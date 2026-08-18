//! 실행 도구별 사용 한도 보류 기록.
//!
//! **기록은 기기 단위다.** 사용 한도는 계정과 실행 도구에 걸리므로, 같은 도구를 쓰는 다른 프로젝트도
//! 같은 보류를 읽어야 한다. 그래서 기록의 자리는 프로젝트 안이 아니라 보류 기록 루트 아래
//! `provider-holds/<실행 도구 이름>.yml` 하나다. 루트 경로는 인자로 받는다. 홈 해석은 커맨드 계층이
//! 하고 이 모듈은 환경 변수로 홈을 찾지 않는다.
//!
//! **확인 실패는 보류가 아니다.** 파일이 없거나 형식이 깨졌거나 디렉터리를 읽지 못하면 보류 없음으로
//! 답하고 오류로 올리지 않는다. 읽지 못한 것을 보류로 바꾸면 입출력 오류 한 번이 배정을 통째로
//! 멈춘다.
//!
//! **기록을 쓰지 않는 조건은 이 모듈이 판정한다.** 화면이 2.5초마다 같은 실행 행을 다시 보내므로,
//! 같은 행으로 보류를 무한히 연장하지 않는 규칙이 부르는 쪽이 아니라 여기 있어야 한다.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde::Deserialize;

use crate::domain::agent_runtime::{ProviderHold, RunSummary};

/// 보류 기록 루트 아래에서 기록들이 놓이는 디렉터리 이름.
const HOLD_DIRECTORY: &str = "provider-holds";

/// 기록 규격 버전. 기록을 나중에 읽는 쪽이 형태를 판단하는 값이다.
const SCHEMA_VERSION: u32 = 1;

/// 기록이 쓰는 시각 표기. 조건 검사 스크립트가 이 형식만 비교하므로 오프셋 표기와 소수 초를 쓰지 않는다.
const STAMP: &str = "%Y-%m-%dT%H:%M:%SZ";

/// 해제 예정 시각이 오지 않았을 때 기다리는 시간.
const DEFAULT_HOLD_HOURS: i64 = 1;

/// 기록 본문. 필드 순서가 곧 파일에 적히는 여섯 줄의 순서다.
#[derive(Debug, Deserialize)]
struct HoldRecord {
    resume_at: String,
    resume_at_known: bool,
    run_id: String,
}

/// 한도 도달로 끝난 실행 하나를 보류 기록으로 남긴다.
///
/// 다음 가운데 하나라도 해당하면 파일을 만들지 않는다. 쓸 수 없는 실행 도구 이름, 재개 시각을 정할
/// 수 없는 행, 이미 지난 재개 시각, 그리고 같은 실행으로 이미 남긴 기록이다. 쓰기에 실패해도
/// 오류를 올리지 않는다. 보류를 남기지 못한 것이 실행 목록 조회를 실패로 만들지는 않기 때문이다.
pub fn record(root: &Path, run: &RunSummary, now: DateTime<Utc>) {
    let Some(path) = hold_path(root, &run.provider) else {
        return;
    };
    let Some((resume_at, resume_at_known)) = resume_at(run) else {
        return;
    };
    if resume_at <= now {
        return;
    }
    if read_record(&path).is_some_and(|record| record.run_id == run.run_id) {
        return;
    }
    let body = format!(
        "schema_version: {SCHEMA_VERSION}\nprovider: {}\nresume_at: {}\nresume_at_known: {}\nrecorded_at: {}\nrun_id: {}\n",
        run.provider,
        resume_at.format(STAMP),
        resume_at_known,
        now.format(STAMP),
        run.run_id,
    );
    let Some(directory) = path.parent() else {
        return;
    };
    if fs::create_dir_all(directory).is_err() {
        return;
    }
    let _ = fs::write(&path, body);
}

/// 이 실행 도구가 지금 보류 중이면 그 보류.
///
/// 만료된 기록은 보류가 아니고, 그 파일을 지우거나 고치지도 않는다. 사용자가 해제 조작을 하지 않아도
/// 시각이 지나면 보류가 풀린다.
pub fn hold_for(root: &Path, provider: &str, now: DateTime<Utc>) -> Option<ProviderHold> {
    let record = read_record(&hold_path(root, provider)?)?;
    if parse_stamp(&record.resume_at)? <= now {
        return None;
    }
    Some(ProviderHold {
        // 파일 이름으로 찾은 이름을 그대로 쓴다. 본문이 적은 이름을 믿으면 한 기록이 다른 실행
        // 도구의 보류를 주장할 수 있다.
        provider: provider.to_owned(),
        resume_at: record.resume_at,
        resume_at_known: record.resume_at_known,
    })
}

