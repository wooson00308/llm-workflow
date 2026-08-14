import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOLLOW_UP_LABEL, labelSpecDecisions } from "../domain/specDecisionLabels";
import type {
  AgentLeaseSummary,
  ProjectSummary,
  TaskEvent,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
import { ActivityView } from "./ActivityView";
import { eventKinds } from "./DevelopmentBoard";

const now = new Date("2026-08-03T09:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function item(id: string, title: string): WorkflowItemSummary {
  return { fileName: `${id}.md`, id, title, status: "todo", updatedAt: null, excerpt: "" };
}

const primary: WorkflowSummary = {
  id: "wf_1",
  directory: "feature--wf_1",
  name: "Feature",
  status: "active",
  createdAt: "2026-07-30T00:00:00Z",
  counts: { ideas: 1, specs: 1, decisions: 0, workGroups: 0, tasks: 1, reports: 0 },
  items: {
    ideas: [item("IDEA-001", "첫 생각")],
    specs: [item("SPEC-001", "첫 기획서")],
    workGroups: [],
    tasks: [item("TASK-001", "첫 작업")],
  },
};

const second: WorkflowSummary = {
  ...primary,
  id: "wf_2",
  directory: "second--wf_2",
  name: "Second",
  items: {
    ideas: [],
    specs: [item("SPEC-001", "두 번째 워크플로우의 기획서"), item("SPEC-009", "저쪽 기획서")],
    workGroups: [],
    tasks: [],
  },
};

function lease(overrides: Partial<AgentLeaseSummary> = {}): AgentLeaseSummary {
  return {
    leaseId: "lease-1",
    agent: "developer-claude",
    role: "developer",
    taskId: "TASK-001",
    heartbeatAt: "2026-08-03T08:55:00Z",
    expiresAt: "2026-08-03T09:12:00Z",
    ...overrides,
  };
}

function project(
  activeLeases: AgentLeaseSummary[],
  workflows: WorkflowSummary[] = [primary],
): ProjectSummary {
  return {
    rootPath: "/projects/workflow-labs",
    initialized: true,
    projectId: "prj_1",
    name: "workflow-labs",
    compatibility: "current",
    activeLeases,
    workflows,
  };
}

function formatMoment(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

describe("ActivityView", () => {
  it("draws every active lease as its own card", () => {
    render(
      <ActivityView
        onOpenDocument={vi.fn()}
        project={project([
          lease({ leaseId: "l1", agent: "planner-claude", role: "planner", taskId: "IDEA-001" }),
          lease({ leaseId: "l2", agent: "architect-claude", role: "architect", taskId: "SPEC-001" }),
          lease({ leaseId: "l3" }),
        ])}
        workflow={primary}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("shows the agent, held document, last heartbeat and remaining time on one card", () => {
    render(
      <ActivityView onOpenDocument={vi.fn()} project={project([lease()])} workflow={primary} />,
    );

    const card = screen.getByRole("listitem");
    expect(within(card).getByText("developer-claude")).toBeInTheDocument();
    expect(within(card).getByText("첫 작업")).toBeInTheDocument();
    expect(within(card).getByText("마지막 심장박동")).toBeInTheDocument();
    expect(within(card).getByText(formatMoment("2026-08-03T08:55:00Z"))).toBeInTheDocument();
    expect(within(card).getByText("12분 남음")).toBeInTheDocument();
  });

  // lease 파일에는 최초 시작 시각이 없다. 없는 값을 추정으로 채우면 화면이 틀린 말을 한다.
  it("never presents the heartbeat as a start time", () => {
    const { container } = render(
      <ActivityView onOpenDocument={vi.fn()} project={project([lease()])} workflow={primary} />,
    );

    expect(container.textContent).not.toContain("시작");
    expect(container.textContent).not.toMatch(/\d+분째/);
  });

  it("names contract roles, leaves the slot out when absent and shows other values verbatim", () => {
    render(
      <ActivityView
        onOpenDocument={vi.fn()}
        project={project([
          lease({ leaseId: "l1", agent: "architect-claude", role: "architect" }),
          lease({ leaseId: "l2", agent: "nameless-claude", role: null }),
          lease({ leaseId: "l3", agent: "off-contract-claude", role: "reviewer" }),
        ])}
        workflow={primary}
      />,
    );

    const [named, without, offContract] = screen.getAllByRole("listitem");
    expect(within(named).getByText("아키텍트")).toBeInTheDocument();
    expect(without.querySelector(".worker-role")).toBeNull();
    expect(within(without).getByText("nameless-claude")).toBeInTheDocument();
    expect(within(offContract).getByText("reviewer")).toBeInTheDocument();
  });

  it("says the project is quiet instead of leaving an empty list", () => {
    render(<ActivityView onOpenDocument={vi.fn()} project={project([])} workflow={primary} />);

    expect(screen.getByText("지금은 조용합니다")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("opens an idea, a specification and a task through the same navigation callback", () => {
    const onOpenDocument = vi.fn();
    render(
      <ActivityView
        onOpenDocument={onOpenDocument}
        project={project([
          lease({ leaseId: "l1", taskId: "IDEA-001" }),
          lease({ leaseId: "l2", taskId: "SPEC-001" }),
          lease({ leaseId: "l3", taskId: "TASK-001" }),
        ])}
        workflow={primary}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /첫 생각/ }));
    expect(onOpenDocument).toHaveBeenLastCalledWith({
      item: primary.items.ideas[0],
      kind: "ideas",
      workflow: primary,
    });

    fireEvent.click(screen.getByRole("button", { name: /첫 기획서/ }));
    expect(onOpenDocument).toHaveBeenLastCalledWith({
      item: primary.items.specs[0],
      kind: "specs",
      workflow: primary,
    });

    fireEvent.click(screen.getByRole("button", { name: /첫 작업/ }));
    expect(onOpenDocument).toHaveBeenLastCalledWith({
      item: primary.items.tasks[0],
      kind: "tasks",
      workflow: primary,
    });

    expect(screen.getByText(/^아이디어 · IDEA-001/)).toBeInTheDocument();
    expect(screen.getByText(/^기획서 · SPEC-001/)).toBeInTheDocument();
    expect(screen.getByText(/^개발 작업 · TASK-001/)).toBeInTheDocument();
  });

  // lease는 프로젝트 전역이라 선택하지 않은 워크플로우의 워커도 목록에 들어온다.
  it("tells which workflow the resolved document belongs to", () => {
    render(
      <ActivityView
        onOpenDocument={vi.fn()}
        project={project([lease({ taskId: "SPEC-009" })], [primary, second])}
        workflow={primary}
      />,
    );

    expect(screen.getByText("저쪽 기획서")).toBeInTheDocument();
    expect(screen.getByText("기획서 · SPEC-009 · Second")).toBeInTheDocument();
  });

  it("resolves an id shared by two workflows in the selected one", () => {
    const shared = project([lease({ taskId: "SPEC-001" })], [primary, second]);

    const { rerender } = render(
      <ActivityView onOpenDocument={vi.fn()} project={shared} workflow={primary} />,
    );
    expect(screen.getByText("기획서 · SPEC-001 · Feature")).toBeInTheDocument();

    rerender(<ActivityView onOpenDocument={vi.fn()} project={shared} workflow={second} />);
    expect(screen.getByText("기획서 · SPEC-001 · Second")).toBeInTheDocument();
  });

  it("shows only the identifier when the held document cannot be resolved", () => {
    render(
      <ActivityView
        onOpenDocument={vi.fn()}
        project={project([lease({ taskId: "DECISION-XXXX" })])}
        workflow={primary}
      />,
    );

    expect(screen.getByText("DECISION-XXXX")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the banner wording when a lease holds no document", () => {
    render(
      <ActivityView
        onOpenDocument={vi.fn()}
        project={project([lease({ taskId: null })])}
        workflow={primary}
      />,
    );

    expect(screen.getByText("워크플로우 작업")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // 남은 시간은 렌더 시점에 계산한다. 이 뷰는 자기 타이머를 만들지 않고 주기 조회에 얹혀 간다.
  it("reads the remaining time from the render clock without owning a timer", () => {
    render(
      <ActivityView
        onOpenDocument={vi.fn()}
        project={project([
          lease({ leaseId: "l1", expiresAt: "2026-08-03T09:12:00Z" }),
          lease({ leaseId: "l2", expiresAt: "2026-08-03T09:00:30Z" }),
          lease({ leaseId: "l3", expiresAt: "2026-08-03T08:59:00Z" }),
        ])}
        workflow={primary}
      />,
    );

    expect(screen.getByText("12분 남음")).toBeInTheDocument();
    expect(screen.getByText("1분 미만 남음")).toBeInTheDocument();
    expect(screen.getByText("곧 만료")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  // 이 뷰는 읽기 전용이다. 쓰기 액션 props가 없다는 것을 타입과 이 테스트가 함께 고정한다.
  it("routes every interactive element to the single navigation callback", () => {
    const onOpenDocument = vi.fn();
    render(
      <ActivityView
        onOpenDocument={onOpenDocument}
        project={project([
          lease({ leaseId: "l1", taskId: "IDEA-001" }),
          lease({ leaseId: "l2", taskId: "SPEC-001" }),
          lease({ leaseId: "l3", taskId: "TASK-001" }),
        ])}
        workflow={primary}
      />,
    );

    expect(onOpenDocument).not.toHaveBeenCalled();
    for (const button of screen.getAllByRole("button")) fireEvent.click(button);
    expect(onOpenDocument).toHaveBeenCalledTimes(3);
  });
});

function recorded(id: string, title: string, events: TaskEvent[]): WorkflowItemSummary {
  return { ...item(id, title), events };
}

function workflowWith(items: Partial<WorkflowSummary["items"]>): WorkflowSummary {
  return { ...primary, items: { ideas: [], specs: [], workGroups: [], tasks: [], ...items } };
}

function renderFeed(workflow: WorkflowSummary, onOpenDocument = vi.fn()) {
  return render(
    <ActivityView onOpenDocument={onOpenDocument} project={project([])} workflow={workflow} />,
  );
}

function feed() {
  return screen.getByRole("region", { name: "최근 활동" });
}

function feedList() {
  const list = feed().querySelector("ul");
  if (!list) throw new Error("피드 목록이 없습니다");
  return list;
}

function marks() {
  return within(feed())
    .getAllByRole("listitem")
    .map((entry) => entry.querySelector(".activity-mark")?.textContent);
}

/** jsdom은 레이아웃이 없어 `scrollTop`이 늘 0이다. 복원 값을 볼 수 있게 기록 가능한 속성으로 바꾼다. */
function trackScrollTop() {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  const stored = new WeakMap<Element, number>();
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) { return stored.get(this) ?? 0; },
    set(this: Element, value: number) { stored.set(this, value); },
  });
  return () => { if (original) Object.defineProperty(Element.prototype, "scrollTop", original); };
}

describe("ActivityView 최근 활동", () => {
  it("lays task transitions and specification decisions out newest first", () => {
    renderFeed(workflowWith({
      tasks: [recorded("TASK-001", "첫 작업", [
        { kind: "created", at: "2026-08-01T01:00:00Z" },
        { kind: "qa_waiting", at: "2026-08-02T05:00:00Z" },
      ])],
      specs: [recorded("SPEC-001", "첫 기획서", [{ kind: "approved", at: "2026-08-02T03:00:00Z" }])],
    }));

    expect(marks()).toEqual(["기존 QA 대기", "승인", "생성"]);
    expect(within(feed()).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      expect.stringContaining("TASK-001"),
      expect.stringContaining("SPEC-001"),
      expect.stringContaining("TASK-001"),
    ]);
  });

  it("says which document, what happened and when on one line", () => {
    renderFeed(workflowWith({
      tasks: [recorded("TASK-001", "첫 작업", [{ kind: "in_progress", at: "2026-08-02T05:00:00Z" }])],
    }));

    const entry = within(feed()).getByRole("listitem");
    expect(within(entry).getByText("TASK-001")).toBeInTheDocument();
    expect(within(entry).getByText("첫 작업")).toBeInTheDocument();
    expect(within(entry).getByText("시작")).toBeInTheDocument();
    expect(within(entry).getByText(formatMoment("2026-08-02T05:00:00Z"))).toBeInTheDocument();
    expect(entry.querySelector("time")).toHaveAttribute("datetime", "2026-08-02T05:00:00Z");
  });

  // 같은 사실을 두 화면이 다른 말로 부르지 않게 라벨 정의를 개발 화면과 공유한다.
  it("names task transitions and definition revision events with the development timeline labels", () => {
    renderFeed(workflowWith({
      tasks: [recorded("TASK-001", "첫 작업", eventKinds.map((entry, index) => ({
        kind: entry.kind,
        at: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      })))],
    }));

    expect(marks()).toEqual([...eventKinds].reverse().map((entry) => entry.label));
    // 사용자 재개는 QA 반려와 다른 이름으로 선다. 둘 다 작업을 준비 상태로 되돌리지만 다른 사실이다.
    expect(marks()).toEqual([
      "아키텍트 수정", "정의 수정 요청", "사용자 재개", "반려", "기존 완료", "기존 QA 대기",
      "v2 검증 전환", "AI 검증 완료", "막힘", "시작", "생성",
    ]);
  });

  it("shows approval, revision request and rejection from specification decisions", () => {
    renderFeed(workflowWith({
      specs: [
        recorded("SPEC-001", "첫 기획서", [{ kind: "approved", at: "2026-08-03T00:00:00Z" }]),
        recorded("SPEC-002", "둘째 기획서", [{ kind: "revision_requested", at: "2026-08-02T00:00:00Z" }]),
        recorded("SPEC-003", "셋째 기획서", [{ kind: "rejected", at: "2026-08-01T00:00:00Z" }]),
      ],
    }));

    expect(marks()).toEqual(["승인", "수정 요청", "폐기"]);
  });

  // 같은 `kind`라도 원천이 다르면 다른 사건이다. 원천을 잃으면 두 사실이 한 이름으로 뭉개진다.
  it("tells a QA rejection apart from a specification revision request", () => {
    renderFeed(workflowWith({
      tasks: [recorded("TASK-001", "첫 작업", [{ kind: "revision_requested", at: "2026-08-03T00:00:00Z" }])],
      specs: [recorded("SPEC-001", "첫 기획서", [{ kind: "revision_requested", at: "2026-08-02T00:00:00Z" }])],
    }));

    expect(marks()).toEqual(["반려", "수정 요청"]);
  });

  // 기획서 쪽 `revision_requested`도 하나가 아니다. 승인 뒤의 것은 승인과 파생 작업을 그대로 두고
  // 후속 기획을 요청하는 것이라 앞선 승인이 없는 것과 다른 이름으로 불린다(SPEC-042 R5).
  it("tells a follow-up request apart from a revision request on an undecided specification", () => {
    renderFeed(workflowWith({
      specs: [
        recorded("SPEC-001", "승인된 기획서", [
          { kind: "approved", at: "2026-08-01T00:00:00Z" },
          { kind: "revision_requested", at: "2026-08-03T00:00:00Z" },
        ]),
        recorded("SPEC-002", "아직 결정되지 않은 기획서", [
          { kind: "revision_requested", at: "2026-08-02T00:00:00Z" },
        ]),
      ],
    }));

    expect(marks()).toEqual([FOLLOW_UP_LABEL, "수정 요청", "승인"]);
  });

  // 이름이 갈려도 표시는 기록된 값이 정한다. 두 수정 요청이 화면에서 같은 마크를 쓴다.
  it("keeps the mark on the recorded event value when the name splits", () => {
    renderFeed(workflowWith({
      specs: [
        recorded("SPEC-001", "승인된 기획서", [
          { kind: "approved", at: "2026-08-01T00:00:00Z" },
          { kind: "revision_requested", at: "2026-08-03T00:00:00Z" },
        ]),
        recorded("SPEC-002", "아직 결정되지 않은 기획서", [
          { kind: "revision_requested", at: "2026-08-02T00:00:00Z" },
        ]),
      ],
    }));

    expect(
      within(feed())
        .getAllByRole("listitem")
        .map((entry) => entry.querySelector(".activity-mark")?.className),
    ).toEqual([
      "activity-mark event-revision_requested",
      "activity-mark event-revision_requested",
      "activity-mark event-approved",
    ]);
  });

  // 이름 판별이 기획서 화면의 이력과 한 모듈에서만 나온다. 이 뷰가 같은 판별을 다시 쓰면 두 자리가
  // 같은 결정을 다른 이름으로 부르게 되고, 이 단정이 그 자리에서 깨진다.
  it("calls a decision what the specification screen's history calls it", () => {
    const events: TaskEvent[] = [
      { kind: "approved", at: "2026-08-01T00:00:00Z" },
      { kind: "revision_requested", at: "2026-08-02T00:00:00Z" },
      { kind: "rejected", at: "2026-08-03T00:00:00Z" },
    ];
    renderFeed(workflowWith({ specs: [recorded("SPEC-001", "첫 기획서", events)] }));

    expect(marks()).toEqual(labelSpecDecisions(events).map((entry) => entry.label).reverse());
    expect(marks()).toEqual(["폐기", FOLLOW_UP_LABEL, "승인"]);
  });

  it("drops only the records it cannot read", () => {
    renderFeed(workflowWith({
      tasks: [recorded("TASK-001", "첫 작업", [
        { kind: "created", at: "어제" },
        { kind: "teleported", at: "2026-08-02T05:00:00Z" },
        { kind: "qa_waiting", at: "2026-08-02T06:00:00Z" },
      ])],
    }));

    expect(marks()).toEqual(["기존 QA 대기"]);
    expect(feed().textContent).not.toContain("teleported");
  });

  it("follows the selected workflow", () => {
    const first = workflowWith({
      tasks: [recorded("TASK-001", "첫 작업", [{ kind: "created", at: "2026-08-01T00:00:00Z" }])],
    });
    const other: WorkflowSummary = {
      ...second,
      items: {
        ideas: [],
        specs: [recorded("SPEC-009", "저쪽 기획서", [{ kind: "approved", at: "2026-08-02T00:00:00Z" }])],
        workGroups: [],
        tasks: [],
      },
    };

    const { rerender } = renderFeed(first);
    expect(within(feed()).getByText("첫 작업")).toBeInTheDocument();

    rerender(
      <ActivityView onOpenDocument={vi.fn()} project={project([])} workflow={other} />,
    );
    expect(within(feed()).getByText("저쪽 기획서")).toBeInTheDocument();
    expect(within(feed()).queryByText("첫 작업")).not.toBeInTheDocument();
  });

  it("opens the document behind an entry the same way a worker card does", () => {
    const onOpenDocument = vi.fn();
    const workflow = workflowWith({
      tasks: [recorded("TASK-001", "첫 작업", [{ kind: "created", at: "2026-08-01T00:00:00Z" }])],
      specs: [recorded("SPEC-001", "첫 기획서", [{ kind: "approved", at: "2026-08-02T00:00:00Z" }])],
    });
    renderFeed(workflow, onOpenDocument);

    fireEvent.click(within(feed()).getByRole("button", { name: /첫 기획서/ }));
    expect(onOpenDocument).toHaveBeenLastCalledWith({
      item: workflow.items.specs[0],
      kind: "specs",
      workflow,
    });

    fireEvent.click(within(feed()).getByRole("button", { name: /첫 작업/ }));
    expect(onOpenDocument).toHaveBeenLastCalledWith({
      item: workflow.items.tasks[0],
      kind: "tasks",
      workflow,
    });
  });

  it("says the feed was cut and where the whole record lives", () => {
    renderFeed(workflowWith({
      tasks: [recorded("TASK-001", "첫 작업", Array.from({ length: 31 }, (_, index) => ({
        kind: "created",
        at: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
      })))],
    }));

    expect(within(feed()).getAllByRole("listitem")).toHaveLength(30);
    expect(within(feed()).getByText(/최근 30건만 보여줍니다/)).toBeInTheDocument();
    expect(within(feed()).getByText(/타임라인/)).toBeInTheDocument();
  });

  it("separates an empty record from a truncated one", () => {
    renderFeed(workflowWith({ tasks: [item("TASK-001", "첫 작업")] }));

    expect(within(feed()).getByText("아직 기록이 없습니다")).toBeInTheDocument();
    expect(within(feed()).queryByText(/보여줍니다/)).not.toBeInTheDocument();
    expect(within(feed()).queryByRole("listitem")).not.toBeInTheDocument();
  });

  // 문서로 이동하면 이 뷰는 언마운트된다. 보존이 없으면 돌아왔을 때 맨 위로 튄다.
  it("keeps the place the user was reading after leaving and coming back", () => {
    const restore = trackScrollTop();
    const workflow = workflowWith({
      tasks: [recorded("TASK-001", "첫 작업", Array.from({ length: 12 }, (_, index) => ({
        kind: "created",
        at: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
      })))],
    });

    try {
      const first = renderFeed(workflow);
      feedList().scrollTop = 96;
      fireEvent.scroll(feedList());
      first.unmount();

      renderFeed(workflow);
      expect(feedList().scrollTop).toBe(96);

      // 모듈 스코프에 남은 자리가 다음 테스트로 새지 않게 되돌린다.
      feedList().scrollTop = 0;
      fireEvent.scroll(feedList());
    } finally {
      restore();
    }
  });

  it("draws the feed without owning a timer", () => {
    renderFeed(workflowWith({
      tasks: [recorded("TASK-001", "첫 작업", [{ kind: "created", at: "2026-08-01T00:00:00Z" }])],
    }));

    expect(vi.getTimerCount()).toBe(0);
  });
});
