//! 도는 데몬의 버전과 디스크의 버전을 읽어 어긋남을 판정하는 서비스.
//!
//! 판정의 설계는 데몬에서 그대로 왔다. `heartbeat update`가 재기동 필요를 **도는 프로세스의
//! `_daemon.version`과 디스크 버전의 비교**로 판정하므로(`docs/heartbeat.md` 1번 절의 `step=service`),
//! 앱이 같은 두 값을 같은 방식으로 비교하면 데몬과 같은 판정을 한다.
//!
//! 앱이 읽는 표면은 `docs/heartbeat.md`의 "앱이 의존하는 데몬 표면" 절에 적힌 것뿐이다(SPEC-037 R7).
//! 이 모듈이 쓰는 것은 그중 2번 `heartbeat --version`과 3번 `state.json`의 `_daemon.version` 둘이다.
//!
//! **모르는 값을 아는 척하지 않는다.** SPEC-034 R2가 세우고 R5가 다시 든 선이다. 한쪽만 아는 상태를
//! "같다"로도 "다르다"로도 접지 않고 판정 불가로 둔다. 출력이 계약의 모양이 아니면 앱이 그 안에서
//! 버전처럼 보이는 조각을 잘라 내지 않고 받은 원문을 그대로 보존한다.
//!
//! **이 판정은 조회 주기에 실리지 않는다.** 디스크 버전을 읽으려면 프로세스를 하나 띄워야 하는데
//! `inspect_integrations`는 자동 새로고침 주기마다 불린다. `heartbeat_setup.rs`의 머리주석이
//! "실행 파일을 찾아 다니지도 않는다"로 같은 선을 이미 세웠다. 부르는 시점은 화면이 정한다.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::domain::project::HeartbeatReadFailure;
use crate::infrastructure::heartbeat_process::{candidates, run_capturing, Captured, RunFailure};
use crate::infrastructure::heartbeat_status::read_job_runs;

/// 실행할 고정 인자. 화면이 준 문자열이 명령줄에 닿는 경로가 없다.
const ARGUMENTS: [&str; 1] = ["--version"];

/// 계약이 정한 출력의 첫 토큰. `heartbeat --version`은 `heartbeat <X.Y.Z>` 한 줄을 낸다
/// (`docs/heartbeat.md` 2번 절).
///
/// 실행 파일 이름을 만드는 상수와 값이 같지만 그 상수를 빌려 오지 않는다. 이쪽이 대조하는 것은
/// 앱이 띄운 파일의 이름이 아니라 **계약이 적은 출력의 모양**이고, 둘은 따로 바뀔 수 있다.
const OUTPUT_PREFIX: &str = "heartbeat";

/// 도는 데몬의 버전. `state.json`의 `_daemon.version` 하나에서 온다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunningVersion {
    /// 읽었다.
    #[serde(rename_all = "camelCase")]
    Known { version: String },
    /// 모른다. 상태 파일이 없거나, JSON이 깨졌거나, `_daemon.version`이 없다. 셋 다 오류가 아니다.
    /// 데몬이 한 번도 뜬 적 없으면 키 자체가 없다.
    Unknown,
}

/// 디스크의 버전. `heartbeat --version`의 출력에서 온다.
///
/// 모르는 경우를 하나로 뭉치지 않는다. 실행 파일을 찾지 못한 것과 띄우지 못한 것과 출력이 계약
/// 밖인 것은 사용자가 할 다음 행동이 서로 다르다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiskVersion {
    /// 읽었다.
    #[serde(rename_all = "camelCase")]
    Known { version: String },
    /// 후보를 전부 봤는데 실행 파일이 없다. 이 기기의 현재 상태다(SPEC-037 확인 사실 11).
    ///
    /// 본 후보를 함께 싣는다. 앱이 경로를 지어내지 않는다(R5).
    #[serde(rename_all = "camelCase")]
    NotFound { looked: Vec<String> },
    /// 찾긴 찾았는데 띄우지 못했다(실행 권한 없음 등).
    #[serde(rename_all = "camelCase")]
    NotStarted { message: String },
    /// 띄웠는데 출력이 계약의 모양이 아니다. 받은 원문을 그대로 보존한다 — 앱이 그 안에서 버전을
    /// 잘라 내지 않는다.
    #[serde(rename_all = "camelCase")]
    OffContract {
        code: Option<i32>,
        stdout: String,
        stderr: String,
    },
}

