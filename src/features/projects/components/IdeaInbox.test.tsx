import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdeaDocument, WorkflowItemSummary, WorkflowSummary } from "../domain/types";
import { IdeaInbox } from "./IdeaInbox";

const firstIdea: WorkflowItemSummary = { fileName: "IDEA-001.md", id: "IDEA-001", title: "빠른 기록", status: "inbox", updatedAt: "2026-07-30T00:00:00Z", excerpt: "떠오른 생각을 바로 기록한다." };
const secondIdea: WorkflowItemSummary = { fileName: "IDEA-002.md", id: "IDEA-002", title: "채택된 생각", status: "adopted", updatedAt: "2026-07-31T00:00:00Z", excerpt: "기획서로 넘어갔다." };

const workflow: WorkflowSummary = {
  id: "wf_1",
  directory: "feature--wf_1",
  name: "Feature",
  status: "active",
  createdAt: "2026-07-30T00:00:00Z",
  counts: { ideas: 1, specs: 0, decisions: 0, tasks: 0, reports: 0 },
  items: {
    ideas: [firstIdea],
    specs: [],
    tasks: [],
  },
};

afterEach(cleanup);

function withIdeas(...ideas: WorkflowItemSummary[]): WorkflowSummary {
  return { ...workflow, items: { ...workflow.items, ideas } };
}

function documentFor(item: WorkflowItemSummary, body: string): IdeaDocument {
  return { summary: item, body };
}

function readerFor(bodies: Record<string, string>) {
  return vi.fn(async (fileName: string) => {
    const body = bodies[fileName];
    return body === undefined ? null : { summary: firstIdea, body };
  });
}

