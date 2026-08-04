use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::domain::project::{
    DreamRefinement, DuplicateHeartbeatJob, HeartbeatInstallation, HeartbeatJobRun,
    HeartbeatReadFailure, HeartbeatRoleStatus, HeartbeatSetupStage, HeartbeatStatus,
    IntegrationInstallation, JobDefaults, JobQuota,
};
use crate::infrastructure::heartbeat_condition::{
    install_condition_script, ConditionScriptError, CONDITION_SCRIPT,
};
use crate::infrastructure::heartbeat_dream::{self, read_dream_status, DreamJobSettings};
use crate::infrastructure::heartbeat_jobs::{
    install_managed_jobs, parse_heartbeat, parse_quota, project_jobs_path, project_slug,
    validate_managed_jobs, write_project_jobs, HeartbeatJob, HeartbeatJobsError, ManagedJob,
    MaxPer,
};
use crate::infrastructure::heartbeat_roles::{
    job_name, role_managed_jobs, HeartbeatRole, RoleJob, RoleJobSettings,
};
use crate::infrastructure::heartbeat_setup::setup_stages;
use crate::infrastructure::heartbeat_status::{
    self, read_heartbeat_status, read_job_runs, read_text, JobRuns,
};

const CONTROL_DIRECTORY: &str = ".workflow";
/// 전환 전에 앱이 잡을 쓰던 전역 파일. 이제 앱은 이 파일에서 자기 잡을 빼는 정리만 한다(R3).
const HEARTBEAT_FILE: &str = "HEARTBEAT.md";

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
    /// 이 프로젝트의 잡 파일을 읽지 못한 사유. `None`이면 읽었다는 뜻이고, 파일이 없는 것도 읽은
    /// 것으로 본다(잡 없음의 정규 표현이다, SPEC-024 R2). `Some`이면 앱이 잡의 값을 모르는
    /// 상태이므로 화면은 그것을 "잡 없음"으로 읽으면 안 된다.
    ///
    /// 두 연동이 같은 slug의 잡 파일 하나를 공유하므로 연동별 payload가 아니라 섹션 공통 값이다.
    ///
    /// 이름은 옛 마커 블록 시절 그대로다. 전환 뒤 사실과 어긋나지만, 바꾸면 `types.ts`와 화면
    /// 테스트가 함께 움직여 전환의 diff가 이름 바꾸기로 덮인다. 이름 정리는 별도로 다룬다.
    pub managed_block_failure: Option<HeartbeatReadFailure>,
    /// 앱이 이 프로젝트의 잡을 읽고 쓰는 파일의 절대 경로.
    ///
    /// 화면이 문자열을 조립하지 않게 백엔드가 실제로 쓰는 값을 그대로 싣는다.
    /// `condition_command`·`condition_script_path`가 같은 이유로 payload에 있는 것과 같은 규칙이다.
    /// 경로에 slug가 들어가므로 화면이 조립하면 갈라질 자리가 하나 더 생긴다.
    ///
    /// 두 연동이 같은 파일을 쓰므로 연동별 payload가 아니라 섹션 공통 값이다.
    pub jobs_file_path: String,
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
    /// dream 잡의 실행 한도 사용량(R1). 역할 잡과 같은 규칙으로 만든다.
    pub quota: JobQuota,
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
    /// 설치 단계 넷을 고정 순서로 담는다(SPEC-016 R1·R2). `installation`을 대체하지 않고 더해
    /// 싣는다. dream 단계가 여기 들어가는 이유는 이것이 하트비트 카드의 마법사이기 때문이며,
    /// dream 카드는 이 값을 읽지 않는다.
    pub setup_stages: Vec<HeartbeatSetupStage>,
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
    pub timeout: Option<String>,
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
    pub timeout: Option<String>,
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
    pub max_per: Option<MaxPerRequest>,
    pub model: Option<String>,
    pub timeout: Option<String>,
}

/// 저장 요청이 정하는 실행 한도(R3). 필드가 `None`이면 "이번 편집에서 지정하지 않음"이라 파일 값이
/// 이긴다. 지정한 경우는 이 둘 중 하나다.
///
/// 두 필드(`maxPer`와 `maxPerUnlimited`)로 나누지 않는다. 그러면 `("4/24h", true)`처럼 뜻이 충돌하는
/// 조합이 계약에 생기고, 그 조합의 우선순위 규칙이 코드 두 곳에 흩어진다.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MaxPerRequest {
    Unlimited,
    Limit { value: String },
}

impl From<MaxPerRequest> for MaxPer {
    fn from(request: MaxPerRequest) -> Self {
        match request {
            MaxPerRequest::Unlimited => MaxPer::Unlimited,
            MaxPerRequest::Limit { value } => MaxPer::Limit(value),
        }
    }
}

/// 설치 커맨드가 받는 dream 잡 요청. 역할 잡과 같은 방식으로 "꺼짐"은 블록에서 빼는 것으로
/// 표현한다. 이 요청에는 역할 잡 값이 들어가지 않는다.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamJobRequest {
    pub enabled: bool,
    pub interval: Option<String>,
    pub max_per: Option<MaxPerRequest>,
    pub model: Option<String>,
    pub timeout: Option<String>,
}

/// 잡 하나의 편집 가능 값 네 개. 필드마다 없을 수 있다. 관리 블록에서 읽은 값과 이번 요청이 같은
/// 모양을 쓴다.
#[derive(Debug, Clone, Default)]
struct PartialSettings {
    model: Option<String>,
    interval: Option<String>,
    /// `None`은 여전히 "지정 안 함"이다. 제한 없음은 `Some(MaxPer::Unlimited)`라 두 뜻이 갈린다(R3).
    max_per: Option<MaxPer>,
    timeout: Option<String>,
}

/// 편집 가능 값 네 개가 모두 정해진 상태. 잡 종류가 달라도 네 필드는 같으므로, 병합 규칙을 한 번만
/// 적기 위해 이 모양으로 모아 다룬다(R1).
#[derive(Debug, Clone)]
struct JobSettings {
    model: String,
    interval: String,
    max_per: MaxPer,
    timeout: String,
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
            timeout: self.timeout.unwrap_or(base.timeout),
        }
    }

    /// 사용자가 이번 편집에서 한 필드라도 지정했는지. 검증 실패 문구를 고르는 근거다.
    fn specifies_nothing(&self) -> bool {
        self.model.is_none()
            && self.interval.is_none()
            && self.max_per.is_none()
            && self.timeout.is_none()
    }
}

/// 병합 기준을 만드는 유일한 출발점이다. 잡 종류가 달라도 앱 기본값은 같은 모양이므로 변환도
/// 하나면 된다(SPEC-017 R1).
impl From<JobDefaults> for JobSettings {
    fn from(defaults: JobDefaults) -> Self {
        Self {
            model: defaults.model,
            interval: defaults.interval,
            max_per: MaxPer::Limit(defaults.max_per),
            timeout: defaults.timeout,
        }
    }
}

impl From<JobSettings> for RoleJobSettings {
    fn from(settings: JobSettings) -> Self {
        Self {
            model: settings.model,
            interval: settings.interval,
            max_per: settings.max_per,
            timeout: settings.timeout,
        }
    }
}

impl From<JobSettings> for DreamJobSettings {
    fn from(settings: JobSettings) -> Self {
        Self {
            model: settings.model,
            interval: settings.interval,
            max_per: settings.max_per,
            timeout: settings.timeout,
        }
    }
}

