# TASK-081 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(tl-dev-081)의 보고서 파일 작성을 차단해("Subagents should return findings as text"), 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T10:26Z, TL 세션)

- 대상: TASK-081 (앱의 잡 읽기와 쓰기 대상을 이 프로젝트의 jobs.d 파일로 옮긴다)
- 근거: SPEC-024 R1·R2, DECISION-3C8F1A42 (`approved`·`created_by: user` 직접 확인) / 상태: `qa_waiting`
- lease: `lease-781-20260804095632` (acquire·renew·release 전부 exit 0)
- 선행: TASK-080·TASK-064 모두 `qa_waiting`. 두 작업이 만든 계약이 코드에 있는 것을 먼저 확인하고 착수했다 — `project_jobs_path`·`write_project_jobs`(`heartbeat_jobs.rs:180`·`:199`), `owned_job_names`(`heartbeat_service.rs`).

## 변경한 파일

둘뿐이다.

- `src-tauri/src/application/heartbeat_service.rs` — 읽기·쓰기 대상 전환, 두 모듈 테스트 갱신.
- `src-tauri/src/commands/heartbeat.rs` — doc 주석 두 곳만. 코드 무변경.

`heartbeat_status.rs`·`heartbeat_setup.rs`·`heartbeat_jobs.rs`·`heartbeat_roles.rs`·`heartbeat_dream.rs`·프론트엔드·문서 전부 무변경. 보호 상태(`project.yml`·`workflow.yml`·`decisions/`·`.runtime/`·`AGENTS.md` 관리 블록) 무변경. git 커밋·푸시·checkout·restore·stash 없음.

`~/.claude` 아래 전역 파일도 무변경이다. 세션 시작(18:56 KST) 전후로 `~/.claude/HEARTBEAT.md`(17:50:43)와 `~/.claude/heartbeat/jobs.d/`의 두 파일(17:50:43·16:58:15)의 수정 시각이 그대로다. 같은 시간대에 움직인 것은 `heartbeat_20260804.log`·`launchd_stderr.log`·`state.json`뿐이고 이것은 이 기기에서 돌고 있는 데몬 자신이 쓴 것이다. 모든 테스트가 `tempdir()`만 쓴다.

## 쓰기 (R1)

`install`·`install_dream`의 대상 파일을 `heartbeat_home.join(HEARTBEAT_FILE)`에서 `project_jobs_path(heartbeat_home, &slug)`로 바꾸고, 쓰기를 `install_managed_jobs(&path, &jobs, &owned_job_names(&slug))`에서 `write_project_jobs(&path, &jobs)`로 바꿨다. 대조·병합의 근거 문서도 같은 파일이다 — `read_document`가 그 경로를 읽고, baseline 대조·`preserved_role_jobs`·`preserved_dream_job`·`requested_*`의 입력이 모두 그 원문이다.

순서는 그대로다. 조건 스크립트가 먼저이고 그것이 실패하면 잡 파일을 쓰지 않는다. 잡 순서도 그대로 역할 3종 다음 dream이다(`merge_block` 무변경).

**전환 뒤 앱의 어떤 저장 경로도 `~/.claude/HEARTBEAT.md`를 쓰지 않는다.** `install_managed_jobs`의 프로덕션 호출자가 0이 되었다(남은 호출은 `heartbeat_roles.rs:179`·`heartbeat_dream.rs:574`이고 둘 다 `#[cfg(test)]` 안이다). 그 파일은 이제 설치 판정·설치 단계 2번·중복 감지의 읽기 대상으로만 남는다.

## 읽기 (R2)

`inspect`가 파일 둘을 읽는다. 관리 잡의 출처는 `read_heartbeat_status`가 읽어 온 `read.document`가 아니라 `read_text(&project_jobs_path(...))`의 결과다. `heartbeat_status.rs`는 지시대로 한 줄도 고치지 않았고, 이미 `pub(crate)`인 `read_text`·`TextSource`를 그대로 썼다.

