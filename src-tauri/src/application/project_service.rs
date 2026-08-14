use std::path::Path;

use crate::domain::project::{
    CustomRulesDocument, CustomRulesDraft, CustomRulesPreview, IdeaDocument,
    ManagedAssetSyncResult, ProjectSummary, SaveCustomRulesRequest, SaveCustomRulesResult,
    SpecDecisionOutcome, SpecDocument, TaskDocument, TaskResumeRequest, TaskResumeResult,
    TaskRevisionRequestInput, TaskRevisionRequestResult, WorkGroupQaSubmission,
    WorkGroupQaSubmissionResult,
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

    pub fn synchronize_managed_assets(
        &self,
        root: &Path,
    ) -> Result<ManagedAssetSyncResult, ProjectError> {
        self.repository.synchronize_managed_assets(root)
    }

    pub fn read_custom_rules(&self, root: &Path) -> Result<CustomRulesDocument, ProjectError> {
        self.repository.read_custom_rules(root)
    }

    pub fn prepare_custom_rules_preview(
        &self,
        root: &Path,
        draft: CustomRulesDraft,
    ) -> Result<CustomRulesPreview, ProjectError> {
        self.repository.prepare_custom_rules_preview(root, draft)
    }

    pub fn save_custom_rules(
        &self,
        root: &Path,
        request: SaveCustomRulesRequest,
    ) -> Result<SaveCustomRulesResult, ProjectError> {
        self.repository.save_custom_rules(root, request)
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

    pub fn read_idea(
        &self,
        root: &Path,
        workflow_directory: &str,
        file_name: &str,
    ) -> Result<IdeaDocument, ProjectError> {
        self.repository
            .read_idea(root, workflow_directory, file_name)
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

    pub fn submit_work_group_qa(
        &self,
        root: &Path,
        submission: &WorkGroupQaSubmission,
    ) -> Result<WorkGroupQaSubmissionResult, ProjectError> {
        self.repository.submit_work_group_qa(root, submission)
    }

    pub fn resume_task(
        &self,
        root: &Path,
        request: &TaskResumeRequest,
    ) -> Result<TaskResumeResult, ProjectError> {
        self.repository.resume_task(root, request)
    }

    pub fn record_task_revision_request(
        &self,
        root: &Path,
        request: &TaskRevisionRequestInput,
    ) -> Result<TaskRevisionRequestResult, ProjectError> {
        self.repository.record_task_revision_request(root, request)
    }

    pub fn migrate(&self, root: &Path) -> Result<ProjectSummary, ProjectError> {
        self.repository.migrate(root)
    }
}
