use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use chrono::{DateTime, Utc};
use tempfile::NamedTempFile;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::project::{
    AgentLease, AgentLeaseSummary, CustomRulesDocument, CustomRulesDraft, CustomRulesPreview,
    IdeaDocument, ManagedAssetState, ManagedAssetStatus, ManagedAssetSyncResult,
    ManagedAssetSyncStatus, PendingRoleWork, PendingRoleWorkDetail, ProjectManifest,
    ProjectSummary, SaveCustomRulesRequest, SaveCustomRulesResult, SchemaCompatibility,
    SpecDecisionOutcome, SpecDocument, TaskDependency, TaskDependencyState, TaskDocument,
    TaskEvent, TaskOverlapBlock, TaskQaBatchEntry, TaskQaBatchResult, TaskQaOutcome,
    TaskResumeRecovery, TaskResumeRequest, TaskResumeResult, TaskResumeStatus, TaskRevisionRequest,
    TaskRevisionRequestInput, TaskRevisionRequestResult, TaskRevisionRequestStatus, WorkflowCounts,
    WorkflowEntry, WorkflowItemSummary, WorkflowItems, WorkflowManifest, WorkflowStatus,
    PROJECT_SCHEMA_VERSION,
};
use crate::infrastructure::custom_rules::{
    prepare_custom_rules_preview, read_custom_rules, save_custom_rules, CustomRulesError,
};
use crate::infrastructure::managed_project_assets::{
    install_managed_project_assets, synchronize_managed_project_assets,
    validate_managed_project_assets, ManagedProjectAssetsError,
};
use crate::infrastructure::project_write_lock::{ProjectWriteLock, ProjectWriteLockError};
use crate::infrastructure::reservation_helper::{
    install_reservation_helper, plan_reservation_helper, validate_reservation_helper,
    RESERVATION_HELPER_VERSION,
};
use crate::infrastructure::role_eligibility::{pending_role_work, WorkflowInput};

const CONTROL_DIRECTORY: &str = ".workflow";
const PROJECT_MANIFEST: &str = "project.yml";
const WORKFLOW_MANIFEST: &str = "workflow.yml";
const RUNTIME_DIRECTORY: &str = ".runtime";
const MIGRATION_LOCK_FILE: &str = "migration.lock";
const WORKFLOW_DIRECTORIES: [&str; 6] =
    ["ideas", "specs", "decisions", "tasks", "reports", "state"];
/// 개발 작업 `history` 항목의 `kind`로 인정하는 값. 이 밖의 값은 항목째 버린다.
const TASK_EVENT_KINDS: [&str; 7] = [
    "created",
    "in_progress",
    "blocked",
    "qa_waiting",
    "completed",
    "revision_requested",
    "resumed",
];
/// 사용자가 막힌 작업을 다시 연 사실을 남기는 앱 소유 감사 기록의 스키마(SPEC-054 R9).
/// 기획서 결정·QA 결정과 다른 식별자이므로 두 판정 어디에도 섞이지 않는다.
const TASK_RESUME_SCHEMA: &str = "workflow-labs/task-resume@1";
/// 사용자가 잘못 분해된 작업을 고쳐 달라고 남긴 요청 기록의 스키마(SPEC-055 R2). 기획서 결정·QA 결정·
/// 재개 기록과 다른 식별자이므로 네 기록이 서로의 판정에 섞이지 않는다.
const TASK_REVISION_REQUEST_SCHEMA: &str = "workflow-labs/task-revision-request@1";
/// 확인 동선 절의 제목. 앱이 설치하는 개발자 계약이 고정한 문자열과 문자 단위로 같다. 이 파일은 그
/// 문자열을 읽기만 하고 규칙 문언을 정하지 않는다(SPEC-056 R4).
const TASK_WALKTHROUGH_HEADING: &str = "## 확인 동선";
/// 카드 미리보기에 담기는 글자 수. 발췌와 확인 동선 미리보기가 같은 한도를 쓴다(SPEC-056 R7).
const EXCERPT_LIMIT: usize = 160;

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("선택한 프로젝트 디렉터리를 찾을 수 없습니다: {0}")]
    RootNotFound(String),
    #[error("워크플로우 이름을 입력해 주세요.")]
    EmptyWorkflowName,
    #[error("워크플로우 이름은 80자 이하여야 합니다.")]
    WorkflowNameTooLong,
    #[error("워크플로우 이름에는 제어 문자를 사용할 수 없습니다.")]
    InvalidWorkflowName,
    #[error("아이디어 내용을 입력해 주세요.")]
    EmptyIdea,
    #[error("아이디어는 10,000자 이하여야 합니다.")]
    IdeaTooLong,
    #[error("기획서 파일 이름이 안전하지 않습니다: {0}")]
    UnsafeDocumentFile(String),
    #[error("기획서 파일을 찾을 수 없습니다: {0}")]
    DocumentNotFound(String),
    #[error("사용자 선택 대기 상태인 기획서에는 승인·수정 요청·폐기를, 승인된 기획서에는 수정 요청만 보낼 수 있습니다. 그 밖의 조합은 기록하지 않습니다.")]
    SpecNotAwaitingDecision,
    #[error("수정 요청이나 폐기에는 코멘트를 입력해 주세요.")]
    DecisionCommentRequired,
    #[error("결정 코멘트는 2,000자 이하여야 합니다.")]
    DecisionCommentTooLong,
    #[error("QA 대기 상태인 개발 작업만 확인할 수 있습니다.")]
    TaskNotAwaitingQa,
    #[error("개발 수정 요청에는 코멘트를 입력해 주세요.")]
    QaCommentRequired,
    #[error("막힌 상태인 개발 작업만 재개할 수 있습니다.")]
    TaskNotBlocked,
    #[error("작업 문서가 그사이 변경되었습니다. 문서를 다시 열어 확인한 뒤 재개해 주세요.")]
    TaskResumeStale,
    #[error("외부 LLM이 이 작업을 선점하고 있습니다. 선점이 끝난 뒤 다시 시도해 주세요.")]
    TaskResumeLeased,
    #[error("이전 재개 기록과 작업 상태가 어긋납니다. 작업 문서를 확인해 주세요.")]
    TaskResumeInconsistent,
    #[error("작업 문서의 프론트매터를 읽지 못해 재개를 기록하지 않았습니다.")]
    TaskResumeUnreadable,
    #[error("재개 근거를 입력해 주세요.")]
    ResumeResolutionRequired,
    #[error("재개 근거는 2,000자 이하여야 합니다.")]
    ResumeResolutionTooLong,
    #[error("재개 요청 식별자를 입력해 주세요.")]
    ResumeRequestIdRequired,
    #[error("막힌 작업과 아직 선점되지 않은 개발 준비 작업에만 수정을 요청할 수 있습니다.")]
    TaskNotRevisable,
    #[error("외부 LLM이 이 작업을 선점하고 있습니다. 선점이 끝난 뒤 다시 시도해 주세요.")]
    TaskRevisionLeased,
    #[error("작업 문서가 그사이 변경되었습니다. 문서를 다시 열어 확인한 뒤 요청해 주세요.")]
    TaskRevisionStale,
    #[error("수정 요청 이유를 입력해 주세요.")]
    RevisionReasonRequired,
    #[error("수정 요청 이유는 2,000자 이하여야 합니다.")]
    RevisionReasonTooLong,
    #[error("수정 요청 식별자를 입력해 주세요.")]
    RevisionRequestIdRequired,
    #[error("프로젝트에 등록되지 않은 워크플로우입니다.")]
    UnknownWorkflow,
    #[error("워크플로우 디렉터리 경로가 안전하지 않습니다: {0}")]
    UnsafeWorkflowDirectory(String),
    #[error("기존 .workflow 디렉터리에 앱이 생성하지 않은 파일이 있습니다. 내용을 확인해 주세요.")]
    UnmanagedControlDirectory,
    #[error("프로젝트 문서 규격을 먼저 마이그레이션해야 합니다.")]
    MigrationRequired,
    #[error("현재 앱보다 새로운 문서 규격입니다. 프로젝트를 읽기 전용으로 열어야 합니다.")]
    FutureSchema,
    #[error("아직 LLM Workflow 프로젝트로 초기화되지 않았습니다.")]
    NotInitialized,
    #[error("외부 LLM이 문서를 작업 중입니다. 작업이 끝난 뒤 다시 시도해 주세요.")]
    ActiveLeases,
    #[error("지원하는 마이그레이션 경로가 없습니다: {0} → {1}")]
    MissingMigration(u32, u32),
    #[error("프로젝트 파일을 처리하지 못했습니다: {0}")]
    Io(#[from] std::io::Error),
    #[error("프로젝트 메타데이터 형식이 올바르지 않습니다: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("프로젝트 메타데이터를 안전하게 저장하지 못했습니다: {0}")]
    Persist(String),
    #[error(transparent)]
    ManagedProjectAssets(#[from] ManagedProjectAssetsError),
    #[error(transparent)]
    CustomRules(#[from] CustomRulesError),
    #[error(transparent)]
    ProjectWriteLock(#[from] ProjectWriteLockError),
}

#[derive(Debug, Default)]
pub struct FileSystemProjectRepository;

impl FileSystemProjectRepository {
    pub fn inspect(&self, root: &Path) -> Result<ProjectSummary, ProjectError> {
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let manifest_path = control_root.join(PROJECT_MANIFEST);

        if !manifest_path.exists() {
            return Ok(uninitialized_summary(&root));
        }

        let manifest = read_manifest(&manifest_path)?;
        validate_workflow_directories(&control_root, &manifest)?;
        let compatibility = compatibility_for(manifest.schema_version);
        let active_leases = read_active_leases(&control_root)?;

        Ok(summary_from_manifest(
            &root,
            manifest,
            compatibility,
            active_leases,
        ))
    }

    pub fn create_workflow(
        &self,
        root: &Path,
        workflow_name: &str,
    ) -> Result<ProjectSummary, ProjectError> {
        validate_workflow_name(workflow_name)?;
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        validate_all_managed_project_assets(&root, &control_root)?;
        ensure_managed_control_root(&control_root)?;

        let project_manifest_path = control_root.join(PROJECT_MANIFEST);
        let mut project = if project_manifest_path.exists() {
            let manifest = read_manifest(&project_manifest_path)?;
            validate_workflow_directories(&control_root, &manifest)?;
            match compatibility_for(manifest.schema_version) {
                SchemaCompatibility::Current => manifest,
                SchemaCompatibility::MigrationRequired => {
                    return Err(ProjectError::MigrationRequired)
                }
                SchemaCompatibility::FutureSchema => return Err(ProjectError::FutureSchema),
                SchemaCompatibility::NotInitialized => unreachable!("manifest exists"),
            }
        } else {
            initialize_control_root(&control_root)?;
            ProjectManifest {
                schema_version: PROJECT_SCHEMA_VERSION,
                project_id: format!("prj_{}", compact_uuid()),
                name: project_directory_name(&root),
                workflows: Vec::new(),
            }
        };

        install_all_managed_project_assets(&root, &control_root)?;

        let id = format!("wf_{}", &compact_uuid()[..8]);
        let directory = format!("{}--{}", slugify(workflow_name), id);
        let workflow_root = control_root.join(&directory);
        fs::create_dir(&workflow_root)?;
        for child in WORKFLOW_DIRECTORIES {
            fs::create_dir(workflow_root.join(child))?;
        }

        let created_at = Utc::now().to_rfc3339();
        let status = WorkflowStatus::Active;
        let workflow_manifest = WorkflowManifest {
            schema_version: PROJECT_SCHEMA_VERSION,
            workflow_id: id.clone(),
            name: workflow_name.trim().to_owned(),
            status: status.clone(),
            created_at: created_at.clone(),
        };
        write_yaml_atomically(&workflow_root.join(WORKFLOW_MANIFEST), &workflow_manifest)?;
        write_text_atomically(
            &workflow_root.join("README.md"),
            &workflow_readme(workflow_name.trim(), &id),
        )?;

        project.workflows.push(WorkflowEntry {
            id,
            directory,
            name: workflow_name.trim().to_owned(),
            status,
            created_at,
        });
        write_yaml_atomically(&project_manifest_path, &project)?;

        // 이 호출은 방금 만든 워크플로우뿐 아니라 기존 워크플로우의 아이디어까지 다시 실어 보낸다.
        // 빈 목록을 넘기면 살아 있는 lease가 무시되어 정상 반영중인 아이디어가 한 조회 동안
        // 중단 의심으로 보인다. 경고를 거짓으로 띄우는 것은 그 경고를 못 믿게 만든다.
        let active_leases = read_active_leases(&control_root)?;

        Ok(summary_from_manifest(
            &root,
            project,
            SchemaCompatibility::Current,
            active_leases,
        ))
    }

    pub fn create_idea(
        &self,
        root: &Path,
        workflow_directory: &str,
        content: &str,
    ) -> Result<ProjectSummary, ProjectError> {
        validate_idea(content)?;
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let project_manifest_path = control_root.join(PROJECT_MANIFEST);
        let project = read_manifest(&project_manifest_path)?;
        validate_workflow_directories(&control_root, &project)?;

        match compatibility_for(project.schema_version) {
            SchemaCompatibility::Current => {}
            SchemaCompatibility::MigrationRequired => return Err(ProjectError::MigrationRequired),
            SchemaCompatibility::FutureSchema => return Err(ProjectError::FutureSchema),
            SchemaCompatibility::NotInitialized => unreachable!("manifest exists"),
        }

        if !project
            .workflows
            .iter()
            .any(|workflow| workflow.directory == workflow_directory)
        {
            return Err(ProjectError::UnknownWorkflow);
        }

        let idea_id = format!("IDEA-{}", compact_uuid()[..8].to_uppercase());
        let created_at = Utc::now().to_rfc3339();
        let idea = format!(
            "---\nschema: workflow-labs/idea@1\nid: {idea_id}\nstatus: inbox\ncreated_at: {created_at}\n---\n\n{}\n",
            content.trim()
        );
        let idea_path = control_root
            .join(workflow_directory)
            .join("ideas")
            .join(format!("{idea_id}.md"));
        write_text_atomically(&idea_path, &idea)?;

        let active_leases = read_active_leases(&control_root)?;
        Ok(summary_from_manifest(
            &root,
            project,
            SchemaCompatibility::Current,
            active_leases,
        ))
    }

    pub fn synchronize_managed_assets(
        &self,
        root: &Path,
    ) -> Result<ManagedAssetSyncResult, ProjectError> {
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let manifest_path = control_root.join(PROJECT_MANIFEST);
        if !manifest_path.exists() {
            return Err(ProjectError::NotInitialized);
        }
        let project = read_manifest(&manifest_path)?;
        validate_workflow_directories(&control_root, &project)?;
        require_current_schema(project.schema_version)?;
        synchronize_all_managed_project_assets(&root, &control_root)
    }

    pub fn read_custom_rules(&self, root: &Path) -> Result<CustomRulesDocument, ProjectError> {
        let control_root = current_project_control_root(root)?;
        Ok(read_custom_rules(&control_root)?)
    }

    pub fn prepare_custom_rules_preview(
        &self,
        root: &Path,
        draft: CustomRulesDraft,
    ) -> Result<CustomRulesPreview, ProjectError> {
        let control_root = current_project_control_root(root)?;
        Ok(prepare_custom_rules_preview(&control_root, draft)?)
    }

    pub fn save_custom_rules(
        &self,
        root: &Path,
        request: SaveCustomRulesRequest,
    ) -> Result<SaveCustomRulesResult, ProjectError> {
        let control_root = current_project_control_root(root)?;
        Ok(save_custom_rules(&control_root, request)?)
    }

    pub fn read_spec(
        &self,
        root: &Path,
        workflow_directory: &str,
        file_name: &str,
    ) -> Result<SpecDocument, ProjectError> {
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let project = read_manifest(&control_root.join(PROJECT_MANIFEST))?;
        validate_workflow_directories(&control_root, &project)?;
        let workflow_root = registered_workflow_root(&control_root, &project, workflow_directory)?;
        let spec_path = safe_markdown_file(&workflow_root.join("specs"), file_name)?;
        let (mut summary, body) = read_markdown_document(&spec_path, "draft")?;
        normalize_spec_status(&mut summary);
        apply_latest_decision(&workflow_root, &mut summary);
        Ok(SpecDocument { summary, body })
    }

    pub fn read_task(
        &self,
        root: &Path,
        workflow_directory: &str,
        file_name: &str,
    ) -> Result<TaskDocument, ProjectError> {
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let project = read_manifest(&control_root.join(PROJECT_MANIFEST))?;
        validate_workflow_directories(&control_root, &project)?;
        let workflow_root = registered_workflow_root(&control_root, &project, workflow_directory)?;
        let tasks_root = workflow_root.join("tasks");
        let task_path = safe_markdown_file(&tasks_root, file_name)?;
        let (summary, body) = read_markdown_document(&task_path, "todo")?;
        // 선행 판정에는 워크플로우의 모든 작업 문서가 필요하다. 카드를 눌렀을 때만 도는 경로라
        // `inspect`의 2.5초 주기와 다르고, 목록 payload는 이 값을 싣지 않는다(SPEC-013 R5).
        let graph = task_dependency_graph(&tasks_root);
        let (dependencies, dependency_format_error) = task_dependencies(&summary.id, &graph);
        // 겹침 근거는 미만료 lease를 읽어야 나온다. 자격 판정이 쓰는 읽기 그대로다.
        let overlap_blocks = task_overlap_blocks(&summary.id, &graph, &lease_ids(&control_root));
        // 처리 여부는 작업이 연결한 요청 id 하나로만 갈린다(SPEC-055 R10). 다른 근거로 추측하지 않는다.
        let revision_requests = read_task_revision_requests(
            &workflow_root,
            &summary.id,
            handled_revision_request_id(&task_path).as_deref(),
        );
        Ok(TaskDocument {
            summary,
            body,
            dependencies,
            dependency_format_error,
            overlap_blocks,
            revision_requests,
        })
    }

    pub fn read_idea(
        &self,
        root: &Path,
        workflow_directory: &str,
        file_name: &str,
    ) -> Result<IdeaDocument, ProjectError> {
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let project = read_manifest(&control_root.join(PROJECT_MANIFEST))?;
        validate_workflow_directories(&control_root, &project)?;
        let workflow_root = registered_workflow_root(&control_root, &project, workflow_directory)?;
        let idea_path = safe_markdown_file(&workflow_root.join("ideas"), file_name)?;
        let (mut summary, body) = read_markdown_document(&idea_path, "inbox")?;
        // 목록(`workflow_items`)이 하는 판정과 같아야 화면의 상태 표시가 갈리지 않는다.
        // 여기서만 `unwrap_or_default()`를 쓴다. 이 경로에는 마이그레이션 차단 같은 안전 판정이
        // 걸려 있지 않고, lease를 못 읽었다고 아이디어 전문이 통째로 안 열리는 편이 더 나쁘다.
        let leases = read_active_leases(&control_root).unwrap_or_default();
        derive_idea_states(
            std::slice::from_mut(&mut summary),
            &spec_references(&workflow_root, &read_spec_decisions(&workflow_root)),
            &leases,
        );
        Ok(IdeaDocument { summary, body })
    }

    pub fn record_spec_decision(
        &self,
        root: &Path,
        workflow_directory: &str,
        file_name: &str,
        outcome: SpecDecisionOutcome,
        comment: &str,
    ) -> Result<ProjectSummary, ProjectError> {
        validate_decision(&outcome, comment)?;
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let project = read_manifest(&control_root.join(PROJECT_MANIFEST))?;
        validate_workflow_directories(&control_root, &project)?;
        require_current_schema(project.schema_version)?;
        install_all_managed_project_assets(&root, &control_root)?;
        let workflow_root = registered_workflow_root(&control_root, &project, workflow_directory)?;
        let spec_path = safe_markdown_file(&workflow_root.join("specs"), file_name)?;
        let (mut spec, _) = read_markdown_document(&spec_path, "draft")?;
        normalize_spec_status(&mut spec);
        apply_latest_decision(&workflow_root, &mut spec);
        if !spec_decision_is_allowed(&spec.status, &outcome) {
            return Err(ProjectError::SpecNotAwaitingDecision);
        }

        let decision_id = format!("DECISION-{}", compact_uuid()[..8].to_uppercase());
        let created_at = Utc::now().to_rfc3339();
        let outcome_value = match outcome {
            SpecDecisionOutcome::Approved => "approved",
            SpecDecisionOutcome::RevisionRequested => "revision_requested",
            SpecDecisionOutcome::Rejected => "rejected",
        };
        let decision = format!(
            "---\nschema: workflow-labs/decision@1\nid: {decision_id}\nspec_id: {}\noutcome: {outcome_value}\ncreated_by: user\ncreated_at: {created_at}\n---\n\n{}\n",
            yaml_scalar(&spec.id),
            comment.trim()
        );
        write_text_atomically(
            &workflow_root
                .join("decisions")
                .join(format!("{decision_id}.md")),
            &decision,
        )?;

        Ok(summary_from_manifest(
            &root,
            project,
            SchemaCompatibility::Current,
            read_active_leases(&control_root)?,
        ))
    }

    pub fn record_task_qa(
        &self,
        root: &Path,
        workflow_directory: &str,
        file_name: &str,
        outcome: TaskQaOutcome,
        comment: &str,
    ) -> Result<ProjectSummary, ProjectError> {
        validate_task_qa(&outcome, comment)?;
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let project = read_manifest(&control_root.join(PROJECT_MANIFEST))?;
        validate_workflow_directories(&control_root, &project)?;
        require_current_schema(project.schema_version)?;
        install_all_managed_project_assets(&root, &control_root)?;
        let workflow_root = registered_workflow_root(&control_root, &project, workflow_directory)?;
        record_one_task_qa(&workflow_root, file_name, &outcome, comment)?;

        Ok(summary_from_manifest(
            &root,
            project,
            SchemaCompatibility::Current,
            read_active_leases(&control_root)?,
        ))
    }

    /// 목록을 통째로 받아 건별로 QA 확인을 기록한다. 확인 전용이라 `outcome` 자리가 없다.
    /// 한 건이 실패해도 멈추지 않고, `Err`로 끝나는 것은 프로젝트 전체를 읽지 못하는 경우뿐이다.
    /// 리스는 보지 않는다 — 일괄이 단건보다 엄격해지면 같은 작업이 자리에 따라 다르게 찍힌다.
    pub fn confirm_task_qa_batch(
        &self,
        root: &Path,
        workflow_directory: &str,
        file_names: &[String],
        comment: &str,
    ) -> Result<TaskQaBatchResult, ProjectError> {
        validate_task_qa(&TaskQaOutcome::Confirmed, comment)?;
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let project = read_manifest(&control_root.join(PROJECT_MANIFEST))?;
        validate_workflow_directories(&control_root, &project)?;
        require_current_schema(project.schema_version)?;
        install_all_managed_project_assets(&root, &control_root)?;
        let workflow_root = registered_workflow_root(&control_root, &project, workflow_directory)?;

        let results = file_names
            .iter()
            .map(|file_name| {
                match record_one_task_qa(
                    &workflow_root,
                    file_name,
                    &TaskQaOutcome::Confirmed,
                    comment,
                ) {
                    Ok(task_id) => TaskQaBatchEntry {
                        file_name: file_name.clone(),
                        task_id: Some(task_id),
                        recorded: true,
                        message: None,
                    },
                    Err(error) => TaskQaBatchEntry {
                        file_name: file_name.clone(),
                        task_id: task_id_of(&workflow_root, file_name),
                        recorded: false,
                        message: Some(error.to_string()),
                    },
                }
            })
            .collect();

        Ok(TaskQaBatchResult {
            summary: summary_from_manifest(
                &root,
                project,
                SchemaCompatibility::Current,
                read_active_leases(&control_root)?,
            ),
            results,
        })
    }

    /// 막힌 작업을 사용자 판단으로 `todo`로 되돌리고 그 사실을 감사 기록으로 남긴다(SPEC-054 R8).
    /// 상태 전이와 감사 기록은 한 요청에서 함께 남으며, 하나만 남은 결과를 성공으로 돌려주지 않는다.
    pub fn resume_task(
        &self,
        root: &Path,
        request: &TaskResumeRequest,
    ) -> Result<TaskResumeResult, ProjectError> {
        self.resume_task_with(root, request, |path| fs::remove_file(path))
    }

    /// 되돌리기를 인자로 받는 본체. 되돌리기 실패는 파일 권한만으로 재현되지 않기 때문이다 —
    /// 감사 기록을 쓸 수 있는 디렉터리는 그 파일을 지울 수도 있어서, 복구 분기는 이 인자로만
    /// 검사할 수 있다. 명령 경로는 언제나 `fs::remove_file`을 넘긴다.
    fn resume_task_with(
        &self,
        root: &Path,
        request: &TaskResumeRequest,
        remove: impl Fn(&Path) -> std::io::Result<()>,
    ) -> Result<TaskResumeResult, ProjectError> {
        validate_task_resume(request)?;
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let project = read_manifest(&control_root.join(PROJECT_MANIFEST))?;
        validate_workflow_directories(&control_root, &project)?;
        require_current_schema(project.schema_version)?;
        // 관리 자산 설치가 스스로 쓰기 잠금을 잡으므로 이 명령의 잠금보다 앞에 둔다. 기존
        // migration lock이 있으면 여기서 이미 실패하고 어떤 문서도 쓰지 않는다.
        install_all_managed_project_assets(&root, &control_root)?;
        let workflow_root =
            registered_workflow_root(&control_root, &project, &request.workflow_directory)?;

        let recovery = {
            let _lock = ProjectWriteLock::acquire(&control_root)?;
            resume_one_task(&control_root, &workflow_root, request, remove)?
        };

        Ok(TaskResumeResult {
            status: if recovery.is_some() {
                TaskResumeStatus::RecoveryRequired
            } else {
                TaskResumeStatus::Resumed
            },
            summary: summary_from_manifest(
                &root,
                project,
                SchemaCompatibility::Current,
                read_active_leases(&control_root)?,
            ),
            recovery,
        })
    }

    /// 사용자가 남긴 작업 정의 수정 요청을 앱 소유 기록으로 저장한다(SPEC-055 R2·R3).
    ///
    /// 이 명령은 작업 문서를 쓰지 않는다. 요청 문서 한 건을 만들거나 아무것도 만들지 않으며, 그래서
    /// 두 문서가 반쯤 남는 결과 자체가 생기지 않는다. 작업 본문을 고치는 일은 아키텍트 몫이다.
    pub fn record_task_revision_request(
        &self,
        root: &Path,
        request: &TaskRevisionRequestInput,
    ) -> Result<TaskRevisionRequestResult, ProjectError> {
        validate_task_revision_request(request)?;
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let project = read_manifest(&control_root.join(PROJECT_MANIFEST))?;
        validate_workflow_directories(&control_root, &project)?;
        require_current_schema(project.schema_version)?;
        // 관리 자산 설치가 스스로 쓰기 잠금을 잡으므로 이 명령의 잠금보다 앞에 둔다. 기존
        // migration lock이 있으면 여기서 이미 실패하고 어떤 문서도 쓰지 않는다.
        install_all_managed_project_assets(&root, &control_root)?;
        let workflow_root =
            registered_workflow_root(&control_root, &project, &request.workflow_directory)?;

        let (status, recorded) = {
            let _lock = ProjectWriteLock::acquire(&control_root)?;
            record_one_task_revision_request(&control_root, &workflow_root, request)?
        };

        Ok(TaskRevisionRequestResult {
            status,
            summary: summary_from_manifest(
                &root,
                project,
                SchemaCompatibility::Current,
                read_active_leases(&control_root)?,
            ),
            request: recorded,
        })
    }

    pub fn migrate(&self, root: &Path) -> Result<ProjectSummary, ProjectError> {
        let root = canonical_project_root(root)?;
        let control_root = root.join(CONTROL_DIRECTORY);
        let project_manifest_path = control_root.join(PROJECT_MANIFEST);
        let mut project = read_manifest(&project_manifest_path)?;
        validate_workflow_directories(&control_root, &project)?;

        match compatibility_for(project.schema_version) {
            SchemaCompatibility::Current => return self.inspect(&root),
            SchemaCompatibility::FutureSchema => return Err(ProjectError::FutureSchema),
            SchemaCompatibility::NotInitialized => unreachable!("manifest exists"),
            SchemaCompatibility::MigrationRequired => {}
        }

        let _lock = ProjectWriteLock::acquire(&control_root)?;
        if !read_active_leases(&control_root)?.is_empty() {
            return Err(ProjectError::ActiveLeases);
        }
        backup_manifests(&control_root, &project)?;

        while project.schema_version < PROJECT_SCHEMA_VERSION {
            project = migrate_one_version(project)?;
        }
        write_yaml_atomically(&project_manifest_path, &project)?;

        Ok(summary_from_manifest(
            &root,
            project,
            SchemaCompatibility::Current,
            Vec::new(),
        ))
    }
}

fn backup_manifests(
    control_root: &Path,
    project: &ProjectManifest,
) -> Result<PathBuf, ProjectError> {
    let backup_root = control_root
        .join(RUNTIME_DIRECTORY)
        .join("migrations")
        .join(Utc::now().format("%Y%m%dT%H%M%SZ").to_string());
    fs::create_dir_all(&backup_root)?;
    fs::copy(
        control_root.join(PROJECT_MANIFEST),
        backup_root.join(PROJECT_MANIFEST),
    )?;
    for workflow in &project.workflows {
        let source = control_root
            .join(&workflow.directory)
            .join(WORKFLOW_MANIFEST);
        if source.is_file() {
            let target_directory = backup_root.join(&workflow.directory);
            fs::create_dir_all(&target_directory)?;
            fs::copy(source, target_directory.join(WORKFLOW_MANIFEST))?;
        }
    }
    Ok(backup_root)
}

fn migrate_one_version(mut project: ProjectManifest) -> Result<ProjectManifest, ProjectError> {
    match project.schema_version {
        // Version 0 was the pre-release manifest. Its field layout is compatible with v1.
        0 => {
            project.schema_version = 1;
            Ok(project)
        }
        version => Err(ProjectError::MissingMigration(
            version,
            PROJECT_SCHEMA_VERSION,
        )),
    }
}

fn canonical_project_root(root: &Path) -> Result<PathBuf, ProjectError> {
    if !root.is_dir() {
        return Err(ProjectError::RootNotFound(root.display().to_string()));
    }
    Ok(root.canonicalize()?)
}

fn current_project_control_root(root: &Path) -> Result<PathBuf, ProjectError> {
    let root = canonical_project_root(root)?;
    let control_root = root.join(CONTROL_DIRECTORY);
    let manifest_path = control_root.join(PROJECT_MANIFEST);
    if !manifest_path.exists() {
        return Err(ProjectError::NotInitialized);
    }
    let project = read_manifest(&manifest_path)?;
    validate_workflow_directories(&control_root, &project)?;
    require_current_schema(project.schema_version)?;
    Ok(control_root)
}

/// 기존 관리 자산과 예약 도구를 함께 검사한다. 예약 도구는 같은 공용 설치 규약을 쓰되, 현재 동기화
/// 결과 타입을 바꾸지 않기 위해 이 경계에서 한 자산으로 합류한다.
fn validate_all_managed_project_assets(
    project_root: &Path,
    control_root: &Path,
) -> Result<(), ProjectError> {
    validate_managed_project_assets(project_root, control_root)?;
    validate_reservation_helper(control_root).map_err(reservation_asset_error)
}

/// 문서를 쓰는 기존 경로도 예약 도구를 빠뜨리지 않게 한 곳으로 모은다.
fn install_all_managed_project_assets(
    project_root: &Path,
    control_root: &Path,
) -> Result<(), ProjectError> {
    // 예약 자산의 미래 버전·비관리 파일은 기존 자산을 바꾸기 전에 막는다.
    validate_reservation_helper(control_root).map_err(reservation_asset_error)?;
    install_managed_project_assets(project_root, control_root)?;
    install_reservation_helper(control_root).map_err(reservation_asset_error)
}

/// 설정 화면의 수동 동기화 결과에 예약 도구도 명시한다. 공용 동기화가 충돌 또는 재시도를 돌려주면
/// 새 자산을 따로 쓰지 않아 부분 갱신을 만들지 않는다.
fn synchronize_all_managed_project_assets(
    project_root: &Path,
    control_root: &Path,
) -> Result<ManagedAssetSyncResult, ProjectError> {
    let reservation = plan_reservation_helper(control_root).map_err(reservation_asset_error)?;
    let mut result = synchronize_managed_project_assets(project_root, control_root)?;
    if !matches!(
        result.status,
        ManagedAssetSyncStatus::Current | ManagedAssetSyncStatus::Updated
    ) {
        return Ok(result);
    }

    let updated = reservation.replacement.is_some();
    let installed_version = if updated {
        Some(RESERVATION_HELPER_VERSION)
    } else {
        reservation.installed_version
    };
    install_reservation_helper(control_root).map_err(reservation_asset_error)?;
    result.assets.push(ManagedAssetState {
        id: "reservation_helper".to_owned(),
        label: "예약 헬퍼".to_owned(),
        status: if updated {
            ManagedAssetStatus::Updated
        } else {
            ManagedAssetStatus::Current
        },
        installed_version,
        provided_version: Some(RESERVATION_HELPER_VERSION),
        reason: None,
    });
    if updated {
        result.status = ManagedAssetSyncStatus::Updated;
        result.updated_assets.push("reservation_helper".to_owned());
    }
    Ok(result)
}

fn reservation_asset_error(
    error: crate::infrastructure::managed_script::ManagedScriptError,
) -> ProjectError {
    ProjectError::ManagedProjectAssets(ManagedProjectAssetsError::Conflict(error.to_string()))
}

fn ensure_managed_control_root(control_root: &Path) -> Result<(), ProjectError> {
    if !control_root.exists() {
        fs::create_dir(control_root)?;
        return Ok(());
    }
    if control_root.join(PROJECT_MANIFEST).exists() {
        return Ok(());
    }
    if fs::read_dir(control_root)?.next().is_some() {
        return Err(ProjectError::UnmanagedControlDirectory);
    }
    Ok(())
}

fn initialize_control_root(control_root: &Path) -> Result<(), ProjectError> {
    fs::create_dir_all(control_root.join(RUNTIME_DIRECTORY).join("leases"))?;
    fs::create_dir_all(control_root.join(RUNTIME_DIRECTORY).join("migrations"))?;
    write_text_atomically(&control_root.join(".gitignore"), ".runtime/\n")?;
    Ok(())
}

fn read_manifest(path: &Path) -> Result<ProjectManifest, ProjectError> {
    let file = File::open(path)?;
    Ok(serde_yaml::from_reader(file)?)
}

fn compatibility_for(schema_version: u32) -> SchemaCompatibility {
    match schema_version.cmp(&PROJECT_SCHEMA_VERSION) {
        std::cmp::Ordering::Less => SchemaCompatibility::MigrationRequired,
        std::cmp::Ordering::Equal => SchemaCompatibility::Current,
        std::cmp::Ordering::Greater => SchemaCompatibility::FutureSchema,
    }
}

fn validate_workflow_directories(
    control_root: &Path,
    manifest: &ProjectManifest,
) -> Result<(), ProjectError> {
    for workflow in &manifest.workflows {
        let relative = Path::new(&workflow.directory);
        let mut components = relative.components();
        let is_single_normal =
            matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
        if !is_single_normal {
            return Err(ProjectError::UnsafeWorkflowDirectory(
                workflow.directory.clone(),
            ));
        }

        let workflow_root = control_root.join(&workflow.directory);
        if workflow_root.exists()
            && fs::symlink_metadata(&workflow_root)?
                .file_type()
                .is_symlink()
        {
            return Err(ProjectError::UnsafeWorkflowDirectory(
                workflow.directory.clone(),
            ));
        }
    }
    Ok(())
}

/// 만료 전인 lease 하나. `stem`은 파일 이름에서 확장자를 뺀 것이고, 자격 판정의 키다. lease 안의
/// `task_id`가 아니다 — 조건 스크립트가 파일 이름으로 판정하므로 앱도 그래야 한다.
struct UnexpiredLease {
    stem: String,
    summary: AgentLeaseSummary,
}

/// `leases/` 아래에서 만료 전인 lease만 읽는다. 앱의 만료 규칙은 이 함수 하나뿐이다. 두 곳에 두면
/// 화면과 자격 판정이 서로 다른 만료 개념을 갖는다.
///
/// 열지 못하거나 `expires_at`을 RFC3339로 읽지 못한 파일은 조용히 건너뛴다. 파일은 읽기만 한다.
fn read_unexpired_leases(control_root: &Path) -> Result<Vec<UnexpiredLease>, ProjectError> {
    let leases_root = control_root.join(RUNTIME_DIRECTORY).join("leases");
    if !leases_root.is_dir() {
        return Ok(Vec::new());
    }

    let now = Utc::now();
    let mut leases = Vec::new();
    for entry in fs::read_dir(leases_root)? {
        let path = entry?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("yml") {
            continue;
        }
        let stem = match path.file_stem().and_then(|value| value.to_str()) {
            Some(value) => value.to_owned(),
            None => continue,
        };
        let file = match File::open(&path) {
            Ok(file) => file,
            Err(_) => continue,
        };
        let lease: AgentLease = match serde_yaml::from_reader(file) {
            Ok(lease) => lease,
            Err(_) => continue,
        };
        let expires_at = match DateTime::parse_from_rfc3339(&lease.expires_at) {
            Ok(value) => value.with_timezone(&Utc),
            Err(_) => continue,
        };
        if expires_at > now {
            leases.push(UnexpiredLease {
                stem,
                summary: AgentLeaseSummary {
                    lease_id: lease.lease_id,
                    agent: lease.agent,
                    // 공백뿐인 역할은 비어 있는 것과 같다. `Some("")`가 화면에 도달하면 "역할 칸이
                    // 비어 있다"와 "역할이 빈 문자열이다"가 같은 모양이 된다.
                    role: lease.role.filter(|value| !value.trim().is_empty()),
                    task_id: lease.task_id,
                    heartbeat_at: lease.heartbeat_at,
                    expires_at: lease.expires_at,
                },
            });
        }
    }
    Ok(leases)
}

fn read_active_leases(control_root: &Path) -> Result<Vec<AgentLeaseSummary>, ProjectError> {
    let mut leases: Vec<AgentLeaseSummary> = read_unexpired_leases(control_root)?
        .into_iter()
        .map(|lease| lease.summary)
        .collect();
    leases.sort_by(|left, right| left.expires_at.cmp(&right.expires_at));
    Ok(leases)
}

/// 판정용 lease 목록. 만료된 파일은 빠진다 — 조건 스크립트의 `lease_blocks`와 같은 규칙이고, 세션
/// 하나가 죽어 남긴 lease가 그 대상을 영원히 막는 것을 그 규칙이 없앤다. 화면 payload를 만드는
/// `read_active_leases`와 반환형만 다르고, 만료 판정은 둘 다 `read_unexpired_leases`에서 온다.
///
/// 디렉터리를 읽지 못하면 빈 집합이다. 선점이 없는 것으로 떨어지고 판정 자체는 계속된다.
fn lease_ids(control_root: &Path) -> HashSet<String> {
    read_unexpired_leases(control_root)
        .unwrap_or_default()
        .into_iter()
        .map(|lease| lease.stem)
        .collect()
}

fn write_yaml_atomically<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), ProjectError> {
    write_text_atomically(path, &serde_yaml::to_string(value)?)
}

fn write_text_atomically(path: &Path, value: &str) -> Result<(), ProjectError> {
    let parent = path.parent().ok_or_else(|| {
        ProjectError::Persist(format!("상위 디렉터리가 없습니다: {}", path.display()))
    })?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(value.as_bytes())?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(path)
        .map_err(|error| ProjectError::Persist(error.to_string()))?;
    Ok(())
}

fn summary_from_manifest(
    root: &Path,
    manifest: ProjectManifest,
    compatibility: SchemaCompatibility,
    active_leases: Vec<AgentLeaseSummary>,
) -> ProjectSummary {
    let control_root = root.join(CONTROL_DIRECTORY);
    // 미만료 lease의 대상 id. 겹침 판정과 선점 판정이 같은 집합을 본다.
    let lease_target_ids = lease_ids(&control_root);
    let prepared: Vec<PreparedWorkflow> = manifest
        .workflows
        .iter()
        .map(|workflow| {
            PreparedWorkflow::read(
                control_root.join(&workflow.directory),
                &active_leases,
                &lease_target_ids,
            )
        })
        .collect();
    let pending_detail = {
        let inputs: Vec<WorkflowInput<'_>> = manifest
            .workflows
            .iter()
            .zip(prepared.iter())
            .map(|(entry, workflow)| WorkflowInput {
                directory: &entry.directory,
                items: &workflow.items,
                approved_decisions: &workflow.approved_decisions,
                revision_requested_decisions: &workflow.revision_requested_decisions,
                unsatisfied_dependencies: &workflow.unsatisfied_dependencies,
                overlap_blocked: &workflow.overlap_blocked,
                nondraft_spec_sources: &workflow.nondraft_spec_sources,
            })
            .collect();
        let migration_locked = control_root
            .join(RUNTIME_DIRECTORY)
            .join(MIGRATION_LOCK_FILE)
            .exists();
        pending_role_work(migration_locked, &lease_target_ids, &inputs)
    };

    ProjectSummary {
        root_path: root.display().to_string(),
        initialized: true,
        project_id: Some(manifest.project_id),
        name: manifest.name,
        compatibility,
        active_leases,
        workflows: manifest
            .workflows
            .iter()
            .zip(prepared)
            .map(|(workflow, prepared)| {
                workflow.to_summary(
                    workflow_counts(&prepared.root, &prepared.items),
                    prepared.items,
                )
            })
            .collect(),
        pending_work: pending_detail.flags(),
        pending_detail,
    }
}

/// 워크플로우 하나를 읽은 결과. 요약과 대기 물량 판정이 같은 읽기를 나눠 쓴다.
struct PreparedWorkflow {
    root: PathBuf,
    items: WorkflowItems,
    /// 같은 기획서에 더 늦은 결정이 없는 `outcome: approved` 결정의 `(결정 id, spec_id)`
    /// (SPEC-028 R4).
    approved_decisions: Vec<(String, String)>,
    /// 같은 기획서에 더 늦은 결정이 없는 `outcome: revision_requested` 결정의 id(SPEC-018 R1).
    revision_requested_decisions: Vec<String>,
    /// 선행 선언이 미충족인 작업의 id(SPEC-013 R2).
    unsatisfied_dependencies: HashSet<String>,
    /// 겹침 선언이 활성 lease와 충돌해 착수가 막힌 작업의 id(SPEC-032 R2).
    overlap_blocked: HashSet<String>,
    /// `draft`가 아닌 기획서가 원천으로 참조하는 id(SPEC-035 R2). 기획서 훑기가 함께 낸다.
    nondraft_spec_sources: HashSet<String>,
}

impl PreparedWorkflow {
    fn read(
        root: PathBuf,
        leases: &[AgentLeaseSummary],
        lease_target_ids: &HashSet<String>,
    ) -> Self {
        // 디렉터리마다 한 번씩만 훑는다(SPEC-033 R7). 결정 훑기가 기획서 결정 목록과 QA 이벤트를,
        // 작업 훑기가 목록 요약과 판정 노드를 함께 낸다. 선행·겹침 판정은 목록에 실리지 않는 값을
        // 쓰지만(`WorkflowItemSummary`에 필드를 더하지 않는다 — TASK-037) 같은 읽기에서 나온다.
        let (decisions, qa_events) = read_decision_documents(&root);
        let (tasks, graph) = read_task_documents(&root.join("tasks"));
        let (items, nondraft_spec_sources) =
            workflow_items(&root, &decisions, &qa_events, tasks, leases);
        let revision_requested_decisions = latest_revision_requests(&decisions);
        let approved_decisions = latest_approvals(&decisions);
        let unsatisfied_dependencies = unsatisfied_dependency_task_ids(&graph);
        let overlap_blocked = overlap_blocked_task_ids(&graph, lease_target_ids);
        Self {
            root,
            items,
            approved_decisions,
            revision_requested_decisions,
            unsatisfied_dependencies,
            overlap_blocked,
            nondraft_spec_sources,
        }
    }
}

fn uninitialized_summary(root: &Path) -> ProjectSummary {
    ProjectSummary {
        root_path: root.display().to_string(),
        initialized: false,
        project_id: None,
        name: project_directory_name(root),
        compatibility: SchemaCompatibility::NotInitialized,
        active_leases: Vec::new(),
        workflows: Vec::new(),
        pending_work: PendingRoleWork::default(),
        pending_detail: PendingRoleWorkDetail::default(),
    }
}

fn project_directory_name(root: &Path) -> String {
    root.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Untitled Project")
        .to_owned()
}

fn validate_workflow_name(name: &str) -> Result<(), ProjectError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::EmptyWorkflowName);
    }
    if trimmed.chars().count() > 80 {
        return Err(ProjectError::WorkflowNameTooLong);
    }
    if trimmed.chars().any(char::is_control) {
        return Err(ProjectError::InvalidWorkflowName);
    }
    Ok(())
}

