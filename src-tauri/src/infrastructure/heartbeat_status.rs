//! 하트비트 설치 상태·잡 실행 기록·중복 잡을 읽기만 하는 모듈.
//!
//! 이 모듈은 파일을 쓰지 않고 디렉터리도 만들지 않는다. 하트비트 홈 경로는 인자로 받는다.
//! 대상 파일이 없거나 깨져 있어도 오류로 올리지 않는다. 상태 표시는 자동 새로고침 주기마다
//! 호출되므로, 없는 파일 때문에 화면이 에러로 덮이면 안 된다.
// 커맨드 계층(TASK-006)이 이 모듈을 호출하기 전까지는 전부 미사용이다. 연결이 끝나면 이 줄을 지운다.
#![allow(dead_code)]

use std::fs;
use std::io::ErrorKind;
use std::ops::RangeInclusive;
use std::path::Path;

use serde_json::{Map, Value};

use crate::domain::project::{
    DuplicateHeartbeatJob, HeartbeatInstallation, HeartbeatJobRun, HeartbeatReadFailure,
    HeartbeatRoleStatus, HeartbeatStatus,
};
use crate::infrastructure::heartbeat_jobs::{
    job_name, parse_heartbeat, HeartbeatRole, MANAGED_END, MANAGED_START,
};

const HEARTBEAT_FILE: &str = "HEARTBEAT.md";
const DAEMON_DIRECTORY: &str = "heartbeat";
const PID_FILE: &str = "heartbeat.pid";
const STATE_FILE: &str = "state.json";

/// 조건 스크립트는 파일 이름으로만 대조한다. 앱 설치본(`.workflow/rules/`)과 사용자가 손으로 적은
/// 경로(`scripts/`)가 모두 같은 판정 로직을 가리키므로, 둘 다 중복으로 잡아야 한다.
const CONDITION_SCRIPT_FILE: &str = "wf-eligible.sh";

/// 하트비트 홈에서 설치 상태·역할 잡 실행 기록·중복 잡을 한 번에 읽는다.
///
/// `heartbeat_home`은 `~/.claude`에 해당하는 디렉터리다. 홈 해석은 커맨드 계층이 한다.
pub fn read_heartbeat_status(heartbeat_home: &Path, slug: &str) -> HeartbeatStatus {
    let mut read_failures = Vec::new();

    let document = read_text(&heartbeat_home.join(HEARTBEAT_FILE), &mut read_failures);
    let daemon_directory = heartbeat_home.join(DAEMON_DIRECTORY);
    let directory_present = probe(&daemon_directory, &mut read_failures);
    let pid_present = probe(&daemon_directory.join(PID_FILE), &mut read_failures);

    // pid 파일은 데몬 기동 시 생기고 정상 종료 시 지워진다. 하트비트가 상태 조회에서 죽은 pid를
    // 정리하므로 대부분 실행 중과 일치한다. 한계: 데몬이 정리 없이 죽으면 pid 파일이 남아 실행
    // 중으로 보인다. 프로세스 생존 확인은 플랫폼별 시스템 호출이 필요해 이 범위 밖이다.
    let installation = if pid_present {
        HeartbeatInstallation::InstalledDaemonRunning
    } else if document.found() || directory_present {
        HeartbeatInstallation::InstalledDaemonStopped
    } else {
        HeartbeatInstallation::NotInstalled
    };

    let state = read_text(&daemon_directory.join(STATE_FILE), &mut read_failures);
    let state = state
        .text()
        .and_then(|contents| serde_json::from_str::<Value>(contents).ok());

    let roles = HeartbeatRole::ALL
        .iter()
        .map(|role| {
            let name = job_name(*role, slug);
            let last_run = state.as_ref().and_then(|state| job_run(state, &name));
            HeartbeatRoleStatus {
                role: role.as_argument().to_owned(),
                job_name: name,
                last_run,
            }
        })
        .collect();

    let duplicate_jobs = document
        .text()
        .map(|contents| find_duplicate_jobs(contents, slug))
        .unwrap_or_default();

    HeartbeatStatus {
        installation,
        roles,
        duplicate_jobs,
        read_failures,
    }
}

