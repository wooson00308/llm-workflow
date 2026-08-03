import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DreamJobRequest,
  IntegrationActions,
  IntegrationsSnapshot,
  IntegrationsState,
  ManagedDreamJob,
  ManagedRoleJob,
  ProjectGateway,
  ProjectSummary,
  RecentProject,
  RecentProjectStore,
  RoleJobRequest,
  SpecDecisionOutcome,
  TaskQaOutcome,
} from "../domain/types";

interface Dependencies {
  gateway: ProjectGateway;
  recentStore: RecentProjectStore;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useProjectWorkspace({ gateway, recentStore }: Dependencies) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() =>
    recentStore.load(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsState>({
    snapshot: null,
    error: null,
    writeError: null,
  });

  const remember = useCallback(
    (next: ProjectSummary) => {
      if (next.initialized) {
        setRecentProjects(recentStore.remember(next));
      }
    },
    [recentStore],
  );

  const inspect = useCallback(
    async (path: string, silent = false) => {
      if (!silent) setBusy(true);
      setError(null);
      try {
        const next = await gateway.inspect(path);
        setProject(next);
        remember(next);
        return next;
      } catch (reason) {
        if (!silent) setError(messageFrom(reason));
        return null;
      } finally {
        if (!silent) setBusy(false);
      }
    },
    [gateway, remember],
  );

  const openFolder = useCallback(async () => {
    setError(null);
    try {
      const path = await gateway.chooseDirectory();
      if (path) await inspect(path);
    } catch (reason) {
      setError(messageFrom(reason));
    }
  }, [gateway, inspect]);

  const openRecent = useCallback((path: string) => inspect(path), [inspect]);

  const createWorkflow = useCallback(
    async (name: string) => {
      if (!project) return false;
      setBusy(true);
      setError(null);
      try {
        const next = await gateway.createWorkflow(project.rootPath, name);
        setProject(next);
        remember(next);
        return true;
      } catch (reason) {
        setError(messageFrom(reason));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [gateway, project, remember],
  );

  const createIdea = useCallback(
    async (workflowDirectory: string, content: string) => {
      if (!project) return false;
      setBusy(true);
      setError(null);
      try {
        const next = await gateway.createIdea(
          project.rootPath,
          workflowDirectory,
          content,
        );
        setProject(next);
        return true;
      } catch (reason) {
        setError(messageFrom(reason));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [gateway, project],
  );

  const refresh = useCallback(async () => {
    if (project) await inspect(project.rootPath);
  }, [inspect, project]);

  const readSpec = useCallback(
    async (workflowDirectory: string, fileName: string) => {
      if (!project) return null;
      setError(null);
      try {
        return await gateway.readSpec(
          project.rootPath,
          workflowDirectory,
          fileName,
        );
      } catch (reason) {
        setError(messageFrom(reason));
        return null;
      }
    },
    [gateway, project],
  );

  const readTask = useCallback(
    async (workflowDirectory: string, fileName: string) => {
      if (!project) return null;
      setError(null);
      try {
        return await gateway.readTask(
          project.rootPath,
          workflowDirectory,
          fileName,
        );
      } catch (reason) {
        setError(messageFrom(reason));
        return null;
      }
    },
    [gateway, project],
  );

  const readIdea = useCallback(
    async (workflowDirectory: string, fileName: string) => {
      if (!project) return null;
      setError(null);
      try {
        return await gateway.readIdea(
          project.rootPath,
          workflowDirectory,
          fileName,
        );
      } catch (reason) {
        setError(messageFrom(reason));
        return null;
      }
    },
    [gateway, project],
  );

  const decideSpec = useCallback(
    async (
      workflowDirectory: string,
      fileName: string,
      outcome: SpecDecisionOutcome,
      comment: string,
    ) => {
      if (!project) return false;
      setBusy(true);
      setError(null);
      try {
        const next = await gateway.decideSpec(
          project.rootPath,
          workflowDirectory,
          fileName,
          outcome,
          comment,
        );
        setProject(next);
        return true;
      } catch (reason) {
        setError(messageFrom(reason));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [gateway, project],
  );

  const recordTaskQa = useCallback(
    async (
      workflowDirectory: string,
      fileName: string,
      outcome: TaskQaOutcome,
      comment: string,
    ) => {
      if (!project) return false;
      setBusy(true);
      setError(null);
      try {
        const next = await gateway.recordTaskQa(
          project.rootPath,
          workflowDirectory,
          fileName,
          outcome,
          comment,
        );
        setProject(next);
        return true;
      } catch (reason) {
        setError(messageFrom(reason));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [gateway, project],
  );

  const migrate = useCallback(async () => {
    if (!project) return false;
    setBusy(true);
    setError(null);
    try {
      const next = await gateway.migrate(project.rootPath);
      setProject(next);
      return true;
    } catch (reason) {
      setError(messageFrom(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }, [gateway, project]);

  // 조회 실패를 화면 전체 에러로 올리지 않는다. 2.5초마다 실패가 반복되면 앱을 쓸 수 없다.
  // 쓰기 실패 문구는 조회가 지우지 않는다. 2.5초 뒤에 사라지면 사용자가 읽을 수 없다.
  const readIntegrations = useCallback(
    async (path: string) => {
      try {
        const snapshot = await gateway.inspectIntegrations(path);
        setIntegrations((previous) => ({ ...previous, snapshot, error: null }));
      } catch (reason) {
        setIntegrations((previous) => ({
          ...previous,
          snapshot: null,
          error: messageFrom(reason),
        }));
      }
    },
    [gateway],
  );

  // 전역 파일 `~/.claude/HEARTBEAT.md`를 쓰는 유일한 경로다. 화면이 확인을 받은 뒤에만 부른다.
  // 실패 사유는 요청한 연동 id와 함께 담는다. 그래야 그 연동 카드에서만 문구가 보인다.
  const writeIntegration = useCallback(
    async (
      integration: string,
      write: (path: string) => Promise<IntegrationsSnapshot>,
    ) => {
      if (!project) return false;
      setBusy(true);
      try {
        const snapshot = await write(project.rootPath);
        setIntegrations({ snapshot, error: null, writeError: null });
        return true;
      } catch (reason) {
        setIntegrations((previous) => ({
          ...previous,
          writeError: { integration, message: messageFrom(reason) },
        }));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [project],
  );

  // 기준값은 화면이 폼을 시딩할 때 읽은 관리 블록의 값이다. 훅은 내용을 들여다보지 않고 그대로
  // 넘긴다. 대조는 쓰기 직전의 파일을 아는 백엔드가 한다.
  const installHeartbeatJobs = useCallback(
    (roles: RoleJobRequest[], baseline: ManagedRoleJob[]) =>
      writeIntegration("heartbeat", (path) =>
        gateway.installHeartbeatJobs(path, roles, baseline),
      ),
    [gateway, writeIntegration],
  );

  const installDreamJob = useCallback(
    (dream: DreamJobRequest, baseline: ManagedDreamJob | null) =>
      writeIntegration("dream", (path) =>
        gateway.installDreamJob(path, dream, baseline),
      ),
    [gateway, writeIntegration],
  );

  // 연동 카드가 받는 쓰기 액션 묶음. 연동이 늘면 여기에 항목이 하나 더 붙는다.
  const integrationActions = useMemo<IntegrationActions>(
    () => ({ installHeartbeatJobs, installDreamJob }),
    [installDreamJob, installHeartbeatJobs],
  );

  useEffect(() => {
    if (!project?.initialized) return;
    const path = project.rootPath;
    void readIntegrations(path);
    const timer = window.setInterval(() => {
      void inspect(path, true);
      void readIntegrations(path);
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [inspect, readIntegrations, project?.initialized, project?.rootPath]);

  return {
    project,
    recentProjects,
    busy,
    error,
    integrations,
    integrationActions,
    openFolder,
    openRecent,
    createWorkflow,
    createIdea,
    readSpec,
    readTask,
    readIdea,
    recordTaskQa,
    decideSpec,
    refresh,
    migrate,
    closeProject: () => {
      setProject(null);
      setError(null);
      setIntegrations({ snapshot: null, error: null, writeError: null });
    },
  };
}