/// 판정 불가의 사유. 한쪽이라도 모르면 그 사유가 여기 실린다.
///
/// 둘 다 모르면 사유도 둘이다. 하나만 골라 실으면 나머지가 사라지고, 그것이 SPEC-037 R4가 막는
/// 뭉뚱그림이다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UndeterminedReason {
    /// 실행 파일을 찾지 못했다. 사용자가 할 일은 설치 경로 쪽에 있다.
    ExecutableNotFound,
    /// 실행 파일은 찾았는데 띄우지 못했다. 사용자가 할 일은 그 파일의 권한 쪽에 있다.
    ExecutableNotStarted,
    /// 띄웠는데 출력이 계약의 모양이 아니다. `--version`을 모르는 옛 설치본이 이 모양이다.
    DiskVersionOffContract,
    /// `state.json`이 없거나 `_daemon`이 없다. 데몬이 한 번도 뜬 적 없는 기기가 이 모양이다.
    RunningVersionUnknown,
}

/// 두 값을 모두 알 때만 나오는 판정과, 모를 때의 사유.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VersionVerdict {
    /// 두 값을 모두 알고 같다.
    Match,
    /// 두 값을 모두 알고 다르다. 디스크의 코드는 갱신됐는데 메모리의 프로세스는 옛 코드라는 뜻이고,
    /// 그 상태를 푸는 것이 `heartbeat update`다(`docs/heartbeat.md` 3번 절).
    Mismatch,
    /// 한쪽이라도 모른다.
    #[serde(rename_all = "camelCase")]
    Undetermined { reasons: Vec<UndeterminedReason> },
}

/// 판정 한 번의 결과. 아는 값만 싣고 사유를 함께 싣는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatVersions {
    pub running: RunningVersion,
    /// 실행 파일을 찾았는지가 여기서 확정된다. 화면이 그 값을 쓴다 — 찾지 못했으면 본 후보 목록이
    /// 실린다.
    pub disk: DiskVersion,
    pub verdict: VersionVerdict,
}

#[derive(Debug, Default)]
pub struct HeartbeatVersionService;

impl HeartbeatVersionService {
    /// 두 값을 읽고 판정한다. 프로세스를 하나 띄우므로 호출자가 블로킹 자리를 마련해 부른다 —
    /// 실행 파일 탐색이 걸리는 자리다.
    ///
    /// `heartbeat_home`은 `~/.claude`이고 `user_home`은 실행 파일 후보(`~/.local/bin`)를 만드는 데만
    /// 쓴다. 앱은 이 경로에서 파일을 쓰지 않는다.
    pub fn versions(&self, heartbeat_home: &Path, user_home: &Path) -> HeartbeatVersions {
        self.versions_with(heartbeat_home, &candidates(user_home))
    }

    /// 후보 목록을 받는 형태. 실제로 하트비트를 띄우지 않고 결과를 확인할 수 있어야 해서 나눠 둔다
    /// (`HeartbeatUpdateService::update_with`가 같은 이유로 같은 모양이다).
    fn versions_with(&self, heartbeat_home: &Path, candidates: &[PathBuf]) -> HeartbeatVersions {
        let running = running_version(heartbeat_home);
        let disk = disk_version(candidates);
        let verdict = judge(&running, &disk);

        HeartbeatVersions {
            running,
            disk,
            verdict,
        }
    }
}

/// 상태 파일에서 도는 데몬의 버전을 읽는다.
///
/// 읽기 실패 목록은 여기서 버린다. 그 목록은 연동 카드가 "무엇을 못 읽었나"를 보이는 자리이고,
/// 이 커맨드가 답할 것은 버전 하나다 — 파일을 못 읽든 없든 이쪽의 답은 똑같이 "모름"이다.
fn running_version(heartbeat_home: &Path) -> RunningVersion {
    let mut discarded: Vec<HeartbeatReadFailure> = Vec::new();
    match read_job_runs(heartbeat_home, &mut discarded).daemon_version() {
        Some(version) => RunningVersion::Known { version },
        None => RunningVersion::Unknown,
    }
}