/// 잡 기록 하나를 꺼낸다. 잡 키가 없거나 값이 객체가 아니면 "실행 기록 없음"이다.
fn job_run(state: &Value, name: &str) -> Option<HeartbeatJobRun> {
    let entry = state.get(name)?.as_object()?;
    Some(HeartbeatJobRun {
        at: text_field(entry, "last_run"),
        result: text_field(entry, "last_result"),
        duration_seconds: entry.get("last_duration").and_then(Value::as_f64),
    })
}

fn text_field(entry: &Map<String, Value>, key: &str) -> Option<String> {
    entry.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// 관리 블록 밖에 있으면서 같은 slug와 조건 스크립트를 쓰는 잡을 찾는다. 감지만 한다.
fn find_duplicate_jobs(contents: &str, slug: &str) -> Vec<DuplicateHeartbeatJob> {
    let managed = managed_block(contents);
    parse_heartbeat(contents)
        .jobs
        .into_iter()
        .filter(|job| {
            managed
                .as_ref()
                .is_none_or(|block| !block.contains(&job.start_line))
        })
        .filter(|job| job.field("slug") == Some(slug))
        .filter_map(|job| {
            let condition = job.field("condition")?;
            if !condition.contains(CONDITION_SCRIPT_FILE) {
                return None;
            }
            let role = condition_role(condition).map(str::to_owned);
            Some(DuplicateHeartbeatJob {
                name: job.name.clone(),
                role,
            })
        })
        .collect()
}

/// 마커 한 쌍이 순서대로 있을 때만 블록 줄 범위를 돌려준다. 블록이 없거나 마커가 손상된 파일에서는
/// 문서의 모든 잡을 블록 밖으로 본다. 손상 상태는 설치 액션이 별도로 거부한다.
fn managed_block(contents: &str) -> Option<RangeInclusive<usize>> {
    let starts = marker_lines(contents, MANAGED_START);
    let ends = marker_lines(contents, MANAGED_END);
    match (starts.as_slice(), ends.as_slice()) {
        ([start], [end]) if start < end => Some(*start..=*end),
        _ => None,
    }
}

fn marker_lines(contents: &str, marker: &str) -> Vec<usize> {
    contents
        .lines()
        .enumerate()
        .filter(|(_, line)| line.trim() == marker)
        .map(|(index, _)| index)
        .collect()
}

fn condition_role(condition: &str) -> Option<&'static str> {
    HeartbeatRole::ALL
        .iter()
        .map(|role| role.as_argument())
        .find(|argument| condition.split_whitespace().any(|token| token == *argument))
}

/// 읽기 결과. 파일이 없는 것과 있는데 못 읽는 것을 구분한다.
enum TextSource {
    Missing,
    Present(String),
    Unreadable,
}

impl TextSource {
    fn text(&self) -> Option<&str> {
        match self {
            Self::Present(contents) => Some(contents),
            _ => None,
        }
    }

    /// 못 읽은 파일도 존재는 하므로 설치 판정에서는 있는 것으로 본다.
    fn found(&self) -> bool {
        !matches!(self, Self::Missing)
    }
}

fn read_text(path: &Path, failures: &mut Vec<HeartbeatReadFailure>) -> TextSource {
    match fs::read_to_string(path) {
        Ok(contents) => TextSource::Present(contents),
        Err(error) if error.kind() == ErrorKind::NotFound => TextSource::Missing,
        Err(error) => {
            failures.push(failure(path, &error));
            TextSource::Unreadable
        }
    }
}

/// 존재 여부만 본다. `NotFound`가 아닌 오류는 "있는데 확인하지 못했다"로 보고 실패 목록에 남긴다.
fn probe(path: &Path, failures: &mut Vec<HeartbeatReadFailure>) -> bool {
    match fs::symlink_metadata(path) {
        Ok(_) => true,
        Err(error) if error.kind() == ErrorKind::NotFound => false,
        Err(error) => {
            failures.push(failure(path, &error));
            true
        }
    }
}

