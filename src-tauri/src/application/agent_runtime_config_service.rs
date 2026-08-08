//! 프로젝트별 역할 정책의 조회·저장과 기존 잡의 마이그레이션.
//!
//! 저장의 정본은 런타임의 설정 계약이다. 앱은 자기 사본을 두지 않고, 화면이 보낸 값을 검사한 뒤
//! 런타임에 통째로 넘긴다. 앱을 껐다 켜도 같은 값이 보이는 것은 앱이 기억해서가 아니라 런타임이
//! 갖고 있기 때문이다.
//!
//! **읽은 뒤 바뀐 설정을 덮어쓰지 않는다.** 화면은 읽을 때 받은 revision을 저장 요청에 실어 보내고,
//! 저장 직전에 다시 읽어 revision이 같을 때만 쓴다. 다르면 아무것도 쓰지 않고 최신 설정을 돌려준다.
//!
//! **저장은 provider를 띄우지 않는다.** 진단은 런타임의 조회 명령에서 오고, 그 결과가 ready가 아니어도
//! 설정 자체는 저장된다. 실행 가능 여부는 따로 실어 보낸다.

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::application::heartbeat_service::ManagedRoleJob;
use crate::domain::agent_runtime::{
    default_policy, validate_policy, Compatibility, PolicyRejection, ProjectPolicy, RolePolicy,
    DEFAULT_DEVICE_MAX_PARALLEL, DEFAULT_POLL_INTERVAL_SECONDS, DEFAULT_PROJECT_MAX_PARALLEL,
    DEFAULT_ROLE_MAX_PARALLEL, POLICY_ROLES,
};
use crate::infrastructure::agent_runtime_process::{self, RuntimeCallFailure, RuntimeCaller};

/// 조회 한 번의 결과.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PolicySnapshot {
    /// 저장된 설정이 없으면 기본값을 제안으로 싣고 `stored`가 거짓이다.
    pub policy: ProjectPolicy,
    pub stored: bool,
    /// 저장 요청에 그대로 실어 보낼 값. 읽은 뒤 누가 바꿨는지를 이 값으로 판정한다.
    pub revision: String,
    /// provider별 준비 상태. 설정 저장과는 무관하고 실행 가능 여부만 가른다.
    pub providers: Vec<Value>,
    /// 이 런타임에서 실행을 열어도 되는지.
    pub execution_allowed: bool,
    pub compatibility: Compatibility,
}

/// 마이그레이션 미리보기. 확인 전에는 아무것도 쓰지 않는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPreview {
    /// 미리보기 식별자. 적용 요청이 이 값을 그대로 실어 보낸다.
    pub preview_id: String,
    pub proposed: ProjectPolicy,
    /// 새 계약에 직접 대응하지 않아 옮기지 못한 값. 조용히 버리지 않는다.
    pub unresolved: Vec<UnresolvedValue>,
    /// 기존 잡이 없어 손대지 않은 역할.
    pub untouched_roles: Vec<String>,
}

/// 옮기지 못한 값 하나. 어느 역할의 어느 필드가 무슨 값이었는지 그대로 남긴다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedValue {
    pub role: String,
    pub field: String,
    pub value: String,
    pub reason: String,
}

/// 설정 명령이 실패하는 방식.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigFailure {
    Runtime(RuntimeCallFailure),
    Rejected(PolicyRejection),
    /// 읽은 뒤 다른 곳에서 설정이 바뀌었다. 최신 값을 함께 돌려준다.
    Stale(Box<PolicySnapshot>),
    /// 이 런타임의 계약이 앱의 지원 범위 밖이다.
    Incompatible(Compatibility),
    /// 미리보기 식별자가 지금 계산한 값과 다르다.
    StalePreview,
}

