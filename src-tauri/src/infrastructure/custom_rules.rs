use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use thiserror::Error;

use crate::domain::project::{
    CustomRuleRole, CustomRulesDocument, CustomRulesDraft, CustomRulesFileStatus,
    CustomRulesPreview, CustomRulesRolePreview, CustomRulesSourceKind, CustomRulesSourcePreview,
    SaveCustomRulesRequest, SaveCustomRulesResult, SaveCustomRulesStatus,
};
use crate::infrastructure::project_write_lock::{ProjectWriteLock, ProjectWriteLockError};

const RULES_DIRECTORY: &str = "rules";
const CUSTOM_RULES_FILE: &str = "custom.md";
const WORKFLOW_RULES_FILE: &str = "workflow.md";
const ROLES_DIRECTORY: &str = "roles";
const CUSTOM_RULES_SCHEMA: &str = "workflow-labs/custom-rules@1";
const MAX_BODY_BYTES: usize = 64 * 1024;
const PRIORITY_NOTICE: &str = "앱 기본 규칙과 역할 계약이 사용자 정의 규칙보다 항상 우선합니다.";

const ROLES: [(CustomRuleRole, &str, &str); 3] = [
    (CustomRuleRole::Planner, "기획자", "planner.md"),
    (CustomRuleRole::Architect, "아키텍트", "architect.md"),
    (CustomRuleRole::Developer, "개발자", "developer.md"),
];

