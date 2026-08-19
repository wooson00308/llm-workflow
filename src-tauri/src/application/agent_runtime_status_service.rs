//! 큐 상태 조회와 프로젝트 일시 정지, 실행 로그 읽기.
//!
//! **조회 실패는 추측의 근거가 아니다.** 런타임을 읽지 못하면 상태를 모름으로 두고 사유를 함께
//! 싣는다. 앱이 마지막으로 본 값을 지금도 도는 중이라고 말하지 않는다.
//!
//! **로그는 cursor만 주고받는다.** 화면이 파일 경로를 보내지도 받지도 않으며, 런타임이 이미 민감정보를
//! 제거한 이벤트만 온다. 앱은 그 이벤트를 다시 해석하지 않고 그대로 전달한다.

use std::path::Path;

use chrono::Utc;
use serde::Serialize;
use serde_json::Value;

use crate::application::agent_runtime_install_service::RuntimeInspection;
use crate::domain::agent_runtime::{
    AutomationRoleState, AutomationSnapshot, Compatibility, QueueSnapshot, RunLogPage, RunSummary,
    WatcherState,
};
use crate::infrastructure::agent_runtime_process::{self, RuntimeCallFailure, RuntimeCaller};
use crate::infrastructure::provider_hold;

/// 상태 명령이 실패하는 방식.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusFailure {
    Runtime(RuntimeCallFailure),
    ProjectMismatch { requested: String, answered: String },
    Incompatible(Compatibility),
    OffContract { detail: String },
}

impl StatusFailure {
    pub fn message(&self) -> String {
        match self {
            StatusFailure::Runtime(failure) => failure.message(),
            StatusFailure::ProjectMismatch {
                requested,
                answered,
            } => format!(
                "런타임이 다른 프로젝트({answered})의 값을 돌려줬습니다. 요청은 {requested}입니다."
            ),
            StatusFailure::Incompatible(_) => {
                "이 런타임은 앱이 지원하는 계약 범위 밖입니다.".to_owned()
            }
            StatusFailure::OffContract { detail } => {
                format!("런타임 응답이 계약의 모양이 아닙니다: {detail}")
            }
        }
    }
}

/// 진단 번들 규격 버전. 번들을 나중에 읽는 쪽이 형태를 판단하는 값이다.
const BUNDLE_VERSION: &str = "1";

/// 번들이 이벤트 하나에서 옮기는 값.
///
/// 런타임 계약이 정한 필드만 자리를 가진다. 도구 인자, 도구 결과 본문, 프롬프트처럼 계약 밖 필드는
/// 여기 자리가 없으므로, 런타임이 그런 값을 이벤트에 더 싣더라도 번들로는 옮겨지지 않는다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleEvent {
    pub kind: String,
    pub role: Option<String>,
    pub provider: Option<String>,
    pub target_id: Option<String>,
    /// 실행 시작 시각과 그로부터 흐른 초. 이벤트의 시각 근거는 이 두 값뿐이다.
    pub started_at: Option<String>,
    pub elapsed_seconds: Option<f64>,
    pub tool_name: Option<String>,
    /// 런타임이 준 상세 문장. 도구 이벤트에서는 싣지 않는다 — 도구 결과 본문이 이 자리로 들어오는
    /// 길을 막는다.
    pub detail: Option<String>,
}

/// provider 진단 결과 하나에서 번들이 옮기는 값.
///
/// 계정 모델 목록은 옮기지 않는다. 그 자리는 provider마다 형태가 다른 값이 그대로 들어오는 통로인데,
/// 실패 사유는 `status`가 이미 말해 주므로 번들이 그 통로를 열어 둘 이유가 없다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleProvider {
    pub provider: Option<String>,
    pub status: Option<String>,
    pub version: Option<String>,
}

/// 읽지 못한 항목 하나와 그 사유. 성공으로 추측하지 않고 빠진 사실을 그대로 적는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleGap {
    pub item: String,
    pub reason: String,
}

/// 실행 하나를 재현하는 데 필요한 자료를 한 덩어리로 모은 것.
///
/// 담는 것은 런타임이 이미 저장해 둔 값뿐이다. 이 구조를 채우려고 새로 수집하는 값은 없다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticBundle {
    pub bundle_version: String,
    pub generated_at: String,
    pub project_id: String,
    pub run_id: String,
    /// 실행 메타정보. 큐 상태에서 이 실행의 행을 찾지 못했으면 없다.
    pub run: Option<RunSummary>,
    /// 이 실행이 쓴 provider의 버전. provider 진단 결과에서 온다.
    pub provider_version: Option<String>,
    pub events: Vec<BundleEvent>,
    pub provider_diagnostics: Option<Vec<BundleProvider>>,
    pub runtime_diagnostics: RuntimeInspection,
    /// 런타임이 기록해 둔 최근 오류. 각 기록이 담은 단계와 사유 코드를 그대로 옮긴다.
    pub recent_errors: Option<Vec<Value>>,
    /// 읽지 못한 항목들. 비어 있으면 모두 읽었다는 뜻이다.
    pub unavailable: Vec<BundleGap>,
}

#[derive(Debug, Default)]
pub struct AgentRuntimeStatusService;

