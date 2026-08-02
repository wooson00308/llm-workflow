//! 하트비트 설정 파일을 읽고 앱 관리 마커 블록만 안전하게 다루는 모듈.
//!
//! 공개 함수는 대상 파일 경로를 인자로 받는다. 홈 디렉터리 해석은 커맨드 계층이 한다.
// 커맨드 계층(TASK-006·TASK-007)이 이 모듈을 호출하기 전까지는 전부 미사용이다. 연결이 끝나면 이 줄을 지운다.
#![allow(dead_code)]

use std::fs;
use std::io::Write;
use std::path::Path;

use tempfile::NamedTempFile;
use thiserror::Error;

pub const MANAGED_START: &str = "<!-- workflow-labs:heartbeat-jobs:start -->";
pub const MANAGED_END: &str = "<!-- workflow-labs:heartbeat-jobs:end -->";

const CONDITION_SCRIPT: &str = ".workflow/rules/wf-eligible.sh";
const NOTIFY: &str = "all";

const PLANNER_PROMPT: &str = "기획자 역할로 진행해줘. .workflow의 공통 규칙과 planner 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.";
const ARCHITECT_PROMPT: &str = "프로젝트 아키텍트 역할로 진행해줘. .workflow의 공통 규칙과 architect 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.";
const DEVELOPER_PROMPT: &str = "개발자 역할로 진행해줘. .workflow의 공통 규칙과 developer 역할 계약을 따르고, 처리할 대상이 없으면 NO_ELIGIBLE_WORK만 보고하고 멈춰.";

#[derive(Debug, Error)]
pub enum HeartbeatJobsError {
    #[error("하트비트 설정 파일을 읽거나 쓰지 못했습니다: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0} 경로가 일반 파일이 아니어서 역할 잡을 설치할 수 없습니다.")]
    NotRegularFile(String),
    #[error("{path}의 앱 관리 블록 마커가 손상되어 파일을 쓰지 않았습니다. 시작 마커 {start}개, 종료 마커 {end}개가 있습니다. 마커를 한 쌍만 남기고 다시 시도하세요.")]
    Markers {
        path: String,
        start: usize,
        end: usize,
    },
    #[error("{0}의 종료 마커가 시작 마커보다 앞에 있어 파일을 쓰지 않았습니다. 마커 순서를 바로잡고 다시 시도하세요.")]
    MarkerOrder(String),
    #[error("{path}의 종료 마커 뒤에 `{line}` 줄이 이어집니다. 이 줄은 관리 블록 마지막 잡의 필드로 흡수되므로 파일을 쓰지 않았습니다. 그 줄을 `## ` 잡 헤더 아래로 옮기거나 지운 뒤 다시 시도하세요.")]
    AbsorbedLine { path: String, line: String },
    #[error("{field} 값 `{value}`의 형식이 올바르지 않아 파일을 쓰지 않았습니다. {expected}")]
    InvalidValue {
        field: &'static str,
        value: String,
        expected: &'static str,
    },
    #[error("임시 파일을 대상 경로로 옮기지 못했습니다: {0}")]
    Persist(String),
}

/// 하트비트 설정 문서에서 읽어 낸 잡 하나.
///
/// `start_line`은 `## ` 헤더 줄의 0-기준 인덱스, `end_line`은 이 잡의 마지막 필드 줄 다음
/// 인덱스다(끝은 포함하지 않는다). 필드가 하나도 없으면 헤더 한 줄만 차지한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeartbeatJob {
    pub name: String,
    pub start_line: usize,
    pub end_line: usize,
    pub fields: Vec<(String, String)>,
}

impl HeartbeatJob {
    pub fn field(&self, key: &str) -> Option<&str> {
        self.fields
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    }
}

/// 하트비트 설정 문서 전체. `globals`는 첫 `## ` 헤더보다 앞에 있는 전역 설정이다.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HeartbeatDocument {
    pub globals: Vec<(String, String)>,
    pub jobs: Vec<HeartbeatJob>,
}

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleJob {
    pub role: HeartbeatRole,
    pub settings: RoleJobSettings,
}

/// 하트비트 파서와 같은 규칙으로 읽는다. 값은 원문 문자열 그대로 보존하고 초 단위로 바꾸지 않는다.
pub fn parse_heartbeat(contents: &str) -> HeartbeatDocument {
    let mut document = HeartbeatDocument::default();
    for (index, raw) in contents.lines().enumerate() {
        let line = raw.trim();
        if let Some(name) = line.strip_prefix("## ") {
            document.jobs.push(HeartbeatJob {
                name: name.trim().to_owned(),
                start_line: index,
                end_line: index + 1,
                fields: Vec::new(),
            });
        } else if let Some(field) = line.strip_prefix("- ") {
            let Some((key, value)) = field.split_once(':') else {
                continue;
            };
            let entry = (key.trim().to_lowercase(), value.trim().to_owned());
            match document.jobs.last_mut() {
                Some(job) => {
                    job.fields.push(entry);
                    job.end_line = index + 1;
                }
                None => document.globals.push(entry),
            }
        }
    }
    document
}

