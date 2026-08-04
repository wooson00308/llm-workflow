//! dream 잡 정의와 dream 연동 상태 읽기.
//!
//! 조건은 `dream-prep check-unprocessed`다. 이 명령이 하트비트 조건용으로 만들어져 있어
//! 역할 잡과 달리 앱 관리 조건 스크립트가 필요 없다.
//!
//! 상태 읽기는 전부 파일에서 직접 유도한다. 이 모듈은 파일을 쓰지 않고 디렉터리도 만들지 않으며
//! 외부 명령을 실행하지 않는다. 하트비트 홈 경로는 인자로 받는다. 대상 파일이 없는 것은 오류가
//! 아니라 "기록 없음"이다.

use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use crate::domain::project::{
    DreamRefinement, DreamStatus, HeartbeatReadFailure, IntegrationInstallation, JobDefaults,
};
use crate::infrastructure::heartbeat_jobs::{ManagedJob, MaxPer};
use crate::infrastructure::heartbeat_status::{failure, probe, read_text};

const MODEL: &str = "opus";
const INTERVAL: &str = "2h";
const TIMEOUT: &str = "30m";
const NOTIFY: &str = "all";
const MAX_PER: &str = "6/24h";

/// 중복 감지 결과에 담을 dream 연동 이름.
pub const INTEGRATION: &str = "dream";

/// dream 잡의 조건 실행 파일. 중복 감지도 같은 이름으로 판정한다.
const CONDITION_COMMAND: &str = "dream-prep";

const SKILL_DIRECTORY: &str = "skills";
const SKILL_FILE: &str = "SKILL.md";
const PROJECTS_DIRECTORY: &str = "projects";
const MEMORY_DIRECTORY: &str = "memory";
const META_FILE: &str = "dream_meta.md";
const MEMORY_INDEX_FILE: &str = "MEMORY.md";
const TRANSCRIPT_SUFFIX: &str = ".jsonl";
const TOPIC_SUFFIX: &str = ".md";
const V2_SECTION: &str = "processed_v2:";
const LAST_DREAM_KEY: &str = "last_dream";
const SEALED: &str = "sealed";

/// 앱이 소유하는 한 줄 고정 문구다. 줄바꿈을 넣지 않는다.
const DREAM_PROMPT: &str = "/dream 스킬로 이 프로젝트의 트랜스크립트를 메모리로 정제해줘. 처리할 트랜스크립트가 없으면 아무것도 정제하지 말고 멈춰.";

/// slug가 `-`로 시작하므로 결과는 `wf-dream-Users-...` 형태가 된다.
/// 사용자가 손으로 만들어 온 `dream-catze` 같은 이름과 겹치지 않는다.
pub fn job_name(slug: &str) -> String {
    format!("wf-dream{slug}")
}

/// 사용자가 편집할 수 있는 dream 잡 설정. 나머지 필드는 앱이 소유한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DreamJobSettings {
    pub model: String,
    pub interval: String,
    pub max_per: MaxPer,
    pub timeout: String,
}

/// R5 기본값. 역할 잡과 같은 이유로 정의를 `JobDefaults` 쪽에 둔다(SPEC-017 R1).
///
/// 기본 주기가 역할 잡보다 성긴 이유: 관측된 dream 실행은 15분 규모이고, 정제할 트랜스크립트는
/// 역할 세션이 끝난 뒤에야 생긴다. 역할 잡보다 촘촘하게 돌릴 이유가 없다.
pub fn default_settings() -> JobDefaults {
    JobDefaults {
        interval: INTERVAL.to_owned(),
        max_per: MAX_PER.to_owned(),
        model: MODEL.to_owned(),
        timeout: TIMEOUT.to_owned(),
    }
}

/// 역할 잡과 같은 이유로 둔다. 화면이 보여주는 기본값과 파일에 쓰이는 기본값이 같은 값에서 나온다.
impl From<JobDefaults> for DreamJobSettings {
    fn from(defaults: JobDefaults) -> Self {
        Self {
            model: defaults.model,
            interval: defaults.interval,
            max_per: MaxPer::Limit(defaults.max_per),
            timeout: defaults.timeout,
        }
    }
}

