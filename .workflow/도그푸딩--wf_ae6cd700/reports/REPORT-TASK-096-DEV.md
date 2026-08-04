# TASK-096 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(tl-dev-096-r2)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T15:47Z, TL 세션)

- 대상: TASK-096 (레인 접힘을 화면에 붙이고 저장소와 잇는다)
- 근거: SPEC-029 R6·완료 조건 8·9, DECISION-DD348ED0 (`outcome: approved`, `created_by: user`, `spec_id: SPEC-029` — 직접 확인. SPEC-029의 결정 문서는 지금도 이 1건뿐이라 더 늦은 결정이 없다)
- 역할: 개발자 (tl-dev-096-r2)
- 선점: acquire exit 0 → `lease-18107-20260804153333` (15:33:33Z). 착수 시 이미 `in_progress`라 상태 전이를 새로 하지 않았다 — 죽은 세션이 13:05:17Z에 남긴 것을 그대로 이었다. renew exit 0 2회 → `qa_waiting`(15:44:00Z) → release exit 0 (15:45:17Z).
- 선행 확인: `depends_on: [TASK-094, TASK-095]`. 착수 시점에 둘 다 `completed`로 직접 확인했다.

**이 작업은 인수 완주다.** 앞선 세션(`lease-4251-20260804130513`, developer-claude)이 13:10Z경 보고서 없이 죽었고, 그 진행분이 작업 트리에 미커밋으로 남아 있었다.

## 인수 경위 — 죽은 세션의 잔여물 평가

`git diff HEAD`로 죽은 세션의 편집만 갈라 읽었다(HEAD에 TASK-095까지 착지분이 커밋돼 있다). 잔여물은 세 파일 +101/+25/+4줄이었고, 판정은 다음과 같다.

### 살린 것 (제품 코드 대부분)

죽은 세션의 배선은 작업 문서의 범위·완료 조건에 맞고 어법도 이 파일의 선례를 따랐다. 다시 쓰지 않고 그대로 살렸다.

- `laneCollapsed` 상태와 게으른 초기화(`useState(() => browserSpecLaneCollapseStore.load(...))`).
- `toggleLaneCollapsed` — 상태를 바꾸고 같은 함수에서 저장한다. `applyPanelWidth`(`:277`)와 같은 어법.
- `collapseDirectory` 비교로 워크플로 전환 시 다시 읽기. `CalendarView`의 `selectedMonth` 비교(`:604`~`:607`)와 글자 그대로 같은 어법인 것을 확인했다.
- 레인 헤더의 접기 버튼(`aria-expanded`), 접힌 레인은 `BoardView`를 그리지 않는 조건부 렌더, `.task-lane.collapsed` 클래스.
- **`UNASSIGNED_LANE_KEY` 이중 정의 해소.** 죽은 세션이 `DevelopmentBoard.tsx`의 지역 상수를 지우고 `browserSpecLaneCollapseStore`가 내보낸 상수를 import하도록 이미 합쳐 두었다. TASK-095 보고서의 후속 노트가 요구한 것이고, 지금 이 문자열은 저장소 파일 한 곳에만 있다.
- `App.css`의 새 규칙 셋(`.task-lane-toggle`·`.task-lane.collapsed`·`.task-lane.collapsed .task-lane-header`).

### 걷어낸 것 (하나)

