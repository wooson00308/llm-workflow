# TASK-005 개발자 핸드오프

- 대상 작업: TASK-005 (하트비트 설치·데몬·실행 기록 읽기와 중복 잡 감지 구현)
- 출처 기획서: SPEC-002
- 승인 결정: DECISION-1265B3C7 (`outcome: approved`, `created_by: user`)
- 세션 역할: 개발자
- 작성 시각: 2026-08-01T17:58:40Z

## 결과

SPEC-002의 R1 상태 판정, R5 상태 표시 데이터, R7 중복 감지를 `src-tauri/src/infrastructure/heartbeat_status.rs` 신규 모듈 1개와 `src-tauri/src/domain/project.rs`의 결과 타입으로 구현했다. 전부 읽기 전용이다. 작업 상태를 `qa_waiting`으로 올렸다. Tauri 커맨드와 화면 표시는 붙이지 않았다(TASK-006 범위).

## 선행 조건 판단

TASK-004는 `qa_waiting`이고 아직 `completed`가 아니다. 그래도 착수한 근거다.

- 의존성의 실제 사유는 파서 재사용이고, `parse_heartbeat`·`HeartbeatJob::field`·`MANAGED_START`/`MANAGED_END`는 이미 저장소에 있다.
- 공통 규칙 5장은 기획서가 `user_review`일 때만 구현 진행을 막는다. 선행 작업의 QA 대기를 이유로 후속 작업을 막는 조항은 없다.
- TASK-004 리포트가 "다음 작업 → TASK-005"에서 이 모듈이 쓸 표면을 그대로 지정했다.
- 같은 판단을 TASK-002가 TASK-001에 대해 이미 내렸고 그 근거가 REPORT-TASK-002-DEV에 남아 있다.
- 활성 lease가 없었고 TASK-004와 파일이 겹치지 않는다(`heartbeat_jobs.rs`는 읽기만 했다).

TASK-004가 QA에서 수정 요청으로 돌아가면 이 모듈이 쓰는 공개 표면 4개가 영향을 받을 수 있다. 리스크 항목에 남긴다.

## 변경한 파일

| 파일 | 변경 | 내용 |
| --- | --- | --- |
| `src-tauri/src/infrastructure/heartbeat_status.rs` | 신규 | 설치 상태 판정·실행 기록 읽기·중복 감지·테스트 12종 |
| `src-tauri/src/domain/project.rs` | 수정 | 결과 타입 6종 추가 (`impl WorkflowEntry` 앞) |
| `src-tauri/src/infrastructure/mod.rs` | 수정 | `pub mod heartbeat_status;` 1줄 추가 |
| `.workflow/.../tasks/TASK-005.md` | 수정 | `status: todo` → `in_progress` → `qa_waiting`, `updated_at` 갱신 |
| `.workflow/.../reports/REPORT-TASK-005-DEV.md` | 신규 | 이 리포트 |

프론트엔드(`src/`), `.workflow/rules/*`, `scripts/`, `docs/`, 다른 인프라 모듈은 변경하지 않았다.

## 공개 API

TASK-006이 호출할 표면이다.

```rust
pub fn read_heartbeat_status(heartbeat_home: &Path, slug: &str) -> HeartbeatStatus
```

- `Result`가 아니다. 파일이 없거나 깨져 있어도 오류로 올리지 않는다. 자동 새로고침 주기마다 호출되므로 화면이 에러로 덮이면 안 된다는 작업 지시를 따랐다.
- `heartbeat_home`은 `~/.claude`에 해당하는 디렉터리다. 홈 해석은 TASK-006이 한다.
- `slug`로 역할 잡 3종의 이름을 `heartbeat_jobs::job_name`으로 만들어 조회한다. 잡 이름을 따로 받지 않는다.

결과 타입(`domain/project.rs`, 전부 `Serialize` + `camelCase`):

- `HeartbeatStatus { installation, roles, duplicateJobs, readFailures }`
- `HeartbeatInstallation` = `not_installed` | `installed_daemon_stopped` | `installed_daemon_running`
- `HeartbeatRoleStatus { role, jobName, lastRun }` — `role`은 `planner`/`architect`/`developer`
- `HeartbeatJobRun { at, result, durationSeconds }` — 셋 다 `Option`
- `DuplicateHeartbeatJob { name, role }` — `role`은 판별 실패 시 `null`
- `HeartbeatReadFailure { path, message }`

## 설계 결정

