# TASK-107 개발자 핸드오프

- 대상: TASK-107 (갱신 안내의 명령 원문을 백엔드가 완성해 싣는다)
- 근거: SPEC-034 R3·R4·R6·R7, 완료 조건 5·6·7·9·11·12·14·15,
  DECISION-3ECEDCA1 (`schema: workflow-labs/decision@1`, `spec_id: SPEC-034`, `outcome: approved`,
  `created_by: user`, 2026-08-04T16:56:16Z — 직접 확인. SPEC-034의 결정 문서는 이 1건뿐이라 더 늦은
  결정이 없다. 본문이 비어 있으므로 "확인 필요" 네 항목은 전부 제안대로다)
- 역할: 개발자 (developer-claude)
- 선점: `acquire TASK-107 developer-claude 30` exit 0 → `lease-37051-20260804194051` →
  `in_progress`(2026-08-04T19:41:20Z) → 구현 → 검증 → `qa_waiting`. 중간에 renew exit 0 1회.

## 선행 확인

`depends_on` 키가 없다 — 기다리는 것이 없다.

- 착수 시점 `todo`는 TASK-106·107·108·109 4건. 106은 `depends_on: [TASK-104]`이고 TASK-104가
  `in_progress`라 미충족, 108은 `[TASK-107]`, 109는 `[TASK-108]`이라 둘 다 미충족. 선행이 충족된
  `todo`는 TASK-107 하나뿐이었다.
- 착수 시점 lease 둘은 모두 만료였다 — `SPEC-009.yml`(만료 2026-08-03T01:20:00Z),
  `TASK-104.yml`(만료 2026-08-04T19:37:05Z, 판정 시각 19:39:41Z). TASK-107을 덮는 lease는 없었다.
- 겹침 선언(`overlaps` 계열) 필드를 쓰는 작업 문서는 이 워크플로우에 아직 없다. 설치된 계약
  (`workflow.md` rules_version 9, `roles/developer.md` rules_version 4)에도 그 필드가 없다 —
  TASK-101·102가 만드는 것이고 둘 다 `qa_waiting`이다.
- 범위 파일을 함께 만지는 다른 열린 작업은 없다. `in_progress`인 TASK-104는
  `heartbeat_condition.rs`·`role_eligibility.rs`가 범위이고, `todo`인 TASK-106은 조건 스크립트
  회귀 검사, TASK-108·109는 프론트엔드다.

## 만든 것

### 새 모듈 전문의 값 (완료 조건 2)

`src-tauri/src/infrastructure/heartbeat_update.rs`. 명령 원문 다섯이 전부 모듈 상수다.
`heartbeat_setup.rs:29`~`:32`가 같은 모양이고, R3이 가리키는 선례가 그것이다.

```rust
const IDENTIFY_COMMAND: &str = "pip show claude-heartbeat";
const PACKAGE_COMMAND: &str = "pip install -U claude-heartbeat";
const SOURCE_COMMAND: &str = "git pull";
const SERVICE_LOOKUP_COMMAND: &str = "launchctl list | grep heartbeat";
const SERVICE_RESTART_COMMAND: &str = "launchctl kickstart -k gui/$(id -u)/<라벨>";
```

조립 함수는 입력이 없다. 갈림은 `cfg!(target_os = "macos")` 하나이고 런타임 값이 아니라 컴파일
시점 값이다 — `heartbeat_setup.rs`의 `service_stage`(`:102`)와 같은 어법이다.

```rust
pub(crate) fn update_guide() -> HeartbeatUpdateGuide {
    let macos = cfg!(target_os = "macos");
    HeartbeatUpdateGuide {
        identify_command: IDENTIFY_COMMAND.to_owned(),
        package_command: PACKAGE_COMMAND.to_owned(),
        source_command: SOURCE_COMMAND.to_owned(),
        service_lookup_command: macos.then(|| SERVICE_LOOKUP_COMMAND.to_owned()),
        service_restart_command: macos.then(|| SERVICE_RESTART_COMMAND.to_owned()),
    }
}
```

### 판정을 만들지 않았다 (완료 조건 5·8)

- 새 모듈 전문에 `fs::`·`Command`·`std::process`가 **한 번도 없다.**
  `grep -n "fs::\|Command\|std::process" src-tauri/src/infrastructure/heartbeat_update.rs` → 일치
  0건(exit 1).
