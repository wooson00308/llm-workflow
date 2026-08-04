# TASK-048 개발자 핸드오프

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 메시지로 보낸 전문을 TL이 그대로 기록했다.

- 대상 작업: TASK-048 (접혀 있는 설치 판정을 설치 단계로 펼쳐 스냅샷에 싣는다)
- 근거 문서: SPEC-016 R1·R2·R3·R4·R5·R9·R10, DECISION-4F1083FF (approved, created_by: user)
- 세션 역할: 개발자 (TL 배정, 병렬 웨이브, 에이전트 `dev-048`)
- 작성 시각: 2026-08-03T12:32Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 선행 선언 `depends_on: [TASK-045]`가 충족이다. 착수 시점 TASK-045는 `qa_waiting`이었고, 그 선행
  사슬(TASK-040 → TASK-042 → TASK-044 → TASK-045)이 `heartbeat_status.rs`·`heartbeat_service.rs`의
  백엔드 겹침을 이미 정리한 뒤였다.
- `migration.lock` 없음. 착수 시점(12:20Z) lease는 `SPEC-009.yml`(만료)·`TASK-043.yml` 둘이고 내
  대상이 아니라 손대지 않았다.
- 선점 helper `.workflow/rules/wf-claim.sh`는 이 저장소에 아직 없다. workflow.md §4의 폴백대로
  `leases/TASK-048.yml`을 `set -o noclobber` 배타 생성으로 만들었고(exit 0), `in_progress` + `history`
  → 구현 → 검증 → `qa_waiting` → lease 반납 순서를 지켰다. 장시간 작업 중 `heartbeat_at`·`expires_at`을
  한 번 갱신했다.

## 구현

### 1. 새 판정 모듈 `infrastructure/heartbeat_setup.rs`

단계 판정을 한곳에 모았다. 이 모듈은 파일을 쓰지 않고 디렉터리도 만들지 않으며 외부 명령을 실행하지
않는다. 입력은 넷이고 그중 판정에 쓰이는 것은 셋이다 — `HEARTBEAT.md` 읽기 결과(`TextSource`),
사용자 홈, dream 스킬 설치 여부. `heartbeat_home`은 판정에 쓰지 않고 2·4단계가 밝힐 `evidence` 경로를
만드는 데만 쓴다. 이 네 번째 인자를 둔 이유는 근거 경로를 화면이 다시 조립하지 않게 하기 위해서다.

- **1단계(package)**: `package_stage(init.state)`. 2단계가 `Done`이면 `Done`, 아니면 `Unknown`.
  `NotDone`을 만들 수 있는 분기가 코드에 없다(R5). `evidence`는 `None`.
- **2단계(init)**: `TextSource`의 세 변형을 그대로 옮긴다 — `Present`→`Done`, `Missing`→`NotDone`,
  `Unreadable`→`Unknown`. **읽기를 새로 추가하지 않았다.** `inspect`가 이미 연 `read.document`를
  그대로 넘겨받는다. `evidence`는 `<하트비트 홈>/HEARTBEAT.md`.
- **3단계(service)**: 아래 별도 절.
- **4단계(dream)**: `dream_integration`이 판정한 `DreamIntegration.installation`을 받아
  `Installed`→`Done`, `NotInstalled`→`NotDone`. **스킬 경로를 다시 읽지 않는다.** `evidence`는
  `heartbeat_dream::skill_path(...)`로, dream payload의 `skillPath`와 같은 함수에서 나온다.
  `required: false`.

명령 원문 넷은 이 모듈의 상수다: `pip install claude-heartbeat` · `heartbeat init` ·
`heartbeat install-service` · `heartbeat install dream`. `launchctl load`는 싣지 않았다 —
`install-service`가 하는 일이고, 명령을 둘로 늘리면 사용자가 어디까지 해야 하는지가 흐려진다.

### 2. 3단계 판정 — 없다고 없는 것이 아니다

DECISION-4F1083FF의 추가 결정을 그대로 코드로 옮겼다.

- macOS이고 `<사용자 홈>/Library/LaunchAgents/com.claude-heartbeat.plist`가 `symlink_metadata`로
  잡히면 **done**. `evidence`는 그 경로다.
- macOS이고 없거나 읽지 못하면 **unknown**. `evidence`는 **그래도 그 경로를 담는다.** 화면이
  "이 경로에 표준 등록물이 없다"와 "이 플랫폼에서는 확인할 방법이 없다"를 `evidence`의 있음·없음으로
  구분해 말할 수 있어야 하기 때문이다.