/// 프로젝트 루트 절대 경로의 `/`를 `-`로 바꾸고, 앞이 `-`가 아니면 `-`를 붙인다.
pub fn project_slug(project_root: &Path) -> String {
    let slug = project_root.to_string_lossy().replace('/', "-");
    if slug.starts_with('-') {
        slug
    } else {
        format!("-{slug}")
    }
}

/// slug가 `-`로 시작하므로 결과는 `wf-planner-Users-...` 형태가 된다.
pub fn job_name(role: HeartbeatRole, slug: &str) -> String {
    format!("wf-{}{}", role.as_argument(), slug)
}

/// 활성 역할 잡을 대상 파일의 관리 블록에 기록한다. `jobs`가 비면 블록 전체를 제거한다.
/// 반환값은 파일을 실제로 썼는지 여부다. 내용이 이미 같으면 쓰지 않는다.
pub fn install_role_jobs(
    path: &Path,
    project_root: &Path,
    jobs: &[RoleJob],
) -> Result<bool, HeartbeatJobsError> {
    validate_role_jobs(jobs)?;

    let block = render_block(jobs, &project_slug(project_root));
    let updated = if path.exists() {
        ensure_regular_file(path)?;
        plan_block(path, &fs::read_to_string(path)?, &block)?
    } else if block.is_empty() {
        None
    } else {
        Some(format!("{block}\n"))
    };

    match updated {
        Some(contents) => {
            write_text_atomically(path, &contents)?;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// 설치와 같은 검증만 하고 파일은 쓰지 않는다. 다른 파일을 쓰기 전에 입력값을 거를 때 쓴다.
pub fn validate_role_jobs(jobs: &[RoleJob]) -> Result<(), HeartbeatJobsError> {
    jobs.iter()
        .try_for_each(|job| validate_settings(&job.settings))
}

fn render_block(jobs: &[RoleJob], slug: &str) -> String {
    if jobs.is_empty() {
        return String::new();
    }

    let mut lines = vec![MANAGED_START.to_owned()];
    for (index, job) in jobs.iter().enumerate() {
        if index > 0 {
            lines.push(String::new());
        }
        lines.push(format!("## {}", job_name(job.role, slug)));
        lines.push(format!("- slug: {slug}"));
        lines.push(format!("- model: {}", job.settings.model));
        lines.push(format!("- prompt: {}", job.role.prompt()));
        lines.push(format!("- interval: {}", job.settings.interval));
        lines.push(format!("- timeout: {}", job.role.timeout()));
        lines.push(format!(
            "- condition: sh {CONDITION_SCRIPT} {}",
            job.role.as_argument()
        ));
        lines.push(format!("- notify: {NOTIFY}"));
        lines.push(format!("- max_per: {}", job.settings.max_per));
    }
    lines.push(MANAGED_END.to_owned());
    lines.join("\n")
}

/// 판정을 모두 끝낸 뒤에 쓸 내용을 만든다. 실패하면 호출자는 아무것도 쓰지 않는다.
fn plan_block(
    path: &Path,
    contents: &str,
    block: &str,
) -> Result<Option<String>, HeartbeatJobsError> {
    let starts = contents
        .match_indices(MANAGED_START)
        .map(|(position, _)| position)
        .collect::<Vec<_>>();
    let ends = contents
        .match_indices(MANAGED_END)
        .map(|(position, _)| position)
        .collect::<Vec<_>>();
    let newline = newline_for(contents);

    match (starts.as_slice(), ends.as_slice()) {
        ([], []) => {
            if block.is_empty() {
                return Ok(None);
            }
            Ok(Some(append_block(contents, block, newline)))
        }
        ([start], [end]) if start < end => {
            let end = end + MANAGED_END.len();
            ensure_no_absorbed_line(path, &contents[end..])?;
            let updated = if block.is_empty() {
                remove_block(contents, *start, end, newline)
            } else {
                let rendered = block.replace('\n', newline);
                format!("{}{}{}", &contents[..*start], rendered, &contents[end..])
            };
            if updated == contents {
                Ok(None)
            } else {
                Ok(Some(updated))
            }
        }
        ([_], [_]) => Err(HeartbeatJobsError::MarkerOrder(path.display().to_string())),
        _ => Err(HeartbeatJobsError::Markers {
            path: path.display().to_string(),
            start: starts.len(),
            end: ends.len(),
        }),
    }
}

/// 종료 마커 뒤부터 다음 `## ` 헤더 전까지의 `- ` 줄은 관리 블록 마지막 잡의 필드로 흡수된다.
fn ensure_no_absorbed_line(path: &Path, tail: &str) -> Result<(), HeartbeatJobsError> {
    for raw in tail.lines() {
        let line = raw.trim();
        if line.starts_with("## ") {
            break;
        }
        if line.starts_with("- ") {
            return Err(HeartbeatJobsError::AbsorbedLine {
                path: path.display().to_string(),
                line: line.to_owned(),
            });
        }
    }
    Ok(())
}

fn append_block(contents: &str, block: &str, newline: &str) -> String {
    let rendered = block.replace('\n', newline);
    if contents.is_empty() {
        return format!("{rendered}{newline}");
    }

    let mut updated = contents.to_owned();
    if !updated.ends_with(newline) {
        updated.push_str(newline);
    }
    if !updated.ends_with(&format!("{newline}{newline}")) {
        updated.push_str(newline);
    }
    updated.push_str(&rendered);
    updated.push_str(newline);
    updated
}

/// `append_block`이 넣은 구분 빈 줄과 블록 끝 줄바꿈까지 되돌려 설치 전 내용으로 복원한다.
fn remove_block(contents: &str, start: usize, end: usize, newline: &str) -> String {
    let mut head = &contents[..start];
    let mut tail = &contents[end..];
    if let Some(rest) = tail.strip_prefix(newline) {
        tail = rest;
    }
    let separator = format!("{newline}{newline}");
    if head.ends_with(&separator) {
        head = &head[..head.len() - newline.len()];
    }
    format!("{head}{tail}")
}

fn validate_settings(settings: &RoleJobSettings) -> Result<(), HeartbeatJobsError> {
    if !is_duration(&settings.interval) {
        return Err(HeartbeatJobsError::InvalidValue {
            field: "interval",
            value: settings.interval.clone(),
            expected: "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요. 예: 30m",
        });
    }
    if !is_quota(&settings.max_per) {
        return Err(HeartbeatJobsError::InvalidValue {
            field: "max_per",
            value: settings.max_per.clone(),
            expected: "<횟수>/<기간> 형태로 적어 주세요. 예: 4/24h",
        });
    }
    if !is_model(&settings.model) {
        return Err(HeartbeatJobsError::InvalidValue {
            field: "model",
            value: settings.model.clone(),
            expected: "공백 없는 한 줄 값이어야 합니다. 예: opus",
        });
    }
    Ok(())
}

fn is_duration(value: &str) -> bool {
    match value.strip_suffix(|unit| matches!(unit, 's' | 'm' | 'h' | 'd')) {
        Some(number) => !number.is_empty() && number.chars().all(|digit| digit.is_ascii_digit()),
        None => false,
    }
}

fn is_quota(value: &str) -> bool {
    match value.split_once('/') {
        Some((count, period)) => {
            !count.is_empty()
                && count.chars().all(|digit| digit.is_ascii_digit())
                && is_duration(period)
        }
        None => false,
    }
}

fn is_model(value: &str) -> bool {
    !value.is_empty() && !value.chars().any(char::is_whitespace)
}

fn newline_for(contents: &str) -> &'static str {
    if contents.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn ensure_regular_file(path: &Path) -> Result<(), HeartbeatJobsError> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(HeartbeatJobsError::NotRegularFile(
            path.display().to_string(),
        ));
    }
    Ok(())
}

fn write_text_atomically(path: &Path, value: &str) -> Result<(), HeartbeatJobsError> {
    let parent = path
        .parent()
        .ok_or_else(|| HeartbeatJobsError::Persist(path.display().to_string()))?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(value.as_bytes())?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(path)
        .map_err(|error| HeartbeatJobsError::Persist(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use tempfile::{tempdir, TempDir};

    use super::{
        install_role_jobs, job_name, parse_heartbeat, project_slug, HeartbeatJobsError,
        HeartbeatRole, RoleJob, RoleJobSettings, MANAGED_END, MANAGED_START,
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
        install_role_jobs(path, Path::new(PROJECT_ROOT), jobs)
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).expect("target file")
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

    #[test]
    fn parses_globals_and_jobs_of_a_real_document() {
        let document = parse_heartbeat(
            "# HEARTBEAT\n- tick: 5m\n\n## wf-planner\n- slug: -tmp-demo\n- Model: Opus\n<!-- comment -->\nnoise\n\n## wf-developer\n- prompt: 한 줄: 콜론 포함\n",
        );

        assert_eq!(document.globals, vec![("tick".to_owned(), "5m".to_owned())]);
        assert_eq!(document.jobs.len(), 2);

        let planner = &document.jobs[0];
        assert_eq!(planner.name, "wf-planner");
        assert_eq!(planner.start_line, 3);
        assert_eq!(planner.end_line, 6);
        assert_eq!(planner.field("slug"), Some("-tmp-demo"));
        assert_eq!(planner.field("model"), Some("Opus"));

        let developer = &document.jobs[1];
        assert_eq!(developer.name, "wf-developer");
        assert_eq!(developer.field("prompt"), Some("한 줄: 콜론 포함"));
    }
}
