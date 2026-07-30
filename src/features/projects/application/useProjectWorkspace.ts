import { useCallback, useEffect, useState } from "react";
import type {
  ProjectGateway,
  ProjectSummary,
  RecentProject,
  RecentProjectStore,
  SpecDecisionOutcome,
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

  useEffect(() => {
    if (!project?.initialized) return;
    const path = project.rootPath;
    const timer = window.setInterval(() => void inspect(path, true), 2_500);
    return () => window.clearInterval(timer);
  }, [inspect, project?.initialized, project?.rootPath]);

  return {
    project,
    recentProjects,
    busy,
    error,
    openFolder,
    openRecent,
    createWorkflow,
    createIdea,
    readSpec,
    decideSpec,
    refresh,
    migrate,
    closeProject: () => {
      setProject(null);
      setError(null);
    },
  };
}