/// dream 잡 하나를 R5 기본값으로 만든다.
pub fn dream_job(slug: &str) -> ManagedJob {
    dream_job_with(slug, &default_settings().into())
}

/// dream 잡 하나를 주어진 설정으로 만든다. 앱 소유 필드(`prompt`, `condition`, `notify`,
/// `slug`)는 설정과 무관하게 항상 여기서 다시 만든다.
pub fn dream_job_with(slug: &str, settings: &DreamJobSettings) -> ManagedJob {
    ManagedJob {
        name: job_name(slug),
        slug: slug.to_owned(),
        model: settings.model.clone(),
        prompt: DREAM_PROMPT.to_owned(),
        interval: settings.interval.clone(),
        timeout: settings.timeout.clone(),
        condition: format!("{CONDITION_COMMAND} check-unprocessed --slug={slug}"),
        notify: NOTIFY.to_owned(),
        max_per: settings.max_per.clone(),
    }
}

/// 조건 문자열이 dream 잡을 가리키는지 판정한다. 중복 감지가 이 기준을 쓴다.
pub fn is_dream_condition(condition: &str) -> bool {
    condition.contains(CONDITION_COMMAND)
}

/// dream 연동 상태를 읽는다. 선행 조건인 하트비트 설치 여부는 하트비트 연동이 판정한 값을 받는다.
///
/// `heartbeat_home`은 `~/.claude`에 해당하는 디렉터리다. 홈 해석은 커맨드 계층이 한다.
pub fn read_dream_status(
    heartbeat_home: &Path,
    slug: &str,
    heartbeat: IntegrationInstallation,
    read_failures: &mut Vec<HeartbeatReadFailure>,
) -> DreamStatus {
    let installation = if probe(&skill_path(heartbeat_home), read_failures) {
        IntegrationInstallation::Installed
    } else {
        IntegrationInstallation::NotInstalled
    };

    DreamStatus {
        installation,
        heartbeat,
        refinement: read_refinement(heartbeat_home, slug, read_failures),
    }
}

/// dream 스킬 설치본의 위치다.
///
/// 한계: `heartbeat install dream --slug`으로 다른 이름으로 설치하면 스킬이 이 경로에 없어
/// 미설치로 보인다. 앱은 판정 경로를 화면에 밝혀 사용자가 대조할 수 있게 한다.
pub fn skill_path(heartbeat_home: &Path) -> std::path::PathBuf {
    heartbeat_home
        .join(SKILL_DIRECTORY)
        .join(INTEGRATION)
        .join(SKILL_FILE)
}

/// 정제 상태를 센다.
///
/// 여기서 나오는 미정제 수는 마킹 기준이다. dream은 실제 실행 시 활성 파일 게이트(수정 시각이
/// 30분 안쪽이면 다음 라운드로 미루고, 10MB 이상이면 강제 처리)를 추가로 적용하므로 한 번에
/// 처리되는 수는 이 값과 다르다. 앱은 그 판정을 베끼지 않는다.
fn read_refinement(
    heartbeat_home: &Path,
    slug: &str,
    read_failures: &mut Vec<HeartbeatReadFailure>,
) -> DreamRefinement {
    let project = heartbeat_home.join(PROJECTS_DIRECTORY).join(slug);
    let transcripts = file_names(&project, read_failures)
        .into_iter()
        .filter(|name| name.ends_with(TRANSCRIPT_SUFFIX))
        .collect::<HashSet<_>>();

    let memory = project.join(MEMORY_DIRECTORY);
    let meta = read_text(&memory.join(META_FILE), read_failures);
    let meta = meta.text().map(parse_meta).unwrap_or_default();

    // `dream_meta.md`에는 이미 지워진 트랜스크립트 이름이 남아 있을 수 있다. 실제로 있는 파일만
    // 세야 미정제 수가 음수가 되지 않는다.
    let marked = meta
        .marked
        .iter()
        .filter(|name| transcripts.contains(*name))
        .count();

    let memory_topics = file_names(&memory, read_failures)
        .into_iter()
        .filter(|name| {
            name.ends_with(TOPIC_SUFFIX) && name != MEMORY_INDEX_FILE && name != META_FILE
        })
        .count();

    DreamRefinement {
        total_transcripts: transcripts.len(),
        marked_transcripts: marked,
        unrefined_transcripts: transcripts.len() - marked,
        last_dream: meta.last_dream,
        memory_topics,
    }
}

