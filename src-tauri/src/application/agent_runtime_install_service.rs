//! 런타임 설치·업데이트·복구의 두 단계 흐름.
//!
//! 여섯 명령이 모두 같은 규칙 위에 있다. **계획은 아무것도 쓰지 않고, 적용은 직전 계획의 식별자와
//! 사용자 확인을 함께 받아야 한다.** 식별자가 없거나 확인이 없으면 파일을 하나도 만들지 않는다.
//!
//! 설치 계획의 식별자는 앱이 만든다. 번들 자산과 지금 설치 상태를 묶은 지문이라 기기가 달라지면
//! 값이 달라지고, 그때 적용은 거절된다. 업데이트 계획의 식별자는 런타임이 만든 것을 그대로 보관했다가
//! 그대로 실어 보낸다 — 두 곳에서 만들면 앱이 본 세계와 런타임이 본 세계가 갈린다.
//!
//! 호환 판정은 파일을 만들기 전에 한다. API 주 버전이 앱의 지원 범위 밖이면 설치와 업데이트의 적용
//! 명령이 그 자리에서 막힌다.

use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::domain::agent_runtime::{
    judge, Compatibility, RuntimeStatus, ServiceState, StageResult, UpdateApplication, UpdatePlan,
    UpdateStage, SUPPORTED_API_MAJOR,
};
use crate::infrastructure::agent_runtime_package::{
    self, launcher_path, PackageFailure, RuntimeManifest,
};
use crate::infrastructure::agent_runtime_process::{
    self, LauncherCaller, RuntimeCallFailure, RuntimeCaller,
};

/// 조회 한 번의 결과. 번들·디스크·실행 중 세 버전을 구분해 싣는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInspection {
    /// 앱 번들이 들고 있는 버전. 런타임이 설치돼 있지 않아도 아는 값이다.
    pub bundled_version: Option<String>,
    /// 런타임이 답한 기기 상태. 런타임을 부르지 못했으면 없다.
    pub status: Option<RuntimeStatus>,
    /// 호환 판정. 런타임을 부르지 못했으면 모름이다.
    pub compatibility: Compatibility,
    /// 이 런타임 위에서 설정과 실행 명령을 열어도 되는지. 화면이 그 자리를 막는 근거로 쓴다.
    /// 모름과 재시작 필요는 둘 다 거짓이다 — 확인하지 못한 기기에서 provider를 띄우지 않는다.
    pub execution_allowed: bool,
    /// 런타임을 부르지 못한 사유. 화면이 그대로 보여 준다.
    pub unavailable: Option<String>,
    pub install_root: String,
}

/// 설치 계획. 무엇이 생기고 무엇이 바뀌는지만 말하고 아무것도 쓰지 않는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    pub plan_id: String,
    pub bundled_version: String,
    pub target: String,
    pub version_directory: String,
    pub launcher: String,
    pub already_installed: bool,
    /// 지금 설치돼 있는 버전. 처음 설치면 없다.
    pub installed_version: Option<String>,
    /// 이 계획이 서비스 등록·재시작을 필요로 하는지.
    pub service_transition_required: bool,
    /// 계획이 읽은 서비스 상태. 운영체제 등록물을 앱이 다시 해석하지 않는다.
    pub service: Option<ServiceState>,
    /// 적용 단계가 수행할 서비스 처분. 확인 불가를 `false`로 접지 않는다.
    pub service_action: InstallServiceAction,
}

/// 설치 계획이 서비스에 수행할 수 있는 처분.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallServiceAction {
    Register,
    AlreadyManaged,
    MigrationRequired,
    Unknown,
}

/// 적용 결과. 단계 이름은 런타임 계약의 것을 쓰고 앱이 새 이름을 만들지 않는다.
///
/// 처음 설치는 런타임을 부를 launcher가 아직 없어서 업데이트 경로를 쓸 수 없다. 그래서 이 값은
/// 파일 설치와 launcher 전환, 서비스 등록 세 단계를 계약의 이름 그대로 싣는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallApplication {
    pub plan_id: String,
    pub result: String,
    pub installed_version: Option<String>,
    pub version_directory: Option<String>,
    pub stages: Vec<StageResult>,
    pub detail: Option<String>,
}

/// 여섯 명령이 실패하는 방식.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallFailure {
    Package(PackageFailure),
    Runtime(RuntimeCallFailure),
    /// 계획 식별자가 지금 기기의 지문과 다르다. 새 계획이 필요하다.
    StalePlan,
    /// 사용자 확인이 없다.
    ConfirmationRequired,
    /// 런타임 계약이 앱의 지원 범위 밖이다. 파일을 바꾸기 전에 막힌다.
    Incompatible(Compatibility),
}

impl InstallFailure {
    pub fn message(&self) -> String {
        match self {
            InstallFailure::Package(failure) => failure.message(),
            InstallFailure::Runtime(failure) => failure.message(),
            InstallFailure::StalePlan => {
                "기기 상태가 계획을 세운 뒤에 달라졌습니다. 새 계획이 필요합니다.".to_owned()
            }
            InstallFailure::ConfirmationRequired => "사용자 확인이 필요합니다.".to_owned(),
            InstallFailure::Incompatible(_) => {
                "이 런타임은 앱이 지원하는 계약 범위 밖입니다.".to_owned()
            }
        }
    }
}

