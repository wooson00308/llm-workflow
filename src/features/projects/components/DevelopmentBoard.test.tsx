import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowItemSummary, WorkflowSummary } from "../domain/types";
import { DevelopmentBoard } from "./DevelopmentBoard";

const today = new Date();
const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

afterEach(cleanup);

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

describe("DevelopmentBoard", () => {
  it("groups development tasks by their actual status", () => {
    render(<DevelopmentBoard workflow={workflowWith()} />);

    expect(screen.getByRole("region", { name: "개발 작업 칸반 보드" })).toBeInTheDocument();
    expect(screen.getByText("파서 구현")).toBeInTheDocument();
    expect(screen.getByText("사용자 QA")).toBeInTheDocument();
    expect(screen.getAllByText("진행 중").length).toBeGreaterThan(0);
    expect(screen.getAllByText("QA 대기").length).toBeGreaterThan(0);
  });

  it("shares search and status filters across view modes", () => {
    render(<DevelopmentBoard workflow={workflowWith()} />);

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
    render(<DevelopmentBoard workflow={workflowWith()} />);
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
    render(<DevelopmentBoard workflow={workflowWith(completed)} />);

    expect(screen.getByText("완료 작업 4")).toBeInTheDocument();
    expect(screen.getByText("완료 작업 3")).toBeInTheDocument();
    expect(screen.getByText("완료 작업 2")).toBeInTheDocument();
    expect(screen.queryByText("완료 작업 1")).not.toBeInTheDocument();
  });
});
