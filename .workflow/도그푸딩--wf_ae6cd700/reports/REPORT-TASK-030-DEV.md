# TASK-030 개발자 핸드오프

- 대상 작업: TASK-030 (카드 골격에 본문 경고 통로를 열고 하트비트 카드가 사용량·소진·대기 경고를
  보여준다)
- 근거 문서: SPEC-009 R1·R2·R3·R4·R5, DECISION-85491D81 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T05:40Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점(05:28Z) `todo`는 TASK-030~040 열한 건. `.workflow/.runtime/leases`에는 SPEC-009
  (01:20Z 만료)·SPEC-013(05:55Z까지 활성, 아키텍트) 둘뿐이라 TASK-030을 덮는 lease는 없었다.
  SPEC-013 lease는 기획서 분해 작업이고 이 작업의 파일과 겹치지 않는다.
- 선행 필수인 TASK-028(`JobQuota`)·TASK-029(`ProjectSummary.pendingWork`)는 둘 다 `qa_waiting`
  이고, 두 payload가 작업 트리에 실제로 존재하는 것을 백엔드 코드에서 확인했다
  (`domain/project.rs`의 `HeartbeatRoleStatus.quota`·`DreamIntegration.quota`·`pending_work`).
  병행 금지 상대(TASK-028·029·027·024·025)는 모두 `qa_waiting` 또는 `completed`라 동시 작업이
  아니다.
- `migration.lock`은 없었다.

## 요약

연동 카드 골격에 "본문만 아는 경고"를 접힘 요약으로 올리는 불리언 통로 하나를 열고, 하트비트
카드가 역할 잡마다 실행 한도 사용량·소진·회복 예상 시각을 보여주며, 소진이면서 그 역할의 대기
물량이 있을 때만 경고를 띄우도록 했다. 백엔드는 건드리지 않았다.

## 변경한 파일

- `src/features/projects/domain/types.ts`
  - `JobQuota`(`unknown`·`unlimited`·`noRuns`·`counted` 네 갈래)와 `PendingRoleWork` 추가.
    백엔드 `JobQuota`의 serde 표현(`tag = "kind"`, camelCase 변형 이름)과 이름까지 맞췄다.
  - `HeartbeatRoleStatus.quota`·`DreamIntegration.quota`는 필수. 백엔드가 늘 보낸다.
  - `ProjectSummary.pendingWork`는 **선택 필드**. 값이 없으면 "대기 물량을 모른다"이고 경고하지
    않는다. 필수로 두면 범위 밖 테스트 파일 넷의 `ProjectSummary` 픽스처가 모두 깨진다
    (`dueAt?`·`events?`와 같은 이유).
  - `WorkflowItemSummary.sourceDecisionId?` 추가. 화면은 쓰지 않고 백엔드 payload와 타입만 맞춘다.
- `src/features/projects/components/integrations/IntegrationCard.tsx`
  - `Props.bodyWarning: boolean` 추가, `hasWarning`에 `|| bodyWarning`. 골격이 아는 경고 신호가
    넷에서 다섯이 됐다.
  - `IntegrationCardProps.pendingWork?: PendingRoleWork` 추가.
  - 이 파일에 `quota`·`maxPer`·`heartbeat`·`dream` 같은 낱말은 넣지 않았다. 골격은 경고가 무엇인지
    모른다.
- `src/features/projects/components/integrations/IntegrationsView.tsx` — `pendingWork`를 받아 각
  카드에 그대로 넘긴다. 뷰는 값의 내용을 보지 않는다(`snapshot`과 같은 방식).
- `src/features/projects/components/WorkspaceShell.tsx` — `pendingWork={project.pendingWork}` 한 줄.
  셸이 이미 `project`를 갖고 있어 `App.tsx`와 훅은 무변경.
