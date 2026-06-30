#!/usr/bin/env python3
# frustration/viewer.py
# frustration 시나리오용 외부 카메라 뷰어.
# main.py가 spawn하는 ego(role_name='hero')에 카메라를 붙여
# 별도 모니터에 표시. left/center/right 3개 인스턴스 실행 가능.

from __future__ import print_function
import glob
import os
import sys
import time
import argparse

try:
    sys.path.append(
        glob.glob('../carla/dist/carla-*%d.%d-%s.egg' % (
            sys.version_info.major,
            sys.version_info.minor,
            'win-amd64' if os.name == 'nt' else 'linux-x86_64'
        ))[0]
    )
except IndexError:
    pass

import carla
import pygame
import numpy as np
from collections import deque


# ================================================================
# 이미지 → pygame Surface 변환 (BGRA 직접 변환, 안정적)
# ================================================================
def image_to_surface(image):
    array = np.frombuffer(image.raw_data, dtype=np.uint8)
    array = array.reshape((image.height, image.width, 4))  # BGRA
    return pygame.image.frombuffer(
        array.tobytes(),
        (image.width, image.height),
        "BGRA"
    )


# ================================================================
# ego 검색 (retry + 디버그 덤프)
# ================================================================
def find_ego_with_retry(world, role_name, timeout=30.0, interval=0.5):
    start    = time.time()
    last_dump = 0.0
    while time.time() - start < timeout:
        actors = world.get_actors().filter('vehicle.*')
        for v in actors:
            if v.attributes.get('role_name', '') == role_name:
                return v

        # 3초마다 차량 목록 덤프
        now = time.time() - start
        if now - last_dump >= 3.0:
            last_dump = now
            count = len(actors)
            print(f'[viewer] 대기 중 {now:.0f}s — 차량 {count}대 발견:')
            for v in actors:
                rn = v.attributes.get('role_name', '(없음)')
                print(f'         id={v.id}  type={v.type_id}  role_name={rn}')

        time.sleep(interval)
    return None


# ================================================================
# 카메라 부착
# ================================================================
def attach_camera(world, ego, width, height, fov, view_mode, postprocess=True, base_yaw=0.0):
    bp = world.get_blueprint_library().find('sensor.camera.rgb')
    bp.set_attribute('image_size_x', str(width))
    bp.set_attribute('image_size_y', str(height))
    bp.set_attribute('fov', str(fov))

    # sync 모드에선 매 tick마다 받도록 0.0
    bp.set_attribute('sensor_tick', '0.0')

    # 화질: post-process(톤매핑·노출·AO) ON 으로 화면을 또렷하게.
    #   단 모션블러·렌즈플레어는 멀미/우천 글레어 유발 → 계속 OFF.
    #   --no-postprocess 로 끄면 예전 Low 호환(밋밋) 동작으로 복귀.
    if bp.has_attribute('enable_postprocess_effects'):
        bp.set_attribute('enable_postprocess_effects', 'True' if postprocess else 'False')
    if bp.has_attribute('motion_blur_intensity'):
        bp.set_attribute('motion_blur_intensity', '0.0')   # 멀미 방지
    if bp.has_attribute('bloom_intensity'):
        bp.set_attribute('bloom_intensity', '0.0')         # 우천 글레어 방지
    if bp.has_attribute('lens_flare_intensity'):
        bp.set_attribute('lens_flare_intensity', '0.0')
    # 그림자/노출 미세 보정 (속성 있을 때만 — 저사양에서 안전)
    if postprocess and bp.has_attribute('gamma'):
        bp.set_attribute('gamma', '2.2')

    # 운전석 위치 (좌측 핸들 기준)
    rel_loc = carla.Location(x=0.0, y=-0.35, z=1.2)

    # 파노라마 이음새 정합: 좌/우 카메라 yaw 오프셋을 FOV와 같게 두면
    # 인접 패널의 화면 가장자리가 정확히 맞닿는다 → 겹침(중복 프레임) 제거.
    #   예) fov=90 → 좌 -90 / 우 +90 (총 270°). 너무 넓으면 --fov 를 낮출 것
    #       (fov=60 → ±60, 총 180°). yaw 오프셋이 fov 를 자동 추종한다.
    yaw_offset = base_yaw          # 전체 리그 기준 yaw (A필러 정렬용, +면 시야 우측→A필러 좌측)
    if view_mode == "left":
        yaw_offset += -fov
    elif view_mode == "right":
        yaw_offset += fov

    rel_rot = carla.Rotation(pitch=-4.0, yaw=yaw_offset, roll=0.0)
    cam_tf  = carla.Transform(rel_loc, rel_rot)

    cam = world.spawn_actor(bp, cam_tf, attach_to=ego)
    return cam


