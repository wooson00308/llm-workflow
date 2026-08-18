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
use std::process::{ExitStatus, Output, Stdio};

use crate::infrastructure::quiet_command::quiet_command;
use std::time::Duration;

/// 하트비트 실행 파일 이름. PATH 후보와 사용자 설치 후보가 같은 이름을 쓴다.
const EXECUTABLE: &str = "heartbeat";

/// 잡 하나만 지금 도는 형태. 잡을 지정하지 않는 `once`는 다른 프로젝트의 역할 잡과 dream 잡까지
/// 깨우므로(확인 사실 15) 그 형태가 이 모듈에 없다(R8).
const SUBCOMMAND: &str = "once";
const JOB_FLAG: &str = "-j";

/// pip·pipx의 사용자 설치 위치. Homebrew는 이 도구를 배포하지 않으므로 후보에 넣지 않는다.
const USER_BIN: [&str; 2] = [".local", "bin"];

/// macOS/Linux가 교체 직후의 실행 파일을 아주 짧게 `ETXTBSY`로 잠글 때 허용할 재시도 횟수.
/// 권한·형식·경로 오류는 즉시 반환하며, 이 경합만 총 40ms 안에서 흡수한다.
const EXECUTABLE_BUSY_ATTEMPTS: usize = 5;
const EXECUTABLE_BUSY_RETRY_DELAY: Duration = Duration::from_millis(10);

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

/// 출력을 받아 온 실행의 결과. 종료 코드가 0이 아닌 것이 여기서는 실패가 아니다 —
/// `heartbeat update`는 종료 코드로 원인을 말하므로(계약), 그 값을 실패로 접으면 원인이 사라진다.
/// 실패로 접는 쪽은 `run_once`이고 그쪽 규약은 그대로다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Captured {
    /// 실제로 띄운 후보. 어느 실행 파일이 답했는지가 사유의 일부다.
    pub program: PathBuf,
    /// 종료 코드. `None`이면 시그널로 끝난 것이다.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// 사용자가 손으로 같은 일을 할 때 칠 명령 원문(R6). 실패 값의 `command`가 여기서만 나온다.
pub fn manual_command(job_name: &str) -> String {
    format!("{EXECUTABLE} {SUBCOMMAND} {JOB_FLAG} {job_name}")
}