#[derive(Debug, Error)]
pub enum CustomRulesError {
    #[error("사용자 정의 규칙 초안이 올바르지 않습니다: {0}")]
    InvalidDraft(String),
    #[error("사용자 정의 규칙 미리보기와 저장 요청이 일치하지 않습니다.")]
    PreviewMismatch,
    #[error("최종 적용 규칙을 준비하지 못했습니다: {0}")]
    ManagedSource(String),
    #[error("사용자 정의 규칙 파일을 처리하지 못했습니다: {0}")]
    Io(#[from] std::io::Error),
    #[error("사용자 정의 규칙 파일을 안전하게 저장하지 못했습니다: {0}")]
    Persist(String),
    #[error(transparent)]
    ProjectWriteLock(#[from] ProjectWriteLockError),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CustomRulesMetadata {
    schema: String,
    enabled: bool,
    applies_to: Vec<CustomRuleRole>,
    updated_at: String,
}

pub fn read_custom_rules(control_root: &Path) -> Result<CustomRulesDocument, CustomRulesError> {
    let path = custom_rules_path(control_root);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(absent_document()),
        Err(error) => return Err(error.into()),
    };
    let modified_at = metadata
        .modified()
        .ok()
        .map(|value| DateTime::<Utc>::from(value).to_rfc3339());
    if !metadata.file_type().is_file() {
        return Ok(CustomRulesDocument {
            status: CustomRulesFileStatus::UnsafeFile,
            enabled: false,
            applies_to: Vec::new(),
            body: String::new(),
            updated_at: None,
            modified_at,
            raw: None,
            content_hash: None,
            error: Some("심볼릭 링크나 일반 파일이 아닌 항목은 읽지 않습니다.".to_owned()),
        });
    }

    let bytes = fs::read(&path)?;
    let content_hash = Some(content_hash(&bytes));
    let raw = match String::from_utf8(bytes) {
        Ok(raw) => raw,
        Err(_) => {
            return Ok(invalid_document(
                None,
                content_hash,
                modified_at,
                "UTF-8 문서가 아닙니다.".to_owned(),
            ))
        }
    };
    parse_document(raw, content_hash, modified_at)
}

pub fn prepare_custom_rules_preview(
    control_root: &Path,
    draft: CustomRulesDraft,
) -> Result<CustomRulesPreview, CustomRulesError> {
    let updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    prepare_custom_rules_preview_at(control_root, draft, &updated_at)
}

pub fn save_custom_rules(
    control_root: &Path,
    request: SaveCustomRulesRequest,
) -> Result<SaveCustomRulesResult, CustomRulesError> {
    let draft = normalize_and_validate_draft(request.draft)?;
    validate_timestamp(&request.updated_at)
        .map_err(|reason| CustomRulesError::InvalidDraft(reason.to_owned()))?;
    let serialized = serialize_document(&draft, &request.updated_at);
    if content_hash(serialized.as_bytes()) != request.preview_hash {
        return Err(CustomRulesError::PreviewMismatch);
    }

    let _lock = match ProjectWriteLock::acquire(control_root) {
        Ok(lock) => lock,
        Err(ProjectWriteLockError::Busy) => {
            return Ok(SaveCustomRulesResult {
                status: SaveCustomRulesStatus::RetryRequired,
                document: read_custom_rules(control_root)?,
                reason: Some("다른 프로젝트 쓰기 작업이 끝난 뒤 다시 시도해 주세요.".to_owned()),
            })
        }
        Err(error) => return Err(error.into()),
    };

    let current = read_custom_rules(control_root)?;
    if current.status == CustomRulesFileStatus::UnsafeFile {
        return Ok(conflict_result(
            current,
            "심볼릭 링크나 일반 파일이 아닌 항목은 덮어쓰지 않습니다.",
        ));
    }
    if current.content_hash != request.expected_content_hash {
        return Ok(conflict_result(
            current,
            "마지막 조회 뒤 사용자 정의 규칙 파일이 바뀌었습니다.",
        ));
    }

    let path = custom_rules_path(control_root);
    let parent = path
        .parent()
        .ok_or_else(|| CustomRulesError::Persist("상위 디렉터리가 없습니다.".to_owned()))?;
    ensure_rules_directory(parent)?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(serialized.as_bytes())?;
    temporary.as_file().sync_all()?;

    let before_commit = read_custom_rules(control_root)?;
    if before_commit.status == CustomRulesFileStatus::UnsafeFile
        || before_commit.content_hash != request.expected_content_hash
    {
        return Ok(conflict_result(
            before_commit,
            "저장 직전에 사용자 정의 규칙 파일이 바뀌었습니다.",
        ));
    }

    if request.expected_content_hash.is_none() {
        if let Err(error) = temporary.persist_noclobber(&path) {
            if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                return Ok(conflict_result(
                    read_custom_rules(control_root)?,
                    "저장 직전에 사용자 정의 규칙 파일이 만들어졌습니다.",
                ));
            }
            return Err(CustomRulesError::Persist(error.error.to_string()));
        }
    } else {
        temporary
            .persist(&path)
            .map_err(|error| CustomRulesError::Persist(error.error.to_string()))?;
    }

    Ok(SaveCustomRulesResult {
        status: SaveCustomRulesStatus::Saved,
        document: read_custom_rules(control_root)?,
        reason: None,
    })
}

