# TASK-S060-01 개발 보고서

## 결정권자 요약

자동 확인 방식의 작업 그룹이 새 커밋이 들어왔다는 이유만으로 완료되지 못하고 개발 중에 남던 동작을
없앴다. 이제 자동 확인 그룹은 판정하는 시점의 코드 상태에서 완료 여부를 정하고, 확인 대상 기준
커밋도 그 시점의 값으로 다시 적는다. 사용자가 직접 확인하는 작업 그룹은 이 변경에서 바뀌지 않았고,
확인을 시작한 코드 상태를 한 번만 고정하는 동작과 확인 도중 코드가 바뀐 제출을 기록하지 않는 보호가
그대로 남는다. 검증 완료가 아닌 작업이 남은 그룹과 구성 오류가 있는 그룹은 기준 커밋이 전진해도
완료로 넘어가지 않는다. Git 저장소가 아닌 프로젝트의 동작도 변경 전과 같다. 격리 사본과 공유 작업
공간 양쪽에서 자동 검사가 모두 통과했다. 이 결과는 GROUP-060의 첫 작업이 끝났다는 근거이며, 실제로
갇혀 있던 작업 그룹이 완료로 정리되는지는 사용자 품질 확인에서 화면으로 확인한다.

## 변경한 파일과 모듈

선언한 범위 그대로 `src-tauri/src/infrastructure/fs_project_repository.rs` 한 파일만 수정했다.

- `QaBasePin::pin_to_current`를 새로 더했다. 저장된 고정 값이 지금 기준 커밋과 다르면 지금 값으로
  다시 적고, 같으면 그대로 둔다(C2). `QaBasePin::pin`은 한 번만 고정하는 기존 동작 그대로 남겼다(C4).
- 두 경로가 공유하는 쓰기 부분을 `QaBasePin::write_pin`으로 분리했다. 경로 조립 `qa_base_pin_path`와
  읽기 `read_qa_base_pin`은 손대지 않아 파일 경로 규칙과 다섯 필드 형식이 그대로다. 쓰기가 실패하면
  `None`을 돌려주어 고정 값이 없는 것으로 다루는 처리도 유지했다(C6).
- `parse_work_group`에서 표시 상태가 `AutomaticCompleted`일 때 고정 값 불일치를 이유로 `Developing`
  으로 되돌리던 분기를 제거했다(C1). 고정 값을 싣는 자리를 `match`로 바꿔 `QaReady`는 `pin`,
  `AutomaticCompleted`는 `pin_to_current`를 부른다. `display_status`가 더는 재대입되지 않아
  `mut`를 뗐다.
- 완료 판정 분기 자체(그룹 결정·준비·막힘·개발 중·구성 오류의 순서와 조건)는 한 줄도 바꾸지
  않았다(C3). 제출 판정과 `WorkGroupQaBaseChanged` 거절 경로도 그대로다(C4).
- 시험 `automatic_work_group_does_not_complete_when_the_base_commit_moves`를
  `automatic_work_group_stays_completed_and_records_the_base_commit_of_each_reading`으로 다시
  썼다(C8). 기준 커밋이 전진한 뒤에도 표시 상태가 자동 완료로 남고, 그룹 요약과 기록 파일의 기준
  커밋이 모두 전진한 현재 커밋과 같음을 확인한다.
- 검증 완료가 아닌 작업이 남은 자동 확인 그룹을 확인하는 시험
  `automatic_work_group_with_an_unverified_task_never_completes_on_a_moved_base_commit`을
  더했다(C9). 기존 자동 모드 픽스처와 기준 전진 도우미를 그대로 썼다.
- 시험 모듈의 `use super::{...}` 목록에 `current_base_commit`을 더했다. 새 기대값이 전진한 실제
  커밋과의 일치를 요구해서 필요했고, C10의 다섯 시험은 이 줄로도 바뀌지 않는다.

## 검증 단계와 결과

격리 사본(`.workflow/.runtime/worktrees/TASK-S060-01/lease-67882-20260817150754`, 기준 커밋
`bf13db5`, 변경 커밋 `3e94458`)에서 먼저 실행했다.

