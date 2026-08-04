# TASK-033 개발자 핸드오프

- 대상 작업: TASK-033 (활동 전용 뷰를 신설하고 지금 작업 중 워커와 배너 입구를 만든다)
- 근거 문서: SPEC-011 R1·R2·R3·R4, DECISION-FE4BCCC7 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T07:55Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점(07:45Z) `todo`는 TASK-033~050 열여덟 건. 선행 선언(`depends_on`)이 없는 것은
  TASK-033·034·035·036·037·040·041·046이고, 그중 번호가 가장 빠른 TASK-033을 골랐다.
- `migration.lock` 없음. `.workflow/.runtime/leases`에는 `SPEC-009.yml` 하나뿐이었고 만료 시각이
  01:20Z라 이미 만료 상태였다. 남의 lease라 지우지 않았고 대상도 다르다.
- 선행 TASK-032는 `qa_waiting`이다. 이 작업이 그리는 `heartbeatAt`·`role`이 이미 화면 계약
  (`AgentLeaseSummary`)에 들어와 있음을 `domain/types.ts:76`에서 확인하고 착수했다.
- 병행 금지 상대 확인: TASK-034는 `todo`이고 아무도 선점하지 않았다. TASK-030도 작업 문서가
  쓰인 시점과 달리 지금 `qa_waiting`이라 `WorkspaceShell.tsx`·`App.css`에 동시 작업이 없다.
- 소스 결정 DECISION-FE4BCCC7은 `approved`로 유효하다.
- 선점: `leases/TASK-033.yml` 배타 생성(`set -C`) → 즉시 `status: in_progress` + `history`
  기록 → 구현 → `qa_waiting` → lease 반납.

## 요약

활동 전용 뷰를 새로 만들고 사이드바 여섯 번째 메뉴와 오늘 화면 배너를 그 입구로 연결했다. 뷰의
"지금 작업 중" 섹션이 `project.activeLeases`를 개수 제한 없이 카드로 그린다. 백엔드는 한 줄도
건드리지 않았고, 새 폴링·새 상태 저장소·쓰기 경로를 만들지 않았다.

## 변경한 파일 (6건, 작업 범위 그대로)

- `src/features/projects/components/ActivityView.tsx` — 신규. 뷰 골격, 워커 카드, `resolveTarget`.
- `src/features/projects/components/ActivityView.test.tsx` — 신규. 11개 케이스.
- `src/features/projects/components/WorkspaceShell.tsx` — 뷰 키·`viewLabels`·사이드바 버튼·배너
  버튼화·렌더 분기. 5곳.
- `src/features/projects/components/WorkspaceShell.test.tsx` — 메뉴·배너 테스트 3건 추가.
- `src/shared/ui/Icon.tsx` — `activity` 아이콘 1종 추가(맥박선).
- `src/App.css` — `.agent-activity`의 버튼 전제 보정과 활동 뷰 스타일.

범위 밖 파일은 손대지 않았다. `src-tauri/`·`domain/types.ts`·`DevelopmentBoard.tsx` 무변경.

## 구현 결정

- **배너를 통째로 `button`으로 바꿨다.** 작업 문서가 지시한 대로다. 안에 다른 누를 수 있는 요소가
  없어 중첩 문제가 없고, 키보드 조작(R9)이 따로 붙이는 것 없이 성립한다. "자세히 보기" 문구를
  더해 입구임이 아이콘 없이도 읽히게 했다(완료 조건 3).
- **CSS의 `.agent-activity > span:last-child`를 `.agent-activity-count` 클래스로 바꿨다.**
  입구 표시가 마지막 자식이 되면서 선택자가 다른 요소를 잡게 되기 때문이다. 색·여백 값은 그대로
  옮겼다. 버튼 기본값 위에 다시 적은 것은 `width: 100%`·`text-align: left`·`cursor: pointer`
  셋뿐이다 — `font: inherit`와 `color: inherit`는 App.css 상단(`:23`·`:24`)의 전역 규칙이 이미
  버튼에 준다.
- **남은 시간은 렌더 시점 `Date.now()`로 계산한다.** `setInterval`·`setTimeout`을 쓰지 않았고,
  2.5초 주기 조회의 재렌더가 갱신을 맡는다. 테스트가 `vi.getTimerCount() === 0`으로 고정한다
  (완료 조건 14).
- **만료 표기는 세 갈래다.** 1분 이상은 `N분 남음`, 1분 미만은 "1분 미만 남음", 0 이하는
  "곧 만료". 마지막 갈래를 둔 이유는 주기 조회 사이에 만료가 지나갈 수 있어서다. 이 값에
  `aria-live`를 붙이지 않았다(R9).
- **역할은 값이 있을 때만 그린다.** `planner`·`architect`·`developer`만 한국어로 부르고 그 밖의
  값은 원문 그대로 보여준다. `null`이면 `.worker-role` 요소 자체를 만들지 않는다. `agent`
  문자열에서 역할을 잘라내지 않는다.
- **`resolveTarget`은 선택된 워크플로우를 먼저 본다.** 문서 번호가 워크플로우마다 따로 매겨져
  같은 `SPEC-001`이 둘 이상 있을 수 있어서다. 순서를 정해 두지 않으면 같은 화면이 조회 때마다
  다른 워크플로우를 가리킨다. 한 워크플로우 안에서는 `ideas` → `specs` → `tasks` 고정이다.
- **이동은 `onOpenDocument` 하나로만 나간다.** `WorkspaceShell`이 그것을 `openSearchResult`에
  연결하므로 프로젝트 검색과 같은 경로다(R4 마지막 항목). 활동 뷰는 자기 이동 규칙을 만들지
  않는다. props는 `onOpenDocument`·`project`·`workflow` 셋뿐이고 쓰기 액션이 타입에 없다.