fn prepare_custom_rules_preview_at(
    control_root: &Path,
    draft: CustomRulesDraft,
    updated_at: &str,
) -> Result<CustomRulesPreview, CustomRulesError> {
    let draft = normalize_and_validate_draft(draft)?;
    validate_timestamp(updated_at)
        .map_err(|reason| CustomRulesError::InvalidDraft(reason.to_owned()))?;
    let serialized = serialize_document(&draft, updated_at);
    let workflow_rules = read_managed_source(
        &control_root.join(RULES_DIRECTORY).join(WORKFLOW_RULES_FILE),
        "공통 규칙",
    )?;
    let roles = ROLES
        .iter()
        .map(|(role, label, file_name)| {
            let role_contract = read_managed_source(
                &control_root
                    .join(RULES_DIRECTORY)
                    .join(ROLES_DIRECTORY)
                    .join(file_name),
                &format!("{label} 역할 계약"),
            )?;
            let applies = draft.enabled && draft.applies_to.contains(role);
            let reason = if !draft.enabled {
                Some("사용자 정의 규칙이 꺼져 있습니다.".to_owned())
            } else if !draft.applies_to.contains(role) {
                Some("이 역할이 적용 대상이 아닙니다.".to_owned())
            } else {
                None
            };
            Ok(CustomRulesRolePreview {
                role: *role,
                sources: vec![
                    CustomRulesSourcePreview {
                        kind: CustomRulesSourceKind::WorkflowRules,
                        label: "공통 규칙".to_owned(),
                        order: 1,
                        content: workflow_rules.clone(),
                        applied: true,
                        reason: None,
                    },
                    CustomRulesSourcePreview {
                        kind: CustomRulesSourceKind::RoleContract,
                        label: format!("{label} 역할 계약"),
                        order: 2,
                        content: role_contract,
                        applied: true,
                        reason: None,
                    },
                    CustomRulesSourcePreview {
                        kind: CustomRulesSourceKind::UserRules,
                        label: "사용자 정의 규칙".to_owned(),
                        order: 3,
                        content: draft.body.clone(),
                        applied: applies,
                        reason,
                    },
                ],
            })
        })
        .collect::<Result<Vec<_>, CustomRulesError>>()?;

    Ok(CustomRulesPreview {
        draft,
        preview_hash: content_hash(serialized.as_bytes()),
        serialized,
        updated_at: updated_at.to_owned(),
        priority_notice: PRIORITY_NOTICE.to_owned(),
        roles,
    })
}

fn parse_document(
    raw: String,
    content_hash: Option<String>,
    modified_at: Option<String>,
) -> Result<CustomRulesDocument, CustomRulesError> {
    let normalized = raw.replace("\r\n", "\n");
    let (metadata_text, body) = match split_frontmatter(&normalized) {
        Ok(parts) => parts,
        Err(reason) => {
            return Ok(invalid_document(
                Some(raw),
                content_hash,
                modified_at,
                reason,
            ))
        }
    };
    let generic: serde_yaml::Value = match serde_yaml::from_str(metadata_text) {
        Ok(value) => value,
        Err(error) => {
            return Ok(invalid_document(
                Some(raw),
                content_hash,
                modified_at,
                format!("프론트매터를 읽을 수 없습니다: {error}"),
            ))
        }
    };
    let schema = generic
        .as_mapping()
        .and_then(|mapping| mapping.get(serde_yaml::Value::String("schema".to_owned())))
        .and_then(serde_yaml::Value::as_str);
    if matches!(custom_schema_version(schema), Some(version) if version > 1) {
        return Ok(CustomRulesDocument {
            status: CustomRulesFileStatus::FutureSchema,
            enabled: false,
            applies_to: Vec::new(),
            body: String::new(),
            updated_at: None,
            modified_at,
            raw: Some(raw),
            content_hash,
            error: Some("현재 앱보다 새로운 사용자 정의 규칙 형식입니다.".to_owned()),
        });
    }
    let metadata: CustomRulesMetadata = match serde_yaml::from_str(metadata_text) {
        Ok(metadata) => metadata,
        Err(error) => {
            return Ok(invalid_document(
                Some(raw),
                content_hash,
                modified_at,
                format!("프론트매터 필드가 올바르지 않습니다: {error}"),
            ))
        }
    };
    if metadata.schema != CUSTOM_RULES_SCHEMA {
        return Ok(invalid_document(
            Some(raw),
            content_hash,
            modified_at,
            "지원하는 사용자 정의 규칙 형식이 아닙니다.".to_owned(),
        ));
    }
    if let Err(reason) = validate_timestamp(&metadata.updated_at) {
        return Ok(invalid_document(
            Some(raw),
            content_hash,
            modified_at,
            reason.to_owned(),
        ));
    }
    let draft = match normalize_and_validate_draft(CustomRulesDraft {
        enabled: metadata.enabled,
        applies_to: metadata.applies_to,
        body: body.to_owned(),
    }) {
        Ok(draft) => draft,
        Err(error) => {
            return Ok(invalid_document(
                Some(raw),
                content_hash,
                modified_at,
                error.to_string(),
            ))
        }
    };

    Ok(CustomRulesDocument {
        status: CustomRulesFileStatus::Valid,
        enabled: draft.enabled,
        applies_to: draft.applies_to,
        body: draft.body,
        updated_at: Some(metadata.updated_at),
        modified_at,
        raw: Some(raw),
        content_hash,
        error: None,
    })
}

