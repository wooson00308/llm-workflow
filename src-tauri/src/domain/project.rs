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
    pub excerpt: String,
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

/// 데몬 실행 여부는 pid 파일 존재로만 판정한다. 프로세스 생존은 확인하지 않는다.
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
    /// `None`은 "실행 기록 없음"이다. 상태 파일이 없거나 깨졌거나 잡 기록이 없는 경우를 구분하지 않는다.
    pub last_run: Option<HeartbeatJobRun>,
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

/// 앱 관리 블록 밖에 있는 같은 프로젝트의 역할 잡. 감지만 하고 수정하지 않는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateHeartbeatJob {
    pub name: String,
    /// 조건 인자로 판별한다. 판별할 수 없으면 `None`이다.
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatReadFailure {
    pub path: String,
    pub message: String,
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
