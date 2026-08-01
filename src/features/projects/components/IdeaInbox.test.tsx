import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowSummary } from "../domain/types";
import { IdeaInbox } from "./IdeaInbox";

const workflow: WorkflowSummary = {
  id: "wf_1",
  directory: "feature--wf_1",
  name: "Feature",
  status: "active",
  createdAt: "2026-07-30T00:00:00Z",
  counts: { ideas: 1, specs: 0, decisions: 0, tasks: 0, reports: 0 },
  items: {
    ideas: [{ fileName: "IDEA-001.md", id: "IDEA-001", title: "빠른 기록", status: "inbox", updatedAt: "2026-07-30T00:00:00Z", excerpt: "떠오른 생각을 바로 기록한다." }],
    specs: [],
    tasks: [],
  },
};

describe("IdeaInbox", () => {
  it("shows the selected idea and submits a new one", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<IdeaInbox busy={false} disabled={false} onAdd={onAdd} workflow={workflow} />);

    expect(screen.getAllByText("떠오른 생각을 바로 기록한다.")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("새로운 생각을 인박스에 담기"), {
      target: { value: "  새로운 아이디어  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "아이디어 추가" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("새로운 아이디어"));
    expect(screen.getByLabelText("새로운 생각을 인박스에 담기")).toHaveValue("");
  });

  it("marks ideas already adopted into a specification", () => {
    const adopted: WorkflowSummary = {
      ...workflow,
      items: {
        ...workflow.items,
        ideas: [
          ...workflow.items.ideas,
          { fileName: "IDEA-002.md", id: "IDEA-002", title: "채택된 생각", status: "adopted", updatedAt: "2026-07-31T00:00:00Z", excerpt: "기획서로 넘어갔다." },
        ],
      },
    };
    render(<IdeaInbox busy={false} disabled={false} onAdd={vi.fn()} workflow={adopted} />);

    expect(screen.getByText("기획 반영")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /채택된 생각/ }));
    expect(screen.getByText("기획서 채택")).toBeInTheDocument();
  });
});
