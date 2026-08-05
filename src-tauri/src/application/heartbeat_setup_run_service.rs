//! 설치 단계 하나를 앱이 대신 실행하는 서비스.
//!
//! 조회·설치·"지금 실행"·업데이트와 다른 책임이라 모듈을 나눠 둔다. **앱은 이 경로에서 파일을 쓰지
//! 않는다.** 파일을 쓰는 것은 데몬이다 — `heartbeat init`이 하트비트 홈에 문서를 만들고,
//! `heartbeat install-service`가 서비스 등록물을 만들고 데몬을 띄운다. 이 구분이 확인 화면의 문구를
//! 정한다(SPEC-037 R3).
//!
//! **화면이 보내는 것은 단계 식별자 하나다.** 명령 문자열이 아니다. 식별자 → 고정 인자의 매핑은 이
//! 모듈의 상수이고, 화면이 준 문자열이 명령줄에 이어 붙는 경로가 없다. 실행 대상이 아닌 식별자는
//! 프로세스를 띄우지 않고 여기서 끝난다 — 백엔드가 payload로 "실행 불가"라고 말해 놓고 실행 통로만
//! 열어 두는 상태를 만들지 않는다(`heartbeat_run_service.rs`의 잡 이름 검증이 같은 어법이다).
//!
//! **종료 코드를 번역하지 않는다.** `heartbeat update`와 달리 이 두 명령은 원인별 종료 코드가 계약에
//! 없고, `docs/heartbeat.md`의 4·5번 절이 "앱은 0과 비0만 쓴다"로 그 자리를 적었다(R7). 그래서 결과는
//! 성공·실패 두 갈래이고, 실패의 사유는 앱이 지어내지 않고 stdout·stderr 원문이 말한다.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::infrastructure::heartbeat_process::{
    candidates, manual_command_for, run_capturing, Captured, RunFailure,
};

/// 화면이 보내는 단계 식별자. `HeartbeatSetupStep`이 payload로 나가는 값과 같은 문자열이다.
const INIT_STEP: &str = "init";
const SERVICE_STEP: &str = "service";

/// 실행할 고정 인자. 명령 원문은 이 상수에서만 나온다.
const INIT_ARGUMENTS: [&str; 1] = ["init"];
const SERVICE_ARGUMENTS: [&str; 1] = ["install-service"];

/// 설치 단계 실행의 결과.
///
/// 실행까지 간 것과 실행 수단을 찾지 못한 것과 애초에 실행 대상이 아닌 것을 서로 다른 값으로
/// 구분한다. 셋은 사용자가 할 다음 행동이 서로 다르다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HeartbeatSetupRun {
    /// 띄웠고 끝났다. 갈림은 종료 코드가 0인지 하나뿐이다 — 그보다 잘게 원인을 가르는 문구를 앱이
    /// 만들면 계약에 없는 것을 지어내는 것이 된다.
    #[serde(rename_all = "camelCase")]
    Ran {
        /// 종료 코드가 0인가. 시그널로 끝난 것(`code`가 `None`)은 성공이 아니다.
        succeeded: bool,
        /// 프로세스 종료 코드. `None`이면 시그널로 끝난 것이다. 숫자 그대로 싣는다.
        code: Option<i32>,
        /// 원문. 요약하지도 잘라내지도 않는다.
        stdout: String,
        /// 사람용 진단. 실패 사유를 말하는 것은 이 원문이지 앱이 아니다.
        stderr: String,
    },
    /// 실행 자체가 실패했다(R5). 사용자가 손으로 끝낼 수 있게 명령 원문을 함께 싣는다.
    #[serde(rename_all = "camelCase")]
    NotRun {
        message: String,
        /// 사용자가 그대로 칠 수 있는 명령 원문. 사유와 무관하게 언제나 채운다.
        command: String,
        /// 실제로 본 후보 경로. 앱이 지어내지 않는다(R5). 탐색에서 진 것이 아니면 비어 있다.
        looked: Vec<String>,
    },
    /// 앱이 대신 실행하지 않는 단계다. 프로세스를 띄우지 않고 여기서 끝난다.
    ///
    /// 화면은 백엔드가 실은 실행 가능 표식만 보고 버튼을 세우므로 정상 경로에서는 이 값이 나오지
    /// 않는다. 나오면 화면과 백엔드의 답이 갈라졌다는 뜻이다.
    #[serde(rename_all = "camelCase")]
    NotRunnable { message: String },
}

