---
schema: workflow-labs/task@1
id: TASK-048
title: 접혀 있는 설치 판정을 설치 단계로 펼쳐 스냅샷에 싣는다
status: verified
source_spec_id: SPEC-016
source_decision_id: DECISION-4F1083FF
depends_on:
- TASK-045
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T07:45:00Z
  kind: created
- at: 2026-08-03T12:20:49Z
  kind: in_progress
- at: 2026-08-03T12:32:29Z
  kind: qa_waiting
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-4F1083FF
work_group_revision: 1
---

# 접혀 있는 설치 판정을 설치 단계로 펼쳐 스냅샷에 싣는다

SPEC-016 R1·R2·R3·R4·R5·R10의 백엔드 몫을 구현한다. 화면은 한 줄도 바꾸지 않는다. 이 작업이 끝난
시점의 화면은 지금과 같고, 스냅샷에 아직 아무도 읽지 않는 단계 목록이 실린다. 그 목록을 그리는 일은
TASK-049다.

앱은 이미 세 신호를 읽는다. `~/.claude/HEARTBEAT.md`, `~/.claude/heartbeat/`,
`~/.claude/heartbeat/heartbeat.pid`. 문제는 읽은 뒤 셋을 OR로 접어 `installed` 한 값으로 만든다는
것이다(`heartbeat_status.rs`의 `installation_of`). 이 작업은 새 감지 수단을 만들지 않고 그 접기를 푼다.
새로 읽는 파일은 서비스 등록 아티팩트 하나뿐이다.

## 의존성

- **선행 필수: TASK-045.** DECISION-4F1083FF 확인 필요 6번이 "SPEC-015 파생 작업 뒤에 서도록
  `depends_on`으로 선언"을 승인했다. 근거는 둘이다. R10이 플랫폼별 명령·경로를 요구하는데 그 분기의
  기준을 SPEC-015가 세우고, TASK-045가 Windows 차단을 풀어야 Windows 사용자가 이 단계 표시를 실제로
  만난다. 파일도 겹친다 — 둘 다 `heartbeat_service.rs`를 만진다. TASK-045의 선행 사슬
  (TASK-040 → TASK-042 → TASK-044 → TASK-045)에 `heartbeat_status.rs`를 만지는 TASK-044가 들어 있어,
  이 선행 하나로 백엔드 겹침이 모두 정리된다.
- **TASK-035·TASK-037과 병행 금지.** 셋 다 `src-tauri/src/domain/project.rs`를 만진다. 서로 다른
  타입을 더하므로 순서는 어느 쪽이 먼저여도 된다.
- **TASK-030·TASK-032·TASK-035·TASK-038과 병행 금지.** `src/features/projects/domain/types.ts`가
  겹친다. 순서는 어느 쪽이 먼저여도 된다.
- **TASK-046과 병행 금지.** 둘 다 `IntegrationsView.test.tsx`를 만진다. 이 작업은 픽스처의 필드
  하나만 더하고 TASK-046은 실행 결과 라벨 단정을 고친다. 순서는 어느 쪽이 먼저여도 된다.

## 범위

- `src-tauri/src/infrastructure/heartbeat_setup.rs` — 신설. 단계 판정과 플랫폼 표.
- `src-tauri/src/infrastructure/mod.rs` — 새 모듈 등록.
- `src-tauri/src/domain/project.rs` — 단계 payload 타입.
- `src-tauri/src/application/heartbeat_service.rs` — `HeartbeatIntegration`에 단계 목록 추가,
  `inspect`·`install`·`install_dream`의 사용자 홈 인자.
- `src-tauri/src/commands/heartbeat.rs` — 홈을 한 번 해석해 두 값으로 넘긴다.
- `src/features/projects/domain/types.ts` — 위 payload의 미러.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 픽스처가 새 필드를
  채우게 하는 최소 수정.
