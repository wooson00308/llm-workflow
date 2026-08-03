//! 하트비트 설정 파일을 읽고 앱 관리 마커 블록만 안전하게 다루는 모듈.
//!
//! 이 모듈은 어떤 연동의 잡인지 모른다. 렌더에 필요한 값이 모두 정해진 `ManagedJob` 목록을 받아
//! 블록 하나를 소유하는 규칙만 지킨다. 잡을 만드는 일은 연동별 모듈이 한다.
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

#[derive(Debug, Error)]
pub enum HeartbeatJobsError {
    #[error("하트비트 설정 파일을 읽거나 쓰지 못했습니다: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0} 경로가 일반 파일이 아니어서 잡을 설치할 수 없습니다.")]
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

/// 관리 블록에 그대로 기록될 잡 하나. 필드 순서가 렌더 순서다.
///
/// 값은 모두 결정된 상태로 들어온다. 이 모듈은 어떤 연동이 만든 값인지 묻지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedJob {
    pub name: String,
    pub slug: String,
    pub model: String,
    pub prompt: String,
    pub interval: String,
    pub timeout: String,
    pub condition: String,
    pub notify: String,
    pub max_per: String,
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

/// 활성 잡을 대상 파일의 관리 블록에 기록한다. `jobs`가 비면 블록 전체를 제거한다.
/// 반환값은 파일을 실제로 썼는지 여부다. 내용이 이미 같으면 쓰지 않는다.
///
/// 목록은 블록에 남길 잡 전체다. 이 함수는 기존 블록에 잡을 덧붙이지 않고 블록을 통째로 다시 쓴다.
pub fn install_managed_jobs(path: &Path, jobs: &[ManagedJob]) -> Result<bool, HeartbeatJobsError> {
    validate_managed_jobs(jobs)?;

    let block = render_block(jobs);
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
pub fn validate_managed_jobs(jobs: &[ManagedJob]) -> Result<(), HeartbeatJobsError> {
    jobs.iter().try_for_each(validate_job)
}

fn render_block(jobs: &[ManagedJob]) -> String {
    if jobs.is_empty() {
        return String::new();
    }

    let mut lines = vec![MANAGED_START.to_owned()];
    for (index, job) in jobs.iter().enumerate() {
        if index > 0 {
            lines.push(String::new());
        }
        lines.push(format!("## {}", job.name));
        lines.push(format!("- slug: {}", job.slug));
        lines.push(format!("- model: {}", job.model));
        lines.push(format!("- prompt: {}", job.prompt));
        lines.push(format!("- interval: {}", job.interval));
        lines.push(format!("- timeout: {}", job.timeout));
        lines.push(format!("- condition: {}", job.condition));
        lines.push(format!("- notify: {}", job.notify));
        lines.push(format!("- max_per: {}", job.max_per));
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

fn validate_job(job: &ManagedJob) -> Result<(), HeartbeatJobsError> {
    if !is_duration(&job.interval) {
        return Err(HeartbeatJobsError::InvalidValue {
            field: "interval",
            value: job.interval.clone(),
            expected: "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요. 예: 30m",
        });
    }
    if !is_quota(&job.max_per) {
        return Err(HeartbeatJobsError::InvalidValue {
            field: "max_per",
            value: job.max_per.clone(),
            expected: "<횟수>/<기간> 형태로 적어 주세요. 예: 4/24h",
        });
    }
    if !is_model(&job.model) {
        return Err(HeartbeatJobsError::InvalidValue {
            field: "model",
            value: job.model.clone(),
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
    use std::path::Path;

    use tempfile::{tempdir, TempDir};

    use super::{install_managed_jobs, parse_heartbeat, ManagedJob, MANAGED_END, MANAGED_START};

    const SLUG: &str = "-tmp-demo";

    fn job(name: &str) -> ManagedJob {
        ManagedJob {
            name: name.to_owned(),
            slug: SLUG.to_owned(),
            model: "opus".to_owned(),
            prompt: "한 줄 프롬프트".to_owned(),
            interval: "30m".to_owned(),
            timeout: "20m".to_owned(),
            condition: "sh check.sh".to_owned(),
            notify: "all".to_owned(),
            max_per: "4/24h".to_owned(),
        }
    }

    fn target(directory: &TempDir) -> std::path::PathBuf {
        directory.path().join("HEARTBEAT.md")
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).expect("target file")
    }

    #[test]
    fn renders_jobs_in_the_given_order_with_a_fixed_field_layout() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);

        assert!(install_managed_jobs(&path, &[job("first"), job("second")]).expect("install"));

        assert_eq!(
            read(&path),
            format!(
                "{MANAGED_START}\n\
                 ## first\n\
                 - slug: -tmp-demo\n\
                 - model: opus\n\
                 - prompt: 한 줄 프롬프트\n\
                 - interval: 30m\n\
                 - timeout: 20m\n\
                 - condition: sh check.sh\n\
                 - notify: all\n\
                 - max_per: 4/24h\n\
                 \n\
                 ## second\n\
                 - slug: -tmp-demo\n\
                 - model: opus\n\
                 - prompt: 한 줄 프롬프트\n\
                 - interval: 30m\n\
                 - timeout: 20m\n\
                 - condition: sh check.sh\n\
                 - notify: all\n\
                 - max_per: 4/24h\n\
                 {MANAGED_END}\n"
            )
        );

        let document = parse_heartbeat(&read(&path));
        let names = document
            .jobs
            .iter()
            .map(|job| job.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["first", "second"]);
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