/// `heartbeat --version`을 띄워 디스크의 버전을 읽는다.
fn disk_version(candidates: &[PathBuf]) -> DiskVersion {
    match run_capturing(candidates, &ARGUMENTS) {
        Ok(captured) => read_version(captured),
        Err(failure) => not_read(&failure),
    }
}

/// 받아 온 출력을 계약 안과 밖으로 가른다.
fn read_version(captured: Captured) -> DiskVersion {
    let Captured {
        code,
        stdout,
        stderr,
        ..
    } = captured;

    match parse_version(&stdout, code) {
        Some(version) => DiskVersion::Known { version },
        None => DiskVersion::OffContract {
            code,
            stdout,
            stderr,
        },
    }
}

/// stdout을 계약이 적은 한 줄로 읽는다. 모양이 어긋나면 `None`이고, 그것이 "모름"이다.
///
/// 계약이 정한 모양은 "`heartbeat <X.Y.Z>` 한 줄, stdout, 종료 코드 0"이다. 그래서 비어 있지 않은
/// 줄이 정확히 하나여야 하고, 그 줄의 토큰이 정확히 둘이어야 하며, 앞 토큰이 계약이 적은 이름이어야
/// 한다. 여러 줄이 오거나 토큰이 더 붙으면 계약 밖이다 — 그 안에서 버전처럼 보이는 조각을 골라내면
/// 앱이 모르는 값을 아는 척하는 것이 된다.
///
/// 뒤 토큰의 모양은 검사하지 않는다. 계약이 파싱하는 쪽에 "마지막 공백 뒤를 버전으로 읽으면 된다"고
/// 적었고 `X.Y.Z`를 검사하라고 적지 않았다. 앱이 거기에 자기 규칙을 더하면 데몬이 버전 표기를 넓힐
/// 때 앱만 모름으로 떨어진다.
fn parse_version(stdout: &str, code: Option<i32>) -> Option<String> {
    if code != Some(0) {
        return None;
    }

    let mut lines = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let line = lines.next()?;
    if lines.next().is_some() {
        return None;
    }

    let mut tokens = line.split_whitespace();
    if tokens.next()? != OUTPUT_PREFIX {
        return None;
    }
    let version = tokens.next()?;
    tokens.next().is_none().then(|| version.to_owned())
}

/// 실행 자체가 실패한 경로. 사유마다 사용자가 할 다음 행동이 다르므로 값을 나눈다.
fn not_read(failure: &RunFailure) -> DiskVersion {
    match failure {
        RunFailure::NotFound { looked } => DiskVersion::NotFound {
            looked: looked
                .iter()
                .map(|path| path.display().to_string())
                .collect(),
        },
        // 0이 아닌 종료 코드는 `run_capturing`에서 실패가 아니므로, 후보를 찾은 뒤에 실패하는
        // 사유는 "띄우지 못했다" 하나뿐이다. 남은 변형은 그 경로에서 나오지 않는다.
        RunFailure::NotStarted { program, reason } => DiskVersion::NotStarted {
            message: format!(
                "`{}`을(를) 찾았지만 실행을 시작하지 못했습니다: {reason}",
                program.display()
            ),
        },
        RunFailure::ExitStatus { program, .. } => DiskVersion::NotStarted {
            message: format!(
                "`{}`을(를) 띄웠지만 출력을 받지 못했습니다.",
                program.display()
            ),
        },
    }
}

