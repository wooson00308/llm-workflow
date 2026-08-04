//! 하트비트 설치 상태·잡 실행 기록·중복 잡을 읽기만 하는 모듈.
//!
//! 이 모듈은 파일을 쓰지 않고 디렉터리도 만들지 않는다. 하트비트 홈 경로는 인자로 받는다.
//! 대상 파일이 없거나 깨져 있어도 오류로 올리지 않는다. 상태 표시는 자동 새로고침 주기마다
//! 호출되므로, 없는 파일 때문에 화면이 에러로 덮이면 안 된다.
// 커맨드 계층(TASK-006)이 이 모듈을 호출하기 전까지는 전부 미사용이다. 연결이 끝나면 이 줄을 지운다.
#![allow(dead_code)]

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde_json::{Map, Value};

use crate::domain::project::{
    DuplicateHeartbeatJob, HeartbeatInstallationStatus, HeartbeatJobRun, HeartbeatReadFailure,
    HeartbeatRoleStatus, HeartbeatStatus, IntegrationInstallation, JobQuota,
};
use crate::infrastructure::heartbeat_condition::CONDITION_SCRIPT_STEM;
use crate::infrastructure::heartbeat_dream;
use crate::infrastructure::heartbeat_jobs::parse_heartbeat;
use crate::infrastructure::heartbeat_roles::{job_name, HeartbeatRole};

const HEARTBEAT_FILE: &str = "HEARTBEAT.md";
const DAEMON_DIRECTORY: &str = "heartbeat";
const PID_FILE: &str = "heartbeat.pid";
const STATE_FILE: &str = "state.json";

/// 중복 감지 결과에 담을 하트비트 연동 이름.
pub const INTEGRATION: &str = "heartbeat";

/// 조회가 한 번에 읽은 것. 문서 읽기 결과를 함께 돌려주어 호출자가 같은 파일을 다시 열지 않는다.
/// 두 번 읽으면 두 결과가 갈라져 "못 읽음"과 "잡 없음"의 구분이 성립하지 않는다.
pub(crate) struct HeartbeatRead {
    pub(crate) status: HeartbeatStatus,
    pub(crate) document: TextSource,
    /// 이 조회가 이미 연 상태 파일. 호출자가 같은 결과에서 값을 더 꺼내 파일을 다시 열지 않는다.
    pub(crate) runs: JobRuns,
}

/// 하트비트 홈에서 설치 상태·역할 잡 실행 기록·중복 잡을 한 번에 읽는다.
///
/// `heartbeat_home`은 `~/.claude`에 해당하는 디렉터리다. 홈 해석은 커맨드 계층이 한다.
pub(crate) fn read_heartbeat_status(heartbeat_home: &Path, slug: &str) -> HeartbeatRead {
    let mut read_failures = Vec::new();

    let document = read_text(&heartbeat_home.join(HEARTBEAT_FILE), &mut read_failures);
    let installation = installation_of(heartbeat_home, document.found(), &mut read_failures);

    let runs = read_job_runs(heartbeat_home, &mut read_failures);
    let roles = HeartbeatRole::ALL
        .iter()
        .map(|role| {
            let name = job_name(*role, slug);
            HeartbeatRoleStatus {
                role: role.as_argument().to_owned(),
                // 화면이 이 값으로 폼을 시딩하고 재설정도 이 값을 쓴다(R5). 잡 정의가 바뀌면
                // 화면의 기본값도 함께 바뀐다.
                defaults: role.default_settings(),
                last_run: runs.get(&name),
                // 한도 값은 관리 블록에 있어 이 모듈이 알지 못한다. 서비스가 채운다.
                quota: JobQuota::Unknown,
                job_name: name,
            }
        })
        .collect();

    let duplicate_jobs = document
        .text()
        .map(|contents| find_duplicate_jobs(contents, slug))
        .unwrap_or_default();

    HeartbeatRead {
        status: HeartbeatStatus {
            installation: installation.collapse(),
            roles,
            duplicate_jobs,
            read_failures,
        },
        document,
        runs,
    }
}

