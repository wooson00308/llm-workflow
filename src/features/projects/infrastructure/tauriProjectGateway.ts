import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
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
  SaveCustomRulesRequest,
  SaveCustomRulesResult,
  SpecDocument,
  TaskDocument,
  TaskQaBatchResult,
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

  decideSpec(path, workflowDirectory, fileName, outcome, comment) {
    return invoke<ProjectSummary>("record_spec_decision", {
      path,
      workflowDirectory,
      fileName,
      outcome,
      comment,
    });
  },

  recordTaskQa(path, workflowDirectory, fileName, outcome, comment) {
    return invoke<ProjectSummary>("record_task_qa", {
      path,
      workflowDirectory,
      fileName,
      outcome,
      comment,
    });
  },

  confirmTaskQaBatch(path, workflowDirectory, fileNames, comment) {
    return invoke<TaskQaBatchResult>("confirm_task_qa_batch", {
      path,
      workflowDirectory,
      fileNames,
      comment,
    });
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

  installDreamJob(path, dream, baseline) {
    return invoke<IntegrationsSnapshot>("install_dream_job", {
      path,
      dream,
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
};
