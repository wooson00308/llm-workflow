use std::fs;
use std::io::Write;
use std::path::Path;

use tempfile::NamedTempFile;
use thiserror::Error;

const AGENTS_FILE: &str = "AGENTS.md";
const CLAUDE_FILE: &str = "CLAUDE.md";
const RULES_DIRECTORY: &str = "rules";
const WORKFLOW_RULES_FILE: &str = "workflow.md";
const MANAGED_START: &str = "<!-- workflow-labs:project-instructions:start -->";
const MANAGED_END: &str = "<!-- workflow-labs:project-instructions:end -->";
const RULES_SCHEMA: &str = "schema: workflow-labs/agent-rules@1";

const AGENTS_BLOCK: &str = r#"<!-- workflow-labs:project-instructions:start -->
## Workflow Labs

This repository uses the Workflow Labs document workflow.

If `.workflow/project.yml` exists, before planning, editing files, or changing workflow state:

1. Read `.workflow/project.yml`.
2. Read and follow `.workflow/rules/workflow.md`.
3. Read the active workflow's `workflow.yml` and `README.md`.

Treat user approvals, app-owned decision records, runtime locks, and schema migrations as protected state.
<!-- workflow-labs:project-instructions:end -->"#;

const CLAUDE_BLOCK: &str = r#"<!-- workflow-labs:project-instructions:start -->
@AGENTS.md
<!-- workflow-labs:project-instructions:end -->"#;

const WORKFLOW_RULES: &str = r#"---
schema: workflow-labs/agent-rules@1
managed_by: workflow-labs
rules_version: 1
---

# Workflow Labs agent protocol

These rules apply only while `.workflow/project.yml` exists in this repository.

## 1. Start every task from the manifests

1. Read `.workflow/project.yml` and select a registered workflow.
2. Read that workflow's `workflow.yml` and `README.md`.
3. Read the relevant idea, specification, task, decision, and report documents before editing.
4. Stop all workflow writes while `.workflow/.runtime/migration.lock` exists.

Never infer a workflow directory from its display name. Use the exact `directory` value registered in `project.yml`.

## 2. Respect ownership boundaries

- The app owns `project.yml`, every `workflow.yml`, `.workflow/.runtime/`, and `decisions/*.md`.
- A user decision is valid only when the app recorded it in a decision document with `created_by: user`.
- Agents may create and update documents under `ideas/`, `specs/`, `tasks/`, and `reports/` according to their schemas.
- Do not approve, reject, archive, migrate, or impersonate a user through a Markdown edit.
- Do not edit Workflow Labs managed blocks in `AGENTS.md` or `CLAUDE.md`.

## 3. Coordinate writes with a lease

Before modifying workflow documents, create a short-lived lease at `.workflow/.runtime/leases/<lease-id>.yml`:

```yaml
schema_version: 1
lease_id: <unique-id>
agent: <agent-name>
task_id: <task-id-or-null>
heartbeat_at: <RFC3339 timestamp>
expires_at: <RFC3339 timestamp>
```

- Check unexpired leases before claiming overlapping work.
- Refresh `heartbeat_at` and `expires_at` during long work.
- Remove your lease after writing the final report or when abandoning the task.
- Never remove another agent's unexpired lease.

## 4. Follow the document state machine

### Ideas and specifications

- Treat `ideas/*.md` as source material. Preserve the original intent when synthesizing a specification.
- Use `status: draft` while a specification is incomplete.
- Use `status: user_review` only when the document is ready for a user decision.
- Do not continue implementation while the required specification is in `user_review` without an app-recorded approval.
- After rejection, read the user comment and create a revised specification with a new ID. Preserve the rejected specification and its decision history.

### Development tasks

Use only these task states:

- `todo`: ready but not started
- `in_progress`: actively being implemented
- `blocked`: cannot proceed because of a concrete dependency or failure
- `qa_waiting`: implementation and agent verification are complete; user QA is required
- `completed`: user QA is complete

Set `blocked` only for a real impediment. A question or approval request belongs in the specification review flow, not as a fabricated completion.

## 5. Preserve the file contract

- Keep required frontmatter keys and valid schema identifiers.
- Preserve unknown frontmatter fields and existing document IDs.
- Update `updated_at` with an RFC3339 timestamp when changing an agent-owned document.
- When a task has a target date, store it as optional `due_at: YYYY-MM-DD`.
- Do not combine user decisions with an agent-authored specification or task file.
- Do not change schema versions. Schema upgrades are performed only by the app migration flow.
- Re-read a file immediately before writing when another user or agent may have changed it. Do not overwrite concurrent changes silently.

