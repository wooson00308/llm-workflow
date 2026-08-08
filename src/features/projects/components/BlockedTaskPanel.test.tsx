import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import cssText from "./BlockedTaskPanel.css?raw";
import type { BlockedReason } from "../domain/documentSections";
import type {
  ProjectSummary,
  TaskDocument,
  TaskResumeOutcome,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
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

function renderBoard(
  onReadTask: (fileName: string) => Promise<TaskDocument | null>,
  items = [blockedTask, relatedTask],
  onResumeTask?: (
    fileName: string,
    expectedUpdatedAt: string,
    resolution: string,
    requestId: string,
  ) => Promise<TaskResumeOutcome>,
  onTaskQa = vi.fn(),
) {
  return render(
    <DevelopmentBoard
      busy={false}
      onReadTask={onReadTask}
      onResumeTask={onResumeTask}
      onTaskQa={onTaskQa}
      onTaskQaBatch={vi.fn()}
      workflow={workflow(items)}
    />,
  );
}

/** 재개 결과에 실리는 요약. 훅이 프로젝트 상태를 갈아 끼우는 값이고 패널은 들여다보지 않는다. */
const resumeSummary: ProjectSummary = {
  rootPath: "/tmp/project",
  initialized: true,
  projectId: "prj_1",
  name: "Project",
  compatibility: "current",
  activeLeases: [],
  workflows: [],
};

function resumedOutcome(): TaskResumeOutcome {
  return { ok: true, result: { status: "resumed", summary: resumeSummary, recovery: null } };
}

/** 재개 영역만 있는 패널. 입력·확인 검사가 전부 이 자리에서 시작한다. */
function renderResume(
  onResume: (resolution: string, requestId: string) => Promise<TaskResumeOutcome>,
  overrides: { onReloadTask?: () => Promise<void>; reason?: BlockedReason | null; updatedAt?: string | null } = {},
) {
  return render(
    <BlockedTaskPanel
      decisionSummary={null}
      onOpenRelatedTask={vi.fn()}
      onReloadTask={overrides.onReloadTask}
      onResume={onResume}
      reason={overrides.reason === undefined ? reason : overrides.reason}
      tasks={[blockedTask, relatedTask]}
      updatedAt={overrides.updatedAt === undefined ? blockedTask.updatedAt : overrides.updatedAt}
    />,
  );
}

function resolutionInput() {
  return screen.getByLabelText("해결 근거");
}

function resumeButton() {
  return screen.getByRole("button", { name: /개발 준비로 되돌리기|한 번 더 누르면 재개|재개하는 중/ });
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

  it("does not offer a resume control without a call path", () => {
    render(
      <BlockedTaskPanel
        decisionSummary={null}
        onOpenRelatedTask={vi.fn()}
        reason={reason}
        tasks={[blockedTask, relatedTask]}
        updatedAt={blockedTask.updatedAt}
      />,
    );

    expect(screen.queryByRole("region", { name: "개발 준비로 돌리기" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("해결 근거")).not.toBeInTheDocument();
  });
});

describe("BlockedTaskPanel resume control", () => {
  it("reads the confirmed update time and the written resume condition next to the input", () => {
    renderResume(vi.fn());

    const control = screen.getByRole("region", { name: "개발 준비로 돌리기" });
    expect(within(control).getByText("2026-08-07T15:30:00Z")).toBeInTheDocument();
    expect(within(control).getByText("토큰 확인 검사가 통과한다.")).toBeInTheDocument();
    expect(resolutionInput()).toHaveValue("");
    expect(within(control).getByText("0 / 2,000자")).toBeInTheDocument();
  });

  // TASK-145가 고른 두 폴백에서도 재개 통로는 같은 자리에 선다. 사유를 읽지 못한 것과 재개할 수
  // 없는 것은 다른 사실이다.
  it.each([
    ["결정권자 요약 폴백", "## 결정권자 요약\n\n요약만 남았다."],
    ["원문 안내", null],
  ] as [string, string | null][])("keeps the resume control in the %s state", (_label, decisionSummary) => {
    render(
      <BlockedTaskPanel
        decisionSummary={decisionSummary}
        onOpenRelatedTask={vi.fn()}
        onResume={vi.fn()}
        reason={null}
        tasks={[]}
        updatedAt={blockedTask.updatedAt}
      />,
    );

    const control = screen.getByRole("region", { name: "개발 준비로 돌리기" });
    expect(within(control).getByText("2026-08-07T15:30:00Z")).toBeInTheDocument();
    expect(within(control).getByText("작성된 재개 조건이 없습니다. 왼쪽 문서 원문에서 확인해 주세요.")).toBeInTheDocument();
    expect(resolutionInput()).toBeInTheDocument();
  });

  it("never calls with an empty or over-long resolution", () => {
    const onResume = vi.fn();
    renderResume(onResume);

    expect(resumeButton()).toBeDisabled();
    fireEvent.change(resolutionInput(), { target: { value: "   " } });
    expect(resumeButton()).toBeDisabled();

    fireEvent.change(resolutionInput(), { target: { value: "가".repeat(2_001) } });
    expect(screen.getByText("해결 근거는 2,000자 이하여야 합니다.")).toBeInTheDocument();
    expect(resumeButton()).toBeDisabled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it("calls once on the second confirmation with the trimmed resolution", async () => {
    const onResume = vi.fn().mockResolvedValue(resumedOutcome());
    renderResume(onResume);

    fireEvent.change(resolutionInput(), { target: { value: "  토큰이 발급됐다.  " } });
    fireEvent.click(resumeButton());
    expect(onResume).not.toHaveBeenCalled();
    expect(screen.getByText("이 작업을 개발 준비 상태로 되돌리고 적은 근거를 사용자 기록으로 남깁니다.")).toBeInTheDocument();

    fireEvent.click(resumeButton());
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
    expect(onResume.mock.calls[0][0]).toBe("토큰이 발급됐다.");
    expect(onResume.mock.calls[0][1]).toEqual(expect.any(String));
    expect(onResume.mock.calls[0][1].length).toBeGreaterThan(0);
  });

  it("blocks the input and a second click while the call is running", async () => {
    let release = () => {};
    const onResume = vi.fn(
      () => new Promise<TaskResumeOutcome>((resolve) => {
        release = () => resolve(resumedOutcome());
      }),
    );
    renderResume(onResume);

    fireEvent.change(resolutionInput(), { target: { value: "토큰이 발급됐다." } });
    fireEvent.click(resumeButton());
    fireEvent.click(resumeButton());
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));

    expect(resolutionInput()).toBeDisabled();
    expect(resumeButton()).toBeDisabled();
    fireEvent.click(resumeButton());
    expect(onResume).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(resolutionInput()).not.toBeDisabled());
  });

  // 응답을 잃고 다시 누르는 것은 같은 조작이다. 같은 식별자를 다시 보내야 앱이 기록을 두 벌 만들지
  // 않고, 입력을 고치면 다른 조작이므로 식별자도 새로 만든다.
  it("repeats the same request id on retry and mints a new one after an edit", async () => {
    const onResume = vi.fn().mockResolvedValue({ ok: false, message: "응답을 받지 못했습니다." });
    renderResume(onResume);

    fireEvent.change(resolutionInput(), { target: { value: "토큰이 발급됐다." } });
    fireEvent.click(resumeButton());
    fireEvent.click(resumeButton());
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));

    fireEvent.click(resumeButton());
    fireEvent.click(resumeButton());
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(2));
    expect(onResume.mock.calls[1][1]).toBe(onResume.mock.calls[0][1]);

    fireEvent.change(resolutionInput(), { target: { value: "토큰이 발급되고 검사도 통과했다." } });
    fireEvent.click(resumeButton());
    fireEvent.click(resumeButton());
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(3));
    expect(onResume.mock.calls[2][1]).not.toBe(onResume.mock.calls[0][1]);
  });

  it("keeps the input and offers a reload when the call is refused", async () => {
    const onReloadTask = vi.fn().mockResolvedValue(undefined);
    const onResume = vi.fn().mockResolvedValue({
      ok: false,
      message: "작업 문서가 그사이 변경되었습니다. 문서를 다시 열어 확인한 뒤 재개해 주세요.",
    });
    renderResume(onResume, { onReloadTask });

    fireEvent.change(resolutionInput(), { target: { value: "토큰이 발급됐다." } });
    fireEvent.click(resumeButton());
    fireEvent.click(resumeButton());

    expect(await screen.findByText(/작업 문서가 그사이 변경되었습니다/)).toBeInTheDocument();
    expect(resolutionInput()).toHaveValue("토큰이 발급됐다.");
    fireEvent.click(screen.getByRole("button", { name: "문서 다시 읽기" }));
    await waitFor(() => expect(onReloadTask).toHaveBeenCalledTimes(1));
  });

  // 두 기록 중 하나만 남은 결과는 성공이 아니다. 남은 파일과 할 일을 그대로 밝힌다.
  it("does not read a partial save as success", async () => {
    const onResume = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        status: "recovery_required",
        summary: resumeSummary,
        recovery: {
          createdPaths: ["/tmp/project/.workflow/wf/decisions/RESUME-1234ABCD.md"],
          reason: "되돌리기 실패",
          action: "남은 재개 감사 기록 파일을 지운 뒤 재개를 다시 시도해 주세요.",
        },
      },
    });
    renderResume(onResume, { onReloadTask: vi.fn().mockResolvedValue(undefined) });

    fireEvent.change(resolutionInput(), { target: { value: "토큰이 발급됐다." } });
    fireEvent.click(resumeButton());
    fireEvent.click(resumeButton());

    expect(await screen.findByText(/재개 기록만 남고 작업 문서를 바꾸지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/RESUME-1234ABCD\.md/)).toBeInTheDocument();
    expect(resolutionInput()).toHaveValue("토큰이 발급됐다.");
  });

  it("refuses to call when the document update time is unreadable", () => {
    const onResume = vi.fn();
    renderResume(onResume, { updatedAt: null });

    fireEvent.change(resolutionInput(), { target: { value: "토큰이 발급됐다." } });
    expect(screen.getByText("문서 갱신 시각을 읽지 못해 재개할 수 없습니다. 문서를 다시 읽어 주세요.")).toBeInTheDocument();
    expect(resumeButton()).toBeDisabled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it("reaches the input, the confirmation and the reload in that order by keyboard", async () => {
    const onResume = vi.fn().mockResolvedValue({ ok: false, message: "선점 중입니다." });
    const { container } = renderResume(onResume, { onReloadTask: vi.fn().mockResolvedValue(undefined) });

    fireEvent.change(resolutionInput(), { target: { value: "토큰이 발급됐다." } });
    fireEvent.click(resumeButton());
    fireEvent.click(resumeButton());
    await screen.findByText("선점 중입니다.");

    const control = container.querySelector<HTMLElement>(".task-resume");
    const focusable = Array.from(
      control?.querySelectorAll<HTMLElement>("textarea, button") ?? [],
    );
    expect(focusable.map((node) => node.tagName)).toEqual(["TEXTAREA", "BUTTON", "BUTTON"]);
    expect(focusable[1].textContent).toContain("문서 다시 읽기");
    expect(focusable[2].textContent).toContain("개발 준비로 되돌리기");
    for (const node of focusable) {
      node.focus();
      expect(document.activeElement).toBe(node);
    }
  });

  it("keeps the resume area in one column and wraps long values", () => {
    expect(cssText).toMatch(/\.task-resume\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(cssText).toMatch(/\.task-resume-facts\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(cssText).toMatch(/\.task-resume\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(cssText).toMatch(/@media \(max-width: 980px\)\s*\{[^}]*\.task-resume\b/s);
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

  it("resumes through the same detail and shows the returned state without closing it", async () => {
    const resumedDocument: TaskDocument = {
      summary: {
        ...blockedTask,
        status: "todo",
        updatedAt: "2026-08-08T02:00:00Z",
        events: [
          { kind: "blocked", at: "2026-08-07T15:30:00Z" },
          { kind: "resumed", at: "2026-08-08T02:00:00Z" },
        ],
      },
      body: blockedBody(),
    };
    const onReadTask = vi.fn()
      .mockResolvedValueOnce({ summary: blockedTask, body: blockedBody() })
      .mockResolvedValue(resumedDocument);
    const onResumeTask = vi.fn().mockResolvedValue(resumedOutcome());
    const onTaskQa = vi.fn();
    renderBoard(onReadTask, [blockedTask, relatedTask], onResumeTask, onTaskQa);

    fireEvent.click(screen.getByRole("button", { name: /배포 준비/ }));
    await screen.findByRole("heading", { level: 2, name: "진행이 막혔습니다" });
    fireEvent.change(screen.getByLabelText("해결 근거"), { target: { value: "토큰이 발급됐다." } });
    fireEvent.click(resumeButton());
    fireEvent.click(resumeButton());

    await waitFor(() => expect(onResumeTask).toHaveBeenCalledTimes(1));
    expect(onResumeTask.mock.calls[0].slice(0, 3)).toEqual([
      "TASK-100.md",
      "2026-08-07T15:30:00Z",
      "토큰이 발급됐다.",
    ]);
    // 재개는 QA 통로를 빌리지 않는다. 두 조작은 남기는 기록도 뜻도 다르다.
    expect(onTaskQa).not.toHaveBeenCalled();
    // 같은 상세가 그대로 열려 있고 그 안의 상태만 바뀐다.
    expect(await screen.findByText("사용자 재개", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "배포 준비" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "개발 준비로 돌리기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "진행이 막혔습니다" })).not.toBeInTheDocument();
    expect(onReadTask).toHaveBeenCalledTimes(2);
    expect(onReadTask).toHaveBeenNthCalledWith(2, "TASK-100.md");
  });

  it("keeps showing why the resumed task still cannot start", async () => {
    const resumedDocument: TaskDocument = {
      summary: { ...blockedTask, status: "todo", updatedAt: "2026-08-08T02:00:00Z" },
      body: blockedBody(),
      dependencies: [{ id: "TASK-101", state: "pending" }],
      overlapBlocks: [{ leaseTargetId: "TASK-777", sharedFiles: ["src/app.ts"] }],
    };
    const onReadTask = vi.fn()
      .mockResolvedValueOnce({ summary: blockedTask, body: blockedBody() })
      .mockResolvedValue(resumedDocument);
    const onResumeTask = vi.fn().mockResolvedValue(resumedOutcome());
    const { container } = renderBoard(onReadTask, [blockedTask, relatedTask], onResumeTask);

    fireEvent.click(screen.getByRole("button", { name: /배포 준비/ }));
    await screen.findByRole("heading", { level: 2, name: "진행이 막혔습니다" });
    fireEvent.change(screen.getByLabelText("해결 근거"), { target: { value: "토큰이 발급됐다." } });
    fireEvent.click(resumeButton());
    fireEvent.click(resumeButton());

    await waitFor(() => expect(onResumeTask).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("시작할 수 없음")).toBeInTheDocument();
    expect(container.querySelector(".task-detail-state .status-pill")?.textContent).toBe("준비");
    const dependencies = screen.getByRole("region", { name: "선행 작업" });
    expect(within(dependencies).getByText("TASK-101")).toBeInTheDocument();
    expect(within(dependencies).getByText("TASK-777")).toBeInTheDocument();
  });

  it.each(["todo", "in_progress", "qa_waiting", "completed"] as const)(
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

/**
 * 첫 적용 대상인 두 런타임 작업의 종단 흐름. 보완 작업의 상태는 검사 데이터로 만들어 쓴다 — 이
 * 화면은 그 상태를 참고 정보로 읽을 뿐이고, 실제 진행 상태를 조회하지 않는다.
 */
describe("blocked runtime tasks resumed by the user", () => {
  const runtimeTasks: WorkflowItemSummary[] = [
    {
      fileName: "TASK-S051-04.md",
      id: "TASK-S051-04",
      title: "역할 디스패처를 정규화한다",
      status: "blocked",
      updatedAt: "2026-08-08T01:00:00Z",
      dueAt: null,
      excerpt: "보완 작업을 기다린다.",
    },
    {
      fileName: "TASK-146.md",
      id: "TASK-146",
      title: "하트비트 조건 계약을 보완한다",
      status: "qa_waiting",
      updatedAt: "2026-08-08T00:30:00Z",
      dueAt: null,
      excerpt: "조건 계약을 보완한다.",
    },
    {
      fileName: "TASK-S051-06.md",
      id: "TASK-S051-06",
      title: "앱 설치 흐름을 잇는다",
      status: "blocked",
      updatedAt: "2026-08-08T01:10:00Z",
      dueAt: null,
      excerpt: "설치 보완을 기다린다.",
    },
    {
      fileName: "TASK-147.md",
      id: "TASK-147",
      title: "앱 설치 계약을 보완한다",
      status: "completed",
      updatedAt: "2026-08-08T00:40:00Z",
      dueAt: null,
      excerpt: "설치 계약을 보완한다.",
    },
  ];

  function runtimeBody(title: string, related: string) {
    return [
      `# ${title}`,
      "",
      "## 결정권자 요약",
      "",
      "보완 작업이 끝나기를 기다린다.",
      "",
      "## 막힌 사유",
      "",
      "- 막힌 지점: 보완 작업의 결과를 아직 쓸 수 없다.",
      "- 필요한 해결: 보완 작업이 사용자 확인까지 간다.",
      "- 재개 조건: 보완 작업의 결과를 이 작업에서 읽을 수 있다.",
      `- 관련 대상: ${related}`,
      "",
      "## 완료 조건",
      "",
      "1. 원래 범위는 이 재개로 바뀌지 않는다.",
    ].join("\n");
  }

  function documentsFor(id: string, related: string) {
    const item = runtimeTasks.find((task) => task.id === id)!;
    const body = runtimeBody(item.title, related);
    return {
      blocked: { summary: item, body } satisfies TaskDocument,
      resumed: {
        summary: {
          ...item,
          status: "todo",
          updatedAt: "2026-08-08T03:00:00Z",
          events: [{ kind: "resumed", at: "2026-08-08T03:00:00Z" }],
        },
        body,
      } satisfies TaskDocument,
    };
  }

  it("resumes TASK-S051-04 only after the user confirms, and keeps the written scope", async () => {
    const documents = documentsFor("TASK-S051-04", "TASK-146");
    const onReadTask = vi.fn()
      .mockResolvedValueOnce(documents.blocked)
      .mockResolvedValue(documents.resumed);
    const onResumeTask = vi.fn().mockResolvedValue(resumedOutcome());
    const { container } = renderBoard(onReadTask, runtimeTasks, onResumeTask);

    fireEvent.click(screen.getByRole("button", { name: /역할 디스패처를 정규화한다/ }));
    await screen.findByRole("heading", { level: 2, name: "진행이 막혔습니다" });
    // 보완 작업의 제목과 현재 상태는 참고 정보로만 실린다. 화면이 스스로 재개하지 않는다.
    expect(screen.getByText("현재 상태 QA 대기")).toBeInTheDocument();
    expect(onResumeTask).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("해결 근거"), {
      target: { value: "TASK-146이 QA 대기까지 가서 조건 계약을 읽을 수 있다." },
    });
    fireEvent.click(resumeButton());
    expect(onResumeTask).not.toHaveBeenCalled();
    fireEvent.click(resumeButton());

    await waitFor(() => expect(onResumeTask).toHaveBeenCalledTimes(1));
    expect(onResumeTask.mock.calls[0].slice(0, 3)).toEqual([
      "TASK-S051-04.md",
      "2026-08-08T01:00:00Z",
      "TASK-146이 QA 대기까지 가서 조건 계약을 읽을 수 있다.",
    ]);
    // 재개 뒤에도 문서 원문의 막힌 사유와 완료 조건은 그대로 남고 조작만 사라진다.
    expect(await screen.findByText("사용자 재개", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "개발 준비로 돌리기" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "원문 전문 보기" }));
    const documentArea = container.querySelector(".task-detail-document");
    expect(documentArea?.textContent).toContain("보완 작업의 결과를 아직 쓸 수 없다.");
    expect(documentArea?.textContent).toContain("원래 범위는 이 재개로 바뀌지 않는다.");
  });

  it("resumes TASK-S051-06 without touching the other blocked task", async () => {
    const documents = documentsFor("TASK-S051-06", "TASK-147");
    const onReadTask = vi.fn()
      .mockResolvedValueOnce(documents.blocked)
      .mockResolvedValue(documents.resumed);
    const onResumeTask = vi.fn().mockResolvedValue(resumedOutcome());
    renderBoard(onReadTask, runtimeTasks, onResumeTask);

    fireEvent.click(screen.getByRole("button", { name: /앱 설치 흐름을 잇는다/ }));
    await screen.findByRole("heading", { level: 2, name: "진행이 막혔습니다" });
    expect(screen.getByText("현재 상태 완료")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("해결 근거"), {
      target: { value: "TASK-147이 완료돼 설치 계약을 읽을 수 있다." },
    });
    fireEvent.click(resumeButton());
    fireEvent.click(resumeButton());
    await waitFor(() => expect(onResumeTask).toHaveBeenCalledTimes(1));

    expect(onResumeTask.mock.calls[0][0]).toBe("TASK-S051-06.md");
    expect(onResumeTask.mock.calls.every((call) => call[0] !== "TASK-S051-04.md")).toBe(true);
    // 목록으로 돌아오면 사용자가 조작하지 않은 막힌 작업은 그대로 있다.
    fireEvent.click(await screen.findByRole("button", { name: "← 개발 작업으로" }));
    expect(screen.getByRole("button", { name: /역할 디스패처를 정규화한다/ })).toBeInTheDocument();
  });
});
