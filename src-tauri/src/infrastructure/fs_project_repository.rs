use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use chrono::{DateTime, Utc};
use tempfile::NamedTempFile;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::project::{
    AgentLease, AgentLeaseSummary, ProjectManifest, ProjectSummary, SchemaCompatibility,
    SpecDecisionOutcome, SpecDocument, WorkflowCounts, WorkflowEntry, WorkflowItemSummary,
    WorkflowItems, WorkflowManifest, WorkflowStatus, PROJECT_SCHEMA_VERSION,
};
use crate::infrastructure::project_instructions::{
    install_project_instructions, validate_project_instructions, ProjectInstructionError,
};

const CONTROL_DIRECTORY: &str = ".workflow";
const PROJECT_MANIFEST: &str = "project.yml";
const WORKFLOW_MANIFEST: &str = "workflow.yml";
const RUNTIME_DIRECTORY: &str = ".runtime";
const WORKFLOW_DIRECTORIES: [&str; 6] =
    ["ideas", "specs", "decisions", "tasks", "reports", "state"];

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
    #[error("사용자 선택 대기 상태인 기획서만 승인하거나 폐기할 수 있습니다.")]
    SpecNotAwaitingDecision,
    #[error("기획서를 폐기할 때는 코멘트를 입력해 주세요.")]
    RejectionCommentRequired,
    #[error("결정 코멘트는 2,000자 이하여야 합니다.")]
    DecisionCommentTooLong,
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
    ProjectInstructions(#[from] ProjectInstructionError),
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
        validate_project_instructions(&root, &control_root)?;
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

        install_project_instructions(&root, &control_root)?;

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

        Ok(summary_from_manifest(
            &root,
            project,
            SchemaCompatibility::Current,
            Vec::new(),
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
        let workflow_root = registered_workflow_root(&control_root, &project, workflow_directory)?;
        let spec_path = safe_markdown_file(&workflow_root.join("specs"), file_name)?;
        let (mut spec, _) = read_markdown_document(&spec_path, "draft")?;
        normalize_spec_status(&mut spec);
        apply_latest_decision(&workflow_root, &mut spec);
        if spec.status != "user_review" {
            return Err(ProjectError::SpecNotAwaitingDecision);
        }

        let decision_id = format!("DECISION-{}", compact_uuid()[..8].to_uppercase());
        let created_at = Utc::now().to_rfc3339();
        let outcome_value = match outcome {
            SpecDecisionOutcome::Approved => "approved",
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

        if !read_active_leases(&control_root)?.is_empty() {
            return Err(ProjectError::ActiveLeases);
        }

        let _lock = MigrationLock::acquire(&control_root)?;
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

struct MigrationLock {
    path: PathBuf,
}

impl MigrationLock {
    fn acquire(control_root: &Path) -> Result<Self, ProjectError> {
        let runtime = control_root.join(RUNTIME_DIRECTORY);
        fs::create_dir_all(&runtime)?;
        let path = runtime.join("migration.lock");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        writeln!(file, "created_at: {}", Utc::now().to_rfc3339())?;
        file.sync_all()?;
        Ok(Self { path })
    }
}

impl Drop for MigrationLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
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

fn read_active_leases(control_root: &Path) -> Result<Vec<AgentLeaseSummary>, ProjectError> {
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
        let file = match File::open(path) {
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
            leases.push(AgentLeaseSummary {
                lease_id: lease.lease_id,
                agent: lease.agent,
                task_id: lease.task_id,
                expires_at: lease.expires_at,
            });
        }
    }
    leases.sort_by(|left, right| left.expires_at.cmp(&right.expires_at));
    Ok(leases)
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
            .map(|workflow| {
                let workflow_root = control_root.join(&workflow.directory);
                let items = workflow_items(&workflow_root);
                workflow.to_summary(workflow_counts(&workflow_root, &items), items)
            })
            .collect(),
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

fn validate_decision(outcome: &SpecDecisionOutcome, comment: &str) -> Result<(), ProjectError> {
    let trimmed = comment.trim();
    if matches!(outcome, SpecDecisionOutcome::Rejected) && trimmed.is_empty() {
        return Err(ProjectError::RejectionCommentRequired);
    }
    if trimmed.chars().count() > 2_000 {
        return Err(ProjectError::DecisionCommentTooLong);
    }
    Ok(())
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

fn workflow_items(workflow_root: &Path) -> WorkflowItems {
    let mut specs = read_markdown_summaries(&workflow_root.join("specs"), "draft");
    let decisions = latest_spec_decisions(workflow_root);
    for spec in &mut specs {
        normalize_spec_status(spec);
        if let Some((_, outcome)) = decisions.get(&spec.id) {
            spec.status.clone_from(outcome);
        }
    }
    WorkflowItems {
        ideas: read_markdown_summaries(&workflow_root.join("ideas"), "inbox"),
        specs,
        tasks: read_markdown_summaries(&workflow_root.join("tasks"), "todo"),
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
    items.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.file_name.cmp(&right.file_name))
    });
    items
}

fn read_markdown_document(
    path: &Path,
    default_status: &str,
) -> Result<(WorkflowItemSummary, String), ProjectError> {
    let contents = fs::read_to_string(path)?;
    let normalized = contents.replace("\r\n", "\n");
    let (metadata, body) = split_frontmatter(&normalized);
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
    let title = yaml_text(metadata.as_ref(), "title")
        .or_else(|| markdown_title(&body))
        .or_else(|| markdown_plain_title(&body))
        .unwrap_or_else(|| fallback_id.clone());
    let updated_at = yaml_text(metadata.as_ref(), "updated_at")
        .or_else(|| yaml_text(metadata.as_ref(), "created_at"))
        .or_else(|| {
            fs::metadata(path)
                .and_then(|value| value.modified())
                .ok()
                .map(|value| DateTime::<Utc>::from(value).to_rfc3339())
        });
    Ok((
        WorkflowItemSummary {
            file_name,
            id: yaml_text(metadata.as_ref(), "id").unwrap_or(fallback_id),
            title,
            status: yaml_text(metadata.as_ref(), "status")
                .unwrap_or_else(|| default_status.to_owned()),
            updated_at,
            excerpt: markdown_excerpt(&body),
        },
        body.trim().to_owned(),
    ))
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
    let mut excerpt: String = joined.chars().take(160).collect();
    if joined.chars().count() > 160 {
        excerpt.push('…');
    }
    excerpt
}

fn latest_spec_decisions(workflow_root: &Path) -> HashMap<String, (String, String)> {
    let mut latest = HashMap::new();
    let Ok(entries) = fs::read_dir(workflow_root.join("decisions")) else {
        return latest;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        let Ok(contents) = fs::read_to_string(path) else {
            continue;
        };
        let normalized = contents.replace("\r\n", "\n");
        let (metadata, _) = split_frontmatter(&normalized);
        if yaml_text(metadata.as_ref(), "schema").as_deref() != Some("workflow-labs/decision@1")
            || yaml_text(metadata.as_ref(), "created_by").as_deref() != Some("user")
        {
            continue;
        }
        let Some(spec_id) = yaml_text(metadata.as_ref(), "spec_id") else {
            continue;
        };
        let Some(outcome) = yaml_text(metadata.as_ref(), "outcome") else {
            continue;
        };
        if outcome != "approved" && outcome != "rejected" {
            continue;
        }
        let created_at = yaml_text(metadata.as_ref(), "created_at").unwrap_or_default();
        let should_replace = latest
            .get(&spec_id)
            .is_none_or(|(current, _)| created_at >= *current);
        if should_replace {
            latest.insert(spec_id, (created_at, outcome));
        }
    }
    latest
}

fn apply_latest_decision(workflow_root: &Path, spec: &mut WorkflowItemSummary) {
    if let Some((_, outcome)) = latest_spec_decisions(workflow_root).get(&spec.id) {
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
        "# {name}\n\n워크플로우 ID: `{id}`\n\n## 외부 LLM 작업 규약\n\n1. 쓰기 전에 `../.runtime/migration.lock`이 없는지 확인합니다.\n2. 아이디어는 `ideas/`, 기획서는 `specs/`, 개발 작업은 `tasks/`, 결과는 `reports/`에 기록합니다.\n3. 사용자 결정이 필요한 기획서는 `status: user_review`로 저장합니다.\n4. `decisions/`는 앱이 사용자 선택을 기록하는 감사 로그입니다. 외부 LLM은 이 파일을 만들거나 덮어쓰지 않습니다.\n5. 기획서 승인 여부는 기획서 원문이 아니라 최신 decision 문서로 판단합니다.\n6. 앱 소유 상태 파일, 문서 식별자와 알 수 없는 기존 메타데이터를 보존합니다.\n\n## 필수 frontmatter\n\n### 기획서 (`specs/*.md`)\n\n```yaml\nschema: workflow-labs/spec@1\nid: SPEC-001\ntitle: 문서 제목\nstatus: draft # draft | user_review\ncreated_at: RFC3339\nupdated_at: RFC3339\n```\n\n본문에는 `기획 내용`, `요구사항 명세`, `기대효과` 섹션을 권장합니다.\n\n### 개발 작업 (`tasks/*.md`)\n\n```yaml\nschema: workflow-labs/task@1\nid: TASK-001\ntitle: 작업 제목\nstatus: todo # todo | in_progress | blocked | qa_waiting | completed\nupdated_at: RFC3339\n```\n\n동시에 수정하면 충돌할 수 있는 작업은 병렬로 진행하지 않습니다.\n"
    )
}

#[cfg(test)]
mod tests {
    use std::fs;

    use chrono::{Duration, Utc};
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use super::{slugify, validate_decision, FileSystemProjectRepository, ProjectError};
    use crate::domain::project::{SchemaCompatibility, SpecDecisionOutcome};

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
        assert!(root.path().join("AGENTS.md").is_file());
        assert!(root.path().join("CLAUDE.md").is_file());
        assert!(root.path().join(".workflow/rules/workflow.md").is_file());
        assert_eq!(
            fs::read_to_string(root.path().join(".workflow/.gitignore")).expect("nested gitignore"),
            ".runtime/\n"
        );
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
    fn requires_a_comment_when_rejecting_a_spec() {
        let error = validate_decision(&SpecDecisionOutcome::Rejected, "   ")
            .expect_err("empty rejection comment must fail");
        assert!(matches!(error, ProjectError::RejectionCommentRequired));
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

        assert!(matches!(error, ProjectError::ProjectInstructions(_)));
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
}
