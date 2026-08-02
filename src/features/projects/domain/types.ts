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

export interface WorkflowItemSummary {
  fileName: string;
  id: string;
  title: string;
  status: string;
  updatedAt: string | null;
  dueAt?: string | null;
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

export type HeartbeatInstallation =
  | "not_installed"
  | "installed_daemon_stopped"
  | "installed_daemon_running";

export interface HeartbeatJobRun {
  /** 타임존이 없는 로컬 시각 문자열이다. UTC로 해석하지 않는다. */
  at: string | null;
  result: string | null;
  durationSeconds: number | null;
}

export interface HeartbeatRoleStatus {
  role: string;
  jobName: string;
  /** null은 "실행 기록 없음"이다. 오류가 아니다. */
  lastRun: HeartbeatJobRun | null;
}

export interface DuplicateHeartbeatJob {
  name: string;
  role: string | null;
}

export interface HeartbeatReadFailure {
  path: string;
  message: string;
}

export interface HeartbeatStatus {
  installation: HeartbeatInstallation;
  roles: HeartbeatRoleStatus[];
  duplicateJobs: DuplicateHeartbeatJob[];
  readFailures: HeartbeatReadFailure[];
}

export interface ManagedRoleJob {
  role: string;
  interval: string | null;
  maxPer: string | null;
  model: string | null;
}

export interface HeartbeatIntegration {
  supported: boolean;
  slug: string;
  conditionScriptPath: string;
  status: HeartbeatStatus;
  managedJobs: ManagedRoleJob[];
}

/** 설치 커맨드에 넘기는 역할별 요청. 비활성 역할도 함께 보낸다. */
export interface RoleJobRequest {
  role: string;
  enabled: boolean;
  interval: string;
  maxPer: string;
  model: string;
}

export interface HeartbeatState {
  /** 아직 읽지 않았거나 조회에 실패하면 null이다. */
  integration: HeartbeatIntegration | null;
  error: string | null;
  /** 설치 쓰기가 실패한 사유. 2.5초 주기 조회는 이 값을 지우지 않는다. */
  writeError: string | null;
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
  inspectHeartbeat(path: string): Promise<HeartbeatIntegration>;
  installHeartbeatJobs(
    path: string,
    roles: RoleJobRequest[],
  ): Promise<HeartbeatIntegration>;
}

export interface RecentProjectStore {
  load(): RecentProject[];
  remember(project: ProjectSummary): RecentProject[];
}