/// 지금 보류 중인 실행 도구를 모두 읽는다. 디렉터리를 읽지 못하면 보류 없음으로 답한다.
pub fn active_holds(root: &Path, now: DateTime<Utc>) -> Vec<ProviderHold> {
    let Ok(entries) = fs::read_dir(root.join(HOLD_DIRECTORY)) else {
        return Vec::new();
    };
    let mut holds: Vec<ProviderHold> = entries
        .flatten()
        .filter_map(|entry| provider_of(&entry.path()))
        .filter_map(|provider| hold_for(root, &provider, now))
        .collect();
    holds.sort_by(|left, right| left.provider.cmp(&right.provider));
    holds
}

/// 실행 행이 실어 온 시각. 실행 환경은 RFC3339로 싣는다.
pub fn runtime_time(text: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

/// 재개 시각과 그 시각을 실행 환경에서 받았는지 여부.
///
/// 해제 예정 시각이 있으면 그 시각이고, 없으면 종료 시각에서 정해진 대기 시간이 지난 시각이다.
/// 앱이 시각을 추정해 받은 값으로 만들지 않으므로, 읽지 못한 해제 예정 시각은 없는 것과 같이 다룬다.
fn resume_at(run: &RunSummary) -> Option<(DateTime<Utc>, bool)> {
    if let Some(at) = run.usage_limit_resets_at.as_deref().and_then(runtime_time) {
        return Some((at, true));
    }
    let finished_at = runtime_time(run.finished_at.as_deref()?)?;
    Some((finished_at + Duration::hours(DEFAULT_HOLD_HOURS), false))
}

/// 이 실행 도구의 기록 파일 경로.
///
/// 이름이 정해진 문자 밖의 값을 담고 있으면 경로를 만들지 않는다. 파일 이름이 그 디렉터리 밖을
/// 가리키는 길을 막는 자리다.
fn hold_path(root: &Path, provider: &str) -> Option<PathBuf> {
    if provider.is_empty()
        || !provider
            .chars()
            .all(|letter| letter.is_ascii_alphanumeric() || letter == '_' || letter == '-')
    {
        return None;
    }
    Some(root.join(HOLD_DIRECTORY).join(format!("{provider}.yml")))
}

/// 파일 이름에서 실행 도구 이름을 읽는다. 확장자가 다른 파일은 이 기록이 아니다.
fn provider_of(path: &Path) -> Option<String> {
    if path.extension()? != "yml" {
        return None;
    }
    Some(path.file_stem()?.to_str()?.to_owned())
}

/// 기록 하나를 읽는다. 읽지 못한 기록은 없는 기록과 같이 다룬다.
fn read_record(path: &Path) -> Option<HoldRecord> {
    serde_yaml::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// 기록이 적은 시각. 기록은 오프셋 표기와 소수 초를 쓰지 않으므로 그 표기만 읽는다.
fn parse_stamp(text: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(text, STAMP)
        .ok()
        .map(|at| at.and_utc())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use chrono::{DateTime, Duration, Utc};
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use super::{active_holds, hold_for, record};
    use crate::domain::agent_runtime::{RunState, RunSummary, USAGE_LIMIT_REACHED};

    fn now() -> DateTime<Utc> {
        Utc::now()
    }

    fn stamp(at: DateTime<Utc>) -> String {
        at.format("%Y-%m-%dT%H:%M:%SZ").to_string()
    }

    fn run(provider: &str, finished_at: DateTime<Utc>, resets_at: Option<String>) -> RunSummary {
        RunSummary {
            run_id: "run-1".to_owned(),
            project_id: "p1".to_owned(),
            role: "developer".to_owned(),
            provider: provider.to_owned(),
            state: RunState::Failed,
            target_id: None,
            started_at: None,
            finished_at: Some(stamp(finished_at)),
            failure_stage: None,
            reason: Some(USAGE_LIMIT_REACHED.to_owned()),
            remaining: Vec::new(),
            previous_run_id: None,
            result_prefix: None,
            usage_limit_resets_at: resets_at,
        }
    }

    fn body(root: &Path, provider: &str) -> String {
        fs::read_to_string(root.join("provider-holds").join(format!("{provider}.yml")))
            .expect("기록 파일")
    }

    #[test]
    fn a_carried_reset_time_becomes_the_resume_time() {
        let root = tempdir().expect("root");
        let at = now();
        let resets_at = stamp(at + Duration::hours(3));

        record(root.path(), &run("claude", at, Some(resets_at.clone())), at);

        let hold = hold_for(root.path(), "claude", at).expect("보류");
        assert_eq!(hold.resume_at, resets_at);
        assert!(hold.resume_at_known);
    }

    #[test]
    fn a_missing_reset_time_waits_one_hour_from_the_finish() {
        let root = tempdir().expect("root");
        let at = now();

        record(root.path(), &run("claude", at, None), at);

        let hold = hold_for(root.path(), "claude", at).expect("보류");
        assert_eq!(hold.resume_at, stamp(at + Duration::hours(1)));
        assert!(!hold.resume_at_known);
    }

    #[test]
    fn the_record_body_is_the_six_lines_in_order() {
        let root = tempdir().expect("root");
        let at = "2026-08-18T09:00:00Z"
            .parse::<DateTime<Utc>>()
            .expect("시각");

        record(root.path(), &run("claude", at, None), at);

        assert_eq!(
            body(root.path(), "claude"),
            "schema_version: 1\n\
             provider: claude\n\
             resume_at: 2026-08-18T10:00:00Z\n\
             resume_at_known: false\n\
             recorded_at: 2026-08-18T09:00:00Z\n\
             run_id: run-1\n"
        );
    }

    #[test]
    fn the_same_run_never_rewrites_the_record() {
        let root = tempdir().expect("root");
        let at = now();
        let row = run("claude", at, None);

        record(root.path(), &row, at);
        let first = body(root.path(), "claude");
        // 폴링이 같은 행을 다시 보내는 상황이다. 기록한 시각이 흘러도 보류가 연장되지 않아야 한다.
        record(root.path(), &row, at + Duration::minutes(5));

        assert_eq!(body(root.path(), "claude"), first);
    }

    #[test]
    fn a_resume_time_already_past_records_nothing() {
        let root = tempdir().expect("root");
        let at = now();
        let old = run("claude", at - Duration::hours(5), None);

        record(root.path(), &old, at);

        assert!(hold_for(root.path(), "claude", at).is_none());
        assert!(!root
            .path()
            .join("provider-holds")
            .join("claude.yml")
            .exists());
    }

    #[test]
    fn a_hold_from_one_provider_never_answers_for_another() {
        let root = tempdir().expect("root");
        let at = now();

        record(root.path(), &run("claude", at, None), at);

        assert!(hold_for(root.path(), "claude", at).is_some());
        assert!(hold_for(root.path(), "codex", at).is_none());
        assert_eq!(
            active_holds(root.path(), at)
                .iter()
                .map(|hold| hold.provider.as_str())
                .collect::<Vec<_>>(),
            vec!["claude"]
        );
    }

    #[test]
    fn an_expired_record_is_not_a_hold_and_stays_on_disk() {
        let root = tempdir().expect("root");
        let at = now();
        record(root.path(), &run("claude", at, None), at);

        let after = at + Duration::hours(2);

        assert!(hold_for(root.path(), "claude", after).is_none());
        assert!(active_holds(root.path(), after).is_empty());
        assert!(root
            .path()
            .join("provider-holds")
            .join("claude.yml")
            .exists());
    }

    #[test]
    fn a_broken_or_missing_record_answers_no_hold() {
        let root = tempdir().expect("root");
        let at = now();
        let directory = root.path().join("provider-holds");
        fs::create_dir_all(&directory).expect("디렉터리");
        fs::write(directory.join("claude.yml"), "resume_at: [").expect("깨진 기록");
        fs::write(
            directory.join("codex.yml"),
            format!(
                "schema_version: 1\nprovider: codex\nresume_at: {}\nresume_at_known: true\nrecorded_at: {}\nrun_id: run-9\n",
                (at + Duration::hours(2)).to_rfc3339(),
                stamp(at),
            ),
        )
        .expect("형식이 다른 기록");

        assert!(hold_for(root.path(), "claude", at).is_none());
        assert!(hold_for(root.path(), "codex", at).is_none());
        assert!(hold_for(root.path(), "gemini", at).is_none());
        assert!(active_holds(root.path(), at).is_empty());
        assert!(active_holds(&root.path().join("없는-자리"), at).is_empty());
    }

    #[test]
    fn a_provider_name_outside_the_safe_set_writes_nothing_and_answers_no_hold() {
        let root = tempdir().expect("root");
        let at = now();

        record(root.path(), &run("../escape", at, None), at);

        assert!(hold_for(root.path(), "../escape", at).is_none());
        assert!(hold_for(root.path(), "", at).is_none());
        assert!(!root.path().join("provider-holds").exists());
    }
}