#[derive(Debug, Error)]
pub enum HeartbeatInstallError {
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
    /// 파일 둘을 읽는다. 이 프로젝트의 잡은 잡 파일에서 오고(SPEC-024 R2), 설치 판정·설치 단계·
    /// 중복 감지는 `HEARTBEAT.md`에서 온다. 어느 쪽도 두 번 읽지 않는다. 같은 파일을 두 번 읽으면
    /// 두 읽기의 결과가 갈라져 "못 읽음"과 "잡 없음"의 구분이 성립하지 않는다.
    ///
    /// `user_home`은 `heartbeat_home`의 부모가 아니라 따로 받는 값이다(SPEC-016). 서비스 등록
    /// 아티팩트가 `~/.claude` 밖에 있어 필요한데, `heartbeat_home.parent()`로 유도하면 임시
    /// 디렉터리를 넘기는 테스트에서 판정이 개발 기기의 실제 파일을 보게 된다.
    pub fn inspect(
        &self,
        project_root: &Path,
        heartbeat_home: &Path,
        user_home: &Path,
    ) -> IntegrationsSnapshot {
        let slug = project_slug(project_root);
        let read = read_heartbeat_status(heartbeat_home, &slug);
        let mut status = read.status;
        // 이 프로젝트의 잡은 이 파일에서만 온다. 읽기 실패는 하트비트 연동의 실패 목록에 실린다 —
        // 옛 문서의 실패가 실리던 자리와 같다.
        let jobs_path = project_jobs_path(heartbeat_home, &slug);
        let jobs_document = read_text(&jobs_path, &mut status.read_failures);
        // 못 읽은 파일에서는 잡 목록이 비지만 그것은 "잡 없음"이 아니다. 파일이 없는 것만 잡 없음
        // 이다(계약 15, R2). 화면은 아래 실패 값을 먼저 보고 두 상태를 구분한다.
        let managed_block_failure = jobs_document.unreadable().cloned();
        let document = jobs_document.text().unwrap_or_default();
        // dream은 하트비트 설치 여부를 스스로 판정하지 않고 이 값을 넘겨받는다. 두 연동이 각자
        // 확인하면 같은 경로가 읽기 실패 목록에 두 번 들어간다.
        let (installation, _) = split_installation(status.installation);
        // 기준 시각은 한 번만 구해 두 연동에 같은 값을 넘긴다. 잡마다 다시 구하면 한 화면 안에서
        // 창의 기준이 어긋난다.
        let now = Utc::now();
        let dream = dream_integration(
            heartbeat_home,
            &slug,
            installation,
            managed_dream_job(document, &slug),
            duplicates_of(&status.duplicate_jobs, heartbeat_dream::INTEGRATION),
            now,
        );
        // 4단계는 dream 카드가 이미 판정한 값을 그대로 받는다(R9). 같은 스킬 경로를 다시 읽으면
        // 읽기 실패 목록에 같은 경로가 두 번 들어가고, 두 화면의 판정이 갈라질 자리가 생긴다.
        let stages = setup_stages(
            heartbeat_home,
            user_home,
            &read.document,
            dream.installation,
        );
        IntegrationsSnapshot {
            // 지금은 모든 플랫폼에서 참이다. 자산이 플랫폼별로 갈리면서 연동을 막던 이유
            // (조건 스크립트가 POSIX `sh` 하나뿐이라는 것)가 사라졌다. 필드와 화면의 미지원 분기는
            // 섹션 공통 계약(SPEC-003)이라 남긴다 — 다시 미지원으로 표시할 플랫폼이 생기면 그 값이
            // 나갈 자리다.
            supported: true,
            managed_block_failure,
            // 읽기가 연 그 경로다. 화면이 보여주는 파일과 앱이 실제로 여는 파일이 갈라질 수 없다.
            jobs_file_path: jobs_path.display().to_string(),
            dream,
            heartbeat: heartbeat_integration(
                status,
                stages,
                condition_script_relative_path(),
                managed_role_jobs(document, &slug),
                &read.runs,
                now,
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
    /// 조건 스크립트 설치가 실패하면 잡 파일을 쓰지 않는다. 반대로 잡 파일 쓰기가 실패해도 설치된
    /// 스크립트는 되돌리지 않는다. 잡 없이 스크립트만 있는 상태는 무해하다.
    ///
    /// 잡 파일을 쓴 뒤 옛 전역 파일에 남은 이 프로젝트의 잡을 뺀다(`remove_legacy_jobs`). 그 정리는
    /// 실패해도 이 저장을 실패시키지 않는다.
    ///
    /// `baseline`은 화면이 읽은 시점의 역할 잡이다. 쓰기 직전에 읽은 문서에서 같은 값을 만들어
    /// 대조하고, 다르면 아무 파일도 쓰지 않는다(R3). 대조 범위는 이 요청이 관장하는 역할 잡뿐이라
    /// dream 잡만 바뀐 것은 이 요청을 막지 않는다.
    pub fn install(
        &self,
        project_root: &Path,
        heartbeat_home: &Path,
        user_home: &Path,
        roles: &[RoleJobRequest],
        baseline: &[ManagedRoleJob],
    ) -> Result<IntegrationsSnapshot, HeartbeatInstallError> {
        let slug = project_slug(project_root);
        let path = project_jobs_path(heartbeat_home, &slug);
        let document = read_document(&path)?;

        // 조건 스크립트 설치보다 먼저 대조한다. 불일치로 실패한 요청이 프로젝트 로컬 파일을 새로
        // 만들면 "아무 파일도 쓰지 않았다"가 성립하지 않는다.
        if managed_role_jobs(&document, &slug) != baseline {
            return Err(HeartbeatInstallError::ManagedBlockChanged);
        }

        let requested = requested_role_jobs(roles, &document, &slug)?;
        let jobs = merge_block(requested, preserved_dream_job(&document, &slug)?);

        install_condition_script(&project_root.join(CONTROL_DIRECTORY))?;
        write_project_jobs(&path, &jobs)?;
        remove_legacy_jobs(heartbeat_home, &slug);

        Ok(self.inspect(project_root, heartbeat_home, user_home))
    }

    /// dream 잡을 설치하고 갱신된 상태를 돌려준다. 명시적 사용자 액션에서만 호출한다.
    ///
    /// 역할 잡 설치와 달리 조건 스크립트를 쓰지 않는다. dream 잡의 조건은
    /// `dream-prep check-unprocessed`이고 앱 관리 스크립트를 거치지 않으므로, "dream만 설치"
    /// 상태에서 프로젝트 로컬에 파일이 생기면 안 된다. 이 경로가 손대는 것은 잡 파일과, 역할 잡
    /// 저장과 같은 규칙으로 도는 옛 전역 파일 정리뿐이다.
    ///
    /// `baseline`은 화면이 읽은 시점의 dream 잡이다. 역할 잡 설치와 같은 규칙으로 대조하고, 대조
    /// 범위는 dream 잡 하나뿐이다(R3).
    pub fn install_dream(
        &self,
        project_root: &Path,
        heartbeat_home: &Path,
        user_home: &Path,
        dream: &DreamJobRequest,
        baseline: Option<&ManagedDreamJob>,
    ) -> Result<IntegrationsSnapshot, HeartbeatInstallError> {
        let slug = project_slug(project_root);
        let path = project_jobs_path(heartbeat_home, &slug);
        let document = read_document(&path)?;

        if managed_dream_job(&document, &slug).as_ref() != baseline {
            return Err(HeartbeatInstallError::ManagedBlockChanged);
        }

        let requested = requested_dream_job(dream, &document, &slug)?;
        let jobs = merge_block(preserved_role_jobs(&document, &slug)?, requested);

        write_project_jobs(&path, &jobs)?;
        remove_legacy_jobs(heartbeat_home, &slug);

        Ok(self.inspect(project_root, heartbeat_home, user_home))
    }
}

/// 잡 파일에 남길 잡 전체. 순서는 연동 목록 순서로 고정한다: 역할 3종 다음에 dream.
/// 어떤 연동을 먼저 설치했든 같은 결과가 나와야 하므로 요청 순서를 반영하지 않는다.
fn merge_block(role_jobs: Vec<ManagedJob>, dream_job: Option<ManagedJob>) -> Vec<ManagedJob> {
    role_jobs.into_iter().chain(dream_job).collect()
}

/// 이 프로젝트가 소유하는 잡 이름 전체. 이번 저장이 끄는 잡도 들어간다.
///
/// `install_managed_jobs`는 slug를 모르므로 이 목록으로 남의 잡을 가려낸다. 목록을 이번에 쓰는 잡만
/// 담게 좁히면 정리가 방금 끈 잡을 남의 잡으로 오인해 원문째 되살린다(SPEC-022 R1).
fn owned_job_names(slug: &str) -> Vec<String> {
    HeartbeatRole::ALL
        .iter()
        .map(|role| job_name(*role, slug))
        .chain(std::iter::once(heartbeat_dream::job_name(slug)))
        .collect()
}

/// 옛 전역 파일의 관리 블록에서 이 프로젝트의 잡을 뺀다(R3, 확인 필요 2번의 승인된 제안).
///
/// 남길 잡 목록을 비우고 소유 목록만 넘기는 것이 곧 "내 잡만 빼기"다. `install_managed_jobs`가 두
/// 목록을 나눠 받으므로, 소유 목록에 있고 남길 목록에 없는 잡은 지워지고 어느 쪽에도 없는 남의 잡은
/// 원문 그대로 남는다(SPEC-022 R1). 블록에 아무것도 남지 않으면 마커째 사라진다. 파일이 없거나
/// 블록이 없으면 아무 일도 일어나지 않는다.
///
/// **실패를 삼킨다.** 근거는 둘이다. 첫째, 이 시점에 잡 파일 쓰기는 이미 성공했고 데몬은 jobs.d를
/// 이기게 하므로(확인 사실 13) 사용자의 편집은 실제로 적용된 상태다. 여기서 오류를 올리면 성공한
/// 저장을 "저장 실패"로 보고하게 된다. 둘째, 옛 파일의 마커가 손상돼 있으면 `install_managed_jobs`는
/// 언제나 거부하므로, 오류를 올리면 이 프로젝트와 아무 상관 없는 파일 하나가 앱의 저장을 영구히
/// 막는다.
///
/// 삼킨 사실은 사라지지 않는다. 정리하지 못한 잡은 `find_duplicate_jobs`가 계속 잡아내고, 사용자는
/// 이 함수 다음에 만들어지는 스냅샷의 중복 잡 목록에서 그것을 본다.
fn remove_legacy_jobs(heartbeat_home: &Path, slug: &str) {
    let _ = install_managed_jobs(
        &heartbeat_home.join(HEARTBEAT_FILE),
        &[],
        &owned_job_names(slug),
    );
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

/// 블록에 있는 잡의 한도 값(R3). 잡이 블록에 있다면 한도는 언제나 정해져 있다. 줄이 있으면 그
/// 값이고, 줄이 없으면 제한 없음이다. 이 자리에서 `None`을 돌려주면 병합이 앱 기본값을 채워
/// 사용자가 지운 줄이 되살아난다.
fn block_max_per(line: Option<&String>) -> Option<MaxPer> {
    Some(match line {
        Some(value) => MaxPer::Limit(value.clone()),
        None => MaxPer::Unlimited,
    })
}

/// 관리 블록에서 읽은 역할 잡의 편집 가능 값. 블록에 없으면 빈 값이다.
fn block_role_settings(block: &[ManagedRoleJob], role: HeartbeatRole) -> PartialSettings {
    block
        .iter()
        .find(|job| job.role == role.as_argument())
        .map(|job| PartialSettings {
            model: job.model.clone(),
            interval: job.interval.clone(),
            max_per: block_max_per(job.max_per.as_ref()),
            timeout: job.timeout.clone(),
        })
        .unwrap_or_default()
}

/// 관리 블록에서 읽은 dream 잡의 편집 가능 값. 블록에 없으면 빈 값이다.
fn block_dream_settings(block: Option<&ManagedDreamJob>) -> PartialSettings {
    block
        .map(|job| PartialSettings {
            model: job.model.clone(),
            interval: job.interval.clone(),
            max_per: block_max_per(job.max_per.as_ref()),
            timeout: job.timeout.clone(),
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
        max_per: dream.max_per.clone().map(MaxPer::from),
        timeout: dream.timeout.clone(),
    };
    let specified = !requested.specifies_nothing();
    let settings = requested.over(
        block_dream_settings(managed_dream_job(document, slug).as_ref())
            .over(heartbeat_dream::default_settings().into()),
    );
    let job = heartbeat_dream::dream_job_with(slug, &settings.into());
    Ok(Some(validate_requested(job, specified)?))
}

/// 병합에 쓸 현재 잡 파일. 파일이 없는 것은 빈 문서이고 오류가 아니다. 읽지 못하는 파일은 오류로
/// 올린다. 못 읽은 문서를 빈 문서로 보면 다른 연동의 잡을 지우는 병합이 만들어진다.
fn read_document(path: &Path) -> Result<String, HeartbeatJobsError> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(HeartbeatJobsError::Io(error)),
    }
}

/// 잡 하나의 실행 한도 사용량을 만든다. 조립 규칙은 이 함수에만 있다.
///
/// `max_per`는 관리 블록에 적힌 값이다(R1). 앱 기본값을 대신 쓰지 않는다.
///
/// 바깥 `Option`은 그 잡이 관리 블록에 있는가이고, 안쪽 `Option`은 그 잡에 `max_per` 줄이 있는가다.
/// 하나로 접으면 "블록에 잡이 없다"와 "블록에 있는데 줄만 없다"가 같은 값이 되어, 사용자가 고른
/// 제한 없음을 앱이 모르는 상태와 구분할 수 없다(SPEC-017 R6).
fn job_quota(
    max_per: Option<Option<&str>>,
    recent: Option<Vec<f64>>,
    now: DateTime<Utc>,
) -> JobQuota {
    // 블록에 그 잡이 없거나 블록을 읽지 못한 조회다. 한도 값을 모른다(SPEC-009 R5).
    let Some(max_per) = max_per else {
        return JobQuota::Unknown;
    };
    // 잡은 있는데 한도 줄이 없다. 사용자가 고른 제한 없음이고 정상 상태다. 실행 기록을 보지 않는다 —
    // 데몬이 무제한 잡의 실행을 기록하지 않으므로 파일에 남은 값은 한도가 있던 시절의 이력이다.
    let Some(max_per) = max_per else {
        return JobQuota::Unlimited;
    };
    // 데몬이 한도로 인정하지 않는 값이다. 형식 위반뿐 아니라 0 이하 횟수와 0 기간이 함께 들어온다
    // (TASK-051이 `parse_quota`를 데몬 기준에 맞춘 뒤로). 앱도 소진 판정을 하지 않는다(R5).
    let Some(quota) = parse_quota(max_per) else {
        return JobQuota::IgnoredLimit {
            value: max_per.to_owned(),
        };
    };
    let Some(recent) = recent else {
        return JobQuota::NoRuns {
            limit: quota.count,
            window: quota.window,
        };
    };

    // 배열 길이가 아니라 창 안 항목만 센다. 하트비트와 같은 부등호(`지금 − t < 창 길이`)를 쓰고
    // 경계는 `<`다. 판정할 수 없는 값은 창 밖으로 본다.
    let now_seconds = now.timestamp() as f64;
    let window_seconds = quota.window_seconds as f64;
    let in_window = recent
        .into_iter()
        .filter(|at| at.is_finite() && now_seconds - at < window_seconds)
        .collect::<Vec<_>>();

    let used = in_window.len() as u64;
    // 한도를 낮춘 직후에는 `used`가 `limit`보다 클 수 있다. 오류가 아니라 소진이다(R5).
    let exhausted = used >= quota.count;
    let recovers_at = exhausted
        .then(|| in_window.into_iter().reduce(f64::min))
        .flatten()
        .and_then(|oldest| recovery_time(oldest + window_seconds));
    JobQuota::Counted {
        used,
        limit: quota.count,
        window: quota.window,
        exhausted,
        recovers_at,
    }
}

/// epoch 초를 RFC3339(UTC) 원문으로 바꾼다. 표현할 수 없는 값이면 `None`이다.
fn recovery_time(seconds: f64) -> Option<String> {
    let whole = seconds.floor();
    let nanos = ((seconds - whole) * 1e9) as u32;
    DateTime::from_timestamp(whole as i64, nanos.min(999_999_999)).map(|at| at.to_rfc3339())
}

/// 상태 조회 결과를 하트비트 카드가 쓰는 payload로 옮긴다.
fn heartbeat_integration(
    status: HeartbeatStatus,
    setup_stages: Vec<HeartbeatSetupStage>,
    condition_script_path: String,
    managed_jobs: Vec<ManagedRoleJob>,
    runs: &JobRuns,
    now: DateTime<Utc>,
) -> HeartbeatIntegration {
    let (installation, daemon_running) = split_installation(status.installation);
    let roles = status
        .roles
        .into_iter()
        .map(|role| {
            // `and_then`이 아니라 `map`이다. 잡을 찾지 못한 것과 찾은 잡에 한도 줄이 없는 것이
            // 서로 다른 상태이므로 여기서 접지 않는다.
            let max_per = managed_jobs
                .iter()
                .find(|job| job.role == role.role)
                .map(|job| job.max_per.as_deref());
            let quota = job_quota(max_per, runs.recent_runs(&role.job_name), now);
            HeartbeatRoleStatus { quota, ..role }
        })
        .collect();
    HeartbeatIntegration {
        installation,
        daemon_running,
        setup_stages,
        condition_script_path,
        roles,
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
    now: DateTime<Utc>,
) -> DreamIntegration {
    // 읽기 실패는 연동별로 담는다. 섹션 공통으로 올리면 어느 연동 때문인지 알 수 없다.
    // 상태 파일도 이 연동 몫으로 다시 읽는다. 하트비트와 한 번만 읽어 나눠 쓰면 상태 파일을 읽지
    // 못했을 때 어느 카드의 값이 비었는지 알 수 없다.
    let mut read_failures = Vec::new();
    let status = read_dream_status(heartbeat_home, slug, heartbeat, &mut read_failures);
    // 사용량도 이 읽기에서 함께 꺼낸다. dream을 위해 파일을 새로 열지 않는다(R6).
    let runs = read_job_runs(heartbeat_home, &mut read_failures);
    let job_name = heartbeat_dream::job_name(slug);
    let last_run = runs.get(&job_name);
    // 역할 잡과 같은 이유로 두 겹을 그대로 넘긴다.
    let quota = job_quota(
        managed_job.as_ref().map(|job| job.max_per.as_deref()),
        runs.recent_runs(&job_name),
        now,
    );
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
        defaults: heartbeat_dream::default_settings(),
        managed_job,
        last_run,
        quota,
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
                max_per: request.max_per.clone().map(MaxPer::from),
                timeout: request.timeout.clone(),
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
/// 화면이 보여주는 조건 스크립트 경로. 관리 블록에 쓰이는 조건 명령과 같은 자산 서술에서 나온다
/// (기획서 완료 조건 24). 프로젝트 루트를 붙였다 떼어 낼 이유가 없어 자산의 상대 경로를 그대로 쓴다.
fn condition_script_relative_path() -> String {
    CONDITION_SCRIPT.relative_path()
}

/// 앱이 소유하는 필드와 앱이 다시 쓸 값. 편집 가능한 네 필드는 여기 없다.
///
/// 이 넷은 잡 설정과 무관하게 잡 정의에서 나오므로, 대조용 잡은 기본 설정으로 만들어도 된다.
fn app_owned_fields(job: &ManagedJob) -> [(&'static str, &str); 4] {
    [
        ("slug", job.slug.as_str()),
        ("prompt", job.prompt.as_str()),
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

/// 잡 파일에 있는 역할 잡만 골라 편집 가능한 설정을 읽는다.
///
/// 파일 전체가 앱 소유이므로 마커로 범위를 좁히지 않는다. 고르는 기준은 잡 이름 하나다 — 이 프로젝트
/// 잡의 이름 규칙이 slug를 담고 있어, 파일 이름과 어긋난 잡이 섞여 들어와도 역할 잡으로 읽히지 않는다.
fn managed_role_jobs(document: &str, slug: &str) -> Vec<ManagedRoleJob> {
    let jobs = parse_heartbeat(document).jobs;
    // 대조용 잡이다. 파일에 쓰지 않으므로 편집 가능 값은 기본값이어도 되고, 잡 정의가 바뀌면 이
    // 값도 함께 바뀐다.
    let app_jobs = role_managed_jobs(
        &HeartbeatRole::ALL
            .iter()
            .map(|role| RoleJob {
                role: *role,
                settings: role.default_settings().into(),
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
                timeout: job.field("timeout").map(str::to_owned),
                app_owned_drift: app_owned_drift(job, app_job),
            })
        })
        .collect()
}

/// 잡 파일에 있는 dream 잡에서 편집 가능한 설정을 읽는다. 파일에 없으면 `None`이다.
fn managed_dream_job(document: &str, slug: &str) -> Option<ManagedDreamJob> {
    let name = heartbeat_dream::job_name(slug);
    let job = parse_heartbeat(document)
        .jobs
        .into_iter()
        .find(|job| job.name == name)?;
    Some(ManagedDreamJob {
        interval: job.field("interval").map(str::to_owned),
        max_per: job.field("max_per").map(str::to_owned),
        model: job.field("model").map(str::to_owned),
        timeout: job.field("timeout").map(str::to_owned),
        app_owned_drift: app_owned_drift(&job, &heartbeat_dream::dream_job(slug)),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::Path;
    use std::time::SystemTime;

    use tempfile::tempdir;

    use chrono::{DateTime, TimeZone, Utc};

    use super::{heartbeat_dream, job_quota, managed_role_jobs, HeartbeatService};
    use crate::domain::project::{
        HeartbeatSetupStage, HeartbeatSetupState, HeartbeatSetupStep, IntegrationInstallation,
        JobQuota,
    };
    use crate::infrastructure::heartbeat_jobs::{project_jobs_path, project_slug};
    use crate::infrastructure::heartbeat_roles::{condition_command, HeartbeatRole};

    const PROJECT_ROOT: &str = "/projects/workflow-labs";
    const SLUG: &str = "-projects-workflow-labs";
    const DEVELOPER_JOB: &str = "wf-developer-projects-workflow-labs";

    fn developer_job(name: &str) -> String {
        job_with_quota(name, "6/24h")
    }

    fn job_with_quota(name: &str, max_per: &str) -> String {
        format!("## {name}\n- slug: {SLUG}\n- interval: 20m\n- max_per: {max_per}\n- model: opus\n")
    }

    /// 한도 줄이 없는 잡. 사용자가 고른 제한 없음이고, 나머지 줄은 `job_with_quota`와 같다.
    fn job_without_quota(name: &str) -> String {
        format!("## {name}\n- slug: {SLUG}\n- interval: 20m\n- model: opus\n")
    }

    /// 이 프로젝트의 잡 파일을 픽스처로 만든다. 경로 정의는 `project_jobs_path` 하나뿐이므로
    /// 픽스처도 그 함수를 통해 만든다. 파일 전체가 앱 소유라 마커로 감싸지 않는다.
    fn write_jobs_file(home: &Path, body: &str) {
        let path = project_jobs_path(home, SLUG);
        fs::create_dir_all(path.parent().expect("jobs directory")).expect("jobs directory");
        fs::write(path, body).expect("jobs file");
    }

    /// 창 안 판정에 쓸 기준 시각. 정수 초라 회복 시각 계산이 픽스처 값과 정확히 맞는다.
    fn at(seconds: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(seconds, 0).single().expect("timestamp")
    }

    /// 관리 블록에 있고 한도 줄도 있는 잡. `job_quota` 두 겹 중 안쪽까지 값이 있는 경우다.
    fn limited(value: &str) -> Option<Option<&str>> {
        Some(Some(value))
    }

    /// 관리 블록에 있으나 한도 줄이 없는 잡. 사용자가 고른 제한 없음이다.
    const UNLIMITED: Option<Option<&str>> = Some(None);

    /// 관리 블록에 그 잡이 없거나 블록을 읽지 못한 조회. 한도 값을 모른다.
    const ABSENT: Option<Option<&str>> = None;

    /// `inspect`가 자기 시계를 쓰므로 픽스처도 지금 기준으로 만든다. 창이 24h라 조회 사이의 드리프트는
    /// 판정을 바꾸지 않는다.
    fn seconds_ago(seconds: f64) -> f64 {
        Utc::now().timestamp() as f64 - seconds
    }

    /// 잡별 `recent_runs`만 담은 상태 파일.
    fn write_state(home: &Path, records: &[(&str, &[f64])]) {
        let body = records
            .iter()
            .map(|(job, recent)| {
                let values = recent
                    .iter()
                    .map(f64::to_string)
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("\"{job}\": {{ \"recent_runs\": [{values}] }}")
            })
            .collect::<Vec<_>>()
            .join(", ");
        write_home_file(home, "heartbeat/state.json", &format!("{{ {body} }}"));
    }

    fn role_quota(snapshot: &super::IntegrationsSnapshot, role: &str) -> JobQuota {
        snapshot
            .heartbeat
            .roles
            .iter()
            .find(|status| status.role == role)
            .expect("role status")
            .quota
            .clone()
    }

    /// SPEC-024 R2·R6. 잡 파일에는 마커가 없다. 파일 전체가 앱 소유라 마커로 범위를 좁히던 판정이
    /// 사라졌고, 마커 없는 같은 픽스처가 이제 잡 하나를 낸다. 앞선 전역 설정 줄은 잡이 아니다.
    #[test]
    fn a_job_file_needs_no_marker_for_its_jobs_to_be_read() {
        let document = format!(
            "- tick: 5m\n\n{}",
            developer_job("wf-developer-projects-workflow-labs")
        );

        let jobs = managed_role_jobs(&document, SLUG);

        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].role, "developer");
    }

    #[test]
    fn role_job_settings_come_from_the_job_file() {
        let document = format!(
            "- tick: 5m\n\n{}",
            developer_job("wf-developer-projects-workflow-labs")
        );

        let jobs = managed_role_jobs(&document, SLUG);

        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].role, "developer");
        assert_eq!(jobs[0].interval.as_deref(), Some("20m"));
        assert_eq!(jobs[0].max_per.as_deref(), Some("6/24h"));
        assert_eq!(jobs[0].model.as_deref(), Some("opus"));
    }

    /// 마커가 하던 범위 제한을 잡 이름 대조가 대신한다. 이름이 이 프로젝트의 역할 잡과 다르면
    /// 파일 어디에 있든 읽지 않는다.
    #[test]
    fn a_job_whose_name_is_not_a_role_job_of_this_project_is_not_read() {
        let document = format!(
            "{}\n{}",
            developer_job("wf-developer-projects-mecha-arena"),
            developer_job("my-own-job")
        );

        assert!(managed_role_jobs(&document, SLUG).is_empty());
    }

    #[test]
    fn an_empty_home_reports_the_slug_and_the_condition_script_path() {
        let home = tempdir().expect("temporary directory");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        // 3단계. slug와 플랫폼 지원 여부는 섹션 공통 값이라 payload 밖에 있다.
        assert_eq!(snapshot.slug, SLUG);
        // 파일이 없어도 경로는 나간다. 확인 화면은 아직 만들어지지 않은 파일을 가리켜야 한다.
        assert_eq!(
            snapshot.jobs_file_path,
            project_jobs_path(home.path(), SLUG).display().to_string()
        );
        // 자산이 플랫폼별로 갈린 뒤로 연동을 막을 이유가 없다. 세 플랫폼 모두 참이다(R5).
        assert!(snapshot.supported);
        // 이 단정은 게이트 밖이라 Windows 러너에서도 돈다. 자산이 플랫폼별로 갈린 뒤로는 기대값도
        // 플랫폼을 따라야 한다(SPEC-015 R2·R4).
        assert_eq!(
            snapshot.heartbeat.condition_script_path,
            if cfg!(windows) {
                ".workflow/rules/wf-eligible.ps1"
            } else {
                ".workflow/rules/wf-eligible.sh"
            }
        );
        assert_eq!(
            snapshot.heartbeat.installation,
            IntegrationInstallation::NotInstalled
        );
        assert!(!snapshot.heartbeat.daemon_running);
        assert!(snapshot.heartbeat.managed_jobs.is_empty());
    }

    /// R7의 확인 항목. **판정이 아니라 사실 기록이다.**
    ///
    /// 앱의 slug 생성은 경로 문자열의 `/`·`\`·`:`를 `-`로 바꾸고 앞이 `-`가 아니면 `-`를 붙인다.
    /// `\`·`:` 치환은 v0.1.8에서 더해졌다 — SPEC-024 전환으로 슬러그가 jobs.d 파일명이 되면서,
    /// Windows 경로의 드라이브 콜론이 파일명에 남아 쓰기가 `InvalidFilename`으로 실패했다(CI 실측).
    /// 하트비트가 이 값을 프로젝트 루트로 되돌릴 수 있는지는 이 저장소에서 확인할 수 없다 — 그
    /// 역변환은 실제 Windows 환경이 있어야 확인된다(기획서 완료 조건 18, 사용자 QA 항목).
    ///
    /// **`/` 경로의 규칙은 바꾸지 않는다**(R7). 잡 이름이 하트비트의 상태 키라, 바꾸면 이미 설치된
    /// 잡의 실행 이력과 실행 한도 창이 초기화된다. 지원 플랫폼(macOS·Linux)의 절대 경로에는
    /// `\`·`:`가 없어 실존 설치의 슬러그는 이 치환으로 달라지지 않고, Windows에는 옛 규칙으로
    /// 설치가 아예 불가능했으므로(위 실패) 초기화될 이력도 없다.
    #[test]
    fn records_what_the_slug_rule_produces_for_a_windows_shaped_path() {
        assert_eq!(
            project_slug(Path::new(r"C:\Users\catze\project\workflow-labs")),
            "-C--Users-catze-project-workflow-labs"
        );
        // 구분자가 `/`인 경로는 플랫폼과 무관하게 지금 값 그대로다.
        assert_eq!(project_slug(Path::new(PROJECT_ROOT)), SLUG);
    }

    /// 기획서 완료 조건 24. 화면에 나가는 경로와 관리 블록에 기록되는 조건 문자열 안의 경로가 같은
    /// 자산에서 나온다. 두 값이 우연히 같은 문자열이던 상태를 이 단정이 막는다.
    #[test]
    fn the_reported_path_is_the_one_written_into_the_job_condition() {
        let home = tempdir().expect("temporary directory");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());
        let condition = condition_command("developer");

        assert!(condition.contains(&snapshot.heartbeat.condition_script_path));
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
            let snapshot =
                HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());
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

    /// SPEC-016 R1·R2. 빈 홈에서도 단계 목록은 넷이고 순서가 고정이다. 단계를 더 실어도 배지가
    /// 읽는 `installation`·`daemonRunning`의 값과 의미는 그대로다.
    #[test]
    fn an_empty_home_reports_the_four_setup_stages_and_keeps_the_installation() {
        let home = tempdir().expect("temporary directory");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        assert_eq!(
            setup_states(&snapshot),
            vec![
                (HeartbeatSetupStep::Package, HeartbeatSetupState::Unknown),
                (HeartbeatSetupStep::Init, HeartbeatSetupState::NotDone),
                (HeartbeatSetupStep::Service, HeartbeatSetupState::Unknown),
                (HeartbeatSetupStep::Dream, HeartbeatSetupState::NotDone),
            ]
        );
        assert_eq!(
            snapshot.heartbeat.installation,
            IntegrationInstallation::NotInstalled
        );
        assert!(!snapshot.heartbeat.daemon_running);
    }

    /// **이 조합이 SPEC-016이 겨냥한 상태다**(R1). `heartbeat init`까지만 한 사용자는 지금
    /// "설치됨" 배지를 받고 안내를 잃는다. 배지의 값은 그대로 두고, 남은 단계가 무엇인지는 단계
    /// 목록이 말한다.
    #[test]
    fn a_home_with_only_the_document_has_the_first_two_steps_done_and_stays_installed() {
        let home = tempdir().expect("temporary directory");
        fs::write(home.path().join("HEARTBEAT.md"), "- tick: 5m\n").expect("seed document");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        assert_eq!(
            setup_states(&snapshot),
            vec![
                (HeartbeatSetupStep::Package, HeartbeatSetupState::Done),
                (HeartbeatSetupStep::Init, HeartbeatSetupState::Done),
                (HeartbeatSetupStep::Service, HeartbeatSetupState::Unknown),
                (HeartbeatSetupStep::Dream, HeartbeatSetupState::NotDone),
            ]
        );
        assert_eq!(
            snapshot.heartbeat.installation,
            IntegrationInstallation::Installed
        );
    }

    /// 3절. macOS만 표준 등록물을 본다. 감지하는 플랫폼에서는 등록물이 없어도 확인 불가이고 근거
    /// 경로는 그대로 남는다 — 화면이 "이 경로에 표준 등록물이 없다"와 "이 플랫폼에서는 확인할
    /// 방법이 없다"를 구분해 말해야 하고, 그 구분이 `evidence`의 있음·없음으로 나온다.
    #[test]
    fn the_service_step_reads_the_standard_launch_agent_only_on_macos() {
        let registered = tempdir().expect("temporary directory");
        write_launch_agent(registered.path());
        let absent = tempdir().expect("temporary directory");

        let stage = |home: &Path| {
            setup_stage(
                &HeartbeatService.inspect(Path::new(PROJECT_ROOT), home, home),
                HeartbeatSetupStep::Service,
            )
        };
        let registered_stage = stage(registered.path());
        let absent_stage = stage(absent.path());

        if cfg!(target_os = "macos") {
            let artifact = |home: &Path| {
                Some(
                    home.join("Library")
                        .join("LaunchAgents")
                        .join("com.claude-heartbeat.plist")
                        .display()
                        .to_string(),
                )
            };
            assert_eq!(registered_stage.state, HeartbeatSetupState::Done);
            assert_eq!(registered_stage.evidence, artifact(registered.path()));
            assert_eq!(absent_stage.state, HeartbeatSetupState::Unknown);
            assert_eq!(absent_stage.evidence, artifact(absent.path()));
        } else {
            // 아티팩트 위치가 확인되지 않은 플랫폼이다. 파일을 만들어 두어도 판정하지 않는다.
            assert_eq!(registered_stage.state, HeartbeatSetupState::Unknown);
            assert_eq!(registered_stage.evidence, None);
            assert_eq!(absent_stage.evidence, None);
        }
        // 어느 플랫폼에서도 등록물이 없다는 것만으로 미완료가 되지 않는다(DECISION-4F1083FF).
        assert_ne!(absent_stage.state, HeartbeatSetupState::NotDone);
        // 명령은 플랫폼과 무관하게 같다. R10이 요구하는 차이는 경로와 감지 가능 여부에서만 나온다.
        assert_eq!(absent_stage.command, "heartbeat install-service");
    }

    /// R9. 4단계 값이 같은 스냅샷의 `dream.installation`과 언제나 같다. 두 화면이 같은 것을 각자
    /// 판정하면 갈라진다.
    #[test]
    fn the_dream_step_always_matches_the_dream_installation() {
        let without = tempdir().expect("temporary directory");
        let with = tempdir().expect("temporary directory");
        write_skill(with.path());

        let reported = [&without, &with].map(|home| {
            let snapshot =
                HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());
            let stage = setup_stage(&snapshot, HeartbeatSetupStep::Dream);
            // 근거 경로도 dream 카드가 밝히는 것과 같다. 두 화면이 다른 경로를 말하면 사용자가
            // 자기 설치본과 대조할 수 없다.
            assert_eq!(
                stage.evidence.as_deref(),
                Some(snapshot.dream.skill_path.as_str())
            );
            // dream은 선택이라 마법사의 접힘을 막지 않는다.
            assert!(!stage.required);
            (snapshot.dream.installation, stage.state)
        });

        assert_eq!(
            reported,
            [
                (
                    IntegrationInstallation::NotInstalled,
                    HeartbeatSetupState::NotDone
                ),
                (
                    IntegrationInstallation::Installed,
                    HeartbeatSetupState::Done
                ),
            ]
        );
    }

    /// R3. 판정은 전부 읽기다. 단계를 읽어도 두 홈의 파일 목록과 수정 시각이 그대로다. 이번에는
    /// 하트비트 홈뿐 아니라 사용자 홈까지 함께 본다.
    #[test]
    fn reading_the_setup_stages_does_not_touch_either_home() {
        let home = tempdir().expect("temporary directory");
        fs::write(home.path().join("HEARTBEAT.md"), "- tick: 5m\n").expect("seed document");
        write_skill(home.path());
        let user_home = tempdir().expect("user home");
        write_launch_agent(user_home.path());

        let before = (tree(home.path()), tree(user_home.path()));
        HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), user_home.path());

        assert_eq!((tree(home.path()), tree(user_home.path())), before);
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

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

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
            let snapshot =
                HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());
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

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        assert_eq!(
            snapshot.dream.condition_command,
            format!("dream-prep check-unprocessed --slug={SLUG}")
        );
        assert_eq!(
            snapshot.dream.skill_path,
            home.path()
                .join("skills")
                .join("dream")
                .join("SKILL.md")
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

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        assert_eq!(snapshot.heartbeat.roles.len(), HeartbeatRole::ALL.len());
        for role in HeartbeatRole::ALL {
            let reported = snapshot
                .heartbeat
                .roles
                .iter()
                .find(|status| status.role == role.as_argument())
                .expect("role status");
            assert_eq!(reported.defaults, role.default_settings());
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

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        assert_eq!(snapshot.dream.defaults, heartbeat_dream::default_settings());
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
            .inspect(Path::new(PROJECT_ROOT), home.path(), home.path())
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

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

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

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        assert!(snapshot.managed_block_failure.is_none());
        assert!(snapshot.heartbeat.managed_jobs.is_empty());
        assert!(snapshot.dream.managed_job.is_none());
    }

    /// R2 회귀. 읽을 수 있는 잡 파일에서는 잡 목록이 현행 그대로 나온다.
    #[test]
    fn a_readable_document_reports_its_jobs_and_no_failure() {
        let home = tempdir().expect("temporary directory");
        write_jobs_file(home.path(), &developer_job(&format!("wf-developer{SLUG}")));

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        assert!(snapshot.managed_block_failure.is_none());
        assert_eq!(snapshot.heartbeat.managed_jobs.len(), 1);
        assert_eq!(snapshot.heartbeat.managed_jobs[0].role, "developer");
        assert_eq!(
            snapshot.heartbeat.managed_jobs[0].max_per.as_deref(),
            Some("6/24h")
        );
    }

    /// R2. 읽지 못한 잡 파일은 없는 파일과 다른 상태다. 잡 목록은 비지만 그 사실을 사유와 함께
    /// 밝힌다. 권한을 바꿀 수 있는 unix에서만 재현한다.
    #[cfg(unix)]
    #[test]
    fn an_unreadable_document_is_reported_with_its_path_and_reason() {
        use std::os::unix::fs::PermissionsExt;

        let home = tempdir().expect("temporary directory");
        write_jobs_file(home.path(), &developer_job(&format!("wf-developer{SLUG}")));
        let path = project_jobs_path(home.path(), SLUG);
        // 테스트가 만든 임시 디렉터리 안에서만 권한을 바꾼다.
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).expect("lock document");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("restore permissions");

        let failure = snapshot
            .managed_block_failure
            .expect("managed block read failure");
        assert_eq!(failure.path, path.display().to_string());
        assert!(!failure.message.is_empty());
        // 읽기 실패는 화면이 이미 그리는 통로에도 실린다.
        assert!(snapshot
            .heartbeat
            .read_failures
            .iter()
            .any(|entry| entry.path == path.display().to_string()));
        // 잡 파일이 하트비트 홈 아래 있으므로 데몬 디렉터리 존재로 설치 판정은 "설치됨"이다.
        assert_eq!(
            snapshot.heartbeat.installation,
            IntegrationInstallation::Installed
        );
        assert!(snapshot.heartbeat.managed_jobs.is_empty());
        assert!(snapshot.dream.managed_job.is_none());
    }

    /// R1. 배열 길이가 아니라 창 안 항목만 센다. 경계는 하트비트와 같은 `<`다.
    #[test]
    fn the_used_count_is_the_number_of_timestamps_inside_the_window() {
        let now = at(1_000_000);
        // 창은 24h(86400초)다. 정확히 창 길이만큼 지난 값은 창 밖이고, 1초 안쪽은 창 안이다.
        let recent = vec![
            1_000_000.0 - 86_400.0,
            1_000_000.0 - 86_399.0,
            1_000_000.0 - 100.0,
            1_000_000.0 - 200_000.0,
        ];

        let quota = job_quota(limited("6/24h"), Some(recent), now);

        assert_eq!(
            quota,
            JobQuota::Counted {
                used: 2,
                limit: 6,
                window: "24h".to_owned(),
                exhausted: false,
                recovers_at: None,
            }
        );
    }

    /// R2. 회복 예상 시각은 창 안 가장 오래된 실행 시각에 창 길이를 더한 값이다.
    #[test]
    fn an_exhausted_quota_recovers_one_window_after_its_oldest_run_in_the_window() {
        let now = at(1_000_000);
        let oldest = 1_000_000.0 - 80_000.0;
        let recent = vec![1_000_000.0 - 10.0, oldest, 1_000_000.0 - 40_000.0];

        let quota = job_quota(limited("3/24h"), Some(recent), now);

        assert_eq!(
            quota,
            JobQuota::Counted {
                used: 3,
                limit: 3,
                window: "24h".to_owned(),
                exhausted: true,
                recovers_at: Some(at(oldest as i64 + 86_400).to_rfc3339()),
            }
        );
    }

    /// R5. 한도를 낮춘 직후에는 사용량이 한도보다 클 수 있다. 오류가 아니라 소진이다.
    #[test]
    fn a_used_count_above_the_limit_is_exhausted_and_not_an_error() {
        let now = at(1_000_000);
        let recent = (1..=5).map(|step| 1_000_000.0 - step as f64).collect();

        let quota = job_quota(limited("2/24h"), Some(recent), now);

        let JobQuota::Counted {
            used, exhausted, ..
        } = quota
        else {
            panic!("counted quota");
        };
        assert_eq!(used, 5);
        assert!(exhausted);
    }

    /// SPEC-017 R5. 데몬이 한도로 인정하지 않는 값은 그 잡이 실제로는 무제한으로 돈다는 신호다.
    /// 형식 위반·0 이하 횟수·0 기간이 모두 같은 갈래이고 원문을 함께 담는다(완료 조건 11).
    ///
    /// SPEC-009 시절에는 `0/24h`가 `Counted { exhausted: true }`로 나가 언제나 소진으로 보였고
    /// `4/0h`는 창이 비어 영원히 차지 않았다. 둘 다 화면이 사실과 정반대를 말하던 자리다.
    #[test]
    fn a_limit_the_daemon_ignores_is_reported_as_an_ignored_limit_with_its_original_text() {
        for value in ["0/24h", "4/0h", "4번"] {
            assert_eq!(
                job_quota(limited(value), Some(Vec::new()), at(1_000_000)),
                JobQuota::IgnoredLimit {
                    value: value.to_owned()
                },
                "max_per `{value}`"
            );
        }
    }

    /// SPEC-017 완료 조건 11. 어긋난 값이 있는 잡은 창 안 실행 기록이 여럿이어도 소진이 아니다.
    /// 이 픽스처가 지금까지 `Counted { exhausted: true }`를 만들던 바로 그 상태다.
    #[test]
    fn an_ignored_limit_makes_no_exhaustion_verdict_even_with_runs_in_the_window() {
        let now = at(1_000_000);
        let recent = vec![
            1_000_000.0 - 10.0,
            1_000_000.0 - 20.0,
            1_000_000.0 - 30.0,
            1_000_000.0 - 40.0,
        ];

        assert_eq!(
            job_quota(limited("0/24h"), Some(recent), now),
            JobQuota::IgnoredLimit {
                value: "0/24h".to_owned()
            }
        );
    }

    /// SPEC-017 R6·완료 조건 13. 블록에 있고 한도 줄만 없는 잡은 사용자가 고른 제한 없음이다.
    /// 값을 담지 않으므로 사용 횟수가 화면에 갈 길이 없다. `recent_runs`에 한도가 있던 시절의
    /// 이력이 남아 있어도 마찬가지다 — 데몬은 무제한 잡의 실행을 기록하지 않는다.
    #[test]
    fn a_job_without_a_quota_line_is_the_unlimited_the_user_chose() {
        let now = at(1_000_000);

        assert_eq!(job_quota(UNLIMITED, None, now), JobQuota::Unlimited);
        assert_eq!(
            job_quota(UNLIMITED, Some(Vec::new()), now),
            JobQuota::Unlimited
        );
        assert_eq!(
            job_quota(
                UNLIMITED,
                Some(vec![1_000_000.0 - 10.0, 1_000_000.0 - 20.0]),
                now
            ),
            JobQuota::Unlimited
        );
    }

    /// R5 + SPEC-017 R5. 네 가지 "값 없음"이 서로 다른 값으로 나간다. 무제한 둘이 갈리는 것이
    /// 이 작업이 더한 구분이다(완료 조건 12).
    #[test]
    fn an_unknown_limit_two_kinds_of_unlimited_and_a_missing_record_are_four_values() {
        let now = at(1_000_000);

        assert_eq!(job_quota(ABSENT, Some(vec![1.0]), now), JobQuota::Unknown);
        assert_eq!(
            job_quota(UNLIMITED, Some(vec![1.0]), now),
            JobQuota::Unlimited
        );
        assert_eq!(
            job_quota(limited("6/24"), Some(vec![1.0]), now),
            JobQuota::IgnoredLimit {
                value: "6/24".to_owned()
            }
        );
        assert_eq!(
            job_quota(limited("6/24h"), None, now),
            JobQuota::NoRuns {
                limit: 6,
                window: "24h".to_owned()
            }
        );
        // 빈 배열은 기록이 있는 0회다. "기록 없음"과 다르다.
        assert_eq!(
            job_quota(limited("6/24h"), Some(Vec::new()), now),
            JobQuota::Counted {
                used: 0,
                limit: 6,
                window: "24h".to_owned(),
                exhausted: false,
                recovers_at: None,
            }
        );
    }

    /// 화면이 읽을 키를 못 박는다. variant 이름과 필드 이름이 모두 camelCase다.
    #[test]
    fn the_quota_serializes_with_camel_case_keys() {
        let counted = serde_json::to_value(JobQuota::Counted {
            used: 6,
            limit: 6,
            window: "24h".to_owned(),
            exhausted: true,
            recovers_at: Some("2026-08-03T00:00:00+00:00".to_owned()),
        })
        .expect("counted json");

        assert_eq!(
            counted,
            serde_json::json!({
                "kind": "counted",
                "used": 6,
                "limit": 6,
                "window": "24h",
                "exhausted": true,
                "recoversAt": "2026-08-03T00:00:00+00:00",
            })
        );
        assert_eq!(
            serde_json::to_value(JobQuota::Unknown).expect("unknown json"),
            serde_json::json!({ "kind": "unknown" })
        );
        // 사용자가 고른 제한 없음. 담을 원문이 없으므로 키가 `kind` 하나다.
        assert_eq!(
            serde_json::to_value(JobQuota::Unlimited).expect("unlimited json"),
            serde_json::json!({ "kind": "unlimited" })
        );
        // 값이 어긋나 무제한이 된 상태. 화면이 원문을 보여줘야 하므로 함께 실린다.
        assert_eq!(
            serde_json::to_value(JobQuota::IgnoredLimit {
                value: "6/24".to_owned()
            })
            .expect("ignored limit json"),
            serde_json::json!({ "kind": "ignoredLimit", "value": "6/24" })
        );
        assert_eq!(
            serde_json::to_value(JobQuota::NoRuns {
                limit: 6,
                window: "24h".to_owned()
            })
            .expect("no runs json"),
            serde_json::json!({ "kind": "noRuns", "limit": 6, "window": "24h" })
        );
    }

    /// R1. 한도의 기준은 잡 파일에 적힌 값이다. 앱 기본값(개발자 `6/24h`)이 대신 쓰이지 않는다.
    #[test]
    fn the_limit_comes_from_the_managed_block_and_not_from_the_app_defaults() {
        let home = tempdir().expect("temporary directory");
        write_jobs_file(home.path(), &job_with_quota(DEVELOPER_JOB, "24/24h"));
        write_state(
            home.path(),
            &[(
                DEVELOPER_JOB,
                &[
                    seconds_ago(100.0),
                    seconds_ago(200.0),
                    seconds_ago(200_000.0),
                ],
            )],
        );

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        assert_eq!(
            role_quota(&snapshot, "developer"),
            JobQuota::Counted {
                used: 2,
                limit: 24,
                window: "24h".to_owned(),
                exhausted: false,
                recovers_at: None,
            }
        );
    }

    /// R5. 상태 파일 없음·깨짐·잡 기록 없음이 모두 `noRuns`다. `used: 0`이 아니다.
    #[test]
    fn a_missing_broken_or_absent_record_reports_no_runs_and_not_zero() {
        let cases: [(&str, Option<&str>); 3] = [
            ("missing", None),
            ("broken", Some("{ not json")),
            ("absent", Some(r#"{ "other-job": { "recent_runs": [1] } }"#)),
        ];

        for (label, state) in cases {
            let home = tempdir().expect("temporary directory");
            write_jobs_file(home.path(), &job_with_quota(DEVELOPER_JOB, "6/24h"));
            if let Some(contents) = state {
                write_home_file(home.path(), "heartbeat/state.json", contents);
            }

            let snapshot =
                HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

            assert_eq!(
                role_quota(&snapshot, "developer"),
                JobQuota::NoRuns {
                    limit: 6,
                    window: "24h".to_owned()
                },
                "{label}"
            );
        }
    }

    /// R5. 잡 파일을 읽지 못하면 한도 값을 모른다. 앱 기본값으로 대신 계산하지 않는다.
    /// 권한을 바꿀 수 있는 unix에서만 재현한다.
    #[cfg(unix)]
    #[test]
    fn an_unreadable_managed_block_leaves_every_quota_unknown() {
        use std::os::unix::fs::PermissionsExt;

        let home = tempdir().expect("temporary directory");
        write_jobs_file(
            home.path(),
            &format!(
                "{}{}",
                job_with_quota(DEVELOPER_JOB, "6/24h"),
                job_with_quota(&heartbeat_dream::job_name(SLUG), "6/24h")
            ),
        );
        let path = project_jobs_path(home.path(), SLUG);
        write_state(
            home.path(),
            &[
                (DEVELOPER_JOB, &[seconds_ago(100.0)]),
                (&heartbeat_dream::job_name(SLUG), &[seconds_ago(100.0)]),
            ],
        );
        // 테스트가 만든 임시 디렉터리 안에서만 권한을 바꾼다.
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).expect("lock document");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("restore permissions");

        assert!(snapshot.managed_block_failure.is_some());
        assert!(snapshot
            .heartbeat
            .roles
            .iter()
            .all(|role| role.quota == JobQuota::Unknown));
        assert_eq!(snapshot.dream.quota, JobQuota::Unknown);
    }

    /// R5. 형식이 깨진 `max_per`는 하트비트가 한도 없는 잡으로 다룬다. 앱도 소진 판정을 하지 않는다.
    /// SPEC-017 이후로 이 상태는 사용자가 고른 제한 없음과 다른 값으로 나간다.
    #[test]
    fn a_malformed_limit_is_reported_as_an_ignored_limit_without_an_exhaustion_verdict() {
        let home = tempdir().expect("temporary directory");
        write_jobs_file(home.path(), &job_with_quota(DEVELOPER_JOB, "6/24"));
        write_state(
            home.path(),
            &[(
                DEVELOPER_JOB,
                &[seconds_ago(1.0), seconds_ago(2.0), seconds_ago(3.0)],
            )],
        );

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        assert_eq!(
            role_quota(&snapshot, "developer"),
            JobQuota::IgnoredLimit {
                value: "6/24".to_owned()
            }
        );
    }

    /// R1. dream 잡도 역할 잡과 같은 규칙으로 사용량을 낸다. 잡 종류별 규칙을 만들지 않는다.
    #[test]
    fn the_dream_job_reports_its_quota_with_the_same_rule() {
        let home = tempdir().expect("temporary directory");
        let dream_job = heartbeat_dream::job_name(SLUG);
        write_jobs_file(
            home.path(),
            &format!(
                "{}{}",
                job_with_quota(DEVELOPER_JOB, "6/24h"),
                job_with_quota(&dream_job, "2/24h")
            ),
        );
        write_state(
            home.path(),
            &[
                (DEVELOPER_JOB, &[seconds_ago(100.0)]),
                (
                    dream_job.as_str(),
                    &[seconds_ago(100.0), seconds_ago(200_000.0)],
                ),
            ],
        );

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        assert_eq!(
            role_quota(&snapshot, "developer"),
            JobQuota::Counted {
                used: 1,
                limit: 6,
                window: "24h".to_owned(),
                exhausted: false,
                recovers_at: None,
            }
        );
        let JobQuota::Counted {
            used,
            limit,
            exhausted,
            recovers_at,
            ..
        } = snapshot.dream.quota
        else {
            panic!("counted dream quota");
        };
        assert_eq!((used, limit), (1, 2));
        assert!(!exhausted);
        assert_eq!(recovers_at, None);
    }

    /// SPEC-017 완료 조건 13. 한도 줄이 없는 잡은 조회에서도 사용자가 고른 제한 없음으로 나간다.
    /// `recent_runs`에 한도가 있던 시절의 이력이 남아 있어도 사용 횟수가 실리지 않는다.
    #[test]
    fn a_job_whose_quota_line_was_removed_reports_the_chosen_unlimited() {
        let home = tempdir().expect("temporary directory");
        let dream_job = heartbeat_dream::job_name(SLUG);
        write_jobs_file(
            home.path(),
            &format!(
                "{}{}",
                job_without_quota(DEVELOPER_JOB),
                job_without_quota(&dream_job)
            ),
        );
        write_state(
            home.path(),
            &[
                (
                    DEVELOPER_JOB,
                    &[seconds_ago(10.0), seconds_ago(20.0), seconds_ago(30.0)],
                ),
                (dream_job.as_str(), &[seconds_ago(10.0)]),
            ],
        );

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        // 잡 종류별로 규칙이 갈리지 않는다.
        assert_eq!(role_quota(&snapshot, "developer"), JobQuota::Unlimited);
        assert_eq!(snapshot.dream.quota, JobQuota::Unlimited);
        // 블록에 없는 두 역할은 여전히 `Unknown`이다. 제한 없음과 섞이지 않는다.
        assert_eq!(role_quota(&snapshot, "planner"), JobQuota::Unknown);
        assert_eq!(role_quota(&snapshot, "architect"), JobQuota::Unknown);
    }

    /// SPEC-017 완료 조건 11·12. 어긋난 값이 있는 잡은 조회에서 `IgnoredLimit`이고, 같은 화면의
    /// 제한 없음인 잡과 다른 값으로 나간다. `0/24h`가 "항상 소진"으로 보이던 상태의 회귀 테스트다.
    #[test]
    fn the_chosen_unlimited_and_an_ignored_limit_leave_the_snapshot_as_different_values() {
        let home = tempdir().expect("temporary directory");
        let dream_job = heartbeat_dream::job_name(SLUG);
        write_jobs_file(
            home.path(),
            &format!(
                "{}{}",
                job_with_quota(DEVELOPER_JOB, "0/24h"),
                job_without_quota(&dream_job)
            ),
        );
        write_state(
            home.path(),
            &[(
                DEVELOPER_JOB,
                &[seconds_ago(10.0), seconds_ago(20.0), seconds_ago(30.0)],
            )],
        );

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        assert_eq!(
            role_quota(&snapshot, "developer"),
            JobQuota::IgnoredLimit {
                value: "0/24h".to_owned()
            }
        );
        assert_eq!(snapshot.dream.quota, JobQuota::Unlimited);
        assert_ne!(role_quota(&snapshot, "developer"), snapshot.dream.quota);
    }

    /// SPEC-017 완료 조건 10. 어긋난 값을 둔 상태에서 조회를 여러 번 거쳐도 앱은 잡 파일을
    /// 고치거나 지우지 않는다. 내용과 수정 시각을 함께 본다.
    #[test]
    fn inspecting_a_document_with_an_ignored_limit_does_not_touch_it() {
        let home = tempdir().expect("temporary directory");
        let original = format!(
            "{}{}",
            job_with_quota(DEVELOPER_JOB, "4/0h"),
            job_without_quota(&heartbeat_dream::job_name(SLUG))
        );
        write_jobs_file(home.path(), &original);
        let path = project_jobs_path(home.path(), SLUG);
        let before = fs::metadata(&path).expect("metadata").modified().ok();

        for _ in 0..3 {
            HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());
        }

        assert_eq!(fs::read_to_string(&path).ok(), Some(original));
        assert_eq!(
            fs::metadata(&path).expect("metadata").modified().ok(),
            before
        );
    }

    /// R6. 사용량을 실어도 상태 파일 읽기 시도 횟수는 연동별 1회씩 그대로다. 읽기 실패 목록은
    /// 시도마다 쌓이므로 시도 횟수의 관찰 가능한 대리값이다.
    #[test]
    fn carrying_the_quota_does_not_add_a_state_file_read() {
        let home = tempdir().expect("temporary directory");
        // 파일 자리를 디렉터리로 만들어 읽기를 실패시킨다.
        let state = home.path().join("heartbeat").join("state.json");
        fs::create_dir_all(&state).expect("state directory");

        let snapshot = HeartbeatService.inspect(Path::new(PROJECT_ROOT), home.path(), home.path());

        let attempts = |failures: &[crate::domain::project::HeartbeatReadFailure]| {
            failures
                .iter()
                .filter(|failure| failure.path == state.display().to_string())
                .count()
        };
        assert_eq!(attempts(&snapshot.heartbeat.read_failures), 1);
        assert_eq!(attempts(&snapshot.dream.read_failures), 1);
    }

    fn write_skill(home: &Path) {
        write_home_file(home, "skills/dream/SKILL.md", "# dream\n");
    }

    /// macOS 표준 서비스 등록 아티팩트. 감지하지 않는 플랫폼에서도 만들어 두고, 그래도 확인 불가로
    /// 남는지를 함께 본다.
    fn write_launch_agent(user_home: &Path) {
        write_home_file(
            user_home,
            "Library/LaunchAgents/com.claude-heartbeat.plist",
            "<plist version=\"1.0\"/>\n",
        );
    }

    /// 테스트 픽스처만 쓴다. 조회 경로는 아무것도 쓰지 않는다.
    fn write_home_file(home: &Path, relative: &str, contents: &str) {
        let path = home.join(relative);
        fs::create_dir_all(path.parent().expect("fixture directory")).expect("fixture directory");
        fs::write(path, contents).expect("fixture file");
    }

    /// 스냅샷이 실은 설치 단계. 단계 이름을 붙여 돌려주므로 순서까지 한 단정에 고정된다(R2).
    fn setup_states(
        snapshot: &super::IntegrationsSnapshot,
    ) -> Vec<(HeartbeatSetupStep, HeartbeatSetupState)> {
        snapshot
            .heartbeat
            .setup_stages
            .iter()
            .map(|stage| (stage.step, stage.state))
            .collect()
    }

    fn setup_stage(
        snapshot: &super::IntegrationsSnapshot,
        step: HeartbeatSetupStep,
    ) -> HeartbeatSetupStage {
        snapshot
            .heartbeat
            .setup_stages
            .iter()
            .find(|stage| stage.step == step)
            .expect("setup stage")
            .clone()
    }

    /// 디렉터리 아래 모든 항목의 경로와 수정 시각.
    fn tree(root: &Path) -> BTreeMap<String, SystemTime> {
        let mut entries = BTreeMap::new();
        collect(root, &mut entries);
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

/// 설치 경로는 세 플랫폼에서 모두 검증한다. 자산이 플랫폼별로 갈린 뒤로 설치가 POSIX `sh`를
/// 전제하지 않으므로, 모듈 단위 게이트를 두지 않는다. 재현할 수 없는 사유가 있는 테스트는 그
/// 테스트 하나만 게이트하고 사유를 옆에 적는다.
#[cfg(test)]
mod install_tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use tempfile::{tempdir, TempDir};

    use super::{
        managed_dream_job, managed_role_jobs, DreamJobRequest, HeartbeatInstallError,
        HeartbeatService, IntegrationsSnapshot, ManagedDreamJob, ManagedRoleJob, MaxPerRequest,
        RoleJobRequest,
    };
    use crate::infrastructure::heartbeat_condition::condition_script_path;
    use crate::infrastructure::heartbeat_jobs::{
        project_jobs_path, project_slug, HeartbeatJobsError, MANAGED_END, MANAGED_START,
    };
    use crate::infrastructure::heartbeat_roles::condition_command;

    /// 프로젝트 루트와 하트비트 홈을 임시 디렉터리로 만든다. 실제 `~/.claude`는 건드리지 않는다.
    fn workspace() -> (TempDir, TempDir) {
        (
            tempdir().expect("project root"),
            tempdir().expect("heartbeat home"),
        )
    }

    /// 한도를 지정하는 요청 값. `null`(지정 안 함)·제한 없음과 구별되는 세 번째 상태다(R3).
    fn limit(value: &str) -> Option<MaxPerRequest> {
        Some(MaxPerRequest::Limit {
            value: value.to_owned(),
        })
    }

    fn request(role: &str, enabled: bool) -> RoleJobRequest {
        let (interval, max_per) = if role == "developer" {
            ("20m", "6/24h")
        } else {
            ("30m", "4/24h")
        };
        let timeout = if role == "developer" { "30m" } else { "20m" };
        RoleJobRequest {
            role: role.to_owned(),
            enabled,
            interval: Some(interval.to_owned()),
            max_per: limit(max_per),
            model: Some("opus".to_owned()),
            timeout: Some(timeout.to_owned()),
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
            timeout: None,
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
            max_per: limit("6/24h"),
            model: Some("opus".to_owned()),
            timeout: Some("30m".to_owned()),
        }
    }

    /// 사용자가 dream 잡의 어떤 필드도 지정하지 않은 요청.
    fn untouched_dream_request(enabled: bool) -> DreamJobRequest {
        DreamJobRequest {
            enabled,
            interval: None,
            max_per: None,
            model: None,
            timeout: None,
        }
    }

    /// 파일에 적힌 그대로의 기준값. 화면이 방금 읽어 폼을 시딩한 상태와 같다(R3).
    fn role_baseline(project: &TempDir, home: &TempDir) -> Vec<ManagedRoleJob> {
        let document = fs::read_to_string(jobs_file(project, home)).unwrap_or_default();
        managed_role_jobs(&document, &project_slug(project.path()))
    }

    fn dream_baseline(project: &TempDir, home: &TempDir) -> Option<ManagedDreamJob> {
        let document = fs::read_to_string(jobs_file(project, home)).unwrap_or_default();
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
        HeartbeatService.install(project.path(), home.path(), home.path(), roles, baseline)
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
        HeartbeatService.install_dream(project.path(), home.path(), home.path(), dream, baseline)
    }

    /// 앱이 쓰는 파일. 경로가 slug에서 나오므로 하트비트 홈만으로는 정해지지 않는다.
    fn jobs_file(project: &TempDir, home: &TempDir) -> PathBuf {
        project_jobs_path(home.path(), &project_slug(project.path()))
    }

    /// 전환 뒤 앱이 더는 쓰지 않는 옛 전역 파일. 이 모듈은 "쓰지 않는다"를 확인할 때만 연다.
    fn legacy_file(home: &TempDir) -> PathBuf {
        home.path().join("HEARTBEAT.md")
    }

    /// 저장 전부터 잡 파일이 있던 상태를 만든다. 디렉터리는 쓰는 쪽이 만든다(계약 19~21줄).
    fn seed_jobs_file(project: &TempDir, home: &TempDir, contents: &str) {
        let path = jobs_file(project, home);
        fs::create_dir_all(path.parent().expect("jobs directory")).expect("jobs directory");
        fs::write(path, contents).expect("seed jobs file");
    }

    fn script_file(project: &TempDir) -> PathBuf {
        condition_script_path(&project.path().join(".workflow"))
    }

    /// 파일이 없으면 `None`이다. "쓰이지 않았다"를 없음과 내용 동일 두 경우로 함께 확인한다.
    fn snapshot(path: &Path) -> Option<String> {
        fs::read_to_string(path).ok()
    }

    /// 이 컴퓨터의 다른 프로젝트. `HEARTBEAT.md`는 모든 프로젝트가 함께 쓰는 파일이라 관리 블록
    /// 안에 여러 프로젝트의 잡이 이름 충돌 없이 공존한다(SPEC-022 확인 사실 4).
    ///
    /// 값은 SPEC-024 확인 사실 2가 실측한 slug 그대로다. 이 기기의 옛 블록에 실제로 들어 있던
    /// 것이 이 프로젝트의 잡이고, 전환 전에는 이 프로젝트의 저장 한 번이 그것을 지웠다.
    const OTHER_SLUG: &str = "-Users-catze-Git-mech-arena";

    /// 다른 프로젝트의 역할 잡. 잡 이름 규칙은 이 프로젝트와 같은 `wf-{role}{slug}`다(확인 사실 4).
    ///
    /// 앱 렌더러가 쓰지 않는 필드(`retries`), 앱과 다른 필드 순서, 앱 검증을 통과하지 못하는
    /// 값(`interval: 20분`)을 일부러 섞었다. 이 잡을 앱 렌더러로 다시 쓰면 셋이 모두 사라지므로
    /// (확인 사실 14), 이 본문이 곧 "원문 그대로 보존"의 판정 수단이다.
    fn other_role_job() -> String {
        format!(
            "## wf-developer{OTHER_SLUG}\n\
             - interval: 20분\n\
             - slug: {OTHER_SLUG}\n\
             - retries: 2\n\
             - model: opus\n\
             - prompt: 개발자 역할로 진행해 줘"
        )
    }

    /// 다른 프로젝트의 dream 잡. 같은 이유로 앱이 모르는 필드(`window`)와 다른 순서를 갖는다.
    fn other_dream_job() -> String {
        format!(
            "## wf-dream{OTHER_SLUG}\n\
             - notify: never\n\
             - slug: {OTHER_SLUG}\n\
             - window: 22:00-06:00\n\
             - model: sonnet\n\
             - interval: 3h"
        )
    }

    /// SPEC-024 확인 사실 2의 실제 상태. 관리 블록 **안**에 다른 프로젝트의 잡 둘만 있는 옛
    /// 전역 파일이고, 전환 전에는 이 프로젝트의 저장 한 번이 그 잡들을 지우던 파일이다.
    fn other_project_document() -> String {
        format!(
            "# HEARTBEAT\n- tick: 5m\n\n{MANAGED_START}\n{}\n\n{}\n{MANAGED_END}\n",
            other_role_job(),
            other_dream_job()
        )
    }

    fn seed_other_project_block(home: &TempDir) {
        fs::write(legacy_file(home), other_project_document()).expect("seed heartbeat file");
    }

    /// 전환 전에 앱이 옛 파일에 써 둔 이 프로젝트의 역할 잡. 조건 문자열이 앱이 쓰던 것과 같아
    /// 정리에 실패한 잔여는 중복 감지에도 걸린다.
    fn my_role_job(project: &TempDir, role: &str) -> String {
        let slug = project_slug(project.path());
        format!(
            "## wf-{role}{slug}\n\
             - slug: {slug}\n\
             - model: opus\n\
             - interval: 20m\n\
             - condition: {}\n\
             - notify: all",
            condition_command(role)
        )
    }

    /// 완료 조건 1의 픽스처. 관리 블록 **안**에 이 프로젝트의 역할 잡 셋과 다른 프로젝트의 잡 둘이
    /// 함께 들어 있다. 전환 전 앱이 쓴 정의가 그대로 남아 있는 상태다.
    ///
    /// 이 프로젝트의 잡이 빠지고 나면 남는 것이 `other_project_document()`와 바이트 단위로 같아야
    /// 한다 — 그것이 "내 잡만 빼고 남의 잡은 원문 그대로"의 판정이다.
    fn seed_mixed_block(project: &TempDir, home: &TempDir) {
        let mine = ["planner", "architect", "developer"]
            .map(|role| my_role_job(project, role))
            .join("\n\n");
        let document = format!(
            "# HEARTBEAT\n- tick: 5m\n\n{MANAGED_START}\n{mine}\n\n{}\n\n{}\n{MANAGED_END}\n",
            other_role_job(),
            other_dream_job()
        );
        fs::write(legacy_file(home), document).expect("seed heartbeat file");
    }

    /// 전환 뒤 판정은 블록 구간 대조보다 강하다. 앱이 이 파일을 아예 쓰지 않으므로 저장 전후가
    /// 파일 전체에서 바이트 단위로 같다(SPEC-024 완료 조건 4). 사고에서 사용자가 잃은 것은 잡의
    /// 존재가 아니라 맞춰 둔 값이었으므로, 판정 기준은 여전히 "값이 그대로다"다.
    fn assert_other_project_jobs_intact(home: &TempDir) {
        assert_eq!(
            snapshot(&legacy_file(home)),
            Some(other_project_document()),
            "옛 전역 파일이 한 바이트도 바뀌면 안 된다"
        );
    }

    /// SPEC-024 완료 조건 1·3. 디렉터리가 하나도 없는 홈에서 저장하면 잡이
    /// `<home>/heartbeat/jobs.d/<slug>.md`에 기록된다. 경로를 여기서 한 번 글자로 고정해, 서비스가
    /// 부르는 경로 함수가 다른 자리를 가리키게 되면 이 시험이 먼저 깨지게 한다.
    #[test]
    fn installs_the_condition_script_and_the_role_jobs_together() {
        let (project, home) = workspace();

        let installed = install(&project, &home, &all_enabled()).expect("install");

        let script = snapshot(&script_file(&project)).expect("condition script");
        assert!(script.contains("# managed_by: workflow-labs"));

        assert_eq!(
            jobs_file(&project, &home),
            home.path()
                .join("heartbeat")
                .join("jobs.d")
                .join(format!("{}.md", installed.slug))
        );
        let document = snapshot(&jobs_file(&project, &home)).expect("jobs file");
        for role in ["planner", "architect", "developer"] {
            assert!(document.contains(&format!("## wf-{role}{}", installed.slug)));
            // 기록되는 조건은 실행 플랫폼의 형태다. 그 형태의 바이트 고정은 `heartbeat_roles`가
            // 갖고, 여기서는 설치가 그 값을 그대로 썼는지만 본다.
            assert!(document.contains(&format!("- condition: {}", condition_command(role))));
        }

        // 5단계. 프론트가 상태를 다시 조회하지 않아도 되도록 갱신된 스냅샷을 함께 돌려준다.
        assert_eq!(installed.heartbeat.managed_jobs.len(), 3);
    }

    /// 확인 화면이 가리키는 파일과 저장이 실제로 쓴 파일이 같다(SPEC-024 R7). 화면은 이 값을
    /// 그리기만 하므로, 두 경로가 갈라지면 그 사고는 여기서만 잡힌다.
    #[test]
    fn the_snapshot_names_the_file_the_save_actually_wrote() {
        let (project, home) = workspace();

        let installed = install(&project, &home, &all_enabled()).expect("install");

        let written = jobs_file(&project, &home);
        assert_eq!(installed.jobs_file_path, written.display().to_string());
        assert!(written.exists(), "화면이 가리키는 파일이 실제로 있다");
        // 옛 전역 파일이 아니다. 전환 전 화면이 가리키던 그 파일은 저장이 만들지도 않는다.
        assert_ne!(
            installed.jobs_file_path,
            legacy_file(&home).display().to_string()
        );
        assert!(!legacy_file(&home).exists());
    }

    /// dream 저장도 같은 파일을 가리킨다. 두 카드가 한 파일을 쓰므로 섹션 공통 값이다.
    #[test]
    fn the_dream_snapshot_names_the_same_jobs_file() {
        let (project, home) = workspace();

        let installed =
            install_dream(&project, &home, &dream_request(true)).expect("install dream");

        assert_eq!(
            installed.jobs_file_path,
            jobs_file(&project, &home).display().to_string()
        );
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
        assert_eq!(snapshot(&jobs_file(&project, &home)), None);
    }

    #[test]
    fn an_unknown_role_writes_neither_file() {
        let (project, home) = workspace();
        let mut roles = all_enabled();
        roles.push(request("reviewer", true));

        let error = install(&project, &home, &roles).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::UnknownRole(role) if role == "reviewer"));
        assert_eq!(snapshot(&script_file(&project)), None);
        assert_eq!(snapshot(&jobs_file(&project, &home)), None);
    }

