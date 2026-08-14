---
schema: workflow-labs/task@1
id: TASK-114
title: 설치 2·3단계를 앱이 대신 실행한다
status: verified
source_spec_id: SPEC-037
source_decision_id: DECISION-6C2F2639
depends_on:
- TASK-113
scope_files:
- src-tauri/src/application/heartbeat_setup_run_service.rs
- src-tauri/src/application/mod.rs
- src-tauri/src/commands/heartbeat.rs
- src-tauri/src/lib.rs
- src-tauri/src/infrastructure/heartbeat_setup.rs
- src-tauri/src/domain/project.rs
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-05T03:25:00Z
  kind: created
- at: 2026-08-05T06:15:00Z
  kind: in_progress
- at: 2026-08-05T06:29:00Z
  kind: qa_waiting
- at: 2026-08-05T09:08:41.765526+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-6C2F2639
work_group_revision: 1
---

# 설치 2·3단계를 앱이 대신 실행한다

SPEC-037 R2의 백엔드다. 확인 필요 1번의 승인안이 이 작업의 범위를 정한다. 화면은 TASK-117이 받는다.

## 승인안이 정한 범위

> 데몬이 명령으로 소유한 걸음만 실행한다 — `heartbeat init`(2단계)과 `heartbeat install-service`
> (3단계). 패키지 획득 자체(`pip install` 또는 git clone)는 실행 대상에서 빼고 지금처럼 명령 원문과
> 복사 수단으로 남긴다.

실행 대상은 **정확히 둘**이다.

- 1단계(`pip install claude-heartbeat`)는 실행하지 않는다. 그 패키지는 PyPI에 없고(확인 사실 12),
  버튼을 붙이면 앱이 404를 대신 실행한다. R2의 마지막 항목이 그것을 막는다.
- 4단계(`heartbeat install dream`)도 실행하지 않는다. 승인안이 든 것은 둘이고, 승인 범위를 앱이
  넓히지 않는다. 넓혀야 할 이유가 보이면 고쳐서 진행하지 말고 보고서에 적고 아키텍트 후속으로 넘긴다.

## 실행 가능 여부를 백엔드가 싣는다

`HeartbeatSetupStage`에 실행 가능 표식을 하나 더한다(`domain/project.rs`), 값은
`heartbeat_setup.rs`의 각 단계 함수가 채운다. init·service만 참이고 package·dream은 거짓이다.

화면이 단계 종류를 보고 스스로 갈리게 하지 않는다. 명령을 소유한 쪽이 백엔드이므로 "이 단계를 앱이
실행할 수 있는가"도 백엔드가 답한다. 이 저장소가 `command`·`evidence`를 payload에 완성해 싣는 것과
같은 규칙이다(`heartbeat_setup.rs` 머리주석의 "화면이 조각을 조립하지 않게").

기존 네 단계의 순서·상태 판정·`required`·`command`·`evidence`는 한 값도 바뀌지 않는다. 설치 판정이
달라지지 않는 것이 R9이고 완료 조건 7이다.

## 실행 서비스

새 모듈 `src-tauri/src/application/heartbeat_setup_run_service.rs`가 소유한다.

- **화면이 보내는 것은 단계 식별자 하나**다. 명령 문자열이 아니다. 식별자 → 고정 인자의 매핑은 이
  모듈의 상수이고, 알 수 없는 식별자는 **프로세스를 띄우지 않고** 실패로 끝난다.
  `heartbeat_run_service.rs`의 잡 이름 검증이 같은 어법의 선례다.
- 실행 대상이 아닌 단계(package·dream)의 식별자가 와도 같은 자리에서 실패다. 백엔드가 payload로
  "실행 불가"라고 말해 놓고 실행 통로는 열어 두는 상태를 만들지 않는다.
- 실행은 TASK-113이 만든 캡처 실행을 그대로 쓴다. 셸 없음·고정 인자·후보 탐색 재사용이 그대로다.
- 결과는 종료 코드와 stdout·stderr 원문이다.

### 종료 코드를 번역하지 않는다

