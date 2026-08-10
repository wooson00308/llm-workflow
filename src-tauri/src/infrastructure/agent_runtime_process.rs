//! 설치된 런타임에게 기기 상태와 업데이트를 묻는 자리.
//!
//! 이 모듈은 런타임이 JSON으로 답한 것만 읽는다. launcher 파일, launchd plist, systemd unit,
//! Task Scheduler 출력, 런타임 SQLite를 여는 경로가 여기에도 다른 어디에도 없다. 그 파일들의 뜻은
//! 런타임이 알고 있고, 앱이 같은 파일을 따로 해석하면 두 해석이 갈리는 날이 온다.
//!
//! 셸을 거치지 않는다. `std::process::Command`로 실행 파일을 직접 띄우고 인자는 고정 배열이다.
//! 화면이 준 문자열이 명령줄에 닿는 경로가 없고, 요청 본문은 표준 입력의 JSON 한 덩어리로만 간다.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::domain::agent_runtime::{RuntimeStatus, UpdateApplication, UpdatePlan};

/// 런타임 계약의 API 버전. 요청 봉투에 그대로 싣는다.
const API_VERSION: &str = "1";

/// 기기 조회의 고정 인자.
const INSPECT: [&str; 2] = ["runtime", "inspect"];
/// 업데이트 명령의 고정 인자. 하위 명령 이름만 갈린다.
const UPDATE_PLAN: [&str; 3] = ["agent", "update", "plan"];
const UPDATE_APPLY: [&str; 3] = ["agent", "update", "apply"];
/// 처음 설치를 마무리하는 두 고정 인자. 설치된 실행 파일 자신이 stable launcher를 만들고,
/// 그다음 그 launcher가 서비스를 등록한다.
const ACTIVATE: [&str; 2] = ["runtime", "activate"];
const INSTALL_SERVICE: [&str; 1] = ["install-service"];
/// 프로젝트 설정 계약의 고정 인자.
const CONFIG_READ: [&str; 3] = ["agent", "config", "read"];
const CONFIG_WRITE: [&str; 3] = ["agent", "config", "write"];
const PROVIDER_DIAGNOSE: [&str; 3] = ["agent", "provider", "diagnose"];
/// 실행 계획·시작·상태·제어의 고정 인자. `once` 같은 데몬 밖 실행 경로는 이 목록에 없다.
const PLAN_READ: [&str; 2] = ["agent", "plan"];
const RUN_START: [&str; 3] = ["agent", "run", "start"];
const RUN_CANCEL: [&str; 3] = ["agent", "run", "cancel"];
const RUN_RETRY: [&str; 3] = ["agent", "run", "retry"];
const PROJECT_PAUSE: [&str; 3] = ["agent", "project", "pause"];
const PROJECT_RESUME: [&str; 3] = ["agent", "project", "resume"];
const LOGS_READ: [&str; 2] = ["agent", "logs"];
const STATE_READ: [&str; 2] = ["agent", "state"];

/// 런타임을 부르지 못했거나, 불렀는데 계약 밖으로 답한 경우.
///
/// 사유를 하나로 뭉치지 않는다. 실행 파일이 없는 것과 띄우지 못한 것과 답이 계약 밖인 것은 사용자가
/// 할 다음 행동이 서로 다르다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeCallFailure {
    /// launcher가 그 자리에 없다. 설치가 먼저다.
    NotFound { looked: PathBuf },
    /// 찾긴 찾았는데 띄우지 못했다(실행 권한 등).
    NotStarted { reason: String },
    /// 띄웠는데 답이 계약의 모양이 아니다. 받은 원문을 그대로 보존한다.
    OffContract {
        code: Option<i32>,
        stdout: String,
        stderr: String,
    },
}

impl RuntimeCallFailure {
    /// 화면이 그대로 보여 줄 수 있는 한 줄. 앱이 사유를 지어내지 않는다.
    pub fn message(&self) -> String {
        match self {
            RuntimeCallFailure::NotFound { looked } => {
                format!("런타임 실행 파일을 찾지 못했습니다: {}", looked.display())
            }
            RuntimeCallFailure::NotStarted { reason } => {
                format!("런타임을 실행하지 못했습니다: {reason}")
            }
            RuntimeCallFailure::OffContract { code, stderr, .. } => format!(
                "런타임 응답이 계약 밖입니다(코드 {}): {}",
                code.map(|value| value.to_string())
                    .unwrap_or_else(|| "없음".to_owned()),
                stderr.trim()
            ),
        }
    }
}

