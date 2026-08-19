import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpecDocument, TaskEvent, WorkGroupSummary, WorkflowItemSummary, WorkflowSummary } from "../domain/types";
import {
  COLLAPSED_PANEL_WIDTH,
  PANEL_KEYBOARD_STEP,
  PANEL_LIMITS,
  READING_WIDTH_MAX,
  READING_WIDTH_MIN,
} from "../domain/panelLayout";
import { SpecWorkspace } from "./SpecWorkspace";

const document: SpecDocument = {
  summary: {
    fileName: "SPEC-001.md",
    id: "SPEC-001",
    title: "승인 흐름",
    status: "user_review",
    updatedAt: "2026-07-30T00:00:00Z",
    excerpt: "사용자가 기획서를 검토한다.",
  },
  body: "# 승인 흐름\n\n## 기획 내용\n\n사용자가 기획서를 검토한다.",
};

/** 요약 절을 가진 문서. 이 저장소의 옛 문서에는 거의 없어서 픽스처로 만든다. */
const withSummary: SpecDocument = {
  summary: { ...document.summary, fileName: "SPEC-002.md", id: "SPEC-002" },
  body: [
    "# 승인 흐름",
    "",
    "## 결정권자 요약",
    "",
    "이 기획이 승인되면 평문이 먼저 열립니다.",
    "",
    "## 기획 내용",
    "",
    "작업자가 작업자에게 쓴 본문입니다.",
  ].join("\n"),
};

const otherWithSummary: SpecDocument = {
  summary: { ...document.summary, fileName: "SPEC-003.md", id: "SPEC-003" },
  body: [
    "# 다른 기획",
    "",
    "## 결정권자 요약",
    "",
    "다른 문서의 요약입니다.",
    "",
    "## 기획 내용",
    "",
    "다른 문서의 본문입니다.",
  ].join("\n"),
};

function structuredSpec({ includeRisk = true, incomplete = false } = {}): SpecDocument {
  return {
    summary: { ...document.summary, fileName: "SPEC-052.md", id: "SPEC-052" },
    body: [
      "# 구조화된 승인 기획",
      "",
      "## 결정권자 요약",
      "",
      "### 제안",
      "",
      "기획 승인 화면에 결정 보드를 둔다.",
      "",
      "### 현재",
      "",
      "평문 요약에서 판단 근거가 섞여 있다.",
      "",
      "### 변경 후",
      "",
      "승인할 변화와 유지 영역을 나눠 읽는다.",
      "",
      "### 사용자 결과",
      "",
      "승인 전에 변화의 범위를 빠르게 확인한다.",
      "",
      "### 영향 범위",
      "",
      "- 변경: 기획서의 기본 요약 화면",
      ...(incomplete ? [] : ["- 유지: 승인 기록과 원문 Markdown"]),
      ...(includeRisk ? ["", "### 비용과 위험", "", "불완전한 문서는 기존 요약으로 열린다."] : []),
      "",
      "### 결정 요청",
      "",
      "이 구조와 기존 승인 조작을 함께 승인할지 판단한다.",
      "",
      "## 기획 내용",
      "",
      "원문 마지막에서 승인 범위를 다시 설명한다.",
    ].join("\n"),
  };
}

function derivedTask(id: string, status: string, sourceSpecId: string | null): WorkflowItemSummary {
  return {
    fileName: `${id}.md`,
    id,
    title: `${id} 작업`,
    status,
    updatedAt: "2026-08-01T00:00:00Z",
    dueAt: null,
    excerpt: "",
    sourceSpecId,
    workGroupId: sourceSpecId ? `GROUP-${sourceSpecId}` : null,
    workGroupRevision: sourceSpecId ? 1 : null,
  };
}

function workflowWithTasks(tasks: WorkflowItemSummary[]): WorkflowSummary {
  const group: WorkGroupSummary = {
    fileName: "GROUP-SPEC-001.md",
    id: "GROUP-SPEC-001",
    title: "승인 흐름",
    status: "active",
    displayStatus: "developing",
    revision: 1,
    qaMode: "user",
    sourceSpecId: "SPEC-001",
    sourceDecisionId: "DECISION-001",
    sourceQaDecisionId: null,
    updatedAt: "2026-08-01T00:00:00Z",
    description: "",
    scenarios: [],
  };
  return {
    ...workflow,
    counts: { ...workflow.counts, workGroups: 1, tasks: tasks.length },
    items: { ...workflow.items, workGroups: [group], tasks },
  };
}

