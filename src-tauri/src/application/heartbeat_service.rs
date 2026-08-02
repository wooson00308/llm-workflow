use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::domain::project::HeartbeatStatus;
use crate::infrastructure::heartbeat_condition::{
    condition_script_path, install_condition_script, ConditionScriptError,
};
use crate::infrastructure::heartbeat_jobs::{
    install_role_jobs, job_name, parse_heartbeat, project_slug, validate_role_jobs,
    HeartbeatJobsError, HeartbeatRole, RoleJob, RoleJobSettings, MANAGED_END, MANAGED_START,
};
use crate::infrastructure::heartbeat_status::read_heartbeat_status;

const CONTROL_DIRECTORY: &str = ".workflow";
const HEARTBEAT_FILE: &str = "HEARTBEAT.md";

/// 이번 범위의 조건 스크립트는 POSIX `sh` 하나뿐이라 Windows에서는 연동을 지원하지 않는다.
const PLATFORM_SUPPORTED: bool = !cfg!(windows);

/// 설정 화면의 연동 카드가 한 번에 필요한 값. 전부 읽기 전용 판정이다.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatIntegration {
    pub supported: bool,
    pub slug: String,
    /// 프로젝트 루트 기준 상대 경로. 잡의 `condition`에 적히는 값과 같다.
    pub condition_script_path: String,
    pub status: HeartbeatStatus,
    /// 앱 관리 블록에 실제로 기록된 역할 잡만 담는다. 블록이 없으면 빈 목록이다.
    pub managed_jobs: Vec<ManagedRoleJob>,
}

/// 관리 블록에 설치된 역할 잡 중 사용자가 편집할 수 있는 값. 나머지 필드는 앱이 소유한다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRoleJob {
    pub role: String,
    pub interval: Option<String>,
    pub max_per: Option<String>,
    pub model: Option<String>,
}

/// 설치 커맨드가 받는 역할별 요청. 비활성 역할도 함께 받는다. 하트비트에 비활성 상태 필드가
/// 없으므로 "꺼짐"은 관리 블록에서 빼는 것으로 표현한다.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleJobRequest {
    pub role: String,
    pub enabled: bool,
    pub interval: String,
    pub max_per: String,
    pub model: String,
}

