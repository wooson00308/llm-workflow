import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdeaDocument, WorkflowItemSummary, WorkflowSummary } from "../domain/types";
import { IdeaInbox } from "./IdeaInbox";

const firstIdea: WorkflowItemSummary = { fileName: "IDEA-001.md", id: "IDEA-001", title: "빠른 기록", status: "inbox", updatedAt: "2026-07-30T00:00:00Z", excerpt: "떠오른 생각을 바로 기록한다." };
const secondIdea: WorkflowItemSummary = { fileName: "IDEA-002.md", id: "IDEA-002", title: "채택된 생각", status: "adopted", updatedAt: "2026-07-31T00:00:00Z", excerpt: "기획서로 넘어갔다." };
const draftingIdea: WorkflowItemSummary = { fileName: "IDEA-003.md", id: "IDEA-003", title: "쓰는 중인 생각", status: "drafting", stalledSpecIds: [], updatedAt: "2026-08-01T00:00:00Z", excerpt: "기획서를 쓰고 있다." };
const stalledIdea: WorkflowItemSummary = { fileName: "IDEA-004.md", id: "IDEA-004", title: "멈춘 생각", status: "drafting", stalledSpecIds: ["SPEC-013"], updatedAt: "2026-08-02T00:00:00Z", excerpt: "세션이 죽었다." };
const closedIdea: WorkflowItemSummary = { fileName: "IDEA-005.md", id: "IDEA-005", title: "끝난 생각", status: "closed", stalledSpecIds: [], updatedAt: "2026-08-03T00:00:00Z", excerpt: "기획서가 모두 반려됐다." };
const redraftingIdea: WorkflowItemSummary = { fileName: "IDEA-006.md", id: "IDEA-006", title: "다시 쓰는 생각", status: "redrafting", stalledSpecIds: [], updatedAt: "2026-08-04T00:00:00Z", excerpt: "수정 요청을 받아 다시 쓴다." };
const stalledRedraftingIdea: WorkflowItemSummary = { fileName: "IDEA-007.md", id: "IDEA-007", title: "다시 쓰다 멈춘 생각", status: "redrafting", stalledSpecIds: ["SPEC-021"], updatedAt: "2026-08-05T00:00:00Z", excerpt: "재작성 세션이 죽었다." };