/// 설치 흐름 하나. 자산 위치와 설치 루트는 호출자가 Tauri에서 받아 넘긴다.
pub struct AgentRuntimeInstallService<'a> {
    resource: &'a Path,
    install_root: &'a Path,
}

impl<'a> AgentRuntimeInstallService<'a> {
    pub fn new(resource: &'a Path, install_root: &'a Path) -> Self {
        Self {
            resource,
            install_root,
        }
    }

    /// 번들·디스크·실행 중 버전과 서비스 상태를 한 번에 읽는다. 아무것도 쓰지 않는다.
    pub fn inspect(&self, caller: &dyn RuntimeCaller) -> RuntimeInspection {
        let bundled = agent_runtime_package::read_manifest(self.resource)
            .ok()
            .map(|manifest| manifest.runtime_version);
        match agent_runtime_process::inspect(caller, self.install_root) {
            Ok(status) => {
                let compatibility = judge(&status);
                RuntimeInspection {
                    bundled_version: bundled,
                    execution_allowed: compatibility.allows_execution(),
                    compatibility,
                    status: Some(status),
                    unavailable: None,
                    install_root: self.install_root.display().to_string(),
                }
            }
            Err(failure) => RuntimeInspection {
                bundled_version: bundled,
                execution_allowed: false,
                status: None,
                // 부르지 못한 것은 불호환이 아니다. 사용자가 할 일은 설치 쪽에 있다.
                compatibility: Compatibility::Undetermined {
                    reason: "runtime_unavailable".to_owned(),
                },
                unavailable: Some(failure.message()),
                install_root: self.install_root.display().to_string(),
            },
        }
    }

    /// 설치 계획을 만든다. 검증까지만 하고 파일은 만들지 않는다.
    pub fn plan_install(&self, caller: &dyn RuntimeCaller) -> Result<InstallPlan, InstallFailure> {
        let bundled = LauncherCaller::new(self.resource_executable());
        self.plan_install_with(caller, &bundled)
    }

    fn plan_install_with(
        &self,
        caller: &dyn RuntimeCaller,
        bundled: &dyn RuntimeCaller,
    ) -> Result<InstallPlan, InstallFailure> {
        let manifest = self.manifest()?;
        agent_runtime_package::verify(self.resource, &manifest).map_err(InstallFailure::Package)?;
        let destination = self.version_directory(&manifest);
        let status = self.install_status(caller, bundled).ok();
        let installed_version = status
            .as_ref()
            .and_then(|status| status.installed_version.clone());
        let service_action = self.service_action(status.as_ref());
        let service_transition_required = match service_action {
            InstallServiceAction::AlreadyManaged => {
                status.as_ref().and_then(|status| status.service.running) != Some(true)
            }
            _ => true,
        };

        Ok(InstallPlan {
            plan_id: self.fingerprint(
                &manifest,
                installed_version.as_deref(),
                service_action,
                status.as_ref().map(|status| &status.service),
            ),
            bundled_version: manifest.runtime_version.clone(),
            target: manifest.target.clone(),
            version_directory: destination.display().to_string(),
            launcher: launcher_path(self.install_root).display().to_string(),
            already_installed: destination.is_dir(),
            installed_version,
            service_transition_required,
            service: status.map(|status| status.service),
            service_action,
        })
    }

    /// 확인받은 설치 계획을 적용한다. 지문이 다르거나 확인이 없으면 아무것도 만들지 않는다.
    pub fn apply_install(
        &self,
        caller: &dyn RuntimeCaller,
        plan_id: &str,
        confirmed: bool,
    ) -> Result<InstallApplication, InstallFailure> {
        let bundled = LauncherCaller::new(self.resource_executable());
        self.apply_install_with(caller, &bundled, plan_id, confirmed)
    }