impl ConfigFailure {
    pub fn message(&self) -> String {
        match self {
            ConfigFailure::Runtime(failure) => failure.message(),
            ConfigFailure::Rejected(rejection) => match rejection {
                PolicyRejection::RoleDisableUnsupported { role } => format!(
                    "{role} 역할을 끄는 설정은 런타임 계약에 자리가 없어 저장할 수 없습니다"
                ),
                other => format!("설정이 계약에 맞지 않습니다: {other:?}"),
            },
            ConfigFailure::Stale(_) => {
                "읽은 뒤 설정이 바뀌었습니다. 최신 값을 확인한 뒤 다시 저장하세요.".to_owned()
            }
            ConfigFailure::Incompatible(_) => {
                "이 런타임은 앱이 지원하는 계약 범위 밖입니다.".to_owned()
            }
            ConfigFailure::StalePreview => {
                "미리보기 뒤 기존 잡이 바뀌었습니다. 미리보기를 다시 읽으세요.".to_owned()
            }
        }
    }
}

/// 마이그레이션 적용 한 번의 입력. 값이 여럿이라 묶어서 받는다.
#[derive(Debug, Clone)]
pub struct MigrationRequest {
    pub project_id: String,
    pub working_directory: String,
    pub jobs: Vec<ManagedRoleJob>,
    pub preview_id: String,
    pub baseline_revision: String,
}

#[derive(Debug, Default)]
pub struct AgentRuntimeConfigService;

impl AgentRuntimeConfigService {
    /// 저장된 설정과 provider 진단을 함께 읽는다. 아무것도 쓰지 않는다.
    pub fn read(
        &self,
        caller: &dyn RuntimeCaller,
        project_id: &str,
        working_directory: &str,
        compatibility: Compatibility,
    ) -> Result<PolicySnapshot, ConfigFailure> {
        let stored = agent_runtime_process::read_configuration(caller, project_id)
            .map_err(ConfigFailure::Runtime)?;
        let providers = agent_runtime_process::diagnose_providers(caller, project_id)
            // 진단을 읽지 못하는 것은 설정을 읽지 못한 것과 다르다. 설정은 그대로 보이고 진단만 빈다.
            .unwrap_or_default();
        let (policy, is_stored) = match stored.as_ref() {
            Some(value) => (from_runtime(value, working_directory), true),
            None => (default_policy(project_id, working_directory), false),
        };
        Ok(PolicySnapshot {
            revision: revision_of(stored.as_ref()),
            execution_allowed: compatibility.allows_execution(),
            compatibility,
            policy,
            stored: is_stored,
            providers,
        })
    }

    /// 정책 하나를 저장한다. 검사와 revision 대조를 모두 통과할 때만 쓴다.
    pub fn save(
        &self,
        caller: &dyn RuntimeCaller,
        policy: &ProjectPolicy,
        baseline_revision: &str,
        compatibility: Compatibility,
    ) -> Result<PolicySnapshot, ConfigFailure> {
        if !compatibility.allows_execution() {
            // 호환되지 않는 런타임에는 쓰지 않는다. 그 런타임의 계약이 이 모양인지 알 수 없다.
            return Err(ConfigFailure::Incompatible(compatibility));
        }
        validate_policy(policy).map_err(ConfigFailure::Rejected)?;

        let current = self.read(caller, &policy.project_id, &policy.working_directory, compatibility.clone())?;
        if current.revision != baseline_revision {
            return Err(ConfigFailure::Stale(Box::new(current)));
        }
        if current.stored && current.policy.project_id != policy.project_id {
            return Err(ConfigFailure::Rejected(PolicyRejection::ProjectIdMismatch {
                requested: policy.project_id.clone(),
                actual: current.policy.project_id.clone(),
            }));
        }
        if current.stored && current.policy.working_directory != policy.working_directory {
            return Err(ConfigFailure::Rejected(
                PolicyRejection::WorkingDirectoryMismatch {
                    requested: policy.working_directory.clone(),
                    actual: current.policy.working_directory.clone(),
                },
            ));
        }
        agent_runtime_process::write_configuration(caller, &to_runtime(policy))
            .map_err(ConfigFailure::Runtime)?;
        self.read(caller, &policy.project_id, &policy.working_directory, compatibility)
    }

