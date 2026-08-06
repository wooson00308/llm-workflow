use std::path::Path;

use crate::application::project_service::ProjectService;
use crate::domain::project::{
    CustomRulesDocument, CustomRulesDraft, CustomRulesPreview, IdeaDocument,
    ManagedAssetSyncResult, ProjectSummary, SaveCustomRulesRequest, SaveCustomRulesResult,
    SpecDecisionOutcome, SpecDocument, TaskDocument, TaskQaBatchResult, TaskQaOutcome,
};

#[tauri::command]
pub fn inspect_project(path: String) -> Result<ProjectSummary, String> {
    ProjectService::default()
        .inspect(Path::new(&path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn synchronize_managed_project_assets(path: String) -> Result<ManagedAssetSyncResult, String> {
    ProjectService::default()
        .synchronize_managed_assets(Path::new(&path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_custom_rules(path: String) -> Result<CustomRulesDocument, String> {
    ProjectService::default()
        .read_custom_rules(Path::new(&path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn prepare_custom_rules_preview(
    path: String,
    draft: CustomRulesDraft,
) -> Result<CustomRulesPreview, String> {
    ProjectService::default()
        .prepare_custom_rules_preview(Path::new(&path), draft)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_custom_rules(
    path: String,
    request: SaveCustomRulesRequest,
) -> Result<SaveCustomRulesResult, String> {
    ProjectService::default()
        .save_custom_rules(Path::new(&path), request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_workflow(path: String, name: String) -> Result<ProjectSummary, String> {
    ProjectService::default()
        .create_workflow(Path::new(&path), &name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_idea(
    path: String,
    workflow_directory: String,
    content: String,
) -> Result<ProjectSummary, String> {
    ProjectService::default()
        .create_idea(Path::new(&path), &workflow_directory, &content)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_spec(
    path: String,
    workflow_directory: String,
    file_name: String,
) -> Result<SpecDocument, String> {
    ProjectService::default()
        .read_spec(Path::new(&path), &workflow_directory, &file_name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_task(
    path: String,
    workflow_directory: String,
    file_name: String,
) -> Result<TaskDocument, String> {
    ProjectService::default()
        .read_task(Path::new(&path), &workflow_directory, &file_name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_idea(
    path: String,
    workflow_directory: String,
    file_name: String,
) -> Result<IdeaDocument, String> {
    ProjectService::default()
        .read_idea(Path::new(&path), &workflow_directory, &file_name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn record_spec_decision(
    path: String,
    workflow_directory: String,
    file_name: String,
    outcome: SpecDecisionOutcome,
    comment: String,
) -> Result<ProjectSummary, String> {
    ProjectService::default()
        .record_spec_decision(
            Path::new(&path),
            &workflow_directory,
            &file_name,
            outcome,
            &comment,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn record_task_qa(
    path: String,
    workflow_directory: String,
    file_name: String,
    outcome: TaskQaOutcome,
    comment: String,
) -> Result<ProjectSummary, String> {
    ProjectService::default()
        .record_task_qa(
            Path::new(&path),
            &workflow_directory,
            &file_name,
            outcome,
            &comment,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn confirm_task_qa_batch(
    path: String,
    workflow_directory: String,
    file_names: Vec<String>,
    comment: String,
) -> Result<TaskQaBatchResult, String> {
    ProjectService::default()
        .confirm_task_qa_batch(Path::new(&path), &workflow_directory, &file_names, &comment)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn migrate_project(path: String) -> Result<ProjectSummary, String> {
    ProjectService::default()
        .migrate(Path::new(&path))
        .map_err(|error| error.to_string())
}