- **해석 실패와 `taskId: null`을 구분해 그린다.** 실패는 식별자만, `null`은 배너와 같은
  "워크플로우 작업" 문구다. 둘 다 누를 수 있는 요소를 만들지 않는다.
- **활동 뷰를 `workflow` 조건 없이 렌더한다.** 위 섹션이 프로젝트 전역이라 워크플로우가 없어도
  그릴 것이 있다. `IntegrationsView`가 이미 같은 자리에 있다.
- **뷰 상단에 활성 워커 수 배지를 뒀다.** 앱의 다른 전용 뷰가 모두 쓰는 `.view-heading` 패턴이고
  CSS가 그 자리를 전제한다. 기획서가 요구한 값은 아니다.

## 검증

```sh
npm run check
```

- `tsc -b` 통과.
- `vitest run` — 14개 파일 236개 테스트 전부 통과. 기존 프론트엔드 테스트는 한 줄도 고치지 않았다
  (WorkspaceShell.test.tsx는 추가만 했다).
- `vite build` 통과.

새로 추가한 테스트가 닫는 완료 조건:

| 테스트 | 기획서 완료 조건 |
| --- | --- |
| 활성 lease 수만큼 카드가 그려진다 | 6 |
| 카드 하나에 네 값이 모두 나타난다 | 7 |
| "시작"·"N분째" 문구가 화면에 없다 | 9 |
| `architect`→아키텍트, `null`→칸 없음, `reviewer`→원문 | 31의 화면 몫 |
| lease가 없으면 빈 상태이고 목록이 없다 | 10 |
| 아이디어·기획서·작업 각각 이동 호출 | 12 |
| 다른 워크플로우 문서의 이름 표시·같은 id는 선택 우선 | 13 |
| 없는 id는 식별자만, 버튼 없음 | 14 |
| `taskId: null`은 "워크플로우 작업" | 15 |
| 남은 시간 세 갈래 + `getTimerCount() === 0` | 27의 화면 몫 |
| 모든 버튼이 `onOpenDocument`로만 나간다 | 25·26의 화면 몫 |
| 사이드바 활동 메뉴·breadcrumb·선택 표시 | 1·2 |
| lease 없으면 배너 없음 | 4 |
| 배너 입구 → 활동 뷰, 대표와 첫 카드가 같은 워커 | 3·5 |

## 사용자 QA에서 봐 주었으면 하는 것

- **화면 확인을 하지 못했다.** 이 세션은 비대화형이라 앱을 띄우지 못했다. 작업 문서의 검증 절차가
  요구한 눈 확인(활동 메뉴 전환, 배너 클릭, 만료 전 lease가 있는 상태와 없는 상태)은 QA에서
  처음 이뤄진다. 이 저장소에는 실제 lease 파일이 `.workflow/.runtime/leases/`에 쌓이므로 재현이
  쉽다.
- **배너 모양이 버튼화로 달라지지 않았는지.** 색·여백 값은 그대로 옮겼지만 요소가 `div`에서
  `button`으로 바뀌었고 오른쪽에 "자세히 보기" 알약이 하나 늘었다. 좁은 창에서 줄이 밀리는지 볼
  가치가 있다.
- **워커 카드 그리드 폭.** `minmax(300px, 1fr)` 자동 채움이라 창 폭에 따라 1~3열이 된다. 카드
  안의 문서 제목은 한 줄로 잘린다(말줄임).
- **활동 메뉴가 주요 메뉴 마지막인 것.** R1이 정한 위치이고 그대로 따랐다. 실제로 눌러 보면
  "오늘"과 성격이 겹쳐 보일 수 있는 자리다.

## 다음 세션에 넘기는 사실

- **TASK-034가 이 뷰 안에 "최근 활동" 섹션을 더한다.** `ActivityView.tsx`와 `App.css`가 겹치므로
  그 작업과 병행하지 않는다. 지금 구조는 `.activity-view` 아래 `.activity-section` 하나이고,
  두 번째 섹션을 그 뒤에 나란히 붙이면 된다. 뷰 상단 배지는 활성 워커 수만 세므로 피드가 들어와도
  의미가 흐려지지 않는다.
- **`kindLabels`·`kindIcons` 상수가 `ProjectSearchDialog.tsx`와 중복된다.** 두 화면이 같은 세
  종류를 같은 말로 부른다. `SearchItemKind`만 export되어 있고 라벨은 아니라 각자 들고 있다.
  TASK-034가 같은 상수를 또 쓰게 되면 그때 한 곳으로 올리는 편이 낫다. 이 작업 범위 밖이라
  건드리지 않았다.
- **읽지 못한 lease 파일이 있다는 사실은 화면에 나타나지 않는다.** 기획서가 다루지 않았고 작업
  문서가 범위 밖으로 못 박았다. 파싱 실패한 lease는 애초에 배열에 오지 않으므로 화면은 그 사실을
  알 방법이 없다.
- **만료된 lease를 "중단됨"으로 알리는 기능은 없다.** 기획서 제외 범위다. 카드의 "곧 만료"는
  주기 조회 사이의 시차를 말하는 것이지 중단 판정이 아니다.
- **작업 범위 밖에서 발견한 것.** `src/App.css`·`domain/types.ts`·`src-tauri/`의 여러 파일과
  `src-tauri/src/infrastructure/role_eligibility.rs`·
  `src/features/projects/infrastructure/jobValueMemoryStore.ts`가 커밋되지 않은 상태로 작업
  트리에 있다. TASK-028~032 계열의 산출물로 보이고 전부 `qa_waiting`이다. 이 세션은 손대지
  않았다.
