export type SchemaCompatibility =
  | "not_initialized"
  | "current"
  | "migration_required"
  | "future_schema";

export interface WorkflowCounts {
  ideas: number;
  specs: number;
  decisions: number;
  tasks: number;
  reports: number;
}

export interface WorkflowSummary {
  id: string;
  directory: string;
  name: string;
  status: "active" | "archived";
  createdAt: string;
  counts: WorkflowCounts;
  items: WorkflowItems;
}

export interface WorkflowItems {
  ideas: WorkflowItemSummary[];
  specs: WorkflowItemSummary[];
  tasks: WorkflowItemSummary[];
}

export interface TaskEvent {
  kind: string;
  at: string;
}

export interface WorkflowItemSummary {
  fileName: string;
  id: string;
  title: string;
  /**
   * 문서의 상태. 아이디어에서는 파일 값이 아니라 조회 시점 파생값이며 `inbox`·`drafting`·
   * `closed`·`adopted` 넷 중 하나다. `closed`는 참조 기획서가 모두 반려로 끝난 경우다. 앱은
   * 판정 결과를 아이디어 파일에 쓰지 않는다.
   */
  status: string;
  updatedAt: string | null;
  dueAt?: string | null;
  /** 개발 작업이 어떤 기획서에서 나왔는지. 아이디어·기획서에서는 늘 null이다. */
  sourceSpecId?: string | null;
  /** 개발 작업이 어떤 승인 결정에서 나왔는지. 아이디어·기획서에서는 늘 null이다. */
  sourceDecisionId?: string | null;
  /**
   * 중단 의심의 근거. 아이디어가 반영중인데 선점한 미만료 lease가 없을 때 걸려 있는 draft 기획서의
   * 문서 id다. 비어 있지 않다는 것과 중단 의심은 같은 뜻이다. 기획서·개발 작업 항목에서는 비어 있다.
   */
  stalledSpecIds?: string[];
  /**
   * 문서에 일어난 사실. 시각 오름차순이다. 개발 작업은 상태 전이, 기획서는 사용자 결정이 실리고
   * 아이디어는 늘 비어 있다. `kind`의 뜻은 문서 종류에 따라 다르다 — 기획서의
   * `revision_requested`는 "수정 요청"이고 개발 작업의 같은 값은 "반려"다.
   */
  events?: TaskEvent[];
  excerpt: string;
}

export interface SpecDocument {
  summary: WorkflowItemSummary;
  body: string;
}

/**
 * 선언된 선행 작업 하나의 판정 결과. `pending`은 시간이 지나면 풀리지만 `missing`·`cyclic`은
 * 영원히 충족되지 않는다.
 */
export type TaskDependencyState = "satisfied" | "pending" | "missing" | "cyclic";

export interface TaskDependency {
  id: string;
  state: TaskDependencyState;
}

/**
 * 이 작업의 착수를 막고 있는 활성 lease 하나와 그 근거. lease가 풀리면 사라지는 일시적인 사실이라
 * `missing`·`cyclic`처럼 사람이 선언을 고쳐야 하는 상태와 다르다.
 */
export interface TaskOverlapBlock {
  /** lease가 잡은 문서 id. */
  leaseTargetId: string;
  /** 두 선언이 함께 가리킨 경로. 선언 부재나 형식 오류로 막힌 경우 비어 있다. */
  sharedFiles: string[];
}

export interface TaskDocument {
  summary: WorkflowItemSummary;
  body: string;
  /** 선언된 선행 작업과 각각의 판정 결과. 선언 순서 그대로다. */
  dependencies?: TaskDependency[];
  /** 선언 줄이 계약 형식이 아니어서 목록으로 읽지 못했는가. 참이면 이 작업은 미충족이다. */
  dependencyFormatError?: boolean;
  /** 착수를 막고 있는 활성 lease와 그 근거. 비어 있으면 막히지 않은 것이다. */
  overlapBlocks?: TaskOverlapBlock[];
}

export interface IdeaDocument {
  summary: WorkflowItemSummary;
  body: string;
}

export type SpecDecisionOutcome =
  | "approved"
  | "revision_requested"
  | "rejected";

export type TaskQaOutcome = "confirmed" | "revision_requested";

export interface TaskQaBatchEntry {
  fileName: string;
  /** 문서를 읽지 못하면 null. 추정으로 채우지 않는다. */
  taskId: string | null;
  recorded: boolean;
  /** 실패 사유. 성공이면 null. */
  message: string | null;
}

