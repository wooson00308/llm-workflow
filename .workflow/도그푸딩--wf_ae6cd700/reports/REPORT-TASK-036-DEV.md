# TASK-036 개발자 핸드오프

- 대상 작업: TASK-036 (아이디어 인박스가 세 상태와 중단 의심을 구분해 보여준다)
- 근거 문서: SPEC-012 R4·R5·R6·R7, DECISION-9B93CEA0 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T09:10Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점(09:02Z) `todo`는 TASK-036~054 열아홉 건. 그중 선행이 충족된 것은 TASK-036·037·040·041·046
  다섯 건이고, 번호가 가장 빠른 TASK-036을 골랐다.
- 선행 TASK-035는 `qa_waiting`이고 이 작업이 읽는 값이 이미 작업 트리에 있다. `types.ts:41`의 `status`
  주석(`inbox`·`drafting`·`adopted`)과 `types.ts:53`의 `stalledSpecIds` 선택 필드를 확인했다.
- `migration.lock` 없음. `.workflow/.runtime/leases`에는 `SPEC-009.yml` 하나뿐이었고 만료 시각이
  01:20Z라 이미 만료 상태다. 남의 lease라 지우지 않았고 대상도 겹치지 않는다.
- 병행 금지 상대 TASK-030·033·034는 모두 `todo`이고 lease가 없다. 동시 작업 세션이 없다.
- 소스 결정 DECISION-9B93CEA0은 `outcome: approved`, `created_by: user`로 유효하다.
- 선점: `leases/TASK-036.yml` 배타 생성(`set -C`) → 즉시 `status: in_progress` + `history` 기록 →
  구현 → `qa_waiting` → lease 반납.

## 요약

인박스 목록 행과 미리보기 배지가 수집됨·반영중·채택 셋을 구분한다. 중단 의심인 아이디어는 행에 붉은
태그가 하나 더 붙고, 미리보기 상단 안내 블록이 걸려 있는 draft 기획서의 문서 id와 사용자가 할 일을
문장으로 말한다. `기획 반영`·`기획서 채택` 두 문구는 화면에서 사라졌다.

## 변경한 파일 (3건, 작업 범위 그대로)

- `src/features/projects/components/IdeaInbox.tsx` — 상태 매핑 4종(`ideaState`·`stateLabels`·
  `stateIcons`·`statePillClasses`)과 `isStalled` 신설, 목록 행을 `IdeaListRow`로 분리, 미리보기
  배지 교체와 `idea-stall-note` 블록 추가.
- `src/features/projects/components/IdeaInbox.test.tsx` — 픽스처 `draftingIdea`·`stalledIdea` 추가,
  기존 `marks ideas already adopted…` 테스트를 상태 3종 테스트로 대체, 총 7건 신설(19건 통과).
- `src/App.css` — `.status-drafting`, `.idea-list-icon.drafting`, `.idea-list-tags`,
  `.idea-state-tag`(+`.drafting`·`.adopted`·`.stalled`), `.idea-stall-note` 추가.
  `.idea-adopted-tag` 삭제(사용처 없음).

범위 밖 파일은 손대지 않았다. `types.ts`·`WorkspaceShell.tsx`·`Icon.tsx`·Rust 코드 무변경.

## 구현 결정

- **화면이 판정을 다시 하지 않는다.** `ideaState`는 `item.status`가 `drafting`·`adopted`면 그대로
  쓰고 나머지는 전부 `inbox`로 떨어뜨린다. `workflow.items.specs`도 lease도 읽지 않는다
  (`grep`으로 확인). 옛 payload의 알 수 없는 `status`가 와도 수집됨으로 그려진다.
- **목록 행을 `IdeaListRow`로 뽑았다.** 상태 분기가 세 군데(아이콘 클래스·아이콘 이름·태그)로 늘면서
  인라인 JSX가 읽히지 않아서다. props는 `item`·`onSelect`·`selected` 셋뿐이고 동작은 그대로다.
- **중단 의심 태그 조건을 `isStalled(item)` 단독으로 뒀다.** 작업 지시는 "반영중 태그 옆에"라고 썼지만
  완료 조건 4번은 상태 조건 없이 "`stalledSpecIds`가 비어 있지 않으면 보인다"이다. 지금 백엔드는 반영중일
  때만 이 값을 채우므로 실제 화면은 같고, 계약이 어긋난 payload가 와도 경고가 사라지지 않는다.
- **아이콘 클래스에 `inbox`도 붙였다.** `.idea-list-icon.inbox`에 대응하는 CSS 규칙은 만들지 않았다
  (기본 호박색 그대로). 세 상태의 클래스 문자열이 서로 달라져 테스트가 아이콘 구분을 클래스로 확인한다.
