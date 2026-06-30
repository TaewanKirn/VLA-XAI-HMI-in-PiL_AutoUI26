# 시각 HMI (CARLA 통합본) — 백업/동기 스냅샷

> 본인 repo `TaewanKirn/HAVinteractiondesign_AutoUI26` 안에 둔 **시각 HMI 자극물의 통합본 스냅샷**.
> 협업자 repo(`ystmk1/HCI-prototype-interface`)에는 push 하지 않고, 우리 통합 작업을 본인 repo로 백업·동기하기 위함. (2026-06-24)

## 출처
- 원본: `ystmk1/HCI-prototype-interface` 의 **새 디자인 시스템**(origin/main: XAI canvas·sequence-driven HMI·Gemini chat)
- 그 위에 얹은 **우리 작업**(브랜치 `carla-bridge-newdesign`, ystmk1 repo엔 미push):
  1. **CARLA WebSocket 브리지**(`src/services/carlaBridge.js`·`src/hooks/useCarlaBridge.js`) — WS `:8766` 의 `scenario_event` 로 시퀀스 단계 전환, ego 속도(`world_metric`) 수신.
  2. **테슬라 내비풍 라이브 주행 배경**(`public/drive_bg/drive_bg.html`) — ego-중심 3인칭 체이스, 경로 자취 페이드아웃, 경로/ego 색을 단계 status 색에 동기화(postMessage).
  3. **인터페이스 정밀수정**: 맵 라이트모드·30% 투명·차선제거+줌아웃·도로 외곽선 벡터 곡선화·도착타이머(C1 5:00/C2 러닝타임, 오류 시 증가)·현재속도 실 ego 정수·내비버튼→615px 패널.

## 실행 (실험 PC, 로컬 전용)
```
npm install
npm run dev          # http://localhost:5173/hmi
```
- CARLA 연동: 시나리오 main.py 가 WS `:8766` 발행 → `/hmi` 가 구독. `launch_hmi.py`(HMI_VARIANT=visual)가 viewer 위 오버레이로 자동 기동.
- ⚠️ **Vercel(HTTPS)은 `ws://localhost:8766` 연결 불가(mixed-content)** → CARLA 실시간 연동은 반드시 로컬 serve.
- `.env`: `VITE_CARLA_HOST=127.0.0.1`, `VITE_CARLA_PORT=8766`.

## 미완 (다음)
- **#5 Traffic/신호 반영**: collector 가 주변 차량·신호등 상태를 8766 추가 발행 → drive_bg 가 회색 차·신호 마커 렌더.
- 615px 패널 내비 전용 레이아웃(`panelMode`).
