//! 큐 상태 조회와 프로젝트 일시 정지, 실행 로그 읽기.
//!
//! **조회 실패는 추측의 근거가 아니다.** 런타임을 읽지 못하면 상태를 모름으로 두고 사유를 함께
//! 싣는다. 앱이 마지막으로 본 값을 지금도 도는 중이라고 말하지 않는다.
//!
//! **로그는 cursor만 주고받는다.** 화면이 파일 경로를 보내지도 받지도 않으며, 런타임이 이미 민감정보를
//! 제거한 이벤트만 온다. 앱은 그 이벤트를 다시 해석하지 않고 그대로 전달한다.

use serde_json::Value;

use crate::domain::agent_runtime::{
    AutomationRoleState, AutomationSnapshot, Compatibility, QueueSnapshot, RunLogPage, RunSummary,
    WatcherState,
};
use crate::infrastructure::agent_runtime_process::{self, RuntimeCallFailure, RuntimeCaller};

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

#[derive(Debug, Default)]
pub struct AgentRuntimeStatusService;

impl AgentRuntimeStatusService {
    /// 큐와 실행 상태를 읽는다. 읽지 못하면 모름으로 답하고 실행 중으로 올리지 않는다.
    ///
    /// 실행 목록은 런타임이 영속 기록에서 복원한 값이다. 앱이 자기 메모리에 큐를 들고 있지 않으므로
    /// 앱을 다시 열어도 첫 조회가 같은 값을 낸다.
    pub fn inspect(
        &self,
        caller: &dyn RuntimeCaller,
        project_id: &str,
        compatibility: &Compatibility,
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
        Ok(self.inspect(caller, project_id, compatibility))
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
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::{AgentRuntimeStatusService, StatusFailure};
    use crate::domain::agent_runtime::{Compatibility, RunState};
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

        let snapshot = AgentRuntimeStatusService.inspect(&caller, "p1", &Compatibility::Compatible);

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

        let snapshot = AgentRuntimeStatusService.inspect(&caller, "p1", &Compatibility::Compatible);

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

        let snapshot = AgentRuntimeStatusService.inspect(&caller, "p1", &Compatibility::Compatible);

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
            .set_paused(&caller, "p1", true, &Compatibility::Compatible)
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
            .set_paused(&caller, "p1", true, &Compatibility::Compatible)
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
}
