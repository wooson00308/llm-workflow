---
schema: workflow-labs/task@1
id: TASK-115
title: 도는 데몬과 디스크의 버전을 읽어 어긋남을 판정한다
status: verified
source_spec_id: SPEC-037
source_decision_id: DECISION-6C2F2639
depends_on:
- TASK-114
scope_files:
- src-tauri/src/application/heartbeat_version_service.rs
- src-tauri/src/application/mod.rs
- src-tauri/src/commands/heartbeat.rs
- src-tauri/src/lib.rs
- src-tauri/src/infrastructure/heartbeat_status.rs
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-05T03:25:00Z
  kind: created
- at: 2026-08-05T06:35:00Z
  kind: in_progress
- at: 2026-08-05T06:50:00Z
  kind: qa_waiting
- at: 2026-08-05T09:08:41.758465+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-6C2F2639
work_group_revision: 1
---

# 도는 데몬과 디스크의 버전을 읽어 어긋남을 판정한다

확인 필요 2번의 승인안이다. SPEC-034가 판정 수단이 없어 뺐던 자리를 데몬이 만든 두 표면으로 채운다.
화면 표시는 TASK-117이 받는다.

승인안의 근거가 그대로 이 작업의 설계다: `update.py`가 재기동 필요를 **도는 프로세스의 버전과 디스크의
버전 비교**로 판정하므로, 앱이 같은 두 값을 같은 방식으로 비교하면 데몬과 같은 판정을 한다.

## 두 값을 읽는 방법

- **도는 데몬의 버전** — `~/.claude/heartbeat/state.json`의 `_daemon.version`. `heartbeat_status.rs`가
  이미 이 파일을 읽으므로 그 모듈에 접근자를 하나 더한다. 파일이 없거나 JSON이 깨졌거나 `_daemon`
  항목이 없으면 **모름**이다. 없는 파일은 오류가 아니다 — 그 모듈의 규약이 그렇다.
- **디스크의 버전** — `heartbeat --version`을 실행해 stdout 한 줄에서 읽는다. 실행은 TASK-113이 만든
  캡처 실행을 그대로 쓴다.

출력 형식이 인용 절이 적은 모양이 아니면 **모름**이고, 받은 원문을 그대로 보존한다. 형식이 조금 다른
값을 앱이 버전처럼 잘라 내지 않는다.

## 판정 셋

1. 두 값을 모두 알고 같다 → 어긋나지 않았다.
2. 두 값을 모두 알고 다르다 → 어긋났다. 08-05 사고(디스크 main / 메모리 v0.8.0)의 모양이다.
3. 한쪽이라도 모른다 → **판정 불가**. 아는 값만 싣고 사유를 함께 싣는다.

3번의 사유는 서로 다른 말이어야 한다. 실행 파일을 찾지 못한 것(확인 사실 11, 이 기기의 현재 상태),
`state.json`이 없거나 `_daemon`이 없는 것, 출력 형식이 계약 밖인 것은 사용자가 할 다음 행동이 다르다.
승인안의 한계가 그 첫째를 미리 적었다 — "실행 파일을 못 찾는 기기에서는 도는 버전만 읽히므로 어긋남
판정이 불가능하다."

**모르는 값을 아는 척하지 않는다.** SPEC-034 R2가 세운 선이고 R5가 다시 든 선이다. 한쪽만 아는 상태를
"같다"로도 "다르다"로도 접지 않는다.

## 커맨드는 조회 주기에 실리지 않는다

이 판정은 프로세스를 하나 띄운다. `inspect_integrations`는 자동 새로고침 주기마다 불리므로 **여기에
얹지 않는다.** `heartbeat_setup.rs` 머리주석이 "실행 파일을 찾아 다니지도 않는다"로 같은 선을 이미
세웠고, 조회에 실행을 얹으면 그 선이 무너진다.

- `commands/heartbeat.rs`에 전용 커맨드를 하나 더하고 `lib.rs`에 등록한다. 인자는 없다.
- `async` + `spawn_blocking`. `--version`은 짧지만 실행 파일 탐색이 걸리는 자리다.
- 호출 시점은 화면이 정한다(TASK-117). 커맨드 머리주석에 "조회 주기·화면 진입의 자동 갱신에서는 부르지
  않는다"를 적는다.
- 앱은 이 경로에서 파일을 쓰지 않는다.

이 커맨드의 결과가 화면에 주는 것이 하나 더 있다. **실행 파일을 찾았는지**가 여기서 처음으로 확정된다.
TASK-117이 그 값을 쓸 수 있다는 것을 결과 타입이 드러내야 한다(찾지 못했으면 본 후보 목록이 실린다).

## 완료 조건

1. `state.json`의 `_daemon.version`을 읽는 경로가 있고, 파일 없음·JSON 깨짐·항목 없음 셋이 모두
   오류가 아니라 "모름"으로 끝난다.
2. `heartbeat --version`의 출력에서 디스크 버전을 읽고, 인용 절이 적은 형식이 아니면 "모름"으로 두며
   원문을 보존한다.
3. 판정 셋(같음·다름·판정 불가)이 구분되고, 판정 불가의 사유가 위 셋으로 갈린다.
4. 실행 파일을 찾지 못한 경우 본 후보 목록이 결과에 실리고, 도는 데몬의 버전은 그래도 실린다.
5. 이 판정이 `inspect_integrations`의 경로에 들어가지 않는다. 조회 커맨드가 프로세스를 띄우지 않는다는
   것이 검사로 남는다.
6. 앱이 쓰는 표면이 `docs/heartbeat.md`의 인용 절에 적힌 것뿐이다.
7. 설치 판정·잡 저장·"지금 실행"·084 경고의 기존 동작이 달라지지 않는다(R9). `heartbeat_status.rs`의
   기존 검사가 기대값 수정 없이 통과한다.
8. 기존 자동 검사가 삭제되거나 비활성화되지 않고, `npm run check`와
   `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.

## 검증 절차

1. `cargo test --manifest-path src-tauri/Cargo.toml`. `state.json` 픽스처 넷(정상 `_daemon`, `_daemon`
   없음, 깨진 JSON, 파일 없음)과 `--version` 출력 셋(정상 한 줄, 형식 밖, 빈 출력)을 각각 세운다.
2. 어긋남 판정은 두 값의 조합으로 세운다 — 같음·다름·한쪽 모름 셋.
3. `npm run check`.
4. 이 기기에서 커맨드를 실제로 부른 결과와, 그때 `~/.claude/heartbeat/state.json`의 `_daemon` 항목
   원문을 보고서에 적는다. 확인 사실 11대로 판정 불가가 나오면 그 사유가 실행 파일 쪽인지 확인한다.

## 범위 파일

- `src-tauri/src/application/heartbeat_version_service.rs` — 새 모듈. 두 값 읽기·판정·결과 타입.
- `src-tauri/src/application/mod.rs` — 모듈 등록.
- `src-tauri/src/commands/heartbeat.rs` — 커맨드 하나.
- `src-tauri/src/lib.rs` — `invoke_handler` 등록.
- `src-tauri/src/infrastructure/heartbeat_status.rs` — `_daemon.version` 접근자.

## 선행

- `TASK-114` — `commands/heartbeat.rs`·`lib.rs`를 함께 만지므로 순서가 필요하다. 실행 기반은
  TASK-113이 만들고 그 작업은 TASK-114의 선행이다.
