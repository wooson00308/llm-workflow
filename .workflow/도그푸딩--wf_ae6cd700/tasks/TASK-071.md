---
schema: workflow-labs/task@1
id: TASK-071
title: 잡 실행 계약과 진행·실패 상태를 워크스페이스 훅에 만든다
status: verified
source_spec_id: SPEC-020
source_decision_id: DECISION-53577F93
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-04T08:52:00Z
  kind: created
- at: 2026-08-04T08:54:30Z
  kind: in_progress
- at: 2026-08-04T09:07:25Z
  kind: qa_waiting
- at: 2026-08-04T11:43:21.540468+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-53577F93
work_group_revision: 1
---

# 잡 실행 계약과 진행·실패 상태를 워크스페이스 훅에 만든다

실행이 진행 중이라는 사실과 실행을 시작하지 못한 사유는 연동 뷰보다 오래 살아야 한다. 연동 뷰는
조건부 렌더라(`WorkspaceShell.tsx:405`) 다른 메뉴를 다녀오면 언마운트되고, R3은 "프로젝트를 바꾸거나
다른 메뉴를 다녀오는 것이 진행 중인 실행을 취소하지 않는다"를 요구한다. 그래서 이 상태의 주인은
`useProjectWorkspace`다. 이 작업은 그 상태와 게이트웨이 계약만 만들고 화면은 손대지 않는다.

## 의존성

- 선행 없음. 아래 범위의 다섯 파일은 지금 열린 어떤 작업의 범위에도 없다.
- TASK-070과 병렬로 진행할 수 있다. 파일이 겹치지 않고, 이 작업은 게이트웨이가 커맨드를 부르는
  자리만 만들기 때문에 Rust 쪽이 아직 없어도 `npm run check`는 통과한다. 커맨드 이름과 인자·오류
  모양은 TASK-070의 "와이어 계약"과 글자까지 같아야 한다.

## 와이어 계약

- 커맨드 이름: `run_heartbeat_job`, 인자 `{ path, jobName }`
- 성공: 값 없음
- 실패: `{ jobName: string, message: string, command: string }`

## 범위

- `src/features/projects/domain/types.ts` — 아래 타입, 게이트웨이 메서드, `IntegrationsState` 필드
  하나.
- `src/features/projects/infrastructure/tauriProjectGateway.ts` — `invoke` 한 건.
- `src/features/projects/application/useProjectWorkspace.ts` — 상태와 액션.
- `src/features/projects/application/useProjectWorkspace.test.ts` — 훅 테스트와 가짜 게이트웨이
  (`gatewayFor`, `:66`)에 새 메서드.
- `src/features/projects/components/WorkspaceShell.test.tsx` — `IntegrationsState` 리터럴 한 줄
  (`:37`)에 새 필드를 채운다. 이 파일에서 그 줄 말고는 아무것도 고치지 않는다.
- **`IntegrationActions`에는 손대지 않는다.** 그 타입의 객체 리터럴이 `IntegrationsView.test.tsx`·
  `DreamCard.test.tsx`·`WorkspaceShell.test.tsx`에 흩어져 있어, 필드를 더하면 지금 TASK-062가 고치고
  있는 파일까지 이 작업이 끌어안는다. 실행은 파일을 쓰지 않으므로 "쓰기 액션 묶음"에 들어갈 값도
  아니다(R1).
- 화면 컴포넌트(`WorkspaceShell.tsx`·`IntegrationsView.tsx`·`IntegrationCard.tsx`·
  `HeartbeatCard.tsx`)와 `App.tsx`는 건드리지 않는다. 배선은 TASK-072가 한다.

## 작업 내용

### 타입

```ts
/** 실행을 시작하지 못했거나 비정상 종료한 사유. 백엔드가 만든 값을 그대로 들고 있는다. */
export interface HeartbeatRunFailure {
  jobName: string;
  message: string;
  /** 사용자가 직접 칠 명령 원문. 화면은 이 문자열을 다시 조립하지 않는다. */
  command: string;
}

/** 앱이 띄운 잡 실행의 진행·실패 상태와 실행 통로. 카드는 이 묶음 하나만 받는다. */
export interface HeartbeatRunControls {
  /** 지금 앱이 띄워 둔 잡 이름. 역할마다 따로 담기므로 한 역할이 다른 역할을 막지 않는다(R3). */
  running: string[];
  /** 마지막 실패 하나. 조회 주기가 지우지 않는다(R6). */
  failure: HeartbeatRunFailure | null;
  run(jobName: string): Promise<boolean>;
}
```

- `ProjectGateway`에 `runHeartbeatJob(path: string, jobName: string): Promise<void>`를 더한다.
- `IntegrationsState`에 `heartbeatRuns: HeartbeatRunControls`를 더한다. 연동 섹션이 한 번에 받는
  값 묶음이라 여기에 실으면 `WorkspaceShell`이 새 prop 없이 그대로 넘길 수 있다. 새 prop을 만들면
  `WorkspaceShell.test.tsx`의 렌더 자리 열넷을 전부 고쳐야 하는데, 그 변경분은 이 기능과 아무
  관계가 없다.

