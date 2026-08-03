---
schema: workflow-labs/task@1
id: TASK-030
title: 카드 골격에 본문 경고 통로를 열고 하트비트 카드가 사용량·소진·대기 경고를 보여준다
status: todo
source_spec_id: SPEC-009
source_decision_id: DECISION-85491D81
updated_at: 2026-08-03T00:45:00Z
history:
  - { at: 2026-08-03T00:45:00Z, kind: created }
---

# 카드 골격에 본문 경고 통로를 열고 하트비트 카드가 사용량·소진·대기 경고를 보여준다

SPEC-009 R1·R2·R4·R5의 화면 몫과 R3의 역할 잡 몫을 구현한다. 연동 카드 골격에 "본문만 아는 경고"를
접힘 요약으로 올리는 통로를 하나 열고, 하트비트 카드가 역할 잡마다 실행 한도 사용량과 소진 여부,
회복 예상 시각, 대기 중일 때의 경고를 보여준다. dream 카드는 TASK-031이 같은 통로를 쓴다.

## 의존성

- **선행 필수: TASK-028.** `JobQuota` payload가 있어야 한다.
- **선행 필수: TASK-029.** `ProjectSummary.pendingWork`가 있어야 한다.
- TASK-028·TASK-029와 병행 금지.
- **TASK-027(SPEC-008)과 병행 금지.** `WorkspaceShell.tsx`와 `App.css`를 같이 만진다.
- **TASK-024·TASK-025(SPEC-007)와 병행 금지.** `App.css`를 같이 만진다.
- 이 작업이 연 통로를 TASK-031이 쓴다. TASK-031보다 먼저 끝나야 한다.

## 범위

- `src/features/projects/domain/types.ts` — `JobQuota`, `PendingRoleWork`, 두 payload의 새 필드.
- `src/features/projects/components/integrations/IntegrationCard.tsx` — 본문 경고 통로.
- `src/features/projects/components/integrations/HeartbeatCard.tsx` — 사용량·소진·경고 표시.
- `src/features/projects/components/integrations/IntegrationsView.tsx` — `pendingWork` 전달.
- `src/features/projects/components/WorkspaceShell.tsx` — `pendingWork` 한 줄 전달.
- `src/App.css` — 사용량 표시 스타일.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 픽스처와 새 테스트.
- 그 외 파일은 건드리지 않는다. `DreamCard.tsx`는 TASK-031 담당이고, 백엔드는 이 작업에서 바뀌지
  않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- 소진만으로는 경고가 아니다(R3). 할 일이 없는 잡의 소진은 루프를 막고 있지 않다. 소진은 사실
  표시(R2)이고, 경고는 소진 **그리고** 대기 물량이 있을 때만이다.
- `lastResult: quota_skipped`를 대기 물량의 근거로 쓰지 않는다(R3). 하트비트가 한도를 조건보다 먼저
  보므로 그 값에는 대기 여부가 담기지 않는다. 지금 카드가 그 값을 "건너뜀 · 실행 한도 도달"로
  번역해 보여주는 것(`HeartbeatCard.tsx:34`)은 그대로 둔다.
- 마이그레이션 락 분기를 화면에 만들지 않는다. TASK-029의 판정이 락 상태에서 세 역할 모두 `false`를
  돌려주므로 경고가 자연히 사라진다(기획서 완료 조건 9).
- 사용량 표시는 마지막 실행 기록 표시를 **대체하지 않고 나란히** 놓는다(R1).
- 관리 블록에 없는 잡에는 아무것도 그리지 않는다(R1). 지금 잡 행이 실행 기록을 `job &&`으로 감싸는
  것과 같은 조건이다(`HeartbeatCard.tsx:587`).
- 관리 블록을 읽지 못한 상태에서는 잡 목록 자체가 `UnreadableManagedBlock`으로 대체되므로 사용량도
  그려지지 않는다(`:180`~`:189`). 이 경로에 새 분기를 만들지 않고, 그대로 성립한다는 것만 테스트로
  못 박는다(R5, 기획서 완료 조건 13).
- 접힘 요약에 담기는 것은 경고의 **존재**까지다. 상세 문구는 본문에 둔다(SPEC-006이 정한 요약 규약).

### 1. 타입 (`types.ts`)