1. `cargo test --manifest-path src-tauri/Cargo.toml` — 832 통과, 0 실패. 통합 시험 25 통과, 0 실패.
2. `cargo test --manifest-path src-tauri/Cargo.toml work_group` — 15 통과, 0 실패. C10의 다섯 시험
   (`work_group_pins_its_qa_base_commit_when_qa_can_open_and_never_repins_it`,
   `work_group_qa_rejects_a_submission_after_the_base_commit_moves`,
   `work_group_qa_records_on_the_pinned_base_and_replays_a_recorded_request`,
   `each_work_group_revision_pins_its_own_base_commit`,
   `work_group_qa_keeps_its_previous_behaviour_outside_a_git_work_tree`)이 본문 수정 없이 통과했다.
3. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — 종료 코드 0,
   경고 0.
4. `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` — 통과. 처음 실행에서 `mut` 제거로
   줄바꿈이 어긋나 실패했고, `cargo fmt`를 돌려 맞춘 뒤 다시 통과했다.
5. `git status` — 변경 파일은 선언한 한 파일뿐이고 `.workflow` 아래 변경은 0건이다(C7).

통합 직전에 공유 기준을 다시 확인했다. 공유 작업 공간의 `dev`가 후보가 출발한 `bf13db5` 그대로였고,
`.workflow` 밖 추적 파일의 미커밋 변경과 stage된 변경이 없으며 진행 중인 기준 변경도 없었다. 후보를
`fd7ad48`로 통합한 뒤 공유 기준에서 같은 검사를 다시 돌렸다.

- `cargo test` 전체 — 832 통과, 0 실패. 통합 시험 25 통과, 0 실패.
- `cargo test work_group` — 15 통과, 0 실패.
- `cargo clippy --all-targets -- -D warnings` — 종료 코드 0, 경고 0.
- `cargo fmt -- --check` — 통과.

격리 사본과 공유 기준의 결과가 모든 항목에서 같다.

## 남은 위험

- 검증이 끝난 뒤 들어온 커밋이 이미 끝난 검증을 깨뜨렸는지는 앱이 판단하지 않는다. 이 점은 변경 전과
  같고 이 작업의 범위 밖이지만, 자동 확인 그룹이 이제 실제로 완료로 마감되므로 그 상태가 화면에
  남는 시간이 길어진다.
- 실제로 갇혀 있는 그룹(`GROUP-RES-20260815T032125Z-60360-20260815032125`)의 회복은 시험 픽스처가
  아니라 실제 기록 파일에 달려 있다. `.workflow/.runtime/`은 Git 추적 대상이 아니어서 자동 검사로
  확인할 수 없었고, 사용자가 화면을 다시 열어 확인해야 한다. GROUP-060의 확인 동선 1~4번이 그 자리다.
- 자동 확인 그룹은 이제 프로젝트를 읽을 때마다 기준 커밋이 달라지면 기록 파일을 다시 쓴다. 쓰기는
  그룹당 한 파일이고 기준 커밋이 같으면 쓰지 않으므로 반복 조회에서 추가 쓰기는 생기지 않는다.

## 후속 작업

- TASK-S060-02가 사용자 확인 모드의 재확인 경로를 다룬다. 이 작업이 만든 `pin_to_current`를 그쪽에서
  함께 쓰도록 GROUP-060이 순서를 정해 두었다.
- 작업 문서 밖에서 확인한 것 하나를 남긴다. C9가 "수용 기준 4"를 번호로만 가리키고 그 문장을 담고
  있지 않아 SPEC-060의 수용 기준 절을 열어 문장을 확인했다. 다음 아키텍트 세션이 완료 조건에서
  기획서 기준을 인용할 때 번호와 함께 그 문장을 옮겨 적으면 이 왕복이 없어진다.
- 공유 작업 공간에는 다른 세션이 쓰는 중인 `.workflow` 문서와 개발 로그가 커밋되지 않은 채 남아
  있다. 이 작업의 통합을 막지 않아 그대로 두었고, DECISION-1591470F의 lease가 아직 유효해 다른
  세션의 작성 중 문서를 대신 커밋하지 않았다.
