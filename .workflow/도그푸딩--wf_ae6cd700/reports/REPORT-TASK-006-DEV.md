# TASK-006 개발자 핸드오프

- 대상 작업: TASK-006 (설정 화면 연동 섹션 읽기 전용 표시와 상태 조회 커맨드 연결)
- 출처 기획서: SPEC-002
- 승인 결정: DECISION-1265B3C7 (`outcome: approved`, `created_by: user`)
- 세션 역할: 개발자
- 작성 시각: 2026-08-01T18:32:00Z

## 결과

SPEC-002의 R1 표시, R5 상태 표시, R7 경고 표시를 구현했다. 조회 커맨드 `inspect_heartbeat` 하나를 추가하고, 설정 화면에 연동 카드를 붙였다. 쓰기 커맨드는 추가하지 않았다. 작업 상태를 `qa_waiting`으로 올렸다.

앱을 GUI로 띄워 눈으로 확인하는 수동 검증 3종은 하지 않았다. 사유와 대신 수행한 검증은 아래 "수행하지 않은 검증"에 적는다.

## 선행 조건 판단

TASK-004·TASK-005는 `qa_waiting`이고 아직 `completed`가 아니다. 그래도 착수한 근거는 REPORT-TASK-005-DEV의 판단과 같다. 의존성의 실제 사유는 두 모듈의 공개 표면 재사용이고 그 표면은 이미 저장소에 있다. 공통 규칙 5장은 기획서가 `user_review`일 때 승인 없는 구현만 막고, SPEC-002에는 DECISION-1265B3C7이 있다. 활성 lease는 없었다.

TASK-007은 TASK-006 선행 필수라 이번 세션 대상이 아니었다. 처리 가능한 `todo`는 TASK-006 하나였다.

## 변경한 파일

| 파일 | 변경 | 내용 |
| --- | --- | --- |
| `src-tauri/src/commands/heartbeat.rs` | 신규 | `inspect_heartbeat` 커맨드와 홈 경로 해석 |
| `src-tauri/src/application/heartbeat_service.rs` | 신규 | 결과 타입 2종, 관리 블록 잡 읽기, 테스트 4종 |
| `src-tauri/src/commands/mod.rs` | 수정 | `pub mod heartbeat;` 1줄 |
| `src-tauri/src/application/mod.rs` | 수정 | `pub mod heartbeat_service;` 1줄 |
| `src-tauri/src/lib.rs` | 수정 | `invoke_handler`에 커맨드 1줄 |
| `src/features/projects/domain/types.ts` | 수정 | 하트비트 타입 8종과 게이트웨이 시그니처 |
| `src/features/projects/infrastructure/tauriProjectGateway.ts` | 수정 | `inspectHeartbeat` 호출 |
| `src/features/projects/application/useProjectWorkspace.ts` | 수정 | `heartbeat` 상태와 기존 인터벌 안의 조회 |
| `src/features/projects/components/SettingsView.tsx` | 수정 | 연동 카드 |
| `src/features/projects/components/SettingsView.test.tsx` | 신규 | 표시 테스트 7종 |
| `src/App.css` | 수정 | 연동 카드 스타일 |
| `src/App.tsx` | 수정 | `heartbeat` prop 전달 1줄 |
| `src/features/projects/components/WorkspaceShell.tsx` | 수정 | `heartbeat` prop 통과 |
| `src/features/projects/components/WorkspaceShell.test.tsx` | 수정 | 새 필수 prop 반영 |
| `src/features/projects/application/useProjectWorkspace.test.ts` | 수정 | 게이트웨이 목에 `inspectHeartbeat` 추가 |

`.workflow/rules/*`, `scripts/`, `docs/`, 인프라 모듈, `domain/project.rs`는 변경하지 않았다.

### 작업 문서 범위와 다른 점

작업 문서의 `범위`가 적지 않은 파일 4개를 함께 바꿨다. 전부 필수 배선이다.

- `WorkspaceShell.tsx` — `SettingsView`에 prop이 늘어나 통과가 필요하다. 작업 문서 `참고 사실`이 이미 예고한 변경이다.
- `App.tsx` — `useProjectWorkspace`의 `heartbeat`를 `WorkspaceShell`로 넘기는 지점이다. 이 한 줄이 없으면 화면에 값이 도달하지 않는다.
- `WorkspaceShell.test.tsx`, `useProjectWorkspace.test.ts` — 새 필수 prop과 새 게이트웨이 메서드 때문에 타입이 깨진다. 기존 단언은 손대지 않았고, `heartbeat` 상수 1개와 목 1줄만 더했다.

