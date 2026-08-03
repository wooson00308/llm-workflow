use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::domain::project::{
    DreamRefinement, DuplicateHeartbeatJob, HeartbeatInstallation, HeartbeatJobRun,
    HeartbeatReadFailure, HeartbeatRoleStatus, HeartbeatStatus, IntegrationInstallation,
    JobDefaults,
};
use crate::infrastructure::heartbeat_condition::{
    condition_script_path, install_condition_script, ConditionScriptError,
};
use crate::infrastructure::heartbeat_dream::{self, read_dream_status, DreamJobSettings};
use crate::infrastructure::heartbeat_jobs::{
    install_managed_jobs, parse_heartbeat, project_slug, validate_managed_jobs, HeartbeatJob,
    HeartbeatJobsError, ManagedJob, MANAGED_END, MANAGED_START,
};
use crate::infrastructure::heartbeat_roles::{
    job_name, role_managed_jobs, HeartbeatRole, RoleJob, RoleJobSettings,
};
use crate::infrastructure::heartbeat_status::{self, read_heartbeat_status, read_job_runs};

const CONTROL_DIRECTORY: &str = ".workflow";
const HEARTBEAT_FILE: &str = "HEARTBEAT.md";

/// 이번 범위의 조건 스크립트는 POSIX `sh` 하나뿐이라 Windows에서는 연동을 지원하지 않는다.
const PLATFORM_SUPPORTED: bool = !cfg!(windows);

/// 설정 화면의 연동 섹션이 한 번에 필요한 값. 전부 읽기 전용 판정이다.
///
/// 섹션 공통 값과 연동별 payload를 나눠 담는다. 연동이 늘어날 때 커맨드·게이트웨이·훅 상태·조회
/// 주기가 함께 늘어나지 않게 하려는 형태이며, 세 번째 연동은 payload 필드 하나만 추가한다.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsSnapshot {
    /// 플랫폼 지원 여부는 섹션 공통 정책이다. 연동별 분기를 만들지 않는다.
    /// (SPEC-003 확인 필요 2번의 승인된 제안)
    pub supported: bool,
    /// 두 연동이 같은 값을 쓰므로 섹션 공통 값이다.
    pub slug: String,
    /// 관리 블록을 담은 문서를 읽지 못한 사유. `None`이면 읽었다는 뜻이고, 파일이 없는 것도 읽은
    /// 것으로 본다(잡이 없는 빈 블록). `Some`이면 앱이 블록의 값을 모르는 상태이므로 화면은 그것을
    /// "잡 없음"으로 읽으면 안 된다(R2).
    ///
    /// 두 연동이 `HEARTBEAT.md` 한 파일을 공유하므로 연동별 payload가 아니라 섹션 공통 값이다.
    pub managed_block_failure: Option<HeartbeatReadFailure>,
    pub heartbeat: HeartbeatIntegration,
    pub dream: DreamIntegration,
}

/// dream 연동 payload. 공통 설치 상태 위에 선행 조건과 정제 상태를 얹는다.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DreamIntegration {
    /// dream 스킬 설치 여부. `skill_path` 존재로만 판정한다.
    pub installation: IntegrationInstallation,
    /// 선행 조건. dream은 하트비트 데몬이 깨우는 스킬이라 하트비트가 먼저 있어야 한다.
    pub heartbeat: IntegrationInstallation,
    pub refinement: DreamRefinement,
    /// 설치 판정에 쓴 경로. 다른 이름(`--slug`)으로 설치하면 이 경로에 없어 미설치로 보인다.
    pub skill_path: String,
    /// 설치될 dream 잡의 `condition` 원문. 화면이 문자열을 다시 조립하지 않게 여기서 만든다.
    pub condition_command: String,
    /// dream 잡의 앱 기본값(R5). 역할 잡은 역할마다 값이 달라 `roles` 항목에 실리고, dream은 잡이
    /// 하나라 여기 하나만 얹는다.
    pub defaults: JobDefaults,
    /// 관리 블록에 기록된 dream 잡의 편집 가능 값. 블록에 없으면 `None`이고 이는 "꺼짐"이다.
    pub managed_job: Option<ManagedDreamJob>,
    /// dream 잡의 마지막 실행 기록. `None`은 "실행 기록 없음"이다.
    pub last_run: Option<HeartbeatJobRun>,
    /// 이 연동의 중복 잡만 담는다. 역할 잡 중복은 하트비트 카드가 보여준다.
    pub duplicate_jobs: Vec<DuplicateHeartbeatJob>,
    pub read_failures: Vec<HeartbeatReadFailure>,
}

/// 하트비트 연동 payload. 카드 골격이 쓰는 공통 부분과 하트비트 전용 부분을 함께 담는다.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatIntegration {
    /// 연동 공통 설치 상태. 미설치·설치됨 두 값뿐이다.
    pub installation: IntegrationInstallation,
    /// 하트비트 부가 상태. pid 파일 존재로만 판정하고 프로세스 생존은 확인하지 않는다.
    pub daemon_running: bool,
    /// 프로젝트 루트 기준 상대 경로. 잡의 `condition`에 적히는 값과 같다.
    pub condition_script_path: String,
    pub roles: Vec<HeartbeatRoleStatus>,
    /// 앱 관리 블록에 실제로 기록된 역할 잡만 담는다. 블록이 없으면 빈 목록이다.
    pub managed_jobs: Vec<ManagedRoleJob>,
    /// 이 연동의 중복 잡만 담는다. 다른 연동의 중복은 그 연동 카드가 보여준다.
    pub duplicate_jobs: Vec<DuplicateHeartbeatJob>,
    pub read_failures: Vec<HeartbeatReadFailure>,
}

/// 관리 블록에 설치된 역할 잡 중 사용자가 편집할 수 있는 값. 나머지 필드는 앱이 소유한다.
///
/// 화면이 이 값을 그대로 되돌려 보내 기준값으로 쓰므로(R3) 역방향 변환도 필요하다.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRoleJob {
    pub role: String,
    pub interval: Option<String>,
    pub max_per: Option<String>,
    pub model: Option<String>,
    /// 앱이 다시 쓸 값과 다른 앱 소유 필드 이름(R4). 화면은 이 이름만 보고 되돌아간다는 사실을
    /// 밝히므로 앱 소유 필드의 값을 알 필요가 없다.
    pub app_owned_drift: Vec<String>,
}

/// 관리 블록에 설치된 dream 잡 중 사용자가 편집할 수 있는 값. 나머지 필드는 앱이 소유한다.
///
/// 역할 잡과 같은 이유로 역방향 변환을 함께 둔다(R3).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedDreamJob {
    pub interval: Option<String>,
    pub max_per: Option<String>,
    pub model: Option<String>,
    /// 역할 잡과 같은 값이다(R4).
    pub app_owned_drift: Vec<String>,
}

/// 설치 커맨드가 받는 역할별 요청. 비활성 역할도 함께 받는다. 하트비트에 비활성 상태 필드가
/// 없으므로 "꺼짐"은 관리 블록에서 빼는 것으로 표현한다.
///
/// 편집 가능 값의 `None`은 "사용자가 이번 편집에서 지정하지 않았다"는 뜻이고, 그 필드는 파일의
/// 값이 이긴다(R1). `enabled`만 `bool`인 이유는 잡의 존재 여부를 화면의 토글이 직접 정하고,
/// 그 시딩 근거("블록에 있느냐")가 필드 값과 달리 파일에서 직접 나오기 때문이다.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleJobRequest {
    pub role: String,
    pub enabled: bool,
    pub interval: Option<String>,
    pub max_per: Option<String>,
    pub model: Option<String>,
}

/// 설치 커맨드가 받는 dream 잡 요청. 역할 잡과 같은 방식으로 "꺼짐"은 블록에서 빼는 것으로
/// 표현한다. 이 요청에는 역할 잡 값이 들어가지 않는다.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamJobRequest {
    pub enabled: bool,
    pub interval: Option<String>,
    pub max_per: Option<String>,
    pub model: Option<String>,
}

/// 잡 하나의 편집 가능 값 세 개. 필드마다 없을 수 있다. 관리 블록에서 읽은 값과 이번 요청이 같은
/// 모양을 쓴다.
#[derive(Debug, Clone, Default)]
struct PartialSettings {
    model: Option<String>,
    interval: Option<String>,
    max_per: Option<String>,
}

/// 편집 가능 값 세 개가 모두 정해진 상태. 잡 종류가 달라도 세 필드는 같으므로, 병합 규칙을 한 번만
/// 적기 위해 이 모양으로 모아 다룬다(R1).
#[derive(Debug, Clone)]
struct JobSettings {
    model: String,
    interval: String,
    max_per: String,
}

impl PartialSettings {
    /// 이 값들을 기준 설정 위에 덮는다. 없는 필드는 기준을 그대로 둔다.
    ///
    /// 이것이 이 기획서의 규칙 전부다. 기준 설정을 만들 때(블록 값 위에 앱 기본값)와 요청을 반영할
    /// 때(요청 값 위에 기준 설정) 같은 함수를 쓴다. 잡 종류마다 다시 적지 않는다.
    fn over(self, base: JobSettings) -> JobSettings {
        JobSettings {
            model: self.model.unwrap_or(base.model),
            interval: self.interval.unwrap_or(base.interval),
            max_per: self.max_per.unwrap_or(base.max_per),
        }
    }

