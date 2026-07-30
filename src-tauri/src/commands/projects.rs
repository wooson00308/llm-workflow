use std::path::Path;

use crate::application::project_service::ProjectService;
use crate::domain::project::ProjectSummary;

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
pub fn migrate_project(path: String) -> Result<ProjectSummary, String> {
    ProjectService::default()
        .migrate(Path::new(&path))
        .map_err(|error| error.to_string())
}