- **`afterEach(() => localStorage.clear())`** (죽은 세션이 검사 파일에 더한 3줄, 주석 포함). 이 한 줄이 **44건 전원 실패의 단일 원인**이었다.

  이 저장소의 검사 환경에서 전역 `localStorage`는 **메서드가 하나도 없는 빈 객체**다(직접 계측: `getItem`·`setItem`·`clear`·`removeItem` 전부 `undefined`, `window.localStorage`와 같은 참조). 그래서 `clear()` 호출이 `TypeError`로 터졌고, `afterEach`가 등록의 역순으로 돌아 먼저 등록된 `cleanup`이 실행되지 못했다. 별개 원인으로 관측됐던 "보드 이중 렌더 의심"(`Found multiple elements with the role "button"`)은 **별개가 아니라 그 `cleanup` 누락의 2차 증상**이었다 — 이 3줄을 걷어내자 44건이 전원 통과했고 이중 렌더는 없었다.

  걷어내도 작업 문서가 요구한 격리는 그대로 성립한다. 값은 `stubStorage()`가 검사마다 새로 만드는 `Map`에만 쌓이고, 이미 걸려 있던 `afterEach(() => vi.unstubAllGlobals())`가 그 스텁을 통째로 걷어낸다. 비울 전역 상태 자체가 없다. 같은 사실을 `browserSpecLaneCollapseStore.test.ts:19`~`:21`의 주석이 이미 적어 두었고, `IdeaInbox`·`IntegrationsView`·`WorkspaceShell` 검사도 전부 같은 어법이다. 다시 더해지지 않도록 그 자리에 한 줄 주석을 남겼다.

  **이것은 기존 검사의 수정이 아니다.** 걷어낸 3줄은 HEAD에 없는 죽은 세션의 미커밋 추가분이고, HEAD 대비 검사 파일의 변경은 **추가 175줄 / 삭제 0줄**이다.

### 새로 쓴 것

- 작업 문서가 요구한 검사 7건 전부. 죽은 세션은 헬퍼 셋(`LANE_COLLAPSE_KEY`·`stubStorage`·`laneByToggle`)까지만 두고 검사는 한 건도 쓰지 못한 채 죽었다. 헬퍼는 살려서 썼다.
- 접기 버튼의 접근 이름을 제목이 아니라 레인 키로 바꿨다(아래 "고른 것" 1번).

## 이 세션이 고른 것

### 1. 접기 버튼의 접근 이름은 제목이 아니라 레인 키로 짓는다

죽은 세션은 `aria-label`을 `${lane.title} 레인 접기`로 지었다. 레인 키(`${lane.specId ?? "미분류"} 레인 접기`)로 바꿨다.

근거는 SPEC-029 자신이다. 제외 범위가 **"반려·개정으로 기획서 id가 갈린 두 레인의 병합... 두 레인 그대로 둔다"**고 정했는데, 개정된 기획서는 보통 제목을 그대로 물려받는다. 즉 **제목이 겹치는 두 레인은 이 제품에서 가정이 아니라 예정된 정상 상태**이고, 그때 제목으로 이름을 지으면 접기 버튼 둘의 접근 이름이 똑같아진다. TASK-095가 바로 이 이유로 보드 region 이름을 제목이 아니라 레인 키로 지었고(그쪽 보고서 "이 작업이 정한 것" 4번), 같은 헤더 안의 버튼이 다른 규칙을 쓸 이유가 없다.

보이는 글자(`접기`/`펼치기`)는 이름이 그대로 담으므로 "Label in Name"도 유지된다. 검사 1이 제목이 있는 기획서(`SPEC-001` = "레인 기획")로 이 선택을 고정한다 — 제목 기반으로 되돌리면 깨진다.

### 2. 워크플로 전환은 "다시 마운트"가 아니라 "프롭 교체"로 검사한다

작업 문서가 착수 시 확인하라고 한 항목이다. **확인 결과: `WorkspaceShell`은 이 컴포넌트에 `key`를 주지 않는다.** `WorkspaceShell.tsx:392`가 `{workflow && view === "tasks" && <DevelopmentBoard ... workflow={workflow} />}`이고, 같은 파일의 `IdeaComposer`(`:329`)와 기획서 워크스페이스(`:374`)는 `key={workflow.directory}`를 준다. 즉 이 컴포넌트만 워크플로가 바뀌어도 마운트가 유지되므로, 죽은 세션이 넣은 디렉터리 비교 재읽기가 실제로 필요하다.

