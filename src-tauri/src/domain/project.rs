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

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecDecisionOutcome {
    Approved,
    Rejected,
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
