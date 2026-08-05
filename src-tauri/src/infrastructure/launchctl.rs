//! 등록된 launchd 서비스를 내리고 올리는 고정 인자 실행(SPEC-036 R1·R5).
//!
//! **이 모듈로 앱이 부르는 실행 파일이 둘이 된다.** 지금까지 앱이 띄운 프로세스는 언제나
//! `heartbeat` 하나였고(SPEC-036 확인 사실 3) 그 단일성이 "앱이 임의의 명령을 조립해 실행하지
//! 않는다"의 근거였다. 실행 파일이 둘이 되면 그 근거는 인자 고정 하나로만 지켜진다 — 확인 필요
//! 1번이 승인되면서 문서에 남은 한계이고, 이 모듈이 그 한계를 감당하는 자리다.
//!
//! 그래서 지키는 선은 `heartbeat_process.rs`의 것을 그대로 잇는다.
//!
//! - 셸을 거치지 않는다. `std::process::Command`로 직접 띄우고 `$(id -u)` 같은 셸 확장을 쓰지 않는다.
//! - 인자는 이 모듈이 만든다. 화면이 준 문자열이 명령줄에 이어 붙는 경로가 없다.
//! - 표준 입력을 닫고 stdout·stderr·종료 코드를 함께 받아 온다. 실패 사유가 stderr에 있고 그것을
//!   버리면 조작할 수 없는 상태를 구분해 말할 수 없다(R5).
//!
//! 이 모듈은 `heartbeat_process.rs`에 얹히지 않는다. 그쪽은 후보 탐색 규약(PATH → `~/.local/bin`)을
//! 가지고 있고 그 규약이 `heartbeat`에만 성립한다. `launchctl`은 후보가 없다.

use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

/// 조작에 쓰는 실행 파일. 앱이 부르는 두 번째 실행 파일이다.
const PROGRAM: &str = "launchctl";

/// 서비스를 내리는 하위 명령과 올리는 하위 명령. 이 둘 밖의 하위 명령이 이 모듈에 없다.
///
/// `stop`·`kill`을 쓰지 않는다. 데몬의 `heartbeat stop`은 pid에 SIGTERM을 보내는 것이고 이 기기의
/// plist는 `KeepAlive`가 참이라 launchd가 곧바로 다시 띄운다(SPEC-036 확인 사실 7).
/// `uninstall-service`도 쓰지 않는다 — 등록 해제는 일시 정지가 아니다(확인 사실 9, R8).
const BOOTOUT: &str = "bootout";
const BOOTSTRAP: &str = "bootstrap";

/// 사용자 로그인 세션의 도메인 표기. launchd가 아는 이름이 `gui/<uid>`다.
const DOMAIN: &str = "gui";

/// 이 모듈이 아는 조작 둘. 그 밖의 조작을 조립하는 경로가 없다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    /// 도는 서비스를 내린다.
    Stop,
    /// 등록물을 다시 올린다.
    Start,
}

/// 띄운 결과. 0이 아닌 종료 코드는 여기서 실패가 아니다 — `bootout`은 로드되지 않은 서비스에 대해,
/// `bootstrap`은 이미 로드된 서비스에 대해 0이 아닌 코드로 끝나고, 그 값과 stderr 원문이 곧 사유다.
/// 실패로 접으면 사유가 사라진다(R7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Executed {
    /// 종료 코드. `None`이면 시그널로 끝난 것이다. 숫자 그대로 싣는다.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// 띄울 실행 파일. 검사가 실제 `launchctl`을 띄우면 개발 기기의 도는 데몬이 내려가므로, 호출자가
/// 다른 실행 파일을 넣을 수 있게 함수로 낸다(`heartbeat_process.rs`의 `candidates`와 같은 어법이다).
pub fn program() -> PathBuf {
    PathBuf::from(PROGRAM)
}

