import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import cssText from "./BlockedTaskPanel.css?raw";
import type { BlockedReason } from "../domain/documentSections";
import type { ProjectSummary, TaskDocument, WorkflowItemSummary, WorkflowSummary } from "../domain/types";
import { BlockedTaskPanel, TaskRevisionRequestPanel } from "./BlockedTaskPanel";
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

function renderBoard(
  onReadTask: (fileName: string) => Promise<TaskDocument | null>,
  items = [blockedTask, relatedTask],
  activeLeases: React.ComponentProps<typeof DevelopmentBoard>["activeLeases"] = [],
) {
  return render(
    <DevelopmentBoard
      activeLeases={activeLeases}
      busy={false}
      onReadTask={onReadTask}
      onTaskQa={vi.fn()}
      onTaskQaBatch={vi.fn()}
      workflow={workflow(items)}
    />,
  );
}

function expectAgentOperatedNotice(withRevisionRequest = false) {
  const notice = screen.getByRole("region", { name: "에이전트 처리 안내" });
  expect(within(notice).getByText("에이전트가 해결·재시도합니다")).toBeInTheDocument();
  expect(within(notice).getByText(withRevisionRequest
    ? /별도로 수정을 요청할 수 있습니다/
    : /사용자가 입력하거나 조작할 내용은 없습니다/)).toBeInTheDocument();
  expect(screen.queryByLabelText("해결 근거")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /개발 준비로 되돌리기|한 번 더 누르면 재개/ })).not.toBeInTheDocument();
  if (withRevisionRequest) expect(screen.getByLabelText("수정이 필요한 이유")).toBeInTheDocument();
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
    expectAgentOperatedNotice();
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
    expectAgentOperatedNotice();
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
    expectAgentOperatedNotice();
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
    expectAgentOperatedNotice();
  });

  it("keeps the reason and agent notice in one-column wrapping layouts", () => {
    expect(cssText).toMatch(/\.blocked-task-fields\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(cssText).toMatch(/\.blocked-task-targets\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(cssText).toMatch(/\.blocked-task-agent-notice\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(cssText).toContain("overflow-wrap: anywhere");
    expect(cssText).toContain("@media (max-width: 980px)");
    expect(cssText).not.toContain(".task-resume");
  });
});

describe("TaskRevisionRequestPanel", () => {
  const taskDocument: TaskDocument = {
    summary: { ...blockedTask, status: "todo" },
    body: "# 배포 준비",
    dependencies: [{ id: "TASK-101", state: "satisfied" }],
    scopeDeclaration: { status: "declared", files: ["src/z.ts", "src/a.ts"] },
    revisionRequests: [{
      id: "REVISION-OLD",
      previousUpdatedAt: "2026-08-06T00:00:00Z",
      reason: "기존 범위가 좁다.",
      createdAt: "2026-08-06T01:00:00Z",
      handled: true,
    }],
  };

  it("shows the current facts and records only the second confirmation once", async () => {
    let resolveRequest!: (value: {
      ok: true;
      result: { status: "recorded"; summary: ProjectSummary; request: null };
    }) => void;
    const pending = new Promise<{
      ok: true;
      result: { status: "recorded"; summary: ProjectSummary; request: null };
    }>((resolve) => { resolveRequest = resolve; });
    const onRequest = vi.fn(() => pending);
    const onReload = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskRevisionRequestPanel
        busy={false}
        dependencies={taskDocument.dependencies ?? []}
        document={taskDocument}
        onReload={onReload}
        onRequest={onRequest}
        preflight="- 값 경로: 현재 범위를 그대로 읽는다."
      />,
    );

    expect(screen.getByText("TASK-100 · 준비")).toBeInTheDocument();
    expect(screen.getByText("TASK-101 (충족)")).toBeInTheDocument();
    expect(screen.getByText("src/z.ts")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText(/처리 완료 · REVISION-OLD/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("범위 사전 검사 근거"));
    expect(screen.getByText(/현재 범위를 그대로 읽는다/)).toBeInTheDocument();

    const input = screen.getByLabelText("수정이 필요한 이유");
    const first = screen.getByRole("button", { name: "정의 수정 요청 확인" });
    expect(first).toBeDisabled();
    fireEvent.change(input, { target: { value: "최상위 조립 파일을 범위에 넣어야 한다." } });
    fireEvent.click(first);
    expect(onRequest).not.toHaveBeenCalled();
    expect(screen.getByText("TASK-100에 다음 이유를 기록합니다.")).toBeInTheDocument();

    const second = screen.getByRole("button", { name: "한 번 더 누르면 수정 요청" });
    fireEvent.click(second);
    fireEvent.click(second);
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith(
      "TASK-100.md",
      "2026-08-07T15:30:00Z",
      "최상위 조립 파일을 범위에 넣어야 한다.",
      expect.stringMatching(/^task-revision-/),
    );

    resolveRequest({
      ok: true,
      result: { status: "recorded", summary: {} as ProjectSummary, request: null },
    });
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue("");
    expect(screen.getByText("정의 수정 요청을 기록했습니다.")).toBeInTheDocument();
  });

  it("blocks oversized text before the call and preserves input after a refusal and reload", async () => {
    const onRequest = vi.fn().mockResolvedValue({ ok: false, message: "작업 문서가 그사이 변경되었습니다." });
    const onReload = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskRevisionRequestPanel
        busy={false}
        dependencies={[]}
        document={{ ...taskDocument, revisionRequests: [] }}
        onReload={onReload}
        onRequest={onRequest}
        preflight={null}
      />,
    );

    const input = screen.getByLabelText("수정이 필요한 이유");
    fireEvent.change(input, { target: { value: "가".repeat(2_001) } });
    expect(screen.getByText("2,001 / 2,000자")).toHaveClass("error");
    expect(screen.getByRole("button", { name: "정의 수정 요청 확인" })).toBeDisabled();
    expect(onRequest).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "현재 범위가 오래됐다." } });
    fireEvent.click(screen.getByRole("button", { name: "정의 수정 요청 확인" }));
    fireEvent.click(screen.getByRole("button", { name: "한 번 더 누르면 수정 요청" }));
    expect(await screen.findByText("작업 문서가 그사이 변경되었습니다.")).toBeInTheDocument();
    expect(input).toHaveValue("현재 범위가 오래됐다.");
    fireEvent.click(screen.getByRole("button", { name: "최신 작업 다시 읽기" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("현재 범위가 오래됐다.");
  });

  it.each([
    [{ status: "declared" as const, files: [] }, "변경 파일 없음 (빈 목록으로 선언됨)"],
    [{ status: "absent" as const, files: [] }, "범위 선언 없음"],
    [{ status: "malformed" as const, files: [] }, "선언을 목록으로 읽지 못함"],
  ])("keeps scope state %j distinct", (scopeDeclaration, expected) => {
    render(
      <TaskRevisionRequestPanel
        busy={false}
        dependencies={[]}
        document={{ ...taskDocument, scopeDeclaration, revisionRequests: [] }}
        onReload={vi.fn()}
        onRequest={vi.fn()}
        preflight={null}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
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
    expectAgentOperatedNotice(true);
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
    expectAgentOperatedNotice(true);
  });

  it("keeps historical user-resume events readable without restoring the control", async () => {
    const resumedTask: WorkflowItemSummary = {
      ...blockedTask,
      status: "todo",
      events: [{ kind: "resumed", at: "2026-08-08T02:00:00Z" }],
    };
    const onReadTask = vi.fn().mockResolvedValue({ summary: resumedTask, body: blockedBody() });
    renderBoard(onReadTask, [resumedTask]);

    fireEvent.click(screen.getByRole("button", { name: /배포 준비/ }));
    expect(await screen.findByText("사용자 재개", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "에이전트 처리 안내" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("해결 근거")).not.toBeInTheDocument();
  });

  it.each(["todo", "in_progress", "qa_waiting", "completed"] as const)(
    "does not show a preserved blocked reason while the task is %s",
    async (status) => {
      const item = { ...blockedTask, status };
      const onReadTask = vi.fn().mockResolvedValue({ summary: item, body: blockedBody() });
      renderBoard(onReadTask, [item]);

      if (status === "qa_waiting") {
        fireEvent.click(screen.getByRole("button", { name: "배포 준비 QA 시작" }));
        fireEvent.click(screen.getByRole("button", { name: "문제 있는 단계 열기" }));
      } else {
        fireEvent.click(screen.getByRole("button", { name: /배포 준비/ }));
      }
      await screen.findByRole("heading", { level: 1, name: "배포 준비" });

      expect(screen.queryByRole("heading", { level: 2, name: "진행이 막혔습니다" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "막힌 작업 상세" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "에이전트 처리 안내" })).not.toBeInTheDocument();
      if (status === "qa_waiting") expect(screen.getByLabelText("테스트 플로우와 확인 메모")).toBeInTheDocument();
      else expect(screen.queryByLabelText("테스트 플로우와 확인 메모")).not.toBeInTheDocument();
      if (status === "todo") expect(screen.getByRole("region", { name: "정의 수정 요청" })).toBeInTheDocument();
      else expect(screen.queryByRole("region", { name: "정의 수정 요청" })).not.toBeInTheDocument();
    },
  );

  it("hides the request control while the selected todo task has an active lease", async () => {
    const todoTask = { ...blockedTask, status: "todo" };
    const onReadTask = vi.fn().mockResolvedValue({ summary: todoTask, body: blockedBody() });
    renderBoard(onReadTask, [todoTask], [{
      leaseId: "lease-1",
      agent: "developer",
      role: "developer",
      taskId: todoTask.id,
      heartbeatAt: "2026-08-08T01:00:00Z",
      expiresAt: "2026-08-08T01:10:00Z",
    }]);

    fireEvent.click(screen.getByRole("button", { name: /배포 준비/ }));
    await screen.findByRole("heading", { level: 1, name: "배포 준비" });
    expect(screen.queryByRole("region", { name: "정의 수정 요청" })).not.toBeInTheDocument();
  });
});
