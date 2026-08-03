# TASK-010 개발자 핸드오프

- 대상 작업: TASK-010 (연동 공통 모델과 카드 골격 도입, 하트비트 카드 동작 변화 없음)
- 근거 문서: SPEC-003 R1·R7, DECISION-5276FDBF (approved)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T09:25Z
- 상태: `qa_waiting`

## 결과

조회 커맨드를 연동 하나짜리에서 연동 스냅샷 하나로 바꾸고, 프론트의 연동 섹션과 카드 골격을 하트비트에서 분리했다. 내장 연동 목록은 아직 항목이 하나다. 화면 문구와 동작은 이 변경 전과 같다. 조회 경로는 여전히 아무것도 쓰지 않는다.

dream 카드·정제 상태·dream 잡 설치는 이 작업 범위 밖이라 손대지 않았다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/application/heartbeat_service.rs` | `IntegrationsSnapshot`(섹션 공통 `supported`·`slug` + 연동별 payload) 추가. `HeartbeatIntegration`을 payload로 재정의하고 `HeartbeatStatus`를 펼쳐 담음. 중복 잡을 연동 기준으로 거름. 신규 테스트 2개 |
| `src-tauri/src/commands/heartbeat.rs` | `inspect_heartbeat` → `inspect_integrations`. 두 커맨드 반환 타입을 스냅샷으로 변경 |
| `src-tauri/src/lib.rs` | `invoke_handler` 등록 이름 변경 |
| `src/features/projects/domain/types.ts` | `IntegrationInstallation`·`DuplicateIntegrationJob`·`IntegrationReadFailure`·`IntegrationsSnapshot`·`IntegrationsState`·`IntegrationActions` 추가. `HeartbeatInstallation`(3값)·`HeartbeatStatus`·`HeartbeatState` 제거. 게이트웨이 계약 변경 |
| `src/features/projects/infrastructure/tauriProjectGateway.ts` | 조회 메서드를 `inspectIntegrations` 하나로 |
| `src/features/projects/application/useProjectWorkspace.ts` | 훅 상태를 스냅샷 하나(`integrations`)로. 카드에 넘길 쓰기 액션 묶음(`integrationActions`) 추가 |
| `src/features/projects/components/integrations/IntegrationCard.tsx` | 신규. 카드 공통 골격과 경고 상자, 카드 props·연동 정의 타입 |
| `src/features/projects/components/integrations/IntegrationSection.tsx` | 신규. 내장 연동 목록을 순회하는 섹션 |
| `src/features/projects/components/integrations/registry.ts` | 신규. 내장 연동 고정 목록 (현재 1개) |
| `src/features/projects/components/integrations/HeartbeatCard.tsx` | 신규. `SettingsView.tsx`에 있던 `HeartbeatIntegrationCard`·`HeartbeatRoleJobs`를 옮기고 배지·판정 근거 문구 계산을 여기로 |
| `src/features/projects/components/SettingsView.tsx` | 연동 관련 코드 전부 제거. `IntegrationSection` 한 줄만 남음 |
| `src/features/projects/components/SettingsView.test.tsx` | 픽스처를 스냅샷 형태로. 기존 시나리오 전부 유지, 신규 4개 |
| `src/features/projects/application/useProjectWorkspace.test.ts` | 게이트웨이 목을 팩토리로 정리. 조회 실패·쓰기 실패 검증 2개 추가 |

### 범위 밖이지만 바꾼 파일

`src/App.tsx`, `src/features/projects/components/WorkspaceShell.tsx`, `src/features/projects/components/WorkspaceShell.test.tsx` 세 개다. 전부 prop 전달만 하는 통과 지점이고, `heartbeat`/`onInstallHeartbeatJobs` prop 이름을 `integrations`/`integrationActions`로 바꾼 기계적 변경이다.

이유: 검증 절차가 `SettingsView.tsx`에서 `heartbeat|Heartbeat` 검색 결과가 없어야 한다고 정했다. prop 이름을 그대로 두면 `SettingsView`의 props 타입에 `heartbeat: HeartbeatState`가 남는다. 이름을 바꾸면 호출 지점이 따라 바뀔 수밖에 없다. 로직 변경은 없다.

## 설계 판단

- **스냅샷은 섹션 공통 값과 연동별 payload로 나눴다.** `supported`와 `slug`는 스냅샷에, 나머지는 `heartbeat` payload에 있다. 세 번째 연동은 payload 필드 하나만 추가하며, 커맨드·게이트웨이 메서드·훅 상태·2.5초 조회 호출은 그대로다. 그것이 R1의 판단 기준이었다.
- **플랫폼 지원 여부는 섹션 공통 값이라 경고도 섹션이 한 번만 그린다.** 카드마다 반복하면 연동이 둘일 때 같은 경고가 두 번 나온다. 확인 필요 2번의 승인된 제안대로 연동별 플랫폼 분기는 만들지 않았다. 문구는 그대로이고 위치만 카드 안에서 카드 위로 올라갔다. 기존 테스트는 섹션 전체(`region` "연동")를 보므로 단언을 고치지 않았다. **화면에서 육안으로 확인할 부분은 이 한 곳이다.**
- **배지는 공통 설치 상태(`installation`)와 하트비트 부가 상태(`daemonRunning`)의 조합으로 만든다.** 백엔드가 `HeartbeatInstallation`(3값)을 payload에서 걷어내고 두 값으로 펼쳐 내려준다. TASK-009가 남긴 `collapse()`의 역이며, 조합에 없는 상태는 판정상 생기지 않는다. 배지 문구 세 가지와 CSS 클래스 접미사(`not_installed`·`installed_daemon_stopped`·`installed_daemon_running`)는 그대로 유지해 색이 바뀌지 않는다.
- **`heartbeat_status.rs`와 `domain/project.rs`는 건드리지 않았다.** 둘 다 이 작업의 범위 밖이다. 그래서 판정은 여전히 3값으로 접힌 뒤 서비스에서 다시 펼쳐진다. 접었다 펴는 왕복이 남아 있고, `HeartbeatInstallation`은 이제 백엔드 내부에서만 쓰인다. 아래 후속에 적었다.
- **카드 골격은 설정 객체가 아니라 합성으로 만들었다.** 연동 컴포넌트가 이름·설명·배지·중복 경고 문구를 `IntegrationCard`에 넘기고 자기 본문을 children으로 준다. 섹션은 목록을 돌며 `<Card />`를 그릴 뿐 어느 연동인지 모른다. 골격이 책임지는 것: 이름·설명·배지, 조회 실패/대기 문구, 중복 잡 경고 상자와 목록, 읽기 실패 목록, 본문 자리.
- **중복 잡 경고에서 연동이 정하는 것은 문구뿐이다.** 제목·설명·항목 표기 함수를 넘긴다. 하트비트는 항목에 역할 이름을 붙이고(`wf-developer · 개발자`), 역할 개념이 없는 연동은 이름만 나온다. 목록을 그리는 코드는 골격에 있다.
- **중복 잡은 백엔드가 연동별로 나눠 담는다.** TASK-009가 감지 결과에 `integration`을 붙였으므로 서비스가 자기 몫만 걸러 payload에 넣는다. 이렇게 하지 않으면 dream 중복 잡이 하트비트 카드에 "역할 잡 중복"으로 뜬다. 화면 코드에서 거르지 않는 이유는, 걸러야 한다는 사실을 연동마다 기억해야 하기 때문이다.
- **읽기 실패 목록도 payload 안에 뒀다.** 지금은 전부 하트비트 홈 파일을 읽다 난 실패다. dream이 자기 경로를 읽다 실패하면 그 payload에 들어가야 dream 카드에 뜬다. 섹션 공통으로 올리면 어느 연동 때문인지 알 수 없고, 카드마다 같은 목록이 반복된다.
- **쓰기 액션은 이름만 아는 묶음(`IntegrationActions`)으로 넘긴다.** 섹션과 골격은 이 객체를 들여다보지 않고 그대로 넘긴다. 연동마다 쓰기 커맨드가 다르므로 이 타입은 연동과 함께 늘어나지만(TASK-012가 dream 설치를 추가한다), 섹션·골격·배지·경고 컴포넌트는 그때 고치지 않는다.
- **쓰기 실패 문구는 아직 섹션 하나짜리다.** `writeError`가 카드마다 나뉘어 있지 않아 두 카드가 같은 값을 받는다. 지금은 쓰기 경로가 하나뿐이라 증상이 없다. 아래 후속에 적었다.
- **`install_heartbeat_jobs`는 이름과 인자를 바꾸지 않았다.** 반환 타입만 스냅샷으로 바뀐다. 훅 상태가 스냅샷 하나이고, 쓰기 직후 프론트가 다시 조회하지 않는 기존 동작(TASK-007)을 유지하려면 같은 형태를 돌려줘야 한다.
- **2.5초 인터벌과 실패 처리 방식은 그대로다.** 조회 실패는 화면 전체 에러로 올리지 않고 섹션 안에만 남기며, 조회는 쓰기 실패 문구를 지우지 않는다. 새 감시 장치는 만들지 않았다.

## 검증

```
npm run check → 통과 (typecheck / vitest 56 passed / vite build)
cargo test --manifest-path src-tauri/Cargo.toml → 91 passed; 0 failed
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets → 경고 없음
cargo fmt --check → 차이 없음
```

기존 테스트는 삭제·비활성화하지 않았다. `SettingsView.test.tsx`의 시나리오 단언은 그대로이고 픽스처 형태만 스냅샷으로 바뀌었다. (완료 조건 5)

섹션·골격 경계 확인:

```
grep -rn "heartbeat\|Heartbeat" \
  src/features/projects/components/SettingsView.tsx \
  src/features/projects/components/integrations/IntegrationSection.tsx \
  src/features/projects/components/integrations/IntegrationCard.tsx