    fn apply_install_with(
        &self,
        caller: &dyn RuntimeCaller,
        bundled: &dyn RuntimeCaller,
        plan_id: &str,
        confirmed: bool,
    ) -> Result<InstallApplication, InstallFailure> {
        if !confirmed {
            return Err(InstallFailure::ConfirmationRequired);
        }
        let manifest = self.manifest()?;
        let status = self.install_status(caller, bundled).ok();
        let installed_version = status
            .as_ref()
            .and_then(|status| status.installed_version.clone());
        let service_action = self.service_action(status.as_ref());
        if self.fingerprint(
            &manifest,
            installed_version.as_deref(),
            service_action,
            status.as_ref().map(|status| &status.service),
        ) != plan_id
        {
            return Err(InstallFailure::StalePlan);
        }
        let destination =
            agent_runtime_package::install(self.resource, self.install_root, &manifest)
                .map_err(InstallFailure::Package)?;
        let mut stages = vec![stage(UpdateStage::VersionInstall, "ok", None)];

        // 새로 설치한 실행 파일 자신이 launcher를 만든다. 처음 설치에는 부를 launcher가 없다.
        let installed_executable = destination.join(if cfg!(windows) {
            "heartbeat.exe"
        } else {
            "heartbeat"
        });
        let bootstrap = LauncherCaller::new(installed_executable);
        match agent_runtime_process::activate(&bootstrap, self.install_root, &destination) {
            Ok(_) => stages.push(stage(UpdateStage::LauncherSwitch, "ok", None)),
            Err(failure) => {
                stages.push(stage(
                    UpdateStage::LauncherSwitch,
                    "failed",
                    Some(failure.message()),
                ));
                return Ok(partial(
                    plan_id,
                    &manifest.runtime_version,
                    &destination,
                    stages,
                ));
            }
        }

        // 계획에서 읽은 서비스 처분만 실행한다. 등록된 서비스를 다시 등록하면 중복 데몬 안전장치가
        // 뒤늦게 실패하므로, 등록 없음에서만 `install-service`를 호출한다.
        match service_action {
            InstallServiceAction::Register => {
                match agent_runtime_process::install_service(caller) {
                    Ok(_) => stages.push(stage(UpdateStage::ServiceTransition, "ok", None)),
                    Err(failure) => {
                        stages.push(stage(
                            UpdateStage::ServiceTransition,
                            "failed",
                            Some(failure.message()),
                        ));
                        return Ok(partial(
                            plan_id,
                            &manifest.runtime_version,
                            &destination,
                            stages,
                        ));
                    }
                }
            }
            InstallServiceAction::AlreadyManaged
                if status.as_ref().and_then(|status| status.service.running) == Some(true) =>
            {
                stages.push(stage(
                    UpdateStage::ServiceTransition,
                    "skipped",
                    Some(
                        "관리형 서비스가 이미 실행 중이어서 등록을 반복하지 않았습니다".to_owned(),
                    ),
                ));
            }
            InstallServiceAction::AlreadyManaged => {
                stages.push(stage(
                    UpdateStage::ServiceTransition,
                    "failed",
                    Some(
                        "관리형 서비스가 등록되어 있지만 실행 상태가 아닙니다. 기존 등록은 유지했으며 새 복구 계획이 필요합니다"
                            .to_owned(),
                    ),
                ));
                return Ok(partial(
                    plan_id,
                    &manifest.runtime_version,
                    &destination,
                    stages,
                ));
            }
            InstallServiceAction::MigrationRequired => {
                let service = status.as_ref().map(|status| &status.service);
                let label = service
                    .map(|service| service.label.as_str())
                    .unwrap_or("알 수 없음");
                let executable = service
                    .map(|service| service.executable.as_str())
                    .unwrap_or("알 수 없음");
                stages.push(stage(
                    UpdateStage::ServiceTransition,
                    "failed",
                    Some(format!(
                        "기존 서비스 {label} ({executable})를 유지했습니다. 중복 등록하지 말고 기존 역할 잡 이전 미리보기 뒤 별도 서비스 전환 계획을 확인하세요"
                    )),
                ));
                return Ok(partial(
                    plan_id,
                    &manifest.runtime_version,
                    &destination,
                    stages,
                ));
            }
            InstallServiceAction::Unknown => {
                stages.push(stage(
                    UpdateStage::ServiceTransition,
                    "failed",
                    Some(
                        "서비스 등록 상태를 확인하지 못해 변경하지 않았습니다. 다시 읽은 뒤 새 계획을 만드세요"
                            .to_owned(),
                    ),
                ));
                return Ok(partial(
                    plan_id,
                    &manifest.runtime_version,
                    &destination,
                    stages,
                ));
            }
        }

        Ok(InstallApplication {
            plan_id: plan_id.to_owned(),
            result: "success".to_owned(),
            installed_version: Some(manifest.runtime_version.clone()),
            version_directory: Some(destination.display().to_string()),
            stages,
            detail: None,
        })
    }

    /// 내려받아 설치한 버전으로 실행 중인 배정 프로세스까지 전환한다.
    ///
    /// 설치 적용은 관리형 서비스가 이미 실행 중이면 전환을 건너뛴다. 그래서 새 버전을 내려받아
    /// 설치해도 구버전 프로세스가 계속 돌았다(2026-08-15 실측: 0.9.0 dispatcher가 세 번의
    /// 업데이트를 지나 이틀을 더 살았다). 설치가 온전히 끝난 경우에만 업데이트 계약의 서비스
    /// 전환과 실행 중 버전 확인을 이어 밟아, 사용자가 업데이트한 순간 실행 중인 프로세스도 그
    /// 버전이 되게 한다. 전환 실패는 설치를 되돌리지 않는다 — 파일은 이미 제자리이고, 다음
    /// 조회가 재시작 필요를 그대로 보여 준다.
    pub fn apply_download(
        &self,
        caller: &dyn RuntimeCaller,
        plan_id: &str,
        confirmed: bool,
        version_directory: &Path,
    ) -> Result<InstallApplication, InstallFailure> {
        let mut application = self.apply_install(caller, plan_id, confirmed)?;
        if application.result != "success" {
            return Ok(application);
        }
        let transition =
            agent_runtime_process::plan_update(caller, self.install_root, version_directory)
                .and_then(|plan| {
                    agent_runtime_process::apply_update(
                        caller,
                        self.install_root,
                        version_directory,
                        &plan.plan_id,
                        true,
                    )
                });
        match transition {
            Ok(update) => {
                if update.result != "success" {
                    application.result = "partial_success".to_owned();
                    application.detail = update.detail.clone();
                }
                application.stages.extend(update.stages);
            }
            Err(failure) => {
                application.result = "partial_success".to_owned();
                application.detail = Some(failure.message());
            }
        }
        Ok(application)
    }

