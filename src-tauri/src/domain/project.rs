use serde::{Deserialize, Serialize};

pub const PROJECT_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectManifest {
    pub schema_version: u32,
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub workflows: Vec<WorkflowEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowEntry {
    pub id: String,
    pub directory: String,
    pub name: String,
    pub status: WorkflowStatus,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowManifest {
    pub schema_version: u32,
    pub workflow_id: String,
    pub name: String,
    pub status: WorkflowStatus,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentLease {
    pub schema_version: u32,
    pub lease_id: String,
    pub agent: String,
    /// 선점 세션이 스스로 적은 역할. 계약상 선택 필드라 없을 수 있고, 없으면 `None`이다.
    /// `#[serde(default)]`가 없으면 이 키가 없는 기존 lease 파일이 파싱에 실패해 화면에서 사라진다.
    #[serde(default)]
    pub role: Option<String>,
    pub task_id: Option<String>,
    pub heartbeat_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStatus {
    Active,
    Archived,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub root_path: String,
    pub initialized: bool,
    pub project_id: Option<String>,
    pub name: String,
    pub compatibility: SchemaCompatibility,
    pub active_leases: Vec<AgentLeaseSummary>,
    pub workflows: Vec<WorkflowSummary>,
    pub pending_work: PendingRoleWork,
    /// 역할별 전체 후보와 판정. 화면은 이 값을 워크플로 항목과 조인해 사람용 대기열을 만든다.
    pub pending_detail: PendingRoleWorkDetail,
}

/// 역할별 대기 물량. 조건 스크립트가 그 역할로 종료 코드 0을 돌려주는 상태가 `true`다.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingRoleWork {
    pub planner: bool,
    pub architect: bool,
    pub developer: bool,
}

/// 세 역할의 넓어진 판정(SPEC-049 R1). 역할마다 대상 문서와 후보별 제외 사유를 함께 답한다.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingRoleWorkDetail {
    pub planner: RoleWorkVerdict,
    pub architect: RoleWorkVerdict,
    pub developer: RoleWorkVerdict,
}

impl PendingRoleWorkDetail {
    /// 화면에 실리는 payload. 대상이 있는 역할이 `true`이고, 그 뜻은 이 타입이 생기기 전과 같다.
    pub fn flags(&self) -> PendingRoleWork {
        PendingRoleWork {
            planner: self.planner.target.is_some(),
            architect: self.architect.target.is_some(),
            developer: self.developer.target.is_some(),
        }
    }
}

/// 역할 하나의 판정 결과.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoleWorkVerdict {
    /// 그 역할이 집어야 하는 문서의 id. 대상이 없으면 `None`이다.
    pub target: Option<String>,
    /// 고른 대상의 종류. 현재는 아키텍트 판정이 승인 결정과 작업 정의 수정 요청을
    /// 구분할 때만 채우며, 대상이 없으면 `None`이다.
    pub target_kind: Option<String>,
    /// 판정한 후보를 판정한 차례대로 담는다. 대상을 찾은 자리에서 판정이 멈추므로 그 뒤의 후보는
    /// 목록에 없다. 대상이 없을 때 이 목록은 그 역할이 본 후보 전부다.
    pub candidates: Vec<WorkCandidate>,
}

impl RoleWorkVerdict {
    /// 제외된 후보 하나를 사유와 함께 기록한다.
    pub fn exclude(&mut self, id: &str, reason: &'static str) {
        self.candidates.push(WorkCandidate {
            id: id.to_owned(),
            verdict: reason.to_owned(),
        });
    }

    /// 대상을 정하고 그 후보를 `eligible`로 기록한다.
    pub fn select(&mut self, id: &str) {
        self.candidates.push(WorkCandidate {
            id: id.to_owned(),
            verdict: ELIGIBLE.to_owned(),
        });
        if self.target.is_none() {
            self.target = Some(id.to_owned());
        }
    }

    /// 종류가 있는 대상을 고르고 그 후보를 `eligible`로 기록한다.
    pub fn select_kind(&mut self, id: &str, kind: &str) {
        let selected = self.target.is_none();
        self.select(id);
        if selected {
            self.target_kind = Some(kind.to_owned());
        }
    }
}

/// 후보 하나와 그 후보에 내려진 판정.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkCandidate {
    pub id: String,
    /// 대상이면 [`ELIGIBLE`], 아니면 제외 사유 코드. 조건 스크립트가 내는 코드와 같은 어휘를 쓴다.
    pub verdict: String,
}

/// 대상으로 뽑힌 후보의 판정값.
pub const ELIGIBLE: &str = "eligible";

/// 비-`draft` 기획서가 이미 참조하는 아이디어.
pub const SPEC_EXISTS: &str = "spec-exists";

/// 비-`draft` 후속 기획서가 이미 답한 수정 요청 결정.
pub const FOLLOW_UP_EXISTS: &str = "follow-up-exists";

/// 그 문서 자신을 덮는 미만료 lease가 있다.
pub const LEASED: &str = "leased";

