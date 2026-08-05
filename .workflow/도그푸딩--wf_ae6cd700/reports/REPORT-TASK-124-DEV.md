# TASK-124 개발자 핸드오프 (qa_waiting)

## 결정권자 요약

이제 커밋 컷을 시작할 때 터미널을 열지 않아도 된다. 연동 탭의 하트비트 카드에 끄기·켜기 버튼이 섰고,
끄기를 누르면 확인 화면이 먼저 열려 세 가지를 말한다 — 이 조작이 이 기기의 모든 잡에 걸린다는 것,
지금 끊기는 세션이 몇 개인지, 재부팅하면 다시 켜진다는 것.

앱은 확인한 것까지만 말한다. 명령이 끝난 것과 데몬이 실제로 내려간 것을 한 문장으로 뭉뚱그리지 않고,
대상을 확정하지 못한 넷에서는 버튼이 아예 서지 않는다. 꺼진 상태는 카드에 계속 남고 앱이 대신 다시
켜지 않는다.

자동 검사는 전부 통과했다. 다만 앱을 띄워 실제로 껐다 켜 보는 걸음은 이 세션이 하지 못했다 — 화면을
누를 수단이 없고, 이 세션이 그 데몬이 띄운 프로세스라면 내리는 순간 죽는다. 그 한 걸음이 사용자 몫으로
남는다.

---

- 대상: TASK-124 (연동 카드에서 데몬을 끄고 켠다)
- 근거: SPEC-036 / DECISION-3D9A30F2 (`schema: workflow-labs/decision@1`, `spec_id: SPEC-036`,
  `outcome: approved`, `created_by: user`, `created_at: 2026-08-05T06:52:32.742176+00:00`) — 이 세션
  시점에도 SPEC-036의 유일한 결정이다.
- 세션: 2026-08-05T15:57Z~16:2xZ. 죽은 세션 인수 아님(`todo`에서 집었다).
- 선점: `sh .workflow/rules/wf-claim.sh acquire TASK-124 developer-claude 45` → exit 0,
  `lease_id: lease-40196-20260805155744`. 작업 중 `renew` 1회(exit 0), 종료 시 `release`.
- 기기: Apple Silicon / macOS (arm64).

## 선택 경위

`sh .workflow/rules/wf-eligible.sh developer` → `eligible`/0. 미완료 11건 중 `todo`는 TASK-124 하나이고
나머지 열은 전부 `qa_waiting`이다. `in_progress`가 없어 인수 대상이 없었다. TASK-124의 선행 둘은
TASK-117(`completed`)·TASK-123(`qa_waiting`)이라 충족이고, lease 디렉터리에는 `SPEC-009.yml` 하나뿐인데
`expires_at: 2026-08-03T01:20:00Z`로 만료라 겹침으로 막힌 것도 없었다. **선택지가 하나였다.**

선점 뒤 같은 스크립트를 다시 돌리면 `no-target`/1이다. 유일하게 남은 대상이 이 세션의 미만료 lease로
덮였기 때문이고, 정상이다.

## 바꾼 것

### 계약 타입 (`src/features/projects/domain/types.ts`)

- `HeartbeatServiceTarget`·`HeartbeatRecordedJob` — TASK-122가 payload에 실은 두 값의 화면 쪽 정의.
  `HeartbeatIntegration`에 `serviceTarget`·`recordedJobs`로 더했다.
- `HeartbeatServiceOperation`·`HeartbeatServiceControlResult`·`HeartbeatServiceOutcome`·
  `HeartbeatServiceControls` — TASK-123의 결과 여섯 갈래와 카드가 받는 통로.
- `IntegrationsState.heartbeatService`, `ProjectGateway.controlHeartbeatService` 추가.

`serviceTarget`·`recordedJobs`를 **선택 필드로 둔 이유**는 아래 "범위 밖으로 나간 자리"에 적었다.
백엔드는 언제나 채워 보내고, 값이 없는 동안 화면은 조작 통로를 세우지 않는다(R4).

