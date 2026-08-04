# TASK-095 개발자 핸드오프

- 대상: TASK-095 (보드 뷰에 기획서별 레인과 그룹 QA 신호를 그린다)
- 근거: SPEC-029 R1~R5·R8, 완료 조건 1~7·12·13, DECISION-DD348ED0 (`outcome: approved`,
  `created_by: user`, `spec_id: SPEC-029` — 직접 확인. SPEC-029의 결정 문서는 이 1건뿐이라 더 늦은
  결정이 없다)
- 역할: 개발자 (developer-claude)
- 선점: acquire exit 0 → `lease-95371-20260804115338` → `in_progress`(11:54:00Z) → 구현 → 검증 →
  `qa_waiting`(12:02:00Z). 중간에 renew exit 0 1회.
- 선행 확인: `depends_on: [TASK-093]`. TASK-093은 `completed`이고, 그 산출물인
  `WorkflowItemSummary.sourceSpecId`(`src/features/projects/domain/types.ts:49`)가 실제로 타입에
  있는 것을 착수 전에 직접 확인했다.

기획서의 본체다. 묶기 토글·기획서별 레인·분절 집계·그룹 QA 신호·미분류 레인·빠진 레인 고지까지
한 번에 들어갔다. 레인 접힘은 TASK-096 몫이라 접기 버튼을 만들지 않았다.

## 병행 안전 재확인 (착수 시점 12:00Z 실측)

작업 문서가 요구한 확인이다. `DevelopmentBoard.tsx`·`App.css`를 범위에 둔 `todo` 작업이 새로 생겼는지
봤다.

- 이 워크플로의 `todo` 작업은 TASK-095(이 작업)·096·097·098 넷이다. QA 반려로 되돌아온 작업은 없다.
- TASK-096이 두 파일을 범위에 두지만 `depends_on: [TASK-094, TASK-095]`라 이 작업이 끝나기 전에는
  선행이 충족되지 않는다. 다른 세션이 집을 수 없으므로 동시 수정 위험이 아니다.
- TASK-097·098은 `.workflow/rules/`의 조건 스크립트와 계약이라 파일이 겹치지 않는다.
- 그래서 진행을 막을 사유가 없다고 판단했다. 작업 문서가 말한 "진행하지 말고 넘긴다" 조건에
  해당하지 않는다.
- 작업 중 TASK-094를 다른 세션이 선점해 착지했다(`browserSpecLaneCollapseStore.ts`·`.test.ts` 신설).
  그 작업은 신설 파일 둘뿐이라 이 작업과 겹치지 않았고, 아래 `npm run check` 결과에 그 검사도 함께
  들어가 있다.

## 변경한 파일 (셋, 작업 문서 범위 그대로)

- `src/features/projects/components/DevelopmentBoard.tsx` — 레인 파생 함수 넷과 `SpecLane` 인터페이스,
  `SpecLaneBoard` 컴포넌트, 상수 넷, `laneGrouping` 상태와 토글, `BoardView`의 `label` 프롭.
- `src/features/projects/components/DevelopmentBoard.test.tsx` — 헬퍼 넷과 검사 11건 추가.
  기존 33건은 이름도 내용도 고치지 않았다.
- `src/App.css` — `/* Development spec lanes */` 블록 13줄 추가. 기존 `.task-board`·`.task-column`·
  `.task-card` 규칙은 한 글자도 고치지 않았다.

Rust·`types.ts`·저장소 전부 무변경. 보호 상태 무변경. 커밋·푸시 없음.

## 승인된 확인 필요 3건이 코드에서 어디에 있는가

### 1번 — 집계와 신호는 워크플로의 작업 전체를 센다

`buildSpecLanes(allTasks, visibleTasks, specs)`가 두 집합을 따로 받는다. 수치와 신호는
`allTasks`(= `workflow.items.tasks`)를 세고, 카드만 `visibleTasks`(= `filteredTasks`)에서 온다.
`SpecLaneBoard`가 두 프롭을 이름으로 갈라 받으므로 호출부에서도 섞이지 않는다.