const workflow: WorkflowSummary = {
  id: "wf_1",
  directory: "feature--wf_1",
  name: "Feature",
  status: "active",
  createdAt: "2026-07-30T00:00:00Z",
  counts: { ideas: 0, specs: 1, decisions: 1, workGroups: 0, tasks: 0, reports: 0 },
  items: { ideas: [], specs: [document.summary], workGroups: [], tasks: [] },
};

/**
 * 한 상태의 기획서 하나. 이력은 목록 항목에서 오므로 열린 문서와 그 항목이 같은 파일 이름을
 * 가리키게 함께 만든다.
 */
function specAt(status: string, events: TaskEvent[] = []) {
  const summary: WorkflowItemSummary = {
    fileName: "SPEC-100.md",
    id: "SPEC-100",
    title: "결정 대상 기획",
    status,
    updatedAt: "2026-08-05T00:00:00Z",
    excerpt: "결정 조합을 확인하는 픽스처입니다.",
    events,
  };
  return {
    document: {
      summary,
      body: "# 결정 대상 기획\n\n## 기획 내용\n\n결정 조합을 확인하는 픽스처입니다.",
    } satisfies SpecDocument,
    workflow: { ...workflow, items: { ...workflow.items, specs: [summary] } },
  };
}

function renderSpecAt(status: string, events: TaskEvent[] = [], onDecision = vi.fn()) {
  const fixture = specAt(status, events);
  render(
    <SpecWorkspace
      busy={false}
      document={fixture.document}
      loading={false}
      onDecision={onDecision}
      onSelect={vi.fn()}
      workflow={fixture.workflow}
    />,
  );
  return onDecision;
}

const FOLLOW_UP_FACTS = [
  "기존 승인 결정은 지워지지 않습니다.",
  "이 기획서에서 나온 개발 작업은 그대로 진행됩니다.",
  "대신 이 기획서가 수정을 요청한 기획으로 바뀝니다.",
];

afterEach(cleanup);

