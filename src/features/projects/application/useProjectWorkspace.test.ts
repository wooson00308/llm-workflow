import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// 클립보드는 Tauri 플러그인을 부르는 자리라 jsdom에서 동작하지 않는다. 복사 경로가 실제로 그 모듈을
// 지나는지만 보면 되므로 모듈 하나를 대신 세운다.
const { clipboardCopy } = vi.hoisted(() => ({
  clipboardCopy: vi.fn<(text: string) => Promise<boolean>>(),
}));
vi.mock("../infrastructure/clipboard", () => ({ copy: clipboardCopy }));

import { bundledRuntimeIsNewer, useProjectWorkspace } from "./useProjectWorkspace";
import type {
  CustomRulesDocument,
  CustomRulesDraft,
  CustomRulesPreview,
  HeartbeatRunControls,
  HeartbeatServiceControlResult,
  HeartbeatServiceControls,
  HeartbeatSetupRunControls,
  HeartbeatSetupRunResult,
  HeartbeatUpdateControls,
  HeartbeatUpdateResult,
  HeartbeatVersionControls,
  HeartbeatVersions,
  IntegrationsSnapshot,
  IntegrationsState,
  ManagedAssetSyncResult,
  ProjectGateway,
  ProjectSummary,
  RecentProjectStore,
  SaveCustomRulesResult,
  TaskQaBatchEntry,
  TaskResumeOutcome,
  WorkflowReportSummary,
  AgentInstallApplication,
  AgentInstallPlan,
  AgentMigrationPreview,
  AgentPolicySnapshot,
  AgentRolePolicy,
  AgentRunSummary,
  AgentRuntimeInspection,
  AgentUpdateApplication,
  AgentUpdatePlan,
} from "../domain/types";

const project: ProjectSummary = {
  rootPath: "/projects/workflow-labs",
  initialized: true,
  projectId: "prj_1",
  name: "workflow-labs",
  compatibility: "current",
  activeLeases: [],
  workflows: [
    {
      id: "wf_1",
      directory: "feature--wf_1",
      name: "Feature",
      status: "active",
      createdAt: "2026-07-30T00:00:00Z",
      counts: { ideas: 0, specs: 0, decisions: 0, tasks: 0, reports: 0 },
      items: { ideas: [], specs: [], tasks: [] },
    },
  ],
};

const managedAssetsResult: ManagedAssetSyncResult = {
  status: "updated",
  assets: [
    {
      id: "workflow_rules",
      label: "공통 규칙",
      status: "updated",
      installedVersion: 12,
      providedVersion: 13,
      reason: null,
    },
  ],
  updatedAssets: ["workflow_rules"],
  reason: null,
  affectedAsset: null,
  rollbackFailures: [],
  rollbackRecoveries: [],
};

const absentCustomRules: CustomRulesDocument = {
  status: "absent",
  enabled: false,
  appliesTo: [],
  body: "",
  updatedAt: null,
  modifiedAt: null,
  raw: null,
  contentHash: null,
  error: null,
};

const customRulesDocument: CustomRulesDocument = {
  status: "valid",
  enabled: true,
  appliesTo: ["developer"],
  body: "검증 결과를 보고서에 적는다.",
  updatedAt: "2026-08-06T12:00:00Z",
  modifiedAt: "2026-08-06T12:00:01Z",
  raw: "saved custom rules\n",
  contentHash: "sha256:old",
  error: null,
};

const customRulesDraft: CustomRulesDraft = {
  enabled: true,
  appliesTo: ["developer"],
  body: "검증 결과를 보고서에 적는다.",
};

const customRulesPreview: CustomRulesPreview = {
  draft: customRulesDraft,
  serialized: "preview custom rules\n",
  updatedAt: "2026-08-06T12:05:00Z",
  previewHash: "sha256:preview",
  priorityNotice: "앱 규칙이 우선합니다.",
  roles: [
    {
      role: "developer",
      sources: [
        {
          kind: "workflow_rules",
          label: "공통 규칙",
          order: 1,
          content: "workflow",
          applied: true,
          reason: null,
        },
        {
          kind: "role_contract",
          label: "개발자 역할 계약",
          order: 2,
          content: "developer",
          applied: true,
          reason: null,
        },
        {
          kind: "user_rules",
          label: "사용자 정의 규칙",
          order: 3,
          content: customRulesDraft.body,
          applied: true,
          reason: null,
        },
      ],
    },
  ],
};

const savedCustomRules: SaveCustomRulesResult = {
  status: "saved",
  document: {
    ...customRulesDocument,
    raw: customRulesPreview.serialized,
    contentHash: "sha256:saved",
  },
  reason: null,
};

const snapshot: IntegrationsSnapshot = {
  supported: true,
  slug: "-projects-workflow-labs",
  managedBlockFailure: null,
  jobsFilePath: "/home/tester/.claude/heartbeat/jobs.d/-projects-workflow-labs.md",
  updateGuide: {
    identifyCommand: "pip show claude-heartbeat",
    packageCommand: "pip install -U claude-heartbeat",
    sourceCommand: "git pull",
    serviceLookupCommand: "launchctl list | grep heartbeat",
    serviceRestartCommand: "launchctl kickstart -k gui/$(id -u)/<라벨>",
  },
  heartbeat: {
    installation: "installed",
    daemonRunning: true,
    setupStages: [],
    conditionScriptPath: ".workflow/rules/wf-eligible.sh",
    roles: [],
    managedJobs: [],
    serviceTarget: {
      kind: "resolved",
      label: "com.catze.dream-heartbeat",
      plist_path: "/Users/tester/Library/LaunchAgents/com.catze.dream-heartbeat.plist",
    },
    recordedJobs: [{ name: "wf-developer-projects-workflow-labs", ofThisProject: true }],
    duplicateJobs: [],
    readFailures: [],
  },
  dream: {
    installation: "not_installed",
    heartbeat: "installed",
    refinement: {
      totalTranscripts: 0,
      markedTranscripts: 0,
      unrefinedTranscripts: 0,
      lastDream: null,
      memoryTopics: 0,
    },
    skillPath: "/Users/catze/.claude/skills/dream/SKILL.md",
    conditionCommand: "dream-prep check-unprocessed --slug=-projects-workflow-labs",
    defaults: { interval: "2h", maxPer: "6/24h", model: "opus", timeout: "30m" },
    managedJob: null,
    lastRun: null,
    quota: { kind: "unknown" },
    duplicateJobs: [],
    readFailures: [],
  },
};

/** 백엔드가 계약대로 답한 업데이트 하나. 훅은 이 값을 들여다보지 않고 그대로 화면에 넘긴다. */
const updateResult: HeartbeatUpdateResult = {
  kind: "contract",
  steps: [{ step: "repo", status: "ok", detail: "updated" }],
  result: "ok",
  version: "0.8.1",
  code: 0,
  stdout: "step=repo status=ok detail=updated\nresult=ok version=0.8.1 exit=0\n",
  stderr: "",
};

/** 백엔드가 계약대로 답한 설치 단계 실행 하나. 훅은 이 값을 들여다보지 않고 그대로 넘긴다. */
const setupRunResult: HeartbeatSetupRunResult = {
  kind: "ran",
  succeeded: true,
  code: 0,
  stdout: "initialized\n",
  stderr: "",
};

/** 두 값을 모두 읽어 같다고 판정한 결과. */
const versionsResult: HeartbeatVersions = {
  running: { kind: "known", version: "0.8.1" },
  disk: { kind: "known", version: "0.8.1" },
  verdict: { kind: "match" },
};

/** 백엔드가 실행까지 간 데몬 조작 하나. 훅은 이 값을 들여다보지 않고 그대로 화면에 넘긴다. */
const serviceRunResult: HeartbeatServiceControlResult = {
  kind: "ran",
  code: 0,
  stdout: "",
  stderr: "",
  label: "com.catze.dream-heartbeat",
  plistPath: "/Users/tester/Library/LaunchAgents/com.catze.dream-heartbeat.plist",
};

/** 데몬이 멈춘 상태의 스냅샷. 자동 복구가 없다는 것을 세우는 자리가 이 값이다. */
const stoppedSnapshot: IntegrationsSnapshot = {
  ...snapshot,
  heartbeat: { ...snapshot.heartbeat, daemonRunning: false },
};

/** 에이전트 런타임 픽스처. 정상 설치·호환 상태 하나를 기본으로 둔다. */
const agentService = {
  platform: "launchd",
  result: "registered",
  registered: true,
  running: true,
  label: "com.claude-heartbeat",
  executable: "/opt/runtime/bin/heartbeat",
  recoverable: true,
  checkedAt: "2026-08-08T09:00:00Z",
  evidence: ["launch_agents_directory"],
};

const agentInspection: AgentRuntimeInspection = {
  bundledVersion: "0.8.0",
  status: {
    result: "ok",
    checkedAt: "2026-08-08T09:00:00Z",
    runtimeVersion: "0.8.0",
    installedVersion: "0.8.0",
    runningVersion: "0.8.0",
    apiMajor: 1,
    target: "macos-universal",
    installResult: "installed",
    recoverable: true,
    service: agentService,
  },
  compatibility: { kind: "compatible" },
  executionAllowed: true,
  unavailable: null,
  installRoot: "/Users/tester/.workflow-labs/runtime",
};

const agentInstallPlan: AgentInstallPlan = {
  planId: "plan-install-1",
  bundledVersion: "0.8.0",
  target: "macos-universal",
  versionDirectory: "/versions/0.8.0",
  launcher: "/bin/heartbeat",
  alreadyInstalled: false,
  installedVersion: null,
  serviceTransitionRequired: true,
  service: agentService,
  serviceAction: "already_managed",
};

const agentInstallApplication: AgentInstallApplication = {
  planId: "plan-install-1",
  result: "ok",
  installedVersion: "0.8.0",
  versionDirectory: "/versions/0.8.0",
  stages: [{ stage: "version_install", status: "ok", detail: null }],
  detail: null,
};

const agentUpdatePlan: AgentUpdatePlan = {
  planId: "plan-update-1",
  result: "ready",
  targetVersion: "0.9.0",
  target: "macos-universal",
  manifestVerified: true,
  launcherSwitchRequired: true,
  serviceTransitionRequired: true,
  recoverableOnFailure: true,
  installedVersion: "0.8.0",
  runningVersion: "0.8.0",
  activeRuns: 0,
  projects: [],
  service: agentService,
};

const agentUpdateApplication: AgentUpdateApplication = {
  planId: "plan-update-1",
  result: "ok",
  stages: [{ stage: "launcher_switch", status: "ok", detail: null }],
  runnableVersion: "0.9.0",
  recoveryActions: [],
  detail: null,
};

function agentRole(provider: string): AgentRolePolicy {
  return {
    enabled: true,
    provider,
    model: null,
    runMode: "continuous",
    maxParallel: 1,
    intervalSeconds: 300,
    maxPer: null,
  };
}

const agentPolicy: AgentPolicySnapshot = {
  policy: {
    projectId: "prj_1",
    workingDirectory: "/projects/workflow-labs",
    projectMaxParallel: 3,
    deviceMaxParallel: 16,
    roles: {
      architect: agentRole("claude"),
      developer: agentRole("claude"),
      planner: agentRole("claude"),
    },
  },
  stored: true,
  revision: "rev-1",
  providers: [{ provider: "claude", status: "ready", version: "1.2.3" }],
  executionAllowed: true,
  compatibility: { kind: "compatible" },
  deviceCapacity: {
    observed: true,
    configuredMaxParallel: 16,
    effectiveMaxParallel: 16,
    recommendedMaxParallel: 8,
    logicalCpuCount: 10,
    totalMemoryBytes: 17179869184,
    reservedMemoryBytes: 4294967296,
    estimatedMemoryPerAgentBytes: 1610612736,
    activeRuns: 0,
    projects: [],
  },
};

