# TASK-070 개발자 핸드오프

- 대상 작업: TASK-070 (역할 잡 하나를 지금 실행하는 백엔드 커맨드를 만든다)
- 근거 문서: SPEC-020 R1·R6·R7·R8·R9, DECISION-53577F93 (outcome: approved, created_by: user)
- 세션 역할: 개발자 (dev-070)
- 작성 시각: 2026-08-04T09:00Z
- 상태: `qa_waiting`

## 대상 선정과 선점

착수 시점(08:47Z) `todo`는 여섯이었다. TASK-064(`depends_on: [TASK-063]`, 그 선행이 `in_progress`), TASK-065(`[TASK-064, TASK-062]`), TASK-072(`[TASK-062, TASK-065, TASK-071]`), TASK-073(`[TASK-072]`)는 전부 미충족이라 제외했다. 남은 것이 선행 선언이 없는 TASK-070과 TASK-071이고, 한 세션은 하나만 처리하므로 백엔드 쪽인 TASK-070을 잡았다. TASK-071은 손대지 않았다.

`migration.lock` 없음. `leases/`에는 IDEA-4141EE4C·IDEA-CAB890F1·SPEC-009·SPEC-021·TASK-063이 있었고 TASK-070은 없었다(남의 lease는 읽기만 했다). TASK-063이 잡고 있는 `heartbeat_service.rs`는 이 작업의 범위 밖이라 겹치지 않는다.

`sh .workflow/rules/wf-claim.sh acquire TASK-070 dev-070 45` → exit 0, `lease-82974-20260804084806`. 같은 편집에서 `in_progress` + history 기록 → 구현 → 검증 → 중간에 `renew ... 30` exit 0 → `qa_waiting` → release.

## 변경한 파일

신설 둘:

- `src-tauri/src/infrastructure/heartbeat_process.rs` — 실행 파일 후보 해석(`candidates`/`candidates_for`), 손으로 칠 명령(`manual_command`), 프로세스 실행(`run_once`), 실패 사유 enum(`RunFailure`). 테스트 7개.
- `src-tauri/src/application/heartbeat_run_service.rs` — 잡 이름 검증과 실패 값 조립(`HeartbeatRunService::run_job`/`run_with`, `RunJobFailure`). 테스트 7개.

기존 파일 넷, 각각 한 줄~한 블록:

- `src-tauri/src/infrastructure/mod.rs` — `pub mod heartbeat_process;`
- `src-tauri/src/application/mod.rs` — `pub mod heartbeat_run_service;`
- `src-tauri/src/commands/heartbeat.rs` — import 한 줄과 `run_heartbeat_job` 커맨드 하나. 기존 커맨드 셋과 `heartbeat_home`은 무수정.
- `src-tauri/src/lib.rs` — `generate_handler!`에 한 줄.

`application/heartbeat_service.rs`는 이 세션에서 한 줄도 고치지 않았다. `Cargo.toml`·`capabilities/default.json`도 무변경이고 프런트엔드 파일도 무변경이다. 보호 상태(project.yml, workflow.yml, decisions, runtime lock, 스키마) 무변경. git 커밋 안 했다.

## 와이어 계약 (TASK-071이 맞춰야 할 값)

작업 문서에 못박힌 그대로 구현했다. 임의로 바꾼 값이 없다.

- 커맨드 이름 `run_heartbeat_job`, 인자 `path: String` / `job_name: String`(화면에서는 `{ path, jobName }`)
- 성공 `Ok(())` → 화면에는 `null`
- 실패는 `RunJobFailure`가 camelCase로 직렬화된 값. 직렬화 모양을 테스트로 고정했다(`the_failure_value_serializes_to_the_wire_contract`).

```json
{ "jobName": "wf-planner-Users-...", "message": "…", "command": "heartbeat once -j wf-planner-Users-..." }
```

`command`는 사유와 무관하게 언제나 채운다. 홈 해석 실패까지 이 모양으로 돌려주므로, 화면은 이 커맨드의 실패를 한 가지 형태로만 다루면 된다.

## 핵심 결정과 근거