그래서 검사 4의 뒷부분을 `cleanup()` 후 재렌더가 아니라 `rerender`로 짰다. 재렌더로 짜면 실제 운영 경로가 아니라 새 마운트를 보게 되어 이 분기를 통과시키지 못한다.

**이 검사가 헛돌지 않는 것을 변이로 확인했다.** `if (collapseDirectory !== workflow.directory)`를 `if (false && ...)`로 잠시 바꾸자 검사 4가 실패했고, 원복 후 다시 통과했다(원복 확인: `:84`가 원래 조건이고 파일에 `if (false` 0건).

### 3. 저장소는 부르기만 했다

작업 문서의 지시대로 `browserSpecLaneCollapseStore.ts`를 한 글자도 고치지 않았다. `load`/`save`가 돌려주는 모양이 부르는 쪽에 그대로 맞아 모자란 것이 없었다 — TASK-094 보고서가 "레인 하나만 뒤집는 헬퍼는 만들지 않았다"고 적은 그대로, `toggleLaneCollapsed`가 맵을 만들어 넘긴다. 보고할 결손 없음.

## 변경한 파일 (셋, 작업 문서 범위 그대로)

| 파일 | HEAD 대비 | 내용 |
|---|---|---|
| `src/features/projects/components/DevelopmentBoard.tsx` | +75 / -28 | 저장소 import, `laneCollapsed`·`collapseDirectory` 상태, `toggleLaneCollapsed`, `SpecLaneBoard`의 `collapsed`·`onToggleCollapsed` 프롭, 헤더 접기 버튼, 조건부 `BoardView` |
| `src/features/projects/components/DevelopmentBoard.test.tsx` | +175 / -0 | 헬퍼 넷과 검사 7건 |
| `src/App.css` | +4 / -0 | `.task-lane-toggle`, `.task-lane.collapsed`, `.task-lane.collapsed .task-lane-header` |

`tsx`의 삭제 28줄은 전부 **재작성이지 기능 제거가 아니다** — 지역 `UNASSIGNED_LANE_KEY` 상수와 그 주석 3줄(저장소 상수로 합쳐짐), 그리고 레인 `<section>` 블록 25줄(접기 버튼과 조건부 렌더를 넣어 다시 씀). 삭제된 줄 전문을 눈으로 확인했고 사라진 동작은 없다.

Rust·`types.ts`·저장소 파일 전부 무변경(`git status --porcelain`으로 `src/features/projects/infrastructure/`·`domain/types.ts`에 변경 0건 확인). CSS는 같은 선택자를 두 번 쓰지 않는다(`.task-lane`·`.task-lane-header`와 `.task-lane.collapsed`·`.task-lane.collapsed .task-lane-header`는 서로 다른 선택자 문자열이다). 보호 상태 무변경. 커밋·푸시 없음.

## 더한 검사 7건

작업 문서의 검사 1~7 번호 그대로다.

1. `collapses a lane to its header while the counts and the signal stay in view` — 접으면 보드 region과 카드가 사라지고, 헤더의 제목·집계(`QA 대기 1`)·신호(`QA 대기만 남음 · 통째로 QA 가능`)는 남는다. 옆 레인은 그대로다. 제목 있는 기획서로 "고른 것 1번"도 함께 고정한다.
2. `brings the cards back when a collapsed lane is expanded again` — 다시 펼치면 `aria-expanded="true"`, `collapsed` 클래스 없음, 카드 복귀.
3. `keeps a lane collapsed after the board is mounted again` — `cleanup()` 후 재렌더에도 접힘이 남고, 접은 적 없는 레인은 펼침으로 돌아온다.
4. `stores the collapse under the versioned key and splits it by workflow directory` — 저장소에 쓴 키가 `workflow-labs.spec-lane-collapse.v1` 하나뿐이고 값이 `{ "feature--wf_1": { "SPEC-001": true } }`. 이어서 `rerender`로 디렉터리를 바꾸면 접힘이 따라오지 않고, 되돌리면 다시 접혀 있다.
5. `draws every lane when the stored collapse points at a spec that is gone` — 저장값에 `SPEC-404`가 섞여 있어도 레인 2개가 정상으로 뜨고, 다른 레인을 접어 저장해도 `SPEC-404` 값이 지워지지 않는다.
6. `keeps the board and the collapse working when localStorage throws` — `getItem`·`setItem`이 전부 던지는 스텁에서 화면이 뜨고 접기·펼치기가 그대로 동작한다. `role="alert"` 없음, 화면 문자열에 `실패`·`오류` 없음.
7. `collapses the unassigned lane under its own key instead of a spec id` — 미분류 레인도 접히고 저장 키가 `#unassigned`다. 기획서 레인은 따라 접히지 않는다.