→ 결과 없음
```

하트비트 전용 문구·타입은 `HeartbeatCard.tsx`에만 있다. (완료 조건 1)

조회 경로 무쓰기:

```
shasum ~/.claude/HEARTBEAT.md
→ d012cd3a9bf2e0999b0eb565f5d437e49fdad5d6 (세션 시작·종료 시점 동일)
```

`heartbeat_service.rs`에서 쓰기 호출(`install_condition_script`, `install_managed_jobs`)은 `install`에만 있고 `inspect`에는 없다. 나머지 `fs::write`는 전부 테스트 픽스처다. (완료 조건 4)

### 신규 테스트

백엔드 (`heartbeat_service.rs`)

- `the_installation_is_reported_as_a_common_state_plus_the_daemon_flag` — 데몬 정지/실행 두 홈에서 `(installation, daemonRunning)` 조합이 배지 재료로 나온다.
- `only_the_duplicates_of_this_integration_reach_the_heartbeat_payload` — 하트비트 중복과 dream 중복이 함께 있는 문서에서 하트비트 payload에 하트비트 것만 남는다.

프론트 (`SettingsView.test.tsx`)

- `draws one card per built-in integration` — 목록 항목이 하나일 때 카드가 하나 그려지고 이름이 `claude-heartbeat`다.
- `labels %s with daemonRunning=%s as %s` (3행) — 배지 문구 세 가지가 (공통 상태, 데몬 플래그) 조합에서 기존과 같게 나온다.

프론트 (`useProjectWorkspace.test.ts`)

- `keeps a failed integrations read out of the workspace error` — 스냅샷 조회 실패가 `integrations.error`에만 남고 화면 전체 에러(`error`)로 올라가지 않는다.
- `keeps a failed write visible while the 2.5s read keeps running` — 쓰기 실패 뒤 2.5초 조회가 한 번 더 돌아도 실패 문구가 남고 스냅샷은 갱신된다.

### 이 세션에서 확인하지 못한 것

- **설정 화면 육안 확인.** GUI 앱을 띄워 클릭하는 절차라 이 세션에서 하지 못했다. 자동화로 덮은 범위는 위 테스트까지다. QA에서 확인할 항목은 아래에 적었다.
- **Windows 미지원 경고의 실제 표시.** macOS에서는 `supported`가 항상 true라 화면에 뜨지 않는다. 위치를 카드 안에서 섹션으로 올린 유일한 변경이므로, Windows 환경이 있으면 그때 확인이 필요하다. 문구는 그대로다.

## QA에서 봐 주면 좋은 것

1. 설정 화면의 연동 카드가 이 변경 전과 같은 문구로 보이는지. 배지·판정 근거 문구·설치 안내·slug·조건 스크립트 경로.
2. 역할 잡 토글·편집·확인·쓰기가 그대로 되는지. 저장 후 `~/.claude/HEARTBEAT.md`의 관리 블록이 이전과 같은 형태인지.
3. 앱을 켜고 프로젝트를 연 뒤 새로고침을 여러 번 거쳐도 `shasum ~/.claude/HEARTBEAT.md` 값이 그대로인지.

## 후속 / 리스크

- **TASK-011은 `registry.ts`에 항목 하나와 dream 본문 컴포넌트 하나만 추가하면 된다.** `IntegrationSection.tsx`·`IntegrationCard.tsx`를 고쳐야 한다면 이 작업의 경계가 잘못 잡힌 것이므로 멈추고 보고해 달라는 것이 TASK-011의 지시다. 중복 잡 경고 문구와 항목 표기, 배지 문구는 dream 카드가 정한다.
- **`writeError`가 아직 섹션 단위다.** TASK-012가 dream 쓰기 경로를 만들면 dream 저장 실패 문구가 하트비트 카드에도 뜬다. 훅 상태를 연동별로 나누거나 실패에 연동 이름을 붙이는 결정이 그 작업에 필요하다.
- **`HeartbeatInstallation`(3값)이 백엔드에 남아 있다.** 이제 화면에 나가지 않고 `heartbeat_status.rs` 안에서 접혔다가 서비스에서 다시 펼쳐진다. `read_heartbeat_status`가 `HeartbeatInstallationStatus`를 그대로 돌려주면 왕복이 사라지지만, 두 파일 모두 이 작업의 범위 밖이라 남겼다. TASK-011이 `domain/project.rs`를 만질 때 함께 정리할 수 있다.
- **`heartbeat_status.rs`의 `#![allow(dead_code)]`가 남아 있다.** 파일 안 주석은 "커맨드 계층이 호출하면 지운다"고 적혀 있는데 이미 호출되고 있다. 범위 밖이라 손대지 않았다.
- **`commands/heartbeat.rs` 파일 이름이 이제 섹션 전체를 담는다.** 커맨드 하나가 연동 스냅샷을 돌려주므로 파일 이름과 내용이 어긋난다. TASK-012가 dream 설치 커맨드를 같은 파일에 추가하기로 되어 있으니 그때 함께 정할 문제다.
- **세션 기록은 `docs/development-logs/`에 남기지 않았다.** 워크플로우 작업의 세션 기록은 `reports/`에 남기는 것이 이 저장소의 규약이고, 작업 범위도 그 밖의 파일을 금지한다.
