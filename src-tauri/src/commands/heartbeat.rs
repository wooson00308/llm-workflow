use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::application::heartbeat_run_service::{HeartbeatRunService, RunJobFailure};
use crate::application::heartbeat_service::{
    DreamJobRequest, HeartbeatService, IntegrationsSnapshot, ManagedDreamJob, ManagedRoleJob,
    RoleJobRequest,
};
use crate::application::heartbeat_service_control::{
    HeartbeatServiceControlService, HeartbeatServiceRun,
};
use crate::application::heartbeat_setup_run_service::{
    HeartbeatSetupRun, HeartbeatSetupRunService,
};
use crate::application::heartbeat_update_service::{HeartbeatUpdate, HeartbeatUpdateService};
use crate::application::heartbeat_version_service::{HeartbeatVersionService, HeartbeatVersions};

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

/// 하트비트를 한 번 갱신한다. 앱은 이 경로에서 어떤 파일도 쓰지 않는다 — 파일을 쓰는 것은
/// 데몬이다(SPEC-037 R1).
///
/// 인자를 받지 않는다. 업데이트는 프로젝트와 무관한 조작이라 `path`가 필요 없고, 실행 파일 후보를
/// 만들 사용자 홈만 커맨드 계층이 해석한다. 화면이 준 문자열이 명령줄에 닿는 경로가 없다 —
/// 인자는 백엔드 상수 `heartbeat update` 하나로 고정이고 셸을 거치지 않는다.
///
/// 사용자가 확인 화면에서 누른 자리에서만 호출한다. 화면 진입·조회 주기·프로젝트 열기에서 부르지
/// 않는다 — 이 조작은 화면 갱신이 아니라 저장소를 갱신하고 데몬을 재기동하는 일이다(R3).
///
/// `git fetch`와 `pip install`이 걸리는 조작이라 블로킹 자리에서 돈다. 동기 커맨드로 두면 그동안
/// 창이 멈춘다.
#[tauri::command]
pub async fn update_heartbeat(app: tauri::AppHandle) -> Result<HeartbeatUpdate, String> {
    // 이 커맨드가 쓰는 홈은 사용자 홈이다. 실행 파일 후보가 `~/.local/bin`에 있어서이며
    // `~/.claude`가 아니다.
    let (_, user_home) = heartbeat_home(&app)?;

    tauri::async_runtime::spawn_blocking(move || HeartbeatUpdateService.update(&user_home))
        .await
        .map_err(|error| format!("업데이트를 시작하지 못했습니다: {error}"))
}

/// 도는 데몬의 버전과 디스크의 버전을 읽어 어긋남을 판정한다. 앱은 이 경로에서 어떤 파일도 쓰지
/// 않는다 — 상태 파일은 읽기만 하고, 디스크 버전은 프로세스가 낸 출력에서만 온다.
///
/// **조회 주기·화면 진입의 자동 갱신에서는 부르지 않는다.** 이 판정은 프로세스를 하나 띄우므로
/// `inspect_integrations`에 얹지 않는다 — 그쪽은 자동 새로고침 주기마다 불린다. 부르는 시점은
/// 사용자가 의도해 누른 자리이고, 화면이 정한다.
///
/// 인자를 받지 않는다. 버전은 프로젝트와 무관한 값이라 `path`가 필요 없고, 상태 파일이 있는
/// 하트비트 홈과 실행 파일 후보를 만들 사용자 홈만 커맨드 계층이 해석한다. 화면이 준 문자열이
/// 명령줄에 닿는 경로가 없다 — 인자는 백엔드 상수 `heartbeat --version` 하나로 고정이고 셸을
/// 거치지 않는다.
///
/// 실행 파일 탐색이 걸리는 자리라 블로킹 자리에서 돈다.
#[tauri::command]
pub async fn check_heartbeat_versions(app: tauri::AppHandle) -> Result<HeartbeatVersions, String> {
    let (home, user_home) = heartbeat_home(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        HeartbeatVersionService.versions(&home, &user_home)
    })
    .await
    .map_err(|error| format!("버전 조회를 시작하지 못했습니다: {error}"))
}