    /// 사용자가 이번 편집에서 한 필드라도 지정했는지. 검증 실패 문구를 고르는 근거다.
    fn specifies_nothing(&self) -> bool {
        self.model.is_none() && self.interval.is_none() && self.max_per.is_none()
    }
}

impl From<RoleJobSettings> for JobSettings {
    fn from(settings: RoleJobSettings) -> Self {
        Self {
            model: settings.model,
            interval: settings.interval,
            max_per: settings.max_per,
        }
    }
}

impl From<JobSettings> for RoleJobSettings {
    fn from(settings: JobSettings) -> Self {
        Self {
            model: settings.model,
            interval: settings.interval,
            max_per: settings.max_per,
        }
    }
}

impl From<DreamJobSettings> for JobSettings {
    fn from(settings: DreamJobSettings) -> Self {
        Self {
            model: settings.model,
            interval: settings.interval,
            max_per: settings.max_per,
        }
    }
}

impl From<JobSettings> for DreamJobSettings {
    fn from(settings: JobSettings) -> Self {
        Self {
            model: settings.model,
            interval: settings.interval,
            max_per: settings.max_per,
        }
    }
}

#[derive(Debug, Error)]
pub enum HeartbeatInstallError {
    #[error("이 플랫폼에서는 연동 잡을 설치할 수 없습니다. 조건 검사가 POSIX sh 스크립트라 Windows에서는 잡이 조용히 건너뛰어집니다.")]
    UnsupportedPlatform,
    #[error("알 수 없는 역할 `{0}`이라 아무 파일도 쓰지 않았습니다. planner, architect, developer 중 하나여야 합니다.")]
    UnknownRole(String),
    /// 이번 요청이 정하지 않는 잡이 관리 블록 안에서 이미 깨져 있는 경우. 조용히 기본값으로
    /// 되돌리지 않고 어느 잡의 어느 필드가 문제인지 밝힌 뒤 아무 파일도 쓰지 않는다.
    #[error("관리 블록에 남아 있는 `{job}` 잡의 값이 올바르지 않아 아무 파일도 쓰지 않았습니다. {source} 그 잡을 손으로 고쳤다면 바로잡은 뒤 다시 시도하세요.")]
    PreservedJob {
        job: String,
        source: HeartbeatJobsError,
    },
    /// 화면이 읽은 뒤 이 요청이 관장하는 잡이 파일에서 바뀐 경우(R3). 사용자가 보지 못한 값을
    /// 덮어쓰지 않는다.
    #[error("화면이 읽은 뒤 관리 블록이 바뀌어 아무 파일도 쓰지 않았습니다. 새로고침된 값을 확인한 뒤 다시 시도하세요.")]
    ManagedBlockChanged,
    #[error(transparent)]
    Jobs(#[from] HeartbeatJobsError),
    #[error(transparent)]
    ConditionScript(#[from] ConditionScriptError),
}

#[derive(Debug, Default)]
pub struct HeartbeatService;

impl HeartbeatService {
    /// 하트비트 홈과 프로젝트 루트를 읽어 연동 스냅샷을 만든다. 대상 파일이 없어도 오류가 아니다.
    ///
    /// 문서는 조회가 읽은 것 하나만 쓴다. 여기서 다시 읽으면 두 읽기의 결과가 갈라져 "못 읽음"과
    /// "잡 없음"의 구분이 성립하지 않는다.
    pub fn inspect(&self, project_root: &Path, heartbeat_home: &Path) -> IntegrationsSnapshot {
        let slug = project_slug(project_root);
        let read = read_heartbeat_status(heartbeat_home, &slug);
        let status = read.status;
        // 못 읽은 문서에서는 잡 목록이 비지만 그것은 "잡 없음"이 아니다. 화면은 아래 실패 값을
        // 먼저 보고 두 상태를 구분한다.
        let managed_block_failure = read.document.unreadable().cloned();
        let document = read.document.text().unwrap_or_default();
        // dream은 하트비트 설치 여부를 스스로 판정하지 않고 이 값을 넘겨받는다. 두 연동이 각자
        // 확인하면 같은 경로가 읽기 실패 목록에 두 번 들어간다.
        let (installation, _) = split_installation(status.installation);
        IntegrationsSnapshot {
            supported: PLATFORM_SUPPORTED,
            managed_block_failure,
            dream: dream_integration(
                heartbeat_home,
                &slug,
                installation,
                managed_dream_job(document, &slug),
                duplicates_of(&status.duplicate_jobs, heartbeat_dream::INTEGRATION),
            ),
            heartbeat: heartbeat_integration(
                status,
                condition_script_relative_path(project_root),
                managed_role_jobs(document, &slug),
            ),
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
    ///
    /// `baseline`은 화면이 읽은 시점의 역할 잡이다. 쓰기 직전에 읽은 문서에서 같은 값을 만들어
    /// 대조하고, 다르면 아무 파일도 쓰지 않는다(R3). 대조 범위는 이 요청이 관장하는 역할 잡뿐이라
    /// dream 잡만 바뀐 것은 이 요청을 막지 않는다.
    pub fn install(
        &self,
        project_root: &Path,
        heartbeat_home: &Path,
        roles: &[RoleJobRequest],
        baseline: &[ManagedRoleJob],
    ) -> Result<IntegrationsSnapshot, HeartbeatInstallError> {
        if !PLATFORM_SUPPORTED {
            return Err(HeartbeatInstallError::UnsupportedPlatform);
        }

        let slug = project_slug(project_root);
        let path = heartbeat_home.join(HEARTBEAT_FILE);
        let document = read_document(&path)?;

        // 조건 스크립트 설치보다 먼저 대조한다. 불일치로 실패한 요청이 프로젝트 로컬 파일을 새로
        // 만들면 "아무 파일도 쓰지 않았다"가 성립하지 않는다.
        if managed_role_jobs(&document, &slug) != baseline {
            return Err(HeartbeatInstallError::ManagedBlockChanged);
        }

        let requested = requested_role_jobs(roles, &document, &slug)?;
        let jobs = merge_block(requested, preserved_dream_job(&document, &slug)?);

        install_condition_script(&project_root.join(CONTROL_DIRECTORY))?;
        install_managed_jobs(&path, &jobs)?;

        Ok(self.inspect(project_root, heartbeat_home))
    }

    /// dream 잡을 설치하고 갱신된 상태를 돌려준다. 명시적 사용자 액션에서만 호출한다.
    ///
    /// 역할 잡 설치와 달리 조건 스크립트를 쓰지 않는다. dream 잡의 조건은
    /// `dream-prep check-unprocessed`이고 앱 관리 스크립트를 거치지 않으므로, "dream만 설치"
    /// 상태에서 프로젝트 로컬에 파일이 생기면 안 된다. 이 경로가 쓰는 파일은 전역 파일 하나뿐이다.
    ///
    /// `baseline`은 화면이 읽은 시점의 dream 잡이다. 역할 잡 설치와 같은 규칙으로 대조하고, 대조
    /// 범위는 dream 잡 하나뿐이다(R3).
    pub fn install_dream(
        &self,
        project_root: &Path,
        heartbeat_home: &Path,
        dream: &DreamJobRequest,
        baseline: Option<&ManagedDreamJob>,
    ) -> Result<IntegrationsSnapshot, HeartbeatInstallError> {
        if !PLATFORM_SUPPORTED {
            return Err(HeartbeatInstallError::UnsupportedPlatform);
        }

        let slug = project_slug(project_root);
        let path = heartbeat_home.join(HEARTBEAT_FILE);
        let document = read_document(&path)?;

        if managed_dream_job(&document, &slug).as_ref() != baseline {
            return Err(HeartbeatInstallError::ManagedBlockChanged);
        }

        let requested = requested_dream_job(dream, &document, &slug)?;
        let jobs = merge_block(preserved_role_jobs(&document, &slug)?, requested);

        install_managed_jobs(&path, &jobs)?;

        Ok(self.inspect(project_root, heartbeat_home))
    }
}

/// 관리 블록에 남길 잡 전체. 순서는 연동 목록 순서로 고정한다: 역할 3종 다음에 dream.
/// 어떤 연동을 먼저 설치했든 같은 결과가 나와야 하므로 요청 순서를 반영하지 않는다.
fn merge_block(role_jobs: Vec<ManagedJob>, dream_job: Option<ManagedJob>) -> Vec<ManagedJob> {
    role_jobs.into_iter().chain(dream_job).collect()
}

/// 이번 요청이 정하지 않는 잡은 블록에 적힌 편집 가능 값 그대로 다시 만든다.
///
/// 값이 검증을 통과하지 못하면 조용히 기본값으로 되돌리지 않고 실패한다. 사용자가 블록 안을 손으로
/// 고쳤을 때 그 사실을 덮어쓰지 않기 위해서다.
fn validate_preserved(job: ManagedJob) -> Result<ManagedJob, HeartbeatInstallError> {
    validate_managed_jobs(std::slice::from_ref(&job)).map_err(|source| {
        HeartbeatInstallError::PreservedJob {
            job: job.name.clone(),
            source,
        }
    })?;
    Ok(job)
}

/// 이번 요청이 정하는 잡의 검증. 요청이 이 잡의 어떤 필드도 지정하지 않았다면 값의 출처가 전부
/// 파일이므로 보존 잡과 같은 처지다. 그때는 "손으로 고친 값을 바로잡으라"는 기존 문구가 맞는
/// 안내다. 한 필드라도 지정한 잡은 사용자가 방금 넣은 값이 문제일 수 있으므로 현행 오류를 쓴다.
fn validate_requested(
    job: ManagedJob,
    specified: bool,
) -> Result<ManagedJob, HeartbeatInstallError> {
    if !specified {
        return validate_preserved(job);
    }
    validate_managed_jobs(std::slice::from_ref(&job))?;
    Ok(job)
}

/// 관리 블록에서 읽은 역할 잡의 편집 가능 값. 블록에 없으면 빈 값이다.
fn block_role_settings(block: &[ManagedRoleJob], role: HeartbeatRole) -> PartialSettings {
    block
        .iter()
        .find(|job| job.role == role.as_argument())
        .map(|job| PartialSettings {
            model: job.model.clone(),
            interval: job.interval.clone(),
            max_per: job.max_per.clone(),
        })
        .unwrap_or_default()
}

/// 관리 블록에서 읽은 dream 잡의 편집 가능 값. 블록에 없으면 빈 값이다.
fn block_dream_settings(block: Option<&ManagedDreamJob>) -> PartialSettings {
    block
        .map(|job| PartialSettings {
            model: job.model.clone(),
            interval: job.interval.clone(),
            max_per: job.max_per.clone(),
        })
        .unwrap_or_default()
}

fn preserved_role_jobs(
    document: &str,
    slug: &str,
) -> Result<Vec<ManagedJob>, HeartbeatInstallError> {
    let block = managed_role_jobs(document, slug);
    let jobs = HeartbeatRole::ALL
        .iter()
        .filter(|role| block.iter().any(|job| job.role == role.as_argument()))
        .map(|role| RoleJob {
            role: *role,
            settings: block_role_settings(&block, *role)
                .over(role.default_settings().into())
                .into(),
        })
        .collect::<Vec<_>>();
    role_managed_jobs(&jobs, slug)
        .into_iter()
        .map(validate_preserved)
        .collect()
}

fn preserved_dream_job(
    document: &str,
    slug: &str,
) -> Result<Option<ManagedJob>, HeartbeatInstallError> {
    let Some(job) = managed_dream_job(document, slug) else {
        return Ok(None);
    };
    let settings =
        block_dream_settings(Some(&job)).over(heartbeat_dream::default_settings().into());
    Ok(Some(validate_preserved(heartbeat_dream::dream_job_with(
        slug,
        &settings.into(),
    ))?))
}

/// 이번 요청이 정하는 dream 잡. 기준은 관리 블록의 값이고 요청이 지정한 필드만 그 위에 덮는다.
fn requested_dream_job(
    dream: &DreamJobRequest,
    document: &str,
    slug: &str,
) -> Result<Option<ManagedJob>, HeartbeatInstallError> {
    if !dream.enabled {
        return Ok(None);
    }
    let requested = PartialSettings {
        model: dream.model.clone(),
        interval: dream.interval.clone(),
        max_per: dream.max_per.clone(),
    };
    let specified = !requested.specifies_nothing();
    let settings = requested.over(
        block_dream_settings(managed_dream_job(document, slug).as_ref())
            .over(heartbeat_dream::default_settings().into()),
    );
    let job = heartbeat_dream::dream_job_with(slug, &settings.into());
    Ok(Some(validate_requested(job, specified)?))
}

/// 병합에 쓸 현재 문서. 파일이 없는 것은 빈 문서이고 오류가 아니다. 읽지 못하는 파일은 오류로
/// 올린다. 못 읽은 문서를 빈 문서로 보면 다른 연동의 잡을 지우는 병합이 만들어진다.
fn read_document(path: &Path) -> Result<String, HeartbeatJobsError> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(HeartbeatJobsError::Io(error)),
    }
}

/// 상태 조회 결과를 하트비트 카드가 쓰는 payload로 옮긴다.
fn heartbeat_integration(
    status: HeartbeatStatus,
    condition_script_path: String,
    managed_jobs: Vec<ManagedRoleJob>,
) -> HeartbeatIntegration {
    let (installation, daemon_running) = split_installation(status.installation);
    HeartbeatIntegration {
        installation,
        daemon_running,
        condition_script_path,
        roles: status.roles,
        managed_jobs,
        duplicate_jobs: duplicates_of(&status.duplicate_jobs, heartbeat_status::INTEGRATION),
        read_failures: status.read_failures,
    }
}

/// dream 상태를 읽어 dream 카드가 쓰는 payload로 옮긴다.
fn dream_integration(
    heartbeat_home: &Path,
    slug: &str,
    heartbeat: IntegrationInstallation,
    managed_job: Option<ManagedDreamJob>,
    duplicate_jobs: Vec<DuplicateHeartbeatJob>,
) -> DreamIntegration {
    // 읽기 실패는 연동별로 담는다. 섹션 공통으로 올리면 어느 연동 때문인지 알 수 없다.
    // 상태 파일도 이 연동 몫으로 다시 읽는다. 하트비트와 한 번만 읽어 나눠 쓰면 상태 파일을 읽지
    // 못했을 때 어느 카드의 값이 비었는지 알 수 없다.
    let mut read_failures = Vec::new();
    let status = read_dream_status(heartbeat_home, slug, heartbeat, &mut read_failures);
    let last_run =
        read_job_runs(heartbeat_home, &mut read_failures).get(&heartbeat_dream::job_name(slug));
    DreamIntegration {
        installation: status.installation,
        heartbeat: status.heartbeat,
        refinement: status.refinement,
        skill_path: heartbeat_dream::skill_path(heartbeat_home)
            .display()
            .to_string(),
        // 실제로 설치될 잡에서 그대로 꺼낸다. 잡 정의가 바뀌면 화면 문구도 함께 바뀐다.
        condition_command: heartbeat_dream::dream_job(slug).condition,
        // 설치 경로가 쓰는 것과 같은 기본값이다(R5).
        defaults: heartbeat_dream::default_settings().into(),
        managed_job,
        last_run,
        duplicate_jobs,
        read_failures,
    }
}

/// 감지된 중복 잡 중 이 연동의 것만 고른다. 다른 연동의 중복은 그 연동 카드가 보여준다.
fn duplicates_of(jobs: &[DuplicateHeartbeatJob], integration: &str) -> Vec<DuplicateHeartbeatJob> {
    jobs.iter()
        .filter(|job| job.integration == integration)
        .cloned()
        .collect()
}

/// 화면이 쓰던 세 값을 연동 공통 설치 상태와 하트비트 부가 상태로 되돌린다.
/// `HeartbeatInstallationStatus::collapse`의 역이며, 조합에 없는 값은 판정상 생기지 않는다.
const fn split_installation(
    installation: HeartbeatInstallation,
) -> (IntegrationInstallation, bool) {
    match installation {
        HeartbeatInstallation::NotInstalled => (IntegrationInstallation::NotInstalled, false),
        HeartbeatInstallation::InstalledDaemonStopped => {
            (IntegrationInstallation::Installed, false)
        }
        HeartbeatInstallation::InstalledDaemonRunning => (IntegrationInstallation::Installed, true),
    }
}

/// 이번 요청이 정하는 역할 잡. 기준은 관리 블록의 값이고 요청이 지정한 필드만 그 위에 덮는다.
///
/// 활성 역할만 앱이 아는 순서대로 모은다. 요청 배열의 순서가 파일의 잡 순서를 바꾸지 않는다.
fn requested_role_jobs(
    roles: &[RoleJobRequest],
    document: &str,
    slug: &str,
) -> Result<Vec<ManagedJob>, HeartbeatInstallError> {
    if let Some(unknown) = roles.iter().find(|request| {
        !HeartbeatRole::ALL
            .iter()
            .any(|role| role.as_argument() == request.role)
    }) {
        return Err(HeartbeatInstallError::UnknownRole(unknown.role.clone()));
    }

    let block = managed_role_jobs(document, slug);
    let (jobs, specified): (Vec<_>, Vec<_>) = HeartbeatRole::ALL
        .iter()
        .filter_map(|role| {
            let request = roles
                .iter()
                .find(|request| request.role == role.as_argument())
                .filter(|request| request.enabled)?;
            let requested = PartialSettings {
                model: request.model.clone(),
                interval: request.interval.clone(),
                max_per: request.max_per.clone(),
            };
            let specified = !requested.specifies_nothing();
            let settings = requested
                .over(block_role_settings(&block, *role).over(role.default_settings().into()));
            Some((
                RoleJob {
                    role: *role,
                    settings: settings.into(),
                },
                specified,
            ))
        })
        .unzip();

    role_managed_jobs(&jobs, slug)
        .into_iter()
        .zip(specified)
        .map(|(job, specified)| validate_requested(job, specified))
        .collect()
}

/// 하트비트가 조건을 프로젝트 cwd에서 실행하므로 잡에 적히는 값도 이 상대 경로다.
/// `sh`가 실행할 값이라 OS와 무관하게 항상 `/` 구분자로 만든다.
fn condition_script_relative_path(project_root: &Path) -> String {
    let path = condition_script_path(&project_root.join(CONTROL_DIRECTORY));
    path.strip_prefix(project_root)
        .unwrap_or(&path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

/// 앱이 소유하는 필드와 앱이 다시 쓸 값. 편집 가능한 세 필드는 여기 없다.
///
/// 이 다섯은 잡 설정과 무관하게 잡 정의에서 나오므로, 대조용 잡은 기본 설정으로 만들어도 된다.
fn app_owned_fields(job: &ManagedJob) -> [(&'static str, &str); 5] {
    [
        ("slug", job.slug.as_str()),
        ("prompt", job.prompt.as_str()),
        ("timeout", job.timeout.as_str()),
        ("condition", job.condition.as_str()),
        ("notify", job.notify.as_str()),
    ]
}

/// 관리 블록에 적힌 잡과 앱이 다시 쓸 잡을 앱 소유 필드 단위로 대조한다(R4).
///
/// 그 줄이 블록에 아예 없는 경우도 다른 것으로 센다. 저장하면 앱 값이 그 자리에 적히므로 사용자가
/// 보게 되는 결과는 값을 고쳐 둔 경우와 같다.
fn app_owned_drift(file_job: &HeartbeatJob, app_job: &ManagedJob) -> Vec<String> {
    app_owned_fields(app_job)
        .into_iter()
        .filter(|(field, value)| file_job.field(field) != Some(value))
        .map(|(field, _)| field.to_owned())
        .collect()
}

/// 관리 블록 안의 역할 잡만 골라 편집 가능한 설정을 읽는다.
fn managed_role_jobs(document: &str, slug: &str) -> Vec<ManagedRoleJob> {
    let Some(block) = managed_block(document) else {
        return Vec::new();
    };
    let jobs = parse_heartbeat(block).jobs;
    // 대조용 잡이다. 파일에 쓰지 않으므로 편집 가능 값은 기본값이어도 되고, 잡 정의가 바뀌면 이
    // 값도 함께 바뀐다.
    let app_jobs = role_managed_jobs(
        &HeartbeatRole::ALL
            .iter()
            .map(|role| RoleJob {
                role: *role,
                settings: role.default_settings(),
            })
            .collect::<Vec<_>>(),
        slug,
    );
    HeartbeatRole::ALL
        .iter()
        .zip(app_jobs.iter())
        .filter_map(|(role, app_job)| {
            let name = job_name(*role, slug);
            let job = jobs.iter().find(|job| job.name == name)?;
            Some(ManagedRoleJob {
                role: role.as_argument().to_owned(),
                interval: job.field("interval").map(str::to_owned),
                max_per: job.field("max_per").map(str::to_owned),
                model: job.field("model").map(str::to_owned),
                app_owned_drift: app_owned_drift(job, app_job),
            })
        })
        .collect()
}

/// 관리 블록 안의 dream 잡에서 편집 가능한 설정을 읽는다. 블록에 없으면 `None`이다.
fn managed_dream_job(document: &str, slug: &str) -> Option<ManagedDreamJob> {
    let block = managed_block(document)?;
    let name = heartbeat_dream::job_name(slug);
    let job = parse_heartbeat(block)
        .jobs
        .into_iter()
        .find(|job| job.name == name)?;
    Some(ManagedDreamJob {
        interval: job.field("interval").map(str::to_owned),
        max_per: job.field("max_per").map(str::to_owned),
        model: job.field("model").map(str::to_owned),
        app_owned_drift: app_owned_drift(&job, &heartbeat_dream::dream_job(slug)),
    })
}

/// 마커 한 쌍 사이의 본문. 마커가 없으면 관리 블록이 없는 것으로 본다.
fn managed_block(document: &str) -> Option<&str> {
    let (_, rest) = document.split_once(MANAGED_START)?;
    let (block, _) = rest.split_once(MANAGED_END)?;
    Some(block)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use tempfile::tempdir;

    use super::{heartbeat_dream, managed_role_jobs, HeartbeatService};
    use crate::domain::project::IntegrationInstallation;
    use crate::infrastructure::heartbeat_jobs::{MANAGED_END, MANAGED_START};
    use crate::infrastructure::heartbeat_roles::HeartbeatRole;

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

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path());

        // 3단계. slug와 플랫폼 지원 여부는 섹션 공통 값이라 payload 밖에 있다.
        assert_eq!(snapshot.slug, SLUG);
        assert_eq!(snapshot.supported, !cfg!(windows));
        assert_eq!(
            snapshot.heartbeat.condition_script_path,
            ".workflow/rules/wf-eligible.sh"
        );
        assert_eq!(
            snapshot.heartbeat.installation,
            IntegrationInstallation::NotInstalled
        );
        assert!(!snapshot.heartbeat.daemon_running);
        assert!(snapshot.heartbeat.managed_jobs.is_empty());
    }

    /// 2단계. 배지 문구의 재료다. 화면의 세 값은 공통 설치 상태와 데몬 실행 여부의 조합으로 만든다.
    #[test]
    fn the_installation_is_reported_as_a_common_state_plus_the_daemon_flag() {
        let stopped = tempdir().expect("temporary directory");
        fs::write(stopped.path().join("HEARTBEAT.md"), "- tick: 5m\n").expect("seed document");
        let running = tempdir().expect("temporary directory");
        fs::create_dir(running.path().join("heartbeat")).expect("daemon directory");
        fs::write(running.path().join("heartbeat/heartbeat.pid"), "1234\n").expect("seed pid");

        let reported = [&stopped, &running].map(|home| {
            let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path());
            (
                snapshot.heartbeat.installation,
                snapshot.heartbeat.daemon_running,
            )
        });

        assert_eq!(
            reported,
            [
                (IntegrationInstallation::Installed, false),
                (IntegrationInstallation::Installed, true),
            ]
        );
    }

    /// 중복 잡은 연동별로 나뉜다. 하트비트 카드에 dream 중복이 섞이면 안 된다.
    #[test]
    fn only_the_duplicates_of_this_integration_reach_the_heartbeat_payload() {
        let home = tempdir().expect("temporary directory");
        fs::write(
            home.path().join("HEARTBEAT.md"),
            format!(
                "## wf-developer\n- slug: {SLUG}\n- condition: sh scripts/wf-eligible.sh developer\n\n## dream-labs\n- slug: {SLUG}\n- condition: dream-prep check-unprocessed --slug={SLUG}\n"
            ),
        )
        .expect("seed document");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path());

        let reported = snapshot
            .heartbeat
            .duplicate_jobs
            .iter()
            .map(|job| job.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(reported, vec!["wf-developer"]);
    }

    /// R2. dream 카드의 세 상태는 하트비트 설치 여부와 dream 스킬 설치 여부의 조합이다.
    #[test]
    fn the_dream_payload_carries_the_two_checks_behind_the_three_states() {
        let nothing = tempdir().expect("temporary directory");
        let heartbeat_only = tempdir().expect("temporary directory");
        fs::write(heartbeat_only.path().join("HEARTBEAT.md"), "- tick: 5m\n")
            .expect("seed document");
        let both = tempdir().expect("temporary directory");
        fs::write(both.path().join("HEARTBEAT.md"), "- tick: 5m\n").expect("seed document");
        write_skill(both.path());

        let reported = [&nothing, &heartbeat_only, &both].map(|home| {
            let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path());
            (snapshot.dream.heartbeat, snapshot.dream.installation)
        });

        assert_eq!(
            reported,
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

    /// 화면이 조건 문자열을 다시 조립하지 않도록 설치될 잡의 값을 그대로 싣는다. 판정 경로도 같다.
    #[test]
    fn the_dream_payload_carries_the_condition_command_and_the_skill_path() {
        let home = tempdir().expect("temporary directory");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path());

        assert_eq!(
            snapshot.dream.condition_command,
            format!("dream-prep check-unprocessed --slug={SLUG}")
        );
        assert_eq!(
            snapshot.dream.skill_path,
            home.path()
                .join("skills/dream/SKILL.md")
                .display()
                .to_string()
        );
    }

    /// R5. 앱 기본값의 출처는 잡 정의 하나다. 스냅샷이 그 값을 그대로 실어 화면이 같은 상수를
    /// 따로 두지 않게 한다. 두 정의가 갈라지면 "기본값으로 되돌렸는데 미설치 상태에서 시작하는
    /// 값과 다르다"가 된다.
    #[test]
    fn the_snapshot_carries_the_app_defaults_of_every_role_job() {
        let home = tempdir().expect("temporary directory");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path());

        assert_eq!(snapshot.heartbeat.roles.len(), HeartbeatRole::ALL.len());
        for role in HeartbeatRole::ALL {
            let reported = snapshot
                .heartbeat
                .roles
                .iter()
                .find(|status| status.role == role.as_argument())
                .expect("role status");
            assert_eq!(reported.defaults, role.default_settings().into());
        }
        // 역할마다 값이 다르므로 역할별로 실려야 한다. 하나로 접으면 개발자 잡이 다른 값으로
        // 되돌아간다.
        let developer = snapshot
            .heartbeat
            .roles
            .iter()
            .find(|status| status.role == "developer")
            .expect("developer status");
        assert_eq!(developer.defaults.interval, "20m");
        assert_eq!(developer.defaults.max_per, "6/24h");
    }

    /// R5. dream도 같은 규칙이다. 잡이 하나라 payload에 하나만 실린다.
    #[test]
    fn the_snapshot_carries_the_app_defaults_of_the_dream_job() {
        let home = tempdir().expect("temporary directory");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path());

        assert_eq!(
            snapshot.dream.defaults,
            heartbeat_dream::default_settings().into()
        );
    }