## 완료 조건별 확인

| # | 조건 | 결과 |
|---|---|---|
| 1 | 접고 펼 수 있고 접힘이 다시 열었을 때 남는다 | 통과 — 검사 1·2·3 |
| 2 | 키가 `workflow-labs.*.v1` 계열, 워크플로 디렉터리로 구분 | 통과 — 검사 4 |
| 3 | 다른 저장소 넷의 값을 건드리지 않는다 | 통과 — 저장소 파일 무변경 + TASK-094 검사 16건 그린 |
| 4 | 읽기·파싱·쓰기 실패에 화면이 안 깨진다 | 통과 — 검사 6 |
| 5 | 없는 기획서를 가리켜도 안 깨진다 | 통과 — 검사 5 |
| 6 | 접힌 레인의 집계와 신호가 그대로 보인다 | 통과 — 검사 1 |
| 7 | 묶기 끈 보드·리스트·타임라인 무변경 | 통과 — 기존 44건 무수정 통과 |
| 8 | 기존 검사가 삭제·비활성화되지 않는다 | 통과 — 검사 파일 +175 / -0 |
| 9 | 변경분에 Rust·`types.ts`·저장소 파일 없음 | 통과 |
| 10 | `npm run check` 통과 | 통과 — exit 0 |

## 검증

- `npx vitest run .../DevelopmentBoard.test.tsx` → **51 passed / 51.** 착수 시점 44건 전원 실패에서 출발했고, 그 44건은 **한 줄도 고치지 않고** 통과시킨 뒤 7건을 더했다(44 + 7 = 51).
- `npx vitest run .../DevelopmentBoard.test.tsx .../browserSpecLaneCollapseStore.test.ts` → **67 passed / 67** (51 + 16). 완료 조건 3의 저장소 쪽 근거다.
- `npm run check` (typecheck → test → build) → **exit 0.** `tsc -b --pretty false` 무오류, `vitest run` **19 파일 508건 전부 통과**(TASK-095 착지 시점 501건 + 이 세션 7건), `vite build` 성공(326 modules).
- `cargo test`는 **돌리지 않았다.** 이 세션의 Rust 변경분이 0이고 작업 문서의 완료 조건에도 없다. (`src-tauri/`에 다른 세션의 미커밋 변경이 있지만 이 세션은 손대지 않았다.)
- 변이 확인 1건: 위 "고른 것 2번"의 디렉터리 비교 분기.

**판정 방법에 관하여.** 이 저장소는 병행 세션의 미커밋 변경이 커서 `git status`나 "diff가 비었다"로는 이 세션의 몫이 갈리지 않는다. 그래서 위 표를 전부 `git diff HEAD -- <파일>`의 파일·줄 단위와 심볼·값 단위로 확인했다. 착수 후에도 다른 세션이 `src-tauri/.../project_instructions.rs`를 새로 고친 것이 보였고 손대지 않았다.

## 사용자 QA 제안

접기 버튼이 이번에 처음 생긴다. TASK-095 QA에서 "접기 버튼이 없는 것이 정상"이라고 적었던 자리다.

