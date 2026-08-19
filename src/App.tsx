import { useMemo } from "react";
import "./App.css";
import { ProjectPicker } from "./features/projects/components/ProjectPicker";
import { ProjectSetup } from "./features/projects/components/ProjectSetup";
import { WorkspaceShell } from "./features/projects/components/WorkspaceShell";
import { useProjectWorkspace } from "./features/projects/application/useProjectWorkspace";
import { browserRecentProjectStore } from "./features/projects/infrastructure/browserRecentProjectStore";
import { tauriProjectGateway } from "./features/projects/infrastructure/tauriProjectGateway";
import { useAppUpdater } from "./features/updater/application/useAppUpdater";
import { tauriUpdaterGateway } from "./features/updater/infrastructure/tauriUpdaterGateway";

export default function App() {
  const projectDependencies = useMemo(
    () => ({
      gateway: tauriProjectGateway,
      recentStore: browserRecentProjectStore,
    }),
    [],
  );
  const workspace = useProjectWorkspace(projectDependencies);
  const updater = useAppUpdater(tauriUpdaterGateway);

  if (!workspace.project) {
    return (
      <ProjectPicker
        busy={workspace.busy}
        error={workspace.error}
        recentProjects={workspace.recentProjects}
        onOpenFolder={workspace.openFolder}
        onOpenRecent={workspace.openRecent}
      />
    );
  }

  if (!workspace.project.initialized) {
    return (
      <ProjectSetup
        busy={workspace.busy}
        error={workspace.error}
        project={workspace.project}
        onBack={workspace.closeProject}
        onCreate={workspace.createWorkflow}
      />
    );
  }

  return (
    <WorkspaceShell
      agentRuntime={workspace.agentRuntime}
      agentRuntimeActions={workspace.agentRuntimeActions}
      busy={workspace.busy}
      customRules={workspace.customRules}
      customRulesActions={workspace.customRulesActions}
      error={workspace.error}
      managedAssets={workspace.managedAssets}
      project={workspace.project}
      updater={updater}
      onAddIdea={workspace.createIdea}
      onAddWorkflow={workspace.createWorkflow}
      onDecideSpec={workspace.decideSpec}
      onMigrate={workspace.migrate}
      onReadIdea={workspace.readIdea}
      onReadSpec={workspace.readSpec}
      onReadTask={workspace.readTask}
      onWorkGroupQaSubmit={workspace.submitWorkGroupQa}
      onWorkGroupLifecycle={workspace.recordWorkGroupLifecycle}
      onRefresh={workspace.refresh}
      onSwitchProject={workspace.closeProject}
    />
  );
}