/// 하트비트 설치 상태만 읽는다. dream처럼 하트비트를 선행 조건으로 삼는 연동이 재사용한다.
pub fn read_heartbeat_installation(
    heartbeat_home: &Path,
    read_failures: &mut Vec<HeartbeatReadFailure>,
) -> HeartbeatInstallationStatus {
    let document_present = probe(&heartbeat_home.join(HEARTBEAT_FILE), read_failures);
    installation_of(heartbeat_home, document_present, read_failures)
}

/// 설치 판정은 한 곳에만 둔다. 호출자가 이미 문서를 읽었으면 그 결과를 넘겨 재조회를 피한다.
fn installation_of(
    heartbeat_home: &Path,
    document_present: bool,
    read_failures: &mut Vec<HeartbeatReadFailure>,
) -> HeartbeatInstallationStatus {
    let daemon_directory = heartbeat_home.join(DAEMON_DIRECTORY);
    let directory_present = probe(&daemon_directory, read_failures);
    let pid_present = probe(&daemon_directory.join(PID_FILE), read_failures);

    // pid 파일은 데몬 기동 시 생기고 정상 종료 시 지워진다. 하트비트가 상태 조회에서 죽은 pid를
    // 정리하므로 대부분 실행 중과 일치한다. 한계: 데몬이 정리 없이 죽으면 pid 파일이 남아 실행
    // 중으로 보인다. 프로세스 생존 확인은 플랫폼별 시스템 호출이 필요해 이 범위 밖이다.
    let installed = document_present || directory_present || pid_present;
    HeartbeatInstallationStatus {
        installation: if installed {
            IntegrationInstallation::Installed
        } else {
            IntegrationInstallation::NotInstalled
        },
        daemon_running: pid_present,
    }
}

/// 잡 실행 기록. 잡 이름 하나로만 조회하므로 어느 연동의 잡인지 알지 못한다.
pub struct JobRuns(Option<Value>);

impl JobRuns {
    /// 잡 기록 하나를 꺼낸다. 상태 파일이 없거나 깨졌거나 잡 키가 없으면 전부 "실행 기록 없음"이다.
    pub fn get(&self, job_name: &str) -> Option<HeartbeatJobRun> {
        let entry = self.0.as_ref()?.get(job_name)?.as_object()?;
        Some(HeartbeatJobRun {
            at: text_field(entry, "last_run"),
            result: text_field(entry, "last_result"),
            duration_seconds: entry.get("last_duration").and_then(Value::as_f64),
            // 같은 잡 항목에서 네 번째 값을 함께 꺼낸다. 이 값을 위해 상태 파일을 다시 열지 않는다.
            // `text_field`가 문자열이 아닌 타입을 값 없음으로 다루므로 계약 밖의 값이 와도 실패하지
            // 않는다.
            condition_output: text_field(entry, "last_condition_output"),
        })
    }

    /// 잡의 실행 시각 기록(epoch 초). 창 안 판정은 하지 않는다. 이 모듈은 관리 블록을 모르므로
    /// 창 길이를 알 수 없다.
    ///
    /// `None`은 "실행 기록 없음"이고 0회와 구분된다(R5). 빈 배열은 `Some(vec![])`이며 0회다.
    /// 배열이 있다는 것 자체가 기록이다. 숫자가 아닌 항목은 버린다.
    pub fn recent_runs(&self, job_name: &str) -> Option<Vec<f64>> {
        let entry = self.0.as_ref()?.get(job_name)?.as_object()?;
        let values = entry.get("recent_runs")?.as_array()?;
        Some(values.iter().filter_map(Value::as_f64).collect())
    }
}

/// 하트비트 상태 파일을 한 번만 읽는다. 잡 수만큼 파일을 다시 열지 않는다.
pub fn read_job_runs(
    heartbeat_home: &Path,
    read_failures: &mut Vec<HeartbeatReadFailure>,
) -> JobRuns {
    let state = read_text(
        &heartbeat_home.join(DAEMON_DIRECTORY).join(STATE_FILE),
        read_failures,
    );
    JobRuns(
        state
            .text()
            .and_then(|contents| serde_json::from_str::<Value>(contents).ok()),
    )
}