    /// R3. 정제 상태는 파일에서 센 값이 그대로 payload에 실린다.
    #[test]
    fn the_dream_payload_carries_the_refinement_counts() {
        let home = tempdir().expect("temporary directory");
        write_skill(home.path());
        for index in 1..=3 {
            write_home_file(
                home.path(),
                &format!("projects/{SLUG}/t{index}.jsonl"),
                "{}\n",
            );
        }
        write_home_file(
            home.path(),
            &format!("projects/{SLUG}/memory/dream_meta.md"),
            "last_dream: 2026-07-19T19:25:01\n\nprocessed_v2:\n- file: t1.jsonl\n",
        );
        write_home_file(
            home.path(),
            &format!("projects/{SLUG}/memory/topic.md"),
            "---\nname: topic\n---\n",
        );

        let refinement = HeartbeatService
            .inspect(Path::new(PROJECT_ROOT), home.path())
            .dream
            .refinement;

        assert_eq!(refinement.total_transcripts, 3);
        assert_eq!(refinement.marked_transcripts, 1);
        assert_eq!(refinement.unrefined_transcripts, 2);
        assert_eq!(
            refinement.last_dream.as_deref(),
            Some("2026-07-19T19:25:01")
        );
        assert_eq!(refinement.memory_topics, 1);
    }