1. **묶기를 켜고 레인을 접어 본다.** 카드가 사라지고 헤더는 남아야 한다. 특히 **접은 레인의 집계 수치와 "QA 대기만 남음 · 통째로 QA 가능" 신호가 그대로 보이는지** — 접기의 목적이 카드를 줄이는 것이지 사실을 감추는 것이 아니다.
2. **앱을 껐다 켜거나 다른 화면을 갔다 온 뒤 접힘이 남아 있는지.**
3. **워크플로를 바꿔 본다.** A에서 접은 레인이 B에서는 펼쳐져 있고, A로 돌아오면 다시 접혀 있어야 한다. 이 화면은 워크플로를 바꿔도 다시 마운트되지 않으므로(위 "고른 것 2번") 눈으로 볼 값이 있다.
4. **접었던 레인이 목록에서 빠졌다 돌아왔을 때.** 카드가 0장이 되어 빠진 레인이 나중에 돌아오면 접힌 채로 돌아오는 것이 정상이다(SPEC-029 확인 필요 3번의 비용 항목).
5. **묶기를 끈 보드는 여전히 완전히 같아야 한다.** 접기 버튼은 레인 헤더에만 있다.
6. 좁은 창에서 헤더가 줄바꿈될 때 접기 버튼이 밀려나지 않는지. jsdom은 레이아웃을 계산하지 않아 눈으로만 확인된다(TASK-095 QA 노트와 같은 성격).

## 후속 / 리스크

- **`#unassigned` 이중 정의는 이 작업에서 해소됐다.** TASK-095 보고서가 남긴 후속 노트가 닫혔고, 지금 이 문자열은 `browserSpecLaneCollapseStore.ts:19` 한 곳에만 있다.
- **TASK-099·100이 이 작업을 `depends_on`으로 기다리고 있었다.** 이 착지로 선행이 충족된다.
- **접기 상태와 레인 순서가 함께 움직이는 자리.** 레인 순서는 신호에 따라 바뀌고(TASK-095) 2.5초마다 목록이 갱신되므로, 접어 둔 레인이 화면에서 위아래로 움직일 수 있다. 접힘 자체는 키로 따라다녀 어긋나지 않는다. 거슬리면 별도 아이디어 감이고 이 작업의 범위가 아니다.
- **역할 밖 관찰(수정하지 않음).** 이 워크플로의 lease 디렉터리에 만료된 `SPEC-009.yml`(`expires_at: 2026-08-03T01:20:00Z`)이 그대로 남아 있다. TASK-093·094·095 보고서가 같은 것을 적었고 상황이 그대로다. 만료된 lease는 대상을 잡지 않고, 공통 규칙 §4가 판정은 lease 파일을 지우거나 고치지 않는다고 정하므로 손대지 않았다.
- **역할 밖 관찰(수정하지 않음).** 검사 환경의 전역 `localStorage`가 메서드 없는 빈 객체인 것은 이 저장소 전반의 전제이고 각 검사가 `vi.stubGlobal`로 세워 쓴다. 죽은 세션이 여기서 걸려 넘어졌으므로 후속 세션을 위해 사실만 적어 둔다. 환경 설정을 바꾸는 것은 이 작업의 범위가 아니다.
- 커밋·푸시하지 않았다. 저장소에 병행 세션의 미커밋 변경이 크므로 QA는 작업 트리 기준으로 봐야 한다.

---

> 기록 경위(추기): 아래 재작업 절도 하네스가 서브에이전트(tl-dev-096-r2)의 보고서 파일 작성을 차단해 발신 전문을 TL이 대리 추기한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T16:06Z, TL 세션)

# 재작업 — QA-F25FD89E (revision_requested, 15:57:50Z)

- 재선점: acquire exit 0 → `lease-75245-20260804155908` (15:59:08Z) → `in_progress`(15:59:30Z) → `qa_waiting`(16:04:46Z) → release exit 0.
- QA 원문 직접 확인: "그룹별 나뉘어지는게 확인되었지만 화면 비율을 줄이면 안에 내용물 (완료나 qa대기 등)이 오른쪽 바깥으로 빠져나감."