export interface TaskQaBatchResult {
  summary: ProjectSummary;
  /** 요청 순서 그대로. 화면이 목록과 나란히 읽는다. */
  results: TaskQaBatchEntry[];
}

export interface AgentLeaseSummary {
  leaseId: string;
  agent: string;
  /** 선점 세션이 적은 역할. 계약상 선택 필드라 없으면 null이다. 추정으로 채우지 않는다. */
  role: string | null;
  taskId: string | null;
  /** lease 파일의 `heartbeat_at` 원문(RFC3339). 최초 시작 시각이 아니다. */
  heartbeatAt: string;
  expiresAt: string;
}

/** 역할별 대기 물량. 조건 스크립트가 그 역할로 종료 코드 0을 돌려주는 상태가 true다. */
export interface PendingRoleWork {
  planner: boolean;
  architect: boolean;
  developer: boolean;
}

export interface ProjectSummary {
  rootPath: string;
  initialized: boolean;
  projectId: string | null;
  name: string;
  compatibility: SchemaCompatibility;
  activeLeases: AgentLeaseSummary[];
  workflows: WorkflowSummary[];
  /** 값이 없으면 "대기 물량을 모른다"이고, 모르는 상태에서는 경고하지 않는다. */
  pendingWork?: PendingRoleWork;
}

/**
 * 연동 공통 설치 상태. 값은 미설치·설치됨 두 개뿐이다.
 *
 * 연동별 부가 상태(하트비트의 데몬 실행 여부 등)는 이 위에 얹는다. 세 번째 연동이 와도 이 타입은
 * 고치지 않는다.
 */
export type IntegrationInstallation = "not_installed" | "installed";

export interface HeartbeatJobRun {
  /** 타임존이 없는 로컬 시각 문자열이다. UTC로 해석하지 않는다. */
  at: string | null;
  result: string | null;
  durationSeconds: number | null;
  /**
   * 마지막 조건 검사의 표준 출력 첫 줄. 건너뜀 사유가 여기 실린다.
   *
   * 선택 필드다. 데몬은 출력이 비면 이 키를 지우고, 이 키를 아예 주지 않는 데몬도 아직 쓰인다.
   * 값 없음이 정상 상태이므로 화면은 없을 때를 기본으로 그린다(SPEC-023 R2).
   */
  conditionOutput?: string | null;
}

export interface HeartbeatRoleStatus {
  role: string;
  jobName: string;
  /** 이 역할 잡의 앱 기본값. 미설치 잡의 입력 초기값이자 재설정이 되돌릴 값이다. */
  defaults: JobDefaults;
  /** null은 "실행 기록 없음"이다. 오류가 아니다. */
  lastRun: HeartbeatJobRun | null;
  /** 이 잡의 실행 한도 사용량. 관리 블록을 읽지 못하면 unknown이다. */
  quota: JobQuota;
}

/**
 * 잡 하나의 실행 한도 사용량. "값을 모른다"·"한도가 없다"·"기록이 없다"가 서로 다른 값이다.
 *
 * used가 0인 것과 기록이 없는 것을 화면이 같은 것으로 읽으면 안 된다. 기록이 없는 것을 0으로 읽으면
 * 사용자는 한도가 비어 있다고 판단한다.
 *
 * 무제한도 한 낱말이 아니다. `unlimited`는 사용자가 고른 정상 상태이고, `ignoredLimit`은 파일의 값이
 * 데몬 기준에 미치지 못해 무제한이 된 상태라 손볼 곳이 있다는 신호다.
 */
export type JobQuota =
  | { kind: "unknown" }
  /** 사용자가 고른 제한 없음. 관리 블록의 그 잡에 max_per 줄이 없다. 보여줄 원문이 없다. */
  | { kind: "unlimited" }
  /** max_per 값이 있으나 하트비트가 한도로 인정하지 않는다. 형식 위반·0 이하 횟수·0 기간이 모두 여기다. */
  | { kind: "ignoredLimit"; value: string }
  | { kind: "noRuns"; limit: number; window: string }
  | {
      kind: "counted";
      used: number;
      limit: number;
      window: string;
      exhausted: boolean;
      /** RFC3339. 화면이 로컬 시각으로 바꾼다. 계산할 수 없으면 null이다. */
      recoversAt: string | null;
    };