    /// R6. dream 중복 잡은 dream payload에만 담긴다.
    #[test]
    fn only_the_duplicates_of_this_integration_reach_the_dream_payload() {
        let home = tempdir().expect("temporary directory");
        fs::write(
            home.path().join("HEARTBEAT.md"),
            format!(
                "## wf-developer\n- slug: {SLUG}\n- condition: sh scripts/wf-eligible.sh developer\n\n## dream-labs\n- slug: {SLUG}\n- condition: dream-prep check-unprocessed --slug={SLUG}\n"
            ),
        )
        .expect("seed document");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path());

        let reported = snapshot
            .dream
            .duplicate_jobs
            .iter()
            .map(|job| (job.name.as_str(), job.role.as_deref()))
            .collect::<Vec<_>>();
        assert_eq!(reported, vec![("dream-labs", None)]);
    }

    /// R2. 파일이 없는 것은 읽기 실패가 아니다. 첫 설치 화면이 이 판정 위에 서 있다.
    #[test]
    fn an_absent_document_counts_as_read_with_no_jobs() {
        let home = tempdir().expect("temporary directory");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path());

        assert!(snapshot.managed_block_failure.is_none());
        assert!(snapshot.heartbeat.managed_jobs.is_empty());
        assert!(snapshot.dream.managed_job.is_none());
    }

    /// R2 회귀. 읽을 수 있는 문서에서는 잡 목록이 현행 그대로 나온다.
    #[test]
    fn a_readable_document_reports_its_jobs_and_no_failure() {
        let home = tempdir().expect("temporary directory");
        fs::write(
            home.path().join("HEARTBEAT.md"),
            format!(
                "{MANAGED_START}\n{}{MANAGED_END}\n",
                developer_job(&format!("wf-developer{SLUG}"))
            ),
        )
        .expect("seed document");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path());

        assert!(snapshot.managed_block_failure.is_none());
        assert_eq!(snapshot.heartbeat.managed_jobs.len(), 1);
        assert_eq!(snapshot.heartbeat.managed_jobs[0].role, "developer");
        assert_eq!(
            snapshot.heartbeat.managed_jobs[0].max_per.as_deref(),
            Some("6/24h")
        );
    }

    /// R2. 읽지 못한 문서는 빈 문서와 다른 상태다. 잡 목록은 비지만 그 사실을 사유와 함께 밝힌다.
    /// 권한을 바꿀 수 있는 unix에서만 재현한다.
    #[cfg(unix)]
    #[test]
    fn an_unreadable_document_is_reported_with_its_path_and_reason() {
        use std::os::unix::fs::PermissionsExt;

        let home = tempdir().expect("temporary directory");
        let path = home.path().join("HEARTBEAT.md");
        fs::write(
            &path,
            format!(
                "{MANAGED_START}\n{}{MANAGED_END}\n",
                developer_job(&format!("wf-developer{SLUG}"))
            ),
        )
        .expect("seed document");
        // 테스트가 만든 임시 디렉터리 안에서만 권한을 바꾼다.
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).expect("lock document");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path());

        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("restore permissions");

        let failure = snapshot
            .managed_block_failure
            .expect("managed block read failure");
        assert_eq!(failure.path, path.display().to_string());
        assert!(!failure.message.is_empty());
        // 못 읽은 파일도 존재는 하므로 설치 판정은 그대로 "설치됨"이다.
        assert_eq!(
            snapshot.heartbeat.installation,
            IntegrationInstallation::Installed
        );
        assert!(snapshot.heartbeat.managed_jobs.is_empty());
        assert!(snapshot.dream.managed_job.is_none());
    }

    fn write_skill(home: &Path) {
        write_home_file(home, "skills/dream/SKILL.md", "# dream\n");
    }

    /// 테스트 픽스처만 쓴다. 조회 경로는 아무것도 쓰지 않는다.
    fn write_home_file(home: &Path, relative: &str, contents: &str) {
        let path = home.join(relative);
        fs::create_dir_all(path.parent().expect("fixture directory")).expect("fixture directory");
        fs::write(path, contents).expect("fixture file");
    }
}