fn validate_idea(content: &str) -> Result<(), ProjectError> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::EmptyIdea);
    }
    if trimmed.chars().count() > 10_000 {
        return Err(ProjectError::IdeaTooLong);
    }
    Ok(())
}

/// 기획서의 지금 상태와 보내려는 결정의 조합이 허용되는가(SPEC-042 R2).
///
/// 행은 `apply_latest_decision`이 정한 지금 상태, 열은 보내려는 결정이다. 허용은 두 칸뿐이다 —
/// `user_review`의 세 결정과 `approved`의 수정 요청. 나머지 열둘도, 표에 없는 상태값도 막는다.
///
/// 재승인을 열지 않는 이유는 아키텍트 후보 판정의 열쇠가 결정 id이기 때문이다. 승인을 하나 더 쓰면
/// 그 id를 원천으로 적은 작업이 하나도 없어, 이미 분해가 끝난 기획서에서 두 번째 작업 세트가 나온다.
/// 수정 요청 상태에 후속 결정을 얹지 않는 것도 같은 종류의 이유다 — 그 수정 요청은 기획자 대기
/// 물량이고, 위에 결정을 얹으면 대기 물량이 조용히 사라진다.
///
/// 판정이 한 자리에 있어야 화면이 여는 조작과 대조할 기준이 하나가 된다.
fn spec_decision_is_allowed(status: &str, outcome: &SpecDecisionOutcome) -> bool {
    matches!(
        (status, outcome),
        ("user_review", _) | ("approved", SpecDecisionOutcome::RevisionRequested)
    )
}

fn validate_decision(outcome: &SpecDecisionOutcome, comment: &str) -> Result<(), ProjectError> {
    let trimmed = comment.trim();
    if matches!(
        outcome,
        SpecDecisionOutcome::RevisionRequested | SpecDecisionOutcome::Rejected
    ) && trimmed.is_empty()
    {
        return Err(ProjectError::DecisionCommentRequired);
    }
    if trimmed.chars().count() > 2_000 {
        return Err(ProjectError::DecisionCommentTooLong);
    }
    Ok(())
}

fn validate_task_qa(outcome: &TaskQaOutcome, comment: &str) -> Result<(), ProjectError> {
    let trimmed = comment.trim();
    if matches!(outcome, TaskQaOutcome::RevisionRequested) && trimmed.is_empty() {
        return Err(ProjectError::QaCommentRequired);
    }
    if trimmed.chars().count() > 2_000 {
        return Err(ProjectError::DecisionCommentTooLong);
    }
    Ok(())
}

/// QA 한 건을 기록한다. 결정 문서를 쓰고 작업 문서의 상태와 `history`를 갱신한 뒤 작업 id를 준다.
/// 단건 경로와 일괄 경로가 이 함수 하나를 함께 쓴다 — QA 기록 규칙이 지켜지는 자리를 둘로 늘리지
/// 않는 것이 뽑은 이유다. 판정 순서와 에러 종류는 뽑기 전과 같다.
fn record_one_task_qa(
    workflow_root: &Path,
    file_name: &str,
    outcome: &TaskQaOutcome,
    comment: &str,
) -> Result<String, ProjectError> {
    let task_path = safe_markdown_file(&workflow_root.join("tasks"), file_name)?;
    let (task, _) = read_markdown_document(&task_path, "todo")?;
    if task.status != "qa_waiting" {
        return Err(ProjectError::TaskNotAwaitingQa);
    }

    let decision_id = format!("QA-{}", compact_uuid()[..8].to_uppercase());
    let created_at = Utc::now().to_rfc3339();
    let (outcome_value, next_status, event_kind) = match outcome {
        TaskQaOutcome::Confirmed => ("confirmed", "completed", "completed"),
        TaskQaOutcome::RevisionRequested => ("revision_requested", "todo", "revision_requested"),
    };
    let decision = format!(
        "---\nschema: workflow-labs/qa-decision@1\nid: {decision_id}\ntask_id: {}\noutcome: {outcome_value}\ncreated_by: user\ncreated_at: {created_at}\n---\n\n{}\n",
        yaml_scalar(&task.id),
        comment.trim()
    );
    write_text_atomically(
        &workflow_root
            .join("decisions")
            .join(format!("{decision_id}.md")),
        &decision,
    )?;

    let source = fs::read_to_string(&task_path)?;
    let updated = update_task_frontmatter(&source, next_status, &created_at, event_kind)?;
    write_text_atomically(&task_path, &updated)?;

    Ok(task.id)
}

fn validate_task_resume(request: &TaskResumeRequest) -> Result<(), ProjectError> {
    let resolution = request.resolution.trim();
    if resolution.is_empty() {
        return Err(ProjectError::ResumeResolutionRequired);
    }
    if resolution.chars().count() > 2_000 {
        return Err(ProjectError::ResumeResolutionTooLong);
    }
    if request.request_id.trim().is_empty() {
        return Err(ProjectError::ResumeRequestIdRequired);
    }
    Ok(())
}

/// 쓰기 잠금 아래의 판정과 커밋. 판정에 걸리면 작업 문서도 `decisions/`도 그대로 두고, 커밋이
/// 반만 성공하면 되돌린다. 되돌리기까지 실패했을 때만 복구 정보를 낸다.
fn resume_one_task(
    control_root: &Path,
    workflow_root: &Path,
    request: &TaskResumeRequest,
    remove: impl Fn(&Path) -> std::io::Result<()>,
) -> Result<Option<TaskResumeRecovery>, ProjectError> {
    let task_path = safe_markdown_file(&workflow_root.join("tasks"), &request.file_name)?;
    let (task, _) = read_markdown_document(&task_path, "todo")?;

    // 같은 요청이 이미 성공했으면 새 기록을 만들지 않고 그 성공을 그대로 돌려준다. 기록이 있는데
    // 상태가 `todo`가 아니면 두 결과가 어긋난 것이므로 성공으로 추측하지 않는다.
    if task_resume_recorded(workflow_root, &task.id, request.request_id.trim()) {
        if task.status != "todo" {
            return Err(ProjectError::TaskResumeInconsistent);
        }
        return Ok(None);
    }
    if task.status != "blocked" {
        return Err(ProjectError::TaskNotBlocked);
    }
    if task.updated_at.as_deref() != Some(request.expected_updated_at.as_str()) {
        return Err(ProjectError::TaskResumeStale);
    }
    // 소유자가 누구든 대상을 덮은 미만료 lease가 있으면 거절한다. lease 파일은 읽기만 한다.
    if lease_ids(control_root).contains(&task.id) {
        return Err(ProjectError::TaskResumeLeased);
    }

    let resumed_at = Utc::now().to_rfc3339();
    let audit_id = format!("RESUME-{}", compact_uuid()[..8].to_uppercase());
    let audit_path = workflow_root
        .join("decisions")
        .join(format!("{audit_id}.md"));
    let audit = format!(
        "---\nschema: {TASK_RESUME_SCHEMA}\nid: {audit_id}\ntask_id: {}\noutcome: resumed\nrequest_id: {}\nprevious_updated_at: {}\ncreated_by: user\ncreated_at: {resumed_at}\n---\n\n{}\n",
        yaml_scalar(&task.id),
        yaml_scalar(request.request_id.trim()),
        yaml_scalar(&request.expected_updated_at),
        request.resolution.trim()
    );
    let source = fs::read_to_string(&task_path)?;
    let updated = update_task_frontmatter(&source, "todo", &resumed_at, "resumed")
        .map_err(|_| ProjectError::TaskResumeUnreadable)?;

    // 감사 기록을 먼저 만들고 작업 문서를 교체한다. 교체가 실패하면 되돌릴 것이 방금 만든 파일
    // 하나뿐이라 사용자 문서를 다시 쓰다 깨뜨릴 자리가 없다.
    write_text_atomically(&audit_path, &audit)?;
    let Err(error) = write_text_atomically(&task_path, &updated) else {
        return Ok(None);
    };
    match remove(&audit_path) {
        Ok(()) => Err(error),
        Err(removal) => Ok(Some(TaskResumeRecovery {
            created_paths: vec![audit_path.display().to_string()],
            reason: format!("{error}; {removal}"),
            action: "남은 재개 감사 기록 파일을 지운 뒤 재개를 다시 시도해 주세요.".to_owned(),
        })),
    }
}

fn validate_task_revision_request(request: &TaskRevisionRequestInput) -> Result<(), ProjectError> {
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err(ProjectError::RevisionReasonRequired);
    }
    if reason.chars().count() > 2_000 {
        return Err(ProjectError::RevisionReasonTooLong);
    }
    if request.request_id.trim().is_empty() {
        return Err(ProjectError::RevisionRequestIdRequired);
    }
    Ok(())
}

/// 쓰기 잠금 아래의 판정과 기록. 판정에 걸리면 어떤 파일도 쓰지 않는다.
///
/// 판정 순서는 재개 기록과 같다. 같은 요청 식별자의 기록이 이미 있으면 그것을 그대로 돌려주고, 그다음
/// 상태와 선점과 갱신 시각을 확인한 뒤, 마지막으로 미처리 요청이 있는지 본다.
fn record_one_task_revision_request(
    control_root: &Path,
    workflow_root: &Path,
    request: &TaskRevisionRequestInput,
) -> Result<(TaskRevisionRequestStatus, Option<TaskRevisionRequest>), ProjectError> {
    let task_path = safe_markdown_file(&workflow_root.join("tasks"), &request.file_name)?;
    let (task, _) = read_markdown_document(&task_path, "todo")?;
    let handled = handled_revision_request_id(&task_path);
    let records = read_revision_request_records(workflow_root, &task.id);
    let handled_of = |entry: &TaskRevisionRequest| handled.as_deref() == Some(entry.id.as_str());

    // 같은 요청이 이미 기록됐으면 새 문서를 만들지 않고 그 기록을 그대로 돌려준다.
    if let Some(record) = records
        .iter()
        .find(|record| record.request_id == request.request_id.trim())
    {
        return Ok((
            TaskRevisionRequestStatus::Recorded,
            Some(TaskRevisionRequest {
                handled: handled_of(&record.entry),
                ..record.entry.clone()
            }),
        ));
    }
    // 요청을 만들 수 있는 상태는 막힘과 개발 준비 둘뿐이다. 나머지 상태에서는 아직 정의를 고칠 때가
    // 아니거나 이미 결과를 판단하는 중이다.
    if task.status != "blocked" && task.status != "todo" {
        return Err(ProjectError::TaskNotRevisable);
    }
    // 소유자가 누구든 대상을 덮은 미만료 lease가 있으면 거절한다. lease 파일은 읽기만 한다.
    if lease_ids(control_root).contains(&task.id) {
        return Err(ProjectError::TaskRevisionLeased);
    }
    if task.updated_at.as_deref() != Some(request.expected_updated_at.as_str()) {
        return Err(ProjectError::TaskRevisionStale);
    }
    // 미처리 요청이 하나라도 있으면 두 번째 요청을 만들지 않고 그 요청을 그대로 돌려준다.
    if let Some(record) = records.iter().find(|record| !handled_of(&record.entry)) {
        return Ok((
            TaskRevisionRequestStatus::AlreadyPending,
            Some(record.entry.clone()),
        ));
    }

    let created_at = Utc::now().to_rfc3339();
    let request_document_id = format!("REVISION-{}", compact_uuid()[..8].to_uppercase());
    let document = format!(
        "---\nschema: {TASK_REVISION_REQUEST_SCHEMA}\nid: {request_document_id}\ntask_id: {}\nrequest_id: {}\nprevious_updated_at: {}\ncreated_by: user\ncreated_at: {created_at}\n---\n\n{}\n",
        yaml_scalar(&task.id),
        yaml_scalar(request.request_id.trim()),
        yaml_scalar(&request.expected_updated_at),
        request.reason.trim()
    );
    write_text_atomically(
        &workflow_root
            .join("decisions")
            .join(format!("{request_document_id}.md")),
        &document,
    )?;

    Ok((
        TaskRevisionRequestStatus::Recorded,
        Some(TaskRevisionRequest {
            id: request_document_id,
            previous_updated_at: request.expected_updated_at.clone(),
            reason: request.reason.trim().to_owned(),
            created_at,
            handled: false,
        }),
    ))
}

/// 작업 문서가 연결한 수정 요청 id. 프론트매터의 선택 필드 하나가 그 값이고, 없으면 `None`이다.
fn handled_revision_request_id(task_path: &Path) -> Option<String> {
    let contents = fs::read_to_string(task_path).ok()?;
    let (metadata, _) = split_frontmatter(&contents.replace("\r\n", "\n"));
    yaml_text(metadata.as_ref(), "revision_request_id")
}

/// 결정 디렉터리에서 읽은 수정 요청 한 건. 화면에 나가는 값과 재시도 판정에만 쓰는 요청 식별자를
/// 함께 든다. 요청 식별자는 사용자에게 보여줄 값이 아니라 같은 조작을 알아보는 값이다.
struct RevisionRequestRecord {
    request_id: String,
    entry: TaskRevisionRequest,
}

/// 한 작업의 수정 요청을 생성 시각 순서로 읽는다. 앱이 쓴 기록만 세고, 형식이 어긋난 문서는 그 파일만
/// 건너뛴다(SPEC-055 R10). `handled`는 여기서 채우지 않고 부르는 쪽이 연결 id로 정한다.
fn read_revision_request_records(
    workflow_root: &Path,
    task_id: &str,
) -> Vec<RevisionRequestRecord> {
    let Ok(entries) = fs::read_dir(workflow_root.join("decisions")) else {
        return Vec::new();
    };
    let mut records: Vec<RevisionRequestRecord> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md")
        })
        .filter_map(|path| {
            let contents = fs::read_to_string(&path).ok()?;
            let (metadata, body) = split_frontmatter(&contents.replace("\r\n", "\n"));
            let metadata = metadata.as_ref();
            if yaml_text(metadata, "schema").as_deref() != Some(TASK_REVISION_REQUEST_SCHEMA)
                || yaml_text(metadata, "created_by").as_deref() != Some("user")
                || yaml_text(metadata, "task_id").as_deref() != Some(task_id)
            {
                return None;
            }
            let created_at = yaml_text(metadata, "created_at")?;
            parse_event_instant(&created_at)?;
            Some(RevisionRequestRecord {
                request_id: yaml_text(metadata, "request_id")?,
                entry: TaskRevisionRequest {
                    id: yaml_text(metadata, "id")?,
                    previous_updated_at: yaml_text(metadata, "previous_updated_at")?,
                    reason: body.trim().to_owned(),
                    created_at,
                    handled: false,
                },
            })
        })
        .collect();
    records.sort_by(|left, right| {
        parse_event_instant(&left.entry.created_at)
            .cmp(&parse_event_instant(&right.entry.created_at))
            .then_with(|| left.entry.id.cmp(&right.entry.id))
    });
    records
}

/// 조회에 실리는 목록. 작업이 연결한 요청 id 하나가 처리 완료를 정하고 나머지는 미처리다.
fn read_task_revision_requests(
    workflow_root: &Path,
    task_id: &str,
    handled_id: Option<&str>,
) -> Vec<TaskRevisionRequest> {
    read_revision_request_records(workflow_root, task_id)
        .into_iter()
        .map(|record| TaskRevisionRequest {
            handled: handled_id == Some(record.entry.id.as_str()),
            ..record.entry
        })
        .collect()
}

/// 같은 작업에 같은 요청 식별자의 성공 재개 기록이 이미 있는가. 앱이 쓴 기록만 센다.
fn task_resume_recorded(workflow_root: &Path, task_id: &str, request_id: &str) -> bool {
    let Ok(entries) = fs::read_dir(workflow_root.join("decisions")) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            return false;
        }
        let Ok(contents) = fs::read_to_string(&path) else {
            return false;
        };
        let (metadata, _) = split_frontmatter(&contents.replace("\r\n", "\n"));
        let metadata = metadata.as_ref();
        yaml_text(metadata, "schema").as_deref() == Some(TASK_RESUME_SCHEMA)
            && yaml_text(metadata, "created_by").as_deref() == Some("user")
            && yaml_text(metadata, "outcome").as_deref() == Some("resumed")
            && yaml_text(metadata, "task_id").as_deref() == Some(task_id)
            && yaml_text(metadata, "request_id").as_deref() == Some(request_id)
    })
}

/// 실패한 건의 작업 id. 문서를 읽지 못하면 `None`이고, 파일 이름에서 추정하지 않는다.
fn task_id_of(workflow_root: &Path, file_name: &str) -> Option<String> {
    let task_path = safe_markdown_file(&workflow_root.join("tasks"), file_name).ok()?;
    read_markdown_document(&task_path, "todo")
        .ok()
        .map(|(task, _)| task.id)
}

fn update_task_frontmatter(
    source: &str,
    next_status: &str,
    updated_at: &str,
    event_kind: &str,
) -> Result<String, ProjectError> {
    let newline = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let normalized = source.replace("\r\n", "\n");
    let Some(rest) = normalized.strip_prefix("---\n") else {
        return Err(ProjectError::TaskNotAwaitingQa);
    };
    let Some(frontmatter_end) = rest.find("\n---\n") else {
        return Err(ProjectError::TaskNotAwaitingQa);
    };
    let frontmatter = &rest[..frontmatter_end];
    let body = &rest[frontmatter_end + "\n---\n".len()..];
    let mut saw_status = false;
    let mut saw_updated_at = false;
    let mut lines = Vec::new();
    for line in frontmatter.lines() {
        if line.starts_with("status:") {
            lines.push(format!("status: {next_status}"));
            saw_status = true;
        } else if line.starts_with("updated_at:") {
            lines.push(format!("updated_at: {updated_at}"));
            saw_updated_at = true;
        } else {
            lines.push(line.to_owned());
        }
    }
    if !saw_status {
        return Err(ProjectError::TaskNotAwaitingQa);
    }
    if !saw_updated_at {
        lines.push(format!("updated_at: {updated_at}"));
    }
    append_task_history(&mut lines, updated_at, event_kind);
    Ok(format!("---\n{}\n---\n{body}", lines.join("\n")).replace('\n', newline))
}

/// 프론트매터 줄 목록 끝에 전이 항목 한 줄을 덧붙인다. 기록은 추가 전용이라 기존 항목은 한 줄도
/// 고치지 않는다. 이력을 남기지 못해도 완료·반려 사실은 QA 결정 문서에 남으므로 이 함수는
/// 실패하지 않고, QA 기록 자체를 막지도 않는다.
fn append_task_history(lines: &mut Vec<String>, at: &str, kind: &str) {
    let entry = |indent: &str| format!("{indent}- {{ at: {at}, kind: {kind} }}");
    let Some(header) = lines.iter().position(|line| line.starts_with("history:")) else {
        lines.push("history:".to_owned());
        lines.push(entry("  "));
        return;
    };
    // `history: []` 같은 인라인 표기는 계약이 금지한 형태다. 줄을 이어 붙이면 문서가 깨지므로
    // 이력만 건너뛴다.
    if !lines[header]["history:".len()..].trim().is_empty() {
        return;
    }
    let mut end = header + 1;
    let mut indent = None;
    while end < lines.len() && lines[end].starts_with([' ', '\t']) {
        if indent.is_none() {
            indent = Some(leading_whitespace(&lines[end]));
        }
        end += 1;
    }
    lines.insert(end, entry(&indent.unwrap_or_else(|| "  ".to_owned())));
}

fn leading_whitespace(line: &str) -> String {
    line.chars()
        .take_while(|value| *value == ' ' || *value == '\t')
        .collect()
}

fn require_current_schema(schema_version: u32) -> Result<(), ProjectError> {
    match compatibility_for(schema_version) {
        SchemaCompatibility::Current => Ok(()),
        SchemaCompatibility::MigrationRequired => Err(ProjectError::MigrationRequired),
        SchemaCompatibility::FutureSchema => Err(ProjectError::FutureSchema),
        SchemaCompatibility::NotInitialized => unreachable!("manifest exists"),
    }
}

fn registered_workflow_root(
    control_root: &Path,
    project: &ProjectManifest,
    workflow_directory: &str,
) -> Result<PathBuf, ProjectError> {
    if !project
        .workflows
        .iter()
        .any(|workflow| workflow.directory == workflow_directory)
    {
        return Err(ProjectError::UnknownWorkflow);
    }
    let workflow_root = control_root.join(workflow_directory);
    if !workflow_root.is_dir() {
        return Err(ProjectError::UnknownWorkflow);
    }
    Ok(workflow_root)
}

fn safe_markdown_file(directory: &Path, file_name: &str) -> Result<PathBuf, ProjectError> {
    let relative = Path::new(file_name);
    let mut components = relative.components();
    let is_single_normal =
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
    if !is_single_normal || relative.extension().and_then(|value| value.to_str()) != Some("md") {
        return Err(ProjectError::UnsafeDocumentFile(file_name.to_owned()));
    }
    let path = directory.join(relative);
    if !path.is_file() {
        return Err(ProjectError::DocumentNotFound(file_name.to_owned()));
    }
    if fs::symlink_metadata(&path)?.file_type().is_symlink() {
        return Err(ProjectError::UnsafeDocumentFile(file_name.to_owned()));
    }
    Ok(path)
}

/// 이미 읽어 둔 결정과 작업을 받는다. 이 함수가 여는 디렉터리는 `specs/`와 `ideas/` 둘뿐이고
/// 각각 한 번이다(SPEC-033 R7).
fn workflow_items(
    workflow_root: &Path,
    decisions: &[SpecDecisionRecord],
    qa_events: &HashMap<String, Vec<TaskEvent>>,
    mut tasks: Vec<WorkflowItemSummary>,
    leases: &[AgentLeaseSummary],
) -> (WorkflowItems, HashSet<String>) {
    let latest = latest_spec_decisions(decisions);
    let (mut specs, references, nondraft_sources) =
        read_spec_documents(&workflow_root.join("specs"), &latest);
    let mut decision_events = spec_decision_events(decisions);
    for spec in &mut specs {
        normalize_spec_status(spec);
        if let Some((_, outcome)) = latest.get(&spec.id) {
            spec.status.clone_from(outcome);
        }
        if let Some(events) = decision_events.remove(&spec.id) {
            spec.events.extend(events);
            spec.events
                .sort_by_key(|event| parse_event_instant(&event.at));
        }
    }
    let mut ideas = read_markdown_summaries(&workflow_root.join("ideas"), "inbox");
    derive_idea_states(&mut ideas, &references, leases);
    merge_qa_decision_events(qa_events, &mut tasks);
    (
        WorkflowItems {
            ideas,
            specs,
            tasks,
        },
        nondraft_sources,
    )
}

/// 아이디어를 참조하는 기획서 하나. 판정에 필요한 값만 담는다.
struct SpecReference {
    idea_id: String,
    spec_id: String,
    /// 화면 기준 상태가 `draft`인가. 정규화와 결정 덮어쓰기를 반영한 결과다.
    is_draft: bool,
    /// 최신 결정이 `rejected`인가. 반려는 계약이 정한 종료 상태이므로, 이 값이 참인 기획서는
    /// 더 갈 곳이 없다(SPEC-018 R6). 결정이 없으면 거짓이다.
    is_rejected: bool,
}

/// `source_idea_id`를 가진 기획서만 모은다. 없는 문서는 아이디어에서 출발하지 않은 기획서이므로
/// 판정 대상이 아니다. 결정 판정은 이미 읽어 둔 최신 결정 표를 받는다 — 규칙을 새로 쓰지 않는다.
fn spec_reference(
    path: &Path,
    metadata: Option<&serde_yaml::Value>,
    decided: &HashMap<String, (String, String)>,
) -> Option<SpecReference> {
    let idea_id = yaml_text(metadata, "source_idea_id")?;
    // `read_markdown_document`의 fallback과 같은 규칙이어야 화면이 짚어 주는 id와
    // 목록의 기획서 id가 어긋나지 않는다.
    let spec_id = yaml_text(metadata, "id").unwrap_or_else(|| {
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("DOCUMENT")
            .to_owned()
    });
    // 화면 기준 상태가 `draft`인가를 본다. 파일에 적힌 글자가 아니다. 결정이 있으면 그
    // 결정이 상태를 덮어쓰고, 정규화가 알 수 없는 값을 `draft`로 떨어뜨리므로 `draft`가
    // 아니라고 말하려면 `user_review`가 명시돼 있어야 한다.
    let latest_outcome = decided.get(&spec_id).map(|(_, outcome)| outcome.as_str());
    let is_draft =
        latest_outcome.is_none() && yaml_text(metadata, "status").as_deref() != Some("user_review");
    // 최신 결정 하나만 본다. `rejected` 뒤에 다른 결정이 붙으면 그 기획서는 반려로 끝난
    // 것이 아니고, `latest_spec_decisions`가 이미 그 규칙을 판정해 둔다.
    let is_rejected = latest_outcome == Some("rejected");
    Some(SpecReference {
        idea_id,
        spec_id,
        is_draft,
        is_rejected,
    })
}

/// `specs/`를 한 번 훑어 목록 요약과 아이디어 판정용 참조, 그리고 회수 판정용 원천 집합을 함께
/// 낸다(SPEC-033 R7).
///
/// 앞의 두 값이 세는 문서가 서로 다르다. 요약은 일반 파일만 담고(`read_markdown_summaries`의 규칙),
/// 참조는 읽히는 `.md`를 전부 담는다 — 심링크로 걸린 기획서가 목록에는 없어도 아이디어 판정에는
/// 든다. 그 차이가 판정을 갈라 온 자리이므로 합치면서도 각자의 규칙을 그대로 지킨다.
/// 참조 순서는 디렉터리 순회 순서 그대로이고, 요약만 목록 정렬을 거친다.
///
/// 세 번째 값은 [`nondraft_spec_sources`]가 만든다. 참조와 달리 `source_decision_id`까지 담고
/// 파일에 적힌 `status` 원문을 본다.
///
/// [`nondraft_spec_sources`]: crate::infrastructure::role_eligibility::WorkflowInput::nondraft_spec_sources
fn read_spec_documents(
    specs_root: &Path,
    decided: &HashMap<String, (String, String)>,
) -> (
    Vec<WorkflowItemSummary>,
    Vec<SpecReference>,
    HashSet<String>,
) {
    let mut summaries = Vec::new();
    let mut references = Vec::new();
    let mut nondraft_sources = HashSet::new();
    for entry in fs::read_dir(specs_root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };
        let normalized = contents.replace("\r\n", "\n");
        let (metadata, body) = split_frontmatter(&normalized);
        if matches!(fs::symlink_metadata(&path), Ok(value) if value.file_type().is_file()) {
            summaries.push(markdown_summary(&path, metadata.as_ref(), &body, "draft"));
        }
        references.extend(spec_reference(&path, metadata.as_ref(), decided));
        collect_nondraft_sources(metadata.as_ref(), &mut nondraft_sources);
    }
    sort_markdown_summaries(&mut summaries);
    (summaries, references, nondraft_sources)
}

/// 이 기획서가 `draft`가 아니면 그 원천 id를 집합에 넣는다(SPEC-035 R2).
///
/// 판별은 프론트매터에 적힌 `status` 원문이 문자열 `draft`와 같은지 하나다. 조건 스크립트가
/// `status:`로 시작하는 첫 줄의 값을 같은 값과 비교하므로 어법을 거기에 맞춘다. 화면용
/// 정규화(`normalize_spec_status`)를 쓰면 계약 밖 상태가 전부 `draft`로 접혀 정확히 반대로 답하고,
/// 아이디어 파생 상태를 쓰면 "모두 `draft`"가 아니라 "하나라도 `draft`"가 되어 갈라진다(SPEC-035 R7).
/// 결정이 덮어쓴 상태도 보지 않는다 — 스크립트는 결정 문서를 읽지 않는다.
///
/// 두 원천이 한 집합에 들어간다. 아이디어 판정과 수정 요청 판정이 각각 자기 id로만 조회하므로
/// 섞이지 않는다.
fn collect_nondraft_sources(metadata: Option<&serde_yaml::Value>, sources: &mut HashSet<String>) {
    if yaml_text(metadata, "status").as_deref() == Some("draft") {
        return;
    }
    for key in ["source_idea_id", "source_decision_id"] {
        if let Some(value) = yaml_text(metadata, key) {
            sources.insert(value);
        }
    }
}

fn spec_references(workflow_root: &Path, decisions: &[SpecDecisionRecord]) -> Vec<SpecReference> {
    read_spec_documents(
        &workflow_root.join("specs"),
        &latest_spec_decisions(decisions),
    )
    .1
}

/// 아이디어 항목의 `status`와 `stalled_spec_ids`를 파생값으로 채운다.
/// 목록 조회와 전문 읽기가 같은 결론을 내도록 두 경로가 이 함수만 부른다(SPEC-012 R7).
///
/// 파일에 적힌 아이디어 `status`는 payload로 흘려보내지 않는다. 네 상태가 배타적이려면 판정이 네
/// 경우 모두에 값을 써야 한다. 파일에 쓰지는 않는다 — 읽은 값을 화면에 그대로 흘리지 않을 뿐이다.
fn derive_idea_states(
    ideas: &mut [WorkflowItemSummary],
    references: &[SpecReference],
    leases: &[AgentLeaseSummary],
) {
    for idea in ideas {
        // 받은 목록이 이미 미만료 lease만 담고 있으므로 만료 판정은 하지 않는다.
        // `task_id`가 없는 lease는 무엇을 물고 있는지 말하지 않으므로 세지 않는다.
        let preempted = leases
            .iter()
            .any(|lease| lease.task_id.as_deref() == Some(idea.id.as_str()));
        let mut drafts: Vec<String> = references
            .iter()
            .filter(|reference| reference.idea_id == idea.id && reference.is_draft)
            .map(|reference| reference.spec_id.clone())
            .collect();
        // `fs::read_dir` 순서는 플랫폼마다 다르므로 정렬하지 않으면 같은 상태에서 화면 문구가
        // 흔들린다.
        drafts.sort();
        let referenced = references
            .iter()
            .any(|reference| reference.idea_id == idea.id);
        // 남은 길이 없는가. `all`은 빈 반복자에서 참이므로 참조가 하나라도 있는지를 함께 본다.
        let all_rejected = referenced
            && references
                .iter()
                .filter(|reference| reference.idea_id == idea.id)
                .all(|reference| reference.is_rejected);

        if !referenced && !preempted {
            idea.status = "inbox".to_owned();
            idea.stalled_spec_ids = Vec::new();
        } else if preempted || !drafts.is_empty() {
            // 반려가 섞여 있어도 아직 쓰는 중인 기획서가 있으면 종결이 아니다(SPEC-018 R6). 그래서
            // 이 가지가 종결보다 앞선다.
            idea.status = "drafting".to_owned();
            idea.stalled_spec_ids = if preempted { Vec::new() } else { drafts };
        } else if all_rejected {
            idea.status = "closed".to_owned();
            idea.stalled_spec_ids = Vec::new();
        } else {
            idea.status = "adopted".to_owned();
            idea.stalled_spec_ids = Vec::new();
        }
    }
}