    /// 기존 역할 잡에서 새 정책을 제안한다. 아무것도 쓰지 않는다.
    pub fn migration_preview(
        &self,
        project_id: &str,
        working_directory: &str,
        jobs: &[ManagedRoleJob],
    ) -> MigrationPreview {
        let mut proposed = default_policy(project_id, working_directory);
        let mut unresolved = Vec::new();
        let mut untouched: Vec<String> = POLICY_ROLES.iter().map(|role| (*role).to_owned()).collect();

        for job in jobs {
            let Some(policy) = proposed.roles.get_mut(&job.role) else {
                unresolved.push(UnresolvedValue {
                    role: job.role.clone(),
                    field: "role".to_owned(),
                    value: job.role.clone(),
                    reason: "계약에 없는 역할입니다".to_owned(),
                });
                continue;
            };
            untouched.retain(|role| role != &job.role);
            policy.enabled = true;
            policy.provider = "claude".to_owned();
            policy.model = job.model.clone().filter(|model| !model.trim().is_empty());

            match job.interval.as_deref().map(parse_duration_seconds) {
                Some(Some(seconds)) if seconds > 0 => policy.interval_seconds = seconds,
                Some(_) => unresolved.push(unresolvable(job, "interval", job.interval.as_deref())),
                None => {}
            }
            match job.max_per.as_deref().map(|value| value.trim().parse::<u32>()) {
                Some(Ok(limit)) if limit > 0 => policy.max_per = Some(limit),
                Some(_) => unresolved.push(unresolvable(job, "maxPer", job.max_per.as_deref())),
                None => {}
            }
            if let Some(timeout) = job.timeout.as_deref() {
                // 실행 시간 제한은 새 계약에 자리가 없다. 값을 버리지 않고 목록으로 남긴다.
                unresolved.push(UnresolvedValue {
                    role: job.role.clone(),
                    field: "timeout".to_owned(),
                    value: timeout.to_owned(),
                    reason: "런타임 설정 계약에 대응하는 필드가 없습니다".to_owned(),
                });
            }
        }

        untouched.sort_unstable();
        MigrationPreview {
            preview_id: preview_fingerprint(project_id, jobs),
            proposed,
            unresolved,
            untouched_roles: untouched,
        }
    }

    /// 확인받은 미리보기를 적용한다. 미리보기 식별자와 revision이 모두 맞아야 쓴다.
    pub fn apply_migration(
        &self,
        caller: &dyn RuntimeCaller,
        request: &MigrationRequest,
        compatibility: Compatibility,
    ) -> Result<PolicySnapshot, ConfigFailure> {
        let preview =
            self.migration_preview(&request.project_id, &request.working_directory, &request.jobs);
        if preview.preview_id != request.preview_id {
            return Err(ConfigFailure::StalePreview);
        }
        self.save(
            caller,
            &preview.proposed,
            &request.baseline_revision,
            compatibility,
        )
    }
}

/// 런타임 설정 계약의 값을 앱의 정책으로 옮긴다.
fn from_runtime(value: &Value, working_directory: &str) -> ProjectPolicy {
    let mut roles = std::collections::BTreeMap::new();
    for role in POLICY_ROLES {
        let stored = value.get("roles").and_then(|roles| roles.get(role));
        roles.insert(
            role.to_owned(),
            RolePolicy {
                enabled: true,
                provider: string_at(stored, "provider").unwrap_or_else(|| "claude".to_owned()),
                model: string_at(stored, "model"),
                run_mode: string_at(stored, "executionMode").unwrap_or_else(|| "once".to_owned()),
                max_parallel: number_at(stored, "maxParallel").unwrap_or(DEFAULT_ROLE_MAX_PARALLEL),
                interval_seconds: number_at(stored, "pollIntervalSeconds")
                    .unwrap_or(DEFAULT_POLL_INTERVAL_SECONDS),
                max_per: number_at(stored, "executionLimit"),
            },
        );
    }
    ProjectPolicy {
        project_id: string_at(Some(value), "projectId").unwrap_or_default(),
        // 저장된 경로를 그대로 싣는다. 호출자가 연 프로젝트와 다르면 저장 단계가 거절한다.
        working_directory: string_at(Some(value), "workingDirectory")
            .unwrap_or_else(|| working_directory.to_owned()),
        project_max_parallel: number_at(Some(value), "projectMaxParallel")
            .unwrap_or(DEFAULT_PROJECT_MAX_PARALLEL),
        device_max_parallel: number_at(Some(value), "deviceMaxParallel")
            .unwrap_or(DEFAULT_DEVICE_MAX_PARALLEL),
        roles,
    }
}