const agentMigration: AgentMigrationPreview = {
  previewId: "preview-1",
  proposed: agentPolicy.policy,
  unresolved: [],
  untouchedRoles: [],
};

function gatewayFor(overrides: Partial<ProjectGateway> = {}): ProjectGateway {
  return {
    chooseDirectory: vi.fn().mockResolvedValue(project.rootPath),
    inspect: vi.fn().mockResolvedValue(project),
    synchronizeManagedAssets: vi.fn().mockResolvedValue(managedAssetsResult),
    readCustomRules: vi.fn().mockResolvedValue(absentCustomRules),
    prepareCustomRulesPreview: vi.fn().mockResolvedValue(customRulesPreview),
    saveCustomRules: vi.fn().mockResolvedValue(savedCustomRules),
    createWorkflow: vi.fn().mockResolvedValue(project),
    createIdea: vi.fn().mockResolvedValue({
      ...project,
      workflows: [
        {
          ...project.workflows[0],
          counts: { ...project.workflows[0].counts, ideas: 1 },
        },
      ],
    }),
    readSpec: vi.fn().mockResolvedValue(null),
    readTask: vi.fn().mockResolvedValue(null),
    readIdea: vi.fn().mockResolvedValue(null),
    decideSpec: vi.fn().mockResolvedValue(project),
    recordTaskQa: vi.fn().mockResolvedValue(project),
    confirmTaskQaBatch: vi
      .fn()
      .mockResolvedValue({ summary: project, results: [] }),
    resumeTask: vi
      .fn()
      .mockResolvedValue({ status: "resumed", summary: project, recovery: null }),
    recordTaskRevisionRequest: vi.fn().mockResolvedValue({
      status: "recorded",
      summary: project,
      request: null,
    }),
    inspectAgentRuntime: vi.fn().mockResolvedValue(agentInspection),
    planAgentRuntimeInstall: vi.fn().mockResolvedValue(agentInstallPlan),
    applyAgentRuntimeInstall: vi.fn().mockResolvedValue(agentInstallApplication),
    planAgentRuntimeUpdate: vi.fn().mockResolvedValue(agentUpdatePlan),
    applyAgentRuntimeUpdate: vi.fn().mockResolvedValue(agentUpdateApplication),
    repairAgentRuntime: vi.fn().mockResolvedValue(agentUpdateApplication),
    readAgentRuntimePolicy: vi.fn().mockResolvedValue(agentPolicy),
    saveAgentRuntimePolicy: vi.fn().mockResolvedValue(agentPolicy),
    previewAgentRuntimeMigration: vi.fn().mockResolvedValue(agentMigration),
    applyAgentRuntimeMigration: vi.fn().mockResolvedValue(agentPolicy),
    planAgentRun: vi.fn().mockResolvedValue({
      planId: "run-plan-1",
      projectId: project.projectId,
      revision: "run-rev-1",
      expiresAt: "2026-08-08T12:00:00Z",
      deviceRemaining: 4,
      projectRemaining: 3,
      billingRouteRisk: false,
      limits: {},
      roles: [],
    }),
    startAgentRun: vi.fn().mockResolvedValue({ started: [], failures: [] }),
    cancelAgentRun: vi.fn().mockResolvedValue({
      kind: "preview",
      preview: {
        runId: "run-1",
        targetId: "TASK-1",
        leaseId: "lease-1",
        pid: 1,
        processLiveness: "running",
        childProcesses: 0,
        cleanup: ["lease"],
      },
    }),
    retryAgentRun: vi.fn().mockResolvedValue({
      runId: "run-2",
      projectId: project.projectId,
      role: "developer",
      provider: "codex",
      state: "queued",
      targetId: "TASK-1",
      startedAt: null,
      failureStage: null,
      reason: null,
      remaining: [],
      previousRunId: "run-1",
    }),
    inspectAgentRuns: vi.fn().mockResolvedValue({
      projectId: project.projectId,
      paused: false,
      runs: [],
      errors: [],
      providers: [],
      unavailable: null,
    }),
    pauseAgentProject: vi.fn().mockResolvedValue({
      projectId: project.projectId,
      paused: true,
      runs: [],
      errors: [],
      providers: [],
      unavailable: null,
    }),
    resumeAgentProject: vi.fn().mockResolvedValue({
      projectId: project.projectId,
      paused: false,
      runs: [],
      errors: [],
      providers: [],
      unavailable: null,
    }),
    readAgentRunLog: vi.fn().mockResolvedValue({
      runId: "run-1",
      events: [],
      nextCursor: 0,
    }),
    chooseDiagnosticsFile: vi.fn().mockResolvedValue("/tmp/run-1-diagnostics.json"),
    exportAgentRunDiagnostics: vi
      .fn()
      .mockResolvedValue('{"bundleVersion":"1","runId":"run-1"}'),
    listRunReports: vi.fn().mockResolvedValue([]),
    readReport: vi.fn().mockResolvedValue({
      summary: { fileName: "REPORT-TASK-1-DEV.md", title: "구현 보고서" },
      body: "# 구현 보고서\n",
    }),
    migrate: vi.fn().mockResolvedValue(project),
    inspectIntegrations: vi.fn().mockResolvedValue(snapshot),
    installHeartbeatJobs: vi.fn().mockResolvedValue(snapshot),
    runHeartbeatJob: vi.fn().mockResolvedValue(undefined),
    updateHeartbeat: vi.fn().mockResolvedValue(updateResult),
    runHeartbeatSetupStep: vi.fn().mockResolvedValue(setupRunResult),
    checkHeartbeatVersions: vi.fn().mockResolvedValue(versionsResult),
    controlHeartbeatService: vi.fn().mockResolvedValue(serviceRunResult),
    ...overrides,
  };
}

/** 실행 기록 하나. 보고서 연결 판정이 쓰는 두 값만 실행마다 다르다. */
function runOf(runId: string, targetId: string): AgentRunSummary {
  return {
    runId,
    projectId: "prj_1",
    role: "developer",
    provider: "codex",
    state: "succeeded",
    targetId,
    startedAt: "2026-08-12T00:00:00Z",
    finishedAt: "2026-08-12T00:01:00Z",
    failureStage: null,
    reason: null,
    remaining: [],
    previousRunId: null,
    resultPrefix: `RES-${runId}`,
  };
}

