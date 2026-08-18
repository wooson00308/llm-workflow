import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WorkGroupSummary,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
import { DevelopmentBoard } from "./DevelopmentBoard";

const today = new Date();

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

const todayKey = localDateKey(today);
const otherDayKey = localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() === 1 ? 2 : 1));

function localDateKeyOf(at: string) {
  return localDateKey(new Date(at));
}

function dayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(year, month - 1, day));
}

function dayCell(container: HTMLElement, key: string) {
  const cell = container.querySelector(`time[datetime="${key}"]`)?.parentElement;
  if (!cell) throw new Error(`${key} 칸을 찾지 못했습니다.`);
  return cell;
}

afterEach(cleanup);
// 접힘 검사가 저장소에 쓰지만 따로 비울 것이 없다. 이 환경의 전역 `localStorage`는 메서드가 없는 빈
// 객체이고 값은 `stubStorage()`가 검사마다 새로 만드는 `Map`에만 쌓이므로, 이 한 줄이 곧 정리다.
afterEach(() => vi.unstubAllGlobals());

const tasks: WorkflowItemSummary[] = [
  { fileName: "TASK-001.md", id: "TASK-001", title: "파서 구현", status: "in_progress", updatedAt: "2026-07-30T09:00:00Z", dueAt: todayKey, excerpt: "문서 상태를 읽는다.", sourceSpecId: "GROUP-DEFAULT", sourceDecisionId: "DECISION-GROUP-DEFAULT", workGroupId: "GROUP-DEFAULT", workGroupRevision: 1 },
  { fileName: "TASK-002.md", id: "TASK-002", title: "사용자 QA", status: "verified", updatedAt: "2026-07-30T08:00:00Z", dueAt: null, excerpt: "실제 흐름을 확인한다.", sourceSpecId: "GROUP-DEFAULT", sourceDecisionId: "DECISION-GROUP-DEFAULT", workGroupId: "GROUP-DEFAULT", workGroupRevision: 1 },
];

function workflowWith(
  items: WorkflowItemSummary[] = tasks,
  specs: WorkflowItemSummary[] = [],
  explicitGroups?: WorkGroupSummary[],
): WorkflowSummary {
  const normalizedTasks = items.map((item) => {
    const workGroupId = item.workGroupId ?? item.sourceSpecId ?? "GROUP-DEFAULT";
    return {
      ...item,
      sourceSpecId: item.sourceSpecId ?? workGroupId,
      sourceDecisionId: item.sourceDecisionId ?? `DECISION-${workGroupId}`,
      workGroupId,
      workGroupRevision: item.workGroupRevision ?? 1,
    };
  });
  const specTitles = new Map(specs.map((spec) => [spec.id, spec.title]));
  const derivedGroups: WorkGroupSummary[] = [...new Set(normalizedTasks.map((item) => item.workGroupId!))].map((id) => {
    const member = normalizedTasks.find((item) => item.workGroupId === id)!;
    return {
      fileName: `${id}.md`,
      id,
      title: specTitles.get(id) ?? (id === "GROUP-DEFAULT" ? "기본 작업 그룹" : id),
      status: "active",
      displayStatus: "developing",
      revision: 1,
      qaMode: "user",
      sourceSpecId: member.sourceSpecId!,
      sourceDecisionId: member.sourceDecisionId!,
      sourceQaDecisionId: null,
      updatedAt: "2026-08-01T00:00:00Z",
      description: "",
      scenarios: [],
    };
  });
  const workGroups = explicitGroups ?? derivedGroups;
  return {
    id: "wf_1",
    directory: "feature--wf_1",
    name: "Feature",
    status: "active",
    createdAt: "2026-07-30T00:00:00Z",
    counts: { ideas: 0, specs: specs.length, decisions: 0, workGroups: workGroups.length, tasks: items.length, reports: 0 },
    items: { ideas: [], specs, workGroups, tasks: normalizedTasks },
  };
}

function testGroup(overrides: Partial<WorkGroupSummary> = {}): WorkGroupSummary {
  return {
    fileName: "GROUP-A.md", id: "GROUP-A", title: "카드 등록", status: "active", displayStatus: "developing",
    revision: 1, qaMode: "user", sourceSpecId: "SPEC-A", sourceDecisionId: "DECISION-A",
    sourceQaDecisionId: null, updatedAt: "2026-08-14T09:00:00Z", description: "", scenarios: [], ...overrides,
  };
}

function taskReader(item: WorkflowItemSummary = tasks[1]) {
  return vi.fn().mockResolvedValue({
    summary: item,
    body: `# ${item.title}\n\n## 작업 범위\n\n${item.excerpt}`,
  });
}

