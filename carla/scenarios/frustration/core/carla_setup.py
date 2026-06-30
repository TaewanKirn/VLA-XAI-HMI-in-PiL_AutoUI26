import carla


def connect(host='localhost', port=2000, timeout=60.0):
    client = carla.Client(host, port)
    client.set_timeout(timeout)
    return client


def load_or_get_world(client, town):
    world = client.get_world()
    current = world.get_map().name.split('/')[-1]
    if current != town:
        print(f'[Setup] 맵 전환: {current} → {town}')
        client.set_timeout(120.0)  # 맵 로딩 충분히 대기
        world = client.load_world(town)
        print(f'[Setup] {town} 로드 완료')
    else:
        print(f'[Setup] {town} 이미 로드됨')
    return world


def cleanup_actors(world):
    for actor in world.get_actors().filter('vehicle.*'):
        actor.destroy()
    for actor in world.get_actors().filter('sensor.*'):
        actor.destroy()
    print('[Setup] 기존 actor 제거 완료')


def enable_sync_mode(world, delta=0.05):
    settings = world.get_settings()
    settings.synchronous_mode = True
    settings.fixed_delta_seconds = delta
    world.apply_settings(settings)
    print(f'[Setup] 동기 모드 ON (delta={delta})')


def disable_sync_mode(world):
    settings = world.get_settings()
    settings.synchronous_mode = False
    settings.fixed_delta_seconds = None
    world.apply_settings(settings)
    print('[Setup] 동기 모드 OFF')