그래서 헤더가 "QA 대기 3"이라고 말하는데 필터 때문에 카드가 0장인 상태, 완료 수치와 보이는 완료
카드 수가 어긋나는 상태가 정상이다. 화면은 레인 목록 위 문장 하나로 그것을 밝힌다 —
`레인의 수치와 QA 신호는 필터·완료 절단 이전의 전체 작업을 셉니다`. 레인마다 26번 반복하지 않고
헤더에는 짧은 표식 `전체 기준`만 붙였다.

### 2번 — 의존 고지는 이번 범위가 아니다

`depends_on`을 읽는 코드를 한 줄도 넣지 않았다. 레인 헤더는 다른 레인의 미충족 선행을 말하지 않는다.

### 3번 — 카드 0장 레인은 빼고 그 수를 남긴다

`buildSpecLanes`가 `items.length === 0`인 레인을 목록에서 빼고 `hiddenLaneCount`로 함께 돌려준다.
문구는 상황에 따라 갈린다.

- 필터 없음: `완료만 있어 표시하지 않은 기획서 N개` (승인된 문구 그대로)
- 필터 있음: `조건에 맞는 카드가 없어 표시하지 않은 기획서 N개`

**갈라 놓은 이유**를 남긴다. 승인된 문구는 필터가 없는 상태를 전제로 쓰였다. 검색어 때문에 빠진
레인까지 "완료만 있어"라고 말하면 R5가 금지한 거짓말이 된다. 승인된 문구는 그것이 참인 자리에
그대로 쓰고 참이 아닌 자리에만 갈아 끼웠다. 판정은 기존 `hasFilters`를 그대로 쓴다.

순서는 `compareLanes`가 정한다. 신호가 켜진 레인이 위, 그 안에서 기획서 id 오름차순(`localeCompare`),
미분류는 늘 맨 뒤다.

## 이 작업이 정한 것 (기획서가 정하지 않은 자리)

기획서가 침묵한 자리라 구현이 정했다. QA에서 뒤집을 수 있는 항목이다.

1. **규격 밖 상태를 신호의 "막는 쪽"에 센다.** `laneSignal`이 `todo + in_progress + blocked +
   unknownCount === 0`을 본다. 무엇인지 모르는 상태를 "QA 대기만 남았다"의 근거로 삼을 수 없다는
   판단이다.
2. **헤더 수치의 규격 밖 항목 이름은 `규격 밖`이다.** 열 제목 `확인 필요`와 다른 문자열을 쓴 이유는,
   헤더 수치가 `statusLabels`의 상태 어휘(준비·진행 중·막힘·QA 대기·완료)로 말하는데 열 제목은
   `taskColumns`의 열 어휘(…·최근 완료)라 두 어휘가 이미 갈려 있기 때문이다. 0건이면 표시하지 않는다.
3. **미분류 레인이 맨 뒤인 이유.** 신호가 붙지 않아 아랫 무리에 속하고, 키가 기획서 id가 아니라 id
   정렬에 섞을 수 없다. 코드 주석으로 남겼다.
4. **레인 보드의 `aria-label`을 제목이 아니라 레인 키로 짓는다** (`SPEC-001 칸반 보드` /
   `미분류 칸반 보드`). 서로 다른 기획서가 같은 제목을 가질 수 있어 제목으로 지으면 region 이름이
   겹친다.
5. **레인 헤더는 제목과 id를 함께 보이되, 제목이 id로 떨어진 레인은 id 하나만 보인다.**
   `items.specs`에 없는 기획서에서 `SPEC-777 SPEC-777`이 되는 것을 막는다.

## 구현 메모

- 파생은 `DevelopmentBoard.tsx`의 모듈 수준 순수 함수 넷이다 — `buildSpecLanes`·`laneKeyOf`·
  `laneSignal`·`compareLanes`와 생성자 `emptyLane`. 새 모듈로 빼지 않았다.
  `tasksForDevelopment`·`matchesFilters`·`count`가 이미 같은 자리에 있다.
- 미분류 레인 키 상수는 이 파일 안의 `UNASSIGNED_LANE_KEY = "#unassigned"`다. 작업 문서가 정한 대로
  이 작업에서는 파일 안 상수로 두었다. **TASK-096이 이 상수와 `browserSpecLaneCollapseStore`의 같은
  상수를 하나로 맞춰야 한다.** 아래 후속에 다시 적는다.