/// 판정 셋. 두 값을 모두 알 때만 같음·다름이 나오고, 한쪽이라도 모르면 사유를 실은 판정 불가다.
///
/// 두 문자열을 그대로 비교한다. 앞뒤를 다듬거나 표기를 맞추지 않는다 — 정규화는 다른 두 값을 같게
/// 만드는 일이고, 그것이 어긋남을 감춘다.
fn judge(running: &RunningVersion, disk: &DiskVersion) -> VersionVerdict {
    match (known_running(running), known_disk(disk)) {
        (Some(running), Some(disk)) if running == disk => VersionVerdict::Match,
        (Some(_), Some(_)) => VersionVerdict::Mismatch,
        _ => VersionVerdict::Undetermined {
            reasons: reasons(running, disk),
        },
    }
}

fn known_running(running: &RunningVersion) -> Option<&str> {
    match running {
        RunningVersion::Known { version } => Some(version),
        RunningVersion::Unknown => None,
    }
}

fn known_disk(disk: &DiskVersion) -> Option<&str> {
    match disk {
        DiskVersion::Known { version } => Some(version),
        _ => None,
    }
}

/// 모르는 쪽마다 사유를 하나씩 싣는다. 도는 쪽을 먼저 두어 순서가 흔들리지 않게 한다.
fn reasons(running: &RunningVersion, disk: &DiskVersion) -> Vec<UndeterminedReason> {
    let mut reasons = Vec::new();
    if matches!(running, RunningVersion::Unknown) {
        reasons.push(UndeterminedReason::RunningVersionUnknown);
    }
    match disk {
        DiskVersion::Known { .. } => {}
        DiskVersion::NotFound { .. } => reasons.push(UndeterminedReason::ExecutableNotFound),
        DiskVersion::NotStarted { .. } => reasons.push(UndeterminedReason::ExecutableNotStarted),
        DiskVersion::OffContract { .. } => reasons.push(UndeterminedReason::DiskVersionOffContract),
    }
    reasons
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use pretty_assertions::assert_eq;
    use tempfile::{tempdir, TempDir};

    use super::{
        DiskVersion, HeartbeatVersionService, HeartbeatVersions, RunningVersion,
        UndeterminedReason, VersionVerdict,
    };

    /// 계약이 적은 출력 한 줄.
    const VERSION_LINE: &str = "heartbeat 0.8.1";

    fn home() -> TempDir {
        tempdir().expect("temporary directory")
    }

    /// 테스트 픽스처만 쓴다. 대상 모듈은 상태 파일을 읽기만 한다.
    fn write_state(home: &Path, contents: &str) {
        let path = home.join("heartbeat");
        fs::create_dir_all(&path).expect("fixture directory");
        fs::write(path.join("state.json"), contents).expect("fixture file");
    }

    fn daemon_state(version: &str) -> String {
        format!(r#"{{ "_daemon": {{ "version": "{version}", "pid": 84213 }} }}"#)
    }

    fn missing(home: &TempDir) -> Vec<PathBuf> {
        vec![home.path().join("없는-후보")]
    }

    fn looked(home: &TempDir) -> Vec<String> {
        missing(home)
            .iter()
            .map(|path| path.display().to_string())
            .collect()
    }

    /// `--version`이 낼 출력을 그대로 내고 끝나는 스크립트. 하트비트를 실제로 띄우지 않는다.
    #[cfg(unix)]
    fn responder(directory: &TempDir, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let script = directory.path().join("responder");
        fs::write(&script, body).expect("write responder");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod responder");
        script
    }

    /// 디스크 버전이 한 줄로 나오는 스크립트를 세우고 판정까지 돌린다.
    #[cfg(unix)]
    fn versions_of(state: Option<&str>, script_body: &str) -> (HeartbeatVersions, TempDir) {
        let heartbeat_home = home();
        if let Some(contents) = state {
            write_state(heartbeat_home.path(), contents);
        }
        let directory = home();
        let script = responder(&directory, script_body);

        let versions = HeartbeatVersionService.versions_with(heartbeat_home.path(), &[script]);
        (versions, heartbeat_home)
    }

    #[cfg(unix)]
    fn prints(line: &str) -> String {
        format!("#!/bin/sh\nprintf '%s\\n' '{line}'\n")
    }

    /// 판정 1. 두 값을 모두 알고 같다.
    #[cfg(unix)]
    #[test]
    fn the_same_version_on_both_sides_is_not_a_mismatch() {
        let (versions, _home) = versions_of(Some(&daemon_state("0.8.1")), &prints(VERSION_LINE));

        assert_eq!(
            versions.running,
            RunningVersion::Known {
                version: "0.8.1".to_owned()
            }
        );
        assert_eq!(
            versions.disk,
            DiskVersion::Known {
                version: "0.8.1".to_owned()
            }
        );
        assert_eq!(versions.verdict, VersionVerdict::Match);
    }

    /// 판정 2. 08-05 사고(디스크 main / 메모리 v0.8.0)의 모양이다.
    #[cfg(unix)]
    #[test]
    fn different_versions_on_both_sides_are_a_mismatch() {
        let (versions, _home) = versions_of(Some(&daemon_state("0.8.0")), &prints(VERSION_LINE));

        assert_eq!(versions.verdict, VersionVerdict::Mismatch);
        assert_eq!(
            versions.running,
            RunningVersion::Known {
                version: "0.8.0".to_owned()
            }
        );
        assert_eq!(
            versions.disk,
            DiskVersion::Known {
                version: "0.8.1".to_owned()
            }
        );
    }

    /// 판정 3. 도는 쪽만 모르는 상태를 "같다"로도 "다르다"로도 접지 않는다. 아는 값은 그대로 실린다.
    #[cfg(unix)]
    #[test]
    fn an_unknown_running_version_alone_makes_the_verdict_undetermined() {
        let (versions, _home) = versions_of(None, &prints(VERSION_LINE));

        assert_eq!(versions.running, RunningVersion::Unknown);
        assert_eq!(
            versions.disk,
            DiskVersion::Known {
                version: "0.8.1".to_owned()
            }
        );
        assert_eq!(
            versions.verdict,
            VersionVerdict::Undetermined {
                reasons: vec![UndeterminedReason::RunningVersionUnknown],
            }
        );
    }

    /// 완료 조건 2·3. 계약 밖 출력은 "모름"이고 받은 원문이 그대로 보존된다. 앱이 그 안에서
    /// 버전처럼 보이는 조각을 잘라 내지 않는다.
    #[cfg(unix)]
    #[test]
    fn output_outside_the_contract_shape_is_unknown_and_keeps_the_raw_text() {
        // `--version`을 모르는 옛 설치본이 낼 법한 모양.
        let usage = "#!/bin/sh\nprintf 'usage: heartbeat [-h] {once,status} ...\\n'\n\
                     printf 'heartbeat: error: unrecognized arguments: --version\\n' >&2\nexit 2\n";
        let (versions, _home) = versions_of(Some(&daemon_state("0.8.0")), usage);

        assert_eq!(
            versions.disk,
            DiskVersion::OffContract {
                code: Some(2),
                stdout: "usage: heartbeat [-h] {once,status} ...\n".to_owned(),
                stderr: "heartbeat: error: unrecognized arguments: --version\n".to_owned(),
            }
        );
        assert_eq!(
            versions.verdict,
            VersionVerdict::Undetermined {
                reasons: vec![UndeterminedReason::DiskVersionOffContract],
            }
        );
    }

    /// 빈 출력에는 읽을 줄이 없다. 종료 코드가 0이어도 버전이 나온 것이 아니다.
    #[cfg(unix)]
    #[test]
    fn empty_output_is_off_contract() {
        let (versions, _home) = versions_of(Some(&daemon_state("0.8.0")), "#!/bin/sh\nexit 0\n");

        assert_eq!(
            versions.disk,
            DiskVersion::OffContract {
                code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
            }
        );
    }

    /// 계약은 한 줄이라고 적었다. 줄이 더 있으면 그중 하나를 골라 읽지 않는다.
    #[cfg(unix)]
    #[test]
    fn more_than_one_line_is_off_contract() {
        let body = "#!/bin/sh\nprintf '%s\\n' 'heartbeat 0.8.1' 'built from a91f0c4'\n";
        let (versions, _home) = versions_of(Some(&daemon_state("0.8.1")), body);

        assert!(
            matches!(versions.disk, DiskVersion::OffContract { .. }),
            "한 줄이 아니면 계약 밖이다: {:?}",
            versions.disk
        );
        assert_eq!(
            versions.verdict,
            VersionVerdict::Undetermined {
                reasons: vec![UndeterminedReason::DiskVersionOffContract],
            }
        );
    }

    /// 토큰이 더 붙거나 앞 토큰이 계약이 적은 이름이 아니면 계약 밖이다. 마지막 공백 뒤를 무조건
    /// 잘라 오면 이런 줄에서 앱이 엉뚱한 값을 버전이라고 말하게 된다.
    #[cfg(unix)]
    #[test]
    fn a_line_of_another_shape_is_off_contract() {
        for line in [
            "heartbeat version 0.8.1",
            "claude-heartbeat 0.8.1",
            "0.8.1",
            "heartbeat",
        ] {
            let (versions, _home) = versions_of(Some(&daemon_state("0.8.1")), &prints(line));

            assert!(
                matches!(versions.disk, DiskVersion::OffContract { .. }),
                "`{line}`은 계약이 적은 모양이 아니다: {:?}",
                versions.disk
            );
        }
    }

    /// 계약은 종료 코드 0도 함께 적었다. 0이 아닌 코드로 끝난 실행의 출력은 버전이 아니다.
    #[cfg(unix)]
    #[test]
    fn a_contract_shaped_line_with_a_nonzero_exit_code_is_off_contract() {
        let body = format!("#!/bin/sh\nprintf '%s\\n' '{VERSION_LINE}'\nexit 1\n");
        let (versions, _home) = versions_of(Some(&daemon_state("0.8.1")), &body);

        assert!(
            matches!(
                versions.disk,
                DiskVersion::OffContract { code: Some(1), .. }
            ),
            "종료 코드가 0이 아니면 계약 밖이다: {:?}",
            versions.disk
        );
    }

    /// 뒤 토큰의 모양은 검사하지 않는다. 계약이 `X.Y.Z`를 검사하라고 적지 않았고, 앱이 규칙을 더하면
    /// 데몬이 표기를 넓힐 때 앱만 모름으로 떨어진다.
    #[cfg(unix)]
    #[test]
    fn the_version_token_is_taken_as_it_is() {
        let (versions, _home) = versions_of(
            Some(&daemon_state("0.9.0.dev1")),
            &prints("heartbeat 0.9.0.dev1"),
        );

        assert_eq!(
            versions.disk,
            DiskVersion::Known {
                version: "0.9.0.dev1".to_owned()
            }
        );
        assert_eq!(versions.verdict, VersionVerdict::Match);
    }

    /// 완료 조건 4. 이 기기의 현재 상태다(확인 사실 11). 본 후보가 결과에 실리고, 도는 데몬의
    /// 버전은 그래도 실린다.
    #[test]
    fn a_missing_executable_reports_the_paths_it_looked_at_and_still_carries_the_running_version() {
        let heartbeat_home = home();
        write_state(heartbeat_home.path(), &daemon_state("0.8.0"));
        let user_home = home();

        let versions =
            HeartbeatVersionService.versions_with(heartbeat_home.path(), &missing(&user_home));

        assert_eq!(
            versions.disk,
            DiskVersion::NotFound {
                looked: looked(&user_home),
            }
        );
        assert_eq!(
            versions.running,
            RunningVersion::Known {
                version: "0.8.0".to_owned()
            }
        );
        assert_eq!(
            versions.verdict,
            VersionVerdict::Undetermined {
                reasons: vec![UndeterminedReason::ExecutableNotFound],
            }
        );
    }

    /// 둘 다 모르면 사유도 둘이다. 하나만 실으면 나머지가 사라진다.
    #[test]
    fn both_sides_unknown_carries_both_reasons() {
        let heartbeat_home = home();
        let user_home = home();

        let versions =
            HeartbeatVersionService.versions_with(heartbeat_home.path(), &missing(&user_home));

        assert_eq!(
            versions.verdict,
            VersionVerdict::Undetermined {
                reasons: vec![
                    UndeterminedReason::RunningVersionUnknown,
                    UndeterminedReason::ExecutableNotFound,
                ],
            }
        );
    }

    /// 완료 조건 1. 상태 파일이 깨졌거나 `_daemon`이 없어도 오류가 아니라 "모름"이다.
    #[test]
    fn a_broken_or_entryless_state_file_is_unknown_and_not_an_error() {
        let user_home = home();

        for contents in [
            "{ not json",
            r#"{ "dream-catze": { "last_result": "success" } }"#,
        ] {
            let heartbeat_home = home();
            write_state(heartbeat_home.path(), contents);

            let versions =
                HeartbeatVersionService.versions_with(heartbeat_home.path(), &missing(&user_home));

            assert_eq!(versions.running, RunningVersion::Unknown);
        }
    }

    /// 완료 조건 5. 조회 커맨드는 프로세스를 띄우지 않는다. 후보 자리에 실행 흔적을 남기는
    /// 스크립트를 세워 두고, 조회 한 번 뒤에도 그 흔적이 없다는 것으로 확인한다.
    ///
    /// 이 검사가 이 모듈에 있는 것은 판정이 조회에 얹히는 순간 깨지는 것이 이 모듈의 설계여서다
    /// (머리주석). 조회 쪽에 판정을 부르는 줄이 생기면 여기서 걸린다.
    #[cfg(unix)]
    #[test]
    fn inspecting_the_integrations_starts_no_process() {
        use crate::application::heartbeat_service::HeartbeatService;

        let project = home();
        let heartbeat_home = home();
        write_state(heartbeat_home.path(), &daemon_state("0.8.0"));

        // 조회가 실행 파일을 띄운다면 첫 후보인 `~/.local/bin/heartbeat`가 답한다.
        let user_home = home();
        let user_bin = user_home.path().join(".local").join("bin");
        fs::create_dir_all(&user_bin).expect("user bin");
        let trace = user_home.path().join("실행-흔적");
        {
            use std::os::unix::fs::PermissionsExt;

            let script = user_bin.join("heartbeat");
            fs::write(
                &script,
                format!("#!/bin/sh\nprintf '%s' \"$*\" > '{}'\n", trace.display()),
            )
            .expect("write trace script");
            fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod");
        }

        HeartbeatService.inspect(project.path(), heartbeat_home.path(), user_home.path());

        assert!(
            !trace.exists(),
            "조회는 프로세스를 띄우지 않는다: {}",
            fs::read_to_string(&trace).unwrap_or_default()
        );
    }

    /// 판정 경로가 파일을 쓰지 않는다는 것을, 실행 전후로 목록이 같다는 것으로 확인한다.
    #[test]
    fn judging_writes_no_files() {
        let heartbeat_home = home();
        let user_home = home();

        HeartbeatVersionService.versions_with(heartbeat_home.path(), &missing(&user_home));

        assert_eq!(entries(&heartbeat_home), Vec::<String>::new());
        assert_eq!(entries(&user_home), Vec::<String>::new());
    }

    fn entries(directory: &TempDir) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(directory.path())
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

    #[test]
    fn the_undetermined_result_serializes_to_the_wire_contract() {
        let heartbeat_home = home();
        let user_home = home();

        let versions =
            HeartbeatVersionService.versions_with(heartbeat_home.path(), &missing(&user_home));

        assert_eq!(
            serde_json::to_value(&versions).expect("versions json"),
            serde_json::json!({
                "running": { "kind": "unknown" },
                "disk": { "kind": "notFound", "looked": looked(&user_home) },
                "verdict": {
                    "kind": "undetermined",
                    "reasons": ["runningVersionUnknown", "executableNotFound"],
                },
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_mismatch_result_serializes_to_the_wire_contract() {
        let (versions, _home) = versions_of(Some(&daemon_state("0.8.0")), &prints(VERSION_LINE));

        assert_eq!(
            serde_json::to_value(&versions).expect("versions json"),
            serde_json::json!({
                "running": { "kind": "known", "version": "0.8.0" },
                "disk": { "kind": "known", "version": "0.8.1" },
                "verdict": { "kind": "mismatch" },
            })
        );
    }
}
