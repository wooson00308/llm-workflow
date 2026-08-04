import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProjectWorkspace } from "./useProjectWorkspace";
import type {
  HeartbeatRunControls,
  IntegrationsSnapshot,
  IntegrationsState,
  ProjectGateway,
  ProjectSummary,
  RecentProjectStore,
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
  heartbeat: {
    installation: "installed",
    daemonRunning: true,
    setupStages: [],
    conditionScriptPath: ".workflow/rules/wf-eligible.sh",
    roles: [],
    managedJobs: [],
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
    migrate: vi.fn().mockResolvedValue(project),
    inspectIntegrations: vi.fn().mockResolvedValue(snapshot),
    installHeartbeatJobs: vi.fn().mockResolvedValue(snapshot),
    installDreamJob: vi.fn().mockResolvedValue(snapshot),
    runHeartbeatJob: vi.fn().mockResolvedValue(undefined),
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
