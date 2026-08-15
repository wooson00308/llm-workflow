---
schema: workflow-labs/task@1
id: TASK-020
title: 연동 카드에 접기·펼치기 토글과 접힘 요약을 더한다
status: verified
source_spec_id: SPEC-006
source_decision_id: DECISION-E8A3CB27
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T02:31:11.179691+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-E8A3CB27
work_group_revision: 1
---

# 연동 카드에 접기·펼치기 토글과 접힘 요약을 더한다

SPEC-006 R4·R5·R7을 구현한다. 카드 골격에 펼침/닫기 토글을 두고, 접힌 상태에서도 연동 이름·상태 배지와
"봐야 할 것이 있다"는 사실이 보이게 한다. 접기가 편집 중인 폼 값을 잃게 해서는 안 된다.

기본값은 접힘이다(R6 앞 절). 이 작업의 상태는 화면 안에만 있고, 앱을 다시 열면 초기값으로 돌아간다.
그 상태를 기억하는 것은 TASK-021의 몫이다.

## 의존성

- **선행 필수: TASK-019.** 토글은 전용 뷰의 카드에 붙는다. 뷰가 없는 상태에서 골격만 고치면 이관되는
  테스트가 두 곳으로 갈라진다.
- 후속: TASK-021이 이 작업이 만든 상태의 초기값과 저장만 바꾼다.
- TASK-019·TASK-021과 병행 금지. 같은 파일을 만진다.

## 범위

- `src/features/projects/components/integrations/IntegrationCard.tsx` — 토글 버튼, 접힘 요약,
  본문 감추기, props 추가.
