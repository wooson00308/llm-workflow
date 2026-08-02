import { useCallback, useEffect, useState } from "react";
import type {
  HeartbeatState,
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
  const [heartbeat, setHeartbeat] = useState<HeartbeatState>({
    integration: null,
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
  const readHeartbeat = useCallback(
    async (path: string) => {
      try {
        const integration = await gateway.inspectHeartbeat(path);
        setHeartbeat((previous) => ({ ...previous, integration, error: null }));
      } catch (reason) {
        setHeartbeat((previous) => ({
          ...previous,
          integration: null,
          error: messageFrom(reason),
        }));
      }
    },
    [gateway],
  );

  // 전역 파일 `~/.claude/HEARTBEAT.md`를 쓰는 유일한 경로다. 화면이 확인을 받은 뒤에만 부른다.
  const installHeartbeatJobs = useCallback(
    async (roles: RoleJobRequest[]) => {
      if (!project) return false;
      setBusy(true);
      try {
        const integration = await gateway.installHeartbeatJobs(
          project.rootPath,
          roles,
        );
        setHeartbeat({ integration, error: null, writeError: null });
        return true;
      } catch (reason) {
        setHeartbeat((previous) => ({
          ...previous,
          writeError: messageFrom(reason),
        }));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [gateway, project],
  );

  useEffect(() => {
    if (!project?.initialized) return;
    const path = project.rootPath;
    void readHeartbeat(path);
    const timer = window.setInterval(() => {
      void inspect(path, true);
      void readHeartbeat(path);
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [inspect, readHeartbeat, project?.initialized, project?.rootPath]);

  return {
    project,
    recentProjects,
    busy,
    error,
    heartbeat,
    installHeartbeatJobs,
    openFolder,
    openRecent,
    createWorkflow,
    createIdea,
    readSpec,
    readTask,
    recordTaskQa,
    decideSpec,
    refresh,
    migrate,
    closeProject: () => {
      setProject(null);
      setError(null);
      setHeartbeat({ integration: null, error: null, writeError: null });
    },
  };
}