```ts
/**
 * 잡 하나의 실행 한도 사용량. "값을 모른다"·"한도가 없다"·"기록이 없다"가 서로 다른 값이다.
 * used가 0인 것과 기록이 없는 것을 화면이 같은 것으로 읽으면 안 된다.
 */
export type JobQuota =
  | { kind: "unknown" }
  | { kind: "unlimited"; value: string }
  | { kind: "noRuns"; limit: number; window: string }
  | {
      kind: "counted";
      used: number;
      limit: number;
      window: string;
      exhausted: boolean;
      /** RFC3339. 화면이 로컬 시각으로 바꾼다. 계산할 수 없으면 null이다. */
      recoversAt: string | null;
    };

/** 역할별 대기 물량. 조건 스크립트가 그 역할로 종료 코드 0을 돌려주는 상태가 true다. */
export interface PendingRoleWork {
  planner: boolean;
  architect: boolean;
  developer: boolean;
}
```

- `HeartbeatRoleStatus`에 `quota: JobQuota`, `DreamIntegration`에 `quota: JobQuota`를 더한다(필수).
- `ProjectSummary`에 `pendingWork?: PendingRoleWork`를 더한다. **선택 필드로 둔다.** 백엔드는 늘
  값을 보내지만, `ProjectSummary` 픽스처가 이 작업 범위 밖 테스트 파일 넷에 흩어져 있다
  (`ProjectSetup.test.tsx`·`SettingsView.test.tsx`·`WorkspaceShell.test.tsx`·
  `useProjectWorkspace.test.ts`). `dueAt?`·`events?`가 같은 이유로 선택 필드다. 값이 없으면 "대기
  물량을 모른다"이고, 모르면 경고하지 않는다.
- `WorkflowItemSummary`에 `sourceDecisionId?: string | null`을 더한다. 화면은 쓰지 않지만 백엔드
  payload와 타입을 맞춘다.

### 2. 골격의 본문 경고 통로 (`IntegrationCard.tsx`)

`Props`에 필드 하나를 더한다.

```ts
/**
 * 연동 본문만 아는 경고가 있는지. 골격은 그 경고가 무엇인지 알지 못하고 접힘 요약 판정에만 쓴다.
 * 세 번째 연동이 같은 통로를 그대로 쓴다.
 */
bodyWarning: boolean;
```

`hasWarning`(`:90`)에 `|| bodyWarning`을 더한다. 그 외에는 아무것도 바꾸지 않는다.

**이 파일에 연동 이름도 한도 개념도 들어가면 안 된다**(기획서 완료 조건 11). `quota`·`maxPer`·
`heartbeat`·`dream` 같은 낱말이 이 파일에 나타나면 통로가 아니라 특정 연동을 아는 코드다.

`IntegrationCardProps`(`:11`)에도 필드 하나를 더한다.

```ts
/** 프로젝트의 역할별 대기 물량. 카드가 자기 판정에 쓰고, 섹션은 내용을 들여다보지 않는다. */
pendingWork?: PendingRoleWork;
```

### 3. 배선 (`IntegrationsView.tsx`, `WorkspaceShell.tsx`)

- `IntegrationsView`의 `Props`에 `pendingWork?: PendingRoleWork`를 더하고 각 `Card`에 그대로
  넘긴다. 뷰는 값의 내용을 보지 않는다. `snapshot`을 넘기는 방식과 같다.
- `WorkspaceShell.tsx`의 `IntegrationsView` 렌더(`:386`)에 `pendingWork={project.pendingWork}`
  한 줄을 더한다. 셸은 이미 `project`를 갖고 있으므로 `App.tsx`와 훅은 바뀌지 않는다.

### 4. 하트비트 카드의 사용량 표시 (`HeartbeatCard.tsx`)

잡 행의 실행 기록 블록(`:587`~`:595`) **뒤에**, 같은 `job &&` 조건 아래 사용량 줄을 하나 더한다.
실행 기록 블록은 고치지 않는다.

`JobQuota`의 종류별 표시는 이렇다. 문구를 한 곳(모듈 상단의 작은 함수)에 모아 dream 카드가
TASK-031에서 같은 어법을 쓸 수 있게 한다. 다만 컴포넌트를 공유하지는 않는다 — 두 카드가 각자
자기 잡을 그리는 지금 구조를 유지한다.

- `counted`: `{used}/{limit} · {window} 기준`. 예: `16/16 · 24h 기준`.
  - `exhausted`이면 `실행 한도 도달` 표시를 함께 놓고, 사용량 요소에 소진 상태 클래스를 붙인다.
  - `exhausted`이고 `recoversAt`이 있으면 회복 예상 시각을 함께 보여준다. **로컬 시각으로 바꾸고
    "예상"임을 문구에 남긴다**(R2). 변환은 `DevelopmentBoard.tsx:506`의 `formatDate`와 같은 방식
    (`new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit",
    minute: "2-digit" })`)을 쓴다. 예: `8월 3일 14:20에 1회 여유 (예상)`.
  - `recoversAt`이 `null`이면 시각 문장만 빼고 나머지는 그대로다. 한도가 `0/24h`인 잡에서 그렇게
    된다.
