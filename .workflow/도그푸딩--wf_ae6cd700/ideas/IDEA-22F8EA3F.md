---
schema: workflow-labs/idea@1
id: IDEA-22F8EA3F
status: inbox
created_at: 2026-08-06T04:57:35Z
---

리눅스에서 간헐 실패하는 비결정적 테스트 둘을 결정적으로 만들자. `heartbeat_version_service.rs`의 `more_than_one_line_is_off_contract`·`a_line_of_another_shape_is_off_contract`가 v0.1.9 릴리스 CI(ubuntu-22.04)에서 같은 커밋으로 fail→pass가 뒤집혔다 — 코드 변화 0에서 결과가 갈렸으니 플레이크 확정이다.

실측 근거 (2026-08-06 v0.1.9 릴리스 과정, PR #19 CI run 31027986352 → 31029172771 → 31032183429):

- 1차 run에서 두 테스트 pass, 2차 run(코드 무변경 재실행 아님, 다른 커밋이지만 해당 파일 유닉스 경로는 의미 동일)에서 fail, 같은 커밋 재실행에서 다시 pass.
- 실패 모양: 스크립트 실행이 시작조차 못 해 `NotStarted` 계열이 나와 `OffContract` 기대 단언이 깨짐.
- 원인 가설(릴리스 세션 진단): 테스트가 tempdir에 `#!/bin/sh` 스크립트를 쓰고 chmod 직후 exec하는데, 러스트 테스트는 스레드 병렬이라 다른 테스트가 fork하는 순간 이 테스트의 write fd가 자식에 상속되면 리눅스에서 ETXTBSY로 exec이 실패한다. macOS는 이 방식으로 막지 않아 재현이 안 된다 — 두 번의 CI에서 macOS가 항상 통과한 것과 부합.

왜 문제인가: 릴리스 게이트가 CI 4/4 그린인데, 간헐 실패는 매 릴리스마다 "재실행 도박"을 강요하고, 반복되면 사람들이 빨간 CI를 무시하는 습관을 만든다. 판정 비용 회귀 검사(judgement_cost)처럼 이 저장소는 결정적 검증을 규범으로 삼아 왔다.

처방 방향은 기획자 몫이나 재료를 남긴다: 파일을 닫고 exec 전 fd가 남지 않게 하는 것(쓰기 스코프 분리), exec 실패 시 ETXTBSY 한정 재시도, 또는 스크립트 파일 생성 어법을 저장소의 다른 테스트(judgement_cost의 shim 생성 등 이미 병렬에서 안정적인 자리)와 통일하는 것. 같은 어법을 쓰는 다른 테스트가 있는지 전수 확인도 기획 재료다.

등록 경위: 2026-08-06(KST) v0.1.9 릴리스 세션의 빚 목록에서 사용자 승인으로 등록. 릴리스는 해당 테스트가 통과한 상태로 나갔고 구조는 그대로 남아 있다.