- 그 밖의 플랫폼은 언제나 **unknown**이고 `evidence`는 `None`.
- **not_done이 되는 분기가 없다.**

`heartbeat_status::probe`를 쓰지 않았다. `probe`는 `NotFound`가 아닌 오류를 "있음"으로 보므로 그대로
쓰면 읽기 실패가 done이 된다. 대신 `fs::symlink_metadata(path).is_ok()`만 done으로 보고 나머지는 전부
unknown으로 접었다. 이 경로의 읽기 실패는 `read_failures`에 넣지 않았다 — 자동 새로고침 주기마다
호출되는 판정이고, 확인 불가는 오류가 아니라 표시 상태이기 때문이다.

pid 파일은 판정에 넣지 않았다. `heartbeat start`로 손수 띄운 데몬은 등록물 없이도 돌고, 그것을 done으로
보면 재부팅 뒤 조용히 멈추는 설치를 "끝났다"고 말하게 된다(R8). 플랫폼 분기는 `cfg!(target_os = "macos")`
(런타임 값이 아닌 컴파일 시점 값)이고 테스트도 같은 조건으로 갈라 썼다.

### 3. 타입과 payload

- `domain/project.rs`에 `HeartbeatSetupStage`(step·state·required·command·evidence),
  `HeartbeatSetupStep`(package|init|service|dream), `HeartbeatSetupState`(done|not_done|unknown)를
  더했다. 두 enum 모두 `#[serde(rename_all = "snake_case")]`라 값 집합이 닫혀 있다.
- `HeartbeatIntegration`에 `pub setup_stages: Vec<HeartbeatSetupStage>`를 더했다.
  **`installation`·`daemon_running`의 계산과 의미는 한 줄도 바뀌지 않았다.** `installation_of`의 OR
  접기와 `HeartbeatInstallation`의 세 값을 그대로 뒀다.

### 4. 사용자 홈 인자

- `HeartbeatService::inspect`에 `user_home: &Path`를 더했고, `install`·`install_dream`도 같은 인자를
  받아 마지막 `self.inspect(...)`로 넘긴다.
- `commands/heartbeat.rs`의 `heartbeat_home`이 홈을 **한 번** 해석해 `(하트비트 홈, 사용자 홈)`을 함께
  돌려준다. `HOME` 환경 변수는 여전히 쓰지 않는다(Windows에서 성립하지 않는다).
- **`heartbeat_home.parent()`로 유도하지 않았다.** 테스트가 임시 디렉터리를 넘기는데 그 부모는 시스템
  임시 디렉터리라, 유도하면 판정이 개발 기기의 실제 파일에 따라 흔들린다.
- `inspect`에서 `dream`을 지역 변수로 먼저 만들고 그 `installation`을 `setup_stages`에 넘긴 뒤
  구조체 리터럴을 만든다. 리터럴 안에서는 dream이 heartbeat보다 먼저 만들어져 값을 건네줄 수 없었다.

### 5. 프런트엔드

타입 미러와 픽스처만이다. 화면 동작은 한 줄도 바뀌지 않았고 이 작업이 끝난 시점의 화면은 이전과 같다.

- `types.ts`에 `HeartbeatSetupStep`·`HeartbeatSetupState`·`HeartbeatSetupStage`와
  `HeartbeatIntegration.setupStages`.
- `IntegrationsView.test.tsx`의 `heartbeat()` 픽스처가 네 단계를 채운다.

## 변경 파일

| 파일 | 성격 |
| --- | --- |
| `src-tauri/src/infrastructure/heartbeat_setup.rs` | 신설. 단계 판정·플랫폼 표·명령 원문 + 단위 테스트 4 |
| `src-tauri/src/infrastructure/mod.rs` | 새 모듈 등록 한 줄 |
| `src-tauri/src/domain/project.rs` | 단계 payload 타입 3종 추가 |
| `src-tauri/src/application/heartbeat_service.rs` | `setup_stages` 필드, `user_home` 인자, 배선, 스냅샷 테스트 5 + 기존 호출부 30곳 기계적 수정 |
| `src-tauri/src/commands/heartbeat.rs` | 홈 1회 해석 → 두 값 반환, 호출 3곳 |
| `src/features/projects/domain/types.ts` | 위 payload의 미러 |
| `src/features/projects/components/integrations/IntegrationsView.test.tsx` | 픽스처가 새 필드를 채움 |
| `src/features/projects/application/useProjectWorkspace.test.ts` | **범위 밖 추가 1줄** (아래 참조) |
| `src/features/projects/components/integrations/DreamCard.test.tsx` | **범위 밖 추가 1줄** (아래 참조) |