const reportSummary: WorkflowReportSummary = {
  fileName: "REPORT-TASK-1-DEV.md",
  title: "구현 보고서",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useProjectWorkspace", () => {
  it("명시적 열기와 수동 새로 고침에서 조회 뒤 관리 자산을 동기화한다", async () => {
    const calls: string[] = [];
    const gateway = gatewayFor({
      inspect: vi.fn().mockImplementation(async () => {
        calls.push("inspect");
        return project;
      }),
      synchronizeManagedAssets: vi.fn().mockImplementation(async () => {
        calls.push("sync");
        return managedAssetsResult;
      }),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    expect(calls).toEqual(["inspect", "sync"]);
    expect(result.current.managedAssets).toEqual({
      syncing: false,
      result: managedAssetsResult,
      error: null,
      trigger: "project_open",
    });

    calls.length = 0;
    await act(() => result.current.refresh());
    expect(calls).toEqual(["inspect", "sync"]);
    expect(result.current.managedAssets.trigger).toBe("manual_refresh");
    expect(gateway.synchronizeManagedAssets).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("최근 프로젝트도 열기 동기화를 한 번 실행한다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openRecent(project.rootPath));

    expect(gateway.inspect).toHaveBeenCalledWith(project.rootPath);
    expect(gateway.synchronizeManagedAssets).toHaveBeenCalledTimes(1);
    expect(result.current.managedAssets.trigger).toBe("project_open");
    unmount();
  });

  it("호환되지 않는 프로젝트와 조회 실패에서는 동기화하지 않는다", async () => {
    const incompatible = {
      ...project,
      compatibility: "migration_required" as const,
    };
    const gateway = gatewayFor({
      inspect: vi
        .fn()
        .mockResolvedValueOnce(incompatible)
        .mockRejectedValueOnce(new Error("조회 실패")),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openRecent(project.rootPath));
    await act(() => result.current.openRecent(project.rootPath));

    expect(gateway.synchronizeManagedAssets).not.toHaveBeenCalled();
    expect(result.current.error).toBe("조회 실패");
    unmount();
  });

  it("동기화 명령 실패를 프로젝트와 최근 기록에서 분리한다", async () => {
    const gateway = gatewayFor({
      synchronizeManagedAssets: vi
        .fn()
        .mockRejectedValue(new Error("관리 규칙 충돌")),
    });
    const recentStore: RecentProjectStore = {
      load: vi.fn().mockReturnValue([]),
      remember: vi.fn().mockReturnValue([
        { name: project.name, path: project.rootPath, lastOpenedAt: "now" },
      ]),
    };
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());

    expect(result.current.project).toEqual(project);
    expect(result.current.recentProjects).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.managedAssets).toEqual({
      syncing: false,
      result: null,
      error: "관리 규칙 충돌",
      trigger: "project_open",
    });
    unmount();
  });

  it("파일 변경 알림을 500ms 묶어 프로젝트만 한 번 다시 읽는다", async () => {
    vi.useFakeTimers();
    try {
      let changed: (() => void) | null = null;
      const gateway = gatewayFor({
        watchProject: vi.fn().mockImplementation(async (_path, onChanged) => {
          changed = onChanged;
          return vi.fn().mockResolvedValue(undefined);
        }),
      });
      const recentStore = storeStub();
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );

      await act(() => result.current.openFolder());
      const before = result.current.managedAssets;
      expect(gateway.synchronizeManagedAssets).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(changed).not.toBeNull();
      act(() => { changed!(); changed!(); changed!(); });
      await act(() => vi.advanceTimersByTimeAsync(499));
      expect(gateway.inspect).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(1));

      expect(gateway.inspect).toHaveBeenCalledTimes(2);
      expect(gateway.synchronizeManagedAssets).toHaveBeenCalledTimes(1);
      expect(result.current.managedAssets).toEqual(before);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("프로젝트 열기와 수동 새로 고침은 관리 규칙 동기화 뒤 사용자 규칙을 읽는다", async () => {
    const calls: string[] = [];
    const gateway = gatewayFor({
      inspect: vi.fn().mockImplementation(async () => {
        calls.push("inspect");
        return project;
      }),
      synchronizeManagedAssets: vi.fn().mockImplementation(async () => {
        calls.push("sync");
        return managedAssetsResult;
      }),
      readCustomRules: vi.fn().mockImplementation(async () => {
        calls.push("custom");
        return customRulesDocument;
      }),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openRecent(project.rootPath));
    expect(calls).toEqual(["inspect", "sync", "custom"]);
    expect(result.current.customRules.document).toEqual(customRulesDocument);

    calls.length = 0;
    await act(() => result.current.refresh());
    expect(calls).toEqual(["inspect", "sync", "custom"]);
    unmount();
  });

  it("관리 규칙 동기화가 실패해도 사용자 규칙 조회와 프로젝트를 유지한다", async () => {
    const gateway = gatewayFor({
      synchronizeManagedAssets: vi.fn().mockRejectedValue(new Error("동기화 실패")),
      readCustomRules: vi.fn().mockResolvedValue({
        ...customRulesDocument,
        status: "future_schema",
        enabled: false,
        appliesTo: [],
        body: "",
        error: "새로운 형식입니다.",
      }),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openRecent(project.rootPath));

    expect(result.current.project).toEqual(project);
    expect(result.current.error).toBeNull();
    expect(result.current.managedAssets.error).toBe("동기화 실패");
    expect(result.current.customRules.document?.status).toBe("future_schema");
    unmount();
  });

  it.each(["absent", "invalid", "future_schema", "unsafe_file"] as const)(
    "사용자 규칙 파일 상태가 %s여도 프로젝트를 유지한다",
    async (status) => {
      const document: CustomRulesDocument = {
        ...absentCustomRules,
        status,
        error: status === "absent" ? null : `사용자 규칙 상태: ${status}`,
      };
      const gateway = gatewayFor({
        readCustomRules: vi.fn().mockResolvedValue(document),
      });
      const recentStore = storeStub();
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );

      await act(() => result.current.openRecent(project.rootPath));

      expect(result.current.project).toEqual(project);
      expect(result.current.error).toBeNull();
      expect(result.current.customRules.document).toEqual(document);
      unmount();
    },
  );

  it("시간 경과만으로 프로젝트와 사용자 규칙을 반복 조회하지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const gateway = gatewayFor({
        readCustomRules: vi.fn().mockResolvedValue(customRulesDocument),
      });
      const recentStore = storeStub();
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );

      await act(() => result.current.openRecent(project.rootPath));
      await act(() => vi.advanceTimersByTimeAsync(7_500));

      expect(gateway.inspect).toHaveBeenCalledTimes(1);
      expect(gateway.readCustomRules).toHaveBeenCalledTimes(1);
      expect(gateway.prepareCustomRulesPreview).not.toHaveBeenCalled();
      expect(gateway.saveCustomRules).not.toHaveBeenCalled();
      expect(result.current.customRules.document).toEqual(customRulesDocument);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("같은 내용 식별값의 자동 조회는 미리보기와 재시도 결과를 유지한다", async () => {
    vi.useFakeTimers();
    try {
      const retry: SaveCustomRulesResult = {
        status: "retry_required",
        document: customRulesDocument,
        reason: "잠금 사용 중",
      };
      const gateway = gatewayFor({
        readCustomRules: vi.fn().mockResolvedValue(customRulesDocument),
        saveCustomRules: vi.fn().mockResolvedValue(retry),
      });
      const recentStore = storeStub();
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );

      await act(() => result.current.openRecent(project.rootPath));
      await act(() =>
        result.current.customRulesActions.preparePreview(customRulesDraft),
      );
      await act(() => result.current.customRulesActions.save());
      const previewBefore = result.current.customRules.preview;
      const resultBefore = result.current.customRules.saveResult;

      await act(() => vi.advanceTimersByTimeAsync(2_500));

      expect(result.current.customRules.preview).toBe(previewBefore);
      expect(result.current.customRules.saveResult).toBe(resultBefore);
      expect(result.current.customRules.previewBaselineContentHash).toBe("sha256:old");
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("외부 변경을 읽어도 저장은 미리보기 준비 당시의 식별값을 사용한다", async () => {
    vi.useFakeTimers();
    try {
      const changed = {
        ...customRulesDocument,
        body: "외부에서 바뀐 본문",
        contentHash: "sha256:external",
      };
      const readCustomRules = vi
        .fn()
        .mockResolvedValueOnce(customRulesDocument)
        .mockResolvedValue(changed);
      const saveCustomRules = vi.fn().mockResolvedValue({
        status: "conflict",
        document: changed,
        reason: "외부 변경",
      } satisfies SaveCustomRulesResult);
      let changedProject: (() => void) | null = null;
      const gateway = gatewayFor({
        readCustomRules,
        saveCustomRules,
        watchProject: vi.fn().mockImplementation(async (_path, onChanged) => {
          changedProject = onChanged;
          return vi.fn().mockResolvedValue(undefined);
        }),
      });
      const recentStore = storeStub();
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );

      await act(() => result.current.openRecent(project.rootPath));
      await act(() =>
        result.current.customRulesActions.preparePreview(customRulesDraft),
      );
      await act(() => vi.advanceTimersByTimeAsync(0));
      act(() => changedProject!());
      await act(() => vi.advanceTimersByTimeAsync(500));
      expect(result.current.customRules.document).toEqual(changed);

      await act(() => result.current.customRulesActions.save());

      expect(saveCustomRules).toHaveBeenCalledWith(project.rootPath, {
        expectedContentHash: "sha256:old",
        draft: customRulesPreview.draft,
        updatedAt: customRulesPreview.updatedAt,
        previewHash: customRulesPreview.previewHash,
      });
      expect(result.current.customRules.document).toEqual(changed);
      expect(result.current.customRules.preview).toEqual(customRulesPreview);
      expect(result.current.customRules.saveResult?.status).toBe("conflict");
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("저장 성공은 최신 문서를 반영하고 사용한 미리보기만 비운다", async () => {
    const gateway = gatewayFor({
      readCustomRules: vi.fn().mockResolvedValue(customRulesDocument),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openRecent(project.rootPath));
    await act(() =>
      result.current.customRulesActions.preparePreview(customRulesDraft),
    );
    await act(() => result.current.customRulesActions.save());

    expect(result.current.customRules.document).toEqual(savedCustomRules.document);
    expect(result.current.customRules.preview).toBeNull();
    expect(result.current.customRules.previewBaselineContentHash).toBeNull();
    expect(result.current.customRules.saveResult).toEqual(savedCustomRules);
    unmount();
  });

  it("명령 오류는 사용자 규칙 상태에만 남고 다시 불러오기는 임시 상태를 비운다", async () => {
    const readCustomRules = vi
      .fn()
      .mockResolvedValueOnce(customRulesDocument)
      .mockRejectedValueOnce(new Error("사용자 규칙을 읽지 못했습니다"));
    const gateway = gatewayFor({
      readCustomRules,
      saveCustomRules: vi.fn().mockRejectedValue(new Error("저장 명령 실패")),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openRecent(project.rootPath));
    await act(() =>
      result.current.customRulesActions.preparePreview(customRulesDraft),
    );
    await act(() => result.current.customRulesActions.save());
    expect(result.current.customRules.saveError).toBe("저장 명령 실패");
    expect(result.current.customRules.preview).toEqual(customRulesPreview);

    await act(() => result.current.customRulesActions.reload());

    expect(result.current.project).toEqual(project);
    expect(result.current.error).toBeNull();
    expect(result.current.customRules.readError).toBe("사용자 규칙을 읽지 못했습니다");
    expect(result.current.customRules.preview).toBeNull();
    expect(result.current.customRules.saveResult).toBeNull();
    expect(result.current.customRules.saveError).toBeNull();
    unmount();
  });

  it("이전 프로젝트의 늦은 사용자 규칙 조회 응답을 무시한다", async () => {
    const firstPath = "/projects/first";
    const secondPath = "/projects/second";
    const firstRead = deferred<CustomRulesDocument>();
    const secondDocument = {
      ...customRulesDocument,
      body: "두 번째 프로젝트",
      contentHash: "sha256:second",
    };
    const gateway = gatewayFor({
      inspect: vi.fn().mockImplementation(async (path: string) => ({
        ...project,
        rootPath: path,
        name: path,
      })),
      readCustomRules: vi.fn().mockImplementation((path: string) =>
        path === firstPath ? firstRead.promise : Promise.resolve(secondDocument),
      ),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    let firstOpen!: Promise<ProjectSummary | null>;
    act(() => {
      firstOpen = result.current.openRecent(firstPath);
    });
    await waitFor(() => expect(gateway.readCustomRules).toHaveBeenCalledWith(firstPath));
    await act(() => result.current.openRecent(secondPath));
    await act(async () => {
      firstRead.resolve(customRulesDocument);
      await firstOpen;
    });

    expect(result.current.project?.rootPath).toBe(secondPath);
    expect(result.current.customRules.document).toEqual(secondDocument);
    unmount();
  });

  it("이전 프로젝트의 늦은 미리보기와 저장 응답을 무시한다", async () => {
    const secondProject = { ...project, rootPath: "/projects/second" };
    const pendingPreview = deferred<CustomRulesPreview>();
    const pendingSave = deferred<SaveCustomRulesResult>();
    const gateway = gatewayFor({
      inspect: vi.fn().mockImplementation(async (path: string) =>
        path === secondProject.rootPath ? secondProject : project,
      ),
      readCustomRules: vi.fn().mockImplementation(async (path: string) =>
        path === secondProject.rootPath ? absentCustomRules : customRulesDocument,
      ),
      prepareCustomRulesPreview: vi
        .fn()
        .mockReturnValueOnce(pendingPreview.promise)
        .mockResolvedValue(customRulesPreview),
      saveCustomRules: vi.fn().mockReturnValue(pendingSave.promise),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openRecent(project.rootPath));
    let previewRequest!: Promise<CustomRulesPreview | null>;
    act(() => {
      previewRequest = result.current.customRulesActions.preparePreview(customRulesDraft);
    });
    await waitFor(() => expect(gateway.prepareCustomRulesPreview).toHaveBeenCalledTimes(1));
    await act(() => result.current.openRecent(secondProject.rootPath));
    await act(async () => {
      pendingPreview.resolve(customRulesPreview);
      await previewRequest;
    });
    expect(result.current.customRules.preview).toBeNull();
    expect(result.current.customRules.document).toEqual(absentCustomRules);

    await act(() => result.current.openRecent(project.rootPath));
    await act(() =>
      result.current.customRulesActions.preparePreview(customRulesDraft),
    );
    let saveRequest!: Promise<SaveCustomRulesResult | null>;
    act(() => {
      saveRequest = result.current.customRulesActions.save();
    });
    await waitFor(() => expect(gateway.saveCustomRules).toHaveBeenCalledTimes(1));
    await act(() => result.current.openRecent(secondProject.rootPath));
    await act(async () => {
      pendingSave.resolve(savedCustomRules);
      await saveRequest;
    });

    expect(result.current.customRules.document).toEqual(absentCustomRules);
    expect(result.current.customRules.saveResult).toBeNull();
    unmount();
  });

  it("uses the gateway and remembers an opened project", async () => {
    const gateway = gatewayFor({
      inspectIntegrations: vi.fn().mockRejectedValue(new Error("integrations")),
      installHeartbeatJobs: vi.fn().mockRejectedValue(new Error("integrations")),
    });
    const recentStore: RecentProjectStore = {
      load: vi.fn().mockReturnValue([]),
      remember: vi.fn().mockReturnValue([
        { name: project.name, path: project.rootPath, lastOpenedAt: "now" },
      ]),
    };
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await waitFor(() => expect(result.current.project).toEqual(project));
    expect(recentStore.remember).toHaveBeenCalledWith(project);

    await act(() => result.current.createIdea("feature--wf_1", "아이디어"));
    expect(gateway.createIdea).toHaveBeenCalledWith(
      project.rootPath,
      "feature--wf_1",
      "아이디어",
    );
    expect(result.current.project?.workflows[0].counts.ideas).toBe(1);
    unmount();
  });

  // 2.5초마다 실패가 반복되면 앱을 쓸 수 없다. 조회 실패는 연동 섹션 안에만 남는다.
  it.skip("keeps a failed integrations read out of the workspace error", async () => {
    const gateway = gatewayFor({
      inspectIntegrations: vi.fn().mockRejectedValue(new Error("홈 디렉터리를 찾지 못했습니다")),
    });
    const recentStore: RecentProjectStore = {
      load: vi.fn().mockReturnValue([]),
      remember: vi.fn().mockReturnValue([]),
    };
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());

    await waitFor(() =>
      expect(result.current.integrations.error).toBe("홈 디렉터리를 찾지 못했습니다"),
    );
    expect(result.current.integrations.snapshot).toBeNull();
    expect(result.current.error).toBeNull();
    unmount();
  });

  // 쓰기 실패 문구가 2.5초 주기 조회로 사라지면 사용자가 읽을 수 없다.
  it.skip("keeps a failed write visible while the 2.5s read keeps running", async () => {
    vi.useFakeTimers();
    try {
      const gateway = gatewayFor({
        installHeartbeatJobs: vi.fn().mockRejectedValue(new Error("마커가 손상되었습니다")),
      });
      const recentStore: RecentProjectStore = {
        load: vi.fn().mockReturnValue([]),
        remember: vi.fn().mockReturnValue([]),
      };
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );

      await act(() => result.current.openFolder());
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(result.current.integrations.snapshot).toEqual(snapshot);

      await act(() =>
        result.current.integrationActions.installHeartbeatJobs(
          [
            {
              role: "developer",
              enabled: true,
              interval: "20m",
              maxPer: { kind: "limit", value: "6/24h" },
              model: "opus",
              timeout: "30m",
            },
          ],
          [],
        ),
      );
      expect(result.current.integrations.writeError).toEqual({
        integration: "heartbeat",
        message: "마커가 손상되었습니다",
      });

      await act(() => vi.advanceTimersByTimeAsync(2_500));
      expect(result.current.integrations.writeError).toEqual({
        integration: "heartbeat",
        message: "마커가 손상되었습니다",
      });
      expect(result.current.integrations.snapshot).toEqual(snapshot);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  // R3. 훅은 기준값을 들여다보지 않고 게이트웨이에 그대로 넘긴다. 대조는 쓰기 직전의 파일을 아는
  // 백엔드가 한다.
  it.skip("passes the baseline the card read straight through to the gateway", async () => {
    const gateway = gatewayFor();
    const recentStore: RecentProjectStore = {
      load: vi.fn().mockReturnValue([]),
      remember: vi.fn().mockReturnValue([]),
    };
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );
    const baseline = [
      {
        role: "developer",
        interval: "20m",
        maxPer: "8/24h",
        model: "opus",
        timeout: null,
        appOwnedDrift: [],
      },
    ];

    await act(() => result.current.openFolder());
    await act(() =>
      result.current.integrationActions.installHeartbeatJobs(
        [{ role: "developer", enabled: true, interval: "45m", maxPer: null, model: null, timeout: null }],
        baseline,
      ),
    );

    expect(gateway.installHeartbeatJobs).toHaveBeenCalledWith(
      project.rootPath,
      [{ role: "developer", enabled: true, interval: "45m", maxPer: null, model: null, timeout: null }],
      baseline,
    );
    unmount();
  });

  it("reads one idea document through the gateway", async () => {
    const document = {
      summary: {
        fileName: "IDEA-001.md",
        id: "IDEA-001",
        title: "아이디어 전문 읽기",
        status: "inbox",
        updatedAt: "2026-08-02T00:00:00Z",
        excerpt: "첫째 줄 배경이다.",
      },
      body: "첫째 줄 배경이다.\n넷째 줄은 요약에서 잘린다.",
    };
    const gateway = gatewayFor({
      readIdea: vi.fn().mockResolvedValue(document),
    });
    const recentStore: RecentProjectStore = {
      load: vi.fn().mockReturnValue([]),
      remember: vi.fn().mockReturnValue([]),
    };
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let read: Awaited<ReturnType<typeof result.current.readIdea>> = null;
    await act(async () => {
      read = await result.current.readIdea("feature--wf_1", "IDEA-001.md");
    });

    expect(gateway.readIdea).toHaveBeenCalledWith(
      project.rootPath,
      "feature--wf_1",
      "IDEA-001.md",
    );
    expect(read).toEqual(document);
    expect(result.current.error).toBeNull();
    unmount();
  });

  // 전문을 못 읽는 것은 미리보기 하나의 실패다. 훅은 사유만 올리고 화면을 세우지 않는다.
  it("reports a failed idea read as null with the reason", async () => {
    const gateway = gatewayFor({
      readIdea: vi.fn().mockRejectedValue(new Error("아이디어 문서를 찾을 수 없습니다")),
    });
    const recentStore: RecentProjectStore = {
      load: vi.fn().mockReturnValue([]),
      remember: vi.fn().mockReturnValue([]),
    };
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let read: Awaited<ReturnType<typeof result.current.readIdea>> = null;
    await act(async () => {
      read = await result.current.readIdea("feature--wf_1", "IDEA-001.md");
    });

    expect(read).toBeNull();
    await waitFor(() =>
      expect(result.current.error).toBe("아이디어 문서를 찾을 수 없습니다"),
    );
    unmount();
  });

  // 일괄 확인은 앱 호출 한 번이다. 건별 결과가 그대로 화면으로 가고, 요약은 응답의 것으로 바뀐다.
  it("일괄 확인을 게이트웨이 한 번으로 부르고 건별 결과를 그대로 돌려준다", async () => {
    const results: TaskQaBatchEntry[] = [
      { fileName: "TASK-001.md", taskId: "TASK-001", recorded: true, message: null },
      {
        fileName: "TASK-002.md",
        taskId: "TASK-002",
        recorded: false,
        message: "QA 대기 상태인 개발 작업만 확인할 수 있습니다.",
      },
    ];
    const batched: ProjectSummary = {
      ...project,
      workflows: [
        {
          ...project.workflows[0],
          counts: { ...project.workflows[0].counts, decisions: 1 },
        },
      ],
    };
    const gateway = gatewayFor({
      confirmTaskQaBatch: vi
        .fn()
        .mockResolvedValue({ summary: batched, results }),
    });
    const recentStore: RecentProjectStore = {
      load: vi.fn().mockReturnValue([]),
      remember: vi.fn().mockReturnValue([]),
    };
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let confirmed: TaskQaBatchEntry[] | null = null;
    await act(async () => {
      confirmed = await result.current.confirmTaskQaBatch(
        "feature--wf_1",
        ["TASK-001.md", "TASK-002.md"],
        "한 번에 확인함",
      );
    });

    expect(gateway.confirmTaskQaBatch).toHaveBeenCalledTimes(1);
    expect(gateway.confirmTaskQaBatch).toHaveBeenCalledWith(
      project.rootPath,
      "feature--wf_1",
      ["TASK-001.md", "TASK-002.md"],
      "한 번에 확인함",
    );
    expect(confirmed).toEqual(results);
    await waitFor(() => expect(result.current.project).toEqual(batched));
    expect(result.current.error).toBeNull();
    unmount();
  });

  it("일괄 확인 호출이 실패하면 null과 전역 사유가 남는다", async () => {
    const gateway = gatewayFor({
      confirmTaskQaBatch: vi
        .fn()
        .mockRejectedValue(new Error("결정 코멘트는 2,000자 이하여야 합니다.")),
    });
    const recentStore: RecentProjectStore = {
      load: vi.fn().mockReturnValue([]),
      remember: vi.fn().mockReturnValue([]),
    };
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let confirmed: TaskQaBatchEntry[] | null = [];
    await act(async () => {
      confirmed = await result.current.confirmTaskQaBatch(
        "feature--wf_1",
        ["TASK-001.md"],
        "너무 긴 코멘트",
      );
    });

    expect(confirmed).toBeNull();
    await waitFor(() =>
      expect(result.current.error).toBe("결정 코멘트는 2,000자 이하여야 합니다."),
    );
    unmount();
  });
});

describe("useProjectWorkspace 에이전트 실행", () => {
  const request = [{ role: "developer", slots: 2, targets: ["TASK-S051-01"] }];
  const plan = {
    planId: "run-plan-1",
    projectId: project.projectId,
    revision: "queue-rev-1",
    expiresAt: "2026-08-08T12:00:00Z",
    deviceRemaining: 4,
    projectRemaining: 3,
    billingRouteRisk: false,
    limits: {},
    roles: [],
  };

  it("정책 조회가 실패해도 런타임 검사 결과를 보존한다", async () => {
    const launcherMissing: AgentRuntimeInspection = {
      ...agentInspection,
      status: null,
      compatibility: { kind: "undetermined", reason: "launcher_missing" },
      executionAllowed: false,
      unavailable: "launcher_missing",
    };
    const policyFailure = "launcher_missing: 실행 파일을 찾을 수 없습니다";
    const gateway = gatewayFor({
      inspectAgentRuntime: vi.fn().mockResolvedValue(launcherMissing),
      readAgentRuntimePolicy: vi.fn().mockRejectedValue(new Error(policyFailure)),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await waitFor(() => expect(result.current.agentRuntime.reading).toBe(false));

    expect(result.current.agentRuntime.inspection).toEqual(launcherMissing);
    expect(result.current.agentRuntime.readError).toBe(policyFailure);

    await act(() => result.current.agentRuntimeActions.plan("install"));
    expect(gateway.planAgentRuntimeInstall).toHaveBeenCalledTimes(1);
    expect(result.current.agentRuntime.plan).toEqual({
      kind: "install",
      plan: agentInstallPlan,
    });
    await act(() => result.current.agentRuntimeActions.apply());
    expect(gateway.applyAgentRuntimeInstall).toHaveBeenCalledWith(agentInstallPlan.planId, true);
    expect(gateway.inspectAgentRuntime).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("기존 설정 이전을 적용한 뒤 서비스 상태를 다시 읽는다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await waitFor(() => expect(result.current.agentRuntime.reading).toBe(false));
    await act(() => result.current.agentRuntimeActions.previewMigration());
    await waitFor(() => expect(result.current.agentRuntime.migration).toEqual(agentMigration));
    await act(() => result.current.agentRuntimeActions.applyMigration());

    expect(gateway.applyAgentRuntimeMigration).toHaveBeenCalledWith(
      project.rootPath,
      project.projectId,
      agentMigration.previewId,
      agentPolicy.revision,
    );
    expect(gateway.inspectAgentRuntime).toHaveBeenCalledTimes(2);
    expect(result.current.agentRuntime.migration).toBeNull();
    unmount();
  });

  it("수동 대상을 프로젝트 식별자와 함께 계획하고 확인 뒤 시작한다", async () => {
    const gateway = gatewayFor({
      planAgentRun: vi.fn().mockResolvedValue(plan),
      startAgentRun: vi.fn().mockResolvedValue({ started: [], failures: [] }),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() => result.current.agentRuntimeActions.planRun(request));
    expect(gateway.planAgentRun).toHaveBeenCalledWith(project.projectId, request);
    expect(gateway.startAgentRun).not.toHaveBeenCalled();

    let started = false;
    await act(async () => {
      started = await result.current.agentRuntimeActions.startRun();
    });
    expect(started).toBe(true);
    expect(gateway.startAgentRun).toHaveBeenCalledWith(project.projectId, "run-plan-1", true);
    expect(gateway.inspectAgentRuns).toHaveBeenCalledWith(project.projectId);
    unmount();
  });

  it("stale plan은 시작하지 않고 새 계획을 다시 확인 상태로 둔다", async () => {
    const fresh = { ...plan, planId: "run-plan-2", revision: "queue-rev-2" };
    const gateway = gatewayFor({
      planAgentRun: vi.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(fresh),
      startAgentRun: vi.fn().mockRejectedValue("계획이 더 이상 유효하지 않습니다"),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() => result.current.agentRuntimeActions.planRun(request));
    let started = true;
    await act(async () => {
      started = await result.current.agentRuntimeActions.startRun();
    });

    expect(started).toBe(false);
    expect(gateway.startAgentRun).toHaveBeenCalledTimes(1);
    expect(gateway.planAgentRun).toHaveBeenCalledTimes(2);
    expect(result.current.agentRuntime.runPlan?.planId).toBe("run-plan-2");
    expect(result.current.agentRuntime.runError).toMatch(/최신 계획을 다시 확인/);
    unmount();
  });

  it("pause·cancel·retry·logs는 모두 열린 프로젝트 식별자를 사용한다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );
    await act(() => result.current.openFolder());

    await act(() => result.current.agentRuntimeActions.setProjectPaused(true));
    await act(() => result.current.agentRuntimeActions.previewCancel("run-1"));
    await act(() => result.current.agentRuntimeActions.readRunLog("run-1"));

    expect(gateway.pauseAgentProject).toHaveBeenCalledWith(project.projectId);
    expect(gateway.cancelAgentRun).toHaveBeenCalledWith(project.projectId, "run-1", false);
    expect(gateway.readAgentRunLog).toHaveBeenCalledWith(project.projectId, "run-1", 0);
    unmount();
  });

  // 활동 없음 신호는 새 이벤트가 와야 사라진다. 사용자가 단추를 누른 순간의 이벤트만으로는
  // 판정할 수 없으므로 상세가 열려 있는 동안 이어 읽는다.
  it("실행 상세가 열려 있는 동안 이벤트를 이어 읽고 닫으면 멈춘다", async () => {
    vi.useFakeTimers();
    try {
      const readAgentRunLog = vi
        .fn()
        .mockResolvedValueOnce({ runId: "run-1", events: [{ kind: "started" }], nextCursor: 1 })
        .mockResolvedValue({ runId: "run-1", events: [{ kind: "progress" }], nextCursor: 2 });
      const gateway = gatewayFor({ readAgentRunLog });
      const recentStore = storeStub();
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );
      await act(() => result.current.openFolder());

      act(() => result.current.agentRuntimeActions.watchRunLog("run-1"));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(readAgentRunLog).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(2_500));
      await act(() => vi.advanceTimersByTimeAsync(2_500));
      expect(readAgentRunLog).toHaveBeenCalledTimes(3);
      // 이어 읽기는 마지막으로 읽은 위치에서 계속한다. 같은 이벤트를 다시 쌓지 않는다.
      expect(readAgentRunLog).toHaveBeenLastCalledWith(project.projectId, "run-1", 2);
      expect(result.current.agentRuntime.logs["run-1"]?.events).toHaveLength(3);

      act(() => result.current.agentRuntimeActions.watchRunLog(null));
      await act(() => vi.advanceTimersByTimeAsync(7_500));
      expect(readAgentRunLog).toHaveBeenCalledTimes(3);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("실행에 연결된 보고서를 실행 식별자별로 보관하고 판정 입력만 백엔드에 넘긴다", async () => {
    const listRunReports = vi
      .fn()
      .mockResolvedValueOnce([{ fileName: "REPORT-TASK-1-DEV.md", title: "구현 보고서" }])
      .mockResolvedValueOnce([]);
    const gateway = gatewayFor({ listRunReports });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );
    await act(() => result.current.openFolder());

    await act(() => result.current.agentRuntimeActions.readRunReports(runOf("run-1", "TASK-1"), "feature--wf_1"));
    await act(() => result.current.agentRuntimeActions.readRunReports(runOf("run-2", "TASK-2"), "feature--wf_1"));

    // 넘기는 것은 열린 프로젝트 경로와 등록된 워크플로 디렉터리, 그리고 실행 기록이 이미 싣고 있는
    // 대상 문서 식별자와 예약 결과 접두어뿐이다. 보고서 파일 이름은 여기에 없다.
    expect(listRunReports).toHaveBeenCalledWith(
      project.rootPath,
      "feature--wf_1",
      "TASK-1",
      "RES-run-1",
    );
    expect(result.current.agentRuntime.runReports["run-1"]).toHaveLength(1);
    expect(result.current.agentRuntime.runReports["run-2"]).toHaveLength(0);
    unmount();
  });

  it("연결을 확인하지 못하면 그 실행의 보고서 자리를 비우고 다른 실행의 목록은 남긴다", async () => {
    const listRunReports = vi
      .fn()
      .mockResolvedValueOnce([{ fileName: "REPORT-TASK-1-DEV.md", title: "구현 보고서" }])
      .mockResolvedValueOnce([{ fileName: "REPORT-TASK-2-DEV.md", title: "후속 보고서" }])
      .mockRejectedValueOnce(new Error("워크플로 디렉터리를 읽지 못했습니다"));
    const gateway = gatewayFor({ listRunReports });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );
    await act(() => result.current.openFolder());

    await act(() => result.current.agentRuntimeActions.readRunReports(runOf("run-1", "TASK-1"), "feature--wf_1"));
    await act(() => result.current.agentRuntimeActions.readRunReports(runOf("run-2", "TASK-2"), "feature--wf_1"));
    await act(() => result.current.agentRuntimeActions.readRunReports(runOf("run-1", "TASK-1"), "feature--wf_1"));

    expect(result.current.agentRuntime.runReports["run-1"]).toBeUndefined();
    expect(result.current.agentRuntime.runReports["run-2"]).toHaveLength(1);
    unmount();
  });

  it("보고서 본문을 읽어 화면 상태에 담고 읽지 못하면 본문 없이 사유만 남긴다", async () => {
    const readReport = vi
      .fn()
      .mockResolvedValueOnce({
        summary: { fileName: "REPORT-TASK-1-DEV.md", title: "구현 보고서" },
        body: "# 구현 보고서\n\n검사 469개가 통과했다.\n",
      })
      .mockRejectedValueOnce(new Error("보고서 파일을 찾을 수 없습니다"));
    const gateway = gatewayFor({ readReport });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );
    await act(() => result.current.openFolder());

    await act(() => result.current.agentRuntimeActions.openReport("feature--wf_1", reportSummary));
    expect(readReport).toHaveBeenCalledWith(project.rootPath, "feature--wf_1", reportSummary.fileName);
    expect(result.current.agentRuntime.reportView?.body).toMatch(/검사 469개가 통과했다/);
    expect(result.current.agentRuntime.reportView?.reading).toBe(false);

    await act(() => result.current.agentRuntimeActions.openReport("feature--wf_1", reportSummary));
    // 읽지 못한 본문을 빈 문자열로 대신하지 않는다. 화면은 사유만 보여 준다.
    expect(result.current.agentRuntime.reportView?.body).toBeNull();
    expect(result.current.agentRuntime.reportView?.error).toMatch(/보고서 파일을 찾을 수 없습니다/);

    act(() => result.current.agentRuntimeActions.closeReport());
    expect(result.current.agentRuntime.reportView).toBeNull();
    unmount();
  });

  it("저장 위치를 고르지 않고 닫으면 내보내기를 부르지 않아 파일이 만들어지지 않는다", async () => {
    const chooseDiagnosticsFile = vi.fn().mockResolvedValue(null);
    const exportAgentRunDiagnostics = vi.fn().mockResolvedValue("{}");
    const gateway = gatewayFor({ chooseDiagnosticsFile, exportAgentRunDiagnostics });
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore: storeStub() }),
    );
    await act(() => result.current.openFolder());

    await act(() => result.current.agentRuntimeActions.exportRunDiagnostics("run-1", "save"));

    expect(chooseDiagnosticsFile).toHaveBeenCalled();
    expect(exportAgentRunDiagnostics).not.toHaveBeenCalled();
    expect(result.current.agentRuntime.diagnosticExport).toBeNull();
    unmount();
  });

  it("저장은 고른 위치를 넘기고 복사는 위치 없이 받은 내용을 클립보드에 넣는다", async () => {
    const content = '{"bundleVersion":"1","runId":"run-1"}';
    const exportAgentRunDiagnostics = vi.fn().mockResolvedValue(content);
    const gateway = gatewayFor({ exportAgentRunDiagnostics });
    clipboardCopy.mockResolvedValue(true);
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore: storeStub() }),
    );
    await act(() => result.current.openFolder());

    await act(() => result.current.agentRuntimeActions.exportRunDiagnostics("run-1", "save"));
    expect(exportAgentRunDiagnostics).toHaveBeenLastCalledWith(
      project.projectId,
      "run-1",
      "/tmp/run-1-diagnostics.json",
    );
    expect(result.current.agentRuntime.diagnosticExport).toEqual({
      runId: "run-1",
      mode: "save",
      status: "done",
      error: null,
    });

    await act(() => result.current.agentRuntimeActions.exportRunDiagnostics("run-1", "copy"));
    // 복사는 위치를 묻지 않는다. 백엔드는 같은 조립 결과를 문자열로 돌려주고 그 값이 클립보드로 간다.
    expect(exportAgentRunDiagnostics).toHaveBeenLastCalledWith(project.projectId, "run-1", null);
    expect(clipboardCopy).toHaveBeenCalledWith(content);
    expect(result.current.agentRuntime.diagnosticExport?.status).toBe("done");
    unmount();
  });

  it("클립보드에 넣지 못하면 성공으로 적지 않고 사유를 남긴다", async () => {
    const gateway = gatewayFor({});
    clipboardCopy.mockResolvedValue(false);
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore: storeStub() }),
    );
    await act(() => result.current.openFolder());

    await act(() => result.current.agentRuntimeActions.exportRunDiagnostics("run-1", "copy"));

    expect(result.current.agentRuntime.diagnosticExport?.status).toBe("failed");
    expect(result.current.agentRuntime.diagnosticExport?.error).toMatch(/클립보드/);
    unmount();
  });

  it("프로젝트를 다시 열면 메모리 복원 대신 런타임 큐를 즉시 읽는다", async () => {
    const inspectAgentRuns = vi.fn().mockResolvedValue({
      projectId: project.projectId,
      paused: false,
      runs: [],
      errors: [],
      providers: [],
      unavailable: null,
    });
    const gateway = gatewayFor({ inspectAgentRuns });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await waitFor(() => expect(inspectAgentRuns).toHaveBeenCalledWith(project.projectId));
    expect(result.current.agentRuntime.queue?.projectId).toBe(project.projectId);
    unmount();
  });
});

const developerJob = "wf-developer-projects-workflow-labs";
const plannerJob = "wf-planner-projects-workflow-labs";

/** 훅은 언제나 실행 상태를 채워 내보낸다. 타입상 선택 필드라 여기서 한 번만 좁힌다. */
function runControls(state: IntegrationsState): HeartbeatRunControls {
  const controls = state.heartbeatRuns;
  if (!controls) throw new Error("훅이 heartbeatRuns를 내보내지 않았다");
  return controls;
}

/**
 * 끝나는 시점을 테스트가 정하는 실행. 진행 중 상태를 볼 수 있는 유일한 방법이다.
 *
 * 호출마다 매듭을 쌓아 두고 `settleAll`이 전부 푼다. 마지막 하나만 들고 있으면 두 잡을 띄운
 * 테스트에서 먼저 띄운 실행이 영원히 끝나지 않는다.
 */
function pendingRun() {
  const settlers: ((failure?: unknown) => void)[] = [];
  const gatewayCall = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        settlers.push((failure) =>
          failure === undefined ? resolve() : reject(failure),
        );
      }),
  );
  return {
    gatewayCall,
    settleAll: (failure?: unknown) =>
      settlers.splice(0).forEach((settle) => settle(failure)),
  };
}