fn split_frontmatter(contents: &str) -> Result<(&str, &str), String> {
    let rest = contents
        .strip_prefix("---\n")
        .ok_or_else(|| "프론트매터 시작 표기가 없습니다.".to_owned())?;
    let end = rest
        .find("\n---\n")
        .ok_or_else(|| "프론트매터 종료 표기가 없습니다.".to_owned())?;
    let metadata = &rest[..end];
    let after = &rest[end + "\n---\n".len()..];
    let body = after.strip_prefix('\n').unwrap_or(after);
    Ok((metadata, body.strip_suffix('\n').unwrap_or(body)))
}

fn normalize_and_validate_draft(
    mut draft: CustomRulesDraft,
) -> Result<CustomRulesDraft, CustomRulesError> {
    draft.body = draft.body.replace("\r\n", "\n");
    if draft.body.contains('\r') {
        return Err(CustomRulesError::InvalidDraft(
            "줄바꿈이 아닌 캐리지 리턴은 사용할 수 없습니다.".to_owned(),
        ));
    }
    if draft.body.len() > MAX_BODY_BYTES {
        return Err(CustomRulesError::InvalidDraft(
            "본문은 UTF-8 기준 64 KiB 이하여야 합니다.".to_owned(),
        ));
    }
    if draft
        .body
        .chars()
        .any(|character| matches!(character as u32, 0..=8 | 11..=31 | 127))
    {
        return Err(CustomRulesError::InvalidDraft(
            "본문에 허용하지 않는 제어문자가 있습니다.".to_owned(),
        ));
    }
    let mut seen = HashSet::new();
    if draft.applies_to.iter().any(|role| !seen.insert(*role)) {
        return Err(CustomRulesError::InvalidDraft(
            "적용 역할을 중복해서 지정할 수 없습니다.".to_owned(),
        ));
    }
    if draft.enabled && draft.applies_to.is_empty() {
        return Err(CustomRulesError::InvalidDraft(
            "사용할 때는 적용 역할을 하나 이상 선택해야 합니다.".to_owned(),
        ));
    }
    draft.applies_to = ROLES
        .iter()
        .map(|(role, _, _)| *role)
        .filter(|role| seen.contains(role))
        .collect();
    draft.body = draft.body.trim_end_matches('\n').to_owned();
    Ok(draft)
}

fn serialize_document(draft: &CustomRulesDraft, updated_at: &str) -> String {
    let roles = draft
        .applies_to
        .iter()
        .map(|role| match role {
            CustomRuleRole::Planner => "planner",
            CustomRuleRole::Architect => "architect",
            CustomRuleRole::Developer => "developer",
        })
        .collect::<Vec<_>>()
        .join(", ");
    let header = format!(
        "---\nschema: {CUSTOM_RULES_SCHEMA}\nenabled: {}\napplies_to: [{roles}]\nupdated_at: {updated_at}\n---\n\n",
        draft.enabled
    );
    if draft.body.is_empty() {
        header
    } else {
        format!("{header}{}\n", draft.body)
    }
}

fn validate_timestamp(value: &str) -> Result<(), &'static str> {
    DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| "updated_at은 RFC3339 시각이어야 합니다.")
}