fn text_field(entry: &Map<String, Value>, key: &str) -> Option<String> {
    entry.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// 잡 하나가 어느 연동의 것인지 알아보는 기준. 판정은 연동이 제공한다.
struct DuplicateRule {
    integration: &'static str,
    /// 조건 문자열이 이 연동의 잡을 가리키는지 판정한다.
    matches: fn(&str) -> bool,
    /// 역할 개념이 있는 연동만 값을 돌려준다.
    role: fn(&str) -> Option<&'static str>,
}

/// 세 번째 연동은 이 목록에 항목 하나를 더한다. 아래 감지 루프와 결과 타입은 고치지 않는다.
const DUPLICATE_RULES: &[DuplicateRule] = &[
    DuplicateRule {
        integration: INTEGRATION,
        matches: is_role_condition,
        role: condition_role,
    },
    DuplicateRule {
        integration: heartbeat_dream::INTEGRATION,
        matches: heartbeat_dream::is_dream_condition,
        role: no_role,
    },
];

/// 이 파일에서 같은 slug를 쓰고 어느 연동의 조건을 참조하는 잡을 찾는다. 감지만 한다.
///
/// 블록 안팎을 가리지 않는다. 앱의 잡은 이제 이 파일이 아니라 프로젝트 잡 파일에 있으므로
/// (SPEC-024 R1), 여기 남은 이 프로젝트 slug의 잡은 자리와 무관하게 jobs.d의 정의와 겹치거나
/// 데몬이 무시하는 정의다(확인 사실 13). 블록 안이라고 봐주면 정리에 실패한 잔여가 화면에서 사라진다.
fn find_duplicate_jobs(contents: &str, slug: &str) -> Vec<DuplicateHeartbeatJob> {
    parse_heartbeat(contents)
        .jobs
        .into_iter()
        .filter(|job| job.field("slug") == Some(slug))
        .filter_map(|job| {
            let condition = job.field("condition")?;
            let rule = DUPLICATE_RULES
                .iter()
                .find(|rule| (rule.matches)(condition))?;
            Some(DuplicateHeartbeatJob {
                name: job.name.clone(),
                integration: rule.integration.to_owned(),
                role: (rule.role)(condition).map(str::to_owned),
            })
        })
        .collect()
}

/// 조건 스크립트는 확장자를 뺀 이름으로만 대조한다. 앱 설치본(`.workflow/rules/`)과 사용자가 손으로
/// 적은 경로(`scripts/`)가 모두 같은 판정 로직을 가리키므로 둘 다 중복으로 잡아야 하고, 자산이
/// 플랫폼별로 갈린 뒤로는 `.sh`와 `.ps1` 어느 쪽을 쓰는 잡도 잡아야 한다(R6).
fn is_role_condition(condition: &str) -> bool {
    condition.contains(CONDITION_SCRIPT_STEM)
}

/// dream 잡에는 역할 개념이 없다.
fn no_role(_condition: &str) -> Option<&'static str> {
    None
}

fn condition_role(condition: &str) -> Option<&'static str> {
    HeartbeatRole::ALL
        .iter()
        .map(|role| role.as_argument())
        .find(|argument| condition.split_whitespace().any(|token| token == *argument))
}

/// 읽기 결과. 파일이 없는 것과 있는데 못 읽는 것을 구분한다.
pub(crate) enum TextSource {
    Missing,
    Present(String),
    /// 못 읽은 사유를 함께 담는다. 실패 목록에도 같은 값이 들어가지만, 이 문서를 못 읽었다는 사실을
    /// 목록에서 경로로 되찾지 않고 읽기 결과에서 바로 꺼내 쓰기 위해서다.
    Unreadable(HeartbeatReadFailure),
}

impl TextSource {
    pub(crate) fn text(&self) -> Option<&str> {
        match self {
            Self::Present(contents) => Some(contents),
            _ => None,
        }
    }

