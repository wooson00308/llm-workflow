use std::{collections::HashMap, path::Path, sync::Mutex};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::application::project_service::ProjectService;
use crate::domain::project::{
    CustomRulesDocument, CustomRulesDraft, CustomRulesPreview, IdeaDocument,
    ManagedAssetSyncResult, ProjectSummary, ReportDocument, SaveCustomRulesRequest,
    SaveCustomRulesResult, SpecDecisionOutcome, SpecDocument, TaskDocument, TaskResumeRequest,
    TaskResumeResult, TaskRevisionRequestInput, TaskRevisionRequestResult, WorkGroupQaSubmission,
    WorkGroupQaSubmissionResult, WorkflowReportSummary,
};
use crate::infrastructure::fs_project_repository::FileSystemProjectRepository;

#[derive(Default)]
pub struct ProjectWatchers(Mutex<HashMap<String, RecommendedWatcher>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectChanged {
    watch_id: String,
    path: String,
}

#[tauri::command]
pub fn watch_project(
    app: AppHandle,
    watchers: State<'_, ProjectWatchers>,
    path: String,
) -> Result<String, String> {
    let workflow = Path::new(&path)
        .join(".workflow")
        .canonicalize()
        .map_err(|error| format!("워크플로우 감시 경로를 열 수 없습니다: {error}"))?;
    if !workflow.is_dir() {
        return Err("워크플로우 감시 경로가 디렉터리가 아닙니다".to_owned());
    }
    let watch_id = uuid::Uuid::new_v4().to_string();
    let event_watch_id = watch_id.clone();
    let event_path = path.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        // 격리 작업 사본은 저장소 전체의 사본이라, 개발 세션이 일하는 동안 그 안의 파일 이벤트가
        // 초 단위로 이어진다. 사본 안만 바뀐 이벤트는 워크플로 상태 변화가 아니므로 조회를 깨우지
        // 않는다. 경로가 없는 이벤트는 무엇이 변했는지 모르므로 그대로 알린다.
        let relevant = match &result {
            Ok(event) => {
                event.paths.is_empty()
                    || event
                        .paths
                        .iter()
                        .any(|path| !inside_isolated_worktree(path))
            }
            Err(_) => false,
        };
        if relevant {
            let _ = app.emit(
                "workflow-project-changed",
                ProjectChanged {
                    watch_id: event_watch_id.clone(),
                    path: event_path.clone(),
                },
            );
        }
    })
    .map_err(|error| format!("워크플로우 감시를 시작하지 못했습니다: {error}"))?;
    watcher
        .watch(&workflow, RecursiveMode::Recursive)
        .map_err(|error| format!("워크플로우 감시를 시작하지 못했습니다: {error}"))?;
    watchers
        .0
        .lock()
        .map_err(|_| "워크플로우 감시 상태 잠금이 손상됐습니다".to_owned())?
        .insert(watch_id.clone(), watcher);
    Ok(watch_id)
}

#[tauri::command]
pub fn unwatch_project(
    watchers: State<'_, ProjectWatchers>,
    watch_id: String,
) -> Result<(), String> {
    watchers
        .0
        .lock()
        .map_err(|_| "워크플로우 감시 상태 잠금이 손상됐습니다".to_owned())?
        .remove(&watch_id);
    Ok(())
}

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

/// 실행 하나에 연결된 보고서 목록. 어떤 보고서가 그 실행의 것인지는 백엔드가 판정하고, 화면은
/// 파일 이름이나 경로를 추측하지 않는다. 연결을 확인하지 못하면 빈 목록이 온다.
#[tauri::command]
pub fn list_run_reports(
    path: String,
    workflow_directory: String,
    target_id: Option<String>,
    result_prefix: Option<String>,
) -> Result<Vec<WorkflowReportSummary>, String> {
    FileSystemProjectRepository
        .list_run_reports(
            Path::new(&path),
            &workflow_directory,
            target_id.as_deref(),
            result_prefix.as_deref(),
        )
        .map_err(|error| error.to_string())
}

/// 보고서 하나의 읽기 전용 본문. 파일을 쓰지 않고 문서 상태를 바꾸지 않는다.
#[tauri::command]
pub fn read_report(
    path: String,
    workflow_directory: String,
    file_name: String,
) -> Result<ReportDocument, String> {
    FileSystemProjectRepository
        .read_report(Path::new(&path), &workflow_directory, &file_name)
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

/// 작업 그룹의 사용자 시나리오 결과를 감사 결정 한 건으로 원자적으로 기록한다.
#[tauri::command]
pub fn submit_work_group_qa(
    path: String,
    submission: WorkGroupQaSubmission,
) -> Result<WorkGroupQaSubmissionResult, String> {
    ProjectService::default()
        .submit_work_group_qa(Path::new(&path), &submission)
        .map_err(|error| error.to_string())
}

/// 막힌 작업 재개. 사용자가 앱 화면에서 해결 근거를 적고 누르는 조작만 이 명령에 도달한다.
#[tauri::command]
pub fn resume_task(path: String, request: TaskResumeRequest) -> Result<TaskResumeResult, String> {
    ProjectService::default()
        .resume_task(Path::new(&path), &request)
        .map_err(|error| error.to_string())
}

/// 작업 정의 수정 요청 저장. 사용자가 앱 화면에서 이유를 적고 누르는 조작만 이 명령에 도달한다.
#[tauri::command]
pub fn record_task_revision_request(
    path: String,
    request: TaskRevisionRequestInput,
) -> Result<TaskRevisionRequestResult, String> {
    ProjectService::default()
        .record_task_revision_request(Path::new(&path), &request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn migrate_project(path: String) -> Result<ProjectSummary, String> {
    ProjectService::default()
        .migrate(Path::new(&path))
        .map_err(|error| error.to_string())
}

/// 경로가 격리 작업 사본(`…/.runtime/worktrees/…`) 안인지. 구분자 문자열 비교 대신 경로 성분으로
/// 판정해 운영체제 구분자 차이에 걸리지 않는다.
fn inside_isolated_worktree(path: &Path) -> bool {
    let mut previous_was_runtime = false;
    for component in path.components() {
        if let std::path::Component::Normal(name) = component {
            if previous_was_runtime && name == "worktrees" {
                return true;
            }
            previous_was_runtime = name == ".runtime";
        } else {
            previous_was_runtime = false;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::inside_isolated_worktree;
    use std::path::Path;

    #[test]
    fn only_paths_under_the_isolated_worktrees_are_ignored() {
        assert!(inside_isolated_worktree(Path::new(
            "/p/.workflow/.runtime/worktrees/TASK-1/lease-1/src/App.tsx"
        )));
        // 사본 디렉터리 자신도 사본 안의 일이다 — 생성·삭제 이벤트가 조회를 깨우지 않는다.
        assert!(inside_isolated_worktree(Path::new(
            "/p/.workflow/.runtime/worktrees"
        )));
        // lease와 격리 기록은 워크플로 상태이므로 계속 알린다.
        assert!(!inside_isolated_worktree(Path::new(
            "/p/.workflow/.runtime/leases/TASK-1.yml"
        )));
        assert!(!inside_isolated_worktree(Path::new(
            "/p/.workflow/.runtime/isolation/TASK-1.yml"
        )));
        // `.runtime` 밖의 `worktrees`라는 이름만으로는 사본이 아니다.
        assert!(!inside_isolated_worktree(Path::new(
            "/p/.workflow/wf-1/tasks/worktrees.md"
        )));
    }
}
