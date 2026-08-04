import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  IdeaDocument,
  IntegrationsSnapshot,
  ProjectGateway,
  ProjectSummary,
  SpecDocument,
  TaskDocument,
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
};
