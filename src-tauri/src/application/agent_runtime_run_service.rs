//! 실행 계획과 시작, 취소와 재시도.
//!
//! **앱은 실행을 스스로 띄우지 않는다.** 시작은 언제나 런타임 큐를 거친다. 이 모듈에는 provider
//! 실행 파일도, `heartbeat once` 같은 데몬 밖 실행 경로도 없다. 화면이 준 실행 파일 이름이나 명령
//! 인자를 받는 자리도 없다.
//!
//! **확인한 계획만 시작한다.** 계획 식별자는 일회용이고 revision과 만료 시각이 그 계획의 유효 조건
//! 이다. 런타임이 조건 불일치를 알리면 앱은 그것을 성공으로 바꾸지 않고 새 계획 필요로 전달한다.
//!
//! **응답의 신원을 확인한다.** 런타임이 다른 프로젝트의 값을 돌려주면 성공으로 처리하지 않는다.

use serde::Serialize;
use serde_json::{json, Value};

use crate::domain::agent_runtime::{
    CancelPreview, Compatibility, RunPlan, RunStartOutcome, RunSummary,
};
use crate::infrastructure::agent_runtime_process::{self, RuntimeCallFailure, RuntimeCaller};

/// 역할 하나에 요청하는 슬롯. 화면이 보내는 값이다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleSlotRequest {
    pub role: String,
    pub slots: u32,
    /// 수동 배정의 대상. 비어 있으면 자동 배정이다.
    #[serde(default)]
    pub targets: Vec<String>,
}

/// 취소 요청 하나의 결과. 미리보기와 적용이 같은 값으로 온다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CancelOutcome {
    /// 확인 전 단계. 아무것도 바뀌지 않았다.
    #[serde(rename_all = "camelCase")]
    Preview { preview: CancelPreview },
    /// 확인 뒤 적용됐고 정리가 모두 끝났다.
    #[serde(rename_all = "camelCase")]
    Applied { run: RunSummary },
    /// 적용했으나 남은 단계가 있다. 전체 성공으로 표시하지 않는다.
    #[serde(rename_all = "camelCase")]
    Partial {
        run: RunSummary,
        remaining: Vec<String>,
    },
}

/// 실행 명령이 실패하는 방식.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunFailure {
    Runtime(RuntimeCallFailure),
    /// 런타임이 다른 프로젝트의 값을 돌려줬다.
    ProjectMismatch {
        requested: String,
        answered: String,
    },
    /// 계획이 더 이상 유효하지 않다. 새 계획이 필요하다.
    PlanRejected {
        reason: String,
    },
    /// 이 런타임의 계약이 앱의 지원 범위 밖이다.
    Incompatible(Compatibility),
    /// 응답이 계약의 모양이 아니다.
    OffContract {
        detail: String,
    },
}

impl RunFailure {
    pub fn message(&self) -> String {
        match self {
            RunFailure::Runtime(failure) => failure.message(),
            RunFailure::ProjectMismatch {
                requested,
                answered,
            } => format!(
                "런타임이 다른 프로젝트({answered})의 값을 돌려줬습니다. 요청은 {requested}입니다."
            ),
            RunFailure::PlanRejected { reason } => {
                format!("계획이 더 이상 유효하지 않습니다({reason}). 새 계획을 읽어 주세요.")
            }
            RunFailure::Incompatible(_) => {
                "이 런타임은 앱이 지원하는 계약 범위 밖입니다.".to_owned()
            }
            RunFailure::OffContract { detail } => {
                format!("런타임 응답이 계약의 모양이 아닙니다: {detail}")
            }
        }
    }
}

#[derive(Debug, Default)]
pub struct AgentRuntimeRunService;

impl AgentRuntimeRunService {
    /// 계획을 읽는다. 파일도 provider 프로세스도 바뀌지 않는다.
    pub fn plan(
        &self,
        caller: &dyn RuntimeCaller,
        project_id: &str,
        requests: &[RoleSlotRequest],
        compatibility: &Compatibility,
    ) -> Result<RunPlan, RunFailure> {
        guard(compatibility)?;
        let data = agent_runtime_process::plan_run(caller, project_id, &roles_payload(requests))
            .map_err(RunFailure::Runtime)?;
        let plan: RunPlan = decode(data.get("plan").unwrap_or(&data))?;
        if plan.project_id != project_id {
            return Err(RunFailure::ProjectMismatch {
                requested: project_id.to_owned(),
                answered: plan.project_id,
            });
        }
        Ok(plan)
    }

