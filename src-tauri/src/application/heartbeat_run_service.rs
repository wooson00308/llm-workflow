//! 이 프로젝트의 역할 잡 하나를 지금 실행하는 서비스.
//!
//! 조회·설치와 다른 책임이라 `heartbeat_service`와 나눠 둔다. 이 경로는 어떤 파일도 읽거나 쓰지
//! 않는다(SPEC-020 R1, 완료 조건 5).
//!
//! 실행에 앞서 잡 이름을 검증하는 것이 이 모듈의 핵심이다. 화면이 무엇을 보내든 실제로 도는 것은
//! 이 프로젝트의 역할 잡 셋뿐이고, 그 밖의 이름은 프로세스를 띄우지 않고 실패로 끝난다
//! (완료 조건 21·23).

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::infrastructure::heartbeat_jobs::project_slug;
use crate::infrastructure::heartbeat_process::{candidates, manual_command, run_once, RunFailure};
use crate::infrastructure::heartbeat_roles::{job_name, HeartbeatRole};

/// 실행 실패 값. 화면이 문자열을 다시 조립하지 않게 세 값을 완성해 싣는다.
///
/// `command`는 사용자가 손으로 같은 일을 할 때 칠 명령 원문이고 사유와 무관하게 언제나 채운다(R6).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunJobFailure {
    pub job_name: String,
    pub message: String,
    pub command: String,
}

impl RunJobFailure {
    pub fn new(job_name: &str, message: String) -> Self {
        Self {
            job_name: job_name.to_owned(),
            message,
            command: manual_command(job_name),
        }
    }
}

#[derive(Debug, Default)]
pub struct HeartbeatRunService;

impl HeartbeatRunService {
    /// 역할 잡 하나를 한 번 돌린다. 자식이 끝날 때까지 돌아오지 않으므로 호출자가 블로킹 자리를
    /// 마련해 부른다.
    ///
    /// `user_home`은 실행 파일 후보(`~/.local/bin`)를 만드는 데만 쓴다. 하트비트 홈이 아니다.
    pub fn run_job(
        &self,
        project_root: &Path,
        user_home: &Path,
        job_name: &str,
    ) -> Result<(), RunJobFailure> {
        self.run_with(project_root, &candidates(user_home), job_name)
    }

    /// 후보 목록을 받는 형태. 실제로 하트비트를 띄우지 않고 실패 경로를 확인할 수 있어야 해서
    /// 나눠 둔다.
    fn run_with(
        &self,
        project_root: &Path,
        candidates: &[PathBuf],
        job_name: &str,
    ) -> Result<(), RunJobFailure> {
        if !is_project_role_job(project_root, job_name) {
            return Err(RunJobFailure::new(job_name, unknown_job_message(job_name)));
        }

        run_once(candidates, job_name)
            .map_err(|failure| RunJobFailure::new(job_name, describe(&failure)))
    }
}

/// 받은 이름이 이 프로젝트의 역할 잡 셋 중 하나인가. 이 검사가 완료 조건 21·23을 닫는다.
fn is_project_role_job(project_root: &Path, name: &str) -> bool {
    let slug = project_slug(project_root);
    HeartbeatRole::ALL
        .iter()
        .any(|role| job_name(*role, &slug) == name)
}

fn unknown_job_message(name: &str) -> String {
    format!(
        "`{name}`은 이 프로젝트의 역할 잡이 아니라 아무것도 실행하지 않았습니다. \
         이 액션이 실행하는 것은 지금 열린 프로젝트의 기획자·아키텍트·개발자 잡뿐입니다."
    )
}

