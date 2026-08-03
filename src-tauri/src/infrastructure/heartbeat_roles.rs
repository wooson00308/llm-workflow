//! 역할 잡(기획자·아키텍트·개발자) 정의. 파일을 읽거나 쓰지 않고 값만 조립한다.
//!
//! 관리 블록에 쓰는 일은 `heartbeat_jobs`가 한다. 이 모듈은 역할 잡을 `ManagedJob`으로 바꿔 넘긴다.
// 커맨드 계층(TASK-006·TASK-007)이 이 모듈을 호출하기 전까지는 전부 미사용이다. 연결이 끝나면 이 줄을 지운다.
#![allow(dead_code)]

use crate::domain::project::JobDefaults;
use crate::infrastructure::heartbeat_jobs::ManagedJob;

const CONDITION_SCRIPT: &str = ".workflow/rules/wf-eligible.sh";
const NOTIFY: &str = "all";

const PLANNER_PROMPT: &str = "기획자 역할로 진행해줘. .workflow의 공통 규칙과 planner 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.";
const ARCHITECT_PROMPT: &str = "프로젝트 아키텍트 역할로 진행해줘. .workflow의 공통 규칙과 architect 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.";
const DEVELOPER_PROMPT: &str = "개발자 역할로 진행해줘. .workflow의 공통 규칙과 developer 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeartbeatRole {
    Planner,
    Architect,
    Developer,
}

impl HeartbeatRole {
    pub const ALL: [HeartbeatRole; 3] = [Self::Planner, Self::Architect, Self::Developer];

    pub fn as_argument(self) -> &'static str {
        match self {
            Self::Planner => "planner",
            Self::Architect => "architect",
            Self::Developer => "developer",
        }
    }

    pub fn prompt(self) -> &'static str {
        match self {
            Self::Planner => PLANNER_PROMPT,
            Self::Architect => ARCHITECT_PROMPT,
            Self::Developer => DEVELOPER_PROMPT,
        }
    }

    pub fn default_settings(self) -> RoleJobSettings {
        match self {
            Self::Developer => RoleJobSettings {
                model: "opus".to_owned(),
                interval: "20m".to_owned(),
                max_per: "6/24h".to_owned(),
            },
            _ => RoleJobSettings {
                model: "opus".to_owned(),
                interval: "30m".to_owned(),
                max_per: "4/24h".to_owned(),
            },
        }
    }

    /// 앱이 소유하는 값이라 사용자 편집 대상이 아니다.
    fn timeout(self) -> &'static str {
        match self {
            Self::Developer => "30m",
            _ => "20m",
        }
    }
}

/// 사용자가 편집할 수 있는 역할 잡 설정.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleJobSettings {
    pub model: String,
    pub interval: String,
    pub max_per: String,
}