/// 디렉터리 바로 아래 파일 이름만 모은다. 없는 디렉터리는 빈 목록이고 오류가 아니다.
fn file_names(directory: &Path, read_failures: &mut Vec<HeartbeatReadFailure>) -> Vec<String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Vec::new(),
        Err(error) => {
            read_failures.push(failure(directory, &error));
            return Vec::new();
        }
    };

    entries
        .flatten()
        // 하위 디렉터리는 세지 않는다. `_dream_prep/`처럼 이름이 규칙에 걸리는 경우도 마찬가지다.
        .filter(|entry| !entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect()
}

/// `dream_meta.md`에서 읽는 값.
#[derive(Default)]
struct DreamMeta {
    last_dream: Option<String>,
    marked: HashSet<String>,
}

/// 진행 중인 `processed_v2:` 항목. 상태 줄은 항목 아래 들여쓰기로 오므로 다음 줄까지 봐야 확정된다.
struct PendingEntry {
    file: String,
    sealed: bool,
}

/// 마킹 규칙은 dream 구현을 그대로 따른다.
///
/// - legacy: `- <이름>.jsonl` 줄. `- file:` 형태는 v2 항목이므로 제외한다.
/// - v2: `processed_v2:` 섹션의 `- file: <이름>.jsonl` 항목. 아래 들여쓴 `status:` 줄이 있으면
///   그 값을, 없으면 `sealed`로 본다. 오래된 항목은 압축돼 하위 줄이 지워지므로 이 기본값이 맞다.
/// - `status: active`는 부분 처리 상태다. 마킹으로 세지 않는다.
fn parse_meta(contents: &str) -> DreamMeta {
    let mut meta = DreamMeta::default();
    let mut in_v2 = false;
    let mut pending: Option<PendingEntry> = None;

    for line in contents.lines() {
        let trimmed = line.trim();

        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(entry) = pending.as_mut() {
                if let Some(status) = trimmed.strip_prefix("status:") {
                    entry.sealed = status.trim() == SEALED;
                }
            }
            continue;
        }

        seal(&mut meta, pending.take());

        if trimmed == V2_SECTION {
            in_v2 = true;
            continue;
        }

        if let Some(item) = trimmed.strip_prefix("- ") {
            let item = item.trim();
            match item.strip_prefix("file:") {
                Some(file) if in_v2 => {
                    pending = Some(PendingEntry {
                        file: file.trim().to_owned(),
                        sealed: true,
                    });
                }
                Some(_) => {}
                None if item.ends_with(TRANSCRIPT_SUFFIX) => {
                    meta.marked.insert(item.to_owned());
                }
                None => {}
            }
            continue;
        }

        // 들여쓰지 않은 새 키가 나오면 `processed_v2:` 섹션은 끝난다.
        if let Some((key, value)) = trimmed.split_once(':') {
            in_v2 = false;
            if key == LAST_DREAM_KEY && !value.trim().is_empty() {
                meta.last_dream = Some(value.trim().to_owned());
            }
        }
    }

    seal(&mut meta, pending);
    meta
}

fn seal(meta: &mut DreamMeta, entry: Option<PendingEntry>) {
    if let Some(entry) = entry.filter(|entry| entry.sealed) {
        meta.marked.insert(entry.file);
    }
}