prop을 선택 값으로 만들면 이 두 테스트 파일을 안 건드릴 수 있었지만, App이 항상 넘기는 값을 선택으로 두면 배선 누락을 타입 검사가 못 잡는다. 필수로 두고 테스트를 고쳤다.

## 공개 API

TASK-007이 얹을 표면이다.

```rust
#[tauri::command]
pub fn inspect_heartbeat(app: tauri::AppHandle, path: String) -> Result<HeartbeatIntegration, String>
```

- 프로젝트 루트 경로 하나만 받는다. 오류는 홈 디렉터리 해석 실패 한 가지뿐이다. 대상 파일이 없는 것은 오류가 아니라 `not_installed`다.
- `HeartbeatService::inspect(project_root, heartbeat_home) -> HeartbeatIntegration` — 홈을 인자로 받는다. 서비스는 홈을 계산하지 않는다.

결과 타입(`application/heartbeat_service.rs`, `camelCase`):

- `HeartbeatIntegration { supported, slug, conditionScriptPath, status, managedJobs }`
- `ManagedRoleJob { role, interval, maxPer, model }` — 셋 다 `Option`

프론트 타입은 `src/features/projects/domain/types.ts`에 같은 이름으로 있고, `HeartbeatState { integration, error }`가 화면에 내려가는 단위다.

## 설계 결정

- 커맨드는 `app.path().home_dir()`에 `.claude`를 붙여 홈을 구한다. `std::env::var("HOME")`은 쓰지 않았다. 해석 실패는 문자열 오류로 올리고 화면은 카드 안에서만 "상태를 읽을 수 없음"으로 표시한다.
- 결과 타입 2종을 `domain/project.rs`가 아니라 `application/heartbeat_service.rs`에 뒀다. TASK-005의 타입은 `domain`에 있으므로 위치가 갈린다. 작업 문서의 범위와 검증 절차가 `domain/project.rs` 변경을 명시적으로 제외해서 이렇게 했다. 정리한다면 TASK-007에서 `domain`으로 모으는 쪽이 맞다.
- 관리 블록 잡 읽기는 마커 사이 본문을 잘라내 그 조각만 `parse_heartbeat`에 넣는 방식이다(`split_once` 2회). 줄 번호 범위를 다시 계산하지 않아 `heartbeat_status.rs`의 판정 로직을 베끼지 않는다. 마커가 없으면 관리 블록이 없는 것으로 보고 빈 목록을 준다.
- 잡 식별은 이름 일치(`job_name(role, slug)`)로 한다. 관리 블록 안의 잡 이름은 앱 소유라는 R2 전제를 그대로 쓴다.
- 조건 스크립트 경로는 `condition_script_path(project_root/.workflow)`를 만들고 프로젝트 루트를 떼어 상대 경로로 보여준다. 문자열을 새로 적지 않고 TASK-003의 함수에서 유도한다.
- `HEARTBEAT.md`를 한 번 더 읽는다(`read_heartbeat_status`가 한 번, 관리 블록 읽기가 한 번). 파일이 작고, 합치려면 TASK-005 모듈의 공개 표면을 바꿔야 해서 이번 범위에서 하지 않았다.
- 플랫폼 지원 여부는 `!cfg!(windows)` 상수로 백엔드에서 판정한다. 미지원이어도 조회는 그대로 하고 화면에만 안내를 띄운다. 설치 차단은 TASK-007 몫이다.
- 폴링은 `useProjectWorkspace`의 기존 2.5초 인터벌 콜백 안에 조회를 한 줄 더한 것이다. `setInterval`을 새로 만들지 않았다. 프로젝트를 연 직후 2.5초를 빈 카드로 기다리지 않도록 같은 `useEffect` 안에서 첫 조회를 한 번 한다(타이머가 아니다).
- 조회 실패는 `heartbeat.error`에만 담고 전역 `error`를 건드리지 않는다. 실패해도 2.5초마다 화면 전체 에러가 뜨지 않는다.
- 미설치일 때는 설치 안내만 보여주고 slug·조건 경로·역할 잡 영역을 감춘다. R1의 "설치 안내만"을 문자 그대로 따랐다. slug와 조건 경로는 설치됨 상태에서 표시한다.
- 설치 안내 문구는 실제 도구 기준이다: `pip install claude-heartbeat`, `heartbeat init`, 공식 문서 `https://github.com/wooson00308/claude-heartbeat`. 설치 여부 판정이 `HEARTBEAT.md`/`heartbeat/` 존재이므로 `heartbeat init`까지 안내해야 미설치 표시가 풀린다.
- 데몬 상태 문구는 판정 근거를 그대로 적는다. "데몬이 살아 있습니다"라고 단정하지 않고 pid 파일의 유무를 말하며, 실행 중 문구에는 "정리 없이 종료되면 이 파일이 남을 수 있습니다"를 붙였다.
- `last_run`은 원문 그대로 보여주고 뒤에 "(로컬 시각)"만 붙인다. UTC로 해석하지 않는다.
- `skipped`는 "건너뜀 · 처리할 대상 없음", `quota_skipped`는 "건너뜀 · 실행 한도 도달"로 원인을 갈라 적고, 둘 다 실패 색(주황)을 쓰지 않는 중립 색이다. 실패 색은 `failure`·`timeout`에만 준다.
- `readFailures`가 비지 않으면 경로와 사유를 경고로 따로 보여준다. 파일 없음은 여기 담기지 않으므로 "권한 등으로 못 읽음"만 뜬다.