describe("SpecWorkspace", () => {
  it("records approval inside the review workspace", async () => {
    const onDecision = vi.fn().mockResolvedValue(true);
    render(
      <SpecWorkspace
        busy={false}
        document={document}
        loading={false}
        onDecision={onDecision}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "승인 도장 찍기" }));
    expect(onDecision).not.toHaveBeenCalled();
    expect(screen.getByText("이 기획서를 승인합니다. 승인 기록은 되돌릴 수 없습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "한 번 더 누르면 승인" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("approved", ""));
    expect(screen.getByText("USER DECISION")).toBeInTheDocument();
    expect(screen.getByText("결정 Markdown을 안전하게 저장했습니다.")).toBeInTheDocument();
  });

  it("requires a comment before recording rejection", async () => {
    const onDecision = vi.fn().mockResolvedValue(true);
    render(
      <SpecWorkspace
        busy={false}
        document={document}
        loading={false}
        onDecision={onDecision}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "기획서 폐기" }));
    const submit = screen.getByRole("button", { name: "폐기 기록" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("폐기 사유"), {
      target: { value: "성공 조건이 불명확합니다." },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(onDecision).toHaveBeenCalledWith(
        "rejected",
        "성공 조건이 불명확합니다.",
      ),
    );
  });

  it("records a revision request with user guidance", async () => {
    const onDecision = vi.fn().mockResolvedValue(true);
    render(
      <SpecWorkspace
        busy={false}
        document={document}
        loading={false}
        onDecision={onDecision}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "수정 요청" }));
    const submit = screen.getByRole("button", { name: "수정 요청 기록" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("수정 요청 내용"), {
      target: { value: "성공 조건을 수치로 구체화해 주세요." },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(onDecision).toHaveBeenCalledWith(
        "revision_requested",
        "성공 조건을 수치로 구체화해 주세요.",
      ),
    );
    expect(screen.getByText("수정 요청")).toBeInTheDocument();
  });

  it("opens a spec at its decision summary and keeps the source one toggle away", () => {
    render(
      <SpecWorkspace
        busy={false}
        document={withSummary}
        loading={false}
        onDecision={vi.fn()}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    expect(screen.getByText("이 기획이 승인되면 평문이 먼저 열립니다.")).toBeInTheDocument();
    expect(screen.queryByText("작업자가 작업자에게 쓴 본문입니다.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "원문 전문 보기" }));
    expect(screen.getByText("작업자가 작업자에게 쓴 본문입니다.")).toBeInTheDocument();
    expect(screen.getByText("이 기획이 승인되면 평문이 먼저 열립니다.")).toBeInTheDocument();
  });

  it("keeps a structured decision board, source, and approval callback in one keyboard flow", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn().mockResolvedValue(true);
    render(
      <SpecWorkspace
        busy={false}
        document={structuredSpec()}
        loading={false}
        onDecision={onDecision}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    // 옛 일곱 항목 문서도 보드는 현행 세 덩어리(제안·전후·위험)만 보여 준다. 나머지는 원문 보기 몫이다.
    const board = screen.getByRole("region", { name: "결정 보드" });
    expect(within(board).getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "결정 보드", "제안", "현재", "변경 후", "비용과 위험",
    ]);
    expect(within(board).getByText("승인할 변화와 유지 영역을 나눠 읽는다.")).toBeInTheDocument();
    expect(within(board).queryByText("이 구조와 기존 승인 조작을 함께 승인할지 판단한다.")).not.toBeInTheDocument();
    for (const name of ["승인 도장 찍기", "수정 요청", "기획서 폐기"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(onDecision).not.toHaveBeenCalled();

    /*
     * 목록에서 본문과 결정으로 이어지는 키보드 길. SPEC-080이 목록 패널의 리사이즈 핸들과 결정 패널의
     * 접기 버튼을 이 사이에 세웠으므로 그 둘을 지나 간다. 확인하려는 것은 그 길이 끊기지 않는다는 것이다.
     */
    screen.getByRole("button", { name: /SPEC-001/ }).focus();
    await user.tab();
    expect(screen.getByRole("separator", { name: "기획서 목록 너비 조절" })).toHaveFocus();
    await user.tab();
    const sourceToggle = screen.getByRole("button", { name: "원문 전문 보기" });
    expect(sourceToggle).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "결정권자 요약" })).toBeInTheDocument();
    expect(screen.getByText("원문 마지막에서 승인 범위를 다시 설명한다.")).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("button", { name: "사용자 결정 접기" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "승인 도장 찍기" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("approved", ""));
  });

  it("omits an absent risk and falls back from an incomplete structured spec without inventing values", () => {
    const onDecision = vi.fn();
    const view = render(
      <SpecWorkspace
        busy={false}
        document={structuredSpec({ includeRisk: false })}
        loading={false}
        onDecision={onDecision}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    expect(screen.getByRole("region", { name: "결정 보드" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "비용과 위험" })).not.toBeInTheDocument();
    expect(onDecision).not.toHaveBeenCalled();

    view.rerender(
      <SpecWorkspace
        busy={false}
        document={structuredSpec({ incomplete: true })}
        loading={false}
        onDecision={onDecision}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );
    expect(screen.queryByRole("region", { name: "결정 보드" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "제안" })).toBeInTheDocument();
    expect(screen.queryByText(/빠진|오류|보완/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "승인 도장 찍기" })).toBeInTheDocument();
  });

  it("starts at the summary again when another document is opened in the same place", () => {
    const view = render(
      <SpecWorkspace
        busy={false}
        document={withSummary}
        loading={false}
        onDecision={vi.fn()}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "원문 전문 보기" }));
    expect(screen.getByText("작업자가 작업자에게 쓴 본문입니다.")).toBeInTheDocument();

    view.rerender(
      <SpecWorkspace
        busy={false}
        document={otherWithSummary}
        loading={false}
        onDecision={vi.fn()}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    // 토글 상태를 저장하지 않는다. 다른 문서를 열면 다시 평문에서 시작한다.
    expect(screen.getByRole("button", { name: "원문 전문 보기" })).toBeInTheDocument();
    expect(screen.getByText("다른 문서의 요약입니다.")).toBeInTheDocument();
    expect(screen.queryByText("다른 문서의 본문입니다.")).not.toBeInTheDocument();
  });

  it("leaves a spec without the summary section exactly as it opens today", () => {
    render(
      <SpecWorkspace
        busy={false}
        document={document}
        loading={false}
        onDecision={vi.fn()}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    expect(screen.getByText("사용자가 기획서를 검토한다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "원문 전문 보기" })).not.toBeInTheDocument();
    expect(screen.queryByText(/요약이 없/)).not.toBeInTheDocument();
  });

  it("shows the work group's derived state and verified progress", () => {
    render(
      <SpecWorkspace
        busy={false}
        document={document}
        loading={false}
        onDecision={vi.fn()}
        onSelect={vi.fn()}
        workflow={workflowWithTasks([
          derivedTask("TASK-001", "todo", "SPEC-001"),
          derivedTask("TASK-002", "in_progress", "SPEC-001"),
          derivedTask("TASK-003", "verified", "SPEC-001"),
          derivedTask("TASK-004", "verified", "SPEC-001"),
          // 다른 기획서에서 나온 작업과 출처가 없는 작업은 이 배지가 세지 않는다.
          derivedTask("TASK-005", "todo", "SPEC-002"),
          derivedTask("TASK-006", "todo", null),
        ])}
      />,
    );

    const progress = screen.getByRole("region", { name: "작업 그룹 진행" });
    expect(within(progress).getByText("개발 중")).toBeInTheDocument();
    expect(within(progress).getByText("완료 2 / 4")).toBeInTheDocument();
    expect(within(progress).getByText("현재 작업 그룹을 참조하는 AI 실행 태스크 전체를 셉니다")).toBeInTheDocument();
  });

  it("keeps an off-contract task status out of verified progress and still in view", () => {
    render(
      <SpecWorkspace
        busy={false}
        document={document}
        loading={false}
        onDecision={vi.fn()}
        onSelect={vi.fn()}
        workflow={workflowWithTasks([
          derivedTask("TASK-001", "todo", "SPEC-001"),
          derivedTask("TASK-002", "archived", "SPEC-001"),
        ])}
      />,
    );

    const progress = screen.getByRole("region", { name: "작업 그룹 진행" });
    expect(within(progress).getByText("규격 밖 1")).toBeInTheDocument();
    expect(within(progress).getByText("완료 0 / 2")).toBeInTheDocument();
  });

  it("says a spec has no derived task instead of dropping the row", () => {
    render(
      <SpecWorkspace
        busy={false}
        document={document}
        loading={false}
        onDecision={vi.fn()}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );

    const progress = screen.getByRole("region", { name: "작업 그룹 진행" });
    expect(within(progress).getByText("승인 뒤 아키텍트가 작업 그룹을 만들면 진행 상태가 여기에 나타납니다.")).toBeInTheDocument();
  });

  // 화면이 여는 조합이 TASK-127이 쓰기 경로에 세운 표와 같은지. 표보다 넓게 열면 사용자가 버튼을
  // 누르고 오류를 보고, 좁게 열면 그 작업이 낸 길이 닿지 않는다.
  const decisionActions = ["승인 도장 찍기", "수정 요청", "기획서 폐기", "후속 기획 요청"];
  const openTable: [string, string[]][] = [
    ["draft", []],
    ["user_review", ["승인 도장 찍기", "수정 요청", "기획서 폐기"]],
    ["approved", ["후속 기획 요청"]],
    ["revision_requested", []],
    ["rejected", []],
  ];

  for (const [status, expected] of openTable) {
    it(`opens exactly what the write path allows on a ${status} spec`, () => {
      renderSpecAt(status);

      expect(
        decisionActions.filter((name) => screen.queryByRole("button", { name })),
      ).toEqual(expected);
    });
  }

  it("keeps a follow-up planning request behind an open action and a comment", async () => {
    const onDecision = renderSpecAt("approved", [], vi.fn().mockResolvedValue(true));

    // 기획서를 열자마자 눌리는 자리가 아니다. 여는 조작이 먼저 있다.
    expect(screen.queryByRole("button", { name: "후속 기획 요청 기록" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "후속 기획 요청" }));

    for (const fact of FOLLOW_UP_FACTS) expect(screen.getByText(fact)).toBeInTheDocument();
    expect(
      screen.getByText("이 기획서에 후속 기획 요청을 기록합니다. 결정 기록은 되돌릴 수 없습니다."),
    ).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: "후속 기획 요청 기록" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onDecision).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("후속 기획 요청 내용"), {
      target: { value: "결정을 취소하는 동선까지 함께 다뤄 주세요." },
    });
    fireEvent.click(screen.getByRole("button", { name: "후속 기획 요청 기록" }));

    await waitFor(() =>
      expect(onDecision).toHaveBeenCalledWith(
        "revision_requested",
        "결정을 취소하는 동선까지 함께 다뤄 주세요.",
      ),
    );
    // 기록된 값은 수정 요청 그대로지만 도장은 이 화면이 부른 이름을 쓴다.
    expect(screen.getByText("후속 기획 요청")).toBeInTheDocument();
    expect(screen.getByText("USER DECISION")).toBeInTheDocument();
  });

  it("reads the stamps of a spec in time order and splits the two revision requests", () => {
    renderSpecAt("revision_requested", [
      { kind: "approved", at: "2026-08-01T02:00:00Z" },
      { kind: "revision_requested", at: "2026-08-03T05:30:00Z" },
    ]);

    const history = screen.getByRole("region", { name: "결정 이력" });
    expect([...history.querySelectorAll("li span")].map((node) => node.textContent)).toEqual([
      "승인", "후속 기획 요청",
    ]);
    expect([...history.querySelectorAll("time")].map((node) => node.getAttribute("dateTime"))).toEqual([
      "2026-08-01T02:00:00Z", "2026-08-03T05:30:00Z",
    ]);
  });

  it("still opens the history as one row when a spec has a single decision", () => {
    renderSpecAt("approved", [{ kind: "approved", at: "2026-08-01T02:00:00Z" }]);

    const history = screen.getByRole("region", { name: "결정 이력" });
    expect(within(history).getByText("승인")).toBeInTheDocument();
    expect(history.querySelectorAll("li")).toHaveLength(1);
  });

  it("leaves no place in the history to edit or drop a decision", () => {
    renderSpecAt("revision_requested", [
      { kind: "approved", at: "2026-08-01T02:00:00Z" },
      { kind: "revision_requested", at: "2026-08-03T05:30:00Z" },
    ]);

    const history = screen.getByRole("region", { name: "결정 이력" });
    expect(within(history).queryAllByRole("button")).toHaveLength(0);
    expect(within(history).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("says nothing about a history a spec does not have yet", () => {
    renderSpecAt("user_review");

    expect(screen.queryByRole("region", { name: "결정 이력" })).not.toBeInTheDocument();
  });

  it("lets the history stand in for the sentence it replaced, and keeps that sentence otherwise", () => {
    const preserved = "결정 기록은 원문과 분리되어 보존됩니다.";

    renderSpecAt("approved", [{ kind: "approved", at: "2026-08-01T02:00:00Z" }]);
    expect(screen.queryByText(preserved)).not.toBeInTheDocument();

    cleanup();
    // 이력이 설 것이 없는 기획서에서는 지울 수 없다. 대신할 것이 없는 자리다.
    renderSpecAt("approved");
    expect(screen.getByText(preserved)).toBeInTheDocument();
  });
});

/** `DevelopmentBoard.test.tsx`가 쓰는 것과 같은 목록. 세 화면이 같은 기준으로 C11을 확인한다. */
const internalNames = [
  "configuration_error", "preparing_stalled", "human_judgment_required", "qa_ready",
  "metadata_invalid", "tasks_missing", "task_link_mismatch", "user_scenario_unusable",
  "automatic_scenario_present", "task_not_verified",
  "configurationIssues", "humanJudgmentNote", "displayStatus",
  "SpecWorkspace.tsx", "src/features",
];

function withGroup(overrides: Partial<WorkGroupSummary>): WorkflowSummary {
  const base = workflowWithTasks([]);
  return {
    ...base,
    items: { ...base.items, workGroups: base.items.workGroups.map((group) => ({ ...group, ...overrides })) },
  };
}

function renderProgress(overrides: Partial<WorkGroupSummary>) {
  return render(
    <SpecWorkspace
      busy={false}
      document={document}
      loading={false}
      onDecision={vi.fn()}
      onSelect={vi.fn()}
      workflow={withGroup(overrides)}
    />,
  );
}

describe("SpecWorkspace attention notes", () => {
  it("explains the problem, the owner and the absent user action beside the feature status", () => {
    renderProgress({ displayStatus: "configuration_error", configurationIssues: ["tasks_missing", "user_scenario_unusable"] });

    const progress = screen.getByRole("region", { name: "작업 그룹 진행" });
    const note = within(progress).getByRole("note", { name: "상태 설명" });
    expect(within(progress).getByText("구성 확인 필요")).toBeInTheDocument();
    expect(note).toHaveTextContent("품질 확인을 열 수 없습니다");
    expect(note).toHaveTextContent("아키텍트가 구성을 다시 맞춥니다.");
    expect(note).toHaveTextContent("지금 사용자가 할 일은 없습니다.");
    expect(within(note).getAllByRole("listitem")).toHaveLength(2);
  });

  it("names the developer for blocked development and adds nothing while it is qa-ready", () => {
    renderProgress({ displayStatus: "blocked" });
    expect(screen.getByRole("note", { name: "상태 설명" })).toHaveTextContent("개발자가 막힌 곳을 풀어 갑니다.");

    cleanup();
    renderProgress({ displayStatus: "qa_ready" });
    expect(screen.getByText("사용자 QA 대기")).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "상태 설명" })).not.toBeInTheDocument();
  });

  it("keeps the row when no reason came down, and shows what the user has to judge", () => {
    renderProgress({ displayStatus: "configuration_error" });
    const bare = screen.getByRole("note", { name: "상태 설명" });
    expect(screen.getByText("완료 0 / 0")).toBeInTheDocument();
    expect(bare).toHaveTextContent("아키텍트가 구성을 다시 맞춥니다.");
    expect(within(bare).queryAllByRole("listitem")).toHaveLength(0);

    cleanup();
    renderProgress({ displayStatus: "human_judgment_required", humanJudgmentNote: "어느 구성 버전을 살릴지 정해야 합니다." });
    const judged = screen.getByRole("note", { name: "상태 설명" });
    expect(judged).toHaveTextContent("사용자가 판단할 차례입니다.");
    expect(within(judged).getByText("판단할 내용")).toBeInTheDocument();

    cleanup();
    renderProgress({ displayStatus: "human_judgment_required" });
    const onlyFact = screen.getByRole("note", { name: "상태 설명" });
    expect(onlyFact).toHaveTextContent("사용자가 판단할 차례입니다.");
    expect(within(onlyFact).queryByText("판단할 내용")).not.toBeInTheDocument();
  });

  it("keeps the note a reading place and hides internal names", () => {
    const view = renderProgress({
      displayStatus: "configuration_error",
      configurationIssues: ["metadata_invalid", "tasks_missing", "task_link_mismatch", "user_scenario_unusable", "automatic_scenario_present", "task_not_verified"],
    });

    const note = screen.getByRole("note", { name: "상태 설명" });
    expect(within(note).queryByRole("button")).not.toBeInTheDocument();
    expect(within(note).queryByRole("link")).not.toBeInTheDocument();

    const shown = view.container.textContent ?? "";
    for (const name of internalNames) expect(shown).not.toContain(name);
  });
});

/**
 * 문서 목록 패널과 결정 패널의 리사이즈·접기와, 그것이 본문 읽기 폭에 닿는 자리 (SPEC-080 R1~R12).
 *
 * 두 패널은 비율 배치라 스타일이 px를 정하지 않고, jsdom은 배치를 계산하지 않아 실제 측정이 0으로
 * 나온다. 그래서 기준 너비를 재는 자리를 시험이 바꿔 끼워 넘긴다.
 */
describe("SpecWorkspace 패널 리사이즈와 접기", () => {
  const LAYOUT_KEY = "workflow-labs.panel-layout.v1";
  /** 두 패널이 비율 배치로 그려져 있는 폭. 시험이 측정 자리를 대신 채워 넘기는 값이다. */
  const BASELINE = 240;
  const LIST_HANDLE = "기획서 목록 너비 조절";
  const DECISION_HANDLE = "사용자 결정 너비 조절";

  let storage: Map<string, string>;

  beforeEach(() => {
    storage = stubStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resizeWindow(1024);
  });

  /** 테스트 환경의 `localStorage`는 메서드가 없는 빈 객체다. 저장이 남는지 보려면 직접 세워야 한다. */
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

  /** jsdom의 창 폭을 바꾸고 크기 변경을 알린다. 그리는 너비 계산이 이 값을 읽는다. */
  function resizeWindow(width: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width, writable: true });
    fireEvent(window, new Event("resize"));
  }

  function workspace() {
    return render(
      <SpecWorkspace
        busy={false}
        document={document}
        loading={false}
        measurePanelWidth={() => BASELINE}
        onDecision={vi.fn()}
        onSelect={vi.fn()}
        workflow={workflow}
      />,
    );
  }

  /** 격자에 실린 폭 변수. 한 번도 조절하지 않았으면 빈 문자열이다. */
  function gridWidth(container: HTMLElement, name: string) {
    return container.querySelector<HTMLElement>(".spec-workspace-layout")!.style.getPropertyValue(name);
  }

  /** 본문 상자에 실린 읽기 폭 상한. 되찾은 폭이 없으면 빈 문자열이다. */
  function readingWidth(container: HTMLElement) {
    return container.querySelector<HTMLElement>(".spec-paper")!.style.getPropertyValue("--document-reading-width");
  }

  function handle(name: string) {
    return screen.getByRole("separator", { name });
  }

  /**
   * 핸들을 잡고 목표 너비까지 끈다. 결정 패널의 핸들은 본문 오른쪽 경계에 서 있어 왼쪽으로 끌수록
   * 넓어지므로 부호가 반대다.
   */
  function dragTo(name: string, width: number) {
    const grabbed = handle(name);
    const moved = width - Number(grabbed.getAttribute("aria-valuenow"));
    fireEvent.pointerDown(grabbed, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: name === DECISION_HANDLE ? 500 - moved : 500 + moved });
    fireEvent.pointerUp(window);
  }

  function stored() {
    return JSON.parse(storage.get(LAYOUT_KEY) ?? "{}");
  }

  it("한 번도 조절하지 않으면 격자 변수도 읽기 폭 변수도 싣지 않는다", () => {
    const { container } = workspace();

    expect(gridWidth(container, "--spec-list-width")).toBe("");
    expect(gridWidth(container, "--spec-decision-width")).toBe("");
    expect(readingWidth(container)).toBe("");
    expect(storage.get(LAYOUT_KEY)).toBeUndefined();
  });

  it("문서 목록 패널의 오른쪽 경계를 끌면 최소값과 최대값 사이에서 움직인다", () => {
    const { container } = workspace();
    const limits = PANEL_LIMITS.specList;

    const grabbed = handle(LIST_HANDLE);
    fireEvent.pointerDown(grabbed, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 560 });
    expect(gridWidth(container, "--spec-list-width")).toBe(`${BASELINE + 60}px`);

    fireEvent.pointerMove(window, { clientX: 1500 });
    expect(gridWidth(container, "--spec-list-width")).toBe(`${limits.maxWidth}px`);

    fireEvent.pointerMove(window, { clientX: 0 });
    expect(gridWidth(container, "--spec-list-width")).toBe(`${limits.minWidth}px`);

    fireEvent.pointerUp(window);
    expect(stored().specList).toEqual({ width: limits.minWidth, baselineWidth: BASELINE });
  });

  it("결정 패널의 왼쪽 경계를 끌면 반대 방향으로 같은 한계 안에서 움직인다", () => {
    const { container } = workspace();
    const limits = PANEL_LIMITS.specDecision;

    const grabbed = handle(DECISION_HANDLE);
    fireEvent.pointerDown(grabbed, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 440 });
    expect(gridWidth(container, "--spec-decision-width")).toBe(`${BASELINE + 60}px`);

    fireEvent.pointerMove(window, { clientX: 1500 });
    expect(gridWidth(container, "--spec-decision-width")).toBe(`${limits.minWidth}px`);

    fireEvent.pointerMove(window, { clientX: 0 });
    expect(gridWidth(container, "--spec-decision-width")).toBe(`${limits.maxWidth}px`);
    fireEvent.pointerUp(window);
  });

  it("핸들을 더블클릭하면 저장한 너비가 지워져 격자 규칙의 되돌림 값으로 돌아간다", () => {
    const { container } = workspace();
    dragTo(LIST_HANDLE, 320);
    expect(gridWidth(container, "--spec-list-width")).toBe("320px");

    fireEvent.doubleClick(handle(LIST_HANDLE));

    expect(gridWidth(container, "--spec-list-width")).toBe("");
    expect(stored().specList.width).toBeUndefined();
    // 기준 너비는 남는다. 되찾은 폭을 잴 자리라 되돌림과 함께 지우면 다시 잴 근거가 사라진다.
    expect(stored().specList.baselineWidth).toBe(BASELINE);
  });

  it("방향키는 한 걸음씩 움직이고 각자의 최소값과 최대값에서 멈춘다", () => {
    const { container } = workspace();

    fireEvent.keyDown(handle(LIST_HANDLE), { key: "ArrowRight" });
    expect(gridWidth(container, "--spec-list-width")).toBe(`${BASELINE + PANEL_KEYBOARD_STEP}px`);
    fireEvent.keyDown(handle(LIST_HANDLE), { key: "ArrowLeft" });
    expect(gridWidth(container, "--spec-list-width")).toBe(`${BASELINE}px`);

    // 결정 패널은 왼쪽 경계를 잡으므로 오른쪽 방향키가 좁히는 쪽이다.
    fireEvent.keyDown(handle(DECISION_HANDLE), { key: "ArrowLeft" });
    expect(gridWidth(container, "--spec-decision-width")).toBe(`${BASELINE + PANEL_KEYBOARD_STEP}px`);

    dragTo(LIST_HANDLE, PANEL_LIMITS.specList.maxWidth);
    fireEvent.keyDown(handle(LIST_HANDLE), { key: "ArrowRight" });
    expect(gridWidth(container, "--spec-list-width")).toBe(`${PANEL_LIMITS.specList.maxWidth}px`);

    dragTo(LIST_HANDLE, PANEL_LIMITS.specList.minWidth);
    fireEvent.keyDown(handle(LIST_HANDLE), { key: "ArrowLeft" });
    expect(gridWidth(container, "--spec-list-width")).toBe(`${PANEL_LIMITS.specList.minWidth}px`);
  });

  it("두 패널을 모두 접으면 두 자리에 세로 바만 남고 다시 누르면 접기 직전 너비로 돌아온다", () => {
    const { container } = workspace();
    dragTo(LIST_HANDLE, 320);

    fireEvent.click(screen.getByRole("button", { name: "기획서 목록 접기" }));
    fireEvent.click(screen.getByRole("button", { name: "사용자 결정 접기" }));

    expect(gridWidth(container, "--spec-list-width")).toBe(`${COLLAPSED_PANEL_WIDTH}px`);
    expect(gridWidth(container, "--spec-decision-width")).toBe(`${COLLAPSED_PANEL_WIDTH}px`);
    expect(screen.queryByRole("separator", { name: LIST_HANDLE })).toBeNull();

    const bar = screen.getByRole("button", { name: "기획서 목록 펼치기" });
    expect(bar).toHaveAttribute("title", "기획서 목록 펼치기");
    expect(bar.textContent).not.toContain("기획서 목록");

    fireEvent.click(bar);
    expect(gridWidth(container, "--spec-list-width")).toBe("320px");

    // 조절한 적이 없던 결정 패널은 저장한 너비가 없으므로 비율 배치로 돌아간다.
    fireEvent.click(screen.getByRole("button", { name: "사용자 결정 펼치기" }));
    expect(gridWidth(container, "--spec-decision-width")).toBe("");
  });

  it("읽기 폭 상한이 되찾은 폭만큼 오르고 860px에서 멈춘다", () => {
    const { container } = workspace();

    expect(readingWidth(container)).toBe("");

    dragTo(LIST_HANDLE, PANEL_LIMITS.specList.minWidth);
    expect(readingWidth(container)).toBe(`${READING_WIDTH_MIN + (BASELINE - PANEL_LIMITS.specList.minWidth)}px`);

    fireEvent.click(screen.getByRole("button", { name: "기획서 목록 접기" }));
    fireEvent.click(screen.getByRole("button", { name: "사용자 결정 접기" }));
    expect(readingWidth(container)).toBe(`${READING_WIDTH_MAX}px`);
  });

  it("저장해 둔 너비와 접힘을 다음 실행의 첫 그리기에서 그대로 읽는다", () => {
    storage.set(LAYOUT_KEY, JSON.stringify({ specList: { width: 320, baselineWidth: BASELINE } }));
    expect(gridWidth(workspace().container, "--spec-list-width")).toBe("320px");

    cleanup();
    storage.set(
      LAYOUT_KEY,
      JSON.stringify({ specDecision: { width: 320, baselineWidth: BASELINE, collapsed: true } }),
    );
    expect(gridWidth(workspace().container, "--spec-decision-width")).toBe(`${COLLAPSED_PANEL_WIDTH}px`);
  });

  it("브라우저 저장소를 쓸 수 없어도 화면이 그려지고 드래그와 접기가 동작한다", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("접근 거부");
      },
      setItem: () => {
        throw new Error("접근 거부");
      },
    });

    const { container } = workspace();
    expect(container.querySelector(".spec-workspace-layout")).toBeInTheDocument();

    dragTo(LIST_HANDLE, 320);
    expect(gridWidth(container, "--spec-list-width")).toBe("320px");

    fireEvent.click(screen.getByRole("button", { name: "기획서 목록 접기" }));
    expect(gridWidth(container, "--spec-list-width")).toBe(`${COLLAPSED_PANEL_WIDTH}px`);
  });

  it("창이 좁으면 그리는 너비만 줄고 저장한 값은 그대로 남는다", () => {
    const { container } = workspace();
    dragTo(LIST_HANDLE, 300);
    dragTo(DECISION_HANDLE, 300);

    resizeWindow(600);
    expect(gridWidth(container, "--spec-list-width")).toBe(`${PANEL_LIMITS.specList.minWidth}px`);
    expect(gridWidth(container, "--spec-decision-width")).toBe(`${PANEL_LIMITS.specDecision.minWidth}px`);
    expect(stored().specList.width).toBe(300);
    expect(stored().specDecision.width).toBe(300);

    resizeWindow(1024);
    expect(gridWidth(container, "--spec-list-width")).toBe("300px");
    expect(gridWidth(container, "--spec-decision-width")).toBe("300px");
  });

  it("창 폭 980px 이하에서 접힌 자리는 가로 막대가 되고 접기 버튼은 그대로 동작한다", () => {
    resizeWindow(900);
    const { container } = workspace();

    fireEvent.click(screen.getByRole("button", { name: "사용자 결정 접기" }));

    const bar = screen.getByRole("button", { name: "사용자 결정 펼치기" });
    expect(bar).toHaveClass("panel-collapsed-bar-horizontal");
    expect(gridWidth(container, "--spec-decision-width")).toBe(`${COLLAPSED_PANEL_WIDTH}px`);
  });
});
