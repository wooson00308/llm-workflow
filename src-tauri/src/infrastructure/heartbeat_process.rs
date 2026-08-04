//! 하트비트 실행 파일 후보 해석과 프로세스 실행.
//!
//! 이 모듈은 어떤 파일도 읽거나 쓰지 않는다(SPEC-020 R1). 하는 일은 후보 경로를 만드는 것과
//! 그 후보를 `once -j <잡 이름>` 인자로 띄우는 것 둘뿐이다.
//!
//! 셸을 거치지 않는다. `tauri-plugin-shell`을 붙이면 화면이 임의의 명령을 실행할 수 있는 권한이
//! 열리고 그것이 완료 조건 23이 막으려는 것이라, `std::process::Command`로 실행 파일을 직접 띄운다.
//! 인자도 고정이다 — 화면이 준 문자열을 명령줄에 이어 붙이는 경로가 이 모듈에 없다.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};

/// 하트비트 실행 파일 이름. PATH 후보와 사용자 설치 후보가 같은 이름을 쓴다.
const EXECUTABLE: &str = "heartbeat";

/// 잡 하나만 지금 도는 형태. 잡을 지정하지 않는 `once`는 다른 프로젝트의 역할 잡과 dream 잡까지
/// 깨우므로(확인 사실 15) 그 형태가 이 모듈에 없다(R8).
const SUBCOMMAND: &str = "once";
const JOB_FLAG: &str = "-j";

/// pip·pipx의 사용자 설치 위치. Homebrew는 이 도구를 배포하지 않으므로 후보에 넣지 않는다.
const USER_BIN: [&str; 2] = [".local", "bin"];

/// 실행이 실패한 사유. 사유마다 다른 값을 담고, 사용자가 읽을 문구를 만드는 일은 호출자가 한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunFailure {
    /// 후보를 전부 봤는데 실행 파일이 없다. 본 후보를 함께 담아 호출자가 밝힐 수 있게 한다.
    NotFound { looked: Vec<PathBuf> },
    /// 찾긴 찾았는데 띄우지 못했다(실행 권한 없음 등). 다음 후보로 넘어가지 않는다.
    NotStarted { program: PathBuf, reason: String },
    /// 띄웠고 0이 아닌 코드로 끝났다. `code`가 `None`이면 시그널로 끝난 것이다.
    ExitStatus { program: PathBuf, code: Option<i32> },
}

/// 사용자가 손으로 같은 일을 할 때 칠 명령 원문(R6). 실패 값의 `command`가 여기서만 나온다.
pub fn manual_command(job_name: &str) -> String {
    format!("{EXECUTABLE} {SUBCOMMAND} {JOB_FLAG} {job_name}")
}

/// 실행 파일 후보를 볼 순서대로 만든다.
///
/// PATH를 앞에 두어 사용자 환경을 먼저 존중한다. GUI로 띄운 앱이 물려받는 PATH는 사용자 셸의
/// PATH와 다르므로(확인 사실 4) 후보가 하나면 정상 설치에서도 거의 늘 실패한다.
pub fn candidates(user_home: &Path) -> Vec<PathBuf> {
    candidates_for(user_home, cfg!(windows))
}

/// 플랫폼을 인자로 받는 형태. 실행 플랫폼이 아닌 쪽의 순서도 단정할 수 있어야 해서 나눠 둔다.
///
/// Windows에서는 후보가 PATH 하나뿐이다. 이 저장소는 Windows의 설치 경로 규약을 확인한 적이 없고
/// 확인하지 않은 경로를 추측으로 넣지 않는다.
fn candidates_for(user_home: &Path, windows: bool) -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from(EXECUTABLE)];
    if !windows {
        let mut user_bin = user_home.to_path_buf();
        user_bin.extend(USER_BIN);
        candidates.push(user_bin.join(EXECUTABLE));
    }
    candidates
}

