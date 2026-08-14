---
schema: workflow-labs/task@1
id: TASK-036
title: 아이디어 인박스가 세 상태와 중단 의심을 구분해 보여준다
status: verified
source_spec_id: SPEC-012
source_decision_id: DECISION-9B93CEA0
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T04:00:00Z
  kind: created
- at: 2026-08-03T09:02:49Z
  kind: in_progress
- at: 2026-08-03T09:10:00Z
  kind: qa_waiting
- at: 2026-08-04T11:45:35.503401+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-9B93CEA0
work_group_revision: 1
---

# 아이디어 인박스가 세 상태와 중단 의심을 구분해 보여준다

SPEC-012의 화면 몫 전부를 구현한다. 목록 행과 미리보기 패널이 수집됨·반영중·채택 셋을 구분해 보여주고,
중단 의심인 아이디어에 걸려 있는 draft 기획서의 문서 id를 짚어 준다. `기획 반영` 태그 문구를 정리한다.

TASK-035가 실어 보내는 값만 읽는다. 새 판정을 화면에서 다시 하지 않는다.

## 의존성

- **TASK-035가 선행이다.** 이 작업이 읽는 `status = "drafting"`과 `stalledSpecIds`를 TASK-035가 만든다.
  그 값 없이는 이 작업의 완료 조건 중 어느 것도 검증할 수 없다.
- **TASK-035와 병행 금지.** TASK-035가 `types.ts`를 바꾸고 이 작업이 그 타입을 읽는다.
- **SPEC-009 계열 TASK-030과 병행 금지.** `src/App.css`가 겹친다. TASK-030은 아직 `todo`다.
- **SPEC-011 계열 TASK-033·TASK-034와 병행 금지.** `src/App.css`가 겹친다. 둘 다 아직 `todo`다.
- SPEC-008의 TASK-027(아이디어 미리보기를 문서 뷰어로 전환)은 `completed`다. DECISION-9B93CEA0이 요구한
  "TASK-027이 만든 화면을 기준으로 분해하라"는 이미 만족돼 있다. 이 작업은 그 문서 뷰어 위에 상태 표시를
  얹는다.

## 범위

- `src/features/projects/components/IdeaInbox.tsx` — 상태 라벨 계산, 목록 행 아이콘·태그, 미리보기 배지,
  중단 의심 표시.
- `src/features/projects/components/IdeaInbox.test.tsx` — 새 테스트.
- `src/App.css` — 반영중·중단 의심 표현에 필요한 클래스.
- 그 외 파일은 건드리지 않는다. 특히 `types.ts`·`WorkspaceShell.tsx`·`Icon.tsx`·Rust 코드는 이 작업에서
  바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **화면이 판정을 다시 하지 않는다**(R6·R7). `stalledSpecIds.length > 0`인지 보는 것 외에 상태를 계산하지
  않는다. `workflow.items.specs`를 뒤져 draft를 세거나 `project.activeLeases`를 읽어 선점을 확인하는 코드를
  쓰지 않는다. 그렇게 하면 목록과 전문 읽기의 결론이 갈릴 수 있고, `IdeaInbox`는 애초에 `project`를 받지도
  않는다(`WorkspaceShell.tsx:366`).
- **상태 이름은 기획서의 말과 같아야 한다**(R4). 화면 문구는 `수집됨`·`반영중`·`채택` 셋이다. 다른 말을
  지어내지 않는다.
- **`기획 반영`이라는 문구를 화면에서 없앤다**(R4, 완료 조건 13). "반영중"과 글자가 겹쳐 같은 화면에서
  뜻이 섞인다.
- **새 상호작용을 만들지 않는다**(기획서 제외 범위). 중단 의심 표시에서 기획서 화면으로 이동하는 동작,
  상태별 필터·정렬·검색을 붙이지 않는다. 문서 id를 읽을 수 있게 하는 것까지가 이 작업의 선이다.
- **아이콘을 새로 만들지 않는다.** `Icon.tsx`는 TASK-033이 만지는 파일이고, 반영중에 쓸 수 있는 아이콘이
  이미 있다(`refresh`).

### 1. 상태 라벨을 한 곳에서 정한다

