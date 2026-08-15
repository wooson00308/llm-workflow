---
schema: workflow-labs/task@1
id: TASK-057
title: 참조 기획서가 모두 반려로 끝난 아이디어를 네 번째 파생 상태로 판정한다
status: verified
source_spec_id: SPEC-018
source_decision_id: DECISION-1224D86C
depends_on:
- TASK-056
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T09:30:00Z
  kind: created
- at: 2026-08-03T12:23:06Z
  kind: in_progress
- at: 2026-08-03T12:32:06Z
  kind: qa_waiting
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-1224D86C
work_group_revision: 1
---

# 참조 기획서가 모두 반려로 끝난 아이디어를 네 번째 파생 상태로 판정한다

SPEC-018 R6의 백엔드 몫을 구현한다. 지금 아이디어 파생 상태는 `inbox`·`drafting`·`adopted` 셋이고,
반려로 끝난 아이디어는 승인까지 간 아이디어와 같은 `adopted`를 단다. 사용자는 그 아이디어가 끝났다는
것을 화면에서 알 수 없다. 화면은 이 작업에서 한 줄도 바뀌지 않는다 — 표시는 TASK-058이다.

DECISION-9B93CEA0이 "그 기획이 표시를 바꿔야 한다면 SPEC-012의 상태 축을 확장하는 새 기획으로 다루라"고
적었고, DECISION-1224D86C가 확인 필요 1번을 "구분만 한다"로 확정했다. 그래서 축을 하나 더 만들지 않고
기존 세 값을 네 값으로 늘린다. 상태가 배타적이어야 화면이 한 아이디어에 두 가지 결론을 붙이지 않는다.

## 의존성

- **선행 필수: TASK-056.** 둘 다 `fs_project_repository.rs`를 만진다. 더 중요한 이유가 있다 —
  TASK-056이 `has_planner_work`의 조건을 `status != "adopted"`에서 `status == "inbox"`로 바꾼다. 그
  전에 네 번째 값을 만들면 그 값이 곧바로 "기획자 대기 있음"으로 읽혀 R6의 "표시가 아이디어를 처리
  대상으로 되돌리지 않는다"가 깨진다. **선행이 반영되지 않은 상태에서 이 작업을 시작하지 않는다.**
- 이 기획서의 TASK-058이 이 작업을 선행으로 둔다. 화면이 쓸 값을 이 작업이 만든다.
- 파생 상태를 만드는 `derive_idea_states`·`spec_references`는 TASK-035(SPEC-012)의 산출물이고 그 작업은
  `qa_waiting`이라 편집이 끝나 있다.

## 범위

- `src-tauri/src/infrastructure/fs_project_repository.rs` — `SpecReference`, `spec_references`,
  `derive_idea_states`, 테스트.
- `src-tauri/src/domain/project.rs` — `status` 필드의 주석(파생값이 넷이 된다).
- 그 외 파일은 건드리지 않는다. 특히 `role_eligibility.rs`·`heartbeat_condition.rs`·
  `project_instructions.rs`·`docs/file-contract.md`·`types.ts`·화면은 이 작업에서 바뀌지 않는다.

## 작업 내용

### 1. 기획서의 종료 여부를 읽는다

`spec_references`가 이미 결정 목록을 받아 `latest_spec_decisions`로 최신 결정을 보고 `is_draft`를
정한다. 같은 자리에서 "최신 결정이 `rejected`인가"를 함께 낸다. 결정 판정 규칙을 새로 쓰지 않는다.

- 반려 판정은 최신 결정 하나만 본다. `rejected` 뒤에 다른 결정이 붙으면 그 기획서는 반려로 끝난 것이
  아니다.
- 결정이 없는 기획서는 반려가 아니다.

### 2. 네 번째 파생 상태

`derive_idea_states`의 판정 순서를 아래로 한다. 앞 조건이 먼저 이긴다.

1. 참조 기획서도 선점도 없으면 `inbox`.
2. 미만료 lease가 선점했거나 참조 기획서 중 `draft`가 있으면 `drafting`.
3. 참조 기획서가 하나 이상이고 **전부** 최신 결정이 `rejected`면 새 값.
4. 그 밖은 `adopted`.

- 새 값의 이름은 `closed`다. 파일에 쓰지 않는 조회 시점 파생값이고, 화면 문구는 TASK-058이 정한다.
- 3번이 2번보다 뒤인 것이 R6의 "반려가 섞여 있어도 살아 있는 기획서가 하나라도 있으면 종결이 아니다"를
  만족시킨다. 반려된 기획서와 `draft` 기획서가 함께 있으면 아직 쓰는 중이므로 `drafting`이다.
- 수정 요청으로 끝난 기획서는 반려가 아니다. 후속 기획서가 아직 없으면 그것은 기획자 재작업 대기이고
  (TASK-056의 R1), 종결과 반대편이다.