fn failure(path: &Path, error: &std::io::Error) -> HeartbeatReadFailure {
    HeartbeatReadFailure {
        path: path.display().to_string(),
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::Path;
    use std::time::SystemTime;

    use tempfile::{tempdir, TempDir};

    use super::{read_heartbeat_status, MANAGED_END, MANAGED_START};
    use crate::domain::project::HeartbeatInstallation;

    const SLUG: &str = "-Users-catze-project-workflow-labs";
    const DEVELOPER_JOB: &str = "wf-developer-Users-catze-project-workflow-labs";

    fn home() -> TempDir {
        tempdir().expect("temporary directory")
    }

    /// 테스트 픽스처만 쓴다. 대상 모듈은 아무것도 쓰지 않는다.
    fn write(home: &Path, relative: &str, contents: &str) {
        let path = home.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture directory");
        }
        fs::write(path, contents).expect("fixture file");
    }

    fn user_job(name: &str, slug: &str, condition: &str) -> String {
        format!("## {name}\n- slug: {slug}\n- condition: {condition}\n")
    }

    fn managed_block(body: &str) -> String {
        format!("{MANAGED_START}\n{body}{MANAGED_END}\n")
    }

    #[test]
    fn empty_home_is_not_installed() {
        let directory = home();

        let status = read_heartbeat_status(directory.path(), SLUG);

        assert_eq!(status.installation, HeartbeatInstallation::NotInstalled);
        assert!(status.read_failures.is_empty());
    }

    #[test]
    fn heartbeat_document_alone_means_daemon_stopped() {
        let directory = home();
        write(directory.path(), "HEARTBEAT.md", "- tick: 5m\n");

        let status = read_heartbeat_status(directory.path(), SLUG);

        assert_eq!(
            status.installation,
            HeartbeatInstallation::InstalledDaemonStopped
        );
    }

    #[test]
    fn daemon_directory_alone_means_daemon_stopped() {
        let directory = home();
        fs::create_dir(directory.path().join("heartbeat")).expect("daemon directory");

        let status = read_heartbeat_status(directory.path(), SLUG);

        assert_eq!(
            status.installation,
            HeartbeatInstallation::InstalledDaemonStopped
        );
    }

    #[test]
    fn pid_file_means_daemon_running() {
        let directory = home();
        write(directory.path(), "heartbeat/heartbeat.pid", "1234\n");

        let status = read_heartbeat_status(directory.path(), SLUG);

        assert_eq!(
            status.installation,
            HeartbeatInstallation::InstalledDaemonRunning
        );
    }

    #[test]
    fn role_job_run_comes_from_the_state_file() {
        let directory = home();
        write(
            directory.path(),
            "heartbeat/state.json",
            &format!(
                r#"{{
  "dream-catze": {{ "last_run": "2026-08-01T00:00:00", "last_result": "success" }},
  "{DEVELOPER_JOB}": {{
    "recent_runs": [1785594846.384344],
    "last_run": "2026-08-02T02:42:25.245888",
    "last_result": "skipped",
    "last_duration": 12.5
  }}
}}"#
            ),
        );

        let status = read_heartbeat_status(directory.path(), SLUG);

        let developer = status
            .roles
            .iter()
            .find(|role| role.role == "developer")
            .expect("developer role");
        assert_eq!(developer.job_name, DEVELOPER_JOB);
        let run = developer.last_run.as_ref().expect("run record");
        assert_eq!(run.at.as_deref(), Some("2026-08-02T02:42:25.245888"));
        assert_eq!(run.result.as_deref(), Some("skipped"));
        assert_eq!(run.duration_seconds, Some(12.5));

        // 다른 프로젝트의 잡은 조회 대상이 아니다.
        assert!(status
            .roles
            .iter()
            .filter(|role| role.role != "developer")
            .all(|role| role.last_run.is_none()));
    }

    #[test]
    fn integer_duration_is_read_as_seconds() {
        let directory = home();
        write(
            directory.path(),
            "heartbeat/state.json",
            &format!(r#"{{ "{DEVELOPER_JOB}": {{ "last_duration": 0 }} }}"#),
        );

        let status = read_heartbeat_status(directory.path(), SLUG);

        let run = status
            .roles
            .iter()
            .find(|role| role.role == "developer")
            .and_then(|role| role.last_run.as_ref())
            .expect("run record");
        assert_eq!(run.duration_seconds, Some(0.0));
        assert_eq!(run.at, None);
        assert_eq!(run.result, None);
    }

    #[test]
    fn missing_broken_or_absent_job_key_has_no_run_record() {
        let missing = home();
        let broken = home();
        write(broken.path(), "heartbeat/state.json", "{ not json");
        let absent = home();
        write(
            absent.path(),
            "heartbeat/state.json",
            r#"{ "dream-catze": { "last_result": "success" } }"#,
        );

        for directory in [&missing, &broken, &absent] {
            let status = read_heartbeat_status(directory.path(), SLUG);

            assert!(status.roles.iter().all(|role| role.last_run.is_none()));
            assert!(status.read_failures.is_empty());
        }
    }

    #[test]
    fn duplicate_job_outside_the_managed_block_is_detected() {
        let directory = home();
        write(
            directory.path(),
            "HEARTBEAT.md",
            &format!(
                "- tick: 5m\n\n{}",
                user_job("wf-developer", SLUG, "sh scripts/wf-eligible.sh developer")
            ),
        );

        let status = read_heartbeat_status(directory.path(), SLUG);

        assert_eq!(status.duplicate_jobs.len(), 1);
        assert_eq!(status.duplicate_jobs[0].name, "wf-developer");
        assert_eq!(status.duplicate_jobs[0].role.as_deref(), Some("developer"));
    }

    #[test]
    fn job_inside_the_managed_block_is_not_detected() {
        let directory = home();
        let managed = managed_block(&user_job(
            DEVELOPER_JOB,
            SLUG,
            "sh .workflow/rules/wf-eligible.sh developer",
        ));
        write(
            directory.path(),
            "HEARTBEAT.md",
            &format!(
                "- tick: 5m\n\n{}\n{managed}",
                user_job("wf-developer", SLUG, "sh scripts/wf-eligible.sh developer")
            ),
        );

        let status = read_heartbeat_status(directory.path(), SLUG);

        assert_eq!(status.duplicate_jobs.len(), 1);
        assert_eq!(status.duplicate_jobs[0].name, "wf-developer");
    }

    #[test]
    fn other_slug_or_other_condition_is_not_detected() {
        let directory = home();
        write(
            directory.path(),
            "HEARTBEAT.md",
            &format!(
                "{}\n{}",
                user_job(
                    "other-project",
                    "-Users-catze-project-other",
                    "sh scripts/wf-eligible.sh developer"
                ),
                user_job("dream-catze", SLUG, "sh scripts/dream.sh")
            ),
        );

        let status = read_heartbeat_status(directory.path(), SLUG);

        assert!(status.duplicate_jobs.is_empty());
    }

    #[test]
    fn duplicate_without_a_role_argument_reports_the_name_only() {
        let directory = home();
        write(
            directory.path(),
            "HEARTBEAT.md",
            &user_job("wf-unknown", SLUG, "sh scripts/wf-eligible.sh"),
        );

        let status = read_heartbeat_status(directory.path(), SLUG);

        assert_eq!(status.duplicate_jobs.len(), 1);
        assert_eq!(status.duplicate_jobs[0].name, "wf-unknown");
        assert_eq!(status.duplicate_jobs[0].role, None);
    }

    #[test]
    fn reading_the_status_does_not_touch_the_heartbeat_home() {
        let directory = home();
        write(
            directory.path(),
            "HEARTBEAT.md",
            &user_job("wf-developer", SLUG, "sh scripts/wf-eligible.sh developer"),
        );
        write(directory.path(), "heartbeat/heartbeat.pid", "1234\n");
        write(
            directory.path(),
            "heartbeat/state.json",
            &format!(r#"{{ "{DEVELOPER_JOB}": {{ "last_result": "success" }} }}"#),
        );

        let before = snapshot(directory.path());
        read_heartbeat_status(directory.path(), SLUG);
        assert_eq!(snapshot(directory.path()), before);
    }

    /// 하트비트 홈 아래 모든 파일의 경로와 수정 시각.
    fn snapshot(home: &Path) -> BTreeMap<String, SystemTime> {
        let mut entries = BTreeMap::new();
        collect(home, &mut entries);
        entries
    }

    fn collect(directory: &Path, entries: &mut BTreeMap<String, SystemTime>) {
        for entry in fs::read_dir(directory).expect("directory listing") {
            let path = entry.expect("directory entry").path();
            let metadata = fs::symlink_metadata(&path).expect("entry metadata");
            entries.insert(
                path.display().to_string(),
                metadata.modified().expect("modified time"),
            );
            if metadata.is_dir() {
                collect(&path, entries);
            }
        }
    }
}
