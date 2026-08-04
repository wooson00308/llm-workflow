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

use crate::domain::project::{PendingRoleWork, WorkflowItems};

/// 워크플로우 하나의 판정 재료. 스크립트가 워크플로우 하나 안에서 아이디어↔기획서, 결정↔작업을
/// 대조하므로 짝짓기는 이 단위를 넘지 않는다.
pub struct WorkflowInput<'a> {
    pub items: &'a WorkflowItems,
    /// 이 워크플로우의 `outcome: approved` 결정 중 같은 기획서에 더 늦은 결정이 없는 것.
    /// `(결정 id, spec_id)`다(SPEC-028 R4). 최신 판정을 여기서 다시 하지 않는 것은
    /// `revision_requested` 쪽과 같은 이유다 — 판정 규칙이 한 벌이어야 하고, 그 판정에 필요한
    /// `created_at`은 목록 payload에 실리지 않는다.
    pub approved_decisions: &'a [(String, String)],
    /// 같은 기획서에 더 늦은 결정이 없는 `outcome: revision_requested` 결정의 id(SPEC-018 R1).
    pub revision_requested_decisions: &'a [String],
    /// 선행 선언이 미충족인 작업의 id(SPEC-013 R2). 선언을 여기서 다시 파싱하지 않는 것은 판정
    /// 규칙이 한 벌이어야 하기 때문이다 — 판정은 `fs_project_repository`가 하고 이 모듈은 결과만
    /// 받는다. 목록 payload(`WorkflowItemSummary`)는 선언을 싣지 않으므로 별도 값으로 온다.
    pub unsatisfied_dependencies: &'a HashSet<String>,
    /// 겹침 선언이 활성 lease와 충돌해 착수가 막힌 작업의 id(SPEC-032 R2). 선행 선언과 같은
    /// 이유로 여기서 다시 판정하지 않는다 — lease 파일도 작업 문서도 이 모듈은 읽지 않는다.
    pub overlap_blocked: &'a HashSet<String>,
}

