---
schema: workflow-labs/idea@1
id: IDEA-ACAE7F01
status: inbox
created_at: 2026-08-04T10:35:41Z
---

기획자 자격 판정 분기에도 `created_by` 필터를 넣어 대리 결정 비대칭을 닫자.

TASK-088 착지 과정에서 실측으로 확인된 실제 갈림이다(REPORT-TASK-088-DEV.md 실측 절). `created_by: user-delegate`인 결정 문서가 기획서 옆에 남아 있을 때, 아키텍트 분기(TASK-086이 필터 추가)와 앱(read_spec_decisions가 필터링)은 그것을 무시하지만, 조건 스크립트의 기획자 분기(heartbeat_condition.rs:150~:158 비교 루프)는 `created_by`를 읽지 않아 그 대리 결정을 최신으로 센다. 재현: `revision_requested`(created_by: user)만 있을 때 planner exit 0(eligible)이던 기획서에 대리 승인 문서 하나를 더하면 planner exit 1(no-target)로 뒤집힌다 — 수정 요청이 하트비트에서 가려지고, 앱은 여전히 재작업 대상으로 보므로 앱과 하트비트가 갈린다.

처방은 작고 명확하다: 기획자 분기 비교 루프에 아키텍트 분기와 같은 두 줄(`created_by` 추출 + `user` 아니면 continue)을 sh·ps1 양쪽에 넣고, CONDITION_SCRIPT_VERSION을 착수 시점 값에서 +1. 그리고 공통 규칙(project_instructions.rs의 WORKFLOW_RULES) §2.1이 지금 자기 결함을 명시하고 있는 임시 문장 — "Until that branch reads `created_by` too, the app and the heartbeat disagree" — 을 지우면서 WORKFLOW_RULES_VERSION도 +1 (TASK-088이 이 문장을 임시로 못박아 둔 경위가 보고서에 있다).

경위: SPEC-028은 이 지점을 제외 범위(SPEC-023 겹침)로 뒀고, TASK-086 보고서 후속 3번이 비대칭 잔존을 예고했으며, TASK-088 보고서 후속 1번이 후속 아이디어 등록을 권했다. 개발자 분기는 결정 문서를 읽지 않으므로 대상이 아니다. 판정 결과 불변 검증은 TASK-086의 선례(before/after 이중 실행 + 저장소 결정 전수 대입)를 따르면 된다 — 현재 저장소에는 user-delegate 결정이 0건이라 실저장소 판정은 전후 동일해야 하고, 달라지는 것은 위 재현 픽스처 같은 대리 결정 혼재 상황뿐이어야 한다.