- `noRuns`: `실행 기록 없음 · 한도 {limit}회/{window}`. **`0/{limit}`으로 적지 않는다**(R5).
- `unlimited`: `한도 없음`과 그 이유. 예:
  `한도 없음 — max_per 값 "{value}"의 형식이 올바르지 않아 하트비트가 한도 없는 잡으로 다룹니다.`
  소진 표시도 경고도 그리지 않는다.
- `unknown`: 아무것도 그리지 않는다. 앱이 한도를 모르는 상태이고, 이 값이 나오는 경로에서는 잡 폼
  자체가 그려지지 않는다.

### 5. 대기 중인데 막혀 있을 때의 경고 (R3)

같은 잡 행 안에, 사용량 줄 다음에 `IntegrationWarning`으로 그린다. 조건은
`quota.kind === "counted" && quota.exhausted && pendingWork?.[role] === true` 하나다.

문구에는 넷이 모두 들어가야 한다(R3).

1. 무엇이 대기 중인지 — 역할별 한 낱말까지만. 기획자는 기획할 아이디어, 프로젝트 아키텍트는 작업으로
   분해할 승인 결정, 개발자는 구현할 `todo` 작업이다. **어느 문서인지 목록으로 열거하지 않는다**
   (기획서 제외 범위).
2. 왜 실행되지 않는지 — 실행 한도가 차서 하트비트가 조건 검사 전에 건너뛴다는 사실.
3. 언제 풀리는지 — 회복 예상 시각(있을 때).
4. 한도를 올리려면 어디를 보면 되는지 — 같은 잡 행의 실행 한도 입력 칸과 저장 버튼.

카드가 골격에 넘길 값도 여기서 만든다.

```ts
const bodyWarning = roleOrder.some((role) => quotaWarned(role));
```

`HeartbeatCard`(`:140`)가 `IntegrationCard`에 `bodyWarning={...}`을 넘긴다. 이 계산은
`HeartbeatRoleJobs` 안이 아니라 `HeartbeatCard` 안에서 한다. 골격에 값을 넘기는 것은 카드이고,
필요한 재료(`heartbeat.roles`의 `quota`, `heartbeat.managedJobs`, `pendingWork`)가 모두 그 자리에
있다. 상태를 끌어올리지 않는다.

`snapshot`이 `null`이거나 `heartbeat`가 `null`이면 `bodyWarning`은 `false`다.

### 6. 스타일 (`App.css`)

- `.heartbeat-job-quota`를 `.heartbeat-job-run`(`:605`)과 같은 배치(가로 flex, 줄바꿈 허용, 작은
  글자)로 만든다. 두 줄이 나란히 놓여도 잡 행이 어수선해지지 않아야 한다.
- 소진 표시는 `.heartbeat-run-result.result-failure`(`:608`)가 쓰는 경고색 조합을 따른다. 새 색을
  만들지 않는다.
- 이 작업 때문에 쓰이지 않게 되는 규칙은 없다. 기존 규칙을 고치지 않는다.

### 7. 테스트 (`IntegrationsView.test.tsx`)

`roleStatuses`(`:49`)와 `dream`(`:74`) 픽스처에 `quota` 기본값을 더한다. 기본값은
`{ kind: "unknown" }`이 아니라 **관리 블록이 있는 정상 상태에서 흔한 값**으로 둔다. 기본이 `unknown`이면
새 표시가 대부분의 기존 테스트에서 안 그려져 회귀를 놓친다. `roleStatuses`가 역할별 `quota`를
받도록 인자를 하나 더하고, 기본은 여유 있는 `counted`로 한다.

`renderIntegrations`(`:123`)에 `pendingWork` 인자를 더한다. 기본값은 세 역할 모두 `false`다.

새 테스트:

- 관리 블록에 있는 역할 잡마다 `사용/한도 · 창 기준` 표시가 보이고, 마지막 실행 기록 표시도 함께
  남아 있다. (기획서 완료 조건 1)
- 한도 값이 관리 블록의 값과 같다. 앱 기본값(`4/24h`)이 아닌 값을 픽스처로 주고 화면에서 확인한다.
  (기획서 완료 조건 3)
