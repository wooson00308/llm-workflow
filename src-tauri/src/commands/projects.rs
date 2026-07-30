use std::path::Path;

use crate::application::project_service::ProjectService;
use crate::domain::project::{ProjectSummary, SpecDecisionOutcome, SpecDocument};

#[tauri::command]
pub fn inspect_project(path: String) -> Result<ProjectSummary, String> {
    ProjectService::default()
        .inspect(Path::new(&path))
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
pub fn migrate_project(path: String) -> Result<ProjectSummary, String> {
    ProjectService::default()
        .migrate(Path::new(&path))
        .map_err(|error| error.to_string())
}