- 같은 grep에 `version`도 0건이다. `--version`을 부르는 경로도, `state.json`에서 버전을 찾는
  코드도 만들지 않았다. 이 작업의 변경분 네 파일 어디에도 데몬 버전을 읽는 코드가 없다.
- 표시 조건을 백엔드에 두지 않았다. payload는 조회 상태와 무관하게 언제나 실린다 — 084 경고가 뜨는
  조건은 화면의 `missingRunEvidence`가 이미 갖고 있다.

### 값이 놓인 자리

`IntegrationsSnapshot`의 **섹션 공통 영역**에 `update_guide` 하나를 더했다
(`heartbeat_service.rs:41`~). 이미 같은 이유로 공통 영역에 있는 `managed_block_failure`·
`jobs_file_path` 옆이고, `heartbeat.setup_stages`에는 얹지 않았다. 구조체는
`domain/project.rs`의 `HeartbeatSetupState` 바로 뒤, `HeartbeatSetupStage` 옆에 두었다.

## 변경한 파일 (범위 그대로 넷)

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/infrastructure/heartbeat_update.rs` | 신규. 상수 5, 조립 함수 1, `mod tests` 3건 |
| `src-tauri/src/infrastructure/mod.rs` | `pub mod heartbeat_update;` 한 줄 |
| `src-tauri/src/domain/project.rs` | `HeartbeatUpdateGuide` 구조체 (`#[serde(rename_all = "camelCase")]`) |
| `src-tauri/src/application/heartbeat_service.rs` | 필드 1, import 2, 조립 1줄, `mod tests` 3건 |

`git diff --stat`으로 확인한 순증은 `heartbeat_service.rs` +92/-2, `domain/project.rs` +54(그중 이
작업의 것은 `HeartbeatSetupState` 뒤 마지막 훅 1개 — 앞 훅 셋은 착수 전부터 있던 다른 세션의
미커밋 변경이다), `infrastructure/mod.rs` +1.

**그 외 파일은 건드리지 않았다.** 특히:

- `src-tauri/src/infrastructure/heartbeat_setup.rs` — `git diff --stat` 출력 줄 수 0. `PACKAGE_COMMAND`
  (`:29`)를 포함해 파일 전체가 그대로다(승인된 확인 필요 3번).
- `src/features/projects/domain/types.ts` 를 비롯한 프론트엔드 일체 — 이 세션이 만지지 않았다.
  (이 파일에는 착수 전부터 다른 세션의 미커밋 변경이 있다. 이 작업이 더한 것은 없다.)
- `launchctl`을 실행하지 않았다. 조사도 재시작도 하지 않았다.

## 검증

작업 문서의 검사 6개를 그대로 넣었다. 자리는 `heartbeat_update.rs`의 `mod tests`와
`heartbeat_service.rs`의 `mod tests` 둘이고, **기존 검사는 이름도 내용도 고치지 않았다.**

| 검사 | 테스트 | 결과 |
| --- | --- | --- |
| 1. 조회 결과에 다섯 값이 상수대로 실린다 | `the_snapshot_carries_the_update_guide_in_the_shared_area` / `the_guide_carries_the_command_constants_as_they_are` | ok |
| 2. 상태와 무관하게 같다 | `the_update_guide_does_not_change_with_the_install_or_daemon_state` (빈 홈 / 잡 설치된 홈 / pid 파일 있는 홈 3종) | ok |
| 3. 플랫폼 갈래 | `the_restart_commands_are_present_only_on_macos` (`cfg!`로 갈라 macOS는 `Some`, 그 밖은 `None`) | ok |
| 4. 앱이 모르는 값이 없다 | `no_command_carries_a_value_the_app_cannot_know` (`/Users/`·`.pyenv`·`com.` 0건, 자리 표시자 `<라벨>` 1개) | ok |
| 5. 마법사가 그대로다 | `the_setup_wizard_commands_are_unchanged_and_agree_with_the_update_guide` (네 단계 명령 원문 고정 + 1단계와 pip 갱신 명령의 설치 모델 일치) | ok |
| 6. 조회가 어느 홈도 쓰지 않는다 | 기존 `reading_the_setup_stages_does_not_touch_either_home` **수정 없이** 통과 | ok |