fn normalize_spec_status(spec: &mut WorkflowItemSummary) {
    if spec.status != "draft" && spec.status != "user_review" {
        spec.status = "draft".to_owned();
    }
}

fn read_markdown_summaries(directory: &Path, default_status: &str) -> Vec<WorkflowItemSummary> {
    let mut items: Vec<_> = fs::read_dir(directory)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).ok()?;
            if !metadata.file_type().is_file()
                || path.extension().and_then(|value| value.to_str()) != Some("md")
            {
                return None;
            }
            read_markdown_document(&path, default_status)
                .ok()
                .map(|(summary, _)| summary)
        })
        .collect();
    sort_markdown_summaries(&mut items);
    items
}

/// 목록 화면이 쓰는 정렬. 한 번 훑기로 요약을 만드는 자리들이 같은 순서를 내도록 규칙을 한 벌만 둔다.
/// 같은 디렉터리에 파일 이름이 겹칠 수 없으므로 이 비교는 전순서이고, 입력 순서가 결과를 바꾸지 않는다.
fn sort_markdown_summaries(items: &mut [WorkflowItemSummary]) {
    items.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.file_name.cmp(&right.file_name))
    });
}

fn read_markdown_document(
    path: &Path,
    default_status: &str,
) -> Result<(WorkflowItemSummary, String), ProjectError> {
    let contents = fs::read_to_string(path)?;
    let normalized = contents.replace("\r\n", "\n");
    let (metadata, body) = split_frontmatter(&normalized);
    Ok((
        markdown_summary(path, metadata.as_ref(), &body, default_status),
        body.trim().to_owned(),
    ))
}

/// 이미 읽어 둔 프론트매터와 본문에서 목록 항목 하나를 만든다. 파일을 다시 읽지 않는 자리가
/// 이 함수를 부르고, 같은 문서에서 다른 값을 함께 만드는 훑기가 그 자리다(SPEC-033 R7).
fn markdown_summary(
    path: &Path,
    metadata: Option<&serde_yaml::Value>,
    body: &str,
    default_status: &str,
) -> WorkflowItemSummary {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.md")
        .to_owned();
    let fallback_id = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("DOCUMENT")
        .to_owned();
    let title = yaml_text(metadata, "title")
        .or_else(|| markdown_title(body))
        .or_else(|| markdown_plain_title(body))
        .unwrap_or_else(|| fallback_id.clone());
    let updated_at = yaml_text(metadata, "updated_at")
        .or_else(|| yaml_text(metadata, "created_at"))
        .or_else(|| {
            fs::metadata(path)
                .and_then(|value| value.modified())
                .ok()
                .map(|value| DateTime::<Utc>::from(value).to_rfc3339())
        });
    let due_at = yaml_text(metadata, "due_at");
    let source_spec_id = yaml_text(metadata, "source_spec_id");
    let source_decision_id = yaml_text(metadata, "source_decision_id");
    let events = read_task_events(metadata);
    let status = yaml_text(metadata, "status").unwrap_or_else(|| default_status.to_owned());
    // QA 대기 카드에는 개발자가 쓴 확인 동선의 첫 문단을 싣는다(SPEC-056 R1). 이미 읽어 둔 같은
    // 본문에서 값을 하나 더 뽑을 뿐이라 조회가 파일을 더 열지 않는다. 절이 없거나 첫 문단이 비어
    // 있으면 지금까지의 발췌 그대로다 — 없는 사실을 카드에서 지적하거나 대신 문장을 만들지 않는다.
    let excerpt = (status == "qa_waiting")
        .then(|| walkthrough_preview(body))
        .flatten()
        .unwrap_or_else(|| markdown_excerpt(body));
    WorkflowItemSummary {
        file_name,
        id: yaml_text(metadata, "id").unwrap_or(fallback_id),
        title,
        status,
        updated_at,
        due_at,
        source_spec_id,
        source_decision_id,
        // 아이디어 판정(`derive_idea_states`)만 이 값을 채운다.
        stalled_spec_ids: Vec::new(),
        events,
        excerpt,
    }
}

/// 상태 전이 이력을 관대하게 읽는다. 이력이 없거나 항목이 깨진 것은 오류가 아니다.
/// 읽기가 `Err`가 되면 `read_markdown_summaries`가 그 문서를 통째로 건너뛰기 때문이다.
fn read_task_events(metadata: Option<&serde_yaml::Value>) -> Vec<TaskEvent> {
    let Some(entries) = metadata
        .and_then(|value| value.get("history"))
        .and_then(serde_yaml::Value::as_sequence)
    else {
        return Vec::new();
    };
    let mut events = entries
        .iter()
        .filter_map(|entry| {
            if !entry.is_mapping() {
                return None;
            }
            let kind = yaml_text(Some(entry), "kind")
                .filter(|value| TASK_EVENT_KINDS.contains(&value.as_str()))?;
            let at = yaml_text(Some(entry), "at")?;
            let parsed = DateTime::parse_from_rfc3339(&at).ok()?;
            Some((parsed, TaskEvent { kind, at }))
        })
        .collect::<Vec<_>>();
    events.sort_by_key(|(left, _)| *left);
    events.into_iter().map(|(_, event)| event).collect()
}

fn split_frontmatter(contents: &str) -> (Option<serde_yaml::Value>, String) {
    let Some(rest) = contents.strip_prefix("---\n") else {
        return (None, contents.to_owned());
    };
    let Some(end) = rest.find("\n---\n") else {
        return (None, contents.to_owned());
    };
    let yaml = &rest[..end];
    let body = rest[end + 5..].to_owned();
    (serde_yaml::from_str(yaml).ok(), body)
}

/// 프론트매터 원문 구간. `split_frontmatter`는 파싱된 값과 본문만 돌려주므로 줄 단위로 읽어야 하는
/// 선행 선언에는 쓸 수 없다. 구분자가 없으면 프론트매터가 없는 것이다.
fn frontmatter_source(contents: &str) -> Option<&str> {
    let rest = contents.strip_prefix("---\n")?;
    let end = rest.find("\n---\n")?;
    Some(&rest[..end])
}

/// 프론트매터의 선행 선언 한 줄을 읽은 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
enum DependencyDeclaration {
    /// 키가 없다. 선행 작업이 없다는 뜻이다.
    Absent,
    /// 계약 형식의 목록을 읽었다. 빈 목록일 수 있다.
    Declared(Vec<String>),
    /// 키는 있는데 계약 형식이 아니다. 미충족으로 다룬다(SPEC-013 R3).
    Malformed,
}

/// 계약이 정하는 표기는 열 0에서 시작하는 한 줄 흐름 시퀀스 하나뿐이라 `serde_yaml`로 읽지 않는다.
/// 파서는 블록 표기와 흐름 표기를 구분해 주지 않는데, 블록 표기는 `append_task_history`의 스캔에
/// 걸려 문서를 깨뜨리고 조건 스크립트(TASK-040)가 sh로 읽을 수도 없다.
///
/// 아래 순서가 SPEC-013 R2의 단일 정의이고 조건 스크립트가 같은 결론을 내야 한다.
fn parse_dependency_declaration(frontmatter: &str) -> DependencyDeclaration {
    let mut declarations = frontmatter
        .lines()
        .filter_map(|line| line.strip_prefix("depends_on:"));
    let Some(value) = declarations.next() else {
        return DependencyDeclaration::Absent;
    };
    // 같은 키가 두 줄이면 YAML 중복 키이기도 하다.
    if declarations.next().is_some() {
        return DependencyDeclaration::Malformed;
    }
    let value = value.trim();
    // 값이 비어 있는 것은 블록 표기이거나 값 없는 키다.
    if !value.starts_with('[') || !value.ends_with(']') {
        return DependencyDeclaration::Malformed;
    }
    let tokens: Vec<&str> = value[1..value.len() - 1]
        .split(',')
        .map(str::trim)
        .collect();
    if tokens.iter().all(|token| token.is_empty()) {
        return DependencyDeclaration::Declared(Vec::new());
    }
    // 따옴표로 감싼 표기도 여기서 걸린다. 계약이 정하는 것은 따옴표 없는 문서 id다.
    if tokens.iter().any(|token| {
        token.is_empty()
            || !token
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || value == '_' || value == '-')
    }) {
        return DependencyDeclaration::Malformed;
    }
    DependencyDeclaration::Declared(tokens.into_iter().map(str::to_owned).collect())
}

/// 프론트매터의 겹침 선언 한 줄을 읽은 결과(SPEC-032 R1).
#[derive(Debug, Clone, PartialEq, Eq)]
enum ScopeDeclaration {
    /// 키가 없다. 이 작업이 무엇을 만지는지 알 수 없다.
    Absent,
    /// 계약 형식의 목록을 읽었다. 빈 목록은 "만지는 파일이 없다"이고 아무와도 겹치지 않는다.
    Declared(Vec<String>),
    /// 키는 있는데 계약 형식이 아니다.
    Malformed,
}

/// `depends_on`과 같은 어법으로 `scope_files` 한 줄을 읽는다. 두 필드를 한 함수로 합치지 않는 것은
/// 허용 문자 집합이 다르기 때문이다 — 경로에는 `.`과 `/`가 들어간다.
///
/// 판정 순서는 [`parse_dependency_declaration`]과 같고, 조건 스크립트 두 본문이 같은 결론을 낸다.
/// 부재와 형식 오류는 자격 판정에서 같은 답을 내지만 화면이 둘을 다르게 말할 수 있도록 구분한다.
fn parse_scope_declaration(frontmatter: &str) -> ScopeDeclaration {
    let mut declarations = frontmatter
        .lines()
        .filter_map(|line| line.strip_prefix("scope_files:"));
    let Some(value) = declarations.next() else {
        return ScopeDeclaration::Absent;
    };
    // 같은 키가 두 줄이면 YAML 중복 키이기도 하다.
    if declarations.next().is_some() {
        return ScopeDeclaration::Malformed;
    }
    let value = value.trim();
    // 값이 비어 있는 것은 블록 표기이거나 값 없는 키다.
    if !value.starts_with('[') || !value.ends_with(']') || value.len() < 2 {
        return ScopeDeclaration::Malformed;
    }
    let tokens: Vec<&str> = value[1..value.len() - 1]
        .split(',')
        .map(str::trim)
        .collect();
    if tokens.iter().all(|token| token.is_empty()) {
        return ScopeDeclaration::Declared(Vec::new());
    }
    // 따옴표로 감싼 표기와 공백이 든 경로가 여기서 걸린다. 경로는 프로젝트 루트 기준 상대 경로를
    // 적힌 그대로 쓴다 — 정규화도 글롭도 하지 않는다.
    if tokens.iter().any(|token| {
        token.is_empty()
            || !token.chars().all(|value| {
                value.is_ascii_alphanumeric() || matches!(value, '_' | '-' | '.' | '/')
            })
    }) {
        return ScopeDeclaration::Malformed;
    }
    ScopeDeclaration::Declared(tokens.into_iter().map(str::to_owned).collect())
}

/// 판정에 필요한 값만 담은 작업 문서 하나. 한 번의 읽기에서 셋이 함께 나온다.
struct TaskNode {
    status: String,
    dependencies: DependencyDeclaration,
    scope: ScopeDeclaration,
}

/// 판정에 필요한 값만 담은 워크플로우의 작업 목록. 문서 id로 찾고 값은 상태와 두 선언이다.
///
/// id와 상태는 목록 화면이 쓰는 규칙 그대로 읽고 선언만 줄 단위로 읽는다. 같은 id를 가진 문서가
/// 둘 이상이면 파일 이름이 앞서는 쪽을 남긴다 — 중복 id는 계약 위반이라 여기서 다루지 않는다.
fn task_dependency_graph(tasks_root: &Path) -> HashMap<String, TaskNode> {
    read_task_documents(tasks_root).1
}

/// `tasks/`를 한 번 훑어 목록 요약과 판정 노드를 함께 낸다(SPEC-033 R7).
///
/// 두 값이 세는 문서와 읽는 규칙이 같다. id와 상태는 목록 요약이 만든 값을 그대로 쓰고 — 두 자리가
/// 같은 규칙이라고 적어 온 것이 이 함수에서 한 벌이 된다 — 선언만 프론트매터 원문에서 줄 단위로
/// 읽는다. 선언은 목록 payload에 실리지 않는다(`WorkflowItemSummary`에 필드를 더하지 않는다 —
/// TASK-037).
///
/// 노드 표는 파일 이름 순서로 채운다. 같은 id를 가진 문서가 둘 이상이면 파일 이름이 앞서는 쪽을
/// 남기는 규칙이 그 순서에 기댄다. 요약은 뒤에서 다시 정렬하므로 이 순서에 기대지 않는다.
fn read_task_documents(tasks_root: &Path) -> (Vec<WorkflowItemSummary>, HashMap<String, TaskNode>) {
    let mut paths: Vec<PathBuf> = fs::read_dir(tasks_root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|value| value.to_str()) == Some("md")
                && matches!(fs::symlink_metadata(path), Ok(metadata) if metadata.file_type().is_file())
        })
        .collect();
    paths.sort();

    let mut summaries = Vec::new();
    let mut graph = HashMap::new();
    for path in paths {
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };
        let normalized = contents.replace("\r\n", "\n");
        let (metadata, body) = split_frontmatter(&normalized);
        let summary = markdown_summary(&path, metadata.as_ref(), &body, "todo");
        let frontmatter = frontmatter_source(&normalized).unwrap_or_default();
        graph.entry(summary.id.clone()).or_insert(TaskNode {
            status: summary.status.clone(),
            dependencies: parse_dependency_declaration(frontmatter),
            scope: parse_scope_declaration(frontmatter),
        });
        summaries.push(summary);
    }
    sort_markdown_summaries(&mut summaries);
    (summaries, graph)
}

/// 작업 하나의 선언을 판정해 상세 payload에 실을 값으로 만든다. 순서는 선언에 적힌 그대로다 —
/// 아키텍트가 쓴 순서에 뜻이 있을 수 있다.
fn task_dependencies(
    task_id: &str,
    graph: &HashMap<String, TaskNode>,
) -> (Vec<TaskDependency>, bool) {
    match graph.get(task_id).map(|node| &node.dependencies) {
        Some(DependencyDeclaration::Declared(ids)) => (
            ids.iter()
                .map(|id| TaskDependency {
                    id: id.clone(),
                    state: dependency_state(task_id, id, graph),
                })
                .collect(),
            false,
        ),
        Some(DependencyDeclaration::Malformed) => (Vec::new(), true),
        Some(DependencyDeclaration::Absent) | None => (Vec::new(), false),
    }
}

/// 선행 선언이 미충족인 작업의 id. 자격 판정이 쓰는 모양으로 접은 것이고, 판정 자체는 상세 화면과
/// 같은 `task_dependencies`가 한다 — 같은 규칙의 구현을 두 벌 만들지 않는다(SPEC-013 R2).
///
/// 선언이 없는 작업은 이 집합에 들어가지 않는다. 그래서 여기 없는 id는 제약이 없는 것이고, 그래프에
/// 잡히지 않은 작업도 조건 스크립트와 같이 충족으로 떨어진다.
fn unsatisfied_dependency_task_ids(graph: &HashMap<String, TaskNode>) -> HashSet<String> {
    graph
        .keys()
        .filter(|task_id| {
            let (dependencies, format_error) = task_dependencies(task_id, graph);
            format_error
                || dependencies
                    .iter()
                    .any(|dependency| dependency.state != TaskDependencyState::Satisfied)
        })
        .cloned()
        .collect()
}

/// 선행 작업 하나의 판정. 순서는 `Missing` → `Cyclic` → 상태다.
///
/// 선행 작업 자신의 선언이 형식 오류인 것은 지금 작업의 판정을 바꾸지 않는다. 형식 오류는 그 문서를
/// 미충족으로 만들지, 그 문서에 기대는 문서까지 막지는 않는다.
fn dependency_state(
    task_id: &str,
    dependency_id: &str,
    graph: &HashMap<String, TaskNode>,
) -> TaskDependencyState {
    let Some(TaskNode { status, .. }) = graph.get(dependency_id) else {
        return TaskDependencyState::Missing;
    };
    // 순환은 상태 판정보다 앞선다. 뒤에 두면 `completed`인 선행이 고리를 이룰 때 결론이 갈린다.
    if declaration_reaches(dependency_id, task_id, graph) {
        return TaskDependencyState::Cyclic;
    }
    // 계약에 없는 상태값도 미충족이다. 모르는 값을 충족 쪽으로 넘기지 않는다.
    if status == "qa_waiting" || status == "completed" {
        TaskDependencyState::Satisfied
    } else {
        TaskDependencyState::Pending
    }
}

/// `from`에서 선언 그래프의 간선을 따라 `target`에 닿는가. 방문 집합이 종료를 보장하므로 순환을 따라
/// 무한히 돌지 않는다. 자기 참조는 `from`과 `target`이 같은 길이 0의 경우다.
fn declaration_reaches<'a>(
    from: &'a str,
    target: &str,
    graph: &'a HashMap<String, TaskNode>,
) -> bool {
    let mut visited: HashSet<&str> = HashSet::new();
    let mut pending = vec![from];
    while let Some(current) = pending.pop() {
        if current == target {
            return true;
        }
        if !visited.insert(current) {
            continue;
        }
        // `Absent`·`Malformed`인 작업에는 나가는 간선이 없다.
        if let Some(TaskNode {
            dependencies: DependencyDeclaration::Declared(ids),
            ..
        }) = graph.get(current)
        {
            pending.extend(ids.iter().map(String::as_str));
        }
    }
    false
}

/// 미만료 lease 대상 `target` 하나가 작업 `task_id`의 착수를 막는지, 막는다면 두 선언이 함께 가리킨
/// 경로가 무엇인지(SPEC-032 R2). `None`이 막지 않는다는 뜻이다.
///
/// 자기 자신을 잡은 lease는 이 규칙이 다루지 않는다. 그것은 겹침이 아니라 자기 선점이고, 자격
/// 판정의 기존 조건이 이미 뺀다.
///
/// 선언이 없거나 형식 오류인 작업은 "모든 미완료 작업과 겹친다"로 본다(SPEC-032 승인된 확인 필요
/// 2번). 겹침은 대칭 관계이므로 lease가 잡은 작업 쪽의 선언이 그럴 때도 같은 답을 낸다. 반대로
/// lease가 잡은 것이 작업 문서가 아니면 비교할 상대가 없으므로 막지 않는다.
fn overlap_block(
    task_id: &str,
    target: &str,
    graph: &HashMap<String, TaskNode>,
) -> Option<Vec<String>> {
    if target == task_id {
        return None;
    }
    let Some(TaskNode {
        scope: ScopeDeclaration::Declared(mine),
        ..
    }) = graph.get(task_id)
    else {
        return Some(Vec::new());
    };
    let other = graph.get(target)?;
    let ScopeDeclaration::Declared(theirs) = &other.scope else {
        return Some(Vec::new());
    };
    // 문자열 완전 일치 교집합이다. 정규화·글롭·디렉터리 접두 일치·대소문자 접기를 하지 않는다 —
    // 세 구현이 같은 결론을 내야 하고 경로 정규화는 플랫폼마다 다르다.
    let theirs: HashSet<&str> = theirs.iter().map(String::as_str).collect();
    let mut shared: Vec<String> = mine
        .iter()
        .filter(|path| theirs.contains(path.as_str()))
        .cloned()
        .collect();
    shared.sort();
    shared.dedup();
    if shared.is_empty() {
        None
    } else {
        Some(shared)
    }
}

/// 겹침으로 착수가 막힌 작업의 id(SPEC-032 R2). 자격 판정이 쓰는 모양으로 접은 것이고, 판정 자체는
/// 상세 화면과 같은 [`overlap_block`]이 한다 — 같은 규칙의 구현을 두 벌 만들지 않는다.
///
/// `lease_target_ids`는 미만료 lease의 대상 id 집합이다. 비어 있으면 아무것도 막히지 않으므로
/// 판정은 이 필드가 없던 때와 같다.
fn overlap_blocked_task_ids(
    graph: &HashMap<String, TaskNode>,
    lease_target_ids: &HashSet<String>,
) -> HashSet<String> {
    graph
        .keys()
        .filter(|task_id| {
            lease_target_ids
                .iter()
                .any(|target| overlap_block(task_id, target, graph).is_some())
        })
        .cloned()
        .collect()
}

/// 작업 하나의 착수를 막고 있는 lease와 그 근거. lease 대상 id 오름차순이다(SPEC-032 R7).
fn task_overlap_blocks(
    task_id: &str,
    graph: &HashMap<String, TaskNode>,
    lease_target_ids: &HashSet<String>,
) -> Vec<TaskOverlapBlock> {
    let mut blocks: Vec<TaskOverlapBlock> = lease_target_ids
        .iter()
        .filter_map(|target| {
            overlap_block(task_id, target, graph).map(|shared_files| TaskOverlapBlock {
                lease_target_id: target.clone(),
                shared_files,
            })
        })
        .collect();
    blocks.sort_by(|left, right| left.lease_target_id.cmp(&right.lease_target_id));
    blocks
}

fn yaml_text(metadata: Option<&serde_yaml::Value>, key: &str) -> Option<String> {
    metadata?
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn markdown_title(body: &str) -> Option<String> {
    body.lines()
        .find_map(|line| line.trim().strip_prefix("# "))
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
}

fn markdown_plain_title(body: &str) -> Option<String> {
    let line = body
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with(['#', '-', '*']))?;
    let mut title = line.chars().take(60).collect::<String>();
    if line.chars().count() > 60 {
        title.push('…');
    }
    Some(title)
}

fn markdown_excerpt(body: &str) -> String {
    let joined = body
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.trim_start_matches(['-', '*', ' ']))
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");
    clip_excerpt(&joined)
}

/// 카드에 담기는 길이로 자른다. 넘치면 말줄임표를 붙인다. 발췌와 확인 동선 미리보기가 이 규칙 하나를
/// 함께 쓰므로 두 값의 잘림이 갈라지지 않는다.
fn clip_excerpt(value: &str) -> String {
    let mut clipped: String = value.chars().take(EXCERPT_LIMIT).collect();
    if value.chars().count() > EXCERPT_LIMIT {
        clipped.push('…');
    }
    clipped
}

/// 확인 동선 절의 첫 문단을 카드 미리보기 문장으로 만든다(SPEC-056 R2·R5·R6).
///
/// 제목은 계약이 정한 문자열과 문자 단위로 같을 때만 절로 인정하고, 철자·깊이·앞뒤 공백이 다른 제목을
/// 보완하지 않는다. 코드 울타리 안의 같은 줄은 제목으로 세지 않는다. 첫 문단은 제목 아래 빈 줄을 지나
/// 처음 만나는 빈 줄 앞까지이고, 여러 줄이면 한 줄로 이어 붙인다. 값은 문서에 적힌 그대로이며 요약하거나
/// 다시 쓰지 않는다. 절이 없거나 문단이 비어 있으면 `None`이고, 그때 부르는 쪽이 기존 발췌로 되돌아간다.
fn walkthrough_preview(body: &str) -> Option<String> {
    let mut lines = body.lines();
    let mut fenced = false;
    loop {
        let line = lines.next()?;
        if is_code_fence(line) {
            fenced = !fenced;
            continue;
        }
        if !fenced && line == TASK_WALKTHROUGH_HEADING {
            break;
        }
    }

    let mut paragraph: Vec<&str> = Vec::new();
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            // 제목과 문단 사이의 빈 줄은 지나가고, 문단이 시작된 뒤의 빈 줄에서 멈춘다.
            if paragraph.is_empty() {
                continue;
            }
            break;
        }
        // 다음 절의 제목이나 코드 울타리를 문장으로 싣지 않는다. 여기서 멈추면 문단은 비어 있고,
        // 그 결과 카드는 기존 발췌를 그대로 보여준다.
        if trimmed.starts_with('#') || is_code_fence(line) {
            break;
        }
        paragraph.push(trimmed);
    }

    (!paragraph.is_empty()).then(|| clip_excerpt(&paragraph.join(" ")))
}

fn is_code_fence(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with("```") || trimmed.starts_with("~~~")
}

/// QA 결정 문서 하나를 전이 이벤트로 읽는다. 결정 문서는 앱 소유라 여기서는 읽기만 한다.
/// 형식이 어긋난 문서는 그 파일만 건너뛰고 조회 전체를 실패시키지 않는다.
fn qa_decision_event(metadata: Option<&serde_yaml::Value>) -> Option<(String, TaskEvent)> {
    let task_id = yaml_text(metadata, "task_id")?;
    let at = yaml_text(metadata, "created_at")?;
    DateTime::parse_from_rfc3339(&at).ok()?;
    let kind = match yaml_text(metadata, "outcome").as_deref() {
        Some("confirmed") => "completed",
        Some("revision_requested") => "revision_requested",
        _ => return None,
    };
    Some((
        task_id,
        TaskEvent {
            kind: kind.to_owned(),
            at,
        },
    ))
}

/// 재개 감사 기록 하나를 전이 이벤트로 읽는다. 작업 문서 이력의 `resumed` 항목과 같은 사실이므로
/// 같은 타임라인에 실리고, 두 원천에 함께 있으면 시각 비교로 한 번만 남는다.
fn task_resume_event(metadata: Option<&serde_yaml::Value>) -> Option<(String, TaskEvent)> {
    let task_id = yaml_text(metadata, "task_id")?;
    let at = yaml_text(metadata, "created_at")?;
    DateTime::parse_from_rfc3339(&at).ok()?;
    if yaml_text(metadata, "outcome").as_deref() != Some("resumed") {
        return None;
    }
    Some((
        task_id,
        TaskEvent {
            kind: "resumed".to_owned(),
            at,
        },
    ))
}

/// 작업 문서의 이력과 QA 결정 문서를 한 타임라인으로 합친다. 같은 사실이 두 원천에 있으면 작업
/// 문서의 항목을 남긴다(원문 보존). 가리키는 작업이 목록에 없는 결정 기록은 화면에 도달하지 않는다.
///
/// 결정은 이미 읽어 둔 것을 받는다. `decisions/`를 여는 자리는 `read_decision_documents` 하나다.
fn merge_qa_decision_events(
    decisions: &HashMap<String, Vec<TaskEvent>>,
    tasks: &mut [WorkflowItemSummary],
) {
    if decisions.is_empty() {
        return;
    }
    for task in tasks.iter_mut() {
        let Some(candidates) = decisions.get(&task.id) else {
            continue;
        };
        // 같은 순간을 `Z`와 `+00:00`으로 달리 적을 수 있으므로 문자열이 아니라 파싱한 순간으로 비교한다.
        let mut seen = task
            .events
            .iter()
            .filter_map(|event| Some((event.kind.clone(), parse_event_instant(&event.at)?)))
            .collect::<HashSet<_>>();
        for event in candidates {
            let Some(instant) = parse_event_instant(&event.at) else {
                continue;
            };
            if seen.insert((event.kind.clone(), instant)) {
                task.events.push(event.clone());
            }
        }
        task.events
            .sort_by_key(|event| parse_event_instant(&event.at));
    }
}

fn parse_event_instant(at: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(at)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

/// 기획서 결정 문서 하나. 조회는 이 목록 하나로 기획서 상태와 아키텍트 대기 물량을 함께 만든다.
/// 두 판정 때문에 결정 디렉터리를 두 번 훑지 않는다.
struct SpecDecisionRecord {
    id: String,
    spec_id: String,
    outcome: String,
    created_at: String,
}

/// 기획서 결정 문서 하나를 읽는다. 앞의 세 값이 없으면 판정에 쓸 수 없는 문서다.
fn spec_decision_record(metadata: Option<&serde_yaml::Value>) -> Option<SpecDecisionRecord> {
    // 조건 스크립트도 `[ -n "$did" ]`로 id 없는 결정을 건너뛴다.
    let id = yaml_text(metadata, "id")?;
    let spec_id = yaml_text(metadata, "spec_id")?;
    let outcome = yaml_text(metadata, "outcome")?;
    if outcome != "approved" && outcome != "revision_requested" && outcome != "rejected" {
        return None;
    }
    Some(SpecDecisionRecord {
        id,
        spec_id,
        outcome,
        created_at: yaml_text(metadata, "created_at").unwrap_or_default(),
    })
}

/// `decisions/`를 한 번 훑어 기획서 결정 목록과 QA 이벤트를 함께 낸다(SPEC-033 R7).
///
/// 두 값이 세는 문서는 스키마로 갈리므로 한 문서가 양쪽에 들지 않고, 두 벌로 훑던 때와 같은
/// 부분집합이 나온다. 목록 순서는 디렉터리 순회 순서 그대로다 — `latest_spec_decisions`의 동률
/// 처리가 그 순서를 보므로 여기서 정렬하거나 순서를 바꾸지 않는다.
fn read_decision_documents(
    workflow_root: &Path,
) -> (Vec<SpecDecisionRecord>, HashMap<String, Vec<TaskEvent>>) {
    let mut records = Vec::new();
    let mut events: HashMap<String, Vec<TaskEvent>> = HashMap::new();
    let Ok(entries) = fs::read_dir(workflow_root.join("decisions")) else {
        return (records, events);
    };
    // 파일 이름 오름차순으로 읽는다. 조건 스크립트가 결정을 글롭 순서로 훑고, 어느 결정이 대상이
    // 되는지가 그 차례로 갈린다(SPEC-049 R1). `read_task_documents`가 같은 이유로 이미 정렬한다.
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md")
        })
        .collect();
    paths.sort();
    for path in paths {
        let Ok(contents) = fs::read_to_string(path) else {
            continue;
        };
        let normalized = contents.replace("\r\n", "\n");
        let (metadata, _) = split_frontmatter(&normalized);
        if yaml_text(metadata.as_ref(), "created_by").as_deref() != Some("user") {
            continue;
        }
        match yaml_text(metadata.as_ref(), "schema").as_deref() {
            Some("workflow-labs/decision@1") => {
                records.extend(spec_decision_record(metadata.as_ref()));
            }
            Some("workflow-labs/qa-decision@1") => {
                if let Some((task_id, event)) = qa_decision_event(metadata.as_ref()) {
                    events.entry(task_id).or_default().push(event);
                }
            }
            Some(TASK_RESUME_SCHEMA) => {
                if let Some((task_id, event)) = task_resume_event(metadata.as_ref()) {
                    events.entry(task_id).or_default().push(event);
                }
            }
            _ => {}
        }
    }
    (records, events)
}

fn read_spec_decisions(workflow_root: &Path) -> Vec<SpecDecisionRecord> {
    read_decision_documents(workflow_root).0
}

/// 기획서 결정을 기획서 항목의 이벤트로 바꾼다. 원천이 결정 문서 하나뿐이고 앱이 결정 하나당
/// 문서 하나를 쓰므로, 작업 이벤트와 달리 중복 제거가 필요 없다. 한 기획서에 결정이 여럿이면
/// 전부 남긴다. "언제 승인됐고 언제 반려됐나"가 감사 로그에 묻는 질문이다.
///
/// 이미 읽어 둔 결정 목록을 받는다. 이 목록은 스키마·`created_by: user`·`outcome` 세 값을 이미
/// 걸렀고, 결정 디렉터리를 한 번 더 훑지 않으려고 `SpecDecisionRecord`가 만들어졌다.
fn spec_decision_events(records: &[SpecDecisionRecord]) -> HashMap<String, Vec<TaskEvent>> {
    let mut events: HashMap<String, Vec<TaskEvent>> = HashMap::new();
    for record in records {
        // 시각을 읽을 수 없는 결정은 그 문서만 건너뛴다. 피드가 시간 위에 놓이는 화면이라
        // 시각 없는 항목은 놓을 자리가 없다.
        if parse_event_instant(&record.created_at).is_none() {
            continue;
        }
        events
            .entry(record.spec_id.clone())
            .or_default()
            .push(TaskEvent {
                kind: record.outcome.clone(),
                at: record.created_at.clone(),
            });
    }
    for entries in events.values_mut() {
        entries.sort_by_key(|event| parse_event_instant(&event.at));
    }
    events
}

fn latest_spec_decisions(records: &[SpecDecisionRecord]) -> HashMap<String, (String, String)> {
    let mut latest: HashMap<String, (String, String)> = HashMap::new();
    for record in records {
        let should_replace = latest
            .get(&record.spec_id)
            .is_none_or(|(current, _)| record.created_at >= *current);
        if should_replace {
            latest.insert(
                record.spec_id.clone(),
                (record.created_at.clone(), record.outcome.clone()),
            );
        }
    }
    latest
}

/// 같은 `spec_id`를 가진 다른 결정 중 `created_at` 문자열이 더 큰 것이 없는 `revision_requested`
/// 결정의 id(SPEC-018 R1).
///
/// `latest_spec_decisions`를 쓰지 않는 이유는 동률 처리다. 그쪽은 `>=`라 `created_at`이 같은 결정이
/// 둘이면 나중에 읽힌 하나만 최신으로 남는데, 디렉터리 순회 순서는 정해져 있지 않다. 조건 스크립트는
/// "더 큰 것이 있는가"만 보므로 동률을 양쪽 다 최신으로 본다. 여기서 갈라지면 두 판정이 어긋난다.
fn latest_revision_requests(records: &[SpecDecisionRecord]) -> Vec<String> {
    records
        .iter()
        .filter(|record| record.outcome == "revision_requested")
        .filter(|record| {
            !records.iter().any(|other| {
                other.spec_id == record.spec_id && other.created_at > record.created_at
            })
        })
        .map(|record| record.id.clone())
        .collect()
}

/// 같은 `spec_id`를 가진 다른 결정 중 `created_at` 문자열이 더 큰 것이 없는 `approved` 결정의
/// `(결정 id, spec_id)`(SPEC-028 R4).
///
/// 비교 어법이 [`latest_revision_requests`]와 같다. 세 역할이 서로 다른 방식으로 최신을 판정하지
/// 않는 것이 R4의 요구라, 두 함수가 같은 비교와 같은 동률 처리를 쓴다. 조건 스크립트의 `architect)`
/// 분기도 같은 모양이다.
///
/// 비교 대상이 `records`인 것은 승인만 보면 안 되기 때문이다. 승인 뒤에 온 수정 요청·반려도 그 승인을
/// 최신 자리에서 밀어낸다 — 계약 문언이 요구하는 것은 "최신 결정이 `approved`"다.
fn latest_approvals(records: &[SpecDecisionRecord]) -> Vec<(String, String)> {
    records
        .iter()
        .filter(|record| record.outcome == "approved")
        .filter(|record| {
            !records.iter().any(|other| {
                other.spec_id == record.spec_id && other.created_at > record.created_at
            })
        })
        .map(|record| (record.id.clone(), record.spec_id.clone()))
        .collect()
}

fn apply_latest_decision(workflow_root: &Path, spec: &mut WorkflowItemSummary) {
    if let Some((_, outcome)) =
        latest_spec_decisions(&read_spec_decisions(workflow_root)).get(&spec.id)
    {
        spec.status.clone_from(outcome);
    }
}

fn yaml_scalar(value: &str) -> String {
    serde_yaml::to_string(value)
        .unwrap_or_else(|_| "''\n".to_owned())
        .trim()
        .to_owned()
}

fn workflow_counts(workflow_root: &Path, items: &WorkflowItems) -> WorkflowCounts {
    WorkflowCounts {
        ideas: items.ideas.len(),
        specs: items.specs.len(),
        decisions: items
            .specs
            .iter()
            .filter(|item| item.status == "user_review")
            .count(),
        tasks: items.tasks.len(),
        reports: count_markdown_files(&workflow_root.join("reports")),
    }
}

fn count_markdown_files(directory: &Path) -> usize {
    fs::read_dir(directory)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry.path().is_file()
                        && entry.path().extension().and_then(|value| value.to_str()) == Some("md")
                })
                .count()
        })
        .unwrap_or_default()
}

pub fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut pending_separator = false;

    for character in value.trim().to_lowercase().chars() {
        if character.is_alphanumeric() {
            if pending_separator && !slug.is_empty() {
                slug.push('-');
            }
            slug.push(character);
            pending_separator = false;
        } else {
            pending_separator = true;
        }
    }

    if slug.is_empty() {
        "workflow".to_owned()
    } else {
        slug
    }
}

fn compact_uuid() -> String {
    Uuid::new_v4().simple().to_string()
}

