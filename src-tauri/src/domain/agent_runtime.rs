//! 에이전트 런타임의 호환성 판정과 계약 어휘.
//!
//! 이 모듈은 파일도 프로세스도 건드리지 않는다. 런타임이 JSON으로 준 사실을 앱의 값으로 옮기고,
//! 그 값으로 "지금 설정과 실행을 열어도 되는가"를 판정하는 규칙만 둔다.
//!
//! **모르는 값을 아는 척하지 않는다.** 런타임 계약은 확인한 값과 확인하지 못한 값과 권한 때문에
//! 확인할 수 없는 값을 서로 다른 값으로 준다(`docs/agent-runtime-contract.md`의 `기기 상태 조회`).
//! 앱은 그 구분을 그대로 들고 다닌다. 모름을 실행 중으로 접으면 사용자는 도는 줄 알고 기다리고,
//! 실행 중을 모름으로 접으면 멀쩡한 기기에 복구를 권하게 된다.
//!
//! **단계 이름을 앱이 만들지 않는다.** 적용 결과의 다섯 단계는 런타임 계약이 정한 이름 그대로다
//! (`docs/runtime-management-contract.md`의 `업데이트 적용`). 앱이 새 이름을 만들거나 여러 단계를
//! 하나로 합치면 화면이 말하는 실패 지점과 런타임이 말하는 실패 지점이 갈라진다.

use serde::{Deserialize, Serialize};

/// 앱이 지원하는 런타임 API 주 버전. 이 값과 다른 런타임과는 계약이 통하지 않는다.
pub const SUPPORTED_API_MAJOR: u32 = 1;

/// 앱이 다룰 수 있는 런타임 버전의 아래 끝과 위 끝.
///
/// 세 상수를 한 곳에 둔다. 호환 판정이 여러 자리에 흩어지면 설치 경로에서는 막히고 실행 경로에서는
/// 열리는 상태가 생기고, 그 어긋남은 사용자에게 "됐다가 안 됐다가"로 보인다.
pub const MINIMUM_RUNTIME_VERSION: &str = "0.9.0";
pub const MAXIMUM_RUNTIME_VERSION: &str = "1.99.99";

/// 런타임이 돌려준 서비스 판정. 계약이 정한 일곱 어휘를 그대로 옮긴다.
///
/// 문자열을 그대로 들고 다니지 않고 값으로 바꾸는 것은, 앱이 모르는 어휘를 만났을 때 조용히
/// 넘어가지 않게 하기 위해서다. 모르는 값은 `Unrecognized`가 되어 화면까지 그대로 간다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceResult {
    Registered,
    NotRegistered,
    ExecutableMissing,
    AmbiguousRegistration,
    PermissionDenied,
    ToolMissing,
    UnsupportedPlatform,
    #[serde(other)]
    Unrecognized,
}

/// 런타임 조회의 서비스 상태. 필드 이름과 뜻은 런타임 계약에서 온다.
///
/// `registered`와 `running`이 `Option<bool>`인 것이 이 구조의 핵심이다. `None`은 확인하지 못했다는
/// 뜻이고 앱은 그것을 거짓으로도 참으로도 바꾸지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceState {
    pub platform: String,
    pub result: ServiceResult,
    pub registered: Option<bool>,
    pub running: Option<bool>,
    pub label: String,
    pub executable: String,
    pub recoverable: Option<bool>,
    pub checked_at: String,
    #[serde(default)]
    pub evidence: Vec<String>,
}

/// 기기 조회 한 번의 결과. 런타임 응답의 필드를 그대로 옮긴 값이다.
///
/// 앱이 launcher 파일이나 plist, unit 파일, Task Scheduler 출력을 열어 보는 경로는 없다. 이 구조체를
/// 채우는 유일한 입력은 런타임의 JSON 응답이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub result: String,
    pub checked_at: String,
    pub runtime_version: Option<String>,
    pub installed_version: Option<String>,
    pub running_version: Option<String>,
    pub api_major: u32,
    pub target: String,
    pub install_result: String,
    pub recoverable: Option<bool>,
    pub service: ServiceState,
}