- 그 외 파일은 건드리지 않는다. 특히 `HeartbeatCard.tsx`·`DreamCard.tsx`·`IntegrationCard.tsx`·
  `IntegrationsView.tsx`·`App.css`·`heartbeat_dream.rs`·`heartbeat_roles.rs`·`heartbeat_condition.rs`·
  `heartbeat_jobs.rs`는 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **기존 `installation` 값의 의미를 바꾸지 않는다**(R1). 그 값에 의존하는 배지와 분기가 이미 있다.
  `installation_of`의 OR 판정과 `HeartbeatInstallation`의 세 값은 그대로 둔다. 단계 정보는 더해서
  싣는다.
- **판정을 위해 외부 명령을 실행하지 않는다**(기획서 제외 범위). `heartbeat status`도
  `heartbeat skills`도 부르지 않는다. 판정은 전부 파일 존재의 읽기다.
- **PATH를 훑어 실행 파일을 찾지 않는다**(R5). GUI 앱의 PATH가 사용자 셸의 PATH와 다르다는 것이
  도구 자신의 launchd plist에서 확인된다. 설치해 둔 사용자에게 미설치라고 말하는 오탐이 나온다.
- **없는 파일은 오류가 아니다.** 이 경로는 자동 새로고침 주기마다 호출된다. 파일이 없다고 화면이
  에러로 덮이면 안 된다.
- **dream 스킬을 다시 감지하지 않는다.** 같은 경로를 두 번 읽으면 읽기 실패 목록에 같은 경로가 두 번
  들어간다. `dream_integration`이 이미 판정한 값을 넘겨받아 쓴다.

### 1. 단계 payload 타입

`domain/project.rs`에 둔다. `JobQuota`·`HeartbeatInstallationStatus`와 같은 자리이고, 화면이 쓰는
값의 정의가 한 파일에 모인다.

```rust
pub struct HeartbeatSetupStage {
    pub step: HeartbeatSetupStep,     // package | init | service | dream
    pub state: HeartbeatSetupState,   // done | not_done | unknown
    /// 1~3은 참, dream은 거짓(R9).
    pub required: bool,
    /// 사용자가 자기 터미널에 그대로 붙여 넣을 명령 원문(R6).
    pub command: String,
    /// 판정에 쓴 경로. 감지하지 않는 단계와 이 플랫폼에서 볼 경로가 없는 단계는 `None`이다.
    pub evidence: Option<String>,
}
```

- `step`·`state`는 `#[serde(rename_all = "snake_case")]` enum이다. 문자열로 두지 않는다 — 화면이
  단계마다 다른 문구를 쓰므로 값 집합이 닫혀 있어야 한다.
- 순서는 고정이다(R2). 목록은 언제나 넷이고 `package` → `init` → `service` → `dream` 순서다. 이
  순서를 화면이 다시 정렬하지 않는다.
- `HeartbeatIntegration`(`heartbeat_service.rs:87`)에 `pub setup_stages: Vec<HeartbeatSetupStage>`로
  싣는다. dream 단계가 하트비트 payload에 들어가는 이유는 이것이 하트비트 카드의 마법사이기 때문이다.
  dream 카드는 이 값을 읽지 않는다.

### 2. 판정 규칙

`heartbeat_setup.rs`가 단계 목록을 만든다. 입력은 셋이다 — `HEARTBEAT.md` 읽기 결과(있음·없음·못 읽음),
사용자 홈 경로, dream 스킬 설치 여부. 이 모듈은 파일을 쓰지 않고 디렉터리도 만들지 않는다.

| 단계 | done | not_done | unknown |
| --- | --- | --- | --- |
| 1. 패키지 설치 | 2단계가 done | 없음 | 2단계가 done이 아닐 때 |
| 2. `heartbeat init` | `HEARTBEAT.md` 있음 | 없음 | 읽지 못함 |
| 3. `heartbeat install-service` | 표준 등록 아티팩트 있음 | 없음 | 그 밖의 전부 |
| 4. dream 스킬 | dream 스킬 설치됨 | 설치 안 됨 | 없음 |

- **1단계는 독립 감지를 하지 않는다**(R5). 2단계가 done이면 done, 아니면 unknown이다. **not_done이
  될 수 없다.** 앱은 패키지가 없다고 말할 근거를 갖지 못한다. `evidence`는 `None`이다.
