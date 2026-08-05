//! 설치 단계 판정. 접혀 있던 설치 신호를 네 단계로 펼쳐 화면이 쓸 목록을 만든다(SPEC-016 R1).
//!
//! 이 모듈은 파일을 쓰지 않고 디렉터리도 만들지 않으며 외부 명령을 실행하지 않는다. 판정은 전부
//! 파일 존재의 읽기다(R3). 실행 파일을 찾아 다니지도 않는다 — GUI로 띄운 앱이 물려받는 환경이
//! 사용자 셸의 것과 달라, 설치해 둔 사용자에게 미설치라고 말하는 오탐이 나온다(R5).
//!
//! 없는 파일은 오류가 아니다. 이 판정은 자동 새로고침 주기마다 호출되므로 파일이 없다고 화면이
//! 에러로 덮이면 안 된다.

use std::fs;
use std::path::Path;

use crate::domain::project::{
    HeartbeatSetupStage, HeartbeatSetupState, HeartbeatSetupStep, IntegrationInstallation,
};
use crate::infrastructure::heartbeat_dream;
use crate::infrastructure::heartbeat_status::TextSource;

const HEARTBEAT_FILE: &str = "HEARTBEAT.md";

/// macOS 표준 서비스 등록 아티팩트. `heartbeat install-service --print-only`가 출력하는 값이다.
const LAUNCH_AGENTS_DIRECTORY: &str = "Library";
const LAUNCH_AGENTS_SUBDIRECTORY: &str = "LaunchAgents";
const LAUNCH_AGENT_FILE: &str = "com.claude-heartbeat.plist";

/// 단계마다 명령 하나씩이다(R6). 화면이 조각을 조립하지 않게 완성된 문자열을 싣는다.
/// 네 명령 모두 플랫폼과 무관하다 — R10이 요구하는 플랫폼 차이는 3단계의 아티팩트 경로와 감지
/// 가능 여부에서 나온다.
const PACKAGE_COMMAND: &str = "pip install claude-heartbeat";
const INIT_COMMAND: &str = "heartbeat init";
const SERVICE_COMMAND: &str = "heartbeat install-service";
const DREAM_COMMAND: &str = "heartbeat install dream";

/// 설치 단계 넷을 고정 순서로 만든다(R2). 목록은 언제나 넷이고 화면이 다시 정렬하지 않는다.
///
/// 판정 입력은 셋이다 — `HEARTBEAT.md` 읽기 결과, 사용자 홈, dream 스킬 설치 여부.
/// `heartbeat_home`은 판정에 쓰지 않고 2·4단계가 근거로 밝힐 경로를 만드는 데만 쓴다.
///
/// dream 스킬을 여기서 다시 감지하지 않는다. dream 연동이 이미 판정한 값을 받는다 — 같은 경로를
/// 두 번 읽으면 읽기 실패 목록에 같은 경로가 두 번 들어간다.
pub(crate) fn setup_stages(
    heartbeat_home: &Path,
    user_home: &Path,
    document: &TextSource,
    dream: IntegrationInstallation,
) -> Vec<HeartbeatSetupStage> {
    let init = init_stage(document, heartbeat_home);
    vec![
        package_stage(init.state),
        init,
        service_stage(user_home),
        dream_stage(dream, heartbeat_home),
    ]
}

/// 1단계. 독립 감지를 하지 않는다(R5). 2단계가 done이면 done이고 아니면 확인 불가다.
/// **not_done이 될 수 없다** — 앱은 패키지가 없다고 말할 근거를 갖지 못한다. 근거로 밝힐 경로도
/// 없으므로 `evidence`는 `None`이다.
fn package_stage(init: HeartbeatSetupState) -> HeartbeatSetupStage {
    HeartbeatSetupStage {
        step: HeartbeatSetupStep::Package,
        state: match init {
            HeartbeatSetupState::Done => HeartbeatSetupState::Done,
            HeartbeatSetupState::NotDone | HeartbeatSetupState::Unknown => {
                HeartbeatSetupState::Unknown
            }
        },
        required: true,
        // 패키지 획득은 앱이 대신 실행하지 않는다(SPEC-037 확인 필요 1번의 승인안). 이 명령은 지금
        // 실패하므로, 버튼을 붙이면 앱이 실패를 대신 실행하게 된다.
        runnable: false,
        command: PACKAGE_COMMAND.to_owned(),
        evidence: None,
    }
}

/// 2단계. not_done이 나오는 유일한 필수 단계다(R3·R4). 조회가 이미 연 문서의 세 값이 그대로 이
/// 셋이므로 읽기를 새로 추가하지 않는다.
fn init_stage(document: &TextSource, heartbeat_home: &Path) -> HeartbeatSetupStage {
    HeartbeatSetupStage {
        step: HeartbeatSetupStep::Init,
        state: match document {
            TextSource::Present(_) => HeartbeatSetupState::Done,
            TextSource::Missing => HeartbeatSetupState::NotDone,
            TextSource::Unreadable(_) => HeartbeatSetupState::Unknown,
        },
        required: true,
        // 데몬이 명령으로 소유한 걸음이라 앱이 대신 실행한다.
        runnable: true,
        command: INIT_COMMAND.to_owned(),
        evidence: Some(heartbeat_home.join(HEARTBEAT_FILE).display().to_string()),
    }
}