- `lastRun`이 `null`이면 "실행 기록 없음"이다. 상태 파일 없음·JSON 깨짐·잡 키 없음 세 경우를 구분하지 않는다는 작업 지시를 그대로 따랐다. 잡 키가 있지만 값이 객체가 아닌 경우도 같게 처리한다.
- `at`(`last_run`)은 타임존 없는 로컬 시각 문자열이라 파싱하지 않고 원문 그대로 올린다. `result`도 알려진 5개 값 외에 무엇이 와도 원문을 전달한다. 표시 형식은 TASK-006이 정한다.
- `durationSeconds`는 `f64`다. 실제 `state.json`에 정수(`0`)와 소수가 섞여 있어 `Value::as_f64`로 둘 다 받는다. 이 필드 때문에 관련 타입에는 `Eq`를 붙이지 않았다.
- 읽기 실패는 `NotFound`만 "없음"으로 보고, 그 외 오류(권한 등)는 `readFailures`에 경로와 사유를 담고 "있는데 못 읽음"으로 취급한다. 그래서 권한 문제로 못 읽은 `HEARTBEAT.md`가 `미설치`로 둔갑하지 않는다.
- 중복 감지의 조건 대조는 경로 전체가 아니라 파일 이름 `wf-eligible.sh`로 한다. 앱 설치본(`.workflow/rules/`)과 사용자가 손으로 적은 `scripts/` 경로가 같은 판정 로직을 가리키므로 둘 다 잡아야 한다. 실제 도그푸딩 환경의 잡 3종이 후자다.
- 관리 블록 범위는 마커 줄 인덱스로 잡고 잡의 `start_line`이 그 범위 안인지로 안팎을 가른다. 마커가 없거나 개수·순서가 손상된 파일에서는 범위를 잡지 않고 모든 잡을 블록 밖으로 본다. 읽기 경로에서 손상을 판정해 봐야 할 일이 없고, 경고를 더 하는 쪽이 안전하다. 손상 파일 거부는 설치 액션(TASK-004)이 이미 한다.
- 데몬 실행 판정 근거와 한계(정리 없이 죽은 데몬의 pid 잔존)를 `read_heartbeat_status` 본문 주석과 `HeartbeatInstallation` 타입 주석 양쪽에 남겼다. UI 문구는 TASK-006이 정한다.

## 검증

```
~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml
```

- `60 passed; 0 failed` (신규 12종 포함). `cargo`가 PATH에 없어 `~/.cargo/bin/cargo`로 실행했다.

```
grep -n "write\|create_dir\|remove_file\|File::create\|home_dir\|env::var(\"HOME\")" src-tauri/src/infrastructure/heartbeat_status.rs
```

- 첫 일치가 224줄이고 `#[cfg(test)] mod tests`는 204줄에서 시작한다. 테스트 밖에는 쓰기도 홈 경로 계산도 없다. 완료 조건 5 충족.

```
~/.cargo/bin/cargo build --manifest-path src-tauri/Cargo.toml
```

- 경고 0개. `#![allow(dead_code)]`를 이 모듈에도 같은 이유·같은 주석으로 달았다.

```
stat -f "%m %N" ~/.claude/HEARTBEAT.md ~/.claude/heartbeat/heartbeat.pid
```

- 작업 전후 동일. `state.json`은 하트비트 데몬이 계속 갱신하므로 이 비교에서 제외했다. 앱이 그 파일에 쓰지 않는다는 것은 위 grep과 `reading_the_status_does_not_touch_the_heartbeat_home` 테스트로 확인한다.

```
git status --short
```

- 코드 변경은 `heartbeat_status.rs`(신규), `domain/project.rs`(수정), `infrastructure/mod.rs`(수정) 셋뿐이다. `src/` 변경 없음. 나머지 항목은 이 세션 시작 시점에 이미 있던 상태다.

