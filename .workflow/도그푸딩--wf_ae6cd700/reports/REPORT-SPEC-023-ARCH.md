# SPEC-023 아키텍트 핸드오프

> 기록 경위: 하네스가 서브에이전트(arch-b)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T09:12Z, TL 세션)

- 역할: 프로젝트 아키텍트 (architect)
- 대상: DECISION-9E5D2C71 (SPEC-023 승인)
- 산출 작업: TASK-075, TASK-076, TASK-077 (3건, todo)
- 세션: 2026-08-04T09:01Z ~ 09:06Z / lease 취득→갱신→반납 전부 exit 0

## 의존 지도

TASK-075(사본 제거+docs, R5) → TASK-076(조건 스크립트 ASCII 사유 출력, R4·R6) → TASK-077(앱이 사유 표시, R1~R3). TASK-077 ← TASK-065(SPEC-022, HeartbeatCard·DreamCard 파일 겹침). 직렬 3단, 순환·댕글링 없음.

## 핵심 분해 결정

- 사본 제거가 맨 앞: the_repository_copy_matches_the_managed_script(heartbeat_condition.rs:593)가 사본·내장 본문 동일성을 단언하므로, 076이 먼저 가면 사본까지 같이 고쳐야 하는데 075가 그 파일을 지운다. 이 순서면 076은 사본을 신경 쓰지 않는다.
- 시나리오 표·일치 테스트 갱신 5단계를 TASK-076에 명시: (1) run_condition이 종료 코드+stdout 첫 줄 반환하게 확장, (2) Scenario 구조체에 기대 사유 열 추가(expected 종료 코드 열은 무변경 — 완료 조건 7의 증거), (3) sh·PowerShell 본문 동시 수정, (4) CONDITION_SCRIPT_VERSION 4→5, (5) 사유 코드 플랫폼 분기 감시는 표 대조+CI 3플랫폼 위에서 구현 판단.
- quota 낡은 사유는 우회(R3): 사유는 skipped에만, quota_skipped 제외. 데몬 결함(claude-heartbeat 백로그 등록됨)임을 작업 문서에 사실로 기록.
- TASK-077 → TASK-065 의존: 같은 두 파일(HeartbeatCard·DreamCard)의 다른 구간, SPEC-022 체인 우선 권고와 일치.
- SPEC-024에는 depends_on을 걸 수 없음(미분해라 작업 id 부재) — SPEC-024 분해자가 TASK-077 겹침(HeartbeatCard.tsx·heartbeat_status.rs)을 보고 걸어야 함. 인계.
- 테스트 모듈 표기 인계 확인: heartbeat_service.rs는 mod tests(:874)·mod install_tests(:2082) 두 모듈(TASK-063 인계가 정확). 이번 세 작업의 대상 파일은 전부 단일 mod tests라 같은 함정 없음(실측 표기).
- 승인 결론 반영: 확인 1(사본 제거+docs, "앱 설치 후 생성" 안내를 별도 완료 조건으로), 확인 2(R2 하위 호환을 TASK-077 핵심 제약 절로), 확인 3(076이 ASCII 코드 어휘 확정·보고, 077이 그 목록으로 한국어 대응표 — 이 인계가 의존의 실질).
- 아키텍트 위임 결정 1건: 성공·실패 기록에는 사유를 붙이지 않음 — 설명이 필요 없는 자리의 문장 증가는 R3 세 번째 항목을 해침.

## 후속 / 리스크

- SPEC-024 분해자 인계: TASK-077 겹침에 depends_on 필요 가능성.
- TASK-076의 실질 난이도는 deps_of 표준 출력(의존성 목록 명령 치환)과 사유 첫 줄 계약의 공존 — 구현이 정하고 근거를 남길 것. 막히면 사유 출력 위치 재검토.
- state.json에 last_condition_output 실물 0건 — TASK-077 검증은 픽스처 기반, 실물은 076 이후.
- dream 카드는 통로만 열림(dream-prep이 저장소 밖).

## 상태

보호 상태 무변경, 제품 코드·문서 무변경(읽기만), git 커밋 없음. 작업 셋 todo + created history. lease 반납 완료.