    /// 못 읽었다면 그 사유. 읽었거나 파일이 없으면 `None`이다.
    pub(crate) fn unreadable(&self) -> Option<&HeartbeatReadFailure> {
        match self {
            Self::Unreadable(failure) => Some(failure),
            _ => None,
        }
    }

    /// 못 읽은 파일도 존재는 하므로 설치 판정에서는 있는 것으로 본다.
    fn found(&self) -> bool {
        !matches!(self, Self::Missing)
    }
}

pub(crate) fn read_text(path: &Path, failures: &mut Vec<HeartbeatReadFailure>) -> TextSource {
    match fs::read_to_string(path) {
        Ok(contents) => TextSource::Present(contents),
        Err(error) if error.kind() == ErrorKind::NotFound => TextSource::Missing,
        Err(error) => {
            let failure = failure(path, &error);
            failures.push(failure.clone());
            TextSource::Unreadable(failure)
        }
    }
}

/// 존재 여부만 본다. `NotFound`가 아닌 오류는 "있는데 확인하지 못했다"로 보고 실패 목록에 남긴다.
pub(crate) fn probe(path: &Path, failures: &mut Vec<HeartbeatReadFailure>) -> bool {
    match fs::symlink_metadata(path) {
        Ok(_) => true,
        Err(error) if error.kind() == ErrorKind::NotFound => false,
        Err(error) => {
            failures.push(failure(path, &error));
            true
        }
    }
}

