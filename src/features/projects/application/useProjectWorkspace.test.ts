import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProjectWorkspace } from "./useProjectWorkspace";
import type {
  IntegrationsSnapshot,
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
  heartbeat: {
    installation: "installed",
    daemonRunning: true,
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
    defaults: { interval: "2h", maxPer: "6/24h", model: "opus" },
    managedJob: null,
    lastRun: null,
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
          [{ role: "developer", enabled: true, interval: "20m", maxPer: "6/24h", model: "opus" }],
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
          maxPer: "6/24h",
          model: "opus",
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
        maxPer: "6/24h",
        model: "opus",
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
        appOwnedDrift: [],
      },
    ];

    await act(() => result.current.openFolder());
    await act(() =>
      result.current.integrationActions.installHeartbeatJobs(
        [{ role: "developer", enabled: true, interval: "45m", maxPer: null, model: null }],
        baseline,
      ),
    );

    expect(gateway.installHeartbeatJobs).toHaveBeenCalledWith(
      project.rootPath,
      [{ role: "developer", enabled: true, interval: "45m", maxPer: null, model: null }],
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
