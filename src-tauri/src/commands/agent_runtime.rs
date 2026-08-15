//! 에이전트 런타임의 설치·업데이트·복구 커맨드.
//!
//! 경로 해석은 이 계층에서만 한다. 설치 루트는 Tauri가 해석한 앱 데이터 디렉터리이고 번들 자산은
//! Tauri가 해석한 resource 디렉터리다. 환경 변수나 화면이 준 문자열로 경로를 조립하는 자리가 없다.
//!
//! 계획과 적용을 나눈 것이 이 커맨드 묶음의 규약이다. 화면은 계획을 받아 사용자에게 보여 주고,
//! 확인을 받은 뒤 같은 계획 식별자를 실어 적용을 부른다. 확인 없는 적용은 파일을 만들지 않는다.

use std::path::{Path, PathBuf};

use chrono::Utc;
use tauri::Manager;

use crate::application::agent_runtime_config_service::{
    AgentRuntimeConfigService, ConfigFailure, MigrationPreview, MigrationRequest, PolicySnapshot,
    ProjectConsent,
};
use crate::application::agent_runtime_install_service::{
    AgentRuntimeInstallService, InstallApplication, InstallFailure, InstallPlan, RuntimeInspection,
};
use crate::application::agent_runtime_run_service::{
    AgentRuntimeRunService, CancelOutcome, RoleSlotRequest, RunFailure,
};
use crate::application::agent_runtime_status_service::{AgentRuntimeStatusService, StatusFailure};
use crate::application::heartbeat_service::{migration_role_requests, HeartbeatService};
use crate::domain::agent_runtime::{
    Compatibility, ProjectPolicy, QueueSnapshot, RunLogPage, RunPlan, RunStartOutcome, RunSummary,
};
use crate::domain::agent_runtime::{UpdateApplication, UpdatePlan};
use crate::infrastructure::agent_runtime_package::{launcher_path, VERSIONS_DIRECTORY};
use crate::infrastructure::agent_runtime_process::{self, LauncherCaller, RuntimeCallFailure};
use crate::infrastructure::agent_runtime_release::{
    self, HttpReleaseFetcher, ReleaseCheck, DOWNLOADS_DIRECTORY,
};

/// 번들 안에서 런타임 자산이 놓이는 디렉터리 이름.
const RESOURCE_DIRECTORY: &str = "runtime";

/// 번들·디스크·실행 중 버전과 서비스 상태를 한 번에 읽는다. 아무것도 쓰지 않는다.
#[tauri::command]
pub async fn inspect_agent_runtime(app: tauri::AppHandle) -> Result<RuntimeInspection, String> {
    let (resource, install_root) = locations(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        AgentRuntimeInstallService::new(&resource, &install_root).inspect(&caller)
    })
    .await
    .map_err(|error| format!("런타임 조회를 시작하지 못했습니다: {error}"))
}

/// 설치 계획을 읽는다. 파일, launcher, 서비스, 데이터베이스를 바꾸지 않는다.
#[tauri::command]
pub async fn plan_agent_runtime_install(app: tauri::AppHandle) -> Result<InstallPlan, String> {
    let (resource, install_root) = locations(&app)?;
    blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        AgentRuntimeInstallService::new(&resource, &install_root).plan_install(&caller)
    })
    .await
}

/// 확인받은 설치 계획을 적용한다. 오래된 계획과 확인 없는 요청은 거절한다.
#[tauri::command]
pub async fn apply_agent_runtime_install(
    app: tauri::AppHandle,
    plan_id: String,
    confirmed: bool,
) -> Result<InstallApplication, String> {
    let (resource, install_root) = locations(&app)?;
    blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        AgentRuntimeInstallService::new(&resource, &install_root)
            .apply_install(&caller, &plan_id, confirmed)
    })
    .await
}

/// 업데이트 계획을 읽는다. 실행 중 작업 수와 프로젝트 목록은 런타임이 센 값 그대로다.
#[tauri::command]
pub async fn plan_agent_runtime_update(app: tauri::AppHandle) -> Result<UpdatePlan, String> {
    let (resource, install_root) = locations(&app)?;
    blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        AgentRuntimeInstallService::new(&resource, &install_root).plan_update(&caller)
    })
    .await
}

