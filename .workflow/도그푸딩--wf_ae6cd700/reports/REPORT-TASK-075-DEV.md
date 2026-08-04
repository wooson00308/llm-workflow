# TASK-075 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(dev-075=dev-063)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T09:34Z, TL 세션)

- 대상 작업: TASK-075 (저장소 사본 scripts/wf-eligible.sh 제거 + 문서가 설치본 경로 안내)
- 근거 문서: SPEC-023 R5, DECISION-9E5D2C71
- 상태: `qa_waiting` (lease-31291-20260804090940, acquire→renew→release 전부 exit 0, 경합 없음)

## TASK-076 인계 (중요)

CONDITION_SCRIPT_SH 본문의 `# 사용법: sh scripts/wf-eligible.sh ...` 줄(heartbeat_condition.rs:30)과 :24 독 주석("그 아래는 scripts/wf-eligible.sh와 같다")이 삭제된 경로를 가리킴 — 설치본 :5에도 동일. 제품 코드 구간이라 이 작업 범위 밖(버전 불변 명시). TASK-076이 본문에 사유 출력을 넣으며 버전 4→5 올릴 때 함께 고치면 비용 0. → TL이 TASK-076 배정에 반영.

## 변경한 파일 (셋 + 작업 문서)

1. scripts/wf-eligible.sh — 삭제 (git rm -f, 인덱스 D 스테이징). scripts/ 디렉터리는 잔존 파일 2개로 유지.
2. docs/heartbeat.md — 옛 경로 6곳을 설치본 경로로 교체 + "이 파일은 저장소에 없다" 문단 + Windows는 .ps1 안내 한 문장.
3. heartbeat_condition.rs — mod tests의 the_repository_copy_matches_the_managed_script 제거(독 주석 포함 25줄 순수 삭제).

제품 코드 구간(:1~:495) 무변경(복원본 대조: 차이는 테스트 모듈 한 hunk뿐, 추가 줄 0), CONDITION_SCRIPT_VERSION 4 유지, 설치본 무변경, 보호 상태 무변경, git 커밋 없음.

## 핵심 결정

1. git rm -f 사용 전 증거 확보: 삭제 직전 사본 일치 테스트 단독 실행 통과(1 passed) → 미커밋 121줄(선행 선언 판정)이 앱 내장 본문에 동일 존재 → 삭제로 잃는 고유 내용 0 확인.
2. 대체 검사 미작성(완료 조건 5): 그 테스트가 막던 것은 "사본이 내장 본문과 갈라지는 것"인데 사본이 사라져 대상 자체가 없음. 곁다리 보장 둘은 기존 테스트가 각각 보유 — 설치본==내장 본문(installs_condition_script_with_managed_markers의 직접 단언), 앱 판정==스크립트 판정(role_eligibility의 assert_matches_condition_script 36곳, 35 테스트 통과). 줄어든 것은 "관리 안 되는 네 번째 사본"이지 보장이 아님.
3. Windows 한 문장 추가: 설치본 경로 안내로 바꾸는 순간 Windows는 .ps1이라(컴파일 분기 확인) 미기재 시 없는 파일을 찾게 됨. "다음 설치가 덮어쓴다" 초안은 사실 오류(관리 표기 없는 파일은 거부)라 삭제.

## 게이트 수치

cargo test 369/0/0, npm run check 16 files 374 passed + build, role_eligibility 35/0, fmt 통과. 내 변경만의 델타는 테스트 1 감소(사본 대조 테스트), 나머지 증가는 병행 착지분.

## 판정 전후 대조 (완료 조건 7)

planner 1→1, architect 0→1, developer 0→0. architect 반전은 내 변경이 아니라 두 실행 사이 다른 세션의 워크플로 문서 변화(SPEC-024 lease·TASK-078/079 생성) — 판정 규칙 불변의 근거는 결과 대조가 아니라 (1) 설치본 무변경(mtime 실측), (2) 내 변경 파일을 스크립트가 읽지 않음, (3) 고정 픽스처 대조 36곳 통과.

## 후속 / 리스크

- (재게시) CONDITION_SCRIPT_SH 사용법 줄 죽은 경로 — TASK-076 몫.
- docs/heartbeat.md "현재 한계" 두 항목이 낡음(:101 만료 lease — v0.1.8 lease_blocks가 expires_at 판정, :102 planner 재작업 감지 — 테스트 실존): 범위 밖 인계, 언젠가 계약 기준점 문서 갱신 필요.
- 삭제가 스테이징 상태(커밋은 사용자 몫). 복원 시 HEAD 버전(121줄 없는 옛 본문)이 돌아오는 점 유의.
- 테스트 픽스처의 옛 경로 문자열 8곳은 의도적 유지(옛 수기 잡 흉내 픽스처 — 그 문자열이어야 시험의 뜻이 삶).
