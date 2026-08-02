use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::application::heartbeat_service::{
    HeartbeatIntegration, HeartbeatService, RoleJobRequest,
};

/// 하트비트가 설정과 상태를 두는 홈 디렉터리 이름.
const HEARTBEAT_HOME: &str = ".claude";

/// 프로젝트의 하트비트 연동 상태를 한 번에 읽는다. 이 커맨드는 어떤 파일도 쓰지 않는다.
#[tauri::command]
pub fn inspect_heartbeat(
    app: tauri::AppHandle,
    path: String,
) -> Result<HeartbeatIntegration, String> {
    let home = heartbeat_home(&app)?;
    Ok(HeartbeatService.inspect(Path::new(&path), &home))
}

/// 조건 스크립트와 역할 잡을 설치하고 갱신된 연동 상태를 돌려준다.
///
/// 전역 파일 `~/.claude/HEARTBEAT.md`를 쓴다. 화면에서 대상 경로와 변경 요지를 보여주고 확인을
/// 받은 뒤에만 호출한다. 자동 새로고침이나 화면 진입에서는 호출하지 않는다.
#[tauri::command]
pub fn install_heartbeat_jobs(
    app: tauri::AppHandle,
    path: String,
    roles: Vec<RoleJobRequest>,
) -> Result<HeartbeatIntegration, String> {
    let home = heartbeat_home(&app)?;
    HeartbeatService
        .install(Path::new(&path), &home, &roles)
        .map_err(|error| error.to_string())
}

/// 홈 해석은 커맨드 계층에서만 한다. `HOME` 환경 변수는 Windows에서 성립하지 않으므로 쓰지 않는다.
fn heartbeat_home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .home_dir()
        .map(|home| home.join(HEARTBEAT_HOME))
        .map_err(|error| format!("홈 디렉터리를 찾지 못했습니다: {error}"))
}
