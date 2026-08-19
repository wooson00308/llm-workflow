# TASK-S082-01 개발 보고서

## 결정권자 요약

아이디어 카드의 상태 판정에 다섯 번째 값 재반영중이 생겼다. 사용자가 수정 요청으로 돌려보낸
기획서를 다시 받는 아이디어는 이제 첫 기획을 받는 반영중과 다른 값으로 화면에 내려간다. 판정이
결정 기록을 함께 읽게 되면서, 재작성 세션이 잡는 수정 요청 결정의 lease도 아이디어를 잡은 lease와
같은 무게로 선점이 된다. 정상으로 도는 재작성 세션 위에 중단 의심이 뜨던 자리가 이것으로 막힌다.
쓰다 만 재작성 기획서만 남았을 때는 재반영중인 채로 그 기획서 번호가 중단 의심 근거에 담긴다.
결정 기록을 읽지 못해도 조회 자체는 성공하고 lease를 보는 판정만 빠진다. 화면 문구와 색은 이
작업의 범위가 아니며 같은 기능의 TASK-S082-02가 이미 반영했다. 격리 사본과 통합 커밋에서 백엔드
시험 950건이 통과했고 기존 아이디어 판정 시험은 기대값을 하나도 고치지 않았다. 이 결과는
GROUP-082 사용자 확인의 재반영중 구분과 중단 의심 표시 항목을 뒷받침한다.

## 바꾼 파일과 모듈

- `src-tauri/src/infrastructure/fs_project_repository.rs` — 네 곳이다.
  - `SpecReference`에 `source_decision_id: Option<String>`을 더하고 `spec_reference`가 기획서
    프론트매터에서 그 값을 읽는다. 나머지 세 필드의 판정 규칙은 그대로다.
  - `derive_idea_states`가 결정 기록 목록을 인자로 더 받는다. 선점 판정을 아이디어 식별자를 문
    lease(`idea_preempted`)와 이 아이디어에서 나온 기획서를 되돌린 `revision_requested` 결정을 문
    lease(`redraft_preempted`) 둘로 나눠 OR로 합쳤고, 재작성 판정(`redrafting`)은 뒤쪽 lease이거나
    `source_decision_id`를 적은 `draft` 기획서가 있을 때 참이다. 기존 네 갈래의 조건식은 그대로
    두고, 두 번째 갈래의 상태 문자열만 `redrafting`과 `drafting` 중에서 고른다.
  - 목록 경로는 `workflow_items`가 이미 읽어 둔 `decisions`를 판정에 넘긴다. 디렉터리를 다시 훑지
    않는다(SPEC-033 R7).
  - 문서 전문 경로는 `read_idea`가 `read_spec_decisions`의 결과를 변수로 묶어 참조 판정과 상태
    판정에 같은 목록을 넘긴다. 전에는 인자 자리에서 만들어 버려 두 판정이 같은 목록을 못 봤다.
- `src-tauri/src/domain/project.rs` — 문서 주석 둘이다. `status`는 다섯 값과 `redrafting`의 뜻을
  적고, `stalled_spec_ids`는 넓어진 선점 두 갈래를 적는다. 두 필드의 이름과 타입은 그대로다.
- 같은 저장소 파일의 시험 모듈 — 픽스처 둘(`write_rework_spec_for_idea`,
  `write_revision_requested_idea`)과 내용 스냅샷 헬퍼 하나, 시험 일곱을 더했다.

## 검증 단계와 결과

- C2·A2. `treats_an_idea_whose_revision_request_is_claimed_as_redrafting`. 재작성 기획서 문서가
  아직 없고 결정을 문 lease만 있는 조합이 `("redrafting", [])`을 낸다. 통과.
- C3·C6·A3. `names_the_stalled_rework_spec_when_the_revision_request_is_not_claimed`. lease를 뺀
  같은 조합에 재작성 `draft` 기획서를 더하면 `("redrafting", ["SPEC-002"])`다. 통과.
- C5. `counts_the_revision_request_lease_as_a_claim_over_the_rework_spec`. 위 조합에 lease를 다시
  넣으면 상태는 그대로고 중단 의심 근거가 빈다. 통과.
