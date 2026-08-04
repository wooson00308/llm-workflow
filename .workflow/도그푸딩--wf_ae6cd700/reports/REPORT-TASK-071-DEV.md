# TASK-071 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(dev-071)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T09:13Z, TL 세션)

- 대상: TASK-071 (잡 실행 계약과 진행·실패 상태를 워크스페이스 훅에 만든다)
- 근거: SPEC-020, DECISION-53577F93 (outcome: approved, created_by: user)
- 상태: `qa_waiting` / 선점: wf-claim.sh acquire → lease-1132-20260804085417 → … → release exit 0

## 변경한 파일 (다섯, 전부 범위 내)

- domain/types.ts — HeartbeatRunFailure·HeartbeatRunControls 신설, IntegrationsState.heartbeatRuns 추가, ProjectGateway.runHeartbeatJob 추가
- infrastructure/tauriProjectGateway.ts — invoke 한 건(4줄)
- application/useProjectWorkspace.ts — 실행 상태·ref 가드·run 액션·병합 memo
- application/useProjectWorkspace.test.ts — 기본 구현 한 줄 + 신규 테스트 11개
- components/WorkspaceShell.test.tsx — IntegrationsState 리터럴(:37) 한 줄

IntegrationActions·화면 컴포넌트·App.tsx·src-tauri/ 무변경, 보호 상태 무변경, git 커밋 없음.

## 와이어 계약 대조

작업 문서를 원천으로 구현, 작업 트리의 TASK-070 산출물과 글자 단위 일치 확인 (commands/heartbeat.rs:82 run_heartbeat_job(path, job_name), RunJobFailure camelCase {jobName, message, command}, 성공은 값 없음).

## 핵심 결정

1. heartbeatRuns를 선택 필드로 (작업 문서와의 유일한 차이, 아키텍트 판단 요망): 필수 선언 시 typecheck 오류 19건 중 18건이 범위 밖 IntegrationsView.test.tsx의 IntegrationsState 리터럴. 훅은 언제나 채워 내보내고, 타입 주석에 "리터럴들이 갖추면 필수로 좁힌다" 명시. 비용: TASK-072가 좁히기 한 번. → TL 반영: TASK-072 배정 시 이 사실 전달 예정.
2. 겹쳐 실행 가드는 useRef (같은 tick 이중 클릭 시 state 클로저 낡음 문제 — "훅 단의 마지막 방어선"이라 렌더 타이밍 비의존 판정).
3. 실패 값 조립: isRunFailure가 3필드+command 비어있지 않음 검증, 통과 못 하는 거절은 messageFrom + 대비책 명령 `heartbeat once -j <jobName>`(원천은 백엔드 manual_command, 대비책임을 주석 명시).
4. 상태 분리: 조회·쓰기 상태(Omit)와 실행 상태를 별도 useState, 반환 직전 useMemo 병합 — writeIntegration의 통째 교체가 진행 중 표시를 지우는 것 방지. closeProject는 실행 상태 불변(R3).

## 게이트 수치

npm run check 통과: tsc 오류 0, vitest 16 files / 374 passed / 실패 0 / 스킵 0 (6.27s, 기준선 363 → +11 전부 신규), build 성공.

git diff 검증 문구 2건은 작업 트리의 타 세션 미커밋분 때문에 문구 그대로 성립 불가 — 이 세션 기여분으로 대체 확인 (components/integrations 무변경, WorkspaceShell.test.tsx :37 한 줄만).

## 사용자 QA 제안

화면 배선 전이라 눈에 보이는 변화 없음 — 회귀 부재 확인: (1) 연동 화면 정상, (2) 잡 설정 저장 동작 동일, (3) 메뉴 왕복·프로젝트 전환 정상, (4) 2.5초 조회 지속 + 자동 실행 없음(R7 육안 확인).

## 리스크와 후속

- 선택 필드가 유일한 계약상 미완 — TASK-072가 좁히거나 리터럴 정리 후 필수화(한 줄).
- 대비책 명령이 프론트에 한 번 더 적힘 — CLI 규약 변경 시 대비책만 낡음.
- 실행 상태는 메모리 전용(범위 밖 명시) — 재시작 시 진행 중 표시 소멸.
- closeProject가 실행 상태를 안 비워 프로젝트 전환 후 이전 잡 이름이 running에 잔존 — TASK-072가 이름 대조로 그리는 전제(R3).
- 범위 밖 관찰: 훅 테스트의 recentStore는 렌더 콜백 밖에서 생성해야 함(안이면 조회 effect 무한 재실행·힙 폭발 — 이 세션이 실제 겪고 신규 테스트에서 회피, 기존 테스트는 원래 정상).