`IdeaInbox.tsx`에 상태 매핑을 둔다. 목록 행과 미리보기가 같은 값을 쓴다.

```tsx
type IdeaState = "inbox" | "drafting" | "adopted";

/** 백엔드가 파생해 실어 보낸 값이다. 화면이 판정을 다시 하지 않는다(SPEC-012 R6). */
function ideaState(item: WorkflowItemSummary): IdeaState {
  return item.status === "drafting" || item.status === "adopted" ? item.status : "inbox";
}

const stateLabels: Record<IdeaState, string> = {
  inbox: "수집됨",
  drafting: "반영중",
  adopted: "채택",
};

function isStalled(item: WorkflowItemSummary): boolean {
  return (item.stalledSpecIds?.length ?? 0) > 0;
}
```

모르는 `status` 값이 오면 `수집됨`으로 떨어진다. 지금 화면이 `adopted`가 아닌 모든 값을 `수집됨`으로
다루는 것과 같은 성질이라, 옛 payload를 받아도 화면이 깨지지 않는다.

### 2. 목록 행

지금 행은 아이콘 두 종류(`stamp`/`idea`)와 `기획 반영` 태그 하나로 두 상태만 구분한다(`:96`~`:105`).
셋을 구분하게 바꾼다.

- 아이콘: `inbox` → `idea`(현행), `drafting` → `refresh`, `adopted` → `stamp`(현행).
- 아이콘 색: `.idea-list-icon`(현행 호박색) / `.idea-list-icon.drafting`(새로 추가) /
  `.idea-list-icon.adopted`(현행 초록).
- 태그: `inbox`는 태그 없음(현행과 같다), `drafting`은 `반영중`, `adopted`는 `채택`.
  클래스 이름을 `idea-adopted-tag`에서 `idea-state-tag`로 바꾸고 상태별 수식 클래스를 붙인다. 태그가 두
  상태에 붙게 되므로 `adopted` 전용 이름은 더 이상 사실이 아니다.
- 중단 의심: `isStalled`이면 `반영중` 태그 옆에 `중단 의심` 태그를 하나 더 붙인다.
  `.idea-state-tag.stalled`다. 상태 축을 넷으로 늘리지 않고 반영중의 부가 표시로 둔다 —
  DECISION-9B93CEA0이 확인 필요 1번을 그렇게 확정했다.

`.idea-list-meta`가 `display: grid`라 태그가 둘일 때 세로로 쌓인다. 두 태그를 한 줄에 두려면 감싸는
`<span>`을 하나 두고 `display: flex; gap`을 준다. 목록 행의 높이 규칙(`.idea-list button`)은 바꾸지 않는다.

### 3. 미리보기 패널

지금 배지는 `기획서 채택`/`수집됨` 두 문구다(`:148`~`:150`). 셋으로 바꾼다.

- `status-pill`의 수식 클래스: `inbox` → 없음(기본 회색), `drafting` → `status-drafting`(새로 추가),
  `adopted` → `status-approved`(현행 초록).
- 문구는 `stateLabels` 그대로 `수집됨`·`반영중`·`채택`이다.

중단 의심이면 헤더 아래, 본문 위에 안내 블록을 하나 그린다. 문구는 아래 그대로 쓴다. 사용자가 무엇을
해야 하는지가 문장에 있어야 경고가 알림으로 끝나지 않는다(R5).

```tsx
{isStalled(item) && (
  <p className="idea-stall-note">
    <strong>중단 의심</strong>
    <span>
      이 아이디어를 선점한 세션이 없는데 작성 중이던 기획서가 남아 있습니다. 걸린 기획서:{" "}
      {item.stalledSpecIds?.join(", ")}. 자동 처리로 다시 잡히지 않으므로 직접 확인해야 합니다.
    </span>
  </p>
)}
```

마지막 문장은 사실이다. 조건 스크립트의 기획자 자격 판정은 참조가 있는 아이디어를 건너뛰므로(기획서
제외 범위, TASK-035 완료 조건 11) 하트비트가 이 아이디어를 다시 집지 않는다. 이 문장을 빼면 사용자가
"곧 자동으로 처리되겠지"라고 읽는다.