    /// 업데이트 계획을 런타임에게 묻는다. 실행 중 작업 수와 프로젝트 목록은 런타임이 센 값이다.
    pub fn plan_update(&self, caller: &dyn RuntimeCaller) -> Result<UpdatePlan, InstallFailure> {
        let manifest = self.manifest()?;
        let version_dir = self.version_directory(&manifest);
        agent_runtime_process::plan_update(caller, self.install_root, &version_dir)
            .map_err(InstallFailure::Runtime)
    }

    /// 확인받은 업데이트 계획을 적용한다.
    ///
    /// 적용 전에 호환을 먼저 본다. 지원 범위 밖 API 주 버전이면 런타임을 부르지도 않는다 — 부르면
    /// 그쪽이 파일을 바꾸기 시작한다.
    pub fn apply_update(
        &self,
        caller: &dyn RuntimeCaller,
        plan_id: &str,
        confirmed: bool,
    ) -> Result<UpdateApplication, InstallFailure> {
        if !confirmed {
            return Err(InstallFailure::ConfirmationRequired);
        }
        let manifest = self.manifest()?;
        let inspection = self.inspect(caller);
        if let Some(status) = inspection.status.as_ref() {
            if status.api_major != SUPPORTED_API_MAJOR {
                return Err(InstallFailure::Incompatible(inspection.compatibility));
            }
        }
        let version_dir = self.version_directory(&manifest);
        agent_runtime_process::apply_update(
            caller,
            self.install_root,
            &version_dir,
            plan_id,
            confirmed,
        )
        .map_err(InstallFailure::Runtime)
    }

    /// launcher나 서비스 등록만 어긋난 경우를 되돌린다.
    ///
    /// manifest가 정상일 때만 손댄다. 데이터베이스와 프로젝트 설정은 이 경로에서 열지도 않는다 —
    /// 복구가 사용자 기록을 지우는 일이 되면 안 된다.
    pub fn repair(
        &self,
        caller: &dyn RuntimeCaller,
        plan_id: &str,
        confirmed: bool,
    ) -> Result<UpdateApplication, InstallFailure> {
        self.apply_update(caller, plan_id, confirmed)
    }

    fn manifest(&self) -> Result<RuntimeManifest, InstallFailure> {
        agent_runtime_package::read_manifest(self.resource).map_err(InstallFailure::Package)
    }

    fn version_directory(&self, manifest: &RuntimeManifest) -> PathBuf {
        self.install_root
            .join(agent_runtime_package::VERSIONS_DIRECTORY)
            .join(&manifest.runtime_version)
    }

    fn resource_executable(&self) -> PathBuf {
        self.resource.join(if cfg!(windows) {
            "heartbeat.exe"
        } else {
            "heartbeat"
        })
    }

    /// stable launcher가 아직 없을 때만 번들 실행 파일로 읽기 전용 기기 조회를 다시 시도한다.
    fn install_status(
        &self,
        caller: &dyn RuntimeCaller,
        bundled: &dyn RuntimeCaller,
    ) -> Result<RuntimeStatus, RuntimeCallFailure> {
        match agent_runtime_process::inspect(caller, self.install_root) {
            Err(RuntimeCallFailure::NotFound { .. }) => {
                agent_runtime_process::inspect(bundled, self.install_root)
            }
            result => result,
        }
    }

    fn service_action(&self, status: Option<&RuntimeStatus>) -> InstallServiceAction {
        let Some(service) = status.map(|status| &status.service) else {
            return InstallServiceAction::Unknown;
        };
        match service.registered {
            Some(false) => InstallServiceAction::Register,
            Some(true)
                if service.executable == launcher_path(self.install_root).display().to_string() =>
            {
                InstallServiceAction::AlreadyManaged
            }
            Some(true) => InstallServiceAction::MigrationRequired,
            None => InstallServiceAction::Unknown,
        }
    }

    /// 계획이 가정한 사실의 지문. 서비스 신원이 바뀌면 파일을 쓰기 전에 오래된 계획을 거절한다.
    fn fingerprint(
        &self,
        manifest: &RuntimeManifest,
        installed: Option<&str>,
        service_action: InstallServiceAction,
        service: Option<&ServiceState>,
    ) -> String {
        let mut hasher = Sha256::new();
        hasher.update(manifest.runtime_version.as_bytes());
        hasher.update(b"\0");
        hasher.update(manifest.target.as_bytes());
        hasher.update(b"\0");
        hasher.update(installed.unwrap_or("none").as_bytes());
        hasher.update(b"\0");
        hasher.update(format!("{service_action:?}").as_bytes());
        if let Some(service) = service {
            for value in [
                service.platform.as_str(),
                service.label.as_str(),
                service.executable.as_str(),
            ] {
                hasher.update(b"\0");
                hasher.update(value.as_bytes());
            }
            hasher.update(b"\0");
            hasher.update(format!("{:?}", service.result).as_bytes());
            hasher.update(b"\0");
            hasher.update(format!("{:?}", service.registered).as_bytes());
            hasher.update(b"\0");
            hasher.update(format!("{:?}", service.running).as_bytes());
        }
        format!("{:x}", hasher.finalize())[..32].to_owned()
    }
}