**`plist_path`·`plist_paths`가 snake_case인 것은 오타가 아니다.** `domain/project.rs`의
`HeartbeatServiceTarget`이 `#[serde(tag = "kind", rename_all = "snake_case")]`만 달고 변형별
`rename_all`이 없어 변형 이름과 필드 이름이 모두 snake_case로 나간다. 같은 파일의 `JobQuota`가
`recovers_at`을 `recoversAt`으로 내보내려고 변형마다 `rename_all`을 다시 다는 것이 그 반례다. 추정으로
적지 않고 같은 derive 조합을 `/tmp`의 별도 크레이트로 세워 직렬화 결과를 실측했다 —
`{"kind":"resolved","label":...,"plist_path":...}`, `{"kind":"not_registered"}`,
`{"kind":"ambiguous","plist_paths":[...]}`, `{"kind":"unsupported_platform"}`,
`{"kind":"unreadable","path":...}`, 그리고 `{"name":...,"ofThisProject":true}`. 실측한 크레이트는
지웠다. 이 어긋남 자체는 백엔드 쪽 자리라 여기서 고치지 않았다(아래 핸드오프 3번).

### 게이트웨이 (`tauriProjectGateway.ts`)

`controlHeartbeatService(operation)` 하나. 넘기는 것은 식별자 하나이고 명령 조각이 없다.

### 훅 (`useProjectWorkspace.ts`)

- `heartbeatService` 상태(`running`·`outcome`·`error`)와 `controlHeartbeatService` 통로.
- 겹쳐 실행은 `controllingService` ref로 막는다. 같은 tick에 두 번 눌려도 호출은 하나다.
- **커맨드 자체가 거절한 것은 결과가 아니라 `error`다.** 명령 원문은 대상이 확정된 뒤에만 만들어지고
  그 값을 아는 쪽은 백엔드라, 훅이 라벨을 지어내 명령을 적지 않는다(R4). `heartbeatVersions.error`가
  같은 어법의 선례다.
- **실행 뒤 연동 조회를 다시 부르지 않는다.** 데몬 실행 여부의 원천은 2.5초 주기 하나이고, 판정이 늦게
  따라오는 것은 정상이며 그 순간을 화면이 그대로 말한다(R7). 설치 단계 실행이 조회를 다시 부르는 것은
  단계 상태가 그 커맨드로만 바뀌기 때문이고, 여기에는 그 이유가 없다.
- **조회 주기가 이 통로를 부르는 자리가 없다.** 자동 복구를 두지 않는다는 확인 필요 4번의 승인안이다.

### 배선 (`WorkspaceShell.tsx` → `IntegrationsView.tsx` → 카드)

`heartbeatRuns`가 쓰는 통로 그대로다. 껍데기와 뷰는 값의 내용을 보지 않고 넘기기만 한다.
`heartbeatSetupRuns`·`heartbeatVersions`와 같은 이유로 렌더 조건에 걸지 않았다 — 없으면 이 버튼만 빠지고
카드의 나머지는 그대로 돈다.

### 카드 (`HeartbeatCard.tsx`)

- `HeartbeatServiceSection` — 업데이트 통로 옆 공통 자리. 버튼 둘, 진행 표시, 확인 화면, 결과.
- `ServiceStopConfirm` — 끄기 전 확인 화면. 실린 것 넷: 기기 전체 사정거리와 잡 목록(이 프로젝트 것과
  그 밖의 것이 나뉜다), dream 잡도 함께 멈춘다는 한 문장, 지금 끊기는 세션(0개와 하나 이상의 문구가
  다르고 둘 다 "이 프로젝트의 lease만 센 값"이라는 사실을 함께 말한다), 재부팅하면 다시 켜지고 이것이
  등록 해제가 아니라는 것.
- `ServiceUnresolvedNote` — 대상 미확정 넷의 문구. 스냅샷 판정과 조작 결과가 같은 문구 표를 쓴다.
  그 상태에서는 **버튼이 아예 렌더되지 않는다**(R4·R5).
- `ServiceOutcomeView` — 결과. `serviceExitNote`는 숫자만 말하고 뜻을 붙이지 않으며,
  `serviceStateNote`가 "명령은 끝났고 상태 갱신을 기다리는 중"과 "판정이 따라왔다"를 가른다. 0이 아닌
  종료 코드에서만 stderr 원문이 `<details>`로 붙는다.