/// 확인받은 업데이트 계획을 적용한다. 실행 중 작업을 자동으로 종료하지 않는다.
#[tauri::command]
pub async fn apply_agent_runtime_update(
    app: tauri::AppHandle,
    plan_id: String,
    confirmed: bool,
) -> Result<UpdateApplication, String> {
    let (resource, install_root) = locations(&app)?;
    blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        AgentRuntimeInstallService::new(&resource, &install_root)
            .apply_update(&caller, &plan_id, confirmed)
    })
    .await
}

/// 게시된 최신 런타임 버전을 조회한다. 아무것도 내려받지 않는다.
#[tauri::command]
pub async fn check_agent_runtime_release() -> Result<ReleaseCheck, String> {
    tauri::async_runtime::spawn_blocking(|| agent_runtime_release::check(&HttpReleaseFetcher))
        .await
        .map_err(|error| format!("런타임 릴리스 조회를 시작하지 못했습니다: {error}"))?
        .map_err(|failure| failure.message())
}

/// 최신 런타임 배포물을 내려받아 설치 계획을 만든다. 버전 디렉터리와 launcher는 바꾸지 않는다.
///
/// 내려받은 배포물은 설치 루트의 내려받기 자리에 머물고, 적용이 같은 버전을 실어 오면 그 사본을
/// 쓴다. 계획이 만드는 검증은 번들 설치와 같다 — manifest의 대상·계약 번호·파일 해시.
#[tauri::command]
pub async fn plan_agent_runtime_download(app: tauri::AppHandle) -> Result<InstallPlan, String> {
    let (_, install_root) = locations(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<InstallPlan, String> {
        let release = agent_runtime_release::latest_release(&HttpReleaseFetcher)
            .map_err(|failure| failure.message())?;
        let staged = agent_runtime_release::stage_release(
            &HttpReleaseFetcher,
            &release,
            &install_root.join(DOWNLOADS_DIRECTORY),
        )
        .map_err(|failure| failure.message())?;
        let caller = LauncherCaller::new(launcher_path(&install_root));
        AgentRuntimeInstallService::new(&staged, &install_root)
            .plan_install(&caller)
            .map_err(|failure| failure.message())
    })
    .await
    .map_err(|error| format!("런타임 내려받기를 시작하지 못했습니다: {error}"))?
}

/// 내려받아 둔 배포물로 확인받은 설치 계획을 적용하고, 실행 중인 배정 프로세스를 새 버전으로
/// 전환한다. 오래된 계획과 확인 없는 요청은 거절한다.
#[tauri::command]
pub async fn apply_agent_runtime_download(
    app: tauri::AppHandle,
    version: String,
    plan_id: String,
    confirmed: bool,
) -> Result<InstallApplication, String> {
    let (_, install_root) = locations(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<InstallApplication, String> {
        let staged = agent_runtime_release::staged_directory(
            &install_root.join(DOWNLOADS_DIRECTORY),
            &version,
        )
        .map_err(|failure| failure.message())?;
        let version_directory = install_root.join(VERSIONS_DIRECTORY).join(&version);
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let application = AgentRuntimeInstallService::new(&staged, &install_root)
            .apply_download(&caller, &plan_id, confirmed, &version_directory)
            .map_err(|failure| failure.message())?;
        agent_runtime_release::discard_staged(&staged);
        Ok(application)
    })
    .await
    .map_err(|error| format!("런타임 설치를 시작하지 못했습니다: {error}"))?
}

/// launcher와 서비스 등록만 되돌린다. 프로젝트 설정·큐·이력 데이터베이스는 열지 않는다.
#[tauri::command]
pub async fn repair_agent_runtime(
    app: tauri::AppHandle,
    plan_id: String,
    confirmed: bool,
) -> Result<UpdateApplication, String> {
    let (resource, install_root) = locations(&app)?;
    blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        AgentRuntimeInstallService::new(&resource, &install_root)
            .repair(&caller, &plan_id, confirmed)
    })
    .await
}

/// 프로젝트 하나의 역할 정책과 provider 진단을 읽는다. 아무것도 쓰지 않는다.
#[tauri::command]
pub async fn read_agent_runtime_policy(
    app: tauri::AppHandle,
    project_id: String,
    working_directory: String,
) -> Result<PolicySnapshot, String> {
    let (resource, install_root) = locations(&app)?;
    config_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = AgentRuntimeInstallService::new(&resource, &install_root)
            .inspect(&caller)
            .compatibility;
        AgentRuntimeConfigService.read(&caller, &project_id, &working_directory, compatibility)
    })
    .await
}