const workflow: WorkflowSummary = {
  id: "wf_1",
  directory: "feature--wf_1",
  name: "Feature",
  status: "active",
  createdAt: "2026-07-30T00:00:00Z",
  counts: { ideas: 1, specs: 0, decisions: 0, workGroups: 0, tasks: 0, reports: 0 },
  items: {
    ideas: [firstIdea],
    specs: [],
    workGroups: [],
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

  it("tells the three derived states apart in the list rows", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, "본문"))}
        workflow={withIdeas(firstIdea, draftingIdea, secondIdea)}
      />,
    );

    expect(screen.getAllByText("반영중")).toHaveLength(1);
    expect(screen.getAllByText("채택")).toHaveLength(1);

    const iconClasses = ["빠른 기록", "쓰는 중인 생각", "채택된 생각"].map(
      (title) =>
        screen
          .getByRole("button", { name: new RegExp(title) })
          .querySelector(".idea-list-icon")?.className,
    );
    expect(new Set(iconClasses).size).toBe(3);
  });

  it("shows each derived state in the preview badge", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, "본문"))}
        workflow={withIdeas(firstIdea, draftingIdea, secondIdea)}
      />,
    );

    const badge = () => within(screen.getByRole("article")).getByText(/^(수집됨|반영중|재반영중|채택)$/);
    expect(badge()).toHaveTextContent("수집됨");

    fireEvent.click(screen.getByRole("button", { name: /쓰는 중인 생각/ }));
    expect(badge()).toHaveTextContent("반영중");

    fireEvent.click(screen.getByRole("button", { name: /채택된 생각/ }));
    expect(badge()).toHaveTextContent("채택");
  });

  it("never shows the old adoption wording next to the new state names", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, "본문"))}
        workflow={withIdeas(firstIdea, draftingIdea, stalledIdea, secondIdea)}
      />,
    );

    expect(screen.queryByText("기획 반영")).toBeNull();
    expect(screen.queryByText("기획서 채택")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /채택된 생각/ }));
    expect(screen.queryByText("기획 반영")).toBeNull();
    expect(screen.queryByText("기획서 채택")).toBeNull();
  });

  it("points at the specifications left behind by a dead session", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(stalledIdea, "본문"))}
        workflow={withIdeas(stalledIdea)}
      />,
    );

    const row = screen.getByRole("button", { name: /멈춘 생각/ });
    expect(within(row).getByText("중단 의심")).toBeInTheDocument();

    const preview = within(screen.getByRole("article"));
    expect(preview.getByText("중단 의심")).toBeInTheDocument();
    expect(preview.getByText(/SPEC-013/)).toBeInTheDocument();
    expect(preview.getByText(/다음 기획자 세션이 이 문서를 이어받아/)).toBeInTheDocument();
    expect(screen.queryByText(/직접 확인해야 합니다/)).toBeNull();
  });

  it("lists every stalled specification", async () => {
    const twoStalled: WorkflowItemSummary = {
      ...stalledIdea,
      stalledSpecIds: ["SPEC-013", "SPEC-019"],
    };
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(twoStalled, "본문"))}
        workflow={withIdeas(twoStalled)}
      />,
    );

    const preview = within(screen.getByRole("article"));
    expect(preview.getByText(/SPEC-013/)).toBeInTheDocument();
    expect(preview.getByText(/SPEC-019/)).toBeInTheDocument();
  });

  it("keeps a live drafting idea free of the stall warning", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(draftingIdea, "본문"))}
        workflow={withIdeas(draftingIdea)}
      />,
    );

    const row = screen.getByRole("button", { name: /쓰는 중인 생각/ });
    expect(within(row).getByText("반영중")).toBeInTheDocument();
    expect(within(screen.getByRole("article")).getByText("반영중")).toBeInTheDocument();
    expect(screen.queryByText("중단 의심")).toBeNull();
  });

  it("renders items from an older payload without the stall field", async () => {
    const legacyIdea: WorkflowItemSummary = { fileName: "IDEA-004.md", id: "IDEA-004", title: "멈춘 생각", status: "drafting", updatedAt: "2026-08-02T00:00:00Z", excerpt: "세션이 죽었다." };
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(legacyIdea, "본문"))}
        workflow={withIdeas(legacyIdea)}
      />,
    );

    expect(screen.getByRole("heading", { name: "멈춘 생각" })).toBeInTheDocument();
    expect(screen.queryByText("중단 의심")).toBeNull();
  });

  it("tags a closed idea in the list row", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, "본문"))}
        workflow={withIdeas(firstIdea, closedIdea, secondIdea)}
      />,
    );

    const row = screen.getByRole("button", { name: /끝난 생각/ });
    expect(within(row).getByText("종결")).toBeInTheDocument();
    expect(row.querySelector(".idea-list-icon")?.className).toContain("closed");
  });

  it("points a closed idea at the new idea path", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(closedIdea, "본문"))}
        workflow={withIdeas(closedIdea)}
      />,
    );

    const article = screen.getByRole("article");
    expect(article.querySelector(".status-pill")).toHaveTextContent("종결");
    expect(within(article).getByText(/기획서가 모두 반려로 끝났습니다/)).toBeInTheDocument();
    expect(within(article).getByText(/새 아이디어로 요청해야 합니다/)).toBeInTheDocument();
    expect(screen.queryByText("중단 의심")).toBeNull();
  });

  it("keeps the closed marking off an adopted idea", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(secondIdea, "본문"))}
        workflow={withIdeas(secondIdea)}
      />,
    );

    const article = screen.getByRole("article");
    expect(article.querySelector(".status-pill")).toHaveTextContent("채택");
    expect(screen.queryByText("종결")).toBeNull();
    expect(screen.queryByText(/새 아이디어로 요청해야 합니다/)).toBeNull();
  });

  it("tells a redrafting idea apart from a drafting one in the row and the preview", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, "본문"))}
        workflow={withIdeas(firstIdea, draftingIdea, redraftingIdea)}
      />,
    );

    const row = screen.getByRole("button", { name: /다시 쓰는 생각/ });
    expect(within(row).getByText("재반영중")).toBeInTheDocument();
    expect(within(row).queryByText("반영중")).toBeNull();

    fireEvent.click(row);
    const badge = within(screen.getByRole("article")).getByText(
      /^(수집됨|반영중|재반영중|채택)$/,
    );
    expect(badge).toHaveTextContent("재반영중");
  });

  it("gives the redrafting state its own colour hooks and the drafting icon", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(redraftingIdea, "본문"))}
        workflow={withIdeas(draftingIdea, redraftingIdea)}
      />,
    );

    const row = screen.getByRole("button", { name: /다시 쓰는 생각/ });
    expect(row.querySelector(".idea-list-icon")?.className).toContain("redrafting");
    expect(row.querySelector(".idea-state-tag")?.className).toContain("redrafting");

    // 아이콘이 반영중과 같은 회전 화살표인지는 그려진 도형을 맞대어 확인한다.
    const shape = (title: RegExp) =>
      screen.getByRole("button", { name: title }).querySelector(".idea-list-icon svg")
        ?.innerHTML;
    expect(shape(/다시 쓰는 생각/)).toBe(shape(/쓰는 중인 생각/));

    fireEvent.click(row);
    expect(
      screen.getByRole("article").querySelector(".status-pill")?.className,
    ).toContain("status-redrafting");
  });

  it("shows the stall warning beside the redrafting badge", async () => {
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(stalledRedraftingIdea, "본문"))}
        workflow={withIdeas(stalledRedraftingIdea)}
      />,
    );

    const row = screen.getByRole("button", { name: /다시 쓰다 멈춘 생각/ });
    expect(within(row).getByText("재반영중")).toBeInTheDocument();
    expect(within(row).getByText("중단 의심")).toBeInTheDocument();

    const preview = within(screen.getByRole("article"));
    expect(preview.getByText("재반영중")).toBeInTheDocument();
    expect(preview.getByText("중단 의심")).toBeInTheDocument();
    expect(preview.getByText(/SPEC-021/)).toBeInTheDocument();
  });

  it("reads an unknown state as the inbox state", async () => {
    const unknownIdea: WorkflowItemSummary = { ...firstIdea, status: "retired" };
    render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(unknownIdea, "본문"))}
        workflow={withIdeas(unknownIdea)}
      />,
    );

    const article = screen.getByRole("article");
    expect(article.querySelector(".status-pill")).toHaveTextContent("수집됨");
    expect(screen.queryByText("종결")).toBeNull();
    const row = screen.getByRole("button", { name: /빠른 기록/ });
    expect(row.querySelector(".idea-state-tag")).toBeNull();
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

  it("keeps the line breaks the user typed in the idea body", async () => {
    const body = ["첫 줄은 배경이다.", "둘째 줄은 원인이다.", "셋째 줄은 방향이다.", "", "빈 줄 뒤는 다른 문단이다."].join("\n");
    const { container } = render(
      <IdeaInbox
        busy={false}
        disabled={false}
        onAdd={vi.fn()}
        onReadIdea={vi.fn().mockResolvedValue(documentFor(firstIdea, body))}
        workflow={workflow}
      />,
    );

    await screen.findByText(/첫 줄은 배경이다/);
    // `<br>`이 들어가면 텍스트가 이어 붙으므로 `getByText`가 맞지 않는다. 구조를 세고 내용은 통째로 본다.
    const paragraphs = container.querySelectorAll(".markdown-body p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].querySelectorAll("br")).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent("첫 줄은 배경이다.");
    expect(paragraphs[0]).toHaveTextContent("둘째 줄은 원인이다.");
    expect(paragraphs[0]).toHaveTextContent("셋째 줄은 방향이다.");
    expect(paragraphs[1]).toHaveTextContent("빈 줄 뒤는 다른 문단이다.");
    expect(paragraphs[1].querySelectorAll("br")).toHaveLength(0);
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

const DRAFT_STORAGE_KEY = "workflow-labs.idea-draft.v1";
const composerLabel = "새로운 생각을 인박스에 담기";

const otherWorkflow: WorkflowSummary = {
  ...workflow,
  id: "wf_2",
  directory: "other--wf_2",
  name: "Other",
};

/**
 * 테스트 환경의 `localStorage`는 메서드가 없는 빈 객체다. 초안이 실제로 남는지 보려면 직접 세워야
 * 한다. `browserIdeaDraftStore.test.ts`의 방식을 따른다.
 */
function stubStorage() {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
  });
  return stored;
}

function inbox(on: WorkflowSummary = workflow, onAdd = vi.fn().mockResolvedValue(true)) {
  return render(
    <IdeaInbox
      busy={false}
      disabled={false}
      onAdd={onAdd}
      onReadIdea={vi.fn().mockResolvedValue(null)}
      workflow={on}
    />,
  );
}

function composer() {
  return screen.getByLabelText(composerLabel);
}

describe("IdeaInbox 아이디어 초안", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = stubStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function storedDrafts(): Record<string, string> {
    return JSON.parse(storage.get(DRAFT_STORAGE_KEY) ?? "{}");
  }

  // 뷰가 조건부 렌더라 다른 메뉴를 누르는 순간 언마운트된다. 그것이 지금 글이 사라지는 경로다.
  it("keeps the draft after the view is left and reopened", () => {
    const { unmount } = inbox();
    fireEvent.change(composer(), { target: { value: "쓰다 만 생각" } });
    unmount();

    inbox();

    expect(composer()).toHaveValue("쓰다 만 생각");
  });

  /**
   * 이 배선에서 가장 조용히 깨지기 쉬운 지점이다.
   *
   * 그리기만 해도 저장하는 구현은 평소에 멀쩡해 보인다. 읽은 값을 그대로 되쓰기 때문이다. 그러다
   * 입력창이 빈 채로 먼저 그려지는 순간(비활성 상태, 잠깐의 뷰 전환) 빈 값이 저장되어 사용자의 글이
   * 사라진다(완료 조건 12). 그래서 "쓰기는 사용자 편집 때만"을 렌더 자체로 고정한다.
   */
  it("writes nothing while only rendering", () => {
    const written: string[] = [];
    const stored = new Map([
      [DRAFT_STORAGE_KEY, JSON.stringify({ [workflow.directory]: "그대로 있어야 하는 글" })],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        written.push(key);
        stored.set(key, value);
      },
    });

    const { unmount } = inbox();
    expect(composer()).toHaveValue("그대로 있어야 하는 글");
    unmount();
    inbox();

    expect(written).toEqual([]);
    expect(composer()).toHaveValue("그대로 있어야 하는 글");
  });

  // 앱을 다시 여는 경로다. 저장소에만 있던 값이 첫 렌더에 입력창으로 올라와야 한다.
  it("shows a draft that was stored before the first render", () => {
    storage.set(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ [workflow.directory]: "지난번에 쓰던 글" }),
    );

    inbox();

    expect(composer()).toHaveValue("지난번에 쓰던 글");
  });

  it("drops the stored draft once the idea is filed", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    const { unmount } = inbox(workflow, onAdd);
    fireEvent.change(composer(), { target: { value: "담길 생각" } });
    fireEvent.click(screen.getByRole("button", { name: "아이디어 추가" }));

    await waitFor(() => expect(composer()).toHaveValue(""));
    expect(storedDrafts()).toEqual({});

    unmount();
    inbox();
    expect(composer()).toHaveValue("");
  });

  // 담기지 못한 글을 잃지 않는 현행 규칙을 저장된 초안까지 넓힌 것이 R2다.
  it("keeps the draft when filing the idea fails", async () => {
    const onAdd = vi.fn().mockResolvedValue(false);
    const { unmount } = inbox(workflow, onAdd);
    fireEvent.change(composer(), { target: { value: "담기지 않을 생각" } });
    fireEvent.click(screen.getByRole("button", { name: "아이디어 추가" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(composer()).toHaveValue("담기지 않을 생각");

    unmount();
    inbox();
    expect(composer()).toHaveValue("담기지 않을 생각");
  });

  it("drops the stored draft when the user empties the box", () => {
    const { unmount } = inbox();
    fireEvent.change(composer(), { target: { value: "썼다가" } });
    fireEvent.change(composer(), { target: { value: "" } });

    expect(storedDrafts()).toEqual({});

    unmount();
    inbox();
    expect(composer()).toHaveValue("");
  });

  // R3. 워크플로가 바뀌면 그 워크플로의 초안만 보여야 한다. A에 쓰던 글이 B에서 제출되면 안 된다.
  it("keeps each workflow's draft to itself", () => {
    const first = inbox();
    fireEvent.change(composer(), { target: { value: "A 워크플로의 글" } });
    first.unmount();

    const second = inbox(otherWorkflow);
    expect(composer()).toHaveValue("");
    fireEvent.change(composer(), { target: { value: "B 워크플로의 글" } });
    second.unmount();

    inbox();
    expect(composer()).toHaveValue("A 워크플로의 글");
  });

  it.each([
    ["JSON이 아닌 문자열", "{not json"],
    ["배열", '["초안"]'],
    ["초안이 문자열이 아닌 값", '{"feature--wf_1":42}'],
  ])("starts from an empty box when the stored value is %s", (_case, stored) => {
    storage.set(DRAFT_STORAGE_KEY, stored);

    expect(() => inbox()).not.toThrow();
    expect(composer()).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // 저장 실패는 알리지 않는다. 그 순간 화면의 글과 제출은 멀쩡해야 한다(R4).
  it("keeps typing and filing working when the storage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("접근이 차단되었습니다");
      },
      setItem: () => {
        throw new Error("접근이 차단되었습니다");
      },
    });
    const onAdd = vi.fn().mockResolvedValue(true);

    expect(() => inbox(workflow, onAdd)).not.toThrow();
    fireEvent.change(composer(), { target: { value: "  저장은 실패해도 담긴다  " } });
    expect(composer()).toHaveValue("  저장은 실패해도 담긴다  ");

    fireEvent.click(screen.getByRole("button", { name: "아이디어 추가" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("저장은 실패해도 담긴다"));
    expect(composer()).toHaveValue("");
  });

  // R6. 초안 배선이 기존 입력 제약을 건드리지 않았다.
  it("still refuses a whitespace-only idea", () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    inbox(workflow, onAdd);
    fireEvent.change(composer(), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: "아이디어 추가" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "아이디어 추가" }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("still caps the box at ten thousand characters", () => {
    inbox();

    expect(composer()).toHaveAttribute("maxlength", "10000");
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