## 원인 진단 — 왜 넘쳤나

`.task-board`가 `min-width: 950px`을 갖는다(`App.css:407`, SPEC-021이 정한 값이고 `boardCardOverflow.test.ts:60`~`:64`가 지킨다). 이 상자는 창을 좁혀도 950px 밑으로 줄지 않는다.

**묶기를 끈 보드에서는 이게 문제가 안 된다.** `.development-view`(`min-width: 0`)에는 눈에 보이는 테두리·배경이 없고, 넘친 폭은 조상인 `.workspace-content { overflow: auto }`(`:144`)의 가로 스크롤이 흡수한다. 넘쳐도 넘친 티가 안 난다.

**레인에서는 문제가 된다.** 마크업이 `.task-lane` → `.task-board`인데, `.task-lane`은 테두리 1px·`border-radius: 14px`·배경을 가진 **눈에 보이는 상자**이고 폭은 좁은 부모를 그대로 따른다(`min-width: 0`). 그 안의 950px 보드가 이 상자보다 넓으니 열(완료·QA 대기 등)이 **레인의 둥근 테두리 오른쪽 밖으로 그려져 나간다.** 사용자가 본 그림 그대로다.

두 가지를 덧붙인다.

- **`.task-board` 자신의 `overflow-x: auto`는 이 상황에서 무력하다.** 자기 `min-width`가 950px이라 자기 박스가 950px로 확정되고, `overflow`는 자기 내용물이 그 950px을 넘을 때만 도는데 5열이 950px 안에 들어맞아 한 번도 돌지 않는다. TASK-095 보고서가 "이것 때문에 레인 안에서도 가로로 스크롤된다"고 적은 것은 **틀린 관찰이었다.** 스크롤된 건 레인 안이 아니라 워크스페이스 전체였다.
- **상태 필터가 걸리면 재현되지 않는다.** `.task-board.columns-1`이 `min-width: 0`으로 덮으므로(`:408`) 열이 하나로 줄면 넘치지 않는다. 즉 이 결함은 **필터가 `모든 상태`(5열)일 때만** 보인다. QA 재확인 시 이 조건이 필요하다.

## 처방 — 어느 선택자에 무엇을 더했나

보드에만 가로 스크롤 상자를 씌워 레인 테두리 안에 가뒀다. `.task-board`의 최소 폭은 **건드리지 않았다** — SPEC-021의 결정이고 다른 검사가 지키는 값이다.

- `src/App.css:449` **신설** — `.task-lane-scroll { min-width: 0; overflow-x: auto; }`
- `src/features/projects/components/DevelopmentBoard.tsx` — `SpecLaneBoard`에서 `<BoardView>`를 `<div className="task-lane-scroll">`로 감쌌다. 접힌 레인은 이 상자째 그리지 않으므로 접기 동작은 그대로다.

**왜 `.task-lane`에 직접 `overflow-x: auto`를 주지 않았나.** 그게 이 저장소의 겉보기 선례이긴 하다(`.task-list:452`·`.task-calendar:469`가 둘 다 테두리 있는 상자 자신에 걸었다). 하지만 그 둘은 안에 넓은 내용물만 있고 **레인은 헤더를 품는다.** 레인 전체를 스크롤 상자로 만들면 오른쪽으로 밀 때 헤더(제목·분절 집계·QA 신호·접기 버튼)까지 같이 밀려 화면에서 사라진다. 접어도 헤더는 남긴다는 R6의 판단과 정면으로 어긋나고, 집계·신호가 늘 보여야 한다는 R2·R3에도 반한다. 부수적으로 `overflow-x: auto`는 `overflow-y`를 `visible`로 둘 수 없어 세로 축까지 끌려오는 문제도 있다. 그래서 스크롤은 보드에만 씌웠다.