/// 단계 하나를 계약 이름으로 만든다.
fn stage(name: UpdateStage, status: &str, detail: Option<String>) -> StageResult {
    StageResult {
        stage: name,
        status: status.to_owned(),
        detail,
    }
}

/// 파일은 놓였는데 뒤 단계가 끝나지 않은 상태. 전체 성공으로 표시하지 않는다.
fn partial(
    plan_id: &str,
    version: &str,
    destination: &Path,
    stages: Vec<StageResult>,
) -> InstallApplication {
    InstallApplication {
        plan_id: plan_id.to_owned(),
        result: "partial_success".to_owned(),
        installed_version: Some(version.to_owned()),
        version_directory: Some(destination.display().to_string()),
        stages,
        detail: Some("설치본은 놓였지만 남은 단계가 있습니다".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use pretty_assertions::assert_eq;
    use serde_json::json;
    use tempfile::{tempdir, TempDir};

    use super::{AgentRuntimeInstallService, InstallFailure, InstallServiceAction};
    use crate::domain::agent_runtime::{Compatibility, ServiceResult};
    use crate::infrastructure::agent_runtime_package::tests::bundled;
    use crate::infrastructure::agent_runtime_package::{host_target, VERSIONS_DIRECTORY};
    use crate::infrastructure::agent_runtime_process::tests::{
        plan_body, service_body, status_body, FakeCaller,
    };
    use crate::infrastructure::agent_runtime_process::{Captured, RuntimeCallFailure};

    fn install_root() -> TempDir {
        tempdir().expect("temporary directory")
    }

    fn answering(bodies: Vec<serde_json::Value>) -> FakeCaller {
        FakeCaller::new(
            bodies
                .into_iter()
                .map(|body| {
                    Ok(Captured {
                        code: Some(0),
                        stdout: body.to_string(),
                        stderr: String::new(),
                    })
                })
                .collect(),
        )
    }

    fn installed_status(version: &str) -> serde_json::Value {
        status_body(
            json!(version),
            json!(version),
            1,
            service_body("registered", json!(true), json!(true)),
        )
    }

    fn status_with_service(
        version: &str,
        result: &str,
        registered: serde_json::Value,
        running: serde_json::Value,
        label: &str,
        executable: &str,
    ) -> serde_json::Value {
        let mut service = service_body(result, registered, running);
        service["label"] = json!(label);
        service["executable"] = json!(executable);
        status_body(json!(version), json!(null), 1, service)
    }

    #[test]
    fn inspection_separates_the_bundled_disk_and_running_versions() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = answering(vec![installed_status("0.8.0")]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());

        let inspection = service.inspect(&caller);

        assert_eq!(inspection.bundled_version.as_deref(), Some("0.9.0"));
        let status = inspection.status.expect("status");
        assert_eq!(status.installed_version.as_deref(), Some("0.8.0"));
        assert_eq!(status.running_version.as_deref(), Some("0.8.0"));
        assert_eq!(status.service.result, ServiceResult::Registered);
        assert!(!inspection.execution_allowed);
        assert!(matches!(
            inspection.compatibility,
            Compatibility::VersionOutOfRange { .. }
        ));
    }

    #[test]
    fn an_unreachable_runtime_is_undetermined_rather_than_incompatible() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = FakeCaller::new(vec![Err(RuntimeCallFailure::NotFound {
            looked: root.path().join("bin/heartbeat"),
        })]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());

        let inspection = service.inspect(&caller);

        assert!(matches!(
            inspection.compatibility,
            Compatibility::Undetermined { .. }
        ));
        assert!(inspection.unavailable.is_some());
        assert!(inspection.status.is_none());
        assert!(!inspection.execution_allowed);
    }

    #[test]
    fn planning_an_install_writes_nothing() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = answering(vec![installed_status("0.8.0")]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());

        let plan = service.plan_install(&caller).expect("plan");

        assert_eq!(plan.bundled_version, "0.9.0");
        assert_eq!(plan.target, host_target());
        assert!(!plan.already_installed);
        assert_eq!(plan.installed_version.as_deref(), Some("0.8.0"));
        assert!(!root.path().join(VERSIONS_DIRECTORY).exists());
    }

    #[test]
    fn a_missing_launcher_uses_the_bundled_runtime_to_plan_a_foreign_service() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = FakeCaller::new(vec![Err(RuntimeCallFailure::NotFound {
            looked: root.path().join("bin/heartbeat"),
        })]);
        let bundled = answering(vec![status_with_service(
            "0.8.0",
            "registered",
            json!(true),
            json!(false),
            "com.catze.dream-heartbeat",
            "/legacy/dream-heartbeat",
        )]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());

        let plan = service.plan_install_with(&caller, &bundled).expect("plan");

        assert_eq!(plan.service_action, InstallServiceAction::MigrationRequired);
        assert!(plan.service_transition_required);
        let service = plan.service.expect("service state");
        assert_eq!(service.label, "com.catze.dream-heartbeat");
        assert_eq!(service.executable, "/legacy/dream-heartbeat");
        assert!(!root.path().join(VERSIONS_DIRECTORY).exists());
    }

    #[test]
    fn the_serialized_plan_keeps_the_service_identity_and_disposition() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = answering(vec![status_with_service(
            "0.8.0",
            "registered",
            json!(true),
            json!(false),
            "com.catze.dream-heartbeat",
            "/legacy/dream-heartbeat",
        )]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());

        let plan = service.plan_install(&caller).expect("plan");
        let serialized = serde_json::to_value(plan).expect("serialized plan");

        assert_eq!(serialized["serviceAction"], json!("migration_required"));
        assert_eq!(
            serialized["service"]["label"],
            json!("com.catze.dream-heartbeat")
        );
        assert_eq!(
            serialized["service"]["executable"],
            json!("/legacy/dream-heartbeat")
        );
    }

    #[test]
    fn applying_without_a_confirmation_changes_nothing() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = answering(vec![installed_status("0.8.0")]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());
        let plan = service.plan_install(&caller).expect("plan");

        let failure = service
            .apply_install(&caller, &plan.plan_id, false)
            .expect_err("refused");

        assert_eq!(failure, InstallFailure::ConfirmationRequired);
        assert!(!root.path().join(VERSIONS_DIRECTORY).exists());
    }

    #[test]
    fn a_plan_from_a_different_device_state_is_refused_before_writing() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = answering(vec![installed_status("0.8.0"), installed_status("0.8.5")]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());
        let plan = service.plan_install(&caller).expect("plan");

        let failure = service
            .apply_install(&caller, &plan.plan_id, true)
            .expect_err("refused");

        assert_eq!(failure, InstallFailure::StalePlan);
        assert!(!root.path().join(VERSIONS_DIRECTORY).exists());
    }

    #[test]
    fn a_service_identity_change_makes_the_plan_stale_before_writing() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = FakeCaller::new(vec![
            Err(RuntimeCallFailure::NotFound {
                looked: root.path().join("bin/heartbeat"),
            }),
            Err(RuntimeCallFailure::NotFound {
                looked: root.path().join("bin/heartbeat"),
            }),
        ]);
        let bundled = answering(vec![
            status_with_service(
                "0.8.0",
                "registered",
                json!(true),
                json!(false),
                "com.catze.dream-heartbeat",
                "/legacy/one",
            ),
            status_with_service(
                "0.8.0",
                "registered",
                json!(true),
                json!(false),
                "com.catze.dream-heartbeat",
                "/legacy/two",
            ),
        ]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());
        let plan = service.plan_install_with(&caller, &bundled).expect("plan");

        let failure = service
            .apply_install_with(&caller, &bundled, &plan.plan_id, true)
            .expect_err("stale plan");

        assert_eq!(failure, InstallFailure::StalePlan);
        assert!(!root.path().join(VERSIONS_DIRECTORY).exists());
    }

    /// 처음 설치의 세 단계가 계약 이름 그대로 나오는지 본다. 스크립트가 실행돼야 launcher 전환이
    /// 성립하므로 unix에서만 돈다.
    #[cfg(unix)]
    #[test]
    fn a_confirmed_plan_installs_activates_and_registers_in_named_stages() {
        use crate::domain::agent_runtime::UpdateStage;

        let resource = bundled("0.9.0");
        let root = install_root();
        let not_registered = status_with_service(
            "0.8.0",
            "not_registered",
            json!(false),
            json!(false),
            "",
            "",
        );
        let caller = answering(vec![
            not_registered.clone(),
            not_registered,
            json!({"outcome": "success"}),
        ]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());
        let plan = service.plan_install(&caller).expect("plan");

        let applied = service
            .apply_install(&caller, &plan.plan_id, true)
            .expect("install");

        assert_eq!(applied.result, "success");
        assert_eq!(applied.installed_version.as_deref(), Some("0.9.0"));
        assert_eq!(
            applied
                .stages
                .iter()
                .map(|stage| stage.stage)
                .collect::<Vec<_>>(),
            vec![
                UpdateStage::VersionInstall,
                UpdateStage::LauncherSwitch,
                UpdateStage::ServiceTransition,
            ]
        );
        assert!(applied.stages.iter().all(|stage| stage.status == "ok"));
        assert!(root
            .path()
            .join(VERSIONS_DIRECTORY)
            .join("0.9.0")
            .join("heartbeat")
            .is_file());
        assert_eq!(caller.calls.borrow()[2].0, vec!["install-service"]);
    }

    /// 내려받기 적용은 설치 뒤 실행 중인 배정 프로세스를 새 버전으로 전환한다. 설치 적용만으로는
    /// 관리형 서비스가 이미 돌고 있을 때 전환이 생략되어, 구버전 프로세스가 계속 돌았다
    /// (2026-08-15 실측). 활성화가 설치된 픽스처 스크립트를 실제로 실행하므로 unix에서만 돈다.
    #[cfg(unix)]
    #[test]
    fn a_download_apply_hands_the_running_service_to_the_new_version() {
        use crate::domain::agent_runtime::UpdateStage;

        let resource = bundled("0.9.7");
        let root = install_root();
        let managed = status_with_service(
            "0.9.6",
            "registered",
            json!(true),
            json!(true),
            "com.claude-heartbeat",
            &crate::infrastructure::agent_runtime_package::launcher_path(root.path())
                .display()
                .to_string(),
        );
        let caller = answering(vec![
            managed.clone(),
            managed,
            plan_body("update-plan-1", 0, json!([])),
            json!({
                "apiVersion": "1", "requestId": "r", "command": "update.apply",
                "outcome": "success",
                "data": {
                    "planId": "update-plan-1", "result": "success",
                    "checkedAt": "2026-08-15T09:00:00Z",
                    "stages": [
                        {"stage": "service_transition", "status": "ok", "detail": null},
                        {"stage": "running_version_check", "status": "ok", "detail": null},
                    ],
                    "runnableVersion": "0.9.7", "recoveryActions": [], "detail": null,
                },
            }),
        ]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());
        let plan = service.plan_install(&caller).expect("plan");
        let version_directory = root.path().join(VERSIONS_DIRECTORY).join("0.9.7");

        let applied = service
            .apply_download(&caller, &plan.plan_id, true, &version_directory)
            .expect("download apply");

        assert_eq!(applied.result, "success", "applied: {applied:?}");
        let stages: Vec<_> = applied.stages.iter().map(|stage| stage.stage).collect();
        assert_eq!(
            &stages[stages.len() - 2..],
            &[
                UpdateStage::ServiceTransition,
                UpdateStage::RunningVersionCheck
            ],
            "설치 뒤 업데이트 계약의 전환 단계가 이어진다"
        );
        let calls = caller.calls.borrow();
        assert_eq!(calls[2].0, vec!["agent", "update", "plan"]);
        assert_eq!(calls[3].0, vec!["agent", "update", "apply"]);
    }

    /// 전환이 거절되어도 설치는 되돌리지 않는다. 파일은 제자리이고 사유만 부분 성공으로 남는다.
    /// 활성화가 설치된 픽스처 스크립트를 실제로 실행하므로 unix에서만 돈다.
    #[cfg(unix)]
    #[test]
    fn a_failed_handover_keeps_the_install_and_reports_partial_success() {
        let resource = bundled("0.9.7");
        let root = install_root();
        let managed = status_with_service(
            "0.9.6",
            "registered",
            json!(true),
            json!(true),
            "com.claude-heartbeat",
            &crate::infrastructure::agent_runtime_package::launcher_path(root.path())
                .display()
                .to_string(),
        );
        let caller = answering(vec![
            managed.clone(),
            managed,
            json!({
                "apiVersion": "1", "requestId": "r", "command": "update.plan",
                "outcome": "failure",
                "error": {"stage": "request_validation", "code": "active_runs", "message": "실행 중 작업이 있습니다"},
            }),
        ]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());
        let plan = service.plan_install(&caller).expect("plan");
        let version_directory = root.path().join(VERSIONS_DIRECTORY).join("0.9.7");

        let applied = service
            .apply_download(&caller, &plan.plan_id, true, &version_directory)
            .expect("download apply");

        assert_eq!(applied.result, "partial_success");
        assert!(applied.detail.is_some());
        assert!(root
            .path()
            .join(VERSIONS_DIRECTORY)
            .join("0.9.7")
            .join("heartbeat")
            .is_file());
    }

    #[cfg(unix)]
    #[test]
    fn a_foreign_service_is_preserved_and_never_re_registered() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = FakeCaller::new(vec![
            Err(RuntimeCallFailure::NotFound {
                looked: root.path().join("bin/heartbeat"),
            }),
            Err(RuntimeCallFailure::NotFound {
                looked: root.path().join("bin/heartbeat"),
            }),
        ]);
        let foreign = status_with_service(
            "0.8.0",
            "registered",
            json!(true),
            json!(false),
            "com.catze.dream-heartbeat",
            "/legacy/dream-heartbeat",
        );
        let bundled = answering(vec![foreign.clone(), foreign]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());
        let plan = service.plan_install_with(&caller, &bundled).expect("plan");

        let applied = service
            .apply_install_with(&caller, &bundled, &plan.plan_id, true)
            .expect("application");

        assert_eq!(applied.result, "partial_success");
        let transition = applied.stages.last().expect("service stage");
        assert_eq!(transition.status, "failed");
        assert!(transition
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("com.catze.dream-heartbeat")));
        assert_eq!(caller.calls.borrow().len(), 2);
        assert!(!caller
            .calls
            .borrow()
            .iter()
            .any(|(arguments, _)| arguments == &["install-service"]));
    }

    #[cfg(unix)]
    #[test]
    fn an_unknown_service_state_changes_no_registration() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let missing = || RuntimeCallFailure::NotFound {
            looked: root.path().join("bin/heartbeat"),
        };
        let caller = FakeCaller::new(vec![Err(missing()), Err(missing())]);
        let bundled = FakeCaller::new(vec![Err(missing()), Err(missing())]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());
        let plan = service.plan_install_with(&caller, &bundled).expect("plan");

        let applied = service
            .apply_install_with(&caller, &bundled, &plan.plan_id, true)
            .expect("application");

        assert_eq!(plan.service_action, InstallServiceAction::Unknown);
        assert!(plan.service_transition_required);
        assert_eq!(applied.result, "partial_success");
        assert!(applied
            .stages
            .last()
            .and_then(|stage| stage.detail.as_deref())
            .is_some_and(|detail| detail.contains("확인하지 못해 변경하지 않았습니다")));
        assert_eq!(caller.calls.borrow().len(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn an_already_running_managed_service_is_not_registered_twice() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let launcher = root.path().join("bin/heartbeat").display().to_string();
        let managed = status_with_service(
            "0.8.0",
            "registered",
            json!(true),
            json!(true),
            "com.claude-heartbeat",
            &launcher,
        );
        let caller = answering(vec![managed.clone(), managed]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());
        let plan = service.plan_install(&caller).expect("plan");

        let applied = service
            .apply_install(&caller, &plan.plan_id, true)
            .expect("application");

        assert_eq!(plan.service_action, InstallServiceAction::AlreadyManaged);
        assert!(!plan.service_transition_required);
        assert_eq!(applied.result, "success");
        assert_eq!(
            applied.stages.last().expect("service stage").status,
            "skipped"
        );
        assert_eq!(caller.calls.borrow().len(), 2);
    }

    /// launcher 전환이 실패하면 설치본은 남기고 전체 성공으로 표시하지 않는다.
    #[test]
    fn a_failed_launcher_switch_is_reported_as_a_remaining_stage() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = answering(vec![installed_status("0.8.0"), installed_status("0.8.0")]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());
        let plan = service.plan_install(&caller).expect("plan");
        // 설치될 실행 파일을 실행 불가능한 조각으로 바꾼다. manifest도 같이 맞춰 검증은 통과시킨다.
        crate::infrastructure::agent_runtime_package::tests::write_resource(
            resource.path(),
            "0.9.0",
            host_target(),
            1,
        );
        fs::write(resource.path().join("heartbeat"), b"not-executable").expect("fixture");
        let manifest_path = resource.path().join("runtime-manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&manifest_path).expect("read")).expect("json");
        manifest["files"][0]["sha256"] = json!(format!(
            "{:x}",
            <sha2::Sha256 as sha2::Digest>::digest(b"not-executable")
        ));
        manifest["files"][0]["size"] = json!("not-executable".len());
        fs::write(&manifest_path, manifest.to_string()).expect("write");

        let applied = service
            .apply_install(&caller, &plan.plan_id, true)
            .expect("install");

        assert_eq!(applied.result, "partial_success");
        assert_eq!(applied.stages[0].status, "ok");
        assert_eq!(applied.stages[1].status, "failed");
        assert!(root
            .path()
            .join(VERSIONS_DIRECTORY)
            .join("0.9.0")
            .join("heartbeat")
            .is_file());
    }

    #[test]
    fn the_update_plan_impact_comes_from_the_runtime_and_is_not_recounted() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = answering(vec![plan_body("plan-9", 3, json!(["one", "two"]))]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());

        let plan = service.plan_update(&caller).expect("plan");

        assert_eq!(plan.plan_id, "plan-9");
        assert_eq!(plan.active_runs, 3);
        assert_eq!(plan.projects, vec!["one".to_owned(), "two".to_owned()]);
    }

    #[test]
    fn an_unsupported_api_major_blocks_the_update_before_the_runtime_is_asked_to_apply() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let caller = answering(vec![status_body(
            json!("0.9.0"),
            json!("0.9.0"),
            9,
            service_body("registered", json!(true), json!(true)),
        )]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());

        let failure = service
            .apply_update(&caller, "plan-9", true)
            .expect_err("refused");

        assert!(matches!(failure, InstallFailure::Incompatible(_)));
        // 조회 한 번만 나가고 적용 호출은 나가지 않는다.
        assert_eq!(caller.calls.borrow().len(), 1);
    }

    #[test]
    fn repair_never_touches_the_runtime_database() {
        let resource = bundled("0.9.0");
        let root = install_root();
        let database = root.path().join("agent-runtime.sqlite3");
        fs::write(&database, b"state").expect("fixture");
        let caller = answering(vec![
            installed_status("0.9.0"),
            json!({
                "apiVersion": "1", "requestId": "r", "command": "update.apply", "outcome": "success",
                "data": {
                    "planId": "plan-9", "result": "success", "checkedAt": "2026-08-08T09:00:00Z",
                    "stages": [{"stage": "launcher_switch", "status": "ok", "detail": null}],
                    "runnableVersion": "0.9.0", "recoveryActions": [], "detail": null,
                },
            }),
        ]);
        let service = AgentRuntimeInstallService::new(resource.path(), root.path());

        let repaired = service.repair(&caller, "plan-9", true).expect("repair");

        assert_eq!(repaired.result, "success");
        assert_eq!(fs::read(&database).expect("read"), b"state");
    }
}