/// 3단계. **표준 아티팩트가 없다는 것은 "등록 안 됨"의 충분한 근거가 아니다**(DECISION-4F1083FF).
/// 사용자가 다른 라벨로 등록한 설치가 실존하므로 아티팩트가 없으면 미완료가 아니라 확인 불가다.
/// 이 단계는 어떤 입력에서도 not_done이 되지 않는다.
///
/// 데몬 실행 여부(pid 파일)는 이 판정에 넣지 않는다. `heartbeat start`로 손수 띄운 데몬은 등록물
/// 없이도 돌고, 그것을 done으로 보면 재부팅 뒤 조용히 멈추는 설치를 "끝났다"고 말하게 된다(R8).
///
/// macOS 밖은 언제나 확인 불가다. Linux(systemd user unit)와 Windows(Task Scheduler)의 아티팩트
/// 위치는 확인되지 않았고, 특히 Windows는 등록물이 파일이 아니라 스케줄러의 항목이라 파일 존재
/// 판정이 성립하지 않을 수 있다(기획서 확인 필요 2번의 승인된 (A)안).
fn service_stage(user_home: &Path) -> HeartbeatSetupStage {
    // 런타임 값이 아니라 컴파일 시점 값이다. 테스트도 같은 조건으로 갈라 쓴다.
    let artifact = cfg!(target_os = "macos").then(|| {
        user_home
            .join(LAUNCH_AGENTS_DIRECTORY)
            .join(LAUNCH_AGENTS_SUBDIRECTORY)
            .join(LAUNCH_AGENT_FILE)
    });
    HeartbeatSetupStage {
        step: HeartbeatSetupStep::Service,
        // 읽지 못한 것도 확인 불가다. 등록물이 있다고 단정할 근거가 되지 못한다.
        state: match &artifact {
            Some(path) if fs::symlink_metadata(path).is_ok() => HeartbeatSetupState::Done,
            _ => HeartbeatSetupState::Unknown,
        },
        required: true,
        // 2단계와 같은 이유로 실행 대상이다. 등록물을 만드는 것은 데몬이고 앱이 아니다.
        runnable: true,
        command: SERVICE_COMMAND.to_owned(),
        // 이 플랫폼에서 볼 경로가 없으면 `None`이다. 화면은 "이 경로에 표준 등록물이 없다"와
        // "이 플랫폼에서는 확인할 방법이 없다"를 이 있음·없음으로 구분해 말한다.
        evidence: artifact.map(|path| path.display().to_string()),
    }
}