명령과 결과:

- `cargo fmt --manifest-path src-tauri/Cargo.toml` — 적용
- `cargo test --manifest-path src-tauri/Cargo.toml` — **442 passed; 0 failed; 0 ignored**
  (신규 6건 전부 통과)
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — 경고 0
- `npm run check` — typecheck 통과, vitest **530 passed (20 files)**, `vite build` 성공

착수 시점 `heartbeat_service.rs`의 `#[test]` 개수는 **98**, 지금은 **101**(순증 3, 삭제 0).
저장소 전체 `#[ignore]`는 착수 시점과 같은 **0건**이다(완료 조건 9).

## 완료 조건 대조

1. 공통 영역에 실리고 다섯 값이 표대로다 — 검사 1. ✅
2. 명령 원문이 백엔드 상수다 — 위에 전문 인용. ✅
3. 재시작 두 값이 macOS에서만 `Some`이고 라벨을 지어내지 않는다 — 검사 3·4. ✅
4. 설치·실행 상태에 따라 달라지지 않는다 — 검사 2. ✅
5. 파일을 읽거나 명령을 실행하는 코드가 없다 — grep 0건, 전문 인용. ✅
6. 마법사 1단계 문구가 그대로이고 갱신 안내가 같은 설치 모델을 말한다 — 검사 5. ✅
7. 설치 판정·잡 저장·"지금 실행"이 달라지지 않는다 — `heartbeat_service.rs` 기존 98건이 수정 없이
   통과. ✅
8. 데몬 버전을 읽는 코드가 없다 — 변경분에 `--version`·버전 조회 경로 0건. ✅
9. 기존 자동 테스트 삭제·비활성화 0건 — 98 → 101, `#[ignore]` 0. ✅
10. `cargo test`와 `npm run check` 통과. ✅

## 사용자 QA 안내

앱이 아직 이 값을 화면에 그리지 않으므로(화면은 TASK-108·109) 확인은 payload 수준이다.

1. `cargo test --manifest-path src-tauri/Cargo.toml`이 442건 통과하는지.
2. `npm run check`가 통과하는지.
3. 설치 마법사(하트비트 카드)의 네 단계 명령 문구가 이전과 같은지 — 눈으로 확인.
4. 값을 눈으로 보고 싶으면 `read_integrations` 응답의 `updateGuide` 키다. macOS에서는 다섯 값이
   모두 있고, `serviceRestartCommand`의 `<라벨>`이 빈자리로 남아 있는 것이 의도다.

## 리스크와 핸드오프 (역할 밖 발견)

- **`<라벨>` 빈자리를 문구로 설명하는 일은 이 작업에 없다.** payload는 자리만 비워 두고, "앱이 이
  값을 모른다"고 말하는 것은 TASK-108 완료 조건 5의 몫이다. 화면이 그 문장을 붙이지 않으면
  사용자는 `<라벨>`을 그대로 붙여 넣게 된다.
- **macOS 밖에서는 재시작 걸음이 통째로 비어 있다.** Linux·Windows 사용자는 갱신 명령까지만 보고
  재시작 방법을 받지 못한다. 확인하지 않은 절차를 싣지 않는 것이 R2의 선택이지만, 그 플랫폼의
  절차가 확인되면 이 상수 둘을 늘리는 것이 후속 자리다.
- **`pip install -U claude-heartbeat`는 지금 실패하는 명령이다**(SPEC-034 확인 사실 3, PyPI 404).
  기획서가 승인된 확인 필요 3번으로 그대로 두기로 한 상태이고, 이 작업은 그 결정을 따랐다. 해소는
  데몬 저장소의 PyPI 배포이지 앱 문구 수정이 아니다.
- **TASK-104가 `in_progress`인 채 lease가 만료돼 있다.** 착수 시점(2026-08-04T19:39:41Z) 기준
  만료 2026-08-04T19:37:05Z. 이 작업의 범위와 겹치지 않아 진행에 지장은 없었지만, 그 작업을 잡았던
  세션이 끝났는지는 이 세션이 판단할 자리가 아니다. 개발자 자격 판정은 `todo`만 보므로 TASK-104는
  누구에게도 잡히지 않는 상태로 남아 있다.