/// `lease_ids`는 만료 전인 lease 파일 이름 집합이다. 스크립트도 만료된 lease를 선점으로 세지
/// 않으므로, 죽은 세션이 남긴 lease는 어느 역할에서도 그 대상을 막지 않는다.
pub fn pending_role_work(
    migration_locked: bool,
    lease_ids: &HashSet<String>,
    workflows: &[WorkflowInput<'_>],
) -> PendingRoleWork {
    // 스크립트 첫 줄: `[ -f ".workflow/.runtime/migration.lock" ] && exit 1`.
    if migration_locked {
        return PendingRoleWork::default();
    }

    PendingRoleWork {
        planner: workflows
            .iter()
            .any(|workflow| has_planner_work(workflow, lease_ids)),
        architect: workflows
            .iter()
            .any(|workflow| has_architect_work(workflow, lease_ids)),
        developer: workflows
            .iter()
            .any(|workflow| has_developer_work(workflow, lease_ids)),
    }
}

/// 스크립트 `planner)` 절. 둘 중 하나라도 있으면 대기 물량이 있다(SPEC-018 R1).
///
/// (가) 어떤 기획서도 참조하지 않는 아이디어 중 선점되지 않은 것. 파생 상태 `inbox`가 정확히 그
/// 경우다 — 참조 기획서가 있으면 `drafting`이거나 `adopted`이고, 스크립트도 참조가 있으면 건너뛴다.
/// `!= "adopted"`로 두면 `draft` 기획서가 참조하는 아이디어(`drafting`)에서 스크립트와 갈라진다.
///
/// (나) 후속 기획서가 없고 선점되지 않은 최신 `revision_requested` 결정. 후속 판정 키는 결정 id다 —
/// 한 기획서가 여러 번 반려되면 결정마다 후속이 하나씩 생기므로 기획서 id로는 구분되지 않는다.
/// 후속 기획서의 `status`와 그 뒤에 붙은 결정은 보지 않는다.
fn has_planner_work(workflow: &WorkflowInput<'_>, lease_ids: &HashSet<String>) -> bool {
    let unprocessed_idea = workflow
        .items
        .ideas
        .iter()
        .any(|idea| idea.status == "inbox" && !lease_ids.contains(&idea.id));
    let unanswered_revision =
        workflow
            .revision_requested_decisions
            .iter()
            .any(|decision_id| {
                !lease_ids.contains(decision_id)
                    && !workflow.items.specs.iter().any(|spec| {
                        spec.source_decision_id.as_deref() == Some(decision_id.as_str())
                    })
            });
    unprocessed_idea || unanswered_revision
}

/// 스크립트 `architect)` 절: 그 기획서의 최신 결정인 승인 중 파생 작업이 없고 `spec_id`로 lease가
/// 없는 것. 최신 판정과 `created_by: user` 필터는 이 함수에 오기 전에 끝난다 — 앞의 것은
/// `latest_approvals`가, 뒤의 것은 결정 문서를 읽는 `read_spec_decisions`가 한다. 스크립트도 같은
/// 두 판정을 `architect)` 분기 안에서 한다(SPEC-028 R4·R5).
///
/// 최신이 아닌 승인은 여기 오지 않는다. 그래서 승인 뒤에 수정 요청이 붙은 기획서는 그 승인에서
/// 작업이 파생되지 않았어도 아키텍트 대기 물량이 아니다. 역할 계약의 "The latest app-owned decision
/// must be `approved`"가 그것을 요구한다.
fn has_architect_work(workflow: &WorkflowInput<'_>, lease_ids: &HashSet<String>) -> bool {
    workflow
        .approved_decisions
        .iter()
        .any(|(decision_id, spec_id)| {
            // 스크립트도 `spec_id`가 비어 있으면 lease를 보지 않는다.
            if !spec_id.is_empty() && lease_ids.contains(spec_id) {
                return false;
            }
            !workflow
                .items
                .tasks
                .iter()
                .any(|task| task.source_decision_id.as_deref() == Some(decision_id.as_str()))
        })
}

/// 스크립트 `developer)` 절: `todo` 작업 중 그 id로 lease가 없고, 선행 선언이 충족됐고, 다른
/// 문서를 잡은 활성 lease와 겹치지 않는 것.
///
/// 네 조건은 개발자 계약의 자격 조건 그대로다. 선언을 보지 않던 동안에는 의존 미충족 `todo`만 남은
/// 저장소에서 스크립트가 1을, 이 모듈이 `true`를 냈다(SPEC-013 완료 조건 8).
///
/// 마지막 조건은 잡힌 lease가 있을 때만 개입한다. 활성 lease가 하나도 없으면 `overlap_blocked`가
/// 비어 있어 판정이 이 조건이 없던 때와 같다(SPEC-032 R9).
fn has_developer_work(workflow: &WorkflowInput<'_>, lease_ids: &HashSet<String>) -> bool {
    workflow.items.tasks.iter().any(|task| {
        task.status == "todo"
            && !lease_ids.contains(&task.id)
            && !workflow.unsatisfied_dependencies.contains(&task.id)
            && !workflow.overlap_blocked.contains(&task.id)
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;
    use std::path::{Path, PathBuf};

    use pretty_assertions::assert_eq;
    use tempfile::{tempdir, TempDir};

    use crate::domain::project::PendingRoleWork;
    use crate::infrastructure::fs_project_repository::FileSystemProjectRepository;
    use crate::infrastructure::heartbeat_condition::install_condition_script;
    use crate::infrastructure::heartbeat_condition::test_support::run_condition;

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

    /// 조회 결과의 판정과 스크립트의 종료 코드를 대조한다. 규칙만이 아니라 배선까지 고정한다.
    /// 스크립트 실행은 조건 스크립트 모듈의 공용 헬퍼가 한다 — 두 모듈이 다른 명령으로 부르면
    /// 대조의 뜻이 사라진다.
    fn assert_matches_condition_script(project_root: &Path) -> PendingRoleWork {
        let pending = FileSystemProjectRepository
            .inspect(project_root)
            .expect("inspect project")
            .pending_work;

        for (role, app_flag) in [
            ("planner", pending.planner),
            ("architect", pending.architect),
            ("developer", pending.developer),
        ] {
            assert_eq!(
                app_flag,
                run_condition(project_root, role).code == 0,
                "{role} 판정이 조건 스크립트와 다르다"
            );
        }
        pending
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
    /// 작업은 열리고, 미충족 선언은 lease가 사라져도 그대로 미충족이다.
    #[test]
    fn an_expired_lease_does_not_change_how_a_declaration_is_judged() {
        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "qa_waiting", None);
        write_task_with_declaration(&workflow_root, "TASK-002", "todo", "[TASK-001]");
        write_lease(root.path(), "TASK-002", &past());
        assert!(assert_matches_condition_script(root.path()).developer);

        let (root, workflow_root) = project();
        write_task(&workflow_root, "TASK-001", "in_progress", None);
        write_task_with_declaration(&workflow_root, "TASK-002", "todo", "[TASK-001]");
        write_lease(root.path(), "TASK-002", &past());
        assert!(!assert_matches_condition_script(root.path()).developer);
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

    /// 후속 기획서가 생기면 그 결정은 처리 완료다. 후속의 상태는 결과를 바꾸지 않는다.
    #[test]
    fn a_follow_up_spec_answers_the_revision_request_whatever_its_status() {
        for status in ["draft", "user_review"] {
            let (root, workflow_root) = project();
            write_decision(
                &workflow_root,
                "DECISION-001",
                "SPEC-001",
                "revision_requested",
                "2026-08-01T00:00:00Z",
            );
            write_rework_spec(&workflow_root, "SPEC-002", "DECISION-001", status);

            assert!(
                !assert_matches_condition_script(root.path()).planner,
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

    /// 파생 상태가 세 값이 된 뒤(SPEC-012)의 일치 복원. `draft` 기획서가 참조하는 아이디어는
    /// `drafting`이고, 스크립트도 참조가 있으면 건너뛴다. `!= "adopted"`로 두면 여기서 갈라진다.
    #[test]
    fn an_idea_claimed_by_a_draft_spec_is_not_planner_work() {
        let (root, workflow_root) = project();
        write_idea(&workflow_root, "IDEA-001");
        write_spec_with_status(&workflow_root, "SPEC-001", "IDEA-001", "draft");

        assert!(!assert_matches_condition_script(root.path()).planner);
    }

    #[test]
    fn a_lease_blocks_the_same_id_in_every_workflow() {
        let items = crate::domain::project::WorkflowItems::default();
        let approved = [("DECISION-001".to_owned(), "SPEC-001".to_owned())];
        let unsatisfied = HashSet::new();
        let overlapped = HashSet::new();
        let workflows = [super::WorkflowInput {
            items: &items,
            approved_decisions: &approved,
            revision_requested_decisions: &[],
            unsatisfied_dependencies: &unsatisfied,
            overlap_blocked: &overlapped,
        }];
        let mut leases = HashSet::new();
        leases.insert("SPEC-001".to_owned());

        assert!(!super::pending_role_work(false, &leases, &workflows).architect);
        assert!(super::pending_role_work(false, &HashSet::new(), &workflows).architect);
    }
}