/// 설치 마법사의 단계 하나를 앱이 대신 실행한다. 앱은 이 경로에서 어떤 파일도 쓰지 않는다 —
/// 파일을 쓰는 것은 데몬이다. `heartbeat init`은 하트비트 홈에 문서를 만들고,
/// `heartbeat install-service`는 서비스 등록물을 만들고 데몬을 띄운다. 그 구분이 확인 화면의 문구를
/// 정한다(SPEC-037 R3).
///
/// 인자는 단계 식별자 하나다. `path`는 받지 않는다 — 설치는 프로젝트와 무관한 조작이다. 화면이 준
/// 문자열이 명령줄에 닿는 경로도 없다. 식별자는 백엔드 상수의 고정 인자로 옮겨지고, 그 상수에 없는
/// 식별자는 프로세스를 띄우지 않고 실패로 끝난다.
///
/// **스냅샷을 돌려주지 않는다.** 실행 결과만 돌려주고, 단계 상태의 갱신은 화면이
/// `inspect_integrations`를 다시 부르는 것으로 얻는다. 설치 판정의 원천을 둘로 만들지 않는다.
///
/// 사용자가 확인 화면에서 누른 자리에서만 호출한다. `install-service`는 등록물 생성과 기동을
/// 포함하는 걸리는 조작이라 블로킹 자리에서 돈다.
#[tauri::command]
pub async fn run_heartbeat_setup_step(
    app: tauri::AppHandle,
    step: String,
) -> Result<HeartbeatSetupRun, String> {
    // 이 커맨드가 쓰는 홈은 사용자 홈이다. 실행 파일 후보가 `~/.local/bin`에 있어서이며
    // `~/.claude`가 아니다.
    let (_, user_home) = heartbeat_home(&app)?;

    tauri::async_runtime::spawn_blocking(move || HeartbeatSetupRunService.run(&user_home, &step))
        .await
        .map_err(|error| format!("설치 단계 실행을 시작하지 못했습니다: {error}"))
}

/// 등록된 하트비트 서비스를 내리거나 다시 올린다. 앱은 이 경로에서 **어떤 파일도 쓰지 않는다** —
/// 특히 `~/Library/LaunchAgents`에 쓰거나 지우지 않는다. 등록과 해제는 설치 마법사 3단계와
/// `uninstall-service`의 일이고 이 조작은 등록된 서비스를 잠깐 내렸다 올리는 것이다(SPEC-036 R8).
/// lease 파일도 읽지도 쓰지도 않는다(R3).
///
/// 인자는 조작 식별자 하나다. `path`는 받지 않는다 — 데몬은 기기 하나에 하나라 프로젝트와 무관한
/// 조작이다. 화면이 준 문자열이 명령줄에 닿는 경로도 없다. 식별자는 백엔드 상수의 고정 인자로
/// 옮겨지고, 그 상수에 없는 식별자는 프로세스를 띄우지 않고 실패로 끝난다.
///
/// **스냅샷을 돌려주지 않는다.** 실행 결과만 돌려주고, 데몬 상태의 갱신은 화면이
/// `inspect_integrations`를 다시 부르는 것으로 얻는다. 데몬 상태의 원천을 둘로 만들지 않는 것이
/// R7의 "모순된 두 상태를 동시에 말하지 않는다"이다.
///
/// 사용자가 확인 화면에서 누른 자리에서만 호출한다. 화면 진입·조회 주기·프로젝트 열기에서 부르지
/// 않는다 — 이 조작은 화면 갱신이 아니라 이 기기의 모든 잡을 멈추거나 되살리는 일이다(R2·R3).
///
/// `bootout`은 데몬이 내려갈 때까지 걸리는 조작이라 블로킹 자리에서 돈다.
#[tauri::command]
pub async fn control_heartbeat_service(
    app: tauri::AppHandle,
    operation: String,
) -> Result<HeartbeatServiceRun, String> {
    // 이 커맨드가 쓰는 홈은 사용자 홈이다. 등록물이 `~/Library/LaunchAgents`에 있고 도메인의 uid도
    // 그 홈의 소유자에서 오며, `~/.claude`가 아니다.
    let (_, user_home) = heartbeat_home(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        HeartbeatServiceControlService.control(&user_home, &operation)
    })
    .await
    .map_err(|error| format!("데몬 조작을 시작하지 못했습니다: {error}"))?
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