- `src/features/projects/components/integrations/IntegrationsView.tsx` — 카드별 펼침 상태 보유와 전달.
- `src/features/projects/components/integrations/HeartbeatCard.tsx`,
  `src/features/projects/components/integrations/DreamCard.tsx` — 받은 props를 골격에 그대로 넘기는
  전달만. 본문 로직은 건드리지 않는다.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx`,
  `src/features/projects/components/integrations/DreamCard.test.tsx` — 접힘으로 바뀐 기본값에 맞춘
  최소 수정과 신규 케이스.
- `src/App.css` — 토글·요약 스타일.
- 그 외 파일은 건드리지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **접기는 언마운트가 아니다.** 폼 상태는 `HeartbeatRoleJobs`(`HeartbeatCard.tsx:187`~)와
  `DreamJob`(`DreamCard.tsx:190`~)의 `useState`에 있다. 접을 때 `children`을 조건부 렌더에서 빼면 두
  컴포넌트가 언마운트되어 편집값·확인 단계·입력 오류가 전부 사라진다. R7이 금지하는 것이 정확히 이것이다.
  본문은 DOM에 남긴 채 감춘다(`hidden` 속성 또는 그에 상응하는 방식). 어떤 방식을 골랐든 접었다 펴서
  값이 남는 것을 테스트로 증명한다.
- 골격은 어느 연동인지 모른다(`IntegrationCard.tsx:57` 주석). 토글도 요약도 연동 이름을 알지 않고
  동작해야 한다. 새 연동이 늘어도 이 파일은 고치지 않는 현행 성질을 유지한다.
- 배지 문구와 판정은 바꾸지 않는다. 접힘 요약이 쓰는 배지는 지금 `integration-item-head`에 있는 그것
  그대로다(`IntegrationCard.tsx:76`).
- 플랫폼 미지원 경고는 뷰 공통 위치에 있어 카드 접힘과 무관하게 항상 보인다(R5). 이 작업에서 위치를
  옮기지 않는다.

### 1. 토글 (R4)

- 카드 머리(`integration-item-head`)에 펼침/닫기 컨트롤을 둔다. `button`으로 만들고 `aria-expanded`로
  현재 상태를 노출하며, 감춰지는 본문을 `aria-controls`로 가리킨다. 키보드로 조작 가능해야 한다
  (`button`이면 기본으로 만족하지만, 확인하는 테스트를 둔다).
- 토글은 그 카드 하나에만 작용한다. 한 카드를 접어도 다른 카드의 상태는 그대로다.
- 펼침 상태는 골격이 스스로 들지 않는다. `expanded: boolean`과 `onToggleExpanded(): void`를 props로
  받는다. 상태의 주인은 뷰다(2절). 골격이 자기 상태를 들면 TASK-021이 기억을 붙일 자리가 없다.
- `IntegrationCardProps`(`IntegrationCard.tsx:10`)에 같은 두 필드를 더한다. 뷰가 registry를 순회하며
  카드에 넘기고, `HeartbeatCard`·`DreamCard`는 그것을 `IntegrationCard`에 그대로 전달한다.
  `writeError`가 이미 같은 경로로 흐른다(`IntegrationSection.tsx:45` → `HeartbeatCard.tsx:128` →
  본문). 그 방식을 따른다.

### 2. 뷰가 카드별 펼침 상태를 갖는다

- 뷰가 연동 id를 키로 하는 펼침 여부 맵을 `useState`로 들고, 순회하면서 각 카드에 자기 값과 토글
  콜백을 넘긴다.
- 값이 없는 연동은 접힘으로 본다. 초기값은 빈 맵이고, 따라서 첫 화면은 전부 접힘이다(R6 앞 절,
  기획서 완료 조건 12).
- 기억은 연동 단위다. 한 연동을 펼쳐도 다른 연동은 그대로다(R6).

### 3. 접힘 요약 (R5)

접힌 상태에서 보여야 하는 것은 둘이다.

- 연동 이름과 상태 배지. 지금 `integration-item-head`가 이미 한 줄로 그리고 있으므로, 이 줄은 접힘
  여부와 무관하게 항상 렌더한다. 설명(`small`)까지 접을지는 구현 판단에 맡긴다.
- 경고가 하나라도 있으면 그 사실. 골격이 아는 신호는 셋이다: 조회 실패(`error`), 중복 잡
  (`duplicateJobs`), 읽기 실패(`readFailures`). 넷째인 저장 실패(`writeError`)는 지금 연동 본문이
  그리므로 골격이 모른다. 골격 Props에 `writeError: string | null`을 더해 요약 판정에만 쓴다.
  실패 문구를 그리는 자리는 지금처럼 본문에 둔다. 문구를 옮기면 R2(문구 무변경)를 깬다.
- 요약 표시는 상태 배지와 시각적으로 구분되어야 한다(R5). 배지가 "설치됨"인데 경고가 감춰지는 상태가
  있어서는 안 된다. 표현은 아키텍트가 정하지 않고 남겨 둔 항목이 아니다 — 다음으로 정한다:
  상태 배지 옆에 별도 표식을 두고, 보조 기술이 읽을 수 있는 텍스트로 "확인할 경고가 있습니다"에
  해당하는 내용을 준다. 색만으로 구분하지 않는다.
- 경고의 상세(어떤 잡이 중복인지, 어떤 파일을 못 읽었는지)는 펼쳤을 때 보이면 된다. 접힘 요약이
  책임지는 것은 "봐야 할 것이 있다"는 사실까지다.
- 조회 실패(`error`)일 때 골격은 지금 본문 대신 사유 한 줄만 그린다(`IntegrationCard.tsx:79`).
  이 분기에서도 접힘 요약이 성립해야 한다. 배지는 이미 "상태를 읽을 수 없음"이고, 경고 표식이 함께
  보여야 한다.

### 4. 테스트

- 카드가 둘인 상태에서 한쪽을 펼쳐도 다른 쪽은 접힌 채다. 그 반대도 같다. (기획서 완료 조건 8)
- 토글에 `aria-expanded`가 있고 접힘/펼침에 따라 값이 바뀐다. 키보드로 눌러 상태가 바뀐다.
  (기획서 완료 조건 9)
- 접힌 카드에서 연동 이름과 상태 배지가 보인다. (기획서 완료 조건 10)
- 중복 잡·읽기 실패·저장 실패·조회 실패 각각에 대해, 접힌 상태에서 경고가 있다는 사실이 보이고 그
  표시가 상태 배지와 구분된다. (기획서 완료 조건 11)
- 경고가 없는 접힌 카드에는 그 표식이 없다. 있음/없음을 모두 본다.
- 폼 값 보존: 카드를 펼쳐 주기 또는 쿼터를 고친 뒤 접고 다시 펼치면 값이 그대로다.
  (기획서 완료 조건 15) 하트비트 카드와 dream 카드 각각에 둔다.
- 기존 이관 테스트의 기본값 대응: `IntegrationsView.test.tsx`와 `DreamCard.test.tsx`의 상당수가 본문
  내용을 바로 단언한다. 기본이 접힘으로 바뀌어도 본문은 DOM에 남으므로 `toHaveTextContent` 계열은
  대체로 그대로 통과하지만, 접근성 질의(`getByRole`·`getByLabelText`)는 `hidden` 처리 방식에 따라
  결과가 달라진다. 단언 내용을 바꾸지 말고, 필요한 케이스에서 카드를 먼저 펼치는 준비 동작을 더하는
  방향으로 맞춘다. 케이스를 지우거나 건너뛰지 않는다.

## 완료 조건

1. 각 카드의 토글로 그 카드만 접히고 펼쳐진다. (기획서 완료 조건 8)
2. 토글을 키보드로 조작할 수 있고 펼침 여부가 `aria-expanded`로 노출된다. (기획서 완료 조건 9)
3. 접힌 카드에서 연동 이름과 상태 배지가 보인다. (기획서 완료 조건 10)
4. 조회 실패·중복 잡·읽기 실패·저장 실패 각각에서, 접힌 상태에 경고가 있다는 사실이 보이고 상태 배지와
   구분된다. 색만으로 구분하지 않는다. (기획서 완료 조건 11)
5. 저장하지 않은 폼 값이 있는 카드를 접었다 펼치면 값이 그대로 남는다. 두 카드 모두에 대한 테스트가
   있고 통과한다. (기획서 완료 조건 15)
6. 한 번도 조작하지 않은 카드는 접힌 상태로 시작한다. (기획서 완료 조건 12의 화면 쪽 절반)
7. 골격(`IntegrationCard.tsx`)이 특정 연동의 id나 문구를 알지 않는다. registry에 항목을 더하는 것만으로
   새 연동이 토글과 요약을 갖는다.
8. 카드 본문의 문구와 판정이 바뀌지 않았다. 이관된 테스트가 단언 변경 없이 통과한다.
9. `npm run check`가 통과한다. (기획서 완료 조건 16)

## 검증 절차

```sh
npm run check
```

화면에서 확인한다.

- 연동 뷰를 처음 열면 두 카드가 모두 접혀 있고, 각각의 이름과 배지가 보인다.
- 한쪽을 펼쳐도 다른 쪽은 접힌 채다.
- Tab으로 토글에 도달해 Enter/Space로 접고 펼 수 있다.
- 주기 값을 고친 뒤 접었다 펴면 고친 값이 그대로다. 저장하지 않았는데 값이 되돌아가면 실패다.
- 경고가 있는 상태를 만들어 접는다. 관리 블록 밖에 같은 프로젝트의 역할 잡을 하나 두면 중복 잡 경고가
  뜬다. 접힌 상태에서 경고가 있다는 것이 보여야 한다.

## 범위 밖

- 접힘 상태의 저장·복원. TASK-021이 한다.
- 카드 본문의 내용·문구, 배지 판정 규칙, 경고 판정 규칙 변경.
- 저장 실패 문구를 카드 머리로 옮기는 것. 요약은 사실만 알리고 문구는 본문에 남는다.
- 전체 펼치기/접기 같은 일괄 조작, 카드 정렬·검색·필터. (기획서 제외 범위)
- 펼침 애니메이션. 요구되지 않았다.
- 플랫폼 미지원 경고의 위치 변경.

## 참고 사실

확인 시점 2026-08-02. 추정 없이 실측한 값이다. 줄 번호는 TASK-019 이전 기준이므로, 이 작업 시작 시점의
파일을 다시 확인한다.

- 골격은 `IntegrationCard.tsx:60`이고, 머리 줄은 `:74`, 배지는 `:76`이다. 배지 대체값
  `unknownBadge`·`pendingBadge`는 `:51`~`:52`에 있다.
- 본문·중복 잡 경고·읽기 실패 목록은 `!error && badge` 분기(`:82`) 안에 함께 있다. 접힘이 감춰야 하는
  범위가 이 분기의 내용이다.
- 폼 상태는 `HeartbeatCard.tsx:187`~`:196`(`seeded`·`form`·`customModel`·`specified`·`errors`·
  `confirming`·`saving`)과 `DreamCard.tsx:190`~`:199`에 있다. 전부 카드 본문 안쪽 컴포넌트의
  `useState`다. 언마운트되면 전부 사라진다.
- `HeartbeatRoleJobs`는 `key={snapshot.slug}`로 렌더된다(`HeartbeatCard.tsx:160`). 슬러그가 그대로면
  같은 인스턴스가 유지된다.
- 저장 실패 문구는 `HeartbeatCard.tsx:364`와 `DreamCard.tsx:354`가 본문에서 그린다. 골격은 지금
  `writeError`를 받지 않는다.
- `IntegrationCardProps`는 `IntegrationCard.tsx:10`, registry 순회는 `IntegrationSection.tsx:39`
  (TASK-019 이후에는 `IntegrationsView.tsx`)다.
- `.integration-item`·`.integration-item-head` 스타일은 `App.css:582`~`:586`이다.