/// 호환 판정. 사유마다 사용자가 할 다음 행동이 다르므로 값을 나눈다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Compatibility {
    /// API 주 버전과 버전 범위가 모두 맞다.
    Compatible,
    /// 계약 자체가 통하지 않는다. 앱이나 런타임 한쪽을 바꿔야 한다.
    #[serde(rename_all = "camelCase")]
    UnsupportedApiMajor { found: u32, supported: u32 },
    /// 계약은 통하는데 버전이 앱이 다루는 범위 밖이다.
    #[serde(rename_all = "camelCase")]
    VersionOutOfRange {
        found: String,
        minimum: String,
        maximum: String,
    },
    /// 디스크의 버전과 도는 버전이 다르다. 디스크만 새 버전인 상태를 정상으로 표시하지 않는다.
    #[serde(rename_all = "camelCase")]
    RestartRequired { installed: String, running: String },
    /// 판정에 필요한 값을 읽지 못했다. 모름은 호환도 불호환도 아니다.
    #[serde(rename_all = "camelCase")]
    Undetermined { reason: String },
}

impl Compatibility {
    /// 설정과 실행 명령을 열어도 되는지. 호환일 때만 참이다.
    ///
    /// 모름에서 참을 내지 않는다. 확인하지 못한 기기에서 provider를 띄우면 어떤 버전이 무슨 계약으로
    /// 답할지 모르는 채 실행이 시작된다.
    pub fn allows_execution(&self) -> bool {
        matches!(self, Compatibility::Compatible)
    }
}

/// 런타임 조회 결과로 호환을 판정한다.
///
/// 순서가 규칙의 일부다. API 주 버전이 다르면 버전 범위를 볼 이유가 없고, 범위를 벗어나면 재시작
/// 필요를 따질 이유가 없다. 앞의 사유가 뒤의 사유를 가린다.
pub fn judge(status: &RuntimeStatus) -> Compatibility {
    if status.api_major != SUPPORTED_API_MAJOR {
        return Compatibility::UnsupportedApiMajor {
            found: status.api_major,
            supported: SUPPORTED_API_MAJOR,
        };
    }
    let Some(installed) = status.installed_version.as_deref() else {
        return Compatibility::Undetermined {
            reason: status.install_result.clone(),
        };
    };
    if !within_supported_range(installed) {
        return Compatibility::VersionOutOfRange {
            found: installed.to_owned(),
            minimum: MINIMUM_RUNTIME_VERSION.to_owned(),
            maximum: MAXIMUM_RUNTIME_VERSION.to_owned(),
        };
    }
    match status.running_version.as_deref() {
        Some(running) if running != installed => Compatibility::RestartRequired {
            installed: installed.to_owned(),
            running: running.to_owned(),
        },
        Some(_) => Compatibility::Compatible,
        // 도는 버전을 모르는 것은 서비스가 안 도는 것과 확인 못 한 것 둘 다일 수 있다. 런타임이
        // 그 둘을 서비스 판정으로 이미 갈라 놓았으므로 여기서는 설치본만으로 호환을 말한다.
        None => Compatibility::Compatible,
    }
}

/// 버전 문자열이 지원 범위 안인지. 점으로 나눈 숫자를 앞에서부터 비교한다.
///
/// 계약이 정한 모양은 점으로 나뉜 숫자다. 숫자가 아닌 조각이 섞이면 범위를 판정하지 않고 범위 밖으로
/// 두지도 않는다 — 그 경우는 호출자가 모름으로 다룬다.
fn within_supported_range(version: &str) -> bool {
    let Some(found) = numeric_parts(version) else {
        return false;
    };
    let (Some(minimum), Some(maximum)) = (
        numeric_parts(MINIMUM_RUNTIME_VERSION),
        numeric_parts(MAXIMUM_RUNTIME_VERSION),
    ) else {
        return false;
    };
    found >= minimum && found <= maximum
}

fn numeric_parts(version: &str) -> Option<Vec<u32>> {
    let parts: Option<Vec<u32>> = version.split('.').map(|part| part.parse().ok()).collect();
    let mut parts = parts?;
    parts.resize(3, 0);
    Some(parts)
}

/// 적용 결과의 단계. 런타임 계약이 정한 다섯 이름과 순서를 그대로 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateStage {
    ManifestVerification,
    VersionInstall,
    LauncherSwitch,
    ServiceTransition,
    RunningVersionCheck,
    /// 계약에 없는 단계 이름이 왔다. 앱이 아는 이름으로 바꾸지 않고 그대로 남긴다.
    #[serde(other)]
    Unrecognized,
}

