import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  AgentInstallApplication,
  AgentInstallPlan,
  AgentMigrationPreview,
  AgentCancelOutcome,
  AgentPolicySnapshot,
  AgentProjectConsent,
  AgentProjectPolicy,
  AgentQueueSnapshot,
  AgentRoleSlotRequest,
  AgentRunLogPage,
  AgentRunPlan,
  AgentRunStartOutcome,
  AgentRunSummary,
  AgentRuntimeInspection,
  AgentUpdateApplication,
  AgentUpdatePlan,
  CustomRulesDocument,
  CustomRulesDraft,
  CustomRulesPreview,
  HeartbeatServiceControlResult,
  HeartbeatSetupRunResult,
  HeartbeatUpdateResult,
  HeartbeatVersions,
  IdeaDocument,
  IntegrationsSnapshot,
  ManagedAssetSyncResult,
  ProjectGateway,
  ProjectSummary,
  ReportDocument,
  SaveCustomRulesRequest,
  SaveCustomRulesResult,
  SpecDocument,
  TaskDocument,
  WorkGroupQaSubmission,
  WorkGroupQaSubmissionResult,
  TaskResumeRequest,
  TaskResumeResult,
  TaskRevisionRequestInput,
  TaskRevisionRequestResult,
  WorkflowReportSummary,
} from "../domain/types";

