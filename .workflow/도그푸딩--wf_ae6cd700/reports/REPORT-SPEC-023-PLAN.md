# REPORT-SPEC-023-PLAN

> 기록 경위: 하네스가 서브에이전트(plan-a)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T08:57Z, TL 세션)

기획자 세션 결과. IDEA-4141EE4C를 SPEC-023으로 합성했다.

- 대상 아이디어: IDEA-4141EE4C (역할 자격 판정 4벌 중복과 건너뜀 사유 미노출)
- 산출 기획서: SPEC-023 (status: user_review) → 이후 DECISION-9E5D2C71로 위임 대리 승인됨
- 선점: lease-74201-20260804083316 (08:33Z 획득 → 08:50Z 해제, exit 0) — wf-claim.sh 헬퍼 사용(공통 규칙 §4)
- 작성 시각: 2026-08-04T08:50:00Z

## 대상 선정

미답변 수정 요청 없음. 미처리 아이디어 5건 중 created_at 최선순 동률(IDEA-4141EE4C·IDEA-CAB890F1)에서 id 사전순으로 IDEA-4141EE4C 선택(직전 SPEC-021 세션과 같은 기준). SPEC-020 lease(아키텍트 보유)·SPEC-009(만료) 무조치.

## 핵심 기획 결정

1. 아이디어의 사실 주장 넷 중 셋 확인, 하나 정정: 판정 사본 네 곳(heartbeat_condition.rs:26 sh 본문, :209 PowerShell 본문, role_eligibility.rs, scripts/wf-eligible.sh) 실재. 단 scripts/ 사본은 "잔재"가 아니라 승인된 SPEC-001의 산출물 — docs/heartbeat.md가 네 곳에서 공식 호출 경로로 안내하고 본문 일치 테스트(heartbeat_condition.rs:593)가 붙어 있다. 제거하려면 승인 문서를 함께 고쳐야 해서 확인 필요 1번으로.
2. "4벌이 갈라진다"는 지금 일어나지 않는다: role_eligibility.rs:157 대조 테스트 + 윈도우 PowerShell 경유 + 3플랫폼 CI. 문제의 실체는 "조용한 분기 위험"이 아니라 "규칙 한 줄에 네 곳 편집"이라는 유지비 (TASK-056 범위 목록이 그 네 파일).
3. 줄일 수 있는 사본은 하나뿐(4→3): PowerShell 본문은 윈도우에 sh가 없어서, role_eligibility.rs는 조회마다 외부 프로세스 3회를 띄울 수 없어서 존재.
4. 사유 통로는 실재하나 미출시: config-contract.md가 last_condition_output을 계약 키로 정의, 구현은 미푸시 브랜치(claude/v0.8.0-jobsd). R2로 "키가 없으면 지금 화면 그대로" 하위 호환을 박음.
5. 스크립트가 아무것도 안 해도 절반은 해결: 데몬이 타임아웃·실행 실패 사유를 직접 만든다(core.py:318~:322). 앱이 키만 읽으면 나타남.
6. PowerShell ASCII 제약(heartbeat_condition.rs:768)이 사유 문자열 설계를 좁힘 → 스크립트는 ASCII 코드, 앱이 한국어 문장 제안.
7. 낡은 사유 함정: 데몬 quota 분기(core.py:434~:443)가 last_condition_output을 안 지움 → R3에서 quota_skipped에는 사유 미표시로 우회. 근본 수정은 데몬 몫.

## 확인 필요 3건과 처리

1. scripts/wf-eligible.sh 제거 + docs/heartbeat.md 경로 수정 — 제안대로 승인 (SPEC-002의 유예 조건 충족).
2. 데몬 0.8 출시 전 앱 먼저 — 제안대로 승인 (R2 하위 호환).
3. 스크립트 ASCII 코드 + 앱 한국어 문장 — 제안대로 승인.

## 검증

확인 사실 26건을 앱 코드·저장소 문서·CI 설정·claude-heartbeat 작업 트리·실물 파일에서 직접 대조(추정 0). 실측: state.json 잡 11개 중 last_condition_output 키 0건 — 데몬은 그 코드로 도는데 스크립트가 사유를 안 낸다는 진단과 일치. 인용 줄 번호 재대조로 8곳 정정(작업 트리 기준). 코드 무변경이라 테스트 미실행.

## 핸드오프·역할 밖 발견

- dream-prep 소스가 이 기기에 없어 dream 잡 사유 가능 여부 미확인(제외 범위 명시).
- role_eligibility.rs:6~:19의 의도된 차이 5건 중 lease 시각 표기 차이(4번)는 선점 헬퍼 도입 전 파일에만 남는 항목 — 언젠가 정리 대상.
- 데몬 quota 분기의 사유 미삭제는 claude-heartbeat 쪽 수정이 근본적 → TL이 데몬 백로그 등록.
- 세션 종료 시점 다른 lease: SPEC-021, TASK-063, TASK-070 (경합 없음).

## 보호 상태

생성 파일 SPEC-023.md 하나. 보호 상태 무변경, git 커밋 없음, lease 해제 완료. 만료 SPEC-009.yml 무조치. .workflow/rules/wf-eligible.sh의 수정 상태는 이 세션 이전(mtime 15:14)의 기존 미커밋 구현분.