/// 단계 하나의 결과.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageResult {
    pub stage: UpdateStage,
    pub status: String,
    pub detail: Option<String>,
}

/// 업데이트 계획. 런타임 응답을 그대로 옮긴다.
///
/// `active_runs`와 `projects`는 런타임이 센 값이다. 앱이 같은 수를 따로 세지 않는다 — 두 곳에서 세면
/// 화면이 보여 준 수와 실제로 영향받는 수가 갈린다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlan {
    pub plan_id: String,
    pub result: String,
    pub target_version: Option<String>,
    pub target: String,
    pub manifest_verified: bool,
    pub launcher_switch_required: bool,
    pub service_transition_required: bool,
    pub recoverable_on_failure: bool,
    pub installed_version: Option<String>,
    pub running_version: Option<String>,
    pub active_runs: u32,
    pub projects: Vec<String>,
    pub service: ServiceState,
}

/// 적용 결과. 단계별 결과와 지금 실행 가능한 버전을 함께 싣는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateApplication {
    pub plan_id: String,
    pub result: String,
    pub stages: Vec<StageResult>,
    pub runnable_version: Option<String>,
    #[serde(default)]
    pub recovery_actions: Vec<String>,
    pub detail: Option<String>,
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::{
        default_policy, judge, validate_policy, Compatibility, RuntimeStatus, ServiceResult,
        ServiceState, MINIMUM_RUNTIME_VERSION, SUPPORTED_API_MAJOR,
    };

    fn service() -> ServiceState {
        ServiceState {
            platform: "launchd".into(),
            result: ServiceResult::Registered,
            registered: Some(true),
            running: Some(true),
            label: "com.claude-heartbeat".into(),
            executable: "/opt/runtime/bin/heartbeat".into(),
            recoverable: Some(true),
            checked_at: "2026-08-08T09:00:00Z".into(),
            evidence: vec!["launch_agents_directory".into()],
        }
    }

    fn status(installed: Option<&str>, running: Option<&str>, api_major: u32) -> RuntimeStatus {
        RuntimeStatus {
            result: "ok".into(),
            checked_at: "2026-08-08T09:00:00Z".into(),
            runtime_version: Some(MINIMUM_RUNTIME_VERSION.into()),
            installed_version: installed.map(str::to_owned),
            running_version: running.map(str::to_owned),
            api_major,
            target: "macos-universal".into(),
            install_result: "installed".into(),
            recoverable: Some(true),
            service: service(),
        }
    }

    #[test]
    fn matching_versions_are_compatible() {
        let verdict = judge(&status(
            Some(MINIMUM_RUNTIME_VERSION),
            Some(MINIMUM_RUNTIME_VERSION),
            SUPPORTED_API_MAJOR,
        ));

        assert_eq!(verdict, Compatibility::Compatible);
        assert!(verdict.allows_execution());
    }

    #[test]
    fn a_different_api_major_hides_every_other_reason() {
        let verdict = judge(&status(Some("99.0.0"), Some("0.1.0"), 2));

        assert_eq!(
            verdict,
            Compatibility::UnsupportedApiMajor {
                found: 2,
                supported: SUPPORTED_API_MAJOR,
            }
        );
        assert!(!verdict.allows_execution());
    }

    #[test]
    fn a_version_outside_the_supported_range_is_not_compatible() {
        let verdict = judge(&status(Some("0.1.0"), Some("0.1.0"), SUPPORTED_API_MAJOR));

        assert!(matches!(verdict, Compatibility::VersionOutOfRange { .. }));
        assert!(!verdict.allows_execution());
    }

    #[test]
    fn a_disk_only_upgrade_asks_for_a_restart_instead_of_reporting_health() {
        let verdict = judge(&status(Some("0.9.0"), Some("0.8.0"), SUPPORTED_API_MAJOR));

        assert_eq!(
            verdict,
            Compatibility::RestartRequired {
                installed: "0.9.0".into(),
                running: "0.8.0".into(),
            }
        );
        assert!(!verdict.allows_execution());
    }

    #[test]
    fn an_unreadable_install_stays_undetermined() {
        let mut unreadable = status(None, None, SUPPORTED_API_MAJOR);
        unreadable.install_result = "launcher_missing".into();

        let verdict = judge(&unreadable);

        assert_eq!(
            verdict,
            Compatibility::Undetermined {
                reason: "launcher_missing".into(),
            }
        );
        assert!(!verdict.allows_execution());
    }

    #[test]
    fn an_unknown_service_word_is_kept_instead_of_being_dropped() {
        let decoded: ServiceResult = serde_json::from_str("\"brand_new_word\"").expect("decode");

        assert_eq!(decoded, ServiceResult::Unrecognized);
    }

    #[test]
    fn project_capacity_may_exceed_the_current_device_choice() {
        let mut policy = default_policy("project", "/project");
        policy.project_max_parallel = 48;
        policy.device_max_parallel = 4;

        assert_eq!(validate_policy(&policy), Ok(()));
    }
}

