# TASK-004 개발자 핸드오프

- 대상 작업: TASK-004 (HEARTBEAT.md 파서와 앱 관리 잡 블록 엔진 구현)
- 출처 기획서: SPEC-002
- 승인 결정: DECISION-1265B3C7 (`outcome: approved`, `created_by: user`)
- 세션 역할: 개발자
- 작성 시각: 2026-08-01T16:40:12Z

## 결과

SPEC-002의 R2·R3과 R6의 쓰기 안전 요구를 `src-tauri/src/infrastructure/heartbeat_jobs.rs` 신규 모듈 1개로 구현했다. 작업 상태를 `qa_waiting`으로 올렸다. UI와 Tauri 커맨드는 붙이지 않았다(TASK-006·TASK-007 범위).

## 변경한 파일

| 파일 | 변경 | 내용 |
| --- | --- | --- |
| `src-tauri/src/infrastructure/heartbeat_jobs.rs` | 신규 | 파서·블록 엔진·검증·테스트 11종 |
| `src-tauri/src/infrastructure/mod.rs` | 수정 | `pub mod heartbeat_jobs;` 1줄 추가 |
| `.workflow/.../tasks/TASK-004.md` | 수정 | `status: todo` → `in_progress` → `qa_waiting`, `updated_at` 갱신 |
| `.workflow/.../reports/REPORT-TASK-004-DEV.md` | 신규 | 이 리포트 |

프론트엔드(`src/`), `scripts/wf-eligible.sh`, `docs/`, `.workflow/rules/*`는 변경하지 않았다.

## 공개 API

TASK-005·TASK-006·TASK-007이 호출할 표면이다.

- `parse_heartbeat(&str) -> HeartbeatDocument` — 전역 설정과 잡 목록. 잡마다 이름, 줄 범위(`start_line`, `end_line`), key/value 목록을 담는다. `HeartbeatJob::field(key)`로 조회한다.
- `project_slug(&Path) -> String` — `/` → `-` 치환 후 앞에 `-` 보장.
- `job_name(HeartbeatRole, &str) -> String` — `wf-<역할><slug>`.
- `HeartbeatRole::{ALL, as_argument, prompt, default_settings}` — 역할 상수와 R3 기본값.
- `install_role_jobs(path, project_root, &[RoleJob]) -> Result<bool, HeartbeatJobsError>` — 활성 역할 목록을 받아 관리 블록을 만들고 갱신하고 지운다. 반환값은 실제로 썼는지 여부.
- `MANAGED_START` / `MANAGED_END` — 마커 상수.

`timeout`·`notify`·`prompt`·`condition`·`slug`는 앱이 정한다. 사용자 편집 대상은 `RoleJobSettings`의 `model`·`interval`·`max_per` 셋뿐이다.

## 설계 결정

- 줄 범위 `end_line`은 그 잡의 마지막 필드 줄 다음 인덱스(끝 미포함)다. 뒤따르는 빈 줄은 잡의 범위에 넣지 않았다. TASK-005의 중복 감지는 이 값으로 잡 위치를 특정할 수 있다.
- 블록 교체는 마커의 바이트 오프셋으로 하고, 파서의 줄 범위는 쓰지 않았다. `project_instructions.rs`의 `plan_managed_file`과 같은 방식이라 블록 밖 내용이 바이트 단위로 보존된다.
- 블록 제거는 `append_block`이 넣은 구분 빈 줄과 블록 끝 줄바꿈까지 되돌린다. 전체 비활성화 후 파일이 설치 전 내용과 정확히 같아진다(테스트 `disabling_every_role_removes_the_whole_block`).
- 값 검증(`interval`·`max_per`·`model`)을 파일 접근보다 먼저 수행한다. 잘못된 값이면 읽기조차 하지 않는다.
- 오류 타입은 `ProjectInstructionError` 재사용 대신 전용 `HeartbeatJobsError`를 정의했다. 마커 개수 불일치·마커 역순·흡수될 줄·값 형식 오류가 각각 다른 사유이고, 사용자에게 "어디를 어떻게 고쳐야 하는지"를 문구에 담아야 해서 `Conflict(path)` 한 종류로는 부족했다.

## 검증

```
~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml
```

- `38 passed; 0 failed` (신규 11종 포함). `cargo`가 PATH에 없어 `~/.cargo/bin/cargo`로 실행했다.

```
grep -rn "\.claude\|home_dir\|env::var(\"HOME\")" src-tauri/src/infrastructure/heartbeat_jobs.rs
```

- 출력 없음. 완료 조건 8 충족. 모든 경로는 인자로 들어온다.

```
stat -f "%Sm" ~/.claude/HEARTBEAT.md
```

- 작업 전후 모두 `2026-08-01T23:50:55`. 테스트가 실제 설정 파일을 건드리지 않았다.

