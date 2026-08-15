//! 역할 잡(기획자·아키텍트·개발자) 정의. 파일을 읽거나 쓰지 않고 값만 조립한다.
//!
//! 관리 블록에 쓰는 일은 `heartbeat_jobs`가 한다. 이 모듈은 역할 잡을 `ManagedJob`으로 바꿔 넘긴다.
// 커맨드 계층(TASK-006·TASK-007)이 이 모듈을 호출하기 전까지는 전부 미사용이다. 연결이 끝나면 이 줄을 지운다.
#![allow(dead_code)]

use crate::domain::project::JobDefaults;
use crate::infrastructure::heartbeat_condition::CONDITION_SCRIPT;
use crate::infrastructure::heartbeat_jobs::{ManagedJob, MaxPer};

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

    /// 앱 기본값. 언제나 한도가 있는 값이므로 정의를 `JobDefaults` 쪽에 두고 설정을 그것에서
    /// 만든다(SPEC-017 R1). 반대 방향이면 `MaxPer::Unlimited`를 문자열로 바꿀 수 없는 자리가 생긴다.
    pub fn default_settings(self) -> JobDefaults {
        match self {
            Self::Developer => JobDefaults {
                interval: "20m".to_owned(),
                max_per: "6/24h".to_owned(),
                model: "opus".to_owned(),
                timeout: "30m".to_owned(),
            },
            _ => JobDefaults {
                interval: "30m".to_owned(),
                max_per: "4/24h".to_owned(),
                model: "opus".to_owned(),
                timeout: "20m".to_owned(),
            },
        }
    }
}

/// 사용자가 편집할 수 있는 역할 잡 설정.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleJobSettings {
    pub model: String,
    pub interval: String,
    pub max_per: MaxPer,
    pub timeout: String,
}