// --- 프로젝트별 역할 정책 -------------------------------------------------
//
// 저장의 정본은 런타임의 설정 계약이다. 앱은 그 계약의 필드를 그대로 옮기고, 계약에 없는 값을
// 만들어 넣지 않는다. 여기 있는 것은 화면이 보내온 값을 쓰기 전에 거절할 규칙뿐이다.

/// 계약이 정한 세 역할. 앱이 새 역할을 만들지 않는다.
pub const POLICY_ROLES: [&str; 3] = ["architect", "developer", "planner"];
/// 첫 릴리스가 허용하는 provider.
pub const SUPPORTED_PROVIDERS: [&str; 2] = ["claude", "codex"];
/// 계약이 정한 실행 방식.
pub const RUN_MODES: [&str; 2] = ["continuous", "once"];

pub const DEFAULT_ROLE_MAX_PARALLEL: u32 = 1;
pub const DEFAULT_PROJECT_MAX_PARALLEL: u32 = 3;
pub const DEFAULT_DEVICE_MAX_PARALLEL: u32 = 16;
pub const DEFAULT_POLL_INTERVAL_SECONDS: u32 = 300;

/// 역할 하나의 정책. 필드 이름은 앱 화면이 쓰는 이름이고, 런타임 계약의 이름으로는 저장할 때 옮긴다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolePolicy {
    /// 이 역할을 쓰는지. 런타임 설정 계약에는 대응 필드가 없어 거짓으로는 저장할 수 없다.
    pub enabled: bool,
    pub provider: String,
    /// 빈 값이면 각 CLI의 기본 모델을 쓴다. 앱이 임의 모델명을 넣지 않는다.
    pub model: Option<String>,
    pub run_mode: String,
    pub max_parallel: u32,
    pub interval_seconds: u32,
    /// 실행 한도. 없으면 한도를 두지 않는다.
    pub max_per: Option<u32>,
}

/// 프로젝트 하나의 정책 전체.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPolicy {
    pub project_id: String,
    pub working_directory: String,
    pub project_max_parallel: u32,
    pub device_max_parallel: u32,
    /// 프로젝트 자동 배정의 마스터. 꺼도 역할 선택과 실행 중 세션은 유지한다.
    pub automation_enabled: bool,
    /// 역할 이름으로 찾는다. 세 역할이 모두 있어야 한다.
    pub roles: std::collections::BTreeMap<String, RolePolicy>,
}

/// 쓰기 전에 거절하는 사유. 사유마다 화면이 고칠 자리가 다르다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PolicyRejection {
    #[serde(rename_all = "camelCase")]
    RolesIncomplete { expected: Vec<String> },
    #[serde(rename_all = "camelCase")]
    UnsupportedProvider { role: String, provider: String },
    #[serde(rename_all = "camelCase")]
    UnsupportedRunMode { role: String, run_mode: String },
    #[serde(rename_all = "camelCase")]
    RoleLimitExceeded {
        role: String,
        found: u32,
        limit: u32,
    },
    #[serde(rename_all = "camelCase")]
    InvalidProjectLimit { found: u32 },
    #[serde(rename_all = "camelCase")]
    InvalidValue { role: String, field: String },
    #[serde(rename_all = "camelCase")]
    WorkingDirectoryMismatch { requested: String, actual: String },
    #[serde(rename_all = "camelCase")]
    ProjectIdMismatch { requested: String, actual: String },
}

