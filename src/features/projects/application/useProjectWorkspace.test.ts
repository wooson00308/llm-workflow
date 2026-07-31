import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProjectWorkspace } from "./useProjectWorkspace";
import type {
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

describe("useProjectWorkspace", () => {
  it("uses the gateway and remembers an opened project", async () => {
    const gateway: ProjectGateway = {
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
      decideSpec: vi.fn().mockResolvedValue(project),
      recordTaskQa: vi.fn().mockResolvedValue(project),
      migrate: vi.fn().mockResolvedValue(project),
    };
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
});