- **2단계는 not_done이 나오는 유일한 필수 단계다.** `HEARTBEAT.md`가 `NotFound`면 not_done,
  읽었으면 done, `NotFound`가 아닌 오류면 unknown이다. 지금 `read_text`가 돌려주는 `TextSource`의
  세 값(`Present`·`Missing`·`Unreadable`)이 그대로 이 셋이다. 새 읽기를 추가하지 말고 조회가 이미 연
  결과를 쓴다. `evidence`는 판정에 쓴 `HEARTBEAT.md` 경로다.
- **4단계는 dream 카드의 판정을 그대로 따른다**(R9). `DreamIntegration.installation`이 `installed`면
  done, `not_installed`면 not_done이다. 별도의 unknown을 만들지 않는다 — 두 화면이 같은 것을 각자
  판정하면 갈라진다. `evidence`는 dream payload가 쓰는 것과 같은 스킬 경로다.

### 3. 서비스 등록 판정 — 없다고 없는 것이 아니다

DECISION-4F1083FF가 이 단계에 R4의 원칙을 그대로 적용하라고 정했다. **표준 아티팩트가 없다는 것은
"등록 안 됨"의 충분한 근거가 아니다.** 사용자가 다른 라벨로 등록한 설치가 실존한다 — 이 저장소의
도그푸딩 머신이 `com.catze.dream-heartbeat.plist`로 등록해 데몬이 실제로 돌고 있다. 결정문이 구체
판정 규칙을 아키텍트에게 맡겼고, 규칙은 다음과 같다.

- macOS이고 `<사용자 홈>/Library/LaunchAgents/com.claude-heartbeat.plist`가 있으면 **done**.
  `evidence`는 그 경로다.
- macOS이고 그 파일이 없거나 읽지 못하면 **unknown**. `evidence`는 **그래도 그 경로를 담는다.**
  화면이 "이 경로에 표준 등록물이 없다"와 "이 플랫폼에서는 확인할 방법이 없다"를 구분해 말해야
  하는데, 그 구분이 `evidence`의 있음·없음으로 나온다.
- 그 밖의 플랫폼은 언제나 **unknown**이고 `evidence`는 `None`이다. Linux(systemd user unit)와
  Windows(Task Scheduler)의 아티팩트 위치는 확인되지 않았고, 특히 Windows는 등록물이 파일이 아니라
  스케줄러의 항목이라 파일 존재 판정이 성립하지 않을 수 있다. 이것이 기획서 확인 필요 2번의 승인된
  (A)안이다.
- **이 단계는 not_done이 될 수 없다.** 표를 그렇게 읽어야 한다.

pid 파일(데몬 실행 여부)을 이 판정에 넣지 않는다. `heartbeat start`로 손수 띄운 데몬은 등록물 없이도
돌고, 그것을 done으로 보면 재부팅 뒤 조용히 멈추는 설치를 "끝났다"고 말하게 된다. 지금 사람이 실제로
막히는 자리가 바로 거기다(R8). 데몬 실행 여부는 화면이 이미 `daemonRunning`으로 알고 있으므로 문구를
고르는 데 쓰면 된다. 판정에는 쓰지 않는다.

플랫폼 분기는 `cfg!(target_os = "macos")`로 한다. 런타임 값이 아니라 컴파일 시점 값이므로 테스트도
같은 조건으로 갈라 쓴다(`heartbeat_service.rs:931`이 `!cfg!(windows)`로 쓰는 방식과 같다).

### 4. 사용자 홈 인자

지금 서비스가 받는 경로는 `heartbeat_home`(`~/.claude`) 하나다. 3단계 아티팩트는 `~/.claude` 밖에
있으므로 사용자 홈이 따로 필요하다.

- `HeartbeatService::inspect`에 `user_home: &Path`를 더한다. `install`·`install_dream`도 마지막에
  `self.inspect(...)`를 부르므로 같은 인자를 받는다.
- `commands/heartbeat.rs`의 `heartbeat_home`은 홈을 한 번 해석해 두 값을 함께 돌려주도록 고친다.
  홈 해석은 지금처럼 커맨드 계층에서만 하고 `HOME` 환경 변수는 쓰지 않는다.
