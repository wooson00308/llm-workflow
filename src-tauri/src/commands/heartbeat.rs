use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::application::heartbeat_run_service::{HeartbeatRunService, RunJobFailure};
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
    let (home, user_home) = heartbeat_home(&app)?;
    Ok(HeartbeatService.inspect(Path::new(&path), &home, &user_home))
}

/// 조건 스크립트와 역할 잡을 설치하고 갱신된 연동 스냅샷을 돌려준다.
///
/// 이 프로젝트의 잡 파일 `~/.claude/heartbeat/jobs.d/<slug>.md`를 쓴다. 화면에서 대상 경로와 변경
/// 요지를 보여주고 확인을 받은 뒤에만 호출한다. 자동 새로고침이나 화면 진입에서는 호출하지 않는다.
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
    let (home, user_home) = heartbeat_home(&app)?;
    HeartbeatService
        .install(Path::new(&path), &home, &user_home, &roles, &baseline)
        .map_err(|error| error.to_string())
}

/// dream 잡을 설치하고 갱신된 연동 스냅샷을 돌려준다.
///
/// 이 프로젝트의 잡 파일만 쓴다. 역할 잡 설치와 달리 프로젝트 로컬 파일은 쓰지 않는다.
/// 화면에서 대상 경로와 변경 요지를 보여주고 확인을 받은 뒤에만 호출한다.
///
/// `baseline`은 화면이 폼을 시딩할 때 읽은 dream 잡이다. 잡 파일에 없었으면 `None`이다(R3).
#[tauri::command]
pub fn install_dream_job(
    app: tauri::AppHandle,
    path: String,
    dream: DreamJobRequest,
    baseline: Option<ManagedDreamJob>,
) -> Result<IntegrationsSnapshot, String> {
    let (home, user_home) = heartbeat_home(&app)?;
    HeartbeatService
        .install_dream(
            Path::new(&path),
            &home,
            &user_home,
            &dream,
            baseline.as_ref(),
        )
        .map_err(|error| error.to_string())
}

/// 이 프로젝트의 역할 잡 하나를 지금 한 번 실행한다. 어떤 파일도 쓰지 않는다(SPEC-020 R1).
///
/// 실행되는 것은 지금 열린 프로젝트의 역할 잡 셋 중 이름이 일치하는 하나뿐이다. 그 밖의 이름은
/// 프로세스를 띄우지 않고 실패로 끝난다. 앱이 임의의 명령을 조립해 실행하는 경로는 없다.
///
/// 사용자가 의도해 누른 자리에서만 호출한다. 화면 진입·조회 주기·프로젝트 열기에서 부르지
/// 않는다 — 이 조작은 화면 갱신이 아니라 토큰을 쓰는 모델 세션 하나를 띄우는 것이다(R7).
///
/// 자식이 끝날 때까지 기다리므로 실행은 블로킹 자리에서 돈다. 동기 커맨드로 두면 타임아웃 상한
/// (기획자·아키텍트 20분, 개발자 30분)까지 창이 멈춘다.
#[tauri::command]
pub async fn run_heartbeat_job(
    app: tauri::AppHandle,
    path: String,
    job_name: String,
) -> Result<(), RunJobFailure> {
    // 이 커맨드가 쓰는 홈은 사용자 홈이다. 실행 파일 후보가 `~/.local/bin`에 있어서이며
    // `~/.claude`가 아니다.
    let (_, user_home) =
        heartbeat_home(&app).map_err(|error| RunJobFailure::new(&job_name, error))?;

    let name = job_name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        HeartbeatRunService.run_job(Path::new(&path), &user_home, &job_name)
    })
    .await
    .map_err(|error| RunJobFailure::new(&name, format!("실행을 시작하지 못했습니다: {error}")))?
}

/// 하트비트 홈과 사용자 홈을 함께 돌려준다. 서비스 등록 아티팩트가 `~/.claude` 밖에 있어 서비스가
/// 두 경로를 모두 받는다. 홈을 한 번만 해석해 두 값이 어긋나지 않게 한다.
///
/// 홈 해석은 커맨드 계층에서만 한다. `HOME` 환경 변수는 Windows에서 성립하지 않으므로 쓰지 않는다.
fn heartbeat_home(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    app.path()
        .home_dir()
        .map(|home| (home.join(HEARTBEAT_HOME), home))
        .map_err(|error| format!("홈 디렉터리를 찾지 못했습니다: {error}"))
}