/// 화면이 보여주는 기본값과 파일에 쓰이는 기본값을 같은 값에서 만든다(R5).
impl From<RoleJobSettings> for JobDefaults {
    fn from(settings: RoleJobSettings) -> Self {
        Self {
            interval: settings.interval,
            max_per: settings.max_per,
            model: settings.model,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleJob {
    pub role: HeartbeatRole,
    pub settings: RoleJobSettings,
}

/// slug가 `-`로 시작하므로 결과는 `wf-planner-Users-...` 형태가 된다.
pub fn job_name(role: HeartbeatRole, slug: &str) -> String {
    format!("wf-{}{}", role.as_argument(), slug)
}

/// 역할 잡을 관리 블록이 쓰는 공통 잡으로 바꾼다. 호출자가 필드를 직접 조립하지 않는다.
pub fn role_managed_jobs(jobs: &[RoleJob], slug: &str) -> Vec<ManagedJob> {
    jobs.iter()
        .map(|job| ManagedJob {
            name: job_name(job.role, slug),
            slug: slug.to_owned(),
            model: job.settings.model.clone(),
            prompt: job.role.prompt().to_owned(),
            interval: job.settings.interval.clone(),
            timeout: job.role.timeout().to_owned(),
            condition: format!("sh {CONDITION_SCRIPT} {}", job.role.as_argument()),
            notify: NOTIFY.to_owned(),
            max_per: job.settings.max_per.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use tempfile::{tempdir, TempDir};

    use super::{job_name, role_managed_jobs, HeartbeatRole, RoleJob, RoleJobSettings};
    use crate::infrastructure::heartbeat_jobs::{
        install_managed_jobs, parse_heartbeat, project_slug, HeartbeatJobsError, MANAGED_END,
        MANAGED_START,
    };

    const PROJECT_ROOT: &str = "/Users/catze/project/workflow-labs";

    fn default_jobs() -> Vec<RoleJob> {
        HeartbeatRole::ALL
            .iter()
            .map(|role| RoleJob {
                role: *role,
                settings: role.default_settings(),
            })
            .collect()
    }

    fn jobs_without(excluded: HeartbeatRole) -> Vec<RoleJob> {
        default_jobs()
            .into_iter()
            .filter(|job| job.role != excluded)
            .collect()
    }

    fn target(directory: &TempDir) -> PathBuf {
        directory.path().join("HEARTBEAT.md")
    }

    fn install(path: &Path, jobs: &[RoleJob]) -> Result<bool, HeartbeatJobsError> {
        let slug = project_slug(Path::new(PROJECT_ROOT));
        install_managed_jobs(path, &role_managed_jobs(jobs, &slug))
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).expect("target file")
    }

    /// SPEC-003 완료 조건 12. 역할 잡만 설치한 결과가 구조 변경 전과 바이트 단위로 같아야 한다.
    /// 이 문자열은 변경 전 코드가 실제로 만든 파일에서 그대로 가져왔다.
    #[test]
    fn role_only_block_matches_the_bytes_written_before_the_split() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);

        assert!(install(&path, &default_jobs()).expect("install"));

        assert_eq!(
            read(&path),
            "<!-- workflow-labs:heartbeat-jobs:start -->\n\
             ## wf-planner-Users-catze-project-workflow-labs\n\
             - slug: -Users-catze-project-workflow-labs\n\
             - model: opus\n\
             - prompt: 기획자 역할로 진행해줘. .workflow의 공통 규칙과 planner 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.\n\
             - interval: 30m\n\
             - timeout: 20m\n\
             - condition: sh .workflow/rules/wf-eligible.sh planner\n\
             - notify: all\n\
             - max_per: 4/24h\n\
             \n\
             ## wf-architect-Users-catze-project-workflow-labs\n\
             - slug: -Users-catze-project-workflow-labs\n\
             - model: opus\n\
             - prompt: 프로젝트 아키텍트 역할로 진행해줘. .workflow의 공통 규칙과 architect 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.\n\
             - interval: 30m\n\
             - timeout: 20m\n\
             - condition: sh .workflow/rules/wf-eligible.sh architect\n\
             - notify: all\n\
             - max_per: 4/24h\n\
             \n\
             ## wf-developer-Users-catze-project-workflow-labs\n\
             - slug: -Users-catze-project-workflow-labs\n\
             - model: opus\n\
             - prompt: 개발자 역할로 진행해줘. .workflow의 공통 규칙과 developer 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.\n\
             - interval: 20m\n\
             - timeout: 30m\n\
             - condition: sh .workflow/rules/wf-eligible.sh developer\n\
             - notify: all\n\
             - max_per: 6/24h\n\
             <!-- workflow-labs:heartbeat-jobs:end -->\n"
        );
    }

    #[test]
    fn creates_file_with_three_role_jobs_at_defaults() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);

        assert!(install(&path, &default_jobs()).expect("install"));

        let contents = read(&path);
        assert_eq!(contents.matches(MANAGED_START).count(), 1);
        assert_eq!(contents.matches(MANAGED_END).count(), 1);

        let document = parse_heartbeat(&contents);
        let names = document
            .jobs
            .iter()
            .map(|job| job.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "wf-planner-Users-catze-project-workflow-labs",
                "wf-architect-Users-catze-project-workflow-labs",
                "wf-developer-Users-catze-project-workflow-labs",
            ]
        );

        let developer = document
            .jobs
            .iter()
            .find(|job| job.name.contains("developer"))
            .expect("developer job");
        assert_eq!(
            developer.field("slug"),
            Some("-Users-catze-project-workflow-labs")
        );
        assert_eq!(developer.field("model"), Some("opus"));
        assert_eq!(developer.field("interval"), Some("20m"));
        assert_eq!(developer.field("timeout"), Some("30m"));
        assert_eq!(developer.field("max_per"), Some("6/24h"));
        assert_eq!(developer.field("notify"), Some("all"));
        assert_eq!(
            developer.field("condition"),
            Some("sh .workflow/rules/wf-eligible.sh developer")
        );
        assert_eq!(
            developer.field("prompt"),
            Some(HeartbeatRole::Developer.prompt())
        );