#[derive(Debug, Error)]
pub enum HeartbeatInstallError {
    #[error("이 플랫폼에서는 역할 잡을 설치할 수 없습니다. 조건 검사가 POSIX sh 스크립트라 Windows에서는 잡이 조용히 건너뛰어집니다.")]
    UnsupportedPlatform,
    #[error("알 수 없는 역할 `{0}`이라 아무 파일도 쓰지 않았습니다. planner, architect, developer 중 하나여야 합니다.")]
    UnknownRole(String),
    #[error(transparent)]
    Jobs(#[from] HeartbeatJobsError),
    #[error(transparent)]
    ConditionScript(#[from] ConditionScriptError),
}

#[derive(Debug, Default)]
pub struct HeartbeatService;

impl HeartbeatService {
    /// 하트비트 홈과 프로젝트 루트를 읽어 연동 상태를 만든다. 대상 파일이 없어도 오류가 아니다.
    pub fn inspect(&self, project_root: &Path, heartbeat_home: &Path) -> HeartbeatIntegration {
        let slug = project_slug(project_root);
        let status = read_heartbeat_status(heartbeat_home, &slug);
        let document = fs::read_to_string(heartbeat_home.join(HEARTBEAT_FILE)).unwrap_or_default();
        HeartbeatIntegration {
            supported: PLATFORM_SUPPORTED,
            condition_script_path: condition_script_relative_path(project_root),
            status,
            managed_jobs: managed_role_jobs(&document, &slug),
            slug,
        }
    }

    /// 활성 역할 잡을 설치하고 갱신된 상태를 돌려준다. 명시적 사용자 액션에서만 호출한다.
    ///
    /// 순서를 지킨다. 조건 스크립트가 먼저다. 잡을 먼저 쓰면 존재하지 않는 스크립트를 가리키는
    /// 잡이 잠깐이라도 활성화되고, 하트비트는 조건 검사 실패를 skip으로 처리하므로 사용자에게는
    /// "아무 일도 안 일어남"으로만 보인다.
    ///
    /// 조건 스크립트 설치가 실패하면 `HEARTBEAT.md`를 쓰지 않는다. 반대로 `HEARTBEAT.md` 쓰기가
    /// 실패해도 설치된 스크립트는 되돌리지 않는다. 잡 없이 스크립트만 있는 상태는 무해하다.
    pub fn install(
        &self,
        project_root: &Path,
        heartbeat_home: &Path,
        roles: &[RoleJobRequest],
    ) -> Result<HeartbeatIntegration, HeartbeatInstallError> {
        if !PLATFORM_SUPPORTED {
            return Err(HeartbeatInstallError::UnsupportedPlatform);
        }

        let jobs = enabled_role_jobs(roles)?;
        validate_role_jobs(&jobs)?;
        install_condition_script(&project_root.join(CONTROL_DIRECTORY))?;
        install_role_jobs(&heartbeat_home.join(HEARTBEAT_FILE), project_root, &jobs)?;

        Ok(self.inspect(project_root, heartbeat_home))
    }
}

/// 활성 역할만 앱이 아는 순서대로 모은다. 요청 배열의 순서가 파일의 잡 순서를 바꾸지 않는다.
fn enabled_role_jobs(roles: &[RoleJobRequest]) -> Result<Vec<RoleJob>, HeartbeatInstallError> {
    if let Some(unknown) = roles.iter().find(|request| {
        !HeartbeatRole::ALL
            .iter()
            .any(|role| role.as_argument() == request.role)
    }) {
        return Err(HeartbeatInstallError::UnknownRole(unknown.role.clone()));
    }

    Ok(HeartbeatRole::ALL
        .iter()
        .filter_map(|role| {
            let request = roles
                .iter()
                .find(|request| request.role == role.as_argument())
                .filter(|request| request.enabled)?;
            Some(RoleJob {
                role: *role,
                settings: RoleJobSettings {
                    model: request.model.clone(),
                    interval: request.interval.clone(),
                    max_per: request.max_per.clone(),
                },
            })
        })
        .collect())
}

/// 하트비트가 조건을 프로젝트 cwd에서 실행하므로 잡에 적히는 값도 이 상대 경로다.
fn condition_script_relative_path(project_root: &Path) -> String {
    let path = condition_script_path(&project_root.join(CONTROL_DIRECTORY));
    path.strip_prefix(project_root)
        .unwrap_or(&path)
        .display()
        .to_string()
}

/// 관리 블록 안의 역할 잡만 골라 편집 가능한 설정을 읽는다.
fn managed_role_jobs(document: &str, slug: &str) -> Vec<ManagedRoleJob> {
    let Some(block) = managed_block(document) else {
        return Vec::new();
    };
    let jobs = parse_heartbeat(block).jobs;
    HeartbeatRole::ALL
        .iter()
        .filter_map(|role| {
            let name = job_name(*role, slug);
            let job = jobs.iter().find(|job| job.name == name)?;
            Some(ManagedRoleJob {
                role: role.as_argument().to_owned(),
                interval: job.field("interval").map(str::to_owned),
                max_per: job.field("max_per").map(str::to_owned),
                model: job.field("model").map(str::to_owned),
            })
        })
        .collect()
}

/// 마커 한 쌍 사이의 본문. 마커가 없으면 관리 블록이 없는 것으로 본다.
fn managed_block(document: &str) -> Option<&str> {
    let (_, rest) = document.split_once(MANAGED_START)?;
    let (block, _) = rest.split_once(MANAGED_END)?;
    Some(block)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use tempfile::tempdir;

    use super::{managed_role_jobs, HeartbeatService};
    use crate::domain::project::HeartbeatInstallation;
    use crate::infrastructure::heartbeat_jobs::{MANAGED_END, MANAGED_START};

    const PROJECT_ROOT: &str = "/projects/workflow-labs";
    const SLUG: &str = "-projects-workflow-labs";

    fn developer_job(name: &str) -> String {
        format!("## {name}\n- slug: {SLUG}\n- interval: 20m\n- max_per: 6/24h\n- model: opus\n")
    }

    #[test]
    fn a_document_without_the_managed_block_has_no_role_jobs() {
        let document = format!(
            "- tick: 5m\n\n{}",
            developer_job("wf-developer-projects-workflow-labs")
        );

        assert!(managed_role_jobs(&document, SLUG).is_empty());
    }

    #[test]
    fn role_job_settings_come_from_the_managed_block() {
        let document = format!(
            "- tick: 5m\n\n{MANAGED_START}\n{}{MANAGED_END}\n",
            developer_job("wf-developer-projects-workflow-labs")
        );

        let jobs = managed_role_jobs(&document, SLUG);

        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].role, "developer");
        assert_eq!(jobs[0].interval.as_deref(), Some("20m"));
        assert_eq!(jobs[0].max_per.as_deref(), Some("6/24h"));
        assert_eq!(jobs[0].model.as_deref(), Some("opus"));
    }

