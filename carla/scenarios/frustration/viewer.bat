@echo off
chcp 65001 >nul

REM ============================================================
REM Frustration 시나리오 Viewer 런처 (NVIDIA Surround 단일창)
REM ============================================================
REM 모니터 배치 (현재 리그, 실측):
REM   [Control 1920x1080 @ (0,0)]   [Surround 5760x1080 @ (1920,-1080)]
REM   Control = main.py / EgoCamera / Surround = 좌·중·우 3뷰 한 창
REM
REM viewer.py 1개가 --views left,center,right 로 카메라 3개를
REM 5760x1080 한 창에 나란히 렌더 (좌→중→우, 각 패널 1920x1080).
REM
REM 위치/크기를 바꾸려면 아래 RES/POS_X/POS_Y 만 수정.
REM ============================================================

cd /d "%~dp0"

REM ── 설정 (서라운드 단일 디스플레이) ──────────────
set VIEWER=viewer.py
set VIEWS=left,center,right
set RES=5760x1080
set POS_X=1920
set POS_Y=-1080

REM ── 단일창 viewer 실행 ───────────────────────────
start "Viewer Surround" py %VIEWER% --views %VIEWS% --pos-x %POS_X% --pos-y %POS_Y% --res %RES%

REM bat 은 즉시 종료 (자동 실행 호환).  종료는 viewer 창에서 ESC 또는 X.
