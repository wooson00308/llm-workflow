import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CustomRulesActions,
  CustomRulesDocument,
  CustomRulesDraft,
  CustomRulesPreview,
  CustomRulesState,
  HeartbeatRunFailure,
  HeartbeatServiceOperation,
  HeartbeatServiceOutcome,
  HeartbeatSetupRunResult,
  HeartbeatSetupStep,
  HeartbeatUpdateResult,
  HeartbeatVersions,
  IntegrationActions,
  IntegrationsSnapshot,
  IntegrationsState,
  ManagedAssetsState,
  ManagedAssetSyncTrigger,
  ManagedRoleJob,
  ProjectGateway,
  ProjectSummary,
  RecentProject,
  RecentProjectStore,
  RoleJobRequest,
  SaveCustomRulesResult,
  SpecDecisionOutcome,
  TaskQaBatchEntry,
  TaskQaOutcome,
  TaskResumeOutcome,
  TaskRevisionRequestOutcome,
  WorkflowReportSummary,
  AgentProjectPolicy,
  AgentRunSummary,
  AgentRuntimeActions,
  AgentRuntimeOperation,
  AgentRuntimeState,
  AgentRoleSlotRequest,
} from "../domain/types";
import { copy } from "../infrastructure/clipboard";

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

/** 화면에 그릴 업데이트 상태. `update`는 훅이 붙이므로 여기에는 값만 담는다. */
interface HeartbeatUpdateState {
  running: boolean;
  result: HeartbeatUpdateResult | null;
}

/** 화면에 그릴 설치 단계 실행 상태. `run`은 훅이 붙이므로 여기에는 값만 담는다. */
interface HeartbeatSetupRunState {
  running: HeartbeatSetupStep[];
  results: Partial<Record<HeartbeatSetupStep, HeartbeatSetupRunResult>>;
}

/** 화면에 그릴 버전 판정 상태. `check`는 훅이 붙이므로 여기에는 값만 담는다. */
interface HeartbeatVersionState {
  checking: boolean;
  versions: HeartbeatVersions | null;
  error: string | null;
}

/** 화면에 그릴 데몬 조작 상태. `control`은 훅이 붙이므로 여기에는 값만 담는다. */
interface HeartbeatServiceState {
  running: HeartbeatServiceOperation | null;
  outcome: HeartbeatServiceOutcome | null;
  error: string | null;
}

function emptyCustomRulesState(): CustomRulesState {
  return {
    document: null,
    reading: false,
    previewing: false,
    saving: false,
    preview: null,
    previewBaselineContentHash: null,
    saveResult: null,
    readError: null,
    previewError: null,
    saveError: null,
  };
}