function storeStub(): RecentProjectStore {
  return {
    load: vi.fn().mockReturnValue([]),
    remember: vi.fn().mockReturnValue([]),
  };
}

describe.skip("useProjectWorkspace 폐기된 잡 실행", () => {
  it("열린 프로젝트의 경로와 잡 이름으로 커맨드를 부른다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let started: boolean | undefined;
    await act(async () => {
      started = await runControls(result.current.integrations).run(developerJob);
    });

    expect(started).toBe(true);
    expect(gateway.runHeartbeatJob).toHaveBeenCalledWith(
      project.rootPath,
      developerJob,
    );
    unmount();
  });

  // 훅 단의 마지막 방어선이다. 버튼이 잠기지 않아도 같은 잡이 겹쳐 돌지 않는다.
  it("이미 도는 잡을 다시 부르면 게이트웨이 호출이 늘지 않는다", async () => {
    const { gatewayCall, settleAll } = pendingRun();
    const gateway = gatewayFor({ runHeartbeatJob: gatewayCall });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let first!: Promise<boolean>;
    await act(async () => {
      first = runControls(result.current.integrations).run(developerJob);
    });
    expect(runControls(result.current.integrations).running).toEqual([
      developerJob,
    ]);

    let second: boolean | undefined;
    await act(async () => {
      second = await runControls(result.current.integrations).run(developerJob);
    });

    expect(second).toBe(false);
    expect(gatewayCall).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleAll();
      await first;
    });
    expect(runControls(result.current.integrations).running).toEqual([]);
    unmount();
  });

  // 역할마다 따로 담기므로 한 역할이 다른 역할을 막지 않는다(R3).
  it("한 잡이 도는 동안 다른 잡은 그대로 실행된다", async () => {
    const { gatewayCall, settleAll } = pendingRun();
    const gateway = gatewayFor({ runHeartbeatJob: gatewayCall });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let runs!: Promise<boolean[]>;
    await act(async () => {
      const controls = runControls(result.current.integrations);
      runs = Promise.all([controls.run(developerJob), controls.run(plannerJob)]);
    });

    expect(gatewayCall).toHaveBeenCalledTimes(2);
    expect(runControls(result.current.integrations).running).toEqual([
      developerJob,
      plannerJob,
    ]);

    await act(async () => {
      settleAll();
      await runs;
    });
    expect(runControls(result.current.integrations).running).toEqual([]);
    unmount();
  });

  it("실패로 끝나도 잡 이름이 진행 중에서 빠지고 사유가 남는다", async () => {
    const failure = {
      jobName: developerJob,
      message: "heartbeat 실행 파일을 찾지 못했습니다",
      command: `heartbeat once -j ${developerJob}`,
    };
    const gateway = gatewayFor({
      runHeartbeatJob: vi.fn().mockRejectedValue(failure),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let started: boolean | undefined;
    await act(async () => {
      started = await runControls(result.current.integrations).run(developerJob);
    });

    expect(started).toBe(false);
    expect(runControls(result.current.integrations).running).toEqual([]);
    expect(runControls(result.current.integrations).failure).toEqual(failure);
    unmount();
  });

  // 계약 모양이 아닌 거절에도 사용자가 칠 명령이 있어야 한다. 명령 없는 실패 문구는 쓸모가 없다.
  it("계약 모양이 아닌 거절에서도 명령을 비우지 않는다", async () => {
    const gateway = gatewayFor({
      runHeartbeatJob: vi.fn().mockRejectedValue(new Error("연결이 끊겼습니다")),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(async () => {
      await runControls(result.current.integrations).run(developerJob);
    });

    const failure = runControls(result.current.integrations).failure;
    expect(failure?.jobName).toBe(developerJob);
    expect(failure?.message).toBe("연결이 끊겼습니다");
    expect(failure?.command).not.toBe("");
    unmount();
  });

  // 조회 주기가 실패 문구를 지우면 사용자가 읽기 전에 사라진다(R6).
  it("조회 주기가 여러 번 돌아도 실패가 지워지지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const gateway = gatewayFor({
        runHeartbeatJob: vi.fn().mockRejectedValue(new Error("실행하지 못했습니다")),
      });
      const recentStore = storeStub();
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );

      await act(() => result.current.openFolder());
      await act(async () => {
        await runControls(result.current.integrations).run(developerJob);
      });
      expect(runControls(result.current.integrations).failure?.message).toBe(
        "실행하지 못했습니다",
      );

      await act(() => vi.advanceTimersByTimeAsync(2_500));
      await act(() => vi.advanceTimersByTimeAsync(2_500));
      await act(() => vi.advanceTimersByTimeAsync(2_500));

      expect(runControls(result.current.integrations).failure?.message).toBe(
        "실행하지 못했습니다",
      );
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("같은 잡을 다시 실행하면 지난 실패가 지워진다", async () => {
    const runHeartbeatJob = vi
      .fn()
      .mockRejectedValueOnce(new Error("실행하지 못했습니다"))
      .mockResolvedValueOnce(undefined);
    const gateway = gatewayFor({ runHeartbeatJob });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(async () => {
      await runControls(result.current.integrations).run(developerJob);
    });
    expect(runControls(result.current.integrations).failure).not.toBeNull();

    await act(async () => {
      await runControls(result.current.integrations).run(developerJob);
    });
    expect(runControls(result.current.integrations).failure).toBeNull();
    unmount();
  });

  // 실행은 토큰을 쓰는 모델 세션을 띄운다. 사용자가 누르지 않은 자리에서 돌면 안 된다(R7).
  it("프로젝트를 열고 조회 주기가 돌아도 실행은 한 번도 불리지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const gateway = gatewayFor();
      const recentStore = storeStub();
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );

      await act(() => result.current.openFolder());
      await act(() => vi.advanceTimersByTimeAsync(2_500));
      await act(() => vi.advanceTimersByTimeAsync(2_500));
      await act(() => vi.advanceTimersByTimeAsync(2_500));

      expect(gateway.inspectIntegrations).toHaveBeenCalled();
      expect(gateway.runHeartbeatJob).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  // 실행은 어떤 파일도 쓰지 않는다(R1). 설치 커맨드를 타면 관리 블록이 바뀐다.
  it("실행 경로에서 설치 커맨드를 부르지 않는다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(async () => {
      await runControls(result.current.integrations).run(developerJob);
    });

    expect(gateway.installHeartbeatJobs).not.toHaveBeenCalled();
    unmount();
  });

  // 프로젝트를 바꾸는 것은 진행 중인 실행을 취소하지 않는다(R3).
  it("프로젝트를 닫아도 진행 중인 실행이 남는다", async () => {
    const { gatewayCall, settleAll } = pendingRun();
    const gateway = gatewayFor({ runHeartbeatJob: gatewayCall });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let running!: Promise<boolean>;
    await act(async () => {
      running = runControls(result.current.integrations).run(developerJob);
    });

    await act(async () => {
      result.current.closeProject();
    });

    expect(result.current.project).toBeNull();
    expect(result.current.integrations.snapshot).toBeNull();
    expect(runControls(result.current.integrations).running).toEqual([
      developerJob,
    ]);

    await act(async () => {
      settleAll();
      await running;
    });
    unmount();
  });

  // 잡 설정 저장은 조회 상태를 통째로 갈아 끼운다. 실행 상태가 같은 객체에 있으면 여기서 지워진다.
  it("잡 설정 저장이 성공해도 진행 중 표시가 사라지지 않는다", async () => {
    const { gatewayCall, settleAll } = pendingRun();
    const gateway = gatewayFor({ runHeartbeatJob: gatewayCall });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let running!: Promise<boolean>;
    await act(async () => {
      running = runControls(result.current.integrations).run(developerJob);
    });

    await act(() =>
      result.current.integrationActions.installHeartbeatJobs(
        [
          {
            role: "developer",
            enabled: true,
            interval: "20m",
            maxPer: null,
            model: null,
            timeout: null,
          },
        ],
        [],
      ),
    );

    expect(gateway.installHeartbeatJobs).toHaveBeenCalled();
    expect(runControls(result.current.integrations).running).toEqual([
      developerJob,
    ]);

    await act(async () => {
      settleAll();
      await running;
    });
    unmount();
  });
});