    /// 확인받은 계획을 시작한다. 조건이 달라졌으면 아무 provider도 시작되지 않는다.
    pub fn start(
        &self,
        caller: &dyn RuntimeCaller,
        project_id: &str,
        plan_id: &str,
        confirmed: bool,
        compatibility: &Compatibility,
    ) -> Result<RunStartOutcome, RunFailure> {
        guard(compatibility)?;
        let data = agent_runtime_process::start_run(caller, project_id, plan_id, confirmed)
            .map_err(RunFailure::Runtime)?;
        // 계획이 낡았다는 답은 실패가 아니라 새 계획이 필요하다는 사실이다. 그대로 전달한다.
        if let Some(reason) = data.get("reason").and_then(Value::as_str) {
            return Err(RunFailure::PlanRejected {
                reason: reason.to_owned(),
            });
        }
        let outcome: RunStartOutcome = decode(&data)?;
        for run in &outcome.started {
            if run.project_id != project_id {
                return Err(RunFailure::ProjectMismatch {
                    requested: project_id.to_owned(),
                    answered: run.project_id.clone(),
                });
            }
        }
        Ok(outcome)
    }

    /// 취소를 미리 보거나 적용한다. 확인이 없으면 아무것도 바뀌지 않는다.
    pub fn cancel(
        &self,
        caller: &dyn RuntimeCaller,
        project_id: &str,
        run_id: &str,
        confirmed: bool,
        compatibility: &Compatibility,
    ) -> Result<CancelOutcome, RunFailure> {
        guard(compatibility)?;
        let data = agent_runtime_process::cancel_run(caller, project_id, run_id, confirmed)
            .map_err(RunFailure::Runtime)?;
        if let Some(preview) = data.get("preview") {
            return Ok(CancelOutcome::Preview {
                preview: decode(preview)?,
            });
        }
        let run: RunSummary = decode(data.get("run").ok_or_else(|| RunFailure::OffContract {
            detail: "취소 응답에 실행 행이 없습니다".to_owned(),
        })?)?;
        if run.project_id != project_id {
            return Err(RunFailure::ProjectMismatch {
                requested: project_id.to_owned(),
                answered: run.project_id,
            });
        }
        // 남은 단계가 하나라도 있으면 전체 성공으로 표시하지 않는다.
        if run.remaining.is_empty() {
            Ok(CancelOutcome::Applied { run })
        } else {
            let remaining = run.remaining.clone();
            Ok(CancelOutcome::Partial { run, remaining })
        }
    }

    /// 실패한 실행을 다시 시도한다. 이전 실행 식별자를 새 실행이 가리킨다.
    pub fn retry(
        &self,
        caller: &dyn RuntimeCaller,
        project_id: &str,
        run_id: &str,
        compatibility: &Compatibility,
    ) -> Result<RunSummary, RunFailure> {
        guard(compatibility)?;
        let data = agent_runtime_process::retry_run(caller, project_id, run_id)
            .map_err(RunFailure::Runtime)?;
        let run: RunSummary = decode(data.get("run").ok_or_else(|| RunFailure::OffContract {
            detail: "재시도 응답에 실행 행이 없습니다".to_owned(),
        })?)?;
        if run.run_id == run_id {
            return Err(RunFailure::OffContract {
                detail: "재시도가 같은 실행 식별자를 돌려줬습니다".to_owned(),
            });
        }
        if run.project_id != project_id {
            return Err(RunFailure::ProjectMismatch {
                requested: project_id.to_owned(),
                answered: run.project_id,
            });
        }
        Ok(run)
    }
}

/// 호환되지 않는 런타임에는 어떤 요청도 보내지 않는다.
fn guard(compatibility: &Compatibility) -> Result<(), RunFailure> {
    if compatibility.allows_execution() {
        Ok(())
    } else {
        Err(RunFailure::Incompatible(compatibility.clone()))
    }
}

/// 역할별 슬롯 요청을 계약의 모양으로 옮긴다. 한 번·반복은 저장된 역할 정책이 정하므로 싣지 않는다.
fn roles_payload(requests: &[RoleSlotRequest]) -> Value {
    let mut roles = serde_json::Map::new();
    for request in requests {
        roles.insert(
            request.role.clone(),
            json!({"slots": request.slots, "targets": request.targets}),
        );
    }
    Value::Object(roles)
}

