import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ProjectGateway,
  ProjectSummary,
  SpecDocument,
} from "../domain/types";

export const tauriProjectGateway: ProjectGateway = {
  async chooseDirectory() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Workflow Labs 프로젝트 폴더 선택",
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

  decideSpec(path, workflowDirectory, fileName, outcome, comment) {
    return invoke<ProjectSummary>("record_spec_decision", {
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
};