describe("IdeaInbox", () => {
  it("shows the selected idea and submits a new one", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={onAdd}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, "본문"))}
        workflow={workflow}
      />,
    );

    expect(screen.getAllByText("떠오른 생각을 바로 기록한다.")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("새로운 생각을 인박스에 담기"), {
      target: { value: "  새로운 아이디어  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "아이디어 추가" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("새로운 아이디어"));
    expect(screen.getByLabelText("새로운 생각을 인박스에 담기")).toHaveValue("");
  });

  it("marks ideas already adopted into a specification", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, "본문"))}
        workflow={withIdeas(firstIdea, secondIdea)}
      />,
    );

    expect(screen.getByText("기획 반영")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /채택된 생각/ }));
    expect(screen.getByText("기획서 채택")).toBeInTheDocument();
  });

  it("renders the whole document instead of the excerpt", async () => {
    const body = [
      "첫째 줄은 배경이다.",
      "둘째 줄은 원인이다.",
      "셋째 줄은 방향이다.",
      "넷째 줄은 제외 사항이다.",
    ].join("\n\n");
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, body))}
        workflow={workflow}
      />,
    );

    expect(await screen.findByText("넷째 줄은 제외 사항이다.")).toBeInTheDocument();
    expect(screen.getByText("셋째 줄은 방향이다.")).toBeInTheDocument();
  });

  it("reads the auto-selected idea without a click", async () => {
    const onReadIdea = vi.fn().mockResolvedValue(documentFor(firstIdea, "자동 선택 본문"));
    render(
      <IdeaInbox busy={false} disabled={false} onAdd={vi.fn()} onReadIdea={onReadIdea} workflow={workflow} />,
    );

    await waitFor(() => expect(onReadIdea).toHaveBeenCalledWith("IDEA-001.md"));
    expect(await screen.findByText("자동 선택 본문")).toBeInTheDocument();
  });

  it("replaces the body when another idea is selected", async () => {
    const onReadIdea = readerFor({
      "IDEA-001.md": "첫 문서의 본문 알파",
      "IDEA-002.md": "둘째 문서의 본문 베타",
    });
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={onReadIdea}
        workflow={withIdeas(firstIdea, secondIdea)}
      />,
    );

    expect(await screen.findByText("첫 문서의 본문 알파")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /채택된 생각/ }));
    expect(await screen.findByText("둘째 문서의 본문 베타")).toBeInTheDocument();
    expect(screen.queryByText("첫 문서의 본문 알파")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /빠른 기록/ }));
    expect(await screen.findByText("첫 문서의 본문 알파")).toBeInTheDocument();
    expect(screen.queryByText("둘째 문서의 본문 베타")).not.toBeInTheDocument();
  });

  it("keeps the placeholder panel when no idea exists", async () => {
    const onReadIdea = vi.fn().mockResolvedValue(null);
    render(
      <IdeaInbox busy={false} disabled={false} onAdd={vi.fn()} onReadIdea={onReadIdea} workflow={withIdeas()} />,
    );

    expect(screen.getByText("아이디어를 선택하세요")).toBeInTheDocument();
    expect(onReadIdea).not.toHaveBeenCalled();
  });

  it("does not show frontmatter", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, "본문만 남은 문서"))}
        workflow={workflow}
      />,
    );

    expect(await screen.findByText("본문만 남은 문서")).toBeInTheDocument();
    expect(screen.queryByText(/schema:/)).not.toBeInTheDocument();
  });

  it("renders markdown formatting like the other document views", async () => {
    const body = [
      "- 첫 항목",
      "- 둘째 항목",
      "",
      "**강조된 문장**",
      "",
      "[문서 링크](https://example.com/doc)",
    ].join("\n");
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, body))}
        workflow={workflow}
      />,
    );

    const link = await screen.findByRole("link", { name: "문서 링크" });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(link).toHaveAttribute("href", "https://example.com/doc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("keeps the list row excerpt", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, "목록과 다른 본문"))}
        workflow={workflow}
      />,
    );

    await screen.findByText("목록과 다른 본문");
    const excerpt = screen.getByText("떠오른 생각을 바로 기록한다.");
    expect(excerpt.closest("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the document information while loading and after a failure", async () => {
    const { rerender } = render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn(() => new Promise<IdeaDocument | null>(() => {}))}
        workflow={workflow}
      />,
    );

    expectDocumentInformation();

    rerender(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        workflow={workflow}
      />,
    );
    expectDocumentInformation();
  });

  it("tells the user while the document is loading", () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn(() => new Promise<IdeaDocument | null>(() => {}))}
        workflow={workflow}
      />,
    );

    expect(screen.getByText("아이디어를 불러오는 중…")).toBeInTheDocument();
  });

  it("tells the user when the document could not be read", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        workflow={workflow}
      />,
    );

    expect(await screen.findByText("아이디어 전문을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.getAllByText("떠오른 생각을 바로 기록한다.")).toHaveLength(1);
  });

  it("keeps working after a failed read", async () => {
    const onReadIdea = readerFor({ "IDEA-002.md": "둘째 문서의 본문 베타" });
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={onReadIdea}
        workflow={withIdeas(firstIdea, secondIdea)}
      />,
    );

    expect(await screen.findByText("아이디어 전문을 불러오지 못했습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /채택된 생각/ }));
    await waitFor(() => expect(onReadIdea).toHaveBeenCalledWith("IDEA-002.md"));
    expect(await screen.findByText("둘째 문서의 본문 베타")).toBeInTheDocument();
  });
});

function expectDocumentInformation() {
  const preview = within(screen.getByRole("article"));
  expect(preview.getByRole("heading", { name: "빠른 기록" })).toBeInTheDocument();
  expect(preview.getByText("수집됨")).toBeInTheDocument();
  expect(preview.getByText("IDEA-001")).toBeInTheDocument();
  expect(preview.getByText("업데이트")).toBeInTheDocument();
  expect(preview.getByText(/^\d+월 \d+일$/)).toBeInTheDocument();
  expect(preview.getByText("IDEA-001.md")).toBeInTheDocument();
}
