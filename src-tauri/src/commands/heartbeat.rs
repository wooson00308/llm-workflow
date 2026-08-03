use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::application::heartbeat_service::{
    DreamJobRequest, HeartbeatService, IntegrationsSnapshot, ManagedDreamJob, ManagedRoleJob,
    RoleJobRequest,
};

/// 하트비트가 설정과 상태를 두는 홈 디렉터리 이름.
const HEARTBEAT_HOME: &str = ".claude";

/// 프로젝트의 연동 상태를 한 번에 읽는다. 이 커맨드는 어떤 파일도 쓰지 않는다.
///
/// 연동이 늘어나도 커맨드는 이 하나다. 새 연동은 스냅샷에 payload 하나를 더한다.
#[tauri::command]
pub fn inspect_integrations(
    app: tauri::AppHandle,
    path: String,
) -> Result<IntegrationsSnapshot, String> {
    let home = heartbeat_home(&app)?;
    Ok(HeartbeatService.inspect(Path::new(&path), &home))
}

/// 조건 스크립트와 역할 잡을 설치하고 갱신된 연동 스냅샷을 돌려준다.
///
/// 전역 파일 `~/.claude/HEARTBEAT.md`를 쓴다. 화면에서 대상 경로와 변경 요지를 보여주고 확인을
/// 받은 뒤에만 호출한다. 자동 새로고침이나 화면 진입에서는 호출하지 않는다.
///
/// `baseline`은 화면이 폼을 시딩할 때 읽은 역할 잡이다. 쓰기 직전의 파일과 다르면 아무 파일도
/// 쓰지 않는다(R3).
#[tauri::command]
pub fn install_heartbeat_jobs(
    app: tauri::AppHandle,
    path: String,
    roles: Vec<RoleJobRequest>,
    baseline: Vec<ManagedRoleJob>,
) -> Result<IntegrationsSnapshot, String> {
    let home = heartbeat_home(&app)?;
    HeartbeatService
        .install(Path::new(&path), &home, &roles, &baseline)
        .map_err(|error| error.to_string())
}

/// dream 잡을 설치하고 갱신된 연동 스냅샷을 돌려준다.
///
/// 전역 파일 `~/.claude/HEARTBEAT.md`만 쓴다. 역할 잡 설치와 달리 프로젝트 로컬 파일은 쓰지 않는다.
/// 화면에서 대상 경로와 변경 요지를 보여주고 확인을 받은 뒤에만 호출한다.
///
/// `baseline`은 화면이 폼을 시딩할 때 읽은 dream 잡이다. 블록에 없었으면 `None`이다(R3).
#[tauri::command]
pub fn install_dream_job(
    app: tauri::AppHandle,
    path: String,
    dream: DreamJobRequest,
    baseline: Option<ManagedDreamJob>,
) -> Result<IntegrationsSnapshot, String> {
    let home = heartbeat_home(&app)?;
    HeartbeatService
        .install_dream(Path::new(&path), &home, &dream, baseline.as_ref())
        .map_err(|error| error.to_string())
}

/// 홈 해석은 커맨드 계층에서만 한다. `HOME` 환경 변수는 Windows에서 성립하지 않으므로 쓰지 않는다.
fn heartbeat_home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .home_dir()
        .map(|home| home.join(HEARTBEAT_HOME))
        .map_err(|error| format!("홈 디렉터리를 찾지 못했습니다: {error}"))
}
