---
schema: workflow-labs/task@1
id: TASK-116
title: 연동 카드가 업데이트를 한 번의 조작으로 끝낸다
status: completed
source_spec_id: SPEC-037
source_decision_id: DECISION-6C2F2639
depends_on: [TASK-113]
scope_files: [src/features/projects/components/integrations/HeartbeatCard.tsx, src/features/projects/components/integrations/HeartbeatUpdateGuide.tsx, src/features/projects/components/integrations/IntegrationsView.tsx, src/features/projects/components/integrations/IntegrationsView.test.tsx, src/features/projects/components/WorkspaceShell.tsx, src/features/projects/components/WorkspaceShell.test.tsx, src/features/projects/application/useProjectWorkspace.ts, src/features/projects/application/useProjectWorkspace.test.ts, src/features/projects/domain/types.ts, src/features/projects/infrastructure/tauriProjectGateway.ts, src/App.css]
updated_at: 2026-08-05T09:08:41.750137+00:00
history:
  - { at: 2026-08-05T03:25:00Z, kind: created }
  - { at: 2026-08-05T07:31:00Z, kind: in_progress }
  - { at: 2026-08-05T07:57:00Z, kind: qa_waiting }
  - { at: 2026-08-05T09:08:41.750137+00:00, kind: completed }
---

# 연동 카드가 업데이트를 한 번의 조작으로 끝낸다

SPEC-037의 화면 쪽 본체다. R1·R3·R4·R5·R6과 확인 필요 3·6번의 승인안, 완료 조건 1~4를 닫는다.
설치 실행 버튼과 버전 표시는 TASK-117이 받는다.

TASK-113이 만든 커맨드를 화면까지 잇는다. 배선은 이 저장소가 이미 쓰는 통로 그대로다 —
`tauriProjectGateway.ts`에 호출을 더하고, `useProjectWorkspace.ts`가 진행·결과 상태를 들고,
`IntegrationsView`가 값을 그대로 카드에 넘긴다. `heartbeatRuns`(지금 실행)가 같은 모양의 선례다.

## 자리

업데이트는 역할별 조작이 아니라 설치 전체의 일이다. 그래서 역할 잡 폼 안이 아니라 **하트비트 카드의
공통 자리**(설치 마법사 아래, 역할 잡 목록 위)에 선다. dream 카드에는 이 통로를 만들지 않는다.

## R3 — 실행 전에 알리고 사용자가 고른다

버튼은 누르는 즉시 실행하지 않는다. 확인 화면을 먼저 연다. "지금 실행" 확인 화면과 같은 자리·같은
모양을 쓰되, 첫 줄에서 서로 갈라 준다 — 그쪽은 "어떤 파일도 쓰지 않습니다"로 시작하고, 이쪽은 데몬이
저장소를 갱신하고 의존성을 다시 깔고 자신을 재기동한다.

확인 화면에 실리는 것:

1. 무엇이 바뀌는지 세 줄 — 저장소 갱신, 의존성 재설치, 데몬 재기동.
2. **지금 끊기는 세션.** 활성 lease의 개수와 목록(에이전트 이름·대상 문서)이 확인 전에 보인다.
   08-05에 TASK-104가 고아가 된 사고가 이 고지의 값이다.
3. 되돌릴 수 없다는 것.

세션 목록의 원천은 `project.activeLeases`다. 활동 뷰가 이미 쓰는 값이고(확인 사실 14) 앱이 새로
계산하지 않는다. 카드까지 내리는 배선이 이 작업의 일이다: `WorkspaceShell`이 `IntegrationsView`에
넘기고, 뷰는 값을 보지 않고 카드에 그대로 넘긴다(`pendingWork`가 같은 어법의 선례다).

**세션이 없을 때와 있을 때의 문구가 다르다.** 0개면 "지금 끊길 세션이 없습니다"이고, 하나 이상이면
개수와 목록이 선다. 기획서가 그 무게 차이를 한계로 적었으므로 문구로 갈리는 데까지가 이 작업이다.

