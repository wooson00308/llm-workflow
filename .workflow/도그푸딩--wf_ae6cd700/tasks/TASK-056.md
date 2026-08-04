---
schema: workflow-labs/task@1
id: TASK-056
title: 후속 기획서가 없는 수정 요청이 기획자 대기 물량이 되고 두 판정이 같은 결론을 낸다
status: completed
source_spec_id: SPEC-018
source_decision_id: DECISION-1224D86C
depends_on: [TASK-055]
updated_at: 2026-08-03T12:42:56Z
history:
  - { at: 2026-08-03T09:30:00Z, kind: created }
  - { at: 2026-08-03T10:08:00Z, kind: in_progress }
  - { at: 2026-08-03T10:18:00Z, kind: qa_waiting }
---

# 후속 기획서가 없는 수정 요청이 기획자 대기 물량이 되고 두 판정이 같은 결론을 낸다

SPEC-018 R1과 R5를 구현한다. 기획자 계약은 담당을 "미처리 아이디어 또는 앱이 기록한
`revision_requested` 결정 하나"로 적지만, 조건 스크립트의 `planner` 분기는 `ideas/`만 훑고 `decisions/`를
열지 않는다. 계약의 절반을 판정이 보지 못한다. SPEC-018이 IDEA-C95EABD2를 참조하면서 미처리 아이디어가
0이 되었으므로, 지금부터 기록되는 수정 요청은 기획자 잡을 깨우지 못한다.

이 작업은 그 구멍을 sh와 앱 양쪽에서 동시에 막는다. 한쪽만 고치면 화면과 실행이 다른 사실을 말하고,
`role_eligibility.rs`의 일치 테스트가 곧바로 깨진다.

## 의존성

- **선행 필수: TASK-055.** 같은 세 파일(`heartbeat_condition.rs`·`fs_project_repository.rs`·
  `role_eligibility.rs`)을 만지고, R1이 요구하는 "결정이 lease로 선점되어 있으면 제외한다"의 선점
  판정이 TASK-055가 만드는 sh 함수와 앱의 만료 필터다. **선행이 반영되지 않은 상태에서 이 작업을
  시작하지 않는다.**
- TASK-055가 TASK-039·TASK-040을 선행으로 두므로 그 체인 전체가 이 작업 앞에 선다.
- 이 기획서의 TASK-057이 이 작업을 선행으로 둔다. 같은 파일을 만지고, 아이디어 상태에 네 번째 값이
  생겨도 판정이 흔들리지 않으려면 이 작업의 3절이 먼저 반영돼야 한다.
- **착수 시 TASK-042의 반영 여부를 확인한다.** 조건은 TASK-055의 0절과 같다.

## 범위

- `src-tauri/src/infrastructure/heartbeat_condition.rs` — `CONDITION_SCRIPT` 본문의 `planner` 분기,
  `CONDITION_SCRIPT_VERSION`, 테스트.
- `scripts/wf-eligible.sh` — 같은 본문(관리 표기 두 줄 제외).
- `src-tauri/src/infrastructure/fs_project_repository.rs` — `PreparedWorkflow`가 수정 요청 결정을
  판정에 넘기는 배선.
- `src-tauri/src/infrastructure/role_eligibility.rs` — `WorkflowInput`, `has_planner_work`, 시나리오 표.
- 조건부: 조건 스크립트의 PowerShell 본문 — TASK-042가 이미 반영됐을 때만.
- 그 외 파일은 건드리지 않는다. 특히 `project_instructions.rs`·`docs/file-contract.md`·
  `domain/project.rs`·화면은 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 확인할 저장소 상태

- `CONDITION_SCRIPT_VERSION`의 현재 값을 읽고 1을 올린다. TASK-055가 이미 한 번 올린 뒤다.
- 저장소의 `.workflow/.runtime/leases/`에서 실험하지 않는다.

### 1. 판정 규칙 (sh와 앱이 함께 지킨다)

이 절이 규칙의 단일 정의다. 두 구현이 갈리면 여기로 돌아온다.

기획자 대기 물량은 **둘 중 하나라도** 있으면 있음이다.

**(가) 미처리 아이디어.** 어떤 기획서도 `source_idea_id`로 참조하지 않고 유효한 lease가 없는 아이디어.
지금 규칙 그대로다.

**(나) 후속 기획서가 없는 수정 요청 결정.** 아래를 모두 만족하는 결정이다.

1. 문서가 기획서 결정이다. `schema: workflow-labs/decision@1`이고 `spec_id`가 비어 있지 않다.
   **QA 결정을 걸러내는 조건이라 생략하면 안 된다.** `workflow-labs/qa-decision@1`도 `outcome`에
   `revision_requested`를 쓰고 그 문서는 `task_id`를 갖는다. 이 조건이 없으면 개발 작업 QA 반려가
   기획자 잡을 깨운다. 앱의 `read_spec_decisions`는 이미 `schema`·`created_by`·`spec_id`를 요구한다.