function sameCustomRulesDocument(
  previous: CustomRulesDocument | null,
  next: CustomRulesDocument,
): boolean {
  return (
    previous?.status === next.status &&
    previous.contentHash === next.contentHash
  );
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 번들 런타임이 설치본보다 새 버전인가. 점으로 나뉜 숫자 표기만 비교하고, 숫자가 아닌 조각이
 * 있으면 거짓이다 — 자동 업데이트는 확신이 있을 때만 움직이고, 애매하면 수동 경로에 맡긴다.
 */
export function bundledRuntimeIsNewer(bundled: string, installed: string): boolean {
  const left = bundled.split(".");
  const right = installed.split(".");
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = Number(left[index] ?? "0");
    const b = Number(right[index] ?? "0");
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (a !== b) return a > b;
  }
  return false;
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

/** 프로젝트를 열기 전과 닫은 뒤의 에이전트 상태. 프로젝트가 바뀌면 이 값으로 되돌린다. */
const emptyAgentRuntime: AgentRuntimeState = {
  inspection: null,
  policy: null,
  reading: false,
  readError: null,
  planning: null,
  plan: null,
  planError: null,
  applying: false,
  application: null,
  applyError: null,
  migration: null,
  migrationBusy: false,
  migrationError: null,
  saving: false,
  saveError: null,
  runPlan: null,
  runRequests: [],
  runPlanning: false,
  runStarting: false,
  runError: null,
  queue: null,
  queueReading: false,
  queueError: null,
  pausing: false,
  cancelPreview: null,
  cancelResult: null,
  retryPreview: null,
  controllingRunId: null,
  controlError: null,
  logs: {},
  readingLogRunId: null,
  logError: null,
  logWatchRunId: null,
  runReports: {},
  reportView: null,
  diagnosticExport: null,
};

export function useProjectWorkspace({ gateway, recentStore }: Dependencies) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() =>
    recentStore.load(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managedAssets, setManagedAssets] = useState<ManagedAssetsState>({
    syncing: false,
    result: null,
    error: null,
    trigger: null,
  });
  const [customRules, setCustomRules] = useState<CustomRulesState>(
    emptyCustomRulesState,
  );
  const [integrations, setIntegrations] = useState<IntegrationsReadState>({
    snapshot: null,
    error: null,
    writeError: null,
  });
  const [agentViewActive, setAgentViewActive] = useState(false);
  // 실행 상태는 조회·쓰기 상태와 따로 둔다. 한 객체에 담으면 잡 설정 저장의 통째 교체가 진행 중
  // 표시를 지우고, 프로젝트를 닫는 것이 실행을 취소한 것처럼 보인다(R3).
  const [heartbeatRuns, setHeartbeatRuns] = useState<HeartbeatRunState>({
    running: [],
    failure: null,
  });
  // 업데이트도 조회·쓰기 상태와 따로 둔다. 실행 상태와 나누는 것은 수명이 아니라 소유하는 사실이
  // 달라서다 — 잡 하나의 실행과 설치본 전체의 갱신은 서로를 가리지 않아야 한다(R9).
  const [heartbeatUpdate, setHeartbeatUpdate] = useState<HeartbeatUpdateState>({
    running: false,
    result: null,
  });
  // 설치 단계 실행도 따로 둔다. 잡 실행·업데이트와 같은 이유이고, 단계마다 결과를 나눠 담는 것은
  // 한 단계의 결과가 다른 단계의 자리에 나타나지 않게 하기 위해서다.
  const [heartbeatSetupRuns, setHeartbeatSetupRuns] = useState<HeartbeatSetupRunState>({
    running: [],
    results: {},
  });
  // 버전 판정은 조회 주기가 부르지 않는 값이라 스냅샷과 수명이 다르다. 주기가 도는 동안 이 값은
  // 그대로 남고, 새로 읽는 것은 사용자가 카드를 펼치거나 업데이트가 끝난 자리뿐이다.
  const [heartbeatVersions, setHeartbeatVersions] = useState<HeartbeatVersionState>({
    checking: false,
    versions: null,
    error: null,
  });
  // 데몬 조작도 따로 둔다. 이 값은 프로젝트가 아니라 기기 하나의 데몬에 대한 사실이라 조회·쓰기
  // 상태와 수명이 다르고, 조회 주기가 이 값을 지우지도 만들지도 않는다.
  const [heartbeatService, setHeartbeatService] = useState<HeartbeatServiceState>({
    running: null,
    outcome: null,
    error: null,
  });
  // 겹쳐 실행을 막는 판정은 ref로 한다. 같은 tick에 두 번 눌리면 state는 아직 갱신 전이라
  // 두 호출이 모두 통과한다.
  const runningJobs = useRef<string[]>([]);
  const updating = useRef(false);
  const runningSteps = useRef<HeartbeatSetupStep[]>([]);
  const checkingVersions = useRef(false);
  const controllingService = useRef(false);
  const activeProjectPath = useRef<string | null>(null);
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntimeState>(
    emptyAgentRuntime,
  );
  // 실행별로 다음에 읽을 위치. 이어 읽기 주기가 이 값을 읽으므로 상태에 두면 한 번 읽을 때마다
  // 읽기 함수의 신원이 바뀌고 주기가 스스로를 다시 세운다.
  const agentLogCursors = useRef<Record<string, number>>({});
  const customRulesReadRequest = useRef(0);
  const customRulesPreviewRequest = useRef(0);
  const customRulesSaveRequest = useRef(0);
  const savingCustomRules = useRef(false);

  const remember = useCallback(
    (next: ProjectSummary) => {
      if (next.initialized) {
        setRecentProjects(recentStore.remember(next));
      }
    },
    [recentStore],
  );

  /**
   * 기기 상태와 이 프로젝트의 정책을 읽는다. 읽기 명령 둘만 부르므로 화면 진입과 새로고침에서
   * 불러도 아무것도 쓰지 않는다(R14). 계획과 적용 결과는 지우지 않는다 — 조회가 진행 표시를
   * 덮으면 다른 메뉴를 다녀온 사용자가 자기 조작의 결과를 잃는다.
   */
  const readAgentRuntime = useCallback(
    async (path: string, projectId: string | null) => {
      setAgentRuntime((current) => ({ ...current, reading: true, readError: null }));
      try {
        const inspection = await gateway.inspectAgentRuntime();
        if (activeProjectPath.current !== path) return;
        setAgentRuntime((current) => ({ ...current, inspection }));
        // 정책은 프로젝트 식별자가 있어야 읽는다. 초기화되지 않은 폴더에는 정책 자체가 없다.
        if (!projectId) {
          setAgentRuntime((current) => ({
            ...current,
            policy: null,
            reading: false,
          }));
          return;
        }
        try {
          const policy = await gateway.readAgentRuntimePolicy(projectId, path);
          if (activeProjectPath.current !== path) return;
          setAgentRuntime((current) => ({
            ...current,
            policy,
            reading: false,
          }));
        } catch (reason) {
          if (activeProjectPath.current !== path) return;
          setAgentRuntime((current) => ({
            ...current,
            reading: false,
            readError: messageFrom(reason),
          }));
        }
      } catch (reason) {
        if (activeProjectPath.current !== path) return;
        setAgentRuntime((current) => ({
          ...current,
          reading: false,
          readError: messageFrom(reason),
        }));
      }
    },
    [gateway],
  );

  /** 런타임의 영속 큐를 읽는다. 프로젝트를 바꾸면 늦게 온 이전 응답은 버린다. */
  const readAgentRuns = useCallback(
    async (path: string, projectId: string, silent = false) => {
      if (!silent) {
        setAgentRuntime((current) => ({ ...current, queueReading: true, queueError: null }));
      }
      try {
        const queue = await gateway.inspectAgentRuns(projectId);
        if (activeProjectPath.current !== path) return;
        setAgentRuntime((current) => ({
          ...current,
          queue,
          queueReading: false,
          queueError: queue.unavailable,
        }));
      } catch (reason) {
        if (activeProjectPath.current !== path) return;
        setAgentRuntime((current) => ({
          ...current,
          queueReading: false,
          queueError: messageFrom(reason),
        }));
      }
    },
    [gateway],
  );

  const planAgentRun = useCallback(
    async (requests: AgentRoleSlotRequest[]) => {
      if (!project?.projectId) return;
      setAgentRuntime((current) => ({
        ...current,
        runPlanning: true,
        runPlan: null,
        runRequests: requests,
        runError: null,
      }));
      try {
        const runPlan = await gateway.planAgentRun(project.projectId, requests);
        if (activeProjectPath.current !== project.rootPath) return;
        setAgentRuntime((current) => ({ ...current, runPlanning: false, runPlan }));
      } catch (reason) {
        if (activeProjectPath.current !== project.rootPath) return;
        setAgentRuntime((current) => ({
          ...current,
          runPlanning: false,
          runPlan: null,
          runError: messageFrom(reason),
        }));
      }
    },
    [gateway, project?.projectId, project?.rootPath],
  );

  const cancelAgentRunPlan = useCallback(() => {
    setAgentRuntime((current) => ({ ...current, runPlan: null, runError: null }));
  }, []);

  const startAgentRun = useCallback(async () => {
    const plan = agentRuntime.runPlan;
    if (!plan || !project?.projectId) return false;
    setAgentRuntime((current) => ({ ...current, runStarting: true, runError: null }));
    try {
      await gateway.startAgentRun(project.projectId, plan.planId, true);
      if (activeProjectPath.current !== project.rootPath) return false;
      setAgentRuntime((current) => ({
        ...current,
        runStarting: false,
        runPlan: null,
      }));
      await readAgentRuns(project.rootPath, project.projectId);
      return true;
    } catch (reason) {
      if (activeProjectPath.current !== project.rootPath) return false;
      const message = messageFrom(reason);
      const stale = /계획|stale|revision|expired|만료/i.test(message);
      if (stale && agentRuntime.runRequests.length > 0) {
        try {
          const runPlan = await gateway.planAgentRun(
            project.projectId,
            agentRuntime.runRequests,
          );
          if (activeProjectPath.current !== project.rootPath) return false;
          setAgentRuntime((current) => ({
            ...current,
            runStarting: false,
            runPlan,
            runError: "계획이 변경되었습니다. 최신 계획을 다시 확인해 주세요.",
          }));
          return false;
        } catch (refreshReason) {
          setAgentRuntime((current) => ({
            ...current,
            runStarting: false,
            runPlan: null,
            runError: messageFrom(refreshReason),
          }));
          return false;
        }
      }
      setAgentRuntime((current) => ({
        ...current,
        runStarting: false,
        runPlan: null,
        runError: message,
      }));
      return false;
    }
  }, [agentRuntime.runPlan, agentRuntime.runRequests, gateway, project, readAgentRuns]);

  const setAgentProjectPaused = useCallback(
    async (paused: boolean) => {
      if (!project?.projectId) return false;
      setAgentRuntime((current) => ({ ...current, pausing: true, controlError: null }));
      try {
        const queue = paused
          ? await gateway.pauseAgentProject(project.projectId)
          : await gateway.resumeAgentProject(project.projectId);
        if (activeProjectPath.current !== project.rootPath) return false;
        setAgentRuntime((current) => ({ ...current, pausing: false, queue }));
        return true;
      } catch (reason) {
        if (activeProjectPath.current !== project.rootPath) return false;
        setAgentRuntime((current) => ({
          ...current,
          pausing: false,
          controlError: messageFrom(reason),
        }));
        return false;
      }
    },
    [gateway, project],
  );

  const previewAgentRunCancel = useCallback(
    async (runId: string) => {
      if (!project?.projectId) return;
      setAgentRuntime((current) => ({
        ...current,
        controllingRunId: runId,
        cancelPreview: null,
        cancelResult: null,
        controlError: null,
      }));
      try {
        const outcome = await gateway.cancelAgentRun(project.projectId, runId, false);
        if (activeProjectPath.current !== project.rootPath) return;
        setAgentRuntime((current) => ({
          ...current,
          controllingRunId: null,
          cancelPreview: outcome.kind === "preview" ? outcome.preview : null,
          cancelResult: outcome.kind === "preview" ? null : outcome,
        }));
      } catch (reason) {
        if (activeProjectPath.current !== project.rootPath) return;
        setAgentRuntime((current) => ({
          ...current,
          controllingRunId: null,
          controlError: messageFrom(reason),
        }));
      }
    },
    [gateway, project],
  );

  const dismissAgentRunCancel = useCallback(() => {
    setAgentRuntime((current) => ({ ...current, cancelPreview: null }));
  }, []);

  const confirmAgentRunCancel = useCallback(async () => {
    const preview = agentRuntime.cancelPreview;
    if (!preview || !project?.projectId) return false;
    setAgentRuntime((current) => ({
      ...current,
      controllingRunId: preview.runId,
      controlError: null,
    }));
    try {
      const outcome = await gateway.cancelAgentRun(project.projectId, preview.runId, true);
      if (activeProjectPath.current !== project.rootPath) return false;
      setAgentRuntime((current) => ({
        ...current,
        controllingRunId: null,
        cancelPreview: null,
        cancelResult: outcome,
      }));
      await readAgentRuns(project.rootPath, project.projectId);
      return outcome.kind === "applied";
    } catch (reason) {
      if (activeProjectPath.current !== project.rootPath) return false;
      setAgentRuntime((current) => ({
        ...current,
        controllingRunId: null,
        controlError: messageFrom(reason),
      }));
      return false;
    }
  }, [agentRuntime.cancelPreview, gateway, project, readAgentRuns]);

  const previewAgentRunRetry = useCallback((runId: string) => {
    setAgentRuntime((current) => ({
      ...current,
      retryPreview: current.queue?.runs.find((run) => run.runId === runId) ?? null,
      controlError: null,
    }));
  }, []);

  const dismissAgentRunRetry = useCallback(() => {
    setAgentRuntime((current) => ({ ...current, retryPreview: null }));
  }, []);

  const confirmAgentRunRetry = useCallback(async () => {
    const previous = agentRuntime.retryPreview;
    if (!previous || !project?.projectId) return false;
    setAgentRuntime((current) => ({
      ...current,
      controllingRunId: previous.runId,
      controlError: null,
    }));
    try {
      const next = await gateway.retryAgentRun(project.projectId, previous.runId);
      if (activeProjectPath.current !== project.rootPath) return false;
      setAgentRuntime((current) => ({
        ...current,
        controllingRunId: null,
        retryPreview: null,
        queue: current.queue
          ? { ...current.queue, runs: [...current.queue.runs, next] }
          : current.queue,
      }));
      await readAgentRuns(project.rootPath, project.projectId);
      return true;
    } catch (reason) {
      if (activeProjectPath.current !== project.rootPath) return false;
      setAgentRuntime((current) => ({
        ...current,
        controllingRunId: null,
        controlError: messageFrom(reason),
      }));
      return false;
    }
  }, [agentRuntime.retryPreview, gateway, project, readAgentRuns]);

  const readAgentRunLog = useCallback(
    async (runId: string) => {
      if (!project?.projectId) return;
      const cursor = agentLogCursors.current[runId] ?? 0;
      setAgentRuntime((current) => ({
        ...current,
        readingLogRunId: runId,
        logError: null,
      }));
      try {
        const page = await gateway.readAgentRunLog(project.projectId, runId, cursor);
        if (activeProjectPath.current !== project.rootPath) return;
        agentLogCursors.current[runId] = page.nextCursor;
        setAgentRuntime((current) => {
          const previous = current.logs[runId];
          return {
            ...current,
            readingLogRunId: null,
            logs: {
              ...current.logs,
              [runId]: {
                ...page,
                events: [...(previous?.events ?? []), ...page.events],
              },
            },
          };
        });
      } catch (reason) {
        if (activeProjectPath.current !== project.rootPath) return;
        setAgentRuntime((current) => ({
          ...current,
          readingLogRunId: null,
          logError: messageFrom(reason),
        }));
      }
    },
    [gateway, project],
  );

  /** 이어 읽을 실행을 정하거나(`runId`) 읽기를 멈춘다(`null`). 주기 자체는 아래 effect가 관리한다. */
  const watchAgentRunLog = useCallback((runId: string | null) => {
    setAgentRuntime((current) =>
      current.logWatchRunId === runId ? current : { ...current, logWatchRunId: runId },
    );
  }, []);

  const readAgentRunReports = useCallback(
    async (run: AgentRunSummary, workflowDirectory: string) => {
      if (!project) return;
      try {
        const reports = await gateway.listRunReports(
          project.rootPath,
          workflowDirectory,
          run.targetId,
          run.resultPrefix,
        );
        if (activeProjectPath.current !== project.rootPath) return;
        setAgentRuntime((current) => ({
          ...current,
          runReports: { ...current.runReports, [run.runId]: reports },
        }));
      } catch {
        if (activeProjectPath.current !== project.rootPath) return;
        // 연결을 확인하지 못한 실행은 자리를 비운다. 직전에 읽은 목록을 지금의 사실로 남기면
        // 사라진 보고서의 바로가기가 계속 열려 있게 된다.
        setAgentRuntime((current) => {
          if (!(run.runId in current.runReports)) return current;
          const remaining = { ...current.runReports };
          delete remaining[run.runId];
          return { ...current, runReports: remaining };
        });
      }
    },
    [gateway, project],
  );

  const openAgentReport = useCallback(
    async (workflowDirectory: string, report: WorkflowReportSummary) => {
      if (!project) return;
      setAgentRuntime((current) => ({
        ...current,
        reportView: {
          fileName: report.fileName,
          title: report.title,
          body: null,
          reading: true,
          error: null,
        },
      }));
      try {
        const document = await gateway.readReport(
          project.rootPath,
          workflowDirectory,
          report.fileName,
        );
        if (activeProjectPath.current !== project.rootPath) return;
        // 읽는 동안 다른 보고서로 옮겨 갔으면 그 화면에 이 본문을 싣지 않는다.
        setAgentRuntime((current) =>
          current.reportView?.fileName === report.fileName
            ? {
                ...current,
                reportView: {
                  fileName: report.fileName,
                  title: document.summary.title,
                  body: document.body,
                  reading: false,
                  error: null,
                },
              }
            : current,
        );
      } catch (reason) {
        if (activeProjectPath.current !== project.rootPath) return;
        setAgentRuntime((current) =>
          current.reportView?.fileName === report.fileName
            ? {
                ...current,
                reportView: {
                  ...current.reportView,
                  body: null,
                  reading: false,
                  error: messageFrom(reason),
                },
              }
            : current,
        );
      }
    },
    [gateway, project],
  );

  const closeAgentReport = useCallback(() => {
    setAgentRuntime((current) =>
      current.reportView ? { ...current, reportView: null } : current,
    );
  }, []);

  /**
   * 실행 하나의 진단 자료를 저장하거나 복사한다.
   *
   * 저장은 위치를 먼저 묻는다. 사용자가 고르지 않고 닫으면 내보내기 명령을 부르지 않으므로 파일이
   * 만들어지지 않는다. 복사는 위치를 묻지 않고 조립한 내용을 클립보드에 넣는다. 두 경로 모두 같은
   * 백엔드 명령 하나를 지나고, 외부로 보내는 자리는 어디에도 없다.
   */
  const exportAgentRunDiagnostics = useCallback(
    async (runId: string, mode: "save" | "copy") => {
      if (!project?.projectId) return;
      let destination: string | null = null;
      if (mode === "save") {
        destination = await gateway.chooseDiagnosticsFile(`${runId}-diagnostics.json`);
        if (!destination) return;
      }
      setAgentRuntime((current) => ({
        ...current,
        diagnosticExport: { runId, mode, status: "working", error: null },
      }));
      try {
        const content = await gateway.exportAgentRunDiagnostics(
          project.projectId,
          runId,
          destination,
        );
        if (activeProjectPath.current !== project.rootPath) return;
        if (mode === "copy" && !(await copy(content))) {
          throw new Error("클립보드에 넣지 못했습니다");
        }
        setAgentRuntime((current) => ({
          ...current,
          diagnosticExport: { runId, mode, status: "done", error: null },
        }));
      } catch (reason) {
        if (activeProjectPath.current !== project.rootPath) return;
        setAgentRuntime((current) => ({
          ...current,
          diagnosticExport: { runId, mode, status: "failed", error: messageFrom(reason) },
        }));
      }
    },
    [gateway, project],
  );

  /** 계획을 만든다. 세 조작 모두 계획 단계에서는 아무것도 쓰지 않는다. */
  const planAgentRuntime = useCallback(
    async (operation: AgentRuntimeOperation) => {
      setAgentRuntime((current) => ({
        ...current,
        planning: operation,
        planError: null,
        applyError: null,
      }));
      try {
        const plan =
          operation === "install"
            ? { kind: "install" as const, plan: await gateway.planAgentRuntimeInstall() }
            : {
                kind: operation,
                plan: await gateway.planAgentRuntimeUpdate(),
              };
        setAgentRuntime((current) => ({ ...current, planning: null, plan }));
      } catch (reason) {
        setAgentRuntime((current) => ({
          ...current,
          planning: null,
          plan: null,
          planError: messageFrom(reason),
        }));
      }
    },
    [gateway],
  );

  const cancelAgentRuntimePlan = useCallback(() => {
    setAgentRuntime((current) => ({ ...current, plan: null, planError: null }));
  }, []);

  /**
   * 확인 대기 중인 계획을 적용한다. 계획이 없으면 아무것도 부르지 않는다.
   *
   * 백엔드가 오래된 계획이라고 거절하면 사유를 남기고 같은 조작의 계획을 다시 만든다. 사용자가 본
   * 계획과 실제로 적용될 계획이 다른 채로 버튼만 다시 열리지 않게 하는 자리다.
   */
  const applyAgentRuntimePlan = useCallback(async () => {
    const pending = agentRuntime.plan;
    if (!pending) return false;
    setAgentRuntime((current) => ({ ...current, applying: true, applyError: null }));
    try {
      const application =
        pending.kind === "install"
          ? {
              kind: "install" as const,
              result: await gateway.applyAgentRuntimeInstall(pending.plan.planId, true),
            }
          : {
              kind: pending.kind,
              result:
                pending.kind === "update"
                  ? await gateway.applyAgentRuntimeUpdate(pending.plan.planId, true)
                  : await gateway.repairAgentRuntime(pending.plan.planId, true),
            };
      setAgentRuntime((current) => ({
        ...current,
        applying: false,
        plan: null,
        application,
      }));
      if (project) {
        await readAgentRuntime(project.rootPath, project.projectId);
      }
      return true;
    } catch (reason) {
      setAgentRuntime((current) => ({
        ...current,
        applying: false,
        plan: null,
        applyError: messageFrom(reason),
      }));
      await planAgentRuntime(pending.kind);
      return false;
    }
  }, [agentRuntime.plan, gateway, planAgentRuntime, project, readAgentRuntime]);

  // 앱 업데이트는 번들 런타임 교체까지 이어져야 한다. 실전에서 번들만 새 버전이고 설치본이
  // 그대로 남아, 런타임 수정이 배달만 되고 장착되지 않았다(2026-08-13 진단 번들: 번들 0.9.4,
  // 설치·실행 0.9.2). 실행 중인 세션이 있으면 방해하지 않고 미룬다 — 다만 자동 실행 기기는
  // 세션이 거의 항상 돌므로, 화면이 아는 실행 수가 0으로 떨어지는 순간에도 다시 시도해야
  // 미룸이 사실상의 포기가 되지 않는다. 자동 경로가 실패하면 조용히 물러난다 — 고급 설정의
  // 수동 업데이트가 그대로 있다.
  const autoRuntimeUpdateDone = useRef(false);
  const activeRunCount = useMemo(
    () =>
      (agentRuntime.queue?.runs ?? []).filter(
        (run) =>
          run.state === "reserved" ||
          run.state === "queued" ||
          run.state === "running" ||
          run.state === "paused",
      ).length,
    [agentRuntime.queue],
  );
  useEffect(() => {
    const inspection = agentRuntime.inspection;
    const installed = inspection?.status?.installedVersion;
    const bundled = inspection?.bundledVersion;
    if (!installed || !bundled || autoRuntimeUpdateDone.current) return;
    if (inspection.status?.result !== "ok") return;
    if (!bundledRuntimeIsNewer(bundled, installed)) return;
    if (activeRunCount > 0) return;
    autoRuntimeUpdateDone.current = true;
    void (async () => {
      try {
        const plan = await gateway.planAgentRuntimeUpdate();
        if (plan.activeRuns > 0) {
          // 화면이 모르는 실행이 있었다. 실행 수 변화가 이 판단을 다시 깨운다.
          autoRuntimeUpdateDone.current = false;
          return;
        }
        await gateway.applyAgentRuntimeUpdate(plan.planId, true);
        if (project) {
          await readAgentRuntime(project.rootPath, project.projectId);
        }
      } catch {
        // 수동 경로가 남아 있으므로 자동 경로의 실패는 화면을 막지 않는다.
      }
    })();
  }, [activeRunCount, agentRuntime.inspection, gateway, project, readAgentRuntime]);

  /** 기존 역할 잡에서 새 정책을 제안받는다. 파일을 읽기만 한다. */
  const previewAgentRuntimeMigration = useCallback(async () => {
    if (!project?.projectId) return;
    const path = project.rootPath;
    const projectId = project.projectId;
    setAgentRuntime((current) => ({
      ...current,
      migrationBusy: true,
      migrationError: null,
    }));
    try {
      const migration = await gateway.previewAgentRuntimeMigration(path, projectId);
      setAgentRuntime((current) => ({ ...current, migrationBusy: false, migration }));
    } catch (reason) {
      setAgentRuntime((current) => ({
        ...current,
        migrationBusy: false,
        migrationError: messageFrom(reason),
      }));
    }
  }, [gateway, project?.projectId, project?.rootPath]);

  const dismissAgentRuntimeMigration = useCallback(() => {
    setAgentRuntime((current) => ({ ...current, migration: null, migrationError: null }));
  }, []);

  /** 확인받은 미리보기를 적용한다. 미리보기 식별자와 읽을 때 받은 revision이 함께 나간다. */
  const applyAgentRuntimeMigration = useCallback(async () => {
    const preview = agentRuntime.migration;
    const revision = agentRuntime.policy?.revision;
    if (!preview || revision === undefined || !project?.projectId) return false;
    setAgentRuntime((current) => ({
      ...current,
      migrationBusy: true,
      migrationError: null,
    }));
    try {
      const policy = await gateway.applyAgentRuntimeMigration(
        project.rootPath,
        project.projectId,
        preview.previewId,
        revision,
      );
      setAgentRuntime((current) => ({
        ...current,
        migrationBusy: false,
        migration: null,
        policy,
      }));
      await readAgentRuntime(project.rootPath, project.projectId);
      return true;
    } catch (reason) {
      setAgentRuntime((current) => ({
        ...current,
        migrationBusy: false,
        migrationError: messageFrom(reason),
      }));
      return false;
    }
  }, [
    agentRuntime.migration,
    agentRuntime.policy?.revision,
    gateway,
    project,
    project?.projectId,
    project?.rootPath,
    readAgentRuntime,
  ]);

  /**
   * 정책을 저장한다. 읽을 때 받은 revision을 그대로 실어 보내고, 경합으로 거절되면 사유를 남긴 뒤
   * 최신 값을 다시 읽는다. 폼을 조용히 덮지 않고 무엇이 달라졌는지 사용자가 볼 수 있게 한다.
   */
  const saveAgentRuntimePolicy = useCallback(
    async (policy: AgentProjectPolicy) => {
      const revision = agentRuntime.policy?.revision;
      if (revision === undefined) return false;
      setAgentRuntime((current) => ({ ...current, saving: true, saveError: null }));
      try {
        const saved = await gateway.saveAgentRuntimePolicy(policy, revision);
        setAgentRuntime((current) => ({ ...current, saving: false, policy: saved }));
        return true;
      } catch (reason) {
        setAgentRuntime((current) => ({
          ...current,
          saving: false,
          saveError: messageFrom(reason),
        }));
        if (project) {
          await readAgentRuntime(project.rootPath, project.projectId);
        }
        return false;
      }
    },
    [agentRuntime.policy?.revision, gateway, project, readAgentRuntime],
  );

  const resetCustomRules = useCallback(() => {
    customRulesReadRequest.current += 1;
    customRulesPreviewRequest.current += 1;
    customRulesSaveRequest.current += 1;
    savingCustomRules.current = false;
    setCustomRules(emptyCustomRulesState());
  }, []);

  const readCustomRules = useCallback(
    async (path: string, silent = false, clearTransient = false) => {
      const request = ++customRulesReadRequest.current;
      if (!silent || clearTransient) {
        setCustomRules((previous) => ({
          ...previous,
          reading: !silent,
          preview: clearTransient ? null : previous.preview,
          previewBaselineContentHash: clearTransient
            ? null
            : previous.previewBaselineContentHash,
          saveResult: clearTransient ? null : previous.saveResult,
          readError: null,
          previewError: clearTransient ? null : previous.previewError,
          saveError: clearTransient ? null : previous.saveError,
        }));
      }
      try {
        const document = await gateway.readCustomRules(path);
        if (
          request !== customRulesReadRequest.current ||
          activeProjectPath.current !== path
        ) {
          return false;
        }
        setCustomRules((previous) => ({
          ...previous,
          document: sameCustomRulesDocument(previous.document, document)
            ? previous.document
            : document,
          reading: false,
          readError: null,
        }));
        return true;
      } catch (reason) {
        if (
          request !== customRulesReadRequest.current ||
          activeProjectPath.current !== path
        ) {
          return false;
        }
        setCustomRules((previous) => ({
          ...previous,
          reading: false,
          readError: messageFrom(reason),
        }));
        return false;
      }
    },
    [gateway],
  );

  const synchronizeManagedAssets = useCallback(
    async (path: string, trigger: ManagedAssetSyncTrigger) => {
      setManagedAssets({ syncing: true, result: null, error: null, trigger });
      try {
        const result = await gateway.synchronizeManagedAssets(path);
        if (activeProjectPath.current !== path) return;
        setManagedAssets({ syncing: false, result, error: null, trigger });
      } catch (reason) {
        if (activeProjectPath.current !== path) return;
        setManagedAssets({
          syncing: false,
          result: null,
          error: messageFrom(reason),
          trigger,
        });
      }
    },
    [gateway],
  );

  const inspect = useCallback(
    async (
      path: string,
      silent = false,
      syncTrigger: ManagedAssetSyncTrigger | null = null,
    ) => {
      if (!silent) setBusy(true);
      setError(null);
      try {
        const next = await gateway.inspect(path);
        if (
          syncTrigger !== "project_open" &&
          activeProjectPath.current !== path
        ) {
          return null;
        }
        if (syncTrigger === "project_open") {
          activeProjectPath.current = next.rootPath;
          resetCustomRules();
          // 이전 프로젝트의 정책과 계획이 새 프로젝트 화면에 남지 않게 통째로 되돌린다(R5).
          setAgentRuntime(emptyAgentRuntime);
          agentLogCursors.current = {};
          void readAgentRuntime(next.rootPath, next.projectId);
          if (next.projectId) void readAgentRuns(next.rootPath, next.projectId);
        }
        setProject(next);
        remember(next);
        if (syncTrigger) {
          if (next.initialized && next.compatibility === "current") {
            await synchronizeManagedAssets(next.rootPath, syncTrigger);
            await readCustomRules(next.rootPath);
          } else {
            setManagedAssets({
              syncing: false,
              result: null,
              error: null,
              trigger: null,
            });
            resetCustomRules();
          }
        } else if (silent && next.initialized && next.compatibility === "current") {
          await readCustomRules(next.rootPath, true);
        }
        return next;
      } catch (reason) {
        if (!silent) setError(messageFrom(reason));
        return null;
      } finally {
        if (!silent) setBusy(false);
      }
    },
    [
      gateway,
      readAgentRuntime,
      readAgentRuns,
      readCustomRules,
      remember,
      resetCustomRules,
      synchronizeManagedAssets,
    ],
  );

  const openFolder = useCallback(async () => {
    setError(null);
    try {
      const path = await gateway.chooseDirectory();
      if (path) await inspect(path, false, "project_open");
    } catch (reason) {
      setError(messageFrom(reason));
    }
  }, [gateway, inspect]);

  const openRecent = useCallback(
    (path: string) => inspect(path, false, "project_open"),
    [inspect],
  );

  const createWorkflow = useCallback(
    async (name: string) => {
      if (!project) return false;
      setBusy(true);
      setError(null);
      try {
        const next = await gateway.createWorkflow(project.rootPath, name);
        if (activeProjectPath.current !== project.rootPath) return false;
        setProject(next);
        remember(next);
        if (next.initialized && next.compatibility === "current") {
          await readCustomRules(next.rootPath);
        }
        return true;
      } catch (reason) {
        setError(messageFrom(reason));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [gateway, project, readCustomRules, remember],
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
    if (project) await inspect(project.rootPath, false, "manual_refresh");
  }, [inspect, project]);

  const prepareCustomRulesPreview = useCallback(
    async (draft: CustomRulesDraft): Promise<CustomRulesPreview | null> => {
      if (
        !project?.initialized ||
        project.compatibility !== "current" ||
        !customRules.document ||
        savingCustomRules.current
      ) {
        return null;
      }
      const path = project.rootPath;
      const baselineContentHash = customRules.document.contentHash;
      const request = ++customRulesPreviewRequest.current;
      setCustomRules((previous) => ({
        ...previous,
        previewing: true,
        preview: null,
        previewBaselineContentHash: null,
        saveResult: null,
        previewError: null,
        saveError: null,
      }));
      try {
        const preview = await gateway.prepareCustomRulesPreview(path, draft);
        if (
          request !== customRulesPreviewRequest.current ||
          activeProjectPath.current !== path
        ) {
          return null;
        }
        setCustomRules((previous) => ({
          ...previous,
          previewing: false,
          preview,
          previewBaselineContentHash: baselineContentHash,
          previewError: null,
        }));
        return preview;
      } catch (reason) {
        if (
          request !== customRulesPreviewRequest.current ||
          activeProjectPath.current !== path
        ) {
          return null;
        }
        setCustomRules((previous) => ({
          ...previous,
          previewing: false,
          preview: null,
          previewBaselineContentHash: null,
          previewError: messageFrom(reason),
        }));
        return null;
      }
    },
    [customRules.document, gateway, project],
  );

  const saveCustomRules = useCallback(async (): Promise<SaveCustomRulesResult | null> => {
    if (
      !project?.initialized ||
      project.compatibility !== "current" ||
      !customRules.preview ||
      savingCustomRules.current
    ) {
      return null;
    }
    const path = project.rootPath;
    const preview = customRules.preview;
    const expectedContentHash = customRules.previewBaselineContentHash;
    const request = ++customRulesSaveRequest.current;
    savingCustomRules.current = true;
    setCustomRules((previous) => ({
      ...previous,
      saving: true,
      saveResult: null,
      saveError: null,
    }));
    try {
      const result = await gateway.saveCustomRules(path, {
        expectedContentHash,
        draft: preview.draft,
        updatedAt: preview.updatedAt,
        previewHash: preview.previewHash,
      });
      if (
        request !== customRulesSaveRequest.current ||
        activeProjectPath.current !== path
      ) {
        return null;
      }
      setCustomRules((previous) =>
        result.status === "saved"
          ? {
              ...previous,
              document: result.document,
              saving: false,
              preview: null,
              previewBaselineContentHash: null,
              saveResult: result,
              previewError: null,
              saveError: null,
            }
          : {
              ...previous,
              saving: false,
              saveResult: result,
              saveError: null,
            },
      );
      return result;
    } catch (reason) {
      if (
        request !== customRulesSaveRequest.current ||
        activeProjectPath.current !== path
      ) {
        return null;
      }
      setCustomRules((previous) => ({
        ...previous,
        saving: false,
        saveResult: null,
        saveError: messageFrom(reason),
      }));
      return null;
    } finally {
      if (request === customRulesSaveRequest.current) {
        savingCustomRules.current = false;
      }
    }
  }, [customRules.preview, customRules.previewBaselineContentHash, gateway, project]);

  const reloadCustomRules = useCallback(async () => {
    if (
      !project?.initialized ||
      project.compatibility !== "current" ||
      savingCustomRules.current
    ) {
      return false;
    }
    return readCustomRules(project.rootPath, false, true);
  }, [project, readCustomRules]);

  const clearCustomRulesFeedback = useCallback(() => {
    if (savingCustomRules.current) return;
    customRulesPreviewRequest.current += 1;
    setCustomRules((previous) => ({
      ...previous,
      previewing: false,
      preview: null,
      previewBaselineContentHash: null,
      saveResult: null,
      previewError: null,
      saveError: null,
    }));
  }, []);

  const customRulesActions = useMemo<CustomRulesActions>(
    () => ({
      preparePreview: prepareCustomRulesPreview,
      save: saveCustomRules,
      reload: reloadCustomRules,
      clearFeedback: clearCustomRulesFeedback,
    }),
    [
      clearCustomRulesFeedback,
      prepareCustomRulesPreview,
      reloadCustomRules,
      saveCustomRules,
    ],
  );

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

  /**
   * 막힌 작업 하나를 사용자 판단으로 개발 준비 상태로 되돌린다. QA 기록과 다른 통로다.
   *
   * 실패 사유를 돌려주는 값에도 담는다. 재개 영역은 입력을 유지한 채 그 자리에서 사유를 보여 주고
   * 다음 행동을 묻는데, 다음 호출이 덮는 전역 문구만으로는 그 자리를 채울 수 없다.
   */
  const resumeTask = useCallback(
    async (
      workflowDirectory: string,
      fileName: string,
      expectedUpdatedAt: string,
      resolution: string,
      requestId: string,
    ): Promise<TaskResumeOutcome> => {
      if (!project) return { ok: false, message: "열린 프로젝트가 없습니다." };
      setBusy(true);
      setError(null);
      try {
        const result = await gateway.resumeTask(project.rootPath, {
          workflowDirectory,
          fileName,
          expectedUpdatedAt,
          resolution,
          requestId,
        });
        // 부분 저장으로 끝난 결과도 지금의 사실이다. 요약을 갱신해 다음 조회가 옛 상태를 보여 주지
        // 않게 하고, 성공 여부 판정은 화면이 `status`로 한다.
        setProject(result.summary);
        return { ok: true, result };
      } catch (reason) {
        const message = messageFrom(reason);
        setError(message);
        return { ok: false, message };
      } finally {
        setBusy(false);
      }
    },
    [gateway, project],
  );

  /**
   * 작업 정의 수정 요청을 앱 소유 기록으로 남긴다. 거절 사유는 입력 영역이 그대로 보여 줄 수 있도록
   * 반환값에도 담고, 성공 응답의 프로젝트 요약은 즉시 반영한다.
   */
  const recordTaskRevisionRequest = useCallback(
    async (
      workflowDirectory: string,
      fileName: string,
      expectedUpdatedAt: string,
      reason: string,
      requestId: string,
    ): Promise<TaskRevisionRequestOutcome> => {
      if (!project) return { ok: false, message: "열린 프로젝트가 없습니다." };
      setBusy(true);
      setError(null);
      try {
        const result = await gateway.recordTaskRevisionRequest(project.rootPath, {
          workflowDirectory,
          fileName,
          expectedUpdatedAt,
          reason,
          requestId,
        });
        setProject(result.summary);
        return { ok: true, result };
      } catch (reason) {
        const message = messageFrom(reason);
        setError(message);
        return { ok: false, message };
      } finally {
        setBusy(false);
      }
    },
    [gateway, project],
  );

  /**
   * 일괄 확인은 앱 호출 한 번이다. 건별 실패는 돌려주는 배열에 담기고 전역 에러로 올라가지 않는다 —
   * 전역 문구는 다음 호출이 덮는 자리라 건별 보고를 담지 못한다. `null`은 호출 자체가 실패한 것이다.
   */
  const confirmTaskQaBatch = useCallback(
    async (
      workflowDirectory: string,
      fileNames: string[],
      comment: string,
    ): Promise<TaskQaBatchEntry[] | null> => {
      if (!project) return null;
      setBusy(true);
      setError(null);
      try {
        const result = await gateway.confirmTaskQaBatch(
          project.rootPath,
          workflowDirectory,
          fileNames,
          comment,
        );
        setProject(result.summary);
        return result.results;
      } catch (reason) {
        setError(messageFrom(reason));
        return null;
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

  // 기존 역할 잡 이전을 위한 임시 호환 통로. 전용 연동 화면에서는 더 이상 노출하지 않는다.
  const integrationActions = useMemo<IntegrationActions>(
    () => ({ installHeartbeatJobs }),
    [installHeartbeatJobs],
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

  /**
   * 도는 데몬의 버전과 디스크의 버전을 읽어 어긋남을 판정한다.
   *
   * **조회 주기가 이 함수를 부르지 않는다.** 이 판정은 프로세스를 하나 띄우는 조작이라
   * `readIntegrations`에 얹지 않는다. 부르는 자리는 카드가 펼쳐지는 순간과 업데이트가 끝난 뒤
   * 둘뿐이고, 겹쳐 부르는 것은 여기서 막는다 — 카드가 두 번 렌더되어도 프로세스는 하나다.
   *
   * 거절당하면 지난 판정을 지운다. 커맨드가 답하지 못한 자리에 옛 값이 남아 있으면 사용자가 그것을
   * 지금의 판정으로 읽는다.
   */
  const checkHeartbeatVersions = useCallback(async () => {
    if (checkingVersions.current) return;
    checkingVersions.current = true;
    setHeartbeatVersions((previous) => ({ ...previous, checking: true, error: null }));
    try {
      const versions = await gateway.checkHeartbeatVersions();
      setHeartbeatVersions({ checking: false, versions, error: null });
    } catch (reason) {
      setHeartbeatVersions({
        checking: false,
        versions: null,
        error: messageFrom(reason),
      });
    } finally {
      checkingVersions.current = false;
    }
  }, [gateway]);

  /**
   * 설치 마법사의 단계 하나를 지금 한 번 실행한다. 사용자가 확인 화면에서 누른 자리에서만 불린다 —
   * 조회 주기와 프로젝트 열기 경로는 이 함수를 부르지 않는다.
   *
   * 실행이 끝나면 연동 조회를 다시 부른다. 단계 상태를 화면이 스스로 바꾸지 않고, 커맨드도
   * 스냅샷을 돌려주지 않는다 — 설치 판정의 원천은 조회 하나다.
   *
   * `command`는 커맨드 자체가 거절했을 때만 쓰는 폴백이다. 그 문자열의 원천은 백엔드(payload의
   * `command`)이며 훅이 명령을 다시 적지 않는다 — `failureFrom`이 같은 이유로 같은 모양이다.
   */
  const runHeartbeatSetupStep = useCallback(
    async (step: HeartbeatSetupStep, command: string) => {
      if (runningSteps.current.includes(step)) return;

      runningSteps.current = [...runningSteps.current, step];
      // 이 단계에 한해 지난 결과를 지운다. 새 실행의 진행 표시 옆에 옛 결과가 남으면 사용자가
      // 그것을 이번 결과로 읽는다.
      setHeartbeatSetupRuns((previous) => {
        const results = { ...previous.results };
        delete results[step];
        return { running: runningSteps.current, results };
      });
      try {
        const result = await gateway.runHeartbeatSetupStep(step);
        setHeartbeatSetupRuns((previous) => ({
          ...previous,
          results: { ...previous.results, [step]: result },
        }));
      } catch (reason) {
        setHeartbeatSetupRuns((previous) => ({
          ...previous,
          results: {
            ...previous.results,
            // 본 후보 경로는 비워 둔다. 앱이 무엇을 봤는지 모르는 상태이고, 모르는 값을 지어내지
            // 않는다(R5).
            [step]: { kind: "notRun", message: messageFrom(reason), command, looked: [] },
          },
        }));
      } finally {
        runningSteps.current = runningSteps.current.filter((name) => name !== step);
        const running = runningSteps.current;
        setHeartbeatSetupRuns((previous) => ({ ...previous, running }));
        if (project) await readIntegrations(project.rootPath);
      }
    },
    [gateway, project, readIntegrations],
  );

  /**
   * 하트비트를 한 번 갱신한다. 사용자가 확인 화면에서 누른 자리에서만 불린다 — 조회 주기와
   * 프로젝트 열기 경로는 이 함수를 부르지 않는다(R3).
   *
   * 실행이 실패한 것도 결과다. 커맨드가 계약 값을 돌려주지 못한 경우(하트비트 홈을 해석하지
   * 못했거나 IPC가 끊긴 경우)만 여기서 값을 만들고, 그때도 사용자가 손으로 끝낼 수 있게 명령
   * 원문을 채운다. 이 문자열의 원천은 백엔드(`heartbeat_process::manual_command_for`)이며 여기
   * 값은 그 경로가 답하지 못했을 때만 쓴다 — `failureFrom`이 같은 이유로 같은 모양이다.
   *
   * 본 후보 경로는 비워 둔다. 앱이 무엇을 봤는지 모르는 상태이고, 모르는 값을 지어내지 않는다(R5).
   */
  const updateHeartbeat = useCallback(async () => {
    if (updating.current) return;
    updating.current = true;
    // 지난 결과를 지운다. 새 실행의 진행 표시 옆에 옛 결과가 남으면 그것을 이번 결과로 읽는다.
    setHeartbeatUpdate({ running: true, result: null });
    try {
      const result = await gateway.updateHeartbeat();
      setHeartbeatUpdate({ running: false, result });
    } catch (reason) {
      setHeartbeatUpdate({
        running: false,
        result: {
          kind: "notRun",
          message: messageFrom(reason),
          command: "heartbeat update",
          looked: [],
        },
      });
    } finally {
      updating.current = false;
      // 갱신이 끝난 자리에서 한 번 다시 읽는다. 방금 바뀐 것이 바로 이 두 값이고, 그 결과를 보려고
      // 사용자가 카드를 접었다 펴게 하지 않는다. 실패로 끝난 실행 뒤에도 읽는다 — 어디까지 갔는지가
      // 종료 코드가 아니라 두 버전에서 읽히는 경우가 `partial`이다.
      await checkHeartbeatVersions();
    }
  }, [checkHeartbeatVersions, gateway]);

  /**
   * 데몬을 내리거나 다시 올린다. 사용자가 버튼을 누른 자리에서만 불린다 — 조회 주기와 프로젝트
   * 열기 경로는 이 함수를 부르지 않는다.
   *
   * **꺼진 데몬을 앱이 대신 다시 켜지 않는다(R6·확인 필요 4번).** 자동 복구는 사용자가 의도해서
   * 꺼 둔 상태를 앱이 무르는 것이고, 커밋 컷 도중에 데몬이 되살아나면 이 기능이 없애려던 페인이
   * 그대로 재현된다. 그래서 이 함수를 부르는 자리는 화면의 버튼 하나뿐이다.
   *
   * 커맨드 자체가 거절한 것은 결과가 아니다. 그 사유는 `error`에 남는다 — 명령 원문은 대상이
   * 확정된 뒤에만 만들어지고 그 값을 아는 쪽은 백엔드다. 훅이 라벨을 지어내 명령을 적으면 그것이
   * 곧 R4가 막는 일이다.
   *
   * 실행이 끝난 자리에서 연동 조회를 다시 부르지 않는다. 데몬 실행 여부의 원천은 2.5초 조회
   * 하나이고, 그 판정이 늦게 따라오는 것은 정상이다 — 화면이 그 순간을 그대로 말한다(R7).
   */
  const controlHeartbeatService = useCallback(
    async (operation: HeartbeatServiceOperation) => {
      if (controllingService.current) return;
      controllingService.current = true;
      // 지난 결과를 지운다. 새 조작의 진행 표시 옆에 옛 결과가 남으면 그것을 이번 결과로 읽는다.
      setHeartbeatService({ running: operation, outcome: null, error: null });
      try {
        const result = await gateway.controlHeartbeatService(operation);
        setHeartbeatService({
          running: null,
          outcome: { operation, result },
          error: null,
        });
      } catch (reason) {
        setHeartbeatService({
          running: null,
          outcome: null,
          error: messageFrom(reason),
        });
      } finally {
        controllingService.current = false;
      }
    },
    [gateway],
  );

  // 연동 섹션이 한 번에 받는 묶음. 실행 상태는 따로 살다가 여기에서만 합쳐진다.
  const integrationsState = useMemo<IntegrationsState>(
    () => ({
      ...integrations,
      heartbeatRuns: { ...heartbeatRuns, run: runHeartbeatJob },
      heartbeatUpdate: { ...heartbeatUpdate, update: updateHeartbeat },
      heartbeatSetupRuns: { ...heartbeatSetupRuns, run: runHeartbeatSetupStep },
      heartbeatVersions: { ...heartbeatVersions, check: checkHeartbeatVersions },
      heartbeatService: { ...heartbeatService, control: controlHeartbeatService },
    }),
    [
      checkHeartbeatVersions,
      controlHeartbeatService,
      heartbeatRuns,
      heartbeatService,
      heartbeatSetupRuns,
      heartbeatUpdate,
      heartbeatVersions,
      integrations,
      runHeartbeatJob,
      runHeartbeatSetupStep,
      updateHeartbeat,
    ],
  );

  useEffect(() => {
    if (!project?.initialized || !gateway.watchProject) return;
    const path = project.rootPath;
    let disposed = false;
    let stop: (() => Promise<void>) | null = null;
    let debounce: number | null = null;
    void gateway.watchProject(path, () => {
      if (debounce !== null) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void inspect(path, true), 500);
    }).then((cleanup) => {
      if (disposed) void cleanup();
      else stop = cleanup;
    }).catch(() => {
      // 런타임 dispatcher의 안전 확인 주기가 남아 있다. 화면은 수동 새로고침도 제공한다.
    });
    return () => {
      disposed = true;
      if (debounce !== null) window.clearTimeout(debounce);
      if (stop) void stop();
    };
  }, [gateway, inspect, project?.initialized, project?.rootPath]);

  const hasActiveAgentRun = agentRuntime.queue?.runs.some((run) =>
    ["reserved", "queued", "running", "paused"].includes(run.state)
  ) ?? false;

  useEffect(() => {
    if (!project?.initialized || !project.projectId || (!agentViewActive && !hasActiveAgentRun)) return;
    const path = project.rootPath;
    const projectId = project.projectId;
    void readAgentRuns(path, projectId, true);
    const timer = window.setInterval(() => void readAgentRuns(path, projectId, true), 2_500);
    return () => window.clearInterval(timer);
  }, [agentViewActive, hasActiveAgentRun, project?.initialized, project?.projectId, project?.rootPath, readAgentRuns]);

  // 실행 상세가 열려 있는 동안만 이벤트를 이어 읽는다. 활동 없음 신호는 새 이벤트가 와야 사라지므로
  // 사용자가 단추를 누른 순간의 이벤트만으로는 판정할 수 없다. 주기는 실행 목록 조회와 같은 값이다.
  useEffect(() => {
    const runId = agentRuntime.logWatchRunId;
    if (!runId || !project?.projectId) return;
    void readAgentRunLog(runId);
    const timer = window.setInterval(() => void readAgentRunLog(runId), 2_500);
    return () => window.clearInterval(timer);
  }, [agentRuntime.logWatchRunId, project?.projectId, readAgentRunLog]);

  const agentRuntimeActions: AgentRuntimeActions = useMemo(
    () => ({
      refresh: async () => {
        if (!project) return;
        await Promise.all([
          readAgentRuntime(project.rootPath, project.projectId),
          project.projectId
            ? readAgentRuns(project.rootPath, project.projectId)
            : Promise.resolve(),
        ]);
      },
      setViewActive: setAgentViewActive,
      plan: planAgentRuntime,
      cancelPlan: cancelAgentRuntimePlan,
      apply: applyAgentRuntimePlan,
      previewMigration: previewAgentRuntimeMigration,
      applyMigration: applyAgentRuntimeMigration,
      dismissMigration: dismissAgentRuntimeMigration,
      save: saveAgentRuntimePolicy,
      planRun: planAgentRun,
      cancelRunPlan: cancelAgentRunPlan,
      startRun: startAgentRun,
      refreshRuns: async () => {
        if (project?.projectId) {
          await readAgentRuns(project.rootPath, project.projectId);
        }
      },
      setProjectPaused: setAgentProjectPaused,
      previewCancel: previewAgentRunCancel,
      dismissCancel: dismissAgentRunCancel,
      confirmCancel: confirmAgentRunCancel,
      previewRetry: previewAgentRunRetry,
      dismissRetry: dismissAgentRunRetry,
      confirmRetry: confirmAgentRunRetry,
      readRunLog: readAgentRunLog,
      watchRunLog: watchAgentRunLog,
      readRunReports: readAgentRunReports,
      openReport: openAgentReport,
      closeReport: closeAgentReport,
      exportRunDiagnostics: exportAgentRunDiagnostics,
    }),
    [
      applyAgentRuntimeMigration,
      applyAgentRuntimePlan,
      cancelAgentRuntimePlan,
      cancelAgentRunPlan,
      closeAgentReport,
      confirmAgentRunCancel,
      confirmAgentRunRetry,
      dismissAgentRuntimeMigration,
      dismissAgentRunCancel,
      dismissAgentRunRetry,
      exportAgentRunDiagnostics,
      openAgentReport,
      planAgentRuntime,
      planAgentRun,
      previewAgentRuntimeMigration,
      previewAgentRunCancel,
      previewAgentRunRetry,
      project,
      readAgentRuntime,
      readAgentRunLog,
      readAgentRunReports,
      readAgentRuns,
      saveAgentRuntimePolicy,
      setAgentProjectPaused,
      startAgentRun,
      watchAgentRunLog,
    ],
  );

  return {
    project,
    recentProjects,
    busy,
    error,
    managedAssets,
    customRules,
    customRulesActions,
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
    confirmTaskQaBatch,
    resumeTask,
    recordTaskRevisionRequest,
    decideSpec,
    agentRuntime,
    agentRuntimeActions,
    refresh,
    migrate,
    // 진행 중인 실행은 여기서 비우지 않는다. 잡 이름에 프로젝트 slug가 들어 있어 다른 프로젝트의
    // 카드에는 그려지지 않고, 비우면 아직 돌고 있는 잡의 버튼이 다시 눌리는 상태로 돌아온다(R3).
    closeProject: () => {
      activeProjectPath.current = null;
      resetCustomRules();
      setAgentRuntime(emptyAgentRuntime);
      agentLogCursors.current = {};
      setProject(null);
      setError(null);
      setManagedAssets({
        syncing: false,
        result: null,
        error: null,
        trigger: null,
      });
      setIntegrations({ snapshot: null, error: null, writeError: null });
    },
  };
}