pub(crate) fn failure(path: &Path, error: &std::io::Error) -> HeartbeatReadFailure {
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

    use super::read_heartbeat_status;
    use crate::domain::project::{
        HeartbeatInstallation, HeartbeatJobRun, HeartbeatStatus, JobQuota,
    };
    use crate::infrastructure::heartbeat_jobs::{MANAGED_END, MANAGED_START};

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

    fn developer_run(status: &HeartbeatStatus) -> Option<&HeartbeatJobRun> {
        status
            .roles
            .iter()
            .find(|role| role.role == "developer")
            .and_then(|role| role.last_run.as_ref())
    }

    #[test]
    fn empty_home_is_not_installed() {
        let directory = home();

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        assert_eq!(status.installation, HeartbeatInstallation::NotInstalled);
        assert!(status.read_failures.is_empty());
    }

    #[test]
    fn heartbeat_document_alone_means_daemon_stopped() {
        let directory = home();
        write(directory.path(), "HEARTBEAT.md", "- tick: 5m\n");

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        assert_eq!(
            status.installation,
            HeartbeatInstallation::InstalledDaemonStopped
        );
    }

    #[test]
    fn daemon_directory_alone_means_daemon_stopped() {
        let directory = home();
        fs::create_dir(directory.path().join("heartbeat")).expect("daemon directory");

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        assert_eq!(
            status.installation,
            HeartbeatInstallation::InstalledDaemonStopped
        );
    }

    #[test]
    fn pid_file_means_daemon_running() {
        let directory = home();
        write(directory.path(), "heartbeat/heartbeat.pid", "1234\n");

        let status = read_heartbeat_status(directory.path(), SLUG).status;

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

        let status = read_heartbeat_status(directory.path(), SLUG).status;

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

        let status = read_heartbeat_status(directory.path(), SLUG).status;

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

    /// 건너뜀 사유는 기존 세 값과 같은 잡 항목에서 나온다. 값을 만들거나 정규화하지 않으므로
    /// 어휘 밖의 문장(데몬이 만드는 타임아웃·실행 실패 사유)도 원문 그대로 통과한다.
    #[test]
    fn the_condition_output_comes_from_the_same_job_entry() {
        let directory = home();
        write(
            directory.path(),
            "heartbeat/state.json",
            &format!(
                r#"{{
  "{DEVELOPER_JOB}": {{
    "last_run": "2026-08-02T02:42:25.245888",
    "last_result": "skipped",
    "last_duration": 12.5,
    "last_condition_output": "no-target"
  }}
}}"#
            ),
        );

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        let run = developer_run(&status).expect("run record");
        assert_eq!(run.condition_output.as_deref(), Some("no-target"));
        // 네 번째 값이 기존 셋을 밀어내지 않는다.
        assert_eq!(run.result.as_deref(), Some("skipped"));
        assert_eq!(run.duration_seconds, Some(12.5));
    }

    /// 데몬이 직접 만드는 사유는 코드가 아니라 문장이다. 앱이 어휘로 걸러내면 그 사유가 사라진다.
    #[test]
    fn a_daemon_written_reason_passes_through_unchanged() {
        let directory = home();
        write(
            directory.path(),
            "heartbeat/state.json",
            &format!(
                r#"{{ "{DEVELOPER_JOB}": {{ "last_condition_output": "condition 타임아웃 (10s)" }} }}"#
            ),
        );

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        let run = developer_run(&status).expect("run record");
        assert_eq!(
            run.condition_output.as_deref(),
            Some("condition 타임아웃 (10s)")
        );
    }

    /// 키가 없는 상태가 지금 대부분의 기기다(이 키를 주는 데몬이 아직 출시본이 아니다). 계약 밖의
    /// 타입이 와도 값 없음이지 실패가 아니다.
    #[test]
    fn an_absent_or_non_string_condition_output_is_no_value() {
        let absent = home();
        write(
            absent.path(),
            "heartbeat/state.json",
            &format!(r#"{{ "{DEVELOPER_JOB}": {{ "last_result": "skipped" }} }}"#),
        );
        let wrong_type = home();
        write(
            wrong_type.path(),
            "heartbeat/state.json",
            &format!(
                r#"{{ "{DEVELOPER_JOB}": {{ "last_result": "skipped", "last_condition_output": {{ "code": 3 }} }} }}"#
            ),
        );

        for directory in [&absent, &wrong_type] {
            let status = read_heartbeat_status(directory.path(), SLUG).status;

            let run = developer_run(&status).expect("run record");
            assert_eq!(run.condition_output, None);
            // 같은 항목의 다른 값은 그대로 나온다. 값 하나가 조회 전체를 무르지 않는다.
            assert_eq!(run.result.as_deref(), Some("skipped"));
            assert!(status.read_failures.is_empty());
        }
    }

    /// 완료 조건 5. 상태 파일을 열 수 없게 만들면 조회 한 번이 실패를 몇 개 남기는지가 곧 그 파일을
    /// 몇 번 열었는지다. 사유를 위해 파일을 다시 여는 구현으로 바뀌면 이 수가 늘어난다.
    #[test]
    fn the_state_file_is_opened_once_per_status_read() {
        let directory = home();
        fs::create_dir_all(directory.path().join("heartbeat/state.json"))
            .expect("unreadable state file");

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        let state_failures = status
            .read_failures
            .iter()
            .filter(|failure| failure.path.ends_with("state.json"))
            .count();
        assert_eq!(state_failures, 1, "상태 파일을 한 번만 연다");
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
            let status = read_heartbeat_status(directory.path(), SLUG).status;

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

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        assert_eq!(status.duplicate_jobs.len(), 1);
        assert_eq!(status.duplicate_jobs[0].name, "wf-developer");
        assert_eq!(status.duplicate_jobs[0].role.as_deref(), Some("developer"));
    }

    /// SPEC-024 R3 · 완료 조건 6. 전환 전에는 관리 블록 안이 앱의 영토였으므로 그 안의 잡을
    /// 중복으로 세지 않았다. 이제 앱의 잡은 jobs.d에 있고 이 파일의 정의는 데몬이 무시하므로
    /// (확인 사실 13), 블록 안에 남은 이 프로젝트의 잡도 사용자에게 보여야 한다.
    #[test]
    fn a_job_of_this_project_inside_the_managed_block_is_detected_too() {
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

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        let reported = status
            .duplicate_jobs
            .iter()
            .map(|job| job.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(reported, vec!["wf-developer", DEVELOPER_JOB]);
    }

    /// 완료 조건 7. 판정 범위가 블록 안까지 넓어져도 고르는 기준은 slug 그대로다. 블록 안에 있는
    /// 남의 잡은 이 프로젝트와 무관하므로 화면에 올리지 않는다.
    #[test]
    fn another_projects_job_inside_the_managed_block_is_not_detected() {
        let directory = home();
        let managed = managed_block(&user_job(
            "wf-developer-Users-catze-Git-mech-arena",
            "-Users-catze-Git-mech-arena",
            "sh .workflow/rules/wf-eligible.sh developer",
        ));
        write(
            directory.path(),
            "HEARTBEAT.md",
            &format!("- tick: 5m\n\n{managed}"),
        );

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        assert!(status.duplicate_jobs.is_empty());
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

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        assert!(status.duplicate_jobs.is_empty());
    }

    /// R6. dream 잡은 자기 조건 기준으로 감지되고, 역할 개념이 없으므로 역할은 비어 있다.
    /// 블록 안의 dream 잡도 위 역할 잡과 같은 이유로 함께 감지된다(SPEC-024 R3).
    #[test]
    fn duplicate_dream_job_outside_the_managed_block_is_detected() {
        let directory = home();
        let managed = managed_block(&user_job(
            "wf-dream-Users-catze-project-workflow-labs",
            SLUG,
            "dream-prep check-unprocessed --slug=-Users-catze-project-workflow-labs",
        ));
        write(
            directory.path(),
            "HEARTBEAT.md",
            &format!(
                "- tick: 5m\n\n{}\n{managed}",
                user_job(
                    "dream-labs",
                    SLUG,
                    "dream-prep check-unprocessed --slug=-Users-catze-project-workflow-labs"
                )
            ),
        );

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        let reported = status
            .duplicate_jobs
            .iter()
            .map(|job| {
                (
                    job.name.as_str(),
                    job.integration.as_str(),
                    job.role.clone(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            reported,
            vec![
                ("dream-labs", "dream", None),
                ("wf-dream-Users-catze-project-workflow-labs", "dream", None),
            ]
        );
    }

    /// 감지 결과가 어느 연동의 중복인지 담는다. 화면이 그 연동 카드 안에 경고를 그린다.
    #[test]
    fn duplicates_of_both_integrations_are_reported_with_their_integration() {
        let directory = home();
        write(
            directory.path(),
            "HEARTBEAT.md",
            &format!(
                "{}\n{}",
                user_job("wf-developer", SLUG, "sh scripts/wf-eligible.sh developer"),
                user_job("dream-labs", SLUG, "dream-prep check-unprocessed --slug=x")
            ),
        );

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        let reported = status
            .duplicate_jobs
            .iter()
            .map(|job| (job.integration.as_str(), job.role.as_deref()))
            .collect::<Vec<_>>();
        assert_eq!(
            reported,
            vec![("heartbeat", Some("developer")), ("dream", None)]
        );
    }

    /// 자산이 플랫폼별로 갈린 뒤에도 감지는 한 벌이다(R6). 확장자를 뺀 이름으로 대조하므로
    /// PowerShell 조건을 쓰는 잡도 같은 규칙에 걸린다.
    #[test]
    fn detects_a_duplicate_role_job_written_with_a_powershell_condition() {
        let directory = home();
        write(
            directory.path(),
            "HEARTBEAT.md",
            &user_job(
                "wf-developer",
                SLUG,
                "powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-eligible.ps1 developer",
            ),
        );

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        assert_eq!(status.duplicate_jobs.len(), 1);
        assert_eq!(status.duplicate_jobs[0].name, "wf-developer");
        assert_eq!(status.duplicate_jobs[0].integration, "heartbeat");
        // 역할 판정은 마지막 토큰을 그대로 찾는다. 앞의 플래그들이 역할 토큰과 겹치지 않는다.
        assert_eq!(status.duplicate_jobs[0].role.as_deref(), Some("developer"));
    }

    #[test]
    fn duplicate_powershell_condition_without_a_role_argument_reports_the_name_only() {
        let directory = home();
        write(
            directory.path(),
            "HEARTBEAT.md",
            &user_job(
                "wf-unknown",
                SLUG,
                "powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-eligible.ps1",
            ),
        );

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        assert_eq!(status.duplicate_jobs.len(), 1);
        assert_eq!(status.duplicate_jobs[0].name, "wf-unknown");
        assert_eq!(status.duplicate_jobs[0].role, None);
    }

    #[test]
    fn duplicate_without_a_role_argument_reports_the_name_only() {
        let directory = home();
        write(
            directory.path(),
            "HEARTBEAT.md",
            &user_job("wf-unknown", SLUG, "sh scripts/wf-eligible.sh"),
        );

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        assert_eq!(status.duplicate_jobs.len(), 1);
        assert_eq!(status.duplicate_jobs[0].name, "wf-unknown");
        assert_eq!(status.duplicate_jobs[0].role, None);
    }

    /// 창 안 판정은 관리 블록을 아는 쪽이 한다. 이 모듈은 기록을 자르지 않고 그대로 돌려준다.
    #[test]
    fn recent_runs_are_returned_without_trimming_the_window() {
        let directory = home();
        write(
            directory.path(),
            "heartbeat/state.json",
            &format!(
                r#"{{ "{DEVELOPER_JOB}": {{ "recent_runs": [1, 2.5, "noise", null, 1785594846.384344] }} }}"#
            ),
        );

        let runs = read_heartbeat_status(directory.path(), SLUG).runs;

        assert_eq!(
            runs.recent_runs(DEVELOPER_JOB),
            Some(vec![1.0, 2.5, 1785594846.384344])
        );
    }

    /// `None`은 "실행 기록 없음"이고 0회와 구분된다.
    #[test]
    fn a_missing_broken_or_non_array_record_has_no_recent_runs() {
        let missing = home();
        let broken = home();
        write(broken.path(), "heartbeat/state.json", "{ not json");
        let absent = home();
        write(
            absent.path(),
            "heartbeat/state.json",
            r#"{ "dream-catze": { "recent_runs": [1] } }"#,
        );
        let not_an_array = home();
        write(
            not_an_array.path(),
            "heartbeat/state.json",
            &format!(r#"{{ "{DEVELOPER_JOB}": {{ "recent_runs": 3 }} }}"#),
        );
        let no_field = home();
        write(
            no_field.path(),
            "heartbeat/state.json",
            &format!(r#"{{ "{DEVELOPER_JOB}": {{ "last_result": "success" }} }}"#),
        );

        for directory in [&missing, &broken, &absent, &not_an_array, &no_field] {
            let runs = read_heartbeat_status(directory.path(), SLUG).runs;

            assert_eq!(runs.recent_runs(DEVELOPER_JOB), None);
        }
    }

    /// 배열이 있다는 것 자체가 기록이다. 빈 배열은 0회다.
    #[test]
    fn an_empty_array_is_zero_runs_and_not_a_missing_record() {
        let directory = home();
        write(
            directory.path(),
            "heartbeat/state.json",
            &format!(r#"{{ "{DEVELOPER_JOB}": {{ "recent_runs": [] }} }}"#),
        );

        let runs = read_heartbeat_status(directory.path(), SLUG).runs;

        assert_eq!(runs.recent_runs(DEVELOPER_JOB), Some(Vec::new()));
    }

    /// 한도 값은 관리 블록에 있고 이 모듈은 블록을 모른다. 서비스가 채울 때까지 `unknown`이다.
    #[test]
    fn the_status_alone_does_not_know_the_quota() {
        let directory = home();
        write(
            directory.path(),
            "heartbeat/state.json",
            &format!(r#"{{ "{DEVELOPER_JOB}": {{ "recent_runs": [1, 2] }} }}"#),
        );

        let status = read_heartbeat_status(directory.path(), SLUG).status;

        assert!(status
            .roles
            .iter()
            .all(|role| role.quota == JobQuota::Unknown));
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
            &format!(
                r#"{{ "{DEVELOPER_JOB}": {{ "recent_runs": [1785594846.384344], "last_result": "success" }} }}"#
            ),
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