## 6. Verify and hand off

- Satisfy the task's stated completion conditions and run relevant tests before moving it to `qa_waiting`.
- Record outcomes, verification commands, remaining risks, and follow-up work in `reports/`.
- Leave protected state unchanged and release your lease at the end of the session.
"#;

#[derive(Debug, Error)]
pub enum ProjectInstructionError {
    #[error("프로젝트 규칙 파일과 충돌합니다: {0}")]
    Conflict(String),
    #[error("프로젝트 규칙 파일을 처리하지 못했습니다: {0}")]
    Io(#[from] std::io::Error),
    #[error("프로젝트 규칙 파일을 안전하게 저장하지 못했습니다: {0}")]
    Persist(String),
}

pub fn install_project_instructions(
    project_root: &Path,
    control_root: &Path,
) -> Result<(), ProjectInstructionError> {
    let rules_path = control_root.join(RULES_DIRECTORY).join(WORKFLOW_RULES_FILE);
    let agents_path = project_root.join(AGENTS_FILE);
    let claude_path = project_root.join(CLAUDE_FILE);

    validate_rules_file(&rules_path)?;
    let agents_update = plan_managed_file(&agents_path, AGENTS_BLOCK, false)?;
    let claude_update = plan_managed_file(&claude_path, CLAUDE_BLOCK, true)?;

    if !rules_path.exists() {
        fs::create_dir_all(
            rules_path
                .parent()
                .expect("workflow rules always have a parent"),
        )?;
        write_text_atomically(&rules_path, WORKFLOW_RULES)?;
    }
    if let Some(contents) = agents_update {
        write_text_atomically(&agents_path, &contents)?;
    }
    if let Some(contents) = claude_update {
        write_text_atomically(&claude_path, &contents)?;
    }
    Ok(())
}

pub fn validate_project_instructions(
    project_root: &Path,
    control_root: &Path,
) -> Result<(), ProjectInstructionError> {
    let rules_path = control_root.join(RULES_DIRECTORY).join(WORKFLOW_RULES_FILE);
    validate_rules_file(&rules_path)?;
    plan_managed_file(&project_root.join(AGENTS_FILE), AGENTS_BLOCK, false)?;
    plan_managed_file(&project_root.join(CLAUDE_FILE), CLAUDE_BLOCK, true)?;
    Ok(())
}

fn validate_rules_file(path: &Path) -> Result<(), ProjectInstructionError> {
    if !path.exists() {
        return Ok(());
    }
    ensure_regular_file(path)?;
    let contents = fs::read_to_string(path)?;
    if !contents.lines().any(|line| line.trim() == RULES_SCHEMA) {
        return Err(conflict(path));
    }
    Ok(())
}

fn plan_managed_file(
    path: &Path,
    block: &str,
    accept_agents_import: bool,
) -> Result<Option<String>, ProjectInstructionError> {
    if !path.exists() {
        return Ok(Some(format!("{block}\n")));
    }
    ensure_regular_file(path)?;
    let contents = fs::read_to_string(path)?;
    let start_positions = contents
        .match_indices(MANAGED_START)
        .map(|(position, _)| position)
        .collect::<Vec<_>>();
    let end_positions = contents
        .match_indices(MANAGED_END)
        .map(|(position, _)| position)
        .collect::<Vec<_>>();

    match (start_positions.as_slice(), end_positions.as_slice()) {
        ([], []) => {
            if accept_agents_import && has_agents_import(&contents) {
                return Ok(None);
            }
            Ok(Some(append_block(&contents, block)))
        }
        ([start], [end]) if start < end => {
            let end = end + MANAGED_END.len();
            let newline = newline_for(&contents);
            let rendered = block.replace('\n', newline);
            let mut updated = String::with_capacity(contents.len() + rendered.len());
            updated.push_str(&contents[..*start]);
            updated.push_str(&rendered);
            updated.push_str(&contents[end..]);
            if updated == contents {
                Ok(None)
            } else {
                Ok(Some(updated))
            }
        }
        _ => Err(conflict(path)),
    }
}

fn append_block(contents: &str, block: &str) -> String {
    let newline = newline_for(contents);
    let rendered = block.replace('\n', newline);
    if contents.is_empty() {
        return format!("{rendered}{newline}");
    }

    let mut updated = contents.to_owned();
    if !updated.ends_with('\n') {
        updated.push_str(newline);
    }
    if !updated.ends_with(&format!("{newline}{newline}")) {
        updated.push_str(newline);
    }
    updated.push_str(&rendered);
    updated.push_str(newline);
    updated
}

fn has_agents_import(contents: &str) -> bool {
    contents
        .lines()
        .any(|line| line.trim() == format!("@{AGENTS_FILE}"))
}

fn newline_for(contents: &str) -> &'static str {
    if contents.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn ensure_regular_file(path: &Path) -> Result<(), ProjectInstructionError> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(conflict(path));
    }
    Ok(())
}