/// 앱의 정책을 런타임 설정 계약의 모양으로 옮긴다. 계약에 없는 필드를 넣지 않는다.
fn to_runtime(policy: &ProjectPolicy) -> Value {
    let mut roles = serde_json::Map::new();
    for (role, value) in &policy.roles {
        roles.insert(
            role.clone(),
            json!({
                "provider": value.provider,
                "model": value.model,
                "executionMode": value.run_mode,
                "maxParallel": value.max_parallel,
                "pollIntervalSeconds": value.interval_seconds,
                "executionLimit": value.max_per,
            }),
        );
    }
    json!({
        "projectId": policy.project_id,
        "workingDirectory": policy.working_directory,
        "projectMaxParallel": policy.project_max_parallel,
        "deviceMaxParallel": policy.device_max_parallel,
        "paused": false,
        "eventRetentionDays": 30,
        "roles": Value::Object(roles),
    })
}

/// 읽은 설정의 지문. 런타임 계약에 revision 필드가 없어 앱이 읽은 내용에서 만든다.
fn revision_of(stored: Option<&Value>) -> String {
    let mut hasher = Sha256::new();
    match stored {
        Some(value) => hasher.update(canonical(value).as_bytes()),
        None => hasher.update(b"absent"),
    }
    format!("{:x}", hasher.finalize())[..32].to_owned()
}

/// 미리보기의 지문. 기존 잡이 바뀌면 값이 달라져 적용이 거절된다.
fn preview_fingerprint(project_id: &str, jobs: &[ManagedRoleJob]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(project_id.as_bytes());
    for job in jobs {
        for part in [
            Some(job.role.as_str()),
            job.interval.as_deref(),
            job.max_per.as_deref(),
            job.model.as_deref(),
            job.timeout.as_deref(),
        ] {
            hasher.update(part.unwrap_or("none").as_bytes());
            hasher.update(b"\0");
        }
    }
    format!("{:x}", hasher.finalize())[..32].to_owned()
}

/// 키 순서에 흔들리지 않는 직렬화. 같은 설정이 다른 지문을 내지 않게 한다.
fn canonical(value: &Value) -> String {
    match value {
        Value::Object(entries) => {
            let mut keys: Vec<&String> = entries.keys().collect();
            keys.sort();
            let body: Vec<String> = keys
                .into_iter()
                .map(|key| format!("{key}:{}", canonical(&entries[key])))
                .collect();
            format!("{{{}}}", body.join(","))
        }
        Value::Array(items) => {
            let body: Vec<String> = items.iter().map(canonical).collect();
            format!("[{}]", body.join(","))
        }
        other => other.to_string(),
    }
}

fn string_at(value: Option<&Value>, key: &str) -> Option<String> {
    value?
        .get(key)?
        .as_str()
        .map(str::to_owned)
        .filter(|found| !found.is_empty())
}

fn number_at(value: Option<&Value>, key: &str) -> Option<u32> {
    value?.get(key)?.as_u64().map(|found| found as u32)
}

fn unresolvable(job: &ManagedRoleJob, field: &str, value: Option<&str>) -> UnresolvedValue {
    UnresolvedValue {
        role: job.role.clone(),
        field: field.to_owned(),
        value: value.unwrap_or_default().to_owned(),
        reason: "값의 모양을 계약의 숫자로 읽지 못했습니다".to_owned(),
    }
}