- 소진 상태에서 소진 표시와 회복 예상 시각이 함께 보이고, 문구에 "예상"이 들어 있다.
  시각은 `recoversAt`을 로컬로 바꾼 값이다. (기획서 완료 조건 4)
- 소진이면서 그 역할의 `pendingWork`가 `true`이면 경고가 보인다. `false`이면 사실 표시만 있고
  경고는 없다. (기획서 완료 조건 5)
- `lastResult: quota_skipped`이고 `pendingWork`가 `false`인 상태에서 경고가 없다.
  (기획서 완료 조건 7)
- `pendingWork`가 `undefined`(값을 모름)이면 경고가 없다.
- 세 역할 모두 `pendingWork`가 `false`인 상태 — TASK-029가 마이그레이션 락에서 만드는 값 — 에서
  소진이어도 경고가 없다. (기획서 완료 조건 9의 화면 몫)
- 접힘 요약: 기존 `it.each`의 "골격이 아는 경고 신호 넷"(`:1176`)에 다섯 번째 항목으로 "한도 소진 +
  대기 물량"을 더한다. 접힌 카드에 `확인할 경고가 있습니다`가 보이고 상태 배지와는 다른 요소다.
  (기획서 완료 조건 10, 11)
- 소진이지만 대기 물량이 없으면 접힘 요약에 경고 표시가 없다.
- `noRuns`에서 `실행 기록 없음`이 보이고 `0/`으로 시작하는 사용량 표시가 없다.
  (기획서 완료 조건 12)
- 관리 블록 읽기 실패 상태에서 사용량 표시가 하나도 없다. (기획서 완료 조건 13)
- `unlimited`에서 `한도 없음`이 보이고 소진 표시와 경고가 없다. (기획서 완료 조건 14)
- `used`가 `limit`보다 큰 값이어도 오류 없이 소진으로 그려진다. (기획서 완료 조건 15)
- 관리 블록에 없는 역할 잡에는 사용량 표시가 없다.

## 완료 조건

1. 관리 블록에 설치된 역할 잡마다 사용 횟수·한도 횟수·창 길이가 보이고, 기존 마지막 실행 기록
   표시가 그대로 남는다. (기획서 완료 조건 1)
2. 화면의 한도 값이 관리 블록의 값이다. (기획서 완료 조건 3)
3. 소진 상태에 소진 표시와 회복 예상 시각이 함께 보이고, 시각이 로컬 시각이며 "예상"임이 문구에
   드러난다. (기획서 완료 조건 4)
4. 소진이면서 그 역할의 대기 물량이 있을 때만 경고가 보인다. 대기 물량이 없으면 사실 표시에
   그친다. (기획서 완료 조건 5, 7)
5. 경고 문구에 대기 대상·원인·회복 시각·한도를 올리는 자리가 모두 들어 있다. (R3)
6. 대기 물량이 세 역할 모두 없는 상태에서는 소진이어도 경고가 없다. (기획서 완료 조건 9의 화면 몫)
7. 경고가 있으면 카드가 접혀 있어도 경고가 있다는 표시가 보인다. (기획서 완료 조건 10)
8. `IntegrationCard.tsx`에 연동 이름도 한도 개념도 나타나지 않고, 본문이 넘기는 불리언 하나로
   요약 경고가 켜진다. (기획서 완료 조건 11의 골격 몫)
9. 실행 기록이 없으면 `0`이 아니라 "실행 기록 없음"으로 보인다. (기획서 완료 조건 12)
10. 관리 블록을 읽지 못한 상태에서 사용량 표시가 없다. (기획서 완료 조건 13)
11. `max_per` 형식이 깨진 잡이 "한도 없음"으로 보이고 소진 표시·경고가 없다. (기획서 완료 조건 14)
12. 사용 횟수가 한도보다 커도 오류 없이 소진으로 보인다. (기획서 완료 조건 15)
13. SPEC-002~SPEC-006 계열의 기존 프런트 테스트가 통과한다. 삭제·비활성화된 테스트가 없다.
    (기획서 완료 조건 18)
14. `npm run check`가 통과한다. (기획서 완료 조건 19)

## 검증 절차

```sh
npm run check
```

앱에서 확인한다. 이 저장소의 실제 상태로 확인할 수 있다.

- 연동 화면에서 claude-heartbeat 카드를 펼쳐 역할 잡 셋의 사용량이 보이는지 본다. 지금 관리 블록의
  값은 기획자·아키텍트 `8/24h`, 개발자 `24/24h`다.