/// 사유마다 다른 말을 쓴다. 실행 파일을 찾지 못한 것, 찾았지만 띄우지 못한 것, 띄웠지만 0이 아닌
/// 코드로 끝난 것은 사용자가 할 다음 행동이 서로 다르다.
fn describe(failure: &RunFailure) -> String {
    match failure {
        RunFailure::NotFound { looked } => format!(
            "하트비트 실행 파일을 찾지 못해 실행하지 못했습니다. 확인한 경로: {}",
            looked
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        RunFailure::NotStarted { program, reason } => format!(
            "`{}`을(를) 찾았지만 실행을 시작하지 못했습니다: {reason}",
            program.display()
        ),
        RunFailure::ExitStatus {
            program,
            code: Some(code),
        } => format!(
            "`{}`이(가) 종료 코드 {code}으로 끝났습니다.",
            program.display()
        ),
        RunFailure::ExitStatus {
            program,
            code: None,
        } => format!("`{}`이(가) 종료 코드 없이 끝났습니다.", program.display()),
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use pretty_assertions::assert_eq;
    use tempfile::{tempdir, TempDir};

    use super::{HeartbeatRunService, RunJobFailure};
    use crate::infrastructure::heartbeat_jobs::project_slug;
    use crate::infrastructure::heartbeat_roles::{job_name, HeartbeatRole};

    fn planner_job(project_root: &Path) -> String {
        job_name(HeartbeatRole::Planner, &project_slug(project_root))
    }

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

    #[test]
    fn a_name_that_is_not_a_role_job_of_this_project_fails_without_running_anything() {
        let project = tempdir().expect("temp project");
        let home = tempdir().expect("temp home");

        let failure = HeartbeatRunService
            .run_job(project.path(), home.path(), "wf-planner-Users-someone-else")
            .expect_err("다른 프로젝트의 잡 이름은 실패다");

        assert_eq!(failure.job_name, "wf-planner-Users-someone-else");
        assert_eq!(
            failure.command,
            "heartbeat once -j wf-planner-Users-someone-else"
        );
        assert!(
            failure.message.contains("이 프로젝트의 역할 잡이 아니라"),
            "사유를 밝혀야 한다: {}",
            failure.message
        );
    }

    #[test]
    fn dream_jobs_are_not_runnable_through_this_action() {
        let project = tempdir().expect("temp project");
        let home = tempdir().expect("temp home");
        let dream = format!("wf-dream{}", project_slug(project.path()));

        let failure = HeartbeatRunService
            .run_job(project.path(), home.path(), &dream)
            .expect_err("dream 잡은 이번 범위가 아니다");

        assert_eq!(failure.job_name, dream);
    }

    #[test]
    fn every_role_job_of_this_project_reaches_the_run_path() {
        let project = tempdir().expect("temp project");
        let home = tempdir().expect("temp home");
        let slug = project_slug(project.path());

        for role in HeartbeatRole::ALL {
            let job = job_name(role, &slug);
            let failure = HeartbeatRunService
                .run_with(project.path(), &missing(&home), &job)
                .expect_err("후보가 없으므로 실행에는 실패한다");

            assert!(
                failure.message.contains("실행 파일을 찾지 못해"),
                "이름 검증이 아니라 실행에서 실패해야 한다: {}",
                failure.message
            );
        }
    }

    #[test]
    fn a_missing_executable_reports_the_command_the_user_can_type() {
        let project = tempdir().expect("temp project");
        let home = tempdir().expect("temp home");
        let job = planner_job(project.path());

        let failure = HeartbeatRunService
            .run_with(project.path(), &missing(&home), &job)
            .expect_err("후보가 없으므로 실패다");

        assert_eq!(failure.job_name, job);
        assert_eq!(failure.command, format!("heartbeat once -j {job}"));
        assert!(
            failure.message.contains("없는-후보"),
            "본 후보 경로를 밝혀야 한다: {}",
            failure.message
        );
    }

    /// 실행 경로가 파일을 쓰지 않는다는 것은 두 입구 모두에서 성립해야 한다. 이름 검증에서 끝나는
    /// 쪽과 실행까지 가는 쪽을 각각 확인한다.
    #[test]
    fn running_writes_no_files_to_the_home_or_the_project() {
        let project = tempdir().expect("temp project");
        let home = tempdir().expect("temp home");
        let job = planner_job(project.path());

        HeartbeatRunService
            .run_with(project.path(), &missing(&home), &job)
            .expect_err("후보가 없으므로 실패다");
        HeartbeatRunService
            .run_job(project.path(), home.path(), "wf-planner-Users-someone-else")
            .expect_err("다른 프로젝트의 잡 이름은 실패다");

        assert_eq!(entries(&project), Vec::<String>::new());
        assert_eq!(entries(&home), Vec::<String>::new());
    }

    #[test]
    fn the_failure_value_serializes_to_the_wire_contract() {
        let failure = RunJobFailure::new("wf-planner-slug", "실행하지 못했습니다.".to_owned());

        assert_eq!(
            serde_json::to_value(&failure).expect("failure json"),
            serde_json::json!({
                "jobName": "wf-planner-slug",
                "message": "실행하지 못했습니다.",
                "command": "heartbeat once -j wf-planner-slug",
            })
        );
    }

    /// 잡 이름이 이 프로젝트의 것이 아니면 프로세스를 띄우지 않는다는 것을, 띄웠으면 남았을 흔적이
    /// 없다는 것으로 확인한다.
    #[cfg(unix)]
    #[test]
    fn an_unknown_job_name_never_spawns_the_candidate() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let project = tempdir().expect("temp project");
        let directory = tempdir().expect("temp dir");
        let script = directory.path().join("recorder");
        fs::write(
            &script,
            "#!/bin/sh\nprintf 'ran' > \"$(dirname \"$0\")/ran\"\n",
        )
        .expect("write recorder");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod recorder");

        HeartbeatRunService
            .run_with(project.path(), &[script], "wf-planner-Users-someone-else")
            .expect_err("다른 프로젝트의 잡 이름은 실패다");

        assert!(
            !directory.path().join("ran").exists(),
            "이름 검증 전에 프로세스를 띄우면 안 된다"
        );
    }
}