/// 실행된 런타임 명령 하나의 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Captured {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// 실행 방식을 갈아 끼울 수 있게 하는 자리.
///
/// 검사는 런타임을 실제로 띄우지 않고 계약 응답만 흉내 내야 한다. 등록 없음·권한 부족·확인 불가처럼
/// 기기에서 재현할 수 없는 상태가 검사 대상이라 이 갈래가 필요하다.
pub trait RuntimeCaller {
    fn call(
        &self,
        arguments: &[&str],
        request: Option<&Value>,
    ) -> Result<Captured, RuntimeCallFailure>;
}

/// 설치된 launcher를 실제로 띄우는 구현.
#[derive(Debug, Clone)]
pub struct LauncherCaller {
    launcher: PathBuf,
}

impl LauncherCaller {
    pub fn new(launcher: PathBuf) -> Self {
        Self { launcher }
    }
}

impl RuntimeCaller for LauncherCaller {
    fn call(
        &self,
        arguments: &[&str],
        request: Option<&Value>,
    ) -> Result<Captured, RuntimeCallFailure> {
        if !self.launcher.is_file() {
            return Err(RuntimeCallFailure::NotFound {
                looked: self.launcher.clone(),
            });
        }
        let mut command = Command::new(&self.launcher);
        command
            .args(arguments)
            .stdin(if request.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| RuntimeCallFailure::NotStarted {
                reason: error.to_string(),
            })?;
        if let Some(request) = request {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| RuntimeCallFailure::NotStarted {
                    reason: "표준 입력을 열지 못했습니다".to_owned(),
                })?;
            let body = request.to_string();
            stdin
                .write_all(body.as_bytes())
                .map_err(|error| RuntimeCallFailure::NotStarted {
                    reason: error.to_string(),
                })?;
        }
        let output = child
            .wait_with_output()
            .map_err(|error| RuntimeCallFailure::NotStarted {
                reason: error.to_string(),
            })?;
        Ok(Captured {
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

/// 기기 상태를 읽는다. 런타임 쪽에서도 아무것도 쓰지 않는 조회다.
pub fn inspect(
    caller: &dyn RuntimeCaller,
    install_root: &Path,
) -> Result<RuntimeStatus, RuntimeCallFailure> {
    let root = install_root.display().to_string();
    let arguments = [INSPECT[0], INSPECT[1], "--install-root", root.as_str()];
    let captured = caller.call(&arguments, None)?;
    decode(&captured)
}

/// 업데이트 계획을 읽는다. 계획은 어느 쪽에서도 쓰지 않는다.
pub fn plan_update(
    caller: &dyn RuntimeCaller,
    install_root: &Path,
    version_dir: &Path,
) -> Result<UpdatePlan, RuntimeCallFailure> {
    let request = envelope(install_root, version_dir, None, false);
    let captured = caller.call(&UPDATE_PLAN, Some(&request))?;
    decode_envelope(&captured)
}

/// 확인받은 계획을 적용한다. 계획 식별자와 확인이 함께 가지 않으면 런타임이 거절한다.
pub fn apply_update(
    caller: &dyn RuntimeCaller,
    install_root: &Path,
    version_dir: &Path,
    plan_id: &str,
    confirmed: bool,
) -> Result<UpdateApplication, RuntimeCallFailure> {
    let request = envelope(install_root, version_dir, Some(plan_id), confirmed);
    let captured = caller.call(&UPDATE_APPLY, Some(&request))?;
    decode_envelope(&captured)
}

/// 설치된 버전을 stable launcher로 올린다.
///
/// 처음 설치에는 launcher가 아직 없으므로 **방금 설치한 실행 파일 자신**을 부른다. 그 실행 파일이
/// manifest를 다시 검증한 뒤에만 launcher를 바꾸므로, 검증에 실패하면 이전 launcher가 그대로 남는다.
pub fn activate(
    caller: &dyn RuntimeCaller,
    install_root: &Path,
    version_dir: &Path,
) -> Result<Captured, RuntimeCallFailure> {
    let root = install_root.display().to_string();
    let version = version_dir.display().to_string();
    let arguments = [
        ACTIVATE[0],
        ACTIVATE[1],
        "--install-root",
        root.as_str(),
        "--version-dir",
        version.as_str(),
    ];
    succeeded(caller.call(&arguments, None)?)
}

/// 사용자 서비스를 등록한다. 사용자가 확인한 설치에서만 부른다.
pub fn install_service(caller: &dyn RuntimeCaller) -> Result<Captured, RuntimeCallFailure> {
    succeeded(caller.call(&INSTALL_SERVICE, None)?)
}

/// 종료 코드가 0이 아니면 계약 밖으로 다룬다. 이 두 명령은 JSON이 아니라 코드로 답한다.
fn succeeded(captured: Captured) -> Result<Captured, RuntimeCallFailure> {
    if captured.code == Some(0) {
        Ok(captured)
    } else {
        Err(off_contract(&captured))
    }
}

/// 프로젝트 하나의 저장된 설정을 읽는다. 아무것도 쓰지 않는다.
///
/// 설정이 없는 프로젝트도 오류가 아니다. 런타임은 `configuration`을 null로 답하고, 그것이 "아직
/// 저장한 적 없음"의 정규 표현이다.
pub fn read_configuration(
    caller: &dyn RuntimeCaller,
    project_id: &str,
) -> Result<Option<Value>, RuntimeCallFailure> {
    let request = json!({
        "apiVersion": API_VERSION,
        "requestId": uuid::Uuid::new_v4().to_string(),
        "projectId": project_id,
    });
    let captured = caller.call(&CONFIG_READ, Some(&request))?;
    let data: Value = decode_envelope(&captured)?;
    Ok(match data.get("configuration") {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.clone()),
    })
}

/// 설정 하나를 통째로 저장한다. 런타임이 검증하고 원자적으로 바꾼다.
pub fn write_configuration(
    caller: &dyn RuntimeCaller,
    configuration: &Value,
) -> Result<Value, RuntimeCallFailure> {
    let request = json!({
        "apiVersion": API_VERSION,
        "requestId": uuid::Uuid::new_v4().to_string(),
        "configuration": configuration,
    });
    let captured = caller.call(&CONFIG_WRITE, Some(&request))?;
    let data: Value = decode_envelope(&captured)?;
    data.get("configuration")
        .cloned()
        .ok_or_else(|| off_contract(&captured))
}

/// provider별 준비 상태를 읽는다. provider 프로세스를 시작하지 않는다.
pub fn diagnose_providers(
    caller: &dyn RuntimeCaller,
    project_id: &str,
) -> Result<Vec<Value>, RuntimeCallFailure> {
    let request = json!({
        "apiVersion": API_VERSION,
        "requestId": uuid::Uuid::new_v4().to_string(),
        "projectId": project_id,
    });
    let captured = caller.call(&PROVIDER_DIAGNOSE, Some(&request))?;
    let data: Value = decode_envelope(&captured)?;
    match data.get("providers") {
        Some(Value::Array(values)) => Ok(values.clone()),
        _ => Err(off_contract(&captured)),
    }
}

/// 프로젝트 하나의 실행 계획을 읽는다. provider 프로세스를 만들지 않는다.
pub fn plan_run(
    caller: &dyn RuntimeCaller,
    project_id: &str,
    roles: &Value,
) -> Result<Value, RuntimeCallFailure> {
    let mut request = project_envelope(project_id);
    request["roles"] = roles.clone();
    let captured = caller.call(&PLAN_READ, Some(&request))?;
    decode_envelope(&captured)
}

/// 확인받은 계획을 시작한다. 계획 식별자와 확인이 함께 가지 않으면 런타임이 거절한다.
pub fn start_run(
    caller: &dyn RuntimeCaller,
    project_id: &str,
    plan_id: &str,
    confirmed: bool,
) -> Result<Value, RuntimeCallFailure> {
    let mut request = project_envelope(project_id);
    request["planId"] = json!(plan_id);
    request["confirmed"] = json!(confirmed);
    let captured = caller.call(&RUN_START, Some(&request))?;
    decode_envelope(&captured)
}

/// 실행 하나를 취소한다. `confirmed`가 없으면 런타임이 미리보기만 돌려준다.
pub fn cancel_run(
    caller: &dyn RuntimeCaller,
    project_id: &str,
    run_id: &str,
    confirmed: bool,
) -> Result<Value, RuntimeCallFailure> {
    let mut request = project_envelope(project_id);
    request["runId"] = json!(run_id);
    if confirmed {
        request["confirmed"] = json!(true);
    }
    let captured = caller.call(&RUN_CANCEL, Some(&request))?;
    decode_envelope(&captured)
}

/// 실패한 실행을 다시 시도한다. 이전 실행 행은 그대로 남는다.
pub fn retry_run(
    caller: &dyn RuntimeCaller,
    project_id: &str,
    run_id: &str,
) -> Result<Value, RuntimeCallFailure> {
    let mut request = project_envelope(project_id);
    request["runId"] = json!(run_id);
    let captured = caller.call(&RUN_RETRY, Some(&request))?;
    decode_envelope(&captured)
}

/// 프로젝트의 새 배정만 멈추거나 다시 연다.
pub fn set_project_paused(
    caller: &dyn RuntimeCaller,
    project_id: &str,
    paused: bool,
) -> Result<Value, RuntimeCallFailure> {
    let request = project_envelope(project_id);
    let arguments = if paused {
        PROJECT_PAUSE
    } else {
        PROJECT_RESUME
    };
    let captured = caller.call(&arguments, Some(&request))?;
    decode_envelope(&captured)
}

/// 실행 하나의 이벤트를 cursor부터 읽는다. 파일 경로를 주고받지 않는다.
pub fn read_run_log(
    caller: &dyn RuntimeCaller,
    project_id: &str,
    run_id: &str,
    cursor: u64,
) -> Result<Value, RuntimeCallFailure> {
    let mut request = project_envelope(project_id);
    request["runId"] = json!(run_id);
    request["cursor"] = json!(cursor);
    let captured = caller.call(&LOGS_READ, Some(&request))?;
    decode_envelope(&captured)
}

/// 프로젝트의 큐와 실행 상태를 읽는다.
pub fn read_state(
    caller: &dyn RuntimeCaller,
    project_id: &str,
) -> Result<Value, RuntimeCallFailure> {
    let request = project_envelope(project_id);
    let captured = caller.call(&STATE_READ, Some(&request))?;
    decode_envelope(&captured)
}

/// 프로젝트 식별자만 실은 요청 봉투.
fn project_envelope(project_id: &str) -> Value {
    json!({
        "apiVersion": API_VERSION,
        "requestId": uuid::Uuid::new_v4().to_string(),
        "projectId": project_id,
    })
}

/// 계약이 정한 요청 봉투. 값은 앱이 아는 경로와 식별자뿐이다.
fn envelope(
    install_root: &Path,
    version_dir: &Path,
    plan_id: Option<&str>,
    confirmed: bool,
) -> Value {
    let mut request = json!({
        "apiVersion": API_VERSION,
        "requestId": uuid::Uuid::new_v4().to_string(),
        "installRoot": install_root.display().to_string(),
        "versionDir": version_dir.display().to_string(),
    });
    if let Some(plan_id) = plan_id {
        request["planId"] = json!(plan_id);
        request["confirmed"] = json!(confirmed);
    }
    request
}

/// 봉투를 벗겨 `data`를 읽는다.
///
/// 봉투의 `outcome`으로 성공을 판정하지 않는다. 부분 성공과 실패도 앱이 그대로 보여 줄 사실이고,
/// 그 사실은 `data` 안에 단계별로 들어 있다. 여기서 실패로 접으면 어느 단계까지 갔는지가 사라진다.
fn decode_envelope<T: for<'de> Deserialize<'de>>(
    captured: &Captured,
) -> Result<T, RuntimeCallFailure> {
    let Ok(value) = serde_json::from_str::<Value>(first_line(&captured.stdout)) else {
        return Err(off_contract(captured));
    };
    let Some(data) = value.get("data") else {
        return Err(off_contract(captured));
    };
    serde_json::from_value(data.clone()).map_err(|_| off_contract(captured))
}

/// 봉투가 없는 응답(`runtime inspect`)을 읽는다.
fn decode<T: for<'de> Deserialize<'de>>(captured: &Captured) -> Result<T, RuntimeCallFailure> {
    serde_json::from_str(first_line(&captured.stdout)).map_err(|_| off_contract(captured))
}

/// 계약은 표준 출력에 JSON 한 줄을 약속한다. 뒤에 붙은 것은 응답이 아니다.
fn first_line(stdout: &str) -> &str {
    stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
}

fn off_contract(captured: &Captured) -> RuntimeCallFailure {
    RuntimeCallFailure::OffContract {
        code: captured.code,
        stdout: captured.stdout.clone(),
        stderr: captured.stderr.clone(),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::cell::RefCell;
    use std::path::PathBuf;

    use pretty_assertions::assert_eq;
    use serde_json::{json, Value};

    use super::{
        activate, apply_update, inspect, install_service, plan_update, Captured,
        RuntimeCallFailure, RuntimeCaller,
    };
    use crate::domain::agent_runtime::ServiceResult;

    /// 계약 응답을 흉내 내는 호출자. 런타임을 띄우지 않고 등록 없음·권한 부족 같은 상태를 준다.
    pub(crate) struct FakeCaller {
        pub responses: RefCell<Vec<Result<Captured, RuntimeCallFailure>>>,
        pub calls: RefCell<Vec<(Vec<String>, Option<Value>)>>,
    }

    impl FakeCaller {
        pub fn new(responses: Vec<Result<Captured, RuntimeCallFailure>>) -> Self {
            Self {
                responses: RefCell::new(responses),
                calls: RefCell::new(Vec::new()),
            }
        }

        pub fn answering(body: Value) -> Self {
            Self::new(vec![Ok(Captured {
                code: Some(0),
                stdout: body.to_string(),
                stderr: String::new(),
            })])
        }
    }

    impl RuntimeCaller for FakeCaller {
        fn call(
            &self,
            arguments: &[&str],
            request: Option<&Value>,
        ) -> Result<Captured, RuntimeCallFailure> {
            self.calls.borrow_mut().push((
                arguments.iter().map(|value| (*value).to_owned()).collect(),
                request.cloned(),
            ));
            if self.responses.borrow().is_empty() {
                return Err(RuntimeCallFailure::NotStarted {
                    reason: "픽스처 응답이 없습니다".to_owned(),
                });
            }
            self.responses.borrow_mut().remove(0)
        }
    }

    pub(crate) fn service_body(result: &str, registered: Value, running: Value) -> Value {
        json!({
            "platform": "launchd",
            "result": result,
            "registered": registered,
            "running": running,
            "label": "com.claude-heartbeat",
            "executable": "/opt/runtime/bin/heartbeat",
            "recoverable": true,
            "checkedAt": "2026-08-08T09:00:00Z",
            "evidence": ["launch_agents_directory"],
        })
    }

    pub(crate) fn status_body(
        installed: Value,
        running: Value,
        api_major: u32,
        service: Value,
    ) -> Value {
        json!({
            "schemaVersion": 1,
            "result": "ok",
            "checkedAt": "2026-08-08T09:00:00Z",
            "runtimeVersion": "0.8.0",
            "installedVersion": installed,
            "runningVersion": running,
            "apiMajor": api_major,
            "target": "macos-universal",
            "executable": "/opt/runtime/bin/heartbeat",
            "installRoot": "/opt/runtime",
            "launcher": "/opt/runtime/bin/heartbeat",
            "installResult": "installed",
            "recoverable": true,
            "service": service,
            "evidence": ["stable_launcher"],
        })
    }

    pub(crate) fn plan_body(plan_id: &str, active_runs: u32, projects: Value) -> Value {
        json!({
            "apiVersion": "1",
            "requestId": "r",
            "command": "update.plan",
            "outcome": "success",
            "data": {
                "planId": plan_id,
                "result": "ready",
                "targetVersion": "0.9.0",
                "target": "macos-universal",
                "checkedAt": "2026-08-08T09:00:00Z",
                "manifestVerified": true,
                "launcherSwitchRequired": true,
                "serviceTransitionRequired": true,
                "recoverableOnFailure": true,
                "installedVersion": "0.8.0",
                "runningVersion": "0.8.0",
                "activeRuns": active_runs,
                "projects": projects,
                "service": service_body("registered", json!(true), json!(true)),
                "detail": null,
                "stages": ["manifest_verification"],
            },
        })
    }

    #[test]
    fn inspect_reads_only_the_runtime_response() {
        let caller = FakeCaller::answering(status_body(
            json!("0.8.0"),
            json!(null),
            1,
            service_body("permission_denied", json!(null), json!(null)),
        ));

        let status = inspect(&caller, &PathBuf::from("/opt/runtime")).expect("status");

        assert_eq!(status.installed_version.as_deref(), Some("0.8.0"));
        assert_eq!(status.running_version, None);
        assert_eq!(status.service.result, ServiceResult::PermissionDenied);
        assert_eq!(status.service.registered, None);
        assert_eq!(status.service.running, None);
        assert_eq!(
            caller.calls.borrow()[0].0,
            vec!["runtime", "inspect", "--install-root", "/opt/runtime"]
        );
        assert!(caller.calls.borrow()[0].1.is_none());
    }

    #[test]
    fn a_plan_request_carries_no_screen_supplied_argument() {
        let caller = FakeCaller::answering(plan_body("plan-1", 2, json!(["a", "b"])));

        let plan = plan_update(
            &caller,
            &PathBuf::from("/opt/runtime"),
            &PathBuf::from("/opt/runtime/versions/0.9.0"),
        )
        .expect("plan");

        assert_eq!(plan.plan_id, "plan-1");
        assert_eq!(plan.active_runs, 2);
        assert_eq!(plan.projects, vec!["a".to_owned(), "b".to_owned()]);
        let (arguments, request) = caller.calls.borrow()[0].clone();
        assert_eq!(arguments, vec!["agent", "update", "plan"]);
        let request = request.expect("request body");
        assert_eq!(request["installRoot"], json!("/opt/runtime"));
        assert_eq!(request["apiVersion"], json!("1"));
        assert!(request.get("planId").is_none());
    }

    #[test]
    fn an_apply_request_carries_the_plan_and_the_confirmation() {
        let caller = FakeCaller::answering(json!({
            "apiVersion": "1", "requestId": "r", "command": "update.apply", "outcome": "success",
            "data": {
                "planId": "plan-1", "result": "success", "checkedAt": "2026-08-08T09:00:00Z",
                "stages": [{"stage": "manifest_verification", "status": "ok", "detail": null}],
                "runnableVersion": "0.9.0", "recoveryActions": [], "detail": null,
            },
        }));

        let applied = apply_update(
            &caller,
            &PathBuf::from("/opt/runtime"),
            &PathBuf::from("/opt/runtime/versions/0.9.0"),
            "plan-1",
            true,
        )
        .expect("application");

        assert_eq!(applied.result, "success");
        assert_eq!(applied.runnable_version.as_deref(), Some("0.9.0"));
        let request = caller.calls.borrow()[0].1.clone().expect("request body");
        assert_eq!(request["planId"], json!("plan-1"));
        assert_eq!(request["confirmed"], json!(true));
    }

    #[test]
    fn activation_asks_the_freshly_installed_executable_to_switch_the_launcher() {
        let caller = FakeCaller::new(vec![Ok(Captured {
            code: Some(0),
            stdout: "{\"outcome\":\"success\"}".to_owned(),
            stderr: String::new(),
        })]);

        activate(
            &caller,
            &PathBuf::from("/opt/runtime"),
            &PathBuf::from("/opt/runtime/versions/0.9.0"),
        )
        .expect("activated");

        assert_eq!(
            caller.calls.borrow()[0].0,
            vec![
                "runtime",
                "activate",
                "--install-root",
                "/opt/runtime",
                "--version-dir",
                "/opt/runtime/versions/0.9.0",
            ]
        );
    }

    #[test]
    fn a_nonzero_exit_from_activation_is_a_failure_not_a_success() {
        let caller = FakeCaller::new(vec![Ok(Captured {
            code: Some(2),
            stdout: String::new(),
            stderr: "manifest verification failed".to_owned(),
        })]);

        let failure = activate(
            &caller,
            &PathBuf::from("/opt/runtime"),
            &PathBuf::from("/opt/runtime/versions/0.9.0"),
        )
        .expect_err("refused");

        assert!(matches!(failure, RuntimeCallFailure::OffContract { .. }));
    }

    #[test]
    fn service_registration_uses_the_fixed_argument() {
        let caller = FakeCaller::new(vec![Ok(Captured {
            code: Some(0),
            stdout: String::new(),
            stderr: String::new(),
        })]);

        install_service(&caller).expect("registered");

        assert_eq!(caller.calls.borrow()[0].0, vec!["install-service"]);
    }

    #[test]
    fn an_answer_outside_the_contract_keeps_the_original_output() {
        let caller = FakeCaller::new(vec![Ok(Captured {
            code: Some(2),
            stdout: "not json".to_owned(),
            stderr: "boom".to_owned(),
        })]);

        let failure = inspect(&caller, &PathBuf::from("/opt/runtime")).expect_err("off contract");

        assert_eq!(
            failure,
            RuntimeCallFailure::OffContract {
                code: Some(2),
                stdout: "not json".to_owned(),
                stderr: "boom".to_owned(),
            }
        );
    }
}
