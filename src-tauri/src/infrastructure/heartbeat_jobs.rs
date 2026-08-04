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
use std::path::{Path, PathBuf};

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

/// 잡 하나의 실행 한도. `Unlimited`는 관리 블록에 `max_per` 줄을 쓰지 않는다는 뜻이다(R2).
/// 데몬이 줄 없는 잡을 한도 없는 잡으로 다루므로 새 표기를 만들지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MaxPer {
    Unlimited,
    Limit(String),
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
    pub max_per: MaxPer,
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

/// 프로젝트 루트 절대 경로의 경로 구분자(`/`·`\`)와 드라이브 콜론(`:`)을 `-`로 바꾸고,
/// 앞이 `-`가 아니면 `-`를 붙인다. 슬러그는 jobs.d 파일명이 되므로 파일명에 못 쓰는
/// 문자가 남으면 Windows에서 쓰기가 `InvalidFilename`으로 실패한다. macOS·Linux 절대
/// 경로에는 `\`·`:`가 나타나지 않아 기존 슬러그는 이 치환으로 달라지지 않는다.
pub fn project_slug(project_root: &Path) -> String {
    let slug = project_root
        .to_string_lossy()
        .replace(['/', '\\', ':'], "-");
    if slug.starts_with('-') {
        slug
    } else {
        format!("-{slug}")
    }
}