- `~/.claude/heartbeat/state.json`의 개발자 잡 `recent_runs`가 17개다. 창 안 개수가 배열 길이와
  다르게 나오는지 본다.
- 개발자 잡의 실행 한도를 일시적으로 낮춰(예: `1/24h`) 저장한 뒤 소진 표시와 회복 예상 시각이
  나오는지, 그 상태에서 `todo` 작업이 있으면 경고까지 뜨는지 본다. 확인 후 값을 되돌린다.
- 카드를 접어 요약에 경고 표시가 남는지 본다.
- `.workflow/.runtime/migration.lock`을 잠깐 만들어 경고가 사라지는지 본다. 확인 후 지운다.

## 범위 밖

- `DreamCard.tsx`의 어떤 변경도. TASK-031이다.
- 백엔드의 어떤 변경도. TASK-028·TASK-029다.
- OS 알림·배지·소리. 이번 범위는 연동 화면 안의 표시다(기획서 제외 범위).
- 사용량 이력 그래프, 실행 로그 열람.
- 어느 문서가 대기 중인지 목록화(기획서 제외 범위).
- 한도 편집 경로 변경. 지금의 입력 칸과 저장 버튼 그대로다.
- 카드 상단에 잡 목록을 따로 묶는 배치. 확인 필요 3번이 "각 잡 행의 실행 기록 옆"으로 확정됐다.
- `App.tsx`·`useProjectWorkspace.ts` 변경. 셸이 이미 `project`를 갖고 있어 필요 없다.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- 골격이 아는 경고 신호는 넷이다: 섹션 조회 실패, 쓰기 실패, 중복 잡, 읽기 실패
  (`IntegrationCard.tsx:90`~`:91`). 연동 본문이 자기 경고를 이 신호에 얹을 통로가 지금은 없다.
- 그 넷을 확인하는 기존 테스트가 `IntegrationsView.test.tsx:1176`의 `it.each`다. 경고 표시가 상태
  배지와 다른 요소라는 단정도 거기 있다(`:1218`~`:1220`).
- 잡 행의 실행 기록은 `HeartbeatCard.tsx:587`~`:595`이고 `job &&`로 감싸여 있다. 기록이 없으면
  `실행 기록 없음` 한 줄이다(`:594`).
- `runResultLabels`(`:29`)가 `quota_skipped`를 `건너뜀 · 실행 한도 도달`로 번역한다. 마지막 한 번의
  결과일 뿐 사용량·한도·회복 시각은 없다.
- 역할 잡의 앱 기본값은 스냅샷의 `roles[].defaults`에서 온다(`defaultsFrom`, `:103`). 화면에 같은
  값을 상수로 두지 않는 것이 SPEC-005 R5의 규칙이다. 사용량의 한도도 같은 이유로 파일 값을 쓴다.
- 관리 블록 읽기 실패 시 `HeartbeatCard`는 잡 폼 대신 `UnreadableManagedBlock`을 그린다
  (`:180`~`:189`). dream 카드도 같다(`DreamCard.tsx:159`~`:168`).
- `IntegrationsView`가 카드에 넘기는 값은 `actions`·`error`·`expanded`·`onToggleExpanded`·
  `snapshot`·`writeError` 여섯이다(`:62`~`:72`). 뷰는 payload 내용을 보지 않는다.
- `WorkspaceShell`은 `project: ProjectSummary`를 이미 prop으로 받고 있고(`:213` 등에서 사용),
  `IntegrationsView`를 `:386`에서 렌더한다.
- 날짜를 로컬로 바꾸는 선례는 `DevelopmentBoard.tsx:506`의 `formatDate`다.
  `new Intl.DateTimeFormat("ko-KR", …)`을 쓰고 파싱 실패 시 원문을 그대로 돌려준다.
- `ProjectSummary` 픽스처를 만드는 테스트 파일은 넷이다: `ProjectSetup.test.tsx`·
  `SettingsView.test.tsx`·`WorkspaceShell.test.tsx`·`useProjectWorkspace.test.ts`. `pendingWork`를
  필수 필드로 두면 넷이 모두 깨진다.
- `App.css`의 관련 규칙: `.integration-alert`(`:590`), `.integration-note`(`:595`),
  `.heartbeat-job-list > li`(`:600`), `.heartbeat-job-run`(`:605`),
  `.heartbeat-run-result`(`:606`~`:608`), `.integration-warning`(`:622`~`:625`).
- 이 저장소에 eslint·biome 설정이 없다. `npm run check`는 `tsc -b` + `vitest run` + `vite build`다.
