---
schema: workflow-labs/task@1
id: TASK-113
title: 앱이 heartbeat update를 실행하고 계약 출력을 구조화한다
status: verified
source_spec_id: SPEC-037
source_decision_id: DECISION-6C2F2639
depends_on:
- TASK-112
scope_files:
- src-tauri/src/infrastructure/heartbeat_process.rs
- src-tauri/src/application/heartbeat_update_service.rs
- src-tauri/src/application/mod.rs
- src-tauri/src/commands/heartbeat.rs
- src-tauri/src/lib.rs
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-05T03:25:00Z
  kind: created
- at: 2026-08-05T05:43:46Z
  kind: in_progress
- at: 2026-08-05T06:00:23Z
  kind: qa_waiting
- at: 2026-08-05T09:08:41.772144+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-6C2F2639
work_group_revision: 1
---

# 앱이 heartbeat update를 실행하고 계약 출력을 구조화한다

SPEC-037의 백엔드 첫 걸음이다. R1·R4·R5·R7·R8을 백엔드 쪽에서 닫는다. 화면은 TASK-116이 받는다.

이 작업이 만드는 것은 둘이다. 하나는 **하트비트를 고정 인자로 띄우고 출력을 받아 오는 실행 기반**
(`heartbeat_process.rs`), 다른 하나는 **`heartbeat update`의 계약 출력을 값으로 옮기는 서비스와 그
커맨드**다. TASK-114·TASK-115가 같은 실행 기반을 쓰므로 이 작업이 먼저 선다.

## 실행 기반이 지키는 선

`heartbeat_process.rs`의 머리주석이 세운 규약을 그대로 잇는다. 새로 만드는 것은 "출력을 버리지 않는
실행" 하나뿐이다.

- **셸을 거치지 않는다.** `std::process::Command`로 실행 파일을 직접 띄운다. `tauri-plugin-shell`을
  붙이지 않는다.
- **인자는 백엔드 상수에서만 나온다.** 화면이 준 문자열이 명령줄에 이어 붙는 경로를 만들지 않는다.
  `update`도 상수다.
- **후보 탐색은 지금 것을 그대로 쓴다.** `candidates()`가 만드는 PATH → `~/.local/bin` 순서와
  Windows에서 PATH 하나뿐인 갈림을 바꾸지 않는다. 확인 필요 4번이 "탐색 규약은 이 기획서에서 다루지
  않는다"로 승인됐다.
- 앞 후보가 `NotFound`일 때만 다음 후보를 본다는 규칙도 그대로다.
- 기존 `run_once`와 그 테스트는 손대지 않는다. `once -j <잡>`은 stdio 셋을 닫고 기다리는 경로이고
  (세션 하나가 수십 분이라 파이프를 열면 막힌다), 새 경로는 출력을 받아 와야 하므로 함수가 다르다.

새 함수는 후보 목록과 고정 인자 목록을 받아 종료 코드·stdout·stderr를 함께 돌려준다. 실패는 지금
`RunFailure`의 세 사유를 그대로 쓴다 — `NotFound { looked }`가 R5의 재료다.

사용자가 손으로 칠 명령 원문도 이 모듈이 만든다. `manual_command(job)`이 잡 이름을 받는 형태라 그대로
쓸 수 없으므로, 인자 목록에서 원문을 만드는 형태를 하나 더 둔다(`heartbeat update`가 그 결과다).

## 계약 출력을 값으로 옮긴다

새 모듈 `src-tauri/src/application/heartbeat_update_service.rs`가 파싱과 판정을 소유한다. 결과 타입은
이 모듈에 둔다 — `heartbeat_run_service.rs`의 `RunJobFailure`가 같은 자리에 있는 선례다.

**읽는 표면은 TASK-112가 `docs/heartbeat.md`에 적은 것뿐이다.** 그 절에 없는 값에 기대지 않는다.
아래 모양은 분해 시점에 작업 트리의 `update.py`에서 확인한 것이고, 계약 문서와 어긋나면 **계약 문서가
맞다.** 어긋남을 발견하면 고쳐서 진행하지 말고 보고서에 적고 멈춘다.

- stdout은 공백으로 나뉜 `key=value` 줄만 나간다. 단계 줄이 0~3개(`step=repo` → `step=deps` →
  `step=service`), 마지막에 `result=` 줄이 정확히 하나이고 그 줄이 언제나 마지막이다.
- 단계 줄은 `status`(`ok`·`failed`·`skipped`)와 `detail`을 싣는다.
- `result` 줄은 `result`(`ok`·`partial`·`failed`)·`version`·`exit`을 싣는다.
- 종료 코드는 원인별로 갈린다: 0, 10, 11, 12, 13, 14, 20, 30, 31, 32.
- 사람용 진단은 stderr로 간다.

### 버리지 않는다

R4의 마지막 항목이 이 작업의 자리다. **stderr 원문을 결과 값에 그대로 싣는다.** 요약하지도 잘라내지도
않는다. 화면이 그것을 어디에 그릴지는 TASK-116이 정하고, 이 작업은 값이 화면까지 닿게 한다.

단계 줄도 마찬가지다. 앱이 단계 셋을 미리 만들어 두고 채우는 것이 아니라, 데몬이 실제로 낸 줄만
순서대로 싣는다. 낸 적 없는 단계를 앱이 "건너뜀"으로 지어내면 그것이 R4가 막는 뭉뚱그림이다.

### 계약 밖으로 끝난 경우

R7의 마지막 항목이 이 자리다. **옛 설치본에는 `update` 서브커맨드가 없다.** 그때 앱이 조용히 아무 일도
하지 않은 것처럼 끝나면 안 된다. 다음 셋을 서로 다른 결과로 구분한다.