fn read_managed_source(path: &Path, label: &str) -> Result<String, CustomRulesError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| CustomRulesError::ManagedSource(format!("{label}: {error}")))?;
    if !metadata.file_type().is_file() {
        return Err(CustomRulesError::ManagedSource(format!(
            "{label}: 일반 파일이 아닙니다."
        )));
    }
    let bytes = fs::read(path)
        .map_err(|error| CustomRulesError::ManagedSource(format!("{label}: {error}")))?;
    String::from_utf8(bytes)
        .map_err(|_| CustomRulesError::ManagedSource(format!("{label}: UTF-8 문서가 아닙니다.")))
}

fn ensure_rules_directory(path: &Path) -> Result<(), CustomRulesError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => Err(CustomRulesError::Persist(
            "규칙 디렉터리가 안전한 디렉터리가 아닙니다.".to_owned(),
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path)?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

fn custom_schema_version(schema: Option<&str>) -> Option<u32> {
    schema?
        .strip_prefix("workflow-labs/custom-rules@")?
        .parse()
        .ok()
}

fn conflict_result(document: CustomRulesDocument, reason: &str) -> SaveCustomRulesResult {
    SaveCustomRulesResult {
        status: SaveCustomRulesStatus::Conflict,
        document,
        reason: Some(reason.to_owned()),
    }
}

fn invalid_document(
    raw: Option<String>,
    content_hash: Option<String>,
    modified_at: Option<String>,
    error: String,
) -> CustomRulesDocument {
    CustomRulesDocument {
        status: CustomRulesFileStatus::Invalid,
        enabled: false,
        applies_to: Vec::new(),
        body: String::new(),
        updated_at: None,
        modified_at,
        raw,
        content_hash,
        error: Some(error),
    }
}

fn absent_document() -> CustomRulesDocument {
    CustomRulesDocument {
        status: CustomRulesFileStatus::Absent,
        enabled: false,
        applies_to: Vec::new(),
        body: String::new(),
        updated_at: None,
        modified_at: None,
        raw: None,
        content_hash: None,
        error: None,
    }
}

fn custom_rules_path(control_root: &Path) -> PathBuf {
    control_root.join(RULES_DIRECTORY).join(CUSTOM_RULES_FILE)
}

fn content_hash(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{
        content_hash, prepare_custom_rules_preview_at, read_custom_rules, save_custom_rules,
        CustomRulesError,
    };
    use crate::domain::project::{
        CustomRuleRole, CustomRulesDraft, CustomRulesFileStatus, SaveCustomRulesRequest,
        SaveCustomRulesStatus,
    };
    use crate::infrastructure::project_instructions::install_project_instructions;
    use crate::infrastructure::project_write_lock::ProjectWriteLock;

    const NOW: &str = "2026-08-06T12:00:00Z";

    fn roots() -> (tempfile::TempDir, std::path::PathBuf) {
        let root = tempdir().expect("root");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control");
        install_project_instructions(root.path(), &control).expect("managed rules");
        (root, control)
    }

    fn draft() -> CustomRulesDraft {
        CustomRulesDraft {
            enabled: true,
            applies_to: vec![CustomRuleRole::Developer, CustomRuleRole::Planner],
            body: "개발 보고서에는 측정 환경을 함께 적는다.\r\n".to_owned(),
        }
    }

    fn request(
        control: &std::path::Path,
        expected_content_hash: Option<String>,
        draft: CustomRulesDraft,
    ) -> SaveCustomRulesRequest {
        let preview =
            prepare_custom_rules_preview_at(control, draft.clone(), NOW).expect("preview");
        SaveCustomRulesRequest {
            expected_content_hash,
            draft,
            updated_at: preview.updated_at,
            preview_hash: preview.preview_hash,
        }
    }

    #[test]
    fn an_absent_file_is_an_off_empty_document() {
        let (_root, control) = roots();
        let document = read_custom_rules(&control).expect("read");

        assert_eq!(document.status, CustomRulesFileStatus::Absent);
        assert!(!document.enabled);
        assert!(document.applies_to.is_empty());
        assert!(document.content_hash.is_none());
    }

    #[test]
    fn preview_and_save_share_the_exact_canonical_bytes() {
        let (_root, control) = roots();
        let preview = prepare_custom_rules_preview_at(&control, draft(), NOW).expect("preview");

        assert_eq!(
            preview.serialized,
            "---\nschema: workflow-labs/custom-rules@1\nenabled: true\napplies_to: [planner, developer]\nupdated_at: 2026-08-06T12:00:00Z\n---\n\n개발 보고서에는 측정 환경을 함께 적는다.\n"
        );
        assert_eq!(
            preview.preview_hash,
            content_hash(preview.serialized.as_bytes())
        );
        assert_eq!(preview.roles.len(), 3);
        assert!(preview.roles[0].sources.iter().all(|source| source.applied));
        assert!(!preview.roles[1].sources[2].applied);
        assert_eq!(preview.roles[2].sources[2].order, 3);
        assert_eq!(
            preview.roles[0].sources[0].content,
            fs::read_to_string(control.join("rules/workflow.md")).expect("workflow source")
        );
        assert_eq!(
            preview.roles[0].sources[1].content,
            fs::read_to_string(control.join("rules/roles/planner.md")).expect("planner source")
        );
        assert_eq!(
            preview.roles[0].sources[2].content,
            "개발 보고서에는 측정 환경을 함께 적는다."
        );
        assert!(preview.priority_notice.contains("항상 우선"));

        let result = save_custom_rules(
            &control,
            SaveCustomRulesRequest {
                expected_content_hash: None,
                draft: draft(),
                updated_at: preview.updated_at.clone(),
                preview_hash: preview.preview_hash.clone(),
            },
        )
        .expect("save");

        assert_eq!(result.status, SaveCustomRulesStatus::Saved);
        assert_eq!(
            fs::read_to_string(control.join("rules/custom.md")).expect("saved bytes"),
            preview.serialized
        );
        assert_eq!(result.document.status, CustomRulesFileStatus::Valid);
        assert_eq!(
            result.document.body,
            "개발 보고서에는 측정 환경을 함께 적는다."
        );
        assert_eq!(
            result.document.applies_to,
            vec![CustomRuleRole::Planner, CustomRuleRole::Developer]
        );
    }

    #[test]
    fn disabled_and_unselected_roles_keep_the_user_source_but_do_not_apply_it() {
        let (_root, control) = roots();
        let preview = prepare_custom_rules_preview_at(
            &control,
            CustomRulesDraft {
                enabled: false,
                applies_to: vec![CustomRuleRole::Architect],
                body: "규칙 본문".to_owned(),
            },
            NOW,
        )
        .expect("preview");

        for role in preview.roles {
            assert_eq!(role.sources.len(), 3);
            assert!(!role.sources[2].applied);
            assert_eq!(role.sources[2].content, "규칙 본문");
            assert_eq!(
                role.sources[2].reason.as_deref(),
                Some("사용자 정의 규칙이 꺼져 있습니다.")
            );
        }
    }

    #[test]
    fn invalid_future_and_unsafe_files_are_structured_without_repair() {
        let (root, control) = roots();
        let path = control.join("rules/custom.md");
        let invalid = "---\nschema: workflow-labs/custom-rules@1\nenabled: true\napplies_to: [developer, developer]\nupdated_at: nope\n---\n\nbody\n";
        fs::write(&path, invalid).expect("invalid");
        let document = read_custom_rules(&control).expect("read invalid");
        assert_eq!(document.status, CustomRulesFileStatus::Invalid);
        assert_eq!(document.raw.as_deref(), Some(invalid));
        assert_eq!(fs::read_to_string(&path).expect("unchanged"), invalid);

        let future = invalid.replace("custom-rules@1", "custom-rules@2");
        fs::write(&path, &future).expect("future");
        let document = read_custom_rules(&control).expect("read future");
        assert_eq!(document.status, CustomRulesFileStatus::FutureSchema);
        assert_eq!(document.raw.as_deref(), Some(future.as_str()));

        fs::remove_file(&path).expect("remove future");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.path().join("secret.txt"), &path).expect("symlink");
            fs::write(root.path().join("secret.txt"), "do not read").expect("target");
            let document = read_custom_rules(&control).expect("read unsafe");
            assert_eq!(document.status, CustomRulesFileStatus::UnsafeFile);
            assert!(document.raw.is_none());
            assert!(document.content_hash.is_none());
        }
    }

    #[test]
    fn unknown_metadata_fields_roles_and_schemas_stay_invalid() {
        let (_root, control) = roots();
        let path = control.join("rules/custom.md");
        let invalid_documents = [
            "---\nschema: workflow-labs/custom-rules@1\nenabled: true\napplies_to: [developer]\nupdated_at: 2026-08-06T12:00:00Z\nextra: no\n---\n\nbody\n",
            "---\nschema: workflow-labs/custom-rules@1\nenabled: true\napplies_to: [unknown]\nupdated_at: 2026-08-06T12:00:00Z\n---\n\nbody\n",
            "---\nschema: workflow-labs/custom-rules@0\nenabled: true\napplies_to: [developer]\nupdated_at: 2026-08-06T12:00:00Z\n---\n\nbody\n",
        ];

        for source in invalid_documents {
            fs::write(&path, source).expect("invalid custom rules");
            let document = read_custom_rules(&control).expect("read invalid custom rules");
            assert_eq!(document.status, CustomRulesFileStatus::Invalid);
            assert_eq!(document.raw.as_deref(), Some(source));
            assert_eq!(
                fs::read_to_string(&path).expect("invalid unchanged"),
                source
            );
        }
    }

    #[test]
    fn draft_validation_rejects_duplicates_limits_controls_and_enabled_without_roles() {
        let (_root, control) = roots();
        let invalid = [
            CustomRulesDraft {
                enabled: true,
                applies_to: Vec::new(),
                body: "body".to_owned(),
            },
            CustomRulesDraft {
                enabled: true,
                applies_to: vec![CustomRuleRole::Planner, CustomRuleRole::Planner],
                body: "body".to_owned(),
            },
            CustomRulesDraft {
                enabled: true,
                applies_to: vec![CustomRuleRole::Planner],
                body: "bad\u{7f}".to_owned(),
            },
            CustomRulesDraft {
                enabled: true,
                applies_to: vec![CustomRuleRole::Planner],
                body: "bad\u{1}".to_owned(),
            },
            CustomRulesDraft {
                enabled: true,
                applies_to: vec![CustomRuleRole::Planner],
                body: "x".repeat(64 * 1024 + 1),
            },
        ];

        for draft in invalid {
            assert!(prepare_custom_rules_preview_at(&control, draft, NOW).is_err());
        }
        assert!(prepare_custom_rules_preview_at(
            &control,
            CustomRulesDraft {
                enabled: true,
                applies_to: vec![CustomRuleRole::Planner],
                body: "x".repeat(64 * 1024),
            },
            NOW,
        )
        .is_ok());
    }

    #[test]
    fn every_external_baseline_change_is_a_conflict_and_is_preserved() {
        let (root, control) = roots();
        let first = save_custom_rules(&control, request(&control, None, draft())).expect("first");
        let baseline = first.document.content_hash.clone();
        let path = control.join("rules/custom.md");

        for external in ["external one\n", "external two\n"] {
            fs::write(&path, external).expect("external change");
            let result = save_custom_rules(&control, request(&control, baseline.clone(), draft()))
                .expect("conflict");
            assert_eq!(result.status, SaveCustomRulesStatus::Conflict);
            assert_eq!(fs::read_to_string(&path).expect("preserved"), external);
        }

        fs::remove_file(&path).expect("external delete");
        let result = save_custom_rules(&control, request(&control, baseline.clone(), draft()))
            .expect("delete conflict");
        assert_eq!(result.status, SaveCustomRulesStatus::Conflict);
        assert!(!path.exists());

        fs::write(&path, "created after absent read\n").expect("external create");
        let result =
            save_custom_rules(&control, request(&control, None, draft())).expect("create conflict");
        assert_eq!(result.status, SaveCustomRulesStatus::Conflict);
        assert_eq!(
            fs::read_to_string(&path).expect("external create preserved"),
            "created after absent read\n"
        );

        #[cfg(unix)]
        {
            fs::remove_file(&path).expect("remove external create");
            let target = root.path().join("external-target.md");
            fs::write(&target, "external target\n").expect("external target");
            std::os::unix::fs::symlink(&target, &path).expect("external symlink replacement");

            let result = save_custom_rules(&control, request(&control, baseline, draft()))
                .expect("symlink replacement conflict");

            assert_eq!(result.status, SaveCustomRulesStatus::Conflict);
            assert_eq!(result.document.status, CustomRulesFileStatus::UnsafeFile);
            assert_eq!(
                fs::read_to_string(target).expect("symlink target preserved"),
                "external target\n"
            );
        }
    }

    #[test]
    fn preview_mismatch_and_missing_managed_sources_write_nothing() {
        let (_root, control) = roots();
        let preview =
            prepare_custom_rules_preview_at(&control, draft(), NOW).expect("valid preview");
        let error = save_custom_rules(
            &control,
            SaveCustomRulesRequest {
                expected_content_hash: None,
                draft: preview.draft,
                updated_at: preview.updated_at,
                preview_hash: "sha256:not-the-preview".to_owned(),
            },
        )
        .expect_err("mismatched preview must fail");
        assert!(matches!(error, CustomRulesError::PreviewMismatch));
        assert!(!control.join("rules/custom.md").exists());

        fs::remove_file(control.join("rules/roles/developer.md")).expect("remove managed source");
        let error = prepare_custom_rules_preview_at(&control, draft(), NOW)
            .expect_err("missing role contract must fail preview");
        assert!(matches!(error, CustomRulesError::ManagedSource(_)));
        assert_eq!(
            read_custom_rules(&control)
                .expect("custom rules remain readable")
                .status,
            CustomRulesFileStatus::Absent
        );
    }

    #[cfg(unix)]
    #[test]
    fn temporary_file_creation_failure_preserves_the_existing_file() {
        use std::os::unix::fs::PermissionsExt;

        let (_root, control) = roots();
        let first = save_custom_rules(&control, request(&control, None, draft())).expect("first");
        let path = control.join("rules/custom.md");
        let before = fs::read(&path).expect("existing custom rules");
        let request = request(&control, first.document.content_hash, draft());
        let rules_directory = control.join("rules");
        let original_mode = fs::metadata(&rules_directory)
            .expect("rules metadata")
            .permissions()
            .mode();
        fs::set_permissions(&rules_directory, fs::Permissions::from_mode(0o555))
            .expect("make rules directory read only");

        let result = save_custom_rules(&control, request);

        fs::set_permissions(&rules_directory, fs::Permissions::from_mode(original_mode))
            .expect("restore rules directory permissions");
        assert!(result.is_err());
        assert_eq!(
            fs::read(path).expect("existing custom rules preserved"),
            before
        );
    }

    #[test]
    fn a_shared_write_lock_returns_retry_required_without_touching_the_file() {
        let (_root, control) = roots();
        let before = read_custom_rules(&control).expect("before");
        let lock = ProjectWriteLock::acquire(&control).expect("lock");

        let result = save_custom_rules(&control, request(&control, None, draft())).expect("retry");

        assert_eq!(result.status, SaveCustomRulesStatus::RetryRequired);
        assert_eq!(result.document, before);
        assert!(!control.join("rules/custom.md").exists());
        drop(lock);
    }
}