#[derive(Debug, Default)]
pub struct HeartbeatSetupRunService;

impl HeartbeatSetupRunService {
    /// 설치 단계 하나를 한 번 실행한다. 자식이 끝날 때까지 돌아오지 않으므로 호출자가 블로킹 자리를
    /// 마련해 부른다 — `install-service`는 등록물 생성과 기동을 포함한다.
    ///
    /// `user_home`은 실행 파일 후보(`~/.local/bin`)를 만드는 데만 쓴다. 하트비트 홈이 아니다.
    pub fn run(&self, user_home: &Path, step: &str) -> HeartbeatSetupRun {
        self.run_with(&candidates(user_home), step)
    }

    /// 후보 목록을 받는 형태. 실제로 하트비트를 띄우지 않고 결과를 확인할 수 있어야 해서 나눠 둔다
    /// (`HeartbeatUpdateService::update_with`가 같은 이유로 같은 모양이다).
    fn run_with(&self, candidates: &[PathBuf], step: &str) -> HeartbeatSetupRun {
        let Some(arguments) = arguments_for(step) else {
            return HeartbeatSetupRun::NotRunnable {
                message: not_runnable_message(step),
            };
        };

        match run_capturing(candidates, arguments) {
            Ok(captured) => ran(captured),
            Err(failure) => not_run(&failure, arguments),
        }
    }
}

/// 단계 식별자를 고정 인자로 옮긴다. 여기 없는 식별자는 실행 대상이 아니다 — 1단계(패키지 획득)와
/// 4단계(dream 스킬)는 승인안이 실행 대상에서 뺐고, 모르는 값은 애초에 단계가 아니다.
fn arguments_for(step: &str) -> Option<&'static [&'static str]> {
    match step {
        INIT_STEP => Some(&INIT_ARGUMENTS),
        SERVICE_STEP => Some(&SERVICE_ARGUMENTS),
        _ => None,
    }
}

/// 받아 온 출력을 결과로 옮긴다. 종료 코드는 0인지만 보고, 값 자체는 그대로 싣는다.
fn ran(captured: Captured) -> HeartbeatSetupRun {
    let Captured {
        code,
        stdout,
        stderr,
        ..
    } = captured;

    HeartbeatSetupRun::Ran {
        succeeded: code == Some(0),
        code,
        stdout,
        stderr,
    }
}

/// 실행 자체가 실패한 경로. 사유마다 사용자가 할 다음 행동이 다르므로 문구를 나눈다.
fn not_run(failure: &RunFailure, arguments: &[&str]) -> HeartbeatSetupRun {
    let (message, looked) = match failure {
        RunFailure::NotFound { looked } => (
            "하트비트 실행 파일을 찾지 못해 이 단계를 실행하지 못했습니다.".to_owned(),
            looked
                .iter()
                .map(|path| path.display().to_string())
                .collect(),
        ),
        // 0이 아닌 종료 코드는 `run_capturing`에서 실패가 아니므로, 후보를 찾은 뒤에 실패하는
        // 사유는 "띄우지 못했다" 하나뿐이다. 남은 변형은 그 경로에서 나오지 않는다.
        RunFailure::NotStarted { program, reason } => (
            format!(
                "`{}`을(를) 찾았지만 실행을 시작하지 못했습니다: {reason}",
                program.display()
            ),
            Vec::new(),
        ),
        RunFailure::ExitStatus { program, .. } => (
            format!(
                "`{}`을(를) 띄웠지만 출력을 받지 못했습니다.",
                program.display()
            ),
            Vec::new(),
        ),
    };

    HeartbeatSetupRun::NotRun {
        message,
        command: manual_command_for(arguments),
        looked,
    }
}

