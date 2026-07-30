import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectPicker } from "./ProjectPicker";

describe("ProjectPicker", () => {
  it("opens a folder from the primary action", () => {
    const onOpenFolder = vi.fn();
    render(
      <ProjectPicker
        busy={false}
        error={null}
        recentProjects={[]}
        onOpenFolder={onOpenFolder}
        onOpenRecent={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "프로젝트 폴더 열기" }));
    expect(onOpenFolder).toHaveBeenCalledOnce();
  });

  it("shows and opens recent projects", () => {
    const onOpenRecent = vi.fn();
    render(
      <ProjectPicker
        busy={false}
        error={null}
        recentProjects={[
          {
            name: "workflow-labs",
            path: "/projects/workflow-labs",
            lastOpenedAt: "2026-07-30T00:00:00Z",
          },
        ]}
        onOpenFolder={vi.fn()}
        onOpenRecent={onOpenRecent}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /workflow-labs/ }));
    expect(onOpenRecent).toHaveBeenCalledWith("/projects/workflow-labs");
  });
});
