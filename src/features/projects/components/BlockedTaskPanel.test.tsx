import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import cssText from "./BlockedTaskPanel.css?raw";
import type { BlockedReason } from "../domain/documentSections";
import type { TaskDocument, WorkflowItemSummary, WorkflowSummary } from "../domain/types";
import { BlockedTaskPanel } from "./BlockedTaskPanel";
import { DevelopmentBoard } from "./DevelopmentBoard";

afterEach(cleanup);

const blockedTask: WorkflowItemSummary = {
  fileName: "TASK-100.md",
  id: "TASK-100",
  title: "배포 준비",
  status: "blocked",
  updatedAt: "2026-08-07T15:30:00Z",
  dueAt: null,
  excerpt: "배포 토큰을 기다린다.",
};

const relatedTask: WorkflowItemSummary = {
  fileName: "TASK-101.md",
  id: "TASK-101",
  title: "토큰 발급",
  status: "qa_waiting",
  updatedAt: "2026-08-07T15:20:00Z",
  dueAt: null,
  excerpt: "운영 토큰을 발급한다.",
};

const reason: BlockedReason = {
  blockedPoint: "배포 **토큰**이 없다.",
  requiredResolution: "운영자가 토큰을 발급한다.",
  resumeCondition: "토큰 확인 검사가 통과한다.",
  relatedTargetsRaw: "TASK-101, TASK-없는-작업, 외부 공급자 승인",
  relatedTargets: ["TASK-101", "TASK-없는-작업", "외부 공급자 승인"],
};

function workflow(items: WorkflowItemSummary[]): WorkflowSummary {
  return {
    id: "wf_1",
    directory: "feature--wf_1",
    name: "Feature",
    status: "active",
    createdAt: "2026-08-07T00:00:00Z",
    counts: { ideas: 0, specs: 0, decisions: 0, tasks: items.length, reports: 0 },
    items: { ideas: [], specs: [], tasks: items },
  };
}

function blockedBody(relatedTargets = reason.relatedTargetsRaw) {
  return [
    "# 배포 준비",
    "",
    "## 결정권자 요약",
    "",
    "배포 토큰이 없어 진행을 멈췄다.",
    "",
    "## 막힌 사유",
    "",
    "- 막힌 지점: 배포 **토큰**이 없다.",
    "- 필요한 해결: 운영자가 토큰을 발급한다.",
    "- 재개 조건: 토큰 확인 검사가 통과한다.",
    `- 관련 대상: ${relatedTargets}`,
  ].join("\n");
}

function renderBoard(onReadTask: (fileName: string) => Promise<TaskDocument | null>, items = [blockedTask, relatedTask]) {
  return render(
    <DevelopmentBoard
      busy={false}
      onReadTask={onReadTask}
      onTaskQa={vi.fn()}
      onTaskQaBatch={vi.fn()}
      workflow={workflow(items)}
    />,
  );
}