2. 그 `spec_id`의 **가장 최근** 결정이다. 같은 `spec_id`를 가진 다른 결정 중 `created_at` 문자열이 더
   큰 것이 있으면 이 결정은 최신이 아니다. 앱의 `latest_spec_decisions`도 `created_at` 문자열 비교이므로
   두 구현이 같은 방식이어야 한다. 이 규칙은 새 규칙이 아니라 `docs/file-contract.md:102`의 적용이다.
3. `outcome: revision_requested`다.
4. `source_decision_id`가 그 결정 id와 같은 기획서가 `specs/` 아래에 없다. 판정 키는 결정 id다 —
   한 기획서가 여러 번 수정 요청을 받으면 결정마다 후속이 하나씩 생기므로 기획서 id보다 정확하다.
   후속 기획서의 `status`(`draft`·`user_review`)와 그 뒤에 붙은 결정은 보지 않는다.
5. 그 결정 id로 만든 유효한 lease가 없다. 유효성 판정은 TASK-055가 만든 것을 쓴다.

`architect`·`developer` 분기의 자격 조건은 이 작업으로 바뀌지 않는다.

### 2. sh의 `planner` 분기

아이디어 루프 뒤에 결정 루프를 더한다. 둘 중 어느 쪽이든 대상을 찾으면 즉시 0으로 끝낸다.

- 스키마 확인은 `grep -qs '^schema: workflow-labs/decision@1'`, `spec_id`·`id`·`outcome`·`created_at`은
  기존 분기와 같이 `sed -n 's/^키: *//p' | head -1`로 읽는다.
- 최신 결정 판정은 같은 워크플로우의 결정 파일을 한 번 더 훑어 같은 `spec_id`의 `created_at`이 더 큰
  것이 있는지 본다. 결정 수가 작아 이중 루프로 충분하고, `sort`·`awk`를 새로 들이지 않는 편이
  TASK-042의 PowerShell 이식에도 싸다.
- 후속 기획서 확인은 `grep -qs "source_decision_id: *$did" "${wf}"specs/*.md`다. `architect` 분기가
  작업 문서에 대해 쓰는 것과 같은 모양이고, 보는 디렉터리가 달라 개발 작업의 같은 이름 필드와 섞이지
  않는다.
- 결정 문서의 값에 정규식 메타문자가 들어오지 않는다는 가정을 새로 만들지 않는다. 기존 분기와 같은
  수준의 `grep` 사용에 머문다.

### 3. 앱 판정 (R1·R5)

- `WorkflowInput`에 수정 요청 결정 목록을 더한다. `PreparedWorkflow::read`가 이미 결정 전부를 읽고
  `approved`만 걸러 `approved_decisions`로 넘기므로, 같은 읽기에서 "최신이면서 `revision_requested`인
  결정"을 함께 만든다. 최신 판정은 기존 `latest_spec_decisions`를 쓴다.
- 후속 기획서 존재는 `WorkflowItems::specs`의 `source_decision_id`로 본다.
  `read_markdown_document`가 문서 종류와 무관하게 이 필드를 이미 파싱한다.
- **`has_planner_work`의 아이디어 조건을 `status == "inbox"`로 바꾼다.** 지금은
  `status != "adopted"`이고, SPEC-012가 아이디어 상태를 `inbox`·`drafting`·`adopted` 세 값으로 바꾼
  뒤로 이 조건은 스크립트와 어긋나 있다. 재현: `status: draft`인 기획서가 참조하는 아이디어 하나만
  있는 프로젝트에서 앱은 기획자 대기 있음, 스크립트는 없음이라고 답한다. 스크립트는 참조 기획서가
  있으면 그 아이디어를 건너뛰고, 파생 상태가 `inbox`인 경우가 정확히 "참조도 선점도 없는" 경우다.
  **이 일치 복원은 DECISION-1224D86C가 이 기획서에 명시적으로 배정한 몫이다.**
- 아이디어의 lease 확인(`!lease_ids.contains(&idea.id)`)은 남긴다. 파생 상태는 lease의 `task_id`를
  보고 판정은 파일 이름을 보므로, 둘이 어긋난 lease가 있어도 스크립트와 갈라지지 않게 한다.
- 모듈 머리 주석의 "알려진 차이" 목록을 이 변경 뒤 사실에 맞게 유지한다.

### 4. 시나리오 표 (R5)

`role_eligibility.rs` 테스트 모듈에 아래를 더한다. 전부 `assert_matches_condition_script`로 앱과
스크립트를 함께 대조한다.

- 후속 없는 수정 요청이 있고 미처리 아이디어가 없으면 기획자 대기 있음. (기획서 완료 조건 1)
- 그 결정을 `source_decision_id`로 참조하는 기획서가 생기면 대기 없음. (기획서 완료 조건 2)
- 후속 기획서가 `draft`일 때와 `user_review`일 때 결과가 같다. (기획서 완료 조건 3)
- `revision_requested` 뒤에 `approved`가 붙은 픽스처와 `rejected`가 붙은 픽스처에서 대기 없음.
  (기획서 완료 조건 4)
- 미처리 아이디어가 있으면 수정 요청 유무와 무관하게 대기 있음. 기존 테스트가 수정 없이 통과한다.
  (기획서 완료 조건 5)
