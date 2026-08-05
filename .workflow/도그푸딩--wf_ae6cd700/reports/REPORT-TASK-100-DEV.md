# TASK-100 개발자 핸드오프

- 대상: TASK-100 (레인 헤더에 일괄 QA 확인 화면을 붙이고 건별 결과를 보인다)
- 근거: SPEC-031 R1·R2·R4·R5·R6·R8, 완료 조건 1·2·3·5·6·8·10·11·12,
  DECISION-1FAA8251 (`outcome: approved`, `created_by: user`, `spec_id: SPEC-031` — 직접 확인.
  SPEC-031의 결정 문서는 이 1건뿐이라 더 늦은 결정이 없다)
- 역할: 개발자 (claude-developer)
- 선점: acquire exit 0 → `lease-79876-20260804172705` → `in_progress`(17:27:09Z) → 구현 → 검증 →
  `qa_waiting`. 중간에 renew exit 0 1회.

## 선행 확인

`depends_on: [TASK-095, TASK-096, TASK-099]`.

- TASK-095: `completed`
- TASK-096: `completed`
- TASK-099: `qa_waiting`

셋 다 충족이다. `sh .workflow/rules/wf-eligible.sh developer`가 exit 0(`eligible`)이었고, `todo` 작업
9건 중 선행이 충족된 것은 TASK-100·102·104·105·107 다섯이었다. 그중 가장 앞선 TASK-100 하나만 처리했다.
착수 시점 `.workflow/.runtime/leases/`에는 만료된 `SPEC-009.yml` 하나뿐이었고 TASK-100을 덮는 리스는
없었다.

### 파일 겹침 재확인 (작업 문서가 착수 시 다시 확인하라고 지목한 자리)

`DevelopmentBoard.tsx`·`App.css`를 범위에 둔 다른 미완료 작업은 TASK-103(`todo`,
`depends_on: [TASK-100, TASK-101]`)과 TASK-108(`todo`, `depends_on: [TASK-107]`, `App.css`만)이다.
둘 다 선행이 충족되지 않아 지금 착수할 수 없는 작업이라 병행이 성립하지 않는다. 작업 문서가 경고한
상황(사용자 QA가 TASK-095·TASK-096을 `todo`로 되돌리는 경우)은 일어나지 않았다 — 둘 다 `completed`다.

## 한 것

### `DevelopmentBoard.tsx`

- `SpecLane`에 `qaWaiting: WorkflowItemSummary[]`를 더하고 **`buildSpecLanes`의 `allTasks` 순회에서**
  채웠다. `visibleTasks` 순회가 아니다 — 그쪽에서 채우면 필터에 가려진 건이 빠져 액션 문구의 건수와
  목록의 건수가 어긋나고, 그것이 승인된 확인 필요 3번을 정면으로 어기는 자리다. 순서는 `allTasks`가
  오는 순서 그대로다.
- `laneSignal`·`counts`·`hiddenLaneCount`·완료 절단은 한 글자도 건드리지 않았다.
- 신호가 켜진 레인의 헤더에 `이 그룹 {N}건 QA 확인` 버튼 하나를 접기 버튼 옆에 뒀다. 조건은
  `lane.signal` 하나이고, 같은 규칙을 두 벌 만들지 않았다. 접힌 레인에도 헤더가 남으므로 액션도 남는다.
- 확인 화면을 같은 파일 안의 `LaneQaDialog` 컴포넌트로 만들었다. 마크업 어법은
  `ProjectSearchDialog.tsx`를 따랐다(오버레이 `div`, `role="dialog"`, `aria-modal`, `aria-labelledby`).
  그 컴포넌트를 재사용하지는 않았다.
  - 대상 목록: `lane.qaWaiting`을 `id`·`title`로 보이고 항목마다 체크박스. 처음에는 전부 선택이고,
    해제한 파일 이름을 `Set`으로 든다. 0건이면 실행 버튼이 비활성이다.
  - 필터가 걸렸을 때만 `필터와 무관하게 이 레인의 QA 대기 전체를 셉니다` 한 줄을 덧붙인다.
  - 공통 코멘트 `textarea` 하나, `maxLength={2_000}`. 비어도 실행된다.
  - `useArmedConfirm` 2단계 무장. 무장 문구가 건수와 되돌릴 수 없다는 것을 함께 말한다. 목록 선택이나
    코멘트가 바뀌면 `disarm()`한다.
  - 실행 중에는 실행 버튼·체크박스·닫기가 비활성이고, `busy` 프롭과 컴포넌트 안의 실행 상태를 함께 본다.
  - 결과는 확인 화면 안에 남는다. 전부 성공해도 `N건을 기록했습니다.`를 말하고, 실패가 있으면 작업
    id(없으면 파일 이름)와 사유를 건별로 나열한다. 훅이 `null`을 돌려준 경우도 이 화면 안에서 말한다.
  - 닫기는 사용자가 누른다. 실행 뒤 자동으로 닫지 않는다.
