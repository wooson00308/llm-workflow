---
schema: workflow-labs/task@1
id: TASK-060
title: 앱의 개발자 대기 물량 판정이 선행 선언을 조건 스크립트와 같은 기준으로 확인한다
status: verified
source_spec_id: SPEC-013
source_decision_id: DECISION-73D4BC1B
depends_on:
- TASK-056
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T09:45:00Z
  kind: created
- at: 2026-08-03T12:36:03Z
  kind: in_progress
- at: 2026-08-03T12:45:15Z
  kind: qa_waiting
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-73D4BC1B
work_group_revision: 1
---

# 앱의 개발자 대기 물량 판정이 선행 선언을 조건 스크립트와 같은 기준으로 확인한다

TASK-040이 의도적으로 미충족으로 남긴 완료 조건 8을 닫는다. 조건 스크립트 v2의 `developer` 분기는
선행 선언(`depends_on`)을 판정하지만, 앱의 `role_eligibility.rs`는 아직 선언을 보지 않는다. 선언이
미충족인 `todo` 작업만 남으면 스크립트는 1(대상 없음), 앱은 `developer: true`를 내어 화면의 대기
물량이 하트비트보다 낙관적으로 보인다. SPEC-009 R3이 고정한 "두 판정이 같은 결론" 성질의 파손이며,
그 복원이 이 작업이다.

이 문서는 SPEC-018 분해가 이 배선을 R5 범위에 담지 못한 것을 TL 검수에서 발견해 사용자 위임 하에
보충한 것이다(REPORT-TASK-040-DEV의 승계 항목, DECISION-1224D86C의 분해 검수 지시). SPEC-013의
완료 조건 8이 근거이므로 소스는 SPEC-013·DECISION-73D4BC1B다.

## 의존성

- **선행 필수: TASK-056.** TASK-055(만료 lease)·TASK-056(수정 요청)이 같은 두 파일
  (`fs_project_repository.rs`의 `WorkflowInput` 조립, `role_eligibility.rs`)을 순차로 고친다. 세
  갈래가 같은 파일에서 만나므로 사슬 끝에 선다. TASK-056이 끝나면 TASK-055도 끝나 있다.
- TASK-037(파서·그래프)과 TASK-040(스크립트 v2)은 이미 `qa_waiting`이라 충족이다.

## 범위

- `src-tauri/src/infrastructure/fs_project_repository.rs` — `WorkflowInput` 조립에 작업별 선행
  선언(또는 판정에 필요한 최소 형태)을 싣는다. TASK-037의 `task_dependency_graph`(:1245)를
  재사용한다 — 같은 규칙의 구현을 두 벌 만들지 않는다.
- `src-tauri/src/infrastructure/role_eligibility.rs` — `has_developer_work`가 선행 선언 충족을
  확인하고, TASK-040이 남긴 "알려진 차이" 모듈 문서를 제거한다. 동치 테스트에 선언 시나리오를
  더한다.
- 그 외 파일은 건드리지 않는다. 화면·`types.ts`·조건 스크립트는 무변경이다.

## 작업 내용

- 판정 기준은 SPEC-013 R2의 단일 정의 그대로다: 선언된 id가 모두 `qa_waiting`·`completed`면 충족,
  하나라도 그 밖의 상태이거나 문서가 없거나 자기 참조·순환이거나 목록으로 읽을 수 없는 형식이면
  미충족. 새 규칙을 만들지 않는다 — TASK-037의 파서·판정을 호출하는 배선이다.
- `WorkflowItemSummary`에는 필드를 더하지 않는다(TASK-037의 제약 유지). 선언은 `WorkflowInput`의
  별도 값으로 싣는다.
- 동치 테스트 시나리오 최소: 선언 없는 todo만 있음(현행과 동일), 충족된 선언을 가진 todo, 미충족
  선언만 남음(스크립트 1 = 앱 false), 없는 id·순환·형식 오류 각각, 만료 lease와의 조합(TASK-055
  기준 유지).

## 완료 조건

1. 의존 미충족 `todo`만 남은 픽스처에서 조건 스크립트 v2와 `has_developer_work`가 같은 결론(대상
   없음)을 낸다. (SPEC-013 완료 조건 8)
2. `role_eligibility.rs`의 "알려진 차이" 문서가 제거되고, 동치 테스트가 선언 시나리오를 포함해
   통과한다.
3. `planner`·`architect` 판정 결과가 이 변경 전후로 같다.
4. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과하고, 삭제·비활성화된
   테스트가 없다.

## 범위 밖

- 조건 스크립트 변경(v2 그대로), 화면 표시, `WorkflowItemSummary` 확장, 스크립트의 파싱 구간
  차이(`scripts/wf-eligible.sh`가 파일 전체를 훑는 것 — REPORT-TASK-037-DEV 리스크 1번의 별건).
