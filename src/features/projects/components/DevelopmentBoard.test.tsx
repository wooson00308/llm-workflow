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
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith()} />);

    expect(screen.getByRole("region", { name: "GROUP-DEFAULT 칸반 보드" })).toBeInTheDocument();
    expect(screen.getByText("파서 구현")).toBeInTheDocument();
    expect(screen.getAllByText("사용자 QA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("진행 중").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI 검증 완료").length).toBeGreaterThan(0);
  });

  it("shares search and status filters across view modes", () => {
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith()} />);

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
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const timeline = screen.getByRole("region", { name: "개발 작업 타임라인" });
    expect(within(dayCell(timeline, todayKey)).getByText("시작")).toBeInTheDocument();
  });

  it("drops the due_at placement wording from the timeline header", () => {
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith()} />);
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
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(cell.querySelectorAll(".calendar-count")).toHaveLength(2);
    expect(within(cell).getByText("시작").parentElement).toHaveTextContent("시작3");
    expect(within(cell).getByText("AI 검증 완료").parentElement).toHaveTextContent("AI 검증 완료3");
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
    render(<DevelopmentBoard onReadTask={taskReader(verified[0])} workflow={workflowWith(verified)} />);

    expect(screen.getByText("4개 표시")).toBeInTheDocument();
    expect(screen.getByText("검증 완료 작업 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(within(cell).getByText("AI 검증 완료").parentElement).toHaveTextContent("AI 검증 완료4");
    expect(screen.getByText("4개 표시 · 전체 이력 표시")).toBeInTheDocument();
  });

  it("narrows timeline events with the shared search and status filters", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T01:00:00Z` }] },
      { ...tasks[1], dueAt: null, events: [{ kind: "verified", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const cell = () => dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(cell().querySelectorAll(".calendar-count")).toHaveLength(2);

    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "verified" } });
    expect(within(cell()).getByText("AI 검증 완료")).toBeInTheDocument();
    expect(within(cell()).queryByText("시작")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "파서" } });
    expect(within(cell()).getByText("시작")).toBeInTheDocument();
    expect(within(cell()).queryByText("AI 검증 완료")).not.toBeInTheDocument();
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
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
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
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const timeline = screen.getByRole("region", { name: "개발 작업 타임라인" });
    expect(within(dayCell(timeline, localKey)).getByText("AI 검증 완료")).toBeInTheDocument();
    if (localKey !== todayKey) {
      expect(within(dayCell(timeline, todayKey)).queryByText("AI 검증 완료")).not.toBeInTheDocument();
    }
  });

  it("opens a day's events in time order with the task id, title and kind", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "qa_waiting", at: `${todayKey}T08:00:00Z` }] },
      { ...tasks[1], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
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
    render(<DevelopmentBoard onReadTask={onReadTask} workflow={workflowWith(items)} />);
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
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
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
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
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
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
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
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 2건` }));

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("clears the day selection when the month changes", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 1건` }));
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
  });

  it("reports tasks that never reach the timeline and drops the notice once they do", () => {
    const withEvents: WorkflowItemSummary = { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] };
    const view = render(
      <DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith([withEvents, { ...tasks[1], dueAt: null }])} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    expect(screen.getByText("기록이 없어 타임라인에 표시되지 않는 작업 1건")).toBeInTheDocument();

    view.rerender(
      <DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith([withEvents])} />,
    );
    expect(screen.queryByText(/기록이 없어 타임라인에 표시되지 않는 작업/)).not.toBeInTheDocument();
  });

  it("tells an empty month apart from a month emptied by filters", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items)} />);
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
    ["todo", "AI 작업 준비 중", "AI가 아직 이 작업을 시작하지 않았습니다."],
    ["in_progress", "AI가 작업하고 있습니다", "사용자가 따로 실행할 절차는 없습니다."],
    ["blocked", "AI 작업이 잠시 멈췄습니다", "내부 확인과 복구는 AI가 맡습니다."],
    ["verified", "구현과 자동검증을 마쳤습니다", "작업 그룹 전체가 품질 확인에 올라옵니다."],
  ])("explains the %s state without asking the user to run internal checks", async (status, heading, description) => {
    const item = { ...tasks[0], status };
    render(<DevelopmentBoard onReadTask={taskReader(item)} workflow={workflowWith([item])} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    const verification = await screen.findByRole("region", { name: "AI 자동검증 상태" });
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
    render(<DevelopmentBoard onReadTask={taskReader(item)} workflow={workflowWith([item], [], [group])} />);

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
    render(<DevelopmentBoard onReadTask={onReadTask} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));
    await screen.findByRole("region", { name: "AI 자동검증 상태" });

    expect(screen.queryByText(/npx vitest/)).not.toBeInTheDocument();
    expect(screen.queryByText("TASK-404")).not.toBeInTheDocument();
    expect(screen.queryByText("TASK-999")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /원문|수정 요청|다시 열기/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: /검증 패널/ })).not.toBeInTheDocument();
  });

  it.each([
    ["missing group", { ...tasks[0], workGroupId: "GROUP-404" }],
    ["future group revision", { ...tasks[0], workGroupRevision: 2 }],
    ["different source spec", { ...tasks[0], sourceSpecId: "SPEC-OTHER" }],
    ["different source decision", { ...tasks[0], sourceDecisionId: "DECISION-OTHER" }],
  ])("marks a %s as needing group confirmation", async (_case, item) => {
    render(<DevelopmentBoard onReadTask={taskReader(item)} workflow={workflowWith([tasks[0]])} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    const groupPanel = await screen.findByRole("region", { name: "소속 작업 그룹" });
    expect(within(groupPanel).getByRole("heading", { name: "소속 그룹 확인 필요" })).toBeInTheDocument();
  });

  it("does not expose technical excerpts on task cards or the flat list", () => {
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith()} />);

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
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items, [], [
      testGroup({ id: "GROUP-A", title: "카드 등록", displayStatus: "developing" }),
    ])} />);

    expect(screen.getByRole("region", { name: "GROUP-A 칸반 보드" })).toBeInTheDocument();
    expect(screen.getByText("카드 등록")).toBeInTheDocument();
    expect(screen.getByText("GROUP-A · 구성 버전 1")).toBeInTheDocument();
    expect(screen.getByText("개발 중")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "평면 태스크 보기" })).not.toHaveAttribute("aria-pressed");
  });

  it("shows architect preparation before any task exists", () => {
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith([], [], [
      testGroup({ status: "preparing", displayStatus: "preparing", title: "검색 개편" }),
    ])} />);

    expect(screen.getByText("검색 개편")).toBeInTheDocument();
    expect(screen.getByText("아키텍트 구성 중")).toBeInTheDocument();
    expect(screen.getByText("아키텍트가 작업 구성을 작성 중입니다.")).toBeInTheDocument();
  });

  it("distinguishes a stopped architect preparation from ordinary development", () => {
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith([], [], [
      testGroup({ status: "preparing", displayStatus: "preparing_stalled", title: "검색 개편" }),
    ])} />);

    expect(screen.getByText("구성 중단 의심")).toBeInTheDocument();
  });

  it("keeps user QA controls out of the development board", () => {
    const items = [laneTask("TASK-201", "verified", "SPEC-A", { workGroupId: "GROUP-A", workGroupRevision: 2 })];
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items, [], [
      testGroup({ revision: 2, displayStatus: "qa_ready", scenarios: [{ id: "QA-01", title: "카드 확인", body: "카드를 확인한다." }] }),
    ])} />);

    expect(screen.getByText("사용자 QA 대기")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /QA 시작|품질 확인 열기|도장/ })).not.toBeInTheDocument();
  });

  it("switches to the flat task board only as a secondary view", () => {
    const items = [laneTask("TASK-301", "todo", "SPEC-A", { workGroupId: "GROUP-A", workGroupRevision: 1 })];
    render(<DevelopmentBoard onReadTask={taskReader()} workflow={workflowWith(items, [], [testGroup()])} />);

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
    const first = render(<DevelopmentBoard onReadTask={taskReader()} workflow={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "GROUP-A 레인 접기" }));
    first.unmount();

    render(<DevelopmentBoard onReadTask={taskReader()} workflow={summary} />);
    expect(screen.queryByRole("region", { name: "GROUP-A 칸반 보드" })).not.toBeInTheDocument();
    expect(JSON.parse(stored.get(LANE_COLLAPSE_KEY) ?? "{}")["feature--wf_1"]["GROUP-A"]).toBe(true);
  });
});