- 콜백은 **한 번만** 부른다. 선택된 파일 이름 배열과 공통 코멘트를 한 번에 넘긴다.

### 프롭 배선

- `DevelopmentBoard`의 `Props`에 `onTaskQaBatch(fileNames, comment)` 하나를 더했다(필수 필드다).
  `onTaskQa`(단건)는 그대로 남는다.
- `WorkspaceShell`이 `workflow.directory`를 채워 넘긴다 — `onTaskQa`와 같은 자리·같은 어법이다.
- `App.tsx`가 `workspace.confirmTaskQaBatch`를 넘긴다(한 줄).

### `App.css`

`.task-lane-batch`, `.lane-qa-overlay`, `.lane-qa-dialog`, `.lane-qa-note`, `.lane-qa-targets`,
`.lane-qa-result`, `.lane-qa-failures`와 그 하위 선택자만 더했다. 기존 규칙은 고치지 않았다. 색·모서리·
글자 크기는 `.project-search-overlay`·`.project-search-dialog`·`.task-lane-header`·`.task-lane-signal`
에서 가져왔고 새 색을 발명하지 않았다. 새로 더한 선택자 중 중복은 없다(`src/App.css` 전체를
`cssRules.ts`와 같은 방식으로 파싱해 확인했고, 검출된 중복 15건은 전부 미디어 쿼리 안의 기존 선언이다).

## 계약에서 벗어난 자리 하나

작업 문서는 열린 레인을 `useState<string | null>`로 레인 키만 들라고 적었다. 실제로는
`useState<SpecLane | null>`로 **연 시점의 레인 스냅샷**을 든다. 이유는 R4다 — 상태 필터가 걸린 채 그
레인의 `qa_waiting`이 전부 `completed`가 되면 그 레인은 카드가 0장이 되어 `buildSpecLanes`가 목록에서
빼고(`lane.items.length === 0`), 키로 다시 찾는 구조였다면 건별 결과를 읽기 전에 확인 화면이 사라진다.
작업 문서가 같은 문단에서 "결과를 읽기 전에 화면이 사라지면 R4가 무의미해진다"와 "실행 뒤 레인의
`qaWaiting`이 줄어도 결과 문구는 그대로 남는다"를 요구했으므로 그 요구를 따랐다. 열린 레인이 하나뿐인
것과 레인 단위로 연다는 것은 그대로다.

## 검증

- `npx vitest run` 착수 시점: **20파일 514건 통과**. 마침 시점: **20파일 524건 통과**(추가 10건).
  `DevelopmentBoard.test.tsx`는 착수 시점 **52건** → 마침 시점 **62건**이다.
- `npm run check`(typecheck + test + build) 통과.
- `cargo test --manifest-path src-tauri/Cargo.toml` 통과 — **427건**. 이 작업은 Rust를 건드리지 않았고
  회귀도 없다.

### 더한 검사 10건 (`DevelopmentBoard.test.tsx`)

1. `puts the batch QA action only on a lane whose signal is lit` — 신호 켜짐/꺼짐/미분류 세 경우.
   문구의 건수가 그 레인의 `qa_waiting` 수와 같다. (완료 조건 1)
2. `lists every target with its id and title and lets each one be dropped` — 목록·개별 제외·전부 해제 시
   실행 불가. (완료 조건 2)
3. `counts the whole lane even when the status filter hides some of its cards` — 상태 필터로 카드가
   가려진 상태에서 액션 문구의 건수와 목록의 건수가 같고, 가려진 작업이 목록에 있다. (완료 조건 3)
4. `calls the app once with every selected file name and the shared comment` — 콜백이 **한 번** 불리고
   인자가 선택된 파일 이름 전부와 공통 코멘트다. 해제한 건은 인자에 없다. (완료 조건 4·10)
5. `reads out the recorded count and every failure with its task id and reason` — 성공 2·실패 1에서
   성공 건수와 실패 건의 id·사유. (완료 조건 5)
6. `still says how many were recorded when nothing failed` — 전부 성공해도 건수를 말한다. (완료 조건 5)
7. `says the call itself failed inside the dialog instead of leaving it to a global message` — 훅이
   `null`일 때 확인 화면 안에서 말한다. (R4 셋째 항목)
8. `runs with an empty comment and caps the shared one at two thousand characters` — 빈 코멘트 실행과
   `maxLength`. (완료 조건 6)
