use std::path::Path;

use crate::domain::project::{
    ProjectSummary, SpecDecisionOutcome, SpecDocument, TaskDocument, TaskQaOutcome,
};
use crate::infrastructure::fs_project_repository::{FileSystemProjectRepository, ProjectError};

#[derive(Debug, Default)]
pub struct ProjectService {
    repository: FileSystemProjectRepository,
}

impl ProjectService {
    pub fn inspect(&self, root: &Path) -> Result<ProjectSummary, ProjectError> {
        self.repository.inspect(root)
    }

    pub fn create_workflow(
        &self,
        root: &Path,
        workflow_name: &str,
    ) -> Result<ProjectSummary, ProjectError> {
        self.repository.create_workflow(root, workflow_name)
    }

    pub fn create_idea(
        &self,
        root: &Path,
        workflow_directory: &str,
        content: &str,
    ) -> Result<ProjectSummary, ProjectError> {
        self.repository
            .create_idea(root, workflow_directory, content)
    }

    pub fn read_spec(
        &self,
        root: &Path,
        workflow_directory: &str,
        file_name: &str,
    ) -> Result<SpecDocument, ProjectError> {
        self.repository
            .read_spec(root, workflow_directory, file_name)
    }

    pub fn read_task(
        &self,
        root: &Path,
        workflow_directory: &str,
        file_name: &str,
    ) -> Result<TaskDocument, ProjectError> {
        self.repository
            .read_task(root, workflow_directory, file_name)
    }

    pub fn record_spec_decision(
        &self,
        root: &Path,
        workflow_directory: &str,
        file_name: &str,
        outcome: SpecDecisionOutcome,
        comment: &str,
    ) -> Result<ProjectSummary, ProjectError> {
        self.repository
            .record_spec_decision(root, workflow_directory, file_name, outcome, comment)
    }

    pub fn record_task_qa(
        &self,
        root: &Path,
        workflow_directory: &str,
        file_name: &str,
        outcome: TaskQaOutcome,
        comment: &str,
    ) -> Result<ProjectSummary, ProjectError> {
        self.repository
            .record_task_qa(root, workflow_directory, file_name, outcome, comment)
    }

    pub fn migrate(&self, root: &Path) -> Result<ProjectSummary, ProjectError> {
        self.repository.migrate(root)
    }
}
