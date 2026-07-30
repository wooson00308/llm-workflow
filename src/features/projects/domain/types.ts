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
}

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
  migrate(path: string): Promise<ProjectSummary>;
}

export interface RecentProjectStore {
  load(): RecentProject[];
  remember(project: ProjectSummary): RecentProject[];
}