    #[test]
    fn a_job_outside_the_managed_block_is_not_installed() {
        let document = format!(
            "{}\n{MANAGED_START}\n{MANAGED_END}\n",
            developer_job("wf-developer-projects-workflow-labs")
        );

        assert!(managed_role_jobs(&document, SLUG).is_empty());
    }

    #[test]
    fn an_empty_home_reports_the_slug_and_the_condition_script_path() {
        let home = tempdir().expect("temporary directory");

        let integration = HeartbeatService::default().inspect(Path::new(PROJECT_ROOT), home.path());

        assert_eq!(integration.slug, SLUG);
        assert_eq!(
            integration.condition_script_path,
            ".workflow/rules/wf-eligible.sh"
        );
        assert_eq!(
            integration.status.installation,
            HeartbeatInstallation::NotInstalled
        );
        assert!(integration.managed_jobs.is_empty());
    }
}

/// 설치는 POSIX `sh` 조건 스크립트를 전제하므로 지원 플랫폼에서만 검증한다.
#[cfg(all(test, not(windows)))]
mod install_tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use tempfile::{tempdir, TempDir};

    use super::{
        HeartbeatInstallError, HeartbeatIntegration, HeartbeatService, RoleJobRequest,
        HEARTBEAT_FILE,
    };
    use crate::infrastructure::heartbeat_condition::condition_script_path;
    use crate::infrastructure::heartbeat_jobs::HeartbeatJobsError;

    /// 프로젝트 루트와 하트비트 홈을 임시 디렉터리로 만든다. 실제 `~/.claude`는 건드리지 않는다.
    fn workspace() -> (TempDir, TempDir) {
        (
            tempdir().expect("project root"),
            tempdir().expect("heartbeat home"),
        )
    }

    fn request(role: &str, enabled: bool) -> RoleJobRequest {
        let (interval, max_per) = if role == "developer" {
            ("20m", "6/24h")
        } else {
            ("30m", "4/24h")
        };
        RoleJobRequest {
            role: role.to_owned(),
            enabled,
            interval: interval.to_owned(),
            max_per: max_per.to_owned(),
            model: "opus".to_owned(),
        }
    }

    fn all_enabled() -> Vec<RoleJobRequest> {
        vec![
            request("planner", true),
            request("architect", true),
            request("developer", true),
        ]
    }

    fn install(
        project: &TempDir,
        home: &TempDir,
        roles: &[RoleJobRequest],
    ) -> Result<HeartbeatIntegration, HeartbeatInstallError> {
        HeartbeatService::default().install(project.path(), home.path(), roles)
    }

    fn heartbeat_file(home: &TempDir) -> PathBuf {
        home.path().join(HEARTBEAT_FILE)
    }

    fn script_file(project: &TempDir) -> PathBuf {
        condition_script_path(&project.path().join(".workflow"))
    }

    /// 파일이 없으면 `None`이다. "쓰이지 않았다"를 없음과 내용 동일 두 경우로 함께 확인한다.
    fn snapshot(path: &Path) -> Option<String> {
        fs::read_to_string(path).ok()
    }

    #[test]
    fn installs_the_condition_script_and_the_role_jobs_together() {
        let (project, home) = workspace();

        let integration = install(&project, &home, &all_enabled()).expect("install");

        let script = snapshot(&script_file(&project)).expect("condition script");
        assert!(script.contains("# managed_by: workflow-labs"));

        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        for role in ["planner", "architect", "developer"] {
            assert!(document.contains(&format!("## wf-{role}{}", integration.slug)));
            assert!(document.contains(&format!(
                "- condition: sh .workflow/rules/wf-eligible.sh {role}"
            )));
        }

        // 5단계. 프론트가 상태를 다시 조회하지 않아도 되도록 갱신된 결과를 함께 돌려준다.
        assert_eq!(integration.managed_jobs.len(), 3);
    }

    #[test]
    fn an_invalid_setting_writes_neither_file() {
        let (project, home) = workspace();
        let mut roles = all_enabled();
        roles[0].interval = "30분".to_owned();

        let error = install(&project, &home, &roles).expect_err("must fail");

        assert!(matches!(
            error,
            HeartbeatInstallError::Jobs(HeartbeatJobsError::InvalidValue {
                field: "interval",
                ..
            })
        ));
        assert_eq!(snapshot(&script_file(&project)), None);
        assert_eq!(snapshot(&heartbeat_file(&home)), None);
    }

    #[test]
    fn an_unknown_role_writes_neither_file() {
        let (project, home) = workspace();
        let mut roles = all_enabled();
        roles.push(request("reviewer", true));

        let error = install(&project, &home, &roles).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::UnknownRole(role) if role == "reviewer"));
        assert_eq!(snapshot(&script_file(&project)), None);
        assert_eq!(snapshot(&heartbeat_file(&home)), None);
    }

    #[test]
    fn a_failed_condition_script_install_leaves_the_heartbeat_file_alone() {
        let (project, home) = workspace();
        let script = script_file(&project);
        fs::create_dir_all(script.parent().expect("rules directory")).expect("rules directory");
        let unmanaged = "#!/bin/sh\nexit 0\n";
        fs::write(&script, unmanaged).expect("seed script");
        let original = "- tick: 5m\n\n## my-job\n- slug: -tmp-demo\n";
        fs::write(heartbeat_file(&home), original).expect("seed heartbeat file");

        let error = install(&project, &home, &all_enabled()).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ConditionScript(_)));
        assert_eq!(snapshot(&script), Some(unmanaged.to_owned()));
        assert_eq!(snapshot(&heartbeat_file(&home)), Some(original.to_owned()));
    }

    #[test]
    fn the_same_install_twice_changes_neither_file() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("first install");
        let script = snapshot(&script_file(&project));
        let document = snapshot(&heartbeat_file(&home));

        install(&project, &home, &all_enabled()).expect("second install");

        assert_eq!(snapshot(&script_file(&project)), script);
        assert_eq!(snapshot(&heartbeat_file(&home)), document);
    }

    #[test]
    fn turning_a_role_off_and_on_restores_the_first_install() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let first = snapshot(&heartbeat_file(&home));

        let mut disabled = all_enabled();
        disabled[1].enabled = false;
        let integration = install(&project, &home, &disabled).expect("disable architect");
        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        assert!(!document.contains(&format!("## wf-architect{}", integration.slug)));
        assert_eq!(integration.managed_jobs.len(), 2);

        install(&project, &home, &all_enabled()).expect("enable architect");
        assert_eq!(snapshot(&heartbeat_file(&home)), first);
    }

    #[test]
    fn disabling_every_role_removes_the_block_but_keeps_the_script() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let script = snapshot(&script_file(&project));

        let disabled = vec![
            request("planner", false),
            request("architect", false),
            request("developer", false),
        ];
        let integration = install(&project, &home, &disabled).expect("disable all");

        assert!(integration.managed_jobs.is_empty());
        assert_eq!(snapshot(&heartbeat_file(&home)).as_deref(), Some(""));
        assert_eq!(snapshot(&script_file(&project)), script);
    }
}