```
~/.cargo/bin/cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

- `heartbeat_status.rs`·`domain/project.rs`에 대한 지적 없음. `heartbeat_condition.rs`(TASK-003 산출물)에 지적 2건이 남아 있으나 내 작업 범위가 아니라 손대지 않았다. 아래 역할 밖 발견 사항에 적는다.

`npm run check`는 실행하지 않았다. 이 작업은 프론트엔드 파일을 하나도 바꾸지 않았고, 작업 문서의 검증 절차에도 포함되어 있지 않다. 기획서 완료 조건 13은 화면이 붙는 TASK-006·TASK-007에서 확인 대상이다.

### 완료 조건 대응 테스트

| 완료 조건 | 테스트 |
| --- | --- |
| 1. 세 설치 상태 구분 | `empty_home_is_not_installed`, `heartbeat_document_alone_means_daemon_stopped`, `daemon_directory_alone_means_daemon_stopped`, `pid_file_means_daemon_running` |
| 2. 실행 기록 일치 / 기록 없음 | `role_job_run_comes_from_the_state_file`, `integer_duration_is_read_as_seconds`, `missing_broken_or_absent_job_key_has_no_run_record` |
| 3. 블록 밖 중복 감지, 대상 불변 | `duplicate_job_outside_the_managed_block_is_detected`, `job_inside_the_managed_block_is_not_detected`, `other_slug_or_other_condition_is_not_detected`, `duplicate_without_a_role_argument_reports_the_name_only` |
| 5. 어떤 파일도 쓰지 않음 | `reading_the_status_does_not_touch_the_heartbeat_home` (홈 전체의 경로·수정 시각 스냅샷 비교) |

## 사용자 QA 제안

앱 UI가 아직 없으므로 코드 레벨 확인이다.

1. `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml`이 통과하는지 확인한다.
2. 실제 `~/.claude/heartbeat/state.json`의 `wf-planner` 항목 값(`last_run`, `last_result`, `last_duration`)과 `HeartbeatJobRun`의 필드 대응이 맞는지 눈으로 대조한다. 다만 현재 실제 잡 이름은 slug 접미사가 없는 `wf-planner`라서, 앱이 만드는 이름(`wf-planner-Users-...`)으로는 아직 기록이 조회되지 않는 것이 정상이다.
3. 실제 설정 파일이 변경되지 않았는지 `stat -f "%Sm" ~/.claude/HEARTBEAT.md`로 확인한다.

## 남은 리스크

- TASK-004가 QA에서 수정 요청으로 돌아가 `parse_heartbeat`의 `start_line` 의미나 마커 상수가 바뀌면 이 모듈의 블록 안팎 판정이 함께 흔들린다. 두 작업이 같이 QA를 통과해야 안전하다.
- 관리 블록 안팎 판정은 마커 줄 전체 일치(`line.trim() == MARKER`)로 하고, 설치 경로(`plan_block`)는 바이트 오프셋 부분 일치로 한다. 정상 파일에서는 결과가 같지만, 마커 문자열이 다른 줄 가운데에 박혀 있는 인위적인 파일에서는 갈릴 수 있다. 읽기 전용 감지라 피해가 없다고 보고 맞추지 않았다.
- 데몬 생존을 pid 파일 존재로만 판정하므로, 정리 없이 죽은 데몬은 "실행 중"으로 보인다. 작업 문서가 지정한 한계이며 UI 문구로 드러내는 것은 TASK-006 몫이다.
- 모듈이 아직 호출되지 않아 `#![allow(dead_code)]`가 붙어 있다. TASK-006 연결이 끝나면 이 줄을 지우고 남는 경고가 없는지 확인해야 한다.
- 잡 이름을 `slug`에서만 만든다. 사용자가 관리 블록 안의 잡 이름을 손으로 바꾸면 실행 기록 조회가 비게 된다. 잡 이름은 앱 소유라는 R2 전제 위에서 수용한 범위다.

## 다음 작업

- TASK-006: 하트비트 홈(`~/.claude`) 해석, `read_heartbeat_status` 호출, 세 설치 상태·실행 기록·중복 경고 문구 확정. `readFailures`가 비지 않을 때의 표시도 정해야 한다.
- TASK-007: 설치·토글·편집 액션. 이 모듈은 읽기만 하므로 관여하지 않는다.

## 역할 밖 발견 사항

개발자 역할에서 고치지 않고 남긴다.

- `cargo fmt --check`가 `src-tauri/src/infrastructure/heartbeat_condition.rs` 114줄과 246줄에 서식 지적 2건을 낸다. TASK-003 산출물이고 이번 작업 범위가 아니라 손대지 않았다. `cargo fmt`를 그냥 돌리면 내 파일과 함께 저 파일도 바뀌므로, 정리는 TASK-003의 QA나 별도 작업에서 하는 편이 낫다.
- 현재 `~/.claude/HEARTBEAT.md`의 손으로 적은 잡 3종은 이 모듈의 중복 감지에 그대로 걸린다(같은 slug, `scripts/wf-eligible.sh <역할>` 조건, 관리 블록 밖). TASK-006이 화면을 붙이면 첫 화면부터 경고 3건이 뜨는 것이 정상 동작이다. 실제 정리는 사용자 몫이다.