앱은 세션을 정리하지 않는다. 드레이닝을 기다리지도, lease를 지우지도 않는다 — 남의 lease에 손대는
것은 `.workflow/rules/workflow.md` §4가 금한다. 고지하고 사용자가 고르는 것이 승인안이다.

## R1 — 겹쳐 누를 수 없고 실행 중임이 보인다

확인 버튼을 누르면 확인 화면이 닫히고 버튼이 비활성이 된다. 진행 표시가 뜬다 — 저장소 갱신과 의존성
설치가 걸리는 조작이라 표시가 없으면 사용자는 눌리지 않았다고 판단하고 다시 누른다. "지금 실행"의
`runningNow` 표시가 같은 이유로 있는 선례다.

## R4 — 실패가 어디까지 갔는지 읽힌다

결과는 "성공/실패" 두 마디가 아니다.

- **단계 줄**을 데몬이 낸 순서대로 그린다. 저장소·의존성·재기동 각각의 `ok`·`failed`·`skipped`와
  `detail`이 보인다. 앱이 내지 않은 단계를 만들어 넣지 않는다.
- **`partial`을 셋째 상태로 그린다.** 성공으로도 실패로도 읽히지 않아야 한다. 그 상태의 뜻은 "코드는
  갱신됐는데 도는 프로세스는 갱신 전 코드일 수 있다"이고, 그것이 08-05 사고의 모양이다.
- **원인별로 다음 행동이 다르다.** 사용자가 저장소에서 할 일이 있는 코드(미커밋 변경·fast-forward
  불가·upstream 없음), 네트워크(fetch 실패), 의존성, 재기동 실패, 서비스 밖에서 손수 띄운 데몬 —
  각각 다른 문장이다. 하나의 문구로 뭉뚱그리지 않는다.
- 종료 코드 10(git 저장소가 아님)은 wheel 설치라는 뜻이므로 pip 갱신 쪽 안내로 잇는다.
- **인용 절에 없는 종료 코드는 지어내지 않는다.** 숫자와 함께 "앱이 아는 코드가 아니다"라고 말한다.
- **stderr 원문을 버리지 않는다.** 접힌 자리(`<details>`)에 원문 그대로 둔다. 요약하지 않는다.
- 계약 밖 출력으로 끝난 경우(옛 설치본이라 `update`가 없는 경우 등)는 성공으로도 실패로도 부르지 않고
  "이 설치본이 계약대로 답하지 않았다"로 말한다. 조용히 아무 일도 없던 것처럼 끝나지 않는다(R7).

## R5·R6 — 못 찾았을 때와 안내의 자리

실행 수단을 찾지 못한 것은 예외가 아니라 이 기기의 현재 상태다(확인 사실 11).

- 그 사실과 **본 후보 경로**, 사용자가 그대로 칠 수 있는 명령 원문(`heartbeat update`)과 복사 버튼이
  나온다. "지금 실행" 실패 표시가 같은 모양을 이미 쓴다.
- 앱이 찾은 척하는 경로를 지어내지 않는다.

확인 필요 6번의 승인안이 안내의 자리를 정한다.

- 하트비트 카드의 084 경고 안에서 **업데이트 버튼이 주 통로**이고 `HeartbeatUpdateGuide`는 접힌
  자리로 내려간다.
- 실행이 "실행 수단 없음"으로 끝난 뒤에는 안내가 펼쳐진 주 통로가 된다.
- **앱은 사전 탐색으로 실행 가능 여부를 판정하지 않는다.** 조회 주기에 프로세스를 띄우지 않는다는
  이 저장소의 선을 지키기 위해서다. 그래서 접힘·펼침을 가르는 것은 "직전 실행이 무엇으로 끝났는가"
  하나다.
- **dream 카드는 그대로다.** 그쪽에는 업데이트 버튼이 없으므로 안내가 계속 주 통로다.
  `HeartbeatUpdateGuide`의 문구와 다섯 값은 바꾸지 않는다 — SPEC-034 R7이 "같은 것을 같은 문구로"를
  세웠다. 접는 것은 하트비트 카드 쪽의 감싸기이지 컴포넌트의 문구 변경이 아니다.