9. `arms before it runs, names the count in the warning, and locks the dialog while running` — 한 번의
   클릭으로는 안 불리고, 무장 문구에 건수와 되돌릴 수 없다는 말이 있으며, 실행 중 버튼·체크박스가
   비활성이다. (완료 조건 7)
10. `keeps the batch action on a collapsed lane` — 접힌 레인에서도 액션이 보인다.

단건 QA 검사 3건(`lets the user confirm a QA waiting task`,
`returns the confirm button to a safe state when not clicked again in time`,
`requires guidance when QA requests development changes`)은 **수정 없이 통과한다**. (완료 조건 8)

### 기존 검사의 변경분 (완료 조건 11)

- `WorkspaceShell.test.tsx`: **12줄 추가, 삭제 0줄**. 전부 `onTaskQaBatch={vi.fn().mockResolvedValue([])}`
  프롭 한 줄씩이다. 단언·검사 이름은 그대로다.
- `DevelopmentBoard.test.tsx`: 삭제된 줄은 전부 `render(<DevelopmentBoard ... />)` 호출 줄과 타입
  import 한 줄이고, 프롭 `onTaskQaBatch` 하나가 붙은 같은 줄로 돌아왔다. 단언과 검사 이름은 하나도
  바뀌지 않았다. 프롭을 선택 필드로 만들어 이 편집을 피하지 않았다 — 화면이 이 콜백 없이 동작하는
  상태를 만들지 않기 위해서다.
- 삭제·비활성화된 검사는 없다.

### 변경한 파일 (완료 조건 12)

`src/features/projects/components/DevelopmentBoard.tsx`,
`src/features/projects/components/DevelopmentBoard.test.tsx`,
`src/features/projects/components/WorkspaceShell.tsx`,
`src/features/projects/components/WorkspaceShell.test.tsx`,
`src/App.tsx`, `src/App.css`.

Rust 파일·`types.ts`·게이트웨이·훅은 손대지 않았다. `git status`에 보이는
`useProjectWorkspace.ts`·`useProjectWorkspace.test.ts`·`types.ts`·`tauriProjectGateway.ts`의 변경은
착수 전부터 있던 TASK-099의 미커밋 산출물이고 이 세션이 만든 것이 아니다.

## 한계

- **카드가 0장이라 목록에서 빠진 레인에는 액션이 없다.** 헤더 자체가 그려지지 않기 때문이다. SPEC-029가
  정한 레인 표시 규칙이고 SPEC-031 R8 둘째 항목이 그대로 두라고 했으므로 바꾸지 않았다. 완료만 있는
  레인은 신호가 꺼져 있어 애초에 대상이 아니지만, 검색어가 걸려 카드가 전부 가려진 신호 레인은 액션이
  사라진다.
- **일괄 반려·되돌리기·진행률·건별 코멘트는 없다.** 전부 기획서 제외 범위이거나 승인된 확인 필요 2번이
  자른 것이다.
- **리스트·타임라인 뷰에는 일괄 액션이 없다.** 레인이 있는 곳은 보드 뷰다.
- 확인 화면이 뜬 동안 2.5초 주기 갱신으로 그 레인에 새 `qa_waiting`이 생겨도 목록에 들어오지 않는다.
  연 시점의 스냅샷을 그대로 들기 때문이고, 사용자가 체크하는 동안 목록이 흔들리지 않는 편이 낫다고
  판단했다. 닫았다 다시 열면 새 목록이 온다.

## 후속 / 핸드오프

- **사용자 QA 시나리오**: 묶기를 켜고, `QA 대기만 남음` 배지가 붙은 레인에서 `이 그룹 N건 QA 확인`을
  누른다. 목록에서 한 건을 해제하고, 코멘트를 비운 채 실행 버튼을 두 번 눌러 실행한다. 결과 문구의
  건수가 선택한 수와 같은지, 해제한 작업이 `qa_waiting` 그대로인지, 결정 문서가 선택한 건수만큼만
  생겼는지 확인한다. 상태 필터를 `완료`로 걸어 카드가 가려진 상태에서도 액션 문구의 건수와 목록의
  건수가 같은지 함께 본다.
- **TASK-103**이 이 두 파일을 이어서 만진다. 지금 `todo`이고 `depends_on: [TASK-100, TASK-101]`이라
  이 작업이 `qa_waiting`이 되면 선행이 풀린다.
- 범위 밖이라 손대지 않은 것 하나: `SpecLaneBoard`가 `busy` 프롭을 받게 되면서 프롭이 아홉 개가 됐다.
  묶음으로 정리할 여지가 있지만 이 작업의 요청과 직접 연결되지 않아 두었다.