R7이 이 자리를 정한다. `heartbeat update`와 달리 이 두 명령은 **원인별 종료 코드가 계약에 없다**
(확인 사실 13은 명령이 있다는 것까지다). TASK-112가 `docs/heartbeat.md`에 적은 인용 절이 판단 기준이다.

- 인용 절이 "0/비0만 쓴다"로 적었으면 앱도 그것만 쓴다. 성공과 실패 두 갈래이고, 실패의 사유는 앱이
  지어내지 않고 stderr 원문이 말한다.
- 인용 절이 의미별 코드를 적었으면 그 목록만 번역한다. 절에 없는 코드는 숫자 그대로 싣는다.

## 커맨드

`commands/heartbeat.rs`에 커맨드 하나를 더하고 `lib.rs`에 등록한다.

- 인자는 단계 식별자 하나다. `path`는 받지 않는다 — 설치는 프로젝트와 무관한 조작이다.
- `async` + `spawn_blocking`. `heartbeat init`은 짧지만 `install-service`는 등록물 생성과 기동을
  포함한다.
- **이 커맨드는 스냅샷을 돌려주지 않는다.** 실행 결과만 돌려주고, 단계 상태의 갱신은 화면이 기존
  조회(`inspect_integrations`)를 다시 부르는 것으로 얻는다. 설치 판정의 원천을 둘로 만들지 않는다.
- 앱은 이 경로에서 파일을 쓰지 않는다. 파일을 쓰는 것은 데몬이다. 이 구분이 확인 화면의 문구를
  정하므로(TASK-117) 머리주석에 적는다.

## 완료 조건

1. 단계 식별자 하나를 받아 `heartbeat init` 또는 `heartbeat install-service`를 고정 인자로 실행하는
   경로가 있다.
2. 그 밖의 식별자(package·dream·모르는 값)는 프로세스를 띄우지 않고 실패로 끝난다. 띄웠으면 남았을
   흔적이 없다는 것으로 확인한다(`heartbeat_run_service.rs`의 같은 검사가 선례다).
3. 화면이 준 문자열이 명령줄에 흘러가는 경로가 없다. 명령 원문은 백엔드 상수에서만 나온다.
4. 결과에 종료 코드와 stdout·stderr 원문이 실린다. 실패 사유를 앱이 지어내지 않는다.
5. 실행 파일을 찾지 못하면 본 후보 목록과 사용자가 칠 명령 원문이 결과에 실린다(R5).
6. `HeartbeatSetupStage`가 단계별 실행 가능 여부를 싣고, 참인 것은 init·service 둘뿐이다.
7. 네 단계의 순서·상태 판정·`required`·`command`·`evidence`가 변경 전과 같다. `heartbeat_setup.rs`의
   기존 네 검사가 기대값 수정 없이 통과한다.
8. 앱이 쓰는 표면이 `docs/heartbeat.md`의 인용 절에 적힌 것뿐이다.
9. 기존 자동 검사가 삭제되거나 비활성화되지 않고, `npm run check`와
   `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.

## 검증 절차

1. `cargo test --manifest-path src-tauri/Cargo.toml`. 실행 경로는 recorder 스크립트로 인자를 확인하고,
   거부 경로는 프로세스가 뜨지 않았음을 흔적 없음으로 확인한다.
2. `npm run check`.
3. 이 기기에서 두 식별자를 각각 한 번 부른 결과를 보고서에 적는다. 실행 파일을 찾지 못하는 경로가
   나오면 그 값이 R5의 모양인지 함께 적는다.

## 범위 파일

- `src-tauri/src/application/heartbeat_setup_run_service.rs` — 새 모듈. 식별자 검증·매핑·결과.
- `src-tauri/src/application/mod.rs` — 모듈 등록.
- `src-tauri/src/commands/heartbeat.rs` — 커맨드 하나.
- `src-tauri/src/lib.rs` — `invoke_handler` 등록.
- `src-tauri/src/infrastructure/heartbeat_setup.rs` — 단계별 실행 가능 표식을 채운다.
- `src-tauri/src/domain/project.rs` — `HeartbeatSetupStage`의 새 필드.

## 선행

- `TASK-113` — 캡처 실행 기반을 만드는 작업. `commands/heartbeat.rs`·`lib.rs`도 함께 만지므로 순서가
  필요하다.
