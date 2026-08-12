//! 역할별 대기 물량 판정(SPEC-009 R3).
//!
//! 조건 스크립트(`.workflow/rules/wf-eligible.sh`)를 옮긴 것이다. 더 똑똑하게 만들지 않는다.
//! 두 판정이 갈라지면 화면이 거짓말을 한다. 이 모듈은 파일 시스템을 만지지 않고 값만 받는다.
//!
//! 알려진 차이. 스크립트를 고치지 않으므로 아래 다섯은 남는다.
//!
//! 1. 스크립트는 `grep`으로 파일 아무 곳이나 본다. 앱은 프론트매터만 본다. 본문의 프론트매터
//!    예시가 실제 값처럼 잡히면 스크립트만 그 문서를 처리 완료로 본다.
//! 2. 스크립트는 `id:` 줄이 없는 문서를 건너뛴다. 앱은 `id`가 없으면 파일 stem을 id로 쓴다.
//!    앱이 만든 문서에는 항상 `id`가 있다.
//! 3. 스크립트는 `.workflow/*/`를 전부 본다. 앱은 `project.yml`에 등록된 워크플로우만 본다.
//! 4. lease의 `expires_at`을 앱은 RFC3339로 파싱하고 스크립트는 자리수가 고정된
//!    `YYYY-MM-DDTHH:MM:SSZ`만 읽는다. 오프셋 표기(`+09:00`)나 소수 초를 쓴 lease는 앱만 유효로
//!    보고 스크립트는 만료로 본다. 표기 기준을 계약에 올리기 전까지 남는 차이이고, 선점 헬퍼가
//!    쓰는 lease는 이미 canonical이라 헬퍼 이전에 손으로 만들어진 파일에만 해당한다.
//! 5. 기획서 결정을 앱은 `created_by: user`와 세 `outcome` 값으로 한 번 더 거른다. 스크립트의
//!    `planner)`·`architect)` 두 분기도 `created_by`를 같은 값으로 거르지만(SPEC-028 R5,
//!    SPEC-030 R1) `outcome` 값 목록은 보지 않는다. 그래서 남는 차이는 두 분기가 보지 않는
//!    `outcome` 값 목록 하나다. 앱이 쓰는 결정 문서는 전부 그 조건을 만족하므로, 손으로 만든
//!    결정 문서에만 해당한다.
//!
//! 이 대조는 세 플랫폼 러너에서 모두 돈다. 한 플랫폼에서만 도는 상태로 되돌리지 않는다.

use std::collections::HashSet;

use crate::domain::project::{
    PendingRoleWorkDetail, RoleWorkVerdict, WorkflowItemSummary, WorkflowItems, DECOMPOSED,
    DEPENDENCIES_UNSATISFIED, FOLLOW_UP_EXISTS, LEASED, OVERLAP, SPEC_EXISTS, SPEC_LEASED,
};

/// 워크플로우 하나의 판정 재료. 스크립트가 워크플로우 하나 안에서 아이디어↔기획서, 결정↔작업을
/// 대조하므로 짝짓기는 이 단위를 넘지 않는다.
pub struct WorkflowInput<'a> {
    /// 컨트롤 루트 아래의 워크플로우 디렉터리 이름. 판정이 워크플로우를 보는 차례를 정한다 —
    /// 스크립트는 `.workflow/*/` 글롭 순서로 돌고, 대상이 어느 워크플로우에서 나오는지가 그
    /// 차례로 갈리기 때문이다. 판정 결과(대상 유무)는 차례와 무관하다.
    pub directory: &'a str,
    pub items: &'a WorkflowItems,
    /// 이 워크플로우의 `outcome: approved` 결정 중 같은 기획서에 더 늦은 결정이 없는 것.
    /// `(결정 id, spec_id)`다(SPEC-028 R4). 최신 판정을 여기서 다시 하지 않는 것은
    /// `revision_requested` 쪽과 같은 이유다 — 판정 규칙이 한 벌이어야 하고, 그 판정에 필요한
    /// `created_at`은 목록 payload에 실리지 않는다.
    pub approved_decisions: &'a [(String, String)],
    /// 아직 처리되지 않은 작업 정의 수정 요청 판정 재료. 처리 여부와 대상 작업의 상태를
    /// 이 모듈이 판정하도록 원문 값을 함께 받는다.
    pub task_revision_requests: &'a [TaskRevisionRequestCandidate],
    /// `status: blocked`이면서 `blocked_kind: definition_error`인 작업 id. 작업 요약 payload에는
    /// `blocked_kind`가 없으므로 파일을 읽는 저장소가 이 집합을 만든다. 아키텍트는 이 집합의 작업을
    /// 사용자 수정 요청 없이 직접 고치고, 개발자는 같은 작업을 후보에서 제외한다.
    pub definition_error_tasks: &'a HashSet<String>,
    /// 같은 기획서에 더 늦은 결정이 없는 `outcome: revision_requested` 결정의 id(SPEC-018 R1).
    pub revision_requested_decisions: &'a [String],
    /// 선행 선언이 미충족인 작업의 id(SPEC-013 R2). 선언을 여기서 다시 파싱하지 않는 것은 판정
    /// 규칙이 한 벌이어야 하기 때문이다 — 판정은 `fs_project_repository`가 하고 이 모듈은 결과만
    /// 받는다. 목록 payload(`WorkflowItemSummary`)는 선언을 싣지 않으므로 별도 값으로 온다.
    pub unsatisfied_dependencies: &'a HashSet<String>,
    /// 겹침 선언이 활성 lease와 충돌해 착수가 막힌 작업의 id(SPEC-032 R2). 선행 선언과 같은
    /// 이유로 여기서 다시 판정하지 않는다 — lease 파일도 작업 문서도 이 모듈은 읽지 않는다.
    pub overlap_blocked: &'a HashSet<String>,
    /// `draft`가 아닌 기획서가 원천으로 참조하는 id의 집합(SPEC-035 R2). 아이디어 id와 결정 id가
    /// 한 집합에 들어온다 — 두 판정이 각각 자기 id로만 조회하므로 섞이지 않는다.
    ///
    /// 여기서 다시 만들지 못하는 값이라 별도로 온다. 목록 payload(`WorkflowItemSummary`)에
    /// `source_idea_id`가 없고, 판정이 보아야 하는 `status`는 파일에 적힌 원문인데 payload의 값은
    /// 정규화와 결정 덮어쓰기를 지난 화면용 값이다. 계산은 `fs_project_repository`가 한다.
    pub nondraft_spec_sources: &'a HashSet<String>,
}

/// 아키텍트 자격 판정이 보는 작업 정의 수정 요청 하나.
pub struct TaskRevisionRequestCandidate {
    pub id: String,
    pub task_id: String,
    pub created_at: String,
    pub task_status: String,
    pub handled: bool,
}

const SPEC_APPROVAL_KIND: &str = "spec_approval";
const TASK_REVISION_REQUEST_KIND: &str = "task_revision_request";
const BLOCKED_TASK_KIND: &str = "blocked_task";