fn not_runnable_message(step: &str) -> String {
    format!(
        "`{step}` 단계는 앱이 대신 실행하는 단계가 아니라 아무것도 실행하지 않았습니다. \
         앱이 실행하는 것은 `heartbeat init`과 `heartbeat install-service` 둘뿐입니다."
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use pretty_assertions::assert_eq;
    use tempfile::{tempdir, TempDir};

    use super::{arguments_for, HeartbeatSetupRun, HeartbeatSetupRunService};
    use crate::domain::project::IntegrationInstallation;
    use crate::infrastructure::heartbeat_setup::setup_stages;
    use crate::infrastructure::heartbeat_status::TextSource;

    /// 실행 대상이 아닌 식별자. 앞의 둘은 마법사의 1·4단계이고 마지막은 단계 이름조차 아니다.
    #[cfg(unix)]
    const REJECTED: [&str; 3] = ["package", "dream", "정체불명"];

    fn missing(home: &TempDir) -> Vec<PathBuf> {
        vec![home.path().join("없는-후보")]
    }

    fn entries(directory: &TempDir) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(directory.path())
            .expect("read dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    /// 받은 인자를 파일에 적고 끝나는 스크립트. 실제 하트비트를 띄우면 이 기기에 파일이 생긴다.
    #[cfg(unix)]
    fn recorder(directory: &TempDir, body: &str) -> PathBuf {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let script = directory.path().join("recorder");
        fs::write(&script, body).expect("write recorder");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod recorder");
        script
    }

    #[cfg(unix)]
    fn recorded_arguments(directory: &TempDir) -> Option<String> {
        std::fs::read_to_string(directory.path().join("arguments")).ok()
    }

    /// 마법사가 "앱이 실행할 수 있다"고 실은 단계와 이 서비스가 실제로 실행하는 단계가 같아야 한다.
    /// 갈라지면 payload로 실행 불가라고 말해 놓고 통로만 열어 둔 상태가 된다.
    #[test]
    fn the_runnable_flag_of_every_stage_matches_what_this_service_accepts() {
        let heartbeat_home = tempdir().expect("heartbeat home");
        let user_home = tempdir().expect("user home");

        let stages = setup_stages(
            heartbeat_home.path(),
            user_home.path(),
            &TextSource::Missing,
            IntegrationInstallation::NotInstalled,
        );

        for stage in stages {
            let identifier = serde_json::to_value(stage.step).expect("step json");
            let identifier = identifier.as_str().expect("단계 식별자는 문자열이다");

            assert_eq!(
                stage.runnable,
                arguments_for(identifier).is_some(),
                "`{identifier}` 단계의 표식과 실행 통로가 갈라졌다"
            );
        }
    }

    /// 완료 조건 1·3. 식별자 하나가 고정 인자가 되어 나간다.
    #[cfg(unix)]
    #[test]
    fn each_runnable_step_runs_with_its_own_fixed_argument() {
        for (step, expected) in [("init", "init"), ("service", "install-service")] {
            let directory = tempdir().expect("temp dir");
            let script = recorder(
                &directory,
                "#!/bin/sh\nprintf '%s' \"$*\" > \"$(dirname \"$0\")/arguments\"\n",
            );

            let run = HeartbeatSetupRunService.run_with(&[script], step);

            assert!(
                matches!(
                    run,
                    HeartbeatSetupRun::Ran {
                        succeeded: true,
                        ..
                    }
                ),
                "{step} 단계는 실행까지 가야 한다: {run:?}"
            );
            assert_eq!(recorded_arguments(&directory).as_deref(), Some(expected));
        }
    }

    /// 완료 조건 2. 실행 대상이 아닌 식별자는 프로세스를 띄우지 않는다. 띄웠으면 남았을 흔적이
    /// 없다는 것으로 확인한다.
    #[cfg(unix)]
    #[test]
    fn a_step_that_is_not_runnable_never_spawns_the_candidate() {
        for step in REJECTED {
            let directory = tempdir().expect("temp dir");
            let script = recorder(
                &directory,
                "#!/bin/sh\nprintf 'ran' > \"$(dirname \"$0\")/ran\"\n",
            );

            let run = HeartbeatSetupRunService.run_with(&[script], step);

            assert!(
                matches!(run, HeartbeatSetupRun::NotRunnable { .. }),
                "`{step}`은 실행 대상이 아니다: {run:?}"
            );
            assert!(
                !directory.path().join("ran").exists(),
                "`{step}`을 받고 프로세스를 띄우면 안 된다"
            );
        }
    }

    /// 완료 조건 4. 0이 아닌 종료 코드는 실패이고, 원문은 그대로 실린다. 앱이 사유를 짓지 않는다.
    #[cfg(unix)]
    #[test]
    fn a_nonzero_exit_code_is_a_failure_that_carries_the_output_verbatim() {
        let directory = tempdir().expect("temp dir");
        let script = recorder(
            &directory,
            "#!/bin/sh\nprintf 'created /Users/tester/.claude/HEARTBEAT.md\\n'\n\
             printf 'Permission denied\\n' >&2\nexit 1\n",
        );

        assert_eq!(
            HeartbeatSetupRunService.run_with(&[script], "init"),
            HeartbeatSetupRun::Ran {
                succeeded: false,
                code: Some(1),
                stdout: "created /Users/tester/.claude/HEARTBEAT.md\n".to_owned(),
                stderr: "Permission denied\n".to_owned(),
            }
        );
    }

    /// 완료 조건 5. 실행 파일을 찾지 못하면 본 후보와 사용자가 칠 명령 원문이 결과에 실린다(R5).
    #[test]
    fn a_missing_executable_reports_the_paths_it_looked_at_and_the_command_to_type() {
        let home = tempdir().expect("temp home");
        let looked = missing(&home);

        assert_eq!(
            HeartbeatSetupRunService.run_with(&looked, "service"),
            HeartbeatSetupRun::NotRun {
                message: "하트비트 실행 파일을 찾지 못해 이 단계를 실행하지 못했습니다.".to_owned(),
                command: "heartbeat install-service".to_owned(),
                looked: looked
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect(),
            }
        );
    }

    /// 앱이 이 경로에서 파일을 쓰지 않는다는 것을, 실행 전후로 목록이 같다는 것으로 확인한다.
    /// 파일을 쓰는 것은 데몬이고 앱이 아니다.
    ///
    /// 검사는 `run_with`로만 들어간다. `run`은 `candidates`가 만드는 맨 이름 `heartbeat`를 첫
    /// 후보로 두고, 그 이름은 검사를 돌리는 셸의 PATH에서 해석된다 — 설치된 기기에서는 검사가
    /// 진짜 `heartbeat init`을 실행해 홈에 문서를 만든다.
    #[test]
    fn running_a_setup_step_writes_no_files_from_the_app() {
        let project = tempdir().expect("temp project");
        let home = tempdir().expect("temp home");

        HeartbeatSetupRunService.run_with(&missing(&home), "init");
        HeartbeatSetupRunService.run_with(&missing(&home), "package");

        assert_eq!(entries(&project), Vec::<String>::new());
        assert_eq!(entries(&home), Vec::<String>::new());
    }

    #[test]
    fn the_results_serialize_to_the_wire_contract() {
        assert_eq!(
            serde_json::to_value(HeartbeatSetupRun::Ran {
                succeeded: true,
                code: Some(0),
                stdout: "ok\n".to_owned(),
                stderr: String::new(),
            })
            .expect("ran json"),
            serde_json::json!({
                "kind": "ran",
                "succeeded": true,
                "code": 0,
                "stdout": "ok\n",
                "stderr": "",
            })
        );

        let home = tempdir().expect("temp home");
        let looked = missing(&home);

        assert_eq!(
            serde_json::to_value(HeartbeatSetupRunService.run_with(&looked, "init"))
                .expect("not run json"),
            serde_json::json!({
                "kind": "notRun",
                "message": "하트비트 실행 파일을 찾지 못해 이 단계를 실행하지 못했습니다.",
                "command": "heartbeat init",
                "looked": [looked[0].display().to_string()],
            })
        );

        let rejected = serde_json::to_value(HeartbeatSetupRunService.run_with(&looked, "dream"))
            .expect("not runnable json");

        assert_eq!(rejected["kind"], "notRunnable");
        assert!(
            rejected["message"]
                .as_str()
                .expect("문구는 문자열이다")
                .contains("앱이 대신 실행하는 단계가 아니라"),
            "사유를 밝혀야 한다: {rejected}"
        );
    }
}