- 꺼짐 경고 — 084가 세운 `IntegrationWarning` 통로 그대로이고, `bodyWarning`에 `daemonStopped`를 더해
  접힌 카드에서도 경고 표식이 남는다. 문구가 원인을 단정하지 않는다.

### 스타일 (`App.css`)

`.heartbeat-service*` 한 묶음. 업데이트 통로와 같은 상자 모양을 쓰고 결과 색은 종료 코드 0인지로만
갈린다. 기존 규칙은 건드리지 않았다.

## 범위 밖으로 나간 자리 (하나)

**`src/features/projects/components/integrations/IntegrationCard.tsx`를 손댔다.** 작업 문서의
`scope_files`와 "범위 파일" 절 어디에도 없는 파일이다.

바꾼 것은 한 줄짜리 선택 prop 하나다 — `IntegrationCardProps`에 `heartbeatService?: HeartbeatServiceControls`.
`import` 한 줄이 함께 늘었다. 그 밖의 동작은 손대지 않았다.

피할 길이 없었다. 작업 문서가 지시한 배선은 "뷰가 값을 보지 않고 카드에 그대로 넘긴다"이고
`heartbeatRuns`를 선례로 지목했는데, 그 prop들의 정의가 전부 이 파일의 `IntegrationCardProps`에 있다.
뷰가 `<Card>`에 넘기는 값은 이 인터페이스에 없으면 타입이 통과하지 않고, 카드 목록은
`ComponentType<IntegrationCardProps>`로 묶여 있어 카드 쪽에서만 넓히는 것도 뷰의 호출부를 통과시키지
못한다. 선언 병합 같은 우회는 한 줄짜리 선언보다 나쁘다고 판단했다.

지금 미만료 lease는 이 세션의 것 하나뿐이라 실제 충돌은 없었다. 그래도 선언과 실제가 갈린 사실이라
보고서에 남긴다 — 아키텍트가 이 파일을 범위에 넣었어야 했다는 것이 이 항목의 뜻이다.

## 하지 못한 판단 하나 (선택 필드로 둔 이유)

`serviceTarget`·`recordedJobs`를 `HeartbeatIntegration`의 **필수 필드로 좁히지 못했다.** 좁히면
`DreamCard.test.tsx`의 스냅샷 리터럴이 컴파일을 통과하지 못하는데, 그 파일은 이 작업의 범위 밖이고
완료 조건 16이 그 파일을 "기대값 수정 없이 통과"로 못박고 있다. 그래서 `heartbeatRuns`가 같은 이유로
선택인 것과 같은 어법을 따랐다.

대신 값이 없는 상태를 안전한 쪽으로 닫았다 — 판정이 없으면 조작 통로 자체가 서지 않는다. 그 검사도
세워 두었다(`draws no daemon controls while the snapshot carries no judgement`).

## 검증

명령 두 개, 전부 이 세션에서 실제로 돌린 값이다.

| 명령 | 결과 |
| --- | --- |
| `npm run check` | 23 files / **705 tests passed**, 0 failed. typecheck·build 포함 통과 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **538 passed / 0 failed / 0 ignored** |

- 프론트엔드 검사는 이 작업 전 674개였다. 31개가 늘었고 줄거나 비활성화된 것은 없다.
- Rust는 한 줄도 바뀌지 않았다. 538은 TASK-123이 넘길 때의 값과 같다.

세운 검사(요지):

- 화면(`IntegrationsView.test.tsx`, 26개) — 두 버튼의 자리, 켜기의 즉시 실행, 끄기의 확인 화면(취소·확인
  각각), 진행 중 잠금과 진행 문구 둘, 확인 화면의 넷(기기 전체·dream 문장·잡 목록·세션 고지·재부팅),
  잡 구성이 다른 두 스냅샷과 빈 목록, 세션 0개와 2개의 문구 차이 및 "이 프로젝트만"이라는 사실,
  켜기에 세션 고지가 없음, 대상 미확정 넷이 서로 다른 문구이고 버튼이 없음, 모호에서 경로 전부·읽지
  못함에서 경로 하나, 실행 수단 없음의 사유·명령 원문·복사·빈칸 없음, 결과가 명령과 데몬 상태를
  뭉뚱그리지 않음(판정 전/후 두 갈래), 0이 아닌 종료 코드와 stderr 원문, 조작 대상 표시, 커맨드 거절,
  실패 전후 마법사 표시 동일, 실패 뒤에도 다른 조작 살아 있음, 꺼짐 경고와 접힘 요약, 판정 없을 때
  통로 없음.
