import carla


class TopDownSpectator:
    def __init__(self, world, center, height=80.0, pitch=-90.0):
        self.spectator = world.get_spectator()
        self.cx, self.cy = center
        self.height = height
        self.pitch = pitch
        self.update()

    def update(self):
        self.spectator.set_transform(carla.Transform(
            carla.Location(x=self.cx, y=self.cy, z=self.height),
            carla.Rotation(pitch=self.pitch)
        ))
