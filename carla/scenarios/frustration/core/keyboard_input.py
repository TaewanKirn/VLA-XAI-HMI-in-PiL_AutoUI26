import pygame


class KeyboardInput:
    """pygame 기반 키보드 입력. CARLA 시뮬레이션과 별도 창에서 입력 받음."""

    def __init__(self, window_size=(400, 220)):
        pygame.init()
        self.screen = pygame.display.set_mode(window_size)
        pygame.display.set_caption('Frustration Scenario - Control')
        self.font = pygame.font.SysFont('Arial', 14)
        self.clock = pygame.time.Clock()

        self.events = {
            'gap_decrease': False,     # ↑ 키
            'gap_increase': False,     # ↓ 키
            'lead_decrease': False,    # + 키 (거리 줄임 = 공격적)
            'lead_increase': False,    # - 키 (거리 늘림 = 보수적)
            'force_enter': False,      # SPACE
            'reset': False,            # R
            'quit': False,             # ESC
        }

    def poll(self):
        """매 틱 호출. 누른 키를 events로 반환 후 클리어."""
        for k in self.events:
            self.events[k] = False

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.events['quit'] = True
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_UP:
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
                elif event.key == pygame.K_ESCAPE:
                    self.events['quit'] = True

        return self.events.copy()

    def render_status(self, status_dict):
        """현재 상태를 pygame 창에 표시."""
        self.screen.fill((30, 30, 40))

        y = 10
        title = self.font.render('Frustration Scenario Control',
                                 True, (255, 255, 255))
        self.screen.blit(title, (10, y))
        y += 25

        for key, value in status_dict.items():
            text = self.font.render(f'{key}: {value}', True, (200, 200, 200))
            self.screen.blit(text, (10, y))
            y += 18

        y += 10
        help_text = [
            '[UP/DOWN]   gap_angle +-5deg',
            '[+/-]       leading_distance -+0.5m',
            '[SPACE]     force enter 1.5s',
            '[R]         reset',
            '[ESC]       quit',
        ]
        for line in help_text:
            text = self.font.render(line, True, (150, 200, 150))
            self.screen.blit(text, (10, y))
            y += 16

        pygame.display.flip()
        self.clock.tick(60)

    def cleanup(self):
        pygame.quit()