`aria-live`를 붙이지 않는다. 2.5초 폴링이 갱신 경로라 값이 바뀔 때마다 스크린리더가 읽어 버린다.

### 4. CSS

`App.css`의 아이디어 블록(`:246`~`:250`)과 상태 배지 블록(`:224`~`:230`)에 더한다. 기존 팔레트에서
고른다 — 새 색 체계를 만들지 않는다.

- `.idea-list-icon.drafting` — `.status-qa_waiting`의 파랑 계열(`#3f6184` / `#deeaf5`).
- `.idea-state-tag` — 현행 `.idea-adopted-tag`의 모양(`padding: 2px 6px; border-radius: 99px;
  font-size: 11px; font-weight: 700; white-space: nowrap;`)을 이름만 바꿔 옮긴다. 색은 수식 클래스로
  가른다: `.adopted`는 현행 초록(`#286042` / `#dfeee4`), `.drafting`은 파랑(`#3f6184` / `#deeaf5`),
  `.stalled`는 `.status-rejected`의 붉은 계열(`#8a3f38` / `#f3dfdc`).
- `.status-drafting` — `.status-qa_waiting`과 같은 파랑.
- `.idea-stall-note` — 붉은 계열 배경의 얇은 블록. `.idea-preview > header`와 `.idea-preview-body`
  사이에 들어가므로 위아래 여백만 잡고 본문 영역의 스크롤 규칙(`max-height: 430px`)은 건드리지 않는다.

`.idea-adopted-tag`는 이 작업이 쓰지 않게 되므로 지운다. 다른 사용처가 없다.

### 5. 테스트

`IdeaInbox.test.tsx`의 픽스처에 상태별 아이디어를 더한다. 기존 `secondIdea`(`status: "adopted"`)는 그대로
쓰되 문구 기대값을 바꾼다.

- 세 상태의 아이디어가 있는 목록에서 `수집됨`을 뺀 두 태그(`반영중`·`채택`)가 각각 한 번씩 보이고, 세
  행의 아이콘이 서로 다르다. 아이콘은 `.idea-list-icon`의 클래스로 확인한다. (완료 조건 11)
- 세 상태의 아이디어를 각각 선택하면 미리보기 배지가 `수집됨`·`반영중`·`채택`으로 바뀐다.
  (완료 조건 12)
- 어떤 상태 조합에서도 `기획 반영`이라는 문구가 화면에 없다. `queryByText("기획 반영")`이 `null`이다.
  (완료 조건 13)
- `stalledSpecIds: ["SPEC-013"]`인 아이디어의 행에 `중단 의심` 태그가 보이고, 선택하면 미리보기 안내
  블록에 `SPEC-013`이 보인다. (완료 조건 14·16)
- `status: "drafting"`이고 `stalledSpecIds: []`인 아이디어에는 행에도 미리보기에도 `중단 의심`이 없다.
  (완료 조건 15)
- `stalledSpecIds`가 둘이면 두 id가 모두 보인다.
- `stalledSpecIds` 키가 아예 없는 항목(옛 payload)에서도 화면이 그려지고 `중단 의심`이 없다.

## 완료 조건

1. 목록 행에서 수집됨·반영중·채택 셋이 서로 구분된다. (기획서 완료 조건 11)
2. 미리보기 배지가 세 상태를 각각 `수집됨`·`반영중`·`채택`으로 보여준다. (기획서 완료 조건 12)
3. 화면 어디에도 `기획 반영`이라는 문구가 없다. (기획서 완료 조건 13)
4. `stalledSpecIds`가 비어 있지 않은 아이디어에 중단 의심 표시가 보인다. (기획서 완료 조건 14)
5. 반영중이지만 `stalledSpecIds`가 빈 아이디어에는 중단 의심 표시가 없다. (기획서 완료 조건 15)
6. 중단 의심 표시에서 걸린 draft 기획서의 문서 id를 읽을 수 있고, 사용자가 무엇을 해야 하는지 문장으로
   알 수 있다. (기획서 완료 조건 16, R5)
7. 화면이 상태 판정을 다시 하지 않는다. `IdeaInbox.tsx`가 `workflow.items.specs`나 lease를 읽지 않는다.
   (기획서 완료 조건 19의 화면 몫)