- **태그 두 개는 `.idea-list-tags` flex로 감쌌다.** `.idea-list-meta`가 `display: grid`라 감싸지 않으면
  세로로 쌓인다. 태그가 하나도 없는 수집됨 행에서는 이 `<span>` 자체를 그리지 않아 grid `gap`이
  늘어나지 않게 했다.
- **색은 기존 팔레트에서만 골랐다.** 반영중은 `.status-qa_waiting`의 파랑(`#3f6184`/`#deeaf5`),
  중단 의심은 `.status-rejected`의 붉은색(`#8a3f38`/`#f3dfdc`)이다. 새 색 체계를 만들지 않았다.
- **`aria-live`를 붙이지 않았다.** 2.5초 폴링이 갱신 경로라 값이 바뀔 때마다 스크린리더가 읽는다.

## 검증

```sh
npm run check
```

- `tsc -b` 통과.
- `vitest run` 14파일 254건 전부 통과. 그중 `IdeaInbox.test.tsx` 19건.
- `vite build` 통과.

완료 조건 대응:

| 완료 조건 | 확인 방법 |
| --- | --- |
| 1. 목록 행에서 셋이 구분된다 | `tells the three derived states apart in the list rows` — 태그 `반영중`·`채택` 각 1회, 아이콘 클래스 3종이 서로 다름 |
| 2. 미리보기 배지가 세 문구 | `shows each derived state in the preview badge` — 선택마다 `수집됨`→`반영중`→`채택` |
| 3. `기획 반영` 없음 | `never shows the old adoption wording next to the new state names` — `기획 반영`·`기획서 채택` 둘 다 `null` |
| 4. 중단 의심 표시 | `points at the specifications left behind by a dead session` — 행과 미리보기 양쪽 |
| 5. 정상 반영중에는 없음 | `keeps a live drafting idea free of the stall warning` — `stalledSpecIds: []`에서 `중단 의심`이 `null` |
| 6. 걸린 기획서 id와 할 일 | 같은 테스트에서 `SPEC-013`과 `직접 확인해야 합니다` 확인. id 둘일 때는 `lists every stalled specification` |
| 7. 화면이 판정을 다시 하지 않음 | `IdeaInbox.tsx`에 `items.specs`·`activeLeases`·`lease` 문자열 없음 |
| 8. 새 상호작용 없음 | 추가한 요소는 태그·안내 블록뿐. 필터·정렬·이동 없음 |
| 9. `npm run check` | 위 결과 |

옛 payload 회귀: `renders items from an older payload without the stall field` — `stalledSpecIds` 키가
아예 없는 항목에서도 화면이 그려지고 중단 의심이 없다.

## 화면 확인

수동 확인은 하지 않았다. 작업 지시가 알려준 대로 이 저장소에는 반영중·중단 의심 실물이 없고
(`specs/`에 `draft` 기획서가 없다), 확인하려면 `.workflow` 사본에 실험용 문서를 만들어야 한다.
원본에 실험 문서를 만들지 말라는 지시가 있어 자동화 테스트로만 검증했다. 사용자 QA에서 사본을 띄워
볼 수 있다 — `specs/`에 `status: draft` 기획서를 하나 넣고 `source_idea_id`를 수집됨 아이디어
(`IDEA-08303478`·`IDEA-48EDAF2B`·`IDEA-54B29779`·`IDEA-C95EABD2` 중 하나)로 맞추면 중단 의심이 되고,
`.workflow/.runtime/leases/<그 아이디어 id>.yml`에 미만료 lease를 두면 중단 의심 표시만 사라진다.

## 리스크

- 중단 의심 태그가 붙으면 목록 행의 오른쪽 열이 넓어진다. `.idea-list > button`의
  `grid-template-columns`가 `32px minmax(0, 1fr) auto`라 제목·요약 열이 그만큼 좁아진다. 제목은
  `text-overflow: ellipsis`, 요약은 2줄 클램프라 잘리기만 하고 행 높이는 그대로다.
- 미리보기 안내 블록이 헤더와 본문 사이에 들어가 본문 영역이 그만큼 아래로 밀린다.
  `.idea-preview-body`의 `max-height: 430px`는 건드리지 않았으므로 패널 전체 높이가 늘어난다.
  중단 의심 아이디어를 선택했을 때만이다.

## 핸드오프 노트 (역할 밖 발견)

- `.workflow/.runtime/leases/SPEC-009.yml`이 만료 시각 2026-08-03T01:20Z로 남아 있다. 앱에 lease를
  지우는 경로가 없어 계속 남는다(SPEC-012 확인 사실). 이 세션의 범위가 아니라 손대지 않았다.
- TASK-030·033·034가 `src/App.css`를 공유한다. 이 세션이 추가한 블록은 아이디어 인박스 구역과
  `.status-drafting` 한 줄뿐이라 충돌 지점은 좁지만, 순서를 걸어 둔 이유는 유효하다.
