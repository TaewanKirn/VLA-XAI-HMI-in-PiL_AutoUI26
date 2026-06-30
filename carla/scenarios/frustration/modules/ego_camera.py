import carla
import pygame
import numpy as np
import weakref


class EgoCamera:
    """ego 1인칭 카메라 + 컨트롤 UI를 단일 pygame 창에 표시.

    레이아웃:
    ┌─────────────────────┬────────────────┐
    │                     │  HUD / 상태    │
    │   카메라 뷰          │  키 안내       │
    │   (cam_w x cam_h)   │  (panel_w)     │
    └─────────────────────┴────────────────┘
    """

    CAM_W     = 800
    CAM_H     = 450
    PANEL_W   = 260
    WIN_W     = CAM_W + PANEL_W
    WIN_H     = CAM_H

    def __init__(self, world, ego_vehicle,
                 fov=90, x=1.5, z=1.5, pitch=-10.0):
        pygame.init()
        self.screen = pygame.display.set_mode((self.WIN_W, self.WIN_H))
        pygame.display.set_caption('Frustration Scenario')

        self.font_lg = pygame.font.SysFont('Arial', 15)
        self.font_sm = pygame.font.SysFont('Arial', 13)
        self.clock   = pygame.time.Clock()

        self.surface = None  # 카메라 이미지

        # 키 이벤트 상태
        self.events = {
            'gap_decrease':  False,
            'gap_increase':  False,
            'lead_decrease': False,
            'lead_increase': False,
            'force_enter':   False,
            'reset':         False,
            'exit_trigger':  False,
            'quit':          False,
        }

        self._spawn_sensor(world, ego_vehicle, fov, x, z, pitch)

    def _spawn_sensor(self, world, vehicle, fov, x, z, pitch):
        bp = world.get_blueprint_library().find('sensor.camera.rgb')
        bp.set_attribute('image_size_x', str(self.CAM_W))
        bp.set_attribute('image_size_y', str(self.CAM_H))
        bp.set_attribute('fov', str(fov))
        # Low quality 모드 호환: post-process 쉐이더 일괄 OFF
        if bp.has_attribute('enable_postprocess_effects'):
            bp.set_attribute('enable_postprocess_effects', 'False')
        if bp.has_attribute('motion_blur_intensity'):
            bp.set_attribute('motion_blur_intensity', '0.0')
        if bp.has_attribute('bloom_intensity'):
            bp.set_attribute('bloom_intensity', '0.0')
        if bp.has_attribute('lens_flare_intensity'):
            bp.set_attribute('lens_flare_intensity', '0.0')

        tf = carla.Transform(
            carla.Location(x=x, z=z),
            carla.Rotation(pitch=pitch))

        self.sensor = world.spawn_actor(bp, tf, attach_to=vehicle)

        weak_self = weakref.ref(self)
        self.sensor.listen(lambda img: EgoCamera._on_image(weak_self, img))
        print(f'[EgoCamera] 카메라 부착 ({self.CAM_W}x{self.CAM_H} fov={fov})')

    @staticmethod
    def _on_image(weak_self, image):
        self = weak_self()
        if self is None:
            return
        arr = np.frombuffer(image.raw_data, dtype=np.uint8)
        arr = arr.reshape((image.height, image.width, 4))
        arr = arr[:, :, :3][:, :, ::-1]
        self.surface = pygame.surfarray.make_surface(arr.swapaxes(0, 1))

    def poll(self):
        """키 이벤트 처리. 매 틱 호출."""
        for k in self.events:
            self.events[k] = False

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.events['quit'] = True
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    self.events['quit'] = True
                elif event.key == pygame.K_UP:
                    self.events['gap_decrease'] = True
                elif event.key == pygame.K_DOWN:
                    self.events['gap_increase'] = True
                elif event.key in (pygame.K_PLUS, pygame.K_EQUALS, pygame.K_KP_PLUS):
                    self.events['lead_decrease'] = True
                elif event.key in (pygame.K_MINUS, pygame.K_KP_MINUS):
                    self.events['lead_increase'] = True
                elif event.key == pygame.K_SPACE:
                    self.events['force_enter'] = True
                elif event.key == pygame.K_r:
                    self.events['reset'] = True
                elif event.key == pygame.K_e:
                    self.events['exit_trigger'] = True

        return self.events.copy()

    def render(self, elapsed, scenario_duration, ego_state, gap_deg, fade_alpha=0):
        """매 틱 호출. 카메라 + 패널 렌더링.
        fade_alpha: 0(투명)~255(완전 암전). 텔레포트 타이밍 전환을 가리는 검은 오버레이."""

        # ── 카메라 영역 ──────────────────────────────
        if self.surface is not None:
            self.screen.blit(self.surface, (0, 0))
        else:
            pygame.draw.rect(self.screen, (20, 20, 20),
                             (0, 0, self.CAM_W, self.CAM_H))
            txt = self.font_lg.render('카메라 초기화 중...', True, (180, 180, 180))
            self.screen.blit(txt, (20, 20))

        # 카메라 위에 속도 오버레이
        if ego_state:
            spd = ego_state.get('speed_kmh', 0)
            spd_txt = self.font_lg.render(f'{spd:.0f} km/h', True, (255, 255, 255))
            shadow   = self.font_lg.render(f'{spd:.0f} km/h', True, (0, 0, 0))
            self.screen.blit(shadow,  (self.CAM_W - 90, self.CAM_H - 28))
            self.screen.blit(spd_txt, (self.CAM_W - 91, self.CAM_H - 29))

        # ── 오른쪽 패널 ─────────────────────────────
        panel_x = self.CAM_W
        pygame.draw.rect(self.screen, (25, 28, 38),
                         (panel_x, 0, self.PANEL_W, self.WIN_H))

        # 구분선
        pygame.draw.line(self.screen, (60, 65, 80),
                         (panel_x, 0), (panel_x, self.WIN_H), 2)

        y = 12
        def write(text, color=(210, 215, 230), font=None):
            nonlocal y
            f = font or self.font_lg
            surf = f.render(text, True, color)
            self.screen.blit(surf, (panel_x + 12, y))
            y += surf.get_height() + 4

        def divider():
            nonlocal y
            pygame.draw.line(self.screen, (50, 55, 70),
                             (panel_x + 8, y), (panel_x + self.PANEL_W - 8, y))
            y += 8

        # 제목
        write('Frustration Scenario', color=(255, 220, 80))
        divider()

        # 시나리오 상태
        if ego_state:
            state_color = {
                'WAITING': (255, 180, 60),
                'DRIVING': (80, 220, 120),
                'DONE':    (100, 180, 255),
            }.get(ego_state.get('state', ''), (200, 200, 200))

            write(f"state : {ego_state.get('state', '-')}", color=state_color)
            write(f"speed : {ego_state.get('speed_kmh', 0):.1f} km/h")
            write(f"wait  : {ego_state.get('wait_time', 0):.1f} s")
            write(f"collisions: {ego_state.get('collisions', 0)}",
                  color=(255, 80, 80) if ego_state.get('collisions', 0) > 0
                  else (210, 215, 230))

        divider()

        # 파라미터
        write('Parameters', color=(160, 200, 255))
        write(f"gap_angle    : {gap_deg:.0f} deg")
        if ego_state:
            write(f"leading_dist : {ego_state.get('leading_distance', 0):.1f} m")

        divider()

        # 키 안내
        write('Controls', color=(160, 200, 255))
        controls = [
            ('[↑]  gap -5deg  (공격적)',  (180, 230, 180)),
            ('[↓]  gap +5deg  (보수적)',  (180, 230, 180)),
            ('[+]  dist -0.5m',           (180, 230, 180)),
            ('[-]  dist +0.5m',           (180, 230, 180)),
            ('[SPACE] 강제 진입',          (255, 220, 100)),
            ('[E]  출구로 빠지기',         (100, 220, 255)),
            ('[R]  gap 리셋',              (200, 200, 200)),
            ('[ESC] 종료',                 (255, 120, 120)),
        ]
        for text, color in controls:
            write(text, color=color, font=self.font_sm)

        divider()

        # 타이머 바
        progress = min(elapsed / scenario_duration, 1.0)
        bar_w = self.PANEL_W - 24
        pygame.draw.rect(self.screen, (50, 55, 70),
                         (panel_x + 12, y, bar_w, 10), border_radius=4)
        pygame.draw.rect(self.screen, (80, 160, 255),
                         (panel_x + 12, y, int(bar_w * progress), 10),
                         border_radius=4)
        y += 14
        write(f'{elapsed:.0f}s / {scenario_duration:.0f}s',
              color=(150, 160, 180), font=self.font_sm)

        # ── 페이드(암전) 오버레이 — 카메라 영역 위에 검은 막(텔레포트 전환 은폐) ──
        if fade_alpha > 0:
            a = max(0, min(255, int(fade_alpha)))
            overlay = pygame.Surface((self.CAM_W, self.CAM_H))
            overlay.set_alpha(a)
            overlay.fill((0, 0, 0))
            self.screen.blit(overlay, (0, 0))

        pygame.display.flip()
        self.clock.tick(60)

    def cleanup(self):
        if self.sensor and self.sensor.is_alive:
            self.sensor.stop()
            self.sensor.destroy()
        pygame.quit()
        print('[EgoCamera] 정리 완료')
