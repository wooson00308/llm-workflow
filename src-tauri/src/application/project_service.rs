use std::path::Path;

use crate::domain::project::ProjectSummary;
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

    pub fn migrate(&self, root: &Path) -> Result<ProjectSummary, ProjectError> {
        self.repository.migrate(root)
    }
}