/// 역할 정책을 저장한다. 읽을 때 받은 revision이 지금 값과 같을 때만 쓴다.
///
/// 이 커맨드는 provider 프로세스를 시작하지 않는다. 진단은 조회에서 오고 저장과 갈라져 있다.
#[tauri::command]
pub async fn save_agent_runtime_policy(
    app: tauri::AppHandle,
    policy: ProjectPolicy,
    baseline_revision: String,
) -> Result<PolicySnapshot, String> {
    let (resource, install_root) = locations(&app)?;
    config_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = AgentRuntimeInstallService::new(&resource, &install_root)
            .inspect(&caller)
            .compatibility;
        AgentRuntimeConfigService.save(&caller, &policy, &baseline_revision, compatibility)
    })
    .await
}

/// 사용자가 읽은 고지 버전으로 이 프로젝트의 실행 권한 동의를 남긴다.
///
/// 동의 시각은 런타임이 스스로 읽는다. 앱이 보내는 값은 프로젝트 식별자와 고지 버전뿐이다.
#[tauri::command]
pub async fn grant_agent_runtime_consent(
    app: tauri::AppHandle,
    project_id: String,
    notice_version: u32,
) -> Result<ProjectConsent, String> {
    let (resource, install_root) = locations(&app)?;
    config_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = AgentRuntimeInstallService::new(&resource, &install_root)
            .inspect(&caller)
            .compatibility;
        AgentRuntimeConfigService.grant_consent(&caller, &project_id, notice_version, compatibility)
    })
    .await
}

/// 이 프로젝트의 실행 권한 동의를 철회한다. 이미 실행 중인 세션은 종료하지 않는다.
#[tauri::command]
pub async fn revoke_agent_runtime_consent(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<ProjectConsent, String> {
    let (resource, install_root) = locations(&app)?;
    config_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = AgentRuntimeInstallService::new(&resource, &install_root)
            .inspect(&caller)
            .compatibility;
        AgentRuntimeConfigService.revoke_consent(&caller, &project_id, compatibility)
    })
    .await
}

/// 기존 역할 잡에서 새 정책을 제안한다. 파일을 읽기만 한다.
#[tauri::command]
pub async fn preview_agent_runtime_migration(
    app: tauri::AppHandle,
    path: String,
    project_id: String,
) -> Result<MigrationPreview, String> {
    let (home, user_home) = heartbeat_home(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let jobs = HeartbeatService
            .inspect(Path::new(&path), &home, &user_home)
            .heartbeat
            .managed_jobs;
        AgentRuntimeConfigService.migration_preview(&project_id, &path, &jobs)
    })
    .await
    .map_err(|error| format!("마이그레이션 미리보기를 시작하지 못했습니다: {error}"))
}

/// 확인받은 미리보기를 적용한다. 미리보기 식별자와 revision이 모두 맞아야 쓴다.
#[tauri::command]
pub async fn apply_agent_runtime_migration(
    app: tauri::AppHandle,
    path: String,
    project_id: String,
    preview_id: String,
    baseline_revision: String,
) -> Result<PolicySnapshot, String> {
    let (resource, install_root) = locations(&app)?;
    let (home, user_home) = heartbeat_home(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let jobs = HeartbeatService
            .inspect(Path::new(&path), &home, &user_home)
            .heartbeat
            .managed_jobs;
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = AgentRuntimeInstallService::new(&resource, &install_root)
            .inspect(&caller)
            .compatibility;
        let policy = AgentRuntimeConfigService
            .apply_migration(
                &caller,
                &MigrationRequest {
                    project_id,
                    working_directory: path.clone(),
                    jobs: jobs.clone(),
                    preview_id,
                    baseline_revision,
                },
                compatibility,
            )
            .map_err(|failure| failure.message())?;

        // 새 정책은 automationEnabled=false로 먼저 저장된다. 그 뒤 앱이 소유한 세 역할 잡만
        // 중지하므로 어느 단계에서 실패해도 옛 스케줄러와 새 dispatcher가 동시에 돌지 않는다.
        let disabled = migration_role_requests(&jobs, false);
        HeartbeatService
            .install(Path::new(&path), &home, &user_home, &disabled, &jobs)
            .map_err(|error| format!("기존 역할 잡을 안전하게 중지하지 못했습니다: {error}"))?;

        if let Err(failure) = agent_runtime_process::migrate_service(&caller) {
            let restored = migration_role_requests(&jobs, true);
            let rollback = HeartbeatService
                .install(Path::new(&path), &home, &user_home, &restored, &[])
                .map(|_| ())
                .map_err(|error| error.to_string());
            let suffix = match rollback {
                Ok(()) => "기존 역할 잡은 원래대로 복구했습니다.",
                Err(_) => {
                    "기존 역할 잡 복구도 완료하지 못했습니다. 자동 배정은 꺼진 상태로 유지됩니다."
                }
            };
            return Err(format!(
                "자동 배정 서비스로 전환하지 못했습니다. {} {suffix}",
                service_failure_detail(&failure),
            ));
        }

        Ok(policy)
    })
    .await
    .map_err(|error| format!("기존 설정 이전을 시작하지 못했습니다: {error}"))?
}