/// 인자 목록에서 명령 원문을 만든다. `manual_command`는 잡 이름을 받는 형태라 `once -j` 밖의
/// 실행에 쓸 수 없어서 나눠 둔다.
pub fn manual_command_for(arguments: &[&str]) -> String {
    std::iter::once(EXECUTABLE)
        .chain(arguments.iter().copied())
        .collect::<Vec<_>>()
        .join(" ")
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

/// 고정 인자로 한 번 띄우고 stdout·stderr·종료 코드를 함께 받아 온다.
///
/// 후보 순서와 폴스루 규칙은 `run_once`와 같다 — 앞 후보가 `NotFound`일 때만 다음 후보를 본다.
/// 다른 것은 출력을 버리지 않는다는 것 하나다. `run_once`는 세션 하나가 수십 분이라 파이프를 열면
/// 막히지만, 이쪽이 부르는 명령은 출력 자체가 계약이라 받아 와야 한다.
///
/// `arguments`는 백엔드 상수에서만 온다. 화면이 준 문자열이 여기 섞이는 경로가 이 모듈에 없다.
pub fn run_capturing(candidates: &[PathBuf], arguments: &[&str]) -> Result<Captured, RunFailure> {
    for candidate in candidates {
        match output_of(candidate, arguments) {
            Ok(output) => {
                return Ok(Captured {
                    program: candidate.clone(),
                    code: output.status.code(),
                    stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
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
    quiet_command(program)
        .arg(SUBCOMMAND)
        .arg(JOB_FLAG)
        .arg(job_name)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
}

/// stdout·stderr를 파이프로 받는다. 표준 입력은 닫는다 — 앱이 띄우는 프로세스에 사람이 답할
/// 자리가 없고, 열어 두면 입력을 기다리는 명령이 영원히 끝나지 않는다.
///
/// 작업 디렉터리를 지정하지 않는 것은 `status_of`와 같다.
fn output_of(program: &Path, arguments: &[&str]) -> std::io::Result<Output> {
    retry_executable_busy(|| {
        quiet_command(program)
            .args(arguments)
            .stdin(Stdio::null())
            .output()
    })
}

/// Unix에서 실행 파일을 원자 교체한 직후 발생할 수 있는 `ETXTBSY`만 짧게 재시도한다.
/// 다른 플랫폼과 다른 종류의 시작 오류는 기존 계약대로 첫 실패를 그대로 반환한다.
fn retry_executable_busy<T>(
    mut operation: impl FnMut() -> std::io::Result<T>,
) -> std::io::Result<T> {
    for attempt in 0..EXECUTABLE_BUSY_ATTEMPTS {
        match operation() {
            Err(error)
                if executable_temporarily_busy(&error)
                    && attempt + 1 < EXECUTABLE_BUSY_ATTEMPTS =>
            {
                std::thread::sleep(EXECUTABLE_BUSY_RETRY_DELAY);
            }
            result => return result,
        }
    }

    unreachable!("마지막 시도는 반드시 결과를 반환한다")
}

#[cfg(unix)]
fn executable_temporarily_busy(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(26)
}

#[cfg(not(unix))]
fn executable_temporarily_busy(_error: &std::io::Error) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use pretty_assertions::assert_eq;
    use tempfile::tempdir;
    #[cfg(unix)]
    use tempfile::TempDir;

    #[cfg(unix)]
    use super::Captured;
    use super::{
        candidates_for, manual_command, manual_command_for, run_capturing, run_once, RunFailure,
    };

    const JOB: &str = "wf-planner-Users-catze-project-workflow-labs";

    /// 캡처 실행이 쓰는 고정 인자. 서비스 쪽 상수와 같은 값이고, 여기서는 원문 조립만 확인한다.
    const UPDATE: [&str; 1] = ["update"];

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

    #[test]
    fn the_manual_command_for_an_argument_list_names_the_executable_first() {
        assert_eq!(manual_command_for(&UPDATE), "heartbeat update");
    }

    #[test]
    fn capturing_reports_every_path_that_was_looked_at_when_nothing_is_found() {
        let home = tempdir().expect("temp home");
        let looked = missing(home.path());

        assert_eq!(
            run_capturing(&looked, &UPDATE),
            Err(RunFailure::NotFound { looked })
        );
    }

    #[cfg(unix)]
    #[test]
    fn capturing_retries_only_a_temporarily_busy_executable() {
        let mut attempts = 0;

        let result = super::retry_executable_busy(|| {
            attempts += 1;
            if attempts < 3 {
                Err(std::io::Error::from_raw_os_error(26))
            } else {
                Ok("ready")
            }
        });

        assert_eq!(result.expect("세 번째 시도가 성공한다"), "ready");
        assert_eq!(attempts, 3);
    }

    #[cfg(unix)]
    #[test]
    fn capturing_does_not_retry_another_start_error() {
        let mut attempts = 0;

        let error = super::retry_executable_busy::<()>(|| {
            attempts += 1;
            Err(std::io::Error::from_raw_os_error(13))
        })
        .expect_err("권한 오류는 즉시 반환한다");

        assert_eq!(error.raw_os_error(), Some(13));
        assert_eq!(attempts, 1);
    }

    #[cfg(unix)]
    #[test]
    fn capturing_carries_stdout_stderr_and_the_exit_code_together() {
        let directory = tempdir().expect("temp dir");
        let script = recorder(
            &directory,
            "#!/bin/sh\nprintf '%s' \"$*\" > \"$(dirname \"$0\")/arguments\"\n\
             printf 'result=ok version=0.8.1 exit=0\\n'\n\
             printf '진단 한 줄\\n' >&2\nexit 0\n",
        );

        assert_eq!(
            run_capturing(std::slice::from_ref(&script), &UPDATE),
            Ok(Captured {
                program: script,
                code: Some(0),
                stdout: "result=ok version=0.8.1 exit=0\n".to_owned(),
                stderr: "진단 한 줄\n".to_owned(),
            })
        );
        assert_eq!(recorded_arguments(&directory).as_deref(), Some("update"));
    }

    /// 0이 아닌 종료 코드는 이 경로에서 실패가 아니다. 계약이 코드로 원인을 말하므로 그 값이
    /// 결과에 실려야 하고, 실패로 접으면 stdout·stderr도 함께 사라진다.
    #[cfg(unix)]
    #[test]
    fn a_nonzero_exit_code_is_not_a_capture_failure() {
        let directory = tempdir().expect("temp dir");
        let script = recorder(
            &directory,
            "#!/bin/sh\nprintf 'step=repo status=failed detail=dirty-tree\\n'\nexit 11\n",
        );

        let captured = run_capturing(std::slice::from_ref(&script), &UPDATE)
            .expect("종료 코드가 0이 아니어도 결과다");

        assert_eq!(captured.code, Some(11));
        assert_eq!(
            captured.stdout,
            "step=repo status=failed detail=dirty-tree\n"
        );
        assert_eq!(captured.stderr, "");
    }

    #[cfg(unix)]
    #[test]
    fn a_missing_candidate_falls_through_to_the_next_one_while_capturing() {
        let directory = tempdir().expect("temp dir");
        let script = recorder(&directory, "#!/bin/sh\nprintf 'result=ok\\n'\n");
        let candidates = vec![directory.path().join("없는-후보"), script.clone()];

        let captured = run_capturing(&candidates, &UPDATE).expect("두 번째 후보가 답한다");

        assert_eq!(captured.program, script);
        assert_eq!(captured.stdout, "result=ok\n");
    }
}
