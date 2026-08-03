# TASK-009 개발자 핸드오프

- 대상 작업: TASK-009 (dream 설치 판정·정제 상태 읽기와 중복 잡 감지 공통화)
- 근거 문서: SPEC-003 R1·R2·R3·R5·R6, DECISION-5276FDBF (approved)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T08:45Z
- 상태: `qa_waiting`

## 결과

백엔드 읽기 계층만 구현했다. 연동 공통 설치 상태 타입을 만들고, dream 스킬 설치 판정과 정제 상태 읽기를 붙였으며, 중복 잡 감지를 연동이 판정 기준을 제공하는 형태로 바꿨다. 화면과 커맨드는 건드리지 않았다. 이 작업에서 만든 코드는 어떤 파일도 쓰지 않고 디렉터리도 만들지 않으며 외부 명령을 실행하지 않는다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/domain/project.rs` | `IntegrationInstallation`(공통 2값), `HeartbeatInstallationStatus`(공통 + 데몬), `DreamStatus`, `DreamRefinement` 추가. `DuplicateHeartbeatJob`에 `integration` 필드 추가 |
| `src-tauri/src/infrastructure/heartbeat_dream.rs` | `read_dream_status`·`skill_path`·`is_dream_condition`과 `dream_meta.md` 파서 추가. 상태 테스트 10개 |
| `src-tauri/src/infrastructure/heartbeat_status.rs` | 설치 판정을 공통 타입 조합으로 재구성(`read_heartbeat_installation`), 잡 실행 기록 조회를 잡 이름 기준(`JobRuns`)으로 일반화, 중복 감지를 규칙 목록 기반으로 교체. 중복 감지 테스트 2개 |

범위에 적힌 3개 파일만 바뀌었다. 프론트엔드(`src/`), `docs/`, `.workflow/` 규칙 문서는 변경하지 않았다.

## 설계 판단

- **공통 설치 상태는 두 값(`NotInstalled`/`Installed`)뿐이고, 연동별 부가 상태를 위에 얹었다.** 하트비트는 `HeartbeatInstallationStatus { installation, daemon_running }`, dream은 `DreamStatus { installation, heartbeat, refinement }`다. 세 번째 연동은 자기 상태 타입만 만들면 되고 `IntegrationInstallation`은 고치지 않는다.
- **`HeartbeatInstallation`(3값 열거형)은 그대로 남겼다.** 완료 조건 7이 SPEC-002 테스트를 단언 수정 없이 통과할 것을 요구하고, 그 테스트들이 `status.installation`을 세 값과 대조한다. 그래서 판정은 공통 조합으로 하고 `collapse()`로 접어 payload에 실었다. 이 열거형을 payload에서 걷어내는 것은 화면을 함께 옮기는 TASK-010 몫이다. 지금 걷어내면 프론트가 표현하지 못하는 중간 상태가 생긴다.
- **설치 판정 로직은 한 곳(`installation_of`)에만 있다.** 문서를 이미 읽은 호출자는 그 결과를 넘기고, dream처럼 문서 내용이 필요 없는 호출자는 `read_heartbeat_installation`이 존재 여부만 본다. 같은 파일을 두 번 읽지 않는다. 판정 결과는 기존과 동일하다: pid 있으면 실행 중, 문서나 데몬 디렉터리가 있으면 설치·정지, 아니면 미설치.
- **dream은 하트비트 설치 여부를 스스로 판정하지 않고 인자로 받는다.** 두 연동이 각자 `HEARTBEAT.md`를 stat 하면 읽기 실패 항목이 `readFailures`에 두 번 들어간다. 선행 조건은 하트비트 연동이 판정한 값을 넘기는 것이 맞다.
- **중복 감지는 규칙 목록(`DUPLICATE_RULES`)으로 바꿨다.** 각 규칙이 "이 조건 문자열이 우리 잡인가"와 "역할을 뽑을 수 있는가"를 제공한다. 감지 루프와 `DuplicateHeartbeatJob`은 연동을 모른다. 세 번째 연동은 항목 하나를 더한다.
- **역할 잡의 판정 기준(`wf-eligible.sh`)은 `heartbeat_status.rs`에 남겨 뒀다.** 원래 그 파일에 있던 상수이고, `heartbeat_roles.rs`는 이 작업의 범위 밖이다. dream 기준(`dream-prep`)은 `heartbeat_dream.rs`가 제공하며, `dream_job`의 조건 문자열과 같은 상수를 쓴다. 조건이 바뀌면 감지 기준도 같이 바뀐다.
- **잡 실행 기록은 `JobRuns::get(job_name)` 하나로 조회한다.** 상태 파일은 호출당 한 번만 읽고, 역할별 조회가 그 위에 얹혀 있다. dream 잡 기록도 이름만 넘기면 나온다. `last_run`·`last_result`는 원문 그대로 전달한다.
- **정제 수는 파일에서 직접 센다.** 승인된 "확인 필요 1번" 제안대로다. 마킹 수는 `dream_meta.md`에 적혀 있으면서 실제로 존재하는 `*.jsonl`만 센다. 그래서 지워진 트랜스크립트 이름이 남아 있어도 미정제 수가 음수가 되지 않는다.
- **`dream_meta.md` 파서는 압축된 항목을 sealed로 본다.** `- file: x.jsonl` 아래 들여쓴 `status:` 줄이 있으면 그 값을, 없으면 sealed다. dream이 sealed 200개를 넘기면 오래된 항목의 하위 줄을 지우기 때문이다. `status: active`는 부분 처리이므로 미정제로 센다.
- **활성 파일 게이트는 베끼지 않았다.** mtime quiet 30분·10MB 강제 처리는 dream 내부 판정이다. 이 수가 dream이 한 번에 처리할 수를 예측하지 않는다는 사실을 `read_refinement` 주석에 남겼다.
- **dream 스킬 판정 경로의 한계를 `skill_path` 주석에 남겼다.** `heartbeat install dream --slug`으로 다른 이름으로 설치하면 이 경로에 없어 미설치로 보인다. 경로를 화면에 밝히는 것은 TASK-011 몫이라 함수만 `pub`으로 열어 뒀다.

## 검증

```
cargo test --manifest-path src-tauri/Cargo.toml
→ 89 passed; 0 failed (신규 12개 포함)
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets → 경고 없음
cargo fmt --check → 차이 없음
npm run typecheck → 통과 (이 작업은 src/ 를 바꾸지 않는다)
```

- SPEC-002에서 만든 `heartbeat_status.rs` 테스트 9개가 단언 수정 없이 통과한다. 바뀐 것은 `DuplicateHeartbeatJob`에 필드가 하나 는 것뿐이고, 기존 단언은 `name`과 `role`만 본다. (완료 조건 7)
- 쓰기·외부 명령·홈 계산 확인:

```
grep -rn "write|create_dir|remove_file|File::create|Command|process::|home_dir" \
  src-tauri/src/infrastructure/heartbeat_dream.rs src-tauri/src/infrastructure/heartbeat_status.rs
