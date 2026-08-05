use serde::{Deserialize, Serialize};

pub const PROJECT_SCHEMA_VERSION: u32 = 1;

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
}

/// 역할별 대기 물량. 조건 스크립트가 그 역할로 종료 코드 0을 돌려주는 상태가 `true`다.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingRoleWork {
    pub planner: bool,
    pub architect: bool,
    pub developer: bool,
}

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
    pub reports: usize,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowItems {
    pub ideas: Vec<WorkflowItemSummary>,
    pub specs: Vec<WorkflowItemSummary>,
    pub tasks: Vec<WorkflowItemSummary>,
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
    /// 선행 작업이 `qa_waiting` 또는 `completed`다. 후행이 딛고 설 코드가 트리에 있다.
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
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IdeaDocument {
    pub summary: WorkflowItemSummary,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecDecisionOutcome {
    Approved,
    RevisionRequested,
    Rejected,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskQaOutcome {
    Confirmed,
    RevisionRequested,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskQaBatchResult {
    pub summary: ProjectSummary,
    /// 요청 순서 그대로. 화면이 목록과 나란히 읽는다.
    pub results: Vec<TaskQaBatchEntry>,
}

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
