---
schema: workflow-labs/task@1
id: TASK-072
title: 하트비트 카드의 역할마다 지금 실행 액션과 확인 단계를 만든다
status: verified
source_spec_id: SPEC-020
source_decision_id: DECISION-53577F93
depends_on:
- TASK-062
- TASK-065
- TASK-071
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-04T09:02:00Z
  kind: created
- at: 2026-08-04T09:23:30Z
  kind: in_progress
- at: 2026-08-04T09:41:00Z
  kind: qa_waiting
- at: 2026-08-04T11:42:43.583090+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-53577F93
work_group_revision: 1
---

# 하트비트 카드의 역할마다 지금 실행 액션과 확인 단계를 만든다

TASK-071이 만든 실행 통로를 화면까지 배선하고, 역할마다 그 잡 하나를 지금 실행하는 액션을 둔다.
R1·R2·R3·R7·R8이 이 작업의 범위다. 실패 안내와 결과 안내는 TASK-073이 이어서 붙인다.

## 의존성

- **선행 필수: TASK-071.** `HeartbeatRunControls`·`HeartbeatRunFailure` 타입과
  `integrations.heartbeatRuns`가 없으면 타입 검사부터 실패한다.
- **선행 필수: TASK-062.** 같은 `HeartbeatCard.tsx`와 `IntegrationsView.test.tsx`를 고친다.
  구간은 다르지만(그쪽은 `HeartbeatSetupWizard`와 `설치 가이드 접기` describe) 같은 파일이라
  동시에 진행하면 서로를 덮는다.
- **선행 필수: TASK-065(SPEC-022).** 같은 `HeartbeatCard.tsx`의 저장·재설정 확인 화면 문구와
  `IntegrationsView.test.tsx`·`DreamCard.test.tsx`를 고친다. 이 작업이 그 확인 화면 옆에 실행
  확인 화면을 새로 놓으므로 뒤에 온다.
- TASK-070(백엔드)은 선행이 아니다. 화면 테스트는 실행 통로를 주입받아 돌고 Rust를 컴파일하지
  않는다. 다만 사람이 앱에서 눌러 보는 확인은 TASK-070이 끝난 뒤에야 가능하다.

## 범위

- `src/features/projects/components/WorkspaceShell.tsx` — `IntegrationsView`에 넘기는 prop 한 줄.
- `src/features/projects/components/integrations/IntegrationsView.tsx` — prop 하나를 받아 카드에
  그대로 넘긴다. 값의 내용을 들여다보지 않는다.
- `src/features/projects/components/integrations/IntegrationCard.tsx` — `IntegrationCardProps`에
  필드 하나. 골격 컴포넌트의 렌더는 고치지 않는다.
- `src/features/projects/components/integrations/HeartbeatCard.tsx` — `HeartbeatRoleJobs`의 역할별
  자리. `HeartbeatSetupWizard`는 한 줄도 고치지 않는다(R9).
- `src/App.css` — 새 요소의 스타일.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 렌더 헬퍼에 새 prop,
  새 describe.
- `src/features/projects/components/integrations/DreamCard.test.tsx` — 렌더 헬퍼 둘에 새 prop만
  더한다. dream 카드의 동작은 고치지 않는다.
- `src/App.tsx`는 건드리지 않는다. 이미 `workspace.integrations`를 통째로 넘기고 있다.

## 작업 내용

### 배선

- `IntegrationsView`의 Props와 `IntegrationCardProps`에 `heartbeatRuns: HeartbeatRunControls`를
  **필수**로 더한다. 선택으로 두면 배선을 빠뜨려도 컴파일이 통과하고, 카드는 조용히 액션 없는
  화면이 된다.
- `WorkspaceShell`은 `heartbeatRuns={integrations.heartbeatRuns}` 한 줄만 더한다.
- 두 테스트 파일의 렌더 자리에 새 prop을 채운다(`IntegrationsView.test.tsx`의 `renderView`와 인라인
  렌더 셋, `DreamCard.test.tsx`의 렌더 헬퍼 둘). 기본값은 `{ running: [], failure: null, run }`
  꼴이고 `run`은 `vi.fn().mockResolvedValue(true)`다. 기존 테스트의 이름과 본문은 고치지 않는다.