- `stalled_spec_ids`의 뜻과 채우는 조건은 바뀌지 않는다.
- 판정은 조회 시점 파생이다. 아이디어 파일에 쓰지 않고, 새 프론트매터 필드나 새 원천을 만들지 않는다.
- 목록 조회와 전문 읽기가 같은 함수를 부르는 SPEC-012 R7의 구조를 유지한다.

### 3. 판정이 대상을 되돌리지 않는지 확인한다

`role_eligibility.rs`를 고치지 않는다. TASK-056 뒤의 `has_planner_work`는 `status == "inbox"`만 보므로
`closed`는 자동으로 대상이 아니다. 이 사실을 테스트로 고정하는 것이 이 작업의 몫이다.

### 4. 테스트

- 참조 기획서가 모두 반려로 끝난 아이디어가 `closed`다. (기획서 완료 조건 18의 판정 몫)
- 반려와 승인이 섞이면 `adopted`이고, 반려와 `user_review`가 섞여도 `adopted`다.
  (기획서 완료 조건 19)
- 반려와 `draft`가 섞이면 `drafting`이다.
- 반려된 기획서를 참조하는 아이디어를 선점한 미만료 lease가 있으면 `drafting`이다.
- 최신 결정이 `revision_requested`인 기획서만 참조하는 아이디어는 `closed`가 아니다.
- `rejected` 뒤에 다른 결정이 붙은 기획서만 참조하는 아이디어는 `closed`가 아니다.
- `closed` 아이디어만 있는 프로젝트에서 조건 스크립트와 앱 판정이 모두 기획자 대기 없음이다.
  `role_eligibility.rs`의 기존 대조 헬퍼를 쓰되 그 파일은 고치지 않는다. (기획서 완료 조건 20)
- 조회 전후로 아이디어·기획서·결정·lease 파일의 내용과 수정 시각이 같다. 기존
  `inspecting_the_project_does_not_touch_the_workflow_files`가 그 성질을 이미 고정하고 있으므로 반려
  픽스처가 포함되게 한다. (기획서 완료 조건 21)

## 완료 조건

1. 참조 기획서가 모두 최신 결정 `rejected`인 아이디어의 파생 상태가 `closed`다.
   (기획서 완료 조건 18의 판정 몫)
2. 살아 있는 기획서가 하나라도 있으면 `closed`가 아니다. (기획서 완료 조건 19)
3. `closed` 아이디어가 조건 스크립트·앱 양쪽에서 기획자 처리 대상이 아니다. (기획서 완료 조건 20)
4. 판정이 아이디어·기획서·결정·lease 파일에 쓰기를 일으키지 않는다. (기획서 완료 조건 21)
5. 네 값이 배타적이고, 목록 조회와 전문 읽기가 같은 결론을 낸다.
6. 기존 자동화 테스트가 삭제되거나 비활성화되지 않는다. (기획서 완료 조건 22)
7. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다.
   (기획서 완료 조건 23)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

## 범위 밖

- 화면의 어떤 변경도. 라벨·아이콘·재진입 안내는 TASK-058이다.
- `src/features/projects/domain/types.ts`를 포함한 프런트엔드 타입. TASK-058이다.
- 반려된 기획서를 되살리거나 반려된 아이디어를 파이프라인이 다시 집게 만드는 것(기획서 제외 범위).
  재진입 경로는 사용자가 새 아이디어를 만드는 기존 경로다.
- 기획서 화면과 개발 작업 화면의 상태 표시(기획서 제외 범위).
- 조건 스크립트의 판정. TASK-055·TASK-056이 정한 그대로다.
- 죽은 세션이 남긴 고아 `draft` 기획서의 회수(기획서 제외 범위).
- 계약 문서 갱신. TASK-059다.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `spec_references`(`fs_project_repository.rs:983`)는 `source_idea_id`를 가진 기획서만 모으고,
  `latest_spec_decisions`로 만든 `decided` 맵으로 `is_draft`를 정한다. 결정이 있으면 `draft`가 아니다.
- `derive_idea_states`(`:1024`)가 세 값을 파생하고, 판정 순서는 `inbox` → `drafting` → `adopted`다.
  받은 lease 목록이 이미 미만료만 담고 있어 만료 판정을 하지 않는다.
- `read_spec_decisions`(`:1479`)가 `rejected`를 이미 읽는다. 세 outcome 밖의 값만 버린다.
- 이 저장소에 반려 결정은 아직 하나도 없다. 기획서 결정 18건 중 `approved` 16, `revision_requested` 2다.
  픽스처로만 검증할 수 있다.
- `domain/project.rs:111`의 주석이 파생값을 `inbox`·`drafting`·`adopted` 셋으로 적는다.
- SPEC-012 제외 범위는 "죽은 세션의 아이디어를 회수하는 문제는 회수 정책으로 따로 다뤄야 한다"고
  적었고, 이 기획서는 그중 표시만 맡는다.
