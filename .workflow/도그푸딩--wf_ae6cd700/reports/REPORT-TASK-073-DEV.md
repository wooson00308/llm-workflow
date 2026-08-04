# TASK-073 개발자 핸드오프

- 대상 작업: TASK-073 (실행 실패와 실행 종료를 그 자리에서 구분해 말한다)
- 근거 문서: SPEC-020 R4·R5·R6 / 완료 조건 11~18, DECISION-53577F93 (approved)
- 선행: TASK-072 `qa_waiting` 확인 후 착수
- 상태: `qa_waiting` (lease-98662-20260804095035, acquire exit 0)

## 변경한 파일 (셋, 전부 범위 안)

- `src/features/projects/components/integrations/HeartbeatCard.tsx` — `HeartbeatRoleJobs`에 실패 표시·종료 안내·복사 수단.
- `src/App.css` — 종료 안내를 기존 진행 중 표시 규칙에 합치고(선택자 1개 추가), 실패 표시의 명령·복사 줄 스타일 6줄 추가.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — TASK-072가 만든 describe 안에 중첩 describe 하나(11개 케이스) 추가. 로컬 헬퍼 `state()`에 `quotas` 인자 추가(완료 조건 10이 사용량 갱신을 봐야 함).

훅·게이트웨이·`types.ts`·`IntegrationCard.tsx`·마법사·`src-tauri` 무변경. `runResultLabels`·`quotaUsageLabel`·`JobQuotaLine`·`skippedReasonNote` 무변경(R4·완료 조건 14).

## 핵심 결정

1. **실패 판정은 이름 대조 하나.** `heartbeatRuns.failure?.jobName === status.jobName`일 때만 그 역할 자리에 그린다. 잡 이름에 프로젝트 slug가 들어 있어 다른 프로젝트·다른 역할로 새지 않는다. 카드는 실패 값을 들지 않으므로 조회 주기가 지우지 못한다(완료 조건 4는 카드 쪽 성질만 고정 — 값의 수명은 훅 소유).
2. **종료 안내의 근거는 `run`의 반환값 하나.** 참이면 안내, 거짓이면 실패 표시가 그 자리를 대신한다. 종료 코드·소요 시간으로 결과를 추정하지 않는다. 문구는 셋만 말한다(요청이 끝났다 / 세션이 안 떴을 수 있다 / 결과는 마지막 실행 기록에). "성공" 낱말을 쓰지 않는다.
3. **종료 안내는 역할별 레코드.** `Record<string, boolean>`로 두어 한 역할의 실행이 다른 역할의 안내를 지우지 않는다(R3의 역할 독립과 같은 축). 시작할 때 그 역할 것만 지운다.
4. **복사 결과는 잡 이름과 함께 든다.** 마법사의 `{step, ok}` idiom 그대로 `{jobName, ok}`. 실행을 다시 시작할 때 비워, 같은 잡이 다시 실패해도 사용자가 누르지 않은 "복사됨"이 되살아나지 않는다.
5. **`IntegrationWarning`에 className을 추가하지 않았다.** `IntegrationCard.tsx`가 범위 밖이라 스타일 훅은 자식 요소(`heartbeat-run-failure-command` 등)에 붙였다.

## 완료 조건 대조