/// 활성 잡을 대상 파일의 관리 블록에 기록한다. 블록에 남길 잡이 하나도 없으면 블록 전체를 제거한다.
/// 반환값은 파일을 실제로 썼는지 여부다. 내용이 이미 같으면 쓰지 않는다.
///
/// 이 함수는 블록을 통째로 다시 쓴다. `jobs`는 호출자가 이번에 남길 잡 전체이고, `owned`는 호출자가
/// 소유하는 잡 이름 전체다. 두 목록을 나누는 이유는 끈 잡과 남의 잡을 구별하기 위해서다. `owned`에
/// 있으나 `jobs`에 없는 잡은 이번 저장이 끈 잡이라 지우고, 둘 중 어디에도 없는 잡은 이 파일을 함께
/// 쓰는 다른 호출자의 것이라 원문 그대로 남긴다(SPEC-022 R1).
pub fn install_managed_jobs(
    path: &Path,
    jobs: &[ManagedJob],
    owned: &[String],
) -> Result<bool, HeartbeatJobsError> {
    validate_managed_jobs(jobs)?;

    let updated = if path.exists() {
        ensure_regular_file(path)?;
        let contents = fs::read_to_string(path)?;
        let block = render_block(jobs, &foreign_job_texts(&contents, owned));
        plan_block(path, &contents, &block)?
    } else if jobs.is_empty() {
        None
    } else {
        Some(format!("{}\n", render_block(jobs, &[])))
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

/// 이 프로젝트의 잡 파일 경로. 하트비트 홈 아래 `heartbeat/jobs.d/<slug>.md`다(SPEC-024 확인 사실 17).
///
/// **경로 정의는 이 함수 하나뿐이다.** 같은 경로를 여러 상수로 흩어 두면 화면이 가리키는 파일과
/// 실제로 쓰는 파일이 갈라진다. 옛 경로에서 그 사고가 이미 났다(SPEC-024 확인 사실 11).
pub fn project_jobs_path(heartbeat_home: &Path, slug: &str) -> PathBuf {
    heartbeat_home
        .join("heartbeat")
        .join("jobs.d")
        .join(format!("{slug}.md"))
}

/// 이 프로젝트의 잡 파일 하나를 통째로 쓴다. 반환값은 파일을 실제로 썼는지 여부다.
///
/// 파일 전체가 앱 소유이므로 마커도, 부분 교체도, 남의 잡 보존도 없다. 계약이 한 파일을 여러
/// 도구가 나눠 쓰는 구조를 지원하지 않는다고 명시하고 있어(SPEC-024 확인 사실 12) 그 전제 자체가
/// 이 경로에는 서지 않는다. 사용자가 손으로 고친 값을 지키는 방어는 저장 직전 baseline 대조이고,
/// 그것은 서비스의 몫이다(R6).
///
/// 잡이 하나도 남지 않으면 파일을 지운다. 빈 파일을 남기지 않는 이유는 R2가 "파일이 없는 상태는
/// 잡이 없는 것으로 읽는다"고 정했기 때문이다. 없는 파일이 곧 잡 없음의 정규 표현이다.
///
/// 줄바꿈은 언제나 `\n`으로 쓴다. 마커 블록 쓰기는 남의 줄바꿈 표기를 따라가야 했지만 이 파일에는
/// 따라갈 남이 없다. 표기를 하나로 고정해야 같은 저장을 두 번 했을 때 두 번째가 쓰지 않는다.
pub fn write_project_jobs(path: &Path, jobs: &[ManagedJob]) -> Result<bool, HeartbeatJobsError> {
    validate_managed_jobs(jobs)?;

    let existing = if path.exists() {
        ensure_regular_file(path)?;
        Some(fs::read_to_string(path)?)
    } else {
        None
    };

    if jobs.is_empty() {
        if existing.is_none() {
            return Ok(false);
        }
        fs::remove_file(path)?;
        return Ok(true);
    }

    let contents = format!("{}\n", render_jobs(jobs).join("\n"));
    if existing.as_deref() == Some(contents.as_str()) {
        return Ok(false);
    }

    // 디렉터리는 쓰는 쪽이 만든다(계약 19~21줄, SPEC-024 확인 사실 15).
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    write_text_atomically(path, &contents)?;
    Ok(true)
}

/// `preserved`는 블록에 있던 다른 호출자의 잡 원문이다. 해석하지 않고 이 호출자의 잡 뒤에 그대로
/// 잇는다. 순서 규칙이 "내 잡 다음 남의 잡"으로 고정이라 같은 저장을 두 번 해도 자리가 흔들리지
/// 않는다(SPEC-022 R5).
fn render_block(jobs: &[ManagedJob], preserved: &[String]) -> String {
    if jobs.is_empty() && preserved.is_empty() {
        return String::new();
    }

    let mut lines = vec![MANAGED_START.to_owned()];
    lines.extend(render_jobs(jobs));
    for text in preserved {
        // 시작 마커 바로 다음이 아닐 때만 구분 빈 줄을 넣는다. 이 호출자의 잡 사이 규칙과 같다.
        if lines.len() > 1 {
            lines.push(String::new());
        }
        lines.push(text.clone());
    }
    lines.push(MANAGED_END.to_owned());
    lines.join("\n")
}

/// 잡 목록을 계약의 잡 문법(계약 23~40줄)으로 옮긴 줄들. 잡 사이는 빈 줄 하나로 나눈다.
///
/// 마커 블록 쓰기와 프로젝트 파일 쓰기가 이 함수를 나눠 쓴다. 두 대상의 차이는 감싸는 것뿐이고
/// 잡을 적는 방법은 하나여야 한다. 그래서 렌더를 여기 한 곳에만 둔다.
fn render_jobs(jobs: &[ManagedJob]) -> Vec<String> {
    let mut lines = Vec::new();
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
        // 제한 없음은 줄 자체를 쓰지 않는다. 나머지 여덟 줄의 내용과 순서는 그대로다(R2).
        if let MaxPer::Limit(value) = &job.max_per {
            lines.push(format!("- max_per: {value}"));
        }
    }
    lines
}

/// 블록 안에서 `owned`에 없는 잡의 원문. 이름만 보고 가려내며 내용은 한 글자도 해석하지 않는다.
///
/// 렌더러를 통과시키면 이 모듈이 모르는 필드·다른 순서·다른 표기가 사라지고, 검증을 걸면 남의 잡
/// 값 하나가 이 호출자의 저장을 영구히 막는다. 그래서 문자열로만 옮긴다(SPEC-022 R1·R2).
fn foreign_job_texts(contents: &str, owned: &[String]) -> Vec<String> {
    let Some(interior) = managed_block_interior(contents) else {
        return Vec::new();
    };
    let lines = interior.lines().collect::<Vec<_>>();
    let jobs = parse_heartbeat(interior).jobs;
    jobs.iter()
        .enumerate()
        .filter(|(_, job)| !owned.contains(&job.name))
        .map(|(index, job)| {
            // 구간은 다음 잡 헤더 직전까지다. `end_line`으로 자르면 필드로 읽히지 않는 줄이
            // 잘려 나가므로, 원문 보존이 목적인 여기서는 헤더 사이를 통째로 가져간다.
            let end = jobs
                .get(index + 1)
                .map_or(lines.len(), |next| next.start_line);
            let mut span = &lines[job.start_line..end];
            while span.last().is_some_and(|line| line.trim().is_empty()) {
                span = &span[..span.len() - 1];
            }
            span.join("\n")
        })
        .collect()
}

/// 마커 한 쌍 사이의 원문. 마커가 한 쌍이 아니거나 순서가 뒤바뀐 파일은 `plan_block`이 거부하므로,
/// 여기서도 보존 대상을 찾지 않고 비운다.
fn managed_block_interior(contents: &str) -> Option<&str> {
    let mut starts = contents.match_indices(MANAGED_START).map(|(at, _)| at);
    let mut ends = contents.match_indices(MANAGED_END).map(|(at, _)| at);
    let (start, end) = (starts.next()?, ends.next()?);
    if starts.next().is_some() || ends.next().is_some() {
        return None;
    }
    let body = start + MANAGED_START.len();
    if body > end {
        return None;
    }
    Some(&contents[body..end])
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
    if !is_duration(&job.timeout) {
        return Err(HeartbeatJobsError::InvalidValue {
            field: "timeout",
            value: job.timeout.clone(),
            expected: "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요. 예: 20m",
        });
    }
    // 제한 없음에는 검사할 값이 없다. 줄을 쓰지 않는 것이 곧 그 상태다.
    if let MaxPer::Limit(value) = &job.max_per {
        if let Err(rejection) = check_quota(value) {
            return Err(HeartbeatJobsError::InvalidValue {
                field: "max_per",
                value: value.clone(),
                expected: match rejection {
                    QuotaRejection::Format => QUOTA_FORMAT_MESSAGE,
                    QuotaRejection::Ignored => QUOTA_IGNORED_MESSAGE,
                },
            });
        }
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

/// `max_per` 하나를 읽어 낸 값. `window`는 파일에 적힌 기간 원문(`24h`)이라 화면이 초를 다시
/// 문자열로 만들지 않아도 된다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Quota {
    pub count: u64,
    pub window_seconds: u64,
    pub window: String,
}

/// 기간 값을 초로 바꾼다. 형식이 계약과 다르거나 초 단위로 표현할 수 없으면 `None`이다.
pub fn parse_duration(value: &str) -> Option<u64> {
    let unit = value.chars().last()?;
    let multiplier = match unit {
        's' => 1,
        'm' => 60,
        'h' => 3600,
        'd' => 86400,
        _ => return None,
    };
    let number = value.strip_suffix(unit)?;
    if number.is_empty() || !number.chars().all(|digit| digit.is_ascii_digit()) {
        return None;
    }
    number.parse::<u64>().ok()?.checked_mul(multiplier)
}

/// 한도 값이 거부되는 이유(R4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuotaRejection {
    /// `<횟수>/<기간>` 형태가 아니다.
    Format,
    /// 형태는 맞지만 횟수가 0이거나 기간이 0초다. 데몬이 한도로 인정하지 않아 결과가 무제한이 된다.
    Ignored,
}

const QUOTA_FORMAT_MESSAGE: &str = "<횟수>/<기간> 형태로 적어 주세요. 예: 4/24h";

/// 0 이하 값의 거부 문구(R4). 이 값의 위험은 형식이 틀린 것이 아니라 의도와 정반대로 동작한다는
/// 데 있으므로, 사용자가 원했을 두 경로(잡 끄기·제한 없음)를 함께 밝힌다.
const QUOTA_IGNORED_MESSAGE: &str = "횟수는 1 이상, 기간은 1초 이상이어야 합니다. 하트비트는 0을 한도로 인정하지 않아, 이 값을 쓰면 잡이 멈추는 대신 오히려 제한 없이 실행됩니다. 이 잡을 돌리고 싶지 않다면 잡을 끄고, 한도 없이 돌리려면 실행 한도를 제한 없음으로 지정하세요.";

/// `<횟수>/<기간>`을 읽고 거부 사유를 함께 돌려준다. 판정 규칙은 이 함수에만 있다.
///
/// 형식을 통과한 뒤에도 횟수가 0이거나 기간이 0초면 거부한다. 데몬의 `_parse_max_per`가 그 값을
/// 한도로 인정하지 않아 결과가 무제한이 되기 때문이다(R4).
pub fn check_quota(value: &str) -> Result<Quota, QuotaRejection> {
    let (count, window) = value.split_once('/').ok_or(QuotaRejection::Format)?;
    if count.is_empty() || !count.chars().all(|digit| digit.is_ascii_digit()) {
        return Err(QuotaRejection::Format);
    }
    let count = count.parse::<u64>().map_err(|_| QuotaRejection::Format)?;
    let window_seconds = parse_duration(window).ok_or(QuotaRejection::Format)?;
    if count == 0 || window_seconds == 0 {
        return Err(QuotaRejection::Ignored);
    }
    Ok(Quota {
        count,
        window_seconds,
        window: window.to_owned(),
    })
}

/// `<횟수>/<기간>`을 읽는다. 하트비트가 한도로 인정하지 않는 값은 모두 `None`이고, 그 `None`이
/// "한도 없음"이다. 거부 사유가 필요하면 `check_quota`를 쓴다.
pub fn parse_quota(value: &str) -> Option<Quota> {
    check_quota(value).ok()
}

fn is_duration(value: &str) -> bool {
    parse_duration(value).is_some()
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

    use super::{
        check_quota, install_managed_jobs, parse_duration, parse_heartbeat, parse_quota,
        project_jobs_path, project_slug, write_project_jobs, HeartbeatJobsError, ManagedJob,
        MaxPer, Quota, QuotaRejection, MANAGED_END, MANAGED_START,
    };

    const SLUG: &str = "-tmp-demo";

    #[test]
    fn a_windows_style_path_makes_a_filename_safe_slug() {
        // 슬러그는 jobs.d 파일명이 된다. 드라이브 콜론·역슬래시가 남으면 Windows 쓰기가
        // InvalidFilename으로 실패한다(v0.1.8 CI에서 실측). 문자열 치환이라 어느 OS에서든 돈다.
        assert_eq!(
            project_slug(Path::new("C:\\Users\\tester\\project")),
            "-C--Users-tester-project"
        );
        assert_eq!(
            project_slug(Path::new("/Users/tester/project")),
            "-Users-tester-project"
        );
    }

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
            max_per: MaxPer::Limit("4/24h".to_owned()),
        }
    }

    fn target(directory: &TempDir) -> std::path::PathBuf {
        directory.path().join("HEARTBEAT.md")
    }

    /// 이 모듈의 시험 파일에는 다른 호출자의 잡이 없다. 소유 이름 집합은 언제나 설치 목록과 같다.
    fn install(path: &Path, jobs: &[ManagedJob]) -> Result<bool, HeartbeatJobsError> {
        let owned = jobs.iter().map(|job| job.name.clone()).collect::<Vec<_>>();
        install_managed_jobs(path, jobs, &owned)
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).expect("target file")
    }

    #[test]
    fn renders_jobs_in_the_given_order_with_a_fixed_field_layout() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);

        assert!(install(&path, &[job("first"), job("second")]).expect("install"));

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

    #[test]
    fn durations_are_read_as_seconds() {
        assert_eq!(parse_duration("30s"), Some(30));
        assert_eq!(parse_duration("30m"), Some(1_800));
        assert_eq!(parse_duration("24h"), Some(86_400));
        assert_eq!(parse_duration("2d"), Some(172_800));
        assert_eq!(parse_duration("0s"), Some(0));
    }

    #[test]
    fn a_malformed_duration_has_no_value() {
        for value in [
            "", "30", "m", "30x", "30 m", "-30m", "3.5m", "삼십m", "30분",
        ] {
            assert_eq!(parse_duration(value), None, "duration `{value}`");
        }
    }

    /// 곱셈이 넘치는 값은 초로 표현할 수 없다.
    #[test]
    fn an_overflowing_duration_has_no_value() {
        assert_eq!(parse_duration("99999999999999999999s"), None);
        assert_eq!(parse_duration("9999999999999999d"), None);
    }

    /// 화면이 초를 다시 문자열로 만들지 않도록 기간 원문을 그대로 돌려준다.
    #[test]
    fn a_quota_carries_the_count_the_window_seconds_and_the_window_text() {
        assert_eq!(
            parse_quota("6/24h"),
            Some(Quota {
                count: 6,
                window_seconds: 86_400,
                window: "24h".to_owned(),
            })
        );
        // 경계값. 횟수 1과 기간 1초는 데몬이 한도로 인정한다.
        assert_eq!(
            parse_quota("1/1s"),
            Some(Quota {
                count: 1,
                window_seconds: 1,
                window: "1s".to_owned(),
            })
        );
    }

    #[test]
    fn a_malformed_quota_has_no_value() {
        for value in [
            "",
            "6",
            "6/24",
            "6/24x",
            "/24h",
            "6/",
            "6/24h/2",
            "여섯/24h",
        ] {
            assert_eq!(parse_quota(value), None, "quota `{value}`");
        }
    }

    /// R4. 데몬이 한도로 인정하지 않는 값도 `parse_quota`에서 값이 없다. 앱과 데몬의 판정이 같다.
    #[test]
    fn a_quota_the_daemon_ignores_has_no_value_either() {
        for value in ["0/24h", "0/1s", "4/0h", "4/0m"] {
            assert_eq!(parse_quota(value), None, "quota `{value}`");
        }
    }

    /// R4. 거부 사유는 둘로 갈린다. 사용자가 할 일이 다르다.
    /// `4/0h`는 `parse_duration("0h")`이 `Some(0)`이라 형식은 맞고 `Ignored`다.
    #[test]
    fn the_rejection_reason_separates_a_broken_format_from_an_ignored_value() {
        for value in ["0/24h", "0/1s", "4/0h", "4/0m"] {
            assert_eq!(
                check_quota(value).unwrap_err(),
                QuotaRejection::Ignored,
                "quota `{value}`"
            );
        }
        for value in ["4번", "4/24", "/24h", "여섯/24h"] {
            assert_eq!(
                check_quota(value).unwrap_err(),
                QuotaRejection::Format,
                "quota `{value}`"
            );
        }
    }

    /// 검증은 파서 위에 얹혔을 뿐 거부하던 값은 계속 거부한다.
    #[test]
    fn a_malformed_quota_is_still_rejected_without_writing_the_file() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        let mut broken = job("first");
        broken.max_per = MaxPer::Limit("6/24".to_owned());

        let error = install(&path, &[broken]).expect_err("must fail");

        assert!(matches!(
            error,
            HeartbeatJobsError::InvalidValue {
                field: "max_per",
                ..
            }
        ));
        assert_eq!(
            error.to_string(),
            "max_per 값 `6/24`의 형식이 올바르지 않아 파일을 쓰지 않았습니다. <횟수>/<기간> 형태로 적어 주세요. 예: 4/24h"
        );
        assert!(!path.exists());
    }

    /// 기간 검증도 같은 파서를 쓴다. 거부 문구는 그대로다.
    #[test]
    fn a_malformed_interval_is_still_rejected_without_writing_the_file() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        let mut broken = job("first");
        broken.interval = "30분".to_owned();

        let error = install(&path, &[broken]).expect_err("must fail");

        assert_eq!(
            error.to_string(),
            "interval 값 `30분`의 형식이 올바르지 않아 파일을 쓰지 않았습니다. 숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요. 예: 30m"
        );
        assert!(!path.exists());
    }

    /// R2. 제한 없음인 잡에는 한도 줄이 없다. 나머지 여덟 줄은 한도가 있을 때와 같다.
    #[test]
    fn an_unlimited_job_is_written_without_the_quota_line() {
        let directory = tempdir().expect("temporary directory");
        let limited = target(&directory);
        let unlimited = directory.path().join("UNLIMITED.md");
        let mut without_limit = job("first");
        without_limit.max_per = MaxPer::Unlimited;

        assert!(install(&limited, &[job("first")]).expect("limited"));
        assert!(install(&unlimited, &[without_limit]).expect("unlimited"));

        assert_eq!(
            read(&unlimited),
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
                 {MANAGED_END}\n"
            )
        );
        // 한도 줄 하나만 다르다. 나머지는 바이트 단위로 같다.
        assert_eq!(
            read(&limited).replace("- max_per: 4/24h\n", ""),
            read(&unlimited)
        );

        // 되읽으면 그 잡에 한도 필드가 없다. 데몬도 이 상태를 한도 없음으로 읽는다.
        let document = parse_heartbeat(&read(&unlimited));
        assert_eq!(document.jobs.len(), 1);
        assert_eq!(document.jobs[0].field("max_per"), None);
        assert_eq!(document.jobs[0].fields.len(), 7);
    }

    /// R4. 데몬이 무시하는 값은 형식 오류와 다른 문구로 거부한다. 잡 끄기와 제한 없음의 차이가
    /// 문구에 드러나야 한다(기획서 완료 조건 8).
    #[test]
    fn an_ignored_quota_is_rejected_with_a_message_naming_both_escape_routes() {
        let directory = tempdir().expect("temporary directory");

        for (index, value) in ["0/24h", "4/0h"].into_iter().enumerate() {
            let path = directory.path().join(format!("IGNORED-{index}.md"));
            let mut broken = job("first");
            broken.max_per = MaxPer::Limit(value.to_owned());

            let error = install(&path, &[broken]).expect_err("must fail");

            let message = error.to_string();
            assert!(message.contains(value), "{message}");
            assert!(message.contains("제한 없이 실행됩니다"), "{message}");
            assert!(message.contains("잡을 끄고"), "{message}");
            assert!(message.contains("제한 없음으로 지정"), "{message}");
            assert!(!path.exists());
        }
    }

    /// 임시 디렉터리를 하트비트 홈으로 삼은 이 프로젝트의 잡 파일 경로.
    fn project_target(directory: &TempDir) -> std::path::PathBuf {
        project_jobs_path(directory.path(), SLUG)
    }

    /// R1. 경로 정의는 이 함수 하나뿐이므로 그 모양을 여기서 고정한다(확인 사실 17).
    #[test]
    fn the_project_job_file_lives_in_jobs_d_under_the_heartbeat_home() {
        assert_eq!(
            project_jobs_path(Path::new("/tmp/home"), "-tmp-demo"),
            Path::new("/tmp/home/heartbeat/jobs.d/-tmp-demo.md")
        );
    }

    /// R1. 파일 전체가 앱 소유라 마커가 없다. 잡 문법은 계약 23~40줄 그대로이고, 제한 없음인 잡만
    /// 한도 줄이 빠진다.
    #[test]
    fn a_project_file_holds_only_the_contract_job_syntax() {
        let directory = tempdir().expect("temporary directory");
        let path = project_target(&directory);
        let mut unlimited = job("second");
        unlimited.max_per = MaxPer::Unlimited;

        assert!(write_project_jobs(&path, &[job("first"), unlimited]).expect("write"));

        assert_eq!(
            read(&path),
            "## first\n\
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
             - notify: all\n"
        );

        let document = parse_heartbeat(&read(&path));
        assert!(document.globals.is_empty());
        assert_eq!(document.jobs.len(), 2);
        assert_eq!(document.jobs[0].fields.len(), 8);
        assert_eq!(document.jobs[0].field("max_per"), Some("4/24h"));
        assert_eq!(document.jobs[1].fields.len(), 7);
        assert_eq!(document.jobs[1].field("max_per"), None);
    }

    /// 잡을 적는 방법이 두 대상에서 갈라지지 않는다. 마커 블록의 속과 프로젝트 파일이 같은 렌더다.
    #[test]
    fn both_writes_render_the_same_job_lines() {
        let directory = tempdir().expect("temporary directory");
        let block = target(&directory);
        let project = project_target(&directory);
        let jobs = [job("first"), job("second")];

        assert!(install(&block, &jobs).expect("block"));
        assert!(write_project_jobs(&project, &jobs).expect("project"));

        let interior = read(&block)
            .replace(&format!("{MANAGED_START}\n"), "")
            .replace(&format!("{MANAGED_END}\n"), "");
        assert_eq!(interior, read(&project));
    }

    /// 확인 사실 15. 디렉터리는 쓰는 쪽이 만든다. `jobs.d`가 없는 홈에서도 저장이 성립한다.
    #[test]
    fn a_missing_jobs_d_directory_is_created_by_the_write() {
        let directory = tempdir().expect("temporary directory");
        let path = project_target(&directory);
        assert!(!path.parent().expect("parent").exists());

        assert!(write_project_jobs(&path, &[job("first")]).expect("write"));

        assert!(path.exists());
    }

    /// R7. 같은 저장을 두 번 해도 파일이 다시 쓰이지 않는다.
    #[test]
    fn writing_the_same_list_twice_does_not_write_the_second_time() {
        let directory = tempdir().expect("temporary directory");
        let path = project_target(&directory);

        assert!(write_project_jobs(&path, &[job("first")]).expect("first write"));
        let written = read(&path);

        assert!(!write_project_jobs(&path, &[job("first")]).expect("second write"));
        assert_eq!(read(&path), written);
    }

    /// R2. 잡이 하나도 남지 않으면 빈 파일 대신 없는 파일이 된다. 없는 파일에 빈 목록은 무동작이다.
    #[test]
    fn an_empty_list_removes_the_file_and_leaves_a_missing_file_alone() {
        let directory = tempdir().expect("temporary directory");
        let path = project_target(&directory);

        assert!(!write_project_jobs(&path, &[]).expect("nothing to remove"));
        assert!(!path.exists());

        assert!(write_project_jobs(&path, &[job("first")]).expect("write"));
        assert!(write_project_jobs(&path, &[]).expect("remove"));
        assert!(!path.exists());
    }

    /// 검증에 걸린 요청은 파일을 만들지도, 이미 있는 파일을 고치지도 않는다.
    #[test]
    fn a_rejected_job_leaves_the_project_file_untouched() {
        let directory = tempdir().expect("temporary directory");
        let path = project_target(&directory);
        let mut broken = job("first");
        broken.max_per = MaxPer::Limit("6/24".to_owned());

        let error = write_project_jobs(&path, &[broken.clone()]).expect_err("must fail");
        assert!(matches!(
            error,
            HeartbeatJobsError::InvalidValue {
                field: "max_per",
                ..
            }
        ));
        assert!(!path.exists());

        assert!(write_project_jobs(&path, &[job("first")]).expect("write"));
        let written = read(&path);
        write_project_jobs(&path, &[broken]).expect_err("must fail");
        assert_eq!(read(&path), written);
    }

    /// 대상이 일반 파일이 아니면 블록 쓰기와 같은 오류로 거부한다. 지우는 저장도 마찬가지다.
    #[test]
    fn a_project_path_that_is_not_a_regular_file_is_rejected() {
        let directory = tempdir().expect("temporary directory");
        let path = project_target(&directory);
        fs::create_dir_all(&path).expect("directory in place of the file");

        for jobs in [vec![job("first")], Vec::new()] {
            let error = write_project_jobs(&path, &jobs).expect_err("must fail");
            assert!(matches!(error, HeartbeatJobsError::NotRegularFile(_)));
        }
        assert!(path.is_dir());
    }
}