/** 훅은 언제나 업데이트 상태를 채워 내보낸다. 타입상 선택 필드라 여기서 한 번만 좁힌다. */
function updateControls(state: IntegrationsState): HeartbeatUpdateControls {
  const controls = state.heartbeatUpdate;
  if (!controls) throw new Error("훅이 heartbeatUpdate를 내보내지 않았다");
  return controls;
}

describe.skip("useProjectWorkspace 폐기된 하트비트 업데이트", () => {
  it("커맨드가 준 결과를 그대로 들고 있는다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() => updateControls(result.current.integrations).update());

    // 인자가 없다. 프로젝트 경로도 화면이 준 문자열도 이 경로에 실리지 않는다.
    expect(gateway.updateHeartbeat).toHaveBeenCalledWith();
    expect(updateControls(result.current.integrations).result).toEqual(updateResult);
    expect(updateControls(result.current.integrations).running).toBe(false);
    unmount();
  });

  // 겹쳐 실행을 막는 훅 단의 방어선이다. 버튼이 잠기지 않아도 두 번 나가지 않는다.
  it("도는 동안 다시 불러도 커맨드 호출이 늘지 않는다", async () => {
    let finish!: (value: HeartbeatUpdateResult) => void;
    const updateHeartbeat = vi.fn(
      () => new Promise<HeartbeatUpdateResult>((resolve) => { finish = resolve; }),
    );
    const gateway = gatewayFor({ updateHeartbeat });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let running!: Promise<void>;
    await act(async () => {
      running = updateControls(result.current.integrations).update();
    });

    expect(updateControls(result.current.integrations).running).toBe(true);
    await act(() => updateControls(result.current.integrations).update());
    expect(updateHeartbeat).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(updateResult);
      await running;
    });
    expect(updateControls(result.current.integrations).running).toBe(false);
    unmount();
  });

  /**
   * 커맨드 자체가 거절한 경우다. 조용히 아무 일도 없던 것처럼 끝나지 않고, 사용자가 손으로 끝낼 수
   * 있게 명령 원문이 실린다. 본 후보는 앱이 모르는 값이라 비운다.
   */
  it("커맨드가 거절하면 실행 실패로 옮기고 명령 원문을 채운다", async () => {
    const gateway = gatewayFor({
      updateHeartbeat: vi.fn().mockRejectedValue(new Error("하트비트 홈을 찾지 못했습니다")),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() => updateControls(result.current.integrations).update());

    expect(updateControls(result.current.integrations).result).toEqual({
      kind: "notRun",
      message: "하트비트 홈을 찾지 못했습니다",
      command: "heartbeat update",
      looked: [],
    });
    unmount();
  });

  // 새 실행의 진행 표시 옆에 옛 결과가 남으면 사용자가 그것을 이번 결과로 읽는다.
  it("다음 실행이 시작되면 지난 결과가 사라진다", async () => {
    let finish!: (value: HeartbeatUpdateResult) => void;
    const updateHeartbeat = vi
      .fn()
      .mockResolvedValueOnce(updateResult)
      .mockImplementationOnce(
        () => new Promise<HeartbeatUpdateResult>((resolve) => { finish = resolve; }),
      );
    const gateway = gatewayFor({ updateHeartbeat });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() => updateControls(result.current.integrations).update());
    expect(updateControls(result.current.integrations).result).toEqual(updateResult);

    let running!: Promise<void>;
    await act(async () => {
      running = updateControls(result.current.integrations).update();
    });

    expect(updateControls(result.current.integrations).result).toBeNull();
    await act(async () => {
      finish(updateResult);
      await running;
    });
    unmount();
  });

  /**
   * 방금 바뀐 것이 두 버전이다. 그 결과를 보려고 사용자가 카드를 접었다 펴게 하지 않는다
   * (TASK-117 "부를 때 — … 업데이트가 끝난 뒤 한 번").
   */
  it("갱신이 끝나면 버전을 다시 읽는다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    expect(gateway.checkHeartbeatVersions).not.toHaveBeenCalled();

    await act(() => updateControls(result.current.integrations).update());

    expect(gateway.checkHeartbeatVersions).toHaveBeenCalledTimes(1);
    expect(versionControls(result.current.integrations).versions).toEqual(versionsResult);
    unmount();
  });

  /** 이 경로는 어떤 파일도 쓰지 않는다. 스냅샷을 건드리지도 않는다 — 파일을 쓰는 것은 데몬이다. */
  it("잡 설정 조회·쓰기 상태를 건드리지 않는다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await waitFor(() =>
      expect(result.current.integrations.snapshot).not.toBeNull(),
    );

    await act(() => updateControls(result.current.integrations).update());

    expect(gateway.installHeartbeatJobs).not.toHaveBeenCalled();
    expect(gateway.runHeartbeatJob).not.toHaveBeenCalled();
    expect(result.current.integrations.snapshot).toEqual(snapshot);
    expect(result.current.integrations.writeError).toBeNull();
    unmount();
  });
});