## 회귀 고정

jsdom이 레이아웃을 재지 못하므로 `boardCardOverflow.test.ts`(TASK-089/SPEC-021)의 어법을 그대로 따라 **선언 단위**로 고정했다. SPEC-021 소유 파일은 손대지 않고 같은 계열의 파일을 하나 새로 뒀다.

**`src/features/projects/components/specLaneOverflow.test.ts` 신설 (38줄, 검사 3건)** — `cssRules.ts`의 `declarationsOf` 사용.
1. `레인 안 보드에 가로 스크롤 상자가 씌워져 있다` — `.task-lane-scroll`의 `overflow-x`가 `auto`.
2. `스크롤 상자의 콘텐츠 기반 최소 크기가 해제되어 있다` — `min-width`가 `0`. 초기값 `auto`면 상자가 950px 보드만큼 넓어져 스크롤이 안 생기는 경로가 남는다.
3. `레인 자신은 스크롤 상자가 아니다` — `.task-lane`에 `overflow`·`overflow-x`가 없다. 위에 적은 헤더 유실 경로를 못 박는다.

**`DevelopmentBoard.test.tsx`에 검사 1건 추가** — `wraps only the lane board in a scroll box and leaves the header outside it`. 선언이 아니라 **마크업**을 본다: 보드 region의 부모가 `.task-lane-scroll`이고 그 부모가 `.task-lane`이며, 헤더는 그 상자 밖에 있다(`scroll.querySelector(".task-lane-header")`가 `null`). 이어서 **묶기를 끈 보드에는 이 상자가 생기지 않는 것**까지 확인한다(완료 조건 7).

**변이로 헛돌지 않는 것을 확인했다.** `.task-lane-scroll`에서 `overflow-x: auto`를 빼자 검사 1이 실패했고, 원복 후 통과했다(`App.css:449` 원래 선언 복귀 확인).

## 게이트 수치

- `DevelopmentBoard.test.tsx` + `specLaneOverflow.test.ts` → **55 passed / 55** (52 + 3).
- `DevelopmentBoard.test.tsx` 단독 → **52 passed / 52.** 재작업 전 51건을 **한 줄도 고치지 않고** 통과시킨 뒤 1건 추가.
- `boardCardOverflow.test.ts` 포함 3파일 → **62 passed / 62.** SPEC-021의 검사 7건이 그대로 통과한다(`.task-board`의 `min-width: 950px`·`overflow-x: auto`를 안 건드렸다는 근거).
- `npm run check` → **exit 0.** tsc 무오류, **20 파일 514건 전부 통과**, `vite build` 성공.

**514의 내역을 갈라 둔다.** 재작업 전 508건에서 **내 몫은 +4건**(보드 1 + 신설 파일 3)이라 512여야 한다. 나머지 +2는 **다른 세션의 몫**이다 — `src/features/projects/application/useProjectWorkspace.test.ts`에 `it(` 2건이 추가된 것을 확인했다(그 파일 현재 20건). 파일 수 19 → 20은 내 신설 파일 1개다.

## 앞선 보고의 수치 정정 하나

첫 착지 보고에서 `DevelopmentBoard.test.tsx`를 "+175 / -0"이라고 적었는데, 그 측정이 **검사 4를 `rerender`로 고쳐 쓰기 전** 시점이었다. 첫 착지 시점의 정확한 값은 **+188 / -0**이다. 삭제 0줄이라는 사실과 게이트 수치(508)는 그대로다. 지금 누적은 **+206 / -0**.

## 변경 파일 (누적, HEAD 대비)

| 파일 | 누적 | 이번 재작업 몫 |
|---|---|---|
| `src/App.css` | +7 / -0 | `.task-lane-scroll` 규칙 1개 + 근거 주석 2줄 |
| `src/features/projects/components/DevelopmentBoard.tsx` | +79 / -28 | `SpecLaneBoard`의 `BoardView`를 스크롤 상자로 감쌈 |
| `src/features/projects/components/DevelopmentBoard.test.tsx` | +206 / -0 | 검사 1건 |
| `src/features/projects/components/specLaneOverflow.test.ts` | 신설 38줄 | 검사 3건 |