- **`heartbeat_home.parent()`로 유도하지 않는다.** 테스트는 임시 디렉터리를 `heartbeat_home`으로
  넘기는데, 그 부모는 시스템 임시 디렉터리라 판정이 개발 기기의 실제 파일에 따라 흔들린다.
- 기존 테스트 23곳의 `HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path())`는 같은
  임시 디렉터리를 두 인자에 넘기는 기계적 수정이다. 그러면 3단계 픽스처는 `<임시 홈>/Library/
  LaunchAgents/` 아래에 만들면 되고, 픽스처가 없는 기존 테스트의 판정은 unknown으로 고정된다.

### 5. 명령 원문

단계마다 명령 하나씩이다(R6). 화면이 조각을 조립하지 않게 백엔드가 완성된 문자열을 싣는다.

- 1단계 `pip install claude-heartbeat`
- 2단계 `heartbeat init`
- 3단계 `heartbeat install-service`
- 4단계 `heartbeat install dream`

네 명령 모두 플랫폼과 무관하다. R10이 요구하는 플랫폼 차이는 3단계의 아티팩트 경로와 감지 가능
여부에서 나오고, 그것은 3절이 처리한다. `launchctl load`는 싣지 않는다 — `install-service`가 하는
일이고, 명령을 둘로 늘리면 사용자가 무엇까지 해야 하는지가 흐려진다.

### 6. 테스트

`heartbeat_setup.rs`의 단위 테스트:

- 2단계가 done이면 1단계도 done이고, 2단계가 done이 아니면 1단계는 unknown이다. 1단계가 not_done이
  되는 입력이 없다. (R5)
- `HEARTBEAT.md` 있음·없음·못 읽음이 각각 done·not_done·unknown이다. (R3·R4)
- 3단계는 어떤 입력에서도 not_done이 되지 않는다. (3절)
- 단계 목록은 언제나 넷이고 순서가 고정이며, 넷째만 `required: false`다. (R2·R9)

`heartbeat_service.rs`의 스냅샷 테스트:

- 빈 홈에서 스냅샷의 단계가 순서대로 unknown·not_done·unknown·not_done이고 `installation`은
  지금처럼 `not_installed`다. (R1)
- `HEARTBEAT.md`만 있는 홈에서 1·2단계가 done, 3단계가 unknown, `installation`은 지금처럼
  `installed`다. **이 조합이 이 기획서가 겨냥한 상태다.**
- macOS에서 `<사용자 홈>/Library/LaunchAgents/com.claude-heartbeat.plist`를 만들면 3단계가 done이
  되고, 없으면 unknown이며 `evidence`에는 그 경로가 남는다. macOS가 아니면 unknown이고 `evidence`가
  `None`이다. (`cfg!(target_os = "macos")`로 갈라 쓴다)
- dream 스킬 파일이 있으면 4단계가 done, 없으면 not_done이고, 그 값이 `snapshot.dream.installation`과
  언제나 같다. (R9)
- 단계를 읽어도 하트비트 홈이 바뀌지 않는다. 기존 `reading_the_status_does_not_touch_the_heartbeat_home`과
  같은 형식으로, 이번에는 사용자 홈까지 포함해 확인한다.

프런트엔드는 타입 미러와 픽스처만 고친다. 화면 동작 테스트는 TASK-049다.

## 완료 조건

1. 스냅샷의 하트비트 payload가 네 단계를 고정 순서로 싣고, 각 단계가 done·not_done·unknown 중
   하나와 명령 원문을 갖는다. (기획서 완료 조건 1의 payload 몫, R1·R2)
2. 모든 단계 판정이 파일 존재의 읽기에서만 나온다. 판정을 위해 실행되는 외부 명령이 없고 PATH를
   훑는 코드가 없다. (기획서 완료 조건 2, R3·R5)
3. 1단계와 3단계는 어떤 입력에서도 not_done이 되지 않고, 그 사실이 테스트로 고정된다.
   (R4·R5 + DECISION-4F1083FF의 추가 결정)
