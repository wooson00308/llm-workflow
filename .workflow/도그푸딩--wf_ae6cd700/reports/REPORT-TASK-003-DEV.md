# TASK-003 개발자 핸드오프

- 대상 작업: TASK-003 (조건 스크립트를 앱 관리 자산으로 설치하는 모듈 추가)
- 출처 기획서: SPEC-002
- 승인 결정: DECISION-1265B3C7 (`outcome: approved`, `created_by: user`)
- 세션 역할: 개발자
- 작성 시각: 2026-08-01T17:12:30Z

## 결과

SPEC-002의 R4를 `src-tauri/src/infrastructure/heartbeat_condition.rs` 신규 모듈 1개로 구현했다. 작업 상태를 `qa_waiting`으로 올렸다. Tauri 커맨드 등록과 UI 연결은 붙이지 않았다(TASK-007 범위).

## 변경한 파일

| 파일 | 변경 | 내용 |
| --- | --- | --- |
| `src-tauri/src/infrastructure/heartbeat_condition.rs` | 신규 | 스크립트 본문 상수, 설치·검증 함수, 테스트 10종 |
| `src-tauri/src/infrastructure/mod.rs` | 수정 | `pub mod heartbeat_condition;` 1줄 추가 |
| `.workflow/.../tasks/TASK-003.md` | 수정 | `status: todo` → `in_progress` → `qa_waiting`, `updated_at` 갱신 |
| `.workflow/.../reports/REPORT-TASK-003-DEV.md` | 신규 | 이 리포트 |

`scripts/wf-eligible.sh`, `docs/`, 프론트엔드(`src/`), `.workflow/rules/*`는 변경하지 않았다. 작업 시작 전부터 워킹 트리에 있던 미추적·수정 파일(`docs/heartbeat.md`, `heartbeat_jobs.rs`, `docs/development-logs/2026-08-01.md` 등)에는 손대지 않았다.

## 공개 API

TASK-007의 설치 액션이 호출할 표면이다.

- `install_condition_script(control_root) -> Result<(), ConditionScriptError>` — 컨트롤 루트 아래 `rules/wf-eligible.sh`를 앱 버전으로 맞춘다. 내용이 이미 같으면 파일을 쓰지 않는다.
- `validate_condition_script(control_root) -> Result<(), ConditionScriptError>` — 같은 판정만 하고 쓰지 않는다. `project_instructions.rs`의 `install`/`validate` 쌍과 같은 구조다.
- `condition_script_path(control_root) -> PathBuf` — 설치 경로. UI가 사용자에게 경로를 보여줄 때 쓸 수 있다.

경로 계산은 호출자 몫이다. 모듈은 컨트롤 루트만 받고 프로젝트 루트를 모른다. 잡의 `condition`이 쓰는 프로젝트 루트 기준 상대 경로 `.workflow/rules/wf-eligible.sh`는 이미 `heartbeat_jobs.rs`의 `CONDITION_SCRIPT` 상수에 있다.

## 설계 결정

- 스크립트 본문은 `const` 문자열 리터럴이다. `include_str!("../../../scripts/wf-eligible.sh")`을 쓰지 않았다. 작업 지시대로, 두 파일을 빌드 의존으로 묶으면 나중에 저장소 원본을 지울 수 없기 때문이다. 결과적으로 같은 스크립트가 저장소에 두 벌 존재한다(기획서가 인지·승인한 상태).
- 오류 타입은 `ProjectInstructionError` 재사용 대신 전용 `ConditionScriptError`를 정의했다. 재사용하면 사용자에게 "프로젝트 규칙 파일과 충돌합니다"라는 잘못된 문구가 나간다. 변종은 `NotRegularFile` / `Unmanaged` / `Downgrade` / `Io` / `Persist` 다섯이고, 문구는 한국어로 충돌 경로와 다음 행동을 함께 담았다(`heartbeat_jobs.rs`의 오류 문구 방식과 같다).
- 판정 순서는 `plan_rules_file`과 같다. 함수 재사용은 하지 않았다. 그 함수는 private이고 `rules_version:` 접두사에 묶여 있어, 재사용하려면 범위 밖 파일인 `project_instructions.rs`를 고쳐야 한다.
- `condition_script_version` 줄이 없거나 정수로 파싱되지 않으면 작업 지시대로 `Unmanaged`로 처리한다. 관리 표기만 있고 버전을 못 읽는 파일은 앱이 쓴 파일이라고 믿을 수 없다.
- 판정을 모두 끝낸 뒤 쓴다. 실패 경로에서는 `fs::create_dir_all`조차 호출하지 않으므로 기존 파일이 바이트 단위로 남는다.
- 실행 권한은 주지 않았다(`644` 상당). 잡의 `condition`이 `sh <경로> <역할>`로 부르므로 실행 비트가 필요 없다.
- 쓰기는 같은 디렉터리 임시 파일 → `sync_all` → `persist`다. `project_instructions.rs`·`heartbeat_jobs.rs`가 각자 갖고 있는 것과 같은 함수를 이 모듈에도 뒀다. 세 벌째 중복이지만, 공용화하면 범위 밖 파일 두 개를 건드려야 한다(아래 핸드오프 참고).
- 모듈 상단에 `#![allow(dead_code)]`와 제거 조건 주석을 뒀다. TASK-007이 연결을 끝내면 그 줄을 지운다. `heartbeat_jobs.rs`와 같은 처리다.

