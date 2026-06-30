import pygame
pygame.init()
n = pygame.display.get_num_displays()
print(f'모니터 {n}대 발견:')
for i in range(n):
    rect = pygame.display.get_desktop_sizes()[i]
    bounds = pygame.display.get_display_bounds(i) if hasattr(pygame.display, 'get_display_bounds') else 'N/A'
    print(f'  [{i}] 크기={rect}  위치={bounds}')