/// 이미 작업으로 분해된 승인 결정.
pub const DECOMPOSED: &str = "decomposed";

/// 승인된 기획서를 덮는 미만료 lease가 있다.
pub const SPEC_LEASED: &str = "spec-leased";

/// 선행 선언이 미충족이거나 읽을 수 없다.
pub const DEPENDENCIES_UNSATISFIED: &str = "dependencies-unsatisfied";

/// 겹침 선언이 다른 문서를 잡은 미만료 lease와 충돌한다.
pub const OVERLAP: &str = "overlap";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub id: String,
    pub directory: String,
    pub name: String,
    pub status: WorkflowStatus,
    pub created_at: String,
    pub counts: WorkflowCounts,
    pub items: WorkflowItems,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCounts {
    pub ideas: usize,
    pub specs: usize,
    pub decisions: usize,
    pub tasks: usize,
    pub work_groups: usize,
    pub reports: usize,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowItems {
    pub ideas: Vec<WorkflowItemSummary>,
    pub specs: Vec<WorkflowItemSummary>,
    pub tasks: Vec<WorkflowItemSummary>,
    pub work_groups: Vec<WorkGroupSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowItemSummary {
    pub file_name: String,
    pub id: String,
    pub title: String,
    /// 문서의 상태. 아이디어에서는 파일 값이 아니라 조회 시점 파생값이며 `inbox`·`drafting`·
    /// `closed`·`adopted` 넷 중 하나다(SPEC-012 R1, SPEC-018 R6). `closed`는 참조 기획서가 모두
    /// 반려로 끝난 경우다. 앱은 판정 결과를 아이디어 파일에 쓰지 않는다.
    pub status: String,
    pub updated_at: Option<String>,
    pub due_at: Option<String>,
    /// 이 작업이 어떤 기획서에서 나왔는지. 아이디어·기획서에서는 항상 `None`이다.
    /// 보드가 이 값으로 작업을 기획서별 레인에 모은다(SPEC-029 R8).
    pub source_spec_id: Option<String>,
    /// 이 작업이 어떤 승인 결정에서 나왔는지. 아이디어·기획서에서는 항상 `None`이다.
    /// 앱은 이 참조로 "승인됐지만 아직 작업으로 분해되지 않은 결정"을 판정한다.
    pub source_decision_id: Option<String>,
    /// v2에서 작업이 속한 사용자 승인 단위. 아이디어·기획서에서는 항상 `None`이다.
    pub work_group_id: Option<String>,
    /// 작업이 만들어진 시점의 작업 그룹 revision. 그룹 재작업 이력을 섞지 않는다.
    pub work_group_revision: Option<u32>,
    /// 그룹 QA 반려 뒤 만들어진 수정 작업이 답하는 그룹 QA 결정 id.
    pub source_qa_decision_id: Option<String>,
    /// 중단 의심의 근거. 이 아이디어가 반영중인데 선점한 미만료 lease가 없을 때, 걸려 있는 `draft`
    /// 기획서의 문서 id다. 문서 id 오름차순이며 그 조합이 아니면 비어 있다. 비어 있지 않다는 것과
    /// 중단 의심은 같은 뜻이다(SPEC-012 R5). 기획서·개발 작업 항목에서는 항상 비어 있다.
    pub stalled_spec_ids: Vec<String>,
    /// 문서에 일어난 사실. 시각 오름차순이다. 개발 작업은 상태 전이, 기획서는 사용자 결정이
    /// 실리고 아이디어는 항상 비어 있다. `kind`의 뜻은 문서 종류에 따라 다르다 — 기획서의
    /// `revision_requested`는 "수정 요청"이고 개발 작업의 같은 값은 "반려"다.
    pub events: Vec<TaskEvent>,
    pub excerpt: String,
}

/// 개발 작업 프론트매터 `history`의 항목 하나. 전이 하나가 사실 하나다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub kind: String,
    /// 파일에 적힌 RFC3339 원문. 화면이 로컬 날짜로 바꾼다.
    pub at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkGroupStatus {
    Preparing,
    Active,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkGroupQaMode {
    User,
    Automatic,
}

/// 작업 그룹 문서와 현재 작업·결정을 합쳐 계산한 사용자 화면 상태.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkGroupDisplayStatus {
    Completed,
    Rework,
    Preparing,
    PreparingStalled,
    Blocked,
    Developing,
    QaReady,
    AutomaticCompleted,
    ConfigurationError,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkGroupQaScenario {
    pub id: String,
    pub title: String,
    /// 다음 `### QA-*` 절 전까지의 마크다운 원문. 화면은 개발 명령을 추출하지 않는다.
    pub body: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkGroupSummary {
    pub file_name: String,
    pub id: String,
    pub title: String,
    /// 문서 작성 상태. 화면 파생 상태와 구분한다.
    pub status: WorkGroupStatus,
    pub display_status: WorkGroupDisplayStatus,
    pub revision: u32,
    pub qa_mode: WorkGroupQaMode,
    pub source_spec_id: String,
    pub source_decision_id: String,
    pub source_qa_decision_id: Option<String>,
    pub updated_at: String,
    pub description: String,
    pub scenarios: Vec<WorkGroupQaScenario>,
    /// 이 그룹과 구성 버전의 품질 확인이 대상으로 고정한 기준 커밋 해시. 그룹이 품질 확인을 열 수
    /// 있는 상태가 된 시점에 한 번 고정되고 그 뒤로 바뀌지 않는다. 프로젝트가 Git 작업 트리가
    /// 아니면 `None`이며, 그 경우 그룹 상태 계산과 제출 판정은 고정 값이 없던 때와 같이 동작한다.
    pub qa_base_commit: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpecDocument {
    pub summary: WorkflowItemSummary,
    pub body: String,
}

/// 선언된 선행 작업 하나의 판정 결과(SPEC-013 R2).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskDependencyState {
    /// 선행 작업이 AI 구현·자동검증을 마친 `verified`다.
    Satisfied,
    /// 선행 작업이 아직 그 상태에 이르지 못했다. 시간이 지나면 풀릴 수 있다.
    Pending,
    /// 그 id의 개발 작업 문서가 이 워크플로우에 없다. 영원히 충족되지 않는다.
    Missing,
    /// 선언을 따라가면 자기 자신으로 돌아온다. 영원히 충족되지 않는다.
    Cyclic,
}

/// 작업 하나가 선언한 선행 작업 하나.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDependency {
    pub id: String,
    pub state: TaskDependencyState,
}

/// 활성 lease 하나가 이 작업의 착수를 막는 근거(SPEC-032 R7).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskOverlapBlock {
    /// lease가 잡은 문서 id. 활동 뷰의 카드가 쓰는 값과 같다.
    pub lease_target_id: String,
    /// 두 선언이 함께 가리킨 경로. 선언에 적힌 문자열 그대로이고 오름차순·중복 없음이다.
    /// 선언 부재나 형식 오류로 막힌 경우 비어 있다.
    pub shared_files: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskScopeStatus {
    Declared,
    Absent,
    Malformed,
}

/// 작업 상세가 현재 `scope_files` 선언을 추측 없이 보여 주기 위한 값.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskScopeDeclaration {
    pub status: TaskScopeStatus,
    /// 선언에 적힌 순서와 문자열 그대로다. 부재·형식 오류에서는 비어 있다.
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDocument {
    pub summary: WorkflowItemSummary,
    pub body: String,
    /// 선언된 선행 작업과 각각의 판정 결과. 선언이 없거나 형식 오류면 비어 있다.
    pub dependencies: Vec<TaskDependency>,
    /// 선언 줄이 계약 형식이 아니어서 목록으로 읽지 못했는가(SPEC-013 R3). 참이면 `dependencies`는
    /// 비어 있고 이 작업은 미충족이다.
    pub dependency_format_error: bool,
    /// 이 작업의 착수를 막고 있는 활성 lease와 그 근거(SPEC-032 R7). 비어 있으면 막히지 않은
    /// 것이다. 자기 자신을 잡은 lease는 담지 않는다 — 그것은 겹침이 아니라 자기 선점이다.
    pub overlap_blocks: Vec<TaskOverlapBlock>,
    /// 정상 목록, 선언 부재, 형식 오류를 서로 다른 상태로 싣는다.
    pub scope_declaration: TaskScopeDeclaration,
    /// 이 작업에 남은 사용자 수정 요청. 생성 시각 오름차순이고, 요청이 없으면 비어 있다.
    pub revision_requests: Vec<TaskRevisionRequest>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IdeaDocument {
    pub summary: WorkflowItemSummary,
    pub body: String,
}

/// 보고서 파일 하나의 목록 항목. 보고서에는 앞머리 메타데이터가 없고 파일 이름이 유일한 식별
/// 수단이므로, 다른 문서 요약이 싣는 id·상태·전이는 담지 않는다. 없는 사실을 지어내지 않기 위해
/// 필드를 두 개로 묶어 둔다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowReportSummary {
    pub file_name: String,
    /// 본문 제목. 찾지 못하면 파일 이름의 줄기를 그대로 쓴다.
    pub title: String,
}

/// 보고서 하나의 읽기 전용 전문. 본문은 파일에 적힌 그대로이고 앱이 다듬지 않는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReportDocument {
    pub summary: WorkflowReportSummary,
    pub body: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecDecisionOutcome {
    Approved,
    RevisionRequested,
    Rejected,
}

#[cfg(test)]
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskQaOutcome {
    Confirmed,
    RevisionRequested,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkGroupQaOutcome {
    Confirmed,
    RevisionRequested,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkGroupQaSubmission {
    pub workflow_directory: String,
    pub file_name: String,
    pub expected_revision: u32,
    pub expected_updated_at: String,
    pub request_id: String,
    pub entries: Vec<WorkGroupQaSubmissionEntry>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkGroupQaSubmissionEntry {
    pub scenario_id: String,
    pub outcome: WorkGroupQaOutcome,
    pub comment: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkGroupQaSubmissionStatus {
    Recorded,
    AlreadyRecorded,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkGroupQaSubmissionResult {
    pub summary: ProjectSummary,
    pub decision_file_name: String,
    pub group_id: String,
    pub group_revision: u32,
    pub outcome: WorkGroupQaOutcome,
    pub status: WorkGroupQaSubmissionStatus,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskQaBatchResult {
    pub summary: ProjectSummary,
    /// 요청 순서 그대로. 화면이 목록과 나란히 읽는다.
    pub results: Vec<TaskQaBatchEntry>,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskQaBatchEntry {
    pub file_name: String,
    /// 문서를 읽지 못하면 `None`. 추정으로 채우지 않는다.
    pub task_id: Option<String>,
    pub recorded: bool,
    /// 실패 사유. 성공이면 `None`.
    pub message: Option<String>,
}

/// 작업별 결과와 메모를 한 번에 싣는 품질 확인 제출. 기존 일괄 통로는 확인 완료만 보내고 메모도 전
/// 건이 하나를 공유하는데, 이 요청은 항목마다 결과와 메모를 따로 나른다.
#[cfg(test)]
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskQaSubmission {
    pub workflow_directory: String,
    /// 화면이 보낸 순서 그대로. 결과 목록도 같은 순서로 돌아온다.
    pub entries: Vec<TaskQaSubmissionEntry>,
}

#[cfg(test)]
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskQaSubmissionEntry {
    pub file_name: String,
    pub outcome: TaskQaOutcome,
    /// 이 작업에만 붙는 메모. 다른 항목의 메모와 섞이지 않는다.
    pub comment: String,
    /// 사용자가 검토를 시작할 때 읽은 작업 문서의 `updated_at` 원문. 문자 단위로 같아야 기록한다.
    pub expected_updated_at: String,
}

/// 항목 하나가 기록되지 못한 까닭. 화면이 "다시 확인해야 한다"와 "기록에 실패했다"를 가르는 값이라
/// 사유 문자열과 따로 싣는다.
#[cfg(test)]
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskQaSubmissionFailure {
    /// 검토를 시작한 뒤 작업 문서가 바뀌었다.
    Stale,
    /// 작업이 더 이상 품질 확인 대기 상태가 아니다.
    NotAwaitingQa,
    /// 그 밖의 기록 실패.
    RecordFailed,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskQaSubmissionEntryResult {
    pub file_name: String,
    /// 문서를 읽지 못하면 `None`. 추정으로 채우지 않는다.
    pub task_id: Option<String>,
    pub recorded: bool,
    /// 실패 종류. 성공이면 `None`.
    pub failure: Option<TaskQaSubmissionFailure>,
    /// 실패 사유. 성공이면 `None`.
    pub message: Option<String>,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskQaSubmissionResult {
    pub summary: ProjectSummary,
    /// 요청 순서 그대로. 화면이 목록과 나란히 읽는다.
    pub results: Vec<TaskQaSubmissionEntryResult>,
}

/// 잘못 분해된 작업을 고쳐 달라는 사용자 요청(SPEC-055 R2). 앱 UI의 사용자 조작만 이 요청을 만든다.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRevisionRequestInput {
    pub workflow_directory: String,
    pub file_name: String,
    /// 사용자가 화면에서 확인한 작업 문서의 `updated_at` 원문. 문자 단위로 같아야 기록한다.
    pub expected_updated_at: String,
    /// 사용자가 적은 요청 이유. 앱은 이 문장을 대신 지어내지 않는다.
    pub reason: String,
    /// 같은 요청을 한 번만 기록하기 위한 요청 식별자. 재시도는 같은 값을 다시 보낸다.
    pub request_id: String,
}

/// 요청 저장의 결말. 새 기록을 만든 경우와 이미 있는 미처리 요청 때문에 만들지 않은 경우를 가른다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskRevisionRequestStatus {
    /// 이번 호출이 기록을 남겼거나, 같은 요청 식별자의 기록이 이미 있어 그것을 그대로 돌려준다.
    Recorded,
    /// 같은 작업에 아직 처리되지 않은 요청이 있어 새 기록을 만들지 않았다.
    AlreadyPending,
}

/// 작업 하나에 남은 수정 요청 한 건. 조회가 생성 시각 순서로 싣는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRevisionRequest {
    pub id: String,
    /// 요청 당시 사용자가 확인한 작업 갱신 시각.
    pub previous_updated_at: String,
    /// 사용자가 적은 이유 원문.
    pub reason: String,
    pub created_at: String,
    /// 작업 문서가 이 요청의 id를 연결하고 있는가. 앱은 다른 근거로 처리 여부를 추측하지 않는다.
    pub handled: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRevisionRequestResult {
    pub status: TaskRevisionRequestStatus,
    /// 요청 저장 뒤 다시 계산한 프로젝트 요약.
    pub summary: ProjectSummary,
    /// 이번에 남았거나 이미 남아 있던 요청. 판정에 걸려 아무것도 쓰지 않은 경우에도 현재 사실을 싣는다.
    pub request: Option<TaskRevisionRequest>,
}

/// 막힌 작업을 사용자 판단으로 다시 여는 요청(SPEC-054 R8). 앱 UI의 사용자 조작만 이 요청을 만든다.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskResumeRequest {
    pub workflow_directory: String,
    pub file_name: String,
    /// 사용자가 화면에서 확인한 작업 문서의 `updated_at` 원문. 문자 단위로 같아야 재개한다.
    pub expected_updated_at: String,
    /// 사용자가 입력한 해결 근거. 앱은 이 문장을 대신 지어내지 않는다.
    pub resolution: String,
    /// 같은 재개를 한 번만 기록하기 위한 요청 식별자. 재시도는 같은 값을 다시 보낸다.
    pub request_id: String,
}

/// 재개 요청의 결말. 두 기록 중 하나만 남은 결과는 `Resumed`가 아니다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskResumeStatus {
    /// 상태 전이와 감사 기록이 함께 남았다. 같은 요청 식별자의 재시도도 이 값이다.
    Resumed,
    /// 감사 기록만 남고 작업 문서 교체가 실패했으며 되돌리기까지 실패했다. 사용자가 손으로
    /// 치워야 할 파일이 있으므로 `recovery`를 함께 싣는다.
    RecoveryRequired,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskResumeResult {
    pub status: TaskResumeStatus,
    /// 재개 뒤 다시 계산한 프로젝트 요약. 개발자 자격 판정도 이 값에서 다시 나온다.
    pub summary: ProjectSummary,
    /// `RecoveryRequired`에서만 채운다.
    pub recovery: Option<TaskResumeRecovery>,
}

/// 되돌리지 못하고 남은 파일과 사용자가 해야 할 행동.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskResumeRecovery {
    pub created_paths: Vec<String>,
    pub reason: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentLeaseSummary {
    pub lease_id: String,
    pub agent: String,
    /// lease 파일의 `role` 원문. 앱은 값을 검사하지 않는다. 계약을 어긴 세션을 드러내는 것이
    /// 이 값을 그리는 화면의 목적이라, 모르는 값을 걸러 내면 그 사실이 사라진다.
    pub role: Option<String>,
    pub task_id: Option<String>,
    /// lease 파일의 `heartbeat_at` 원문(RFC3339). 최초 시작 시각이 아니다. 화면이 로컬로 바꾼다.
    pub heartbeat_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SchemaCompatibility {
    NotInitialized,
    Current,
    MigrationRequired,
    FutureSchema,
}

/// 앱이 제공하는 관리 자산 동기화의 전체 결과.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedAssetSyncStatus {
    Current,
    Updated,
    RetryRequired,
    Conflict,
}

/// 관리 자산 하나의 사전 검사 또는 동기화 상태.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ManagedAssetStatus {
    Current,
    UpdateRequired,
    Updated,
    RetryRequired,
    Conflict,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAssetState {
    pub id: String,
    pub label: String,
    pub status: ManagedAssetStatus,
    pub installed_version: Option<u32>,
    pub provided_version: Option<u32>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAssetRollbackFailure {
    pub asset_id: String,
    pub label: String,
    pub reason: String,
    pub recovery_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAssetRollbackRecovery {
    pub asset_id: String,
    pub label: String,
    pub recovery_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAssetSyncResult {
    pub status: ManagedAssetSyncStatus,
    pub assets: Vec<ManagedAssetState>,
    pub updated_assets: Vec<String>,
    pub reason: Option<String>,
    pub affected_asset: Option<String>,
    pub rollback_failures: Vec<ManagedAssetRollbackFailure>,
    pub rollback_recoveries: Vec<ManagedAssetRollbackRecovery>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CustomRuleRole {
    Planner,
    Architect,
    Developer,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CustomRulesFileStatus {
    Absent,
    Valid,
    Invalid,
    FutureSchema,
    UnsafeFile,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomRulesDocument {
    pub status: CustomRulesFileStatus,
    pub enabled: bool,
    pub applies_to: Vec<CustomRuleRole>,
    pub body: String,
    pub updated_at: Option<String>,
    pub modified_at: Option<String>,
    pub raw: Option<String>,
    pub content_hash: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomRulesDraft {
    pub enabled: bool,
    pub applies_to: Vec<CustomRuleRole>,
    pub body: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CustomRulesSourceKind {
    WorkflowRules,
    RoleContract,
    UserRules,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomRulesSourcePreview {
    pub kind: CustomRulesSourceKind,
    pub label: String,
    pub order: u8,
    pub content: String,
    pub applied: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomRulesRolePreview {
    pub role: CustomRuleRole,
    pub sources: Vec<CustomRulesSourcePreview>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomRulesPreview {
    pub draft: CustomRulesDraft,
    pub serialized: String,
    pub updated_at: String,
    pub preview_hash: String,
    pub priority_notice: String,
    pub roles: Vec<CustomRulesRolePreview>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveCustomRulesRequest {
    pub expected_content_hash: Option<String>,
    pub draft: CustomRulesDraft,
    pub updated_at: String,
    pub preview_hash: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SaveCustomRulesStatus {
    Saved,
    Conflict,
    RetryRequired,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveCustomRulesResult {
    pub status: SaveCustomRulesStatus,
    pub document: CustomRulesDocument,
    pub reason: Option<String>,
}

/// 연동 공통 설치 상태. 값은 미설치·설치됨 두 개뿐이다.
///
/// 연동별 부가 상태(하트비트의 데몬 실행 여부, dream의 선행 조건)는 이 타입에 넣지 않고
/// 위에 얹는다. 세 번째 연동이 와도 이 타입은 고치지 않는다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationInstallation {
    NotInstalled,
    Installed,
}

/// 하트비트 연동 상태 조회 결과. 전부 읽기 전용 판정이다.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatStatus {
    pub installation: HeartbeatInstallation,
    pub roles: Vec<HeartbeatRoleStatus>,
    pub duplicate_jobs: Vec<DuplicateHeartbeatJob>,
    /// 대상 경로가 있는데 읽지 못한 경우만 담는다. 파일이 없는 것은 실패가 아니다.
    pub read_failures: Vec<HeartbeatReadFailure>,
}

/// 하트비트 연동의 설치 상태. 공통 설치 상태 위에 데몬 실행 여부를 얹은 것이다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatInstallationStatus {
    pub installation: IntegrationInstallation,
    /// 데몬 실행 여부는 pid 파일 존재로만 판정한다. 프로세스 생존은 확인하지 않는다.
    pub daemon_running: bool,
}

impl HeartbeatInstallationStatus {
    /// SPEC-002 화면이 쓰는 세 값으로 접는다. 조합에 없는 상태(미설치인데 데몬 실행 중)는
    /// 판정상 생기지 않으므로 미설치로 본다.
    pub const fn collapse(self) -> HeartbeatInstallation {
        match (self.installation, self.daemon_running) {
            (IntegrationInstallation::NotInstalled, _) => HeartbeatInstallation::NotInstalled,
            (IntegrationInstallation::Installed, false) => {
                HeartbeatInstallation::InstalledDaemonStopped
            }
            (IntegrationInstallation::Installed, true) => {
                HeartbeatInstallation::InstalledDaemonRunning
            }
        }
    }
}

/// 하트비트 카드가 지금 쓰는 세 값. `HeartbeatInstallationStatus`의 조합을 접은 표현이며,
/// 화면이 공통 표현을 직접 쓰게 되면 사라진다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HeartbeatInstallation {
    NotInstalled,
    InstalledDaemonStopped,
    InstalledDaemonRunning,
}

/// 설치 마법사가 보여주는 단계 하나(SPEC-016). 접혀 있던 설치 판정을 단계로 펼친 값이며,
/// `HeartbeatInstallation`을 대체하지 않고 그 옆에 실린다(R1).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatSetupStage {
    pub step: HeartbeatSetupStep,
    pub state: HeartbeatSetupState,
    /// 1~3은 참, dream은 거짓(R9). 선택 단계가 미완료여도 마법사는 접힌다.
    pub required: bool,
    /// 앱이 이 단계를 대신 실행할 수 있는가(SPEC-037 R2). 명령을 소유한 쪽이 백엔드이므로
    /// "이 단계를 앱이 실행할 수 있는가"도 백엔드가 답한다 — 화면이 단계 종류를 보고 스스로
    /// 갈리면 백엔드와 화면이 다른 답을 낼 자리가 생긴다. `command`·`evidence`를 완성해 싣는
    /// 것과 같은 규칙이다.
    pub runnable: bool,
    /// 사용자가 자기 터미널에 그대로 붙여 넣을 명령 원문(R6). 화면이 조각을 조립하지 않는다.
    pub command: String,
    /// 판정에 쓴 경로. 감지하지 않는 단계와 이 플랫폼에서 볼 경로가 없는 단계는 `None`이다.
    pub evidence: Option<String>,
}

/// 설치 단계의 이름. 목록은 언제나 넷이고 이 순서가 고정이다(R2). 문자열로 두지 않는 이유는
/// 화면이 단계마다 다른 문구를 쓰기 때문이다 — 값 집합이 닫혀 있어야 한다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HeartbeatSetupStep {
    Package,
    Init,
    Service,
    Dream,
}

/// 단계 하나의 표시 상태(R4). 확인 불가는 앱이 판정 근거를 갖지 못한 상태이며 미완료와 다르다.
/// 앱이 "모른다"를 "아니다"로 번역하면 사용자는 이미 끝낸 일을 다시 한다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HeartbeatSetupState {
    Done,
    NotDone,
    Unknown,
}

/// 이 기기에 등록된 하트비트 서비스를 앱이 얼마나 확정했는지(SPEC-036 R4·R5).
///
/// 확정된 경우에만 조작 대상이 있다. 나머지 넷은 서로 다른 사유이고 사용자가 할 다음 행동도
/// 다르므로 하나의 실패 값으로 접지 않는다(R5). 확정하지 못한 채 표준 라벨로 대신 시도하는 값은
/// 이 집합에 없다 — 그것이 R4가 막는 일이다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HeartbeatServiceTarget {
    /// 대상 plist가 정확히 하나이고 그 `Label`을 읽었다. 이 둘이 조작에 필요한 값 전부다.
    Resolved { label: String, plist_path: String },
    /// 디렉터리는 읽었는데 대상 plist가 없다. 데몬 계약이 같은 상태를 `skipped/not-registered`로
    /// 부른다.
    NotRegistered,
    /// 대상 plist가 둘 이상이라 앱이 대상을 고르지 않는다(확인 필요 3번). 찾은 경로를 전부 담아
    /// 사용자가 무엇을 정리해야 하는지 보이게 한다.
    Ambiguous { plist_paths: Vec<String> },
    /// macOS가 아니다. 다른 플랫폼의 등록물 위치와 조작 절차는 이 저장소가 확인한 적이 없다(R9).
    UnsupportedPlatform,
    /// 읽어야 할 것을 읽지 못했다. 디렉터리를 열지 못했거나, plist는 하나인데 그 `Label`을 읽지
    /// 못했다(파일을 열지 못했거나, plist가 아니거나, `Label` 키가 없거나 문자열이 아니다).
    ///
    /// 등록물 없음과 갈라 두는 값이다. 못 읽은 것을 없음으로 접으면 앱이 모르는 것을 안다고
    /// 말하게 된다.
    Unreadable { path: String },
}

/// 데몬을 내리면 함께 멈추는 잡 하나(SPEC-036 R2).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatRecordedJob {
    /// 상태 파일 최상위 키의 원문. 앱이 이름을 해석하지 않는다 — 이름에서 프로젝트를 뽑아내지도,
    /// 역할을 번역하지도 않는다(R2).
    pub name: String,
    /// 이 프로젝트의 잡인가. 앱이 자기 slug로 만든 잡 이름들과의 완전 일치로만 정한다. 부분 일치나
    /// 접두사 판정을 쓰지 않는다.
    pub of_this_project: bool,
}

/// 084 경고 자리에서 보여줄 하트비트 갱신 절차의 명령 원문(SPEC-034 R3·R4). 설치 마법사의
/// `command`와 같은 규칙이다 — 화면이 조각을 조립하지 않게 완성된 문자열이 도착한다.
///
/// 설치 방법을 하나로 단정하지 않으므로 갱신 명령이 둘이다(R3). `identify_command`가 사용자에게
/// 자기 갈래를 알려 주고, `package_command`와 `source_command`가 그 두 갈래다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatUpdateGuide {
    /// 어느 갈래인지 확인하는 명령. 출력의 `Editable project location` 유무가 갈래를 가른다.
    pub identify_command: String,
    /// pip 배포본으로 설치한 경우의 갱신 명령.
    pub package_command: String,
    /// 소스 체크아웃으로 설치한 경우의 갱신 명령. 체크아웃 경로는 앱이 알지 못하므로 붙이지 않는다.
    pub source_command: String,
    /// 재시작에 앞서 사용자가 자기 서비스 라벨을 확인하는 명령(R4). 확인할 방법이 없는 플랫폼에서는
    /// `None`이다 — 설치 3단계의 `evidence`가 같은 이유로 `None`이 되는 것과 같은 어법이다.
    pub service_lookup_command: Option<String>,
    /// 데몬 재시작 명령(R4). 라벨 자리는 사용자가 바꿔 넣는 빈자리이고 앱이 지어낸 값이 아니다.
    pub service_restart_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatRoleStatus {
    pub role: String,
    pub job_name: String,
    /// 이 역할 잡의 앱 기본값(R5). 미설치 잡의 입력 초기값이자 재설정이 되돌릴 값이다.
    pub defaults: JobDefaults,
    /// `None`은 "실행 기록 없음"이다. 상태 파일이 없거나 깨졌거나 잡 기록이 없는 경우를 구분하지 않는다.
    pub last_run: Option<HeartbeatJobRun>,
    /// 이 잡의 실행 한도 사용량(R1). 한도 값은 관리 블록에 있고 상태 조회는 그 블록을 모르므로,
    /// 조회는 `Unknown`으로 두고 서비스가 채운다. 관리 블록을 읽지 못한 조회에서는 이 값이 그대로
    /// 나가야 한다(R5).
    pub quota: JobQuota,
}

/// 잡 하나의 실행 한도 사용량. "값을 모른다"·"한도가 없다"·"기록이 없다"를 서로 다른 값으로
/// 구분한다(R5). 화면이 `used == 0`을 "기록 없음"으로 오독할 수 없어야 한다.
///
/// 무제한도 한 낱말이 아니다(SPEC-017 R5). 사용자가 고른 제한 없음은 정상 상태이고, 값이 어긋나
/// 무제한이 된 것은 손볼 곳이 있다는 신호다. 둘을 같은 변형으로 부르면 화면이 그 차이를 말할 수 없다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum JobQuota {
    /// 앱이 한도 값을 모른다. 관리 블록을 읽지 못했거나 그 잡이 블록에 없다.
    Unknown,
    /// 사용자가 고른 제한 없음. 그 잡이 블록에 있고 `max_per` 줄이 없다(SPEC-017 R6). 정상 상태다.
    /// 보여줄 원문이 없으므로 값을 담지 않는다 — 파일에 그 줄 자체가 없다.
    Unlimited,
    /// `max_per` 값이 있으나 데몬이 한도로 인정하지 않아 결과가 무제한이다(SPEC-017 R5).
    /// 형식 위반·0 이하 횟수·0 기간이 모두 여기다. 손볼 곳이라는 신호이므로 원문을 함께 담는다.
    IgnoredLimit { value: String },
    /// 한도는 알지만 실행 기록이 없다. 0회로 단정하지 않는다.
    #[serde(rename_all = "camelCase")]
    NoRuns { limit: u64, window: String },
    #[serde(rename_all = "camelCase")]
    Counted {
        used: u64,
        limit: u64,
        window: String,
        exhausted: bool,
        /// 소진 상태에서 한 번 분의 여유가 생기는 예상 시각. RFC3339(UTC)이고 화면이 로컬로
        /// 바꾼다. `TaskEvent.at`과 같은 규칙이다.
        recovers_at: Option<String>,
    },
}

/// 잡 하나의 앱 기본값. 사용자가 편집할 수 있는 세 필드뿐이다.
///
/// 화면이 이 값을 보여주고 파일에도 이 값을 쓴다(R5). 그래서 정의는 앱 안에 하나여야 한다. 화면이
/// 같은 값을 상수로 다시 적으면 두 정의가 갈라지고, "기본값으로 되돌렸는데 미설치 상태에서 시작하는
/// 값과 다르다"가 된다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobDefaults {
    pub interval: String,
    pub max_per: String,
    pub model: String,
    pub timeout: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatJobRun {
    /// 타임존이 없는 로컬 시각 문자열이다. 원문 그대로 전달하고 UTC로 해석하지 않는다.
    pub at: Option<String>,
    /// `success`, `failure`, `skipped`, `quota_skipped`, `timeout` 외의 값도 원문 그대로 전달한다.
    pub result: Option<String>,
    pub duration_seconds: Option<f64>,
    /// 마지막 condition의 표준 출력 첫 줄. 데몬이 빈 출력이면 키를 지우므로 없을 수 있고, 이 키를
    /// 주지 않는 데몬도 있다. `result`와 같은 취급이다 — 앱은 내용을 검증하거나 정규화하지 않고
    /// 원문 그대로 전달한다. 사유 코드를 문장으로 옮기는 일은 화면이 한다.
    pub condition_output: Option<String>,
}

/// 앱 관리 블록 밖에 있는 같은 프로젝트의 잡. 감지만 하고 수정하지 않는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateHeartbeatJob {
    pub name: String,
    /// 어느 연동의 중복인지. 화면이 해당 연동 카드 안에 경고를 그린다.
    pub integration: String,
    /// 조건 인자로 판별한다. 역할 개념이 없는 연동이거나 판별할 수 없으면 `None`이다.
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatReadFailure {
    pub path: String,
    pub message: String,
}

/// dream 연동 상태. 공통 설치 상태(dream 스킬) 위에 선행 조건과 정제 상태를 얹는다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DreamStatus {
    /// dream 스킬 설치 여부.
    pub installation: IntegrationInstallation,
    /// dream은 하트비트 위에서 돈다. 화면의 세 상태는 이 값과 `installation`의 조합이다.
    pub heartbeat: IntegrationInstallation,
    pub refinement: DreamRefinement,
}

/// 정제 상태. 전부 파일에서 직접 센 값이고, 없는 파일은 오류가 아니다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DreamRefinement {
    pub total_transcripts: usize,
    /// 마킹돼 있으면서 실제로 존재하는 트랜스크립트 수.
    pub marked_transcripts: usize,
    /// 전체 − 마킹. 마킹은 존재하는 파일만 세므로 음수가 되지 않는다.
    pub unrefined_transcripts: usize,
    /// `dream_meta.md`의 `last_dream` 원문. `None`은 "정제 기록 없음"이다.
    pub last_dream: Option<String>,
    pub memory_topics: usize,
}

impl WorkflowEntry {
    pub fn to_summary(&self, counts: WorkflowCounts, items: WorkflowItems) -> WorkflowSummary {
        WorkflowSummary {
            id: self.id.clone(),
            directory: self.directory.clone(),
            name: self.name.clone(),
            status: self.status.clone(),
            created_at: self.created_at.clone(),
            counts,
            items,
        }
    }
}
