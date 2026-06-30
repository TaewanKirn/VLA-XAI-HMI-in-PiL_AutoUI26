"""
CARLA 경량화 공용 설정.

호출 시점: 맵 로드 + sync 모드 ON 직후, 액터 스폰 전.

목적
  - 렌더링 지연으로 인한 프레임 드랍 → 물리/충돌 이상 방지
  - 카메라 센서가 필요한 시나리오도 깨지 않도록 no_rendering_mode 는 끄지 않음

주의
  - CARLA 를 `-quality-level=Low` 로 띄운 상태에서는 unload_map_layer 호출이
    셰이더 재컴파일을 유발해 무한대기로 빠지는 사례가 있음.
    그래서 unload 는 기본 OFF.  Epic 품질에서 띄웠을 때만 unload_layers=True 권장.
"""
import carla


def apply_lightweight_settings(world,
                               unload_layers=False,
                               fixed_delta_seconds=None,
                               max_substep_delta_time=0.01,
                               max_substeps=16):
    # 1) (옵션) 무거운 맵 레이어 언로드 — Low quality 모드에서는 권장하지 않음
    if unload_layers:
        layers = [
            ('Foliage',        carla.MapLayer.Foliage),
            ('ParkedVehicles', carla.MapLayer.ParkedVehicles),
            ('Props',          carla.MapLayer.Props),
            ('Decals',         carla.MapLayer.Decals),
            ('StreetLights',   carla.MapLayer.StreetLights),
            ('Particles',      carla.MapLayer.Particles),
        ]
        unloaded = []
        for name, layer in layers:
            try:
                world.unload_map_layer(layer)
                unloaded.append(name)
            except Exception as e:
                print(f'[Perf] 맵 레이어 {name} 언로드 실패 (무시): {e}')
        if unloaded:
            print(f'[Perf] 맵 레이어 언로드: {" / ".join(unloaded)}')
    else:
        print('[Perf] 맵 레이어 언로드 SKIP (Low quality 호환 모드)')

    # 2) 물리 substepping ON
    #    fixed_delta=0.05 라도 substep_dt=0.01 로 잘라서 5 substep 으로 계산
    #    → 한 tick 이 늦게 와도 차량이 도로를 뚫고 박히거나 NPC 충돌 누락되는 일 방지
    settings = world.get_settings()
    settings.substepping = True
    settings.max_substep_delta_time = max_substep_delta_time
    settings.max_substeps = max_substeps
    if fixed_delta_seconds is not None:
        settings.synchronous_mode = True
        settings.fixed_delta_seconds = fixed_delta_seconds
    world.apply_settings(settings)
    print(f'[Perf] 물리 substepping ON  '
          f'(max_substep_dt={max_substep_delta_time*1000:.0f}ms, '
          f'max_substeps={max_substeps})')