/// 상태 읽기 테스트. 가짜 하트비트 홈만 쓰고 실제 `~/.claude`는 건드리지 않는다.
#[cfg(test)]
mod status_tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::Path;
    use std::time::SystemTime;

    use tempfile::{tempdir, TempDir};

    use super::read_dream_status;
    use crate::domain::project::{DreamStatus, HeartbeatReadFailure, IntegrationInstallation};
    use crate::infrastructure::heartbeat_status::read_heartbeat_installation;

    const SLUG: &str = "-Users-catze-project-workflow-labs";
    const SKILL: &str = "skills/dream/SKILL.md";

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

    fn transcripts(home: &Path, count: usize) {
        for index in 1..=count {
            write(home, &format!("projects/{SLUG}/t{index}.jsonl"), "{}\n");
        }
    }

    fn meta(home: &Path, body: &str) {
        write(
            home,
            &format!("projects/{SLUG}/memory/dream_meta.md"),
            &format!(
                "---\nname: dream_meta\ndescription: /dream 프로세스 메타데이터\nmetadata: \n  node_type: memory\n---\n\nlast_dream: 2026-07-19T19:25:01\nlast_lint: 2026-07-19T19:25:01\n\n{body}"
            ),
        );
    }

    /// 선행 조건인 하트비트 설치 여부도 실제 판정 함수를 거쳐 넣는다.
    fn read(home: &Path) -> (DreamStatus, Vec<HeartbeatReadFailure>) {
        let mut failures = Vec::new();
        let heartbeat = read_heartbeat_installation(home, &mut failures).installation;
        let status = read_dream_status(home, SLUG, heartbeat, &mut failures);
        (status, failures)
    }

    #[test]
    fn the_skill_file_decides_the_dream_installation() {
        let missing = home();
        let installed = home();
        write(installed.path(), SKILL, "# dream\n");

        assert_eq!(
            read(missing.path()).0.installation,
            IntegrationInstallation::NotInstalled
        );
        assert_eq!(
            read(installed.path()).0.installation,
            IntegrationInstallation::Installed
        );
    }

    /// R2의 세 상태는 하트비트 설치 여부와 dream 스킬 설치 여부의 조합이다.
    #[test]
    fn the_three_states_come_from_two_independent_checks() {
        let nothing = home();
        let heartbeat_only = home();
        write(heartbeat_only.path(), "HEARTBEAT.md", "- tick: 5m\n");
        let both = home();
        write(both.path(), "HEARTBEAT.md", "- tick: 5m\n");
        write(both.path(), SKILL, "# dream\n");

        let states = [nothing, heartbeat_only, both].map(|directory| {
            let status = read(directory.path()).0;
            (status.heartbeat, status.installation)
        });

        assert_eq!(
            states,
            [
                (
                    IntegrationInstallation::NotInstalled,
                    IntegrationInstallation::NotInstalled
                ),
                (
                    IntegrationInstallation::Installed,
                    IntegrationInstallation::NotInstalled
                ),
                (
                    IntegrationInstallation::Installed,
                    IntegrationInstallation::Installed
                ),
            ]
        );
    }

    #[test]
    fn marked_transcripts_come_from_the_v2_section() {
        let directory = home();
        transcripts(directory.path(), 5);
        meta(
            directory.path(),
            "processed_v2:\n- file: t1.jsonl\n- file: t2.jsonl\n",
        );

        let (status, failures) = read(directory.path());

        assert_eq!(status.refinement.total_transcripts, 5);
        assert_eq!(status.refinement.marked_transcripts, 2);
        assert_eq!(status.refinement.unrefined_transcripts, 3);
        assert_eq!(
            status.refinement.last_dream.as_deref(),
            Some("2026-07-19T19:25:01")
        );
        assert!(failures.is_empty());
    }

    /// 부분 처리 상태는 마킹이 아니다. 하위 줄이 없는 항목은 압축된 오래된 항목이므로 마킹이다.
    #[test]
    fn an_active_entry_counts_as_unrefined() {
        let directory = home();
        transcripts(directory.path(), 3);
        meta(
            directory.path(),
            "processed_v2:\n- file: t1.jsonl\n  status: active\n- file: t2.jsonl\n  status: sealed\n- file: t3.jsonl\n",
        );

        let (status, _) = read(directory.path());

        assert_eq!(status.refinement.marked_transcripts, 2);
        assert_eq!(status.refinement.unrefined_transcripts, 1);
    }

    #[test]
    fn a_legacy_entry_counts_as_marked() {
        let directory = home();
        transcripts(directory.path(), 3);
        meta(directory.path(), "processed:\n- t1.jsonl\n- t2.jsonl\n");

        let (status, _) = read(directory.path());

        assert_eq!(status.refinement.marked_transcripts, 2);
        assert_eq!(status.refinement.unrefined_transcripts, 1);
    }

    /// 지워진 트랜스크립트 이름이 남아 있어도 미정제 수가 음수가 되지 않는다.
    #[test]
    fn entries_without_a_transcript_file_are_not_counted() {
        let directory = home();
        transcripts(directory.path(), 1);
        meta(
            directory.path(),
            "processed_v2:\n- file: t1.jsonl\n- file: gone.jsonl\n- file: also-gone.jsonl\n",
        );

        let (status, _) = read(directory.path());

        assert_eq!(status.refinement.total_transcripts, 1);
        assert_eq!(status.refinement.marked_transcripts, 1);
        assert_eq!(status.refinement.unrefined_transcripts, 0);
    }

    #[test]
    fn a_missing_meta_file_means_no_refinement_record() {
        let directory = home();
        transcripts(directory.path(), 4);

        let (status, failures) = read(directory.path());

        assert_eq!(status.refinement.total_transcripts, 4);
        assert_eq!(status.refinement.marked_transcripts, 0);
        assert_eq!(status.refinement.unrefined_transcripts, 4);
        assert_eq!(status.refinement.last_dream, None);
        assert_eq!(status.refinement.memory_topics, 0);
        assert!(failures.is_empty());
    }

    #[test]
    fn a_missing_project_directory_means_no_transcripts() {
        let directory = home();

        let (status, failures) = read(directory.path());

        assert_eq!(status.refinement.total_transcripts, 0);
        assert_eq!(status.refinement.unrefined_transcripts, 0);
        assert!(failures.is_empty());
    }

    #[test]
    fn memory_topics_exclude_the_index_the_meta_and_subdirectories() {
        let directory = home();
        meta(directory.path(), "processed_v2:\n");
        write(
            directory.path(),
            &format!("projects/{SLUG}/memory/MEMORY.md"),
            "- [a](a.md)\n",
        );
        for name in ["a", "b", "c"] {
            write(
                directory.path(),
                &format!("projects/{SLUG}/memory/{name}.md"),
                "---\nname: a\n---\n",
            );
        }
        write(
            directory.path(),
            &format!("projects/{SLUG}/memory/_dream_prep/chunk.md"),
            "chunk\n",
        );

        let (status, _) = read(directory.path());

        assert_eq!(status.refinement.memory_topics, 3);
    }

    #[test]
    fn reading_the_dream_status_does_not_touch_the_heartbeat_home() {
        let directory = home();
        write(directory.path(), SKILL, "# dream\n");
        transcripts(directory.path(), 2);
        meta(directory.path(), "processed_v2:\n- file: t1.jsonl\n");

        let before = snapshot(directory.path());
        read(directory.path());
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use tempfile::{tempdir, TempDir};

    use super::{dream_job, job_name, DREAM_PROMPT};
    use crate::infrastructure::heartbeat_jobs::{
        install_managed_jobs, parse_heartbeat, HeartbeatJobsError, ManagedJob, MANAGED_END,
        MANAGED_START,
    };
    use crate::infrastructure::heartbeat_roles::{role_managed_jobs, HeartbeatRole, RoleJob};

    const SLUG: &str = "-Users-catze-project-workflow-labs";

    fn target(directory: &TempDir) -> PathBuf {
        directory.path().join("HEARTBEAT.md")
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).expect("target file")
    }

    /// 이 모듈의 시험 파일에는 다른 호출자의 잡이 없다. 소유 이름 집합은 언제나 설치 목록과 같다.
    fn install(path: &Path, jobs: &[ManagedJob]) -> Result<bool, HeartbeatJobsError> {
        let owned = jobs.iter().map(|job| job.name.clone()).collect::<Vec<_>>();
        install_managed_jobs(path, jobs, &owned)
    }

    fn default_role_jobs() -> Vec<RoleJob> {
        HeartbeatRole::ALL
            .iter()
            .map(|role| RoleJob {
                role: *role,
                settings: role.default_settings().into(),
            })
            .collect()
    }

    #[test]
    fn renders_the_dream_job_with_the_specified_defaults() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);

        assert!(install(&path, &[dream_job(SLUG)]).expect("install"));

        let document = parse_heartbeat(&read(&path));
        assert_eq!(document.jobs.len(), 1);

        let job = &document.jobs[0];
        assert_eq!(job.name, "wf-dream-Users-catze-project-workflow-labs");
        assert_eq!(job.fields.len(), 8);
        assert_eq!(job.field("slug"), Some(SLUG));
        assert_eq!(job.field("model"), Some("opus"));
        assert_eq!(job.field("prompt"), Some(DREAM_PROMPT));
        assert_eq!(job.field("interval"), Some("2h"));
        assert_eq!(job.field("timeout"), Some("30m"));
        assert_eq!(
            job.field("condition"),
            Some("dream-prep check-unprocessed --slug=-Users-catze-project-workflow-labs")
        );
        assert_eq!(job.field("notify"), Some("all"));
        assert_eq!(job.field("max_per"), Some("6/24h"));
    }

    /// R4. 연동이 둘이어도 마커 블록은 하나이고, dream 잡은 역할 잡 뒤에 덧붙는다.
    #[test]
    fn role_jobs_and_the_dream_job_share_one_managed_block() {
        let directory = tempdir().expect("temporary directory");
        let roles_only = target(&directory);
        let both = directory.path().join("BOTH.md");
        let slug = SLUG.to_owned();
        let mut jobs = role_managed_jobs(&default_role_jobs(), &slug);

        assert!(install(&roles_only, &jobs).expect("install roles"));
        jobs.push(dream_job(&slug));
        assert!(install(&both, &jobs).expect("install roles and dream"));

        let contents = read(&both);
        assert_eq!(contents.matches(MANAGED_START).count(), 1);
        assert_eq!(contents.matches(MANAGED_END).count(), 1);

        let names = parse_heartbeat(&contents)
            .jobs
            .iter()
            .map(|job| job.name.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                format!("wf-planner{SLUG}"),
                format!("wf-architect{SLUG}"),
                format!("wf-developer{SLUG}"),
                job_name(SLUG),
            ]
        );

        // 역할 잡 부분은 dream 잡이 붙어도 그대로다.
        let roles_body = read(&roles_only);
        let roles_body = roles_body
            .strip_suffix(&format!("{MANAGED_END}\n"))
            .expect("end marker");
        assert!(contents.starts_with(roles_body));
    }

    #[test]
    fn an_invalid_dream_interval_leaves_the_file_alone() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        let original = "## my-job\n- slug: -tmp-demo\n";
        fs::write(&path, original).expect("seed file");

        let mut job = dream_job(SLUG);
        job.interval = "2시간".to_owned();

        let error = install(&path, &[job]).expect_err("must fail");

        match error {
            HeartbeatJobsError::InvalidValue { field, .. } => assert_eq!(field, "interval"),
            other => panic!("unexpected error: {other}"),
        }
        assert_eq!(read(&path), original);
    }

    #[test]
    fn installing_the_same_block_twice_does_not_write() {
        let directory = tempdir().expect("temporary directory");
        let path = target(&directory);
        let mut jobs = role_managed_jobs(&default_role_jobs(), SLUG);
        jobs.push(dream_job(SLUG));

        assert!(install(&path, &jobs).expect("first install"));
        let first = read(&path);
        assert!(!install(&path, &jobs).expect("second install"));
        assert_eq!(read(&path), first);
    }
}
