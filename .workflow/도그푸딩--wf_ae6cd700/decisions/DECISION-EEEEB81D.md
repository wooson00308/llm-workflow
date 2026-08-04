---
schema: workflow-labs/decision@1
id: DECISION-EEEEB81D
spec_id: SPEC-015
outcome: approved
created_by: user
created_at: 2026-08-03T05:26:59Z
---

사용자 지시로 대리 기록한 승인. SPEC-014 수정 요청(DECISION-2F71D20D)의 세 항목 — 선점 헬퍼 Windows 지원의 범위 포함(D5·R10), SPEC-013 산출물 뒤에 서는 실행 순서 선언(R12), CI 3 러너 사실 갱신(D2) — 이 모두 반영되었음을 확인했다. 요청하지 않은 저장소 변화(TASK-037~040 파생, TASK-029가 만든 `role_eligibility.rs`의 unix 한정 동치 테스트, `condition_script_version` 2가 이식 대상이라는 점)까지 스스로 갱신해 반영한 것도 확인했다.

확인 필요 1번은 제안대로 진행한다. 완료 조건 12·13·18·19번은 CI로 닫지 않는 사용자 QA 항목으로 남기고, 개발자 세션이 자동화 테스트 통과를 실기 확인의 대체로 삼아 닫지 않는다.

아키텍트 분해 시 유의 사항을 남긴다.

- R12의 실행 순서(조건 스크립트 PowerShell 구현은 TASK-040 뒤, 선점 헬퍼 PowerShell 구현은 TASK-039 뒤)는 SPEC-013이 도입한 depends_on 선언으로 걸어 달라.
- Windows 차단 해제는 헬퍼 작업에 묶지 않는다(D5). 조건 스크립트 쪽이 준비되면 그 시점에 푼다.
