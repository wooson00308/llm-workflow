import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpecDocument, TaskEvent, WorkGroupSummary, WorkflowItemSummary, WorkflowSummary } from "../domain/types";
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

    screen.getByRole("button", { name: /SPEC-001/ }).focus();
    await user.tab();
    const sourceToggle = screen.getByRole("button", { name: "원문 전문 보기" });
    expect(sourceToggle).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "결정권자 요약" })).toBeInTheDocument();
    expect(screen.getByText("원문 마지막에서 승인 범위를 다시 설명한다.")).toBeInTheDocument();

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