fn conflict(path: &Path) -> ProjectInstructionError {
    ProjectInstructionError::Conflict(path.display().to_string())
}

fn write_text_atomically(path: &Path, value: &str) -> Result<(), ProjectInstructionError> {
    let parent = path
        .parent()
        .ok_or_else(|| ProjectInstructionError::Persist(path.display().to_string()))?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(value.as_bytes())?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(path)
        .map_err(|error| ProjectInstructionError::Persist(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{install_project_instructions, ProjectInstructionError, MANAGED_START};

    #[test]
    fn installs_rules_and_both_agent_entrypoints() {
        let root = tempdir().expect("project root");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control root");

        install_project_instructions(root.path(), &control).expect("install instructions");

        let rules = fs::read_to_string(control.join("rules/workflow.md")).expect("rules");
        let agents = fs::read_to_string(root.path().join("AGENTS.md")).expect("agents");
        let claude = fs::read_to_string(root.path().join("CLAUDE.md")).expect("claude");
        assert!(rules.contains("schema: workflow-labs/agent-rules@1"));
        assert!(rules.contains("status: user_review"));
        assert!(agents.contains(".workflow/rules/workflow.md"));
        assert!(claude.contains("@AGENTS.md"));
    }

    #[test]
    fn preserves_existing_content_and_is_idempotent() {
        let root = tempdir().expect("project root");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control root");
        fs::write(
            root.path().join("AGENTS.md"),
            "# Existing\n\n- Keep this.\n",
        )
        .expect("existing agents");
        fs::write(root.path().join("CLAUDE.md"), "# Claude only\n").expect("existing claude");

        install_project_instructions(root.path(), &control).expect("first install");
        let first_agents = fs::read_to_string(root.path().join("AGENTS.md")).expect("agents");
        let first_claude = fs::read_to_string(root.path().join("CLAUDE.md")).expect("claude");
        install_project_instructions(root.path(), &control).expect("second install");

        assert!(first_agents.starts_with("# Existing\n\n- Keep this.\n"));
        assert!(first_claude.starts_with("# Claude only\n"));
        assert_eq!(
            first_agents,
            fs::read_to_string(root.path().join("AGENTS.md")).expect("agents again")
        );
        assert_eq!(
            first_claude,
            fs::read_to_string(root.path().join("CLAUDE.md")).expect("claude again")
        );
        assert_eq!(first_agents.matches(MANAGED_START).count(), 1);
    }

    #[test]
    fn leaves_existing_claude_agents_import_untouched() {
        let root = tempdir().expect("project root");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control root");
        let existing = "@AGENTS.md\n\n## Claude\n\nKeep this instruction.\n";
        fs::write(root.path().join("CLAUDE.md"), existing).expect("existing claude");

        install_project_instructions(root.path(), &control).expect("install instructions");

        assert_eq!(
            fs::read_to_string(root.path().join("CLAUDE.md")).expect("claude"),
            existing
        );
    }

    #[test]
    fn rejects_damaged_managed_markers_without_overwriting() {
        let root = tempdir().expect("project root");
        let control = root.path().join(".workflow");
        fs::create_dir(&control).expect("control root");
        let damaged = format!("# Existing\n\n{MANAGED_START}\nunfinished\n");
        fs::write(root.path().join("AGENTS.md"), &damaged).expect("damaged agents");

        let error = install_project_instructions(root.path(), &control)
            .expect_err("damaged markers must fail");

        assert!(matches!(error, ProjectInstructionError::Conflict(_)));
        assert_eq!(
            fs::read_to_string(root.path().join("AGENTS.md")).expect("agents"),
            damaged
        );
        assert!(!control.join("rules/workflow.md").exists());
    }

    #[test]
    fn rejects_unmanaged_file_at_rules_path() {
        let root = tempdir().expect("project root");
        let control = root.path().join(".workflow");
        fs::create_dir_all(control.join("rules")).expect("rules root");
        fs::write(control.join("rules/workflow.md"), "# Mine\n").expect("foreign rules");

        let error = install_project_instructions(root.path(), &control)
            .expect_err("foreign rules must fail");

        assert!(matches!(error, ProjectInstructionError::Conflict(_)));
        assert_eq!(
            fs::read_to_string(control.join("rules/workflow.md")).expect("foreign rules"),
            "# Mine\n"
        );
    }
}