/**
 * 잡 하나의 앱 기본값. 사용자가 편집할 수 있는 세 필드뿐이다.
 *
 * 백엔드의 잡 정의에서 그대로 내려온다. 화면이 같은 값을 상수로 다시 적으면 두 정의가 갈라지고,
 * 재설정이 보여주는 값과 파일에 쓰이는 값이 달라진다.
 */
export interface JobDefaults {
  interval: string;
  maxPer: string;
  model: string;
  timeout: string;
}

/** 앱 관리 블록 밖에 있는 같은 프로젝트의 잡. 감지만 하고 수정하지 않는다. */
export interface DuplicateIntegrationJob {
  name: string;
  /** 어느 연동의 중복인지. 백엔드가 연동별로 나눠 담는다. */
  integration: string;
  /** 역할 개념이 없는 연동이거나 판별할 수 없으면 null이다. */
  role: string | null;
}

export interface IntegrationReadFailure {
  path: string;
  message: string;
}

export interface ManagedRoleJob {
  role: string;
  interval: string | null;
  maxPer: string | null;
  model: string | null;
  timeout: string | null;
  /**
   * 앱이 다시 쓸 값과 다른 앱 소유 필드 이름. 저장하면 이 필드들이 앱 값으로 되돌아간다.
   *
   * 판정은 백엔드가 한다. 화면은 이름만 밝히고 값은 알지 않는다.
   */
  appOwnedDrift: string[];
}

/** 관리 블록에 기록된 dream 잡의 편집 가능 값. 나머지 필드는 앱이 소유한다. */
export interface ManagedDreamJob {
  interval: string | null;
  maxPer: string | null;
  model: string | null;
  timeout: string | null;
  /** 역할 잡과 같은 값이다. */
  appOwnedDrift: string[];
}

/**
 * 설치 마법사의 단계 이름. 목록은 언제나 넷이고 이 순서가 고정이다. 화면이 다시 정렬하지 않는다.
 */
export type HeartbeatSetupStep = "package" | "init" | "service" | "dream";

/**
 * 단계 하나의 표시 상태. `unknown`은 앱이 판정 근거를 갖지 못한 상태이며 `not_done`과 다른 문구로
 * 보여준다. "모른다"를 "아니다"로 번역하면 사용자는 이미 끝낸 일을 다시 한다.
 */
export type HeartbeatSetupState = "done" | "not_done" | "unknown";

/** 설치 마법사가 보여주는 단계 하나. 접혀 있던 설치 판정을 단계로 펼친 값이다. */
export interface HeartbeatSetupStage {
  step: HeartbeatSetupStep;
  state: HeartbeatSetupState;
  /** 1~3은 참, dream은 거짓이다. 선택 단계가 미완료여도 마법사는 접힌다. */
  required: boolean;
  /** 사용자가 자기 터미널에 그대로 붙여 넣을 명령 원문. 화면에서 조각을 조립하지 않는다. */
  command: string;
  /** 판정에 쓴 경로. 감지하지 않는 단계와 이 플랫폼에서 볼 경로가 없는 단계는 null이다. */
  evidence: string | null;
}

/** 하트비트 연동 payload. 공통 설치 상태 위에 데몬 실행 여부와 역할 잡을 얹는다. */
export interface HeartbeatIntegration {
  installation: IntegrationInstallation;
  /** pid 파일 존재로만 판정한다. 프로세스 생존은 확인하지 않는다. */
  daemonRunning: boolean;
  /**
   * 설치 단계 넷. installation을 대체하지 않고 그 옆에 실린다. dream 단계가 여기 들어가는 이유는
   * 이것이 하트비트 카드의 마법사이기 때문이며, dream 카드는 이 값을 읽지 않는다.
   */
  setupStages: HeartbeatSetupStage[];
  conditionScriptPath: string;
  roles: HeartbeatRoleStatus[];
  managedJobs: ManagedRoleJob[];
  duplicateJobs: DuplicateIntegrationJob[];
  readFailures: IntegrationReadFailure[];
}