### 역할별 실행 액션 (R1)

- 자리는 `HeartbeatRoleJobs`의 역할별 `<li>` 안, 실행 기록·사용량 줄 다음이다. 기본값 재설정 버튼과
  같은 층에 둔다.
- 실행 대상 이름은 **스냅샷의 `jobName`**(`heartbeat.roles`의 그 역할 항목)에서 가져온다. 카드 안의
  `jobNameOf`(`wf-${role}${slug}`)를 쓰지 않는다 — 그 함수는 차이 표시용 표기이고, 실행은 백엔드가
  아는 이름으로 나가야 한다(확인 사실 8, 완료 조건 2). `jobNameOf`와 그 호출부는 고치지 않는다.
- 관리 블록에 그 역할 잡이 없으면(`job`이 없으면) 버튼을 조작할 수 없는 상태로 두고, 먼저 잡을
  설치해야 한다는 것을 그 자리에서 말한다. 문구에 "설치"라는 낱말을 쓰되 설치 마법사를 가리키지
  않는다 — 여기서 말하는 설치는 아래의 역할 잡 저장이다.
- 실행 액션은 폼과 무관하다. 저장하지 않은 편집이 있어도 대상과 호출 인자가 달라지지 않는다
  (완료 조건 4). 폼 상태(`form`·`specified`)를 읽지 않으면 저절로 성립한다.
- 이 액션은 어떤 쓰기 액션도 부르지 않는다(완료 조건 5).

### 확인 단계 (R2, 승인된 확인 필요 3번)

- 누르면 바로 돌지 않고 확인 화면을 연다. 기존 저장·재설정 확인 화면과 같은 요소를 쓴다
  (`className="heartbeat-confirm"`, `role="group"`, `aria-label`).
- 확인 화면이 밝히는 것 셋(R2):
  1. 실행될 잡 이름.
  2. 이것이 모델 세션 하나를 띄우는 조작이라는 것. 화면 갱신이 아니고 되돌릴 수 없다.
  3. 조건과 한도가 그대로 적용되므로 실제로는 세션이 뜨지 않고 끝날 수 있다는 것(확인 사실 6).
- 여기에 "이 조작은 어떤 파일도 쓰지 않습니다"를 함께 적는다. 같은 자리의 다른 두 확인 화면이
  "확인 후 아래 두 파일을 씁니다"로 시작하므로, 사용자가 같은 모양의 화면을 다른 일로 읽지 않게
  한다(R1).
- 확인 화면은 한 번에 하나만 연다. 실행 확인을 열면 저장 확인(`confirming`)과 재설정 확인
  (`resetting`)을 닫고, 그 둘을 열면 실행 확인을 닫는다. 폼 편집(`edit`·`switchMaxPer` 등)도
  실행 확인을 닫는다 — 기존 두 확인 화면이 이미 그렇게 동작한다.
- 확인 버튼을 누르면 확인 화면을 닫고 `heartbeatRuns.run(jobName)`을 부른다.

### 진행 중 표시 (R3)

- `heartbeatRuns.running`에 그 잡 이름이 있으면 진행 중이다. 카드가 따로 상태를 들지 않는다 —
  들면 뷰를 떠났다 오는 순간 갈라진다.
- 진행 중이면 그 역할의 실행 버튼을 누를 수 없고, 진행 중이라는 것이 `role="status"` 요소로 화면에
  남는다. 실측에서 세션 하나가 206초였고 타임아웃은 20~30분이므로(확인 사실 7) 이 표시가 없으면
  사용자는 눌리지 않았다고 판단하고 다시 누른다.
- 진행 중 표시와 비활성은 그 역할에만 건다. 다른 역할의 버튼은 그대로 눌린다(R3, 완료 조건 8).
- 실행이 끝나면 `running`에서 이름이 빠지므로 버튼이 저절로 되돌아온다(완료 조건 9).

### 저절로 실행되지 않는다 (R7)

- 실행 호출은 확인 화면의 버튼에서만 나간다. 마운트·조회 갱신·프로젝트 열기 어디에도 넣지 않는다.
- 데몬이 도는 상태에서도 액션을 막지 않는다(완료 조건 19). `daemonRunning`을 실행 가능 판정에
  쓰지 않는다.