fn workflow_readme(name: &str, id: &str) -> String {
    format!(
        r#"# {name}

워크플로우 ID: `{id}`

## 외부 LLM 작업 규약

1. 공통 규칙 `../rules/workflow.md`와 이 세션에 할당된 `../rules/roles/*.md` 하나를 읽습니다.
2. 쓰기 전에 `../.runtime/migration.lock`과 겹치는 활성 lease가 없는지 확인합니다.
3. 한 세션에서는 기획자·프로젝트 아키텍트·개발자 중 한 역할과 한 대상만 처리합니다.
4. 아이디어는 `ideas/`, 기획서는 `specs/`, 개발 작업은 `tasks/`, 결과는 `reports/`에 기록합니다.
5. 사용자 결정이 필요한 기획서는 `status: user_review`로 저장합니다.
6. `decisions/`는 앱이 승인·수정 요청·폐기를 기록하는 감사 로그입니다. 외부 LLM은 이 파일을 만들거나 덮어쓰지 않습니다.
7. 기획서의 `revision_requested`만 기획자 재작업 대상으로 삼고 `rejected`는 종료 상태로 보존합니다.
8. `todo`로 돌아온 개발 작업은 최신 `workflow-labs/qa-decision@1`의 테스트 플로우를 읽고 재작업합니다.
9. 앱 소유 상태 파일, 문서 식별자와 알 수 없는 기존 메타데이터를 보존합니다.

## 필수 frontmatter

### 기획서 (`specs/*.md`)

```yaml
schema: workflow-labs/spec@1
id: SPEC-001
title: 문서 제목
status: draft # draft | user_review
created_at: RFC3339
updated_at: RFC3339
```

본문에는 `기획 내용`, `요구사항 명세`, `기대효과` 섹션을 권장합니다.

### 개발 작업 (`tasks/*.md`)

```yaml
schema: workflow-labs/task@1
id: TASK-001
title: 작업 제목
status: todo # todo | in_progress | blocked | qa_waiting | completed
source_spec_id: SPEC-001
source_decision_id: DECISION-001
updated_at: RFC3339
due_at: YYYY-MM-DD # 선택
```

동시에 수정하면 충돌할 수 있는 작업은 병렬로 진행하지 않습니다.
"#
    )
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::SystemTime;

    use chrono::{Duration, Utc};
    use pretty_assertions::assert_eq;
    use tempfile::{tempdir, TempDir};

    use super::{
        apply_latest_decision, latest_spec_decisions, lease_ids, markdown_excerpt,
        normalize_spec_status, overlap_blocked_task_ids, parse_scope_declaration,
        read_markdown_document, read_spec_decisions, slugify, task_dependency_graph,
        update_task_frontmatter, validate_decision, validate_task_qa, walkthrough_preview,
        FileSystemProjectRepository, ProjectError, ProjectSummary, ScopeDeclaration,
    };
    use crate::domain::project::{
        CustomRuleRole, CustomRulesDraft, CustomRulesFileStatus, ManagedAssetStatus,
        ManagedAssetSyncStatus, PendingRoleWork, SaveCustomRulesRequest, SaveCustomRulesStatus,
        SchemaCompatibility, SpecDecisionOutcome, TaskDependencyState, TaskDocument, TaskQaOutcome,
        TaskResumeRequest, TaskResumeStatus, TaskRevisionRequest, TaskRevisionRequestInput,
        TaskRevisionRequestStatus, WorkflowItemSummary,
    };
    // 설치본 이름이 플랫폼마다 다르므로 경로를 자산 서술에서 받는다(SPEC-015 R1).
    use crate::infrastructure::claim_helper::claim_helper_path;
    use crate::infrastructure::heartbeat_condition::install_condition_script;
    use crate::infrastructure::heartbeat_condition::test_support::run_condition;
    use crate::infrastructure::project_write_lock::ProjectWriteLock;
    use crate::infrastructure::reservation_helper::reservation_helper_path;

    #[test]
    fn slug_is_portable_and_preserves_unicode_letters() {
        assert_eq!(slugify(" 온보딩 Redesign! "), "온보딩-redesign");
        assert_eq!(slugify("***"), "workflow");
    }

    #[test]
    fn inspect_returns_setup_state_for_plain_directory() {
        let root = tempdir().expect("temp project");
        let summary = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project");

        assert!(!summary.initialized);
        assert_eq!(summary.compatibility, SchemaCompatibility::NotInitialized);
        assert!(summary.workflows.is_empty());
    }

    #[test]
    fn creates_reloadable_workflow_layout() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;

        let created = repository
            .create_workflow(root.path(), "온보딩 개편")
            .expect("create workflow");
        let reloaded = repository.inspect(root.path()).expect("reload project");

        assert_eq!(created, reloaded);
        assert_eq!(created.workflows.len(), 1);
        let workflow_root = root
            .path()
            .join(".workflow")
            .join(&created.workflows[0].directory);
        for directory in ["ideas", "specs", "decisions", "tasks", "reports", "state"] {
            assert!(workflow_root.join(directory).is_dir());
        }
        assert!(workflow_root.join("workflow.yml").is_file());
        assert!(fs::read_to_string(workflow_root.join("README.md"))
            .expect("workflow readme")
            .contains("due_at: YYYY-MM-DD # 선택"));
        assert!(root.path().join("AGENTS.md").is_file());
        assert!(root.path().join("CLAUDE.md").is_file());
        assert!(root.path().join(".workflow/rules/workflow.md").is_file());
        assert_eq!(
            fs::read_to_string(root.path().join(".workflow/.gitignore")).expect("nested gitignore"),
            ".runtime/\n"
        );
    }

    #[test]
    fn inspect_stays_read_only_when_managed_rules_need_an_update() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let rules = root.path().join(".workflow/rules/workflow.md");
        let old = fs::read_to_string(&rules)
            .expect("rules")
            .replace("rules_version: 20", "rules_version: 19");
        fs::write(&rules, &old).expect("old rules");
        let modified = fs::metadata(&rules)
            .and_then(|metadata| metadata.modified())
            .expect("rules mtime");

        repository.inspect(root.path()).expect("first inspect");
        repository.inspect(root.path()).expect("second inspect");

        assert_eq!(fs::read_to_string(&rules).expect("unchanged rules"), old);
        assert_eq!(
            fs::metadata(&rules)
                .and_then(|metadata| metadata.modified())
                .expect("unchanged mtime"),
            modified
        );
    }

    #[test]
    fn the_separate_sync_entrypoint_updates_assets() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let rules = root.path().join(".workflow/rules/workflow.md");
        let old = fs::read_to_string(&rules)
            .expect("rules")
            .replace("rules_version: 20", "rules_version: 19");
        fs::write(&rules, old).expect("old rules");

        let result = repository
            .synchronize_managed_assets(root.path())
            .expect("sync");

        assert_eq!(result.status, ManagedAssetSyncStatus::Updated);
        assert!(result.updated_assets.contains(&"workflow_rules".to_owned()));
        assert!(fs::read_to_string(rules)
            .expect("updated rules")
            .contains("rules_version: 20"));
    }

    #[test]
    fn custom_rules_round_trip_through_the_repository_contract() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");

        let initial = repository
            .read_custom_rules(root.path())
            .expect("read absent custom rules");
        assert_eq!(initial.status, CustomRulesFileStatus::Absent);

        let preview = repository
            .prepare_custom_rules_preview(
                root.path(),
                CustomRulesDraft {
                    enabled: true,
                    applies_to: vec![CustomRuleRole::Developer],
                    body: "개발 보고서에 검증 결과를 적는다.".to_owned(),
                },
            )
            .expect("prepare preview");
        let saved = repository
            .save_custom_rules(
                root.path(),
                SaveCustomRulesRequest {
                    expected_content_hash: initial.content_hash,
                    draft: preview.draft.clone(),
                    updated_at: preview.updated_at.clone(),
                    preview_hash: preview.preview_hash.clone(),
                },
            )
            .expect("save custom rules");

        assert_eq!(saved.status, SaveCustomRulesStatus::Saved);
        assert_eq!(saved.document.status, CustomRulesFileStatus::Valid);
        assert_eq!(
            saved.document.raw.as_deref(),
            Some(preview.serialized.as_str())
        );
        assert_eq!(
            fs::read_to_string(root.path().join(".workflow/rules/custom.md"))
                .expect("saved custom rules"),
            preview.serialized
        );
        assert_eq!(
            repository
                .read_custom_rules(root.path())
                .expect("read saved custom rules"),
            saved.document
        );
    }

    #[test]
    fn malformed_custom_rules_do_not_block_inspection_or_managed_asset_sync() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let custom = root.path().join(".workflow/rules/custom.md");
        let invalid = b"---\nschema: workflow-labs/custom-rules@1\nenabled: true\napplies_to: [unknown]\nupdated_at: nope\n---\n\nkeep exactly\n";
        fs::write(&custom, invalid).expect("write malformed custom rules");
        let modified = fs::metadata(&custom)
            .and_then(|metadata| metadata.modified())
            .expect("custom rules mtime");
        let rules = root.path().join(".workflow/rules/workflow.md");
        let old_rules = fs::read_to_string(&rules)
            .expect("rules")
            .replace("rules_version: 20", "rules_version: 19");
        fs::write(&rules, old_rules).expect("old managed rules");

        repository.inspect(root.path()).expect("inspect project");
        let result = repository
            .synchronize_managed_assets(root.path())
            .expect("sync managed rules");

        assert_eq!(result.status, ManagedAssetSyncStatus::Updated);
        assert!(!result.updated_assets.iter().any(|id| id == "custom_rules"));
        assert_eq!(fs::read(&custom).expect("custom rules unchanged"), invalid);
        assert_eq!(
            fs::metadata(&custom)
                .and_then(|metadata| metadata.modified())
                .expect("custom rules mtime unchanged"),
            modified
        );
        assert_eq!(
            repository
                .read_custom_rules(root.path())
                .expect("read malformed custom rules")
                .status,
            CustomRulesFileStatus::Invalid
        );
    }

    #[test]
    fn the_sync_entrypoint_returns_non_utf8_as_a_structured_conflict() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let rules = root.path().join(".workflow/rules/workflow.md");
        fs::write(&rules, [0xff, 0xfe, 0xfd]).expect("non UTF-8 rules");

        let result = repository
            .synchronize_managed_assets(root.path())
            .expect("non UTF-8 must be a structured result");

        assert_eq!(result.status, ManagedAssetSyncStatus::Conflict);
        assert_eq!(result.affected_asset.as_deref(), Some("workflow_rules"));
        assert!(result
            .assets
            .iter()
            .any(|asset| asset.id == "workflow_rules"
                && asset.status == ManagedAssetStatus::Conflict
                && asset
                    .reason
                    .as_deref()
                    .is_some_and(|reason| reason.contains("UTF-8"))));
        assert_eq!(
            fs::read(rules).expect("damaged bytes kept"),
            [0xff, 0xfe, 0xfd]
        );
    }

    #[test]
    fn a_sync_lock_conflict_is_retryable_and_does_not_block_inspection() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let control = root.path().join(".workflow");
        let _lock = ProjectWriteLock::acquire(&control).expect("shared write lock");

        let result = repository
            .synchronize_managed_assets(root.path())
            .expect("retry result");
        let inspected = repository
            .inspect(root.path())
            .expect("inspection remains available");

        assert_eq!(result.status, ManagedAssetSyncStatus::RetryRequired);
        assert!(inspected.initialized);
    }

    #[test]
    fn reports_only_non_expired_agent_leases() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let leases = root.path().join(".workflow/.runtime/leases");
        let active_expiry = (Utc::now() + Duration::minutes(5)).to_rfc3339();
        let expired = (Utc::now() - Duration::minutes(5)).to_rfc3339();
        fs::write(
            leases.join("active.yml"),
            format!(
                "schema_version: 1\nlease_id: active\nagent: codex\ntask_id: TASK-1\nheartbeat_at: {active_expiry}\nexpires_at: {active_expiry}\n"
            ),
        )
        .expect("active lease");
        fs::write(
            leases.join("expired.yml"),
            format!(
                "schema_version: 1\nlease_id: expired\nagent: codex\ntask_id: null\nheartbeat_at: {expired}\nexpires_at: {expired}\n"
            ),
        )
        .expect("expired lease");

        let summary = repository.inspect(root.path()).expect("inspect leases");
        assert_eq!(summary.active_leases.len(), 1);
        assert_eq!(summary.active_leases[0].lease_id, "active");
    }

    fn write_lease(root: &Path, file_name: &str, contents: &str) {
        fs::write(
            root.join(".workflow/.runtime/leases").join(file_name),
            contents,
        )
        .expect("write lease");
    }

    #[test]
    fn carries_the_lease_role_and_heartbeat_without_rewriting_them() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        // 만료 오름차순 정렬에 기대어 순서를 고정한다.
        let legacy_expiry = (Utc::now() + Duration::minutes(5)).to_rfc3339();
        let role_expiry = (Utc::now() + Duration::minutes(6)).to_rfc3339();
        let blank_expiry = (Utc::now() + Duration::minutes(7)).to_rfc3339();
        write_lease(
            root.path(),
            "legacy.yml",
            &format!(
                "schema_version: 1\nlease_id: legacy\nagent: codex\ntask_id: TASK-1\nheartbeat_at: 2026-08-03T00:41:00+00:00\nexpires_at: {legacy_expiry}\n"
            ),
        );
        write_lease(
            root.path(),
            "with-role.yml",
            &format!(
                "schema_version: 1\nlease_id: with-role\nagent: codex\nrole: architect\ntask_id: SPEC-1\nheartbeat_at: 2026-08-03T00:42:00Z\nexpires_at: {role_expiry}\n"
            ),
        );
        write_lease(
            root.path(),
            "blank-role.yml",
            &format!(
                "schema_version: 1\nlease_id: blank-role\nagent: codex\nrole: \"   \"\ntask_id: null\nheartbeat_at: 2026-08-03T00:43:00Z\nexpires_at: {blank_expiry}\n"
            ),
        );

        let summary = repository.inspect(root.path()).expect("inspect leases");

        // 계약에 없던 필드라 `role` 키가 없는 기존 lease가 목록에서 사라지면 안 된다.
        assert_eq!(
            summary
                .active_leases
                .iter()
                .map(|lease| (lease.lease_id.as_str(), lease.role.as_deref()))
                .collect::<Vec<_>>(),
            vec![
                ("legacy", None),
                ("with-role", Some("architect")),
                ("blank-role", None),
            ]
        );
        // 원문 그대로다. `+00:00`이 `Z`로 바뀌지 않는다.
        assert_eq!(
            summary.active_leases[0].heartbeat_at,
            "2026-08-03T00:41:00+00:00"
        );
    }

    #[test]
    fn reports_the_readable_leases_when_one_file_is_broken() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let expiry = (Utc::now() + Duration::minutes(5)).to_rfc3339();
        write_lease(
            root.path(),
            "healthy.yml",
            &format!(
                "schema_version: 1\nlease_id: healthy\nagent: codex\nrole: developer\ntask_id: TASK-1\nheartbeat_at: 2026-08-03T00:41:00Z\nexpires_at: {expiry}\n"
            ),
        );
        write_lease(root.path(), "broken.yml", "이것은: [YAML이: 아니다\n");

        let summary = repository.inspect(root.path()).expect("inspect leases");

        assert_eq!(summary.active_leases.len(), 1);
        assert_eq!(summary.active_leases[0].lease_id, "healthy");
        assert_eq!(summary.active_leases[0].role.as_deref(), Some("developer"));
    }

    #[test]
    fn creates_markdown_idea_and_updates_counts() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let workflow = &project.workflows[0];

        let updated = repository
            .create_idea(root.path(), &workflow.directory, "빠르게 생각을 기록한다.")
            .expect("create idea");

        assert_eq!(updated.workflows[0].counts.ideas, 1);
        assert_eq!(
            updated.workflows[0].items.ideas[0].title,
            "빠르게 생각을 기록한다."
        );
        let ideas_root = root
            .path()
            .join(".workflow")
            .join(&workflow.directory)
            .join("ideas");
        let idea_path = fs::read_dir(ideas_root)
            .expect("ideas directory")
            .next()
            .expect("idea entry")
            .expect("idea file")
            .path();
        let contents = fs::read_to_string(idea_path).expect("idea markdown");
        assert!(contents.contains("schema: workflow-labs/idea@1"));
        assert!(contents.contains("빠르게 생각을 기록한다."));
    }

    fn write_idea_document(root: &Path, directory: &str, id: &str, status: &str) {
        fs::write(
            root.join(".workflow")
                .join(directory)
                .join("ideas")
                .join(format!("{id}.md")),
            format!(
                "---\nschema: workflow-labs/idea@1\nid: {id}\ntitle: {id} 아이디어\nstatus: {status}\ncreated_at: 2026-08-01T00:00:00Z\n---\n\n본문이다.\n"
            ),
        )
        .expect("write idea");
    }

    fn write_spec_for_idea(
        root: &Path,
        directory: &str,
        spec_id: &str,
        idea_id: &str,
        status: &str,
    ) {
        fs::write(
            root.join(".workflow")
                .join(directory)
                .join("specs")
                .join(format!("{spec_id}.md")),
            format!(
                "---\nschema: workflow-labs/spec@1\nid: {spec_id}\ntitle: {spec_id} 기획서\nstatus: {status}\nsource_idea_id: {idea_id}\ncreated_at: 2026-08-01T00:00:00Z\nupdated_at: 2026-08-01T00:00:00Z\n---\n\n기획 내용이다.\n"
            ),
        )
        .expect("write spec for idea");
    }

    fn write_idea_lease(root: &Path, file_name: &str, task_id: &str, minutes_from_now: i64) {
        let expiry = (Utc::now() + Duration::minutes(minutes_from_now)).to_rfc3339();
        write_lease(
            root,
            file_name,
            &format!(
                "schema_version: 1\nlease_id: {file_name}\nagent: codex\ntask_id: {task_id}\nheartbeat_at: {expiry}\nexpires_at: {expiry}\n"
            ),
        );
    }

    /// 아이디어 항목의 파생 상태와 중단 의심 근거.
    fn idea_state(project: &ProjectSummary, workflow: usize, id: &str) -> (String, Vec<String>) {
        let idea = project.workflows[workflow]
            .items
            .ideas
            .iter()
            .find(|item| item.id == id)
            .expect("idea summary");
        (idea.status.clone(), idea.stalled_spec_ids.clone())
    }

    #[test]
    fn treats_an_unreferenced_idea_without_a_lease_as_collected() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        // 파일에 적힌 상태가 무엇이든 판정이 값을 정한다. 그러지 않으면 `status: adopted`라고
        // 적힌 파일이 참조 없이도 채택으로 보인다.
        write_idea_document(root.path(), directory, "IDEA-001", "adopted");

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("inbox".to_owned(), Vec::new())
        );
    }

    #[test]
    fn treats_an_idea_with_a_draft_spec_as_drafting_and_names_the_stalled_spec() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_spec_for_idea(root.path(), directory, "SPEC-001", "IDEA-001", "draft");

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("drafting".to_owned(), vec!["SPEC-001".to_owned()])
        );
    }

    #[test]
    fn treats_a_preempted_idea_without_specs_as_drafting_without_a_stalled_spec() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_idea_lease(root.path(), "IDEA-001.yml", "IDEA-001", 5);

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("drafting".to_owned(), Vec::new())
        );
    }

    #[test]
    fn treats_an_idea_with_a_reviewed_spec_as_adopted() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_spec_for_idea(
            root.path(),
            directory,
            "SPEC-001",
            "IDEA-001",
            "user_review",
        );

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("adopted".to_owned(), Vec::new())
        );
    }

    // 결정을 받은 기획서는 셋 중 어느 결과든 `draft`가 아니다. 그중 `rejected`만 갈 곳이 없으므로
    // 종결이고, 나머지 둘은 채택이다(SPEC-018 R6). 수정 요청은 기획자 재작업 대기라 종결의 반대편이다.
    #[test]
    fn derives_the_idea_state_from_the_latest_decision_outcome() {
        for (outcome, expected) in [
            ("approved", "adopted"),
            ("revision_requested", "adopted"),
            ("rejected", "closed"),
        ] {
            let root = tempdir().expect("temp project");
            let repository = FileSystemProjectRepository;
            let project = repository
                .create_workflow(root.path(), "Feature")
                .expect("create workflow");
            let directory = &project.workflows[0].directory;
            write_idea_document(root.path(), directory, "IDEA-001", "inbox");
            write_spec_for_idea(root.path(), directory, "SPEC-001", "IDEA-001", "draft");
            write_decision(
                root.path(),
                directory,
                "DECISION-001.md",
                &spec_decision("DECISION-001", "SPEC-001", outcome, "2026-08-02T00:00:00Z"),
            );

            let inspected = repository.inspect(root.path()).expect("inspect");

            assert_eq!(
                idea_state(&inspected, 0, "IDEA-001"),
                (expected.to_owned(), Vec::new()),
                "결정 결과 {outcome}"
            );
        }
    }

    // 참조 기획서가 여럿이어도 전부 반려로 끝나야 종결이다.
    #[test]
    fn treats_an_idea_as_closed_when_every_referenced_spec_ended_rejected() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        for (spec_id, decision_id) in [("SPEC-001", "DECISION-001"), ("SPEC-002", "DECISION-002")] {
            write_spec_for_idea(root.path(), directory, spec_id, "IDEA-001", "user_review");
            write_decision(
                root.path(),
                directory,
                &format!("{decision_id}.md"),
                &spec_decision(decision_id, spec_id, "rejected", "2026-08-02T00:00:00Z"),
            );
        }

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("closed".to_owned(), Vec::new())
        );
    }

    // 살아 있는 기획서가 하나라도 있으면 종결이 아니다. 승인이든 아직 결정을 기다리는 검토든 같다.
    #[test]
    fn keeps_an_idea_adopted_when_a_live_spec_sits_next_to_a_rejected_one() {
        for live_outcome in [Some("approved"), None] {
            let root = tempdir().expect("temp project");
            let repository = FileSystemProjectRepository;
            let project = repository
                .create_workflow(root.path(), "Feature")
                .expect("create workflow");
            let directory = &project.workflows[0].directory;
            write_idea_document(root.path(), directory, "IDEA-001", "inbox");
            write_spec_for_idea(
                root.path(),
                directory,
                "SPEC-001",
                "IDEA-001",
                "user_review",
            );
            write_decision(
                root.path(),
                directory,
                "DECISION-001.md",
                &spec_decision(
                    "DECISION-001",
                    "SPEC-001",
                    "rejected",
                    "2026-08-02T00:00:00Z",
                ),
            );
            write_spec_for_idea(
                root.path(),
                directory,
                "SPEC-002",
                "IDEA-001",
                "user_review",
            );
            if let Some(outcome) = live_outcome {
                write_decision(
                    root.path(),
                    directory,
                    "DECISION-002.md",
                    &spec_decision("DECISION-002", "SPEC-002", outcome, "2026-08-02T00:00:00Z"),
                );
            }

            let inspected = repository.inspect(root.path()).expect("inspect");

            assert_eq!(
                idea_state(&inspected, 0, "IDEA-001"),
                ("adopted".to_owned(), Vec::new()),
                "살아 있는 기획서의 결정 {live_outcome:?}"
            );
        }
    }

    // 아직 쓰는 중인 기획서가 있으면 종결보다 반영중이 이긴다.
    #[test]
    fn prefers_drafting_when_a_draft_and_a_rejected_spec_share_an_idea() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_spec_for_idea(
            root.path(),
            directory,
            "SPEC-001",
            "IDEA-001",
            "user_review",
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-001.md",
            &spec_decision(
                "DECISION-001",
                "SPEC-001",
                "rejected",
                "2026-08-02T00:00:00Z",
            ),
        );
        write_spec_for_idea(root.path(), directory, "SPEC-002", "IDEA-001", "draft");

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("drafting".to_owned(), vec!["SPEC-002".to_owned()])
        );
    }

    // 선점도 종결보다 앞선다. 누군가 그 아이디어를 지금 쥐고 있으면 끝난 것이 아니다.
    #[test]
    fn prefers_drafting_when_a_lease_preempts_an_otherwise_closed_idea() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_spec_for_idea(
            root.path(),
            directory,
            "SPEC-001",
            "IDEA-001",
            "user_review",
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-001.md",
            &spec_decision(
                "DECISION-001",
                "SPEC-001",
                "rejected",
                "2026-08-02T00:00:00Z",
            ),
        );
        write_idea_lease(root.path(), "IDEA-001.yml", "IDEA-001", 5);

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("drafting".to_owned(), Vec::new())
        );
    }

    // 반려 판정은 최신 결정 하나만 본다. 뒤에 다른 결정이 붙으면 반려로 끝난 것이 아니다.
    #[test]
    fn does_not_close_an_idea_whose_rejection_was_superseded() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_spec_for_idea(
            root.path(),
            directory,
            "SPEC-001",
            "IDEA-001",
            "user_review",
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-001.md",
            &spec_decision(
                "DECISION-001",
                "SPEC-001",
                "rejected",
                "2026-08-02T00:00:00Z",
            ),
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-002.md",
            &spec_decision(
                "DECISION-002",
                "SPEC-001",
                "approved",
                "2026-08-03T00:00:00Z",
            ),
        );

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("adopted".to_owned(), Vec::new())
        );
    }

    /// 종결 표시가 아이디어를 처리 대상으로 되돌리지 않는다(기획서 완료 조건 20). 조건 스크립트를
    /// 고치지 않고도 성립하는 것이 요점이라, `role_eligibility.rs`와 같은 대조를 여기서 한 번 더 한다.
    /// 그 파일의 대조 헬퍼는 자기 테스트 모듈 안에 있어 다른 모듈에서 부를 수 없다.
    #[test]
    fn a_closed_idea_is_not_planner_work_in_either_judgement() {
        use std::process::Command;

        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_spec_for_idea(
            root.path(),
            directory,
            "SPEC-001",
            "IDEA-001",
            "user_review",
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-001.md",
            &spec_decision(
                "DECISION-001",
                "SPEC-001",
                "rejected",
                "2026-08-02T00:00:00Z",
            ),
        );
        install_condition_script(&root.path().join(".workflow")).expect("install condition script");

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(idea_state(&inspected, 0, "IDEA-001").0, "closed");
        assert!(!inspected.pending_work.planner);
        for (role, app_flag) in [
            ("planner", inspected.pending_work.planner),
            ("architect", inspected.pending_work.architect),
            ("developer", inspected.pending_work.developer),
        ] {
            let code = Command::new("sh")
                .arg(".workflow/rules/wf-eligible.sh")
                .arg(role)
                .current_dir(root.path())
                .status()
                .expect("run condition script")
                .code()
                .expect("exit code");
            assert_eq!(app_flag, code == 0, "{role} 판정이 조건 스크립트와 다르다");
        }
    }

    #[test]
    fn prefers_drafting_when_a_draft_and_a_reviewed_spec_share_an_idea() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_spec_for_idea(
            root.path(),
            directory,
            "SPEC-001",
            "IDEA-001",
            "user_review",
        );
        write_spec_for_idea(root.path(), directory, "SPEC-002", "IDEA-001", "draft");

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("drafting".to_owned(), vec!["SPEC-002".to_owned()])
        );
    }

    #[test]
    fn lists_every_stalled_draft_spec_in_document_id_order() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_spec_for_idea(root.path(), directory, "SPEC-050", "IDEA-001", "draft");
        write_spec_for_idea(root.path(), directory, "SPEC-004", "IDEA-001", "draft");

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            (
                "drafting".to_owned(),
                vec!["SPEC-004".to_owned(), "SPEC-050".to_owned()]
            )
        );
    }

    #[test]
    fn ignores_expired_leases_when_deriving_idea_states() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_idea_lease(root.path(), "IDEA-001.yml", "IDEA-001", -5);

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("inbox".to_owned(), Vec::new())
        );
    }

    #[test]
    fn ignores_leases_without_a_task_id_when_deriving_idea_states() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_idea_lease(root.path(), "anonymous.yml", "null", 5);

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("inbox".to_owned(), Vec::new())
        );
    }

    // 기획자가 기획서 id로 선점하면 아이디어를 선점한 것이 아니다. 그 기획서가 결정까지 받았다면
    // 아이디어는 채택이고, lease가 그 판정을 되돌리지 않는다.
    #[test]
    fn keeps_an_idea_adopted_when_the_lease_points_at_its_spec() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_spec_for_idea(root.path(), directory, "SPEC-001", "IDEA-001", "draft");
        write_decision(
            root.path(),
            directory,
            "DECISION-001.md",
            &spec_decision(
                "DECISION-001",
                "SPEC-001",
                "approved",
                "2026-08-02T00:00:00Z",
            ),
        );
        write_idea_lease(root.path(), "SPEC-001.yml", "SPEC-001", 5);

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("adopted".to_owned(), Vec::new())
        );
    }

    // lease는 프로젝트 전역이라 워크플로우를 가리지 않지만, 기획서 참조는 자기 워크플로우 안에서만
    // 본다.
    #[test]
    fn keeps_idea_derivation_inside_its_workflow() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let project = repository
            .create_workflow(root.path(), "Other")
            .expect("create second workflow");
        let first = project.workflows[0].directory.clone();
        let second = project.workflows[1].directory.clone();
        write_idea_document(root.path(), &first, "IDEA-001", "inbox");
        write_idea_document(root.path(), &second, "IDEA-002", "inbox");
        write_spec_for_idea(root.path(), &first, "SPEC-001", "IDEA-002", "draft");

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("inbox".to_owned(), Vec::new())
        );
        assert_eq!(
            idea_state(&inspected, 1, "IDEA-002"),
            ("inbox".to_owned(), Vec::new())
        );
    }

    // 목록과 전문 읽기가 갈리면 같은 아이디어가 화면 두 곳에서 다르게 보인다.
    #[test]
    fn reports_the_same_idea_state_from_the_list_and_the_full_read() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        write_idea_document(root.path(), &directory, "IDEA-001", "inbox");
        write_idea_document(root.path(), &directory, "IDEA-002", "inbox");
        write_idea_document(root.path(), &directory, "IDEA-003", "inbox");
        write_idea_document(root.path(), &directory, "IDEA-004", "inbox");
        write_spec_for_idea(root.path(), &directory, "SPEC-002", "IDEA-002", "draft");
        write_spec_for_idea(
            root.path(),
            &directory,
            "SPEC-003",
            "IDEA-003",
            "user_review",
        );
        write_spec_for_idea(
            root.path(),
            &directory,
            "SPEC-004",
            "IDEA-004",
            "user_review",
        );
        write_decision(
            root.path(),
            &directory,
            "DECISION-004.md",
            &spec_decision(
                "DECISION-004",
                "SPEC-004",
                "rejected",
                "2026-08-02T00:00:00Z",
            ),
        );

        let inspected = repository.inspect(root.path()).expect("inspect");

        for id in ["IDEA-001", "IDEA-002", "IDEA-003", "IDEA-004"] {
            let document = repository
                .read_idea(root.path(), &directory, &format!("{id}.md"))
                .expect("read idea");
            assert_eq!(
                (
                    document.summary.status.clone(),
                    document.summary.stalled_spec_ids.clone()
                ),
                idea_state(&inspected, 0, id),
                "{id}의 목록과 전문이 갈렸다"
            );
        }
        assert_eq!(idea_state(&inspected, 0, "IDEA-001").0, "inbox");
        assert_eq!(idea_state(&inspected, 0, "IDEA-002").0, "drafting");
        assert_eq!(idea_state(&inspected, 0, "IDEA-003").0, "adopted");
        assert_eq!(idea_state(&inspected, 0, "IDEA-004").0, "closed");
    }

    // 판정은 읽기이고 파생이다. 아이디어 문서의 `status`는 파일에서 그대로 남는다.
    #[test]
    fn deriving_idea_states_does_not_touch_the_workflow_files() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        write_idea_document(root.path(), &directory, "IDEA-001", "inbox");
        write_spec_for_idea(root.path(), &directory, "SPEC-001", "IDEA-001", "draft");
        write_idea_lease(root.path(), "IDEA-002.yml", "IDEA-002", 5);
        let control_root = root.path().join(".workflow");
        let before = file_snapshot(&control_root);

        repository.inspect(root.path()).expect("inspect");
        repository
            .read_idea(root.path(), &directory, "IDEA-001.md")
            .expect("read idea");

        assert_eq!(file_snapshot(&control_root), before);
        assert!(fs::read_to_string(
            control_root
                .join(&directory)
                .join("ideas")
                .join("IDEA-001.md")
        )
        .expect("idea after read")
        .contains("status: inbox"));
    }

    #[test]
    fn lists_ideas_when_the_lease_directory_is_missing() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        write_idea_document(root.path(), &directory, "IDEA-001", "inbox");
        fs::remove_dir_all(root.path().join(".workflow/.runtime/leases")).expect("drop leases");

        let inspected = repository.inspect(root.path()).expect("inspect");

        assert_eq!(
            idea_state(&inspected, 0, "IDEA-001"),
            ("inbox".to_owned(), Vec::new())
        );
        let document = repository
            .read_idea(root.path(), &directory, "IDEA-001.md")
            .expect("read idea without lease directory");
        assert_eq!(document.summary.status, "inbox");
    }

    // 세션이 죽으면 lease는 만료되지만 draft 스켈레톤은 남는다. 그 순간부터 중단 의심이다.
    // 파일을 두 번 쓰는 것으로 시각 경과를 대신한다 — 실제로 기다리면 테스트가 느려진다.
    #[test]
    fn fills_the_stalled_spec_when_the_lease_expires() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        write_idea_document(root.path(), &directory, "IDEA-001", "inbox");
        write_spec_for_idea(root.path(), &directory, "SPEC-001", "IDEA-001", "draft");
        write_idea_lease(root.path(), "IDEA-001.yml", "IDEA-001", 5);

        let while_active = repository
            .inspect(root.path())
            .expect("inspect while active");
        write_idea_lease(root.path(), "IDEA-001.yml", "IDEA-001", -5);
        let after_expiry = repository
            .inspect(root.path())
            .expect("inspect after expiry");

        assert_eq!(
            idea_state(&while_active, 0, "IDEA-001"),
            ("drafting".to_owned(), Vec::new())
        );
        assert_eq!(
            idea_state(&after_expiry, 0, "IDEA-001"),
            ("drafting".to_owned(), vec!["SPEC-001".to_owned()])
        );
    }

    #[test]
    fn reads_optional_task_due_date() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let task_path = root
            .path()
            .join(".workflow")
            .join(&project.workflows[0].directory)
            .join("tasks/TASK-001.md");
        fs::write(
            task_path,
            "---\nschema: workflow-labs/task@1\nid: TASK-001\ntitle: 일정 작업\nstatus: todo\nupdated_at: 2026-07-30T00:00:00Z\ndue_at: 2026-08-07\n---\n\n목표일이 있는 작업\n",
        )
        .expect("write task");

        let inspected = repository.inspect(root.path()).expect("inspect task");
        assert_eq!(
            inspected.workflows[0].items.tasks[0].due_at.as_deref(),
            Some("2026-08-07")
        );
    }

    #[test]
    fn reads_the_source_decision_of_a_task_and_leaves_it_empty_elsewhere() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        repository
            .create_idea(root.path(), &directory, "출처가 없는 아이디어")
            .expect("create idea");
        fs::write(
            root.path()
                .join(".workflow")
                .join(&directory)
                .join("specs/SPEC-001.md"),
            "---\nschema: workflow-labs/spec@1\nid: SPEC-001\ntitle: 기획서\nstatus: user_review\ncreated_at: 2026-07-30T00:00:00Z\nupdated_at: 2026-07-30T00:00:00Z\n---\n\n# 기획서\n",
        )
        .expect("write spec");

        let inspected = write_task_with_frontmatter(
            root.path(),
            &directory,
            "source_spec_id: SPEC-001\nsource_decision_id: DECISION-001\n",
        );

        let workflow = &inspected.workflows[0];
        assert_eq!(
            workflow.items.tasks[0].source_decision_id.as_deref(),
            Some("DECISION-001")
        );
        assert_eq!(workflow.items.ideas[0].source_decision_id, None);
        assert_eq!(workflow.items.specs[0].source_decision_id, None);
        assert_eq!(
            workflow.items.tasks[0].source_spec_id.as_deref(),
            Some("SPEC-001")
        );
        assert_eq!(workflow.items.ideas[0].source_spec_id, None);
        assert_eq!(workflow.items.specs[0].source_spec_id, None);
    }

    fn write_task_with_frontmatter(root: &Path, directory: &str, extra: &str) -> ProjectSummary {
        fs::write(
            root.join(".workflow")
                .join(directory)
                .join("tasks/TASK-001.md"),
            format!(
                "---\nschema: workflow-labs/task@1\nid: TASK-001\ntitle: 이력 작업\nstatus: qa_waiting\nupdated_at: 2026-07-30T00:00:00Z\n{extra}---\n\n전이 이력이 있는 작업\n"
            ),
        )
        .expect("write task");
        FileSystemProjectRepository
            .inspect(root)
            .expect("inspect task")
    }

    #[test]
    fn reads_task_history_in_chronological_order() {
        let root = tempdir().expect("temp project");
        let project = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");

        let inspected = write_task_with_frontmatter(
            root.path(),
            &project.workflows[0].directory,
            "history:\n  - { at: 2026-07-30T14:00:00Z, kind: qa_waiting }\n  - { at: 2026-07-30T09:00:00Z, kind: created }\n  - { at: 2026-07-30T10:30:00Z, kind: in_progress }\n",
        );

        let events = &inspected.workflows[0].items.tasks[0].events;
        assert_eq!(
            events
                .iter()
                .map(|event| (event.kind.as_str(), event.at.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("created", "2026-07-30T09:00:00Z"),
                ("in_progress", "2026-07-30T10:30:00Z"),
                ("qa_waiting", "2026-07-30T14:00:00Z"),
            ]
        );
    }

    #[test]
    fn reads_block_style_history_and_keeps_the_recorded_offset() {
        let root = tempdir().expect("temp project");
        let project = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");

        let inspected = write_task_with_frontmatter(
            root.path(),
            &project.workflows[0].directory,
            "history:\n  - at: 2026-07-30T09:00:00+00:00\n    kind: created\n",
        );

        let events = &inspected.workflows[0].items.tasks[0].events;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "created");
        assert_eq!(events[0].at, "2026-07-30T09:00:00+00:00");
    }

    #[test]
    fn treats_a_task_without_history_as_having_no_events() {
        let root = tempdir().expect("temp project");
        let project = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");

        let inspected = write_task_with_frontmatter(
            root.path(),
            &project.workflows[0].directory,
            "owner: 나\n",
        );

        let task = &inspected.workflows[0].items.tasks[0];
        assert!(task.events.is_empty());
        assert_eq!(task.id, "TASK-001");
        assert_eq!(task.title, "이력 작업");
        assert_eq!(task.status, "qa_waiting");
        assert_eq!(task.updated_at.as_deref(), Some("2026-07-30T00:00:00Z"));
    }

    #[test]
    fn drops_only_the_damaged_history_entries() {
        let root = tempdir().expect("temp project");
        let project = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");

        let inspected = write_task_with_frontmatter(
            root.path(),
            &project.workflows[0].directory,
            "history:\n  - { at: 2026-07-30T09:00:00Z, kind: created }\n  - { kind: in_progress }\n  - { at: 어제, kind: blocked }\n  - { at: 2026-07-30T11:00:00Z, kind: 시작 }\n  - 문자열 항목\n  - { at: 2026-07-30T14:00:00Z, kind: qa_waiting }\n",
        );

        let events = &inspected.workflows[0].items.tasks[0].events;
        assert_eq!(
            events
                .iter()
                .map(|event| event.kind.as_str())
                .collect::<Vec<_>>(),
            vec!["created", "qa_waiting"]
        );
    }

    #[test]
    fn treats_a_non_sequence_history_as_empty_without_failing_the_read() {
        let root = tempdir().expect("temp project");
        let project = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");

        let inspected = write_task_with_frontmatter(
            root.path(),
            &project.workflows[0].directory,
            "history: 아직 없음\n",
        );
        assert!(inspected.workflows[0].items.tasks[0].events.is_empty());

        let inspected = write_task_with_frontmatter(
            root.path(),
            &project.workflows[0].directory,
            "history:\n  created: 2026-07-30T09:00:00Z\n",
        );
        let task = &inspected.workflows[0].items.tasks[0];
        assert!(task.events.is_empty());
        assert_eq!(task.id, "TASK-001");
    }

    #[test]
    fn keeps_repeated_transitions_after_qa_rework() {
        let root = tempdir().expect("temp project");
        let project = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");

        let inspected = write_task_with_frontmatter(
            root.path(),
            &project.workflows[0].directory,
            "history:\n  - { at: 2026-07-30T10:00:00Z, kind: in_progress }\n  - { at: 2026-07-30T12:00:00Z, kind: qa_waiting }\n  - { at: 2026-07-30T15:00:00Z, kind: revision_requested }\n  - { at: 2026-07-31T09:00:00Z, kind: in_progress }\n  - { at: 2026-07-31T11:00:00Z, kind: qa_waiting }\n",
        );

        let events = &inspected.workflows[0].items.tasks[0].events;
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == "qa_waiting")
                .map(|event| event.at.as_str())
                .collect::<Vec<_>>(),
            vec!["2026-07-30T12:00:00Z", "2026-07-31T11:00:00Z"]
        );
    }

    #[test]
    fn reads_task_detail_and_records_user_qa_outcomes() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let workflow = &project.workflows[0];
        let tasks = root
            .path()
            .join(".workflow")
            .join(&workflow.directory)
            .join("tasks");
        let confirmed_path = tasks.join("TASK-CONFIRMED.md");
        fs::write(
            &confirmed_path,
            "---\nschema: workflow-labs/task@1\nid: TASK-CONFIRMED\ntitle: 사용자 확인\nstatus: qa_waiting\ncustom_field: keep-me\nupdated_at: 2026-07-31T00:00:00Z\n---\n\n# 사용자 확인\n\n## 테스트\n\n실제 동작을 확인한다.\n",
        )
        .expect("confirmed task");
        let revision_path = tasks.join("TASK-REVISION.md");
        fs::write(
            &revision_path,
            "---\nschema: workflow-labs/task@1\nid: TASK-REVISION\ntitle: 재작업 요청\nstatus: qa_waiting\nupdated_at: 2026-07-31T00:00:00Z\n---\n\n# 재작업 요청\n",
        )
        .expect("revision task");

        let detail = repository
            .read_task(root.path(), &workflow.directory, "TASK-CONFIRMED.md")
            .expect("read task");
        assert!(detail.body.contains("실제 동작을 확인한다."));
        let architect = root.path().join(".workflow/rules/roles/architect.md");
        let old_architect = fs::read_to_string(&architect)
            .expect("architect")
            .replace("rules_version: 13", "rules_version: 12");
        fs::write(&architect, old_architect).expect("old architect");

        let confirmed = repository
            .record_task_qa(
                root.path(),
                &workflow.directory,
                "TASK-CONFIRMED.md",
                TaskQaOutcome::Confirmed,
                "앱 실행 → 정상 표시 확인",
            )
            .expect("confirm task");
        assert_eq!(
            confirmed.workflows[0]
                .items
                .tasks
                .iter()
                .find(|item| item.id == "TASK-CONFIRMED")
                .expect("confirmed summary")
                .status,
            "completed"
        );
        assert!(fs::read_to_string(architect)
            .expect("architect updated on QA")
            .contains("rules_version: 13"));
        let confirmed_source = fs::read_to_string(&confirmed_path).expect("confirmed source");
        assert!(confirmed_source.contains("status: completed"));
        assert!(confirmed_source.contains("custom_field: keep-me"));
        assert!(confirmed_source.contains("실제 동작을 확인한다."));

        let revised = repository
            .record_task_qa(
                root.path(),
                &workflow.directory,
                "TASK-REVISION.md",
                TaskQaOutcome::RevisionRequested,
                "빈 상태에서 다시 확인해 주세요.",
            )
            .expect("request task revision");
        assert_eq!(
            revised.workflows[0]
                .items
                .tasks
                .iter()
                .find(|item| item.id == "TASK-REVISION")
                .expect("revision summary")
                .status,
            "todo"
        );
        let decisions = root
            .path()
            .join(".workflow")
            .join(&workflow.directory)
            .join("decisions");
        let qa_decisions = fs::read_dir(decisions)
            .expect("qa decisions")
            .filter_map(Result::ok)
            .map(|entry| fs::read_to_string(entry.path()).expect("qa decision"))
            .collect::<Vec<_>>();
        assert!(qa_decisions.iter().any(|decision| {
            decision.contains("schema: workflow-labs/qa-decision@1")
                && decision.contains("outcome: confirmed")
                && decision.contains("앱 실행 → 정상 표시 확인")
        }));
        assert!(qa_decisions.iter().any(|decision| {
            decision.contains("outcome: revision_requested")
                && decision.contains("빈 상태에서 다시 확인해 주세요.")
        }));
    }

    fn qa_waiting_task(
        root: &Path,
        directory: &str,
        file_name: &str,
        frontmatter: &str,
    ) -> PathBuf {
        let path = root
            .join(".workflow")
            .join(directory)
            .join("tasks")
            .join(file_name);
        fs::write(&path, format!("---\n{frontmatter}---\n\n# QA 대상 작업\n"))
            .expect("write qa task");
        path
    }

    fn back_to_qa_waiting(path: &Path) {
        let source = fs::read_to_string(path).expect("task source");
        fs::write(
            path,
            source
                .replace("status: completed", "status: qa_waiting")
                .replace("status: todo", "status: qa_waiting"),
        )
        .expect("rewind task status");
    }

    fn qa_decision_created_at(root: &Path, directory: &str, outcome: &str) -> String {
        fs::read_dir(root.join(".workflow").join(directory).join("decisions"))
            .expect("decisions")
            .filter_map(Result::ok)
            .filter_map(|entry| fs::read_to_string(entry.path()).ok())
            .filter(|text| text.contains("schema: workflow-labs/qa-decision@1"))
            .filter(|text| text.contains(&format!("outcome: {outcome}")))
            .find_map(|text| {
                text.lines()
                    .find_map(|line| line.strip_prefix("created_at: "))
                    .map(str::to_owned)
            })
            .expect("qa decision created_at")
    }

    fn write_decision(root: &Path, directory: &str, file_name: &str, contents: &str) {
        fs::write(
            root.join(".workflow")
                .join(directory)
                .join("decisions")
                .join(file_name),
            contents,
        )
        .expect("write decision");
    }

    fn task_events(project: &ProjectSummary, id: &str) -> Vec<(String, String)> {
        project.workflows[0]
            .items
            .tasks
            .iter()
            .find(|item| item.id == id)
            .expect("task summary")
            .events
            .iter()
            .map(|event| (event.kind.clone(), event.at.clone()))
            .collect()
    }

    fn write_spec(root: &Path, directory: &str, id: &str) {
        write_spec_with_status(root, directory, id, "user_review");
    }

    fn write_spec_with_status(root: &Path, directory: &str, id: &str, status: &str) {
        fs::write(
            root.join(".workflow")
                .join(directory)
                .join("specs")
                .join(format!("{id}.md")),
            format!(
                "---\nschema: workflow-labs/spec@1\nid: {id}\ntitle: {id} 기획서\nstatus: {status}\nupdated_at: 2026-08-01T00:00:00Z\n---\n\n본문\n"
            ),
        )
        .expect("write spec");
    }

    fn spec_decision(id: &str, spec_id: &str, outcome: &str, created_at: &str) -> String {
        format!(
            "---\nschema: workflow-labs/decision@1\nid: {id}\nspec_id: {spec_id}\noutcome: {outcome}\ncreated_by: user\ncreated_at: {created_at}\n---\n\n결정 사유\n"
        )
    }

    fn spec_events(project: &ProjectSummary, workflow: usize, id: &str) -> Vec<(String, String)> {
        project.workflows[workflow]
            .items
            .specs
            .iter()
            .find(|item| item.id == id)
            .expect("spec summary")
            .events
            .iter()
            .map(|event| (event.kind.clone(), event.at.clone()))
            .collect()
    }

    #[test]
    fn carries_spec_decisions_as_events_in_time_order() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_spec(root.path(), directory, "SPEC-001");
        write_spec(root.path(), directory, "SPEC-002");
        write_decision(
            root.path(),
            directory,
            "DECISION-LATE.md",
            &spec_decision(
                "DECISION-LATE",
                "SPEC-001",
                "approved",
                "2026-08-02T00:00:00Z",
            ),
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-EARLY.md",
            &spec_decision(
                "DECISION-EARLY",
                "SPEC-001",
                "revision_requested",
                "2026-08-01T00:00:00Z",
            ),
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-OTHER.md",
            &spec_decision(
                "DECISION-OTHER",
                "SPEC-002",
                "rejected",
                "2026-08-03T00:00:00Z",
            ),
        );

        let inspected = repository.inspect(root.path()).expect("inspect specs");

        // 한 기획서의 결정이 여럿이면 전부 남는다. "언제 승인됐고 언제 반려됐나"가 감사 로그의 질문이다.
        assert_eq!(
            spec_events(&inspected, 0, "SPEC-001"),
            vec![
                (
                    "revision_requested".to_owned(),
                    "2026-08-01T00:00:00Z".to_owned()
                ),
                ("approved".to_owned(), "2026-08-02T00:00:00Z".to_owned()),
            ]
        );
        assert_eq!(
            spec_events(&inspected, 0, "SPEC-002"),
            vec![("rejected".to_owned(), "2026-08-03T00:00:00Z".to_owned())]
        );
    }

    #[test]
    fn skips_unreadable_spec_decisions_and_keeps_the_others() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_spec(root.path(), directory, "SPEC-001");
        write_decision(
            root.path(),
            directory,
            "DECISION-GOOD.md",
            &spec_decision(
                "DECISION-GOOD",
                "SPEC-001",
                "approved",
                "2026-08-01T00:00:00Z",
            ),
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-AGENT.md",
            &spec_decision(
                "DECISION-AGENT",
                "SPEC-001",
                "approved",
                "2026-08-01T01:00:00Z",
            )
            .replace("created_by: user", "created_by: agent"),
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-NO-TIME.md",
            &spec_decision("DECISION-NO-TIME", "SPEC-001", "approved", "어제"),
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-ODD.md",
            &spec_decision(
                "DECISION-ODD",
                "SPEC-001",
                "archived",
                "2026-08-01T02:00:00Z",
            ),
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-BROKEN.md",
            "프론트매터가 없는 문서\n",
        );

        let inspected = repository.inspect(root.path()).expect("inspect specs");

        assert_eq!(
            spec_events(&inspected, 0, "SPEC-001"),
            vec![("approved".to_owned(), "2026-08-01T00:00:00Z".to_owned())]
        );
    }

    #[test]
    fn keeps_spec_decision_events_inside_their_workflow() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "First")
            .expect("create first workflow");
        let project = repository
            .create_workflow(root.path(), "Second")
            .expect("create second workflow");
        let first = project.workflows[0].directory.clone();
        let second = project.workflows[1].directory.clone();
        write_spec(root.path(), &first, "SPEC-001");
        write_spec(root.path(), &second, "SPEC-001");
        write_decision(
            root.path(),
            &first,
            "DECISION-FIRST.md",
            &spec_decision(
                "DECISION-FIRST",
                "SPEC-001",
                "approved",
                "2026-08-01T00:00:00Z",
            ),
        );

        let inspected = repository.inspect(root.path()).expect("inspect specs");

        assert_eq!(
            spec_events(&inspected, 0, "SPEC-001"),
            vec![("approved".to_owned(), "2026-08-01T00:00:00Z".to_owned())]
        );
        assert!(spec_events(&inspected, 1, "SPEC-001").is_empty());
    }

    #[test]
    fn inspecting_the_project_does_not_touch_the_workflow_files() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        write_spec(root.path(), directory, "SPEC-001");
        write_decision(
            root.path(),
            directory,
            "DECISION-GOOD.md",
            &spec_decision(
                "DECISION-GOOD",
                "SPEC-001",
                "approved",
                "2026-08-01T00:00:00Z",
            ),
        );
        // 종결 판정도 읽기다(SPEC-018 R6). 반려 픽스처가 없으면 이 성질이 새 가지를 지나지 않는다.
        write_idea_document(root.path(), directory, "IDEA-001", "inbox");
        write_spec_for_idea(
            root.path(),
            directory,
            "SPEC-002",
            "IDEA-001",
            "user_review",
        );
        write_decision(
            root.path(),
            directory,
            "DECISION-REJECTED.md",
            &spec_decision(
                "DECISION-REJECTED",
                "SPEC-002",
                "rejected",
                "2026-08-02T00:00:00Z",
            ),
        );
        write_task_with_frontmatter(
            root.path(),
            directory,
            "history:\n  - { at: 2026-07-30T09:00:00Z, kind: created }\n",
        );
        write_lease(
            root.path(),
            "TASK-001.yml",
            &format!(
                "schema_version: 1\nlease_id: active\nagent: codex\nrole: developer\ntask_id: TASK-001\nheartbeat_at: 2026-08-03T00:41:00Z\nexpires_at: {}\n",
                (Utc::now() + Duration::minutes(5)).to_rfc3339()
            ),
        );
        let control_root = root.path().join(".workflow");
        let before = file_snapshot(&control_root);

        repository.inspect(root.path()).expect("inspect project");

        assert_eq!(file_snapshot(&control_root), before);
    }

    /// 컨트롤 디렉터리 아래 모든 파일의 경로와 수정 시각.
    fn file_snapshot(control_root: &Path) -> BTreeMap<String, SystemTime> {
        let mut entries = BTreeMap::new();
        collect_modified_times(control_root, &mut entries);
        entries
    }

    fn collect_modified_times(directory: &Path, entries: &mut BTreeMap<String, SystemTime>) {
        for entry in fs::read_dir(directory).expect("directory listing") {
            let path = entry.expect("directory entry").path();
            let metadata = fs::symlink_metadata(&path).expect("entry metadata");
            entries.insert(
                path.display().to_string(),
                metadata.modified().expect("modified time"),
            );
            if metadata.is_dir() {
                collect_modified_times(&path, entries);
            }
        }
    }

    #[test]
    fn records_a_confirmed_transition_with_the_qa_decision_time() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        let path = qa_waiting_task(
            root.path(),
            directory,
            "TASK-001.md",
            "schema: workflow-labs/task@1\nid: TASK-001\ntitle: 확인 대상\nstatus: qa_waiting\nupdated_at: 2026-07-31T00:00:00Z\nhistory:\n  - { at: 2026-07-31T00:00:00Z, kind: qa_waiting }\n",
        );

        let confirmed = repository
            .record_task_qa(
                root.path(),
                directory,
                "TASK-001.md",
                TaskQaOutcome::Confirmed,
                "앱에서 확인함",
            )
            .expect("confirm task");

        let created_at = qa_decision_created_at(root.path(), directory, "confirmed");
        let source = fs::read_to_string(&path).expect("task source");
        assert!(source.contains(&format!("  - {{ at: {created_at}, kind: completed }}")));
        assert!(source.contains("  - { at: 2026-07-31T00:00:00Z, kind: qa_waiting }"));
        assert_eq!(
            task_events(&confirmed, "TASK-001"),
            vec![
                ("qa_waiting".to_owned(), "2026-07-31T00:00:00Z".to_owned()),
                ("completed".to_owned(), created_at),
            ]
        );
    }

    #[test]
    fn records_a_revision_transition_and_returns_the_task_to_todo() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        let path = qa_waiting_task(
            root.path(),
            directory,
            "TASK-001.md",
            "schema: workflow-labs/task@1\nid: TASK-001\ntitle: 반려 대상\nstatus: qa_waiting\nupdated_at: 2026-07-31T00:00:00Z\nhistory:\n  - { at: 2026-07-31T00:00:00Z, kind: qa_waiting }\n",
        );

        let revised = repository
            .record_task_qa(
                root.path(),
                directory,
                "TASK-001.md",
                TaskQaOutcome::RevisionRequested,
                "빈 상태에서 다시 확인해 주세요.",
            )
            .expect("request revision");

        let created_at = qa_decision_created_at(root.path(), directory, "revision_requested");
        let source = fs::read_to_string(&path).expect("task source");
        assert!(source.contains("status: todo"));
        assert!(source.contains(&format!(
            "  - {{ at: {created_at}, kind: revision_requested }}"
        )));
        assert_eq!(
            task_events(&revised, "TASK-001")
                .into_iter()
                .map(|(kind, _)| kind)
                .collect::<Vec<_>>(),
            vec!["qa_waiting", "revision_requested"]
        );
    }

    #[test]
    fn keeps_every_transition_when_qa_repeats() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        let seeded = "  - { at: 2026-07-31T00:00:00Z, kind: qa_waiting }";
        let path = qa_waiting_task(
            root.path(),
            directory,
            "TASK-001.md",
            "schema: workflow-labs/task@1\nid: TASK-001\ntitle: 반복 QA\nstatus: qa_waiting\nupdated_at: 2026-07-31T00:00:00Z\nhistory:\n  - { at: 2026-07-31T00:00:00Z, kind: qa_waiting }\n",
        );

        for _ in 0..2 {
            repository
                .record_task_qa(
                    root.path(),
                    directory,
                    "TASK-001.md",
                    TaskQaOutcome::RevisionRequested,
                    "다시 확인해 주세요.",
                )
                .expect("request revision");
            back_to_qa_waiting(&path);
        }
        let inspected = repository
            .record_task_qa(
                root.path(),
                directory,
                "TASK-001.md",
                TaskQaOutcome::Confirmed,
                "확인 완료",
            )
            .expect("confirm task");

        let source = fs::read_to_string(&path).expect("task source");
        assert!(source.contains(seeded));
        assert_eq!(
            task_events(&inspected, "TASK-001")
                .into_iter()
                .map(|(kind, _)| kind)
                .collect::<Vec<_>>(),
            vec![
                "qa_waiting",
                "revision_requested",
                "revision_requested",
                "completed"
            ]
        );
    }

    fn batch_qa_task(root: &Path, directory: &str, id: &str, status: &str) -> PathBuf {
        qa_waiting_task(
            root,
            directory,
            &format!("{id}.md"),
            &format!(
                "schema: workflow-labs/task@1\nid: {id}\ntitle: 일괄 확인 대상\nstatus: {status}\nupdated_at: 2026-07-31T00:00:00Z\nhistory:\n  - {{ at: 2026-07-31T00:00:00Z, kind: qa_waiting }}\n"
            ),
        )
    }

    fn qa_decision_texts(root: &Path, directory: &str) -> Vec<String> {
        fs::read_dir(root.join(".workflow").join(directory).join("decisions"))
            .expect("decisions")
            .filter_map(Result::ok)
            .filter_map(|entry| fs::read_to_string(entry.path()).ok())
            .filter(|text| text.contains("schema: workflow-labs/qa-decision@1"))
            .collect()
    }

    #[test]
    fn a_batch_confirms_every_task_it_was_given() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        let paths: Vec<PathBuf> = ["TASK-001", "TASK-002", "TASK-003"]
            .iter()
            .map(|id| batch_qa_task(root.path(), &directory, id, "qa_waiting"))
            .collect();
        let developer = root.path().join(".workflow/rules/roles/developer.md");
        let old_developer = fs::read_to_string(&developer)
            .expect("developer")
            .replace("rules_version: 14", "rules_version: 13");
        fs::write(&developer, old_developer).expect("old developer");

        let result = repository
            .confirm_task_qa_batch(
                root.path(),
                &directory,
                &[
                    "TASK-001.md".to_owned(),
                    "TASK-002.md".to_owned(),
                    "TASK-003.md".to_owned(),
                ],
                "레인에서 한 번에 확인함",
            )
            .expect("confirm batch");

        assert!(result.results.iter().all(|entry| entry.recorded));
        assert!(fs::read_to_string(developer)
            .expect("developer updated on batch QA")
            .contains("rules_version: 14"));
        assert_eq!(
            result
                .results
                .iter()
                .map(|entry| entry.task_id.clone())
                .collect::<Vec<_>>(),
            vec![
                Some("TASK-001".to_owned()),
                Some("TASK-002".to_owned()),
                Some("TASK-003".to_owned()),
            ]
        );

        let decisions = qa_decision_texts(root.path(), &directory);
        assert_eq!(decisions.len(), 3);
        for id in ["TASK-001", "TASK-002", "TASK-003"] {
            assert!(decisions.iter().any(|text| {
                text.contains(&format!("task_id: {id}"))
                    && text.contains("outcome: confirmed")
                    && text.contains("created_by: user")
                    && text.contains("레인에서 한 번에 확인함")
            }));
        }
        for path in &paths {
            let source = fs::read_to_string(path).expect("task source");
            assert!(source.contains("status: completed"));
            assert_eq!(source.matches("kind: completed").count(), 1);
        }
    }

    #[test]
    fn a_batch_leaves_tasks_outside_the_list_untouched() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        batch_qa_task(root.path(), &directory, "TASK-001", "qa_waiting");
        let untouched = batch_qa_task(root.path(), &directory, "TASK-002", "qa_waiting");
        let before = fs::read_to_string(&untouched).expect("untouched source");

        repository
            .confirm_task_qa_batch(
                root.path(),
                &directory,
                &["TASK-001.md".to_owned()],
                "하나만 고름",
            )
            .expect("confirm batch");

        assert_eq!(
            fs::read_to_string(&untouched).expect("untouched source"),
            before
        );
        let decisions = qa_decision_texts(root.path(), &directory);
        assert_eq!(decisions.len(), 1);
        assert!(decisions[0].contains("task_id: TASK-001"));
    }

    #[test]
    fn a_batch_records_the_rest_when_one_task_is_not_awaiting_qa() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        batch_qa_task(root.path(), &directory, "TASK-001", "qa_waiting");
        let in_progress = batch_qa_task(root.path(), &directory, "TASK-002", "in_progress");
        batch_qa_task(root.path(), &directory, "TASK-003", "qa_waiting");

        let result = repository
            .confirm_task_qa_batch(
                root.path(),
                &directory,
                &[
                    "TASK-001.md".to_owned(),
                    "TASK-002.md".to_owned(),
                    "TASK-003.md".to_owned(),
                ],
                "확인함",
            )
            .expect("confirm batch");

        assert_eq!(
            result
                .results
                .iter()
                .map(|entry| (entry.file_name.as_str(), entry.recorded))
                .collect::<Vec<_>>(),
            vec![
                ("TASK-001.md", true),
                ("TASK-002.md", false),
                ("TASK-003.md", true),
            ]
        );
        assert_eq!(result.results[1].task_id, Some("TASK-002".to_owned()));
        assert_eq!(
            result.results[1].message.as_deref(),
            Some(ProjectError::TaskNotAwaitingQa.to_string().as_str())
        );
        assert!(result.results[0].message.is_none());
        assert!(fs::read_to_string(&in_progress)
            .expect("task source")
            .contains("status: in_progress"));
        assert_eq!(qa_decision_texts(root.path(), &directory).len(), 2);
    }

    #[test]
    fn a_batch_writes_nothing_when_the_comment_is_too_long() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        let path = batch_qa_task(root.path(), &directory, "TASK-001", "qa_waiting");
        let before = fs::read_to_string(&path).expect("task source");

        let error = repository
            .confirm_task_qa_batch(
                root.path(),
                &directory,
                &["TASK-001.md".to_owned()],
                &"가".repeat(2_001),
            )
            .expect_err("comment too long");

        assert!(matches!(error, ProjectError::DecisionCommentTooLong));
        assert_eq!(fs::read_to_string(&path).expect("task source"), before);
        assert!(qa_decision_texts(root.path(), &directory).is_empty());

        let confirmed = repository
            .confirm_task_qa_batch(root.path(), &directory, &["TASK-001.md".to_owned()], "")
            .expect("empty comment is allowed");
        assert!(confirmed.results[0].recorded);
    }

    #[test]
    fn a_batch_confirms_a_task_covered_by_an_unexpired_lease() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        let path = batch_qa_task(root.path(), &directory, "TASK-001", "qa_waiting");
        let expires_at = (Utc::now() + Duration::minutes(30)).to_rfc3339();
        write_lease(
            root.path(),
            "TASK-001.yml",
            &format!(
                "schema_version: 1\nlease_id: live\nagent: codex\ntask_id: TASK-001\nheartbeat_at: {expires_at}\nexpires_at: {expires_at}\n"
            ),
        );

        let result = repository
            .confirm_task_qa_batch(
                root.path(),
                &directory,
                &["TASK-001.md".to_owned()],
                "리스가 있어도 확인함",
            )
            .expect("confirm batch");

        assert!(result.results[0].recorded);
        assert!(fs::read_to_string(&path)
            .expect("task source")
            .contains("status: completed"));
    }

    #[test]
    fn a_repeated_file_name_fails_only_the_second_time() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        batch_qa_task(root.path(), &directory, "TASK-001", "qa_waiting");

        let result = repository
            .confirm_task_qa_batch(
                root.path(),
                &directory,
                &["TASK-001.md".to_owned(), "TASK-001.md".to_owned()],
                "두 번 들어옴",
            )
            .expect("confirm batch");

        assert!(result.results[0].recorded);
        assert!(!result.results[1].recorded);
        assert_eq!(
            result.results[1].message.as_deref(),
            Some(ProjectError::TaskNotAwaitingQa.to_string().as_str())
        );
        assert_eq!(qa_decision_texts(root.path(), &directory).len(), 1);
    }

    #[test]
    fn an_empty_batch_returns_the_summary_with_no_results() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();

        let result = repository
            .confirm_task_qa_batch(root.path(), &directory, &[], "")
            .expect("empty batch");

        assert!(result.results.is_empty());
        assert_eq!(result.summary.workflows.len(), 1);
        assert!(qa_decision_texts(root.path(), &directory).is_empty());
    }

    #[test]
    fn adds_a_history_block_while_preserving_custom_fields() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        let path = qa_waiting_task(
            root.path(),
            directory,
            "TASK-001.md",
            "schema: workflow-labs/task@1\nid: TASK-001\ntitle: 이력 없음\nstatus: qa_waiting\ncustom_field: keep-me\nupdated_at: 2026-07-31T00:00:00Z\n",
        );

        let confirmed = repository
            .record_task_qa(
                root.path(),
                directory,
                "TASK-001.md",
                TaskQaOutcome::Confirmed,
                "확인 완료",
            )
            .expect("confirm task");

        let created_at = qa_decision_created_at(root.path(), directory, "confirmed");
        let source = fs::read_to_string(&path).expect("task source");
        assert!(source.contains("custom_field: keep-me"));
        assert!(source.contains("history:\n"));
        assert!(source.contains(&format!("  - {{ at: {created_at}, kind: completed }}")));
        assert_eq!(
            task_events(&confirmed, "TASK-001"),
            vec![("completed".to_owned(), created_at)]
        );
    }

    #[test]
    fn keeps_history_entries_out_of_the_status_and_updated_at_substitution() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        let path = qa_waiting_task(
            root.path(),
            directory,
            "TASK-001.md",
            "schema: workflow-labs/task@1\nid: TASK-001\ntitle: 중간 이력\nstatus: qa_waiting\nhistory:\n  - { at: 2026-07-30T09:00:00Z, kind: created }\n  - { at: 2026-07-30T10:00:00Z, kind: qa_waiting }\nupdated_at: 2026-07-31T00:00:00Z\ncustom_field: keep-me\n",
        );

        repository
            .record_task_qa(
                root.path(),
                directory,
                "TASK-001.md",
                TaskQaOutcome::Confirmed,
                "확인 완료",
            )
            .expect("confirm task");

        let created_at = qa_decision_created_at(root.path(), directory, "confirmed");
        let source = fs::read_to_string(&path).expect("task source");
        assert!(source.contains("  - { at: 2026-07-30T09:00:00Z, kind: created }"));
        assert!(source.contains("  - { at: 2026-07-30T10:00:00Z, kind: qa_waiting }"));
        assert!(source.contains(&format!("  - {{ at: {created_at}, kind: completed }}")));
        assert!(source.contains("custom_field: keep-me"));
        assert!(!source.contains("updated_at: 2026-07-31T00:00:00Z"));
        assert_eq!(source.matches("\nstatus:").count(), 1);
        assert!(source.contains("\nstatus: completed\n"));
        assert_eq!(source.matches("\nupdated_at:").count(), 1);
    }

    #[test]
    fn skips_history_when_the_field_uses_an_inline_form() {
        let source = "---\nschema: workflow-labs/task@1\nid: TASK-001\nstatus: qa_waiting\nhistory: []\nupdated_at: 2026-07-31T00:00:00Z\n---\n\n본문\n";
        let updated =
            update_task_frontmatter(source, "completed", "2026-08-01T00:00:00Z", "completed")
                .expect("update frontmatter");
        assert!(updated.contains("history: []"));
        assert!(updated.contains("status: completed"));
        assert!(!updated.contains("kind: completed"));
    }

    #[test]
    fn reads_qa_decisions_as_events_for_tasks_without_history() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        qa_waiting_task(
            root.path(),
            directory,
            "TASK-001.md",
            "schema: workflow-labs/task@1\nid: TASK-001\ntitle: 이력 없음\nstatus: completed\nupdated_at: 2026-07-31T00:00:00Z\n",
        );
        write_decision(
            root.path(),
            directory,
            "QA-1.md",
            "---\nschema: workflow-labs/qa-decision@1\nid: QA-1\ntask_id: TASK-001\noutcome: confirmed\ncreated_by: user\ncreated_at: 2026-07-31T04:37:59.588232+00:00\n---\n\n",
        );
        write_decision(
            root.path(),
            directory,
            "QA-2.md",
            "---\nschema: workflow-labs/qa-decision@1\nid: QA-2\ntask_id: TASK-001\noutcome: revision_requested\ncreated_by: user\ncreated_at: 2026-07-30T01:00:00Z\n---\n\n다시 확인해 주세요.\n",
        );

        let inspected = repository.inspect(root.path()).expect("inspect");
        assert_eq!(
            task_events(&inspected, "TASK-001"),
            vec![
                (
                    "revision_requested".to_owned(),
                    "2026-07-30T01:00:00Z".to_owned()
                ),
                (
                    "completed".to_owned(),
                    "2026-07-31T04:37:59.588232+00:00".to_owned()
                ),
            ]
        );
    }

    #[test]
    fn ignores_qa_decisions_that_are_damaged_or_point_nowhere() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        qa_waiting_task(
            root.path(),
            directory,
            "TASK-001.md",
            "schema: workflow-labs/task@1\nid: TASK-001\ntitle: 정상 작업\nstatus: completed\nupdated_at: 2026-07-31T00:00:00Z\n",
        );
        write_decision(root.path(), directory, "QA-BROKEN.md", "프론트매터 없음\n");
        write_decision(
            root.path(),
            directory,
            "QA-OTHER-SCHEMA.md",
            "---\nschema: workflow-labs/decision@1\nid: QA-OTHER-SCHEMA\ntask_id: TASK-001\noutcome: confirmed\ncreated_by: user\ncreated_at: 2026-07-31T02:00:00Z\n---\n",
        );
        write_decision(
            root.path(),
            directory,
            "QA-AGENT.md",
            "---\nschema: workflow-labs/qa-decision@1\nid: QA-AGENT\ntask_id: TASK-001\noutcome: confirmed\ncreated_by: agent\ncreated_at: 2026-07-31T03:00:00Z\n---\n",
        );
        write_decision(
            root.path(),
            directory,
            "QA-MISSING-FIELDS.md",
            "---\nschema: workflow-labs/qa-decision@1\nid: QA-MISSING-FIELDS\ntask_id: TASK-001\ncreated_by: user\n---\n",
        );
        write_decision(
            root.path(),
            directory,
            "QA-UNKNOWN-TASK.md",
            "---\nschema: workflow-labs/qa-decision@1\nid: QA-UNKNOWN-TASK\ntask_id: TASK-404\noutcome: confirmed\ncreated_by: user\ncreated_at: 2026-07-31T05:00:00Z\n---\n",
        );
        write_decision(
            root.path(),
            directory,
            "QA-GOOD.md",
            "---\nschema: workflow-labs/qa-decision@1\nid: QA-GOOD\ntask_id: TASK-001\noutcome: confirmed\ncreated_by: user\ncreated_at: 2026-07-31T06:00:00Z\n---\n",
        );

        let inspected = repository.inspect(root.path()).expect("inspect");
        assert_eq!(
            task_events(&inspected, "TASK-001"),
            vec![("completed".to_owned(), "2026-07-31T06:00:00Z".to_owned())]
        );
    }

    #[test]
    fn merges_the_same_fact_from_both_sources_only_once() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = &project.workflows[0].directory;
        qa_waiting_task(
            root.path(),
            directory,
            "TASK-001.md",
            "schema: workflow-labs/task@1\nid: TASK-001\ntitle: 두 원천\nstatus: completed\nupdated_at: 2026-07-31T00:00:00Z\nhistory:\n  - { at: 2026-07-30T12:00:00Z, kind: qa_waiting }\n  - { at: 2026-07-31T09:00:00Z, kind: completed }\n",
        );
        write_decision(
            root.path(),
            directory,
            "QA-SAME.md",
            "---\nschema: workflow-labs/qa-decision@1\nid: QA-SAME\ntask_id: TASK-001\noutcome: confirmed\ncreated_by: user\ncreated_at: 2026-07-31T09:00:00+00:00\n---\n",
        );

        let inspected = repository.inspect(root.path()).expect("inspect");
        assert_eq!(
            task_events(&inspected, "TASK-001"),
            vec![
                ("qa_waiting".to_owned(), "2026-07-30T12:00:00Z".to_owned()),
                ("completed".to_owned(), "2026-07-31T09:00:00Z".to_owned()),
            ]
        );
    }

    #[test]
    fn leaves_events_empty_when_only_updated_at_is_recorded() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        qa_waiting_task(
            root.path(),
            &project.workflows[0].directory,
            "TASK-001.md",
            "schema: workflow-labs/task@1\nid: TASK-001\ntitle: 이력 없는 완료\nstatus: completed\nupdated_at: 2026-07-31T00:00:00Z\n",
        );

        let inspected = repository.inspect(root.path()).expect("inspect");
        assert!(task_events(&inspected, "TASK-001").is_empty());
    }

    #[test]
    fn requires_a_comment_for_task_qa_revision() {
        let error = validate_task_qa(&TaskQaOutcome::RevisionRequested, "   ")
            .expect_err("empty QA revision must fail");
        assert!(matches!(error, ProjectError::QaCommentRequired));
    }

    #[test]
    fn reads_user_review_spec_and_records_approval_without_rewriting_it() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let workflow = &project.workflows[0];
        let spec_path = root
            .path()
            .join(".workflow")
            .join(&workflow.directory)
            .join("specs/SPEC-001.md");
        let source = "---\nschema: workflow-labs/spec@1\nid: SPEC-001\ntitle: 승인 흐름\nstatus: user_review\ncreated_at: 2026-07-30T00:00:00Z\n---\n\n# 승인 흐름\n\n## 기획 내용\n\n사용자가 기획서를 검토한다.\n";
        fs::write(&spec_path, source).expect("write external spec");

        let inspected = repository.inspect(root.path()).expect("inspect spec");
        assert_eq!(inspected.workflows[0].counts.decisions, 1);
        assert_eq!(inspected.workflows[0].items.specs[0].title, "승인 흐름");
        let document = repository
            .read_spec(root.path(), &workflow.directory, "SPEC-001.md")
            .expect("read spec");
        assert!(document.body.contains("## 기획 내용"));
        let rules = root.path().join(".workflow/rules/workflow.md");
        let old_rules = fs::read_to_string(&rules)
            .expect("rules")
            .replace("rules_version: 20", "rules_version: 19");
        fs::write(&rules, old_rules).expect("old rules");

        let decided = repository
            .record_spec_decision(
                root.path(),
                &workflow.directory,
                "SPEC-001.md",
                SpecDecisionOutcome::Approved,
                "범위 확인 완료",
            )
            .expect("approve spec");

        assert_eq!(decided.workflows[0].counts.decisions, 0);
        assert_eq!(decided.workflows[0].items.specs[0].status, "approved");
        assert!(fs::read_to_string(rules)
            .expect("rules updated on decision")
            .contains("rules_version: 20"));
        assert_eq!(
            fs::read_to_string(spec_path).expect("original spec"),
            source
        );
        let decision_root = root
            .path()
            .join(".workflow")
            .join(&workflow.directory)
            .join("decisions");
        let decision = fs::read_to_string(
            fs::read_dir(decision_root)
                .expect("decision directory")
                .next()
                .expect("decision entry")
                .expect("decision file")
                .path(),
        )
        .expect("decision markdown");
        assert!(decision.contains("spec_id: SPEC-001"));
        assert!(decision.contains("outcome: approved"));
    }

    #[test]
    fn requires_a_comment_when_requesting_revision_or_rejecting_a_spec() {
        for outcome in [
            SpecDecisionOutcome::RevisionRequested,
            SpecDecisionOutcome::Rejected,
        ] {
            let error =
                validate_decision(&outcome, "   ").expect_err("empty decision comment must fail");
            assert!(matches!(error, ProjectError::DecisionCommentRequired));
        }
    }

    #[test]
    fn records_revision_request_as_the_latest_spec_state() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let workflow = &project.workflows[0];
        fs::write(
            root.path()
                .join(".workflow")
                .join(&workflow.directory)
                .join("specs/SPEC-REVISION.md"),
            "---\nschema: workflow-labs/spec@1\nid: SPEC-REVISION\ntitle: 수정 흐름\nstatus: user_review\ncreated_at: 2026-07-31T00:00:00Z\n---\n\n# 수정 흐름\n",
        )
        .expect("write spec");

        let decided = repository
            .record_spec_decision(
                root.path(),
                &workflow.directory,
                "SPEC-REVISION.md",
                SpecDecisionOutcome::RevisionRequested,
                "성공 조건을 수치로 구체화해 주세요.",
            )
            .expect("request revision");

        assert_eq!(
            decided.workflows[0].items.specs[0].status,
            "revision_requested"
        );
        let decisions = root
            .path()
            .join(".workflow")
            .join(&workflow.directory)
            .join("decisions");
        let decision = fs::read_to_string(
            fs::read_dir(decisions)
                .expect("decisions")
                .next()
                .expect("decision entry")
                .expect("decision file")
                .path(),
        )
        .expect("decision markdown");
        assert!(decision.contains("outcome: revision_requested"));
        assert!(decision.contains("성공 조건을 수치로 구체화해 주세요."));
    }

    #[test]
    fn ignores_decisions_not_owned_by_the_app() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let workflow_root = root
            .path()
            .join(".workflow")
            .join(&project.workflows[0].directory);
        fs::write(
            workflow_root.join("specs/SPEC-001.md"),
            "---\nid: SPEC-001\ntitle: 검토 문서\nstatus: user_review\n---\n\n# 검토 문서\n",
        )
        .expect("write spec");
        fs::write(
            workflow_root.join("decisions/forged.md"),
            "---\nschema: workflow-labs/decision@1\nid: FORGED\nspec_id: SPEC-001\noutcome: approved\ncreated_by: external_agent\ncreated_at: 2026-07-30T00:00:00Z\n---\n",
        )
        .expect("write forged decision");

        let inspected = repository.inspect(root.path()).expect("inspect project");
        assert_eq!(inspected.workflows[0].items.specs[0].status, "user_review");
        assert_eq!(inspected.workflows[0].counts.decisions, 1);
    }

    /// `record_spec_decision`이 도장 가능 여부를 판정할 때 보는 상태. 그 경로의
    /// `read_markdown_document` → `normalize_spec_status` → `apply_latest_decision` 세 줄과 같다.
    fn spec_status_after_latest_decision(workflow_root: &Path, file_name: &str) -> String {
        let (mut spec, _) =
            read_markdown_document(&workflow_root.join("specs").join(file_name), "draft")
                .expect("read spec document");
        normalize_spec_status(&mut spec);
        apply_latest_decision(workflow_root, &mut spec);
        spec.status
    }

    /// 앱이 방금 쓴 결정 문서의 전문. 미리 놓아 둔 픽스처 하나를 빼면 남는 것이 그 문서다.
    fn app_recorded_decision_text(workflow_root: &Path, fixture_file_name: &str) -> String {
        let mut recorded: Vec<String> = fs::read_dir(workflow_root.join("decisions"))
            .expect("decisions")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy() != fixture_file_name)
            .filter_map(|entry| fs::read_to_string(entry.path()).ok())
            .collect();
        assert_eq!(recorded.len(), 1, "앱이 쓴 결정 문서는 하나여야 한다");
        recorded.remove(0)
    }

    /// 앱이 방금 쓴 결정 문서의 `id`와 `created_at`.
    fn app_recorded_decision(workflow_root: &Path, fixture_file_name: &str) -> (String, String) {
        let text = app_recorded_decision_text(workflow_root, fixture_file_name);
        let field = |key: &str| {
            let prefix = format!("{key}: ");
            text.lines()
                .find_map(|line| line.strip_prefix(prefix.as_str()))
                .map(str::to_owned)
                .unwrap_or_else(|| panic!("결정 문서에 {key}가 없다"))
        };
        (field("id"), field("created_at"))
    }

    // SPEC-028 R3(TASK-087). 위임을 받아 적은 대리 결정은 `created_by: user-delegate`를 달고,
    // 앱의 기획서 결정 읽기 경로는 `created_by: user`인 문서만 센다. 그래서 기획서가
    // `user_review`로 남고 사용자가 뒤늦게 앱 도장으로 재가할 수 있다. 그 필터가 느슨해지면
    // 대리 결정이 기획서를 `approved`로 만들어 재가 경로가 조용히 막히므로 여기서 고정한다.
    #[test]
    fn records_a_user_reapproval_on_a_spec_that_carries_a_delegate_decision() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        let workflow_root = root.path().join(".workflow").join(&directory);
        write_spec(root.path(), &directory, "SPEC-001");
        // 앱이 쓰는 결정 문서와 다른 것은 `created_by` 하나여야 이 테스트가 그 값을 검사하는 것이 된다.
        write_decision(
            root.path(),
            &directory,
            "DECISION-DELEGATE.md",
            &spec_decision(
                "DECISION-DELEGATE",
                "SPEC-001",
                "approved",
                "2026-08-04T08:58:00Z",
            )
            .replace("created_by: user", "created_by: user-delegate"),
        );

        assert_eq!(
            spec_status_after_latest_decision(&workflow_root, "SPEC-001.md"),
            "user_review"
        );
        let before = repository
            .inspect(root.path())
            .expect("inspect before reapproval");
        assert_eq!(before.workflows[0].items.specs[0].status, "user_review");

        let decided = repository
            .record_spec_decision(
                root.path(),
                &directory,
                "SPEC-001.md",
                SpecDecisionOutcome::Approved,
                "위임으로 대신 적힌 승인을 사용자가 재가한다",
            )
            .expect("대리 결정이 있는 기획서에도 재가 도장을 찍을 수 있어야 한다");

        assert_eq!(decided.workflows[0].items.specs[0].status, "approved");
        // 기록 뒤의 최신 결정은 방금 앱이 쓴 재가 결정이다. 대리 결정은 목록에 들어오지 않는다.
        let (recorded_id, recorded_at) =
            app_recorded_decision(&workflow_root, "DECISION-DELEGATE.md");
        let counted = read_spec_decisions(&workflow_root);
        assert_eq!(
            counted
                .iter()
                .map(|record| record.id.clone())
                .collect::<Vec<_>>(),
            vec![recorded_id]
        );
        assert_eq!(
            latest_spec_decisions(&counted).get("SPEC-001"),
            Some(&(recorded_at, "approved".to_owned()))
        );
        assert_eq!(
            spec_status_after_latest_decision(&workflow_root, "SPEC-001.md"),
            "approved"
        );
    }

    // 위 테스트의 대조군. `created_by: user`인 승인 결정은 앱이 세므로 기획서가 `approved`가 되고
    // 같은 경로가 지금처럼 `SpecNotAwaitingDecision`으로 막는다. 이것이 없으면 위 테스트가
    // "필터가 동작한다"가 아니라 "아무나 통과한다"를 확인하는 것이 될 수 있다.
    #[test]
    fn refuses_a_second_decision_on_a_spec_the_app_already_decided() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        let workflow_root = root.path().join(".workflow").join(&directory);
        write_spec(root.path(), &directory, "SPEC-001");
        write_decision(
            root.path(),
            &directory,
            "DECISION-APP.md",
            &spec_decision(
                "DECISION-APP",
                "SPEC-001",
                "approved",
                "2026-08-04T07:34:27.458543+00:00",
            ),
        );

        assert_eq!(
            spec_status_after_latest_decision(&workflow_root, "SPEC-001.md"),
            "approved"
        );

        let error = repository
            .record_spec_decision(
                root.path(),
                &directory,
                "SPEC-001.md",
                SpecDecisionOutcome::Approved,
                "이미 결정된 기획서에는 덧쓸 수 없다",
            )
            .expect_err("앱이 이미 결정한 기획서에는 결정을 덧쓸 수 없어야 한다");

        assert!(matches!(error, ProjectError::SpecNotAwaitingDecision));
        assert_eq!(
            fs::read_dir(workflow_root.join("decisions"))
                .expect("decisions")
                .count(),
            1
        );
    }

    /// 기획서 하나를 그 상태로 만들어 둔 픽스처(SPEC-042 R2의 표에서 한 행). `draft`와 `user_review`는
    /// 결정이 하나도 없는 상태이고, 나머지 셋은 그 값의 결정 하나가 최신인 상태다 — 화면과 쓰기
    /// 경로가 보는 상태가 파일의 `status`가 아니라 최신 결정의 `outcome`이기 때문이다.
    fn spec_in_state(status: &str) -> (TempDir, String, PathBuf) {
        let root = tempdir().expect("temp project");
        let project = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        let workflow_root = root.path().join(".workflow").join(&directory);
        match status {
            "draft" => write_spec_with_status(root.path(), &directory, "SPEC-001", "draft"),
            "user_review" => write_spec(root.path(), &directory, "SPEC-001"),
            outcome => {
                write_spec(root.path(), &directory, "SPEC-001");
                write_decision(
                    root.path(),
                    &directory,
                    "DECISION-APP.md",
                    &spec_decision(
                        "DECISION-APP",
                        "SPEC-001",
                        outcome,
                        "2026-08-04T07:34:27.458543+00:00",
                    ),
                );
            }
        }
        assert_eq!(
            spec_status_after_latest_decision(&workflow_root, "SPEC-001.md"),
            status,
            "픽스처가 만들려던 상태가 아니다"
        );
        (root, directory, workflow_root)
    }

    fn decision_count(workflow_root: &Path) -> usize {
        fs::read_dir(workflow_root.join("decisions"))
            .expect("decisions")
            .count()
    }

    /// 앱의 대기 물량 판정과 조건 스크립트의 답을 세 역할에서 대조하고 앱의 판정을 낸다.
    /// 대조 어법은 `a_closed_idea_is_not_planner_work_in_either_judgement`과 같다 —
    /// 스크립트를 부르는 일은 `heartbeat_condition`의 공용 헬퍼가 한다. 셸 이름과 파일 이름을 여기
    /// 다시 적으면 그것이 세 번째 사본이 되고, 플랫폼마다 다른 자산이 깔리므로 그 사본은 곧 틀린다.
    ///
    /// 대조 대상은 종료 코드만이 아니라 대상 문서와 후보별 제외 사유까지다(SPEC-049 완료 조건 4).
    /// `role_eligibility`의 대조 헬퍼와 같은 값을 본다 — 두 검사가 서로 다른 것을 대조하면 넓어진
    /// 답이 갈라지는 자리가 한쪽에서만 걸린다.
    fn pending_work_matching_condition_script(project_root: &Path) -> PendingRoleWork {
        let detail = FileSystemProjectRepository
            .inspect(project_root)
            .expect("inspect project")
            .pending_detail;
        for (role, verdict) in [
            ("planner", &detail.planner),
            ("architect", &detail.architect),
            ("developer", &detail.developer),
        ] {
            let run = run_condition(project_root, role);
            let candidates: Vec<String> = verdict
                .candidates
                .iter()
                .map(|candidate| format!("{} {}", candidate.verdict, candidate.id))
                .collect();

            assert_eq!(
                verdict.target.is_some(),
                run.code == 0,
                "{role} 판정이 조건 스크립트와 다르다"
            );
            assert_eq!(
                verdict.target,
                run.target(),
                "{role} 대상이 조건 스크립트와 다르다"
            );
            assert_eq!(
                candidates,
                run.candidates(),
                "{role} 후보 목록이 조건 스크립트와 다르다"
            );
        }
        detail.flags()
    }

    // SPEC-042 R1(TASK-127). 승인이 최신인 기획서에 후속 수정 요청 하나가 더 기록된다. 표에서
    // 이번에 열리는 칸은 이 하나뿐이다.
    #[test]
    fn records_a_follow_up_revision_request_on_an_approved_spec() {
        let (root, directory, workflow_root) = spec_in_state("approved");

        let decided = FileSystemProjectRepository
            .record_spec_decision(
                root.path(),
                &directory,
                "SPEC-001.md",
                SpecDecisionOutcome::RevisionRequested,
                "승인된 기획에 범위를 넓혀 달라",
            )
            .expect("승인된 기획서도 후속 수정 요청은 받아야 한다");

        assert_eq!(decision_count(&workflow_root), 2);
        assert_eq!(
            decided.workflows[0].items.specs[0].status,
            "revision_requested"
        );
        assert_eq!(
            spec_status_after_latest_decision(&workflow_root, "SPEC-001.md"),
            "revision_requested"
        );
        // 기존 승인 결정은 지워지지 않는다. 감사 로그는 덧쓰기만 한다.
        assert!(workflow_root
            .join("decisions")
            .join("DECISION-APP.md")
            .is_file());
    }

    // SPEC-042 R1·R8(TASK-127). 새로 열린 칸이 쓰는 결정 문서의 모양이 지금과 같다. 프론트매터는
    // 여섯 값 그대로이고 새 필드가 붙지 않는다.
    #[test]
    fn a_follow_up_revision_request_writes_the_same_decision_frontmatter() {
        let (root, directory, workflow_root) = spec_in_state("approved");

        FileSystemProjectRepository
            .record_spec_decision(
                root.path(),
                &directory,
                "SPEC-001.md",
                SpecDecisionOutcome::RevisionRequested,
                "승인된 기획에 범위를 넓혀 달라",
            )
            .expect("record follow-up revision request");

        let text = app_recorded_decision_text(&workflow_root, "DECISION-APP.md");
        let frontmatter: Vec<&str> = text
            .lines()
            .skip(1)
            .take_while(|line| *line != "---")
            .collect();
        let keys: Vec<&str> = frontmatter
            .iter()
            .map(|line| line.split(':').next().expect("frontmatter key"))
            .collect();
        assert_eq!(
            keys,
            [
                "schema",
                "id",
                "spec_id",
                "outcome",
                "created_by",
                "created_at"
            ]
        );
        assert!(frontmatter.contains(&"schema: workflow-labs/decision@1"));
        assert!(frontmatter.contains(&"spec_id: SPEC-001"));
        assert!(frontmatter.contains(&"outcome: revision_requested"));
        assert!(frontmatter.contains(&"created_by: user"));
    }

    // SPEC-042 R2(TASK-127). 표에서 막힌 칸이 전부 거절되고, 거절될 때 결정 문서가 늘지 않는다.
    // `user_review` 행 셋과 `approved` 행의 수정 요청만 표를 통과한다.
    #[test]
    fn refuses_every_spec_decision_the_table_blocks() {
        for (status, outcome) in [
            ("draft", SpecDecisionOutcome::Approved),
            ("draft", SpecDecisionOutcome::RevisionRequested),
            ("draft", SpecDecisionOutcome::Rejected),
            ("approved", SpecDecisionOutcome::Approved),
            ("approved", SpecDecisionOutcome::Rejected),
            ("revision_requested", SpecDecisionOutcome::Approved),
            ("revision_requested", SpecDecisionOutcome::RevisionRequested),
            ("revision_requested", SpecDecisionOutcome::Rejected),
            ("rejected", SpecDecisionOutcome::Approved),
            ("rejected", SpecDecisionOutcome::RevisionRequested),
            ("rejected", SpecDecisionOutcome::Rejected),
        ] {
            let (root, directory, workflow_root) = spec_in_state(status);
            let before = decision_count(&workflow_root);

            let error = FileSystemProjectRepository
                .record_spec_decision(
                    root.path(),
                    &directory,
                    "SPEC-001.md",
                    outcome.clone(),
                    "막혀야 하는 조합이다",
                )
                .expect_err(&format!("{status} 행의 {outcome:?} 칸이 막히지 않았다"));

            let message = error.to_string();
            assert!(
                matches!(error, ProjectError::SpecNotAwaitingDecision),
                "{status} 행의 {outcome:?} 칸이 다른 이유로 막혔다"
            );
            // R6. 거절 문구가 새 규칙과 어긋나지 않는다 — 승인된 기획서도 수정 요청은 받는다.
            assert!(
                message.contains("승인된 기획서에는 수정 요청만"),
                "거절 문구가 무엇이 허용되는지 말하지 않는다: {message}"
            );
            assert_eq!(
                decision_count(&workflow_root),
                before,
                "{status} 행의 {outcome:?} 칸이 거절되면서 결정 문서를 남겼다"
            );
        }
    }

    // SPEC-042 R8(TASK-127). 승인 뒤에 수정 요청이 붙은 기획서는 이 프로젝트에 아직 한 건도 없어
    // 그 상태에서 판정이 돌아본 적이 없다. 파생 작업이 없는 승인에서 (나)를 본다 — 그 승인이
    // 아키텍트 대기 물량이었다가 후속 수정 요청 뒤에 빠지고, 그 수정 요청이 기획자 대기 물량이 된다.
    #[test]
    fn a_follow_up_revision_request_moves_the_approval_out_of_architect_work() {
        let (root, directory, _) = spec_in_state("approved");
        install_condition_script(&root.path().join(".workflow")).expect("install condition script");

        assert_eq!(
            pending_work_matching_condition_script(root.path()),
            PendingRoleWork {
                planner: false,
                architect: true,
                developer: false,
            }
        );

        FileSystemProjectRepository
            .record_spec_decision(
                root.path(),
                &directory,
                "SPEC-001.md",
                SpecDecisionOutcome::RevisionRequested,
                "승인된 기획에 범위를 넓혀 달라",
            )
            .expect("record follow-up revision request");

        assert_eq!(
            pending_work_matching_condition_script(root.path()),
            PendingRoleWork {
                planner: true,
                architect: false,
                developer: false,
            }
        );
    }

    // SPEC-042 R8(TASK-127)의 나머지 몫. 그 승인에서 이미 파생된 작업은 후속 수정 요청이 붙어도
    // 그대로 개발자 후보로 남는다. 개발자 판정이 결정을 아예 읽지 않는 것이 근거이고, 이것이
    // 부작용이 아니라 기획서가 올린 약속이다.
    #[test]
    fn a_follow_up_revision_request_leaves_the_derived_task_to_the_developer() {
        let (root, directory, _) = spec_in_state("approved");
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "source_spec_id: SPEC-001\nsource_decision_id: DECISION-APP\nscope_files: []\n",
        );
        install_condition_script(&root.path().join(".workflow")).expect("install condition script");

        assert_eq!(
            pending_work_matching_condition_script(root.path()),
            PendingRoleWork {
                planner: false,
                architect: false,
                developer: true,
            }
        );

        FileSystemProjectRepository
            .record_spec_decision(
                root.path(),
                &directory,
                "SPEC-001.md",
                SpecDecisionOutcome::RevisionRequested,
                "승인된 기획에 범위를 넓혀 달라",
            )
            .expect("record follow-up revision request");

        assert_eq!(
            pending_work_matching_condition_script(root.path()),
            PendingRoleWork {
                planner: true,
                architect: false,
                developer: true,
            }
        );
        // 파생 작업은 그대로다. 앱이 되돌리거나 닫지 않는다.
        assert_eq!(
            read_task_document(root.path(), &directory, "TASK-001.md")
                .summary
                .status,
            "todo"
        );
    }

    #[test]
    fn rejects_document_path_traversal() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let error = repository
            .read_spec(root.path(), &project.workflows[0].directory, "../README.md")
            .expect_err("document traversal must fail");
        assert!(matches!(error, ProjectError::UnsafeDocumentFile(_)));
        let idea_error = repository
            .read_idea(root.path(), &project.workflows[0].directory, "../README.md")
            .expect_err("idea traversal must fail");
        assert!(matches!(idea_error, ProjectError::UnsafeDocumentFile(_)));
    }

    // 목록의 `excerpt`는 앞 세 줄에서 끊긴다. 전문 읽기는 그 뒤까지 돌려줘야 의미가 있다.
    #[test]
    fn reads_full_idea_body_without_touching_the_file() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let workflow = &project.workflows[0];
        let workflow_root = root.path().join(".workflow").join(&workflow.directory);
        let idea_path = workflow_root.join("ideas/IDEA-001.md");
        let source = "---\nschema: workflow-labs/idea@1\nid: IDEA-001\ntitle: 아이디어 전문 읽기\nstatus: inbox\ncreated_at: 2026-08-02T00:00:00Z\n---\n\n# 아이디어 전문 읽기\n\n첫째 줄 배경이다.\n둘째 줄 문제다.\n셋째 줄 제안이다.\n넷째 줄은 요약에서 잘린다.\n";
        fs::write(&idea_path, source).expect("write idea");
        let modified_before = fs::metadata(&idea_path)
            .and_then(|value| value.modified())
            .expect("idea mtime");

        let document = repository
            .read_idea(root.path(), &workflow.directory, "IDEA-001.md")
            .expect("read idea");

        assert!(document.body.contains("넷째 줄은 요약에서 잘린다."));
        assert!(!document
            .summary
            .excerpt
            .contains("넷째 줄은 요약에서 잘린다."));
        assert!(!document.body.contains("schema:"));
        assert!(!document.body.contains("id: IDEA-001"));
        assert_eq!(document.summary.id, "IDEA-001");
        assert_eq!(document.summary.status, "inbox");
        assert_eq!(
            fs::read_to_string(&idea_path).expect("idea after read"),
            source
        );
        assert_eq!(
            fs::metadata(&idea_path)
                .and_then(|value| value.modified())
                .expect("idea mtime after read"),
            modified_before
        );
    }

    // 전문 읽기의 상태가 목록과 갈리면 같은 아이디어가 화면 두 곳에서 다르게 보인다.
    #[test]
    fn reports_the_stalled_draft_spec_when_reading_an_idea_in_full() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let workflow = &project.workflows[0];
        let workflow_root = root.path().join(".workflow").join(&workflow.directory);
        fs::write(
            workflow_root.join("ideas/IDEA-001.md"),
            "---\nschema: workflow-labs/idea@1\nid: IDEA-001\ntitle: 반영중인 아이디어\nstatus: inbox\n---\n\n본문이다.\n",
        )
        .expect("write idea");
        fs::write(
            workflow_root.join("specs/SPEC-001.md"),
            "---\nschema: workflow-labs/spec@1\nid: SPEC-001\ntitle: 기획서\nstatus: draft\nsource_idea_id: IDEA-001\n---\n\n기획 내용이다.\n",
        )
        .expect("write spec");

        let document = repository
            .read_idea(root.path(), &workflow.directory, "IDEA-001.md")
            .expect("read idea");

        assert_eq!(document.summary.status, "drafting");
        assert_eq!(document.summary.stalled_spec_ids, vec!["SPEC-001"]);
    }

    #[test]
    fn marks_future_schema_read_only() {
        let root = tempdir().expect("temp project");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control directory");
        fs::write(
            control.join("project.yml"),
            "schema_version: 999\nproject_id: future\nname: Future\nworkflows: []\n",
        )
        .expect("future manifest");

        let summary = FileSystemProjectRepository
            .inspect(root.path())
            .expect("future project is inspectable");
        assert_eq!(summary.compatibility, SchemaCompatibility::FutureSchema);
    }

    #[test]
    fn migrates_legacy_manifest_with_backup() {
        let root = tempdir().expect("temp project");
        let control = root.path().join(".workflow");
        fs::create_dir_all(control.join(".runtime/migrations")).expect("runtime");
        fs::write(control.join(".gitignore"), ".runtime/\n").expect("gitignore");
        fs::write(
            control.join("project.yml"),
            "schema_version: 0\nproject_id: legacy\nname: Legacy\nworkflows: []\n",
        )
        .expect("legacy manifest");

        let migrated = FileSystemProjectRepository
            .migrate(root.path())
            .expect("migrate legacy project");

        assert_eq!(migrated.compatibility, SchemaCompatibility::Current);
        let backups = fs::read_dir(control.join(".runtime/migrations"))
            .expect("migration backups")
            .count();
        assert_eq!(backups, 1);
        assert!(!control.join(".runtime/migration.lock").exists());
    }

    #[test]
    fn migration_uses_the_same_exclusive_project_write_lock() {
        let root = tempdir().expect("temp project");
        let control = root.path().join(".workflow");
        fs::create_dir_all(control.join(".runtime/migrations")).expect("runtime");
        fs::write(
            control.join("project.yml"),
            "schema_version: 0\nproject_id: legacy\nname: Legacy\nworkflows: []\n",
        )
        .expect("legacy manifest");
        let _lock = ProjectWriteLock::acquire(&control).expect("shared write lock");

        let error = FileSystemProjectRepository
            .migrate(root.path())
            .expect_err("shared lock must block migration");

        assert!(matches!(error, ProjectError::ProjectWriteLock(_)));
        assert!(fs::read_to_string(control.join("project.yml"))
            .expect("manifest unchanged")
            .contains("schema_version: 0"));
    }

    #[test]
    fn blocks_migration_while_agent_lease_is_active() {
        let root = tempdir().expect("temp project");
        let control = root.path().join(".workflow");
        let leases = control.join(".runtime/leases");
        fs::create_dir_all(&leases).expect("leases");
        fs::write(
            control.join("project.yml"),
            "schema_version: 0\nproject_id: legacy\nname: Legacy\nworkflows: []\n",
        )
        .expect("legacy manifest");
        let expiry = (Utc::now() + Duration::minutes(5)).to_rfc3339();
        fs::write(
            leases.join("active.yml"),
            format!(
                "schema_version: 1\nlease_id: active\nagent: codex\ntask_id: null\nheartbeat_at: {expiry}\nexpires_at: {expiry}\n"
            ),
        )
        .expect("active lease");

        let error = FileSystemProjectRepository
            .migrate(root.path())
            .expect_err("active lease must block migration");
        assert!(matches!(error, ProjectError::ActiveLeases));
    }

    #[test]
    fn refuses_to_adopt_non_empty_unmanaged_control_directory() {
        let root = tempdir().expect("temp project");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control directory");
        fs::write(control.join("foreign.txt"), "keep me").expect("foreign file");

        let error = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect_err("must refuse unmanaged directory");
        assert!(matches!(error, ProjectError::UnmanagedControlDirectory));
    }

    #[test]
    fn instruction_conflict_does_not_partially_initialize_control_directory() {
        let root = tempdir().expect("temp project");
        fs::write(
            root.path().join("AGENTS.md"),
            "<!-- workflow-labs:project-instructions:start -->\nunfinished\n",
        )
        .expect("damaged agents");

        let error = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect_err("instruction conflict must fail before initialization");

        assert!(matches!(error, ProjectError::ManagedProjectAssets(_)));
        assert!(!root.path().join(".workflow").exists());
    }

    #[test]
    fn rejects_workflow_directory_traversal_from_tampered_manifest() {
        let root = tempdir().expect("temp project");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control directory");
        fs::write(
            control.join("project.yml"),
            "schema_version: 1\nproject_id: unsafe\nname: Unsafe\nworkflows:\n  - id: wf_bad\n    directory: ../outside\n    name: Bad\n    status: active\n    created_at: 2026-07-30T00:00:00Z\n",
        )
        .expect("tampered manifest");

        let error = FileSystemProjectRepository
            .inspect(root.path())
            .expect_err("path traversal must be rejected");
        assert!(matches!(error, ProjectError::UnsafeWorkflowDirectory(_)));
    }

    #[test]
    fn installs_the_claim_helper_with_the_workflow() {
        let root = tempdir().expect("temp project");
        FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");

        let helper = fs::read_to_string(claim_helper_path(&root.path().join(".workflow")))
            .expect("claim helper");
        assert!(helper.contains("# managed_by: workflow-labs"));
        assert!(helper.contains("# claim_helper_version: 1"));
        let reservation =
            fs::read_to_string(reservation_helper_path(&root.path().join(".workflow")))
                .expect("reservation helper");
        assert!(reservation.contains("# managed_by: workflow-labs"));
        assert!(reservation.contains("# reservation_helper_version: 1"));
    }

    #[test]
    fn sync_refuses_to_overwrite_a_future_reservation_helper() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let helper = reservation_helper_path(&root.path().join(".workflow"));
        let future = fs::read_to_string(&helper)
            .expect("reservation helper")
            .replace(
                "# reservation_helper_version: 1",
                "# reservation_helper_version: 999",
            );
        fs::write(&helper, &future).expect("future reservation helper");

        let error = repository
            .synchronize_managed_assets(root.path())
            .expect_err("future reservation helper must stay untouched");

        assert!(matches!(error, ProjectError::ManagedProjectAssets(_)));
        assert_eq!(fs::read_to_string(helper).expect("future helper"), future);
    }

    #[test]
    fn refuses_to_overwrite_an_unmanaged_claim_helper() {
        let root = tempdir().expect("temp project");
        let helper = claim_helper_path(&root.path().join(".workflow"));
        fs::create_dir_all(helper.parent().expect("rules root")).expect("rules root");
        let foreign = "#!/bin/sh\nexit 0\n";
        fs::write(&helper, foreign).expect("foreign helper");

        let error = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect_err("an unmanaged helper must stop workflow creation");

        assert!(matches!(error, ProjectError::ManagedProjectAssets(_)));
        assert_eq!(fs::read_to_string(&helper).expect("helper"), foreign);
        assert!(!root.path().join(".workflow/project.yml").exists());
    }

    /// 헬퍼가 쓴 lease를 앱의 lease 읽기 경로가 활성 lease로 인식한다(SPEC-013 완료 조건 22).
    #[cfg(unix)]
    #[test]
    fn reads_a_lease_written_by_the_installed_helper() {
        use std::process::Command;

        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");

        let output = Command::new("sh")
            .arg(".workflow/rules/wf-claim.sh")
            .args(["acquire", "TASK-001", "dev-a", "30"])
            .current_dir(root.path())
            .output()
            .expect("run claim helper");
        assert_eq!(output.status.code(), Some(0));
        let lease_id = String::from_utf8_lossy(&output.stdout).trim().to_owned();

        let inspected = repository.inspect(root.path()).expect("inspect");
        assert_eq!(inspected.active_leases.len(), 1);
        assert_eq!(inspected.active_leases[0].lease_id, lease_id);
        assert_eq!(inspected.active_leases[0].agent, "dev-a");
        assert_eq!(
            inspected.active_leases[0].task_id.as_deref(),
            Some("TASK-001")
        );
    }

    fn dependency_workflow() -> (TempDir, String) {
        let root = tempdir().expect("temp project");
        let project = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        (root, directory)
    }

    /// 선행 판정 픽스처 하나. `extra`는 프론트매터 끝에 그대로 붙는다.
    fn write_task_document(root: &Path, directory: &str, id: &str, status: &str, extra: &str) {
        fs::write(
            root.join(".workflow")
                .join(directory)
                .join("tasks")
                .join(format!("{id}.md")),
            format!(
                "---\nschema: workflow-labs/task@1\nid: {id}\ntitle: {id} 작업\nstatus: {status}\nupdated_at: 2026-08-03T00:00:00Z\n{extra}---\n\n# {id} 작업\n"
            ),
        )
        .expect("write task");
    }

    fn read_task_document(root: &Path, directory: &str, file_name: &str) -> TaskDocument {
        FileSystemProjectRepository
            .read_task(root, directory, file_name)
            .expect("read task")
    }

    fn declared_dependencies(
        root: &Path,
        directory: &str,
        file_name: &str,
    ) -> Vec<(String, TaskDependencyState)> {
        read_task_document(root, directory, file_name)
            .dependencies
            .into_iter()
            .map(|dependency| (dependency.id, dependency.state))
            .collect()
    }

    fn dependency(id: &str, state: TaskDependencyState) -> (String, TaskDependencyState) {
        (id.to_owned(), state)
    }

    fn task_summary(project: &ProjectSummary, id: &str) -> WorkflowItemSummary {
        project.workflows[0]
            .items
            .tasks
            .iter()
            .find(|item| item.id == id)
            .expect("task summary")
            .clone()
    }

    #[test]
    fn treats_a_task_without_a_declaration_as_having_no_dependencies() {
        let (root, directory) = dependency_workflow();
        write_task_document(root.path(), &directory, "TASK-001", "todo", "");

        let inspected = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect");
        let document = read_task_document(root.path(), &directory, "TASK-001.md");

        assert_eq!(document.summary, task_summary(&inspected, "TASK-001"));
        assert!(document.dependencies.is_empty());
        assert!(!document.dependency_format_error);
    }

    #[test]
    fn reads_an_empty_declaration_as_no_dependencies() {
        let (root, directory) = dependency_workflow();

        for (id, declaration) in [("TASK-001", "[]"), ("TASK-002", "[ ]")] {
            write_task_document(
                root.path(),
                &directory,
                id,
                "todo",
                &format!("depends_on: {declaration}\n"),
            );
            let document = read_task_document(root.path(), &directory, &format!("{id}.md"));
            assert!(document.dependencies.is_empty(), "{declaration}");
            assert!(!document.dependency_format_error, "{declaration}");
        }
    }

    #[test]
    fn treats_declarations_outside_the_contract_form_as_a_format_error() {
        let (root, directory) = dependency_workflow();
        let cases = [
            ("TASK-BLOCK", "depends_on:\n  - TASK-001\n"),
            ("TASK-EMPTY", "depends_on:\n"),
            ("TASK-OPEN", "depends_on: [TASK-001\n"),
            ("TASK-QUOTED", "depends_on: [\"TASK-001\"]\n"),
            ("TASK-BLANK", "depends_on: [TASK-001, ]\n"),
            (
                "TASK-TWICE",
                "depends_on: [TASK-001]\ndepends_on: [TASK-002]\n",
            ),
        ];

        for (id, extra) in cases {
            write_task_document(root.path(), &directory, id, "todo", extra);
            let document = read_task_document(root.path(), &directory, &format!("{id}.md"));
            assert!(document.dependency_format_error, "{id}의 선언이 통과했다");
            assert!(document.dependencies.is_empty(), "{id}");
        }
    }

    // 파싱 대상은 프론트매터다. 본문에 열 0으로 적힌 같은 문자열은 선언이 아니다.
    #[test]
    fn ignores_a_declaration_written_in_the_body() {
        let (root, directory) = dependency_workflow();
        fs::write(
            root.path()
                .join(".workflow")
                .join(&directory)
                .join("tasks/TASK-001.md"),
            "---\nschema: workflow-labs/task@1\nid: TASK-001\ntitle: 본문 언급\nstatus: todo\nupdated_at: 2026-08-03T00:00:00Z\n---\n\n# 본문 언급\n\ndepends_on: [TASK-002]\n",
        )
        .expect("write task");

        let document = read_task_document(root.path(), &directory, "TASK-001.md");
        assert!(document.dependencies.is_empty());
        assert!(!document.dependency_format_error);
    }

    #[test]
    fn satisfies_a_dependency_that_reached_qa_or_completion() {
        let (root, directory) = dependency_workflow();
        write_task_document(root.path(), &directory, "TASK-QA", "qa_waiting", "");
        write_task_document(root.path(), &directory, "TASK-DONE", "completed", "");
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "depends_on: [TASK-QA, TASK-DONE]\n",
        );

        // 선언에 적힌 순서 그대로다. 정렬하면 아키텍트가 쓴 순서의 뜻이 사라진다.
        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-001.md"),
            vec![
                dependency("TASK-QA", TaskDependencyState::Satisfied),
                dependency("TASK-DONE", TaskDependencyState::Satisfied),
            ]
        );
    }

    #[test]
    fn leaves_a_dependency_pending_until_it_reaches_qa() {
        let (root, directory) = dependency_workflow();
        // 계약에 없는 상태값도 미충족이다. 모르는 값을 충족 쪽으로 넘기지 않는다.
        let cases = [
            ("TASK-TODO", "todo"),
            ("TASK-PROGRESS", "in_progress"),
            ("TASK-BLOCKED", "blocked"),
            ("TASK-UNKNOWN", "검토중"),
        ];

        for (id, status) in cases {
            write_task_document(root.path(), &directory, id, status, "");
            write_task_document(
                root.path(),
                &directory,
                "TASK-001",
                "todo",
                &format!("depends_on: [{id}]\n"),
            );

            assert_eq!(
                declared_dependencies(root.path(), &directory, "TASK-001.md"),
                vec![dependency(id, TaskDependencyState::Pending)],
                "{status}이 충족으로 넘어갔다"
            );
        }
    }

    #[test]
    fn keeps_every_entry_when_only_one_dependency_is_satisfied() {
        let (root, directory) = dependency_workflow();
        write_task_document(root.path(), &directory, "TASK-DONE", "completed", "");
        write_task_document(root.path(), &directory, "TASK-OPEN", "todo", "");
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "depends_on: [TASK-DONE, TASK-OPEN]\n",
        );

        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-001.md"),
            vec![
                dependency("TASK-DONE", TaskDependencyState::Satisfied),
                dependency("TASK-OPEN", TaskDependencyState::Pending),
            ]
        );
    }

    #[test]
    fn marks_a_declaration_without_a_document_as_missing() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "depends_on: [TASK-404]\n",
        );

        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-001.md"),
            vec![dependency("TASK-404", TaskDependencyState::Missing)]
        );
    }

    #[test]
    fn marks_a_self_reference_as_cyclic() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "completed",
            "depends_on: [TASK-001]\n",
        );

        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-001.md"),
            vec![dependency("TASK-001", TaskDependencyState::Cyclic)]
        );
    }

    #[test]
    fn marks_a_two_task_cycle_as_cyclic_on_both_sides() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "depends_on: [TASK-002]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "todo",
            "depends_on: [TASK-001]\n",
        );

        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-001.md"),
            vec![dependency("TASK-002", TaskDependencyState::Cyclic)]
        );
        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-002.md"),
            vec![dependency("TASK-001", TaskDependencyState::Cyclic)]
        );
    }

    #[test]
    fn marks_a_three_task_cycle_as_cyclic() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "depends_on: [TASK-002]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "todo",
            "depends_on: [TASK-003]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-003",
            "todo",
            "depends_on: [TASK-001]\n",
        );

        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-001.md"),
            vec![dependency("TASK-002", TaskDependencyState::Cyclic)]
        );
    }

    // 상태 판정이 순환보다 앞서면 여기서 갈라진다. 순환이 먼저다.
    #[test]
    fn prefers_the_cycle_over_the_state_of_a_completed_dependency() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "depends_on: [TASK-002]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "completed",
            "depends_on: [TASK-001]\n",
        );

        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-001.md"),
            vec![dependency("TASK-002", TaskDependencyState::Cyclic)]
        );
    }

    // 선행 작업 자신의 형식 오류는 그 문서만 미충족으로 만든다. 기대는 문서까지 막지는 않는다.
    #[test]
    fn reads_only_the_state_of_a_dependency_with_a_malformed_declaration() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "completed",
            "depends_on: 없음\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "depends_on: [TASK-002]\n",
        );

        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-001.md"),
            vec![dependency("TASK-002", TaskDependencyState::Satisfied)]
        );
        assert!(read_task_document(root.path(), &directory, "TASK-002.md").dependency_format_error);
    }

    #[test]
    fn separates_missing_cyclic_and_malformed_declarations() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "depends_on: [TASK-002, TASK-404]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "todo",
            "depends_on: [TASK-001]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-003",
            "todo",
            "depends_on: TASK-001\n",
        );

        let declared = read_task_document(root.path(), &directory, "TASK-001.md");
        assert_eq!(
            declared
                .dependencies
                .into_iter()
                .map(|value| (value.id, value.state))
                .collect::<Vec<_>>(),
            vec![
                dependency("TASK-002", TaskDependencyState::Cyclic),
                dependency("TASK-404", TaskDependencyState::Missing),
            ]
        );
        assert!(!declared.dependency_format_error);

        let malformed = read_task_document(root.path(), &directory, "TASK-003.md");
        assert!(malformed.dependency_format_error);
        assert!(malformed.dependencies.is_empty());
    }

    // 판정 범위는 워크플로우 안이다(SPEC-013 R1).
    #[test]
    fn keeps_dependency_resolution_inside_its_workflow() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let first = repository
            .create_workflow(root.path(), "First")
            .expect("create first workflow");
        let second = repository
            .create_workflow(root.path(), "Second")
            .expect("create second workflow");
        let first_directory = first.workflows[0].directory.clone();
        let second_directory = second.workflows[1].directory.clone();
        write_task_document(root.path(), &second_directory, "TASK-002", "completed", "");
        write_task_document(
            root.path(),
            &first_directory,
            "TASK-001",
            "todo",
            "depends_on: [TASK-002]\n",
        );

        assert_eq!(
            declared_dependencies(root.path(), &first_directory, "TASK-001.md"),
            vec![dependency("TASK-002", TaskDependencyState::Missing)]
        );
    }

    // 목록 payload는 이 기능으로 늘지 않는다. `inspect`는 2.5초마다 도는 경로다.
    #[test]
    fn keeps_the_declaration_out_of_the_list_payload() {
        let (root, directory) = dependency_workflow();
        write_task_document(root.path(), &directory, "TASK-002", "completed", "");
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "depends_on: [TASK-002]\n",
        );
        let declared = task_summary(
            &FileSystemProjectRepository
                .inspect(root.path())
                .expect("inspect declared"),
            "TASK-001",
        );

        write_task_document(root.path(), &directory, "TASK-001", "todo", "");
        let plain = task_summary(
            &FileSystemProjectRepository
                .inspect(root.path())
                .expect("inspect plain"),
            "TASK-001",
        );

        assert_eq!(declared, plain);
    }

    // ---- 겹침 선언(SPEC-032) ----

    /// 겹침 판정 픽스처의 결과. 워크플로우의 작업 문서와 미만료 lease를 읽어 막힌 id 집합을 만든다.
    fn overlap_blocked(root: &Path, directory: &str) -> Vec<String> {
        let control_root = root.join(".workflow");
        let graph = task_dependency_graph(&control_root.join(directory).join("tasks"));
        let mut blocked: Vec<String> = overlap_blocked_task_ids(&graph, &lease_ids(&control_root))
            .into_iter()
            .collect();
        blocked.sort();
        blocked
    }

    /// 대상 문서를 잡은 lease 하나. 시각은 조건 스크립트가 읽는 고정 자리수 UTC 표기여야 한다 —
    /// `to_rfc3339()`가 내는 `+00:00`은 두 판정의 대조를 표기 차이만으로 무너뜨린다.
    fn write_target_lease(root: &Path, target_id: &str, expires_at: chrono::DateTime<Utc>) {
        let stamp = expires_at.format("%Y-%m-%dT%H:%M:%SZ").to_string();
        write_lease(
            root,
            &format!("{target_id}.yml"),
            &format!("schema_version: 1\nlease_id: lease-{target_id}\nagent: agent\ntask_id: {target_id}\nheartbeat_at: {stamp}\nexpires_at: {stamp}\n"),
        );
    }

    fn future() -> chrono::DateTime<Utc> {
        Utc::now() + Duration::minutes(30)
    }

    fn past() -> chrono::DateTime<Utc> {
        Utc::now() - Duration::minutes(30)
    }

    /// SPEC-032 완료 조건 1. 부재와 형식 오류는 자격 판정에서 같은 답을 내지만 파서는 둘을 구분한다.
    #[test]
    fn reads_the_scope_declaration_by_the_contract_form() {
        let cases = [
            (
                "scope_files: [src/a.rs, src/b.rs]",
                ScopeDeclaration::Declared(vec!["src/a.rs".to_owned(), "src/b.rs".to_owned()]),
            ),
            ("title: 선언 없음", ScopeDeclaration::Absent),
            ("scope_files: []", ScopeDeclaration::Declared(Vec::new())),
            ("scope_files: [ ]", ScopeDeclaration::Declared(Vec::new())),
            (
                "scope_files: [src/a.rs]\nscope_files: [src/b.rs]",
                ScopeDeclaration::Malformed,
            ),
            ("scope_files:\n  - src/a.rs", ScopeDeclaration::Malformed),
            ("scope_files:", ScopeDeclaration::Malformed),
            ("scope_files: [\"src/a.rs\"]", ScopeDeclaration::Malformed),
            ("scope_files: [src/a b.rs]", ScopeDeclaration::Malformed),
            ("scope_files: [src/a.rs, ]", ScopeDeclaration::Malformed),
            ("scope_files: [src/a.rs", ScopeDeclaration::Malformed),
            ("scope_files: [src/앱.rs]", ScopeDeclaration::Malformed),
        ];

        for (frontmatter, expected) in cases {
            assert_eq!(
                parse_scope_declaration(frontmatter),
                expected,
                "{frontmatter:?}의 판정이 다르다"
            );
        }
    }

    /// SPEC-032 완료 조건 2. 선행 관계가 없는 두 작업이라도 같은 파일을 선언하면 하나가 잡힌 동안
    /// 다른 하나는 착수 대상이 아니다.
    #[test]
    fn a_shared_path_blocks_the_task_while_the_other_is_leased() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "scope_files: [src/shared.rs, src/one.rs]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "in_progress",
            "scope_files: [src/shared.rs]\n",
        );
        write_target_lease(root.path(), "TASK-002", future());

        assert_eq!(overlap_blocked(root.path(), &directory), vec!["TASK-001"]);
    }

    /// SPEC-032 완료 조건 3. 겹치지 않으면 잡힌 lease가 있어도 열린다.
    #[test]
    fn a_disjoint_declaration_stays_open_while_another_task_is_leased() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "scope_files: [src/one.rs]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "in_progress",
            "scope_files: [src/two.rs]\n",
        );
        write_target_lease(root.path(), "TASK-002", future());

        assert!(overlap_blocked(root.path(), &directory).is_empty());
    }

    /// SPEC-032 완료 조건 6과 승인된 확인 필요 2번. 선언이 없는 작업은 무엇과 겹치는지 알 수 없으므로
    /// 잡힌 lease가 하나라도 있으면 막힌다. 잡힌 것이 없으면 열린다.
    #[test]
    fn a_task_without_a_declaration_is_blocked_by_any_active_lease() {
        let (root, directory) = dependency_workflow();
        write_task_document(root.path(), &directory, "TASK-001", "todo", "");
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "in_progress",
            "scope_files: [src/two.rs]\n",
        );
        assert!(overlap_blocked(root.path(), &directory).is_empty());

        write_target_lease(root.path(), "TASK-002", future());
        assert_eq!(overlap_blocked(root.path(), &directory), vec!["TASK-001"]);
    }

    /// SPEC-032 완료 조건 7. 만료가 유일한 해제 조건이고(R8), 만료된 lease는 아무것도 막지 않는다.
    #[test]
    fn an_expired_lease_blocks_nothing() {
        let (root, directory) = dependency_workflow();
        write_task_document(root.path(), &directory, "TASK-001", "todo", "");
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "todo",
            "scope_files: [src/two.rs]\n",
        );
        write_target_lease(root.path(), "TASK-002", past());

        assert!(overlap_blocked(root.path(), &directory).is_empty());
    }

    /// 형식 오류 선언은 부재와 같은 답을 낸다. 겹침은 대칭 관계이므로 그 작업을 잡은 lease는
    /// 선언이 멀쩡한 다른 작업까지 막는다(판정 규칙 2번).
    #[test]
    fn a_malformed_declaration_blocks_both_directions() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "scope_files: [\"src/one.rs\"]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "in_progress",
            "scope_files: [src/two.rs]\n",
        );
        write_target_lease(root.path(), "TASK-002", future());
        assert_eq!(overlap_blocked(root.path(), &directory), vec!["TASK-001"]);

        // 반대편. 형식 오류를 가진 작업을 잡으면 겹치지 않는 선언도 비교할 상대를 잃는다.
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "scope_files: [src/one.rs]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "in_progress",
            "scope_files: [\"src/two.rs\"]\n",
        );
        write_target_lease(root.path(), "TASK-002", future());
        assert_eq!(overlap_blocked(root.path(), &directory), vec!["TASK-001"]);
    }

    /// lease가 잡은 것이 작업 문서가 아니면 비교할 상대가 없다. 선언을 가진 작업은 그때 막히지 않는다.
    #[test]
    fn a_lease_on_a_document_that_is_not_a_task_blocks_a_declared_task_never() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "scope_files: [src/one.rs]\n",
        );
        write_target_lease(root.path(), "SPEC-001", future());

        assert!(overlap_blocked(root.path(), &directory).is_empty());
    }

    /// SPEC-032 완료 조건 8. 판정은 lease 파일을 읽기만 한다.
    #[test]
    fn judging_overlap_leaves_every_lease_file_untouched() {
        let (root, directory) = dependency_workflow();
        write_task_document(root.path(), &directory, "TASK-001", "todo", "");
        write_target_lease(root.path(), "TASK-002", future());
        write_target_lease(root.path(), "TASK-003", past());
        let leases = root.path().join(".workflow/.runtime/leases");
        let before = lease_directory(&leases);

        assert_eq!(overlap_blocked(root.path(), &directory), vec!["TASK-001"]);

        assert_eq!(before, lease_directory(&leases));
        assert_eq!(before.len(), 2);
    }

    /// lease 디렉터리의 `(파일 이름, 내용)` 목록. 개수와 내용을 함께 고정한다.
    fn lease_directory(leases: &Path) -> Vec<(String, String)> {
        let mut entries: Vec<(String, String)> = fs::read_dir(leases)
            .expect("leases root")
            .map(|entry| {
                let path = entry.expect("lease entry").path();
                (
                    path.file_name()
                        .expect("lease file name")
                        .to_string_lossy()
                        .into_owned(),
                    fs::read_to_string(&path).expect("lease body"),
                )
            })
            .collect();
        entries.sort();
        entries
    }

    /// SPEC-032 R7. 상세 payload가 막은 lease와 함께 가리킨 경로를 싣는다. 막히지 않았으면 비어 있다.
    #[test]
    fn carries_the_overlap_evidence_in_the_task_payload() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "scope_files: [src/b.rs, src/a.rs, src/one.rs]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "in_progress",
            "scope_files: [src/a.rs, src/b.rs]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-003",
            "in_progress",
            "scope_files: [src/three.rs]\n",
        );
        write_target_lease(root.path(), "TASK-002", future());
        write_target_lease(root.path(), "TASK-003", future());

        let blocked = read_task_document(root.path(), &directory, "TASK-001.md");
        assert_eq!(blocked.overlap_blocks.len(), 1);
        assert_eq!(blocked.overlap_blocks[0].lease_target_id, "TASK-002");
        // 선언에 적힌 문자열 그대로이고 오름차순·중복 없음이다.
        assert_eq!(
            blocked.overlap_blocks[0].shared_files,
            vec!["src/a.rs".to_owned(), "src/b.rs".to_owned()]
        );

        // 자기 자신을 잡은 lease는 겹침 근거가 아니다.
        assert!(read_task_document(root.path(), &directory, "TASK-003.md")
            .overlap_blocks
            .is_empty());
    }

    /// 선언이 없어 막힌 작업의 근거에는 함께 가리킨 경로가 없다. 화면이 "겹쳤다"와 "알 수 없다"를
    /// 그 값으로 구분한다.
    #[test]
    fn leaves_the_shared_files_empty_when_the_declaration_is_missing() {
        let (root, directory) = dependency_workflow();
        write_task_document(root.path(), &directory, "TASK-001", "todo", "");
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "in_progress",
            "scope_files: [src/two.rs]\n",
        );
        write_target_lease(root.path(), "TASK-002", future());

        let blocked = read_task_document(root.path(), &directory, "TASK-001.md");
        assert_eq!(blocked.overlap_blocks.len(), 1);
        assert_eq!(blocked.overlap_blocks[0].lease_target_id, "TASK-002");
        assert!(blocked.overlap_blocks[0].shared_files.is_empty());
    }

    /// 선언 줄이 `history:` 앞에 있는 픽스처. 앱이 QA 전이를 기록해도 원문 그대로여야 한다.
    const DECLARATION_BEFORE_HISTORY: &str = "schema: workflow-labs/task@1\nid: TASK-BEFORE\ntitle: 선언이 앞\nstatus: qa_waiting\ndepends_on: [TASK-A, TASK-B]\nhistory:\n  - { at: 2026-08-01T00:00:00Z, kind: qa_waiting }\nupdated_at: 2026-08-02T00:00:00Z\n";
    /// 선언 줄이 `history:` 뒤에 있는 픽스처. `append_task_history`의 스캔이 열 0에서 멈추는지를
    /// 확인하는 자리다.
    const DECLARATION_AFTER_HISTORY: &str = "schema: workflow-labs/task@1\nid: TASK-AFTER\ntitle: 선언이 뒤\nstatus: qa_waiting\nhistory:\n  - { at: 2026-08-01T00:00:00Z, kind: qa_waiting }\ndepends_on: [TASK-A, TASK-B]\nupdated_at: 2026-08-02T00:00:00Z\n";

    fn assert_qa_keeps_the_declaration_line(outcome: TaskQaOutcome, kind: &str) {
        for (file_name, frontmatter, after_history) in [
            ("TASK-BEFORE.md", DECLARATION_BEFORE_HISTORY, false),
            ("TASK-AFTER.md", DECLARATION_AFTER_HISTORY, true),
        ] {
            let (root, directory) = dependency_workflow();
            let path = qa_waiting_task(root.path(), &directory, file_name, frontmatter);
            write_task_document(root.path(), &directory, "TASK-A", "completed", "");

            FileSystemProjectRepository
                .record_task_qa(
                    root.path(),
                    &directory,
                    file_name,
                    outcome.clone(),
                    "확인했습니다.",
                )
                .expect("record qa");

            let source = fs::read_to_string(&path).expect("task source");
            let updated_at = source
                .lines()
                .find_map(|line| line.strip_prefix("updated_at: "))
                .expect("updated_at");
            let entry = format!("  - {{ at: {updated_at}, kind: {kind} }}");
            assert!(
                source.contains("\ndepends_on: [TASK-A, TASK-B]\n"),
                "{file_name}의 선언 줄이 원문 그대로 남지 않았다"
            );
            assert_eq!(source.matches("depends_on:").count(), 1, "{file_name}");
            assert!(
                source.contains("  - { at: 2026-08-01T00:00:00Z, kind: qa_waiting }"),
                "{file_name}의 기존 이력이 사라졌다"
            );
            assert!(source.contains(&entry), "{file_name}에 전이 항목이 없다");
            assert_eq!(
                source.find("\ndepends_on:") > source.find(&entry),
                after_history,
                "{file_name}의 전이 항목이 선언 줄을 넘어갔다"
            );

            // 선언 줄이 이력 블록에 섞였으면 프론트매터가 깨져 여기서 드러난다.
            let document = read_task_document(root.path(), &directory, file_name);
            assert_eq!(document.summary.events.len(), 2, "{file_name}");
            assert_eq!(
                document
                    .dependencies
                    .into_iter()
                    .map(|value| (value.id, value.state))
                    .collect::<Vec<_>>(),
                vec![
                    dependency("TASK-A", TaskDependencyState::Satisfied),
                    dependency("TASK-B", TaskDependencyState::Missing),
                ],
                "{file_name}"
            );
        }
    }

    #[test]
    fn keeps_the_declaration_line_when_qa_confirms_a_task() {
        assert_qa_keeps_the_declaration_line(TaskQaOutcome::Confirmed, "completed");
    }

    #[test]
    fn keeps_the_declaration_line_when_qa_returns_a_task() {
        assert_qa_keeps_the_declaration_line(
            TaskQaOutcome::RevisionRequested,
            "revision_requested",
        );
    }

    // 판정은 읽는 시점의 파생이다. 앱은 이 기능 때문에 작업 문서를 쓰지 않는다(SPEC-013 R5).
    #[test]
    fn reading_the_task_detail_does_not_touch_the_workflow_files() {
        let (root, directory) = dependency_workflow();
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "depends_on: [TASK-002, TASK-404]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "completed",
            "depends_on: [TASK-001]\n",
        );
        let control_root = root.path().join(".workflow");
        let before = file_snapshot(&control_root);

        let document = read_task_document(root.path(), &directory, "TASK-001.md");

        assert_eq!(file_snapshot(&control_root), before);
        assert_eq!(
            document
                .dependencies
                .into_iter()
                .map(|value| (value.id, value.state))
                .collect::<Vec<_>>(),
            vec![
                dependency("TASK-002", TaskDependencyState::Cyclic),
                dependency("TASK-404", TaskDependencyState::Missing),
            ]
        );
    }

    /// 목록 항목의 `(id, status)`. 합친 훑기가 목록 쪽에 내는 값을 짚을 때 쓴다.
    fn item_states(items: &[WorkflowItemSummary]) -> Vec<(String, String)> {
        items
            .iter()
            .map(|item| (item.id.clone(), item.status.clone()))
            .collect()
    }

    /// 문서 id 오름차순으로 세운 [`item_states`]. 목록 순서가 아니라 문서 집합을 보는 자리가 쓴다.
    fn sorted_item_states(items: &[WorkflowItemSummary]) -> Vec<(String, String)> {
        let mut states = item_states(items);
        states.sort();
        states
    }

    fn qa_decision(
        id: &str,
        task_id: &str,
        outcome: &str,
        created_at: &str,
        extra: &str,
    ) -> String {
        format!(
            "---\nschema: workflow-labs/qa-decision@1\nid: {id}\ntask_id: {task_id}\noutcome: {outcome}\ncreated_by: user\ncreated_at: {created_at}\n{extra}---\n\nQA 코멘트\n"
        )
    }

    // SPEC-033 R7. 결정·기획서·작업 세 디렉터리를 각각 한 번만 훑도록 합친 뒤에도, 두 번 훑어
    // 만들던 값이 그대로 나온다. 쌍마다 그 쌍만이 만드는 값을 짚는다.
    #[test]
    fn one_scan_per_directory_keeps_the_values_two_scans_made() {
        let (root, directory) = dependency_workflow();
        write_idea_document(root.path(), &directory, "IDEA-001", "inbox");
        write_spec_for_idea(
            root.path(),
            &directory,
            "SPEC-001",
            "IDEA-001",
            "user_review",
        );
        write_decision(
            root.path(),
            &directory,
            "DECISION-1.md",
            &spec_decision("DECISION-1", "SPEC-001", "approved", "2026-08-01T00:00:00Z"),
        );
        write_decision(
            root.path(),
            &directory,
            "QA-1.md",
            &qa_decision("QA-1", "TASK-001", "confirmed", "2026-08-02T00:00:00Z", ""),
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "qa_waiting",
            "history:\n  - { at: 2026-08-01T09:00:00Z, kind: created }\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-002",
            "todo",
            "depends_on: [TASK-001]\n",
        );
        write_task_document(
            root.path(),
            &directory,
            "TASK-003",
            "todo",
            "depends_on: [TASK-404]\n",
        );

        let project = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project");

        // 결정 쌍. 기획서 상태와 결정 피드는 앞 훑기가, 작업 타임라인의 QA 이벤트는 뒤 훑기가
        // 만들던 값이다.
        assert_eq!(
            item_states(&project.workflows[0].items.specs),
            vec![("SPEC-001".to_owned(), "approved".to_owned())]
        );
        assert_eq!(
            spec_events(&project, 0, "SPEC-001"),
            vec![("approved".to_owned(), "2026-08-01T00:00:00Z".to_owned())]
        );
        assert_eq!(
            task_events(&project, "TASK-001"),
            vec![
                ("created".to_owned(), "2026-08-01T09:00:00Z".to_owned()),
                ("completed".to_owned(), "2026-08-02T00:00:00Z".to_owned()),
            ]
        );
        // 기획서 쌍. 목록 요약과 아이디어 파생 상태가 같은 훑기에서 나온다.
        assert_eq!(
            idea_state(&project, 0, "IDEA-001"),
            ("adopted".to_owned(), Vec::new())
        );
        // 작업 쌍. 목록 요약과 선행 판정이 같은 훑기에서 나온다.
        assert_eq!(
            item_states(&project.workflows[0].items.tasks),
            vec![
                ("TASK-001".to_owned(), "qa_waiting".to_owned()),
                ("TASK-002".to_owned(), "todo".to_owned()),
                ("TASK-003".to_owned(), "todo".to_owned()),
            ]
        );
        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-002.md"),
            vec![dependency("TASK-001", TaskDependencyState::Satisfied)]
        );
        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-003.md"),
            vec![dependency("TASK-404", TaskDependencyState::Missing)]
        );
        assert_eq!(
            (
                project.pending_work.planner,
                project.pending_work.architect,
                project.pending_work.developer
            ),
            (false, true, true)
        );
    }

    // 결정 쌍을 합칠 때 가장 틀리기 쉬운 자리다. 두 종류가 한 디렉터리에 섞여 있고 서로의 키까지
    // 들고 있어도, 스키마가 가르는 부분집합이 두 벌로 훑던 때와 같아야 한다.
    #[test]
    fn one_decision_scan_keeps_the_two_schemas_apart() {
        let (root, directory) = dependency_workflow();
        write_spec(root.path(), &directory, "SPEC-001");
        write_spec(root.path(), &directory, "SPEC-002");
        write_spec(root.path(), &directory, "SPEC-003");
        write_decision(
            root.path(),
            &directory,
            "DECISION-1.md",
            &spec_decision("DECISION-1", "SPEC-001", "approved", "2026-08-01T00:00:00Z"),
        );
        // 기획서 결정이 `task_id`를 들고 있어도 작업 타임라인에 닿지 않는다.
        write_decision(
            root.path(),
            &directory,
            "DECISION-2.md",
            &spec_decision("DECISION-2", "SPEC-003", "approved", "2026-08-01T01:00:00Z")
                .replace("---\n\n결정 사유", "task_id: TASK-001\n---\n\n결정 사유"),
        );
        // QA 결정이 `spec_id`와 승인 어법의 `outcome`을 들고 있어도 기획서 상태를 덮지 않는다.
        write_decision(
            root.path(),
            &directory,
            "QA-1.md",
            &qa_decision(
                "QA-1",
                "TASK-001",
                "confirmed",
                "2026-08-02T00:00:00Z",
                "spec_id: SPEC-002\n",
            ),
        );
        write_task_document(root.path(), &directory, "TASK-001", "qa_waiting", "");

        let project = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project");

        assert_eq!(
            item_states(&project.workflows[0].items.specs),
            vec![
                ("SPEC-001".to_owned(), "approved".to_owned()),
                ("SPEC-002".to_owned(), "user_review".to_owned()),
                ("SPEC-003".to_owned(), "approved".to_owned()),
            ]
        );
        assert_eq!(
            task_events(&project, "TASK-001"),
            vec![("completed".to_owned(), "2026-08-02T00:00:00Z".to_owned())]
        );
    }

    // 두 훑기가 각자 조용히 건너뛰던 문서를 한 훑기가 다르게 다루지 않는다. 건너뛰는 문서와 세는
    // 문서가 그대로여야 한다.
    #[test]
    fn one_scan_skips_the_documents_two_scans_skipped() {
        let (root, directory) = dependency_workflow();
        let workflow_root = root.path().join(".workflow").join(&directory);
        write_idea_document(root.path(), &directory, "IDEA-001", "inbox");
        write_spec_for_idea(root.path(), &directory, "SPEC-001", "IDEA-001", "draft");
        write_decision(
            root.path(),
            &directory,
            "QA-1.md",
            &qa_decision("QA-1", "TASK-001", "confirmed", "2026-08-02T00:00:00Z", ""),
        );
        write_task_document(root.path(), &directory, "TASK-001", "qa_waiting", "");
        for folder in ["decisions", "specs", "tasks"] {
            let directory_path = workflow_root.join(folder);
            fs::write(
                directory_path.join("no-frontmatter.md"),
                "프론트매터가 없다\n",
            )
            .expect("write plain markdown");
            fs::write(
                directory_path.join("other-schema.md"),
                "---\nschema: workflow-labs/other@1\nid: OTHER\noutcome: approved\ncreated_by: user\ncreated_at: 2026-08-03T00:00:00Z\n---\n\n본문\n",
            )
            .expect("write foreign schema");
            fs::write(directory_path.join("unreadable.md"), [0xff, 0xfe, 0x00])
                .expect("write invalid utf-8");
        }

        let project = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project");

        // 결정 디렉터리의 셋 중 무엇도 기획서 결정도 QA 이벤트도 되지 않는다. 기획서는 파일에
        // 적힌 상태로 남고 작업 이력은 QA 결정 하나뿐이다.
        //
        // 목록 순서는 여기서 보지 않는다. 프론트매터가 없는 문서는 `updated_at`이 파일 수정
        // 시각이라 실행 시각에 따라 자리가 달라진다. 순서는 시각이 고정된 픽스처가 본다.
        assert_eq!(
            sorted_item_states(&project.workflows[0].items.specs),
            vec![
                ("OTHER".to_owned(), "draft".to_owned()),
                ("SPEC-001".to_owned(), "draft".to_owned()),
                ("no-frontmatter".to_owned(), "draft".to_owned()),
            ]
        );
        assert_eq!(
            task_events(&project, "TASK-001"),
            vec![("completed".to_owned(), "2026-08-02T00:00:00Z".to_owned())]
        );
        // 기획서 쌍. 읽히지 않는 문서는 목록에도 참조에도 없고, `source_idea_id`가 없는 문서는
        // 목록에만 있고 아이디어 판정을 흔들지 않는다.
        assert_eq!(
            idea_state(&project, 0, "IDEA-001"),
            ("drafting".to_owned(), vec!["SPEC-001".to_owned()])
        );
        // 작업 쌍. 목록과 선행 판정이 같은 문서 집합을 본다.
        assert_eq!(
            sorted_item_states(&project.workflows[0].items.tasks),
            vec![
                ("OTHER".to_owned(), "todo".to_owned()),
                ("TASK-001".to_owned(), "qa_waiting".to_owned()),
                ("no-frontmatter".to_owned(), "todo".to_owned()),
            ]
        );
        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-001.md"),
            Vec::new()
        );
    }

    // `id`가 없는 문서의 fallback은 파일 stem이다. 기획서 참조와 작업 노드가 각자 갖고 있던 규칙이
    // 합친 훑기에서도 같은 값을 낸다.
    #[test]
    fn one_scan_falls_back_to_the_file_stem_for_a_document_without_an_id() {
        let (root, directory) = dependency_workflow();
        let workflow_root = root.path().join(".workflow").join(&directory);
        write_idea_document(root.path(), &directory, "IDEA-001", "inbox");
        fs::write(
            workflow_root.join("specs").join("no-id-spec.md"),
            "---\nschema: workflow-labs/spec@1\ntitle: id 없는 기획서\nstatus: draft\nsource_idea_id: IDEA-001\nupdated_at: 2026-08-01T00:00:00Z\n---\n\n기획 내용이다.\n",
        )
        .expect("write spec without id");
        fs::write(
            workflow_root.join("tasks").join("no-id-task.md"),
            "---\nschema: workflow-labs/task@1\ntitle: id 없는 작업\nstatus: qa_waiting\nupdated_at: 2026-08-03T00:00:00Z\n---\n\n본문이다.\n",
        )
        .expect("write task without id");
        write_task_document(
            root.path(),
            &directory,
            "TASK-001",
            "todo",
            "depends_on: [no-id-task]\n",
        );

        let project = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project");

        assert_eq!(
            item_states(&project.workflows[0].items.specs),
            vec![("no-id-spec".to_owned(), "draft".to_owned())]
        );
        assert_eq!(
            idea_state(&project, 0, "IDEA-001"),
            ("drafting".to_owned(), vec!["no-id-spec".to_owned()])
        );
        assert_eq!(
            item_states(&project.workflows[0].items.tasks),
            vec![
                ("TASK-001".to_owned(), "todo".to_owned()),
                ("no-id-task".to_owned(), "qa_waiting".to_owned()),
            ]
        );
        assert_eq!(
            declared_dependencies(root.path(), &directory, "TASK-001.md"),
            vec![dependency("no-id-task", TaskDependencyState::Satisfied)]
        );
    }

    /// 재개 대상이 되는 막힌 작업. 알 수 없는 프론트매터 필드와 막힌 사유 절을 함께 담아
    /// 재개가 그것들을 보존하는지 같은 문서에서 확인한다.
    fn blocked_task(root: &Path, directory: &str, extra: &str) -> PathBuf {
        let path = root
            .join(".workflow")
            .join(directory)
            .join("tasks")
            .join("TASK-900.md");
        fs::write(
            &path,
            format!(
                "---\nschema: workflow-labs/task@1\nid: TASK-900\ntitle: 막힌 작업\nstatus: blocked\nsource_spec_id: SPEC-900\nsource_decision_id: DECISION-900\nowner: 나\n{extra}updated_at: 2026-08-01T00:00:00Z\nhistory:\n  - {{ at: 2026-07-31T00:00:00Z, kind: created }}\n  - {{ at: 2026-07-31T01:00:00Z, kind: in_progress }}\n  - {{ at: 2026-07-31T02:00:00Z, kind: blocked }}\n---\n\n# 막힌 작업\n\n## 막힌 사유\n\n외부 API 규격이 확정되지 않았다.\n"
            ),
        )
        .expect("write blocked task");
        path
    }

    fn resume_request(
        directory: &str,
        expected_updated_at: &str,
        request_id: &str,
    ) -> TaskResumeRequest {
        TaskResumeRequest {
            workflow_directory: directory.to_owned(),
            file_name: "TASK-900.md".to_owned(),
            expected_updated_at: expected_updated_at.to_owned(),
            resolution: "외부 API 규격이 확정돼 남은 구현을 진행할 수 있다.".to_owned(),
            request_id: request_id.to_owned(),
        }
    }

    fn resume_audits(root: &Path, directory: &str) -> Vec<String> {
        fs::read_dir(root.join(".workflow").join(directory).join("decisions"))
            .expect("decisions")
            .filter_map(Result::ok)
            .filter_map(|entry| fs::read_to_string(entry.path()).ok())
            .filter(|text| text.contains("schema: workflow-labs/task-resume@1"))
            .collect()
    }

    /// 프론트매터 값 하나를 원문에서 뽑는다. 앱이 값을 따옴표로 감쌀 수 있으므로 감싼 문자를 벗긴다.
    fn audit_field(audit: &str, key: &str) -> String {
        audit
            .lines()
            .find_map(|line| line.strip_prefix(&format!("{key}: ")))
            .map(|value| value.trim().trim_matches(['"', '\'']).to_owned())
            .unwrap_or_else(|| panic!("감사 기록에 {key}가 없습니다"))
    }

    /// 작업과 결정 디렉터리의 원문 전부. 거절된 요청이 아무것도 바꾸지 않았음을 이 값으로 대조한다.
    fn task_and_decision_files(root: &Path, directory: &str) -> BTreeMap<String, String> {
        let workflow_root = root.join(".workflow").join(directory);
        let mut files = BTreeMap::new();
        for sub in ["tasks", "decisions"] {
            let Ok(entries) = fs::read_dir(workflow_root.join(sub)) else {
                continue;
            };
            for entry in entries.filter_map(Result::ok) {
                let contents = fs::read_to_string(entry.path()).expect("document");
                files.insert(
                    format!("{sub}/{}", entry.file_name().to_string_lossy()),
                    contents,
                );
            }
        }
        files
    }

    /// 막힌 작업 하나를 가진 프로젝트. 재개 검사가 모두 이 자리에서 시작한다.
    fn blocked_project() -> (TempDir, String, PathBuf) {
        let root = tempdir().expect("temp project");
        let project = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        let path = blocked_task(root.path(), &directory, "");
        (root, directory, path)
    }

    #[test]
    fn task_resume_records_the_transition_and_the_audit_together() {
        let (root, directory, path) = blocked_project();

        let result = FileSystemProjectRepository
            .resume_task(
                root.path(),
                &resume_request(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect("resume task");

        assert_eq!(result.status, TaskResumeStatus::Resumed);
        assert_eq!(result.recovery, None);

        let audits = resume_audits(root.path(), &directory);
        assert_eq!(audits.len(), 1);
        let audit = &audits[0];
        let resumed_at = audit_field(audit, "created_at");
        assert_eq!(audit_field(audit, "task_id"), "TASK-900");
        assert_eq!(audit_field(audit, "outcome"), "resumed");
        assert_eq!(audit_field(audit, "request_id"), "req-1");
        assert_eq!(
            audit_field(audit, "previous_updated_at"),
            "2026-08-01T00:00:00Z"
        );
        assert_eq!(audit_field(audit, "created_by"), "user");
        assert!(audit.starts_with("---\nschema: workflow-labs/task-resume@1\n"));
        assert!(audit.contains("외부 API 규격이 확정돼 남은 구현을 진행할 수 있다."));

        // 상태와 이력, 갱신 시각이 감사 기록과 같은 시각으로 함께 남는다.
        let task = fs::read_to_string(&path).expect("task");
        assert!(task.contains("status: todo"));
        assert!(task.contains(&format!("updated_at: {resumed_at}")));
        assert!(task.contains(&format!("- {{ at: {resumed_at}, kind: resumed }}")));
        // 기존 스키마·본문·이전 이력·알 수 없는 필드가 그대로 남는다.
        assert!(task.contains("schema: workflow-labs/task@1"));
        assert!(task.contains("owner: 나"));
        assert!(task.contains("- { at: 2026-07-31T02:00:00Z, kind: blocked }"));
        assert!(task.contains("## 막힌 사유\n\n외부 API 규격이 확정되지 않았다."));
        // 프로젝트 규격은 재개로 바뀌지 않는다.
        assert!(
            fs::read_to_string(root.path().join(".workflow/project.yml"))
                .expect("manifest")
                .contains("schema_version: 1")
        );

        // 이력과 감사 기록에 같은 사실이 있어도 활동 payload에는 한 번만 실린다.
        assert_eq!(
            task_events(&result.summary, "TASK-900")
                .into_iter()
                .map(|(kind, _)| kind)
                .collect::<Vec<_>>(),
            vec!["created", "in_progress", "blocked", "resumed"]
        );
    }

    #[test]
    fn task_resume_writes_nothing_when_the_updated_at_is_stale() {
        let (root, directory, _) = blocked_project();
        let before = task_and_decision_files(root.path(), &directory);

        let error = FileSystemProjectRepository
            .resume_task(
                root.path(),
                &resume_request(&directory, "2026-07-01T00:00:00Z", "req-1"),
            )
            .expect_err("stale updated_at");

        assert!(matches!(error, ProjectError::TaskResumeStale));
        assert_eq!(task_and_decision_files(root.path(), &directory), before);
    }

    #[test]
    fn task_resume_writes_nothing_when_the_task_is_not_blocked() {
        let (root, directory, path) = blocked_project();
        let source = fs::read_to_string(&path).expect("task");
        fs::write(&path, source.replace("status: blocked", "status: todo")).expect("todo task");
        let before = task_and_decision_files(root.path(), &directory);

        let error = FileSystemProjectRepository
            .resume_task(
                root.path(),
                &resume_request(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect_err("already resumed");

        assert!(matches!(error, ProjectError::TaskNotBlocked));
        assert_eq!(task_and_decision_files(root.path(), &directory), before);
    }

    #[test]
    fn task_resume_writes_nothing_while_a_lease_covers_the_task() {
        let (root, directory, _) = blocked_project();
        write_lease(
            root.path(),
            "TASK-900.yml",
            &format!(
                "schema_version: 1\nlease_id: lease-1\nagent: other\ntask_id: TASK-900\nheartbeat_at: 2026-08-01T00:00:00Z\nexpires_at: {}\n",
                (Utc::now() + Duration::minutes(30)).format("%Y-%m-%dT%H:%M:%SZ")
            ),
        );
        let before = task_and_decision_files(root.path(), &directory);

        let error = FileSystemProjectRepository
            .resume_task(
                root.path(),
                &resume_request(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect_err("leased task");

        assert!(matches!(error, ProjectError::TaskResumeLeased));
        assert_eq!(task_and_decision_files(root.path(), &directory), before);
        assert!(root
            .path()
            .join(".workflow/.runtime/leases/TASK-900.yml")
            .is_file());
    }

    #[test]
    fn task_resume_writes_nothing_while_a_migration_lock_exists() {
        let (root, directory, _) = blocked_project();
        let before = task_and_decision_files(root.path(), &directory);
        let _lock = ProjectWriteLock::acquire(&root.path().join(".workflow")).expect("lock");

        let error = FileSystemProjectRepository
            .resume_task(
                root.path(),
                &resume_request(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect_err("migration lock");

        assert!(matches!(
            error,
            ProjectError::ManagedProjectAssets(_) | ProjectError::ProjectWriteLock(_)
        ));
        assert_eq!(task_and_decision_files(root.path(), &directory), before);
    }

    #[test]
    fn task_resume_writes_nothing_for_an_unsafe_file_name_or_an_unknown_workflow() {
        let (root, directory, _) = blocked_project();
        let before = task_and_decision_files(root.path(), &directory);
        let repository = FileSystemProjectRepository;

        let mut unsafe_file = resume_request(&directory, "2026-08-01T00:00:00Z", "req-1");
        unsafe_file.file_name = "../tasks/TASK-900.md".to_owned();
        assert!(matches!(
            repository.resume_task(root.path(), &unsafe_file),
            Err(ProjectError::UnsafeDocumentFile(_))
        ));

        let mut unknown = resume_request("없는-워크플로우", "2026-08-01T00:00:00Z", "req-1");
        unknown.file_name = "TASK-900.md".to_owned();
        assert!(matches!(
            repository.resume_task(root.path(), &unknown),
            Err(ProjectError::UnknownWorkflow)
        ));

        assert_eq!(task_and_decision_files(root.path(), &directory), before);
    }

    #[test]
    fn task_resume_writes_nothing_under_a_future_project_schema() {
        let (root, directory, _) = blocked_project();
        let manifest = root.path().join(".workflow/project.yml");
        let source = fs::read_to_string(&manifest).expect("manifest");
        fs::write(
            &manifest,
            source.replace("schema_version: 1", "schema_version: 2"),
        )
        .expect("future manifest");
        let before = task_and_decision_files(root.path(), &directory);

        let error = FileSystemProjectRepository
            .resume_task(
                root.path(),
                &resume_request(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect_err("future schema");

        assert!(matches!(error, ProjectError::FutureSchema));
        assert_eq!(task_and_decision_files(root.path(), &directory), before);
    }

    #[test]
    fn task_resume_requires_a_resolution_and_a_request_id() {
        let (root, directory, _) = blocked_project();
        let before = task_and_decision_files(root.path(), &directory);
        let repository = FileSystemProjectRepository;

        let mut empty = resume_request(&directory, "2026-08-01T00:00:00Z", "req-1");
        empty.resolution = "   ".to_owned();
        assert!(matches!(
            repository.resume_task(root.path(), &empty),
            Err(ProjectError::ResumeResolutionRequired)
        ));

        let mut long = resume_request(&directory, "2026-08-01T00:00:00Z", "req-1");
        long.resolution = "가".repeat(2_001);
        assert!(matches!(
            repository.resume_task(root.path(), &long),
            Err(ProjectError::ResumeResolutionTooLong)
        ));

        let mut blank_id = resume_request(&directory, "2026-08-01T00:00:00Z", " ");
        blank_id.request_id = " ".to_owned();
        assert!(matches!(
            repository.resume_task(root.path(), &blank_id),
            Err(ProjectError::ResumeRequestIdRequired)
        ));

        assert_eq!(task_and_decision_files(root.path(), &directory), before);
    }

    #[test]
    fn task_resume_records_one_history_entry_and_one_audit_for_a_repeated_request() {
        let (root, directory, path) = blocked_project();
        let repository = FileSystemProjectRepository;
        let request = resume_request(&directory, "2026-08-01T00:00:00Z", "req-1");

        let first = repository
            .resume_task(root.path(), &request)
            .expect("first resume");
        let after_first = fs::read_to_string(&path).expect("task");
        let second = repository
            .resume_task(root.path(), &request)
            .expect("repeated resume");

        assert_eq!(first.status, TaskResumeStatus::Resumed);
        assert_eq!(second.status, TaskResumeStatus::Resumed);
        assert_eq!(resume_audits(root.path(), &directory).len(), 1);
        assert_eq!(fs::read_to_string(&path).expect("task"), after_first);
        assert_eq!(
            fs::read_to_string(&path)
                .expect("task")
                .matches("kind: resumed")
                .count(),
            1
        );
    }

    /// 더블 클릭처럼 같은 요청이 동시에 두 번 도착하는 경우. 쓰기 잠금이 한쪽을 물리므로 한쪽은
    /// 실패하거나, 잠금을 이어받아 이미 기록된 성공을 그대로 돌려받는다. 어느 쪽이든 기록은 한 건이다.
    #[test]
    fn task_resume_records_one_audit_for_two_concurrent_requests() {
        let (root, directory, path) = blocked_project();
        let request = resume_request(&directory, "2026-08-01T00:00:00Z", "req-1");

        let results = std::thread::scope(|scope| {
            let first =
                scope.spawn(|| FileSystemProjectRepository.resume_task(root.path(), &request));
            let second =
                scope.spawn(|| FileSystemProjectRepository.resume_task(root.path(), &request));
            [first.join().expect("first"), second.join().expect("second")]
        });

        assert!(results.iter().any(Result::is_ok), "한쪽은 성공해야 한다");
        assert_eq!(resume_audits(root.path(), &directory).len(), 1);
        assert_eq!(
            fs::read_to_string(&path)
                .expect("task")
                .matches("kind: resumed")
                .count(),
            1
        );
    }

    #[test]
    fn task_resume_does_not_guess_success_when_the_record_and_the_status_disagree() {
        let (root, directory, _) = blocked_project();
        // 감사 기록만 남고 작업 교체 전에 세션이 죽은 상태. 상태는 아직 `blocked`다.
        write_decision(
            root.path(),
            &directory,
            "RESUME-DEADBEEF.md",
            "---\nschema: workflow-labs/task-resume@1\nid: RESUME-DEADBEEF\ntask_id: TASK-900\noutcome: resumed\nrequest_id: req-1\nprevious_updated_at: 2026-08-01T00:00:00Z\ncreated_by: user\ncreated_at: 2026-08-02T00:00:00Z\n---\n\n먼저 남은 기록\n",
        );
        let before = task_and_decision_files(root.path(), &directory);

        let error = FileSystemProjectRepository
            .resume_task(
                root.path(),
                &resume_request(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect_err("inconsistent residue");

        assert!(matches!(error, ProjectError::TaskResumeInconsistent));
        assert_eq!(task_and_decision_files(root.path(), &directory), before);
    }

    #[test]
    fn task_resume_leaves_the_original_when_the_audit_cannot_be_written() {
        let (root, directory, _) = blocked_project();
        let decisions = root
            .path()
            .join(".workflow")
            .join(&directory)
            .join("decisions");
        fs::remove_dir_all(&decisions).expect("remove decisions");
        let before = task_and_decision_files(root.path(), &directory);

        let error = FileSystemProjectRepository
            .resume_task(
                root.path(),
                &resume_request(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect_err("audit write failure");

        assert!(matches!(error, ProjectError::Io(_)));
        assert_eq!(task_and_decision_files(root.path(), &directory), before);
        assert!(!decisions.exists());
    }

    #[cfg(unix)]
    #[test]
    fn task_resume_removes_the_audit_when_the_task_cannot_be_replaced() {
        use std::os::unix::fs::PermissionsExt;

        let (root, directory, _) = blocked_project();
        let before = task_and_decision_files(root.path(), &directory);
        let tasks = root.path().join(".workflow").join(&directory).join("tasks");
        fs::set_permissions(&tasks, fs::Permissions::from_mode(0o555)).expect("read-only tasks");

        let error = FileSystemProjectRepository.resume_task(
            root.path(),
            &resume_request(&directory, "2026-08-01T00:00:00Z", "req-1"),
        );

        fs::set_permissions(&tasks, fs::Permissions::from_mode(0o755)).expect("restore tasks");
        assert!(error.is_err());
        assert!(resume_audits(root.path(), &directory).is_empty());
        assert_eq!(task_and_decision_files(root.path(), &directory), before);
    }

    #[cfg(unix)]
    #[test]
    fn task_resume_reports_recovery_when_the_rollback_fails() {
        use std::os::unix::fs::PermissionsExt;

        let (root, directory, path) = blocked_project();
        let original = fs::read_to_string(&path).expect("task");
        let tasks = root.path().join(".workflow").join(&directory).join("tasks");
        fs::set_permissions(&tasks, fs::Permissions::from_mode(0o555)).expect("read-only tasks");

        let result = FileSystemProjectRepository.resume_task_with(
            root.path(),
            &resume_request(&directory, "2026-08-01T00:00:00Z", "req-1"),
            |_| {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "되돌리기 실패",
                ))
            },
        );

        fs::set_permissions(&tasks, fs::Permissions::from_mode(0o755)).expect("restore tasks");
        let result = result.expect("recovery result");
        assert_eq!(result.status, TaskResumeStatus::RecoveryRequired);
        let recovery = result.recovery.expect("recovery detail");
        let audits = resume_audits(root.path(), &directory);
        assert_eq!(audits.len(), 1);
        assert_eq!(recovery.created_paths.len(), 1);
        assert!(recovery.created_paths[0].contains("RESUME-"));
        assert!(recovery.reason.contains("되돌리기 실패"));
        assert!(!recovery.action.is_empty());
        // 작업 문서는 원본 그대로이고, 다음 조회가 이 상태를 완료로 읽지 않는다.
        assert_eq!(fs::read_to_string(&path).expect("task"), original);
        assert_eq!(
            result.summary.workflows[0]
                .items
                .tasks
                .iter()
                .find(|task| task.id == "TASK-900")
                .expect("task summary")
                .status,
            "blocked"
        );
    }

    #[test]
    fn task_resume_leaves_the_developer_verdict_ineligible_while_a_dependency_is_unsatisfied() {
        let root = tempdir().expect("temp project");
        let project = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        blocked_task(root.path(), &directory, "depends_on: [TASK-800]\n");
        // 선행이 `blocked`이므로 재개 뒤에도 충족되지 않고, 그 선행 자체도 후보가 아니다.
        fs::write(
            root.path()
                .join(".workflow")
                .join(&directory)
                .join("tasks/TASK-800.md"),
            "---\nschema: workflow-labs/task@1\nid: TASK-800\ntitle: 선행 작업\nstatus: blocked\nupdated_at: 2026-08-01T00:00:00Z\n---\n\n선행\n",
        )
        .expect("write dependency");

        let result = FileSystemProjectRepository
            .resume_task(
                root.path(),
                &resume_request(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect("resume task");

        assert_eq!(
            result.summary.workflows[0]
                .items
                .tasks
                .iter()
                .find(|task| task.id == "TASK-900")
                .expect("task summary")
                .status,
            "todo"
        );
        assert_eq!(result.summary.pending_work.developer, false);
    }

    /// 재개를 모르던 기존 QA 경로가 새 이력과 감사 문서를 만났을 때. 원문을 지우지도, 기존 결정으로
    /// 오인하지도 않는다.
    #[test]
    fn task_resume_records_survive_the_existing_qa_path() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        let path = qa_waiting_task(
            root.path(),
            &directory,
            "TASK-900.md",
            "schema: workflow-labs/task@1\nid: TASK-900\ntitle: 재개된 작업\nstatus: qa_waiting\nupdated_at: 2026-08-03T00:00:00Z\nhistory:\n  - { at: 2026-08-01T00:00:00Z, kind: blocked }\n  - { at: 2026-08-02T00:00:00Z, kind: resumed }\n  - { at: 2026-08-03T00:00:00Z, kind: qa_waiting }\n",
        );
        let audit = "---\nschema: workflow-labs/task-resume@1\nid: RESUME-DEADBEEF\ntask_id: TASK-900\noutcome: resumed\nrequest_id: req-1\nprevious_updated_at: 2026-08-01T00:00:00Z\ncreated_by: user\ncreated_at: 2026-08-02T00:00:00Z\n---\n\n규격이 확정됐다\n";
        write_decision(root.path(), &directory, "RESUME-DEADBEEF.md", audit);

        let summary = repository
            .record_task_qa(
                root.path(),
                &directory,
                "TASK-900.md",
                TaskQaOutcome::Confirmed,
                "확인했습니다.",
            )
            .expect("record qa");

        let task = fs::read_to_string(&path).expect("task");
        assert!(task.contains("- { at: 2026-08-02T00:00:00Z, kind: resumed }"));
        assert!(task.contains("status: completed"));
        assert_eq!(
            fs::read_to_string(
                root.path()
                    .join(".workflow")
                    .join(&directory)
                    .join("decisions/RESUME-DEADBEEF.md")
            )
            .expect("audit"),
            audit
        );
        assert_eq!(
            task_events(&summary, "TASK-900")
                .into_iter()
                .map(|(kind, _)| kind)
                .collect::<Vec<_>>(),
            vec!["blocked", "resumed", "qa_waiting", "completed"]
        );
    }

    #[test]
    fn a_resume_audit_does_not_reach_the_spec_or_qa_judgements() {
        let (root, directory, _) = blocked_project();
        write_spec_with_status(root.path(), &directory, "SPEC-900", "user_review");
        write_decision(
            root.path(),
            &directory,
            "DECISION-900.md",
            &spec_decision(
                "DECISION-900",
                "SPEC-900",
                "approved",
                "2026-08-01T00:00:00Z",
            ),
        );

        let result = FileSystemProjectRepository
            .resume_task(
                root.path(),
                &resume_request(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect("resume task");

        let spec = result.summary.workflows[0]
            .items
            .specs
            .iter()
            .find(|item| item.id == "SPEC-900")
            .expect("spec summary");
        assert_eq!(spec.status, "approved");
        assert_eq!(
            spec.events
                .iter()
                .map(|event| event.kind.as_str())
                .collect::<Vec<_>>(),
            vec!["approved"]
        );
        // 재개 기록은 작업 이벤트로만 읽히고 QA 결정 자리를 차지하지 않는다.
        assert_eq!(
            task_events(&result.summary, "TASK-900")
                .into_iter()
                .filter(|(kind, _)| kind == "completed" || kind == "revision_requested")
                .count(),
            0
        );
    }

    /// 미리보기 검사가 함께 쓰는 문서 하나. 본문을 그대로 받아 쓰므로 절의 모양을 검사마다 바꿀 수 있다.
    fn preview_task(root: &Path, directory: &str, id: &str, status: &str, body: &str) {
        fs::write(
            root.join(".workflow")
                .join(directory)
                .join("tasks")
                .join(format!("{id}.md")),
            format!(
                "---\nschema: workflow-labs/task@1\nid: {id}\ntitle: 미리보기 대상\nstatus: {status}\nupdated_at: 2026-08-08T00:00:00Z\n---\n\n{body}"
            ),
        )
        .expect("write preview task");
    }

    /// 목록에 실린 그 문서의 카드 미리보기.
    fn preview_of(project: &ProjectSummary, id: &str) -> String {
        project.workflows[0]
            .items
            .tasks
            .iter()
            .chain(project.workflows[0].items.specs.iter())
            .chain(project.workflows[0].items.ideas.iter())
            .find(|item| item.id == id)
            .expect("summary")
            .excerpt
            .clone()
    }

    fn walkthrough_body(section: &str) -> String {
        format!("# 미리보기 대상\n\n## 결정권자 요약\n\n요약 문장이 먼저 온다.\n\n{section}")
    }

    #[test]
    fn a_qa_waiting_card_previews_the_first_paragraph_of_the_walkthrough() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();

        // 화면이 있는 작업, 화면이 없는 작업, 확인 동선이 없는 대기 작업, 대기가 아닌 작업.
        preview_task(
            root.path(),
            &directory,
            "TASK-700",
            "qa_waiting",
            &walkthrough_body(
                "## 확인 동선\n\n개발 화면에서 막힘 열의 카드를 열고\n오른쪽 패널의 재개 영역을 확인한다.\n\n1. 근거를 입력한다.\n",
            ),
        );
        preview_task(
            root.path(),
            &directory,
            "TASK-701",
            "qa_waiting",
            &walkthrough_body(
                "## 확인 동선\n\n이 작업에는 눈으로 볼 화면이 없다. 자동 검사로 닫았고 확인 도장은 그 수치를 신뢰한다는 뜻이다.\n",
            ),
        );
        preview_task(
            root.path(),
            &directory,
            "TASK-702",
            "qa_waiting",
            "# 미리보기 대상\n\n## 결정권자 요약\n\n확인 동선 절이 없는 대기 작업이다.\n",
        );
        preview_task(
            root.path(),
            &directory,
            "TASK-703",
            "todo",
            &walkthrough_body("## 확인 동선\n\n아직 대기가 아니므로 카드에는 실리지 않는다.\n"),
        );

        let project = repository.inspect(root.path()).expect("inspect project");

        assert_eq!(
            preview_of(&project, "TASK-700"),
            "개발 화면에서 막힘 열의 카드를 열고 오른쪽 패널의 재개 영역을 확인한다."
        );
        assert_eq!(
            preview_of(&project, "TASK-701"),
            "이 작업에는 눈으로 볼 화면이 없다. 자동 검사로 닫았고 확인 도장은 그 수치를 신뢰한다는 뜻이다."
        );
        // 절이 없는 대기 작업과 대기가 아닌 작업은 기존 발췌 그대로다.
        assert_eq!(
            preview_of(&project, "TASK-702"),
            "확인 동선 절이 없는 대기 작업이다."
        );
        assert_eq!(
            preview_of(&project, "TASK-703"),
            "요약 문장이 먼저 온다. 아직 대기가 아니므로 카드에는 실리지 않는다."
        );
    }

    #[test]
    fn ideas_and_specs_keep_their_previews() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let project = repository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let directory = project.workflows[0].directory.clone();
        // 상태 값이 `qa_waiting`인 아이디어·기획서는 없지만, 있어도 카드가 바뀌지 않는다는 것을
        // 같은 본문으로 확인한다.
        fs::write(
            root.path()
                .join(".workflow")
                .join(&directory)
                .join("ideas/IDEA-700.md"),
            format!(
                "---\nschema: workflow-labs/idea@1\nid: IDEA-700\ntitle: 아이디어\nupdated_at: 2026-08-08T00:00:00Z\n---\n\n{}",
                walkthrough_body("## 확인 동선\n\n아이디어에는 이 규칙이 닿지 않는다.\n")
            ),
        )
        .expect("write idea");
        fs::write(
            root.path()
                .join(".workflow")
                .join(&directory)
                .join("specs/SPEC-700.md"),
            format!(
                "---\nschema: workflow-labs/spec@1\nid: SPEC-700\ntitle: 기획서\nstatus: user_review\nupdated_at: 2026-08-08T00:00:00Z\n---\n\n{}",
                walkthrough_body("## 확인 동선\n\n기획서에도 닿지 않는다.\n")
            ),
        )
        .expect("write spec");

        let project = repository.inspect(root.path()).expect("inspect project");

        assert_eq!(
            preview_of(&project, "IDEA-700"),
            "요약 문장이 먼저 온다. 아이디어에는 이 규칙이 닿지 않는다."
        );
        assert_eq!(
            preview_of(&project, "SPEC-700"),
            "요약 문장이 먼저 온다. 기획서에도 닿지 않는다."
        );
    }

    #[test]
    fn only_the_exact_heading_counts_as_the_walkthrough() {
        let excerpt_of = |section: &str| {
            let body = walkthrough_body(section);
            (walkthrough_preview(&body), markdown_excerpt(&body))
        };

        // 철자, 제목 깊이, 앞뒤 공백이 다른 제목은 보완하지 않는다.
        for section in [
            "## 확인동선\n\n붙여 쓴 제목이다.\n",
            "### 확인 동선\n\n깊이가 다르다.\n",
            "##  확인 동선\n\n제목 안의 공백이 다르다.\n",
            "## 확인 동선 \n\n뒤에 공백이 붙었다.\n",
            "## 확인 동선입니다\n\n제목이 더 길다.\n",
        ] {
            assert_eq!(
                excerpt_of(section).0,
                None,
                "{section}에서 절로 인정됐습니다"
            );
        }

        // 코드 울타리 안의 같은 문자열은 제목이 아니다.
        let fenced = walkthrough_body("```markdown\n## 확인 동선\n\n예시 안의 문장이다.\n```\n");
        assert_eq!(walkthrough_preview(&fenced), None);
    }

    #[test]
    fn an_empty_walkthrough_section_falls_back_to_the_excerpt() {
        // 절 뒤에 곧바로 다음 제목이 오는 경우와 코드 울타리가 오는 경우 모두 문단이 없다.
        for section in [
            "## 확인 동선\n\n## 다음 절\n\n다음 절의 문장이다.\n",
            "## 확인 동선\n\n```sh\ncargo test\n```\n",
            "## 확인 동선\n",
        ] {
            let body = walkthrough_body(section);
            assert_eq!(walkthrough_preview(&body), None, "{section}");
        }
    }

    #[test]
    fn a_long_walkthrough_paragraph_is_clipped_like_the_excerpt() {
        let long = "가".repeat(200);
        let body = walkthrough_body(&format!("## 확인 동선\n\n{long}\n"));
        let preview = walkthrough_preview(&body).expect("preview");

        assert_eq!(preview.chars().count(), 161);
        assert!(preview.ends_with('…'));
        assert_eq!(
            preview.chars().take(160).collect::<String>(),
            long.chars().take(160).collect::<String>()
        );
        // 기존 발췌와 같은 한도를 쓴다.
        assert_eq!(markdown_excerpt(&long).chars().count(), 161);
    }

    /// 미리보기는 이미 읽어 둔 본문 문자열 하나로 만들어진다. 이 함수가 파일 경로를 받지 않는다는 것이
    /// 조회가 파일을 더 열지 않는다는 뜻이다.
    #[test]
    fn the_walkthrough_preview_reads_only_the_body_it_is_given() {
        let body = walkthrough_body("## 확인 동선\n\n한 줄짜리 문단이다.\n");
        assert_eq!(
            walkthrough_preview(&body),
            Some("한 줄짜리 문단이다.".to_owned())
        );
    }

    fn revision_input(
        directory: &str,
        expected_updated_at: &str,
        request_id: &str,
    ) -> TaskRevisionRequestInput {
        TaskRevisionRequestInput {
            workflow_directory: directory.to_owned(),
            file_name: "TASK-900.md".to_owned(),
            expected_updated_at: expected_updated_at.to_owned(),
            reason: "완료 조건이 선언 범위 밖 파일을 요구한다.".to_owned(),
            request_id: request_id.to_owned(),
        }
    }

    fn revision_documents(root: &Path, directory: &str) -> Vec<String> {
        fs::read_dir(root.join(".workflow").join(directory).join("decisions"))
            .expect("decisions")
            .filter_map(Result::ok)
            .filter_map(|entry| fs::read_to_string(entry.path()).ok())
            .filter(|text| text.contains("schema: workflow-labs/task-revision-request@1"))
            .collect()
    }

    fn set_task_status(path: &Path, status: &str) {
        let source = fs::read_to_string(path).expect("task");
        fs::write(
            path,
            source.replace("status: blocked", &format!("status: {status}")),
        )
        .expect("rewrite status");
    }

    fn read_task_requests(root: &Path, directory: &str) -> Vec<TaskRevisionRequest> {
        FileSystemProjectRepository
            .read_task(root, directory, "TASK-900.md")
            .expect("read task")
            .revision_requests
    }

    #[test]
    fn a_revision_request_is_recorded_without_touching_the_task() {
        let (root, directory, path) = blocked_project();
        let before = fs::read_to_string(&path).expect("task");

        let result = FileSystemProjectRepository
            .record_task_revision_request(
                root.path(),
                &revision_input(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect("record request");

        assert_eq!(result.status, TaskRevisionRequestStatus::Recorded);
        let documents = revision_documents(root.path(), &directory);
        assert_eq!(documents.len(), 1);
        let document = &documents[0];
        assert_eq!(audit_field(document, "task_id"), "TASK-900");
        assert_eq!(audit_field(document, "request_id"), "req-1");
        assert_eq!(
            audit_field(document, "previous_updated_at"),
            "2026-08-01T00:00:00Z"
        );
        assert_eq!(audit_field(document, "created_by"), "user");
        assert!(document.contains("완료 조건이 선언 범위 밖 파일을 요구한다."));
        // 요청 저장은 작업 문서를 바꾸지 않는다.
        assert_eq!(fs::read_to_string(&path).expect("task"), before);

        let recorded = result.request.expect("recorded request");
        assert!(!recorded.handled);
        let listed = read_task_requests(root.path(), &directory);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, recorded.id);
        assert_eq!(
            listed[0].reason,
            "완료 조건이 선언 범위 밖 파일을 요구한다."
        );
        assert!(!listed[0].handled);
    }

    #[test]
    fn a_todo_task_without_a_lease_also_accepts_a_request() {
        let (root, directory, path) = blocked_project();
        set_task_status(&path, "todo");

        let result = FileSystemProjectRepository
            .record_task_revision_request(
                root.path(),
                &revision_input(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect("record request");

        assert_eq!(result.status, TaskRevisionRequestStatus::Recorded);
        assert_eq!(revision_documents(root.path(), &directory).len(), 1);
    }

    #[test]
    fn the_other_states_refuse_a_revision_request() {
        for status in ["in_progress", "qa_waiting", "completed"] {
            let (root, directory, path) = blocked_project();
            set_task_status(&path, status);
            let before = task_and_decision_files(root.path(), &directory);

            let error = FileSystemProjectRepository
                .record_task_revision_request(
                    root.path(),
                    &revision_input(&directory, "2026-08-01T00:00:00Z", "req-1"),
                )
                .expect_err("state refused");

            assert!(matches!(error, ProjectError::TaskNotRevisable), "{status}");
            assert_eq!(task_and_decision_files(root.path(), &directory), before);
        }
    }

    #[test]
    fn a_lease_a_lock_and_a_stale_time_each_write_nothing() {
        // 선점 중.
        let (root, directory, _) = blocked_project();
        write_lease(
            root.path(),
            "TASK-900.yml",
            &format!(
                "schema_version: 1\nlease_id: lease-1\nagent: other\ntask_id: TASK-900\nheartbeat_at: 2026-08-01T00:00:00Z\nexpires_at: {}\n",
                (Utc::now() + Duration::minutes(30)).format("%Y-%m-%dT%H:%M:%SZ")
            ),
        );
        let before = task_and_decision_files(root.path(), &directory);
        let error = FileSystemProjectRepository
            .record_task_revision_request(
                root.path(),
                &revision_input(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect_err("leased");
        assert!(matches!(error, ProjectError::TaskRevisionLeased));
        assert_eq!(task_and_decision_files(root.path(), &directory), before);

        // 마이그레이션 잠금 중.
        let (root, directory, _) = blocked_project();
        let before = task_and_decision_files(root.path(), &directory);
        let _lock = ProjectWriteLock::acquire(&root.path().join(".workflow")).expect("lock");
        let error = FileSystemProjectRepository
            .record_task_revision_request(
                root.path(),
                &revision_input(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect_err("migration lock");
        assert!(matches!(
            error,
            ProjectError::ManagedProjectAssets(_) | ProjectError::ProjectWriteLock(_)
        ));
        assert_eq!(task_and_decision_files(root.path(), &directory), before);
        drop(_lock);

        // 오래된 갱신 시각.
        let (root, directory, _) = blocked_project();
        let before = task_and_decision_files(root.path(), &directory);
        let error = FileSystemProjectRepository
            .record_task_revision_request(
                root.path(),
                &revision_input(&directory, "2026-07-01T00:00:00Z", "req-1"),
            )
            .expect_err("stale");
        assert!(matches!(error, ProjectError::TaskRevisionStale));
        assert_eq!(task_and_decision_files(root.path(), &directory), before);
    }

    #[test]
    fn an_empty_reason_is_refused_before_anything_is_written() {
        let (root, directory, _) = blocked_project();
        let before = task_and_decision_files(root.path(), &directory);
        let mut request = revision_input(&directory, "2026-08-01T00:00:00Z", "req-1");
        request.reason = "   ".to_owned();

        let error = FileSystemProjectRepository
            .record_task_revision_request(root.path(), &request)
            .expect_err("empty reason");

        assert!(matches!(error, ProjectError::RevisionReasonRequired));
        assert_eq!(task_and_decision_files(root.path(), &directory), before);
    }

    #[test]
    fn repeating_the_same_revision_request_records_one_document() {
        let (root, directory, _) = blocked_project();
        let repository = FileSystemProjectRepository;
        let request = revision_input(&directory, "2026-08-01T00:00:00Z", "req-1");

        let first = repository
            .record_task_revision_request(root.path(), &request)
            .expect("first");
        let second = repository
            .record_task_revision_request(root.path(), &request)
            .expect("repeat");

        assert_eq!(first.status, TaskRevisionRequestStatus::Recorded);
        assert_eq!(second.status, TaskRevisionRequestStatus::Recorded);
        assert_eq!(
            first.request.map(|entry| entry.id),
            second.request.map(|entry| entry.id)
        );
        assert_eq!(revision_documents(root.path(), &directory).len(), 1);
    }

    #[test]
    fn two_concurrent_revision_requests_record_one_document() {
        let (root, directory, _) = blocked_project();
        let request = revision_input(&directory, "2026-08-01T00:00:00Z", "req-1");

        let results = std::thread::scope(|scope| {
            let first = scope.spawn(|| {
                FileSystemProjectRepository.record_task_revision_request(root.path(), &request)
            });
            let second = scope.spawn(|| {
                FileSystemProjectRepository.record_task_revision_request(root.path(), &request)
            });
            [first.join().expect("first"), second.join().expect("second")]
        });

        assert!(results.iter().any(Result::is_ok), "한쪽은 성공해야 한다");
        assert_eq!(revision_documents(root.path(), &directory).len(), 1);
    }

    #[test]
    fn a_second_request_waits_while_one_is_pending() {
        let (root, directory, _) = blocked_project();
        let repository = FileSystemProjectRepository;
        repository
            .record_task_revision_request(
                root.path(),
                &revision_input(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect("first request");

        let second = repository
            .record_task_revision_request(
                root.path(),
                &revision_input(&directory, "2026-08-01T00:00:00Z", "req-2"),
            )
            .expect("second request");

        assert_eq!(second.status, TaskRevisionRequestStatus::AlreadyPending);
        assert_eq!(revision_documents(root.path(), &directory).len(), 1);
        // 돌려주는 값은 이미 남아 있는 그 요청이다.
        assert_eq!(
            second.request.expect("pending request").id,
            read_task_requests(root.path(), &directory)[0].id
        );
    }

    #[test]
    fn the_linked_id_alone_decides_that_a_request_was_handled() {
        let (root, directory, path) = blocked_project();
        let repository = FileSystemProjectRepository;
        let recorded = repository
            .record_task_revision_request(
                root.path(),
                &revision_input(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect("record request")
            .request
            .expect("recorded");

        assert!(!read_task_requests(root.path(), &directory)[0].handled);

        // 아키텍트가 요청을 처리하고 그 id를 작업에 연결한 상태.
        let source = fs::read_to_string(&path).expect("task");
        fs::write(
            &path,
            source.replace(
                "owner: 나\n",
                &format!("owner: 나\nrevision_request_id: {}\n", recorded.id),
            ),
        )
        .expect("link request");

        let listed = read_task_requests(root.path(), &directory);
        assert_eq!(listed.len(), 1);
        assert!(listed[0].handled);
        // 미처리 요청이 없으므로 다음 요청은 다시 받는다.
        let next = repository
            .record_task_revision_request(
                root.path(),
                &revision_input(&directory, "2026-08-01T00:00:00Z", "req-2"),
            )
            .expect("next request");
        assert_eq!(next.status, TaskRevisionRequestStatus::Recorded);
        assert_eq!(revision_documents(root.path(), &directory).len(), 2);
    }

    #[test]
    fn a_damaged_request_document_is_skipped_by_the_read() {
        let (root, directory, _) = blocked_project();
        FileSystemProjectRepository
            .record_task_revision_request(
                root.path(),
                &revision_input(&directory, "2026-08-01T00:00:00Z", "req-1"),
            )
            .expect("record request");
        // 시각을 읽을 수 없는 문서와 앱이 쓰지 않은 문서를 함께 둔다.
        write_decision(
            root.path(),
            &directory,
            "REVISION-DAMAGED.md",
            "---\nschema: workflow-labs/task-revision-request@1\nid: REVISION-DAMAGED\ntask_id: TASK-900\nrequest_id: req-x\nprevious_updated_at: 2026-08-01T00:00:00Z\ncreated_by: user\ncreated_at: 어제\n---\n\n시각이 깨진 요청\n",
        );
        write_decision(
            root.path(),
            &directory,
            "REVISION-AGENT.md",
            "---\nschema: workflow-labs/task-revision-request@1\nid: REVISION-AGENT\ntask_id: TASK-900\nrequest_id: req-y\nprevious_updated_at: 2026-08-01T00:00:00Z\ncreated_by: agent\ncreated_at: 2026-08-02T00:00:00Z\n---\n\n에이전트가 쓴 요청\n",
        );

        let listed = read_task_requests(root.path(), &directory);

        assert_eq!(listed.len(), 1);
        assert_eq!(
            listed[0].reason,
            "완료 조건이 선언 범위 밖 파일을 요구한다."
        );
    }

    #[test]
    fn a_project_without_requests_reads_exactly_as_before() {
        let (root, directory, _) = blocked_project();
        write_spec_with_status(root.path(), &directory, "SPEC-900", "user_review");
        write_decision(
            root.path(),
            &directory,
            "DECISION-900.md",
            &spec_decision(
                "DECISION-900",
                "SPEC-900",
                "approved",
                "2026-08-01T00:00:00Z",
            ),
        );

        let document = FileSystemProjectRepository
            .read_task(root.path(), &directory, "TASK-900.md")
            .expect("read task");
        let project = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project");

        assert!(document.revision_requests.is_empty());
        assert_eq!(
            project.workflows[0]
                .items
                .specs
                .iter()
                .find(|item| item.id == "SPEC-900")
                .expect("spec")
                .status,
            "approved"
        );
    }
}