/** dream 정제 상태. 전부 파일에서 직접 센 값이고, 없는 파일은 오류가 아니다. */
export interface DreamRefinement {
  totalTranscripts: number;
  /** 마킹돼 있으면서 실제로 존재하는 트랜스크립트 수. */
  markedTranscripts: number;
  /** 전체 − 마킹. 마킹 기준이라 dream이 한 번에 처리할 수와는 다르다. */
  unrefinedTranscripts: number;
  /** null은 "정제 기록 없음"이다. 오류가 아니다. */
  lastDream: string | null;
  memoryTopics: number;
}

/** dream 연동 payload. 공통 설치 상태 위에 선행 조건과 정제 상태를 얹는다. */
export interface DreamIntegration {
  /** dream 스킬 설치 여부. skillPath 존재로만 판정한다. */
  installation: IntegrationInstallation;
  /** 선행 조건. dream은 하트비트 데몬이 깨우는 스킬이다. */
  heartbeat: IntegrationInstallation;
  refinement: DreamRefinement;
  /** 설치 판정에 쓴 경로. 다른 이름으로 설치하면 이 경로에 없어 미설치로 보인다. */
  skillPath: string;
  /** 설치될 dream 잡의 condition 원문. 화면에서 다시 조립하지 않는다. */
  conditionCommand: string;
  /** dream 잡의 앱 기본값. 역할 잡은 역할마다 달라 roles 항목에 실리고, dream은 잡이 하나다. */
  defaults: JobDefaults;
  /** 관리 블록에 기록된 dream 잡. null은 "꺼짐"이다. */
  managedJob: ManagedDreamJob | null;
  /** null은 "실행 기록 없음"이다. 오류가 아니다. */
  lastRun: HeartbeatJobRun | null;
  /** dream 잡의 실행 한도 사용량. 역할 잡과 같은 규칙이다. */
  quota: JobQuota;
  duplicateJobs: DuplicateIntegrationJob[];
  readFailures: IntegrationReadFailure[];
}

/**
 * 하트비트를 갱신하는 명령 원문(SPEC-034 R3). 백엔드가 완성한 문자열이고 화면은 그리기만 한다 —
 * 설치 마법사의 `command`와 같은 규칙이다.
 *
 * 갈래가 둘인 이유는 앱이 이 기기의 설치 방법을 알지 못하기 때문이다. 사용자가 `identifyCommand`로
 * 자기 갈래를 확인하고 그중 하나를 고른다.
 */
export interface HeartbeatUpdateGuide {
  /** 설치 갈래를 판별하는 명령. 결과에 편집 가능 설치 표시가 있으면 소스 체크아웃이다. */
  identifyCommand: string;
  /** pip으로 설치한 경우의 갱신 명령. */
  packageCommand: string;
  /** 소스 체크아웃으로 설치한 경우의 갱신 명령. 체크아웃 경로는 앱이 알지 못해 붙지 않는다. */
  sourceCommand: string;
  /**
   * 사용자가 자기 서비스 등록물의 라벨을 확인하는 명령. null은 "앱이 이 플랫폼의 재시작 방법을
   * 알지 못한다"는 뜻이며 `serviceRestartCommand`와 함께 움직인다.
   */
  serviceLookupCommand: string | null;
  /** 재시작 명령. 라벨 자리는 사용자가 채운다 — 앱이 지어낸 값을 넣지 않는다. */
  serviceRestartCommand: string | null;
}

/**
 * 연동 섹션이 한 번에 읽는 값. 섹션 공통 값과 연동별 payload를 나눠 담는다.
 *
 * 연동이 늘어나도 게이트웨이 메서드·훅 상태·조회 주기는 그대로다. 새 연동은 payload 필드 하나를
 * 더한다.
 */