/// 화면이 보낸 정책을 쓰기 전에 검사한다. 하나라도 걸리면 아무것도 쓰지 않는다.
pub fn validate_policy(policy: &ProjectPolicy) -> Result<(), PolicyRejection> {
    let mut names: Vec<&str> = policy.roles.keys().map(String::as_str).collect();
    names.sort_unstable();
    if names != POLICY_ROLES {
        return Err(PolicyRejection::RolesIncomplete {
            expected: POLICY_ROLES.iter().map(|role| (*role).to_owned()).collect(),
        });
    }
    if policy.project_max_parallel == 0 {
        return Err(PolicyRejection::InvalidProjectLimit {
            found: policy.project_max_parallel,
        });
    }
    for (role, value) in &policy.roles {
        if !SUPPORTED_PROVIDERS.contains(&value.provider.as_str()) {
            return Err(PolicyRejection::UnsupportedProvider {
                role: role.clone(),
                provider: value.provider.clone(),
            });
        }
        if !RUN_MODES.contains(&value.run_mode.as_str()) {
            return Err(PolicyRejection::UnsupportedRunMode {
                role: role.clone(),
                run_mode: value.run_mode.clone(),
            });
        }
        if value.max_parallel == 0 || value.max_parallel > policy.project_max_parallel {
            return Err(PolicyRejection::RoleLimitExceeded {
                role: role.clone(),
                found: value.max_parallel,
                limit: policy.project_max_parallel,
            });
        }
        if value.interval_seconds == 0 {
            return Err(PolicyRejection::InvalidValue {
                role: role.clone(),
                field: "intervalSeconds".to_owned(),
            });
        }
        if matches!(value.max_per, Some(0)) {
            return Err(PolicyRejection::InvalidValue {
                role: role.clone(),
                field: "maxPer".to_owned(),
            });
        }
        if value
            .model
            .as_ref()
            .is_some_and(|model| model.trim().is_empty())
        {
            return Err(PolicyRejection::InvalidValue {
                role: role.clone(),
                field: "model".to_owned(),
            });
        }
    }
    Ok(())
}

/// 새 프로젝트에 적용할 기본 정책.
pub fn default_policy(project_id: &str, working_directory: &str) -> ProjectPolicy {
    let mut roles = std::collections::BTreeMap::new();
    for role in POLICY_ROLES {
        roles.insert(
            role.to_owned(),
            RolePolicy {
                enabled: true,
                provider: SUPPORTED_PROVIDERS[0].to_owned(),
                model: None,
                run_mode: "continuous".to_owned(),
                max_parallel: DEFAULT_ROLE_MAX_PARALLEL,
                interval_seconds: DEFAULT_POLL_INTERVAL_SECONDS,
                max_per: None,
            },
        );
    }
    ProjectPolicy {
        project_id: project_id.to_owned(),
        working_directory: working_directory.to_owned(),
        project_max_parallel: DEFAULT_PROJECT_MAX_PARALLEL,
        device_max_parallel: DEFAULT_DEVICE_MAX_PARALLEL,
        automation_enabled: false,
        roles,
    }
}

// --- 실행 계획과 큐 상태 ---------------------------------------------------
//
// 런타임이 답한 값을 그대로 옮긴다. 앱은 상태를 추측하지 않고, 조회에 실패한 것을 실행 중으로도
// 종료로도 바꾸지 않는다.

/// 런타임 계약이 정한 실행 상태 여덟 개. 계약 밖 이름은 값으로 바꾸지 않고 그대로 남긴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Reserved,
    Queued,
    Running,
    Paused,
    Succeeded,
    Failed,
    Cancelled,
    RecoveryRequired,
    #[serde(other)]
    Unrecognized,
}

/// 실행 행 하나. 화면이 목록으로 보여 줄 값만 담는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub run_id: String,
    pub project_id: String,
    pub role: String,
    pub provider: String,
    pub state: RunState,
    pub target_id: Option<String>,
    pub started_at: Option<String>,
    /// 종료 상태로 전환한 시각. 구형 런타임과 활성 실행에서는 비어 있다.
    #[serde(default)]
    pub finished_at: Option<String>,
    /// 어느 단계에서 실패했는지. 계약이 정한 여섯 단계 이름이 그대로 온다.
    pub failure_stage: Option<String>,
    pub reason: Option<String>,
    #[serde(default)]
    pub remaining: Vec<String>,
    pub previous_run_id: Option<String>,
}

