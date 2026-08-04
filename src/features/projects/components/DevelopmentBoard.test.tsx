import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskDependency, WorkflowItemSummary, WorkflowSummary } from "../domain/types";
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
afterEach(() => vi.unstubAllGlobals());

const tasks: WorkflowItemSummary[] = [
  { fileName: "TASK-001.md", id: "TASK-001", title: "파서 구현", status: "in_progress", updatedAt: "2026-07-30T09:00:00Z", dueAt: todayKey, excerpt: "문서 상태를 읽는다." },
  { fileName: "TASK-002.md", id: "TASK-002", title: "사용자 QA", status: "qa_waiting", updatedAt: "2026-07-30T08:00:00Z", dueAt: null, excerpt: "실제 흐름을 확인한다." },
];

// 확인 사실 10의 실제 재현 데이터. TASK-049 요약문 원문이고 33자 무공백 런이 그대로 들어 있다.
// 이 런을 접게 하는 CSS 선언 자체는 `boardCardOverflow.test.ts`가 확인한다.
const overflowRun = "(`HeartbeatCard.tsx:246`~`:252`).";
const overflowExcerpt = `SPEC-016 R2·R4·R7·R8·R9·R10·R11을 구현한다. TASK-048이 스냅샷에 실어 둔 단계 목록을 화면이 처음으로 읽는다. 지금 안내는 명령 두 줄이고 미설치 분기에만 붙어 있다${overflowRun}`;

function workflowWith(items: WorkflowItemSummary[] = tasks): WorkflowSummary {
  return {
    id: "wf_1",
    directory: "feature--wf_1",
    name: "Feature",
    status: "active",
    createdAt: "2026-07-30T00:00:00Z",
    counts: { ideas: 0, specs: 0, decisions: 0, tasks: items.length, reports: 0 },
    items: { ideas: [], specs: [], tasks: items },
  };
}

function taskReader(item: WorkflowItemSummary = tasks[1]) {
  return vi.fn().mockResolvedValue({
    summary: item,
    body: `# ${item.title}\n\n## 작업 범위\n\n${item.excerpt}`,
  });
}

function dependencyReader(dependencies: TaskDependency[], dependencyFormatError = false) {
  const item = tasks[0];
  return vi.fn().mockResolvedValue({
    summary: item,
    body: `# ${item.title}`,
    dependencies,
    dependencyFormatError,
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
    ...extra,
  };
}

/** 묶기를 켠 보드를 그린다. 레인 검사가 전부 이 상태에서 시작한다. */
function renderLanes(workflow: WorkflowSummary) {
  const view = render(
    <DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflow} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "기획서별 묶기" }));
  return view;
}

/** 레인 하나를 그 안 보드의 region 이름으로 집는다. */
function laneOf(container: HTMLElement, label: string) {
  const lane = within(container).getByRole("region", { name: label }).closest(".task-lane");
  if (!lane) throw new Error(`${label} 레인을 찾지 못했습니다.`);
  return lane as HTMLElement;
}

function laneCountsOf(container: HTMLElement, label: string) {
  return laneOf(container, label).querySelector(".task-lane-counts");
}

async function openDependencyDetail(dependencies: TaskDependency[], dependencyFormatError = false) {
  render(
    <DevelopmentBoard
      busy={false}
      onReadTask={dependencyReader(dependencies, dependencyFormatError)}
      onTaskQa={vi.fn()}
      workflow={workflowWith()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));
  return await screen.findByRole("region", { name: "선행 작업" });
}

