import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSetup } from "./ProjectSetup";
import type { ProjectSummary } from "../domain/types";

const project: ProjectSummary = {
  rootPath: "/projects/workflow-labs",
  initialized: false,
  projectId: null,
  name: "workflow-labs",
  compatibility: "not_initialized",
  activeLeases: [],
  workflows: [],
};

describe("ProjectSetup", () => {
  it("requires a name and passes a trimmed value", async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    render(
      <ProjectSetup
        busy={false}
        error={null}
        project={project}
        onBack={vi.fn()}
        onCreate={onCreate}
      />,
    );

    const submit = screen.getByRole("button", { name: /워크플로우 만들기/ });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("워크플로우 이름"), {
      target: { value: "  온보딩 개편  " },
    });
    fireEvent.click(submit);

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("온보딩 개편"));
  });
});