/// `lease_ids`는 만료 전인 lease 파일 이름 집합이다. 스크립트도 만료된 lease를 선점으로 세지
/// 않으므로, 죽은 세션이 남긴 lease는 어느 역할에서도 그 대상을 막지 않는다.
///
/// 답은 역할마다 대상 하나와 판정한 후보 목록이다(SPEC-049 R1). 대상 유무는 이 작업 전의 불리언
/// 그대로이고 넓어진 것은 답의 내용이다 — 화면 payload는 [`PendingRoleWorkDetail::flags`]가 낸다.
pub fn pending_role_work(
    migration_locked: bool,
    lease_ids: &HashSet<String>,
    workflows: &[WorkflowInput<'_>],
) -> PendingRoleWorkDetail {
    // 스크립트 첫 줄: `[ -f ".workflow/.runtime/migration.lock" ] && exit 1`.
    // 후보를 하나도 보지 않고 끝나므로 목록도 비어 있다. 스크립트도 락을 만나면 분기에 들어가지
    // 않아 후보 줄을 하나도 내지 않는다.
    if migration_locked {
        return PendingRoleWorkDetail::default();
    }

    PendingRoleWorkDetail {
        planner: judge_workflows(workflows, |workflow| planner_verdict(workflow, lease_ids)),
        architect: architect_workflows_verdict(workflows, lease_ids),
        developer: judge_workflows(workflows, |workflow| developer_verdict(workflow, lease_ids)),
    }
}

/// 워크플로우를 디렉터리 이름 순으로 모두 판정한다. 첫 대상은 역할 계약 순서대로 보존하고,
/// 뒤 후보는 읽기 전용 대기열과 제외 사유를 위해 계속 모은다.
fn judge_workflows(
    workflows: &[WorkflowInput<'_>],
    judge: impl Fn(&WorkflowInput<'_>) -> RoleWorkVerdict,
) -> RoleWorkVerdict {
    let mut ordered: Vec<&WorkflowInput<'_>> = workflows.iter().collect();
    ordered.sort_by(|left, right| left.directory.cmp(right.directory));

    let mut merged = RoleWorkVerdict::default();
    for workflow in ordered {
        let verdict = judge(workflow);
        merged.candidates.extend(verdict.candidates);
        if merged.target.is_none() && verdict.target.is_some() {
            merged.target = verdict.target;
            merged.target_kind = verdict.target_kind;
        }
    }
    merged
}

/// 후보를 보는 차례. 스크립트는 디렉터리를 글롭 순서로 훑으므로 파일 이름 오름차순이 그 차례다.
/// 목록 payload의 정렬(`updated_at` 내림차순)을 그대로 쓰면 두 판정의 대상이 갈라진다.
fn by_file_name(items: &[WorkflowItemSummary]) -> Vec<&WorkflowItemSummary> {
    let mut ordered: Vec<&WorkflowItemSummary> = items.iter().collect();
    ordered.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    ordered
}

/// 스크립트 `planner)` 절. 아이디어를 먼저 보고 그다음 수정 요청 결정을 본다(SPEC-018 R1).
///
/// 두 경우가 같은 목록 하나를 본다. 원천을 참조하는 기획서가 있더라도 그것이 모두 `draft`이면 멈춘
/// 기획 작업이므로 그 원천은 다시 대상이다(SPEC-035 R2). "**모두** `draft`"이지 "하나라도 `draft`"가
/// 아니다 — 그래서 아이디어 파생 상태(`inbox`/`drafting`/`adopted`)를 지름길로 쓰지 않는다. `drafting`은
/// 참조 기획서 중 하나라도 `draft`면 성립하므로, 승인까지 간 기획서와 죽은 재작업 draft를 함께 가진
/// 아이디어에서 스크립트와 갈라진다(SPEC-035 R7).
///
/// (가) 비-`draft` 기획서가 참조하지 않는 아이디어 중 선점되지 않은 것.
///
/// (나) 비-`draft` 후속 기획서가 없고 선점되지 않은 최신 `revision_requested` 결정. 후속 판정 키는
/// 결정 id다 — 한 기획서가 여러 번 반려되면 결정마다 후속이 하나씩 생기므로 기획서 id로는 구분되지
/// 않는다. 후속 기획서 뒤에 붙은 결정은 보지 않는다.
///
/// 제외 사유를 보는 차례는 스크립트의 두 검사 차례 그대로다 — 참조 여부를 먼저 보고 선점을 나중에
/// 본다. 두 조건이 함께 성립하는 후보에서 어느 사유가 남는지가 그 차례로 갈린다.
fn planner_verdict(workflow: &WorkflowInput<'_>, lease_ids: &HashSet<String>) -> RoleWorkVerdict {
    let mut verdict = RoleWorkVerdict::default();
    for idea in by_file_name(&workflow.items.ideas) {
        if workflow.nondraft_spec_sources.contains(&idea.id) {
            verdict.exclude(&idea.id, SPEC_EXISTS);
            continue;
        }
        if lease_ids.contains(&idea.id) {
            verdict.exclude(&idea.id, LEASED);
            continue;
        }
        verdict.select(&idea.id);
    }
    for decision_id in workflow.revision_requested_decisions {
        if workflow.nondraft_spec_sources.contains(decision_id) {
            verdict.exclude(decision_id, FOLLOW_UP_EXISTS);
            continue;
        }
        if lease_ids.contains(decision_id) {
            verdict.exclude(decision_id, LEASED);
            continue;
        }
        verdict.select(decision_id);
    }
    verdict
}

/// 스크립트 `architect)` 절: 그 기획서의 최신 결정인 승인 중 파생 작업이 없고 `spec_id`로 lease가
/// 없는 것. 최신 판정과 `created_by: user` 필터는 이 함수에 오기 전에 끝난다 — 앞의 것은
/// `latest_approvals`가, 뒤의 것은 결정 문서를 읽는 `read_spec_decisions`가 한다. 스크립트도 같은
/// 두 판정을 `architect)` 분기 안에서 한다(SPEC-028 R4·R5).
///
/// 최신이 아닌 승인은 여기 오지 않는다. 그래서 승인 뒤에 수정 요청이 붙은 기획서는 그 승인에서
/// 작업이 파생되지 않았어도 아키텍트 대기 물량이 아니다. 역할 계약의 "The latest app-owned decision
/// must be `approved`"가 그것을 요구한다.
///
/// 분해 여부를 먼저 보고 기획서 선점을 나중에 보는 것이 스크립트의 차례다.
fn architect_verdict(workflow: &WorkflowInput<'_>, lease_ids: &HashSet<String>) -> RoleWorkVerdict {
    let mut verdict = RoleWorkVerdict::default();
    for (decision_id, spec_id) in workflow.approved_decisions {
        let decomposed = workflow
            .items
            .tasks
            .iter()
            .any(|task| task.source_decision_id.as_deref() == Some(decision_id.as_str()));
        if decomposed {
            verdict.exclude(decision_id, DECOMPOSED);
            continue;
        }
        // 스크립트도 `spec_id`가 비어 있으면 lease를 보지 않는다.
        if !spec_id.is_empty() && lease_ids.contains(spec_id) {
            verdict.exclude(decision_id, SPEC_LEASED);
            continue;
        }
        verdict.select_kind(decision_id, SPEC_APPROVAL_KIND);
    }
    verdict
}

/// 작업 정의 수정 요청을 모든 워크플로우에서 먼저 모은 뒤, 생성 시각이 이른 순서로 판정한다.
/// 처리할 요청이 없으면 사용자 요청 없이 고칠 수 있는 `definition_error` 작업을 보고, 그마저 없을
/// 때만 기존 승인 분해 판정으로 넘어간다. 과거 요청을 먼저 보는 순서는 기존 감사 기록과 예약
/// 호환성을 보존한다.
fn architect_workflows_verdict(
    workflows: &[WorkflowInput<'_>],
    lease_ids: &HashSet<String>,
) -> RoleWorkVerdict {
    let mut requests: Vec<(&str, &TaskRevisionRequestCandidate)> = workflows
        .iter()
        .flat_map(|workflow| {
            workflow
                .task_revision_requests
                .iter()
                .map(move |request| (workflow.directory, request))
        })
        .filter(|(_, request)| {
            !request.handled && (request.task_status == "todo" || request.task_status == "blocked")
        })
        .collect();
    requests.sort_by(|(left_directory, left), (right_directory, right)| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
            .then_with(|| left_directory.cmp(right_directory))
    });
    let request_backed_tasks: HashSet<&str> = requests
        .iter()
        .map(|(_, request)| request.task_id.as_str())
        .collect();

    let mut verdict = RoleWorkVerdict::default();
    for (_, request) in requests {
        if lease_ids.contains(&request.id) || lease_ids.contains(&request.task_id) {
            verdict.exclude(&request.id, LEASED);
            continue;
        }
        verdict.select_kind(&request.id, TASK_REVISION_REQUEST_KIND);
    }

    let direct_corrections = judge_workflows(workflows, |workflow| {
        let mut direct = RoleWorkVerdict::default();
        for task in by_file_name(&workflow.items.tasks) {
            if task.status != "blocked" || !workflow.definition_error_tasks.contains(&task.id) {
                continue;
            }
            if request_backed_tasks.contains(task.id.as_str()) {
                continue;
            }
            if lease_ids.contains(&task.id) {
                direct.exclude(&task.id, LEASED);
                continue;
            }
            direct.select_kind(&task.id, BLOCKED_TASK_KIND);
        }
        direct
    });
    verdict.candidates.extend(direct_corrections.candidates);
    if verdict.target.is_none() && direct_corrections.target.is_some() {
        verdict.target = direct_corrections.target;
        verdict.target_kind = direct_corrections.target_kind;
    }

    let approvals = judge_workflows(workflows, |workflow| architect_verdict(workflow, lease_ids));
    verdict.candidates.extend(approvals.candidates);
    if verdict.target.is_none() {
        verdict.target = approvals.target;
        verdict.target_kind = approvals.target_kind;
    }
    verdict
}

/// 스크립트 `developer)` 절: `todo`, `in_progress`, 또는 `definition_error`가 아닌 `blocked` 작업 중
/// 그 id로 lease가 없고, 선행 선언이 충족됐고, 다른 문서를 잡은 활성 lease와 겹치지 않는 것.
///
/// 네 조건은 개발자 계약의 자격 조건 그대로다. 선언을 보지 않던 동안에는 의존 미충족 `todo`만 남은
/// 저장소에서 스크립트가 1을, 이 모듈이 `true`를 냈다(SPEC-013 완료 조건 8).
///
/// `in_progress`가 후보인 것은 죽은 세션이 남긴 작업을 다시 열기 위해서다(SPEC-035 R1). 그 작업을
/// 덮는 미만료 lease가 없다는 것이 계약상 "그 세션은 살아 있지 않다"이므로, 살아 있는 세션의 작업은
/// `lease_ids`가 그대로 막는다. 상태 집합만 넓어지고 나머지 세 조건은 곱해지는 그대로다.
/// `blocked` 작업은 이제 에이전트가 운영하는 복구 레인이다. 작업 문서 자체가 틀린
/// `definition_error`만 아키텍트가 가져가고, 나머지 분류와 미분류 과거 작업은 개발자가 다시
/// 진단하고 구현을 이어 간다. 상태가 넓어져도 lease·선행·겹침 세 조건은 그대로 곱해진다.
///
/// 후보가 아닌 작업은 목록에도 오르지 않는다. 스크립트도 세 후보 상태 밖의 문서와
/// `definition_error` 작업을 후보 행으로 만들지 않으므로, 그 문서에는 낼 제외 사유가 없다.
///
/// 마지막 조건은 잡힌 lease가 있을 때만 개입한다. 활성 lease가 하나도 없으면 `overlap_blocked`가
/// 비어 있어 판정이 이 조건이 없던 때와 같다(SPEC-032 R9).
fn developer_verdict(workflow: &WorkflowInput<'_>, lease_ids: &HashSet<String>) -> RoleWorkVerdict {
    let mut verdict = RoleWorkVerdict::default();
    for task in by_file_name(&workflow.items.tasks) {
        if task.status != "todo" && task.status != "in_progress" && task.status != "blocked" {
            continue;
        }
        if task.status == "blocked" && workflow.definition_error_tasks.contains(&task.id) {
            continue;
        }
        if lease_ids.contains(&task.id) {
            verdict.exclude(&task.id, LEASED);
            continue;
        }
        if workflow.unsatisfied_dependencies.contains(&task.id) {
            verdict.exclude(&task.id, DEPENDENCIES_UNSATISFIED);
            continue;
        }
        if workflow.overlap_blocked.contains(&task.id) {
            verdict.exclude(&task.id, OVERLAP);
            continue;
        }
        verdict.select(&task.id);
    }
    verdict
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;
    use std::path::{Path, PathBuf};

    use pretty_assertions::assert_eq;
    use tempfile::{tempdir, TempDir};

    use crate::domain::project::{
        PendingRoleWork, PendingRoleWorkDetail, RoleWorkVerdict, WorkCandidate,
    };
    use crate::infrastructure::fs_project_repository::FileSystemProjectRepository;
    use crate::infrastructure::heartbeat_condition::install_condition_script;
    use crate::infrastructure::heartbeat_condition::test_support::{
        run_condition, run_machine_condition,
    };

    /// 조건 스크립트를 설치한 픽스처 프로젝트. 워크플로우 디렉터리는 앱이 만든 것을 쓴다.
    fn project() -> (TempDir, PathBuf) {
        let root = tempdir().expect("temp project");
        let summary = FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");
        let workflow_root = root
            .path()
            .join(".workflow")
            .join(&summary.workflows[0].directory);
        install_condition_script(&root.path().join(".workflow")).expect("install condition script");
        (root, workflow_root)
    }

    /// 조회 결과의 판정과 스크립트의 답을 대조한다. 규칙만이 아니라 배선까지 고정한다.
    /// 스크립트 실행은 조건 스크립트 모듈의 공용 헬퍼가 한다 — 두 모듈이 다른 명령으로 부르면
    /// 대조의 뜻이 사라진다.
    ///
    /// 대조 대상은 셋이다. 종료 코드가 말하는 대상 유무, 대상 문서의 id, 그리고 판정한 후보를
    /// 판정한 차례대로 담은 목록이다(SPEC-049 완료 조건 4). 이 표 아래의 시나리오 전부가 이
    /// 헬퍼를 지나므로, 넓어진 답이 갈라지는 자리는 그 시나리오에서 먼저 걸린다.
    fn assert_matches_condition_script(project_root: &Path) -> PendingRoleWork {
        let detail = FileSystemProjectRepository
            .inspect(project_root)
            .expect("inspect project")
            .pending_detail;

        for (role, verdict) in [
            ("planner", &detail.planner),
            ("architect", &detail.architect),
            ("developer", &detail.developer),
        ] {
            let run = run_condition(project_root, role);

            assert_eq!(
                verdict.target.is_some(),
                run.code == 0,
                "{role} 판정이 조건 스크립트와 다르다"
            );
            assert_eq!(
                verdict.target,
                run.target(),
                "{role} 대상이 조건 스크립트와 다르다"
            );
            let machine = run_machine_condition(project_root, role);
            let value: serde_json::Value =
                serde_json::from_str(machine.stdout.trim()).expect("machine JSON");
            let machine_candidates = value["candidates"]
                .as_array()
                .expect("machine candidates")
                .iter()
                .map(|candidate| {
                    format!(
                        "{} {}",
                        candidate["reason"].as_str().expect("candidate reason"),
                        candidate["id"].as_str().expect("candidate id")
                    )
                })
                .collect::<Vec<_>>();
            assert_eq!(
                candidate_lines(verdict),
                machine_candidates,
                "{role} 후보 목록이 조건 스크립트 JSON과 다르다"
            );
            assert_eq!(
                verdict.target_kind.as_deref(),
                value["targetKind"].as_str(),
                "{role} 대상 종류가 조건 스크립트와 다르다"
            );
        }
        detail.flags()
    }

    /// 앱 판정의 후보 목록을 스크립트가 내는 줄과 같은 모양으로 만든다.
    fn candidate_lines(verdict: &RoleWorkVerdict) -> Vec<String> {
        verdict
            .candidates
            .iter()
            .map(|candidate| format!("{} {}", candidate.verdict, candidate.id))
            .collect()
    }

    fn write_idea(workflow_root: &Path, id: &str) {
        fs::write(
            workflow_root.join(format!("ideas/{id}.md")),
            format!("---\nschema: workflow-labs/idea@1\nid: {id}\ntitle: 아이디어\nstatus: inbox\ncreated_at: 2026-08-01T00:00:00Z\nupdated_at: 2026-08-01T00:00:00Z\n---\n\n아이디어 본문\n"),
        )
        .expect("write idea");
    }

    fn write_spec(workflow_root: &Path, id: &str, source_idea_id: &str) {
        fs::write(
            workflow_root.join(format!("specs/{id}.md")),
            format!("---\nschema: workflow-labs/spec@1\nid: {id}\ntitle: 기획서\nstatus: user_review\nsource_idea_id: {source_idea_id}\ncreated_at: 2026-08-01T00:00:00Z\nupdated_at: 2026-08-01T00:00:00Z\n---\n\n# 기획서\n"),
        )
        .expect("write spec");
    }

    /// 아이디어를 참조하는 기획서를 상태만 달리 쓴다. 파생 상태가 `drafting`이 되는 픽스처가 쓴다.
    fn write_spec_with_status(workflow_root: &Path, id: &str, source_idea_id: &str, status: &str) {
        fs::write(
            workflow_root.join(format!("specs/{id}.md")),
            format!("---\nschema: workflow-labs/spec@1\nid: {id}\ntitle: 기획서\nstatus: {status}\nsource_idea_id: {source_idea_id}\ncreated_at: 2026-08-01T00:00:00Z\nupdated_at: 2026-08-01T00:00:00Z\n---\n\n# 기획서\n"),
        )
        .expect("write spec");
    }

    /// 수정 요청 결정을 원천으로 두는 재작업 기획서. 후속 존재 판정의 키가 결정 id임을 고정한다.
    fn write_rework_spec(workflow_root: &Path, id: &str, source_decision_id: &str, status: &str) {
        fs::write(
            workflow_root.join(format!("specs/{id}.md")),
            format!("---\nschema: workflow-labs/spec@1\nid: {id}\ntitle: 재작업 기획서\nstatus: {status}\nsource_spec_id: SPEC-001\nsource_decision_id: {source_decision_id}\ncreated_at: 2026-08-02T00:00:00Z\nupdated_at: 2026-08-02T00:00:00Z\n---\n\n# 재작업 기획서\n"),
        )
        .expect("write rework spec");
    }

    /// 개발 작업 QA 결정. `spec_id`가 없고 `task_id`를 가지며 스키마가 다르다. 이 문서가 기획자
    /// 판정을 깨우면 안 된다.
    fn write_qa_decision(workflow_root: &Path, id: &str, task_id: &str, at: &str) {
        fs::write(
            workflow_root.join(format!("decisions/{id}.md")),
            format!("---\nschema: workflow-labs/qa-decision@1\nid: {id}\ntask_id: {task_id}\noutcome: revision_requested\ncreated_by: user\ncreated_at: {at}\n---\n\nQA 코멘트\n"),
        )
        .expect("write qa decision");
    }

    fn write_decision(workflow_root: &Path, id: &str, spec_id: &str, outcome: &str, at: &str) {
        write_decision_created_by(workflow_root, id, spec_id, outcome, "user", at);
    }

    fn write_task_revision_request(workflow_root: &Path, id: &str, task_id: &str, at: &str) {
        fs::write(
            workflow_root.join(format!("decisions/{id}.md")),
            format!("---\nschema: workflow-labs/task-revision-request@1\nid: {id}\ntask_id: {task_id}\nrequest_id: request-{id}\nprevious_updated_at: 2026-08-01T00:00:00Z\ncreated_by: user\ncreated_at: {at}\n---\n\n작업 정의를 고쳐 주세요.\n"),
        )
        .expect("write task revision request");
    }

    fn link_handled_revision_request(workflow_root: &Path, task_id: &str, request_id: &str) {
        let path = workflow_root.join(format!("tasks/{task_id}.md"));
        let contents = fs::read_to_string(&path).expect("task before handled link");
        fs::write(
            path,
            contents.replace(
                "updated_at:",
                &format!("revision_request_id: {request_id}\nupdated_at:"),
            ),
        )
        .expect("write handled link");
    }

    /// `created_by`를 부르는 쪽이 정하는 결정 문서. 위임 대리 결정처럼 앱이 쓸 수 없는 값을 담은
    /// 문서를 세우는 시나리오가 쓴다(SPEC-028 확인 필요 1번).
    fn write_decision_created_by(
        workflow_root: &Path,
        id: &str,
        spec_id: &str,
        outcome: &str,
        created_by: &str,
        at: &str,
    ) {
        fs::write(
            workflow_root.join(format!("decisions/{id}.md")),
            format!("---\nschema: workflow-labs/decision@1\nid: {id}\nspec_id: {spec_id}\noutcome: {outcome}\ncreated_by: {created_by}\ncreated_at: {at}\n---\n\n결정 코멘트\n"),
        )
        .expect("write decision");
    }

    fn write_task(workflow_root: &Path, id: &str, status: &str, source_decision_id: Option<&str>) {
        let source = source_decision_id
            .map(|value| format!("source_decision_id: {value}\n"))
            .unwrap_or_default();
        fs::write(
            workflow_root.join(format!("tasks/{id}.md")),
            format!("---\nschema: workflow-labs/task@1\nid: {id}\ntitle: 작업\nstatus: {status}\nsource_spec_id: SPEC-001\n{source}updated_at: 2026-08-01T00:00:00Z\n---\n\n작업 본문\n"),
        )
        .expect("write task");
    }

    fn write_blocked_task(workflow_root: &Path, id: &str, blocked_kind: Option<&str>) {
        let kind = blocked_kind
            .map(|value| format!("blocked_kind: {value}\n"))
            .unwrap_or_default();
        fs::write(
            workflow_root.join(format!("tasks/{id}.md")),
            format!("---\nschema: workflow-labs/task@1\nid: {id}\ntitle: 작업\nstatus: blocked\nsource_spec_id: SPEC-001\n{kind}updated_at: 2026-08-01T00:00:00Z\n---\n\n작업 본문\n"),
        )
        .expect("write blocked task");
    }

    /// 선행 선언을 가진 작업. `declaration`은 `depends_on:` 뒤에 그대로 놓이는 원문이라 형식 오류
    /// 시나리오도 같은 헬퍼가 쓴다. 계약대로 키는 열 0에서 시작한다(SPEC-013 R1).
    fn write_task_with_declaration(
        workflow_root: &Path,
        id: &str,
        status: &str,
        declaration: &str,
    ) {
        fs::write(
            workflow_root.join(format!("tasks/{id}.md")),
            format!("---\nschema: workflow-labs/task@1\nid: {id}\ntitle: 작업\nstatus: {status}\nsource_spec_id: SPEC-001\ndepends_on: {declaration}\nupdated_at: 2026-08-01T00:00:00Z\n---\n\n작업 본문\n"),
        )
        .expect("write task with declaration");
    }

    /// `updated_at`을 부르는 쪽이 정하는 작업. 목록 정렬과 판정 차례가 갈리는지 보는 시나리오가
    /// 쓴다.
    fn write_task_updated_at(workflow_root: &Path, id: &str, status: &str, updated_at: &str) {
        fs::write(
            workflow_root.join(format!("tasks/{id}.md")),
            format!("---\nschema: workflow-labs/task@1\nid: {id}\ntitle: 작업\nstatus: {status}\nsource_spec_id: SPEC-001\nupdated_at: {updated_at}\n---\n\n작업 본문\n"),
        )
        .expect("write task with updated_at");
    }

    /// 겹침 선언을 가진 작업. `scope`는 `scope_files:` 뒤에 그대로 놓이는 원문이라 형식 오류
    /// 시나리오도 같은 헬퍼가 쓴다. 계약대로 키는 열 0에서 시작한다(SPEC-032 R1).
    fn write_task_with_scope(workflow_root: &Path, id: &str, status: &str, scope: &str) {
        fs::write(
            workflow_root.join(format!("tasks/{id}.md")),
            format!("---\nschema: workflow-labs/task@1\nid: {id}\ntitle: 작업\nstatus: {status}\nsource_spec_id: SPEC-001\nscope_files: {scope}\nupdated_at: 2026-08-01T00:00:00Z\n---\n\n작업 본문\n"),
        )
        .expect("write task with scope");
    }

    /// lease 파일 하나를 그대로 쓴다. 만료 시각이 아니라 파일 내용 자체를 바꾸는 시나리오가 쓴다.
    fn write_lease_body(project_root: &Path, target_id: &str, body: &str) {
        let leases = project_root.join(".workflow/.runtime/leases");
        fs::create_dir_all(&leases).expect("leases root");
        fs::write(leases.join(format!("{target_id}.yml")), body).expect("write lease");
    }

    fn write_lease(project_root: &Path, target_id: &str, expires_at: &str) {
        write_lease_body(
            project_root,
            target_id,
            &format!("schema_version: 1\nlease_id: lease-{target_id}\nagent: agent\ntask_id: {target_id}\nheartbeat_at: {expires_at}\nexpires_at: {expires_at}\n"),
        );
    }

    /// 시각은 canonical UTC 표기(`YYYY-MM-DDTHH:MM:SSZ`)로 쓴다. `to_rfc3339()`가 내는 `+00:00`은
    /// 조건 스크립트가 읽지 못해 앱과 스크립트의 대조가 표기 차이만으로 무너진다.
    fn canonical(at: chrono::DateTime<chrono::Utc>) -> String {
        at.format("%Y-%m-%dT%H:%M:%SZ").to_string()
    }

    fn future() -> String {
        canonical(chrono::Utc::now() + chrono::Duration::minutes(30))
    }

    fn past() -> String {
        canonical(chrono::Utc::now() - chrono::Duration::minutes(30))
    }

    #[test]
    fn an_idea_without_a_spec_is_planner_work() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");

        assert!(assert_matches_condition_script(root.path()).planner);
    }

    #[test]
    fn an_adopted_idea_is_not_planner_work() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_spec(&workflow_root, "SPEC-001", "IDEA-001");

        assert!(!assert_matches_condition_script(root.path()).planner);
    }

    /// 참조 판정은 앵커 없는 부분 일치다. `IDEA-1`을 참조한 기획서는 `IDEA-12`를 닫지 못하므로
    /// `IDEA-12`가 기획자 대기 물량으로 남는다. 스크립트가 한 번의 훑기로 모은 줄에 부분 문자열
    /// 검사를 걸어도 이 방향의 답이 그대로인지를 본다(TASK-104).
    ///
    /// 반대 방향(`IDEA-12`만 참조한 기획서가 `IDEA-1`까지 닫는 쪽)은 두 판정이 갈라지는 자리라
    /// 여기서 세우지 않는다. 스크립트만 `IDEA-1`을 닫고 앱은 `source_idea_id`를 아이디어 id와 값
    /// 전체로 비교한다. 착수 시점부터 있던 차이이고 TASK-104가 만든 것이 아니다 — 조건 스크립트의
    /// 시나리오 표가 그 상황의 현재 답을 따로 고정한다.
    #[test]
    fn a_spec_naming_a_shorter_idea_id_does_not_close_the_longer_one() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-1");
        write_idea(&workflow_root, "IDEA-12");
        write_spec(&workflow_root, "SPEC-001", "IDEA-1");

        assert!(assert_matches_condition_script(root.path()).planner);
    }

    #[test]
    fn a_leased_idea_is_not_planner_work() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_lease(root.path(), "IDEA-001", &future());

        assert!(!assert_matches_condition_script(root.path()).planner);
    }

    #[test]
    fn an_approved_decision_without_tasks_is_architect_work() {
        let (root, workflow_root) = project();
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );

        assert!(assert_matches_condition_script(root.path()).architect);
        let detail = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project")
            .pending_detail;
        assert_eq!(detail.architect.target.as_deref(), Some("DECISION-001"));
        assert_eq!(
            detail.architect.target_kind.as_deref(),
            Some("spec_approval")
        );
    }

    #[test]
    fn a_task_revision_request_precedes_an_undecomposed_approval() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "todo", None);
        write_task_revision_request(
            &workflow_root,
            "REVISION-001",
            "TASK-001",
            "2026-08-02T00:00:00Z",
        );
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.architect.target.as_deref(), Some("REVISION-001"));
        assert_eq!(
            detail.architect.target_kind.as_deref(),
            Some("task_revision_request")
        );
    }

    #[test]
    fn a_definition_error_block_is_direct_architect_work() {
        let (root, workflow_root) = project();
        write_blocked_task(&workflow_root, "TASK-001", Some("definition_error"));

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.architect.target.as_deref(), Some("TASK-001"));
        assert_eq!(
            detail.architect.target_kind.as_deref(),
            Some("blocked_task")
        );
        assert_eq!(candidate_lines(&detail.architect), ["eligible TASK-001"]);
        assert_eq!(detail.developer.target, None);
    }

    #[test]
    fn a_historical_revision_request_precedes_a_direct_definition_error_block() {
        let (root, workflow_root) = project();
        write_blocked_task(&workflow_root, "TASK-001", Some("definition_error"));
        write_task_revision_request(
            &workflow_root,
            "REVISION-001",
            "TASK-001",
            "2026-08-02T00:00:00Z",
        );

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.architect.target.as_deref(), Some("REVISION-001"));
        assert_eq!(
            detail.architect.target_kind.as_deref(),
            Some("task_revision_request")
        );
    }

    #[test]
    fn a_leased_historical_request_keeps_its_definition_error_task_closed() {
        let (root, workflow_root) = project();
        write_blocked_task(&workflow_root, "TASK-001", Some("definition_error"));
        write_task_revision_request(
            &workflow_root,
            "REVISION-001",
            "TASK-001",
            "2026-08-02T00:00:00Z",
        );
        write_lease(root.path(), "REVISION-001", &future());

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.architect.target, None);
        assert_eq!(candidate_lines(&detail.architect), ["leased REVISION-001"]);
    }

    #[test]
    fn a_leased_definition_error_block_does_not_hide_a_later_direct_correction() {
        let (root, workflow_root) = project();
        write_blocked_task(&workflow_root, "TASK-001", Some("definition_error"));
        write_blocked_task(&workflow_root, "TASK-002", Some("definition_error"));
        write_lease(root.path(), "TASK-001", &future());

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.architect.target.as_deref(), Some("TASK-002"));
        assert_eq!(
            detail.architect.target_kind.as_deref(),
            Some("blocked_task")
        );
        assert_eq!(
            candidate_lines(&detail.architect),
            ["leased TASK-001", "eligible TASK-002"]
        );
    }

    #[test]
    fn non_definition_and_legacy_blocks_are_developer_work() {
        for blocked_kind in [Some("implementation_failure"), None] {
            let (root, workflow_root) = project();
            write_blocked_task(&workflow_root, "TASK-001", blocked_kind);

            let detail = detail_matching_condition_script(root.path());

            assert_eq!(detail.architect.target, None, "{blocked_kind:?}");
            assert_eq!(detail.developer.target.as_deref(), Some("TASK-001"));
        }
    }

    #[test]
    fn the_oldest_unhandled_task_revision_request_is_selected() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "blocked", None);
        write_task_revision_request(
            &workflow_root,
            "REVISION-LATE",
            "TASK-001",
            "2026-08-03T00:00:00Z",
        );
        write_task_revision_request(
            &workflow_root,
            "REVISION-EARLY",
            "TASK-001",
            "2026-08-02T00:00:00Z",
        );

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.architect.target.as_deref(), Some("REVISION-EARLY"));
        assert_eq!(
            detail.architect.target_kind.as_deref(),
            Some("task_revision_request")
        );
    }

    #[test]
    fn handled_or_closed_task_revision_requests_are_not_candidates() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-HANDLED", "todo", None);
        write_task_revision_request(
            &workflow_root,
            "REVISION-HANDLED",
            "TASK-HANDLED",
            "2026-08-01T00:00:00Z",
        );
        link_handled_revision_request(&workflow_root, "TASK-HANDLED", "REVISION-HANDLED");
        for (task, request, status, day) in [
            ("TASK-QA", "REVISION-QA", "qa_waiting", "02"),
            ("TASK-DONE", "REVISION-DONE", "completed", "03"),
        ] {
            write_task(&workflow_root, task, status, None);
            write_task_revision_request(
                &workflow_root,
                request,
                task,
                &format!("2026-08-{day}T00:00:00Z"),
            );
        }
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-04T00:00:00Z",
        );

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.architect.target.as_deref(), Some("DECISION-001"));
        assert_eq!(
            detail.architect.target_kind.as_deref(),
            Some("spec_approval")
        );
        assert_eq!(
            candidate_lines(&detail.architect),
            ["eligible DECISION-001"]
        );
    }

    #[test]
    fn active_request_or_task_leases_hide_revision_requests_but_expired_leases_do_not() {
        for leased_target in ["REVISION-001", "TASK-001"] {
            let (root, workflow_root) = project();
            write_task(&workflow_root, "TASK-001", "blocked", None);
            write_task_revision_request(
                &workflow_root,
                "REVISION-001",
                "TASK-001",
                "2026-08-01T00:00:00Z",
            );
            write_lease(root.path(), leased_target, &future());

            let detail = detail_matching_condition_script(root.path());

            assert_eq!(detail.architect.target, None, "{leased_target}");
            assert_eq!(candidate_lines(&detail.architect), ["leased REVISION-001"]);
        }

        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "blocked", None);
        write_task_revision_request(
            &workflow_root,
            "REVISION-001",
            "TASK-001",
            "2026-08-01T00:00:00Z",
        );
        write_lease(root.path(), "REVISION-001", &past());
        let detail = detail_matching_condition_script(root.path());
        assert_eq!(detail.architect.target.as_deref(), Some("REVISION-001"));
    }

    #[test]
    fn a_decomposed_decision_is_not_architect_work() {
        let (root, workflow_root) = project();
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_task(
            &workflow_root,
            "TASK-001",
            "qa_waiting",
            Some("DECISION-001"),
        );

        assert!(!assert_matches_condition_script(root.path()).architect);
    }

    #[test]
    fn a_leased_spec_is_not_architect_work() {
        let (root, workflow_root) = project();
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_lease(root.path(), "SPEC-001", &future());

        assert!(!assert_matches_condition_script(root.path()).architect);
    }

    /// 승인 뒤 수정 요청이 이어지면 그 승인은 최신이 아니다. 파생 작업이 없어도 아키텍트 자격이
    /// 없다(SPEC-028 R4). 역할 계약의 "The latest app-owned decision must be `approved`"가 요구하는
    /// 답이고, 이 시나리오가 TASK-086 전에는 반대 값을 고정하고 있었다.
    #[test]
    fn an_approved_decision_superseded_by_a_revision_request_is_not_architect_work() {
        let (root, workflow_root) = project();
        write_spec(&workflow_root, "SPEC-001", "IDEA-001");
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_decision(
            &workflow_root,
            "DECISION-002",
            "SPEC-001",
            "revision_requested",
            "2026-08-02T00:00:00Z",
        );

        assert!(!assert_matches_condition_script(root.path()).architect);
    }

    /// 재가 시나리오. 분해가 끝난 승인에 더 늦은 승인이 더해지면 오래된 승인은 최신 자리에서
    /// 밀려나지만, 더해진 승인 자신은 최신이고 그것을 참조하는 작업이 없어 자격이 남는다.
    ///
    /// 이 저장소의 SPEC-022가 같은 모양이다(`DECISION-7A3E5B90` 분해 완료, 더 늦은
    /// `DECISION-4E8C1D67` 미분해). 작업 문서는 이 자리에 "일감 없음"을 적었지만, 그렇게 만들면
    /// 그 결정의 판정이 뒤집혀 완료 조건 8과 충돌한다. 두 판정이 같은 답을 내는 것까지가 이
    /// 시나리오의 보장이다.
    #[test]
    fn a_later_approval_stays_architect_work_after_the_earlier_one_was_decomposed() {
        let (root, workflow_root) = project();
        write_spec(&workflow_root, "SPEC-001", "IDEA-001");
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_task(
            &workflow_root,
            "TASK-001",
            "qa_waiting",
            Some("DECISION-001"),
        );
        write_decision(
            &workflow_root,
            "DECISION-002",
            "SPEC-001",
            "approved",
            "2026-08-02T00:00:00Z",
        );

        assert!(assert_matches_condition_script(root.path()).architect);
    }

    /// 뒤집은 짝. 더 늦은 승인 쪽이 분해되고 오래된 승인이 남으면 자격이 없다. 최신 검사가 없으면
    /// 오래된 승인이 두 번째 작업 세트를 열어 두 판정이 여기서 갈라진다.
    #[test]
    fn an_earlier_approval_does_not_reopen_work_after_the_latest_one_was_decomposed() {
        let (root, workflow_root) = project();
        write_spec(&workflow_root, "SPEC-001", "IDEA-001");
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_decision(
            &workflow_root,
            "DECISION-002",
            "SPEC-001",
            "approved",
            "2026-08-02T00:00:00Z",
        );
        write_task(
            &workflow_root,
            "TASK-001",
            "qa_waiting",
            Some("DECISION-002"),
        );

        assert!(!assert_matches_condition_script(root.path()).architect);
    }

    /// 동률은 최신으로 본다. 앱의 `latest_approvals`와 스크립트가 둘 다 "더 큰 것이 있는가"만
    /// 보므로, `created_at`이 같은 두 승인은 양쪽 다 최신이다. 한쪽만 남기면 디렉터리 순회 순서가
    /// 판정을 정하게 된다.
    #[test]
    fn approvals_recorded_at_the_same_instant_both_stay_latest() {
        let (root, workflow_root) = project();
        write_spec(&workflow_root, "SPEC-001", "IDEA-001");
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_decision(
            &workflow_root,
            "DECISION-002",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_task(
            &workflow_root,
            "TASK-001",
            "qa_waiting",
            Some("DECISION-002"),
        );

        assert!(assert_matches_condition_script(root.path()).architect);
    }

    /// `created_at` 표기가 섞인 같은 초의 두 결정. 앱이 쓰는 `to_rfc3339()`는 소수 초와 `+00:00`을
    /// 남기고 손으로 적은 결정은 초 단위 `Z`인데, 문자열로 비교하면 `.`(0x2E)가 `Z`(0x5A)보다 작아
    /// 같은 초 안에서 순서가 뒤집힌다. 여기서는 실제로 나중에 기록된 앱 형식 결정이 더 이른 것으로
    /// 읽혀 최신 자리를 잃는다.
    ///
    /// 표기 정규화는 SPEC-028 제외 범위이고, 비교 전에 표기를 다듬으면 기획자 분기와 다른 어법이
    /// 된다. 그래서 이 한계는 감수하고, **두 구현이 같은 답을 낸다는 것**만 고정한다. 앱의
    /// `latest_approvals`와 스크립트가 똑같이 문자열을 비교하므로 뒤집힘도 양쪽에서 같이 일어난다.
    #[test]
    fn mixed_timestamp_notations_tie_the_same_way_in_both_implementations() {
        let (root, workflow_root) = project();
        write_spec(&workflow_root, "SPEC-001", "IDEA-001");
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-04T09:32:00Z",
        );
        write_task(
            &workflow_root,
            "TASK-001",
            "qa_waiting",
            Some("DECISION-001"),
        );
        write_decision(
            &workflow_root,
            "DECISION-002",
            "SPEC-001",
            "approved",
            "2026-08-04T09:32:00.500000+00:00",
        );

        assert!(!assert_matches_condition_script(root.path()).architect);
    }

    /// 위임 대리 결정은 아키텍트 일감이 아니다. 앱의 읽기 경로가 `created_by`를 `user`로 거르고
    /// (`read_spec_decisions`), 스크립트의 아키텍트 분기도 같은 값을 값 전체로 비교한다.
    /// 접두 일치로 두면 `user-delegate`가 그대로 통과한다(SPEC-028 R5).
    #[test]
    fn an_approval_created_by_a_delegate_is_not_architect_work() {
        let (root, workflow_root) = project();
        write_decision_created_by(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "user-delegate",
            "2026-08-01T00:00:00Z",
        );

        assert!(!assert_matches_condition_script(root.path()).architect);
    }

    /// 위임 대리 결정은 최신 자리도 차지하지 못한다. 앞의 시나리오가 후보 선택을 보고 이쪽이 최신
    /// 검사를 본다. 스크립트는 최신 검사를 `spec_id`별 `created_at` 최댓값 표로 하는데, 그 표에
    /// 드는 것은 `created_by`가 정확히 `user`인 결정뿐이다(TASK-104). 앱은 `read_spec_decisions`가
    /// 같은 값으로 거른 뒤 `latest_approvals`가 최신을 고른다.
    #[test]
    fn a_delegate_approval_does_not_supersede_an_approval() {
        let (root, workflow_root) = project();
        write_spec(&workflow_root, "SPEC-001", "IDEA-001");
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_decision_created_by(
            &workflow_root,
            "DECISION-002",
            "SPEC-001",
            "approved",
            "user-delegate",
            "2026-08-02T00:00:00Z",
        );

        assert!(assert_matches_condition_script(root.path()).architect);
    }

    /// 최신 검사는 같은 기획서 안에서만 한다. 스크립트의 최댓값 표가 `spec_id`로 갈리는 것과 앱의
    /// `latest_approvals`가 `other.spec_id == record.spec_id`를 보는 것이 같은 규칙이다. 표를 하나로
    /// 두면 다른 기획서의 더 늦은 결정이 이 승인을 밀어내 두 판정이 갈라진다.
    #[test]
    fn a_later_decision_on_another_spec_does_not_supersede_an_approval() {
        let (root, workflow_root) = project();
        write_spec(&workflow_root, "SPEC-001", "IDEA-001");
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_decision(
            &workflow_root,
            "DECISION-002",
            "SPEC-002",
            "revision_requested",
            "2026-08-02T00:00:00Z",
        );

        assert!(assert_matches_condition_script(root.path()).architect);
    }

    #[test]
    fn a_todo_task_is_developer_work() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "todo", Some("DECISION-001"));
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );

        assert!(assert_matches_condition_script(root.path()).developer);
    }

    #[test]
    fn a_qa_waiting_task_is_not_developer_work() {
        let (root, workflow_root) = project();
        write_task(
            &workflow_root,
            "TASK-001",
            "qa_waiting",
            Some("DECISION-001"),
        );
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );

        assert!(!assert_matches_condition_script(root.path()).developer);
    }

    #[test]
    fn a_leased_task_is_not_developer_work() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "todo", Some("DECISION-001"));
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_lease(root.path(), "TASK-001", &future());

        assert!(!assert_matches_condition_script(root.path()).developer);
    }

    /// 선행이 `qa_waiting`·`completed`면 후행이 열린다. 선언을 보지 않던 구현도 여기서는 같은 답을
    /// 내므로, 이 시나리오만으로는 배선을 고정하지 못한다. 아래 미충족 시나리오와 짝이다.
    #[test]
    fn a_todo_task_with_satisfied_dependencies_is_developer_work() {
        for satisfied in ["qa_waiting", "completed"] {
            let (root, workflow_root) = project();
            write_task(&workflow_root, "TASK-001", satisfied, None);
            write_task_with_declaration(&workflow_root, "TASK-002", "todo", "[TASK-001]");

            assert!(
                assert_matches_condition_script(root.path()).developer,
                "선행이 {satisfied}인데 후행이 열리지 않았다"
            );
        }
    }

    /// 빈 목록은 선행이 없다는 뜻이다. 키의 존재 자체를 제약으로 읽으면 여기서 갈라진다.
    #[test]
    fn an_empty_declaration_leaves_the_task_open() {
        let (root, workflow_root) = project();
        write_task_with_declaration(&workflow_root, "TASK-001", "todo", "[]");

        assert!(assert_matches_condition_script(root.path()).developer);
    }

    /// SPEC-013 완료 조건 8. 의존 미충족 `todo`만 남으면 스크립트는 1을, 앱은 `false`를 낸다.
    /// 배선 전에는 이 픽스처에서 앱만 `true`였고 화면의 대기 물량이 하트비트보다 낙관적이었다.
    #[test]
    fn only_unsatisfied_dependencies_leave_no_developer_work() {
        for pending in ["todo", "in_progress", "blocked"] {
            let (root, workflow_root) = project();
            write_task_with_declaration(&workflow_root, "TASK-001", "todo", "[TASK-002]");
            write_task(&workflow_root, "TASK-002", pending, None);
            // 선행 자신이 `todo`면 그 작업이 열려 있다. 후행만 남기려면 선점해 후보에서 뺀다.
            // 선점은 선행 판정을 바꾸지 않는다 — 판정이 보는 것은 상태뿐이다.
            write_lease(root.path(), "TASK-002", &future());

            assert!(
                !assert_matches_condition_script(root.path()).developer,
                "선행이 {pending}인데 후행이 열렸다"
            );
        }
    }

    /// 영원히 충족되지 않는 선언 세 가지. 판정 불가를 자격 있음으로 넘기면 잘못 쓴 한 줄이 순서를
    /// 통째로 무력화한다(SPEC-013 R3).
    #[test]
    fn a_declaration_that_can_never_be_satisfied_is_not_developer_work() {
        // 없는 id.
        let (root, workflow_root) = project();
        write_task_with_declaration(&workflow_root, "TASK-001", "todo", "[TASK-404]");
        assert!(!assert_matches_condition_script(root.path()).developer);

        // 자기 참조.
        let (root, workflow_root) = project();
        write_task_with_declaration(&workflow_root, "TASK-001", "todo", "[TASK-001]");
        assert!(!assert_matches_condition_script(root.path()).developer);

        // 두 작업이 서로를 참조하는 순환. 선행이 `completed`여도 고리가 우선이다.
        let (root, workflow_root) = project();
        write_task_with_declaration(&workflow_root, "TASK-001", "todo", "[TASK-002]");
        write_task_with_declaration(&workflow_root, "TASK-002", "completed", "[TASK-001]");
        assert!(!assert_matches_condition_script(root.path()).developer);
    }

    /// 목록으로 읽을 수 없는 선언은 미충족이다. 마지막 두 값은 프론트매터 자체가 YAML로 파싱되지
    /// 않는 경우이기도 한데, 그때도 두 판정이 갈라지지 않아야 한다.
    #[test]
    fn a_malformed_declaration_is_not_developer_work() {
        for declaration in ["TASK-001", "[\"TASK-001\"]", "[TASK-001", "[TASK-001, ]"] {
            let (root, workflow_root) = project();
            write_task(&workflow_root, "TASK-002", "completed", None);
            write_task_with_declaration(&workflow_root, "TASK-001", "todo", declaration);

            assert!(
                !assert_matches_condition_script(root.path()).developer,
                "`depends_on: {declaration}`이 자격으로 읽혔다"
            );
        }
    }

    /// 만료 lease와의 조합(TASK-055 기준 유지). 만료된 lease는 선점이 아니므로 충족된 선언을 가진
    /// 작업은 열린다. 후반의 `in_progress` 선행은 미충족 그대로이고 — `dep_satisfied`는 여전히
    /// `qa_waiting`·`completed`만 센다 — 그럼에도 판정이 열리는 것은 그 선행 자신이 회수 대상이기
    /// 때문이다(SPEC-035 R1). 멈춘 작업 하나가 자기를 기다리는 작업까지 함께 막던 자리가 여기다.
    ///
    /// TASK-055가 세운 후반의 기대값을 이 작업이 뒤집었다. 미충족 선언이 lease가 사라져도 미충족인
    /// 것은 `only_unsatisfied_dependencies_leave_no_developer_work`가 계속 따로 고정한다 — 그쪽은
    /// 선행에 미만료 lease를 두어 선행 자신을 후보에서 뺀다.
    #[test]
    fn an_expired_lease_leaves_both_the_declaration_and_the_stalled_task_open() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "qa_waiting", None);
        write_task_with_declaration(&workflow_root, "TASK-002", "todo", "[TASK-001]");
        write_lease(root.path(), "TASK-002", &past());
        assert!(assert_matches_condition_script(root.path()).developer);

        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "in_progress", None);
        write_task_with_declaration(&workflow_root, "TASK-002", "todo", "[TASK-001]");
        write_lease(root.path(), "TASK-002", &past());
        assert!(assert_matches_condition_script(root.path()).developer);
    }

    /// 충족된 선언을 가진 작업도 미만료 lease가 있으면 대상이 아니다. 두 조건은 서로를 대체하지
    /// 않는다.
    #[test]
    fn a_lease_still_hides_a_task_whose_dependencies_are_satisfied() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "qa_waiting", None);
        write_task_with_declaration(&workflow_root, "TASK-002", "todo", "[TASK-001]");
        write_lease(root.path(), "TASK-002", &future());

        assert!(!assert_matches_condition_script(root.path()).developer);
    }

    /// SPEC-032 완료 조건 2·5. 선행 관계가 없는 두 작업 — 어느 쪽도 상대를 `depends_on`에 적지
    /// 않았다 — 이 같은 파일을 선언하면, 한쪽이 잡힌 동안 다른 쪽은 착수 대상이 아니다. 두 판정이
    /// 같은 답을 낸다.
    #[test]
    fn a_shared_scope_is_not_developer_work_while_the_other_task_is_leased() {
        let (root, workflow_root) = project();
        write_task_with_scope(&workflow_root, "TASK-001", "todo", "[src/shared.rs]");
        write_task_with_scope(&workflow_root, "TASK-002", "in_progress", "[src/shared.rs]");
        write_lease(root.path(), "TASK-002", &future());

        assert!(!assert_matches_condition_script(root.path()).developer);
    }

    /// SPEC-032 완료 조건 3·5. 겹치지 않는 선언은 잡힌 lease가 있어도 열린다. 위 시나리오와 다른
    /// 것은 선언 한 줄뿐이다.
    #[test]
    fn a_disjoint_scope_is_developer_work_while_another_task_is_leased() {
        let (root, workflow_root) = project();
        write_task_with_scope(&workflow_root, "TASK-001", "todo", "[src/one.rs]");
        write_task_with_scope(&workflow_root, "TASK-002", "in_progress", "[src/two.rs]");
        write_lease(root.path(), "TASK-002", &future());

        assert!(assert_matches_condition_script(root.path()).developer);
    }

    /// SPEC-032 완료 조건 6·5. 선언이 없는 작업은 무엇과 겹치는지 알 수 없으므로 잡힌 lease가
    /// 하나라도 있으면 자격에서 빠지고, 없으면 열린다. 두 판정이 같은 답을 낸다.
    #[test]
    fn a_task_without_a_scope_is_developer_work_only_while_nothing_is_leased() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "todo", None);
        write_task_with_scope(&workflow_root, "TASK-002", "in_progress", "[src/two.rs]");
        assert!(assert_matches_condition_script(root.path()).developer);

        write_lease(root.path(), "TASK-002", &future());
        assert!(!assert_matches_condition_script(root.path()).developer);
    }

    /// SPEC-032 완료 조건 7·5. 만료된 lease는 겹치는 작업을 막지 않는다. 만료가 유일한 해제
    /// 조건이라는 것이 R8이고, 그것이 없으면 죽은 세션 하나가 겹치는 작업을 영원히 닫는다.
    #[test]
    fn an_expired_lease_does_not_block_an_overlapping_task() {
        let (root, workflow_root) = project();
        write_task_with_scope(&workflow_root, "TASK-001", "todo", "[src/shared.rs]");
        write_task_with_scope(&workflow_root, "TASK-002", "in_progress", "[src/shared.rs]");
        write_lease(root.path(), "TASK-002", &past());

        assert!(assert_matches_condition_script(root.path()).developer);
    }

    /// 형식 오류 선언은 부재와 같은 답을 낸다. 겹침이 대칭 관계이므로 어느 쪽이 잘못 썼든 결과가
    /// 같고, 두 판정도 갈라지지 않는다.
    #[test]
    fn a_malformed_scope_is_not_developer_work_on_either_side() {
        for (mine, theirs) in [
            ("[\"src/one.rs\"]", "[src/two.rs]"),
            ("[src/one.rs]", "[\"src/two.rs\"]"),
        ] {
            let (root, workflow_root) = project();
            write_task_with_scope(&workflow_root, "TASK-001", "todo", mine);
            write_task_with_scope(&workflow_root, "TASK-002", "in_progress", theirs);
            write_lease(root.path(), "TASK-002", &future());

            assert!(
                !assert_matches_condition_script(root.path()).developer,
                "`scope_files: {mine}`와 `{theirs}`의 조합이 자격으로 읽혔다"
            );
        }
    }

    /// 빈 목록은 "만지는 파일이 없다"이고 아무와도 겹치지 않는다. 부재와 다르다 — 부재였다면 잡힌
    /// lease 하나로 막혔을 자리다.
    #[test]
    fn an_empty_scope_overlaps_with_nothing() {
        let (root, workflow_root) = project();
        write_task_with_scope(&workflow_root, "TASK-001", "todo", "[]");
        write_task_with_scope(&workflow_root, "TASK-002", "in_progress", "[src/two.rs]");
        write_lease(root.path(), "TASK-002", &future());

        assert!(assert_matches_condition_script(root.path()).developer);
    }

    // ── SPEC-035 R1. 멈춘 개발 작업의 회수 ────────────────────────────────────────────────
    //
    // 죽은 세션의 시그니처는 `in_progress`이면서 그 작업을 덮는 미만료 lease가 없는 것이다. 다섯
    // 시나리오가 기획서 완료 조건 1~5를 닫고, 모두 대조 헬퍼를 지나므로 앱 판정과 조건 스크립트가
    // 같은 답을 내는 것까지 함께 고정한다(완료 조건 13).

    /// 완료 조건 1. lease가 풀렸는데 상태가 `in_progress`라 아무도 집지 않던 작업이 대상이 된다.
    #[test]
    fn a_stalled_in_progress_task_is_developer_work() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "in_progress", None);

        assert!(assert_matches_condition_script(root.path()).developer);
    }

    /// 완료 조건 2. 만료된 lease는 파일이 없는 것과 같은 답을 낸다. 만료 뒤에 유예를 두지 않는 것이
    /// 승인된 확인 필요 2번이고, 판별자는 `lease_blocks()`가 답하는 값 하나뿐이다.
    #[test]
    fn an_expired_lease_leaves_a_stalled_in_progress_task_open() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "in_progress", None);
        write_lease(root.path(), "TASK-001", &past());

        assert!(assert_matches_condition_script(root.path()).developer);
    }

    /// 완료 조건 3. 살아 있는 세션의 작업은 그 lease가 그대로 막는다. 회수가 정상적으로 일하고 있는
    /// 세션의 작업을 자격 목록에 올리면 두 세션이 같은 작업을 편집한다.
    #[test]
    fn an_unexpired_lease_still_hides_an_in_progress_task() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "in_progress", None);
        write_lease(root.path(), "TASK-001", &future());

        assert!(!assert_matches_condition_script(root.path()).developer);
    }

    /// 완료 조건 4. 나머지 자격 조건은 `todo`와 완전히 같다. 상태 집합만 넓어지고 선행 선언 판정은
    /// 느슨해지지 않는다.
    #[test]
    fn an_in_progress_task_with_an_unsatisfiable_declaration_is_not_developer_work() {
        let (root, workflow_root) = project();
        write_task_with_declaration(&workflow_root, "TASK-001", "in_progress", "[TASK-404]");

        assert!(!assert_matches_condition_script(root.path()).developer);
    }

    /// 미분류 `blocked`은 과거 문서까지 에이전트가 회수하도록 개발자 대상에 남는다. 만료된 lease는
    /// 다른 상태와 마찬가지로 이 복구도 막지 않는다.
    #[test]
    fn a_legacy_blocked_task_is_developer_work_with_or_without_an_expired_lease() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "blocked", None);
        assert!(assert_matches_condition_script(root.path()).developer);

        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "blocked", None);
        write_lease(root.path(), "TASK-001", &past());
        assert!(assert_matches_condition_script(root.path()).developer);
    }

    /// 세 역할이 보는 대상 각각에 만료된 lease가 있는 픽스처. 죽은 세션이 남긴 lease가 자격을
    /// 어떻게 다루는지를 보는 시나리오들이 공유한다.
    fn project_with_leases(body: impl Fn(&str) -> String) -> (TempDir, PathBuf) {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_task(&workflow_root, "TASK-001", "todo", None);
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        for target in ["IDEA-001", "TASK-001", "SPEC-001"] {
            write_lease_body(root.path(), target, &body(target));
        }
        (root, workflow_root)
    }

    /// 만료된 lease는 세 분기 어디에서도 대상을 막지 않는다. 세션 하나가 대상을 잡고 죽으면 그
    /// 대상이 영원히 자격을 잃던 결함을 여기서 고정한다.
    #[test]
    fn an_expired_lease_file_does_not_block_its_target() {
        let expired = past();
        let (root, _workflow_root) = project_with_leases(|target| {
            format!("schema_version: 1\nlease_id: lease-{target}\nagent: agent\ntask_id: {target}\nheartbeat_at: {expired}\nexpires_at: {expired}\n")
        });

        let pending = assert_matches_condition_script(root.path());
        assert_eq!(
            pending,
            PendingRoleWork {
                planner: true,
                architect: true,
                developer: true,
            }
        );
        assert!(FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project")
            .active_leases
            .is_empty());
    }

    /// 시각을 읽을 수 없는 lease도 선점으로 세지 않는다. 이 판정이 지는 위험은 대상이 영원히 열리지
    /// 않는 것이고, 실제 선점은 배타적 생성이 막는다.
    #[test]
    fn a_lease_without_a_readable_expiry_does_not_block_its_target() {
        for body in [
            "schema_version: 1\nlease_id: lease-x\nagent: agent\ntask_id: x\nheartbeat_at: 2026-08-01T00:00:00Z\n",
            "schema_version: 1\nlease_id: lease-x\nagent: agent\ntask_id: x\nheartbeat_at: 2026-08-01T00:00:00Z\nexpires_at: nope\n",
        ] {
            let (root, _workflow_root) = project_with_leases(|_| body.to_owned());

            let pending = assert_matches_condition_script(root.path());
            assert_eq!(
                pending,
                PendingRoleWork {
                    planner: true,
                    architect: true,
                    developer: true,
                },
                "{body}는 선점이 아니다"
            );
        }
    }

    /// 판정은 lease 파일을 읽기만 한다. 만료된 파일도 그대로 남는다 — 앱은 lease를 쓰지 않는다.
    #[test]
    fn judging_leaves_every_lease_file_untouched() {
        let expired = past();
        let (root, _workflow_root) = project_with_leases(|target| {
            format!("schema_version: 1\nlease_id: lease-{target}\nagent: agent\ntask_id: {target}\nheartbeat_at: {expired}\nexpires_at: {expired}\n")
        });
        let leases = root.path().join(".workflow/.runtime/leases");
        let before = read_lease_directory(&leases);

        assert_matches_condition_script(root.path());

        assert_eq!(before, read_lease_directory(&leases));
        assert_eq!(before.len(), 3);
    }

    /// 기획서 완료 조건 12. 회수 판정도 아무것도 쓰지 않는다. 죽은 세션이 남긴 것 — 만료된 lease,
    /// `in_progress`로 멈춘 작업, 원천을 물고 있는 `draft` 기획서 — 을 모두 둔 픽스처에서, 판정 전후로
    /// `leases/`와 워크플로우 디렉터리의 파일 개수와 내용이 같다.
    ///
    /// 만료 lease 파일의 청소는 기획서 제외 범위다. 판정에서 무시할 뿐 지우지 않는다(SPEC-018 R4).
    #[test]
    fn recovering_a_stalled_session_writes_nothing() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_spec_with_status(&workflow_root, "SPEC-001", "IDEA-001", "draft");
        write_task(&workflow_root, "TASK-001", "in_progress", None);
        write_lease(root.path(), "TASK-001", &past());
        let leases = root.path().join(".workflow/.runtime/leases");
        let leases_before = read_lease_directory(&leases);
        let documents_before = read_document_tree(&workflow_root);

        let pending = assert_matches_condition_script(root.path());

        assert_eq!(
            pending,
            PendingRoleWork {
                planner: true,
                architect: false,
                developer: true,
            }
        );
        assert_eq!(leases_before, read_lease_directory(&leases));
        assert_eq!(documents_before, read_document_tree(&workflow_root));
        assert_eq!(leases_before.len(), 1);
    }

    #[test]
    fn judging_a_task_revision_request_changes_no_document_or_lease() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "blocked", None);
        write_task_revision_request(
            &workflow_root,
            "REVISION-001",
            "TASK-001",
            "2026-08-01T00:00:00Z",
        );
        write_lease(root.path(), "EXPIRED", &past());
        let leases = root.path().join(".workflow/.runtime/leases");
        let leases_before = read_lease_directory(&leases);
        let documents_before = read_document_tree(&workflow_root);

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.architect.target.as_deref(), Some("REVISION-001"));
        assert_eq!(leases_before, read_lease_directory(&leases));
        assert_eq!(documents_before, read_document_tree(&workflow_root));
    }

    /// 워크플로우 디렉터리 아래 모든 파일의 `(상대 경로, 내용)` 목록. 개수와 내용을 함께 고정한다.
    fn read_document_tree(workflow_root: &Path) -> Vec<(String, String)> {
        let mut entries: Vec<(String, String)> = Vec::new();
        let mut pending = vec![workflow_root.to_path_buf()];
        while let Some(directory) = pending.pop() {
            for entry in fs::read_dir(&directory).expect("workflow directory") {
                let path = entry.expect("directory entry").path();
                if path.is_dir() {
                    pending.push(path);
                    continue;
                }
                entries.push((
                    path.strip_prefix(workflow_root)
                        .expect("relative path")
                        .to_string_lossy()
                        .into_owned(),
                    fs::read_to_string(&path).expect("document body"),
                ));
            }
        }
        entries.sort();
        entries
    }

    /// lease 디렉터리의 `(파일 이름, 내용)` 목록. 개수와 내용을 함께 고정한다.
    fn read_lease_directory(leases: &Path) -> Vec<(String, String)> {
        let mut entries: Vec<(String, String)> = fs::read_dir(leases)
            .expect("leases root")
            .map(|entry| {
                let path = entry.expect("lease entry").path();
                (
                    path.file_name()
                        .expect("lease file name")
                        .to_string_lossy()
                        .into_owned(),
                    fs::read_to_string(&path).expect("lease body"),
                )
            })
            .collect();
        entries.sort();
        entries
    }

    #[test]
    fn a_migration_lock_stops_every_role() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_task(&workflow_root, "TASK-001", "todo", None);
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        let runtime = root.path().join(".workflow/.runtime");
        fs::create_dir_all(&runtime).expect("runtime root");
        fs::write(runtime.join("migration.lock"), "").expect("migration lock");

        let pending = assert_matches_condition_script(root.path());
        assert_eq!(pending, PendingRoleWork::default());
    }

    #[test]
    fn every_role_is_idle_without_documents() {
        let root = tempdir().expect("temp project");
        FileSystemProjectRepository
            .create_workflow(root.path(), "Feature")
            .expect("create workflow");

        let pending = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project")
            .pending_work;

        assert_eq!(pending, PendingRoleWork::default());
    }

    #[test]
    fn an_uninitialized_project_has_no_pending_work() {
        let root = tempdir().expect("temp project");

        let pending = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project")
            .pending_work;

        assert_eq!(pending, PendingRoleWork::default());
    }

    /// 판정은 워크플로우별이다. 다른 워크플로우의 결정과 작업을 짝지으면 스크립트와 갈라진다.
    #[test]
    fn a_task_does_not_decompose_a_decision_from_another_workflow() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let first = repository
            .create_workflow(root.path(), "First")
            .expect("create workflow");
        let summary = repository
            .create_workflow(root.path(), "Second")
            .expect("create workflow");
        let control_root = root.path().join(".workflow");
        install_condition_script(&control_root).expect("install condition script");
        let first_root = control_root.join(&first.workflows[0].directory);
        let second_root = control_root.join(
            &summary
                .workflows
                .iter()
                .find(|workflow| workflow.name == "Second")
                .expect("second workflow")
                .directory,
        );
        write_decision(
            &first_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_task(&second_root, "TASK-001", "qa_waiting", Some("DECISION-001"));

        assert!(assert_matches_condition_script(root.path()).architect);
    }

    /// 같은 짝의 최신 검사 방향. 다른 워크플로우의 더 늦은 결정은 이쪽 승인을 밀어내지 못한다.
    /// 스크립트는 최댓값 표를 워크플로우 하나 안에서 만들고(TASK-104), 앱은 워크플로우별로 읽은
    /// 결정 목록에 `latest_approvals`를 건다. 표를 전역으로 만들면 여기서 갈라진다.
    #[test]
    fn a_later_decision_in_another_workflow_does_not_supersede_an_approval() {
        let root = tempdir().expect("temp project");
        let repository = FileSystemProjectRepository;
        let first = repository
            .create_workflow(root.path(), "First")
            .expect("create workflow");
        let summary = repository
            .create_workflow(root.path(), "Second")
            .expect("create workflow");
        let control_root = root.path().join(".workflow");
        install_condition_script(&control_root).expect("install condition script");
        let first_root = control_root.join(&first.workflows[0].directory);
        let second_root = control_root.join(
            &summary
                .workflows
                .iter()
                .find(|workflow| workflow.name == "Second")
                .expect("second workflow")
                .directory,
        );
        write_decision(
            &first_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_decision(
            &second_root,
            "DECISION-002",
            "SPEC-001",
            "revision_requested",
            "2026-08-02T00:00:00Z",
        );

        // 두 번째 워크플로우의 결정이 `SPEC-001`을 같은 이름으로 쓰지만 첫 워크플로우의 승인을
        // 밀어내지 못한다. 표가 전역이면 이 값이 뒤집힌다.
        assert!(assert_matches_condition_script(root.path()).architect);
    }

    /// SPEC-018 R1 (나). 후속 기획서가 없는 수정 요청이 기획자 대기 물량이다.
    #[test]
    fn a_revision_request_without_a_follow_up_spec_is_planner_work() {
        let (root, workflow_root) = project();
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "revision_requested",
            "2026-08-01T00:00:00Z",
        );

        assert!(assert_matches_condition_script(root.path()).planner);
    }

    /// 기획서 완료 조건 10·11. 후속 기획서가 생기면 그 결정은 처리 완료지만, 그 후속이 아직
    /// `draft`이면 멈춘 재작업이므로 결정이 다시 대상이 된다(SPEC-035 R2).
    ///
    /// TASK-081이 세운 "후속의 상태는 결과를 바꾸지 않는다"를 이 작업이 뒤집은 자리다. 두 상태를
    /// 한 반복문에서 함께 보는 모양은 그대로 두고 기대값만 상태별로 가른다 — 갈리는 자리가 후속의
    /// `status` 하나뿐이라는 것이 이 검사가 보이는 것이다.
    #[test]
    fn only_a_non_draft_follow_up_spec_answers_the_revision_request() {
        for (status, answered) in [("draft", false), ("user_review", true)] {
            let (root, workflow_root) = project();
            write_decision(
                &workflow_root,
                "DECISION-001",
                "SPEC-001",
                "revision_requested",
                "2026-08-01T00:00:00Z",
            );
            write_rework_spec(&workflow_root, "SPEC-002", "DECISION-001", status);

            assert_eq!(
                assert_matches_condition_script(root.path()).planner,
                !answered,
                "후속 기획서가 {status}일 때 결과가 달라졌다"
            );
        }
    }

    /// 판정 대상은 그 기획서의 가장 최근 결정이다. 뒤에 다른 결정이 붙으면 재작업 대상이 아니다.
    #[test]
    fn a_superseded_revision_request_is_not_planner_work() {
        for outcome in ["approved", "rejected"] {
            let (root, workflow_root) = project();
            write_decision(
                &workflow_root,
                "DECISION-001",
                "SPEC-001",
                "revision_requested",
                "2026-08-01T00:00:00Z",
            );
            write_decision(
                &workflow_root,
                "DECISION-002",
                "SPEC-001",
                outcome,
                "2026-08-02T00:00:00Z",
            );

            assert!(
                !assert_matches_condition_script(root.path()).planner,
                "뒤에 {outcome}이 붙었는데 재작업 대상으로 남았다"
            );
        }
    }

    /// 반대 방향. 승인 뒤에 수정 요청이 오면 그것이 최신이고 재작업 대상이다.
    #[test]
    fn the_latest_decision_decides_whether_rework_is_pending() {
        let (root, workflow_root) = project();
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "approved",
            "2026-08-01T00:00:00Z",
        );
        write_decision(
            &workflow_root,
            "DECISION-002",
            "SPEC-001",
            "revision_requested",
            "2026-08-02T00:00:00Z",
        );

        assert!(assert_matches_condition_script(root.path()).planner);
    }

    /// 위임 대리 결정은 사용자의 수정 요청을 최신 자리에서 밀어내지 못한다. 앱의 읽기 경로가
    /// `created_by`를 `user`로 거른 목록 안에서만 `created_at`을 비교하므로, 스크립트의 기획자
    /// 분기도 비교 대상을 같은 값으로 걸러야 두 판정이 같은 답을 낸다(SPEC-030 R1·R3).
    #[test]
    fn a_delegate_approval_does_not_supersede_a_users_revision_request() {
        let (root, workflow_root) = project();
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "revision_requested",
            "2026-08-01T00:00:00Z",
        );
        write_decision_created_by(
            &workflow_root,
            "DECISION-002",
            "SPEC-001",
            "approved",
            "user-delegate",
            "2026-08-02T00:00:00Z",
        );

        assert!(assert_matches_condition_script(root.path()).planner);
    }

    /// 반대 방향. 대리 수정 요청은 앱이 아예 읽지 않으므로 기획자 일감이 아니다. 스크립트가 후보를
    /// 고를 때 `created_by`를 값 전체로 비교하지 않으면 여기서 갈린다(SPEC-030 R1·R3).
    #[test]
    fn a_revision_request_created_by_a_delegate_is_not_planner_work() {
        let (root, workflow_root) = project();
        write_decision_created_by(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "revision_requested",
            "user-delegate",
            "2026-08-01T00:00:00Z",
        );

        assert!(!assert_matches_condition_script(root.path()).planner);
    }

    /// 후속 판정 키는 결정 id다. 그 결정을 참조하는 것이 개발 작업뿐이면 대기가 유지된다.
    #[test]
    fn a_task_referencing_the_decision_does_not_answer_the_revision_request() {
        let (root, workflow_root) = project();
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "revision_requested",
            "2026-08-01T00:00:00Z",
        );
        write_task(
            &workflow_root,
            "TASK-001",
            "qa_waiting",
            Some("DECISION-001"),
        );

        assert!(assert_matches_condition_script(root.path()).planner);
    }

    /// 다른 결정을 참조하는 재작업 기획서는 이 결정을 닫지 않는다.
    #[test]
    fn a_follow_up_for_another_decision_leaves_the_request_open() {
        let (root, workflow_root) = project();
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "revision_requested",
            "2026-08-01T00:00:00Z",
        );
        write_rework_spec(&workflow_root, "SPEC-002", "DECISION-999", "draft");

        assert!(assert_matches_condition_script(root.path()).planner);
    }

    /// 선점 판정은 결정 id로 한다. 만료된 lease는 막지 않는다(SPEC-018 R4).
    #[test]
    fn a_lease_on_the_decision_hides_the_revision_request_until_it_expires() {
        for (expires_at, expected) in [(future(), false), (past(), true)] {
            let (root, workflow_root) = project();
            write_decision(
                &workflow_root,
                "DECISION-001",
                "SPEC-001",
                "revision_requested",
                "2026-08-01T00:00:00Z",
            );
            write_lease(root.path(), "DECISION-001", &expires_at);

            assert_eq!(
                assert_matches_condition_script(root.path()).planner,
                expected,
                "lease 만료 시각 {expires_at}에서 결과가 어긋난다"
            );
        }
    }

    /// QA 결정도 `revision_requested`를 쓰지만 기획자 판정을 깨우면 안 된다. 스키마와 `spec_id`가
    /// 그것을 거른다.
    #[test]
    fn a_task_qa_revision_request_is_not_planner_work() {
        let (root, workflow_root) = project();
        write_qa_decision(
            &workflow_root,
            "DECISION-001",
            "TASK-001",
            "2026-08-01T00:00:00Z",
        );

        assert!(!assert_matches_condition_script(root.path()).planner);
    }

    /// 미처리 아이디어가 있으면 수정 요청 유무와 무관하게 대기가 있다.
    #[test]
    fn an_unprocessed_idea_is_planner_work_next_to_a_revision_request() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_decision(
            &workflow_root,
            "DECISION-001",
            "SPEC-001",
            "revision_requested",
            "2026-08-01T00:00:00Z",
        );
        write_rework_spec(&workflow_root, "SPEC-002", "DECISION-001", "draft");

        assert!(assert_matches_condition_script(root.path()).planner);
    }

    /// 기획서 완료 조건 7. `draft` 기획서 하나만 아이디어를 참조하고 그 아이디어를 덮는 미만료
    /// lease가 없으면, 멈춘 기획 작업이므로 그 아이디어는 다시 기획자 대상이다(SPEC-035 R2).
    ///
    /// TASK-086이 세운 짝(`draft` 참조는 아이디어를 닫는다)을 이 작업이 뒤집은 자리다. 지우지 않고
    /// 기대값을 뒤집는 이유는 이 픽스처가 회수 규칙이 실제로 사는 자리이기 때문이다 — 파생 상태
    /// `drafting`을 지름길로 쓰면 여기서 스크립트와 갈라진다. 닫히는 쪽은 아래
    /// `an_idea_claimed_by_a_reviewed_spec_is_not_planner_work`가 본다.
    #[test]
    fn an_idea_claimed_only_by_a_draft_spec_is_planner_work_again() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_spec_with_status(&workflow_root, "SPEC-001", "IDEA-001", "draft");

        assert!(assert_matches_condition_script(root.path()).planner);
    }

    /// 기획서 완료 조건 8. 인수 세션이 그 아이디어를 선점하면 대상에서 빠진다. 선점 대상은 지금과
    /// 같은 아이디어 id이고, 기획서 문서가 새로운 선점 대상이 되지 않는다(SPEC-035 R2).
    #[test]
    fn a_leased_idea_claimed_only_by_a_draft_spec_is_not_planner_work() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_spec_with_status(&workflow_root, "SPEC-001", "IDEA-001", "draft");
        write_lease(root.path(), "IDEA-001", &future());

        assert!(!assert_matches_condition_script(root.path()).planner);
    }

    /// 기획서 완료 조건 9·14. 참조 기획서 중 하나가 `user_review`이면 그 아이디어는 대상이 아니다 —
    /// R2가 요구하는 것은 "**모두** `draft`"다. 멈춘 것은 아이디어가 아니라 재작업이고, 그 재작업의
    /// 원천인 수정 요청 결정이 회수 대상이 된다.
    ///
    /// 아이디어 파생 상태는 이 픽스처에서 `drafting`이다(SPEC-012 R2의 "하나라도 `draft`"). 그런데도
    /// 두 판정이 모두 "대상 없음"을 내는 것이 앱 이식본이 파생 상태를 지름길로 쓰지 않았다는 증거다
    /// (완료 조건 14). 그래서 상태값을 여기서 함께 단언한다 — 상태가 `drafting`이 아니게 되면 이
    /// 시나리오는 증명하려던 것을 더 이상 증명하지 못한다.
    #[test]
    fn an_idea_claimed_by_a_reviewed_spec_is_not_planner_work() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_spec_with_status(&workflow_root, "SPEC-001", "IDEA-001", "user_review");
        write_spec_with_status(&workflow_root, "SPEC-002", "IDEA-001", "draft");

        let derived = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project")
            .workflows[0]
            .items
            .ideas
            .iter()
            .find(|idea| idea.id == "IDEA-001")
            .expect("IDEA-001")
            .status
            .clone();

        assert_eq!(derived, "drafting");
        assert!(!assert_matches_condition_script(root.path()).planner);
    }

    // ── SPEC-049 R1. 넓어진 답 ────────────────────────────────────────────────────────────
    //
    // 위 시나리오는 대부분 후보가 하나뿐이라 "여럿 중 어느 것이 대상인가"를 묻지 못한다. 아래 셋은
    // 역할마다 후보를 여럿 두고, 그중 일부를 서로 다른 사유로 제외한 상태에서 대상과 목록을
    // 고정한다(기획서 완료 조건 2·4). 조건 스크립트와의 대조는 대조 헬퍼가 함께 한다.

    /// 대조를 거친 뒤 넓어진 판정을 그대로 돌려준다. 대상과 후보 목록을 시나리오가 직접 읽어야 할
    /// 때 쓴다. 읽는 경로는 대조 헬퍼와 같은 조회 하나다.
    fn detail_matching_condition_script(project_root: &Path) -> PendingRoleWorkDetail {
        assert_matches_condition_script(project_root);
        FileSystemProjectRepository
            .inspect(project_root)
            .expect("inspect project")
            .pending_detail
    }

    /// 기획자 후보 셋. 첫째는 비-`draft` 기획서가 참조하고 둘째는 선점됐으므로 셋째가 대상이다.
    #[test]
    fn the_planner_answer_names_the_target_and_why_the_earlier_ideas_were_excluded() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_idea(&workflow_root, "IDEA-002");
        write_idea(&workflow_root, "IDEA-003");
        write_spec(&workflow_root, "SPEC-001", "IDEA-001");
        write_lease(root.path(), "IDEA-002", &future());

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.planner.target.as_deref(), Some("IDEA-003"));
        assert_eq!(
            candidate_lines(&detail.planner),
            [
                "spec-exists IDEA-001",
                "leased IDEA-002",
                "eligible IDEA-003",
            ]
        );
    }

    /// 아키텍트 후보 셋. 첫째는 이미 분해됐고 둘째는 그 기획서가 선점됐으므로 셋째가 대상이다.
    #[test]
    fn the_architect_answer_names_the_target_and_why_the_earlier_approvals_were_excluded() {
        let (root, workflow_root) = project();
        for (id, spec_id) in [
            ("DECISION-A01", "SPEC-001"),
            ("DECISION-A02", "SPEC-002"),
            ("DECISION-A03", "SPEC-003"),
        ] {
            write_decision(
                &workflow_root,
                id,
                spec_id,
                "approved",
                "2026-08-01T00:00:00Z",
            );
        }
        write_task(
            &workflow_root,
            "TASK-001",
            "qa_waiting",
            Some("DECISION-A01"),
        );
        write_lease(root.path(), "SPEC-002", &future());

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.architect.target.as_deref(), Some("DECISION-A03"));
        assert_eq!(
            candidate_lines(&detail.architect),
            [
                "decomposed DECISION-A01",
                "spec-leased DECISION-A02",
                "eligible DECISION-A03",
            ]
        );
    }

    /// 개발자 후보 넷. 셋이 서로 다른 사유로 빠지고 넷째가 대상이다. 잡힌 lease 하나가 첫째를
    /// 선점으로, 셋째를 겹침으로 막는다.
    #[test]
    fn the_developer_answer_names_the_target_and_why_the_earlier_tasks_were_excluded() {
        let (root, workflow_root) = project();
        write_task_with_scope(&workflow_root, "TASK-001", "todo", "[src/shared.rs]");
        write_task_with_declaration(&workflow_root, "TASK-002", "todo", "[TASK-404]");
        write_task_with_scope(&workflow_root, "TASK-003", "todo", "[src/shared.rs]");
        write_task_with_scope(&workflow_root, "TASK-004", "todo", "[src/four.rs]");
        write_lease(root.path(), "TASK-001", &future());

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.developer.target.as_deref(), Some("TASK-004"));
        assert_eq!(
            candidate_lines(&detail.developer),
            [
                "leased TASK-001",
                "dependencies-unsatisfied TASK-002",
                "overlap TASK-003",
                "eligible TASK-004",
            ]
        );
    }

    /// 대상이 없으면 목록이 그 역할이 본 후보 전부다. 위 개발자 픽스처에서 대상 하나만 뺀 것이고,
    /// 남은 셋의 사유는 그대로다.
    #[test]
    fn a_role_without_a_target_still_answers_why_every_candidate_was_excluded() {
        let (root, workflow_root) = project();
        write_task_with_scope(&workflow_root, "TASK-001", "todo", "[src/shared.rs]");
        write_task_with_declaration(&workflow_root, "TASK-002", "todo", "[TASK-404]");
        write_task_with_scope(&workflow_root, "TASK-003", "todo", "[src/shared.rs]");
        write_lease(root.path(), "TASK-001", &future());

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail.developer.target, None);
        assert_eq!(
            candidate_lines(&detail.developer),
            [
                "leased TASK-001",
                "dependencies-unsatisfied TASK-002",
                "overlap TASK-003",
            ]
        );
    }

    /// 후보를 보는 차례는 파일 이름 순이다. 목록 화면의 정렬(`updated_at` 내림차순)을 쓰면 여기서
    /// 대상이 갈린다 — 두 작업의 `updated_at`이 그 정렬에서 서로를 앞지르도록 픽스처를 세운다.
    #[test]
    fn the_target_follows_file_name_order_not_the_list_order() {
        let (root, workflow_root) = project();
        write_task_updated_at(&workflow_root, "TASK-001", "todo", "2026-08-01T00:00:00Z");
        write_task_updated_at(&workflow_root, "TASK-002", "todo", "2026-08-09T00:00:00Z");

        let detail = detail_matching_condition_script(root.path());

        // 목록에서는 `TASK-002`가 앞에 온다. 판정은 그 정렬을 쓰지 않는다.
        let listed = FileSystemProjectRepository
            .inspect(root.path())
            .expect("inspect project")
            .workflows[0]
            .items
            .tasks
            .first()
            .expect("첫 항목")
            .id
            .clone();
        assert_eq!(listed, "TASK-002");
        assert_eq!(detail.developer.target.as_deref(), Some("TASK-001"));
    }

    /// 마이그레이션 락은 후보를 하나도 내지 않는다. 스크립트도 분기에 들어가기 전에 끝난다.
    #[test]
    fn a_migration_lock_answers_with_no_candidate_at_all() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_task(&workflow_root, "TASK-001", "todo", None);
        let runtime = root.path().join(".workflow/.runtime");
        fs::create_dir_all(&runtime).expect("runtime root");
        fs::write(runtime.join("migration.lock"), "").expect("migration lock");

        let detail = detail_matching_condition_script(root.path());

        assert_eq!(detail, PendingRoleWorkDetail::default());
    }

    #[test]
    fn a_lease_blocks_the_same_id_in_every_workflow() {
        let items = crate::domain::project::WorkflowItems::default();
        let approved = [("DECISION-001".to_owned(), "SPEC-001".to_owned())];
        let unsatisfied = HashSet::new();
        let overlapped = HashSet::new();
        let nondraft_sources = HashSet::new();
        let definition_errors = HashSet::new();
        let workflows = [super::WorkflowInput {
            directory: "wf-demo",
            items: &items,
            approved_decisions: &approved,
            task_revision_requests: &[],
            definition_error_tasks: &definition_errors,
            revision_requested_decisions: &[],
            unsatisfied_dependencies: &unsatisfied,
            overlap_blocked: &overlapped,
            nondraft_spec_sources: &nondraft_sources,
        }];
        let mut leases = HashSet::new();
        leases.insert("SPEC-001".to_owned());

        let blocked = super::pending_role_work(false, &leases, &workflows).architect;
        assert_eq!(blocked.target, None);
        assert_eq!(
            blocked.candidates,
            vec![WorkCandidate {
                id: "DECISION-001".to_owned(),
                verdict: "spec-leased".to_owned(),
            }]
        );

        let open = super::pending_role_work(false, &HashSet::new(), &workflows).architect;
        assert_eq!(open.target.as_deref(), Some("DECISION-001"));
    }
}
