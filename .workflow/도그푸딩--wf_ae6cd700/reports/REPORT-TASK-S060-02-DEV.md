# TASK-S060-02 개발 보고서

## 결정권자 요약

확인 대상 코드가 바뀌어 제출이 거절된 뒤에도 사용자가 다시 확인해서 제출할 수 있게 했다. 이제 제출에는
사용자가 확인 결과를 고른 시점에 화면이 보고 있던 코드 상태가 함께 실리고, 그 값이 지금의 코드와 같을
때만 결과가 기록된다. 거절 뒤 화면이 새 코드 상태로 다시 열리므로, 그 상태에서 다시 확인하면 제출이
기록된다. 확인 도중 코드가 바뀌면 남겨 둔 임시 결정을 비우고 처음부터 다시 보게 하여, 확인하지 않은
코드에 결과가 붙지 않는다. 확인 도중 코드가 또 바뀐 제출은 그대로 거절된다. 결정 문서 형식, 결정 기록
절차, 같은 요청 식별자 재전송 처리, 자동 확인 그룹의 판정, Git 저장소가 아닌 프로젝트의 동작은 바뀌지
않았다. 격리 사본과 공유 작업 공간 양쪽에서 자동 검사가 모두 통과했다. 이 결과는 GROUP-060의 둘째
작업이 끝났다는 근거이며, 갇혀 있던 작업 그룹이 실제로 완료로 정리되는지는 사용자 품질 확인에서
화면으로 확인한다.

## 변경한 파일과 모듈

선언한 여덟 파일만 수정했다.

- `src-tauri/src/domain/project.rs`: `WorkGroupQaSubmission`에 `qa_base_commit: Option<String>`을
  더하고 `#[serde(default)]`를 붙여, 값을 담지 않은 요청도 역직렬화되게 했다(C1). `WorkGroupSummary`
  의 `qa_base_commit` 주석을 갱신되는 값이라는 현재 규칙으로 고쳤다.
- `src-tauri/src/infrastructure/fs_project_repository.rs`: 제출 판정을 그룹 요약의 기록 대신 요청에
  실린 값과 `QaBasePin::current`의 대조로 바꿨다(C2). 현재 기준을 확정할 수 없으면 판정을
  건너뛰고, 확정할 수 있는데 요청이 값을 담지 않았으면 같은 `WorkGroupQaBaseChanged`로 거절한다(C3).
  오류 종류와 메시지는 그대로다. `parse_work_group`의 기록 호출은 두 확인 방식 모두
  `pin_to_current`를 쓰게 했고, 사용처가 없어진 `QaBasePin::pin`은 제거했다(C4).
- `src/features/projects/domain/types.ts`: `WorkGroupSummary`와 `WorkGroupQaSubmission`에
  `qaBaseCommit?: string | null`을 더했다. 선택 필드라 다른 화면 시험의 픽스처는 그대로 통과한다(C1).
- `src/features/projects/infrastructure/browserQaReviewDraftStore.ts`: 임시 결정 항목에
  `qaBaseCommit`을 더하고, 이 값이 없는 저장 항목은 `readEntry`가 버리게 했다(C6). `null`은 Git
  작업 트리가 아닌 프로젝트의 정상 값이므로 남긴다.
- `src/features/projects/components/qa/QaFlowReview.tsx`: 결과를 고르는 시점의 기준을 임시 결정에
  저장하고 그 값을 제출에 싣는다(C5). 임시 결정은 갱신 시각과 기준이 모두 같을 때만 물려받고, 다르면
  기존 임시 결정 비움 안내로 이어진다(C6).
- `src/features/projects/components/qa/QaWorkbench.tsx`: 확인 화면을 처음 상태로 되돌리는 키에
  기준 커밋을 더했다(C6). 한 번 열린 화면 안에서 확인 대상이 하나로 유지되는 근거가 이 키다.
- 시험 두 파일: 아래 검증 항목에 정리했다.

판단이 갈릴 수 있던 자리는 C3의 판정 생략 조건 하나다. 그룹 요약의 기록은 판정 직전
`parse_work_group`이 현재 값으로 갱신하므로 두 기준이 정상 동작에서 일치하고, 기록 파일 쓰기가
실패할 때만 갈린다. 그때 제출을 기록하지 않는 쪽이 보호에 맞아 현재 기준 커밋을 기준으로 삼았다.
그 밖에는 작업 문서만으로 구현이 가능했고, 기획서와 결정 문서는 착수 자격 확인으로만 읽었다.

