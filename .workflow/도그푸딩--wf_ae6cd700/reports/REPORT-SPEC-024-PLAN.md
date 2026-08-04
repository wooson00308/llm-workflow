# REPORT-SPEC-024-PLAN

> 기록 경위: 하네스가 서브에이전트(plan-b)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T08:53Z, TL 세션)

기획자 세션 결과. IDEA-CAB890F1을 SPEC-024로 합성했다.

- 대상 아이디어: IDEA-CAB890F1 (하트비트 데몬 0.8의 jobs.d 계약으로 앱 쓰기 경로 전환)
- 산출 기획서: SPEC-024 (status: user_review) → 이후 DECISION-3C8F1A42로 위임 대리 승인됨
- 세션 역할: 기획자 / 선점: lease-74436-20260804083342 (acquire → renew 1회 → release, 전부 exit 0)
- 작성 시각: 2026-08-04T08:50:00Z

## 대상 선정

미답변 수정 요청 없음(revision_requested 결정 둘은 SPEC-015·SPEC-013이 이미 수신). 미처리 아이디어 다섯 중 created_at 최선순 동률(IDEA-4141EE4C·IDEA-CAB890F1)에서 id 사전순으로 IDEA-4141EE4C를 먼저 시도 → exit 3(다른 세션 선점, SPEC-023 생성 확인) → IDEA-CAB890F1로 진행. SPEC-024 파일은 set -o noclobber 배타 생성. 선점은 설치된 wf-claim.sh 헬퍼 사용(파일 모드 600이라 sh로 호출).

## 조사에서 확인한 것 (아이디어가 몰랐던 사실 포함)

- 앱이 여는 파일은 `~/.claude/HEARTBEAT.md`(HEARTBEAT_HOME=".claude" + HEARTBEAT_FILE). 그 관리 블록에 mech-arena 역할 잡 3개가 실재 — workflow-labs 앱에서 역할 잡 저장 시 mech-arena 잡이 사라지는 역방향 사고가 장전된 상태였다. → TL이 수신 직후 migrate 재실행으로 해체(17:50, 양 프로젝트 jobs.d 이전).
- workflow-labs 잡은 이미 jobs.d에서 실행 중(state.json last_run 17:28 success). 앱이 보는 파일과 데몬이 실행하는 정의가 서로 다른 파일.
- 앱은 이 어긋남을 감지할 수단이 없다(find_duplicate_jobs는 HEARTBEAT.md 한 파일만, src-tauri에 jobs.d 문자열 0회).
- 계약 문서(claude-heartbeat docs/config-contract.md): 파일 소유·병합 우선순위·잡 문법·state.json 계약 키·마이그레이션 고정, semver 선언.
- migrate는 앱 마커를 치우지 않고 짝 맞은 채 남기며, 대상 파일이 있으면 그 slug를 건너뜀.
- 데몬 0.8.0 미배포(pyproject 0.7.0, 브랜치 커밋 2, push 미실행) — 그러나 이 기기는 그 코드로 실행 중.
- 버전 판정 수단 없음(앱 설치 판정은 데몬 버전을 안 봄, jobs.d 존재도 근거 불가 — 계약상 쓰는 쪽이 만드는 디렉토리).

## 핵심 기획 결정

R1(자기 프로젝트 파일 하나만 쓴다)~R7(지금 되는 것 유지), 확인 사실 22항, 완료 조건 18항. 인용 줄 번호 전부 작업 트리 실측.

## 확인 필요 4건과 처리

1. 미배포 데몬 전제로 지금 전환할지 — 제안: 전환. → 승인(분해·구현 기준은 이 기기의 실행 코드·계약 문서).
2. 옛 마커 블록 정리 — 제안: 자기 slug 잡만 지우고 남의 잡 보존. → 승인.
3. 계약 미지원 데몬 — 제안: 막지 않고 알림(근거는 state.json last_run). → 승인.
4. SPEC-022와의 순서 — 제안: SPEC-022 먼저, 전환은 그 위에(022가 전환의 발판). → 승인.

## 아키텍트에게 넘기는 것

- 확인 필요 1·4의 결정 이후 착수(→ 승인됨. TASK-063~065 착지 후 분해 권장).
- SPEC-022와의 관계는 단순 대체가 아니라 발판 관계 — 옛 블록 정리에 "내 잡만 빼고 남의 잡 보존" 동작이 필요하고 그것이 SPEC-022 산출물이다.
- heartbeat_service.rs·heartbeat_jobs.rs 병행 금지 확인 필요(미커밋 v0.1.8 + SPEC-022 체인 동일 함수).
- 잡 이름 불변(실행 이력·한도 윈도우가 상태 키, 계약 39~40줄) — R1·완료 조건 14.
- `- slug:` 줄 처리는 기획서가 정하지 않음(jobs.d 안에서는 불필요, 파일 이름이 이김. 데몬 heartbeat install 산출물에는 그 줄이 있음).
- 프론트엔드 파급: HEARTBEAT.md 문자열 src/ 20곳, 경로 상수 HeartbeatCard.tsx:57·DreamCard.tsx:33.

## 역할 밖 관찰 (수정 안 함)

- SPEC-022 확인 사실 17의 경로 오류: 앱이 여는 파일은 `~/.claude/HEARTBEAT.md`다. 확인 사실 18("피해 반경 0")도 당시 사실이 아니었다. 승인 결정문이 그 근거를 직접 인용하지 않아 승인은 유효하나 아키텍트 인지 필요. → DECISION-3C8F1A42에 정정 기록됨.
- 동률 created_at 우선순위 규칙이 계약에 없음(관행은 id 사전순).
- SPEC-009.yml 만료 lease 잔존(무조치).
- 남은 미처리 아이디어 셋: IDEA-19843535, IDEA-7BCB8947, IDEA-5C6073A5.

## 세션 정리 상태

변경 파일 SPEC-024.md 하나. 보호 상태 무변경, git 커밋 없음, lease 해제 완료.
