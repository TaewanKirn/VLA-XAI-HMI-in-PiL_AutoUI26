import os, sys, pygame

pos_x = int(sys.argv[1]) if len(sys.argv) > 1 else 0
pos_y = int(sys.argv[2]) if len(sys.argv) > 2 else 0

os.environ["SDL_VIDEO_WINDOW_POS"] = f"{pos_x},{pos_y}"
pygame.init()
screen = pygame.display.set_mode((600, 300))
pygame.display.set_caption(f"Pos ({pos_x},{pos_y})")

font = pygame.font.SysFont(None, 72)
text = font.render(f"({pos_x}, {pos_y})", True, (255, 255, 255))

running = True
while running:
    for ev in pygame.event.get():
        if ev.type in (pygame.QUIT, pygame.KEYDOWN):
            running = False
    screen.fill((30, 30, 60))
    screen.blit(text, (50, 100))
    pygame.display.flip()

pygame.quit()