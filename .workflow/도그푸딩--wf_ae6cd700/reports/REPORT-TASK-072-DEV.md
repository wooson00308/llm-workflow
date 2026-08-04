# TASK-072 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(dev-072)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T09:58Z, TL 세션)

- 대상: TASK-072 (하트비트 카드의 역할마다 지금 실행 액션과 확인 단계를 만든다, SPEC-020)
- 상태: `qa_waiting` (lease-56475-20260804092311, release exit 0). 의존 062·065·071 충족 확인.

## 변경한 파일 (일곱, 전부 범위)

WorkspaceShell.tsx(배선+좁히기 1곳), IntegrationsView.tsx(Props 필수 추가·전달), IntegrationCard.tsx(Props 필수 추가), HeartbeatCard.tsx(역할별 실행 액션·확인 화면·진행 중 표시), App.css(2줄), IntegrationsView.test.tsx(runControls 헬퍼+신규 describe 18개), DreamCard.test.tsx(헬퍼 2줄). App.tsx·마법사·jobNameOf·types.ts·src-tauri 무변경.

## 핵심 결정

1. View/Card Props는 필수(배선 누락 시 컴파일이 잡음), IntegrationsState는 선택 유지 — types.ts가 범위 밖이고 리터럴 18곳 정리는 "요구사항을 넓히지 않는다" 위반. 좁히기는 WorkspaceShell 렌더 조건 한 곳(값 누락 시 화면 전체가 비어 즉시 드러나는 실패 모드 선택). **계약 부채: IntegrationsState.heartbeatRuns 필수화는 여전히 어느 작업의 것도 아님 — 아키텍트 판단 필요.**
2. 실행 대상은 스냅샷의 status.jobName (jobNameOf는 차이 표시용 — 갈라진 스냅샷 테스트로 고정).
3. 진행 중 상태는 카드가 안 듦 — heartbeatRuns.running 이름 대조만(R3), 언마운트·재렌더 유지 테스트.
4. 확인 화면은 저장·재설정과 같은 요소 재사용 + 셋 상호 배타, 폼 편집이 실행 확인을 닫음. 첫 줄 "어떤 파일도 쓰지 않습니다"로 쓰기 화면과 구분(R1).
5. 판정에 안 쓴 것: 폼 상태·daemonRunning·supported (앞 둘은 완료 조건, supported는 요구 없음 — 조건 불추가).

## 게이트 수치

npm run check 통과: tsc 0, vitest 17 files / 424 passed / 0 실패 / 0 스킵, build 성공(321 modules). 신규 18개(해당 파일 단독 161). 기존 무삭제·무비활성·무수정.

검증 문구 대체(TL 지시): "git diff 두 곳뿐"은 다중 세션 트리에서 불성립(582줄) — 파일·심볼 단위 갈음: DreamCard.test.tsx 기여분 heartbeatRuns 2줄뿐, 마법사에 실행 관련 심볼 0(R9), jobNameOf 정의+8호출부 실행 경로 밖 그대로.

## 완료 조건 17개 전부 대조 (각 조건별 테스트 이름은 발신 전문 참조)

## 사용자 QA 제안

TASK-070 백엔드가 트리에 있어 실제 실행 가능: (1) 역할별 "잡 지금 실행" 버튼, (2) 확인 화면 네 가지 사실, (3) 실행 중 그 역할만 비활성·다른 역할 가능, (4) 메뉴 왕복에도 진행 표시 유지, (5) 종료 시 복귀, (6) 미설치 역할은 설치 안내, (7) 회귀: 저장·재설정 확인 화면과 상호 배타.

## 리스크와 후속

- 실패·완료 안내 부재 — heartbeatRuns.failure를 카드가 아직 안 읽음(TASK-073 몫). QA에서 "진행 표시가 사라짐"을 결함으로 읽지 않도록 주의.
- IntegrationsState 선택 잔존(계약 부채, 아키텍트 판단).
- closeProject 실행 상태 잔존은 slug 상이로 무해 확인(TASK-071 전제 성립).
- 실행 상태 메모리 전용 — 재시작 시 표시 소멸(세션은 계속 돌 수 있음).
- 범위 밖: 데몬과 겹칠 수 있다는 고지(R7 문장 방향 모순 — 기획자 판단 대상), WorkspaceShell 동시 편집은 정확 치환으로 무충돌.