1. 실패 사유를 인프라(`RunFailure`)와 문구(`describe`)로 나눴다. 인프라는 사실만 담고(본 후보 목록, 실행 파일 경로, 종료 코드) 사용자가 읽을 말은 서비스가 만든다. 구분하는 사유는 넷이다 — 이 프로젝트의 역할 잡이 아님, 실행 파일을 찾지 못함(본 경로를 문구에 적는다), 실행을 시작하지 못함, 0이 아닌 종료 코드.
2. `run_with(project_root, candidates, job_name)`를 서비스 안에 뒀다. 이유는 검증 가능성 하나다. 공개 `run_job`은 첫 후보가 PATH의 `heartbeat`라, 하트비트를 설치한 기기에서 그 경로로 테스트를 돌리면 **실제 모델 세션이 뜬다**. 실행 경로를 검사하는 테스트는 전부 존재하지 않는 후보나 임시 스크립트를 명시적으로 넘기는 `run_with`로 돌린다. 이 판단은 작업 문서의 "실행 함수는 후보 목록을 인자로 받는다"를 서비스 계층까지 끌어올린 것이다.
3. `candidates_for(user_home, windows)`도 같은 이유로 나눴다. 완료 조건 5가 Windows 후보가 하나뿐임을 순수 함수 단위 테스트로 확인하라고 요구하는데, `#[cfg(windows)]`로 가르면 그 단정이 이 기기에서 영영 돌지 않는다. 공개 `candidates`는 `cfg!(windows)`를 그 인자에 넘기는 한 줄이다.
4. 인자 검증을 실행보다 먼저 둔 것이 완료 조건 21·23의 핵심이라, "이름이 틀리면 프로세스가 뜨지 않는다"를 흔적으로 확인하는 테스트를 따로 만들었다(`an_unknown_job_name_never_spawns_the_candidate`). 실행되면 파일을 남기는 스크립트를 유일한 후보로 주고, 그 파일이 없다는 것으로 단정한다.
5. 인자가 `once -j <잡 이름>` 고정이라는 것도 실제로 띄워서 확인했다. 받은 인자를 파일에 적고 끝나는 임시 스크립트를 후보로 세우고 기록된 인자가 정확히 `once -j <잡 이름>`인지 대조한다(unix 한정). 하트비트를 띄우지 않고 인자 전달을 확인하는 방법이다.
6. 커맨드는 `async fn` + `tauri::async_runtime::spawn_blocking`이다. 자식이 끝날 때까지 기다리므로 동기 커맨드면 타임아웃 상한(20~30분)까지 창이 멈춘다. `spawn_blocking`의 join 실패도 같은 실패 모양으로 돌려준다.
7. 홈 해석 실패는 `heartbeat_home`이 `String`을 돌려주므로 `RunJobFailure::new`로 감쌌다. 사유 문구는 기존 것을 그대로 싣는다.

## 완료 조건 대조

| # | 조건 | 닫은 방법 |
|---|---|---|
| 1 | 커맨드 등록과 와이어 계약 | `lib.rs` `generate_handler!` 한 줄 + `the_failure_value_serializes_to_the_wire_contract` |
| 2 | 세 역할 잡만 실행 대상 | `every_role_job_of_this_project_reaches_the_run_path`, `a_name_that_is_not_a_role_job_of_this_project_fails_without_running_anything`, `dream_jobs_are_not_runnable_through_this_action`, `an_unknown_job_name_never_spawns_the_candidate` |
| 3 | 인자 `once -j <잡 이름>` 고정 | `the_job_runs_with_once_and_the_job_name_only`. 잡을 지정하지 않는 실행 형태는 코드에 없다(`SUBCOMMAND`/`JOB_FLAG` 상수 외 인자 경로 없음) |
| 4 | 실행 경로가 파일을 쓰지 않음 | `running_writes_no_files_to_the_home_or_the_project` — 임시 홈·임시 프로젝트 루트를 넘긴 실행 뒤 두 디렉터리가 비어 있다. 두 입구(이름 검증에서 끝나는 쪽, 실행까지 가는 쪽)를 각각 확인 |
| 5 | 후보 순서와 Windows 후보 | `candidates_put_path_before_the_user_install_location`, `windows_has_only_the_path_candidate` |
| 6 | 없는 후보에서 실패 값과 `command` | `a_missing_executable_reports_the_command_the_user_can_type`, `missing_candidates_report_every_path_that_was_looked_at` |
| 7 | 전부 자동화 테스트 | 신규 14개 (`heartbeat_process` 7, `heartbeat_run_service` 7) |
| 8 | 셸 의존성·권한 무추가 | `Cargo.toml`·`capabilities/default.json` 이 세션 변경 0. 두 파일에 `shell` 문자열 0건 |
| 9 | `heartbeat_service.rs` 무변경 | 이 세션 변경 0 (아래 주의 참조) |
| 10 | 기존 테스트 무삭제·무비활성 | 기존 파일 넷의 변경은 모듈 선언·import·커맨드 추가·핸들러 등록뿐. 기존 366개 중 삭제·`#[ignore]` 추가 0 |
| 11 | `cargo test` 통과 | 아래 게이트 |