## 완료 조건

1. 하트비트 카드의 버튼 하나로 업데이트가 실행되고, 성공 경로에서 사용자가 터미널을 열지 않는다.
   (기획서 완료 조건 1)
2. 버튼을 누르면 확인 화면이 먼저 열리고, 거기에 무엇이 바뀌는지 세 줄과 지금 끊기는 세션이 실린다.
   세션이 0개일 때와 하나 이상일 때 문구가 다르다. (완료 조건 2)
3. 확인 화면에서 취소하면 아무것도 실행되지 않는다. 확인을 누르면 화면이 닫히고 같은 조작이 두 번
   실행되지 않는다.
4. 실행 중에는 버튼이 눌리지 않고 진행 표시가 보인다.
5. 결과가 단계와 원인으로 구분되어 남고, `partial`이 성공으로도 실패로도 읽히지 않는다.
   (완료 조건 3)
6. 종료 코드별로 다음 행동이 다른 문장이 나온다. 인용 절에 없는 코드는 숫자 그대로 나오고 앱이 뜻을
   지어내지 않는다.
7. stderr 원문이 화면에 남는다.
8. 실행 수단을 찾지 못하면 그 사실과 본 후보, 명령 원문이 나오고 복사할 수 있으며, 그 상태에서
   SPEC-034의 안내가 펼쳐진 주 통로가 된다. (완료 조건 4)
9. 실행 가능한 상태에서는 안내가 접힌 자리에 있고 버튼이 주 통로다.
10. dream 카드의 안내 표시가 변경 전과 같다. `DreamCard.test.tsx`가 기대값 수정 없이 통과한다.
11. 업데이트 실행이 실패해도 카드의 다른 동작(저장·재설정·지금 실행)이 막히지 않는다. (R9)
12. 기존 자동 검사가 삭제되거나 비활성화되지 않고, `npm run check`가 통과한다.

## 검증 절차

1. `npm run check`.
2. 화면 검사는 `IntegrationsView.test.tsx`에 세운다. 결과 픽스처는 TASK-113이 낸 결과 타입으로
   만들고, 최소 다섯을 세운다 — 성공, 단계 실패, `partial`, 계약 밖 출력, 실행 수단 없음.
3. 확인 화면의 세션 고지는 활성 lease가 0개인 경우와 둘 이상인 경우를 각각 세운다.
4. `WorkspaceShell.test.tsx`에서 `activeLeases`가 카드까지 닿는지 확인한다.
5. 앱을 띄워 실제로 눌러 보고, 이 기기에서 무엇으로 끝났는지를 보고서에 적는다. 확인 사실 11대로
   실행 수단 없음으로 끝날 가능성이 높으므로 그때 안내가 주 통로로 바뀌는지 함께 확인한다.

## 범위 파일

- `HeartbeatCard.tsx` — 버튼·확인 화면·진행·결과·실패 표시, 안내의 접힘.
- `HeartbeatUpdateGuide.tsx` — 접힌 자리에 들어갈 수 있게 하는 자리. 문구와 다섯 값은 바꾸지 않는다.
- `IntegrationsView.tsx` — 활성 lease와 업데이트 통로를 카드에 그대로 넘긴다.
- `IntegrationsView.test.tsx` — 화면 검사.
- `WorkspaceShell.tsx`·`WorkspaceShell.test.tsx` — `activeLeases`를 뷰에 넘기는 배선.
- `useProjectWorkspace.ts`·`useProjectWorkspace.test.ts` — 진행·결과 상태와 실행 통로.
- `types.ts` — 결과 타입과 카드 props.
- `tauriProjectGateway.ts` — 커맨드 호출.
- `App.css` — 새 자리의 스타일.

`DreamCard.tsx`는 만지지 않는다. `src-tauri/`도 이 작업의 범위 밖이다.

## 선행

- `TASK-113` — 이 화면이 부르는 커맨드와 결과 타입을 만드는 작업.