export interface IntegrationsSnapshot {
  /** 플랫폼 지원 여부는 섹션 공통 정책이다. 연동별 분기를 만들지 않는다. */
  supported: boolean;
  /** 두 연동이 같은 값을 쓴다. */
  slug: string;
  /**
   * 관리 블록을 담은 문서를 읽지 못한 사유. null이면 읽었다는 뜻이고, 파일이 없는 것도 읽은 것으로
   * 본다(잡이 없는 빈 블록). null이 아니면 앱이 블록의 값을 모르는 상태이므로 카드는 빈 잡 목록을
   * "잡 없음"으로 읽지 않고 저장도 막는다.
   *
   * 두 연동이 HEARTBEAT.md 한 파일을 공유하므로 섹션 공통 값이다.
   */
  managedBlockFailure: IntegrationReadFailure | null;
  /**
   * 앱이 이 프로젝트의 잡을 읽고 쓰는 파일의 절대 경로. 백엔드가 실제로 여는 값을 그대로 받는다.
   *
   * 화면은 이 값을 그리기만 하고 조립하지 않는다. 경로에 slug가 들어가므로 화면이 만들면 백엔드와
   * 갈라질 자리가 생긴다. `conditionScriptPath`·`conditionCommand`가 payload에 있는 것과 같은 규칙이다.
   */
  jobsFilePath: string;
  /**
   * 하트비트 갱신 절차의 명령 원문. 두 카드가 같은 값을 같은 문구로 보여야 하므로(R7) 연동별
   * payload가 아니라 섹션 공통 값이다. `managedBlockFailure`·`jobsFilePath`와 같은 이유다.
   *
   * 표시 조건은 여기 없다. 084 경고가 뜨는 조건은 화면이 이미 갖고 있고, 같은 결론을 내는 자리를
   * 둘로 만들지 않는다.
   */
  updateGuide: HeartbeatUpdateGuide;
  heartbeat: HeartbeatIntegration;
  dream: DreamIntegration;
}

/**
 * 저장 요청이 정하는 실행 한도. null은 "이번 편집에서 지정하지 않음"이다.
 *
 * 한도 값 하나로는 "지정 안 함"과 "제한 없음"을 함께 담을 수 없다. 제한 없음은 관리 블록에 한도
 * 줄을 쓰지 않는 상태이고, 지정 안 함은 파일에 적힌 값을 그대로 두는 상태라 결과가 다르다.
 */
export type MaxPerRequestValue = { kind: "unlimited" } | { kind: "limit"; value: string };

/**
 * 설치 커맨드에 넘기는 역할별 요청. 비활성 역할도 함께 보낸다.
 *
 * 편집 가능 값의 `null`은 "이번 편집에서 지정하지 않았다"는 뜻이고, 그 필드는 파일의 값이 이긴다.
 * 화면이 파일 값을 폼에 채우는 것은 유지하되, 그것이 유일한 보존 수단이 아니다.
 */
export interface RoleJobRequest {
  role: string;
  enabled: boolean;
  interval: string | null;
  maxPer: MaxPerRequestValue | null;
  model: string | null;
  timeout: string | null;
}

/** 설치 커맨드에 넘기는 dream 잡 요청. 역할 잡 값은 담지 않는다. */
export interface DreamJobRequest {
  enabled: boolean;
  interval: string | null;
  maxPer: MaxPerRequestValue | null;
  model: string | null;
  timeout: string | null;
}

/**
 * 쓰기 실패 사유와 그 쓰기를 요청한 연동.
 *
 * 연동 id를 함께 담아 카드마다 자기 실패만 보여준다. 한 연동의 실패 문구가 다른 연동 카드에
 * 나타나면 사용자가 해야 할 일을 잘못 읽는다.
 */
export interface IntegrationWriteError {
  integration: string;
  message: string;
}

/** 실행을 시작하지 못했거나 비정상 종료한 사유. 백엔드가 만든 값을 그대로 들고 있는다. */
export interface HeartbeatRunFailure {
  jobName: string;
  message: string;
  /** 사용자가 직접 칠 명령 원문. 화면은 이 문자열을 다시 조립하지 않는다. */
  command: string;
}

/** 앱이 띄운 잡 실행의 진행·실패 상태와 실행 통로. 카드는 이 묶음 하나만 받는다. */
export interface HeartbeatRunControls {
  /** 지금 앱이 띄워 둔 잡 이름. 역할마다 따로 담기므로 한 역할이 다른 역할을 막지 않는다(R3). */
  running: string[];
  /** 마지막 실패 하나. 조회 주기가 지우지 않는다(R6). */
  failure: HeartbeatRunFailure | null;
  run(jobName: string): Promise<boolean>;
}