4. `HEARTBEAT.md`만 있는 홈에서 1·2단계가 done, 3단계가 unknown이고 `installation`은 여전히
   `installed`다. (기획서 완료 조건 3의 payload 몫, R1)
5. 4단계 값이 같은 스냅샷의 `dream.installation`과 언제나 같고, dream 스킬 경로를 두 번 읽지
   않는다. (R9)
6. 기존 `installation`·`daemonRunning`의 값과 의미가 바뀌지 않았고, 그것을 확인하는 기존 테스트가
   삭제·비활성화 없이 통과한다. (R1)
7. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

판정에 외부 명령이나 PATH 탐색이 섞이지 않았는지 확인한다.

```sh
grep -rn "Command::new\|env::var\|PATH" src-tauri/src/infrastructure/heartbeat_setup.rs
```

## 범위 밖

- 마법사 화면과 표시 조건. TASK-049다. 이 작업이 끝난 시점에 화면은 지금과 같다.
- 명령 복사 수단. TASK-050이다.
- Linux·Windows의 서비스 등록 아티팩트 조사. 기획서 확인 필요 2번이 (A)안으로 승인됐다.
- 데몬 프로세스의 생존 확인. pid 파일이 남는 한계는 이 기획서가 고치지 않는다.
- `installation`을 단계 값으로 대체하거나 `HeartbeatInstallation` 세 값을 정리하는 것. (R1)
- dream 스킬 설치 판정 자체의 변경. dream 카드가 그 소유자다.
- 서비스 등록 실패의 원인 진단(`launchd_stderr.log` 해석).
- 하트비트 패키지 수정.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `installation_of`(`heartbeat_status.rs:99`)가 문서 존재·`heartbeat/` 존재·pid 존재를 OR로 접는다.
  `collapse`(`domain/project.rs:226`)가 그 결과를 화면용 세 값으로 다시 접는다.
- `read_text`(`heartbeat_status.rs:284`)는 `Present`·`Missing`·`Unreadable` 세 값을 돌려주고,
  `probe`(`:297`)는 `NotFound`가 아닌 오류를 "있음"으로 보며 실패 목록에 남긴다. 3단계에 `probe`를
  그대로 쓰면 읽기 실패가 done이 되므로 이 단계에는 세 값을 구분하는 판정이 필요하다.
- `inspect`(`heartbeat_service.rs:279`)는 문서를 한 번만 읽고 그 결과를 두 연동에 나눠 쓴다.
  `read.document`가 `TextSource`이고 `read.document.unreadable()`이 이미 `managed_block_failure`로
  나간다.
- `install`(`:354`)과 `install_dream`(`:389`)이 마지막에 `self.inspect(project_root, heartbeat_home)`을
  부른다.
- `dream_integration`(`:616`)이 `read_dream_status`로 스킬 경로를 판정하고
  `heartbeat_dream::skill_path`(`heartbeat_dream.rs:140`)가 `~/.claude/skills/dream/SKILL.md`를 만든다.
  `inspect`의 구조체 리터럴에서 dream이 heartbeat보다 먼저 만들어진다.
- `heartbeat_home`(`commands/heartbeat.rs:65`)은 `app.path().home_dir()`에 `.claude`를 붙인다.
  `HOME` 환경 변수를 쓰지 않으므로 Windows에서도 성립한다.
- `heartbeat install-service --print-only`의 macOS 결과는 `~/Library/LaunchAgents/com.claude-heartbeat.plist`,
  Label `com.claude-heartbeat`, 로드 명령 `launchctl load <plist 경로>`다(기획서 확인 사실).
- 도그푸딩 머신의 실제 등록물은 `com.catze.dream-heartbeat.plist`다(DECISION-4F1083FF).
- `HeartbeatService.inspect(...)` 호출은 제품 코드 2곳, 테스트 23곳이다.
- `IntegrationsView.test.tsx`의 `heartbeat()` 픽스처가 `HeartbeatIntegration`을 통째로 만든다.
  필드가 늘면 이 픽스처가 컴파일 오류로 먼저 알려 준다.