    #[test]
    fn a_failed_condition_script_install_leaves_the_jobs_file_alone() {
        let (project, home) = workspace();
        let script = script_file(&project);
        fs::create_dir_all(script.parent().expect("rules directory")).expect("rules directory");
        let unmanaged = "#!/bin/sh\nexit 0\n";
        fs::write(&script, unmanaged).expect("seed script");
        let original = "- tick: 5m\n\n## my-job\n- slug: -tmp-demo\n";
        seed_jobs_file(&project, &home, original);

        let error = install(&project, &home, &all_enabled()).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ConditionScript(_)));
        assert_eq!(snapshot(&script), Some(unmanaged.to_owned()));
        assert_eq!(
            snapshot(&jobs_file(&project, &home)),
            Some(original.to_owned())
        );
    }

    #[test]
    fn the_same_install_twice_changes_neither_file() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("first install");
        let script = snapshot(&script_file(&project));
        let document = snapshot(&jobs_file(&project, &home));

        install(&project, &home, &all_enabled()).expect("second install");

        assert_eq!(snapshot(&script_file(&project)), script);
        assert_eq!(snapshot(&jobs_file(&project, &home)), document);
    }

    #[test]
    fn turning_a_role_off_and_on_restores_the_first_install() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let first = snapshot(&jobs_file(&project, &home));

        let mut disabled = all_enabled();
        disabled[1].enabled = false;
        let updated = install(&project, &home, &disabled).expect("disable architect");
        let document = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
        assert!(!document.contains(&format!("## wf-architect{}", updated.slug)));
        assert_eq!(updated.heartbeat.managed_jobs.len(), 2);

        install(&project, &home, &all_enabled()).expect("enable architect");
        assert_eq!(snapshot(&jobs_file(&project, &home)), first);
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
        // 잡이 하나도 남지 않으면 파일이 사라진다. 없는 파일이 잡 없음의 정규 표현이라
        // (SPEC-024 R2) 빈 파일을 남기지 않는다. 옛 경로에서는 마커만 지운 빈 문서가 남았다.
        assert_eq!(snapshot(&jobs_file(&project, &home)), None);
        assert_eq!(snapshot(&script_file(&project)), script);
    }

    /// 완료 조건 4. 연동이 둘이어도 파일은 하나다. 그 파일에는 마커가 없다 — 파일 전체가 앱
    /// 소유라 나눠 쓸 남이 없고, 계약이 마커 구조를 지원하지 않는다(SPEC-024 확인 사실 12).
    #[test]
    fn installing_only_the_dream_job_writes_one_block_with_one_job() {
        let (project, home) = workspace();

        let installed = install_dream(&project, &home, &dream_request(true)).expect("install");

        let document = snapshot(&jobs_file(&project, &home)).expect("jobs file");
        assert!(!document.contains(MANAGED_START), "{document}");
        assert!(!document.contains(MANAGED_END), "{document}");
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
        let roles_only = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");

        install_dream(&project, &home, &dream_request(true)).expect("install dream");

        let both = snapshot(&jobs_file(&project, &home)).expect("jobs file");
        // 종료 마커를 떼어 낼 필요가 없다. 파일이 역할 잡으로 끝나므로 dream 잡은 그 뒤에 붙는다.
        assert!(
            both.starts_with(&roles_only),
            "역할 잡 부분이 그대로여야 한다: {both}"
        );
        assert!(both.contains("## wf-dream"));
    }

    /// 완료 조건 6. 반대 방향도 성립한다. 역할 잡 저장이 dream 잡을 지우지 않는다.
    #[test]
    fn saving_role_jobs_keeps_an_installed_dream_job() {
        let (project, home) = workspace();
        install_dream(&project, &home, &dream_request(true)).expect("install dream");

        let mut roles = all_enabled();
        roles[2].interval = Some("45m".to_owned());
        let updated = install(&project, &home, &roles).expect("save roles");

        let document = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
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
            snapshot(&jobs_file(&project, &roles_first)),
            snapshot(&jobs_file(&project, &dream_first))
        );
    }

    /// 완료 조건 5.
    #[test]
    fn the_same_dream_install_twice_does_not_change_the_file() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install roles");
        install_dream(&project, &home, &dream_request(true)).expect("first install");
        let first = snapshot(&jobs_file(&project, &home));

        install_dream(&project, &home, &dream_request(true)).expect("second install");

        assert_eq!(snapshot(&jobs_file(&project, &home)), first);
    }

    /// 완료 조건 7.
    #[test]
    fn turning_the_dream_job_off_and_on_restores_the_first_install() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install roles");
        install_dream(&project, &home, &dream_request(true)).expect("install dream");
        let first = snapshot(&jobs_file(&project, &home));

        let disabled = install_dream(&project, &home, &dream_request(false)).expect("disable");
        let document = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
        assert!(!document.contains("## wf-dream"));
        assert_eq!(disabled.heartbeat.managed_jobs.len(), 3);
        assert_eq!(disabled.dream.managed_job, None);

        install_dream(&project, &home, &dream_request(true)).expect("enable");
        assert_eq!(snapshot(&jobs_file(&project, &home)), first);
    }

    /// 완료 조건 5. 이 프로젝트의 잡을 전부 끄면 잡 파일이 사라지고, 같은 저장에서 옛 전역 파일은
    /// 한 바이트도 바뀌지 않는다. 전환 전에는 이 경로가 그 파일의 블록을 마커째 지웠다
    /// (SPEC-024 확인 사실 5·6).
    #[test]
    fn turning_both_integrations_off_removes_the_block_and_keeps_the_rest() {
        let (project, home) = workspace();
        let original = "# HEARTBEAT\n- tick: 5m\n\n## my-job\n- slug: -tmp-demo\n- prompt: 안녕\n";
        fs::write(legacy_file(&home), original).expect("seed heartbeat file");
        install(&project, &home, &all_enabled()).expect("install roles");
        install_dream(&project, &home, &dream_request(true)).expect("install dream");

        install_dream(&project, &home, &dream_request(false)).expect("disable dream");
        let disabled = vec![
            request("planner", false),
            request("architect", false),
            request("developer", false),
        ];
        install(&project, &home, &disabled).expect("disable roles");

        assert_eq!(snapshot(&jobs_file(&project, &home)), None);
        assert_eq!(snapshot(&legacy_file(&home)).as_deref(), Some(original));
    }

    // 여기부터 네 개는 관리 블록 **안**에 있는 다른 프로젝트의 잡을 다룬다. 2026-08-04 15:15에
    // 실제로 이 경로로 다른 저장소의 역할 잡 세 개가 사용자가 맞춰 둔 값째로 사라졌다.
    //
    // 전환 뒤에도 네 시험이 지키는 성질은 같지만 성립하는 이유가 바뀌었다. 앱이 남의 잡을 골라
    // 보존하는 것이 아니라 그 파일을 아예 열지 않는다. 그래서 판정도 블록 구간 대조에서 파일 전체
    // 바이트 대조로 강해졌다(SPEC-024 완료 조건 4).

    /// SPEC-022 완료 조건 1. 역할 잡 저장이 블록을 통째로 다시 쓰면서(확인 사실 5) 병합 목록에
    /// 없는 남의 잡을 함께 지웠다(확인 사실 1).
    #[test]
    fn saving_role_jobs_keeps_another_projects_jobs_in_the_block() {
        let (project, home) = workspace();
        seed_other_project_block(&home);

        install(&project, &home, &all_enabled()).expect("save the role jobs");

        assert_other_project_jobs_intact(&home);
    }

    /// SPEC-022 완료 조건 2. dream 저장도 같은 병합을 거치므로 같은 결과가 된다.
    #[test]
    fn saving_the_dream_job_keeps_another_projects_jobs_in_the_block() {
        let (project, home) = workspace();
        seed_other_project_block(&home);

        install_dream(&project, &home, &dream_request(true)).expect("save the dream job");

        assert_other_project_jobs_intact(&home);
    }

    /// SPEC-022 완료 조건 3 · SPEC-024 완료 조건 5. 확인 사실 6의 경로다. 전환 전에는 이 프로젝트의
    /// 잡이 하나도 남지 않으면 블록이 마커째 제거되면서 블록 안 남의 잡이 함께 없어졌다. 이제 이
    /// 저장은 자기 잡 파일만 지운다.
    #[test]
    fn turning_every_job_of_this_project_off_keeps_another_projects_jobs_in_the_block() {
        let (project, home) = workspace();
        seed_other_project_block(&home);
        install(&project, &home, &all_enabled()).expect("install roles");
        install_dream(&project, &home, &dream_request(true)).expect("install dream");

        install_dream(&project, &home, &dream_request(false)).expect("disable dream");
        let disabled = vec![
            request("planner", false),
            request("architect", false),
            request("developer", false),
        ];
        install(&project, &home, &disabled).expect("disable roles");

        assert_eq!(snapshot(&jobs_file(&project, &home)), None);
        assert_other_project_jobs_intact(&home);
    }

    /// SPEC-022 완료 조건 5 · R2. 픽스처의 남의 역할 잡은 앱 검증을 통과하지 못하는
    /// `- interval: 20분`을 갖고 있다. 보존이 그 값을 해석하기 시작하면 확인 사실 13의 실패가
    /// 남의 잡에도 걸려, 다른 프로젝트가 손으로 적어 둔 값 하나가 이 프로젝트의 저장을 영구히
    /// 막을 수 있다. 두 저장 경로 모두 그 값 때문에 실패하지 않아야 한다.
    #[test]
    fn an_invalid_value_in_another_projects_job_does_not_block_this_projects_save() {
        let (project, home) = workspace();
        seed_other_project_block(&home);

        install(&project, &home, &all_enabled())
            .expect("남의 잡 값이 역할 잡 저장을 막으면 안 된다");
        install_dream(&project, &home, &dream_request(true))
            .expect("남의 잡 값이 dream 잡 저장을 막으면 안 된다");

        assert_other_project_jobs_intact(&home);
    }

    // 여기부터 여섯은 전환이 남긴 옛 정의의 정리다(SPEC-024 R3, 확인 필요 2번의 승인된 제안).
    // 위 넷이 "남의 잡을 건드리지 않는다"를 고정한 자리에서, 이 여섯은 "내 잡은 빼 간다"를 고정한다.

    /// 완료 조건 1·2. 두 slug가 섞인 블록에서 역할 잡을 저장하면 이 프로젝트의 잡만 빠진다.
    /// 남은 파일이 남의 잡만 있던 픽스처와 바이트 단위로 같다 — 잡의 존재뿐 아니라 값과 자리까지
    /// 그대로라는 뜻이다.
    #[test]
    fn saving_role_jobs_takes_this_projects_jobs_out_of_the_legacy_block() {
        let (project, home) = workspace();
        seed_mixed_block(&project, &home);

        install(&project, &home, &all_enabled()).expect("save the role jobs");

        assert_other_project_jobs_intact(&home);
    }

    /// 완료 조건 1·2의 dream 쪽 짝. 두 저장 경로가 같은 소유 목록을 쓰므로 어느 쪽으로 저장해도
    /// 이 프로젝트의 잡이 모두 빠진다. 역할 잡을 한 번도 저장하지 않은 상태에서도 성립한다.
    #[test]
    fn saving_the_dream_job_takes_this_projects_jobs_out_of_the_legacy_block() {
        let (project, home) = workspace();
        seed_mixed_block(&project, &home);

        install_dream(&project, &home, &dream_request(true)).expect("save the dream job");

        assert_other_project_jobs_intact(&home);
    }

    /// 완료 조건 3. 이 프로젝트의 잡을 전부 끄는 저장에서도 정리가 돈다. 끄는 저장은 잡 파일을
    /// 지우는데, 그때 옛 파일의 잔여를 놓치면 지운 잡이 옛 정의로만 남는다.
    #[test]
    fn turning_every_job_off_still_takes_this_projects_jobs_out_of_the_legacy_block() {
        let (project, home) = workspace();
        seed_mixed_block(&project, &home);

        let disabled = vec![
            request("planner", false),
            request("architect", false),
            request("developer", false),
        ];
        install(&project, &home, &disabled).expect("disable every role");

        assert_eq!(snapshot(&jobs_file(&project, &home)), None);
        assert_other_project_jobs_intact(&home);
    }

    /// 완료 조건 4. 블록에 이 프로젝트의 잡만 있었다면 정리 뒤 마커까지 사라진다. 블록 밖의 잡과
    /// 전역 설정은 손대지 않으므로 파일이 블록을 설치하기 전 내용으로 정확히 돌아간다.
    #[test]
    fn a_legacy_block_holding_only_this_projects_jobs_goes_away_with_its_markers() {
        let (project, home) = workspace();
        let outside = "# HEARTBEAT\n- tick: 5m\n\n## my-job\n- slug: -tmp-demo\n- prompt: 안녕\n";
        let mine = ["planner", "architect", "developer"]
            .map(|role| my_role_job(&project, role))
            .join("\n\n");
        fs::write(
            legacy_file(&home),
            format!("{outside}\n{MANAGED_START}\n{mine}\n{MANAGED_END}\n"),
        )
        .expect("seed heartbeat file");

        install(&project, &home, &all_enabled()).expect("save the role jobs");

        assert_eq!(snapshot(&legacy_file(&home)).as_deref(), Some(outside));
    }

    /// 완료 조건 5. 옛 파일의 마커가 손상돼 정리가 거부돼도 저장은 성공한다. 그 시점에 잡 파일
    /// 쓰기는 이미 끝났고 데몬은 jobs.d를 이기므로, 여기서 오류를 올리면 성공한 저장이 실패로
    /// 보고되고 이 프로젝트와 무관한 파일 하나가 앱의 저장을 영구히 막는다.
    ///
    /// 완료 조건 6. 삼킨 사실은 사라지지 않는다. 정리하지 못한 잡이 그 저장이 돌려주는 스냅샷의
    /// 중복 잡 목록에 그대로 실려 사용자가 화면에서 본다.
    #[test]
    fn a_legacy_block_the_cleanup_cannot_touch_still_reaches_the_screen_as_a_duplicate() {
        let (project, home) = workspace();
        // 시작 마커만 있는 파일. `install_managed_jobs`는 이 상태를 언제나 거부한다.
        let damaged = format!(
            "{}\n\n{MANAGED_START}\n",
            my_role_job(&project, "developer")
        );
        fs::write(legacy_file(&home), &damaged).expect("seed heartbeat file");

        let installed = install(&project, &home, &all_enabled()).expect("save must succeed");

        // 저장은 성공했고 잡 파일에 잡이 들어갔다.
        assert_eq!(installed.heartbeat.managed_jobs.len(), 3);
        // 정리는 아무것도 못 했고 옛 파일은 한 바이트도 바뀌지 않았다.
        assert_eq!(snapshot(&legacy_file(&home)), Some(damaged));
        // 그 사실이 화면으로 나간다.
        let reported = installed
            .heartbeat
            .duplicate_jobs
            .iter()
            .map(|job| job.name.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            reported,
            vec![format!("wf-developer{}", project_slug(project.path()))]
        );
    }

    /// 정리가 옛 파일을 만들어 내지는 않는다. 그 파일의 존재는 설치 판정(`heartbeat_status.rs`의
    /// 세 갈래 OR)과 설치 안내 2단계(`heartbeat_setup.rs`)의 근거다. 저장이 빈 파일이나 마커만 있는
    /// 파일을 남기면 `heartbeat init`을 하지 않은 기기가 "설치됨"으로 보이고 안내 단계가 건너뛰어진다.
    #[test]
    fn the_cleanup_does_not_create_the_legacy_file_when_it_is_absent() {
        let (project, home) = workspace();

        install(&project, &home, &all_enabled()).expect("save the role jobs");
        install_dream(&project, &home, &dream_request(true)).expect("save the dream job");

        assert_eq!(snapshot(&legacy_file(&home)), None);
        assert!(!legacy_file(&home).exists());
    }

    /// 완료 조건 6·8. 정리 전에는 블록 **안**의 잔여가 중복으로 보이고, 정리가 성공한 뒤 같은
    /// 저장이 돌려주는 스냅샷에서는 목록이 빈다. 두 연동 카드 모두에서 빈다.
    #[test]
    fn the_snapshot_stops_reporting_duplicates_once_the_cleanup_succeeds() {
        let (project, home) = workspace();
        seed_mixed_block(&project, &home);

        let before = HeartbeatService.inspect(project.path(), home.path(), home.path());
        let reported = before
            .heartbeat
            .duplicate_jobs
            .iter()
            .map(|job| job.role.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            reported,
            vec![
                Some("planner".to_owned()),
                Some("architect".to_owned()),
                Some("developer".to_owned()),
            ],
            "블록 안의 잔여가 정리 전에는 보여야 한다"
        );

        let installed = install(&project, &home, &all_enabled()).expect("save the role jobs");

        assert!(installed.heartbeat.duplicate_jobs.is_empty());
        assert!(installed.dream.duplicate_jobs.is_empty());
    }

    /// 보존 대상 잡을 손으로 깨뜨린 경우. 조용히 기본값으로 되돌리지 않고 어느 잡·필드인지 밝힌다.
    #[test]
    fn a_damaged_preserved_role_job_stops_the_dream_install() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install roles");
        let damaged = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            .replace("- interval: 20m", "- interval: 20분");
        fs::write(jobs_file(&project, &home), &damaged).expect("damage file");

        let error = install_dream(&project, &home, &dream_request(true)).expect_err("must fail");

        let message = error.to_string();
        assert!(message.contains("wf-developer"), "잡 이름: {message}");
        assert!(message.contains("interval"), "필드 이름: {message}");
        assert_eq!(snapshot(&jobs_file(&project, &home)), Some(damaged));
    }

    #[test]
    fn an_invalid_dream_setting_writes_nothing() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install roles");
        let installed = snapshot(&jobs_file(&project, &home));
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
        assert_eq!(snapshot(&jobs_file(&project, &home)), installed);
    }

    /// 전환 전에는 옛 전역 파일의 마커가 손상돼 있으면 dream 저장이 거부됐다. 그 파일이 저장
    /// 경로에서 빠졌으므로 이제 저장이 성립하고, 손상된 파일은 그대로 남는다. 마커 판정 자체는
    /// `install_managed_jobs`에 그대로 있고 이 경로가 그것을 부르지 않을 뿐이다(SPEC-024 R6).
    #[test]
    fn damaged_markers_in_the_legacy_file_no_longer_stop_the_dream_install() {
        let (project, home) = workspace();
        let original = format!("## my-job\n- slug: -tmp-demo\n\n{MANAGED_START}\n");
        fs::write(legacy_file(&home), &original).expect("seed heartbeat file");

        let installed =
            install_dream(&project, &home, &dream_request(true)).expect("install dream");

        assert!(installed.dream.managed_job.is_some());
        assert!(snapshot(&jobs_file(&project, &home))
            .expect("jobs file")
            .contains("## wf-dream"));
        assert_eq!(snapshot(&legacy_file(&home)), Some(original));
    }

    /// 전환 전에는 종료 마커 뒤에 붙은 `- ` 줄이 마지막 잡의 필드로 흡수되므로 저장을 거부했다.
    /// 잡 파일에는 마커가 없고 파일 전체가 앱 소유라 그 전제가 서지 않는다. 손으로 붙인 줄은
    /// 저장을 막지 않고 통째 쓰기가 그 줄을 걷어 낸다. 사용자의 편집을 지키는 방어는 이 경로에서
    /// baseline 대조 하나이며, 그것은 아래 대조 시험들이 고정한다(SPEC-024 R6).
    #[test]
    fn a_stray_field_line_in_the_jobs_file_does_not_stop_the_dream_install() {
        let (project, home) = workspace();
        install_dream(&project, &home, &dream_request(true)).expect("install dream");
        let installed = snapshot(&jobs_file(&project, &home)).expect("jobs file");
        let damaged = format!("{}\n- tick: 5m\n", installed.trim_end());
        fs::write(jobs_file(&project, &home), &damaged).expect("damage file");

        install_dream(&project, &home, &dream_request(true)).expect("install dream again");

        assert_eq!(snapshot(&jobs_file(&project, &home)), Some(installed));
    }

    /// SPEC-005 완료 조건 1. 관측된 사고 그 자체다. 화면에서 건드리지 않은 실행 한도가 살아남는다.
    #[test]
    fn a_field_the_request_does_not_specify_keeps_the_value_written_in_the_block() {
        let (project, home) = workspace();
        let mut edited = all_enabled();
        edited[2].max_per = limit("8/24h");
        install(&project, &home, &edited).expect("install with an edited quota");

        let mut roles = all_untouched();
        roles[2].interval = Some("45m".to_owned());
        install(&project, &home, &roles).expect("save the interval only");

        let document = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
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
        edited[2].max_per = limit("8/24h");
        install(&project, &home, &edited).expect("install with edited values");
        let before = snapshot(&jobs_file(&project, &home));

        install(&project, &home, &all_untouched()).expect("save without specifying anything");

        assert_eq!(snapshot(&jobs_file(&project, &home)), before);
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
            snapshot(&jobs_file(&project, &untouched_home)),
            snapshot(&jobs_file(&project, &spelled_out))
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
        edited[1].max_per = limit("8/24h");
        edited[2].max_per = limit("16/24h");
        install(&project, &home, &edited).expect("install with edited quotas");

        install(
            &project,
            &home,
            &reset_request("developer", &["architect", "developer"]),
        )
        .expect("reset the developer job");

        let document = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
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

        let document = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
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
        let damaged = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            .replace("- interval: 20m", "- interval: 20분");
        fs::write(jobs_file(&project, &home), &damaged).expect("damage file");

        let error = install(&project, &home, &all_untouched()).expect_err("must fail");

        match &error {
            HeartbeatInstallError::PreservedJob { job, .. } => {
                assert!(job.contains("wf-developer"), "잡 이름: {job}")
            }
            other => panic!("unexpected error: {other}"),
        }
        assert!(error.to_string().contains("손으로 고쳤다면"));
        assert_eq!(snapshot(&jobs_file(&project, &home)), Some(damaged));
    }

    /// SPEC-005 완료 조건 3. dream 잡에도 같은 규칙이 적용된다.
    #[test]
    fn a_dream_field_the_request_does_not_specify_keeps_the_value_written_in_the_block() {
        let (project, home) = workspace();
        let mut edited = dream_request(true);
        edited.max_per = limit("2/24h");
        install_dream(&project, &home, &edited).expect("install with an edited quota");

        let mut dream = untouched_dream_request(true);
        dream.interval = Some("6h".to_owned());
        install_dream(&project, &home, &dream).expect("save the interval only");

        let document = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
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
        edited.max_per = limit("2/24h");
        install_dream(&project, &home, &edited).expect("install with edited values");
        let before = snapshot(&jobs_file(&project, &home));

        install_dream(&project, &home, &untouched_dream_request(true))
            .expect("save without specifying anything");

        assert_eq!(snapshot(&jobs_file(&project, &home)), before);
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

        // 개발자 잡의 condition만 다른 값이다. 역할 인자가 줄에 들어 있어 이 치환은 그 잡에만 걸린다.
        let edited = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            .replace(
                &format!("- condition: {}", condition_command("developer")),
                "- condition: sh scripts/custom-eligible.sh developer",
            );
        fs::write(jobs_file(&project, &home), edited).expect("hand edit the file");

        let snapshot = HeartbeatService.inspect(project.path(), home.path(), home.path());

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
                ("developer", vec!["condition".to_owned()]),
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

        let edited = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            .replace("- notify: all", "- notify: none");
        fs::write(jobs_file(&project, &home), edited).expect("hand edit the file");

        let snapshot = HeartbeatService.inspect(project.path(), home.path(), home.path());

        let job = snapshot.dream.managed_job.expect("dream job");
        assert_eq!(job.app_owned_drift, vec!["notify".to_owned()]);
        // 편집 가능 값은 대조 대상이 아니다.
        assert_eq!(job.interval.as_deref(), Some("2h"));
    }

    /// timeout은 편집 가능 값이다. 파일에서 고친 dream 잡의 timeout이 역할 잡 저장의 보존 경로를
    /// 그대로 지나가고, 드리프트로도 잡히지 않는다. 역할 잡 저장이 다른 연동의 편집값을 초기화하던
    /// 사고의 회귀 테스트다.
    #[test]
    fn a_hand_edited_dream_timeout_survives_a_role_job_save() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install roles");
        install_dream(&project, &home, &dream_request(true)).expect("install dream");

        // dream 잡 절만 고친다. 역할 잡의 timeout 줄은 그대로 둔다.
        let contents = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
        let (head, dream_section) = contents
            .split_once("## wf-dream")
            .expect("dream job section");
        let edited = format!(
            "{head}## wf-dream{}",
            dream_section.replace("- timeout: 30m", "- timeout: 45m")
        );
        fs::write(jobs_file(&project, &home), edited).expect("hand edit the file");

        // 화면이 다시 읽은 기준값으로 역할 잡만 저장한다. dream 잡은 요청에 없다.
        install_with(
            &project,
            &home,
            &all_untouched(),
            &role_baseline(&project, &home),
        )
        .expect("role save");

        let contents = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
        assert!(
            contents.contains("- timeout: 45m"),
            "역할 잡 저장이 dream 잡의 편집된 timeout을 되돌렸다: {contents}"
        );

        let snapshot = HeartbeatService.inspect(project.path(), home.path(), home.path());
        let job = snapshot.dream.managed_job.expect("dream job");
        assert_eq!(job.timeout.as_deref(), Some("45m"));
        assert!(
            job.app_owned_drift.is_empty(),
            "timeout은 드리프트가 아니다"
        );
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

        let document = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
        assert!(document.contains("- interval: 45m"));
    }

    /// R3. 화면이 읽은 뒤 잡이 생겼다. 조건 스크립트도 새로 생기면 안 된다.
    #[test]
    fn a_role_job_added_after_the_screen_read_writes_neither_file() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let document = snapshot(&jobs_file(&project, &home));
        fs::remove_file(script_file(&project)).expect("remove the condition script");

        // 화면은 잡이 하나도 없던 시점을 읽었다.
        let error = install_with(&project, &home, &all_enabled(), &[]).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ManagedBlockChanged));
        assert_eq!(snapshot(&jobs_file(&project, &home)), document);
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
        let document = snapshot(&jobs_file(&project, &home));

        let error = install_with(&project, &home, &all_enabled(), &stale).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ManagedBlockChanged));
        assert_eq!(snapshot(&jobs_file(&project, &home)), document);
    }

    /// R3. 값만 바뀐 경우. 사고의 원형이라 값 수준의 차이도 잡아야 한다.
    #[test]
    fn a_role_job_value_changed_after_the_screen_read_writes_neither_file() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let stale = role_baseline(&project, &home);
        let edited = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            .replace("- max_per: 6/24h", "- max_per: 9/24h");
        fs::write(jobs_file(&project, &home), &edited).expect("hand edit the file");

        let error = install_with(&project, &home, &all_enabled(), &stale).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ManagedBlockChanged));
        assert_eq!(snapshot(&jobs_file(&project, &home)), Some(edited));
    }

    /// R3. 대조 범위는 그 요청이 관장하는 잡뿐이다. 다른 연동의 잡이 바뀐 것은 현행 보존 규칙이
    /// 그대로 집어 올리므로 역할 잡 쓰기를 막을 이유가 없다.
    #[test]
    fn only_the_dream_job_changing_does_not_stop_a_role_job_write() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install role jobs");
        install_dream(&project, &home, &dream_request(true)).expect("install the dream job");
        let stale = role_baseline(&project, &home);
        let edited = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            .replace("- interval: 2h", "- interval: 6h");
        fs::write(jobs_file(&project, &home), edited).expect("hand edit the dream job");

        install_with(&project, &home, &all_enabled(), &stale).expect("role write is not blocked");

        // 손으로 고친 dream 값이 그대로 남는다.
        let job = HeartbeatService
            .inspect(project.path(), home.path(), home.path())
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
        let edited = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            .replace("- interval: 20m", "- interval: 45m");
        fs::write(jobs_file(&project, &home), edited).expect("hand edit a role job");

        install_dream_with(&project, &home, &dream_request(true), stale.as_ref())
            .expect("dream write is not blocked");

        let jobs = HeartbeatService
            .inspect(project.path(), home.path(), home.path())
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
        let edited = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            .replace("- interval: 2h", "- interval: 6h");
        fs::write(jobs_file(&project, &home), &edited).expect("hand edit the file");

        let error = install_dream_with(&project, &home, &dream_request(true), stale.as_ref())
            .expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ManagedBlockChanged));
        assert_eq!(snapshot(&jobs_file(&project, &home)), Some(edited));
    }

    /// R3. dream 잡이 화면이 읽은 뒤 새로 생긴 경우. 없던 것과 생긴 것도 "달라졌다"다.
    #[test]
    fn a_dream_job_added_after_the_screen_read_writes_nothing() {
        let (project, home) = workspace();
        install_dream(&project, &home, &dream_request(true)).expect("install the dream job");
        let document = snapshot(&jobs_file(&project, &home));

        let error =
            install_dream_with(&project, &home, &dream_request(true), None).expect_err("must fail");

        assert!(matches!(error, HeartbeatInstallError::ManagedBlockChanged));
        assert_eq!(snapshot(&jobs_file(&project, &home)), document);
    }

    /// 완료 조건 1·2. 제한 없음으로 저장하면 그 잡에 한도 줄이 없다.
    /// 완료 조건 3. 같은 저장에서 나머지 필드와 앱 소유 필드는 지금과 같이 쓰인다 — 저장 전후를
    /// 대조해 한도 줄 하나 말고는 차이가 없음을 확인한다.
    #[test]
    fn saving_a_role_job_as_unlimited_removes_only_its_quota_line() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install with limits");
        let before = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");

        let mut roles = all_untouched();
        roles[2].max_per = Some(MaxPerRequest::Unlimited);
        install(&project, &home, &roles).expect("save the developer job as unlimited");

        let after = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
        assert_eq!(
            before.replace("- max_per: 6/24h\n", ""),
            after,
            "한도 줄 하나만 사라져야 한다: {after}"
        );
        // 개발자 잡만 무제한이다. 다른 역할 잡의 한도 줄은 그대로다.
        assert_eq!(after.matches("- max_per: 4/24h").count(), 2, "{after}");
    }

    /// 완료 조건 2의 dream 쪽 짝. 잡 종류별로 규칙이 갈리지 않는다.
    #[test]
    fn saving_the_dream_job_as_unlimited_removes_only_its_quota_line() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install roles");
        install_dream(&project, &home, &dream_request(true)).expect("install dream");
        let before = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");

        let mut dream = untouched_dream_request(true);
        dream.max_per = Some(MaxPerRequest::Unlimited);
        install_dream(&project, &home, &dream).expect("save the dream job as unlimited");

        let after = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
        // dream 잡의 한도만 6/24h이 아닌 개발자 잡과 값이 같아 마지막 것 하나만 지운다.
        let (head, tail) = before
            .rsplit_once("- max_per: 6/24h\n")
            .expect("dream quota");
        assert_eq!(format!("{head}{tail}"), after, "{after}");
        let job = HeartbeatService
            .inspect(project.path(), home.path(), home.path())
            .dream
            .managed_job
            .expect("dream job");
        assert_eq!(job.max_per, None);
    }

    /// 완료 조건 4. 한도 줄이 없는 잡을 아무것도 지정하지 않고 저장해도 줄이 되살아나지 않는다.
    /// 지금 사고의 원형이다. 블록에 잡은 있는데 줄만 없는 경우가 "지정 안 함"으로 읽혀 병합에서
    /// 앱 기본값이 채워졌다.
    #[test]
    fn a_job_without_a_quota_line_does_not_get_one_back_from_a_save() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        // 손으로 개발자 잡의 한도 줄을 지운 상태. 다른 두 잡은 4/24h이라 이 치환에 걸리지 않는다.
        let stripped = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            .replace("- max_per: 6/24h\n", "");
        fs::write(jobs_file(&project, &home), &stripped).expect("hand edit the file");

        install(&project, &home, &all_untouched()).expect("save without specifying anything");

        assert_eq!(snapshot(&jobs_file(&project, &home)), Some(stripped));
    }

    /// 완료 조건 5. 다른 필드만 지정해 저장해도 제한 없음이 유지된다. 보존 잡(기획자·아키텍트)의
    /// 한도 줄도 같은 저장에서 되살아나지 않아야 한다.
    #[test]
    fn saving_another_field_keeps_the_quota_line_absent() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let stripped = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            // 세 잡 모두 한도 줄을 지운다. 보존 잡도 같은 규칙을 지키는지 함께 본다.
            .replace("- max_per: 6/24h\n", "")
            .replace("- max_per: 4/24h\n", "");
        fs::write(jobs_file(&project, &home), stripped).expect("hand edit the file");

        let mut roles = all_untouched();
        roles[2].model = Some("sonnet".to_owned());
        install(&project, &home, &roles).expect("save the model only");

        let document = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
        assert!(document.contains("- model: sonnet"), "{document}");
        assert!(
            !document.contains("- max_per:"),
            "한도 줄이 되살아났다: {document}"
        );
    }

    /// 되돌아갈 길이 있어야 한다. 한도 줄이 없는 잡에 값을 지정하면 그 줄이 생긴다.
    #[test]
    fn specifying_a_limit_brings_the_quota_line_back() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let stripped = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            .replace("- max_per: 6/24h\n", "");
        fs::write(jobs_file(&project, &home), stripped).expect("hand edit the file");

        let mut roles = all_untouched();
        roles[2].max_per = limit("9/24h");
        install(&project, &home, &roles).expect("save a limit again");

        let document = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
        assert!(document.contains("- max_per: 9/24h"), "{document}");
    }

    /// 완료 조건 6. 데몬이 한도로 인정하지 않는 값은 백엔드가 거부하고 파일이 바뀌지 않는다.
    /// 그 잡 자신을 지정한 요청이므로 사용자가 방금 넣은 값에 대한 오류다.
    #[test]
    fn a_quota_the_daemon_ignores_is_rejected_without_writing_the_file() {
        for value in ["0/24h", "4/0h"] {
            let (project, home) = workspace();
            install(&project, &home, &all_enabled()).expect("install");
            let before = snapshot(&jobs_file(&project, &home));
            let mut roles = all_untouched();
            roles[2].max_per = limit(value);

            let error = install(&project, &home, &roles).expect_err("must fail");

            assert!(
                matches!(
                    error,
                    HeartbeatInstallError::Jobs(HeartbeatJobsError::InvalidValue {
                        field: "max_per",
                        ..
                    })
                ),
                "max_per `{value}`: {error}"
            );
            assert_eq!(snapshot(&jobs_file(&project, &home)), before);
        }
    }

    /// 완료 조건 8. 파일에 이미 어긋난 값이 있는 잡은 그 잡을 지정하지 않아도 저장이 막힌다.
    /// 앱이 사용자 몰래 제한 없음으로 해석해 넘기지 않는다(기획서 확인 필요 3번).
    #[test]
    fn an_ignored_quota_already_in_the_file_stops_a_save_that_does_not_specify_it() {
        for value in ["0/24h", "4/0h"] {
            let (project, home) = workspace();
            install(&project, &home, &all_enabled()).expect("install");
            let damaged = snapshot(&jobs_file(&project, &home))
                .expect("heartbeat file")
                .replace("- max_per: 6/24h", &format!("- max_per: {value}"));
            fs::write(jobs_file(&project, &home), &damaged).expect("hand edit the file");

            // 개발자 잡은 요청에 없고 기획자 잡만 저장한다. 그래도 보존 잡의 값이 막는다.
            let error = install(&project, &home, &all_untouched()).expect_err("must fail");

            match &error {
                HeartbeatInstallError::PreservedJob { job, .. } => {
                    assert!(job.contains("wf-developer"), "잡 이름: {job}")
                }
                other => panic!("unexpected error for `{value}`: {other}"),
            }
            assert!(
                error.to_string().contains("제한 없이 실행됩니다"),
                "{error}"
            );
            assert_eq!(snapshot(&jobs_file(&project, &home)), Some(damaged));
        }
    }

    /// 완료 조건 9. 재설정은 앱 기본값으로 되돌리는 것이고 기본값은 언제나 한도 값이다.
    /// 제한 없음이던 잡도 재설정하면 한도 줄이 생긴다.
    #[test]
    fn resetting_an_unlimited_job_writes_the_app_default_quota_again() {
        let (project, home) = workspace();
        install(&project, &home, &all_enabled()).expect("install");
        let stripped = snapshot(&jobs_file(&project, &home))
            .expect("heartbeat file")
            .replace("- max_per: 6/24h\n", "");
        fs::write(jobs_file(&project, &home), stripped).expect("hand edit the file");

        install(
            &project,
            &home,
            &reset_request("developer", &["planner", "architect", "developer"]),
        )
        .expect("reset the developer job");

        let document = snapshot(&jobs_file(&project, &home)).expect("heartbeat file");
        assert!(document.contains("- max_per: 6/24h"), "{document}");
    }
}
