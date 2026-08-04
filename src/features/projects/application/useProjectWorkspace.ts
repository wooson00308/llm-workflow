import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DreamJobRequest,
  HeartbeatRunFailure,
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

/** 조회·쓰기 상태만 담는 부분. 실행 상태는 수명이 달라 이 묶음에 들어가지 않는다. */
type IntegrationsReadState = Omit<IntegrationsState, "heartbeatRuns">;

/** 화면에 그릴 실행 상태. `run`은 훅이 붙이므로 여기에는 값만 담는다. */
interface HeartbeatRunState {
  running: string[];
  failure: HeartbeatRunFailure | null;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 백엔드가 계약 모양(`jobName`·`message`·`command`)으로 거절했는가.
 *
 * `command`가 비어 있으면 계약을 채우지 못한 값으로 본다. 화면이 명령 없이 "직접 실행하세요"라고
 * 말하면 사용자가 할 수 있는 일이 없다.
 */
function isRunFailure(reason: unknown): reason is HeartbeatRunFailure {
  if (typeof reason !== "object" || reason === null) return false;
  const value = reason as Partial<HeartbeatRunFailure>;
  return (
    typeof value.jobName === "string" &&
    typeof value.message === "string" &&
    typeof value.command === "string" &&
    value.command !== ""
  );
}

/**
 * 실패 값을 만든다. 백엔드가 준 값이 계약 모양이면 그대로 쓴다.
 *
 * 그 밖의 거절(커맨드 자체가 없거나 IPC가 끊긴 경우)에는 사유만 살리고 명령은 채운다. 이 문자열의
 * 원천은 백엔드(`heartbeat_process::manual_command`)이며 여기 값은 그 경로가 답하지 못했을 때만 쓴다.
 */
function failureFrom(reason: unknown, jobName: string): HeartbeatRunFailure {
  if (isRunFailure(reason)) return reason;
  return {
    jobName,
    message: messageFrom(reason),
    command: `heartbeat once -j ${jobName}`,
  };
}

export function useProjectWorkspace({ gateway, recentStore }: Dependencies) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() =>
    recentStore.load(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsReadState>({
    snapshot: null,
    error: null,
    writeError: null,
  });
  // 실행 상태는 조회·쓰기 상태와 따로 둔다. 한 객체에 담으면 잡 설정 저장의 통째 교체가 진행 중
  // 표시를 지우고, 프로젝트를 닫는 것이 실행을 취소한 것처럼 보인다(R3).
  const [heartbeatRuns, setHeartbeatRuns] = useState<HeartbeatRunState>({
    running: [],
    failure: null,
  });
  // 겹쳐 실행을 막는 판정은 ref로 한다. 같은 tick에 두 번 눌리면 state는 아직 갱신 전이라
  // 두 호출이 모두 통과한다.
  const runningJobs = useRef<string[]>([]);

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

  // 잡 하나를 지금 한 번 실행한다. 사용자가 누른 자리에서만 불린다 — 조회 주기와 프로젝트 열기
  // 경로는 이 함수를 부르지 않는다(R7).
  const runHeartbeatJob = useCallback(
    async (jobName: string) => {
      if (!project) return false;
      if (runningJobs.current.includes(jobName)) return false;

      runningJobs.current = [...runningJobs.current, jobName];
      // 이 실행에 한해 지난 실패를 지운다. 같은 잡을 다시 돌리는데 옛 사유가 남아 있으면 안 된다.
      setHeartbeatRuns({ running: runningJobs.current, failure: null });
      try {
        await gateway.runHeartbeatJob(project.rootPath, jobName);
        return true;
      } catch (reason) {
        setHeartbeatRuns((previous) => ({
          ...previous,
          failure: failureFrom(reason, jobName),
        }));
        return false;
      } finally {
        runningJobs.current = runningJobs.current.filter(
          (name) => name !== jobName,
        );
        const running = runningJobs.current;
        setHeartbeatRuns((previous) => ({ ...previous, running }));
      }
    },
    [gateway, project],
  );

  // 연동 섹션이 한 번에 받는 묶음. 실행 상태는 따로 살다가 여기에서만 합쳐진다.
  const integrationsState = useMemo<IntegrationsState>(
    () => ({
      ...integrations,
      heartbeatRuns: { ...heartbeatRuns, run: runHeartbeatJob },
    }),
    [heartbeatRuns, integrations, runHeartbeatJob],
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
    integrations: integrationsState,
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
    // 진행 중인 실행은 여기서 비우지 않는다. 잡 이름에 프로젝트 slug가 들어 있어 다른 프로젝트의
    // 카드에는 그려지지 않고, 비우면 아직 돌고 있는 잡의 버튼이 다시 눌리는 상태로 돌아온다(R3).
    closeProject: () => {
      setProject(null);
      setError(null);
      setIntegrations({ snapshot: null, error: null, writeError: null });
    },
  };
}