### 범위 문서와 다른 점 하나

작업 문서의 참고 사실은 "`IntegrationsView.test.tsx`의 `heartbeat()` 픽스처가 `HeartbeatIntegration`을
통째로 만든다"고 적었으나, 실제로는 **세 곳**이 만든다. `useProjectWorkspace.test.ts:35`와
`DreamCard.test.tsx:97`이 스냅샷 리터럴 안에서 heartbeat payload를 인라인으로 만들어 `tsc`가
`TS2741`로 막았다. 두 파일 모두 하트비트 단계를 읽지 않는 테스트이므로 `setupStages: []` 한 줄씩만
더했다. 기존 단정은 하나도 건드리지 않았다. 이 두 줄이 없으면 완료 조건 7의 `npm run check`가 통과할
수 없어, 컴파일이 강제한 최소 수정으로 판단해 진행했다.

## 검증

작업 문서 「검증 절차」 전부를 실행했다.

| 명령 | 결과 |
| --- | --- |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 통과 (출력 없음) |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 통과 (경고 0) |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **344 passed; 0 failed** (착수 전 335 → 9 추가) |
| `npm run check` | typecheck 통과 / **14 files, 315 tests passed** / `vite build` 성공 |
| `grep -rn "Command::new\|env::var\|PATH" src-tauri/src/infrastructure/heartbeat_setup.rs` | **빈 결과** (exit 1) |

기존 테스트를 삭제·비활성화·약화하지 않았다. `heartbeat_service.rs`의 호출부 30곳은 같은 임시
디렉터리를 두 인자에 넘기는 기계적 수정뿐이고, 픽스처가 없는 기존 테스트의 3단계 판정은 unknown으로
고정된다. `~/.claude` 등 전역 파일에는 아무것도 쓰지 않았다 — 테스트는 전부 `tempdir()`를 쓴다.

### 추가한 테스트 9개

`heartbeat_setup.rs` 단위 4:

- `the_package_step_follows_the_init_step_and_never_reports_not_done` — 문서 세 값에 대해
  done·unknown·unknown이고 not_done이 나오는 입력이 없다 (R5)
- `the_init_step_reports_the_three_states_of_the_document` — 있음·없음·못 읽음이 done·not_done·unknown,
  `evidence`는 판정에 쓴 문서 경로 (R3·R4)
- `the_service_step_never_reports_not_done` — 어떤 입력에서도 not_done이 아니다 (3절)
- `the_stage_list_is_always_four_in_a_fixed_order_with_only_the_dream_step_optional` — 문서 3값 ×
  dream 2값 전 조합에서 (step, required) 목록이 고정 (R2·R9)

`heartbeat_service.rs` 스냅샷 5:

- `an_empty_home_reports_the_four_setup_stages_and_keeps_the_installation` — unknown·not_done·
  unknown·not_done이고 `installation`은 여전히 `not_installed` (R1)
- `a_home_with_only_the_document_has_the_first_two_steps_done_and_stays_installed` — **이 기획서가
  겨냥한 상태.** 1·2단계 done, 3단계 unknown, `installation`은 여전히 `installed` (R1)
- `the_service_step_reads_the_standard_launch_agent_only_on_macos` — plist 있으면 done, 없으면
  unknown이고 두 경우 모두 `evidence`에 그 경로가 남는다. macOS가 아니면 unknown + `evidence: None`
- `the_dream_step_always_matches_the_dream_installation` — 4단계 값이 `snapshot.dream.installation`과
  같고, `evidence`가 `snapshot.dream.skillPath`와 같은 문자열이다 (R9)
- `reading_the_setup_stages_does_not_touch_either_home` — 두 홈의 파일 목록과 수정 시각이 조회 전후로
  같다. 하트비트 홈과 사용자 홈을 서로 다른 임시 디렉터리로 두고 둘 다 본다

## 완료 조건 대조

1. 네 단계를 고정 순서로 싣고 각 단계가 세 상태 중 하나와 명령 원문을 갖는다 — **충족**
   (`the_stage_list_is_always_four_...`, 스냅샷 테스트 2건)