8. 상태별 필터·정렬·기획서 이동 같은 새 상호작용이 생기지 않는다.
9. `npm run check`가 통과한다. (기획서 완료 조건 23의 화면 몫)

## 검증 절차

```sh
npm run check
```

화면 확인: 개발 서버를 띄우고 이 저장소 자신의 `.workflow`를 연다. 확인 시점 기준으로 이 저장소에 있는
상태는 둘뿐이다 — 참조 기획서가 없는 아이디어 4건(`IDEA-08303478`·`IDEA-48EDAF2B`·`IDEA-54B29779`·
`IDEA-C95EABD2`)이 수집됨이고, 나머지 12건은 `draft`가 아닌 기획서를 참조해 채택이다(`specs/`에 `draft`
기획서가 하나도 없다). 반영중과 중단 의심은 실물이 없으므로 `.workflow`의 사본을
만들어 확인한다. `specs/`에 `status: draft`인 기획서를 하나 넣고 `source_idea_id`를 수집됨 아이디어로
맞추면 중단 의심이 되고, `.workflow/.runtime/leases/<그 아이디어 id>.yml`에 미만료 lease를 두면 중단 의심
표시만 사라진다. **원본 `.workflow`에 실험용 문서를 만들지 않는다.**

## 범위 밖

- 상태 판정 로직. TASK-035가 만든 값을 읽기만 한다.
- 중단 의심을 네 번째 상태로 두는 것. DECISION-9B93CEA0이 반영중의 부가 표시로 확정했다.
- 중단 의심 표시에서 기획서 화면으로 이동하는 동작. 기획서 제외 범위다.
- 아이디어 목록의 정렬·필터·검색, 상태별 개수 집계.
- 기획서 화면·개발 작업 화면·활동 관련 화면의 상태 표시.
- `Icon.tsx`에 아이콘 추가. 기존 `refresh`를 쓴다.
- 아이디어 전문 읽기 동작과 마크다운 렌더링(TASK-027 범위). 이 작업은 그 위에 상태 표시만 얹는다.
- 반영중이 얼마나 오래됐는지 같은 시간 기준 표시. 기획서 제외 범위다.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- 아이디어 상태를 읽는 화면 코드는 `IdeaInbox.tsx` 두 군데다. 목록 행(`:96`~`:105`)의 아이콘과
  `기획 반영` 태그, 미리보기 헤더(`:148`~`:150`)의 배지다.
- `IdeaInbox`는 `busy`·`disabled`·`onAdd`·`onReadIdea`·`workflow` 다섯 개만 받는다
  (`IdeaInbox.tsx:16`, `WorkspaceShell.tsx:366`). `ProjectSummary`도 `activeLeases`도 받지 않는다.
- 미리보기는 TASK-027 이후 `readIdea`로 전문을 받아 `MarkdownBody`로 그린다(`:49`~`:70`, `:152`~`:162`).
  본문 영역은 `.idea-preview-body`이고 `max-height: 430px`에 자체 스크롤이 있다(`App.css:259`).
- `.idea-list-meta`는 `display: grid; justify-items: end`라 자식이 세로로 쌓인다(`App.css:249`).
- 상태 배지 팔레트는 `App.css:224`~`:230`에 있다. `status-qa_waiting`이 파랑(`#3f6184`/`#deeaf5`),
  `status-rejected`·`status-blocked`가 붉은색(`#8a3f38`/`#f3dfdc`)이다.
- `Icon.tsx`에 있는 아이콘은 14종이고 `refresh`(원형 화살표)가 그중 하나다. TASK-033(SPEC-011, `todo`)이
  이 파일에 `activity`를 더할 예정이다.
- 프론트엔드 테스트 픽스처는 `WorkflowItemSummary` 리터럴을 직접 만든다(`IdeaInbox.test.tsx:6`~`:7`).
  `stalledSpecIds`는 선택 필드라 기존 픽스처가 그대로 유효하다.
- 이 저장소의 `IDEA-C95EABD2`는 사용자가 등록한 회수 정책 아이디어다. 중단 의심 문구가 말하는 "자동
  처리로 다시 잡히지 않는다"는 그 아이디어가 다룰 문제이고 이 작업의 범위가 아니다.