/// 설치는 POSIX `sh` 조건 스크립트를 전제하므로 지원 플랫폼에서만 검증한다.
#[cfg(all(test, not(windows)))]
mod install_tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use tempfile::{tempdir, TempDir};

    use super::{
        managed_dream_job, managed_role_jobs, DreamJobRequest, HeartbeatInstallError,
        HeartbeatService, IntegrationsSnapshot, ManagedDreamJob, ManagedRoleJob, RoleJobRequest,
        HEARTBEAT_FILE,
    };
    use crate::infrastructure::heartbeat_condition::condition_script_path;
    use crate::infrastructure::heartbeat_jobs::{
        project_slug, HeartbeatJobsError, MANAGED_END, MANAGED_START,
    };

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
            interval: Some(interval.to_owned()),
            max_per: Some(max_per.to_owned()),
            model: Some("opus".to_owned()),
        }
    }

    /// 사용자가 이 잡의 어떤 필드도 지정하지 않은 요청. 토글만 정하고 값은 파일에 맡긴다.
    fn untouched(role: &str, enabled: bool) -> RoleJobRequest {
        RoleJobRequest {
            role: role.to_owned(),
            enabled,
            interval: None,
            max_per: None,
            model: None,
        }
    }

    fn all_enabled() -> Vec<RoleJobRequest> {
        vec![
            request("planner", true),
            request("architect", true),
            request("developer", true),
        ]
    }

    /// 화면의 기본값 재설정 액션이 만드는 요청(R5). 대상 잡만 앱 기본값을 명시값으로 싣고 나머지
    /// 잡은 전부 미지정으로 둔다. `enabled`는 폼의 토글이 아니라 관리 블록 기준이다.
    fn reset_request(target: &str, in_block: &[&str]) -> Vec<RoleJobRequest> {
        ["planner", "architect", "developer"]
            .into_iter()
            .map(|role| {
                let enabled = in_block.contains(&role);
                if role == target {
                    request(role, enabled)
                } else {
                    untouched(role, enabled)
                }
            })
            .collect()
    }

    /// 세 역할을 켜기만 하고 값은 하나도 지정하지 않은 요청.
    fn all_untouched() -> Vec<RoleJobRequest> {
        vec![
            untouched("planner", true),
            untouched("architect", true),
            untouched("developer", true),
        ]
    }

    /// R5 기본값. 화면이 처음 보여주는 값과 같다.
    fn dream_request(enabled: bool) -> DreamJobRequest {
        DreamJobRequest {
            enabled,
            interval: Some("2h".to_owned()),
            max_per: Some("6/24h".to_owned()),
            model: Some("opus".to_owned()),
        }
    }

    /// 사용자가 dream 잡의 어떤 필드도 지정하지 않은 요청.
    fn untouched_dream_request(enabled: bool) -> DreamJobRequest {
        DreamJobRequest {
            enabled,
            interval: None,
            max_per: None,
            model: None,
        }
    }

    /// 파일에 적힌 그대로의 기준값. 화면이 방금 읽어 폼을 시딩한 상태와 같다(R3).
    fn role_baseline(project: &TempDir, home: &TempDir) -> Vec<ManagedRoleJob> {
        let document = fs::read_to_string(heartbeat_file(home)).unwrap_or_default();
        managed_role_jobs(&document, &project_slug(project.path()))
    }

    fn dream_baseline(project: &TempDir, home: &TempDir) -> Option<ManagedDreamJob> {
        let document = fs::read_to_string(heartbeat_file(home)).unwrap_or_default();
        managed_dream_job(&document, &project_slug(project.path()))
    }

    /// 기준값을 파일에서 그대로 만들어 넘긴다. 대조를 따로 다루는 시험만 낡은 기준값을 쓴다.
    fn install(
        project: &TempDir,
        home: &TempDir,
        roles: &[RoleJobRequest],
    ) -> Result<IntegrationsSnapshot, HeartbeatInstallError> {
        install_with(project, home, roles, &role_baseline(project, home))
    }

    fn install_with(
        project: &TempDir,
        home: &TempDir,
        roles: &[RoleJobRequest],
        baseline: &[ManagedRoleJob],
    ) -> Result<IntegrationsSnapshot, HeartbeatInstallError> {
        HeartbeatService.install(project.path(), home.path(), roles, baseline)
    }

    fn install_dream(
        project: &TempDir,
        home: &TempDir,
        dream: &DreamJobRequest,
    ) -> Result<IntegrationsSnapshot, HeartbeatInstallError> {
        let baseline = dream_baseline(project, home);
        install_dream_with(project, home, dream, baseline.as_ref())
    }

    fn install_dream_with(
        project: &TempDir,
        home: &TempDir,
        dream: &DreamJobRequest,
        baseline: Option<&ManagedDreamJob>,
    ) -> Result<IntegrationsSnapshot, HeartbeatInstallError> {
        HeartbeatService.install_dream(project.path(), home.path(), dream, baseline)
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

        let installed = install(&project, &home, &all_enabled()).expect("install");

        let script = snapshot(&script_file(&project)).expect("condition script");
        assert!(script.contains("# managed_by: workflow-labs"));

        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        for role in ["planner", "architect", "developer"] {
            assert!(document.contains(&format!("## wf-{role}{}", installed.slug)));
            assert!(document.contains(&format!(
                "- condition: sh .workflow/rules/wf-eligible.sh {role}"
            )));
        }

        // 5단계. 프론트가 상태를 다시 조회하지 않아도 되도록 갱신된 스냅샷을 함께 돌려준다.
        assert_eq!(installed.heartbeat.managed_jobs.len(), 3);
    }

    #[test]
    fn an_invalid_setting_writes_neither_file() {
        let (project, home) = workspace();
        let mut roles = all_enabled();
        roles[0].interval = Some("30분".to_owned());

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
        let updated = install(&project, &home, &disabled).expect("disable architect");
        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        assert!(!document.contains(&format!("## wf-architect{}", updated.slug)));
        assert_eq!(updated.heartbeat.managed_jobs.len(), 2);

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
        let cleared = install(&project, &home, &disabled).expect("disable all");

        assert!(cleared.heartbeat.managed_jobs.is_empty());
        assert_eq!(snapshot(&heartbeat_file(&home)).as_deref(), Some(""));
        assert_eq!(snapshot(&script_file(&project)), script);
    }

    /// 완료 조건 4. 연동이 둘이어도 마커 블록은 하나다.
    #[test]
    fn installing_only_the_dream_job_writes_one_block_with_one_job() {
        let (project, home) = workspace();

        let installed = install_dream(&project, &home, &dream_request(true)).expect("install");

        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        assert_eq!(document.matches(MANAGED_START).count(), 1);
        assert_eq!(document.matches(MANAGED_END).count(), 1);
        assert_eq!(
            document.matches("## ").count(),
            1,
            "블록에 dream 잡 하나만 있어야 한다: {document}"
        );
        assert!(document.contains(&format!("## wf-dream{}", installed.slug)));
        assert!(installed.heartbeat.managed_jobs.is_empty());
        assert!(installed.dream.managed_job.is_some());
    }

    /// dream 설치 경로는 조건 스크립트를 쓰지 않는다. 프로젝트 로컬에 파일이 생기면 안 된다.
    #[test]
    fn installing_only_the_dream_job_writes_no_project_local_file() {
        let (project, home) = workspace();

        install_dream(&project, &home, &dream_request(true)).expect("install");

        assert_eq!(snapshot(&script_file(&project)), None);
        assert!(!project.path().join(".workflow").exists());
    }

    /// 완료 조건 6. 역할 잡 값은 dream 설치가 건드리지 않고, dream 잡은 역할 잡 뒤에 붙는다.
    #[test]
    fn installing_dream_keeps_the_role_jobs_byte_for_byte_and_appends_after_them() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install roles");
        let roles_only = snapshot(&heartbeat_file(&home)).expect("heartbeat file");

        install_dream(&project, &home, &dream_request(true)).expect("install dream");

        let both = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        let head = roles_only
            .strip_suffix(&format!("{MANAGED_END}\n"))
            .expect("end marker");
        assert!(
            both.starts_with(head),
            "역할 잡 부분이 그대로여야 한다: {both}"
        );
        assert!(both.contains("## wf-dream"));
        assert_eq!(both.matches(MANAGED_START).count(), 1);
    }

    /// 완료 조건 6. 반대 방향도 성립한다. 역할 잡 저장이 dream 잡을 지우지 않는다.
    #[test]
    fn saving_role_jobs_keeps_an_installed_dream_job() {
        let (project, home) = workspace();
        install_dream(&project, &home, &dream_request(true)).expect("install dream");

        let mut roles = all_enabled();
        roles[2].interval = Some("45m".to_owned());
        let updated = install(&project, &home, &roles).expect("save roles");

        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        assert!(document.contains("## wf-dream"));
        assert!(document.contains("- interval: 45m"));
        assert_eq!(updated.heartbeat.managed_jobs.len(), 3);
        assert!(updated.dream.managed_job.is_some());
    }

    /// 설치 순서는 결과에 남지 않는다. 잡 순서는 연동 목록 순서로 고정한다.
    /// slug가 프로젝트 경로에서 나오므로 두 순서가 같은 프로젝트를 쓰고 하트비트 홈만 나눈다.
    #[test]
    fn the_install_order_does_not_change_the_file() {
        let (project, roles_first) = workspace();
        let dream_first = tempdir().expect("heartbeat home");

        install(&project, &roles_first, &all_enabled()).expect("roles");
        install_dream(&project, &roles_first, &dream_request(true)).expect("dream");

        install_dream(&project, &dream_first, &dream_request(true)).expect("dream");
        install(&project, &dream_first, &all_enabled()).expect("roles");

        assert_eq!(
            snapshot(&heartbeat_file(&roles_first)),
            snapshot(&heartbeat_file(&dream_first))
        );
    }

    /// 완료 조건 5.
    #[test]
    fn the_same_dream_install_twice_does_not_change_the_file() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install roles");
        install_dream(&project, &home, &dream_request(true)).expect("first install");
        let first = snapshot(&heartbeat_file(&home));

        install_dream(&project, &home, &dream_request(true)).expect("second install");

        assert_eq!(snapshot(&heartbeat_file(&home)), first);
    }

    /// 완료 조건 7.
    #[test]
    fn turning_the_dream_job_off_and_on_restores_the_first_install() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install roles");
        install_dream(&project, &home, &dream_request(true)).expect("install dream");
        let first = snapshot(&heartbeat_file(&home));

        let disabled = install_dream(&project, &home, &dream_request(false)).expect("disable");
        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        assert!(!document.contains("## wf-dream"));
        assert_eq!(disabled.heartbeat.managed_jobs.len(), 3);
        assert_eq!(disabled.dream.managed_job, None);

        install_dream(&project, &home, &dream_request(true)).expect("enable");
        assert_eq!(snapshot(&heartbeat_file(&home)), first);
    }

    /// 완료 조건 6의 "둘 다 없음" 조합. 블록 밖 원문은 바이트 단위로 남는다.
    #[test]
    fn turning_both_integrations_off_removes_the_block_and_keeps_the_rest() {
        let (project, home) = workspace();
        let original = "# HEARTBEAT\n- tick: 5m\n\n## my-job\n- slug: -tmp-demo\n- prompt: 안녕\n";
        fs::write(heartbeat_file(&home), original).expect("seed heartbeat file");
        install(&project, &home, &all_enabled()).expect("install roles");
        install_dream(&project, &home, &dream_request(true)).expect("install dream");

        install_dream(&project, &home, &dream_request(false)).expect("disable dream");
        let disabled = vec![
            request("planner", false),
            request("architect", false),
            request("developer", false),
        ];
        install(&project, &home, &disabled).expect("disable roles");

        assert_eq!(snapshot(&heartbeat_file(&home)).as_deref(), Some(original));
    }

    /// 보존 대상 잡을 손으로 깨뜨린 경우. 조용히 기본값으로 되돌리지 않고 어느 잡·필드인지 밝힌다.
    #[test]
    fn a_damaged_preserved_role_job_stops_the_dream_install() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install roles");
        let damaged = snapshot(&heartbeat_file(&home))
            .expect("heartbeat file")
            .replace("- interval: 20m", "- interval: 20분");
        fs::write(heartbeat_file(&home), &damaged).expect("damage file");

        let error = install_dream(&project, &home, &dream_request(true)).expect_err("must fail");

        let message = error.to_string();
        assert!(message.contains("wf-developer"), "잡 이름: {message}");
        assert!(message.contains("interval"), "필드 이름: {message}");
        assert_eq!(snapshot(&heartbeat_file(&home)), Some(damaged));
    }

    #[test]
    fn an_invalid_dream_setting_writes_nothing() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install roles");
        let installed = snapshot(&heartbeat_file(&home));
        let mut dream = dream_request(true);
        dream.interval = Some("2시간".to_owned());

        let error = install_dream(&project, &home, &dream).expect_err("must fail");

        assert!(matches!(
            error,
            HeartbeatInstallError::Jobs(HeartbeatJobsError::InvalidValue {
                field: "interval",
                ..
            })
        ));
        assert_eq!(snapshot(&heartbeat_file(&home)), installed);
    }

    #[test]
    fn damaged_markers_stop_the_dream_install_without_touching_the_file() {
        let (project, home) = workspace();
        let original = format!("## my-job\n- slug: -tmp-demo\n\n{MANAGED_START}\n");
        fs::write(heartbeat_file(&home), &original).expect("seed heartbeat file");

        let error = install_dream(&project, &home, &dream_request(true)).expect_err("must fail");

        assert!(matches!(
            error,
            HeartbeatInstallError::Jobs(HeartbeatJobsError::Markers { .. })
        ));
        assert_eq!(snapshot(&heartbeat_file(&home)), Some(original));
    }

    /// dream 잡이 블록 마지막이 되므로 종료 마커 뒤 흡수 줄 검사가 계속 필요하다.
    #[test]
    fn a_field_line_after_the_end_marker_stops_the_dream_install() {
        let (project, home) = workspace();
        install_dream(&project, &home, &dream_request(true)).expect("install dream");
        let damaged = format!(
            "{}\n- tick: 5m\n",
            snapshot(&heartbeat_file(&home))
                .expect("heartbeat file")
                .trim_end()
        );
        fs::write(heartbeat_file(&home), &damaged).expect("damage file");

        let error = install_dream(&project, &home, &dream_request(true)).expect_err("must fail");

        assert!(matches!(
            error,
            HeartbeatInstallError::Jobs(HeartbeatJobsError::AbsorbedLine { .. })
        ));
        assert_eq!(snapshot(&heartbeat_file(&home)), Some(damaged));
    }

    /// SPEC-005 완료 조건 1. 관측된 사고 그 자체다. 화면에서 건드리지 않은 실행 한도가 살아남는다.
    #[test]
    fn a_field_the_request_does_not_specify_keeps_the_value_written_in_the_block() {
        let (project, home) = workspace();
        let mut edited = all_enabled();
        edited[2].max_per = Some("8/24h".to_owned());
        install(&project, &home, &edited).expect("install with an edited quota");

        let mut roles = all_untouched();
        roles[2].interval = Some("45m".to_owned());
        install(&project, &home, &roles).expect("save the interval only");

        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        assert!(document.contains("- interval: 45m"), "{document}");
        assert!(
            document.contains("- max_per: 8/24h"),
            "편집한 실행 한도가 남아야 한다: {document}"
        );
    }

    /// SPEC-005 완료 조건 2·13. 화면이 값을 잘못 들고 있어도 지정하지 않은 필드는 파일 값이 이긴다.
    #[test]
    fn a_request_that_specifies_nothing_does_not_change_the_file() {
        let (project, home) = workspace();
        let mut edited = all_enabled();
        edited[2].interval = Some("45m".to_owned());
        edited[2].max_per = Some("8/24h".to_owned());
        install(&project, &home, &edited).expect("install with edited values");
        let before = snapshot(&heartbeat_file(&home));

        install(&project, &home, &all_untouched()).expect("save without specifying anything");

        assert_eq!(snapshot(&heartbeat_file(&home)), before);
    }

    /// 첫 설치 회귀. 블록에 없는 잡은 지정하지 않은 필드가 앱 기본값으로 만들어진다.
    /// 두 홈이 같은 프로젝트를 쓰므로 slug도 같고, 결과는 바이트 단위로 같아야 한다.
    #[test]
    fn a_job_absent_from_the_block_starts_from_the_app_defaults() {
        let (project, spelled_out) = workspace();
        let untouched_home = tempdir().expect("heartbeat home");

        install(&project, &spelled_out, &all_enabled()).expect("install with explicit defaults");
        install(&project, &untouched_home, &all_untouched()).expect("install without any value");

        assert_eq!(
            snapshot(&heartbeat_file(&untouched_home)),
            snapshot(&heartbeat_file(&spelled_out))
        );
    }

    /// SPEC-005 완료 조건 11·12. 화면의 재설정 액션이 만드는 요청을 파일까지 따라가 확인한다.
    ///
    /// 기획자 잡이 블록에 없는 상태에서 개발자 잡만 되돌린다. 대상 잡의 값만 앱 기본값으로
    /// 돌아가고, 같은 블록의 아키텍트 편집값과 잡 목록은 그대로여야 한다.
    #[test]
    fn resetting_one_job_keeps_the_other_values_and_the_job_list() {
        let (project, home) = workspace();
        let mut edited = vec![
            untouched("planner", false),
            request("architect", true),
            request("developer", true),
        ];
        edited[1].max_per = Some("8/24h".to_owned());
        edited[2].max_per = Some("16/24h".to_owned());
        install(&project, &home, &edited).expect("install with edited quotas");

        install(
            &project,
            &home,
            &reset_request("developer", &["architect", "developer"]),
        )
        .expect("reset the developer job");

        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        assert!(
            document.contains("- max_per: 8/24h"),
            "아키텍트 편집값이 남아야 한다: {document}"
        );
        assert!(
            document.contains("- max_per: 6/24h"),
            "개발자가 기본값으로 돌아가야 한다: {document}"
        );
        assert!(!document.contains("16/24h"), "{document}");
        // 잡 목록은 그대로다. 재설정은 편집 가능 값만 되돌린다.
        assert_eq!(document.matches("## wf-").count(), 2, "{document}");
        assert!(!document.contains("## wf-planner"), "{document}");
    }

    /// SPEC-005 완료 조건 14. SPEC-004 R3의 목록 밖 모델 보존과 충돌하지 않는다.
    #[test]
    fn an_unlisted_model_survives_a_save_that_does_not_specify_it() {
        let (project, home) = workspace();
        let mut edited = all_enabled();
        edited[2].model = Some("claude-opus-5".to_owned());
        install(&project, &home, &edited).expect("install with an unlisted model");

        let mut roles = all_untouched();
        roles[2].interval = Some("45m".to_owned());
        install(&project, &home, &roles).expect("save the interval only");

        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        assert!(
            document.contains("- model: claude-opus-5"),
            "목록 밖 모델명이 남아야 한다: {document}"
        );
    }

    /// 요청이 아무 필드도 지정하지 않은 잡은 보존 잡과 같은 처지다. 조용히 기본값으로 되돌리지 않고
    /// 같은 안내로 실패한다.
    #[test]
    fn a_damaged_value_the_request_does_not_specify_fails_as_a_preserved_job() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let damaged = snapshot(&heartbeat_file(&home))
            .expect("heartbeat file")
            .replace("- interval: 20m", "- interval: 20분");
        fs::write(heartbeat_file(&home), &damaged).expect("damage file");

        let error = install(&project, &home, &all_untouched()).expect_err("must fail");

        match &error {
            HeartbeatInstallError::PreservedJob { job, .. } => {
                assert!(job.contains("wf-developer"), "잡 이름: {job}")
            }
            other => panic!("unexpected error: {other}"),
        }
        assert!(error.to_string().contains("손으로 고쳤다면"));
        assert_eq!(snapshot(&heartbeat_file(&home)), Some(damaged));
    }

    /// SPEC-005 완료 조건 3. dream 잡에도 같은 규칙이 적용된다.
    #[test]
    fn a_dream_field_the_request_does_not_specify_keeps_the_value_written_in_the_block() {
        let (project, home) = workspace();
        let mut edited = dream_request(true);
        edited.max_per = Some("2/24h".to_owned());
        install_dream(&project, &home, &edited).expect("install with an edited quota");

        let mut dream = untouched_dream_request(true);
        dream.interval = Some("6h".to_owned());
        install_dream(&project, &home, &dream).expect("save the interval only");

        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        assert!(document.contains("- interval: 6h"), "{document}");
        assert!(
            document.contains("- max_per: 2/24h"),
            "편집한 실행 한도가 남아야 한다: {document}"
        );
    }

    /// SPEC-005 완료 조건 2·3·13의 dream 쪽 짝.
    #[test]
    fn a_dream_request_that_specifies_nothing_does_not_change_the_file() {
        let (project, home) = workspace();
        let mut edited = dream_request(true);
        edited.interval = Some("6h".to_owned());
        edited.max_per = Some("2/24h".to_owned());
        install_dream(&project, &home, &edited).expect("install with edited values");
        let before = snapshot(&heartbeat_file(&home));

        install_dream(&project, &home, &untouched_dream_request(true))
            .expect("save without specifying anything");

        assert_eq!(snapshot(&heartbeat_file(&home)), before);
    }

    /// R4. 앱 소유 필드를 손으로 고쳐 두면 저장할 때 앱 값이 다시 쓰인다. 확인 화면이 그 사실을
    /// 밝히려면 스냅샷이 어느 필드인지 알려 줘야 한다. 앱이 쓴 문서에는 그런 필드가 없다.
    #[test]
    fn a_hand_edited_app_owned_field_is_reported_by_name() {
        let (project, home) = workspace();
        let installed = install(&project, &home, &all_enabled()).expect("install");
        assert!(
            installed
                .heartbeat
                .managed_jobs
                .iter()
                .all(|job| job.app_owned_drift.is_empty()),
            "앱이 쓴 문서에는 되돌아갈 필드가 없다"
        );

        // 개발자 잡의 timeout만 다른 값이다. 다른 역할 잡의 timeout은 20m이라 이 치환에 걸리지 않는다.
        let edited = snapshot(&heartbeat_file(&home))
            .expect("heartbeat file")
            .replace("- timeout: 30m", "- timeout: 5m");
        fs::write(heartbeat_file(&home), edited).expect("hand edit the file");

        let snapshot = HeartbeatService.inspect(project.path(), home.path());

        let reported = snapshot
            .heartbeat
            .managed_jobs
            .iter()
            .map(|job| (job.role.as_str(), job.app_owned_drift.clone()))
            .collect::<Vec<_>>();
        assert_eq!(
            reported,
            vec![
                ("planner", Vec::new()),
                ("architect", Vec::new()),
                ("developer", vec!["timeout".to_owned()]),
            ]
        );
    }

    /// R4. dream 잡도 같은 값을 싣는다. 두 카드가 같은 표시 요소를 쓰므로 판정도 같아야 한다.
    #[test]
    fn a_hand_edited_app_owned_field_of_the_dream_job_is_reported_by_name() {
        let (project, home) = workspace();
        let installed = install_dream(&project, &home, &dream_request(true)).expect("install");
        let job = installed.dream.managed_job.expect("dream job");
        assert!(job.app_owned_drift.is_empty());

        let edited = snapshot(&heartbeat_file(&home))
            .expect("heartbeat file")
            .replace("- notify: all", "- notify: none");
        fs::write(heartbeat_file(&home), edited).expect("hand edit the file");

        let snapshot = HeartbeatService.inspect(project.path(), home.path());

        let job = snapshot.dream.managed_job.expect("dream job");
        assert_eq!(job.app_owned_drift, vec!["notify".to_owned()]);
        // 편집 가능 값은 대조 대상이 아니다.
        assert_eq!(job.interval.as_deref(), Some("2h"));
    }

    /// R3. 기준값과 파일이 같으면 현행대로 쓴다. 다른 시험들이 전부 파일에서 만든 기준값을 쓰므로
    /// 이 성질은 이 모듈 전체가 함께 지키지만, 대조가 통과 경로를 막지 않는다는 사실을 따로 남긴다.
    #[test]
    fn a_baseline_that_matches_the_file_writes_as_before() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("first install");
        let mut edited = all_enabled();
        edited[2].interval = Some("45m".to_owned());

        install_with(&project, &home, &edited, &role_baseline(&project, &home))
            .expect("save with a matching baseline");

        let document = snapshot(&heartbeat_file(&home)).expect("heartbeat file");
        assert!(document.contains("- interval: 45m"));
    }

    /// R3. 화면이 읽은 뒤 잡이 생겼다. 조건 스크립트도 새로 생기면 안 된다.
    #[test]
    fn a_role_job_added_after_the_screen_read_writes_neither_file() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let document = snapshot(&heartbeat_file(&home));
        fs::remove_file(script_file(&project)).expect("remove the condition script");

        // 화면은 잡이 하나도 없던 시점을 읽었다.
        let error = install_with(&project, &home, &all_enabled(), &[]).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ManagedBlockChanged));
        assert_eq!(snapshot(&heartbeat_file(&home)), document);
        assert_eq!(snapshot(&script_file(&project)), None);
    }

    /// R3. 화면이 읽은 뒤 잡이 사라진 경우도 같은 판정이다.
    #[test]
    fn a_role_job_removed_after_the_screen_read_writes_neither_file() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let stale = role_baseline(&project, &home);
        // 파일에서 세 잡을 모두 지운다. 화면은 아직 세 잡이 있던 시점을 들고 있다.
        install(&project, &home, &[]).expect("remove every role job");
        let document = snapshot(&heartbeat_file(&home));

        let error = install_with(&project, &home, &all_enabled(), &stale).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ManagedBlockChanged));
        assert_eq!(snapshot(&heartbeat_file(&home)), document);
    }

    /// R3. 값만 바뀐 경우. 사고의 원형이라 값 수준의 차이도 잡아야 한다.
    #[test]
    fn a_role_job_value_changed_after_the_screen_read_writes_neither_file() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let stale = role_baseline(&project, &home);
        let edited = snapshot(&heartbeat_file(&home))
            .expect("heartbeat file")
            .replace("- max_per: 6/24h", "- max_per: 9/24h");
        fs::write(heartbeat_file(&home), &edited).expect("hand edit the file");

        let error = install_with(&project, &home, &all_enabled(), &stale).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ManagedBlockChanged));
        assert_eq!(snapshot(&heartbeat_file(&home)), Some(edited));
    }

    /// R3. 대조 범위는 그 요청이 관장하는 잡뿐이다. 다른 연동의 잡이 바뀐 것은 현행 보존 규칙이
    /// 그대로 집어 올리므로 역할 잡 쓰기를 막을 이유가 없다.
    #[test]
    fn only_the_dream_job_changing_does_not_stop_a_role_job_write() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install role jobs");
        install_dream(&project, &home, &dream_request(true)).expect("install the dream job");
        let stale = role_baseline(&project, &home);
        let edited = snapshot(&heartbeat_file(&home))
            .expect("heartbeat file")
            .replace("- interval: 2h", "- interval: 6h");
        fs::write(heartbeat_file(&home), edited).expect("hand edit the dream job");

        install_with(&project, &home, &all_enabled(), &stale).expect("role write is not blocked");

        // 손으로 고친 dream 값이 그대로 남는다.
        let job = HeartbeatService
            .inspect(project.path(), home.path())
            .dream
            .managed_job
            .expect("dream job");
        assert_eq!(job.interval.as_deref(), Some("6h"));
    }

    /// R3. dream 쪽도 같다. 역할 잡만 바뀐 것은 dream 쓰기를 막지 않는다.
    #[test]
    fn only_a_role_job_changing_does_not_stop_a_dream_write() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install role jobs");
        install_dream(&project, &home, &dream_request(true)).expect("install the dream job");
        let stale = dream_baseline(&project, &home);
        // 20m은 개발자 잡의 주기다. 다른 역할 잡은 30m, dream 잡은 2h이라 이 치환에 걸리지 않는다.
        let edited = snapshot(&heartbeat_file(&home))
            .expect("heartbeat file")
            .replace("- interval: 20m", "- interval: 45m");
        fs::write(heartbeat_file(&home), edited).expect("hand edit a role job");

        install_dream_with(&project, &home, &dream_request(true), stale.as_ref())
            .expect("dream write is not blocked");

        let jobs = HeartbeatService
            .inspect(project.path(), home.path())
            .heartbeat
            .managed_jobs;
        let developer = jobs
            .iter()
            .find(|job| job.role == "developer")
            .expect("developer job");
        assert_eq!(developer.interval.as_deref(), Some("45m"));
    }

    /// R3. dream 잡의 낡은 기준값. 파일은 바이트 단위로 그대로다.
    #[test]
    fn a_stale_dream_baseline_writes_nothing() {
        let (project, home) = workspace();
        install_dream(&project, &home, &dream_request(true)).expect("install the dream job");
        let stale = dream_baseline(&project, &home);
        let edited = snapshot(&heartbeat_file(&home))
            .expect("heartbeat file")
            .replace("- interval: 2h", "- interval: 6h");
        fs::write(heartbeat_file(&home), &edited).expect("hand edit the file");

        let error = install_dream_with(&project, &home, &dream_request(true), stale.as_ref())
            .expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ManagedBlockChanged));
        assert_eq!(snapshot(&heartbeat_file(&home)), Some(edited));
    }

    /// R3. dream 잡이 화면이 읽은 뒤 새로 생긴 경우. 없던 것과 생긴 것도 "달라졌다"다.
    #[test]
    fn a_dream_job_added_after_the_screen_read_writes_nothing() {
        let (project, home) = workspace();
        install_dream(&project, &home, &dream_request(true)).expect("install the dream job");
        let document = snapshot(&heartbeat_file(&home));

        let error =
            install_dream_with(&project, &home, &dream_request(true), None).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ManagedBlockChanged));
        assert_eq!(snapshot(&heartbeat_file(&home)), document);
    }
}