- 파생은 `SpecLaneBoard` 안의 `useMemo`에 있고, 그 컴포넌트는 묶기를 켰을 때만 마운트된다. 그래서
  꺼진 보드에서는 파생 비용이 0이고, 켠 상태에서도 `allTasks`·`visibleTasks`·`specs`가 바뀔 때만 돈다.
  2.5초 주기가 목록을 새로 실어 오면 그때 한 번 다시 세고, 그 사이의 리렌더에서는 다시 세지 않는다.
  작업 88건·기획서 26개 규모의 단순 집계다.
- `BoardView`의 `label`은 기본값이 지금 문자열(`개발 작업 칸반 보드`)이라 묶기를 끈 화면과 기존 검사
  33건이 그대로 통과한다. 열 구성·`statusFilter` 처리·"확인 필요" 열·카드 마크업·`onOpen` 경로는
  손대지 않고 그대로 재사용한다.
- 토글은 `.development-toolbar`가 아니라 보드 뷰 안, 레인 목록 위에 있다. 리스트·타임라인에서는 뜻이
  없어 보기를 바꿀 때마다 툴바가 흔들리기 때문이다. 상태는 `useState<boolean>`이고 기본값은 꺼짐,
  저장하지 않는다(기획서 제외 범위).
- CSS는 새 규칙 13개만 더했다. 같은 선택자의 규칙을 둘 이상 만들지 않았다(`src/test/cssRules.ts`의
  판독기가 그것을 실패로 다룬다). 색·글자 크기·모서리는 `.task-column`·`.development-summary`·
  `.view-switcher`에서 가져왔고 새 색을 발명하지 않았다.

## 검증

- `npm run check` — 통과. `tsc -b` 무오류, `vitest run` 19파일 501건 전부 통과, `vite build` 성공.
- `npx vitest run src/features/projects/components/DevelopmentBoard.test.tsx` — 44건 통과.
  **착수 시점 기존 검사가 33건이었고 지금 44건이다. 11건을 더했고 기존 33건은 수정 없이 통과한다.**
  (완료 조건 9 / SPEC-029 완료 조건 13)
- `git diff --stat`으로 세 파일만 바뀐 것을 확인했다. 검사 파일 쪽 삭제 줄은 1줄인데 이 세션의 것이
  아니라 앞선 세션이 남긴 import 줄 변경이다(`TaskDependency` 추가). 이 세션의 검사 편집은 전부
  추가다. 삭제·비활성화된 검사는 없다. (완료 조건 10)
- 변경분에 Rust 파일과 `types.ts`가 없다. (완료 조건 12)

### 더한 검사 11건과 무엇을 고정하는가

1. `splits the board into lanes by the source spec of each task` — 서로 다른 기획서의 작업 둘이 다른
   레인에 있다. (완료 조건 1)
2. `starts with grouping off and returns the plain board when it is turned off again` — 기본값 꺼짐,
   끄면 레인 마크업이 없고 기존 보드 region이 그대로다. (완료 조건 1)
3. `names the spec behind a lane and falls back to the bare id when the spec is unknown` — 제목과 id,
   그리고 `items.specs`에 없는 레인은 id만. (완료 조건 2)
4. `breaks the lane header count down by status instead of one percentage` — 다섯 상태를 0이어도 전부
   보이고 화면 어디에도 `%`가 없다. (완료 조건 3)
5. `lights the lane signal only when nothing but QA waiting is left` — 켜지는 레인과 꺼지는 레인을
   한 화면에 함께 만든다. (완료 조건 4)
6. `keeps a todo hidden by the status filter from lighting the lane signal` — **승인된 확인 필요
   1번을 고정하는 자리다.** 상태 필터가 `todo` 카드를 가려도 헤더는 `준비 1`을 말하고 신호가 켜지지
   않는다. 집계를 표시 집합으로 바꾸면 이 검사가 깨진다. (완료 조건 5)