/** 훅은 언제나 설치 단계 실행 상태를 채워 내보낸다. 타입상 선택 필드라 여기서 한 번만 좁힌다. */
function setupRunControls(state: IntegrationsState): HeartbeatSetupRunControls {
  const controls = state.heartbeatSetupRuns;
  if (!controls) throw new Error("훅이 heartbeatSetupRuns를 내보내지 않았다");
  return controls;
}

/** 버전 통로도 같은 이유로 같은 모양이다. */
function versionControls(state: IntegrationsState): HeartbeatVersionControls {
  const controls = state.heartbeatVersions;
  if (!controls) throw new Error("훅이 heartbeatVersions를 내보내지 않았다");
  return controls;
}

describe.skip("useProjectWorkspace 폐기된 설치 단계 실행", () => {
  it("단계 식별자만 넘기고 결과를 그 단계 자리에 담는다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() => setupRunControls(result.current.integrations).run("init", "heartbeat init"));

    // 프로젝트 경로도 명령 문자열도 이 경로에 실리지 않는다. 명령 원문은 백엔드 상수에서만 나온다.
    expect(gateway.runHeartbeatSetupStep).toHaveBeenCalledWith("init");
    const controls = setupRunControls(result.current.integrations);
    expect(controls.results.init).toEqual(setupRunResult);
    expect(controls.results.service).toBeUndefined();
    expect(controls.running).toEqual([]);
    unmount();
  });

  // 설치 판정의 원천은 조회 하나다. 커맨드는 스냅샷을 돌려주지 않으므로 화면이 조회를 다시 얻는다.
  it("실행이 끝나면 연동 조회를 다시 부른다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    const before = vi.mocked(gateway.inspectIntegrations).mock.calls.length;

    await act(() => setupRunControls(result.current.integrations).run("init", "heartbeat init"));

    expect(vi.mocked(gateway.inspectIntegrations).mock.calls.length).toBe(before + 1);
    unmount();
  });

  // 훅 단의 마지막 방어선이다. 버튼이 잠기지 않아도 같은 단계가 겹쳐 돌지 않는다.
  it("도는 단계를 다시 불러도 커맨드 호출이 늘지 않는다", async () => {
    let finish!: (value: HeartbeatSetupRunResult) => void;
    const runHeartbeatSetupStep = vi.fn(
      () => new Promise<HeartbeatSetupRunResult>((resolve) => { finish = resolve; }),
    );
    const gateway = gatewayFor({ runHeartbeatSetupStep });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let running!: Promise<void>;
    await act(async () => {
      running = setupRunControls(result.current.integrations).run("init", "heartbeat init");
    });

    expect(setupRunControls(result.current.integrations).running).toEqual(["init"]);
    await act(() => setupRunControls(result.current.integrations).run("init", "heartbeat init"));
    expect(runHeartbeatSetupStep).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(setupRunResult);
      await running;
    });
    expect(setupRunControls(result.current.integrations).running).toEqual([]);
    unmount();
  });

  // 단계마다 따로 담기므로 한 단계의 실행이 다른 단계를 막지 않는다.
  it("한 단계가 도는 동안 다른 단계를 띄울 수 있다", async () => {
    const finishers: ((value: HeartbeatSetupRunResult) => void)[] = [];
    const runHeartbeatSetupStep = vi.fn(
      () =>
        new Promise<HeartbeatSetupRunResult>((resolve) => {
          finishers.push(resolve);
        }),
    );
    const gateway = gatewayFor({ runHeartbeatSetupStep });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = setupRunControls(result.current.integrations).run("init", "heartbeat init");
    });
    await act(async () => {
      second = setupRunControls(result.current.integrations).run(
        "service",
        "heartbeat install-service",
      );
    });

    expect(setupRunControls(result.current.integrations).running).toEqual(["init", "service"]);
    expect(runHeartbeatSetupStep).toHaveBeenCalledTimes(2);

    await act(async () => {
      finishers.splice(0).forEach((finish) => finish(setupRunResult));
      await Promise.all([first, second]);
    });
    expect(setupRunControls(result.current.integrations).running).toEqual([]);
    unmount();
  });

  /**
   * 커맨드 자체가 거절한 경우다. 조용히 아무 일도 없던 것처럼 끝나지 않고, 사용자가 손으로 끝낼 수
   * 있게 명령 원문이 실린다. 그 문자열은 화면이 payload에서 받아 넘긴 값이고 훅이 짓지 않는다.
   */
  it("커맨드가 거절하면 실행 실패로 옮기고 넘겨받은 명령 원문을 채운다", async () => {
    const gateway = gatewayFor({
      runHeartbeatSetupStep: vi.fn().mockRejectedValue(new Error("홈 디렉터리를 찾지 못했습니다")),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() =>
      setupRunControls(result.current.integrations).run("service", "heartbeat install-service"),
    );

    expect(setupRunControls(result.current.integrations).results.service).toEqual({
      kind: "notRun",
      message: "홈 디렉터리를 찾지 못했습니다",
      command: "heartbeat install-service",
      looked: [],
    });
    unmount();
  });

  // 설치는 사용자가 누른 자리에서만 돈다. 조회 주기가 데몬을 대신 설치하면 안 된다.
  it("프로젝트를 열고 조회 주기가 돌아도 단계 실행은 한 번도 불리지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const gateway = gatewayFor();
      const recentStore = storeStub();
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );

      await act(() => result.current.openFolder());
      await act(() => vi.advanceTimersByTimeAsync(2_500));
      await act(() => vi.advanceTimersByTimeAsync(2_500));

      expect(gateway.inspectIntegrations).toHaveBeenCalled();
      expect(gateway.runHeartbeatSetupStep).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.skip("useProjectWorkspace 폐기된 하트비트 버전", () => {
  it("커맨드가 준 판정을 그대로 들고 있는다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() => versionControls(result.current.integrations).check());

    // 인자가 없다. 프로젝트 경로도 화면이 준 문자열도 이 경로에 실리지 않는다.
    expect(gateway.checkHeartbeatVersions).toHaveBeenCalledWith();
    expect(versionControls(result.current.integrations).versions).toEqual(versionsResult);
    expect(versionControls(result.current.integrations).checking).toBe(false);
    expect(versionControls(result.current.integrations).error).toBeNull();
    unmount();
  });

  /**
   * 완료 조건 10. 이 판정은 프로세스를 하나 띄우는 조작이라 2.5초 주기에 실리면 안 된다. 주기를
   * 여러 번 돌려도 호출 수가 늘지 않는 것이 그 확인이다.
   */
  it("조회 주기가 몇 번을 돌아도 버전 커맨드를 부르지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const gateway = gatewayFor();
      const recentStore = storeStub();
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );

      await act(() => result.current.openFolder());
      await act(() => versionControls(result.current.integrations).check());
      expect(gateway.checkHeartbeatVersions).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(2_500));
      await act(() => vi.advanceTimersByTimeAsync(2_500));
      await act(() => vi.advanceTimersByTimeAsync(2_500));

      expect(gateway.inspectIntegrations).toHaveBeenCalled();
      expect(gateway.checkHeartbeatVersions).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  // 겹쳐 부르기를 막는 훅 단의 방어선. 카드가 두 번 렌더돼도 프로세스는 하나다.
  it("도는 동안 다시 불러도 커맨드 호출이 늘지 않는다", async () => {
    let finish!: (value: HeartbeatVersions) => void;
    const checkHeartbeatVersions = vi.fn(
      () => new Promise<HeartbeatVersions>((resolve) => { finish = resolve; }),
    );
    const gateway = gatewayFor({ checkHeartbeatVersions });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let running!: Promise<void>;
    await act(async () => {
      running = versionControls(result.current.integrations).check();
    });

    expect(versionControls(result.current.integrations).checking).toBe(true);
    await act(() => versionControls(result.current.integrations).check());
    expect(checkHeartbeatVersions).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(versionsResult);
      await running;
    });
    expect(versionControls(result.current.integrations).checking).toBe(false);
    unmount();
  });

  // 커맨드가 답하지 못한 자리에 옛 값이 남으면 사용자가 그것을 지금의 판정으로 읽는다.
  it("커맨드가 거절하면 사유만 남기고 지난 판정을 지운다", async () => {
    const checkHeartbeatVersions = vi
      .fn()
      .mockResolvedValueOnce(versionsResult)
      .mockRejectedValueOnce(new Error("홈 디렉터리를 찾지 못했습니다"));
    const gateway = gatewayFor({ checkHeartbeatVersions });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() => versionControls(result.current.integrations).check());
    expect(versionControls(result.current.integrations).versions).toEqual(versionsResult);

    await act(() => versionControls(result.current.integrations).check());

    expect(versionControls(result.current.integrations).versions).toBeNull();
    expect(versionControls(result.current.integrations).error).toBe(
      "홈 디렉터리를 찾지 못했습니다",
    );
    unmount();
  });

  // 이 판정은 어떤 파일도 쓰지 않고 조회 상태도 건드리지 않는다.
  it("잡 설정 조회·쓰기 상태를 건드리지 않는다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await waitFor(() => expect(result.current.integrations.snapshot).not.toBeNull());

    await act(() => versionControls(result.current.integrations).check());

    expect(gateway.installHeartbeatJobs).not.toHaveBeenCalled();
    expect(gateway.runHeartbeatSetupStep).not.toHaveBeenCalled();
    expect(result.current.integrations.snapshot).toEqual(snapshot);
    expect(result.current.integrations.writeError).toBeNull();
    unmount();
  });
});