export const tauriProjectGateway: ProjectGateway = {
  async chooseDirectory() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "LLM Workflow 프로젝트 폴더 선택",
    });
    return typeof selected === "string" ? selected : null;
  },

  inspect(path) {
    return invoke<ProjectSummary>("inspect_project", { path });
  },

  async watchProject(path, onChanged) {
    let activeWatchId: string | null = null;
    const unlisten = await listen<{ watchId: string; path: string }>(
      "workflow-project-changed",
      (event) => {
        if (event.payload.path === path && event.payload.watchId === activeWatchId) onChanged();
      },
    );
    try {
      activeWatchId = await invoke<string>("watch_project", { path });
    } catch (error) {
      unlisten();
      throw error;
    }
    return async () => {
      unlisten();
      if (activeWatchId) await invoke("unwatch_project", { watchId: activeWatchId });
    };
  },

  synchronizeManagedAssets(path) {
    return invoke<ManagedAssetSyncResult>("synchronize_managed_project_assets", {
      path,
    });
  },

  readCustomRules(path) {
    return invoke<CustomRulesDocument>("read_custom_rules", { path });
  },

  prepareCustomRulesPreview(path, draft: CustomRulesDraft) {
    return invoke<CustomRulesPreview>("prepare_custom_rules_preview", {
      path,
      draft,
    });
  },

  saveCustomRules(path, request: SaveCustomRulesRequest) {
    return invoke<SaveCustomRulesResult>("save_custom_rules", {
      path,
      request,
    });
  },

  createWorkflow(path, name) {
    return invoke<ProjectSummary>("create_workflow", { path, name });
  },

  createIdea(path, workflowDirectory, content) {
    return invoke<ProjectSummary>("create_idea", {
      path,
      workflowDirectory,
      content,
    });
  },

  readSpec(path, workflowDirectory, fileName) {
    return invoke<SpecDocument>("read_spec", {
      path,
      workflowDirectory,
      fileName,
    });
  },

  readTask(path, workflowDirectory, fileName) {
    return invoke<TaskDocument>("read_task", {
      path,
      workflowDirectory,
      fileName,
    });
  },

  readIdea(path, workflowDirectory, fileName) {
    return invoke<IdeaDocument>("read_idea", {
      path,
      workflowDirectory,
      fileName,
    });
  },

  // 넘기는 것은 실행 기록에 이미 실려 있는 대상 문서 식별자와 예약 결과 접두어 둘뿐이다. 어떤
  // 파일이 그 실행의 보고서인지는 백엔드가 판정하므로 이 계층은 파일 이름을 만들지 않는다.
  listRunReports(path, workflowDirectory, targetId, resultPrefix) {
    return invoke<WorkflowReportSummary[]>("list_run_reports", {
      path,
      workflowDirectory,
      targetId,
      resultPrefix,
    });
  },

  readReport(path, workflowDirectory, fileName) {
    return invoke<ReportDocument>("read_report", {
      path,
      workflowDirectory,
      fileName,
    });
  },

  decideSpec(path, workflowDirectory, fileName, outcome, comment) {
    return invoke<ProjectSummary>("record_spec_decision", {
      path,
      workflowDirectory,
      fileName,
      outcome,
      comment,
    });
  },

  submitWorkGroupQa(path, submission: WorkGroupQaSubmission) {
    return invoke<WorkGroupQaSubmissionResult>("submit_work_group_qa", {
      path,
      submission,
    });
  },

  resumeTask(path, request: TaskResumeRequest) {
    return invoke<TaskResumeResult>("resume_task", { path, request });
  },

  recordTaskRevisionRequest(path, request: TaskRevisionRequestInput) {
    return invoke<TaskRevisionRequestResult>("record_task_revision_request", { path, request });
  },

  migrate(path) {
    return invoke<ProjectSummary>("migrate_project", { path });
  },

  inspectIntegrations(path) {
    return invoke<IntegrationsSnapshot>("inspect_integrations", { path });
  },

  installHeartbeatJobs(path, roles, baseline) {
    return invoke<IntegrationsSnapshot>("install_heartbeat_jobs", {
      path,
      roles,
      baseline,
    });
  },

  runHeartbeatJob(path, jobName) {
    return invoke<void>("run_heartbeat_job", { path, jobName });
  },

  // 인자가 없다. 실행 파일 후보를 만들 사용자 홈은 커맨드 계층이 해석하고, 화면이 준 문자열이
  // 명령줄에 닿는 경로가 없다.
  updateHeartbeat() {
    return invoke<HeartbeatUpdateResult>("update_heartbeat");
  },

  // 넘기는 것은 단계 식별자 하나다. 식별자 → 고정 인자의 매핑은 백엔드의 상수이고, 그 상수에 없는
  // 식별자는 프로세스를 띄우지 않고 실패로 끝난다.
  runHeartbeatSetupStep(step) {
    return invoke<HeartbeatSetupRunResult>("run_heartbeat_setup_step", { step });
  },

  // 인자가 없다. 이 커맨드는 프로세스를 하나 띄우므로 조회 주기에서는 부르지 않는다.
  checkHeartbeatVersions() {
    return invoke<HeartbeatVersions>("check_heartbeat_versions");
  },

  // 넘기는 것은 조작 식별자 하나다. 라벨도 plist 경로도 백엔드가 자기 파일 시스템에서 읽은 값이고,
  // 화면이 준 문자열이 명령줄에 닿는 경로가 없다.
  controlHeartbeatService(operation) {
    return invoke<HeartbeatServiceControlResult>("control_heartbeat_service", {
      operation,
    });
  },

  // 아래 열 개가 에이전트 런타임 계약이다. 앞의 넷은 읽기와 계획이라 아무것도 쓰지 않고, 나머지는
  // 사용자가 확인한 자리에서만 불린다. 인자는 식별자와 앱이 이미 들고 있는 값뿐이다.
  inspectAgentRuntime() {
    return invoke<AgentRuntimeInspection>("inspect_agent_runtime");
  },

  planAgentRuntimeInstall() {
    return invoke<AgentInstallPlan>("plan_agent_runtime_install");
  },

  applyAgentRuntimeInstall(planId, confirmed) {
    return invoke<AgentInstallApplication>("apply_agent_runtime_install", {
      planId,
      confirmed,
    });
  },

  planAgentRuntimeUpdate() {
    return invoke<AgentUpdatePlan>("plan_agent_runtime_update");
  },

  applyAgentRuntimeUpdate(planId, confirmed) {
    return invoke<AgentUpdateApplication>("apply_agent_runtime_update", {
      planId,
      confirmed,
    });
  },

  repairAgentRuntime(planId, confirmed) {
    return invoke<AgentUpdateApplication>("repair_agent_runtime", {
      planId,
      confirmed,
    });
  },

  readAgentRuntimePolicy(projectId, workingDirectory) {
    return invoke<AgentPolicySnapshot>("read_agent_runtime_policy", {
      projectId,
      workingDirectory,
    });
  },

  saveAgentRuntimePolicy(policy: AgentProjectPolicy, baselineRevision) {
    return invoke<AgentPolicySnapshot>("save_agent_runtime_policy", {
      policy,
      baselineRevision,
    });
  },

  grantAgentRuntimeConsent(projectId, noticeVersion) {
    return invoke<AgentProjectConsent>("grant_agent_runtime_consent", {
      projectId,
      noticeVersion,
    });
  },

  revokeAgentRuntimeConsent(projectId) {
    return invoke<AgentProjectConsent>("revoke_agent_runtime_consent", {
      projectId,
    });
  },

  previewAgentRuntimeMigration(path, projectId) {
    return invoke<AgentMigrationPreview>("preview_agent_runtime_migration", {
      path,
      projectId,
    });
  },

  applyAgentRuntimeMigration(path, projectId, previewId, baselineRevision) {
    return invoke<AgentPolicySnapshot>("apply_agent_runtime_migration", {
      path,
      projectId,
      previewId,
      baselineRevision,
    });
  },

  planAgentRun(projectId, roles: AgentRoleSlotRequest[]) {
    return invoke<AgentRunPlan>("plan_agent_run", { projectId, roles });
  },

  startAgentRun(projectId, planId, confirmed) {
    return invoke<AgentRunStartOutcome>("start_agent_run", {
      projectId,
      planId,
      confirmed,
    });
  },

  cancelAgentRun(projectId, runId, confirmed) {
    return invoke<AgentCancelOutcome>("cancel_agent_run", {
      projectId,
      runId,
      confirmed,
    });
  },

  retryAgentRun(projectId, runId) {
    return invoke<AgentRunSummary>("retry_agent_run", { projectId, runId });
  },

  inspectAgentRuns(projectId) {
    return invoke<AgentQueueSnapshot>("inspect_agent_runs", { projectId });
  },

  pauseAgentProject(projectId) {
    return invoke<AgentQueueSnapshot>("pause_agent_project", { projectId });
  },

  resumeAgentProject(projectId) {
    return invoke<AgentQueueSnapshot>("resume_agent_project", { projectId });
  },

  readAgentRunLog(projectId, runId, cursor) {
    return invoke<AgentRunLogPage>("read_agent_run_log", { projectId, runId, cursor });
  },

  // 위치를 고르는 것은 대화상자가, 그 위치에 쓰는 것은 백엔드 명령이 한다. 저장소에 파일 시스템
  // 플러그인이 없으므로 화면이 직접 파일을 만들지 않는다.
  chooseDiagnosticsFile(defaultFileName) {
    return save({
      defaultPath: defaultFileName,
      filters: [{ name: "진단 자료", extensions: ["json"] }],
      title: "실행 진단 자료 저장",
    });
  },

  exportAgentRunDiagnostics(projectId, runId, destination) {
    return invoke<string>("export_agent_run_diagnostics", {
      projectId,
      runId,
      destination,
    });
  },
};