/// 잡 하나를 한 번 돌고 자식이 끝날 때까지 기다린다.
///
/// 앞 후보의 실패가 `NotFound`일 때만 다음 후보를 본다. 그 밖의 실패는 찾긴 찾았는데 못 돌린
/// 것이라 사유가 다르므로 그 자리에서 실패로 만든다.
///
/// 종료 코드 0이 아닌 것만 실패다. 조건 미충족과 한도 도달은 하트비트가 0으로 끝내므로(확인 사실 6)
/// 여기서 실패가 되지 않는다.
pub fn run_once(candidates: &[PathBuf], job_name: &str) -> Result<(), RunFailure> {
    for candidate in candidates {
        match status_of(candidate, job_name) {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => {
                return Err(RunFailure::ExitStatus {
                    program: candidate.clone(),
                    code: status.code(),
                })
            }
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(RunFailure::NotStarted {
                    program: candidate.clone(),
                    reason: error.to_string(),
                })
            }
        }
    }

    Err(RunFailure::NotFound {
        looked: candidates.to_vec(),
    })
}

/// 표준 입출력 셋 다 닫는다. 세션 출력을 앱 안에서 보여주는 것은 기획서 제외 범위이고, 파이프를
/// 열어 두고 읽지 않으면 20~30분짜리 세션에서 버퍼가 막힌다.
///
/// 작업 디렉터리를 지정하지 않는다. 잡의 cwd는 하트비트가 slug에서 정한다(확인 사실 14).
fn status_of(program: &Path, job_name: &str) -> std::io::Result<ExitStatus> {
    Command::new(program)
        .arg(SUBCOMMAND)
        .arg(JOB_FLAG)
        .arg(job_name)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use pretty_assertions::assert_eq;
    use tempfile::tempdir;
    #[cfg(unix)]
    use tempfile::TempDir;

    use super::{candidates_for, manual_command, run_once, RunFailure};

    const JOB: &str = "wf-planner-Users-catze-project-workflow-labs";

    fn missing(home: &Path) -> Vec<PathBuf> {
        vec![home.join("없는-후보-1"), home.join("없는-후보-2")]
    }

    #[test]
    fn candidates_put_path_before_the_user_install_location() {
        let home = Path::new("/Users/tester");

        assert_eq!(
            candidates_for(home, false),
            vec![
                PathBuf::from("heartbeat"),
                PathBuf::from("/Users/tester/.local/bin/heartbeat"),
            ]
        );
    }

    #[test]
    fn windows_has_only_the_path_candidate() {
        let home = Path::new("/Users/tester");

        assert_eq!(candidates_for(home, true), vec![PathBuf::from("heartbeat")]);
    }

    #[test]
    fn manual_command_names_the_job() {
        assert_eq!(
            manual_command(JOB),
            "heartbeat once -j wf-planner-Users-catze-project-workflow-labs"
        );
    }

    #[test]
    fn missing_candidates_report_every_path_that_was_looked_at() {
        let home = tempdir().expect("temp home");
        let looked = missing(home.path());

        assert_eq!(run_once(&looked, JOB), Err(RunFailure::NotFound { looked }));
    }

    /// 인자가 실려 나가는 것과 후보 순서는 실제로 띄워 봐야 확인된다. 하트비트를 띄우면 모델
    /// 세션이 뜨므로, 받은 인자를 파일에 적고 끝나는 스크립트를 대신 세운다.
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

    #[cfg(unix)]
    #[test]
    fn the_job_runs_with_once_and_the_job_name_only() {
        let directory = tempdir().expect("temp dir");
        let script = recorder(
            &directory,
            "#!/bin/sh\nprintf '%s' \"$*\" > \"$(dirname \"$0\")/arguments\"\n",
        );

        assert_eq!(run_once(&[script], JOB), Ok(()));
        assert_eq!(
            recorded_arguments(&directory).as_deref(),
            Some("once -j wf-planner-Users-catze-project-workflow-labs")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_missing_candidate_falls_through_to_the_next_one() {
        let directory = tempdir().expect("temp dir");
        let script = recorder(
            &directory,
            "#!/bin/sh\nprintf '%s' \"$*\" > \"$(dirname \"$0\")/arguments\"\n",
        );
        let candidates = vec![directory.path().join("없는-후보"), script];

        assert_eq!(run_once(&candidates, JOB), Ok(()));
        assert!(recorded_arguments(&directory).is_some());
    }

    #[cfg(unix)]
    #[test]
    fn a_nonzero_exit_code_is_a_failure_that_carries_the_code() {
        let directory = tempdir().expect("temp dir");
        let script = recorder(&directory, "#!/bin/sh\nexit 3\n");

        assert_eq!(
            run_once(std::slice::from_ref(&script), JOB),
            Err(RunFailure::ExitStatus {
                program: script,
                code: Some(3),
            })
        );
    }
}