- 그 결정을 참조하는 **작업 문서**만 있고 후속 기획서가 없으면 대기 있음이 유지된다.
  (기획서 완료 조건 6)
- 결정 id로 된 미만료 lease가 있으면 대기 없음. (기획서 완료 조건 7)
- 결정 id로 된 만료 lease는 대기를 막지 않는다.
- `outcome: revision_requested`인 QA 결정(`workflow-labs/qa-decision@1`, `task_id` 보유)만 있으면 대기
  없음. 1절 (나) 1번을 고정한다.
- `status: draft`인 기획서가 참조하는 아이디어만 있으면 두 판정 모두 대기 없음.
  (기획서 완료 조건 13)

## 완료 조건

1. 후속 기획서가 없는 최신 `revision_requested` 결정이 있고 미처리 아이디어가 없으면 조건 스크립트의
   `planner` 판정이 0을 낸다. (기획서 완료 조건 1)
2. 그 결정을 `source_decision_id`로 참조하는 기획서가 생기면 1을 내고, 후속 기획서의 상태는 결과를
   바꾸지 않는다. (기획서 완료 조건 2·3)
3. 같은 기획서의 가장 최근 결정이 `revision_requested`가 아니면 재작업 대상이 아니다.
   (기획서 완료 조건 4)
4. 미처리 아이디어가 있으면 수정 요청 유무와 무관하게 0을 낸다. (기획서 완료 조건 5)
5. 개발 작업의 `source_decision_id`와 QA 결정이 기획자 판정에 영향을 주지 않는다.
   (기획서 완료 조건 6)
6. 결정을 선점한 미만료 lease는 그 결정을 대상에서 빼고, 만료 lease는 빼지 않는다.
   (기획서 완료 조건 7)
7. 앱의 역할별 대기 물량 판정이 위 시나리오 전부에서 조건 스크립트와 같은 결론을 낸다.
   (기획서 완료 조건 12)
8. 아이디어 파생 상태가 세 값인 지금 상태에서 `drafting` 아이디어만 있는 픽스처의 두 판정이 모두
   대기 없음이다. (기획서 완료 조건 13)
9. 조건 스크립트 버전이 1 올라가고 설치·갱신 안전 규칙 셋이 그대로다. (기획서 완료 조건 14)
10. 기존 자동화 테스트가 삭제되거나 비활성화되지 않는다. (기획서 완료 조건 22)
11. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.
    (기획서 완료 조건 23)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

## 범위 밖

- 우선순위 규칙. 조건 스크립트와 앱 판정은 "있다/없다"만 답하고 순서를 표현하지 않는다(R3). 순서를
  계약에 적는 것은 TASK-059다.
- 참조 필드 이름을 계약에 못박는 것(R2). TASK-059다.
- `architect`·`developer` 분기의 자격 조건 변경과 확인 사실 17번의 최신 결정 문제(기획서 제외 범위).
- 반려로 끝난 아이디어의 화면 구분. TASK-057·TASK-058이다.
- 만료 lease 판정의 구현. TASK-055가 낸 것을 쓴다.
- 죽은 세션이 남긴 고아 `draft` 기획서의 회수(기획서 제외 범위).
- 사용자에게 수정 요청을 알리는 알림·배지·집계(기획서 제외 범위).

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `planner` 분기(`heartbeat_condition.rs:37`~`:49`)는 `ideas/*.md`만 훑고 `decisions/`를 열지 않는다.
- `has_planner_work`(`role_eligibility.rs:53`)는 `idea.status != "adopted"`다.
  `derive_idea_states`(`fs_project_repository.rs:1024`)가 `inbox`·`drafting`·`adopted`를 파생하고,
  참조 기획서 중 `draft`가 있으면 `drafting`이다. 두 판정의 어긋남은 지금 실재한다.
- `read_spec_decisions`(`fs_project_repository.rs:1479`)는 `schema: workflow-labs/decision@1`,
  `created_by: user`, `id`, `spec_id`, `outcome`을 요구하고 세 outcome 밖의 값을 버린다.
- `latest_spec_decisions`(`:1550`)는 `created_at` 문자열 비교로 최신을 고른다.
- `PreparedWorkflow::read`(`:729`)가 결정 전부를 읽어 `approved`만 걸러 넘긴다.
  `revision_requested` 결정도 같은 읽기 안에 있다.
- `read_markdown_document`(`:1093`)가 문서 종류와 무관하게 `source_decision_id`를 파싱한다.
  SPEC-013·SPEC-015가 그 필드를 재작업 기획서에 쓰고 있다.
- 이 저장소의 QA 결정 27건은 모두 `outcome: confirmed`이지만 스키마상 `revision_requested`가 가능하고,
  QA 결정에는 `spec_id`가 없다.
- `an_approved_decision_followed_by_a_revision_request_is_still_architect_work`(`role_eligibility.rs:291`)
  는 아키텍트 자격이 최신 결정을 보지 않는다는 사실을 고정한다. 이 작업은 그 성질을 바꾸지 않는다.