/// 조작 하나의 인자 목록.
///
/// 인자에 들어가는 값 중 상수가 아닌 것은 셋이고 셋 다 앱이 자기 파일 시스템에서 읽은 값이다 —
/// 홈 소유자 uid와, 등록물에서 읽어 낸 라벨과 그 plist 경로다(`launch_agents.rs`가 낸 값이다).
pub fn arguments(operation: Operation, uid: u32, label: &str, plist_path: &str) -> Vec<String> {
    let domain = format!("{DOMAIN}/{uid}");
    match operation {
        Operation::Stop => vec![BOOTOUT.to_owned(), format!("{domain}/{label}")],
        Operation::Start => vec![BOOTSTRAP.to_owned(), domain, plist_path.to_owned()],
    }
}

/// 사용자가 그대로 칠 명령 원문. 실제로 띄울 인자 목록에서 만들므로 인자와 원문이 갈리는 자리가
/// 없다(`heartbeat_process.rs`의 `manual_command_for`가 같은 어법이다).
///
/// 원문에 빈칸이 없다 — 라벨도 plist 경로도 uid도 채워진 뒤에만 이 목록이 만들어진다.
pub fn manual_command(arguments: &[String]) -> String {
    std::iter::once(PROGRAM.to_owned())
        .chain(arguments.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ")
}

/// 사용자 홈의 소유자 uid. 프로세스를 하나 더 띄워 `id -u`를 부르지 않고 셸 확장도 쓰지 않는다.
#[cfg(unix)]
pub fn user_uid(user_home: &Path) -> Option<u32> {
    use std::os::unix::fs::MetadataExt;

    std::fs::metadata(user_home)
        .ok()
        .map(|metadata| metadata.uid())
}

/// unix가 아닌 갈래. 조작 대상 해석이 macOS 밖에서 이미 멈추므로 이 값이 쓰이는 경로가 없다(R9).
#[cfg(not(unix))]
pub fn user_uid(_user_home: &Path) -> Option<u32> {
    None
}

/// 고정 인자로 한 번 띄우고 stdout·stderr·종료 코드를 함께 받아 온다.
///
/// 실패는 하나뿐이다 — 띄우지 못한 것이다. 표준 입력은 닫는다. 앱이 띄우는 프로세스에 사람이 답할
/// 자리가 없고, 열어 두면 입력을 기다리는 명령이 영원히 끝나지 않는다.
pub fn run(program: &Path, arguments: &[String]) -> std::io::Result<Executed> {
    let Output {
        status,
        stdout,
        stderr,
    } = Command::new(program)
        .args(arguments)
        .stdin(Stdio::null())
        .output()?;

    Ok(Executed {
        code: status.code(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    #[cfg(unix)]
    use std::path::PathBuf;

    use pretty_assertions::assert_eq;
    use tempfile::tempdir;
    #[cfg(unix)]
    use tempfile::TempDir;

    #[cfg(unix)]
    use super::Executed;
    use super::{arguments, manual_command, program, run, user_uid, Operation};

    const LABEL: &str = "com.catze.dream-heartbeat";
    const PLIST: &str = "/Users/catze/Library/LaunchAgents/com.catze.dream-heartbeat.plist";
    const UID: u32 = 501;

    /// 받은 인자를 파일에 적고 끝나는 스크립트. 실제 `launchctl`을 띄우면 이 기기의 도는 데몬이
    /// 내려간다 — `heartbeat_process.rs`가 같은 이유로 세운 어법이다.
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

    /// 완료 조건 1. 내리기가 `bootout gui/<uid>/<라벨>`로 나간다.
    #[test]
    fn stopping_names_the_service_inside_the_user_domain() {
        assert_eq!(
            arguments(Operation::Stop, UID, LABEL, PLIST),
            vec![
                "bootout".to_owned(),
                "gui/501/com.catze.dream-heartbeat".to_owned(),
            ]
        );
    }

    /// 완료 조건 1. 올리기가 `bootstrap gui/<uid> <plist 경로>`로 나간다. 라벨이 아니라 경로다.
    #[test]
    fn starting_names_the_domain_and_the_plist_path() {
        assert_eq!(
            arguments(Operation::Start, UID, LABEL, PLIST),
            vec![
                "bootstrap".to_owned(),
                "gui/501".to_owned(),
                PLIST.to_owned()
            ]
        );
    }

    /// 완료 조건 6. 명령 원문이 인자 목록에서 나오고 빈칸이 없다. `heartbeat_update.rs`의
    /// `no_command_carries_a_value_the_app_cannot_know`가 반대 방향으로 같은 검사를 한다.
    #[test]
    fn the_manual_command_comes_from_the_argument_list_and_carries_no_placeholder() {
        for operation in [Operation::Stop, Operation::Start] {
            let command = manual_command(&arguments(operation, UID, LABEL, PLIST));

            assert!(
                !command.contains('<'),
                "명령 원문에 빈칸이 남았다: {command}"
            );
            assert!(
                command.starts_with("launchctl "),
                "실행 파일이 앞에 온다: {command}"
            );
        }

        assert_eq!(
            manual_command(&arguments(Operation::Stop, UID, LABEL, PLIST)),
            "launchctl bootout gui/501/com.catze.dream-heartbeat"
        );
        assert_eq!(
            manual_command(&arguments(Operation::Start, UID, LABEL, PLIST)),
            format!("launchctl bootstrap gui/501 {PLIST}")
        );
    }

    /// 인자가 실제로 실려 나가는 것은 띄워 봐야 확인된다.
    #[cfg(unix)]
    #[test]
    fn the_arguments_reach_the_program_verbatim() {
        let directory = tempdir().expect("temp dir");
        let script = recorder(
            &directory,
            "#!/bin/sh\nprintf '%s' \"$*\" > \"$(dirname \"$0\")/arguments\"\n",
        );

        run(&script, &arguments(Operation::Stop, UID, LABEL, PLIST)).expect("띄운다");

        assert_eq!(
            recorded_arguments(&directory).as_deref(),
            Some("bootout gui/501/com.catze.dream-heartbeat")
        );
    }

    /// 완료 조건 8. 0이 아닌 종료 코드가 실패로 접히지 않고 원문과 함께 실린다. `bootout`이 로드되지
    /// 않은 서비스에 대해 끝나는 모양이다.
    #[cfg(unix)]
    #[test]
    fn a_nonzero_exit_code_is_a_result_and_not_a_failure() {
        let directory = tempdir().expect("temp dir");
        let script = recorder(
            &directory,
            "#!/bin/sh\nprintf 'Boot-out failed: 3: No such process\\n' >&2\nexit 3\n",
        );

        assert_eq!(
            run(&script, &arguments(Operation::Stop, UID, LABEL, PLIST)).expect("결과다"),
            Executed {
                code: Some(3),
                stdout: String::new(),
                stderr: "Boot-out failed: 3: No such process\n".to_owned(),
            }
        );
    }

    /// 실행 수단 없음의 두 얼굴 — 파일이 없는 경우와 실행 권한이 없는 경우다. 둘 다 띄우지 못한
    /// 것이고, 사유는 호출자가 이 오류에서 만든다.
    #[test]
    fn a_program_that_cannot_be_spawned_is_an_error() {
        let directory = tempdir().expect("temp dir");
        let missing = directory.path().join("없는-실행-파일");

        assert!(run(&missing, &arguments(Operation::Stop, UID, LABEL, PLIST)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_program_without_the_execute_bit_is_an_error() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("temp dir");
        let script = directory.path().join("실행-권한-없음");
        fs::write(&script, "#!/bin/sh\nexit 0\n").expect("write");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o644)).expect("chmod");

        assert!(run(&script, &arguments(Operation::Start, UID, LABEL, PLIST)).is_err());
    }

    /// 완료 조건 3. uid를 프로세스 없이 얻는다. 읽지 못하면 값을 지어내지 않는다.
    #[cfg(unix)]
    #[test]
    fn the_uid_comes_from_the_home_directory_owner() {
        let directory = tempdir().expect("temp dir");

        assert!(user_uid(directory.path()).is_some());
        assert_eq!(user_uid(&directory.path().join("없는-홈")), None);
    }

    /// unix가 아닌 갈래. 홈이 있어도 읽을 uid가 없고, 그 값이 쓰이는 경로도 없다(R9).
    #[cfg(not(unix))]
    #[test]
    fn outside_unix_there_is_no_uid_to_read() {
        let directory = tempdir().expect("temp dir");

        assert_eq!(user_uid(directory.path()), None);
    }

    #[test]
    fn the_program_is_launchctl() {
        assert_eq!(program(), Path::new("launchctl"));
    }
}