### 스타일

- 새 요소의 클래스는 기존 이름 규칙(`heartbeat-…`)을 따른다. 기존 클래스의 규칙은 고치지 않는다.

## 완료 조건

1. 세 역할 모두의 자리에 그 역할 잡을 지금 실행하는 액션이 보인다. (기획서 완료 조건 1)
2. 실행 호출에 실린 잡 이름이 스냅샷의 `jobName`과 같다. `wf-${role}${slug}`와 다른 값을 담은
   스냅샷으로 확인한다. (완료 조건 2)
3. 관리 블록에 없는 역할에서는 실행할 수 없고, 먼저 잡을 설치해야 한다는 것이 그 자리에 보인다.
   (완료 조건 3)
4. 폼 값을 바꾼 뒤 실행해도 호출 인자가 달라지지 않는다. (완료 조건 4)
5. 실행 경로에서 `installHeartbeatJobs`·`installDreamJob`이 불리지 않는다. (완료 조건 5)
6. 확인 화면에 잡 이름, 모델 세션이 뜬다는 것, 조건과 한도가 그대로 적용된다는 것이 있다.
   (완료 조건 6)
7. 진행 중에는 그 역할의 실행 버튼을 다시 누를 수 없고 진행 중임이 보인다. 확인 버튼을 두 번 눌러
   `run` 호출이 한 번인지 확인한다. (완료 조건 7)
8. 한 역할이 진행 중이어도 다른 역할의 실행 액션이 눌린다. (완료 조건 8)
9. 실행이 끝나면 액션이 다시 눌린다. 성공·실패·건너뜀 세 결과의 스냅샷 각각에서 같다.
   (완료 조건 9)
10. 뷰를 언마운트하고 다시 그려도 진행 중 표시와 비활성이 그대로다. (완료 조건 10)
11. 조작 없이 스냅샷 갱신을 여러 번 태워도 `run`이 불리지 않는다. (완료 조건 20)
12. `daemonRunning`이 참인 스냅샷에서도 실행 액션이 동작한다. (완료 조건 19)
13. 설치 마법사에 실행 버튼이 없고 "앱이 설치를 대행하지 않습니다" 문구가 그대로다. 그 문구와 버튼
    부재를 확인하는 기존 테스트가 수정 없이 통과한다. (완료 조건 22)
14. 결과 라벨과 `skippedReasonNote`를 확인하는 기존 테스트가 수정 없이 통과한다. (완료 조건 12·14)
15. 저장·재설정 확인 화면과 실행 확인 화면이 동시에 열리지 않는다.
16. 기존 자동화 테스트가 삭제되거나 비활성화되지 않는다. (완료 조건 24)
17. `npm run check`가 통과한다. (완료 조건 25)

## 검증 절차

```sh
npm run check
git diff src/features/projects/components/integrations/DreamCard.test.tsx   # 렌더 헬퍼 두 곳뿐
```

## 범위 밖

- 실행 실패 표시와 명령 복사, 실행이 끝났다는 안내. TASK-073이 한다.
- 데몬과 겹칠 수 있다는 사실의 고지. R7의 해당 문장("겹칠 수 있다는 사실을 감춘다")이 같은 절의
  제목("데몬과 겹치는 실행을 사용자가 알고 고른다")과 반대 방향이라 무엇을 요구하는지 정해지지
  않는다. 어느 완료 조건도 이 문구를 검사하지 않으므로 이번 범위에서는 문구를 만들지 않는다.
  기획자 판단 대상으로 남긴다(`REPORT-SPEC-020-ARCH.md` 승계 항목 참조).
- 설치 마법사의 어떤 변경도. 네 단계는 지금처럼 명령 복사까지다(R9).
- dream 카드의 실행 액션. 승인된 확인 필요 4번이 이번 범위에서 뺐다.
- 여러 역할을 한 번에 도는 조작. 승인된 확인 필요 2번이 역할 잡 하나로 한정했다.
- 실행 예약·반복 실행, 실행 이력의 축적, 잡 설정 변경.
- `jobNameOf`와 기존 차이 표시·저장·재설정 경로의 정리. 필요해서 바뀌는 것이 아니면 그대로 둔다.