- C4·A4·A5. `keeps_a_first_drafting_idea_out_of_redrafting`. 아이디어를 문 lease로 도는 조합과 첫
  기획 `draft`만 남은 조합이 각각 `("drafting", [])`, `("drafting", ["SPEC-002"])`다. 통과.
- C7·A7. `the_list_and_the_full_document_agree_on_a_redrafting_idea`. 두 재작성 픽스처를 놓고
  `inspect`와 `read_idea`의 `status`·`stalled_spec_ids`를 대조한다. 통과.
- C8·A9. `keeps_the_rework_draft_judgement_when_the_decision_directory_is_unreadable`. 결정
  디렉터리를 지운 뒤 조회가 성공하고, lease 쪽 카드는 재반영중이 아니게 되며 재작성 `draft` 쪽
  카드는 그대로 재반영중이다. 통과.
- C9·A8. `judging_a_redrafting_idea_writes_nothing`. `inspect`를 두 번 부르기 전후로 제어
  디렉터리 전체의 수정 시각과 파일 내용이 같다. 기존 시각 스냅샷 헬퍼가 시각만 보므로 내용
  스냅샷을 따로 만들어 함께 본다. 통과.
- C1·C12. 격리 사본에서 `cd src-tauri && cargo test` 통과. 950건(922 + 28) 통과, 실패 0.
  기존 아이디어 판정 시험과 `role_eligibility.rs`의 파생 상태 단언 시험은 한 줄도 고치지 않았다.
- C11. 통합 커밋의 변경 파일은 선언한 두 개뿐이다. 화면 코드, 스타일, 자격 판정, 규칙 문서는
  손대지 않았다.
- 통합. 변경 커밋의 기준이 통합 직전 세 번 옮겨져(484a499 → 0356707 → ca82b65 → 2d38cc2) 그때마다
  새 기준 위로 옮기고 `cargo test`를 다시 통과시켰다. 옮긴 기준의 차이는 모두 `.workflow` 아래
  문서 커밋이었다. `.workflow` 밖에 수정된 추적 파일이 없어 충돌 없이 정방향 통합했고, 통합 커밋은
  826876f다.
- 통합 뒤 검사. 격리 사본을 통합 커밋(826876f)으로 옮긴 깨끗한 상태에서 `cargo test` 950건 통과.
  같은 상태에서 `npm run test`도 돌려 화면 쪽 605건 통과·42건 건너뜀을 확인했다. 새 값을 소비하는
  TASK-S082-02가 같은 기준에 이미 들어와 있어 두 절반이 맞물리는지 함께 본 것이다.
- 작업 문서 밖을 본 곳. 없다. 완료 조건과 검증 절차, 범위 사전 검사가 모두 작업 문서 안에서
  닫혔고, 기획서 본문과 결정 문서 본문은 열지 않았다. 결정 문서는 자격 판정에 필요한
  프론트매터만 읽었다.

## 남은 위험

- 재작성 선점 판정은 결정 기록을 훑는 만큼 조회 한 번이 읽는 문서가 늘었다. 결정 디렉터리는
  이미 목록 경로가 읽고 있었고 문서 전문 경로도 참조 판정 때문에 읽고 있었으므로 디렉터리 훑기
  자체는 늘지 않았다. 다만 아이디어마다 결정 목록을 도는 비교가 새로 생겼다.
- C2의 판정은 `revision_requested` 결정 가운데 최신인지를 따지지 않는다. 작업 문서 C2가 "결정이
  있고 그 결정을 문 lease가 있으면"으로 적혀 있어 그대로 구현했다. 한 기획서가 여러 번 되돌려진
  뒤 옛 결정을 문 lease가 남아 있으면 그 아이디어도 재반영중으로 읽힌다.
- 재작성 기획서가 `source_idea_id`를 적지 않으면 참조 자체가 만들어지지 않아 이 판정에 들지
  않는다. 작업 문서가 범위 밖으로 못 박은 자리이며, 이번 변경이 그 성질을 바꾸지 않았다.

## 후속 작업

- 아키텍트에게 넘길 발견은 없다. 범위 사전 검사가 짚은 행과 값 경로가 저장소 현재 상태와
  일치했고, 선언한 두 파일 밖으로 나가야 하는 자리는 나오지 않았다. `role_eligibility.rs`가
  편집 없이 지금 값을 유지한다는 예측도 시험 통과로 확인됐다.
