import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowItemSummary, WorkflowSummary } from "../domain/types";
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

describe("DevelopmentBoard", () => {
  it("groups development tasks by their actual status", () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith()} />);

    expect(screen.getByRole("region", { name: "개발 작업 칸반 보드" })).toBeInTheDocument();
    expect(screen.getByText("파서 구현")).toBeInTheDocument();
    expect(screen.getAllByText("사용자 QA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("진행 중").length).toBeGreaterThan(0);
    expect(screen.getAllByText("QA 대기").length).toBeGreaterThan(0);
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
});
