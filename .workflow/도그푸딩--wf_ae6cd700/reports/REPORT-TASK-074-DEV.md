# TASK-074 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(dev-074)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T09:10Z, TL 세션)

- 대상 작업: TASK-074 (개발 보드 카드가 컬럼 경계를 넘지 않게 하고 선언을 회귀 검사로 고정한다)
- 근거 문서: SPEC-021 R1~R6, DECISION-C9B1C1D5 (outcome: approved, created_by: user)
- 세션 역할: 개발자 (dev-074)
- 상태: `qa_waiting`, lease release exit 0
- 선점: wf-claim.sh acquire → lease-1176-20260804085419 → in_progress → 구현 → 검증 → qa_waiting → release exit 0

## 변경한 파일 (셋, 전부 작업 문서 범위)

- `src/App.css` — 다섯 줄: .task-column(:410), .task-stack(:420), .task-card(:421), .task-card > strong(:425), .task-card > p(:426). 구간 밖 무변경.
- `src/features/projects/components/boardCardOverflow.test.ts` — 신설, 회귀 검사 7개.
- `src/features/projects/components/DevelopmentBoard.test.tsx` — 재현 상수 둘 + 시나리오 하나 추가. 기존 테스트 무수정.

DevelopmentBoard.tsx 마크업 무변경(R4), src-tauri/ 무변경, 보호 상태 무변경, git 커밋 없음.

## CSS 변경 — 세 겹 처방 (확인 사실 1~3을 하나씩 끊음)

```
.task-column { min-width: 0; ... }
.task-stack  { display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; }
.task-card   { width: 100%; min-width: 0; ... }
.task-card > strong { ...; overflow-wrap: anywhere; }
.task-card > p      { ...; overflow-wrap: anywhere; (클램프 유지) }
```

1. 명시 트랙 minmax(0,1fr) — 암시적 auto 트랙의 min-content 바닥을 끊음 (.idea-list 선례).
2. min-width: 0 — 그리드 아이템 auto 최소 크기 해석 차단 (.search-result-copy 선례).
3. overflow-wrap: anywhere — break-word 계열은 min-content 내재 크기 계산에 반영되지 않고 anywhere만 반영됨. R2("긴 토큰이 카드 최소 폭을 정하지 않는다")를 직접 만족. 한글 줄바꿈 품질 불변(음절 분리는 원래 가능). 세 겹 중 한 겹이 빠져도 버티는 구성.

## 회귀 검사 (boardCardOverflow.test.ts)

App.css를 `?raw`로 읽어 규칙 단위 파싱 검사 (node:fs는 @types/node 부재로 typecheck가 깨져 vite/client의 ?raw 타입 사용). 같은 선택자 중복 규칙은 실패 처리(뒤에서 덮이는 재발 경로 차단). 지키는 선언 4건 + 깨지면 안 되는 선언 3건(클램프 4종/완료 조건 6, 보드 min-width·overflow-x/조건 10, keep-all 두 자리/조건 8) 동시 검사.

- 보장: 지정 규칙 안에 지정 선언이 있다는 것까지. 보장 못 함: 실제 레이아웃(jsdom은 계산 안 함) — 파일 머리 주석에 명시(조건 12). 화면 판정은 사용자 QA.
- 헛돌지 않음 검증: 선언 2건을 일부러 지우고 2건 실패 확인 후 원상 복구(git diff -U0로 다섯 줄만 남은 것 확인).

## 재현 데이터 (R6, 조건 11)

실측 33자 무공백 런 `` (`HeartbeatCard.tsx:246`~`:252`). `` 을 그대로 사용. DevelopmentBoard.test.tsx 새 시나리오가 이 런이 카드 <p>까지 도달하는 것을, 회귀 검사가 33자·무공백을 고정. 두 파일에 리터럴 중복(테스트 파일 상호 import 시 describe 이중 등록 회피, 주석이 상호 참조).

## 게이트 수치

npm run check 통과: tsc 오류 0, vitest 16 files / 363 passed / 실패 0 / 스킵 0 (7.01s), build 성공(320 modules). 기준선 15파일 355 → +1파일 +8테스트.

완료 조건 14개 전부 대조 완료 (전문 원문 참조). 조건 9는 주의: 이 세션은 src-tauri/ 무변경이나 작업 트리에 기존 미커밋분이 있어 "git diff 비어 있음" 문구는 성립 불가 — markdown_excerpt 함수 정의가 그 diff에 미포함임을 grep으로 확인.

## 사용자 QA 제안

재현 데이터가 실제 TASK-049 카드(qa_waiting)에 있으므로 데이터 준비 불요.
1. 기본 폭에서 QA 대기 컬럼 — TASK-049 카드가 컬럼 안에 있고 옆 컬럼에 안 얹히는지, 같은 컬럼 카드들이 나란한지(전염 종료).
2. 창을 950px 아래로 좁혀(트랙 최소 상태 = R1 기준 상태) 같은 확인.
3. 상태 필터 qa_waiting 단일 컬럼 상태에서 같은 확인.
4. 리스트·타임라인 뷰 왕복 — 무변경이어야 함.

잘라내기 판정 기준(조건 5): 글자가 모서리에 딱 붙어 끊김 / 요약문 말줄임표 / 요약문 한 줄 / 제목 뒷부분 소실 — 하나라도 보이면 잘못. 정상은 "상자는 안 넘치고 글자는 줄 안에서 접힘"(긴 토큰이 중간에서 끊겨 다음 줄로 넘어가려다 두 줄 클램프에 걸림).

## 리스크와 후속

- 검사는 레이아웃을 재지 않음 — 다른 규칙이 나중에 width나 white-space: nowrap을 걸면 통과하면서 다시 넘칠 수 있음(확인 필요 2 승인 범위).
- 검사가 선택자 문자열에 묶임 — 선택자 리팩터링 시 검사도 같이 수정 필요(조용한 통과보다 나은 의도된 실패).
- @media에서 정당하게 덮는 경우도 실패 — 사람이 확인 후 검사를 고치는 순서 의도.
- .task-board 트랙은 그대로(조건 10) — 좁은 창에서 178px 정지는 불변, 카드가 그 안에 들어가는 것으로 R1 충족.
- 병행 안전: TASK-072·073의 App.css 범위와 구간 안 겹침(아키텍트 판단대로).
- 범위 밖 관찰: 리스트 뷰 요약문(:442)은 nowrap+말줄임으로 보드와 어법이 다름 — "보드에만" 승인이라 유지, 통일 여부는 별도 판단거리.
