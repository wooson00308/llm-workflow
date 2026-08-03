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
  status: string;
  updatedAt: string | null;
  dueAt?: string | null;
  events?: TaskEvent[];
  excerpt: string;
}

export interface SpecDocument {
  summary: WorkflowItemSummary;
  body: string;
}

export interface TaskDocument {
  summary: WorkflowItemSummary;
  body: string;
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

export interface AgentLeaseSummary {
  leaseId: string;
  agent: string;
  taskId: string | null;
  expiresAt: string;
}

export interface ProjectSummary {
  rootPath: string;
  initialized: boolean;
  projectId: string | null;
  name: string;
  compatibility: SchemaCompatibility;
  activeLeases: AgentLeaseSummary[];
  workflows: WorkflowSummary[];
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
}

export interface HeartbeatRoleStatus {
  role: string;
  jobName: string;
  /** 이 역할 잡의 앱 기본값. 미설치 잡의 입력 초기값이자 재설정이 되돌릴 값이다. */
  defaults: JobDefaults;
  /** null은 "실행 기록 없음"이다. 오류가 아니다. */
  lastRun: HeartbeatJobRun | null;
}

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
  /** 역할 잡과 같은 값이다. */
  appOwnedDrift: string[];
}

/** 하트비트 연동 payload. 공통 설치 상태 위에 데몬 실행 여부와 역할 잡을 얹는다. */
export interface HeartbeatIntegration {
  installation: IntegrationInstallation;
  /** pid 파일 존재로만 판정한다. 프로세스 생존은 확인하지 않는다. */
  daemonRunning: boolean;
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
  duplicateJobs: DuplicateIntegrationJob[];
  readFailures: IntegrationReadFailure[];
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
  heartbeat: HeartbeatIntegration;
  dream: DreamIntegration;
}

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
  maxPer: string | null;
  model: string | null;
}

/** 설치 커맨드에 넘기는 dream 잡 요청. 역할 잡 값은 담지 않는다. */
export interface DreamJobRequest {
  enabled: boolean;
  interval: string | null;
  maxPer: string | null;
  model: string | null;
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

export interface IntegrationsState {
  /** 아직 읽지 않았거나 조회에 실패하면 null이다. */
  snapshot: IntegrationsSnapshot | null;
  error: string | null;
  /** 설치 쓰기가 실패한 사유. 2.5초 주기 조회는 이 값을 지우지 않는다. */
  writeError: IntegrationWriteError | null;
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
}

export interface RecentProjectStore {
  load(): RecentProject[];
  remember(project: ProjectSummary): RecentProject[];
}
