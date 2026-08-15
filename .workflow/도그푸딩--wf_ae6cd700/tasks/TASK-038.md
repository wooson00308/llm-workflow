---
schema: workflow-labs/task@1
id: TASK-038
title: 작업 상세가 선행 작업과 충족 여부를 보여주고 영원히 열리지 않는 선언을 구분한다
status: verified
source_spec_id: SPEC-013
source_decision_id: DECISION-73D4BC1B
depends_on:
- TASK-037
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T05:05:00Z
  kind: created
- at: 2026-08-03T09:21:03Z
  kind: in_progress
- at: 2026-08-03T09:32:10Z
  kind: qa_waiting
- at: 2026-08-04T11:45:34.169873+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-73D4BC1B
work_group_revision: 1
---

# 작업 상세가 선행 작업과 충족 여부를 보여주고 영원히 열리지 않는 선언을 구분한다

SPEC-013 R5의 화면 몫을 구현한다. TASK-037이 작업 상세 payload에 실어 보내는 선행 판정을 개발 작업
상세 화면에 그린다. 백엔드는 한 줄도 건드리지 않는다.

R5가 이 화면을 요구하는 이유가 본문에 적혀 있다. 의존을 본문 산문에서 프론트매터로 옮기면 상세 화면
에서 사라진다. 기계가 읽을 수 있게 만든 대가로 사람이 못 읽게 되면 안 된다.

## 의존성

- **선행 필수: TASK-037.** 그 작업이 만드는 payload가 없으면 그릴 값이 없다. 프론트매터의
  선행 선언으로 명시했다.
- **SPEC-011 계열 TASK-034와 병행 금지.** 둘 다 `DevelopmentBoard.tsx`와 `App.css`를 만진다.
  TASK-034는 그 파일에 `export` 키워드 하나만 더하지만 같은 파일이다. 순서는 어느 쪽이 먼저여도 된다.
- **`App.css`에서 TASK-030·TASK-033·TASK-036과 병행 금지.** 넷 다 그 파일에 클래스를 더한다. 순서는
  어느 쪽이 먼저여도 된다.
- **`types.ts`에서 TASK-030·TASK-032·TASK-035와 병행 금지.** 순서는 어느 쪽이 먼저여도 된다.

## 범위

- `src/features/projects/domain/types.ts` — `TaskDependency`, `TaskDependencyState`,
  `TaskDocument`의 새 필드 둘.
- `src/features/projects/components/DevelopmentBoard.tsx` — `TaskDetail`의 선행 표시.
- `src/features/projects/components/DevelopmentBoard.test.tsx` — 새 테스트.
- `src/App.css` — 선행 표시에 필요한 클래스.
- 그 외 파일은 건드리지 않는다. 특히 Rust 코드·`WorkspaceShell.tsx`·`Icon.tsx`는 이 작업에서 바뀌지
  않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **표시 위치와 형태는 이 작업이 정한다**(R5 마지막 줄). 기획서가 요구하는 것은 둘뿐이다. 상세에서
  읽을 수 있을 것, 그리고 영원히 충족되지 않는 선언이 드러날 것.
- **새 아이콘을 만들지 않는다.** `Icon.tsx`는 TASK-033(SPEC-011, `todo`)이 만질 예정이라 겹치는 것을
  피한다. 상태 구분은 문구와 색으로 한다.
- **상세 화면의 기존 배치를 다시 짜지 않는다.** 문서 패널과 QA 패널의 2열 구조, 패널 너비 조절은
  TASK-027이 굳혀 놓은 것이다. 이 작업은 문서 패널 안에 블록 하나를 더한다.
- **선행 작업으로 이동하는 동작을 만들지 않는다.** 기획서가 요구하지 않았다. 사용자는 id를 읽고
  목록에서 찾는다.

### 1. 타입

```ts
  export type TaskDependencyState = "satisfied" | "pending" | "missing" | "cyclic";

  export interface TaskDependency {
    id: string;
    state: TaskDependencyState;
  }
```

`TaskDocument`에 필드 둘을 더한다. 백엔드는 항상 실어 보내지만, 이 저장소의 프런트엔드 테스트가
`TaskDocument` 리터럴을 직접 만들고 있어 선택 필드로 둔다. `events`·`dueAt`와 같은 이유다.

```ts
    /** 선언된 선행 작업과 각각의 판정 결과. 선언 순서 그대로다. */
    dependencies?: TaskDependency[];
    /** 선언 줄이 계약 형식이 아니어서 목록으로 읽지 못했는가. 참이면 이 작업은 미충족이다. */
    dependencyFormatError?: boolean;
```

### 2. 상세 화면 표시

`TaskDetail`(`DevelopmentBoard.tsx:193`)의 문서 패널 안, `task-detail-meta` 줄과 본문 사이에 블록
하나를 넣는다. 선언이 없고 형식 오류도 아니면 블록 자체를 그리지 않는다 — 지금 화면과 같아야 한다.

판정값별 표기다. 라벨은 이 파일의 `statusLabels`(`:15`) 어휘와 결이 같아야 한다.

| 판정 | 라벨 | 뜻 |
| --- | --- | --- |
| `satisfied` | 준비됨 | 선행이 QA 대기이거나 완료다 |
| `pending` | 대기 중 | 선행이 아직 그 상태에 이르지 못했다 |
| `missing` | 없는 작업 | 그 id의 작업 문서가 없다 |
| `cyclic` | 순환 선언 | 선언을 따라가면 자기 자신으로 돌아온다 |