## 검증

```
npm run check
```

- `tsc -b` 통과, `vitest run` 10파일 33테스트 통과(신규 7 포함), `vite build` 성공.

```
~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml
```

- `64 passed; 0 failed` (신규 4 포함, 이전 60).

```
~/.cargo/bin/cargo build --manifest-path src-tauri/Cargo.toml
```

- 경고 0개.

```
~/.cargo/bin/cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

- 신규 2개 파일 지적 없음. `heartbeat_condition.rs` 114·246줄 지적 2건은 이 세션 전부터 있던 TASK-003 산출물의 것이라 손대지 않았다(REPORT-TASK-005-DEV도 같은 항목을 남겼다).

```
grep -n "fs::write|create_dir|File::create|remove_file|write_text|install_" \
  src-tauri/src/application/heartbeat_service.rs src-tauri/src/commands/heartbeat.rs
```

- 일치 0건. 이번에 추가한 경로에는 쓰기 호출도 설치 호출도 없다. 완료 조건 7의 근거이기도 하다. 등록한 커맨드는 `inspect_heartbeat` 하나다.

```
shasum ~/.claude/HEARTBEAT.md; stat -f "%Sm %N" ~/.claude/HEARTBEAT.md
```

- `e90dbf39e5aa325156995967a9d027b53f4936cd`, 수정 시각 `Aug 1 23:50:55 2026`. 세션 시작(2026-08-02 03:19 KST)보다 앞서고 세션 종료 시점까지 그대로다.

```
git status --short
```

- 위 변경 파일 표와 일치한다. `domain/project.rs`·`infrastructure/mod.rs`·`heartbeat_*.rs`(인프라 3개)의 변경 표시는 이 세션 시작 시점에 이미 있던 TASK-003·004·005의 산출물이다.

### 완료 조건 대응

| 완료 조건 | 근거 |
| --- | --- |
| 1. 세 설치 상태가 다르게 표시 | `SettingsView.test.tsx`의 미설치 / 데몬 미실행 / 실행 중 3케이스. GUI 재현은 미수행(아래 참조) |
| 2. 실행 기록 표시, 없으면 "실행 기록 없음" | `shows the slug, the condition script path and the settings...`, `marks a job without a state record...` |
| 3. 자동 새로고침이 전역 파일을 바꾸지 않음 | 위 grep 0건 + `shasum` 불변. GUI 30초 확인은 미수행 |
| 4. 중복 잡 경고, 대상 불변 | `warns about a duplicate job outside the managed block` + 쓰기 경로 없음 |
| 5. 조회 실패가 전체 에러로 안 번짐 | `keeps a failed status read inside the card`, 훅에서 전역 `error` 미변경 |
| 6. `npm run check` / `cargo test` 통과 | 위 검증 |
| 7. 쓰기 커맨드 없음 | `lib.rs`에 추가한 커맨드 1개, grep 0건 |

## 수행하지 않은 검증

작업 문서 `검증 절차`의 GUI 확인 2종을 하지 않았다.

1. `npm run tauri dev`로 앱을 띄우고 설정 화면에서 30초 이상 자동 새로고침을 돌린 뒤 해시 대조.
2. `~/.claude/HEARTBEAT.md`·`heartbeat/`·`heartbeat.pid`를 임시로 옮겨 미설치·데몬 미실행을 재현하고 화면 확인.

사유:

- 이 세션은 비대화형이라 앱 창에서 프로젝트를 열 수 없다. 프로젝트를 열지 않으면 폴링 자체가 시작되지 않아 1번이 검증하려는 경로가 돌지 않는다.
- 2번은 사용자의 실제 하트비트 데몬이 가동 중인 상태에서 그 데몬의 pid 파일과 설정 파일을 옮기는 조작이다. 화면 확인이 불가능한 세션에서 얻을 것 없이 실제 환경만 흔든다.

대신 같은 성질을 자동화로 덮었다. 상태 판정은 TASK-005의 Rust 테스트가, 화면 분기는 신규 프론트 테스트 7종이, 쓰기 없음은 grep과 해시 불변이 각각 담당한다. GUI 확인은 아래 사용자 QA로 넘긴다.

## 사용자 QA 제안

```sh
shasum ~/.claude/HEARTBEAT.md
npm run tauri dev
```

1. 앱을 켜고 이 프로젝트를 연 뒤 설정 화면으로 간다. 연동 카드에 `claude-heartbeat`가 "설치됨 · 데몬 실행 중"으로 뜨는지 본다.
2. 현재 환경 기준 예상 결과다.
   - 역할 잡 영역은 "역할 잡 미설치"다. 관리 블록에 잡을 설치한 적이 없다(설치 액션은 TASK-007).
   - 중복 잡 경고가 3건 뜬다. 손으로 적은 `wf-planner`·`wf-architect`·`wf-developer`가 관리 블록 밖에서 같은 slug와 `scripts/wf-eligible.sh`를 쓰기 때문이다. 정상 동작이다.
   - slug와 조건 스크립트 경로가 그대로 보인다.
3. 설정 화면에 30초 이상 머문 뒤 앱을 끄고 `shasum ~/.claude/HEARTBEAT.md`를 다시 실행해 해시가 같은지 본다. 완료 조건 3의 확인이다.
4. 미설치 표시를 보려면 백업 후 재현한다. 되돌린 뒤 해시를 대조한다.

```sh
cp ~/.claude/HEARTBEAT.md /tmp/HEARTBEAT.md.bak
mv ~/.claude/HEARTBEAT.md /tmp/ && mv ~/.claude/heartbeat /tmp/
# 화면 확인 후
mv /tmp/HEARTBEAT.md ~/.claude/ && mv /tmp/heartbeat ~/.claude/
shasum ~/.claude/HEARTBEAT.md   # e90dbf39e5aa325156995967a9d027b53f4936cd
```

데몬이 도는 중이므로 이 재현은 데몬을 멈춘 뒤에 하는 편이 안전하다.

## 남은 리스크

- TASK-004·TASK-005가 QA에서 수정 요청으로 돌아가 `parse_heartbeat`·`job_name`·`MANAGED_*`·`HeartbeatStatus`가 바뀌면 이 커맨드의 결과가 함께 흔들린다. 세 작업이 같이 QA를 통과해야 안전하다.
- 폴링은 설정 화면을 보지 않아도 프로젝트가 열려 있는 동안 계속 돈다. 작업 문서가 지정한 방식이고 읽는 파일이 작아 비용은 낮지만, 2.5초마다 `HEARTBEAT.md`와 `state.json`을 읽는 것은 사실이다.
- 관리 블록 잡 식별이 잡 이름 일치라, 사용자가 블록 안의 잡 이름을 손으로 바꾸면 "역할 잡 미설치"로 보인다. 잡 이름은 앱 소유라는 R2 전제 위에서 수용한 범위다.
- `heartbeat_status.rs`의 `#![allow(dead_code)]`는 그대로 뒀다. 이제 호출되므로 지울 수 있지만 그 파일은 이번 작업의 범위 밖이다. `heartbeat_jobs.rs`·`heartbeat_condition.rs`는 `install_role_jobs` 등이 TASK-007에서야 쓰이므로 아직 필요하다. 세 파일을 함께 정리하는 편이 낫다.
- 결과 타입이 `application` 계층에 있어 TASK-005의 `domain` 타입과 위치가 갈린다. 위 설계 결정 참조.

## 다음 작업

- TASK-007: 설치·토글·편집 액션. 이 세션이 만든 커맨드 계층·게이트웨이·연동 카드 구조 위에 쓰기를 얹는다. 전역 파일 쓰기 전 확인 절차(R6)와 미지원 플랫폼의 설치 차단, R3의 기본 주기 근거 문구가 남아 있다.

## 역할 밖 발견 사항

개발자 역할에서 고치지 않고 남긴다.

- `cargo fmt --check`가 `heartbeat_condition.rs` 114·246줄에 지적 2건을 낸다. TASK-003 산출물이고 이번 범위가 아니다. REPORT-TASK-005-DEV가 이미 같은 항목을 남겼다.
- 작업 문서의 `범위`가 `App.tsx`와 `WorkspaceShell.tsx`를 빠뜨렸다. 아키텍트가 작업을 쪼갤 때 화면까지 값이 도달하는 배선 경로를 파일 목록에 넣으면 이런 차이가 줄어든다.