| # | 조건 | 고정한 테스트 |
| --- | --- | --- |
| 1 | 조작 실패로 보이고 실행 기록 그대로 | `shows a failed start as the app's own failure and leaves the run record alone` |
| 2 | 명령 원문 + 복사가 그 문자열로 나감 | `hands the backend's command to the clipboard untouched` |
| 3 | 복사 실패해도 원문이 남고 그 사실을 말함 | `keeps the command on screen and says so when the copy fails` |
| 4 | 조회 주기가 실패 문구를 지우지 않음 | `keeps the failure through repeated snapshot refreshes` (3회 갱신) |
| 5 | 마법사 단계 상태 불변 | `leaves the setup wizard untouched when the run cannot start` |
| 6 | 그 잡 이름의 역할에만 | `shows the failure only in the row of the job that failed` |
| 7 | 종료 안내가 결과를 단정하지 않음 | `says the run request ended without claiming a result` |
| 8 | skipped·quota_skipped가 실패로 안 보임 | `keeps the %s wording for a run that raised no session` (2케이스) |
| 9 | `skippedReasonNote` 기존 테스트 무수정 통과 | 기존 `IntegrationsView.test.tsx:427~433, 449` 그대로 통과 |
| 10 | 갱신된 스냅샷이 실행 기록·사용량에 반영 | `shows the refreshed run record and quota from the next snapshot` (실행 호출 1회 유지 확인) |
| 11 | 결과 라벨 기존 테스트 무수정 통과 | 기존 결과 낱말 검사 전부 통과 |
| 12 | 다음 실행 시작 시 종료 안내 사라짐 | `clears the finished note when the next run of that role starts` (두 번째 실행을 pending으로 잡아 확인) |
| 13 | 기존 테스트 무삭제·무비활성 | 아래 수치 |
| 14 | `npm run check` 통과 | 아래 수치 |

## 게이트 수치

`npm run check` 통과 — tsc 오류 0, vitest 17 files / 435 passed / 0 실패 / 0 스킵, build 성공(321 modules). 해당 파일 단독 172 passed.

무삭제·무비활성 근거: 파일 단독 161 → 172(+11 = 신규 케이스 수와 일치), 전체 424 → 435(+11). `.skip`·`.only`·`xit` 0건. 기존 `it` 이름·본문 무변경(추가는 새 중첩 describe 안에서만, 기존 코드 수정은 로컬 `state()` 헬퍼의 인자 1개 추가뿐). 다중 세션 미커밋 트리라 `git diff` 크기는 이 세션 기여분을 뜻하지 않아 파일·심볼 단위로 확인.

## 사용자 QA 제안

TASK-070·072가 트리에 있어 실제 실행 가능:

1. 정상 실행: "확인하고 지금 실행" → 진행 중 표시 → 끝나면 종료 안내. 안내가 결과를 단정하지 않는지(성공/실패라고 말하지 않는지) 확인.
2. 조건 미충족 상태에서 실행: 종료 안내 + 마지막 실행 기록이 "건너뜀"으로 갱신되고, 건너뜀 안내 문구가 이전과 같은지.
3. 실행 실패: PATH에서 `heartbeat`를 못 찾는 상태로 앱을 띄워 실행 → 그 역할 자리에만 경고, 명령 원문 노출, "명령 복사" 동작. 마지막 실행 기록과 설치 마법사 단계 상태가 실패 전과 같은지.
4. 실패 뒤 30초 방치: 문구가 조회 주기에 지워지지 않는지.
5. 재실행: 종료 안내가 남아 있는 상태에서 다시 실행하면 안내가 먼저 사라지는지.

판단 기준: 앱이 "성공/실패"를 단정하거나, 건너뜀 사유를 지어내거나, 실행 실패가 마법사를 미설치로 되돌리면 잘못이다.

## 리스크와 후속

- 종료 안내는 메모리 전용이라 다른 메뉴를 다녀오면 사라진다(작업 문서가 허용한 성질). 가리키는 값인 마지막 실행 기록은 스냅샷에 남는다. QA에서 "안내가 사라짐"을 결함으로 읽지 않도록 주의.
- 실패 표시는 카드가 아니라 훅이 값의 주인이라, 실행 통로가 실패 값을 언제 비우는지는 이 작업의 테스트 범위 밖이다(훅 쪽 테스트 소관).
- 범위 밖으로 남긴 것: 데몬과 겹칠 수 있다는 고지(TASK-072와 같은 이유, R7 문장 방향이 기획자 판단 대상), 세션 출력·로그 노출, 실행 이력 축적.
- 핸드오프(역할 밖): `IntegrationsState.heartbeatRuns`가 여전히 선택 필드다. TASK-072가 남긴 계약 부채 그대로이며 어느 작업의 범위도 아니라 아키텍트 판단이 필요하다.