```

  결과가 전부 테스트 모듈 안이다(`heartbeat_dream.rs` 254줄 이후, `heartbeat_status.rs` 276줄 이후). 대상 모듈 본문에는 하나도 없다. (완료 조건 6)

- 실제 전역 파일 무변경: `~/.claude/HEARTBEAT.md`의 수정 시각이 이 세션 시작 전(Aug 2 13:38) 그대로다. 테스트는 전부 `tempfile::tempdir` 픽스처만 쓴다.
- `reading_the_dream_status_does_not_touch_the_heartbeat_home`가 홈 전체의 경로·수정 시각 스냅샷을 호출 전후로 대조한다.

### 신규 테스트

| 테스트 | 덮는 것 |
| --- | --- |
| `the_skill_file_decides_the_dream_installation` | `skills/dream/SKILL.md` 유무로 판정이 갈린다 |
| `the_three_states_come_from_two_independent_checks` | 하트비트 미설치 / 하트비트만 / 둘 다가 서로 다른 결과 (R2) |
| `marked_transcripts_come_from_the_v2_section` | 전체 5·마킹 2·미정제 3, `last_dream` 원문 |
| `an_active_entry_counts_as_unrefined` | `status: active`는 미정제, 하위 줄 없는 항목은 마킹 |
| `a_legacy_entry_counts_as_marked` | legacy `- <이름>.jsonl` 형태 |
| `entries_without_a_transcript_file_are_not_counted` | 지워진 파일 이름이 남아도 음수가 되지 않음 |
| `a_missing_meta_file_means_no_refinement_record` | `dream_meta.md` 없음이 정상 상태 |
| `a_missing_project_directory_means_no_transcripts` | 프로젝트 디렉터리 없음이 정상 상태 |
| `memory_topics_exclude_the_index_the_meta_and_subdirectories` | topic 3개 (MEMORY.md·dream_meta.md·`_dream_prep/` 제외) |
| `reading_the_dream_status_does_not_touch_the_heartbeat_home` | 읽기 전용 보장 |
| `duplicate_dream_job_outside_the_managed_block_is_detected` | 블록 밖 dream 잡 감지, 블록 안은 미감지 (R6) |
| `duplicates_of_both_integrations_are_reported_with_their_integration` | 결과에 연동 이름이 담김 |

이 저장소 slug(`-Users-catze-project-workflow-labs`)는 `*.jsonl` 22개, `memory/` 없음, `dream_meta.md` 없음이다. `a_missing_meta_file_means_no_refinement_record`가 이 경우(마킹 0, 미정제 = 전체, 정제 기록 없음, topic 0)를 그대로 덮는다.

## 사용자 QA 안내

이 작업은 백엔드 읽기 계층이라 화면에 보이는 변화가 없다. QA는 아래로 충분하다.

1. `cargo test --manifest-path src-tauri/Cargo.toml`이 통과하는지 확인한다.
2. 앱을 켜고 설정 화면에 들어가 하트비트 카드가 이전과 똑같이 보이는지 확인한다(설치 상태, 역할별 마지막 실행, 중복 경고).
3. `ls -la ~/.claude/HEARTBEAT.md`로 수정 시각이 그대로인지 확인한다.

## 남은 위험과 후속

- **선행 작업 TASK-008이 아직 `qa_waiting`이다.** 이 작업은 TASK-008이 만든 `ManagedJob`·`heartbeat_dream.rs` 위에 섰다. 코드가 작업 트리에 있고 검증도 끝난 상태라 진행했지만, TASK-008의 QA가 수정 요청으로 돌아오면 이 작업도 함께 다시 봐야 한다. 두 작업을 이어서 QA 하는 편이 안전하다.
- **TASK-010 주의 1**: `read_heartbeat_status`와 `read_heartbeat_installation`을 한 스냅샷에서 둘 다 호출하면, `HEARTBEAT.md`가 존재하는데 읽히지 않는 상황에서 `readFailures`에 같은 경로가 두 번 담긴다. 스냅샷 커맨드는 설치 판정을 한 번만 하고 그 값을 dream에 넘기도록 배선하는 것이 맞다. 지금 payload에는 접힌 3값만 있어 그대로 재사용할 수 없으므로, TASK-010에서 payload를 `HeartbeatInstallationStatus`로 옮길 때 함께 정리하면 된다.
- **TASK-010 주의 2**: payload를 공통 표현으로 옮기면 `HeartbeatInstallation` 열거형과 `collapse()`는 쓰이지 않게 된다. 그때 함께 지우면 된다. 지금 지우면 SPEC-002 테스트 단언과 프론트 문구가 동시에 깨진다.
- **TASK-011 주의**: `DuplicateHeartbeatJob`에 `integration` 필드가 늘었다. 프론트 `src/features/projects/domain/types.ts`에 아직 반영되지 않았다(이 작업의 범위 밖). 연동별 카드에 경고를 나눠 그릴 때 추가해야 한다.
- **TASK-012 주의**: dream 잡 실행 기록은 `heartbeat_status::read_job_runs(...).get("wf-dream<slug>")`로 얻는다. 역할용 별도 함수를 다시 만들 필요가 없다.
- 역할 개념이 없는 연동이 늘면 `no_role` 같은 함수가 규칙마다 생긴다. 지금은 둘뿐이라 그대로 뒀다. 세 번째가 올 때 `Option<fn>`으로 바꾸는 편이 나을 수 있다.

## 범위 밖으로 남긴 것

- 화면 문구, 커맨드 배선, dream 카드 — TASK-010·TASK-011.
- dream 잡 설치·토글·편집 — TASK-012.
- `dream-prep status` 등 외부 명령 실행 — 승인된 확인 필요 1번이 배제했다.
- 활성 파일 게이트 재현, 메모리 topic 내용 읽기 — 기획서 제외 범위.
