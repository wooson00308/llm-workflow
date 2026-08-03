# TASK-024 개발자 핸드오프

- 대상 작업: TASK-024 (캘린더를 전이 사실 타임라인으로 바꾸고 하루 칸을 집계로 표시한다)
- 근거 문서: SPEC-007 R1·R6·R8, DECISION-AA40AF4B (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T01:05Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-024·025·027·028·029·030·031 일곱 건이다.
- TASK-028~031은 SPEC-009 산출물인데 `leases/SPEC-009.yml`(architect-claude, `expires_at`
  2026-08-03T01:20Z)이 아직 만료되지 않았다. 겹치는 작업을 잡지 않는다는 공통 규칙 4절에 따라 제외했다.
- TASK-025는 선행 필수 TASK-024가 `todo`라 열려 있지 않다. 남는 후보는 TASK-024와 TASK-027이다.
- TASK-024를 골랐다. 선행 필수 TASK-023이 `qa_waiting`(구현 완료)이라 조건이 열렸고, 이 작업이 끝나야
  TASK-025가 열린다. TASK-027은 그 사이에도 계속 열려 있다. 직전 세션(REPORT-TASK-023-DEV)이 쓴 것과
  같은 기준이다.
- 병행 금지 대상은 TASK-025 하나이고 `todo`라 아무도 잡고 있지 않다.
- 착수 시점 `.workflow/.runtime/migration.lock` 없음. 배타 생성(`set -o noclobber`)으로
  `leases/TASK-024.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- SPEC-007 본문은 `status: user_review`지만 앱이 기록한 승인 결정(DECISION-AA40AF4B)이 있으므로 공통
  규칙 5절의 구현 차단 조건에 걸리지 않는다.

## 결과

타임라인은 이제 `due_at`을 보지 않는다. `WorkflowItemSummary.events`(TASK-022·023이 채운 전이 사실)를
`(작업, 이벤트)` 쌍으로 펼쳐 이벤트 시각의 **로컬 날짜**로 묶고, 하루 칸에는 종류별로 접은 칩을
그린다. 칩은 `생성 / 시작 / 막힘 / QA 대기 / 완료 / 반려` 여섯 종류가 최대이고, 종류 이름과 건수를
글자로 담는다. 이벤트가 100건이든 칸의 칩은 여섯을 넘지 않는다.

"일정 미지정" 영역은 통째로 사라졌다. 헤더 기준 표기는 `due_at 기준` → `상태 전이 기록 기준`이고,
사용자에게 보이는 보기 이름은 `캘린더` → `타임라인`이다. `ViewMode`의 `"calendar"` 값과
`CalendarView`·`.task-calendar`·`.calendar-grid` 같은 내부 이름은 그대로 두었다.

타임라인은 보드가 쓰는 완료 3건 절단 목록을 더 이상 받지 않는다. `workflow.items.tasks`에 검색어·상태
필터만 적용한 `timelineTasks`를 받아 완료 작업을 전부 다룬다. 요약줄도 보기에 따라 갈라져서, 보드·
리스트에서는 "완료는 최근 3개만 표시", 타임라인에서는 "완료 작업까지 전부 표시"라고 말한다.

보드·리스트는 한 줄도 바뀌지 않았다. `due_at`은 계약에서 선택 필드로 남고 카드·표의 목표일 표시도
그대로다. 백엔드·타입·규칙 자산은 무변경이다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src/features/projects/components/DevelopmentBoard.tsx` | `eventKinds` 상수, `timelineTasks` 메모, 요약줄 분기, 보기 라벨·안내 문구, `CalendarView` 재작성, `groupEventsByDate`·`countEventKinds`·`eventDateKey` 신설 |
| `src/features/projects/components/DevelopmentBoard.test.tsx` | 목표일 배치 테스트 1건 교체, 타임라인 테스트 7건 추가, `dayCell`·`localDateKeyOf` 헬퍼 |
| `src/App.css` | `.calendar-count` 칩 규칙 신설, `.calendar-task`·`.unscheduled-tasks` 규칙 삭제 |
| `docs/file-contract.md` | `due_at` 설명에서 캘린더 배치 문장 삭제 |
| `.workflow/…/tasks/TASK-024.md` | `todo` → `in_progress` → `qa_waiting`, `history` 항목 |
| `.workflow/…/reports/REPORT-TASK-024-DEV.md` | 신규 |
| `.workflow/.runtime/leases/TASK-024.yml` | 선점 후 반납 |
| `docs/development-logs/2026-08-03.md` | 세션 기록 한 절 |

작업 문서의 범위 그대로다. 백엔드(`src-tauri/`)·`types.ts`·`.workflow/rules/`는 한 줄도 건드리지
않았다.

## 설계 판단

- **이벤트용 날짜 키를 새 헬퍼로 만들었다.** `calendarDateKey`는 문자열 앞 10자를 정규식으로 떼는
  방식이라 날짜(`due_at`)에는 맞지만 순간(`at`)에는 틀린다. `2026-08-02T23:00:00Z`는 한국에서 8월 3일이다.
  `eventDateKey`는 `new Date(at)`을 만들어 기존 `localDateKey`에 넘긴다. `calendarDateKey`와
  `formatDueDate`는 보드·리스트가 계속 쓰므로 그대로 남겼다.
- **칩 색을 상태(`status`)가 아니라 이벤트 종류(`kind`)에 걸었다.** 기존 `.calendar-task
  .status-border-*`는 작업 카드용이라 이벤트 종류 여섯과 값이 일대일로 맞지 않는다(`created`·
  `revision_requested`가 없다). 같은 색값을 쓰되 `.calendar-count.event-<kind>`로 새로 정의해서, 화면이
  칠하는 근거가 무엇인지 클래스 이름에 드러나게 했다.
- **`.calendar-task` CSS를 지웠다.** 이 세션의 변경으로 마크업에서 사라져 죽은 규칙이다. `.calendar-task`는
  저장소 전체에서 이 컴포넌트의 캘린더 칩에만 쓰이고 있었다. TASK-025가 상세 패널에 목록 버튼을
  만들 때는 자기 규칙을 새로 쓰게 된다.
- **`CalendarView`에서 `onOpen` prop을 뺐다.** 칩과 미지정 목록이 사라져 눌 곳이 없어졌고, 남겨 두면
  `noUnusedLocals`로 타입 검사가 깨진다. TASK-025가 날짜 선택 상세를 붙일 때 다시 배선한다.
- **알 수 없는 `kind`는 자연히 빠진다.** `countEventKinds`가 고정된 여섯 종류를 돌며 세므로, 그 밖의
  값은 별도 필터 없이 그려지지 않는다. 방어 코드를 따로 두지 않았다.
- **파싱되지 않는 `at`은 그 이벤트만 버린다.** `eventDateKey`가 `null`을 돌려주면 그 항목만 건너뛴다.
  작업 전체나 화면이 사라지지 않는다.
- **`TimelineEvent`가 `at`과 `item`을 함께 들고 있다.** 이 작업의 화면은 `kind`만 세지만, 작업 문서가
  지정한 구조가 `(작업, 이벤트)` 쌍이고 TASK-025의 상세 패널이 이 둘을 그대로 쓴다. 지금 버리면
  다음 작업이 그룹화를 다시 쓰게 된다.
- **`timelineTasks`를 `filteredTasks`와 나란히 두었다.** `tasksForDevelopment`(완료 3건 절단)는
  보드·리스트 몫으로 남기고, 타임라인만 원본 목록에 필터를 건다. 절단 로직 자체는 손대지 않았다.
- **요약줄은 보기 상태로 갈랐다.** 문구를 하나로 합치거나 절단 규칙을 통일하는 대신, 각 보기가 실제로
  보여 주는 범위를 그대로 말하게 했다. 기획서 완료 조건 21이 요구하는 것이 이것이다.

## 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | 전이 이벤트 시각으로 배치, `due_at` 없는 작업도 칸에 나타남 (기획서 1) | 충족. `places tasks on the timeline by transition time instead of due_at`(`dueAt: null` + `in_progress` 이벤트) |
| 2 | "일정 미지정"·`due_at` 안내 제거, 헤더 기준 표기 교체 (기획서 2) | 충족. `drops the due_at placement wording from the timeline header` |
| 3 | 보드·리스트 목표일 표시와 `due_at` 계약 유지, 기존 테스트 무수정 통과 (기획서 3) | 충족. `formatDueDate`·`calendarDateKey` 유지, 목표일·필터·QA 테스트 8건 무수정 통과 |
| 4 | 하루 칸이 종류·건수를 보여주고 칸이 종류 수(최대 6) 이상으로 늘지 않음 (기획서 15) | 충족. `folds a day into one chip per event kind`(이벤트 6건 → 칩 2개, 각 건수 3) |
| 5 | 이벤트 종류가 색 외의 글자로 구분됨 (기획서 16) | 충족. 칩이 `시작`·`QA 대기`·`완료`·`막힘` 등 이름을 글자로 담고, 테스트가 색 클래스가 아니라 글자로 단언한다 |
| 6 | 타임라인은 완료를 자르지 않고 보드는 자름 (기획서 20) | 충족. `keeps every completed task on the timeline while the board still truncates`(완료 4건 → 칩 건수 4, 보드 요약줄 3) |
| 7 | 요약줄 표시 범위 문구가 보기별 사실과 일치 (기획서 21) | 충족. 같은 테스트에서 보드 "3개 표시 · 완료는 최근 3개만 표시" → 타임라인 "4개 표시 · 완료 작업까지 전부 표시" |
| 8 | 검색어·상태 필터가 타임라인에도 적용 | 충족. `narrows timeline events with the shared search and status filters` |
| 9 | `npm run check` 통과 (기획서 23) | 충족 |

추가로 두 건을 못 박았다. `skips unreadable event times and unknown kinds without breaking the grid`는
`at: 어제`와 `kind: 탈락`이 섞여도 남은 이벤트 하나만 그려지고 화면이 살아 있음을 확인한다.
`groups events by the local date of the transition instant`는 `T23:00:00Z` 이벤트가 실행 환경의 로컬
날짜 칸에 들어가고, 로컬 날짜가 UTC 날짜와 다를 때 UTC 날짜 칸은 비어 있음을 확인한다.

## 검증 단계와 결과

```sh
npm run check
npx vitest run src/features/projects/components/DevelopmentBoard.test.tsx   # TZ=Asia/Seoul, TZ=UTC
```

- `npm run check` (typecheck + vitest + vite build) — 13 파일 171 passed / 0 failed, 빌드 성공.
  직전 세션 기록의 165에서 교체 1건(−1)과 신규 7건(+7)을 반영한 수와 맞는다.
- 로컬 날짜 묶음은 타임존을 바꿔 두 번 돌렸다. `TZ=Asia/Seoul` 15 passed, `TZ=UTC` 15 passed.
  서울에서는 `T23:00:00Z` 이벤트가 다음 날 칸으로 가고 UTC 날짜 칸이 비는 경로가, UTC에서는 같은 칸에
  머무는 경로가 실행된다. 단언은 `todayKey`와 같은 방식으로 실행 환경에서 계산한다.
- 백엔드는 무변경이라 `cargo` 명령은 돌리지 않았다.
- 삭제하거나 비활성화하거나 단언을 약화한 테스트 없음. 교체한 한 건
  (`places due tasks on the calendar and preserves unscheduled tasks`)은 "일정 미지정"과 목표일 배치를
  검증하던 테스트로, 이 기획이 없애기로 한 동작을 지키고 있어 새 기준에서는 성립하지 않는다.
- 앱 GUI 수동 확인은 하지 않았다. 아래 사용자 QA 절차로 넘긴다.

## 사용자 QA 절차

이 저장소의 실제 데이터로 확인할 수 있다. 앱을 띄우고 개발 작업 → **타임라인**을 연다.

1. **하루 칸 집계.** 8월 2일 칸에 `완료 13`이 보여야 한다. 이 저장소의 QA 결정 13건이 전부
   `2026-08-02T04:16Z`~`14:57Z`이고, TASK-023이 이것을 완료 이벤트로 병합한다. 같은 칸에 TASK-023이
   남긴 `시작` 1건이 함께 보일 수 있다(한국 시간 기준 8월 3일 08:53이면 3일 칸이다).
2. **칩이 넘치지 않는다.** 13건이 한 칸에 있어도 칩은 종류 수만큼이고, 그 칸이 다른 칸보다 높아지지
   않아야 한다. 그리드가 무너지지 않는지 본다.
3. **글자로 읽힌다.** 칩에 `완료`·`시작`처럼 종류 이름이 적혀 있고 건수가 오른쪽에 붙는다. 색만 다른
   칩이 아니어야 한다.
4. **일정 미지정이 없다.** 그리드 아래에 "일정 미지정" 상자가 없어야 하고, 헤더 오른쪽이
   `상태 전이 기록 기준`이어야 한다. 보기 전환 버튼도 `타임라인`이다.
5. **빈 달.** 이전 달(7월)로 넘기면 칸이 전부 비어 있고 그리드 모양은 그대로여야 한다. 이때 "이 달에
   기록이 없다"는 안내는 **아직 없다** — TASK-025 몫이다.
6. **필터.** 상태 필터를 `완료`로 바꾸면 완료 작업의 이벤트만 남는다. 검색어를 넣으면 그 작업의
   이벤트만 남는다. 요약줄이 "…개 표시 · 완료 작업까지 전부 표시"로 바뀌어 있어야 한다.
7. **보드 회귀.** 보드로 돌아가 완료 열이 여전히 3장인지, 카드 아래 목표일 자리가 그대로인지,
   요약줄이 "완료는 최근 3개만 표시"로 되돌아오는지 본다. 리스트의 목표일 열도 그대로다.

문서를 바꾸지 않는 읽기 전용 확인이라 원복할 것이 없다.

## 다음 작업자에게

- 다음은 TASK-025(날짜 선택 상세와 빈 상태 안내)다. `groupEventsByDate`가 돌려주는
  `Map<string, TimelineEvent[]>`가 그 작업이 쓸 재료다. `TimelineEvent`는 `{ at, kind, item }`이라
  시간순 정렬과 작업 상세 이동에 필요한 것이 이미 다 들어 있다.
- `CalendarView`의 `onOpen` prop을 이 세션이 뺐다. 상세 패널에서 작업을 열려면 다시 붙여야 한다.
  `DevelopmentBoard`의 `openTask`(`:56`)는 그대로 있다.
- 저장소가 이벤트를 시각 오름차순으로 정렬해 넘기므로(TASK-023 기록), 하루 안 정렬을 다시 할 필요는
  없다. 다만 `groupEventsByDate`는 작업 단위로 순회하며 넣으므로 **날짜별 배열 안에서는 작업 순서**다.
  시간순 상세가 필요하면 그 배열을 `at` 기준으로 한 번 정렬해야 한다.
- `.unscheduled-tasks` CSS 자리는 비워 두었다(`App.css`의 캘린더 블록 끝). TASK-025가 상세 패널
  규칙을 그 자리에 쓰면 된다.
- 이력이 없어 타임라인에 한 번도 안 나타나는 작업이 지금도 다수다(TASK-014~021, 026 등). SPEC-007
  완료 조건 13의 안내는 TASK-025에서 실제로 필요하다.

## 후속 / 리스크

- **7월 이전은 사실상 빈 화면이다.** 이 저장소의 이벤트는 8월 2일에 몰려 있다. 기획이 의도한 결과
  (소급 추정 금지)지만, 사용자가 처음 열면 "한 칸에만 몰려 있는 화면"으로 보인다. 빈 달 안내가 붙는
  TASK-025까지 가야 화면이 완성된다.
- **하루 칸의 집계는 눌러도 아무 일이 없다.** 지금은 칩이 `<span>`이라 상세로 가는 경로가 없다.
  TASK-024의 범위대로이고 TASK-025가 채운다. 그 사이에는 타임라인에서 작업을 열 수 없다.
- **한 칸 칩이 여섯 개면 세로로 쌓인다.** 칸 `min-height`는 102px이고 칩 하나가 약 20px이라 여섯이
  모두 있는 날은 칸이 조금 늘 수 있다. 종류 수 상한이 있어 무한히 늘지는 않지만, 실제로 여섯 종류가
  하루에 다 찍히는 날이 생기면 레이아웃을 다시 볼 값이다.
- 역할 밖 발견 (수정하지 않음):
  - 작업 트리에 이 작업 이전부터 커밋되지 않은 변경(SPEC-005~009 산출물)이 걸쳐 있다. 이 세션은 위
    표의 파일만 건드렸다.
  - `docs/development-logs/2026-07-31.md`에 "일정 미지정" 기준을 설명한 옛 기록이 남아 있다. 지난
    세션의 사실 기록이므로 그대로 두었다.
  - `heartbeat_roles.rs`·`heartbeat_status.rs` 첫머리의 `#![allow(dead_code)]` 주석이 실제와 어긋난
    채 그대로다. REPORT-TASK-014~017·022·023-DEV가 이미 적었다.