describe("BlockedTaskPanel", () => {
  it("shows the written values and resolves only exact task ids in their original order", () => {
    const onOpenRelatedTask = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <BlockedTaskPanel
        decisionSummary={null}
        onOpenRelatedTask={onOpenRelatedTask}
        reason={reason}
        tasks={[blockedTask, relatedTask]}
        updatedAt={blockedTask.updatedAt}
      />,
    );

    const panel = screen.getByRole("region", { name: "막힌 작업 상세" });
    expect(within(panel).getByText("작성된 막힘 사유")).toBeInTheDocument();
    expect(within(panel).getByText(/문서 갱신/)).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll(".blocked-task-field > dt"), (node) => node.textContent)).toEqual([
      "막힌 지점",
      "필요한 해결",
      "재개 조건",
      "관련 대상",
    ]);
    expect(within(panel).getByText("토큰")).toBeInTheDocument();

    const targets = Array.from(container.querySelectorAll<HTMLElement>(".blocked-task-targets > li"));
    expect(targets.map((target) => target.textContent)).toEqual([
      expect.stringContaining("TASK-101"),
      expect.stringContaining("TASK-없는-작업"),
      expect.stringContaining("외부 공급자 승인"),
    ]);
    expect(within(targets[0]).getByText("토큰 발급")).toBeInTheDocument();
    expect(within(targets[0]).getByText("현재 상태 QA 대기")).toBeInTheDocument();
    expect(within(targets[1]).queryByRole("button")).not.toBeInTheDocument();
    expect(within(targets[2]).queryByRole("button")).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "TASK-101 토큰 발급 작업 열기" }));
    expect(onOpenRelatedTask).toHaveBeenCalledTimes(1);
    expect(onOpenRelatedTask).toHaveBeenCalledWith(relatedTask);
  });

  it("keeps the explicit no-target value without inventing a link", () => {
    render(
      <BlockedTaskPanel
        decisionSummary={null}
        onOpenRelatedTask={vi.fn()}
        reason={{ ...reason, relatedTargetsRaw: "없음", relatedTargets: [] }}
        tasks={[relatedTask]}
        updatedAt={null}
      />,
    );

    expect(screen.getByText("없음")).toBeInTheDocument();
    expect(screen.getByText("문서 갱신 시각을 확인할 수 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("falls back to the exact decision summary markdown", () => {
    render(
      <BlockedTaskPanel
        decisionSummary={["## 결정권자 요약", "", "**작성된 요약**을 그대로 표시한다."].join("\n")}
        onOpenRelatedTask={vi.fn()}
        reason={null}
        tasks={[]}
        updatedAt={blockedTask.updatedAt}
      />,
    );

    expect(screen.getByText("구조화된 막힘 사유를 읽을 수 없어 작성된 결정권자 요약을 표시합니다.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "결정권자 요약" })).toBeInTheDocument();
    expect(screen.getByText("작성된 요약").tagName).toBe("STRONG");
  });

  it("points to the visible source when neither structured reason nor summary exists", () => {
    render(
      <BlockedTaskPanel
        decisionSummary={null}
        onOpenRelatedTask={vi.fn()}
        reason={null}
        tasks={[]}
        updatedAt={blockedTask.updatedAt}
      />,
    );

    expect(screen.getByText("구조화된 막힘 사유가 없습니다")).toBeInTheDocument();
    expect(screen.getByText("왼쪽 문서에 표시된 원문에서 현재 기록을 확인해 주세요.")).toBeInTheDocument();
  });

  it("keeps a one-column flow and wraps long uninterrupted values", () => {
    expect(cssText).toMatch(/\.blocked-task-fields\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(cssText).toMatch(/\.blocked-task-targets\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(cssText).toContain("overflow-wrap: anywhere");
    expect(cssText).toContain("@media (max-width: 980px)");
  });
});

describe("DevelopmentBoard blocked task detail", () => {
  it("opens an exact related task through the existing reader and replaces the detail only on success", async () => {
    const blockedDocument: TaskDocument = { summary: blockedTask, body: blockedBody() };
    const relatedDocument: TaskDocument = {
      summary: relatedTask,
      body: "# 토큰 발급\n\n## 결정권자 요약\n\n토큰 발급을 검증한다.",
    };
    const onReadTask = vi.fn(async (fileName: string) => (
      fileName === blockedTask.fileName ? blockedDocument : fileName === relatedTask.fileName ? relatedDocument : null
    ));
    renderBoard(onReadTask);

    fireEvent.click(screen.getByRole("button", { name: /배포 준비/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "진행이 막혔습니다" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "TASK-101 토큰 발급 작업 열기" }));

    expect(await screen.findByRole("heading", { level: 1, name: "토큰 발급" })).toBeInTheDocument();
    expect(onReadTask).toHaveBeenCalledTimes(2);
    expect(onReadTask).toHaveBeenNthCalledWith(2, "TASK-101.md");
    expect(screen.queryByRole("heading", { level: 2, name: "진행이 막혔습니다" })).not.toBeInTheDocument();
  });

  it("keeps the current blocked document when a related task read fails", async () => {
    const onReadTask = vi.fn()
      .mockResolvedValueOnce({ summary: blockedTask, body: blockedBody("TASK-101") })
      .mockResolvedValueOnce(null);
    renderBoard(onReadTask);

    fireEvent.click(screen.getByRole("button", { name: /배포 준비/ }));
    await screen.findByRole("heading", { level: 2, name: "진행이 막혔습니다" });
    fireEvent.click(screen.getByRole("button", { name: "TASK-101 토큰 발급 작업 열기" }));

    await waitFor(() => expect(onReadTask).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { level: 1, name: "배포 준비" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "진행이 막혔습니다" })).toBeInTheDocument();
  });

  it.each(["todo", "in_progress", "qa_waiting", "completed"])(
    "does not show a preserved blocked reason while the task is %s",
    async (status) => {
      const item = { ...blockedTask, status };
      const onReadTask = vi.fn().mockResolvedValue({ summary: item, body: blockedBody() });
      renderBoard(onReadTask, [item]);

      fireEvent.click(screen.getByRole("button", { name: /배포 준비/ }));
      await screen.findByRole("heading", { level: 1, name: "배포 준비" });

      expect(screen.queryByRole("heading", { level: 2, name: "진행이 막혔습니다" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "막힌 작업 상세" })).not.toBeInTheDocument();
      if (status === "qa_waiting") expect(screen.getByLabelText("테스트 플로우와 확인 메모")).toBeInTheDocument();
      else expect(screen.queryByLabelText("테스트 플로우와 확인 메모")).not.toBeInTheDocument();
    },
  );
});