#[cfg(test)]
mod run_summary_tests {
    use serde_json::json;

    use super::RunSummary;

    fn run(finished_at: serde_json::Value) -> serde_json::Value {
        json!({
            "runId": "run-1",
            "projectId": "project-1",
            "role": "developer",
            "provider": "codex",
            "state": "failed",
            "targetId": "TASK-1",
            "startedAt": "2026-08-10T10:00:00Z",
            "finishedAt": finished_at,
            "failureStage": "role_session",
            "reason": "provider_failed",
            "remaining": [],
            "previousRunId": null
        })
    }

    #[test]
    fn finish_time_round_trips_in_camel_case_and_remains_optional_for_legacy_rows() {
        let current: RunSummary = serde_json::from_value(run(json!("2026-08-10T10:00:09Z")))
            .expect("current runtime row");
        let mut legacy = run(serde_json::Value::Null);
        legacy.as_object_mut().expect("row").remove("finishedAt");
        let legacy: RunSummary = serde_json::from_value(legacy).expect("legacy runtime row");

        assert_eq!(current.finished_at.as_deref(), Some("2026-08-10T10:00:09Z"));
        assert_eq!(
            serde_json::to_value(current).expect("serialize")["finishedAt"],
            "2026-08-10T10:00:09Z"
        );
        assert_eq!(legacy.finished_at, None);
    }
}

/// 역할 하나의 계획. 시작 수를 줄인 사유가 함께 온다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolePlanView {
    pub role: String,
    pub provider: String,
    pub execution_mode: String,
    pub requested: u32,
    pub granted: u32,
    #[serde(default)]
    pub excluded: Vec<String>,
    #[serde(default)]
    pub manual_targets: Vec<String>,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub candidates: Vec<serde_json::Value>,
    #[serde(default)]
    pub verdict: String,
    pub diagnostic: serde_json::Value,
}

/// 계획 하나. `plan_id`는 일회용이고 `revision`과 `expires_at`이 그 계획의 유효 조건이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPlan {
    pub plan_id: String,
    pub project_id: String,
    pub revision: String,
    pub expires_at: String,
    pub device_remaining: u32,
    pub project_remaining: u32,
    pub billing_route_risk: bool,
    pub limits: serde_json::Value,
    pub roles: Vec<RolePlanView>,
}

/// 시작 결과. 시작한 실행과 시작하지 못한 사유를 함께 싣는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStartOutcome {
    #[serde(default)]
    pub started: Vec<RunSummary>,
    #[serde(default)]
    pub failures: Vec<serde_json::Value>,
    #[serde(default)]
    pub waiting: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRoleState {
    pub role: String,
    pub status: String,
    pub next_poll_at: Option<String>,
    pub last_check_at: Option<String>,
    pub last_result: Option<String>,
    pub last_assigned_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherState {
    pub status: String,
    pub last_event_at: Option<String>,
    pub error: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSnapshot {
    pub enabled: bool,
    #[serde(default)]
    pub roles: Vec<AutomationRoleState>,
    pub watcher: Option<WatcherState>,
    pub dispatcher_running: bool,
}

/// 취소 미리보기. 무엇을 멈추고 무엇을 정리하는지 먼저 보여 준다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelPreview {
    pub run_id: String,
    pub target_id: Option<String>,
    pub lease_id: Option<String>,
    pub pid: Option<u32>,
    pub process_liveness: String,
    pub child_processes: u32,
    pub cleanup: Vec<String>,
}

/// 이벤트 묶음 하나. cursor만 주고받고 파일 경로는 오가지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLogPage {
    pub run_id: String,
    pub events: Vec<serde_json::Value>,
    pub next_cursor: u64,
}

/// 프로젝트 하나의 큐 상태.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSnapshot {
    pub project_id: String,
    pub paused: bool,
    pub automation: AutomationSnapshot,
    pub runs: Vec<RunSummary>,
    pub errors: Vec<serde_json::Value>,
    pub providers: Vec<serde_json::Value>,
    /// 조회하지 못한 값이 있으면 그 사유. 있으면 화면은 상태를 모름으로 다룬다.
    pub unavailable: Option<String>,
}
