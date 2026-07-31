import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowItemSummary, WorkflowSummary } from "../domain/types";
import { DevelopmentBoard } from "./DevelopmentBoard";

const today = new Date();
const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

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

  it("places due tasks on the calendar and preserves unscheduled tasks", () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} workflow={workflowWith()} />);
    fireEvent.click(screen.getByRole("button", { name: "캘린더" }));

    const calendar = screen.getByRole("region", { name: "개발 작업 캘린더" });
    expect(within(calendar).getByText("파서 구현")).toBeInTheDocument();
    expect(within(calendar).getByText("일정 미지정")).toBeInTheDocument();
    expect(within(calendar).getByText("사용자 QA")).toBeInTheDocument();
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
