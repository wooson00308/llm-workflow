---
schema: workflow-labs/idea@1
id: IDEA-4141EE4C
status: inbox
created_at: 2026-08-04T07:23:55.560894+00:00
---

역할 자격 판정이 4벌로 중복돼 있고 건너뜀 사유가 유저에게 안 보여. 판정은 sh 원본(heartbeat_condition.rs:26 리터럴), PowerShell(:209), role_eligibility.rs, scripts/ 잔재 사본까지 4곳. 단일화 방향 검토가 필요해. 그리고 하트비트 데몬 0.8부터 condition의 stdout 첫 줄을 state.json의 last_condition_output으로 실어주니까, wf-eligible 스크립트가 판정 사유를 한 줄 출력하게 하고(예: "no-target: 아이디어 18개 전부 반영됨") 연동 카드가 그 값을 보여주면 "건너뜀 이유를 모르는" 문제가 풀려. 앱은 heartbeat_status.rs에서 그 키만 추가로 읽으면 돼.