- 훅(`useProjectWorkspace.test.ts`, 6개) — 식별자 하나만 나감, 켜기도 같은 통로, 겹쳐 부르기 차단,
  거절 시 사유만 남김, **꺼진 스냅샷으로 주기를 세 번 돌려도 조작 커맨드가 한 번도 나가지 않음**,
  조회·쓰기 상태 무영향.
- 껍데기(`WorkspaceShell.test.tsx`, 2개) — 통로가 카드까지 닿음, 통로가 없어도 카드의 나머지가 돎.

완료 조건 14(`heartbeat status` 파싱 없음)·15(다른 동작 안 막힘)·16(dream 카드 표시 동일)·
17(설치 판정·잡 저장·지금 실행·업데이트·084 경고 동작 동일)은 변경분 자체와 기대값 수정 없이 통과한
기존 검사가 근거다. `DreamCard.test.tsx`는 열지 않았다.

## 하지 못한 확인

**작업 문서 검증 절차 8 — 앱을 띄워 실제로 껐다 켜 보는 걸음을 하지 못했다.** 두 가지 이유다.

1. 이 세션에는 GUI 창을 띄워 버튼을 누르고 결과를 읽을 수단이 없다.
2. TASK-123이 같은 자리에서 경계한 상태가 그대로다 — 이 세션이 그 데몬이 띄운 프로세스라면 끄기가
   성공하는 순간 세션이 죽고 다시 켤 사람이 남지 않는다.

그래서 이 확인은 사용자 몫으로 넘긴다. 무엇을 보면 되는지는 작업 문서의 `## 확인 동선`에 적었다.
**반드시 다시 켜는 것까지 확인하고 끝내야 한다** — 내린 채로 두면 다음 세션이 깨어나지 않는다.

TASK-123이 실측해 둔 값이 그대로 쓰인다. 이미 올라가 있는 서비스에 `bootstrap`을 치면 종료 코드 5와
`Bootstrap failed: 5: Input/output error`가 나오고 데몬은 그대로 돈다. 화면은 이것을 실패로 접지 않고
숫자와 원문을 그대로 싣는다 — 검사 `carries a nonzero exit code and the stderr verbatim without
translating it`이 그 모양을 고정한다.

## 핸드오프 (역할 밖 발견)

1. **`IntegrationCard.tsx`가 범위 선언에서 빠졌다.** 위에 적은 그대로다. 카드에 새 prop을 내리는 작업은
   앞으로도 이 파일을 함께 만지므로, 다음 분해에서 범위에 넣는 편이 낫다.
2. **`HeartbeatIntegration`의 두 새 필드가 아직 선택이다.** `DreamCard.test.tsx`의 스냅샷 리터럴이 두
   필드를 갖추면 필수로 좁힐 수 있다. 그 파일을 범위에 넣은 작업이 서면 한 줄짜리 정리다.
3. **`HeartbeatServiceTarget`의 wire 이름이 이 저장소의 다른 payload와 어긋난다.** 변형 태그가
   snake_case이고 필드도 snake_case다(`plist_path`·`plist_paths`). 같은 커맨드 계층의
   `HeartbeatServiceRun`은 camelCase라 한 화면이 두 규칙을 함께 읽는다. 백엔드 자리라 손대지 않았고,
   고치면 이 파일의 타입과 검사 픽스처가 함께 움직여야 한다.
4. **작업 트리에 이 세션 밖의 미커밋 변경이 많다.** TASK-122·123을 포함해 앞선 세션들의 결과물이
   그대로 있다. 이 세션이 만진 파일은 위 목록 열하나뿐이다.