function laneTask(
  id: string,
  status: string,
  sourceSpecId: string | null,
  extra: Partial<WorkflowItemSummary> = {},
): WorkflowItemSummary {
  return {
    fileName: `${id}.md`,
    id,
    title: `${id} 작업`,
    status,
    updatedAt: "2026-08-01T00:00:00Z",
    dueAt: null,
    excerpt: "",
    sourceSpecId,
    sourceDecisionId: sourceSpecId ? `DECISION-${sourceSpecId.replace(/^SPEC-/, "")}` : null,
    ...extra,
  };
}

const LANE_COLLAPSE_KEY = "workflow-labs.spec-lane-collapse.v1";

/** `browserSpecLaneCollapseStore.test.ts`와 같은 대체 저장소. 화면이 쓴 값을 그대로 읽어 볼 수 있다. */
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

describe("DevelopmentBoard", () => {
  it("groups development tasks by their actual status", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith()} />);

    expect(screen.getByRole("region", { name: "GROUP-DEFAULT 칸반 보드" })).toBeInTheDocument();
    expect(screen.getByText("파서 구현")).toBeInTheDocument();
    expect(screen.getAllByText("사용자 QA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("진행 중").length).toBeGreaterThan(0);
    expect(screen.getAllByText("완료").length).toBeGreaterThan(0);
  });

  it("shares search and status filters across view modes", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "파서" } });
    expect(screen.getByText("파서 구현")).toBeInTheDocument();
    expect(screen.queryByText("사용자 QA")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "리스트" }));
    const list = screen.getByRole("region", { name: "개발 작업 리스트" });
    expect(within(list).getByText("파서 구현")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "verified" } });
    expect(within(list).getByText("사용자 QA")).toBeInTheDocument();
    expect(within(list).queryByText("파서 구현")).not.toBeInTheDocument();
  });

  it("places tasks on the timeline by transition time instead of due_at", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T04:00:00Z` }] },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const timeline = screen.getByRole("region", { name: "개발 작업 타임라인" });
    expect(within(dayCell(timeline, todayKey)).getByText("시작")).toBeInTheDocument();
  });

  it("drops the due_at placement wording from the timeline header", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith()} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    expect(screen.getByText("상태 전이 기록 기준")).toBeInTheDocument();
    expect(screen.queryByText("일정 미지정")).not.toBeInTheDocument();
    expect(screen.queryByText(/due_at을 추가하면/)).not.toBeInTheDocument();
  });

  it("folds a day into one chip per event kind", () => {
    const items: WorkflowItemSummary[] = [1, 2, 3].map((index) => ({
      fileName: `TASK-10${index}.md`,
      id: `TASK-10${index}`,
      title: `작업 ${index}`,
      status: "verified",
      updatedAt: `${todayKey}T00:00:00Z`,
      dueAt: null,
      excerpt: "",
      events: [
        { kind: "in_progress", at: `${todayKey}T01:00:00Z` },
        { kind: "verified", at: `${todayKey}T02:00:00Z` },
      ],
    }));
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(cell.querySelectorAll(".calendar-count")).toHaveLength(2);
    expect(within(cell).getByText("시작").parentElement).toHaveTextContent("시작3");
    expect(within(cell).getByText("완료").parentElement).toHaveTextContent("완료3");
  });

  it("keeps every verified task on the board and timeline", () => {
    const verified = [1, 2, 3, 4].map((day) => ({
      fileName: `TASK-00${day}.md`,
      id: `TASK-00${day}`,
      title: `검증 완료 작업 ${day}`,
      status: "verified",
      updatedAt: `2026-07-0${day}T00:00:00Z`,
      dueAt: null,
      excerpt: "",
      events: [{ kind: "verified", at: `${todayKey}T05:00:00Z` }],
    }));
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader(verified[0])} workflow={workflowWith(verified)} />);

    expect(screen.getByText("4개 표시")).toBeInTheDocument();
    expect(screen.getByText("검증 완료 작업 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(within(cell).getByText("완료").parentElement).toHaveTextContent("완료4");
    expect(screen.getByText("4개 표시 · 전체 이력 표시")).toBeInTheDocument();
  });

  it("narrows timeline events with the shared search and status filters", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T01:00:00Z` }] },
      { ...tasks[1], dueAt: null, events: [{ kind: "verified", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const cell = () => dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(cell().querySelectorAll(".calendar-count")).toHaveLength(2);

    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "verified" } });
    expect(within(cell()).getByText("완료")).toBeInTheDocument();
    expect(within(cell()).queryByText("시작")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "파서" } });
    expect(within(cell()).getByText("시작")).toBeInTheDocument();
    expect(within(cell()).queryByText("완료")).not.toBeInTheDocument();
  });

  it("skips unreadable event times and unknown kinds without breaking the grid", () => {
    const items: WorkflowItemSummary[] = [
      {
        ...tasks[0],
        dueAt: null,
        events: [
          { kind: "created", at: "어제" },
          { kind: "탈락", at: `${todayKey}T03:00:00Z` },
          { kind: "blocked", at: `${todayKey}T03:00:00Z` },
        ],
      },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(cell.querySelectorAll(".calendar-count")).toHaveLength(1);
    expect(within(cell).getByText("막힘")).toBeInTheDocument();
  });

  it("groups events by the local date of the transition instant", () => {
    const at = `${todayKey}T23:00:00Z`;
    const localKey = localDateKeyOf(at);
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "verified", at }] },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const timeline = screen.getByRole("region", { name: "개발 작업 타임라인" });
    expect(within(dayCell(timeline, localKey)).getByText("완료")).toBeInTheDocument();
    if (localKey !== todayKey) {
      expect(within(dayCell(timeline, todayKey)).queryByText("완료")).not.toBeInTheDocument();
    }
  });

  it("opens a day's events in time order with the task id, title and kind", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "qa_waiting", at: `${todayKey}T08:00:00Z` }] },
      { ...tasks[1], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 2건` }));

    const entries = screen.getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("시작");
    expect(entries[0]).toHaveTextContent("TASK-002");
    expect(entries[0]).toHaveTextContent("사용자 QA");
    expect(entries[1]).toHaveTextContent("기존 QA 대기");
    expect(entries[1]).toHaveTextContent("TASK-001");
    expect(entries[1]).toHaveTextContent("파서 구현");
  });

  it("opens the task detail from a timeline event entry", async () => {
    const onReadTask = taskReader(tasks[0]);
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "blocked", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={onReadTask} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 1건` }));
    fireEvent.click(within(screen.getByRole("listitem")).getByRole("button"));

    await waitFor(() => expect(onReadTask).toHaveBeenCalledWith("TASK-001.md"));
    expect(await screen.findByRole("button", { name: "← 개발 작업으로" })).toBeInTheDocument();
  });

  it("leaves days without events out of the keyboard order", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const timeline = screen.getByRole("region", { name: "개발 작업 타임라인" });
    expect(dayCell(timeline, todayKey).tagName).toBe("BUTTON");
    expect(timeline.querySelectorAll(".calendar-grid > button")).toHaveLength(1);
  });

  it("selects a day with the keyboard and exposes the selection", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
      { ...tasks[1], dueAt: null, events: [{ kind: "qa_waiting", at: `${otherDayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const target = screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 1건` });
    const other = screen.getByRole("button", { name: `${dayLabel(otherDayKey)}, 이벤트 1건` });
    expect(target).toHaveAttribute("aria-pressed", "false");

    // 기본 키보드 조작을 그대로 쓰므로, 날짜 칸이 초점을 받는 진짜 button인지까지 확인한다.
    target.focus();
    expect(document.activeElement).toBe(target);
    expect(target.tagName).toBe("BUTTON");

    fireEvent.click(target);
    expect(target).toHaveAttribute("aria-pressed", "true");
    expect(other).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the month and filters untouched while opening and closing a day", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "파서" } });

    const monthTitle = screen.getByRole("heading", { level: 2 }).textContent;
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 1건` }));
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(monthTitle ?? "");
    expect(screen.getByRole("textbox", { name: "작업 검색" })).toHaveValue("파서");
  });

  it("lists both entries when one task transitions twice on the same day", () => {
    const items: WorkflowItemSummary[] = [
      {
        ...tasks[0],
        dueAt: null,
        events: [
          { kind: "in_progress", at: `${todayKey}T02:00:00Z` },
          { kind: "qa_waiting", at: `${todayKey}T06:00:00Z` },
        ],
      },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 2건` }));

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("clears the day selection when the month changes", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 1건` }));
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
  });

  it("reports tasks that never reach the timeline and drops the notice once they do", () => {
    const withEvents: WorkflowItemSummary = { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] };
    const view = render(
      <DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith([withEvents, { ...tasks[1], dueAt: null }])} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    expect(screen.getByText("기록이 없어 타임라인에 표시되지 않는 작업 1건")).toBeInTheDocument();

    view.rerender(
      <DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith([withEvents])} />,
    );
    expect(screen.queryByText(/기록이 없어 타임라인에 표시되지 않는 작업/)).not.toBeInTheDocument();
  });

  it("tells an empty month apart from a month emptied by filters", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    expect(screen.queryByText("이 달에 기록된 전이가 없습니다.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.getByText("이 달에 기록된 전이가 없습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "오늘" }));
    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "없는작업" } });
    expect(screen.getByText("필터 조건에 맞는 기록이 이 달에 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("이 달에 기록된 전이가 없습니다.")).not.toBeInTheDocument();
  });

  it.each([
    ["todo", "시작을 기다리는 작업입니다", "AI가 아직 이 작업을 시작하지 않았습니다."],
    ["in_progress", "AI가 작업하고 있습니다", "사용자가 따로 실행할 절차는 없습니다."],
    ["blocked", "AI 작업이 잠시 멈췄습니다", "내부 확인과 복구는 AI가 맡습니다."],
    ["verified", "작업을 마쳤습니다", "작업 그룹 단위로 품질 확인에 올라옵니다."],
  ])("explains the %s state without asking the user to run internal checks", async (status, heading, description) => {
    const item = { ...tasks[0], status };
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader(item)} workflow={workflowWith([item])} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    const verification = await screen.findByRole("region", { name: "작업 진행 상태" });
    expect(within(verification).getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(within(verification).getByText(new RegExp(description))).toBeInTheDocument();
  });

  it("shows only the validated work group title, id, revision and display status", async () => {
    const item = laneTask("TASK-DETAIL", "verified", "SPEC-A", {
      title: "카드 저장 구현",
      workGroupId: "GROUP-A",
      workGroupRevision: 1,
    });
    const group = testGroup({ displayStatus: "qa_ready", revision: 2 });
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader(item)} workflow={workflowWith([item], [], [group])} />);

    fireEvent.click(screen.getByRole("button", { name: /카드 저장 구현/ }));

    const groupPanel = await screen.findByRole("region", { name: "소속 작업 그룹" });
    expect(within(groupPanel).getByRole("heading", { name: "카드 등록" })).toBeInTheDocument();
    expect(within(groupPanel).getByText("GROUP-A")).toBeInTheDocument();
    expect(within(groupPanel).getByText("2")).toBeInTheDocument();
    expect(within(groupPanel).getByText("사용자 QA 대기")).toBeInTheDocument();
  });

  it("hides the task source, terminal commands, dependency internals and user correction controls", async () => {
    const onReadTask = vi.fn().mockResolvedValue({
      summary: tasks[0],
      body: "# 파서 구현\n\n## 내부 검증\n\nnpx vitest run",
      dependencies: [{ id: "TASK-404", state: "missing" }],
      dependencyFormatError: true,
      overlapBlocks: [{ leaseTargetId: "TASK-999", sharedFiles: ["src/internal.ts"] }],
    });
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={onReadTask} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));
    await screen.findByRole("region", { name: "작업 진행 상태" });

    expect(screen.queryByText(/npx vitest/)).not.toBeInTheDocument();
    expect(screen.queryByText("TASK-404")).not.toBeInTheDocument();
    expect(screen.queryByText("TASK-999")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /원문|수정 요청|다시 열기/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: /검증 패널/ })).not.toBeInTheDocument();
  });

  it("shows the task's decision-maker summary while keeping internals hidden", async () => {
    const onReadTask = vi.fn().mockResolvedValue({
      summary: tasks[0],
      body: "# 파서 구현\n\n## 결정권자 요약\n\n### 제안\n\n문서 상태를 빠르게 읽게 만든다.\n\n## 내부 검증\n\nnpx vitest run",
    });
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={onReadTask} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));
    const brief = await screen.findByRole("region", { name: "작업 요약" });
    expect(within(brief).getByText("문서 상태를 빠르게 읽게 만든다.")).toBeInTheDocument();
    expect(screen.queryByText(/npx vitest/)).not.toBeInTheDocument();
  });

  it.each([
    ["missing group", { ...tasks[0], workGroupId: "GROUP-404" }],
    ["future group revision", { ...tasks[0], workGroupRevision: 2 }],
    ["different source spec", { ...tasks[0], sourceSpecId: "SPEC-OTHER" }],
    ["different source decision", { ...tasks[0], sourceDecisionId: "DECISION-OTHER" }],
  ])("marks a %s as needing group confirmation", async (_case, item) => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader(item)} workflow={workflowWith([tasks[0]])} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    const groupPanel = await screen.findByRole("region", { name: "소속 작업 그룹" });
    expect(within(groupPanel).getByRole("heading", { name: "소속 그룹 확인 필요" })).toBeInTheDocument();
  });

  it("does not expose technical excerpts on task cards or the flat list", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith()} />);

    expect(screen.queryByText("문서 상태를 읽는다.")).not.toBeInTheDocument();
    expect(screen.queryByText("실제 흐름을 확인한다.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "리스트" }));
    expect(screen.queryByText("문서 상태를 읽는다.")).not.toBeInTheDocument();
    expect(screen.queryByText("실제 흐름을 확인한다.")).not.toBeInTheDocument();
    expect(screen.getByText("TASK-001")).toBeInTheDocument();
  });
  it("uses work groups as the default development view", () => {
    const items = [
      laneTask("TASK-101", "in_progress", "SPEC-A", { workGroupId: "GROUP-A", workGroupRevision: 1 }),
      laneTask("TASK-102", "verified", "SPEC-A", { workGroupId: "GROUP-A", workGroupRevision: 1 }),
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items, [], [
      testGroup({ id: "GROUP-A", title: "카드 등록", displayStatus: "developing" }),
    ])} />);

    expect(screen.getByRole("region", { name: "GROUP-A 칸반 보드" })).toBeInTheDocument();
    expect(screen.getByText("카드 등록")).toBeInTheDocument();
    expect(screen.getByText("GROUP-A · 구성 버전 1")).toBeInTheDocument();
    expect(screen.getByText("개발 중")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "평면 태스크 보기" })).not.toHaveAttribute("aria-pressed");
  });

  it("shows architect preparation before any task exists", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith([], [], [
      testGroup({ status: "preparing", displayStatus: "preparing", title: "검색 개편" }),
    ])} />);

    expect(screen.getByText("검색 개편")).toBeInTheDocument();
    expect(screen.getByText("아키텍트 구성 중")).toBeInTheDocument();
    expect(screen.getByText("아키텍트가 작업 구성을 작성 중입니다.")).toBeInTheDocument();
  });

  it("distinguishes a stopped architect preparation from ordinary development", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith([], [], [
      testGroup({ status: "preparing", displayStatus: "preparing_stalled", title: "검색 개편" }),
    ])} />);

    expect(screen.getByText("구성 중단 의심")).toBeInTheDocument();
  });

  it("opens the quality check for a qa-ready group without exposing decision controls", () => {
    const onOpenQa = vi.fn();
    const items = [laneTask("TASK-201", "verified", "SPEC-A", { workGroupId: "GROUP-A", workGroupRevision: 2 })];
    render(<DevelopmentBoard onOpenQa={onOpenQa} onReadTask={taskReader()} workflow={workflowWith(items, [], [
      testGroup({ revision: 2, displayStatus: "qa_ready", scenarios: [{ id: "QA-01", title: "카드 확인", body: "카드를 확인한다." }] }),
    ])} />);

    // 입구는 열되, 확인·도장 같은 QA 결정 컨트롤은 여전히 개발 화면에 두지 않는다.
    fireEvent.click(screen.getByRole("button", { name: "품질 확인 시작 →" }));
    expect(onOpenQa).toHaveBeenCalledWith("GROUP-A");
    expect(screen.queryByRole("button", { name: /확인하고 다음|확인 완료|도장|기록하기/ })).not.toBeInTheDocument();
  });

  it("keeps finished groups off the board and points to the archive", () => {
    const items = [
      laneTask("TASK-501", "in_progress", "SPEC-A", { workGroupId: "GROUP-A", workGroupRevision: 1 }),
      laneTask("TASK-502", "verified", "SPEC-B", { workGroupId: "GROUP-B", workGroupRevision: 1, sourceDecisionId: "DECISION-B" }),
      laneTask("TASK-503", "verified", "SPEC-C", { workGroupId: "GROUP-C", workGroupRevision: 1, sourceDecisionId: "DECISION-C" }),
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items, [], [
      testGroup({ id: "GROUP-A", title: "진행 중 기능", displayStatus: "developing" }),
      testGroup({ id: "GROUP-B", title: "QA 끝난 기능", displayStatus: "completed" }),
      testGroup({ id: "GROUP-C", title: "자동 검증 기능", displayStatus: "automatic_completed" }),
    ])} />);

    expect(screen.getByText("진행 중 기능")).toBeInTheDocument();
    expect(screen.queryByText("QA 끝난 기능")).not.toBeInTheDocument();
    expect(screen.queryByText("자동 검증 기능")).not.toBeInTheDocument();
    expect(screen.getByText("완료된 작업 그룹 2개는 기록 화면에 있습니다.")).toBeInTheDocument();
  });

  /**
   * 감춤 판정을 확인하는 검사들이 함께 쓰는 화면. 진행 중 그룹 하나, 끝난 그룹 두 개, 소속을
   * 확정할 수 없는 작업 세 종류를 한 화면에 놓아 어느 보기에서든 같은 집합이 나오는지 본다.
   */
  function hidingWorkflow() {
    const items = [
      laneTask("TASK-601", "in_progress", "SPEC-A", { title: "남는 작업", workGroupId: "GROUP-A", workGroupRevision: 1 }),
      laneTask("TASK-602", "verified", "SPEC-B", { title: "끝난 QA 작업", workGroupId: "GROUP-B", workGroupRevision: 1 }),
      laneTask("TASK-603", "blocked", "SPEC-C", { title: "끝난 자동 작업", workGroupId: "GROUP-C", workGroupRevision: 1 }),
      laneTask("TASK-604", "verified", "SPEC-D", { title: "QA 대기 작업", workGroupId: "GROUP-D", workGroupRevision: 1 }),
    ];
    return workflowWith(items, [], [
      testGroup({ id: "GROUP-A", title: "진행 중 기능", displayStatus: "developing", sourceSpecId: "SPEC-A", sourceDecisionId: "DECISION-A" }),
      testGroup({ id: "GROUP-B", title: "QA 끝난 기능", displayStatus: "completed", sourceSpecId: "SPEC-B", sourceDecisionId: "DECISION-B" }),
      testGroup({ id: "GROUP-C", title: "자동 검증 기능", displayStatus: "automatic_completed", sourceSpecId: "SPEC-C", sourceDecisionId: "DECISION-C" }),
      testGroup({ id: "GROUP-D", title: "QA 대기 기능", displayStatus: "qa_ready", sourceSpecId: "SPEC-D", sourceDecisionId: "DECISION-D" }),
    ]);
  }

  function openFlatBoard() {
    fireEvent.click(screen.getByRole("button", { name: "평면 태스크 보기" }));
    return screen.getByRole("region", { name: "개발 작업 칸반 보드" });
  }

  function openList() {
    fireEvent.click(screen.getByRole("button", { name: "리스트" }));
    return screen.getByRole("region", { name: "개발 작업 리스트" });
  }

  it("keeps finished group tasks out of the flat board and the list", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={hidingWorkflow()} />);

    const board = openFlatBoard();
    expect(within(board).getByText("남는 작업")).toBeInTheDocument();
    expect(within(board).queryByText("끝난 QA 작업")).not.toBeInTheDocument();
    expect(within(board).queryByText("끝난 자동 작업")).not.toBeInTheDocument();

    const list = openList();
    expect(within(list).getByText("남는 작업")).toBeInTheDocument();
    expect(within(list).queryByText("끝난 QA 작업")).not.toBeInTheDocument();
    expect(within(list).queryByText("끝난 자동 작업")).not.toBeInTheDocument();
  });

  it("counts the header, summary band and result count without finished group tasks", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={hidingWorkflow()} />);

    // 남는 작업은 진행 중 1건과 QA 대기 그룹의 완료 1건뿐이다. 막힘 1건은 끝난 그룹에 속해 빠진다.
    expect(screen.getByText("진행 중 1")).toBeInTheDocument();
    expect(screen.getByText("막힘 0")).toBeInTheDocument();
    expect(screen.getByText("완료 1")).toBeInTheDocument();
    expect(screen.getByText("2개 표시")).toBeInTheDocument();

    openFlatBoard();
    expect(screen.getByText("2개 표시")).toBeInTheDocument();
    openList();
    expect(screen.getByText("2개 표시")).toBeInTheDocument();
  });

  it("keeps a qa-ready group's tasks in every view", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={hidingWorkflow()} />);

    expect(within(screen.getByRole("region", { name: "GROUP-D 칸반 보드" })).getByText("QA 대기 작업")).toBeInTheDocument();
    expect(within(openFlatBoard()).getByText("QA 대기 작업")).toBeInTheDocument();
    expect(within(openList()).getByText("QA 대기 작업")).toBeInTheDocument();
  });

  it.each([
    ["missing group", { workGroupId: "GROUP-404" }],
    ["future group revision", { workGroupRevision: 2 }],
    ["different source decision", { sourceDecisionId: "DECISION-OTHER" }],
  ])("keeps a task with a %s visible even when its group id is finished", (_case, overrides) => {
    const item = laneTask("TASK-701", "verified", "SPEC-B", {
      title: "소속 미확정 작업",
      workGroupId: "GROUP-B",
      workGroupRevision: 1,
      ...overrides,
    });
    const workflow = workflowWith([item], [], [
      testGroup({ id: "GROUP-B", title: "QA 끝난 기능", displayStatus: "completed", sourceSpecId: "SPEC-B", sourceDecisionId: "DECISION-B" }),
    ]);
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflow} />);

    expect(within(openFlatBoard()).getByText("소속 미확정 작업")).toBeInTheDocument();
    expect(within(openList()).getByText("소속 미확정 작업")).toBeInTheDocument();
  });

  it("does not surface a finished group task through the search box", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={hidingWorkflow()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "끝난" } });
    expect(within(openFlatBoard()).queryByText("끝난 QA 작업")).not.toBeInTheDocument();
    expect(within(openList()).queryByText("끝난 QA 작업")).not.toBeInTheDocument();
  });

  it("shows the archive note once in each list view and never without a hidden group", () => {
    const view = render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={hidingWorkflow()} />);
    const note = "완료된 작업 그룹 2개는 기록 화면에 있습니다.";

    expect(screen.getAllByText(note)).toHaveLength(1);
    openFlatBoard();
    expect(screen.getAllByText(note)).toHaveLength(1);
    openList();
    expect(screen.getAllByText(note)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    expect(screen.queryByText(note)).not.toBeInTheDocument();

    const items = [laneTask("TASK-801", "in_progress", "SPEC-A", { workGroupId: "GROUP-A", workGroupRevision: 1 })];
    view.rerender(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items, [], [
      testGroup({ id: "GROUP-A", displayStatus: "developing" }),
    ])} />);
    fireEvent.click(screen.getByRole("button", { name: "보드" }));
    expect(screen.queryByText(/완료된 작업 그룹/)).not.toBeInTheDocument();
  });

  it("keeps the timeline counting the events of finished group tasks", () => {
    const items = [
      laneTask("TASK-901", "in_progress", "SPEC-A", { workGroupId: "GROUP-A", workGroupRevision: 1, events: [{ kind: "in_progress", at: `${todayKey}T01:00:00Z` }] }),
      laneTask("TASK-902", "verified", "SPEC-B", { workGroupId: "GROUP-B", workGroupRevision: 1, events: [{ kind: "verified", at: `${todayKey}T02:00:00Z` }] }),
    ];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items, [], [
      testGroup({ id: "GROUP-A", displayStatus: "developing", sourceSpecId: "SPEC-A", sourceDecisionId: "DECISION-A" }),
      testGroup({ id: "GROUP-B", displayStatus: "completed", sourceSpecId: "SPEC-B", sourceDecisionId: "DECISION-B" }),
    ])} />);

    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(within(cell).getByText("완료")).toBeInTheDocument();
    expect(screen.getByText("2개 표시 · 전체 이력 표시")).toBeInTheDocument();
  });

  it("switches to the flat task board only as a secondary view", () => {
    const items = [laneTask("TASK-301", "todo", "SPEC-A", { workGroupId: "GROUP-A", workGroupRevision: 1 })];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items, [], [testGroup()])} />);

    fireEvent.click(screen.getByRole("button", { name: "평면 태스크 보기" }));
    expect(screen.getByRole("region", { name: "개발 작업 칸반 보드" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "작업 그룹별 보기" })).not.toHaveAttribute("aria-pressed");
  });

  it("keeps a group collapsed after remounting the workflow", () => {
    const stored = stubStorage();
    const summary = workflowWith(
      [laneTask("TASK-401", "in_progress", "SPEC-A", { workGroupId: "GROUP-A", workGroupRevision: 1 })],
      [],
      [testGroup()],
    );
    const first = render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "GROUP-A 레인 접기" }));
    first.unmount();

    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={summary} />);
    expect(screen.queryByRole("region", { name: "GROUP-A 칸반 보드" })).not.toBeInTheDocument();
    expect(JSON.parse(stored.get(LANE_COLLAPSE_KEY) ?? "{}")["feature--wf_1"]["GROUP-A"]).toBe(true);
  });
});

/** 화면 어디에도 그대로 나오면 안 되는 기계 이름들. C11이 세 화면에서 같은 목록으로 확인한다. */
const internalNames = [
  "configuration_error", "preparing_stalled", "human_judgment_required", "qa_ready",
  "metadata_invalid", "tasks_missing", "task_link_mismatch", "user_scenario_unusable",
  "automatic_scenario_present", "task_not_verified",
  "configurationIssues", "humanJudgmentNote", "displayStatus",
  "DevelopmentBoard.tsx", "src/features",
];

describe("DevelopmentBoard attention notes", () => {
  it("explains the problem, the owner and the absent user action for a configuration error", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith([], [], [
      testGroup({
        title: "카드 등록",
        displayStatus: "configuration_error",
        configurationIssues: ["tasks_missing", "user_scenario_unusable"],
      }),
    ])} />);

    // 상세를 열지 않고 목록만 보는 자리에서 셋이 함께 보인다.
    const note = screen.getByRole("note", { name: "상태 설명" });
    expect(screen.getByText("구성 확인 필요")).toBeInTheDocument();
    expect(within(note).getByText(/품질 확인을 열 수 없습니다/)).toBeInTheDocument();
    expect(within(note).getByText(/아키텍트가 구성을 다시 맞춥니다/)).toBeInTheDocument();
    expect(within(note).getByText(/지금 사용자가 할 일은 없습니다/)).toBeInTheDocument();

    // 사유가 둘이면 둘이 따로 선다.
    const reasons = within(note).getAllByRole("listitem");
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toHaveTextContent("이 기능에 배정된 작업이 하나도 없습니다.");
    expect(reasons[1]).toHaveTextContent("사용자가 따라 할 확인 절차가 없거나 그대로 쓸 수 없습니다.");
  });

  it("names the architect for a stalled preparation and the developer for blocked development", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith([], [], [
      testGroup({ id: "GROUP-A", title: "검색 개편", displayStatus: "preparing_stalled", sourceSpecId: "SPEC-A", sourceDecisionId: "DECISION-A" }),
      testGroup({ id: "GROUP-B", fileName: "GROUP-B.md", title: "알림 재설계", displayStatus: "blocked", sourceSpecId: "SPEC-B", sourceDecisionId: "DECISION-B" }),
    ])} />);

    const notes = screen.getAllByRole("note", { name: "상태 설명" });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toHaveTextContent("아키텍트가 이어서 구성을 마칩니다.");
    expect(notes[0]).toHaveTextContent("지금 사용자가 할 일은 없습니다.");
    expect(notes[1]).toHaveTextContent("개발이 막혀 다음 작업으로 넘어가지 못하고 있습니다.");
    expect(notes[1]).toHaveTextContent("개발자가 막힌 곳을 풀어 갑니다.");
  });

  it("leaves a qa-ready group with its entry alone and adds no attention note", () => {
    const items = [laneTask("TASK-210", "verified", "SPEC-A", { workGroupId: "GROUP-A", workGroupRevision: 2 })];
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith(items, [], [
      testGroup({ revision: 2, displayStatus: "qa_ready" }),
    ])} />);

    expect(screen.getByRole("button", { name: "품질 확인 시작 →" })).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "상태 설명" })).not.toBeInTheDocument();
    expect(screen.queryByText(/지금 사용자가 할 일은 없습니다/)).not.toBeInTheDocument();
  });

  it("keeps the group on the board when no reason came down with the status", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith([], [], [
      testGroup({ title: "카드 등록", displayStatus: "configuration_error" }),
    ])} />);

    const note = screen.getByRole("note", { name: "상태 설명" });
    expect(screen.getByText("카드 등록")).toBeInTheDocument();
    expect(screen.getByText("구성 확인 필요")).toBeInTheDocument();
    expect(within(note).getByText(/아키텍트가 구성을 다시 맞춥니다/)).toBeInTheDocument();
    expect(within(note).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows what the user has to judge, and only the fact when nothing was written", () => {
    const view = render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith([], [], [
      testGroup({
        title: "카드 등록",
        displayStatus: "human_judgment_required",
        configurationIssues: ["task_link_mismatch"],
        humanJudgmentNote: "작업 둘이 서로 다른 구성 버전을 가리켜 어느 쪽을 살릴지 정해야 합니다.",
      }),
    ])} />);

    const note = screen.getByRole("note", { name: "상태 설명" });
    expect(within(note).getByText(/사용자가 판단할 차례입니다/)).toBeInTheDocument();
    expect(within(note).getByText(/어느 쪽을 살릴지 정해야 합니다/)).toBeInTheDocument();
    expect(within(note).getByText("판단할 내용")).toBeInTheDocument();

    view.rerender(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith([], [], [
      testGroup({ title: "카드 등록", displayStatus: "human_judgment_required", humanJudgmentNote: "  " }),
    ])} />);

    const empty = screen.getByRole("note", { name: "상태 설명" });
    expect(screen.getByText("사람 판단 필요")).toBeInTheDocument();
    expect(within(empty).getByText(/사용자가 판단할 차례입니다/)).toBeInTheDocument();
    expect(within(empty).queryByText("판단할 내용")).not.toBeInTheDocument();
  });

  it("keeps the note a reading place, not a quality-check entry", () => {
    render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith([], [], [
      testGroup({ displayStatus: "configuration_error", configurationIssues: ["metadata_invalid"] }),
    ])} />);

    const note = screen.getByRole("note", { name: "상태 설명" });
    expect(within(note).queryByRole("button")).not.toBeInTheDocument();
    expect(within(note).queryByRole("link")).not.toBeInTheDocument();
    expect(note.querySelector(".task-lane-signal, .status-pill, .task-lane-qa-entry")).toBeNull();
    expect(screen.queryByRole("button", { name: "품질 확인 시작 →" })).not.toBeInTheDocument();
  });

  it("keeps internal status and reason names out of the words on screen", () => {
    const view = render(<DevelopmentBoard onOpenQa={vi.fn()} onReadTask={taskReader()} workflow={workflowWith([], [], [
      testGroup({
        displayStatus: "configuration_error",
        configurationIssues: ["metadata_invalid", "tasks_missing", "task_link_mismatch", "user_scenario_unusable", "automatic_scenario_present", "task_not_verified"],
      }),
    ])} />);

    const shown = view.container.textContent ?? "";
    for (const name of internalNames) expect(shown).not.toContain(name);
  });
});