1. `result=` 줄이 있고 종료 코드가 계약이 적은 값이다 → 정상 경로.
2. `result=` 줄이 없거나 stdout이 `key=value` 모양이 아니다 → **계약 밖 출력**. 종료 코드와 stdout·
   stderr 원문을 그대로 실어 "이 설치본이 계약대로 답하지 않았다"고 말한다. 성공으로 읽지 않는다.
3. 실행 자체가 실패했다(`RunFailure` 셋) → R5의 경로. 본 후보 목록과 명령 원문을 싣는다.

계약에 없는 종료 코드는 번역하지 않고 숫자 그대로 싣는다. 아는 척하지 않는 쪽이 SPEC-034 R2가 세운
선이고, 화면이 "모르는 코드"로 말할 수 있어야 한다.

## 커맨드

`commands/heartbeat.rs`에 커맨드 하나를 더하고 `lib.rs`의 `invoke_handler`에 등록한다.

- 인자는 없다(`app` 제외). 업데이트는 프로젝트와 무관한 조작이라 `path`를 받지 않는다. 실행 파일 후보를
  만들 사용자 홈만 커맨드 계층이 해석한다 — `run_heartbeat_job`이 같은 이유로 같은 모양이다.
- `async` + `tauri::async_runtime::spawn_blocking`. `git fetch`와 `pip install`이 걸리는 조작이라
  동기 커맨드로 두면 창이 멈춘다. `run_heartbeat_job`의 선례를 그대로 따른다.
- 앱은 이 경로에서 **어떤 파일도 쓰지 않는다.** 파일을 쓰는 것은 데몬이다.
- 이 커맨드는 조회 주기·화면 진입에서 불리지 않는다. 사용자가 확인 화면에서 누른 자리에서만 불린다는
  것을 머리주석에 적는다(`run_heartbeat_job`의 주석과 같은 어법).

## 완료 조건

1. 고정 인자로 띄우고 stdout·stderr·종료 코드를 함께 돌려주는 실행 경로가 있고, 후보 순서와 폴스루
   규칙이 기존과 같다.
2. 기존 `run_once`의 동작과 테스트가 그대로다. 삭제하거나 비활성화하지 않는다.
3. 단계 줄 0~3개와 `result` 줄 하나를 순서대로 담은 결과가 나온다. 데몬이 내지 않은 단계를 앱이 만들지
   않는다.
4. `result`의 세 값과 종료 코드가 결과에 그대로 실린다. `partial`이 `ok`·`failed` 어느 쪽으로도 접히지
   않는다.
5. stderr 원문이 결과에 실린다. 비어 있으면 비어 있는 것으로 실린다.
6. `result` 줄이 없는 출력이 성공으로 읽히지 않고, 종료 코드·stdout·stderr와 함께 "계약 밖"으로
   구분된다.
7. 실행 파일을 찾지 못하면 본 후보 목록과 사용자가 칠 명령 원문(`heartbeat update`)이 결과에 실린다.
8. 앱이 이 경로에서 파일을 쓰지 않는다. 실행 전후로 하트비트 홈과 프로젝트 디렉터리의 파일 목록이
   같다(`heartbeat_run_service.rs`의 같은 검사가 선례다).
9. 화면이 준 문자열이 인자로 흘러가는 경로가 없다. 커맨드가 받는 값에 명령 조각이 없다.
10. 앱이 쓰는 표면이 `docs/heartbeat.md`의 인용 절에 적힌 것뿐이다. 절에 없는 표면을 쓰게 됐다면
    보고서에 적고 멈춘다.
11. 기존 자동 검사가 삭제되거나 비활성화되지 않고, `npm run check`와
    `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.

## 검증 절차

1. `cargo test --manifest-path src-tauri/Cargo.toml`. 파싱은 stdout 문자열을 직접 넣는 단위 검사로
   세우고, 실행 경로는 `heartbeat_process.rs`의 recorder 스크립트 어법(인자를 파일에 적고 끝나는 셸
   스크립트)으로 세운다. 실제 하트비트를 띄우지 않는다.
2. 계약 출력의 대표 다섯을 픽스처로 고정한다 — 성공(`result=ok`), 단계 실패(`result=failed`,
   종료 코드 11), 부분 성공(`result=partial`, 종료 코드 31), `result` 줄 없는 출력, 빈 stdout.
3. `npm run check`.
4. 이 기기에서 커맨드를 실제로 한 번 부른 결과를 보고서에 적는다. 확인 사실 11대로 실행 파일을 찾지
   못할 가능성이 높고, 그 실패가 R5의 모양으로 나오는지가 이 작업의 실물 확인이다.

## 범위 파일

- `src-tauri/src/infrastructure/heartbeat_process.rs` — 캡처 실행과 명령 원문.
- `src-tauri/src/application/heartbeat_update_service.rs` — 새 모듈. 파싱·판정·결과 타입.
- `src-tauri/src/application/mod.rs` — 모듈 등록.
- `src-tauri/src/commands/heartbeat.rs` — 커맨드 하나.
- `src-tauri/src/lib.rs` — `invoke_handler` 등록.

`domain/project.rs`와 프론트엔드는 이 작업의 범위 밖이다. 결과 타입은 서비스 모듈에 둔다.

## 선행

- `TASK-112` — 앱이 인용할 계약 표면을 고정하는 작업. 그 절이 서기 전에는 무엇에 기대도 되는지가
  정해지지 않는다(확인 필요 5번의 승인안).