/// 화면이 보여주는 기본값과 파일에 쓰이는 기본값을 같은 값에서 만든다(R5).
impl From<JobDefaults> for RoleJobSettings {
    fn from(defaults: JobDefaults) -> Self {
        Self {
            model: defaults.model,
            interval: defaults.interval,
            max_per: MaxPer::Limit(defaults.max_per),
            timeout: defaults.timeout,
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

/// 관리 블록에 쓰는 한 줄 조건 명령. 실행 플랫폼에서 그대로 실행 가능한 형태다(R4).
///
/// 경로는 화면이 보여주는 조건 스크립트 경로와 같은 자산 서술(`CONDITION_SCRIPT`)에서 나온다.
/// 두 값이 우연히 같은 문자열인 상태를 없앤 것이 기획서 완료 조건 24다.
///
/// Windows 형태의 근거: `powershell.exe`는 기본 탑재라 사용자가 더 설치할 것이 없고(R1),
/// `-ExecutionPolicy Bypass`는 그 프로세스에만 걸려 시스템 정책을 바꾸지 않으며(D1),
/// `-NoProfile`은 사용자 프로필 스크립트가 판정에 끼어드는 것을 막고, `-File`은 스크립트의 `exit`
/// 코드를 그대로 프로세스 종료 코드로 낸다. 판정 로직은 명령 문자열이 아니라 파일에 있다(D1).
/// 경로 구분자는 두 플랫폼 모두 `/`다 — PowerShell이 `/`를 받고, `relative_path()`가 이미 `/`로만
/// 조립한다(`7b6fc69`).
pub fn condition_command(role_argument: &str) -> String {
    let script = CONDITION_SCRIPT.relative_path();
    if cfg!(windows) {
        format!("powershell -NoProfile -ExecutionPolicy Bypass -File {script} {role_argument}")
    } else {
        format!("sh {script} {role_argument}")
    }
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
            timeout: job.settings.timeout.clone(),
            condition: condition_command(job.role.as_argument()),
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

    use super::{
        condition_command, job_name, role_managed_jobs, HeartbeatRole, RoleJob, RoleJobSettings,
    };
    use crate::infrastructure::heartbeat_condition::{install_condition_script, CONDITION_SCRIPT};
    use crate::infrastructure::heartbeat_jobs::{
        install_managed_jobs, parse_heartbeat, project_slug, HeartbeatJobsError, MaxPer,
        MANAGED_END, MANAGED_START,
    };

    const PROJECT_ROOT: &str = "/Users/catze/project/workflow-labs";

    fn default_jobs() -> Vec<RoleJob> {
        HeartbeatRole::ALL
            .iter()
            .map(|role| RoleJob {
                role: *role,
                settings: role.default_settings().into(),
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
        // 소유 이름은 끈 역할까지 포함한 세 개다. 설치 목록으로 좁히면 역할을 끄는 저장이 그 잡을
        // 남의 잡으로 오인해 되살린다.
        let owned = HeartbeatRole::ALL
            .iter()
            .map(|role| job_name(*role, &slug))
            .collect::<Vec<_>>();
        install_managed_jobs(path, &role_managed_jobs(jobs, &slug), &owned)
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).expect("target file")
    }

    /// 조건 명령은 한 줄이어야 한다(R4). 하트비트 파서가 관리 블록의 값을 줄 단위로 읽는다.
    #[test]
    fn the_condition_command_is_one_line_pointing_at_the_platform_asset() {
        let command = condition_command("developer");

        assert!(!command.contains('\n'));
        assert!(command.contains(&CONDITION_SCRIPT.relative_path()));
        assert!(command.ends_with(" developer"));
        // 경로 구분자는 두 플랫폼 모두 `/`다. `\`가 섞이면 `7b6fc69`가 고친 문제가 되돌아온다.
        assert!(!command.contains('\\'));
    }

    /// 관리 블록에 적히는 값과 화면이 보여주는 경로가 같은 자산 서술에서 나온다(완료 조건 24).
    #[test]
    fn every_role_condition_points_at_the_same_asset_path() {
        let jobs = role_managed_jobs(&default_jobs(), "-demo");

        for job in &jobs {
            assert!(job.condition.contains(&CONDITION_SCRIPT.relative_path()));
        }
    }

    /// 완료 조건 11. 기록된 조건 명령을 셸을 거쳐 프로젝트 루트에서 실행하면 조건 스크립트의 종료
    /// 코드가 그대로 나온다. 하트비트가 `shell=True`로 부르므로 여기서도 셸을 거친다.
    ///
    /// `HeartbeatService::install`을 거치지 않는다 — 그 경로는 TASK-045 전까지 Windows에서 막혀
    /// 있고, 이 확인은 차단 해제와 무관하다.
    fn run_recorded_condition(project_root: &Path, role: &str) -> i32 {
        use std::process::Command;

        let condition = condition_command(role);
        let mut command = if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.arg("/C").arg(&condition);
            command
        } else {
            let mut command = Command::new("sh");
            command.arg("-c").arg(&condition);
            command
        };
        command
            .current_dir(project_root)
            .status()
            .expect("run recorded condition")
            .code()
            .expect("exit code")
    }

    #[test]
    fn the_recorded_condition_returns_the_condition_scripts_exit_code() {
        let root = tempdir().expect("project root");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control root");
        install_condition_script(&control).expect("install condition script");
        let workflow = control.join("wf-demo");
        fs::create_dir_all(workflow.join("tasks")).expect("tasks root");
        fs::create_dir_all(workflow.join("groups")).expect("groups root");
        fs::create_dir_all(workflow.join("decisions")).expect("decisions root");

        fs::write(
            workflow.join("groups/GROUP-DEFAULT.md"),
            "---\nschema: workflow-labs/work-group@1\nid: GROUP-DEFAULT\nstatus: active\nrevision: 1\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\n---\n",
        )
        .expect("active work group");
        fs::write(
            workflow.join("decisions/DECISION-DEFAULT.md"),
            "---\nschema: workflow-labs/decision@1\nid: DECISION-DEFAULT\nspec_id: SPEC-DEFAULT\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-01T00:00:00Z\n---\n",
        )
        .expect("source approval");

        fs::write(
            workflow.join("tasks/TASK-001.md"),
            "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: todo\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\nwork_group_id: GROUP-DEFAULT\nwork_group_revision: 1\n---\n",
        )
        .expect("todo task");
        assert_eq!(run_recorded_condition(root.path(), "developer"), 0);

        fs::write(
            workflow.join("tasks/TASK-001.md"),
            "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: verified\nsource_spec_id: SPEC-DEFAULT\nsource_decision_id: DECISION-DEFAULT\nwork_group_id: GROUP-DEFAULT\nwork_group_revision: 1\n---\n",
        )
        .expect("verified task");
        assert_eq!(run_recorded_condition(root.path(), "developer"), 1);
    }

    /// 조건 줄만 플랫폼별로 갈린다. 나머지 여덟 줄은 두 플랫폼에서 같은 바이트다.
    ///
    /// 리터럴을 각 플랫폼에서 유지하려고 `condition_command`를 부르지 않는다. 제품 코드가 만든
    /// 값을 그대로 되먹이면 바이트 고정이 아니라 항등식이 된다.
    #[cfg(not(windows))]
    fn expected_condition(role: &str) -> String {
        format!("sh .workflow/rules/wf-eligible.sh {role}")
    }

    #[cfg(windows)]
    fn expected_condition(role: &str) -> String {
        format!("powershell -NoProfile -ExecutionPolicy Bypass -File .workflow/rules/wf-eligible.ps1 {role}")
    }

    /// SPEC-003 완료 조건 12. 역할 잡만 설치한 결과가 구조 변경 전과 바이트 단위로 같아야 한다.
    /// 이 문자열은 변경 전 코드가 실제로 만든 파일에서 그대로 가져왔다. 조건 줄은 자산이 플랫폼별로
    /// 갈린 뒤(SPEC-015 R2·R4) 플랫폼마다 다른 리터럴을 갖는다.
    #[test]
    fn role_only_block_matches_the_bytes_written_before_the_split() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);

        assert!(install(&path, &default_jobs()).expect("install"));

        let planner = expected_condition("planner");
        let architect = expected_condition("architect");
        let developer = expected_condition("developer");
        assert_eq!(
            read(&path),
            format!(
                "<!-- workflow-labs:heartbeat-jobs:start -->\n\
             ## wf-planner-Users-catze-project-workflow-labs\n\
             - slug: -Users-catze-project-workflow-labs\n\
             - model: opus\n\
             - prompt: 기획자 역할로 진행해줘. .workflow의 공통 규칙과 planner 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.\n\
             - interval: 30m\n\
             - timeout: 20m\n\
             - condition: {planner}\n\
             - notify: all\n\
             - max_per: 4/24h\n\
             \n\
             ## wf-architect-Users-catze-project-workflow-labs\n\
             - slug: -Users-catze-project-workflow-labs\n\
             - model: opus\n\
             - prompt: 프로젝트 아키텍트 역할로 진행해줘. .workflow의 공통 규칙과 architect 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.\n\
             - interval: 30m\n\
             - timeout: 20m\n\
             - condition: {architect}\n\
             - notify: all\n\
             - max_per: 4/24h\n\
             \n\
             ## wf-developer-Users-catze-project-workflow-labs\n\
             - slug: -Users-catze-project-workflow-labs\n\
             - model: opus\n\
             - prompt: 개발자 역할로 진행해줘. .workflow의 공통 규칙과 developer 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.\n\
             - interval: 20m\n\
             - timeout: 30m\n\
             - condition: {developer}\n\
             - notify: all\n\
             - max_per: 6/24h\n\
             <!-- workflow-labs:heartbeat-jobs:end -->\n"
            )
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
            Some(expected_condition("developer").as_str())
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
                    max_per: MaxPer::Limit("4/24h".to_owned()),
                    timeout: "20m".to_owned(),
                },
            ),
            (
                "max_per",
                RoleJobSettings {
                    model: "opus".to_owned(),
                    interval: "30m".to_owned(),
                    max_per: MaxPer::Limit("4번".to_owned()),
                    timeout: "20m".to_owned(),
                },
            ),
            (
                "model",
                RoleJobSettings {
                    model: "claude opus".to_owned(),
                    interval: "30m".to_owned(),
                    max_per: MaxPer::Limit("4/24h".to_owned()),
                    timeout: "20m".to_owned(),
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
