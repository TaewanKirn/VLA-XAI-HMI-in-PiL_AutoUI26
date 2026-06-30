# 24h 무인 드라이런 마라톤 — Windows 실행 가이드

> 목적: 사람 미탑승 드라이런을 **다수 반복**해 논문(AutoUI '26 SRT)의 정량 항목을 실측으로 채운다.
> 도구: `scenarios/tools/dryrun_marathon.py` (단일 파일, 표준 라이브러리만) + `scenarios/tools/scenarioQA.py`.
> 작성 2026-06-29. 모든 CARLA 실행은 **`py -3.10`**(맨 `python`은 3.7=carla 없음).

---

## 0. 이 마라톤으로 채워지는 것

| 논문 항목 | 채움 | 비고 |
|---|---|---|
| 6지표 (Table 2a/2b): min-TTC·max jerk·**max yaw·brake delay·recovery**·lane dev | ✅ 실수치 | 이전 NaN이던 yaw/brake/recovery 포함(로직 보완됨) |
| 테스트베드 동작: real-time factor·충돌·완주·gap 시도 | ✅ 실수치 | |
| **동결 CV** (예비 특성화 → 동결) | ✅ | 동결 빌드 N회 반복 → 종료 요약의 CV% |
| 통신지연 (RTT) | ⚠️ **HMI 연결 시에만** | §3 별도 캡처 권장 |
| 모션큐 충실도(§3.4): RTF가 ~1.0로 복원됐는지 | ✅ | FALLBACK_REALTIME 효과 확인 |

> ⚠️ **6지표·RTF·CV는 백엔드(CARLA)만으로 산출**되지만, **통신지연(ws_latency)은 브라우저 HMI가 붙어 ping을 보낼 때만 기록**된다(§3).

---

## 1. 전제 (실행 전 확인)

1. **Python 3.10 + CARLA 0.9.15** 정상(`py -3.10 -c "import carla"` 에러 없음).
2. **코드 sync 완료**(§2). 통신지연 계측 코드 + scenarioQA 지표 보완 + 마라톤 하네스가 Windows 클론에 반영돼 있어야 함.
3. **🔒 빌드 동결**: 마라톤 시작 후 24h 동안 **코드를 수정하지 않는다.** CV(동결)가 유효하려면 모든 런이 동일 빌드여야 한다(서로 다른 빌드면 CV가 깨짐).
4. 디스크 여유(24h ≈ 180런 × 수 MB JSONL — 단 하네스가 집계 후 **자동 삭제**가 기본).

---

## 2. 코드 sync (Mac → Windows)

두 머신 공유 레포(AutoUI26). Mac에서 변경분을 commit·push한 뒤 Windows에서 받는다.

```bat
:: Windows (CARLA 모노레포 루트에서)
git fetch origin
git pull --rebase origin main
```
- diverge/충돌은 두 머신이 거의 disjoint 폴더라 드묾. 충돌 시 해당 파일만 수동 정리.
- 반영 파일: `data-server/sender/websocket_sender.py`(ping→pong) · `HCI-prototype-interface/src/{services/carlaBridge.js,hooks/useCarlaBridge.js}` · `HCI-prototype-voice/src/hooks/useCarlaBridge.js` · `scenarios/tools/{scenarioQA.py,dryrun_marathon.py,DRYRUN_MARATHON_WINDOWS.md}`.

---

## 3. 실행

### 3-A. 6지표·RTF·CV 마라톤 (메인 — HMI 불필요)

```bat
:: 터미널 1 — CARLA 서버 (맵 로드 ~1–2분)
C:\CARLA_0.9.15\CarlaUE4.exe -windowed -ResX=1280 -ResY=720 -nosound -prefernvidia

:: 터미널 2 — 서버 ready 후, 마라톤 24시간
py -3.10 scenarios\tools\dryrun_marathon.py --hours 24 ^
    --carla-exe "C:\CARLA_0.9.15\CarlaUE4.exe" --carla-restart-on-timeout
```
- CARLA hang 자동복구까지 무인화하려면 `--carla-exe` + `--carla-restart-on-timeout` 지정(권장).
- 고정 횟수로만 돌리려면: `py -3.10 scenarios\tools\dryrun_marathon.py --runs 40 --scenarios C1,C2`
- C1만/C2만: `--scenarios C1` 또는 `--scenarios C2`.

### 3-B. 통신지연(RTT) 캡처 — HMI 연결 필요 (별도·짧게 권장)

RTT는 안정적이라 180회가 필요 없다. **HMI 브라우저를 붙인 짧은 세션 1회**로 충분하다.

```bat
:: 터미널 1 — CARLA 서버 (위와 동일)
:: 터미널 2 — 시나리오 1회 (예: C2)
py -3.10 scenarios\anxiety\Puddle\main.py
:: 터미널 3 — HMI 를 http 로 서빙 (https 면 ws:// 차단됨)
cd HCI-prototype-interface && npm run dev
```
1. **Chrome**에서 `http://localhost:5173` (또는 표시된 포트) 열기 → CARLA(:8766) 연결.
2. DevTools 콘솔에 **2초마다 `[carla-bridge] WS RTT ..ms`** 가 찍히면 ping/pong 성공.
3. 음성 HMI도 같은 방법(`HCI-prototype-voice`)으로 열면 `modality:"voice"` 샘플도 수집(시각/음성 RTT 비교 = 변인통제).
4. 몇 분 돌린 뒤 세션 JSONL(`[WS] 세션 로그 → ...jsonl` 경로)에서:
   ```bat
   py -3.10 scenarios\tools\scenarioQA.py --input <그 jsonl> --scenario C2
   :: 또는 latency 만 빠르게
   findstr ws_latency <그 jsonl>
   ```
   → `ws_latency` 레코드의 `rtt_ms` median/p95 가 §2.1 통신지연 수치.

> 마라톤(3-A) 중에 HMI를 계속 붙여두는 방법도 있으나, 매 런이 새 in-process WS 서버라 브라우저 재연결·런 경계 분리 확인이 필요하다 → **3-B 별도 캡처가 단순·안전.**

---

## 4. 주요 옵션

| 옵션 | 기본 | 설명 |
|---|---|---|
| `--hours <h>` / `--runs <n>` | — | 종료 조건(둘 중 먼저). 하나는 지정 |
| `--scenarios C1,C2` | `C1,C2` | 돌릴 시나리오(교대) |
| `--carla-exe <path>` | — | 지정 시 hang 복구로 CARLA 재시작 가능 |
| `--carla-restart-on-timeout` | off | 런 타임아웃 시 CarlaUE4 재시작 |
| `--carla-restart-after <n>` | 1 | 연속 타임아웃 n회 후 재시작 |
| `--per-run-timeout <s>` | 공칭×2.5 | 런 hang 판정 시간 |
| `--cooldown <s>` | 5 | 런 사이 대기(프로세스 정리) |
| `--keep-jsonl` / `--gzip-jsonl` | 삭제 | 원본 JSONL 보존/압축(기본은 집계 후 삭제) |
| `--out <csv>` | `tools\dryrun_marathon_summary.csv` | 마스터 CSV 경로 |
| `--self-test` | — | CARLA 없이 로직 검증(Mac 가능) |

---

## 5. 출력 읽기

**마스터 CSV**: `scenarios\tools\dryrun_marathon_summary.csv` (런당 1행, 이어쓰기)
컬럼: `run_idx, ts, scenario, status, min_ttc, max_jerk, max_yaw, max_lat_accel, brake_delay, recovery, lane_dev, overshoot, rtf, slowmo, latency_med, latency_p95, collisions, completed, n_metric_frames, n_events, duration_s, jsonl`
- `status`: `ok / exit_<rc> / timeout / launch_fail / qa_fail:<reason>`
- 빈칸 = 결측(NaN). `latency_*`는 HMI 미연결 시 빈칸(정상).

**종료 요약**(자동 출력): 시나리오별 핵심지표 **mean ± SD (CV%)**.
- **동결 판정 권고 게이트: 핵심 6지표 CV < 10–15%.**
- CV가 크면 → (a) 빌드 비동결 또는 (b) 런타임 비결정성(주변 교통/물리 시드). 시드 고정 검토.
- 중단(Ctrl-C) 후 같은 명령 재실행 시 `run_idx` 이어서 누적.

---

## 6. 결과 → 논문 반영

1. **Table 2a/2b**: 시나리오별 N런의 6지표 **mean±SD**(+ CV 열 추가 권장)로 교체. 현재 "측정 로직 보완 완료, 실수치 본수집" 문구 → 실수치.
2. **§2.1 통신 지연**: 3-B의 RTT median/p95(ms)로 채움. "RTT(왕복)"임을 명시.
3. **동결**: CV 게이트 통과 시 본문 "예비 특성화" → **"동결(frozen, CV=…%)"** 승격. Abstract도 동기화.
4. **§3.4 모션큐**: RTF가 ~1.0이면 "슬로모를 FALLBACK_REALTIME으로 **해소**(RTF 0.6→~1.0)"로 서사 확정.
5. **안전성**: "N런 전부 충돌 0·완주"를 `completed`/`collisions` 합계로 보고.

---

## 7. 트러블슈팅

- **CARLA hang(get_world 타임아웃)**: `--carla-restart-on-timeout`로 자동. 수동 시 `CarlaUE4.exe` 재시작 후 마라톤 재실행(CSV 이어붙음).
- **latency 칸이 계속 빈칸**: 3-A(백엔드)만 돌려서 정상 — RTT는 3-B(HMI 연결)에서만. HMI 콘솔에 `WS RTT` 안 찍히면: http로 서빙했는지(https면 ws 차단)·Chrome인지·8766 방화벽 확인.
- **첫 런 JSONL 경로 확인**: 첫 실런에서 서버 콘솔 `[WS] 세션 로그 → ...` 경로가 하네스가 주입한 `runNNNN_*.jsonl`과 일치하는지 1회 육안 확인. 불일치(상설 허브가 살아남아 env 미전달) 시 하네스 폴백이 newest로 잡으나 런 경계 분리가 약해지므로, 그 경우 마라톤 전 잔여 `ws_hub.py` 프로세스를 종료.
- **PowerShell 권한**: 런 전 잔여 프로세스 정리에 `Get-CimInstance` 사용 → 실행정책/권한 1회 확인.
- **충돌 카운트 0만 나옴**: 첫 런 JSONL에서 실제 충돌 메시지 형식(`type`/`event`에 collision) 확인 후 필요 시 `scan_jsonl_extras` 키 보정.

---

## 8. 한 줄 순서 요약

```
sync(§2) → 빌드 동결 → CARLA 서버 → 3-A 마라톤 24h(6지표·CV) → 3-B 짧게(RTT) → CSV·요약 → 논문 반영(§6)
```