fn decode<T: for<'de> serde::Deserialize<'de>>(value: &Value) -> Result<T, RunFailure> {
    serde_json::from_value(value.clone()).map_err(|error| RunFailure::OffContract {
        detail: error.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::{AgentRuntimeRunService, CancelOutcome, RoleSlotRequest, RunFailure};
    use crate::domain::agent_runtime::{Compatibility, RunState};
    use crate::infrastructure::agent_runtime_process::tests::FakeCaller;
    use crate::infrastructure::agent_runtime_process::Captured;

    fn envelope(data: serde_json::Value) -> Captured {
        Captured {
            code: Some(0),
            stdout: json!({
                "apiVersion": "1", "requestId": "r", "command": "plan.read",
                "outcome": "success", "data": data,
            })
            .to_string(),
            stderr: String::new(),
        }
    }

    fn plan_body(project: &str) -> serde_json::Value {
        json!({"plan": {
            "planId": "plan-1",
            "projectId": project,
            "revision": "rev-1",
            "expiresAt": "2026-08-08T10:40:00Z",
            "deviceRemaining": 4,
            "projectRemaining": 3,
            "billingRouteRisk": false,
            "limits": {"projectMaxParallel": 3, "deviceMaxParallel": 16},
            "roles": [{
                "role": "developer", "provider": "claude", "executionMode": "once",
                "requested": 2, "granted": 1, "excluded": ["limit_reached"],
                "manualTargets": [], "diagnostic": {"status": "ready"},
            }],
        }})
    }

    fn run_row(
        run: &str,
        project: &str,
        state: &str,
        remaining: serde_json::Value,
    ) -> serde_json::Value {
        json!({
            "runId": run, "projectId": project, "role": "developer", "provider": "claude",
            "state": state, "targetId": "TASK-1", "startedAt": "2026-08-08T10:00:00Z",
            "failureStage": null, "reason": null, "remaining": remaining, "previousRunId": null,
        })
    }

    fn slots() -> Vec<RoleSlotRequest> {
        vec![RoleSlotRequest {
            role: "developer".to_owned(),
            slots: 2,
            targets: Vec::new(),
        }]
    }

    #[test]
    fn a_plan_reports_candidates_and_limits_without_starting_anything() {
        let caller = FakeCaller::new(vec![Ok(envelope(plan_body("p1")))]);

        let plan = AgentRuntimeRunService
            .plan(&caller, "p1", &slots(), &Compatibility::Compatible)
            .expect("plan");

        assert_eq!(plan.plan_id, "plan-1");
        assert_eq!(plan.roles[0].granted, 1);
        assert_eq!(plan.roles[0].excluded, vec!["limit_reached".to_owned()]);
        assert_eq!(plan.device_remaining, 4);
        let (arguments, request) = caller.calls.borrow()[0].clone();
        assert_eq!(arguments, vec!["agent", "plan"]);
        let request = request.expect("body");
        assert_eq!(request["roles"]["developer"]["slots"], json!(2));
    }

    #[test]
    fn a_plan_for_another_project_is_not_accepted() {
        let caller = FakeCaller::new(vec![Ok(envelope(plan_body("other")))]);

        let failure = AgentRuntimeRunService
            .plan(&caller, "p1", &slots(), &Compatibility::Compatible)
            .expect_err("refused");

        assert!(matches!(failure, RunFailure::ProjectMismatch { .. }));
    }

    #[test]
    fn a_stale_plan_becomes_a_new_plan_request_not_a_success() {
        let caller = FakeCaller::new(vec![Ok(envelope(
            json!({"planId": "plan-1", "reason": "runtime_changed", "stage": "request_validation"}),
        ))]);

        let failure = AgentRuntimeRunService
            .start(&caller, "p1", "plan-1", true, &Compatibility::Compatible)
            .expect_err("refused");

        assert_eq!(
            failure,
            RunFailure::PlanRejected {
                reason: "runtime_changed".to_owned(),
            }
        );
    }

    #[test]
    fn starting_sends_the_plan_and_the_confirmation() {
        let caller = FakeCaller::new(vec![Ok(envelope(json!({
            "started": [run_row("run-1", "p1", "running", json!([]))],
            "failures": [],
        })))]);

        let outcome = AgentRuntimeRunService
            .start(&caller, "p1", "plan-1", true, &Compatibility::Compatible)
            .expect("started");

        assert_eq!(outcome.started.len(), 1);
        assert_eq!(outcome.started[0].state, RunState::Running);
        let request = caller.calls.borrow()[0].1.clone().expect("body");
        assert_eq!(request["planId"], json!("plan-1"));
        assert_eq!(request["confirmed"], json!(true));
    }

    #[test]
    fn an_incompatible_runtime_is_never_asked_to_plan_or_start() {
        let caller = FakeCaller::new(vec![]);
        let incompatible = Compatibility::UnsupportedApiMajor {
            found: 9,
            supported: 1,
        };

        let planned = AgentRuntimeRunService.plan(&caller, "p1", &slots(), &incompatible);
        let started = AgentRuntimeRunService.start(&caller, "p1", "plan-1", true, &incompatible);

        assert!(matches!(planned, Err(RunFailure::Incompatible(_))));
        assert!(matches!(started, Err(RunFailure::Incompatible(_))));
        assert!(caller.calls.borrow().is_empty());
    }

    #[test]
    fn cancel_without_a_confirmation_only_previews() {
        let caller = FakeCaller::new(vec![Ok(envelope(json!({"preview": {
            "runId": "run-1", "targetId": "TASK-1", "leaseId": "lease-1", "pid": 42,
            "processLiveness": "running", "childProcesses": 2,
            "cleanup": ["process_termination", "event_close", "lease_release"],
        }})))]);

        let outcome = AgentRuntimeRunService
            .cancel(&caller, "p1", "run-1", false, &Compatibility::Compatible)
            .expect("preview");

        match outcome {
            CancelOutcome::Preview { preview } => {
                assert_eq!(preview.child_processes, 2);
                assert_eq!(preview.cleanup.len(), 3);
            }
            other => panic!("preview expected, got {other:?}"),
        }
        let request = caller.calls.borrow()[0].1.clone().expect("body");
        assert!(request.get("confirmed").is_none());
    }

    #[test]
    fn a_cancel_with_a_remaining_stage_is_not_reported_as_applied() {
        let caller = FakeCaller::new(vec![Ok(envelope(json!({
            "run": run_row("run-1", "p1", "recovery_required", json!(["lease_release"])),
        })))]);

        let outcome = AgentRuntimeRunService
            .cancel(&caller, "p1", "run-1", true, &Compatibility::Compatible)
            .expect("applied");

        match outcome {
            CancelOutcome::Partial { remaining, run } => {
                assert_eq!(remaining, vec!["lease_release".to_owned()]);
                assert_eq!(run.state, RunState::RecoveryRequired);
            }
            other => panic!("partial expected, got {other:?}"),
        }
    }

    #[test]
    fn a_retry_must_carry_a_new_run_identifier() {
        let caller = FakeCaller::new(vec![Ok(envelope(json!({
            "run": run_row("run-1", "p1", "running", json!([])),
            "previousRunId": "run-1",
        })))]);

        let failure = AgentRuntimeRunService
            .retry(&caller, "p1", "run-1", &Compatibility::Compatible)
            .expect_err("refused");

        assert!(matches!(failure, RunFailure::OffContract { .. }));
    }

    #[test]
    fn a_retry_links_the_previous_run() {
        let mut row = run_row("run-2", "p1", "running", json!([]));
        row["previousRunId"] = json!("run-1");
        let caller = FakeCaller::new(vec![Ok(envelope(
            json!({"run": row, "previousRunId": "run-1"}),
        ))]);

        let run = AgentRuntimeRunService
            .retry(&caller, "p1", "run-1", &Compatibility::Compatible)
            .expect("retried");

        assert_eq!(run.run_id, "run-2");
        assert_eq!(run.previous_run_id.as_deref(), Some("run-1"));
    }

    /// 앱이 데몬 밖에서 실행을 띄우지 않는다는 것을 인자 배열로 고정한다.
    #[test]
    fn no_command_this_service_sends_starts_a_process_outside_the_queue() {
        let caller = FakeCaller::new(vec![
            Ok(envelope(plan_body("p1"))),
            Ok(envelope(json!({"started": [], "failures": []}))),
        ]);

        AgentRuntimeRunService
            .plan(&caller, "p1", &slots(), &Compatibility::Compatible)
            .expect("plan");
        AgentRuntimeRunService
            .start(&caller, "p1", "plan-1", true, &Compatibility::Compatible)
            .expect("start");

        for (arguments, _) in caller.calls.borrow().iter() {
            assert!(!arguments.iter().any(|value| value == "once"));
            assert!(!arguments
                .iter()
                .any(|value| value == "claude" || value == "codex"));
            assert_eq!(arguments[0], "agent");
        }
    }
}