## 검증

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

- `test result: ok. 48 passed; 0 failed` (신규 10종 포함). 기존 38종도 그대로 통과했다.
- 신규 테스트: 설치·관리 표기 확인 / 멱등(내용·mtime 불변) / 비관리 파일 거부 / 다운그레이드 거부 / 버전 없는 파일 거부 / 변조된 관리 파일 재작성 / 실행 종료 코드 `0`·`1`·`2` / `migration.lock` 존재 시 `1`.
- 거부 테스트 4종은 모두 "오류를 반환하고 대상 파일 내용이 그대로"임을 함께 단언한다.

```sh
cargo build --manifest-path src-tauri/Cargo.toml   # 경고 없음
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets   # 신규 모듈 지적 없음
```

```sh
diff <(sed -e '/^# managed_by:/d' -e '/^# condition_script_version:/d' /tmp/installed-wf-eligible.sh) scripts/wf-eligible.sh
```

- 차이 없음. 설치본에서 관리 표기 두 줄을 빼면 `scripts/wf-eligible.sh`와 바이트 단위로 같다. 판정 로직을 옮기면서 고치지 않았음을 뜻한다.

```sh
git status --short
```

- 이번 세션이 만든 변경은 `src-tauri/src/infrastructure/heartbeat_condition.rs`(신규)와 `src-tauri/src/infrastructure/mod.rs`(수정) 둘뿐이다. 나머지 목록은 세션 시작 시점에 이미 있던 항목이다.

## 완료 조건 대조

| 조건 | 결과 |
| --- | --- |
| 1. 설치·판정·거부 모듈 존재, `mod.rs` 등록 | 충족 |
| 2. 인자 3종과 종료 코드 `0`/`1`/`2`가 원본과 동일 | 충족 (실행 테스트 + diff) |
| 3. 비관리 파일·상위 버전 파일 거부 및 원본 불변 테스트 통과 | 충족 |
| 4. 두 번 설치해도 파일 불변 | 충족 (내용·mtime 단언) |
| 5. `scripts/`, `docs/`, `src/` 무변경 | 충족 |

## QA 절차 제안

1. `cargo test --manifest-path src-tauri/Cargo.toml` — 48개 통과 확인.
2. `git status --short`로 변경이 위 두 파일에 한정되는지 확인.
3. 위 `diff` 명령으로 설치본과 원본이 관리 표기 두 줄만 다른지 확인.

## 리스크와 남은 일

- 스크립트가 두 벌이다. 지금은 앱 설치본과 `scripts/wf-eligible.sh`가 각각 원본이라 한쪽만 고치면 조용히 갈라진다. 기획서 `확인 필요` 1번이 이번 범위에서 정리하지 않기로 승인한 상태이며, 정리는 별도 아이디어로 다룬다. 그때까지는 `scripts/wf-eligible.sh`를 고치면 이 모듈의 `CONDITION_SCRIPT`도 같이 고쳐야 한다. diff 명령이 그 회귀를 잡는다.
- 판정 로직의 알려진 공백을 그대로 옮겼다: lease 만료 시각을 보지 않음(만료된 lease도 점유로 취급), `planner`가 `revision_requested`를 대상으로 잡지 않음, `architect`가 최신 결정인지 확인하지 않음. 작업 지시가 명시한 범위 밖이다.
- 실행 테스트는 `#[cfg(unix)]`다. Windows에서는 5종만 돌고 종료 코드 4종은 건너뛴다. 기획서 `확인 필요` 2번의 승인대로 이번 범위는 POSIX `sh` 하나뿐이다.

## 핸드오프 노트 (역할 밖, 고치지 않음)

- 원자적 쓰기 `write_text_atomically`가 이제 `project_instructions.rs`·`heartbeat_jobs.rs`·`heartbeat_condition.rs` 세 곳에 같은 형태로 있다. 오류 타입만 다르다. 공용 헬퍼로 뽑을 만하지만 범위 밖 파일 두 개를 건드려야 해서 손대지 않았다. 정리하려면 별도 작업으로 다루는 편이 낫다.
- 이 저장소 자체의 `.workflow/rules/wf-eligible.sh`는 아직 설치되어 있지 않다. 설치는 사용자 액션에서만 일어나야 하므로(R6) 이 세션에서 설치하지 않았다. TASK-007이 액션을 붙인 뒤에 사용자가 실행할 일이다.
- 이 저장소의 도그푸딩용 하트비트 잡은 현재 `condition`으로 `scripts/wf-eligible.sh`를 가리키고 있을 수 있다. 설치본으로 옮기는 시점은 TASK-007 이후다.