## 검증 단계와 결과

격리 사본(기준 e4b844c, 변경 커밋 be65513)에서 먼저 실행했다.

1. `cargo test --manifest-path src-tauri/Cargo.toml` — 835개 통과, 실패 0.
2. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — 경고 0.
3. `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` — 통과.
4. `npx vitest run` 지정 두 파일 — 18개 통과.
5. `npm run test` — 477개 통과, 42개 건너뜀, 실패 0. 그룹 요약 타입 변경으로 깨진 시험이 없다.
6. `npm run typecheck` — 오류 0.
7. `git status` — 변경 파일이 선언한 여덟 파일뿐이고 `.workflow` 아래 변경은 없다(C10).

C11의 다섯 시험 처리 결과는 다음과 같다.
`work_group_pins_its_qa_base_commit_when_qa_can_open_and_never_repins_it`은 갱신 규칙에 맞춰
`work_group_records_its_qa_base_commit_when_qa_can_open_and_updates_it_as_the_base_moves`로 이름과
기대값을 고쳤고, 아직 열 수 없는 그룹은 기록하지 않는다는 앞부분 기대는 그대로 뒀다.
`work_group_qa_rejects_a_submission_after_the_base_commit_moves`와
`work_group_qa_records_on_the_pinned_base_and_replays_a_recorded_request`는 요청이 확인 시점 기준을
싣도록 픽스처를 고쳤고, 뒤쪽은 이름을 `..._on_the_reviewed_base_...`로 맞췄다. 보호하던 기대는 둘 다
유지된다. `each_work_group_revision_pins_its_own_base_commit`과
`work_group_qa_keeps_its_previous_behaviour_outside_a_git_work_tree`는 수정 없이 통과했다. 지운
시험은 없다.

C12로 백엔드 시험 둘을 더했다.
`work_group_qa_records_a_resubmission_reviewed_after_the_rejecting_base_move`가 거절과 재확인 제출
기록을 한 흐름으로 확인하고, `work_group_qa_rejects_a_submission_that_carries_no_reviewed_base_commit`
이 Git 작업 트리에서 기준을 담지 않은 제출의 거절을 확인한다. C13으로 화면 시험 셋을 더했다. 제출
본문에 확인 시점 기준이 실리는지, 요약의 기준이 달라지면 임시 결정을 물려받지 않고 안내가 보이는지,
기준 값이 없는 저장 항목을 버리는지다.

통합은 공유 기준 e4b844c가 격리 사본의 기준과 같아 그대로 진행했다. 공유 작업 공간에서 `.workflow`
바깥의 미커밋 변경은 없어 충돌이 없었고, 제품 파일만 담은 커밋 da76399로 반영했다. 통합 뒤 같은
일곱 검사를 격리 사본을 da76399로 옮긴 깨끗한 상태에서 다시 실행했고 결과는 위와 같다. 격리 결과와
통합 결과가 모두 통과다.

## 남은 위험

- 확인 화면이 새 코드 상태를 알게 되는 시점은 화면이 프로젝트를 다시 읽는 때다. 다시 읽기 전에는
  화면이 이전 기준을 들고 있고 그 제출은 백엔드가 거절한다. 의도한 보호이지만, 사용자에게는 결과를
  다 고른 뒤에야 거절을 만나는 경험으로 보인다.
- 기준 커밋 기록 파일 쓰기가 실패하면 그룹 요약의 기준이 비고, 화면이 실을 값도 없어 Git 작업
  트리에서는 제출이 계속 거절된다. 디스크 쓰기 실패에 한정된 경로이고, 잘못 기록하는 것보다 안전한
  쪽을 골랐다.
- 기준 값을 담기 전에 저장된 임시 결정은 이번 변경으로 한 번 버려진다. 사용자는 진행하던 확인을
  처음부터 다시 보게 된다. 브라우저 시험은 저장소를 흉내 낸 값으로 돌렸고 실제 WebView에서 저장소가 막힌
  경우는 기존 예외 처리에 기대고 있다.

## 후속 작업

- 남긴 것 없음. 아키텍트에게 넘길 발견이나 역할 밖 사항도 없다.
- GROUP-060은 두 작업이 모두 검증 완료이므로 사용자 품질 확인 차례다. 확인 절차는 그룹 문서에 있다.

예약 식별자: RES-20260818T043359Z-13720-20260818043357
