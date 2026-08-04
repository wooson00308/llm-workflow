---
schema: workflow-labs/idea@1
id: IDEA-A61F6A81
status: inbox
created_at: 2026-08-04T07:23:55.560894+00:00
---

하트비트 연동 저장이 다른 프로젝트의 잡을 지워. 오늘(8/4) mech-arena에서 역할 잡을 설치하니 workflow-labs 잡 3개가 커스텀 값째로 사라졌어. 원인은 merge_block(heartbeat_service.rs:425)이 현재 slug의 역할 잡 + dream 잡만 보존하고 관리 블록을 통째로 다시 써서, 다른 slug의 잡이 병합에서 떨어지는 것. baseline 대조도 자기 slug 한정이라 못 막고, 테스트는 slug 픽스처가 하나뿐이라 회귀도 못 잡아. 카드 문구는 "이 컴퓨터의 모든 프로젝트가 함께 씁니다"라고 약속하고 있어. 수정할 때 두 번째 slug를 쓰는 회귀 테스트가 반드시 같이 가야 해.