- `managed_block_failure`는 이제 **잡 파일**을 읽지 못한 사유다. 파일 없음은 여전히 실패가 아니라 잡 없음이다(`TextSource::Missing` → `None`).
- 잡 파일의 읽기 실패는 `heartbeat.read_failures`에도 들어간다. 옛 문서의 실패가 실리던 자리와 같다. dream 카드의 실패 목록에 넣지 않은 것도 현행과 같다 — 두 카드는 섹션 공통값 `managedBlockFailure`로 이 상태를 읽는다.
- `managed_role_jobs`·`managed_dream_job`이 마커로 범위를 좁히지 않는다. 파일 전체가 앱 소유이므로 고르는 기준은 잡 이름 하나다. 그 결과 `managed_block` 헬퍼의 호출자가 사라져 지웠다.
- 설치 판정(`heartbeat_status.rs`의 세 갈래 OR)은 손대지 않았다. 확인 필요 3번의 승인된 제안대로 "막지 않고 알린다"이고, 여기서 판정을 고치면 부결된 대안 A를 구현하는 것이 된다.

### 필드 이름을 바꾸지 않은 판단 (작업 문서가 요구한 기록)

`managedBlockFailure`는 전환 뒤 이름이 사실과 어긋난다. 바꾸지 않았다. 바꾸면 `types.ts`와 화면 테스트 여러 곳이 함께 움직여 이 작업의 diff가 이름 바꾸기로 덮인다. 대신 그 필드의 doc 주석을 사실에 맞췄고, 이름이 옛 시절 그대로라는 사실과 이유를 주석에 남겼다. 같은 이유로 `merge_block`·`block_role_settings`·`ManagedBlockChanged` 같은 내부 이름과 사용자 문구의 "관리 블록"도 그대로 두었다(문구는 TASK-083 몫이다). 이름 정리는 후속 대상이다.

## 지운 것 두 개

둘 다 이 변경으로 호출자가 사라진 것이고, 남겨 두면 `dead_code`로 clippy 게이트가 깨진다.

1. `const HEARTBEAT_FILE`(서비스 쪽) — 작업 문서가 "남는 사용처가 없으면 지운다"고 지시한 그 상수다.
2. `fn owned_job_names(slug)` — TASK-064가 넣었고 유일한 사용처가 `install_managed_jobs` 호출 둘이었다. `write_project_jobs`는 파일 전체가 앱 소유라 `owned` 인자를 받지 않는다.

**TASK-082가 둘 다 다시 넣어야 한다.** 그 작업 문서는 `owned_job_names`를 "그대로 쓴다"고 적고 있고(범위 §40~41), 옛 블록 정리에는 옛 파일 경로도 함께 필요하다. 6줄짜리 순수 함수와 상수 하나이며 그 작업 문서에 이미 형태가 적혀 있다. TASK-064의 보존 **동작** 자체는 손대지 않았다 — `install_managed_jobs`의 `owned` 처리는 `heartbeat_jobs.rs`에 그대로 있다.

## 완료 조건 대조

1. 역할 잡이 `<home>/heartbeat/jobs.d/<slug>.md`에 기록 — `installs_the_condition_script_and_the_role_jobs_together`에 경로를 글자로 고정하는 단정을 더했다.
2. dream 저장이 역할 잡을 남기고 그 반대도 — `installing_dream_keeps_the_role_jobs_byte_for_byte_and_appends_after_them`, `saving_role_jobs_keeps_an_installed_dream_job`.
3. 디렉터리 없는 홈에서 디렉터리가 생김 — 위 1번 시험이 빈 임시 홈에서 시작한다.
4. 저장이 `HEARTBEAT.md`를 한 바이트도 안 바꿈 — `assert_other_project_jobs_intact`를 블록 구간 대조에서 **파일 전체 바이트 대조**로 바꿨다. 픽스처는 확인 사실 2의 상태(남의 slug 잡만 든 블록).
5. 전부 끄는 저장에서도 4가 성립하고 파일이 사라짐 — `turning_every_job_of_this_project_off_...`에 `jobs_file == None` 단정 추가, `turning_both_integrations_off_...`.
6. 손으로 고친 값이 조회에 나옴 — `a_hand_edited_app_owned_field_is_reported_by_name`, `only_a_role_job_changing_does_not_stop_a_dream_write` 등.
7. 못 읽음과 없음이 구분됨 — `an_unreadable_document_is_reported_with_its_path_and_reason`(`Some` + 실패 목록), `an_absent_document_counts_as_read_with_no_jobs`(`None` + 빈 목록).
8. 대조 실패 시 아무 파일도 안 씀 — `a_role_job_added/removed/value_changed_after_the_screen_read_...`, `a_stale_dream_baseline_writes_nothing` 전부 새 경로에서 통과.
9. 같은 저장 두 번 — `the_same_install_twice_changes_neither_file`, `the_same_dream_install_twice_does_not_change_the_file`.
10. 조건 스크립트 경로·순서 불변 — `heartbeat_condition.rs` 무변경. 관련 시험의 스크립트 단정은 한 글자도 안 고쳤다.
11. 잡 이름·slug 규칙 불변 — HEAD와 대조해 동일 확인: `heartbeat_jobs.rs`의 `project_slug`, `heartbeat_roles.rs:91~93`의 `job_name`, `heartbeat_dream.rs`의 `job_name`.
12. 마지막 실행·한도 표시 — 근거는 `state.json`이고 무변경. 관련 시험 전부 통과.
13. 설치 판정 불변 — `let installed = document_present || directory_present || pid_present;` HEAD와 동일(줄 번호만 106→108로 밀렸고 이는 다른 세션의 변경분이다).
14. 기존 테스트 미삭제·미비활성화 — 아래 목록.
15. `npm run check`·`cargo test` — 아래 게이트.