### 훅

- **상태 자체는 `integrations`와 따로 둔다.** 별도 `useState` 하나에 담고, 훅이 값을 돌려줄 때
  `useMemo`로 합쳐서 `integrations.heartbeatRuns`로 내보낸다. 한 객체에 같이 담으면 두 곳이 깨진다.
  `writeIntegration`의 성공 경로가 `setIntegrations({...})`로 통째 교체라 잡 설정 저장이 진행 중
  표시를 지우고, `closeProject`가 `integrations`를 비우는데 실행은 프로젝트를 바꿔도 취소되지
  않아야 한다(R3).
- `closeProject`에서 이 상태를 비우지 않는다. 잡 이름에 프로젝트 slug가 들어 있어 다른 프로젝트의
  카드에는 어차피 그려지지 않고(TASK-072가 이름으로 대조한다), 비우면 실행 중인 잡의 버튼이 다시
  눌리는 상태로 돌아와 겹쳐 실행할 수 있다.
- `run(jobName)`:
  1. 이미 `running`에 있으면 아무것도 하지 않고 `false`. 훅 단의 마지막 방어선이다.
  2. `running`에 잡 이름을 더하고, 이 실행에 한해 `failure`를 지운다(같은 잡을 다시 돌릴 때 지난
     실패가 남아 있으면 안 된다).
  3. `gateway.runHeartbeatJob(project.rootPath, jobName)`을 부른다.
  4. 성공·실패 어느 쪽이든 `finally`에서 `running`에서 그 이름을 뺀다(완료 조건 9).
  5. 실패면 `failure`에 담는다. 백엔드가 준 값이 위 모양이면 그대로 쓰고, 아니면 `message`만
     `messageFrom`으로 만들되 `command`가 빈 문자열이 되지 않게 한다 — 화면이 명령 없이 "직접
     실행하세요"라고 말하면 안 된다.
- 이 액션은 어디에서도 자동으로 불리지 않는다. `useEffect`의 2.5초 주기(`:329`)와 프로젝트 열기
  경로에 실행 호출을 넣지 않는다(R7, 완료 조건 20).

### 테스트

`useProjectWorkspace.test.ts`에 새 describe로 넣는다. 기존 테스트는 이름도 본문도 고치지 않고,
`gatewayFor`에 새 메서드의 기본 구현만 더한다.

## 완료 조건

1. `runHeartbeatJob`이 `run_heartbeat_job` 커맨드를 `{ path, jobName }`으로 부르고, `path`는 열린
   프로젝트의 `rootPath`다. (기획서 완료 조건 21)
2. 실행 중에는 그 잡 이름이 `running`에 있고, 같은 이름으로 다시 부르면 게이트웨이 호출이 늘지
   않는다. (완료 조건 7)
3. 한 잡이 실행 중이어도 다른 잡의 `run`은 게이트웨이를 부른다. (완료 조건 8)
4. 실행이 끝나면 성공·실패 어느 쪽이든 `running`에서 그 이름이 빠진다. (완료 조건 9)
5. 실패하면 `failure`에 백엔드가 준 `jobName`·`message`·`command`가 담긴다. (완료 조건 15·16)
6. 조회가 여러 번 돌아도 `failure`가 지워지지 않는다. 2.5초 주기를 여러 번 태워 확인한다.
   (완료 조건 17)
7. 같은 잡을 다시 실행하면 지난 `failure`가 지워진다.
8. 프로젝트를 열고 조회 주기를 여러 번 태워도 `runHeartbeatJob`이 한 번도 불리지 않는다.
   (완료 조건 20)
9. 실행 경로에서 `installHeartbeatJobs`·`installDreamJob`이 불리지 않는다. (완료 조건 5)
10. `closeProject` 뒤에도 진행 중인 실행이 `running`에 남는다. (R3)
11. 잡 설정 저장이 성공해도 진행 중인 실행 표시가 사라지지 않는다.
12. `IntegrationActions`에 변경분이 없다.
13. 기존 자동화 테스트가 삭제되거나 비활성화되지 않는다. (완료 조건 24)
14. `npm run check`가 통과한다. (완료 조건 25)

## 검증 절차

```sh
npm run check
git diff --stat src/App.tsx src/features/projects/components/integrations   # 비어 있어야 한다
git diff src/features/projects/components/WorkspaceShell.test.tsx           # 한 줄이어야 한다
```

## 범위 밖

- 화면 배선과 카드 UI. TASK-072·TASK-073이 한다.
- `IntegrationActions`·`IntegrationCardProps`의 확장.
- 실행 상태의 영속화. 진행 중 표시는 메모리에만 두고 브라우저 저장소에 쓰지 않는다 — 앱을 다시
  열었을 때 존재하지 않는 실행을 진행 중이라고 말하지 않기 위해서다(R3의 마지막 항목).
- 실행 결과의 판정·추정. 결과는 조회가 실어 오는 `lastRun`뿐이다(R4).
- dream 잡 실행 통로.