/** 훅은 언제나 데몬 조작 상태를 채워 내보낸다. 타입상 선택 필드라 여기서 한 번만 좁힌다. */
function serviceControls(state: IntegrationsState): HeartbeatServiceControls {
  const controls = state.heartbeatService;
  if (!controls) throw new Error("훅이 heartbeatService를 내보내지 않았다");
  return controls;
}

describe.skip("useProjectWorkspace 폐기된 데몬 끄기·켜기", () => {
  it("조작 식별자 하나만 넘기고 결과를 그대로 들고 있는다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() => serviceControls(result.current.integrations).control("stop"));

    // 프로젝트 경로도 명령 조각도 이 경로에 실리지 않는다. 넘기는 것은 식별자 하나다.
    expect(gateway.controlHeartbeatService).toHaveBeenCalledWith("stop");
    expect(serviceControls(result.current.integrations).outcome).toEqual({
      operation: "stop",
      result: serviceRunResult,
    });
    expect(serviceControls(result.current.integrations).running).toBeNull();
    expect(serviceControls(result.current.integrations).error).toBeNull();
    unmount();
  });

  it("켜기도 같은 통로로 나가고 어느 조작의 결과인지가 함께 남는다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() => serviceControls(result.current.integrations).control("start"));

    expect(gateway.controlHeartbeatService).toHaveBeenCalledWith("start");
    expect(serviceControls(result.current.integrations).outcome?.operation).toBe("start");
    unmount();
  });

  // 겹쳐 실행을 막는 훅 단의 방어선이다. 버튼이 잠기지 않아도 두 번 나가지 않는다.
  it("도는 동안 다시 불러도 커맨드 호출이 늘지 않는다", async () => {
    let finish!: (value: HeartbeatServiceControlResult) => void;
    const controlHeartbeatService = vi.fn(
      () => new Promise<HeartbeatServiceControlResult>((resolve) => { finish = resolve; }),
    );
    const gateway = gatewayFor({ controlHeartbeatService });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let running!: Promise<void>;
    await act(async () => {
      running = serviceControls(result.current.integrations).control("stop");
    });

    expect(serviceControls(result.current.integrations).running).toBe("stop");
    await act(() => serviceControls(result.current.integrations).control("stop"));
    await act(() => serviceControls(result.current.integrations).control("start"));
    expect(controlHeartbeatService).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(serviceRunResult);
      await running;
    });
    expect(serviceControls(result.current.integrations).running).toBeNull();
    unmount();
  });

  /**
   * 커맨드 자체가 거절한 것은 결과가 아니다. 명령 원문은 대상이 확정된 뒤에만 만들어지고 그 값을
   * 아는 쪽은 백엔드라, 훅이 라벨을 지어내 명령을 적지 않는다.
   */
  it("커맨드가 거절하면 사유만 남기고 결과 자리를 비운다", async () => {
    const controlHeartbeatService = vi
      .fn()
      .mockResolvedValueOnce(serviceRunResult)
      .mockRejectedValueOnce(new Error("홈 디렉터리를 찾지 못했습니다"));
    const gateway = gatewayFor({ controlHeartbeatService });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() => serviceControls(result.current.integrations).control("stop"));
    expect(serviceControls(result.current.integrations).outcome).not.toBeNull();

    await act(() => serviceControls(result.current.integrations).control("stop"));

    expect(serviceControls(result.current.integrations).outcome).toBeNull();
    expect(serviceControls(result.current.integrations).error).toBe(
      "홈 디렉터리를 찾지 못했습니다",
    );
    unmount();
  });

  /**
   * 완료 조건 12. 자동 복구는 사용자가 의도해서 꺼 둔 상태를 앱이 무르는 것이고, 커밋 컷 도중에
   * 데몬이 되살아나면 이 기능이 없애려던 페인이 그대로 재현된다. 조회 주기가 몇 번을 돌아도 조작
   * 커맨드가 한 번도 나가지 않는 것이 그 확인이다.
   */
  it("데몬이 꺼진 스냅샷으로 주기가 여러 번 돌아도 조작 커맨드가 나가지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const gateway = gatewayFor({
        inspectIntegrations: vi.fn().mockResolvedValue(stoppedSnapshot),
      });
      const recentStore = storeStub();
      const { result, unmount } = renderHook(() =>
        useProjectWorkspace({ gateway, recentStore }),
      );

      await act(() => result.current.openFolder());
      await act(() => vi.advanceTimersByTimeAsync(2_500));
      await act(() => vi.advanceTimersByTimeAsync(2_500));
      await act(() => vi.advanceTimersByTimeAsync(2_500));

      expect(gateway.inspectIntegrations).toHaveBeenCalled();
      expect(result.current.integrations.snapshot?.heartbeat.daemonRunning).toBe(false);
      expect(gateway.controlHeartbeatService).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  // 이 조작은 어떤 파일도 쓰지 않고 조회·쓰기 상태도 건드리지 않는다.
  it("잡 설정 조회·쓰기 상태를 건드리지 않는다", async () => {
    const gateway = gatewayFor();
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await waitFor(() => expect(result.current.integrations.snapshot).not.toBeNull());

    await act(() => serviceControls(result.current.integrations).control("stop"));

    expect(gateway.installHeartbeatJobs).not.toHaveBeenCalled();
    expect(gateway.runHeartbeatSetupStep).not.toHaveBeenCalled();
    expect(gateway.updateHeartbeat).not.toHaveBeenCalled();
    expect(result.current.integrations.snapshot).toEqual(snapshot);
    expect(result.current.integrations.writeError).toBeNull();
    unmount();
  });
});