```
git status --short
```

- 코드 변경은 `src-tauri/src/infrastructure/heartbeat_jobs.rs`(신규)와 `src-tauri/src/infrastructure/mod.rs`(수정) 둘뿐이다. 나머지 항목은 이 세션 시작 시점에 이미 있던 상태다.

```
~/.cargo/bin/cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

- 통과.

### 완료 조건 대응 테스트

| 완료 조건 | 테스트 |
| --- | --- |
| 1. 블록 1개와 역할 잡 3종 기본값 | `creates_file_with_three_role_jobs_at_defaults` |
| 2. 두 번 실행해도 파일 불변 | `second_install_with_same_input_does_not_write` |
| 3. `- tick:` 보존, 블록이 뒤에 위치 | `appends_block_after_user_jobs_and_preserves_them` |
| 4. 마커 손상·흡수될 줄에서 실패, 파일 불변 | `rejects_a_file_with_only_one_marker`, `rejects_reversed_markers`, `rejects_a_field_line_after_the_end_marker` |
| 5. 역할 토글 왕복 후 최초 설치와 동일 | `toggling_one_role_off_and_on_restores_the_first_install` |
| 6. 잘못된 값이 파일에 닿지 않음 | `rejects_invalid_settings_without_touching_the_file` |
| 추가 | `keeps_carriage_returns_of_the_original_file`, `disabling_every_role_removes_the_whole_block`, `parses_globals_and_jobs_of_a_real_document` |

## 사용자 QA 제안

앱 UI가 아직 없으므로 코드 레벨 확인이다.

1. `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml`이 통과하는지 확인한다.
2. `src-tauri/src/infrastructure/heartbeat_jobs.rs`의 `render_block`이 만드는 필드 순서(`slug`, `model`, `prompt`, `interval`, `timeout`, `condition`, `notify`, `max_per`)와 기본값이 현재 손으로 적은 `~/.claude/HEARTBEAT.md`의 값과 일치하는지 눈으로 대조한다. 차이는 `condition` 경로(`scripts/` → `.workflow/rules/`)와 잡 이름(slug 접미사)뿐이어야 한다.
3. 실제 설정 파일이 변경되지 않았는지 `stat -f "%Sm" ~/.claude/HEARTBEAT.md`로 확인한다.

## 남은 리스크

- 모듈이 아직 아무 데서도 호출되지 않아 `dead_code` 경고가 31개 발생했다. 이 저장소는 그 전까지 경고가 0개였으므로, 파일 맨 위에 `#![allow(dead_code)]`를 범위 한정으로 두고 "커맨드 계층 연결이 끝나면 지운다"는 주석을 남겼다. TASK-007이 연결을 마치면 이 줄을 지우고 남는 경고가 없는지 확인해야 한다.
- `project_slug`는 `/`만 치환한다. Windows 경로 구분자는 다루지 않는다. 기획서 `확인 필요` 2번의 승인대로 이번 범위는 POSIX뿐이다.
- 부모 디렉터리가 없으면 쓰기가 `Io` 오류로 끝난다. 대상 파일의 부모는 사용자 홈 설정 디렉터리라 이미 존재한다고 보고 디렉터리 생성은 넣지 않았다.
- `install_role_jobs`는 읽기와 쓰기 사이에 파일 잠금을 걸지 않는다. 사용자가 같은 순간에 에디터로 저장하면 마지막 쓰기가 이긴다. 전역 파일 쓰기가 명시적 사용자 액션에서만 일어난다는 R6 전제 위에서 수용한 범위다.

## 다음 작업

- TASK-005: `parse_heartbeat`와 `HeartbeatJob::field("slug")`·`field("condition")`으로 중복 잡을 판정한다. 관리 블록 밖 잡만 대상으로 삼으려면 `MANAGED_START`·`MANAGED_END` 상수와 잡의 줄 범위를 함께 쓴다.
- TASK-006: 홈 디렉터리 해석과 커맨드 계층. 이 모듈은 경로를 스스로 계산하지 않는다.
- TASK-007: `install_role_jobs` 호출, UI 검증, 쓰기 전 확인 절차, `#![allow(dead_code)]` 제거.

## 역할 밖 발견 사항

개발자 역할에서 고치지 않고 남긴다.

- `~/.claude/HEARTBEAT.md`에 손으로 적은 `wf-planner`·`wf-architect`·`wf-developer` 잡 3종이 있고 `condition`이 `sh scripts/wf-eligible.sh <역할>`을 가리킨다. 이 모듈이 만드는 잡과 이름이 달라 `state.json` 키는 겹치지 않지만 같은 역할이 두 번 깨어난다. 감지·경고는 TASK-005·TASK-006 범위이고 실제 정리는 사용자 몫이다.