추가로 확인한 것: `run_once`가 `NotFound`일 때만 다음 후보로 넘어간다(`a_missing_candidate_falls_through_to_the_next_one`), 0이 아닌 종료 코드가 그 코드를 담은 실패가 된다(`a_nonzero_exit_code_is_a_failure_that_carries_the_code`).

## 게이트 수치

```
cargo test --manifest-path src-tauri/Cargo.toml   366 passed / 0 failed / 4 ignored   (경고 0)
cargo fmt --manifest-path src-tauri/Cargo.toml --check   exit 0
```

`4 ignored`는 TASK-063이 남긴 SPEC-022 재현 테스트다. 이 작업이 만든 것이 아니고 손대지도 않았다.

## 검증 절차의 두 번째 명령에 대한 주의

작업 문서는 `git diff --stat`으로 세 파일이 비어 있어야 한다고 적었는데, 이 세션 착수 시점에 그 셋이 이미 워킹 트리에서 수정된 상태였다. 커밋되지 않은 선행 작업들의 결과다.

- `Cargo.toml` +1, `capabilities/default.json` +1/-1: `tauri-plugin-clipboard-manager`와 `clipboard-manager:allow-write-text`. SPEC-020 확인 사실 2가 이미 이 넷을 현행 권한으로 적고 있으므로 이 작업 이전의 것이다.
- `heartbeat_service.rs`: TASK-063을 포함한 SPEC-022 계열 작업이 진행 중인 파일이다.

그래서 `git diff --stat`은 셋 다 비어 있지 않다. 이 세션이 셋에 아무것도 더하지 않았다는 것은 다음으로 확인했다. 두 설정 파일에 `shell` 문자열이 0건이고(셸 플러그인 의존성·셸 실행 권한 없음), `heartbeat_service.rs`의 diff에 `heartbeat_process`/`heartbeat_run_service`/`run_heartbeat_job` 언급이 0건이다. QA에서 이 셋을 볼 때는 HEAD 대비가 아니라 "셸이 붙었는가"와 "실행 코드가 저 파일에 들어갔는가"로 판정하면 된다.

## 남는 리스크와 핸드오프 노트

1. **TASK-071이 이 계약에 맞춰야 한다.** 커맨드 이름·인자 키(`path`, `jobName`)·실패 payload 세 필드가 어긋나면 화면이 존재하지 않는 커맨드를 부른다. 실패 모양은 이 세션의 직렬화 테스트가 고정하고 있으니 프런트 타입은 그 셋을 그대로 쓰면 된다.
2. **성공이 곧 세션이 떴다는 뜻이 아니다.** 조건 미충족과 한도 도달은 하트비트가 종료 코드 0으로 끝내므로 이 커맨드는 `Ok(())`를 돌려준다. 그 구분은 R4·R5대로 실행 기록 조회가 하는 일이고 TASK-073의 범위다. 화면이 `Ok`를 "세션이 떴다"로 번역하면 안 된다.
3. **취소 경로가 없다.** 띄운 뒤 되돌리는 조작은 기획서 제외 범위라 만들지 않았다. 커맨드는 자식이 끝날 때까지 기다리므로, 앱이 먼저 닫히면 진행 중이던 실행의 결말을 앱이 모른다. R3 마지막 문단(앱을 닫았을 때의 처리)은 프런트 쪽 작업에 남아 있는 결정이다.
4. **exit code 실행 테스트 셋은 unix 한정이다.** 임시 실행 스크립트를 세우는 방식이라 `#[cfg(unix)]`를 달았다. Windows에서는 순수 함수 테스트와 후보 검증 테스트만 돈다. 후보 순서의 Windows 형태는 플랫폼과 무관하게 단정된다(결정 3번).
5. **역할 밖 발견(수정하지 않음).** `heartbeat_roles.rs`와 `heartbeat_condition.rs` 머리에 남아 있는 `#![allow(dead_code)]`는 "커맨드 계층이 호출하면 지운다"는 주석과 함께 붙어 있는데, 두 모듈 다 이미 호출되고 있다. 이 작업의 범위가 아니라 그대로 뒀다.