7. `counts every completed task in the header while the board still truncates the cards` — 헤더
   `완료 4` vs 실제 카드 3장. **어긋남이 정상이라는 것을 검사가 문서로 남긴다.** (완료 조건 6)
8. `keeps tasks without a source spec in an unassigned lane and never signals it` — `qa_waiting`만
   담아 신호 조건을 만족시켜 두고도 붙지 않는 것을 본다. (완료 조건 7)
9. `drops a lane with no card left and says how many lanes went missing` — 완료만 있어 빠진 레인의
   수와, 필터를 걸었을 때 문구가 갈리는 것. (완료 조건 12)
10. `puts signalled lanes first, then id order, and the unassigned lane last` — 레인 제목의 등장
    순서로 단언한다. (완료 조건 12)
11. `keeps an off-contract status in the lane count and in the review column` — 규격 밖 상태가 헤더
    수치(`규격 밖 1`)에 남고 "확인 필요" 열에 카드가 보인다. (R2 셋째 항목)

## QA에서 봐 주면 좋은 것

- **묶기를 끈 보드가 지금과 완전히 같은지.** 토글 줄 하나만 늘어야 한다. 열 구성·카드·요약줄·검색·
  상태 필터·필터 초기화·리스트·타임라인 전부 무변경이 정상이다.
- **레인 안의 가로 스크롤.** `.task-board`가 `min-width: 950px`와 `overflow-x: auto`를 그대로 갖고
  있어 레인 안에서도 가로로 스크롤된다. jsdom은 레이아웃을 계산하지 않으므로 이건 눈으로만 확인된다.
  좁은 창에서 레인이 찌그러지지 않는지 봐 주면 좋다.
- **실제 데이터에서 신호가 15개 레인에 켜지는지** (SPEC-029 R3 넷째 항목·확인 사실 10).
  SPEC-024·SPEC-027은 켜지지 않아야 한다. 다만 확인 사실 10은 2026-08-04 10:36Z 실측이고 그 뒤로
  TASK-090~094가 착지해 상태가 바뀌었으므로, 숫자가 15가 아니어도 그 자체가 결함은 아니다. 봐야 할
  것은 "`todo`가 섞인 레인에 신호가 켜지지 않는가"다.
- **빠진 레인 수가 맞는지.** 완료만 있는 레인이 9개인데 완료 절단이 워크플로 전체에서 최근 3건만
  남기므로, 그 3건이 속한 레인 외에는 목록에서 빠지고 그 수가 아래 줄에 남는다.
- 접기 버튼이 없는 것이 정상이다. TASK-096 몫이다.

## 후속 / 리스크

- **TASK-096이 상수 둘을 하나로 맞춰야 한다.** 지금 `#unassigned`가 두 곳에 따로 있다 —
  `DevelopmentBoard.tsx`의 `UNASSIGNED_LANE_KEY`와 TASK-094가 만든
  `browserSpecLaneCollapseStore`의 같은 값이다. 작업 문서 둘이 그렇게 나눠 놓았고 TASK-096이
  합치기로 되어 있다. 값이 같아 지금 동작은 맞지만, 합치기 전까지는 한쪽만 고치면 접힘 상태가
  어긋난다.
- **레인 순서가 신호에 따라 바뀐다.** 승인된 확인 필요 3번이 정한 것이고, 자리가 바뀌는 것은 그
  레인의 상태가 실제로 바뀐 때뿐이다. 다만 2.5초 주기로 목록이 갱신되므로 사용자가 보는 중에 레인이
  위아래로 움직일 수 있다. 실사용에서 거슬리면 별도 아이디어로 올릴 값이다. 이 작업이 고칠 범위는
  아니다.
- **역할 밖 발견(핸드오프 노트).** 이 워크플로의 lease 디렉터리에 만료된 `SPEC-009.yml`
  (`expires_at: 2026-08-03T01:20:00Z`)이 남아 있다. 만료된 lease는 대상을 잡지 않으므로 판정에
  영향이 없고, 공통 규칙 §4가 판정은 lease 파일을 지우거나 고치지 않는다고 정하므로 손대지 않았다.
- 커밋·푸시하지 않았다. 저장소에 미커밋 변경이 크므로 QA는 작업 트리 기준으로 봐야 한다.