## 고친 테스트와 그 이유 (완료 조건 14)

**삭제하거나 `#[ignore]`한 테스트는 없다.** 두 모듈의 테스트 수는 그대로다.

### 대상 경로만 바뀐 것 (대다수)

`install_tests`의 헬퍼 `heartbeat_file(home)`를 둘로 나눴다: `jobs_file(project, home)`(앱이 실제로 쓰는 파일, 경로가 slug에서 나오므로 프로젝트가 함께 필요하다)와 `legacy_file(home)`(옛 전역 파일, "쓰지 않는다"를 확인할 때만 연다). 호출부 88곳이 기계적으로 `jobs_file`로 옮겨졌고 단정 내용은 그대로다. `mod tests`에는 `write_jobs_file` 픽스처 헬퍼를 더하고 마커로 감싸던 `managed()` 헬퍼를 지웠다(잡 파일에는 마커가 없다).

### 단정이 실제로 바뀐 것 (여섯)

1. `disabling_every_role_removes_the_block_but_keeps_the_script` — `Some("")` → `None`. 옛 경로는 마커만 지운 빈 문서를 남겼고, 새 경로는 파일을 지운다(TASK-080의 계약, R2의 "없는 파일이 잡 없음").
2. `installing_only_the_dream_job_writes_one_block_with_one_job` — 마커 개수 1 단정을 "마커가 없다"로 바꿨다. 잡 하나라는 단정은 그대로.
3. `installing_dream_keeps_the_role_jobs_byte_for_byte_and_appends_after_them` — 종료 마커를 떼어 내 head를 만들던 부분이 필요 없어졌다. 파일이 역할 잡으로 끝나므로 `both.starts_with(&roles_only)`가 더 강한 형태다.
4. `turning_both_integrations_off_removes_the_block_and_keeps_the_rest` — "블록 밖 원문 보존"의 전제가 사라졌다(잡 파일에는 밖이 없다). 씨앗을 옛 전역 파일에 두고, 잡 파일이 사라지는 것과 옛 파일이 바이트로 그대로인 것을 함께 본다.
5. `damaged_markers_stop_the_dream_install_without_touching_the_file` → `damaged_markers_in_the_legacy_file_no_longer_stop_the_dream_install`. 옛 파일이 저장 경로에서 빠졌으므로 그 파일의 마커 손상이 저장을 막지 않는다. 손상된 파일이 그대로 남는 것도 함께 본다.
6. `a_field_line_after_the_end_marker_stops_the_dream_install` → `a_stray_field_line_in_the_jobs_file_does_not_stop_the_dream_install`. 흡수 줄 방어는 "남과 한 파일을 나눠 쓴다"는 전제에서 나왔고 이 파일에는 그 전제가 없다(R6). 손으로 붙인 줄이 저장을 막지 않고 통째 쓰기가 그 줄을 걷어 내는 것을 본다.

### 이름만 바꾼 것 (넷)