2. 판정이 파일 존재의 읽기에서만 나온다 — **충족** (grep 빈 결과, 모듈에 외부 명령·환경 조회 없음)
3. 1·3단계가 어떤 입력에서도 not_done이 되지 않고 테스트로 고정된다 — **충족** (단위 테스트 2건)
4. `HEARTBEAT.md`만 있는 홈에서 1·2 done, 3 unknown, `installation`은 `installed` — **충족**
5. 4단계 값이 `dream.installation`과 언제나 같고 스킬 경로를 두 번 읽지 않는다 — **충족**
   (판정값을 인자로 받고, 읽기 횟수를 세는 기존 `carrying_the_quota_does_not_add_a_state_file_read`도
   그대로 통과한다)
6. 기존 `installation`·`daemonRunning`의 값과 의미가 그대로이고 관련 기존 테스트가 통과 — **충족**
   (`the_installation_is_reported_as_a_common_state_plus_the_daemon_flag` 무수정 통과)
7. 네 게이트 통과 — **충족**

## 리스크 · 후속

- **3단계 done 판정의 사각.** 이 저장소의 도그푸딩 머신은 `com.catze.dream-heartbeat.plist`로 등록해
  데몬이 실제로 돌고 있다. 이 판정에서 그 머신은 3단계가 **unknown**이 된다(not_done이 아니다).
  결정문이 요구한 그대로이지만, "다른 이름으로 등록해 데몬이 이미 돈다면 이 단계는 끝난 것"이라는
  안내 문구를 화면이 반드시 붙여야 이 상태가 사용자에게 이해된다. 그 문구는 TASK-049의 몫이다.
- **읽기 실패를 조용히 삼킨다.** plist를 권한 문제 등으로 읽지 못하면 unknown으로만 나가고
  `read_failures`에는 남지 않는다. 확인 불가와 읽기 실패를 구분해야 할 필요가 생기면 그때 필드를
  늘리는 쪽이 낫다고 판단했다.
- **`setup_stages`를 아직 아무도 읽지 않는다.** 화면은 이전과 동일하다. TASK-049 전까지 이 값은
  payload에만 실린다.
- **병렬 세션 관측.** 실행 시점에 `heartbeat_condition.rs`·`role_eligibility.rs`(TASK-043)와
  `fs_project_repository.rs`·`domain/project.rs`(dev-057)가 같은 트리에서 편집 중이었다. 최종 검증
  시점의 `cargo test` 344건은 전부 통과했고 빨간 모듈이 없었다. `domain/project.rs`는 TL이 승인한
  명시 예외로, 백엔드 편집 중 **맨 마지막**에 파일을 다시 읽고 그 위에 얹었다(dev-057의 편집 지점은
  `WorkflowItemSummary.status` 주석 :111 부근, 내 추가 지점은 `HeartbeatInstallation` 뒤 :280 부근으로
  겹치지 않는다). `fs_project_repository.rs`·`heartbeat_condition.rs`·`role_eligibility.rs`는 열지도
  않았다.

## 사용자 QA 제안

이 작업은 화면을 바꾸지 않으므로 눈으로 확인할 것은 없다. 대신 payload가 이 기기의 실제 상태를 맞게
말하는지를 본다.

1. **판정이 자기 기기와 맞는지.** `ls ~/Library/LaunchAgents/com.claude-heartbeat.plist`가 "없음"인지
   확인한다 — 없으면 이 기기의 3단계는 **unknown**이 맞다(도그푸딩 머신은
   `com.catze.dream-heartbeat.plist`로 등록돼 있다). macOS 분기 자체는
   `cargo test --manifest-path src-tauri/Cargo.toml -- the_service_step`으로 확인된다.
2. **`HEARTBEAT.md`만 있는 상태의 값.** `ls ~/.claude/HEARTBEAT.md`가 있으면 1·2단계는 done이고
   배지는 지금처럼 "설치됨"이어야 한다. 카드의 배지 문구가 이전과 같은지 눈으로 확인한다.
3. **회귀 확인.** 연동 섹션을 열어 하트비트·dream 카드의 배지·쿼터·중복 경고가 이전과 같은지 본다.
   이 작업은 그 값들을 만지지 않았다.
4. **전역 파일 무변경.** `ls -la ~/.claude/` 수정 시각이 이 세션 전후로 같아야 한다. 판정 경로는
   아무것도 쓰지 않는다.

## 다음 역할에 넘기는 것

- TASK-049(마법사 화면)가 이 payload를 읽는다. 화면이 다시 정렬하지 않아야 하고, `evidence`가
  `None`인 것과 값이 있는 것을 다른 문구로 말해야 한다(3절).
- TASK-050(명령 복사)이 `command` 문자열을 그대로 쓴다. 조각을 조립할 필요가 없다.