CSS는 여전히 같은 선택자를 두 번 쓰지 않는다(`declarationsOf`가 중복 시 실패시키는데 3건 다 통과).

**타 세션 파일 무접촉 재확인.** 착수 후 다른 세션이 `src-tauri/**` 8개와 `src/features/projects/{application,domain,infrastructure}`의 4개(`useProjectWorkspace.ts`·`.test.ts`·`domain/types.ts`·`tauriProjectGateway.ts`)를 고쳤다. TASK-099·100이 풀려 착수한 것으로 보이고, **나는 하나도 건드리지 않았다.** 완료 조건 9("변경분에 Rust·`types.ts`·저장소 파일 없음")는 내 변경분 기준으로 그대로 성립한다 — 작업 트리에 그 파일들이 `M`으로 보이는 것은 남의 몫이다. 커밋·푸시 없음.

## 사용자 QA 제안 — 어떤 화면 폭에서 뭘 볼지

이번 결함은 **폭에 달린 것**이라 재현 조건을 정확히 적는다.

1. **묶기를 켜고, 상태 필터는 `모든 상태`(5열)로 둔 채 창을 좁혀라.** 필터를 하나로 걸면 `columns-1`이 `min-width: 0`으로 덮어 재현되지 않는다.
2. **레인 폭이 950px보다 좁아지는 지점**부터가 확인 구간이다. 사이드바 250px + 워크스페이스 좌우 패딩 38px×2 + 레인 패딩 12px×2 + 테두리를 감안하면 **창 폭 대략 1300px 아래**에서 보이기 시작한다. 노트북 화면이나 창 반쪽 크기면 충분하다.
3. **봐야 할 것**: 열이 레인의 둥근 테두리 **밖으로 삐져나오지 않고**, 레인 안에서 가로 스크롤바가 생겨 그 안에서 밀리는가.
4. **헤더가 제자리를 지키는가.** 보드를 오른쪽 끝까지 밀어도 레인 제목·분절 집계·"QA 대기만 남음 · 통째로 QA 가능" 신호·접기 버튼이 그대로 보여야 한다. 이게 `.task-lane`이 아니라 보드에만 스크롤을 씌운 이유다.
5. **레인마다 스크롤이 따로 도는가.** 한 레인을 밀어도 다른 레인은 자기 위치를 지키는 것이 정상이다.
6. **묶기를 끈 보드는 이전과 완전히 같아야 한다.** 좁히면 예전처럼 워크스페이스 전체가 가로로 스크롤된다 — 그건 이번에 고친 대상이 아니고 SPEC-021이 정한 기존 동작이다.
7. 접기·펼치기와 접힘 유지는 1차 QA 때 확인한 대로 그대로 동작해야 한다(접은 레인은 스크롤 상자째 안 그린다).

## 남은 위험

- **묶기 끈 보드의 좁은 화면 동작은 그대로 두었다.** 창을 좁히면 워크스페이스 전체가 가로 스크롤되는 것은 예전부터의 동작이고 `min-width: 950px`이 그 원인이다. 이번 QA 코멘트는 레인 안 넘침을 지목했고 완료 조건 7이 묶기 끈 보드의 무변경을 요구하므로 범위 밖으로 두었다. 보드 자체를 좁은 화면에 맞추려면 SPEC-021의 950px 결정을 다시 여는 별도 기획서 감이다.
- **`.task-board`의 `overflow-x: auto`는 지금 무력한 선언이다**(위 진단 참고). SPEC-021 소유이고 `boardCardOverflow.test.ts:63`이 지키는 값이라 손대지 않았다. 역할 밖 관찰로만 남긴다.