- `src/features/projects/components/integrations/HeartbeatCard.tsx`
  - 모듈 상단에 문구 함수 셋: `quotaUsageLabel`(종류별 사용량 문장), `quotaRecoveryLabel`(회복
    예상 시각), `quotaWarned`(경고 판정). `localTime`은 `DevelopmentBoard`의 날짜 표시와 같은
    `Intl.DateTimeFormat("ko-KR", …)` 방식이고 파싱 실패 시 원문을 돌려준다.
  - `JobQuotaLine` 컴포넌트 — 실행 기록 줄 **뒤에**, 같은 `job &&` 조건으로 놓인다. 실행 기록
    블록은 고치지 않았다.
  - 잡 행 안에 경고 `IntegrationWarning` 추가. 조건은 `counted && exhausted && pendingWork[role]`.
  - `bodyWarning` 계산은 `HeartbeatCard` 안에서 한다(`HeartbeatRoleJobs` 밖). 재료가 그 자리에
    모두 있어 상태를 끌어올릴 필요가 없다. `snapshot`·`heartbeat`가 없으면 `false`다.
- `src/App.css` — `.heartbeat-job-quota`(실행 기록 줄과 같은 배치), `.heartbeat-quota-usage`의
  소진 상태 색, `.heartbeat-quota-exhausted` 배지. 색은 `.heartbeat-run-result.result-failure`가
  쓰는 조합(`#87512f` / `#f8e9da`)을 그대로 썼고 새 색을 만들지 않았다. 기존 규칙은 고치지 않았고
  이 변경으로 쓰이지 않게 된 규칙도 없다.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 픽스처에 `quota`
  기본값(여유 있는 `counted`)과 `pendingWork` 인자 추가, 새 테스트 15개(아래).

### 범위 밖 파일 3건 — 타입 계약 때문에 불가피한 최소 변경

`quota`를 필수 필드로 두라는 작업 지시(`HeartbeatRoleStatus`·`DreamIntegration`) 때문에 컴파일이
깨지는 자리 셋을 한 줄씩 채웠다. 동작 변화는 없다.

- `integrations/DreamCard.tsx` — `bodyWarning={false}` 한 줄. `bodyWarning`이 필수 prop이라
  없으면 `tsc`가 막는다. dream이 올릴 본문 경고는 TASK-031이 채운다.
- `integrations/DreamCard.test.tsx` — 픽스처에 `quota: { kind: "unknown" }`.
- `application/useProjectWorkspace.test.ts` — 같은 이유로 dream 픽스처에 `quota` 한 줄.

TASK-031이 dream 카드를 만들 때 이 셋을 자기 값으로 바꾸면 된다. 그 외에는 손대지 않았다.

## 검증

```
npm run check    # tsc -b + vitest run + vite build — 전부 통과
```

- 전체: 206 tests / 13 files 통과(직전 191에서 +15), 빌드 성공. 삭제·비활성화한 테스트 없음.
- `IntegrationsView.test.tsx`: 90 통과.
- 변이 검사로 새 테스트가 비어 있지 않음을 확인했다. `quotaWarned`를 `return false`로 바꾸면
  정확히 3건이 실패한다(경고 표시 / 경고 문구 넷 / 접힘 요약). 확인 후 되돌렸다.

### 새 테스트 (기획서 완료 조건 대응)

| 테스트 | 대응 |
| --- | --- |
| 사용량이 마지막 실행 기록과 나란히 보인다 | 완료 조건 1 |
| 한도가 관리 블록 값(`3/24`)이고 앱 기본값(`/6`)이 아니다 | 완료 조건 3 |
| 소진 표시 + 회복 예상 시각(로컬 변환, "예상" 포함) | 완료 조건 4 |
| 대기 물량이 있을 때만 경고, 없으면 사실 표시만 | 완료 조건 5·7 |
| 경고 문구에 대기 대상·원인·회복 시각·한도 올리는 자리가 모두 있다 | R3 |
| `quota_skipped` + 대기 없음에서 경고 없음 | 완료 조건 7 |
| `pendingWork`를 모르면(`undefined`) 경고 없음 | R3 |
| 세 역할 모두 대기 없음이면 소진이어도 경고 0개 | 완료 조건 9의 화면 몫 |
| `noRuns`가 `실행 기록 없음 · 한도 24회/24h`이고 `0/24`가 없다 | 완료 조건 12 |
| 관리 블록 읽기 실패에서 사용량 표시 0개 | 완료 조건 13 |
| `unlimited`이 `한도 없음`이고 소진 표시·경고 없음 | 완료 조건 14 |
| `used > limit`(30/24)이 오류 없이 소진으로 보인다 | 완료 조건 15 |
| 관리 블록에 없는 잡에는 사용량이 없다 | R1 |
| 접힘 요약 `it.each`에 다섯 번째 신호 "한도 소진 + 대기 물량" | 완료 조건 10·11 |
| 소진이지만 대기 없음이면 접힘 요약에 경고 표시 없음 | R3 |