/// `30m`, `2h`, `600` 같은 기존 표기를 초로 읽는다. 모양이 다르면 읽지 않는다.
fn parse_duration_seconds(value: &str) -> Option<u32> {
    let trimmed = value.trim();
    let (digits, multiplier) = match trimmed.chars().last()? {
        's' => (&trimmed[..trimmed.len() - 1], 1),
        'm' => (&trimmed[..trimmed.len() - 1], 60),
        'h' => (&trimmed[..trimmed.len() - 1], 3600),
        _ => (trimmed, 1),
    };
    digits.trim().parse::<u32>().ok()?.checked_mul(multiplier)
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::{AgentRuntimeConfigService, ConfigFailure};
    use crate::application::heartbeat_service::ManagedRoleJob;
    use crate::domain::agent_runtime::{Compatibility, PolicyRejection};
    use crate::infrastructure::agent_runtime_process::tests::FakeCaller;
    use crate::infrastructure::agent_runtime_process::Captured;

    fn envelope(data: serde_json::Value) -> Captured {
        Captured {
            code: Some(0),
            stdout: json!({
                "apiVersion": "1", "requestId": "r", "command": "config.read",
                "outcome": "success", "data": data,
            })
            .to_string(),
            stderr: String::new(),
        }
    }

    fn configuration(project: &str, directory: &str, developer_parallel: u32) -> serde_json::Value {
        json!({
            "projectId": project,
            "workingDirectory": directory,
            "projectMaxParallel": 3,
            "deviceMaxParallel": 16,
            "paused": false,
            "eventRetentionDays": 30,
            "roles": {
                "planner": role("claude", json!(null), "once", 1, 300, json!(null)),
                "architect": role("codex", json!("gpt-5"), "continuous", 1, 600, json!(4)),
                "developer": role("claude", json!(null), "once", developer_parallel, 300, json!(null)),
            },
        })
    }

    fn role(
        provider: &str,
        model: serde_json::Value,
        mode: &str,
        parallel: u32,
        interval: u32,
        limit: serde_json::Value,
    ) -> serde_json::Value {
        json!({
            "provider": provider, "model": model, "executionMode": mode,
            "maxParallel": parallel, "pollIntervalSeconds": interval, "executionLimit": limit,
        })
    }

    fn diagnostics() -> serde_json::Value {
        json!({"providers": [{"provider": "claude", "status": "login_required", "version": null}]})
    }

    fn job(role: &str, interval: Option<&str>, max_per: Option<&str>, model: Option<&str>, timeout: Option<&str>) -> ManagedRoleJob {
        ManagedRoleJob {
            role: role.to_owned(),
            interval: interval.map(str::to_owned),
            max_per: max_per.map(str::to_owned),
            model: model.map(str::to_owned),
            timeout: timeout.map(str::to_owned),
            app_owned_drift: Vec::new(),
        }
    }

    #[test]
    fn a_stored_configuration_comes_back_field_for_field() {
        let caller = FakeCaller::new(vec![
            Ok(envelope(json!({"configuration": configuration("p1", "/p1", 2)}))),
            Ok(envelope(diagnostics())),
        ]);

        let snapshot = AgentRuntimeConfigService
            .read(&caller, "p1", "/p1", Compatibility::Compatible)
            .expect("snapshot");

        assert!(snapshot.stored);
        assert_eq!(snapshot.policy.project_id, "p1");
        assert_eq!(snapshot.policy.roles["architect"].provider, "codex");
        assert_eq!(snapshot.policy.roles["architect"].model.as_deref(), Some("gpt-5"));
        assert_eq!(snapshot.policy.roles["architect"].run_mode, "continuous");
        assert_eq!(snapshot.policy.roles["architect"].interval_seconds, 600);
        assert_eq!(snapshot.policy.roles["architect"].max_per, Some(4));
        assert_eq!(snapshot.policy.roles["developer"].max_parallel, 2);
        assert_eq!(snapshot.providers.len(), 1);
    }

    #[test]
    fn a_project_without_a_stored_configuration_gets_the_default_limits() {
        let caller = FakeCaller::new(vec![
            Ok(envelope(json!({"configuration": null}))),
            Ok(envelope(diagnostics())),
        ]);

        let snapshot = AgentRuntimeConfigService
            .read(&caller, "fresh", "/fresh", Compatibility::Compatible)
            .expect("snapshot");

        assert!(!snapshot.stored);
        assert_eq!(snapshot.policy.project_max_parallel, 3);
        assert_eq!(snapshot.policy.roles["developer"].max_parallel, 1);
    }

    #[test]
    fn two_projects_never_mix_their_values() {
        let first = FakeCaller::new(vec![
            Ok(envelope(json!({"configuration": configuration("p1", "/p1", 2)}))),
            Ok(envelope(diagnostics())),
        ]);
        let second = FakeCaller::new(vec![
            Ok(envelope(json!({"configuration": configuration("p2", "/p2", 3)}))),
            Ok(envelope(diagnostics())),
        ]);

        let one = AgentRuntimeConfigService
            .read(&first, "p1", "/p1", Compatibility::Compatible)
            .expect("snapshot");
        let two = AgentRuntimeConfigService
            .read(&second, "p2", "/p2", Compatibility::Compatible)
            .expect("snapshot");

        assert_eq!(one.policy.project_id, "p1");
        assert_eq!(two.policy.project_id, "p2");
        assert_eq!(one.policy.working_directory, "/p1");
        assert_eq!(two.policy.working_directory, "/p2");
        assert_ne!(one.revision, two.revision);
    }

    #[test]
    fn a_save_on_a_stale_revision_writes_nothing_and_returns_the_current_value() {
        let caller = FakeCaller::new(vec![
            Ok(envelope(json!({"configuration": configuration("p1", "/p1", 2)}))),
            Ok(envelope(diagnostics())),
            Ok(envelope(json!({"configuration": configuration("p1", "/p1", 3)}))),
            Ok(envelope(diagnostics())),
        ]);
        let read = AgentRuntimeConfigService
            .read(&caller, "p1", "/p1", Compatibility::Compatible)
            .expect("snapshot");

        let failure = AgentRuntimeConfigService
            .save(&caller, &read.policy, &read.revision, Compatibility::Compatible)
            .expect_err("refused");

        match failure {
            ConfigFailure::Stale(current) => {
                assert_eq!(current.policy.roles["developer"].max_parallel, 3)
            }
            other => panic!("stale expected, got {other:?}"),
        }
        // 조회 두 번뿐이고 쓰기 호출은 나가지 않았다.
        assert_eq!(caller.calls.borrow().len(), 4);
    }

    #[test]
    fn an_unsupported_provider_is_refused_before_the_runtime_is_called() {
        let caller = FakeCaller::new(vec![]);
        let mut policy = crate::domain::agent_runtime::default_policy("p1", "/p1");
        policy.roles.get_mut("developer").expect("role").provider = "gemini".to_owned();

        let failure = AgentRuntimeConfigService
            .save(&caller, &policy, "any", Compatibility::Compatible)
            .expect_err("refused");

        assert!(matches!(
            failure,
            ConfigFailure::Rejected(PolicyRejection::UnsupportedProvider { .. })
        ));
        assert!(caller.calls.borrow().is_empty());
    }

    #[test]
    fn an_incompatible_runtime_is_never_written_to() {
        let caller = FakeCaller::new(vec![]);
        let policy = crate::domain::agent_runtime::default_policy("p1", "/p1");

        let failure = AgentRuntimeConfigService
            .save(
                &caller,
                &policy,
                "any",
                Compatibility::UnsupportedApiMajor { found: 9, supported: 1 },
            )
            .expect_err("refused");

        assert!(matches!(failure, ConfigFailure::Incompatible(_)));
        assert!(caller.calls.borrow().is_empty());
    }

    #[test]
    fn a_role_the_contract_cannot_disable_is_refused_instead_of_silently_enabled() {
        let caller = FakeCaller::new(vec![]);
        let mut policy = crate::domain::agent_runtime::default_policy("p1", "/p1");
        policy.roles.get_mut("planner").expect("role").enabled = false;

        let failure = AgentRuntimeConfigService
            .save(&caller, &policy, "any", Compatibility::Compatible)
            .expect_err("refused");

        assert!(matches!(
            failure,
            ConfigFailure::Rejected(PolicyRejection::RoleDisableUnsupported { .. })
        ));
        assert!(caller.calls.borrow().is_empty());
    }

    #[test]
    fn a_matching_revision_writes_once_and_returns_the_saved_value() {
        let caller = FakeCaller::new(vec![
            Ok(envelope(json!({"configuration": configuration("p1", "/p1", 2)}))),
            Ok(envelope(diagnostics())),
            Ok(envelope(json!({"configuration": configuration("p1", "/p1", 2)}))),
            Ok(envelope(diagnostics())),
            Ok(envelope(json!({"configuration": configuration("p1", "/p1", 2)}))),
            Ok(envelope(json!({"configuration": configuration("p1", "/p1", 2)}))),
            Ok(envelope(diagnostics())),
        ]);
        let read = AgentRuntimeConfigService
            .read(&caller, "p1", "/p1", Compatibility::Compatible)
            .expect("snapshot");

        let saved = AgentRuntimeConfigService
            .save(&caller, &read.policy, &read.revision, Compatibility::Compatible)
            .expect("saved");

        assert_eq!(saved.policy.roles["developer"].max_parallel, 2);
        let commands: Vec<String> = caller
            .calls
            .borrow()
            .iter()
            .map(|(arguments, _)| arguments.join(" "))
            .collect();
        assert_eq!(commands.iter().filter(|value| value.contains("write")).count(), 1);
    }

    #[test]
    fn the_migration_preview_keeps_every_legacy_value_or_lists_it() {
        let jobs = vec![
            job("planner", Some("30m"), Some("4"), Some("sonnet"), Some("15m")),
            job("developer", Some("이상한값"), Some("셋"), None, None),
        ];

        let preview = AgentRuntimeConfigService.migration_preview("p1", "/p1", &jobs);

        assert_eq!(preview.proposed.roles["planner"].interval_seconds, 1800);
        assert_eq!(preview.proposed.roles["planner"].max_per, Some(4));
        assert_eq!(preview.proposed.roles["planner"].model.as_deref(), Some("sonnet"));
        assert_eq!(preview.proposed.roles["planner"].provider, "claude");
        assert_eq!(preview.untouched_roles, vec!["architect".to_owned()]);
        let listed: Vec<(&str, &str)> = preview
            .unresolved
            .iter()
            .map(|value| (value.field.as_str(), value.value.as_str()))
            .collect();
        assert_eq!(
            listed,
            vec![("timeout", "15m"), ("interval", "이상한값"), ("maxPer", "셋")]
        );
    }

    #[test]
    fn a_preview_from_older_jobs_cannot_be_applied() {
        let caller = FakeCaller::new(vec![]);
        let jobs = vec![job("planner", Some("30m"), None, None, None)];
        let preview = AgentRuntimeConfigService.migration_preview("p1", "/p1", &jobs);
        let changed = vec![job("planner", Some("45m"), None, None, None)];

        let failure = AgentRuntimeConfigService
            .apply_migration(
                &caller,
                &super::MigrationRequest {
                    project_id: "p1".to_owned(),
                    working_directory: "/p1".to_owned(),
                    jobs: changed,
                    preview_id: preview.preview_id.clone(),
                    baseline_revision: "any".to_owned(),
                },
                Compatibility::Compatible,
            )
            .expect_err("refused");

        assert_eq!(failure, ConfigFailure::StalePreview);
        assert!(caller.calls.borrow().is_empty());
    }

    #[test]
    fn provider_diagnostics_ride_along_without_changing_the_stored_values() {
        let caller = FakeCaller::new(vec![
            Ok(envelope(json!({"configuration": configuration("p1", "/p1", 2)}))),
            Ok(envelope(json!({"providers": [
                {"provider": "claude", "status": "executable_missing", "version": null},
                {"provider": "codex", "status": "unsupported_version", "version": "0.1"},
            ]}))),
        ]);

        let snapshot = AgentRuntimeConfigService
            .read(&caller, "p1", "/p1", Compatibility::Compatible)
            .expect("snapshot");

        let statuses: Vec<&str> = snapshot
            .providers
            .iter()
            .filter_map(|value| value.get("status").and_then(serde_json::Value::as_str))
            .collect();
        assert_eq!(statuses, vec!["executable_missing", "unsupported_version"]);
        assert_eq!(snapshot.policy.roles["architect"].provider, "codex");
    }
}