describe("DevelopmentBoard", () => {
  it("groups development tasks by their actual status", () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith()} />);

    expect(screen.getByRole("region", { name: "개발 작업 칸반 보드" })).toBeInTheDocument();
    expect(screen.getByText("파서 구현")).toBeInTheDocument();
    expect(screen.getAllByText("사용자 QA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("진행 중").length).toBeGreaterThan(0);
    expect(screen.getAllByText("QA 대기").length).toBeGreaterThan(0);
  });

  it("carries the recorded overflow excerpt all the way onto a board card", () => {
    // jsdom은 레이아웃을 계산하지 않으므로 이 시나리오가 보장하는 것은 "이 데이터가 카드에 실린다"까지다.
    // 상자 크기를 묻지 않는다 — 물으면 전부 0이 돌아와 통과하는 것처럼 보이는 거짓 검사가 된다.
    const items: WorkflowItemSummary[] = [{ ...tasks[1], excerpt: overflowExcerpt }];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);

    const card = screen.getByRole("button", { name: /사용자 QA/ });
    expect(card.querySelector("p")).toHaveTextContent(overflowRun);
  });

  it("shares search and status filters across view modes", () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "파서" } });
    expect(screen.getByText("파서 구현")).toBeInTheDocument();
    expect(screen.queryByText("사용자 QA")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "리스트" }));
    const list = screen.getByRole("region", { name: "개발 작업 리스트" });
    expect(within(list).getByText("파서 구현")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "qa_waiting" } });
    expect(within(list).getByText("사용자 QA")).toBeInTheDocument();
    expect(within(list).queryByText("파서 구현")).not.toBeInTheDocument();
  });

  it("places tasks on the timeline by transition time instead of due_at", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T04:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const timeline = screen.getByRole("region", { name: "개발 작업 타임라인" });
    expect(within(dayCell(timeline, todayKey)).getByText("시작")).toBeInTheDocument();
  });

  it("drops the due_at placement wording from the timeline header", () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith()} />);
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
      status: "qa_waiting",
      updatedAt: `${todayKey}T00:00:00Z`,
      dueAt: null,
      excerpt: "",
      events: [
        { kind: "in_progress", at: `${todayKey}T01:00:00Z` },
        { kind: "qa_waiting", at: `${todayKey}T02:00:00Z` },
      ],
    }));
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(cell.querySelectorAll(".calendar-count")).toHaveLength(2);
    expect(within(cell).getByText("시작").parentElement).toHaveTextContent("시작3");
    expect(within(cell).getByText("QA 대기").parentElement).toHaveTextContent("QA 대기3");
  });

  it("keeps every completed task on the timeline while the board still truncates", () => {
    const completed = [1, 2, 3, 4].map((day) => ({
      fileName: `TASK-00${day}.md`,
      id: `TASK-00${day}`,
      title: `완료 작업 ${day}`,
      status: "completed",
      updatedAt: `2026-07-0${day}T00:00:00Z`,
      dueAt: null,
      excerpt: "",
      events: [{ kind: "completed", at: `${todayKey}T05:00:00Z` }],
    }));
    render(<DevelopmentBoard busy={false} onReadTask={taskReader(completed[0])} onTaskQa={vi.fn()} workflow={workflowWith(completed)} />);

    expect(screen.getByText("3개 표시 · 완료는 최근 3개만 표시")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(within(cell).getByText("완료").parentElement).toHaveTextContent("완료4");
    expect(screen.getByText("4개 표시 · 완료 작업까지 전부 표시")).toBeInTheDocument();
    expect(screen.queryByText(/완료는 최근 3개만 표시/)).not.toBeInTheDocument();
  });

  it("narrows timeline events with the shared search and status filters", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T01:00:00Z` }] },
      { ...tasks[1], dueAt: null, events: [{ kind: "qa_waiting", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const cell = () => dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(cell().querySelectorAll(".calendar-count")).toHaveLength(2);

    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "qa_waiting" } });
    expect(within(cell()).getByText("QA 대기")).toBeInTheDocument();
    expect(within(cell()).queryByText("시작")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "파서" } });
    expect(within(cell()).getByText("시작")).toBeInTheDocument();
    expect(within(cell()).queryByText("QA 대기")).not.toBeInTheDocument();
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
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(cell.querySelectorAll(".calendar-count")).toHaveLength(1);
    expect(within(cell).getByText("막힘")).toBeInTheDocument();
  });

  it("groups events by the local date of the transition instant", () => {
    const at = `${todayKey}T23:00:00Z`;
    const localKey = localDateKeyOf(at);
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "completed", at }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
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
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 2건` }));

    const entries = screen.getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("시작");
    expect(entries[0]).toHaveTextContent("TASK-002");
    expect(entries[0]).toHaveTextContent("사용자 QA");
    expect(entries[1]).toHaveTextContent("QA 대기");
    expect(entries[1]).toHaveTextContent("TASK-001");
    expect(entries[1]).toHaveTextContent("파서 구현");
  });

  it("opens the task detail from a timeline event entry", async () => {
    const onReadTask = taskReader(tasks[0]);
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "blocked", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={onReadTask} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
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
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
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
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
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
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
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
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 2건` }));

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("clears the day selection when the month changes", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 1건` }));
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
  });

  it("reports tasks that never reach the timeline and drops the notice once they do", () => {
    const withEvents: WorkflowItemSummary = { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] };
    const view = render(
      <DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith([withEvents, { ...tasks[1], dueAt: null }])} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    expect(screen.getByText("기록이 없어 타임라인에 표시되지 않는 작업 1건")).toBeInTheDocument();

    view.rerender(
      <DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith([withEvents])} />,
    );
    expect(screen.queryByText(/기록이 없어 타임라인에 표시되지 않는 작업/)).not.toBeInTheDocument();
  });

  it("tells an empty month apart from a month emptied by filters", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    expect(screen.queryByText("이 달에 기록된 전이가 없습니다.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.getByText("이 달에 기록된 전이가 없습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "오늘" }));
    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "없는작업" } });
    expect(screen.getByText("필터 조건에 맞는 기록이 이 달에 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("이 달에 기록된 전이가 없습니다.")).not.toBeInTheDocument();
  });

  it("keeps only the three most recently completed tasks in development", () => {
    const completed = [1, 2, 3, 4].map((day) => ({
      fileName: `TASK-00${day}.md`,
      id: `TASK-00${day}`,
      title: `완료 작업 ${day}`,
      status: "completed",
      updatedAt: `2026-07-0${day}T00:00:00Z`,
      dueAt: null,
      excerpt: "",
    }));
    render(<DevelopmentBoard busy={false} onReadTask={taskReader(completed[0])} onTaskQa={vi.fn()} workflow={workflowWith(completed)} />);

    expect(screen.getByText("완료 작업 4")).toBeInTheDocument();
    expect(screen.getByText("완료 작업 3")).toBeInTheDocument();
    expect(screen.getByText("완료 작업 2")).toBeInTheDocument();
    expect(screen.queryByText("완료 작업 1")).not.toBeInTheDocument();
  });

  it("lets the user confirm a QA waiting task", async () => {
    const onTaskQa = vi.fn().mockResolvedValue(true);
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={onTaskQa} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /사용자 QA/ }));
    await screen.findByLabelText("테스트 플로우와 확인 메모");
    fireEvent.change(screen.getByLabelText("테스트 플로우와 확인 메모"), {
      target: { value: "앱 실행 → 설정 열기 → 정상 표시 확인" },
    });

    fireEvent.click(screen.getByRole("button", { name: "확인 완료" }));
    expect(onTaskQa).not.toHaveBeenCalled();
    expect(screen.getByText("이 작업을 완료 처리합니다. 되돌릴 수 없습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "한 번 더 누르면 완료" }));
    await waitFor(() => expect(onTaskQa).toHaveBeenCalledWith("TASK-002.md", "confirmed", "앱 실행 → 설정 열기 → 정상 표시 확인"));
    expect(screen.getByRole("heading", { name: "개발 작업" })).toBeInTheDocument();
  });

  it("returns the confirm button to a safe state when not clicked again in time", async () => {
    const onTaskQa = vi.fn().mockResolvedValue(true);
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={onTaskQa} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /사용자 QA/ }));
    await screen.findByLabelText("테스트 플로우와 확인 메모");

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "확인 완료" }));
      expect(screen.getByRole("button", { name: "한 번 더 누르면 완료" })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(3_600);
      });
      expect(screen.getByRole("button", { name: "확인 완료" })).toBeInTheDocument();
      expect(onTaskQa).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires guidance when QA requests development changes", async () => {
    const onTaskQa = vi.fn().mockResolvedValue(true);
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={onTaskQa} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /사용자 QA/ }));
    await screen.findByLabelText("테스트 플로우와 확인 메모");
    const submit = screen.getByRole("button", { name: "수정 요청" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("테스트 플로우와 확인 메모"), {
      target: { value: "빈 상태에서 다시 확인해 주세요." },
    });

    fireEvent.click(submit);
    expect(onTaskQa).not.toHaveBeenCalled();
    expect(screen.getByText("작업을 개발 준비로 되돌리고 수정 요청을 기록합니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "한 번 더 누르면 수정 요청" }));
    await waitFor(() =>
      expect(onTaskQa).toHaveBeenCalledWith(
        "TASK-002.md",
        "revision_requested",
        "빈 상태에서 다시 확인해 주세요.",
      ),
    );
  });

  it("resizes the QA side panel and remembers the width", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /사용자 QA/ }));
    const handle = await screen.findByRole("separator", { name: "QA 패널 너비 조절" });
    expect(handle).toHaveAttribute("aria-valuenow", "340");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "364");
    expect(storage.get("llm-workflow.task-qa-panel-width")).toBe("364");

    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute("aria-valuenow", "340");
  });

  it("opens a non-QA card as a read-only detail page", async () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader(tasks[0])} onTaskQa={vi.fn()} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    await screen.findByRole("button", { name: "← 개발 작업으로" });
    expect(screen.getByText("문서 상태를 읽는다.")).toBeInTheDocument();
    expect(screen.queryByLabelText("테스트 플로우와 확인 메모")).not.toBeInTheDocument();
    expect(screen.getByText("QA 대기 상태가 되면 확인 도구가 활성화됩니다.")).toBeInTheDocument();
  });

  // 이 검사가 막는 것은 지금의 결함이 아니라 개행 표시가 이 화면까지 조용히 넓어지는 일이다.
  // DECISION-6F1B8C53의 승인된 확인 필요 1번이 적용 범위를 아이디어 문서뷰 한 곳으로 정했다.
  it("leaves a soft line break unbroken in the task detail", async () => {
    const body = ["첫 줄은 배경이다.", "둘째 줄은 원인이다."].join("\n");
    const onReadTask = vi.fn().mockResolvedValue({ summary: tasks[0], body });
    const { container } = render(
      <DevelopmentBoard busy={false} onReadTask={onReadTask} onTaskQa={vi.fn()} workflow={workflowWith()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    await screen.findByRole("button", { name: "← 개발 작업으로" });
    const paragraphs = container.querySelectorAll(".markdown-body p");
    expect(paragraphs).toHaveLength(1);
    expect(container.querySelectorAll(".markdown-body br")).toHaveLength(0);
    expect(paragraphs[0]).toHaveTextContent("첫 줄은 배경이다.");
    expect(paragraphs[0]).toHaveTextContent("둘째 줄은 원인이다.");
  });

  it("leaves the detail untouched when a task declares no dependency", async () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader(tasks[0])} onTaskQa={vi.fn()} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    await screen.findByRole("button", { name: "← 개발 작업으로" });
    expect(screen.queryByRole("region", { name: "선행 작업" })).not.toBeInTheDocument();
  });

  it("reads every declared dependency as ready when all are satisfied", async () => {
    const block = await openDependencyDetail([
      { id: "TASK-100", state: "satisfied" },
      { id: "TASK-101", state: "satisfied" },
    ]);

    expect(within(block).getByText("TASK-100")).toBeInTheDocument();
    expect(within(block).getByText("TASK-101")).toBeInTheDocument();
    expect(within(block).getAllByText("준비됨")).toHaveLength(2);
    expect(within(block).getByText("시작 가능")).toBeInTheDocument();
    expect(within(block).queryByText(/시간이 지나도 풀리지 않습니다/)).not.toBeInTheDocument();
  });

  it("tells a satisfied dependency apart from a pending one", async () => {
    const block = await openDependencyDetail([
      { id: "TASK-100", state: "satisfied" },
      { id: "TASK-101", state: "pending" },
    ]);

    expect(within(block).getByText("TASK-100").parentElement).toHaveTextContent("준비됨");
    expect(within(block).getByText("TASK-101").parentElement).toHaveTextContent("대기 중");
    expect(within(block).getByText("시작할 수 없음")).toBeInTheDocument();
    expect(within(block).queryByText(/시간이 지나도 풀리지 않습니다/)).not.toBeInTheDocument();
  });

  it("marks a missing dependency id as never satisfied", async () => {
    const block = await openDependencyDetail([{ id: "TASK-404", state: "missing" }]);

    expect(within(block).getByText("TASK-404").parentElement).toHaveTextContent("없는 작업");
    expect(within(block).getByText("시작할 수 없음")).toBeInTheDocument();
    expect(
      within(block).getByText("이 선언은 시간이 지나도 풀리지 않습니다. 작업 문서의 선행 선언을 고쳐야 합니다."),
    ).toBeInTheDocument();
  });

  it("marks a cyclic declaration as never satisfied and apart from a missing id", async () => {
    const block = await openDependencyDetail([{ id: "TASK-100", state: "cyclic" }]);

    expect(within(block).getByText("TASK-100").parentElement).toHaveTextContent("순환 선언");
    expect(within(block).queryByText("없는 작업")).not.toBeInTheDocument();
    expect(
      within(block).getByText("이 선언은 시간이 지나도 풀리지 않습니다. 작업 문서의 선행 선언을 고쳐야 합니다."),
    ).toBeInTheDocument();
  });

  it("reports a broken declaration without inventing the list it could not read", async () => {
    const block = await openDependencyDetail([], true);

    expect(within(block).getByText("선행 선언의 형식이 잘못되어 목록으로 읽지 못했습니다.")).toBeInTheDocument();
    expect(block.querySelectorAll(".task-dependency")).toHaveLength(0);
    expect(within(block).getByText("시작할 수 없음")).toBeInTheDocument();
    expect(
      within(block).getByText("이 선언은 시간이 지나도 풀리지 않습니다. 작업 문서의 선행 선언을 고쳐야 합니다."),
    ).toBeInTheDocument();
  });

  it("keeps the declared order instead of sorting the dependencies", async () => {
    const block = await openDependencyDetail([
      { id: "TASK-900", state: "pending" },
      { id: "TASK-100", state: "satisfied" },
      { id: "TASK-500", state: "missing" },
    ]);

    const ids = [...block.querySelectorAll(".task-dependency > strong")].map((entry) => entry.textContent);
    expect(ids).toEqual(["TASK-900", "TASK-100", "TASK-500"]);
  });

  it("splits the board into lanes by the source spec of each task", () => {
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-001"), laneTask("TASK-202", "qa_waiting", "SPEC-002")];
    const { container } = renderLanes(workflowWith(items));

    const first = laneOf(container, "SPEC-001 칸반 보드");
    const second = laneOf(container, "SPEC-002 칸반 보드");
    expect(within(first).getByText("TASK-201 작업")).toBeInTheDocument();
    expect(within(first).queryByText("TASK-202 작업")).not.toBeInTheDocument();
    expect(within(second).getByText("TASK-202 작업")).toBeInTheDocument();
  });

  it("starts with grouping off and returns the plain board when it is turned off again", () => {
    const { container } = render(
      <DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith()} />,
    );

    const toggle = screen.getByRole("button", { name: "기획서별 묶기" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("region", { name: "개발 작업 칸반 보드" })).toBeInTheDocument();
    expect(container.querySelectorAll(".task-lane")).toHaveLength(0);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll(".task-lane").length).toBeGreaterThan(0);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("region", { name: "개발 작업 칸반 보드" })).toBeInTheDocument();
    expect(container.querySelectorAll(".task-lane")).toHaveLength(0);
    expect(screen.getByText("파서 구현")).toBeInTheDocument();
    expect(screen.queryByText(/레인의 수치와 QA 신호는/)).not.toBeInTheDocument();
  });

  it("names the spec behind a lane and falls back to the bare id when the spec is unknown", () => {
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-001"), laneTask("TASK-202", "qa_waiting", "SPEC-777")];
    const base = workflowWith(items);
    const workflow: WorkflowSummary = {
      ...base,
      items: {
        ...base.items,
        specs: [
          {
            fileName: "SPEC-001.md",
            id: "SPEC-001",
            title: "레인 기획",
            status: "user_review",
            updatedAt: "2026-08-01T00:00:00Z",
            excerpt: "",
          },
        ],
      },
    };
    const { container } = renderLanes(workflow);

    const known = laneOf(container, "SPEC-001 칸반 보드").querySelector(".task-lane-header");
    expect(known).toHaveTextContent("레인 기획");
    expect(known).toHaveTextContent("SPEC-001");

    const unknown = laneOf(container, "SPEC-777 칸반 보드").querySelector(".task-lane-header");
    expect(unknown?.querySelector("strong")).toHaveTextContent("SPEC-777");
    expect(unknown?.querySelectorAll("small")).toHaveLength(0);
  });

  it("breaks the lane header count down by status instead of one percentage", () => {
    const items = [
      laneTask("TASK-201", "todo", "SPEC-001"),
      laneTask("TASK-202", "qa_waiting", "SPEC-001"),
      laneTask("TASK-203", "qa_waiting", "SPEC-001"),
    ];
    const { container } = renderLanes(workflowWith(items));

    const counts = laneCountsOf(container, "SPEC-001 칸반 보드");
    expect(counts).toHaveTextContent("전체 기준");
    expect(counts).toHaveTextContent("준비 1");
    expect(counts).toHaveTextContent("진행 중 0");
    expect(counts).toHaveTextContent("막힘 0");
    expect(counts).toHaveTextContent("QA 대기 2");
    expect(counts).toHaveTextContent("완료 0");
    expect(container.textContent).not.toContain("%");
  });

  it("lights the lane signal only when nothing but QA waiting is left", () => {
    const items = [
      laneTask("TASK-201", "qa_waiting", "SPEC-001"),
      laneTask("TASK-202", "qa_waiting", "SPEC-002"),
      laneTask("TASK-203", "todo", "SPEC-002"),
    ];
    const { container } = renderLanes(workflowWith(items));

    expect(within(laneOf(container, "SPEC-001 칸반 보드")).getByText("QA 대기만 남음 · 통째로 QA 가능")).toBeInTheDocument();
    expect(
      within(laneOf(container, "SPEC-002 칸반 보드")).queryByText("QA 대기만 남음 · 통째로 QA 가능"),
    ).not.toBeInTheDocument();
  });

  it("keeps a todo hidden by the status filter from lighting the lane signal", () => {
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-002"), laneTask("TASK-202", "todo", "SPEC-002")];
    const { container } = renderLanes(workflowWith(items));
    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "qa_waiting" } });

    const lane = laneOf(container, "SPEC-002 칸반 보드");
    expect(within(lane).queryByText("TASK-202 작업")).not.toBeInTheDocument();
    expect(lane.querySelector(".task-lane-counts")).toHaveTextContent("준비 1");
    expect(within(lane).queryByText("QA 대기만 남음 · 통째로 QA 가능")).not.toBeInTheDocument();
  });

  it("counts every completed task in the header while the board still truncates the cards", () => {
    const items = [1, 2, 3, 4].map((day) =>
      laneTask(`TASK-30${day}`, "completed", "SPEC-003", { updatedAt: `2026-07-0${day}T00:00:00Z` }),
    );
    const { container } = renderLanes(workflowWith(items));

    // 헤더는 전체 4건을 말하고 카드는 절단된 3장만 보인다. 이 어긋남이 정상이다.
    const lane = laneOf(container, "SPEC-003 칸반 보드");
    expect(lane.querySelector(".task-lane-counts")).toHaveTextContent("완료 4");
    expect(lane.querySelectorAll(".task-card")).toHaveLength(3);
  });

  it("keeps tasks without a source spec in an unassigned lane and never signals it", () => {
    const items = [laneTask("TASK-201", "qa_waiting", null), laneTask("TASK-202", "qa_waiting", "SPEC-001")];
    const { container } = renderLanes(workflowWith(items));

    const lane = laneOf(container, "미분류 칸반 보드");
    expect(within(lane).getByText("TASK-201 작업")).toBeInTheDocument();
    expect(lane.querySelector(".task-lane-header")).toHaveTextContent("미분류");
    expect(lane.querySelector(".task-lane-counts")).toHaveTextContent("QA 대기 1");
    expect(within(lane).queryByText("QA 대기만 남음 · 통째로 QA 가능")).not.toBeInTheDocument();
  });

  it("drops a lane with no card left and says how many lanes went missing", () => {
    const items = [
      laneTask("TASK-401", "completed", "SPEC-004", { updatedAt: "2026-07-01T00:00:00Z" }),
      laneTask("TASK-501", "completed", "SPEC-005", { updatedAt: "2026-07-05T00:00:00Z" }),
      laneTask("TASK-502", "completed", "SPEC-005", { updatedAt: "2026-07-06T00:00:00Z" }),
      laneTask("TASK-503", "completed", "SPEC-005", { updatedAt: "2026-07-07T00:00:00Z" }),
    ];
    const { container } = renderLanes(workflowWith(items));

    expect(container.querySelectorAll(".task-lane")).toHaveLength(1);
    expect(screen.getByText("완료만 있어 표시하지 않은 기획서 1개")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "TASK-501" } });
    expect(screen.getByText("조건에 맞는 카드가 없어 표시하지 않은 기획서 1개")).toBeInTheDocument();
    expect(screen.queryByText("완료만 있어 표시하지 않은 기획서 1개")).not.toBeInTheDocument();
  });

  it("puts signalled lanes first, then id order, and the unassigned lane last", () => {
    const items = [
      laneTask("TASK-201", "qa_waiting", null),
      laneTask("TASK-202", "todo", "SPEC-002"),
      laneTask("TASK-203", "qa_waiting", "SPEC-003"),
      laneTask("TASK-204", "qa_waiting", "SPEC-001"),
    ];
    const { container } = renderLanes(workflowWith(items));

    const titles = [...container.querySelectorAll(".task-lane-header strong")].map((entry) => entry.textContent);
    expect(titles).toEqual(["SPEC-001", "SPEC-003", "SPEC-002", "미분류"]);
  });

  it("keeps an off-contract status in the lane count and in the review column", () => {
    const items = [laneTask("TASK-201", "탈락", "SPEC-006"), laneTask("TASK-202", "qa_waiting", "SPEC-006")];
    const { container } = renderLanes(workflowWith(items));

    const lane = laneOf(container, "SPEC-006 칸반 보드");
    expect(lane.querySelector(".task-lane-counts")).toHaveTextContent("규격 밖 1");
    expect(within(lane).getByText("확인 필요")).toBeInTheDocument();
    expect(within(lane).getByText("TASK-201 작업")).toBeInTheDocument();
    expect(within(lane).queryByText("QA 대기만 남음 · 통째로 QA 가능")).not.toBeInTheDocument();
  });
});