관리 블록 읽기 실패 테스트는 백엔드가 실제로 보내는 값(`unknown`)이 아니라 `counted` + 소진을
일부러 먹여도 사용량이 그려지지 않는지를 본다. 그 경로에 새 분기를 만들지 않았고, 잡 목록 자체가
`UnreadableManagedBlock`으로 대체돼 성립한다는 사실을 고정한 것이다.

## 사용자 QA에서 확인할 것 (앱 실행 필요)

이 세션은 GUI를 띄우지 못해 자동화 테스트까지만 확인했다. 작업 문서의 검증 절차 그대로:

1. 연동 화면에서 claude-heartbeat 카드를 펼쳐 역할 잡 셋의 사용량이 보이는지. 현재 관리 블록 값은
   기획자·아키텍트 `8/24h`, 개발자 `24/24h`다.
2. `~/.claude/heartbeat/state.json`의 개발자 잡 `recent_runs`가 17개인데, 화면의 사용 횟수가 그
   배열 길이와 다르게(창 안 개수로) 나오는지.
3. 개발자 잡 한도를 잠깐 `1/24h`로 낮춰 저장 → 소진 표시와 회복 예상 시각이 나오는지, `todo`
   작업이 있으면 경고까지 뜨는지. 확인 후 값 되돌리기.
4. 카드를 접어 요약에 `확인할 경고가 있습니다`가 남는지.
5. `.workflow/.runtime/migration.lock`을 잠깐 만들어 경고가 사라지는지. 확인 후 삭제.

## 후속 / 리스크

- **TASK-031이 이어받을 것**: `IntegrationCard`의 `bodyWarning` 통로는 열렸고 dream 카드는 지금
  `false`를 넘긴다. 사용량 문구 함수 셋은 `HeartbeatCard.tsx` 모듈 스코프에 있으므로, dream 카드가
  같은 어법을 쓰려면 export 하거나 공용 모듈로 옮기는 판단이 TASK-031에 필요하다. 이번에는 범위
  밖이라 옮기지 않았다.
- **알려진 경계**: `bodyWarning`은 작업 문서가 지정한 조건(`counted && exhausted && pendingWork`)
  만 본다. `managedBlockFailure`를 따로 보지 않으므로, 백엔드가 계약을 어기고 읽기 실패 상태에서
  `counted` quota를 보내면 본문에는 아무것도 없는데 접힘 요약만 경고를 켜는 상태가 될 수 있다.
  지금 백엔드는 그 경로에서 `unknown`을 보내므로 실제로는 발생하지 않으며, 작업 문서가 "이 경로에
  새 분기를 만들지 않는다"고 못 박아 분기를 넣지 않았다.
- **역할 밖 발견(고치지 않음)**: 만료된 `.workflow/.runtime/leases/SPEC-009.yml`이 아직 남아 있다
  (2026-08-03T01:20Z 만료). TASK-029 보고서도 같은 것을 지적했다. 남의 lease라 건드리지 않았다.
- dream 카드의 사용량·경고는 여전히 없다(TASK-031). OS 알림·사용량 이력 그래프는 기획서 제외
  범위 그대로다.