export interface IntegrationsState {
  /** 아직 읽지 않았거나 조회에 실패하면 null이다. */
  snapshot: IntegrationsSnapshot | null;
  error: string | null;
  /** 설치 쓰기가 실패한 사유. 2.5초 주기 조회는 이 값을 지우지 않는다. */
  writeError: IntegrationWriteError | null;
  /**
   * 잡 실행의 진행·실패 상태. 조회 상태와 수명이 달라 훅이 따로 들고 있다가 여기에 합쳐 내보낸다.
   *
   * 연동 뷰는 조건부 렌더라 다른 메뉴를 다녀오면 언마운트되므로, 이 값의 주인은 화면이 아니라
   * 훅이다(R3).
   *
   * `useProjectWorkspace`는 언제나 이 값을 채워 내보낸다. 선택 필드인 것은 이 묶음을 조립하는
   * 테스트 리터럴이 아직 이 필드를 모르기 때문이며, 그 리터럴들이 필드를 갖추면 필수로 좁힌다.
   */
  heartbeatRuns?: HeartbeatRunControls;
}

/**
 * 연동 카드가 쓰는 쓰기 액션. 섹션은 이 객체를 각 카드에 그대로 넘기기만 한다.
 *
 * 연동마다 쓰기 커맨드가 다르므로 이 목록은 연동과 함께 늘어난다. 섹션과 카드 골격은 내용을
 * 들여다보지 않으므로 그때 고칠 필요가 없다.
 */
export interface IntegrationActions {
  installHeartbeatJobs(
    roles: RoleJobRequest[],
    baseline: ManagedRoleJob[],
  ): Promise<boolean>;
  installDreamJob(
    dream: DreamJobRequest,
    baseline: ManagedDreamJob | null,
  ): Promise<boolean>;
}

export interface RecentProject {
  name: string;
  path: string;
  lastOpenedAt: string;
}

export interface ProjectGateway {
  chooseDirectory(): Promise<string | null>;
  inspect(path: string): Promise<ProjectSummary>;
  createWorkflow(path: string, name: string): Promise<ProjectSummary>;
  createIdea(
    path: string,
    workflowDirectory: string,
    content: string,
  ): Promise<ProjectSummary>;
  readSpec(
    path: string,
    workflowDirectory: string,
    fileName: string,
  ): Promise<SpecDocument>;
  readTask(
    path: string,
    workflowDirectory: string,
    fileName: string,
  ): Promise<TaskDocument>;
  readIdea(
    path: string,
    workflowDirectory: string,
    fileName: string,
  ): Promise<IdeaDocument>;
  decideSpec(
    path: string,
    workflowDirectory: string,
    fileName: string,
    outcome: SpecDecisionOutcome,
    comment: string,
  ): Promise<ProjectSummary>;
  recordTaskQa(
    path: string,
    workflowDirectory: string,
    fileName: string,
    outcome: TaskQaOutcome,
    comment: string,
  ): Promise<ProjectSummary>;
  /** 확인 전용이라 outcome 자리가 없다. 일괄 반려는 이 길로 열지 않는다. */
  confirmTaskQaBatch(
    path: string,
    workflowDirectory: string,
    fileNames: string[],
    comment: string,
  ): Promise<TaskQaBatchResult>;
  migrate(path: string): Promise<ProjectSummary>;
  /** 연동 조회는 이 메서드 하나다. 연동이 늘어나도 메서드를 늘리지 않는다. */
  inspectIntegrations(path: string): Promise<IntegrationsSnapshot>;
  /**
   * `baseline`은 화면이 폼을 시딩할 때 읽은 관리 블록의 값이다. 백엔드가 쓰기 직전의 파일과
   * 대조하고, 다르면 아무 파일도 쓰지 않는다. 화면이 읽은 뒤 바뀐 값을 확인 없이 덮어쓰지 않는다.
   */
  installHeartbeatJobs(
    path: string,
    roles: RoleJobRequest[],
    baseline: ManagedRoleJob[],
  ): Promise<IntegrationsSnapshot>;
  /** 역할 잡과 같은 규칙이다. 관리 블록에 dream 잡이 없던 상태는 `null`이다. */
  installDreamJob(
    path: string,
    dream: DreamJobRequest,
    baseline: ManagedDreamJob | null,
  ): Promise<IntegrationsSnapshot>;
  /**
   * 역할 잡 하나를 지금 한 번 실행한다. 어떤 파일도 쓰지 않으므로 스냅샷을 돌려주지 않는다.
   *
   * 실패는 `HeartbeatRunFailure` 모양으로 거절된다. 사용자가 의도해 누른 자리에서만 부른다.
   */
  runHeartbeatJob(path: string, jobName: string): Promise<void>;
}

export interface RecentProjectStore {
  load(): RecentProject[];
  remember(project: ProjectSummary): RecentProject[];
}