이름이 대상 파일이나 판정 근거를 글자로 말하고 있어 그대로 두면 거짓이 되는 것만 바꿨다. `a_document_without_the_managed_block_has_no_role_jobs` → `a_job_file_needs_no_marker_for_its_jobs_to_be_read`(같은 픽스처로 단정이 뒤집힌다 — 마커 없이도 읽힌다), `role_job_settings_come_from_the_managed_block` → `..._come_from_the_job_file`, `a_job_outside_the_managed_block_is_not_installed` → `a_job_whose_name_is_not_a_role_job_of_this_project_is_not_read`(마커가 하던 범위 제한을 잡 이름 대조가 대신한다는 성질로 옮겼다), `a_failed_condition_script_install_leaves_the_heartbeat_file_alone` → `..._leaves_the_jobs_file_alone`.

나머지 이름의 "블록"은 그대로 두었다. 전부 바꾸면 이 작업의 diff가 이름 바꾸기로 덮인다.

## 게이트

`src-tauri`에서:

- `cargo test` — **391 passed, 0 failed, 0 ignored.** 신규·갱신 테스트 전부 통과, 기존 테스트 무삭제. (총계는 세션 중에도 386 → 390 → 391로 움직였다. 다른 세션이 같은 트리에 테스트를 착지시키고 있어 절대 수치는 판정 근거가 못 된다. 판정은 "실패 0 + 삭제 0"이다. 중간에 한 번 `role_eligibility` 테스트 하나가 실패했는데, 다시 보니 그 테스트가 TASK-086 세션에 의해 실행 중 이름째 바뀐 것이었고 재실행에서 사라졌다.)
- `cargo fmt -- --check` — 통과.
- `cargo clippy --all-targets -- -D warnings` — **에러 1개로 실패한다. 이 작업의 변경분이 아니다.** 유일한 지적은 `src/infrastructure/heartbeat_process.rs:216`의 `cloned_ref_to_slice_refs`이고, 그 파일은 이 작업이 열지도 않은 **untracked 파일**(다른 세션의 SPEC-020 계열 산출물)이다. 그 한 lint만 `-A`로 빼면 `--all-targets`가 깨끗하게 통과한다. 즉 이 작업의 변경분이 만든 clippy 지적은 0이다. 그 파일의 수정은 이 세션의 역할 밖이라 손대지 않았다.

프로젝트 루트에서:

- `npm run check` — 통과. 18 test files / 456 tests passed, `tsc -b && vite build` 성공. 프론트엔드는 한 줄도 고치지 않았다(`types.ts` 무변경이라 계약이 그대로다).

## 남는 중간 상태와 후속

작업 문서가 예고한 그대로다. 이 작업만 착지한 시점에 옛 블록에 이 프로젝트의 잡 정의가 남아 있으면 그것은 화면에 드러나지 않는다. 데몬이 jobs.d를 이기므로 사용자의 편집은 실제로 적용된다(R3 첫 갈래). 정리와 표시는 TASK-082다. 화면 문구와 대상 경로 표기는 여전히 `~/.claude/HEARTBEAT.md`를 가리키고 있고 그것이 TASK-083의 입력이다.

핸드오프 넷:

1. **TASK-082는 `HEARTBEAT_FILE` 상수와 `owned_job_names`를 다시 넣어야 한다.** 위 "지운 것" 참고.
2. **마커 방어 세 겹(마커 개수·순서·흡수 줄)의 서비스 계층 커버리지가 이 작업으로 비었다.** 판정 코드는 `heartbeat_jobs.rs`에 그대로 있으나 그 모듈의 `mod tests`에 손상 마커 시험이 없어서, 지금은 어느 테스트도 그 세 갈래를 타지 않는다. TASK-082가 `install_managed_jobs` 호출자를 되살리므로 그때 함께 덮이는 것이 맞다(그 작업의 완료 조건 5가 정확히 이 지점이다). 이 작업의 범위가 `heartbeat_jobs.rs`를 제외해 여기서 테스트를 옮겨 넣지 않았다.
3. **TASK-064 QA 때 볼 것.** SPEC-022의 네 시험은 지금도 통과하지만 성립 이유가 바뀌었다. 앱이 남의 잡을 골라 보존하는 것이 아니라 그 파일을 아예 열지 않는다. 보존 로직 자체는 `install_managed_jobs`에 살아 있고 TASK-082가 다시 쓴다.
4. **잡 파일에 손으로 덧붙인 줄은 다음 저장에서 사라진다.** 통째 쓰기의 성질이고 TASK-080의 계약이다. 사용자 편집을 지키는 방어는 이 경로에서 저장 직전 baseline 대조 하나다(R6). 사실로만 남긴다.