fn service_failure_detail(failure: &RuntimeCallFailure) -> String {
    if let RuntimeCallFailure::OffContract { stdout, stderr, .. } = failure {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        if !detail.is_empty() {
            return detail.lines().last().unwrap_or(detail).to_owned();
        }
    }
    failure.message()
}

/// 실행 계획을 읽는다. 파일도 provider 프로세스도 바뀌지 않는다.
#[tauri::command]
pub async fn plan_agent_run(
    app: tauri::AppHandle,
    project_id: String,
    roles: Vec<RoleSlotRequest>,
) -> Result<RunPlan, String> {
    let (resource, install_root) = locations(&app)?;
    run_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = compatibility_of(&resource, &install_root, &caller);
        AgentRuntimeRunService.plan(&caller, &project_id, &roles, &compatibility)
    })
    .await
}

/// 확인받은 계획을 시작한다. 조건이 달라졌으면 아무 provider도 시작되지 않는다.
#[tauri::command]
pub async fn start_agent_run(
    app: tauri::AppHandle,
    project_id: String,
    plan_id: String,
    confirmed: bool,
) -> Result<RunStartOutcome, String> {
    let (resource, install_root) = locations(&app)?;
    run_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = compatibility_of(&resource, &install_root, &caller);
        AgentRuntimeRunService.start(&caller, &project_id, &plan_id, confirmed, &compatibility)
    })
    .await
}

/// 취소를 미리 보거나 적용한다. 확인이 없으면 아무것도 바뀌지 않는다.
#[tauri::command]
pub async fn cancel_agent_run(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
    confirmed: bool,
) -> Result<CancelOutcome, String> {
    let (resource, install_root) = locations(&app)?;
    run_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = compatibility_of(&resource, &install_root, &caller);
        AgentRuntimeRunService.cancel(&caller, &project_id, &run_id, confirmed, &compatibility)
    })
    .await
}

/// 실패한 실행을 다시 시도한다. 이전 실행 행은 그대로 남는다.
#[tauri::command]
pub async fn retry_agent_run(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
) -> Result<RunSummary, String> {
    let (resource, install_root) = locations(&app)?;
    run_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = compatibility_of(&resource, &install_root, &caller);
        AgentRuntimeRunService.retry(&caller, &project_id, &run_id, &compatibility)
    })
    .await
}

/// 큐와 실행 상태를 읽는다. 읽지 못하면 모름으로 답한다.
#[tauri::command]
pub async fn inspect_agent_runs(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<QueueSnapshot, String> {
    let (resource, install_root) = locations(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = compatibility_of(&resource, &install_root, &caller);
        AgentRuntimeStatusService.inspect(&caller, &project_id, &compatibility)
    })
    .await
    .map_err(|error| format!("상태 조회를 시작하지 못했습니다: {error}"))
}

/// 프로젝트의 새 배정만 멈춘다.
#[tauri::command]
pub async fn pause_agent_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<QueueSnapshot, String> {
    set_paused(app, project_id, true).await
}

/// 멈춘 프로젝트의 배정을 다시 연다.
#[tauri::command]
pub async fn resume_agent_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<QueueSnapshot, String> {
    set_paused(app, project_id, false).await
}