impl AgentRuntimeStatusService {
    /// 큐와 실행 상태를 읽는다. 읽지 못하면 모름으로 답하고 실행 중으로 올리지 않는다.
    ///
    /// 실행 목록은 런타임이 영속 기록에서 복원한 값이다. 앱이 자기 메모리에 큐를 들고 있지 않으므로
    /// 앱을 다시 열어도 첫 조회가 같은 값을 낸다.
    /// `hold_root`는 사용 한도 보류 기록의 루트다. 커맨드 계층이 해석해 주며, 홈을 얻지 못했으면
    /// 없이 온다. 없으면 보류를 읽지도 남기지도 않고 나머지는 그대로 답한다.
    pub fn inspect(
        &self,
        caller: &dyn RuntimeCaller,
        project_id: &str,
        compatibility: &Compatibility,
        hold_root: Option<&Path>,
    ) -> QueueSnapshot {
        if !compatibility.allows_execution() {
            return unavailable(project_id, "호환되지 않는 런타임입니다");
        }
        let state = match agent_runtime_process::read_state(caller, project_id) {
            Ok(state) => state,
            Err(failure) => return unavailable(project_id, &failure.message()),
        };
        let runs: Vec<RunSummary> = match state.get("runs") {
            Some(Value::Array(rows)) => rows
                .iter()
                .filter_map(|row| serde_json::from_value(row.clone()).ok())
                .collect(),
            _ => Vec::new(),
        };
        // 다른 프로젝트의 행이 섞여 오면 그 응답 전체를 믿지 않는다.
        if let Some(foreign) = runs.iter().find(|run| run.project_id != project_id) {
            return unavailable(
                project_id,
                &format!(
                    "런타임이 다른 프로젝트({})의 행을 함께 돌려줬습니다",
                    foreign.project_id
                ),
            );
        }
        let providers =
            agent_runtime_process::diagnose_providers(caller, project_id).unwrap_or_default();
        let automation = automation_from_state(&state);
        let provider_holds = match hold_root {
            Some(root) => {
                let now = Utc::now();
                for run in usage_limit_ends(&runs) {
                    provider_hold::record(root, run, now);
                }
                provider_hold::active_holds(root, now)
            }
            None => Vec::new(),
        };
        QueueSnapshot {
            project_id: project_id.to_owned(),
            paused: state
                .get("configuration")
                .and_then(|configuration| configuration.get("paused"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
            automation,
            runs,
            errors: match state.get("errors") {
                Some(Value::Array(values)) => values.clone(),
                _ => Vec::new(),
            },
            providers,
            provider_holds,
            unavailable: None,
        }
    }

    /// 프로젝트의 새 배정만 멈추거나 다시 연다. 실행 중 작업과 다른 프로젝트는 건드리지 않는다.
    pub fn set_paused(
        &self,
        caller: &dyn RuntimeCaller,
        project_id: &str,
        paused: bool,
        compatibility: &Compatibility,
        hold_root: Option<&Path>,
    ) -> Result<QueueSnapshot, StatusFailure> {
        if !compatibility.allows_execution() {
            return Err(StatusFailure::Incompatible(compatibility.clone()));
        }
        let data = agent_runtime_process::set_project_paused(caller, project_id, paused)
            .map_err(StatusFailure::Runtime)?;
        let answered = data
            .get("configuration")
            .and_then(|configuration| configuration.get("projectId"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if answered != project_id {
            return Err(StatusFailure::ProjectMismatch {
                requested: project_id.to_owned(),
                answered: answered.to_owned(),
            });
        }
        Ok(self.inspect(caller, project_id, compatibility, hold_root))
    }

    /// 실행 하나의 이벤트를 cursor부터 읽는다.
    pub fn read_log(
        &self,
        caller: &dyn RuntimeCaller,
        project_id: &str,
        run_id: &str,
        cursor: u64,
        compatibility: &Compatibility,
    ) -> Result<RunLogPage, StatusFailure> {
        if !compatibility.allows_execution() {
            return Err(StatusFailure::Incompatible(compatibility.clone()));
        }
        let data = agent_runtime_process::read_run_log(caller, project_id, run_id, cursor)
            .map_err(StatusFailure::Runtime)?;
        let page: RunLogPage =
            serde_json::from_value(data).map_err(|error| StatusFailure::OffContract {
                detail: error.to_string(),
            })?;
        if page.run_id != run_id {
            return Err(StatusFailure::OffContract {
                detail: "다른 실행의 이벤트가 왔습니다".to_owned(),
            });
        }
        Ok(page)
    }

    /// 실행 하나의 진단 번들을 조립한다. 저장과 복사 두 경로가 모두 이 함수 하나를 지난다.
    ///
    /// 어느 항목을 읽지 못해도 조립을 중단하지 않는다. 읽은 부분을 담고 읽지 못한 항목의 이름과
    /// 사유를 `unavailable`에 적는다 — 빈 값을 조용히 채우면 읽은 것과 없는 것을 구분할 수 없다.
    pub fn export_diagnostics(
        &self,
        caller: &dyn RuntimeCaller,
        project_id: &str,
        run_id: &str,
        runtime: RuntimeInspection,
        compatibility: &Compatibility,
        generated_at: &str,
    ) -> DiagnosticBundle {
        let mut gaps = Vec::new();

        // 실행 메타정보와 최근 오류는 같은 큐 상태에서 온다. 큐 상태 조회는 실패를 사유로 답하므로
        // 여기서도 실패가 조립을 멈추지 않는다.
        // 번들은 실행 행과 최근 오류만 가져간다. 보류 기록은 진단 자료의 항목이 아니므로 루트를
        // 넘기지 않는다.
        let snapshot = self.inspect(caller, project_id, compatibility, None);
        let (run, recent_errors) = match &snapshot.unavailable {
            Some(reason) => {
                gaps.push(gap("run", reason));
                gaps.push(gap("recentErrors", reason));
                (None, None)
            }
            None => {
                let found = snapshot
                    .runs
                    .iter()
                    .find(|row| row.run_id == run_id)
                    .cloned();
                if found.is_none() {
                    gaps.push(gap("run", "큐 상태에 이 실행의 행이 없습니다"));
                }
                (found, Some(snapshot.errors.clone()))
            }
        };

        // 위의 큐 상태 조회도 provider 진단을 부르지만, 그 자리는 실패를 빈 목록으로 떨어뜨려
        // 읽지 못한 것과 진단 대상이 없는 것을 구분하지 못한다. 번들은 그 둘을 구분해야 하므로
        // 여기서 한 번 더 부른다.
        let provider_diagnostics =
            match agent_runtime_process::diagnose_providers(caller, project_id) {
                Ok(providers) => Some(providers.iter().map(bundle_provider).collect::<Vec<_>>()),
                Err(failure) => {
                    gaps.push(gap("providerDiagnostics", &failure.message()));
                    None
                }
            };
        let provider_version = match (&run, &provider_diagnostics) {
            (Some(row), Some(entries)) => entries
                .iter()
                .find(|entry| entry.provider.as_deref() == Some(row.provider.as_str()))
                .and_then(|entry| entry.version.clone()),
            _ => None,
        };

        if let Some(reason) = &runtime.unavailable {
            gaps.push(gap("runtimeDiagnostics", reason));
        }

        let events = self.read_whole_log(caller, project_id, run_id, compatibility, &mut gaps);

        DiagnosticBundle {
            bundle_version: BUNDLE_VERSION.to_owned(),
            generated_at: generated_at.to_owned(),
            project_id: project_id.to_owned(),
            run_id: run_id.to_owned(),
            run,
            provider_version,
            events,
            provider_diagnostics,
            runtime_diagnostics: runtime,
            recent_errors,
            unavailable: gaps,
        }
    }

    /// 실행 하나의 이벤트를 처음부터 끝까지 읽는다.
    ///
    /// 저장 계층은 한 번의 조회로 정해진 수까지만 돌려주므로, cursor가 더 나아가지 않을 때까지
    /// 이어 읽어야 전체가 모인다. 도중에 읽지 못하면 그때까지 읽은 것을 남기고 사유를 적는다.
    fn read_whole_log(
        &self,
        caller: &dyn RuntimeCaller,
        project_id: &str,
        run_id: &str,
        compatibility: &Compatibility,
        gaps: &mut Vec<BundleGap>,
    ) -> Vec<BundleEvent> {
        let mut events = Vec::new();
        let mut cursor = 0;
        loop {
            match self.read_log(caller, project_id, run_id, cursor, compatibility) {
                Ok(page) => {
                    events.extend(page.events.iter().map(bundle_event));
                    // 빈 묶음과 제자리 cursor는 둘 다 더 읽을 것이 없다는 뜻이다.
                    if page.events.is_empty() || page.next_cursor <= cursor {
                        return events;
                    }
                    cursor = page.next_cursor;
                }
                Err(failure) => {
                    gaps.push(gap("events", &failure.message()));
                    return events;
                }
            }
        }
    }
}

fn gap(item: &str, reason: &str) -> BundleGap {
    BundleGap {
        item: item.to_owned(),
        reason: reason.to_owned(),
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// provider 진단 결과 하나를 번들이 싣는 값으로 옮긴다. 계약이 정한 세 값만 읽는다.
fn bundle_provider(value: &Value) -> BundleProvider {
    BundleProvider {
        provider: text(value, "provider"),
        status: text(value, "status"),
        version: text(value, "version"),
    }
}

/// 저장된 이벤트 하나를 번들이 싣는 값으로 옮긴다. 계약이 정한 필드만 읽고 나머지는 버린다.
fn bundle_event(value: &Value) -> BundleEvent {
    let kind = text(value, "kind").unwrap_or_default();
    BundleEvent {
        role: text(value, "role"),
        provider: text(value, "provider"),
        target_id: text(value, "targetId"),
        started_at: text(value, "startedAt"),
        elapsed_seconds: value.get("elapsedSeconds").and_then(Value::as_f64),
        tool_name: text(value, "toolName"),
        detail: if kind == "tool" {
            None
        } else {
            text(value, "detail")
        },
        kind,
    }
}

/// 사용 한도로 끝난 실행 행 전부.
///
/// 고르는 조건은 셋을 모두 만족하는 행이다. 종료 사유가 한도 도달 구분값이고, 상태가 끝난 상태이며,
/// 종료 시각이 있다. 종료 시각을 읽지 못하는 행은 재개 시각을 정할 수 없으므로 고르지 않는다.
///
/// 실행 도구마다 한 행으로 줄이지 않는다. 같은 도구의 한도 종료가 여럿 보일 때 어느 행이 가장 늦은
/// 해제 시각을 실었는지는 종료 시각으로 알 수 없어서, 늦게 끝난 행 하나만 보내면 먼저 끝난 행이 실어
/// 온 더 늦은 해제 시각이 기록에 닿지 못한다. 어느 행을 남길지는 기록 쪽이 판정한다.
fn usage_limit_ends(runs: &[RunSummary]) -> Vec<&RunSummary> {
    runs.iter()
        .filter(|run| {
            run.reached_usage_limit()
                && run.state.is_finished()
                && run
                    .finished_at
                    .as_deref()
                    .and_then(provider_hold::runtime_time)
                    .is_some()
        })
        .collect()
}

/// 읽지 못한 상태. 실행 목록을 비우고 사유를 싣는다.
fn unavailable(project_id: &str, reason: &str) -> QueueSnapshot {
    QueueSnapshot {
        project_id: project_id.to_owned(),
        paused: false,
        automation: AutomationSnapshot {
            enabled: false,
            roles: Vec::new(),
            watcher: None,
            dispatcher_running: false,
        },
        runs: Vec::new(),
        errors: Vec::new(),
        providers: Vec::new(),
        provider_holds: Vec::new(),
        unavailable: Some(reason.to_owned()),
    }
}

fn automation_from_state(state: &Value) -> AutomationSnapshot {
    let automation = state.get("automation");
    let roles = automation
        .and_then(|value| value.get("roles"))
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| {
                    serde_json::from_value::<AutomationRoleState>(value.clone()).ok()
                })
                .collect()
        })
        .unwrap_or_default();
    let watcher = automation
        .and_then(|value| value.get("watcher"))
        .filter(|value| !value.is_null())
        .and_then(|value| serde_json::from_value::<WatcherState>(value.clone()).ok());
    AutomationSnapshot {
        enabled: automation
            .and_then(|value| value.get("enabled"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        roles,
        watcher,
        dispatcher_running: automation
            .and_then(|value| value.get("dispatcher"))
            .is_some_and(|value| !value.is_null()),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use chrono::{DateTime, Duration, Utc};
    use pretty_assertions::assert_eq;
    use serde_json::{json, Value};
    use tempfile::tempdir;

    use super::{AgentRuntimeStatusService, StatusFailure};
    use crate::domain::agent_runtime::{Compatibility, RunState, USAGE_LIMIT_REACHED};
    use crate::infrastructure::agent_runtime_process::tests::FakeCaller;
    use crate::infrastructure::agent_runtime_process::{Captured, RuntimeCallFailure};

    fn envelope(data: serde_json::Value) -> Captured {
        Captured {
            code: Some(0),
            stdout: json!({
                "apiVersion": "1", "requestId": "r", "command": "state.read",
                "outcome": "success", "data": data,
            })
            .to_string(),
            stderr: String::new(),
        }
    }

    fn row(run: &str, project: &str, state: &str) -> serde_json::Value {
        json!({
            "runId": run, "projectId": project, "role": "developer", "provider": "claude",
            "state": state, "targetId": "TASK-1", "startedAt": "2026-08-08T10:00:00Z",
            "failureStage": null, "reason": null, "remaining": [], "previousRunId": null,
        })
    }

    fn state(project: &str, paused: bool, rows: Vec<serde_json::Value>) -> serde_json::Value {
        json!({
            "configuration": {"projectId": project, "paused": paused},
            "queue": [], "runs": rows, "errors": [],
        })
    }

    #[test]
    fn every_contract_state_survives_the_round_trip() {
        let names = [
            "reserved",
            "queued",
            "running",
            "paused",
            "succeeded",
            "failed",
            "cancelled",
            "recovery_required",
        ];
        let rows: Vec<serde_json::Value> = names
            .iter()
            .enumerate()
            .map(|(index, name)| row(&format!("run-{index}"), "p1", name))
            .collect();
        let caller = FakeCaller::new(vec![
            Ok(envelope(state("p1", false, rows))),
            Ok(envelope(json!({"providers": []}))),
        ]);

        let snapshot =
            AgentRuntimeStatusService.inspect(&caller, "p1", &Compatibility::Compatible, None);

        assert_eq!(snapshot.runs.len(), 8);
        assert_eq!(snapshot.runs[0].state, RunState::Reserved);
        assert_eq!(snapshot.runs[7].state, RunState::RecoveryRequired);
        assert!(snapshot.unavailable.is_none());
        assert_eq!(snapshot.runs[0].role, "developer");
        assert_eq!(
            snapshot.runs[0].started_at.as_deref(),
            Some("2026-08-08T10:00:00Z")
        );
    }

    #[test]
    fn a_runtime_that_cannot_be_read_leaves_the_state_unknown() {
        let caller = FakeCaller::new(vec![Err(RuntimeCallFailure::NotFound {
            looked: std::path::PathBuf::from("/opt/runtime/bin/heartbeat"),
        })]);

        let snapshot =
            AgentRuntimeStatusService.inspect(&caller, "p1", &Compatibility::Compatible, None);

        assert!(snapshot.unavailable.is_some());
        assert!(snapshot.runs.is_empty());
    }

    #[test]
    fn an_incompatible_runtime_is_never_asked_for_state() {
        let caller = FakeCaller::new(vec![]);

        let snapshot = AgentRuntimeStatusService.inspect(
            &caller,
            "p1",
            &Compatibility::UnsupportedApiMajor {
                found: 9,
                supported: 1,
            },
            None,
        );

        assert!(snapshot.unavailable.is_some());
        assert!(caller.calls.borrow().is_empty());
    }

    #[test]
    fn rows_from_another_project_make_the_whole_answer_untrusted() {
        let caller = FakeCaller::new(vec![Ok(envelope(state(
            "p1",
            false,
            vec![
                row("run-1", "p1", "running"),
                row("run-2", "other", "running"),
            ],
        )))]);

        let snapshot =
            AgentRuntimeStatusService.inspect(&caller, "p1", &Compatibility::Compatible, None);

        assert!(snapshot.unavailable.is_some());
        assert!(snapshot.runs.is_empty());
    }

    #[test]
    fn pausing_one_project_reports_only_that_project() {
        let caller = FakeCaller::new(vec![
            Ok(envelope(
                json!({"configuration": {"projectId": "p1", "paused": true}}),
            )),
            Ok(envelope(state(
                "p1",
                true,
                vec![row("run-1", "p1", "running")],
            ))),
            Ok(envelope(json!({"providers": []}))),
        ]);

        let snapshot = AgentRuntimeStatusService
            .set_paused(&caller, "p1", true, &Compatibility::Compatible, None)
            .expect("paused");

        assert!(snapshot.paused);
        assert_eq!(snapshot.project_id, "p1");
        // 일시 정지는 새 배정만 막는다. 돌던 실행은 그대로 목록에 있다.
        assert_eq!(snapshot.runs[0].state, RunState::Running);
        assert_eq!(
            caller.calls.borrow()[0].0,
            vec!["agent", "project", "pause"]
        );
    }

    #[test]
    fn a_pause_answered_for_another_project_is_not_a_success() {
        let caller = FakeCaller::new(vec![Ok(envelope(
            json!({"configuration": {"projectId": "other", "paused": true}}),
        ))]);

        let failure = AgentRuntimeStatusService
            .set_paused(&caller, "p1", true, &Compatibility::Compatible, None)
            .expect_err("refused");

        assert!(matches!(failure, StatusFailure::ProjectMismatch { .. }));
    }

    #[test]
    fn the_log_page_travels_by_cursor_and_carries_no_path() {
        let caller = FakeCaller::new(vec![Ok(envelope(json!({
            "runId": "run-1",
            "events": [{"kind": "started", "role": "developer", "detail": null}],
            "nextCursor": 12,
        })))]);

        let page = AgentRuntimeStatusService
            .read_log(&caller, "p1", "run-1", 0, &Compatibility::Compatible)
            .expect("page");

        assert_eq!(page.next_cursor, 12);
        assert_eq!(page.events.len(), 1);
        let request = caller.calls.borrow()[0].1.clone().expect("body");
        assert_eq!(request["cursor"], json!(0));
        assert!(request.get("eventPath").is_none());
        assert!(request.get("path").is_none());
        assert_eq!(caller.calls.borrow()[0].0, vec!["agent", "logs"]);
    }

    #[test]
    fn a_log_page_for_another_run_is_refused() {
        let caller = FakeCaller::new(vec![Ok(envelope(json!({
            "runId": "run-9", "events": [], "nextCursor": 0,
        })))]);

        let failure = AgentRuntimeStatusService
            .read_log(&caller, "p1", "run-1", 0, &Compatibility::Compatible)
            .expect_err("refused");

        assert!(matches!(failure, StatusFailure::OffContract { .. }));
    }

    fn stamp(at: DateTime<Utc>) -> String {
        at.format("%Y-%m-%dT%H:%M:%SZ").to_string()
    }

    /// 끝난 실행 행 하나. 싣지 않는 값은 `Value::Null`로 준다.
    fn ended(
        run: &str,
        provider: &str,
        state: &str,
        reason: Value,
        finished_at: Value,
        resets_at: Value,
    ) -> Value {
        let mut value = row(run, "p1", state);
        let object = value.as_object_mut().expect("row");
        object.insert("provider".to_owned(), json!(provider));
        object.insert("reason".to_owned(), reason);
        object.insert("finishedAt".to_owned(), finished_at);
        object.insert("usageLimitResetsAt".to_owned(), resets_at);
        value
    }

    fn queue(rows: Vec<Value>) -> FakeCaller {
        FakeCaller::new(vec![
            Ok(envelope(state("p1", false, rows))),
            Ok(envelope(json!({"providers": []}))),
        ])
    }

    #[test]
    fn provider_holds_reach_the_queue_snapshot_and_stay_empty_without_one() {
        let root = tempdir().expect("root");
        let at = Utc::now();
        let resets_at = stamp(at + Duration::hours(2));
        let held = queue(vec![ended(
            "run-1",
            "claude",
            "failed",
            json!(USAGE_LIMIT_REACHED),
            json!(stamp(at)),
            json!(resets_at.clone()),
        )]);

        let snapshot = AgentRuntimeStatusService.inspect(
            &held,
            "p1",
            &Compatibility::Compatible,
            Some(root.path()),
        );

        assert_eq!(snapshot.provider_holds.len(), 1);
        assert_eq!(snapshot.provider_holds[0].provider, "claude");
        assert_eq!(snapshot.provider_holds[0].resume_at, resets_at);
        assert!(snapshot.provider_holds[0].resume_at_known);

        let quiet = tempdir().expect("quiet root");
        let running = queue(vec![row("run-2", "p1", "running")]);

        let snapshot = AgentRuntimeStatusService.inspect(
            &running,
            "p1",
            &Compatibility::Compatible,
            Some(quiet.path()),
        );

        assert!(snapshot.provider_holds.is_empty());
    }

    #[test]
    fn provider_hold_records_nothing_for_rows_that_did_not_end_on_the_usage_limit() {
        let root = tempdir().expect("root");
        let finished_at = json!(stamp(Utc::now()));
        let caller = queue(vec![
            ended(
                "run-1",
                "claude",
                "failed",
                json!("provider_failed"),
                finished_at.clone(),
                Value::Null,
            ),
            ended(
                "run-2",
                "claude",
                "cancelled",
                Value::Null,
                finished_at.clone(),
                Value::Null,
            ),
            ended(
                "run-3",
                "claude",
                "failed",
                json!(USAGE_LIMIT_REACHED),
                Value::Null,
                Value::Null,
            ),
            // 사유 문구에 구분값이 섞여 있을 뿐 값이 같지는 않은 행이다.
            ended(
                "run-4",
                "claude",
                "failed",
                json!("provider said usage_limit_reached"),
                finished_at.clone(),
                Value::Null,
            ),
            ended(
                "run-5",
                "claude",
                "running",
                json!(USAGE_LIMIT_REACHED),
                finished_at,
                Value::Null,
            ),
        ]);

        let snapshot = AgentRuntimeStatusService.inspect(
            &caller,
            "p1",
            &Compatibility::Compatible,
            Some(root.path()),
        );

        assert!(snapshot.provider_holds.is_empty());
        assert!(!root.path().join("provider-holds").exists());
    }

    #[test]
    fn the_latest_resume_time_of_each_provider_becomes_the_provider_hold() {
        let root = tempdir().expect("root");
        let at = Utc::now();
        let caller = queue(vec![
            // 한 번의 확인에서 같은 도구의 한도 종료가 둘 보인다. 늦게 끝난 쪽이 해제 예정 시각을
            // 싣지 않아 종료 한 시간 뒤라는 추정값을 내므로, 먼저 끝난 쪽의 실제 해제 시각이 남는다.
            ended(
                "run-1",
                "claude",
                "failed",
                json!(USAGE_LIMIT_REACHED),
                json!(stamp(at - Duration::minutes(10))),
                json!(stamp(at + Duration::hours(4))),
            ),
            ended(
                "run-2",
                "claude",
                "failed",
                json!(USAGE_LIMIT_REACHED),
                json!(stamp(at)),
                Value::Null,
            ),
            // 반대 순서로 도착해도 결과는 같고, 한 도구의 보류가 다른 도구의 보류를 만들지 않는다.
            ended(
                "run-3",
                "codex",
                "failed",
                json!(USAGE_LIMIT_REACHED),
                json!(stamp(at - Duration::minutes(5))),
                json!(stamp(at + Duration::hours(1))),
            ),
            ended(
                "run-4",
                "codex",
                "failed",
                json!(USAGE_LIMIT_REACHED),
                json!(stamp(at)),
                json!(stamp(at + Duration::hours(2))),
            ),
        ]);

        let snapshot = AgentRuntimeStatusService.inspect(
            &caller,
            "p1",
            &Compatibility::Compatible,
            Some(root.path()),
        );

        assert_eq!(
            snapshot
                .provider_holds
                .iter()
                .map(|hold| (hold.provider.as_str(), hold.resume_at.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("claude", stamp(at + Duration::hours(4)).as_str()),
                ("codex", stamp(at + Duration::hours(2)).as_str()),
            ]
        );
        assert!(snapshot.provider_holds[0].resume_at_known);
    }

    #[test]
    fn an_unwritable_provider_hold_root_still_answers_the_run_list() {
        let root = tempdir().expect("root");
        // 루트 자리가 파일이면 기록 디렉터리를 만들 수 없다. 그래도 조회는 지금과 같이 성공한다.
        let blocked = root.path().join("hold-root");
        fs::write(&blocked, "not a directory").expect("파일");
        let caller = queue(vec![ended(
            "run-1",
            "claude",
            "failed",
            json!(USAGE_LIMIT_REACHED),
            json!(stamp(Utc::now())),
            Value::Null,
        )]);

        let snapshot = AgentRuntimeStatusService.inspect(
            &caller,
            "p1",
            &Compatibility::Compatible,
            Some(&blocked),
        );

        assert!(snapshot.unavailable.is_none());
        assert_eq!(snapshot.runs.len(), 1);
        assert!(snapshot.provider_holds.is_empty());
    }
}

#[cfg(test)]
mod diagnostic_bundle_tests {
    use pretty_assertions::assert_eq;
    use serde_json::{json, Value};

    use super::{AgentRuntimeStatusService, DiagnosticBundle};
    use crate::application::agent_runtime_install_service::RuntimeInspection;
    use crate::domain::agent_runtime::{Compatibility, RunState};
    use crate::infrastructure::agent_runtime_process::tests::FakeCaller;
    use crate::infrastructure::agent_runtime_process::{Captured, RuntimeCallFailure};

    /// 성공 봉투 하나. 조립은 봉투의 명령 이름을 읽지 않으므로 한 값으로 둔다.
    fn envelope(data: Value) -> Captured {
        Captured {
            code: Some(0),
            stdout: json!({
                "apiVersion": "1", "requestId": "r", "command": "state.read",
                "outcome": "success", "data": data,
            })
            .to_string(),
            stderr: String::new(),
        }
    }

    fn runtime(unavailable: Option<&str>) -> RuntimeInspection {
        RuntimeInspection {
            bundled_version: Some("0.9.0".to_owned()),
            status: None,
            compatibility: Compatibility::Compatible,
            execution_allowed: true,
            unavailable: unavailable.map(str::to_owned),
            install_root: "/runtime".to_owned(),
        }
    }

    /// 조립이 부르는 순서대로 응답을 세워 둔다: 큐 상태, 큐 상태 안쪽의 provider 진단,
    /// 번들이 따로 부르는 provider 진단, 그다음이 이벤트 묶음들이다.
    fn export(
        responses: Vec<Result<Captured, RuntimeCallFailure>>,
        inspection: RuntimeInspection,
    ) -> DiagnosticBundle {
        let caller = FakeCaller::new(responses);
        AgentRuntimeStatusService.export_diagnostics(
            &caller,
            "p1",
            "run-1",
            inspection,
            &Compatibility::Compatible,
            "2026-08-12T15:00:00Z",
        )
    }

    fn tool_event(elapsed: u32) -> Value {
        json!({
            "kind": "tool", "role": "developer", "provider": "claude", "targetId": "TASK-7",
            "startedAt": "2026-08-12T10:00:00Z", "elapsedSeconds": elapsed, "toolName": "Read",
        })
    }

    fn page(events: Vec<Value>, next_cursor: u64) -> Captured {
        envelope(json!({"runId": "run-1", "events": events, "nextCursor": next_cursor}))
    }

    fn failed_run_state() -> Value {
        json!({
            "configuration": {"projectId": "p1", "paused": false},
            "queue": [],
            "runs": [{
                "runId": "run-1", "projectId": "p1", "role": "developer", "provider": "claude",
                "state": "failed", "targetId": "TASK-7", "startedAt": "2026-08-12T10:00:00Z",
                "finishedAt": "2026-08-12T10:02:00Z", "failureStage": "role_session",
                "reason": "provider_failed", "remaining": [], "previousRunId": null,
                "resultPrefix": "RES-20260812T130244Z-394",
            }],
            "errors": [{"stage": "role_session", "reason": "provider_failed", "role": "developer"}],
        })
    }

    fn ready_providers() -> Value {
        json!({"providers": [{"provider": "claude", "status": "ready", "version": "2.1.0"}]})
    }

    #[test]
    fn the_bundle_carries_the_run_identity_its_provider_version_and_the_recent_errors() {
        let bundle = export(
            vec![
                Ok(envelope(failed_run_state())),
                Ok(envelope(ready_providers())),
                Ok(envelope(ready_providers())),
                Ok(page(vec![], 0)),
            ],
            runtime(None),
        );

        assert_eq!(bundle.bundle_version, "1");
        assert_eq!(bundle.generated_at, "2026-08-12T15:00:00Z");
        assert_eq!(bundle.project_id, "p1");
        assert_eq!(bundle.run_id, "run-1");
        let run = bundle.run.expect("실행 행");
        assert_eq!(run.target_id.as_deref(), Some("TASK-7"));
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.failure_stage.as_deref(), Some("role_session"));
        assert_eq!(run.reason.as_deref(), Some("provider_failed"));
        assert_eq!(run.started_at.as_deref(), Some("2026-08-12T10:00:00Z"));
        assert_eq!(run.finished_at.as_deref(), Some("2026-08-12T10:02:00Z"));
        assert_eq!(
            run.result_prefix.as_deref(),
            Some("RES-20260812T130244Z-394")
        );
        assert_eq!(bundle.provider_version.as_deref(), Some("2.1.0"));
        assert_eq!(bundle.recent_errors.expect("오류 기록").len(), 1);
        assert!(bundle.unavailable.is_empty());
    }

    /// 저장과 복사는 이 조립 함수 하나를 지나고, 명령은 그 결과를 한 번만 문자열로 만들어 파일과
    /// 화면 양쪽에 같은 값을 준다. 여기서 확인하는 것은 그 앞단이다 — 같은 실행을 두 번 내보내도
    /// 규격 버전과 실행 내용이 같고, 생성 시각만 다르다.
    #[test]
    fn two_exports_of_one_run_agree_on_the_format_version_and_the_run_content() {
        let responses = || {
            vec![
                Ok(envelope(failed_run_state())),
                Ok(envelope(ready_providers())),
                Ok(envelope(ready_providers())),
                Ok(page(vec![tool_event(1), tool_event(2)], 2)),
                Ok(page(vec![], 2)),
            ]
        };
        let saved = export(responses(), runtime(None));
        let copied = export(responses(), runtime(None));

        assert_eq!(saved.bundle_version, copied.bundle_version);
        assert_eq!(saved.run, copied.run);
        assert_eq!(saved.events, copied.events);
        assert_eq!(saved.provider_version, copied.provider_version);
        assert_eq!(saved.recent_errors, copied.recent_errors);
        assert_eq!(saved.unavailable, copied.unavailable);
    }

    #[test]
    fn events_are_read_on_past_one_page_and_keep_the_order_the_runtime_stored() {
        // 저장 계층은 한 번의 조회로 200건까지만 돌려준다. 한 번에 끊으면 뒤의 3건이 빠진다.
        let first: Vec<Value> = (0..200).map(tool_event).collect();
        let second: Vec<Value> = (200..203).map(tool_event).collect();
        let bundle = export(
            vec![
                Ok(envelope(failed_run_state())),
                Ok(envelope(ready_providers())),
                Ok(envelope(ready_providers())),
                Ok(page(first, 200)),
                Ok(page(second, 203)),
                Ok(page(vec![], 203)),
            ],
            runtime(None),
        );

        assert_eq!(bundle.events.len(), 203);
        assert_eq!(bundle.events[0].elapsed_seconds, Some(0.0));
        assert_eq!(bundle.events[199].elapsed_seconds, Some(199.0));
        assert_eq!(bundle.events[202].elapsed_seconds, Some(202.0));
        assert_eq!(
            bundle.events[202].started_at.as_deref(),
            Some("2026-08-12T10:00:00Z")
        );
        assert!(bundle.unavailable.is_empty());
    }

    #[test]
    fn what_could_not_be_read_is_named_with_its_reason_and_the_rest_still_reaches_the_bundle() {
        let bundle = export(
            vec![
                Err(RuntimeCallFailure::NotStarted {
                    reason: "런타임이 응답하지 않습니다".to_owned(),
                }),
                Err(RuntimeCallFailure::NotStarted {
                    reason: "진단을 읽지 못했습니다".to_owned(),
                }),
                Ok(page(vec![tool_event(1)], 1)),
                Ok(page(vec![], 1)),
            ],
            runtime(Some("런타임 조회에 실패했습니다")),
        );

        // 읽지 못한 자리를 빈 값으로 채우지 않는다. 없는 것과 읽지 못한 것이 구분돼야 한다.
        assert!(bundle.run.is_none());
        assert!(bundle.recent_errors.is_none());
        assert!(bundle.provider_diagnostics.is_none());
        assert!(bundle.provider_version.is_none());
        // 읽은 부분은 그대로 남는다.
        assert_eq!(bundle.events.len(), 1);
        let named: Vec<&str> = bundle
            .unavailable
            .iter()
            .map(|entry| entry.item.as_str())
            .collect();
        assert_eq!(
            named,
            vec![
                "run",
                "recentErrors",
                "providerDiagnostics",
                "runtimeDiagnostics"
            ]
        );
        assert!(bundle
            .unavailable
            .iter()
            .all(|entry| !entry.reason.is_empty()));
    }

    #[test]
    fn a_run_the_queue_does_not_list_leaves_the_meta_empty_with_its_own_reason() {
        let bundle = export(
            vec![
                Ok(envelope(json!({
                    "configuration": {"projectId": "p1", "paused": false},
                    "queue": [], "runs": [], "errors": [],
                }))),
                Ok(envelope(ready_providers())),
                Ok(envelope(ready_providers())),
                Ok(page(vec![], 0)),
            ],
            runtime(None),
        );

        assert!(bundle.run.is_none());
        // 오류 기록은 읽었으므로 자리가 비어 있는 것이 아니라 빈 목록이다.
        assert_eq!(bundle.recent_errors.expect("오류 기록").len(), 0);
        assert_eq!(bundle.unavailable.len(), 1);
        assert_eq!(bundle.unavailable[0].item, "run");
    }

    #[test]
    fn injected_instructions_credentials_and_tool_payloads_never_reach_the_bundle() {
        const FAKE: &str = "SENTINEL-8f3a91c2";
        let state = json!({
            "configuration": {"projectId": "p1", "paused": false},
            "queue": [],
            "runs": [{
                "runId": "run-1", "projectId": "p1", "role": "developer", "provider": "claude",
                "state": "running", "targetId": "TASK-7", "startedAt": "2026-08-12T10:00:00Z",
                "failureStage": null, "reason": null, "remaining": [], "previousRunId": null,
                // 실행 요청이 들고 다니는 값들. 계약이 정한 실행 행에는 이 자리가 없다.
                "prompt": FAKE, "instruction": FAKE, "env": {"ANTHROPIC_API_KEY": FAKE},
            }],
            "errors": [],
        });
        let providers = json!({"providers": [{
            "provider": "claude", "status": "ready", "version": "2.1.0",
            "apiKey": FAKE, "modelCatalog": {"status": "ok", "models": [{"id": FAKE}]},
        }]});
        let log = json!({"runId": "run-1", "events": [{
            "kind": "tool", "role": "developer", "provider": "claude", "targetId": "TASK-7",
            "startedAt": "2026-08-12T10:00:00Z", "elapsedSeconds": 3, "toolName": "Bash",
            "toolArgs": FAKE, "toolResult": FAKE, "detail": FAKE,
            "environment": {"CLAUDE_TOKEN": FAKE},
        }], "nextCursor": 1});

        let bundle = export(
            vec![
                Ok(envelope(state)),
                Ok(envelope(providers.clone())),
                Ok(envelope(providers)),
                Ok(envelope(log)),
                Ok(page(vec![], 1)),
            ],
            runtime(None),
        );

        let serialized = serde_json::to_string(&bundle).expect("직렬화");
        assert!(
            !serialized.contains(FAKE),
            "주입한 값이 번들에 남았습니다: {serialized}"
        );
        // 지우기만 한 것이 아니라 계약이 정한 값은 그대로 옮긴다.
        assert_eq!(bundle.events[0].tool_name.as_deref(), Some("Bash"));
        assert_eq!(bundle.events[0].elapsed_seconds, Some(3.0));
        assert_eq!(bundle.provider_version.as_deref(), Some("2.1.0"));
        assert_eq!(
            bundle.run.expect("실행 행").target_id.as_deref(),
            Some("TASK-7")
        );
    }
}