describe("막힌 작업 재개", () => {
  it("화면이 읽은 값을 그대로 보내고 돌아온 요약으로 프로젝트를 갈아 끼운다", async () => {
    const resumedProject = { ...project, name: "재개 후" };
    const gateway = gatewayFor({
      resumeTask: vi
        .fn()
        .mockResolvedValue({ status: "resumed", summary: resumedProject, recovery: null }),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let outcome: TaskResumeOutcome | undefined;
    await act(async () => {
      outcome = await result.current.resumeTask(
        "feature--wf_1",
        "TASK-900.md",
        "2026-08-08T01:00:00Z",
        "보완 작업이 끝났다.",
        "req-1",
      );
    });

    expect(gateway.resumeTask).toHaveBeenCalledTimes(1);
    expect(gateway.resumeTask).toHaveBeenCalledWith(project.rootPath, {
      workflowDirectory: "feature--wf_1",
      fileName: "TASK-900.md",
      expectedUpdatedAt: "2026-08-08T01:00:00Z",
      resolution: "보완 작업이 끝났다.",
      requestId: "req-1",
    });
    expect(outcome).toEqual({
      ok: true,
      result: { status: "resumed", summary: resumedProject, recovery: null },
    });
    expect(result.current.project?.name).toBe("재개 후");
    expect(result.current.error).toBeNull();
    unmount();
  });

  // 거절 사유는 재개 영역이 그 자리에서 읽어야 한다. 다음 호출이 덮는 전역 문구만으로는 부족하다.
  it("거절 사유를 돌려주는 값에도 담는다", async () => {
    const gateway = gatewayFor({
      resumeTask: vi.fn().mockRejectedValue("작업 문서가 그사이 변경되었습니다."),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    let outcome: TaskResumeOutcome | undefined;
    await act(async () => {
      outcome = await result.current.resumeTask(
        "feature--wf_1",
        "TASK-900.md",
        "2026-08-08T01:00:00Z",
        "보완 작업이 끝났다.",
        "req-1",
      );
    });

    expect(outcome).toEqual({ ok: false, message: "작업 문서가 그사이 변경되었습니다." });
    expect(result.current.error).toBe("작업 문서가 그사이 변경되었습니다.");
    unmount();
  });
});

describe("작업 정의 수정 요청", () => {
  it("화면이 확인한 네 값을 그대로 보내고 저장 결과의 요약을 반영한다", async () => {
    const revisedProject = { ...project, name: "요청 기록 후" };
    const gateway = gatewayFor({
      recordTaskRevisionRequest: vi.fn().mockResolvedValue({
        status: "recorded",
        summary: revisedProject,
        request: null,
      }),
    });
    const recentStore = storeStub();
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );
    await act(() => result.current.openFolder());

    let outcome;
    await act(async () => {
      outcome = await result.current.recordTaskRevisionRequest(
        "feature--wf_1",
        "TASK-900.md",
        "2026-08-08T01:00:00Z",
        "범위를 고쳐야 한다.",
        "request-1",
      );
    });

    expect(gateway.recordTaskRevisionRequest).toHaveBeenCalledTimes(1);
    expect(gateway.recordTaskRevisionRequest).toHaveBeenCalledWith(project.rootPath, {
      workflowDirectory: "feature--wf_1",
      fileName: "TASK-900.md",
      expectedUpdatedAt: "2026-08-08T01:00:00Z",
      reason: "범위를 고쳐야 한다.",
      requestId: "request-1",
    });
    expect(outcome).toEqual({
      ok: true,
      result: { status: "recorded", summary: revisedProject, request: null },
    });
    expect(result.current.project?.name).toBe("요청 기록 후");
    unmount();
  });
});

// 앱 업데이트가 런타임 교체로 이어지지 않아 수정이 배달만 되고 장착되지 않았다
// (2026-08-13 실사용 진단 번들: 번들 0.9.4, 설치 0.9.2). 프로젝트를 열면 앱이 스스로 갱신한다.
describe("런타임 자동 업데이트", () => {
  it("번들이 설치본보다 새 버전이면 프로젝트를 열 때 업데이트를 적용한다", async () => {
    const gateway = gatewayFor({
      inspectAgentRuntime: vi.fn().mockResolvedValue({ ...agentInspection, bundledVersion: "0.9.4" }),
    });
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore: storeStub() }),
    );

    await act(() => result.current.openFolder());
    await waitFor(() => expect(gateway.applyAgentRuntimeUpdate).toHaveBeenCalledWith("plan-update-1", true));
    unmount();
  });

  it("실행 중인 세션이 있으면 자동 업데이트를 미룬다", async () => {
    const gateway = gatewayFor({
      inspectAgentRuntime: vi.fn().mockResolvedValue({ ...agentInspection, bundledVersion: "0.9.4" }),
      planAgentRuntimeUpdate: vi.fn().mockResolvedValue({ ...agentUpdatePlan, activeRuns: 2 }),
    });
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore: storeStub() }),
    );

    await act(() => result.current.openFolder());
    await waitFor(() => expect(gateway.planAgentRuntimeUpdate).toHaveBeenCalled());
    expect(gateway.applyAgentRuntimeUpdate).not.toHaveBeenCalled();
    unmount();
  });

  it("버전 비교는 숫자 조각만 믿는다", () => {
    expect(bundledRuntimeIsNewer("0.9.4", "0.9.2")).toBe(true);
    expect(bundledRuntimeIsNewer("0.10.0", "0.9.4")).toBe(true);
    expect(bundledRuntimeIsNewer("0.9.2", "0.9.2")).toBe(false);
    expect(bundledRuntimeIsNewer("0.9.2", "0.9.4")).toBe(false);
    expect(bundledRuntimeIsNewer("dev", "0.9.2")).toBe(false);
  });
});