- 항목 하나에 작업 id와 라벨을 함께 그린다. 순서는 payload 순서 그대로이고 정렬하지 않는다.
- `missing`·`cyclic`과 형식 오류는 **영원히 충족되지 않는다**는 것이 `pending`과 다른 점이다.
  이 셋에는 경고 톤을 주고, 무엇을 하면 되는지 한 줄로 적는다. "이 선언은 시간이 지나도 풀리지
  않습니다. 작업 문서의 선행 선언을 고쳐야 합니다." 이 문장이 없으면 사용자가 `pending`처럼
  "기다리면 되겠지"로 읽는다(R5, 완료 조건 14).
- 형식 오류일 때는 항목 목록 대신 그 사실만 그린다. 읽지 못한 목록을 지어내지 않는다.
- 블록 머리에 이 작업이 시작 가능한 상태인지 한 줄로 요약한다. 모든 항목이 `satisfied`면 시작 가능,
  아니면 시작할 수 없음이다. 사용자가 항목을 하나씩 읽어 스스로 접지 않아도 되게 한다.
- 클래스 이름은 `task-dependencies`를 뿌리로 쓰고 판정별 수식 클래스를 붙인다. 색은 `App.css`에
  이미 있는 상태 톤(`status-pill` 계열)의 값을 재사용한다. 새 색을 만들지 않는다.

### 3. 테스트

`DevelopmentBoard.test.tsx`에 더한다. 기존 픽스처 만드는 방식을 그대로 따른다.

- 선언이 없는 작업의 상세에 선행 블록이 없다. 지금 화면과 같다.
- 선행 둘이 모두 `satisfied`면 두 id와 라벨이 보이고 머리 요약이 시작 가능이다.
- `satisfied`와 `pending`이 섞이면 각 항목이 자기 라벨로 보이고 머리 요약이 시작 불가다.
  (기획서 완료 조건 13)
- `missing`·`cyclic`·형식 오류가 각각 서로 다른 문구로 보이고, 셋 다 영원히 풀리지 않는다는 안내가
  함께 나온다. (기획서 완료 조건 14)
- 형식 오류일 때 항목 목록이 그려지지 않는다.
- 선언 순서가 payload 순서와 같다.

## 완료 조건

1. 선언이 없는 작업의 상세 화면이 이 작업 전과 같다.
2. 선언된 선행 작업의 id와 충족 여부를 상세에서 읽을 수 있고, 충족·미충족이 섞인 경우가 각각의 판정
   으로 구분된다. (기획서 완료 조건 13)
3. 없는 id·순환·형식 오류가 서로 다른 문구로 드러나고, 셋 다 시간이 지나도 풀리지 않는다는 것을
   사용자가 알 수 있다. (기획서 완료 조건 14)
4. 기존 프런트엔드 테스트가 수정 없이 통과한다. 삭제·비활성화된 테스트가 없다.
   (기획서 완료 조건 18)
5. `npm run check`가 통과한다. (기획서 완료 조건 29)

## 검증 절차

```sh
npm run check
```

화면은 앱을 띄워 개발 작업 카드를 열고 확인한다. 이 저장소에는 선행 선언을 가진 작업이 이 작업 문서
하나뿐이므로, 나머지 판정값은 저장소 **사본**에 픽스처를 만들어 확인한다. 원본
`.workflow/도그푸딩--wf_ae6cd700/tasks/`에 실험용 문서를 만들지 않는다 — 그 문서가 다음 세션의 자격
판정과 선점 대상에 섞인다.

## 범위 밖

- 백엔드의 어떤 변경도. payload는 TASK-037이 만든다.
- 목록·보드·리스트에 선행 표시를 얹는 것. R5가 요구하는 것은 상세다.
- 선행 작업으로 이동하는 링크, 의존 그래프 시각화, 임계경로 표시(기획서 제외 범위).
- 화면에서 선언을 편집하는 것. 이 필드는 아키텍트가 문서에 쓴다.
- 조건 스크립트·역할 계약·파일 계약 문서.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `TaskDetail`(`DevelopmentBoard.tsx:193`)은 문서 패널(`task-detail-document`)과 QA
  패널(`task-qa-panel`) 2열이고, 문서 패널 안에 `task-detail-meta` 줄과 `spec-paper embedded` 본문이
  있다(`:255`~`:258`).
- 상세는 `openTask`(`:69`)가 `onReadTask(fileName)`로 받아 온 `TaskDocument`를 그린다. 목록 항목
  (`WorkflowItemSummary`)이 아니다.
- `statusLabels`(`:15`)가 작업 상태 다섯 개의 한국어 라벨이고, 상세 머리와 리스트가 함께 쓴다.
- `TaskDocument`(`src/features/projects/domain/types.ts:48`)는 지금 `summary`와 `body` 둘뿐이다.
- `WorkflowItemSummary`의 `dueAt`·`events`가 선택 필드다(`:36`). 화면 테스트 픽스처가 이 타입 리터럴을
  여러 파일에서 직접 만든다.
- `DevelopmentBoard.test.tsx`가 이미 있다.