/// 4단계. dream 카드의 판정을 그대로 따른다(R9). 별도의 확인 불가를 만들지 않는다 — 두 화면이 같은
/// 것을 각자 판정하면 갈라진다. 선택 단계라 `required`가 거짓이고, 미설치여도 마법사를 막지 않는다.
fn dream_stage(dream: IntegrationInstallation, heartbeat_home: &Path) -> HeartbeatSetupStage {
    HeartbeatSetupStage {
        step: HeartbeatSetupStep::Dream,
        state: match dream {
            IntegrationInstallation::Installed => HeartbeatSetupState::Done,
            IntegrationInstallation::NotInstalled => HeartbeatSetupState::NotDone,
        },
        required: false,
        // 승인안이 든 실행 대상은 2·3단계 둘이다. 승인 범위를 앱이 넓히지 않는다.
        runnable: false,
        command: DREAM_COMMAND.to_owned(),
        evidence: Some(
            heartbeat_dream::skill_path(heartbeat_home)
                .display()
                .to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use tempfile::{tempdir, TempDir};

    use super::setup_stages;
    use crate::domain::project::{
        HeartbeatReadFailure, HeartbeatSetupState, HeartbeatSetupStep, IntegrationInstallation,
    };
    use crate::infrastructure::heartbeat_status::TextSource;

    /// 두 홈 모두 임시 디렉터리다. 3단계가 개발 기기의 실제 등록물을 보면 판정이 기기마다 달라진다.
    fn homes() -> (TempDir, TempDir) {
        (
            tempdir().expect("heartbeat home"),
            tempdir().expect("user home"),
        )
    }

    fn present() -> TextSource {
        TextSource::Present("- tick: 5m\n".to_owned())
    }

    fn unreadable() -> TextSource {
        TextSource::Unreadable(HeartbeatReadFailure {
            path: "HEARTBEAT.md".to_owned(),
            message: "permission denied".to_owned(),
        })
    }

    /// 문서 읽기 결과 세 값. 어느 단계를 보든 이 셋이 입력의 전부다.
    fn documents() -> [TextSource; 3] {
        [present(), TextSource::Missing, unreadable()]
    }

    fn state_of(
        heartbeat_home: &Path,
        user_home: &Path,
        document: &TextSource,
        step: HeartbeatSetupStep,
    ) -> HeartbeatSetupState {
        setup_stages(
            heartbeat_home,
            user_home,
            document,
            IntegrationInstallation::NotInstalled,
        )
        .into_iter()
        .find(|stage| stage.step == step)
        .expect("setup stage")
        .state
    }

    /// R5. 1단계는 2단계에서 함의한다. 2단계가 done이 아니면 확인 불가이고, **not_done이 되는 입력이
    /// 없다** — 앱은 패키지가 없다고 말할 근거를 갖지 못한다.
    #[test]
    fn the_package_step_follows_the_init_step_and_never_reports_not_done() {
        let (home, user_home) = homes();

        let reported = documents().map(|document| {
            state_of(
                home.path(),
                user_home.path(),
                &document,
                HeartbeatSetupStep::Package,
            )
        });

        assert_eq!(
            reported,
            [
                HeartbeatSetupState::Done,
                HeartbeatSetupState::Unknown,
                HeartbeatSetupState::Unknown,
            ]
        );
    }

    /// R3·R4. 문서의 있음·없음·못 읽음이 그대로 done·not_done·unknown이다. 못 읽은 것을 미완료로
    /// 번역하면 사용자는 이미 끝낸 일을 다시 한다.
    #[test]
    fn the_init_step_reports_the_three_states_of_the_document() {
        let (home, user_home) = homes();

        let reported = documents().map(|document| {
            state_of(
                home.path(),
                user_home.path(),
                &document,
                HeartbeatSetupStep::Init,
            )
        });

        assert_eq!(
            reported,
            [
                HeartbeatSetupState::Done,
                HeartbeatSetupState::NotDone,
                HeartbeatSetupState::Unknown,
            ]
        );
        // 근거는 판정에 쓴 문서 경로다.
        let stages = setup_stages(
            home.path(),
            user_home.path(),
            &TextSource::Missing,
            IntegrationInstallation::NotInstalled,
        );
        assert_eq!(
            stages[1].evidence,
            Some(home.path().join("HEARTBEAT.md").display().to_string())
        );
    }

    /// DECISION-4F1083FF의 추가 결정. 표준 아티팩트가 없어도 미완료로 단정하지 않는다. 다른 라벨로
    /// 등록해 데몬이 실제로 도는 설치가 실존하므로, 없음은 확인 불가다.
    #[test]
    fn the_service_step_never_reports_not_done() {
        let (home, user_home) = homes();

        for document in documents() {
            assert_ne!(
                state_of(
                    home.path(),
                    user_home.path(),
                    &document,
                    HeartbeatSetupStep::Service,
                ),
                HeartbeatSetupState::NotDone
            );
        }
    }

    /// R2·R9. 목록은 언제나 넷이고 순서가 고정이며, 넷째만 선택이다.
    #[test]
    fn the_stage_list_is_always_four_in_a_fixed_order_with_only_the_dream_step_optional() {
        let (home, user_home) = homes();

        for document in documents() {
            for dream in [
                IntegrationInstallation::Installed,
                IntegrationInstallation::NotInstalled,
            ] {
                let stages = setup_stages(home.path(), user_home.path(), &document, dream);

                assert_eq!(
                    stages
                        .iter()
                        .map(|stage| (stage.step, stage.required))
                        .collect::<Vec<_>>(),
                    vec![
                        (HeartbeatSetupStep::Package, true),
                        (HeartbeatSetupStep::Init, true),
                        (HeartbeatSetupStep::Service, true),
                        (HeartbeatSetupStep::Dream, false),
                    ]
                );
                // 명령 원문은 단계마다 하나씩이고 비어 있지 않다(R6).
                assert!(stages.iter().all(|stage| !stage.command.is_empty()));
            }
        }
    }

    /// SPEC-037 R2. 앱이 대신 실행하는 단계는 2·3단계 둘뿐이고, 그 값은 입력과 무관하게 고정이다.
    /// 1단계는 지금 실패하는 명령이고 4단계는 승인안이 들지 않은 단계다.
    #[test]
    fn only_the_init_and_service_steps_are_runnable_by_the_app() {
        let (home, user_home) = homes();

        for document in documents() {
            for dream in [
                IntegrationInstallation::Installed,
                IntegrationInstallation::NotInstalled,
            ] {
                let stages = setup_stages(home.path(), user_home.path(), &document, dream);

                assert_eq!(
                    stages
                        .iter()
                        .map(|stage| (stage.step, stage.runnable))
                        .collect::<Vec<_>>(),
                    vec![
                        (HeartbeatSetupStep::Package, false),
                        (HeartbeatSetupStep::Init, true),
                        (HeartbeatSetupStep::Service, true),
                        (HeartbeatSetupStep::Dream, false),
                    ]
                );
            }
        }
    }
}