        let planner = &document.jobs[0];
        assert_eq!(planner.field("interval"), Some("30m"));
        assert_eq!(planner.field("timeout"), Some("20m"));
        assert_eq!(planner.field("max_per"), Some("4/24h"));
    }

    #[test]
    fn appends_block_after_user_jobs_and_preserves_them() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        let original = "# HEARTBEAT\n- tick: 5m\n\n## my-job\n- slug: -tmp-demo\n- prompt: 안녕\n";
        fs::write(&path, original).expect("seed file");

        assert!(install(&path, &default_jobs()).expect("install"));

        let contents = read(&path);
        let start = contents.find(MANAGED_START).expect("start marker");
        assert_eq!(
            &contents[..start],
            "# HEARTBEAT\n- tick: 5m\n\n## my-job\n- slug: -tmp-demo\n- prompt: 안녕\n\n"
        );
        assert!(contents.trim_end().ends_with(MANAGED_END));

        let document = parse_heartbeat(&contents);
        assert_eq!(document.globals, vec![("tick".to_owned(), "5m".to_owned())]);
        assert_eq!(document.jobs.len(), 4);
        assert_eq!(document.jobs[0].name, "my-job");
    }

    #[test]
    fn second_install_with_same_input_does_not_write() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        fs::write(
            &path,
            "- tick: 5m\n\n## my-job\n- slug: -tmp-demo\n- prompt: 안녕\n",
        )
        .expect("seed file");

        assert!(install(&path, &default_jobs()).expect("first install"));
        let first = read(&path);
        assert!(!install(&path, &default_jobs()).expect("second install"));
        assert_eq!(read(&path), first);
    }

    #[test]
    fn toggling_one_role_off_and_on_restores_the_first_install() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        fs::write(&path, "## my-job\n- slug: -tmp-demo\n- prompt: 안녕\n").expect("seed file");

        assert!(install(&path, &default_jobs()).expect("install"));
        let first = read(&path);

        assert!(install(&path, &jobs_without(HeartbeatRole::Architect)).expect("disable"));
        let disabled = read(&path);
        let slug = project_slug(Path::new(PROJECT_ROOT));
        assert!(!disabled.contains(&job_name(HeartbeatRole::Architect, &slug)));
        assert!(disabled.contains(&job_name(HeartbeatRole::Planner, &slug)));
        assert!(disabled.contains(&job_name(HeartbeatRole::Developer, &slug)));
        assert!(disabled.contains("## my-job"));

        assert!(install(&path, &default_jobs()).expect("enable"));
        assert_eq!(read(&path), first);
    }

    #[test]
    fn disabling_every_role_removes_the_whole_block() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        let original = "## my-job\n- slug: -tmp-demo\n- prompt: 안녕\n";
        fs::write(&path, original).expect("seed file");

        assert!(install(&path, &default_jobs()).expect("install"));
        assert!(install(&path, &[]).expect("disable all"));

        let contents = read(&path);
        assert!(!contents.contains(MANAGED_START));
        assert!(!contents.contains(MANAGED_END));
        assert_eq!(contents, original);
        assert!(!install(&path, &[]).expect("disable all again"));
    }

    #[test]
    fn rejects_a_file_with_only_one_marker() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        let original = format!("## my-job\n- slug: -tmp-demo\n\n{MANAGED_START}\n");
        fs::write(&path, &original).expect("seed file");

        let error = install(&path, &default_jobs()).expect_err("must fail");
        assert!(matches!(error, HeartbeatJobsError::Markers { .. }));
        assert_eq!(read(&path), original);
    }

    #[test]
    fn rejects_reversed_markers() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        let original = format!("{MANAGED_END}\n## my-job\n- slug: -tmp-demo\n{MANAGED_START}\n");
        fs::write(&path, &original).expect("seed file");

        let error = install(&path, &default_jobs()).expect_err("must fail");
        assert!(matches!(error, HeartbeatJobsError::MarkerOrder(_)));
        assert_eq!(read(&path), original);
    }

    #[test]
    fn rejects_a_field_line_after_the_end_marker() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        fs::write(&path, "## my-job\n- slug: -tmp-demo\n- prompt: 안녕\n").expect("seed file");
        assert!(install(&path, &default_jobs()).expect("install"));

        let damaged = format!("{}\n- tick: 5m\n", read(&path).trim_end());
        fs::write(&path, &damaged).expect("damage file");

        let error = install(&path, &default_jobs()).expect_err("must fail");
        match error {
            HeartbeatJobsError::AbsorbedLine { line, .. } => assert_eq!(line, "- tick: 5m"),
            other => panic!("unexpected error: {other}"),
        }
        assert_eq!(read(&path), damaged);
    }

    #[test]
    fn rejects_invalid_settings_without_touching_the_file() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        let original = "## my-job\n- slug: -tmp-demo\n";
        fs::write(&path, original).expect("seed file");

        for (field, settings) in [
            (
                "interval",
                RoleJobSettings {
                    model: "opus".to_owned(),
                    interval: "30분".to_owned(),
                    max_per: "4/24h".to_owned(),
                },
            ),
            (
                "max_per",
                RoleJobSettings {
                    model: "opus".to_owned(),
                    interval: "30m".to_owned(),
                    max_per: "4번".to_owned(),
                },
            ),
            (
                "model",
                RoleJobSettings {
                    model: "claude opus".to_owned(),
                    interval: "30m".to_owned(),
                    max_per: "4/24h".to_owned(),
                },
            ),
        ] {
            let jobs = vec![RoleJob {
                role: HeartbeatRole::Planner,
                settings,
            }];
            let error = install(&path, &jobs).expect_err("must fail");
            match error {
                HeartbeatJobsError::InvalidValue { field: actual, .. } => {
                    assert_eq!(actual, field)
                }
                other => panic!("unexpected error: {other}"),
            }
            assert_eq!(read(&path), original);
        }
    }

    #[test]
    fn keeps_carriage_returns_of_the_original_file() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        fs::write(
            &path,
            "- tick: 5m\r\n\r\n## my-job\r\n- slug: -tmp-demo\r\n",
        )
        .expect("seed file");

        assert!(install(&path, &default_jobs()).expect("install"));

        let contents = read(&path);
        assert!(contents.contains("\r\n"));
        assert!(!contents.replace("\r\n", "").contains('\n'));
        assert!(!install(&path, &default_jobs()).expect("second install"));
    }
}
