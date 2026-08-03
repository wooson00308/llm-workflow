use serde::{Deserialize, Serialize};

pub const PROJECT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectManifest {
    pub schema_version: u32,
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub workflows: Vec<WorkflowEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowEntry {
    pub id: String,
    pub directory: String,
    pub name: String,
    pub status: WorkflowStatus,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowManifest {
    pub schema_version: u32,
    pub workflow_id: String,
    pub name: String,
    pub status: WorkflowStatus,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentLease {
    pub schema_version: u32,
    pub lease_id: String,
    pub agent: String,
    pub task_id: Option<String>,
    pub heartbeat_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStatus {
    Active,
    Archived,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub root_path: String,
    pub initialized: bool,
    pub project_id: Option<String>,
    pub name: String,
    pub compatibility: SchemaCompatibility,
    pub active_leases: Vec<AgentLeaseSummary>,
    pub workflows: Vec<WorkflowSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub id: String,
    pub directory: String,
    pub name: String,
    pub status: WorkflowStatus,
    pub created_at: String,
    pub counts: WorkflowCounts,
    pub items: WorkflowItems,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCounts {
    pub ideas: usize,
    pub specs: usize,
    pub decisions: usize,
    pub tasks: usize,
    pub reports: usize,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowItems {
    pub ideas: Vec<WorkflowItemSummary>,
    pub specs: Vec<WorkflowItemSummary>,
    pub tasks: Vec<WorkflowItemSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowItemSummary {
    pub file_name: String,
    pub id: String,
    pub title: String,
    pub status: String,
    pub updated_at: Option<String>,
    pub due_at: Option<String>,
    /// 개발 작업의 상태 전이 사실. 시각 오름차순이며 아이디어·기획서에서는 항상 비어 있다.
    pub events: Vec<TaskEvent>,
    pub excerpt: String,
}

/// 개발 작업 프론트매터 `history`의 항목 하나. 전이 하나가 사실 하나다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub kind: String,
    /// 파일에 적힌 RFC3339 원문. 화면이 로컬 날짜로 바꾼다.
    pub at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpecDocument {
    pub summary: WorkflowItemSummary,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDocument {
    pub summary: WorkflowItemSummary,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IdeaDocument {
    pub summary: WorkflowItemSummary,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecDecisionOutcome {
    Approved,
    RevisionRequested,
    Rejected,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskQaOutcome {
    Confirmed,
    RevisionRequested,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentLeaseSummary {
    pub lease_id: String,
    pub agent: String,
    pub task_id: Option<String>,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SchemaCompatibility {
    NotInitialized,
    Current,
    MigrationRequired,
    FutureSchema,
}

/// 연동 공통 설치 상태. 값은 미설치·설치됨 두 개뿐이다.
///
/// 연동별 부가 상태(하트비트의 데몬 실행 여부, dream의 선행 조건)는 이 타입에 넣지 않고
/// 위에 얹는다. 세 번째 연동이 와도 이 타입은 고치지 않는다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationInstallation {
    NotInstalled,
    Installed,
}

/// 하트비트 연동 상태 조회 결과. 전부 읽기 전용 판정이다.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatStatus {
    pub installation: HeartbeatInstallation,
    pub roles: Vec<HeartbeatRoleStatus>,
    pub duplicate_jobs: Vec<DuplicateHeartbeatJob>,
    /// 대상 경로가 있는데 읽지 못한 경우만 담는다. 파일이 없는 것은 실패가 아니다.
    pub read_failures: Vec<HeartbeatReadFailure>,
}

/// 하트비트 연동의 설치 상태. 공통 설치 상태 위에 데몬 실행 여부를 얹은 것이다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatInstallationStatus {
    pub installation: IntegrationInstallation,
    /// 데몬 실행 여부는 pid 파일 존재로만 판정한다. 프로세스 생존은 확인하지 않는다.
    pub daemon_running: bool,
}

impl HeartbeatInstallationStatus {
    /// SPEC-002 화면이 쓰는 세 값으로 접는다. 조합에 없는 상태(미설치인데 데몬 실행 중)는
    /// 판정상 생기지 않으므로 미설치로 본다.
    pub const fn collapse(self) -> HeartbeatInstallation {
        match (self.installation, self.daemon_running) {
            (IntegrationInstallation::NotInstalled, _) => HeartbeatInstallation::NotInstalled,
            (IntegrationInstallation::Installed, false) => {
                HeartbeatInstallation::InstalledDaemonStopped
            }
            (IntegrationInstallation::Installed, true) => {
                HeartbeatInstallation::InstalledDaemonRunning
            }
        }
    }
}

/// 하트비트 카드가 지금 쓰는 세 값. `HeartbeatInstallationStatus`의 조합을 접은 표현이며,
/// 화면이 공통 표현을 직접 쓰게 되면 사라진다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HeartbeatInstallation {
    NotInstalled,
    InstalledDaemonStopped,
    InstalledDaemonRunning,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatRoleStatus {
    pub role: String,
    pub job_name: String,
    /// 이 역할 잡의 앱 기본값(R5). 미설치 잡의 입력 초기값이자 재설정이 되돌릴 값이다.
    pub defaults: JobDefaults,
    /// `None`은 "실행 기록 없음"이다. 상태 파일이 없거나 깨졌거나 잡 기록이 없는 경우를 구분하지 않는다.
    pub last_run: Option<HeartbeatJobRun>,
}

/// 잡 하나의 앱 기본값. 사용자가 편집할 수 있는 세 필드뿐이다.
///
/// 화면이 이 값을 보여주고 파일에도 이 값을 쓴다(R5). 그래서 정의는 앱 안에 하나여야 한다. 화면이
/// 같은 값을 상수로 다시 적으면 두 정의가 갈라지고, "기본값으로 되돌렸는데 미설치 상태에서 시작하는
/// 값과 다르다"가 된다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobDefaults {
    pub interval: String,
    pub max_per: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatJobRun {
    /// 타임존이 없는 로컬 시각 문자열이다. 원문 그대로 전달하고 UTC로 해석하지 않는다.
    pub at: Option<String>,
    /// `success`, `failure`, `skipped`, `quota_skipped`, `timeout` 외의 값도 원문 그대로 전달한다.
    pub result: Option<String>,
    pub duration_seconds: Option<f64>,
}

/// 앱 관리 블록 밖에 있는 같은 프로젝트의 잡. 감지만 하고 수정하지 않는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateHeartbeatJob {
    pub name: String,
    /// 어느 연동의 중복인지. 화면이 해당 연동 카드 안에 경고를 그린다.
    pub integration: String,
    /// 조건 인자로 판별한다. 역할 개념이 없는 연동이거나 판별할 수 없으면 `None`이다.
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatReadFailure {
    pub path: String,
    pub message: String,
}

/// dream 연동 상태. 공통 설치 상태(dream 스킬) 위에 선행 조건과 정제 상태를 얹는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DreamStatus {
    /// dream 스킬 설치 여부.
    pub installation: IntegrationInstallation,
    /// dream은 하트비트 위에서 돈다. 화면의 세 상태는 이 값과 `installation`의 조합이다.
    pub heartbeat: IntegrationInstallation,
    pub refinement: DreamRefinement,
}

/// 정제 상태. 전부 파일에서 직접 센 값이고, 없는 파일은 오류가 아니다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DreamRefinement {
    pub total_transcripts: usize,
    /// 마킹돼 있으면서 실제로 존재하는 트랜스크립트 수.
    pub marked_transcripts: usize,
    /// 전체 − 마킹. 마킹은 존재하는 파일만 세므로 음수가 되지 않는다.
    pub unrefined_transcripts: usize,
    /// `dream_meta.md`의 `last_dream` 원문. `None`은 "정제 기록 없음"이다.
    pub last_dream: Option<String>,
    pub memory_topics: usize,
}

impl WorkflowEntry {
    pub fn to_summary(&self, counts: WorkflowCounts, items: WorkflowItems) -> WorkflowSummary {
        WorkflowSummary {
            id: self.id.clone(),
            directory: self.directory.clone(),
            name: self.name.clone(),
            status: self.status.clone(),
            created_at: self.created_at.clone(),
            counts,
            items,
        }
    }
}
