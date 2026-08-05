import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProjectWorkspace } from "./useProjectWorkspace";
import type {
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
  ProjectGateway,
  ProjectSummary,
  RecentProjectStore,
  TaskQaBatchEntry,
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

function gatewayFor(overrides: Partial<ProjectGateway> = {}): ProjectGateway {
  return {
    chooseDirectory: vi.fn().mockResolvedValue(project.rootPath),
    inspect: vi.fn().mockResolvedValue(project),
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
    migrate: vi.fn().mockResolvedValue(project),
    inspectIntegrations: vi.fn().mockResolvedValue(snapshot),
    installHeartbeatJobs: vi.fn().mockResolvedValue(snapshot),
    installDreamJob: vi.fn().mockResolvedValue(snapshot),
    runHeartbeatJob: vi.fn().mockResolvedValue(undefined),
    updateHeartbeat: vi.fn().mockResolvedValue(updateResult),
    runHeartbeatSetupStep: vi.fn().mockResolvedValue(setupRunResult),
    checkHeartbeatVersions: vi.fn().mockResolvedValue(versionsResult),
    controlHeartbeatService: vi.fn().mockResolvedValue(serviceRunResult),
    ...overrides,
  };
}

describe("useProjectWorkspace", () => {
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
  it("keeps a failed integrations read out of the workspace error", async () => {
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
  it("keeps a failed write visible while the 2.5s read keeps running", async () => {
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

  // 실패 사유에 요청한 연동이 함께 담겨야 그 연동 카드에서만 문구가 보인다.
  it("tags a failed write with the integration that asked for it", async () => {
    const gateway = gatewayFor({
      installDreamJob: vi.fn().mockRejectedValue(new Error("dream 잡을 쓰지 못했습니다")),
    });
    const recentStore: RecentProjectStore = {
      load: vi.fn().mockReturnValue([]),
      remember: vi.fn().mockReturnValue([]),
    };
    const { result, unmount } = renderHook(() =>
      useProjectWorkspace({ gateway, recentStore }),
    );

    await act(() => result.current.openFolder());
    await act(() =>
      result.current.integrationActions.installDreamJob(
        {
          enabled: true,
          interval: "2h",
          maxPer: { kind: "limit", value: "6/24h" },
          model: "opus",
          timeout: "30m",
        },
        null,
      ),
    );

    expect(result.current.integrations.writeError).toEqual({
      integration: "dream",
      message: "dream 잡을 쓰지 못했습니다",
    });
    expect(gateway.installDreamJob).toHaveBeenCalledWith(
      project.rootPath,
      {
        enabled: true,
        interval: "2h",
        maxPer: { kind: "limit", value: "6/24h" },
        model: "opus",
        timeout: "30m",
      },
      null,
    );
    unmount();
  });

  // R3. 훅은 기준값을 들여다보지 않고 게이트웨이에 그대로 넘긴다. 대조는 쓰기 직전의 파일을 아는
  // 백엔드가 한다.
  it("passes the baseline the card read straight through to the gateway", async () => {
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

describe("useProjectWorkspace 잡 실행", () => {
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
    expect(gateway.installDreamJob).not.toHaveBeenCalled();
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

describe("useProjectWorkspace 하트비트 업데이트", () => {
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

describe("useProjectWorkspace 설치 단계 실행", () => {
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

describe("useProjectWorkspace 하트비트 버전", () => {
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

describe("useProjectWorkspace 데몬 끄기·켜기", () => {
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