# ================================================================
# 메인
# ================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Frustration scenario external viewer")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=2000, type=int)
    parser.add_argument("--res",  default="1280x720",
                        help="디스플레이 창 '전체' 해상도 (기본 1280x720). "
                             "멀티뷰면 이 폭을 뷰 개수로 나눠 패널 1개 폭 결정. "
                             "예: --views left,center,right --res 5760x1080 → 패널 1920x1080")
    parser.add_argument("--render-res", default=None,
                        help="패널 1개 카메라 캡처 해상도. 지정 안 하면 패널 크기와 동일. "
                             "예: --res 5760x1080 --views left,center,right --render-res 1280x720 "
                             "→ 720p로 캡처 후 패널 크기로 업스케일")
    parser.add_argument("--fov",  default=90.0, type=float)
    parser.add_argument("--yaw",  default=0.0, type=float,
                        help="전체 카메라 리그 기준 yaw[deg] (A필러 정렬). "
                             "+면 시야가 우측을 봐 A필러가 좌측으로 이동.")
    parser.add_argument("--ss",   default=1.0, type=float,
                        help="슈퍼샘플링 배율(>1=더 선명, 무거움). 패널해상도×ss 로 캡처 후 다운스케일. "
                             "--render-res 지정 시 무시.")
    parser.add_argument("--view", choices=["left", "center", "right"],
                        default="center",
                        help="단일 시점 (멀티뷰 --views 안 쓸 때)")
    parser.add_argument("--views", default=None,
                        help="멀티뷰 — 한 창에 좌→우로 나란히 그릴 시점들(콤마구분). "
                             "예: left,center,right . 지정하면 --view 는 무시.")
    parser.add_argument("--pos-x", type=int, default=0,
                        help="창 X 좌표")
    parser.add_argument("--pos-y", type=int, default=0,
                        help="창 Y 좌표 (서라운드가 위쪽이면 음수 가능, 예: -1080)")
    parser.add_argument("--role-name", default="hero",
                        help="찾을 ego role_name (기본 hero)")
    parser.add_argument("--smooth", action="store_true",
                        help="업스케일 시 smoothscale (느리지만 부드러움)")
    parser.add_argument("--no-postprocess", dest="postprocess",
                        action="store_false",
                        help="post-process(톤매핑·노출) 끄기 — Low 호환 밋밋 모드로 복귀")
    parser.set_defaults(postprocess=True)

    args = parser.parse_args()

    # ── 시점 목록 결정 (멀티뷰 우선) ──────────────────────
    if args.views:
        views = [v.strip() for v in args.views.split(",") if v.strip()]
    else:
        views = [args.view]
    n_views = max(1, len(views))

    # ── 해상도/패널 계산 ──────────────────────────────────
    disp_w, disp_h = [int(x) for x in args.res.split("x")]
    panel_w = disp_w // n_views      # 패널 1개 폭 = 창 전체 폭 / 뷰 개수
    panel_h = disp_h
    if args.render_res:
        rend_w, rend_h = [int(x) for x in args.render_res.split("x")]
    elif args.ss and args.ss != 1.0:
        rend_w, rend_h = int(panel_w * args.ss), int(panel_h * args.ss)   # 슈퍼샘플링(다운스케일)
    else:
        rend_w, rend_h = panel_w, panel_h
    upscaling = (rend_w, rend_h) != (panel_w, panel_h)

    # ── 창 위치 지정 (pygame.init 전) ─────────────────────
    # Windows: DPI 인지로 좌표·크기를 물리 픽셀에 정확히 맞춤 (서라운드 5760x1080 정합).
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass
    os.environ["SDL_VIDEO_WINDOW_POS"] = f"{args.pos_x},{args.pos_y}"

    pygame.init()
    pygame.font.init()

    # 테두리 없는 창 (디스플레이 전체 해상도)
    screen = pygame.display.set_mode((disp_w, disp_h), pygame.NOFRAME)
    pygame.display.set_caption("Viewer (" + "|".join(views) + ")")

    print(f"[viewer] 창 {disp_w}x{disp_h} @ ({args.pos_x},{args.pos_y}) "
          f"— 뷰 {n_views}개 {views}, 패널 {panel_w}x{panel_h}")
    if upscaling:
        print(f"[viewer] 패널 캡처 {rend_w}x{rend_h} → {panel_w}x{panel_h} "
              f"업스케일 ({'smooth' if args.smooth else 'fast'})")

    clock = pygame.time.Clock()

    # ── CARLA 연결 ────────────────────────────────────────
    client = carla.Client(args.host, args.port)
    client.set_timeout(5.0)
    world = client.get_world()

    print(f"[viewer] ego 검색 중 (role_name='{args.role_name}')...")
    ego = find_ego_with_retry(world, args.role_name, timeout=30.0)

    if ego is None:
        print(f"\n[viewer] 30초 안에 role_name='{args.role_name}' ego를 못 찾음.")
        print("        - main.py 실행 중인지 확인")
        print("        - 위 차량 목록에 다른 role_name 보이면 --role-name 옵션 사용")
        pygame.quit()
        return

    print(f"[viewer] ego 발견: {ego.type_id} (id={ego.id})")

    # ── 뷰마다 카메라 부착 (각 패널 = 카메라 1개) ────────
    frame_count = [0]

    def _make_listener(queue):
        def _on_image(image):
            queue.append(image)
            frame_count[0] += 1
            if frame_count[0] in (1, 30, 60) or frame_count[0] % 300 == 0:
                print(f'[viewer] {frame_count[0]} frames 수신 (전체 뷰 합산)')
        return _on_image

    cams = []
    for i, view in enumerate(views):
        cam = attach_camera(world, ego, rend_w, rend_h, args.fov, view,
                            postprocess=args.postprocess, base_yaw=args.yaw)
        q = deque(maxlen=1)
        cam.listen(_make_listener(q))
        cams.append({"view": view, "cam": cam, "queue": q,
                     "surf": None, "x": i * panel_w})
        print(f"[viewer] {view:6s} 카메라 부착 — 패널 x={i*panel_w} "
              f"({rend_w}x{rend_h} fov={args.fov} postprocess={args.postprocess})")

    # ── 메인 루프 ─────────────────────────────────────────
    running = True
    try:
        while running:
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    running = False
                elif event.type == pygame.KEYUP and event.key == pygame.K_ESCAPE:
                    running = False

            # 뷰마다 최신 이미지를 surface로 변환 후 자기 패널 위치에 blit
            for c in cams:
                if c["queue"]:
                    surf = image_to_surface(c["queue"].popleft())
                    if upscaling:
                        if args.smooth:
                            surf = pygame.transform.smoothscale(surf, (panel_w, panel_h))
                        else:
                            surf = pygame.transform.scale(surf, (panel_w, panel_h))
                    c["surf"] = surf
                if c["surf"] is not None:
                    screen.blit(c["surf"], (c["x"], 0))

            pygame.display.flip()
            clock.tick(30)

    except KeyboardInterrupt:
        print("\n[viewer] 사용자 중단")

    finally:
        for c in cams:
            try:
                c["cam"].stop()
                c["cam"].destroy()
            except Exception:
                pass
        pygame.quit()
        print(f"[viewer] 종료 (총 {frame_count[0]} frames 수신)")


if __name__ == "__main__":
    main()