/// 실행 하나의 이벤트를 cursor부터 읽는다. 화면이 파일 경로를 보내지 않는다.
#[tauri::command]
pub async fn read_agent_run_log(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
    cursor: u64,
) -> Result<RunLogPage, String> {
    let (resource, install_root) = locations(&app)?;
    status_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = compatibility_of(&resource, &install_root, &caller);
        AgentRuntimeStatusService.read_log(&caller, &project_id, &run_id, cursor, &compatibility)
    })
    .await
}

/// 실행 하나의 진단 번들을 만든다. 저장 위치를 받으면 그 자리에 쓰고, 받지 않으면 같은 내용을
/// 문자열로 돌려준다.
///
/// 두 경로가 조립을 한 번만 지나므로 저장한 파일과 화면이 복사하는 문자열은 같은 내용이다. 번들을
/// 외부로 보내는 자리는 없다 — 이 명령이 하는 쓰기는 사용자가 대화상자로 고른 경로 하나뿐이다.
#[tauri::command]
pub async fn export_agent_run_diagnostics(
    app: tauri::AppHandle,
    project_id: String,
    run_id: String,
    destination: Option<String>,
) -> Result<String, String> {
    let (resource, install_root) = locations(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let runtime = AgentRuntimeInstallService::new(&resource, &install_root).inspect(&caller);
        let compatibility = runtime.compatibility.clone();
        let bundle = AgentRuntimeStatusService.export_diagnostics(
            &caller,
            &project_id,
            &run_id,
            runtime,
            &compatibility,
            &Utc::now().to_rfc3339(),
        );
        let content = serde_json::to_string_pretty(&bundle)
            .map_err(|error| format!("진단 자료를 만들지 못했습니다: {error}"))?;
        if let Some(path) = destination {
            std::fs::write(&path, &content)
                .map_err(|error| format!("진단 자료를 저장하지 못했습니다: {error}"))?;
        }
        Ok(content)
    })
    .await
    .map_err(|error| format!("진단 자료 내보내기를 시작하지 못했습니다: {error}"))?
}

async fn set_paused(
    app: tauri::AppHandle,
    project_id: String,
    paused: bool,
) -> Result<QueueSnapshot, String> {
    let (resource, install_root) = locations(&app)?;
    status_blocking(move || {
        let caller = LauncherCaller::new(launcher_path(&install_root));
        let compatibility = compatibility_of(&resource, &install_root, &caller);
        AgentRuntimeStatusService.set_paused(&caller, &project_id, paused, &compatibility)
    })
    .await
}

/// 호환 판정 한 번. 실행 명령은 모두 이 판정을 먼저 통과해야 한다.
fn compatibility_of(
    resource: &Path,
    install_root: &Path,
    caller: &LauncherCaller,
) -> Compatibility {
    AgentRuntimeInstallService::new(resource, install_root)
        .inspect(caller)
        .compatibility
}

async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, RunFailure> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("실행 작업을 시작하지 못했습니다: {error}"))?
        .map_err(|failure| failure.message())
}

async fn status_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, StatusFailure> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("상태 작업을 시작하지 못했습니다: {error}"))?
        .map_err(|failure| failure.message())
}

/// 설정 실패를 화면이 읽을 한 줄로 바꾼다.
async fn config_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ConfigFailure> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("설정 작업을 시작하지 못했습니다: {error}"))?
        .map_err(|failure| failure.message())
}

/// 하트비트 홈과 사용자 홈. 기존 잡을 읽는 자리에서만 쓴다.
fn heartbeat_home(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    app.path()
        .home_dir()
        .map(|home| (home.join(".claude"), home))
        .map_err(|error| format!("홈 디렉터리를 찾지 못했습니다: {error}"))
}

/// 실패 값을 화면이 읽을 한 줄로 바꾸는 자리. 사유 문구는 서비스가 만든다.
async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, InstallFailure> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("런타임 작업을 시작하지 못했습니다: {error}"))?
        .map_err(|failure| failure.message())
}

/// 번들 자산과 설치 루트를 해석한다. 두 경로 모두 Tauri가 준다.
fn locations(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let resource = app
        .path()
        .resource_dir()
        .map(|directory| directory.join(RESOURCE_DIRECTORY))
        .map_err(|error| format!("번들 자산 위치를 찾지 못했습니다: {error}"))?;
    let install_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("앱 데이터 위치를 찾지 못했습니다: {error}"))?;
    Ok((resource, install_root))
}
