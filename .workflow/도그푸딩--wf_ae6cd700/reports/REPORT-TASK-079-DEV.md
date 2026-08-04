# TASK-079 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(dev-079=dev-071)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T09:48Z, TL 세션)

- 대상: TASK-079 (두 아이디어 입력창을 초안 저장소에 배선하고 동작을 테스트로 고정한다)
- 근거: SPEC-025, DECISION-5B7E9F14
- 상태: `blocked` — 구현·검증(완료 조건 1~16) 완료. 막힌 것은 조건 17(npm run check) 하나로, 원인은 병행 TASK-072 세션의 heartbeatRuns 필수화 진행 중 일시 상태(공유 트리 IntegrationsView.test.tsx 타입 오류·렌더 실패). 내 범위 5파일 타입 오류 0, 내 테스트 2파일 51 passed.
- 선점: acquire → lease-56991-20260804092417 → … → blocked → release exit 0
- 해제 방법: TASK-072 착지 후 npm run check 통과 확인 → qa_waiting 전이. 이 작업 파일 재수정 불요.

## 변경한 파일 (다섯, 전부 범위)

IdeaComposer.tsx(배선 본체), IdeaInbox.tsx(한 줄 — workflow.directory 통과), WorkspaceShell.tsx(빠른 입력창에 key+workflowDirectory), IdeaInbox.test.tsx(+14), WorkspaceShell.test.tsx(+4). TASK-078 저장소·src-tauri 무변경, 보호 상태 무변경, 커밋 없음.

## 핵심 결정

1. 게으른 초기화(마운트 시 1회 읽기, 사용자 편집 시만 쓰기), 상태 끌어올림 안 함 — 두 입력창 비동시 표시라 "초안 하나" 자동 성립 + WorkspaceShell은 TASK-072 편집 중 + 기존 어법(TASK-062).
2. IdeaInbox 새 prop 안 만듦(기존 workflow에서 통과 — 렌더 자리 24곳 수정 회피, TASK-071 학습 재사용). IdeaComposer의 workflowDirectory는 필수 prop(호출부 2곳 모두 내 범위).
3. 오늘 화면에 key={workflow?.directory} — R3의 실질. 실측: key 제거 시 격리 테스트 실패, 재부착 시 통과(확인 사실 8 재현). undefined key 전환도 재마운트라 안전.
4. R5 = 초안 보이되 제출만 막힘(아키텍트 결정 그대로, disabled 테스트 고정).

## 조용히 깨지는 지점의 렌더 고정

"첫 마운트 읽은 값 되쓰기 금지"를 값 비교가 아니라 쓰기 발생 여부로 검사(writes nothing while only rendering — 렌더·언마운트·재렌더에 setItem 0회). 헛돌기 검증: 되쓰기 한 줄 주입 시 그 테스트만 실패(1/35) 후 원상 복구.

## 게이트 실측 (블록 원인)

tsc 실패 파일은 IntegrationsView.test.tsx 하나(시각별 6→1→1건으로 수렴 중 — TASK-072 실시간 수정), vitest 실패도 같은 파일 하나(134건, HeartbeatCard 렌더 실패). 내 범위 파일 오류 0건(grep 대조). 내 테스트만: IdeaInbox 22→36, WorkspaceShell 11→15 = 51 passed.

blocked 사유: build가 tsc 게이트라 지금 qa_waiting이면 사용자가 앱을 못 띄운 채 QA하게 되고 조건 17 거짓 충족이 됨.

## 사용자 QA 제안 (게이트 해제 후)

(1) 오늘 화면에서 쓰다 메뉴 왕복 → 글 유지, (2) 아이디어 화면 입력창에도 같은 글(초안 공유), (3) 워크플로 전환 시 비고 복귀 시 돌아옴 — 양쪽 화면 모두, (4) 제출 후 비움 유지, (5) 직접 비우면 비움 유지, (6) 앱 재시작 후 유지, (7) 공백만으론 추가 버튼 불가.

## 리스크와 후속

- 타이핑마다 getItem+parse+setItem — 체감 문제 시 디바운스는 배선 쪽(TASK-078 인계 준수). 현재 미확인이라 미적용.
- WorkspaceShell을 TASK-072와 동시 편집 — 앵커 좁혀 외과 수정, 양쪽 자리 공존 확인, 상호 덮어쓰기 없음.
- 이중 clone 시 초안 이어짐(R3 취지 부합, TASK-078 보고서 기재).
- 범위 밖 관찰: IdeaComposer 전용 테스트 파일 부재 — 세 번째 호출부가 생기면 컴포넌트 단위 테스트 분리 권장.

## 부록 — blocked 해제 완료 (09:39Z~09:40Z, 2차 세션)

TASK-072 착지 확인(TL 신호) 후 재선점(lease-93578-20260804093932) → 게이트 통과 → qa_waiting 전이 → release exit 0. history는 append-only 5줄(created/in_progress/blocked/in_progress/qa_waiting).

게이트: npm run check 전 구간 통과 — tsc 0, vitest 17 files / 424 passed / 0 실패 / 0 스킵, build 성공. blocked 시점 원인 파일(IntegrationsView.test.tsx 134건 실패)이 정확히 그 차이였음을 재확인. 코드는 blocked 이후 무변경(재선점·게이트·전이만).

병행 편집 사후 확인: TASK-072와 공유한 WorkspaceShell.tsx 포함 세 자리(:329 key+workflowDirectory, IdeaInbox.tsx:114, IdeaComposer.tsx:16·:24) 전부 온전 — 상호 덮어쓰기 없음.

완료 조건 17/17 충족. SPEC-025는 TASK-078·079 둘 다 qa_waiting — 사용자 QA만 남음.
