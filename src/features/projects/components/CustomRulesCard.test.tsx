import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CustomRulesActions,
  CustomRulesDocument,
  CustomRulesPreview,
  CustomRulesState,
  SaveCustomRulesResult,
} from "../domain/types";
import { CustomRulesCard } from "./CustomRulesCard";

afterEach(cleanup);

const absent: CustomRulesDocument = {
  status: "absent",
  enabled: false,
  appliesTo: [],
  body: "",
  updatedAt: null,
  modifiedAt: null,
  raw: null,
  contentHash: null,
  error: null,
};

const saved: CustomRulesDocument = {
  status: "valid",
  enabled: true,
  appliesTo: ["planner", "developer"],
  body: "개발 보고서에는 검증 수치를 적는다.",
  updatedAt: "2026-08-06T12:00:00Z",
  modifiedAt: "2026-08-06T12:00:01Z",
  raw: "저장 원문",
  contentHash: "sha256:saved",
  error: null,
};

const preview: CustomRulesPreview = {
  draft: {
    enabled: true,
    appliesTo: ["planner", "developer"],
    body: saved.body,
  },
  serialized: "---\nschema: workflow-labs/custom-rules@1\n---\n\n개발 보고서에는 검증 수치를 적는다.\n",
  updatedAt: "2026-08-06T12:05:00Z",
  previewHash: "sha256:preview",
  priorityNotice: "앱 기본 규칙과 역할 계약이 우선합니다.",
  roles: ["planner", "architect", "developer"].map((role) => ({
    role: role as "planner" | "architect" | "developer",
    sources: [
      {
        kind: "workflow_rules" as const,
        label: "공통 규칙",
        order: 1,
        content: `공통 규칙 ${role}`,
        applied: true,
        reason: null,
      },
      {
        kind: "role_contract" as const,
        label: `${role} 역할 계약`,
        order: 2,
        content: `역할 계약 ${role}`,
        applied: true,
        reason: null,
      },
      {
        kind: "user_rules" as const,
        label: "사용자 정의 규칙",
        order: 3,
        content: saved.body,
        applied: role !== "architect",
        reason: role === "architect" ? "적용 역할에서 제외됨" : null,
      },
    ],
  })),
};

function state(
  document: CustomRulesDocument | null = saved,
  overrides: Partial<CustomRulesState> = {},
): CustomRulesState {
  return {
    document,
    reading: false,
    previewing: false,
    saving: false,
    preview: null,
    previewBaselineContentHash: null,
    saveResult: null,
    readError: null,
    previewError: null,
    saveError: null,
    ...overrides,
  };
}

function actions(overrides: Partial<CustomRulesActions> = {}): CustomRulesActions {
  return {
    preparePreview: vi.fn().mockResolvedValue(preview),
    save: vi.fn().mockResolvedValue(null),
    reload: vi.fn().mockResolvedValue(true),
    clearFeedback: vi.fn(),
    ...overrides,
  };
}

function renderCard(
  customState: CustomRulesState = state(),
  customActions: CustomRulesActions = actions(),
  activeLeaseCount = 0,
) {
  return render(
    <CustomRulesCard
      actions={customActions}
      activeLeaseCount={activeLeaseCount}
      state={customState}
    />,
  );
}

describe("CustomRulesCard", () => {
  it("파일이 없으면 꺼진 빈 초안으로 시작한다", () => {
    renderCard(state(absent));

    expect(screen.getByText("사용 안 함")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /사용자 규칙 사용/ })).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "사용자 규칙 Markdown 본문" })).toHaveValue("");
    expect(screen.getByText("저장 기록 없음")).toBeInTheDocument();
  });

  it("정상 파일의 사용 여부, 역할, 본문과 수정 시각을 복원한다", () => {
    renderCard();

    expect(screen.getByText("사용 중")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /사용자 규칙 사용/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "기획자" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "아키텍트" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "개발자" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "사용자 규칙 Markdown 본문" })).toHaveValue(saved.body);
    expect(screen.getByText(saved.modifiedAt!)).toBeInTheDocument();
  });

  it("규칙을 꺼도 역할과 본문을 보존하고 켠 상태에는 역할을 요구한다", () => {
    renderCard();

    fireEvent.click(screen.getByRole("checkbox", { name: /사용자 규칙 사용/ }));
    expect(screen.getByRole("textbox", { name: "사용자 규칙 Markdown 본문" })).toHaveValue(saved.body);
    expect(screen.getByRole("checkbox", { name: "기획자" })).toBeChecked();
    expect(screen.queryByText(/역할을 하나 이상/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /사용자 규칙 사용/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "기획자" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "개발자" }));
    expect(screen.getByText(/역할을 하나 이상 선택하세요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "미리보기 준비" })).toBeDisabled();
  });

  it("저장하지 않은 변경을 표시하고 변경 취소는 마지막 불러온 값만 복원한다", () => {
    const customActions = actions();
    renderCard(state(), customActions);
    const body = screen.getByRole("textbox", { name: "사용자 규칙 Markdown 본문" });

    fireEvent.change(body, { target: { value: "바꾼 본문" } });
    expect(screen.getByText("저장하지 않은 변경이 있습니다.")).toBeInTheDocument();
    expect(customActions.reload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
    expect(body).toHaveValue(saved.body);
    expect(screen.getByText("불러온 저장 상태와 같습니다.")).toBeInTheDocument();
    expect(customActions.reload).not.toHaveBeenCalled();
  });

  it("현재 초안의 미리보기를 준비해야만 저장할 수 있고 편집하면 무효화한다", async () => {
    const customActions = actions();
    const { rerender } = renderCard(state(), customActions);
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "미리보기 준비" }));
    await waitFor(() => expect(customActions.preparePreview).toHaveBeenCalledWith(preview.draft));

    rerender(
      <CustomRulesCard actions={customActions} activeLeaseCount={0} state={state(saved, { preview })} />,
    );
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();

    fireEvent.change(screen.getByRole("textbox", { name: "사용자 규칙 Markdown 본문" }), {
      target: { value: "미리보기 뒤 변경" },
    });
    expect(customActions.clearFeedback).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "사용자 규칙 미리보기" })).not.toBeInTheDocument();
  });

  it("빈 본문은 별도 확인 전 미리보기를 요청하지 않는다", async () => {
    const customActions = actions();
    renderCard(state(absent), customActions);

    fireEvent.click(screen.getByRole("button", { name: "미리보기 준비" }));
    expect(screen.getByText("본문을 완전히 비운 상태로 저장할까요?")).toBeInTheDocument();
    expect(customActions.preparePreview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "빈 본문 미리보기 준비" }));
    await waitFor(() => expect(customActions.preparePreview).toHaveBeenCalledWith(absentDraft()));
  });

  it.each(["invalid", "future_schema"] as const)(
    "%s 파일은 원문을 보여주고 확인 전에는 편집하지 않는다",
    (status) => {
      const document: CustomRulesDocument = {
        ...absent,
        status,
        raw: "---\nschema: unknown\n---\n원문",
        contentHash: "sha256:broken",
        error: "지원하지 않는 형식입니다.",
      };
      renderCard(state(document));

      expect(screen.getByText("지원하지 않는 형식입니다.")).toBeInTheDocument();
      expect(screen.getByText(/schema: unknown/)).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "사용자 규칙 Markdown 본문" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "새 형식으로 덮어쓰기" }));
      expect(screen.getByRole("textbox", { name: "사용자 규칙 Markdown 본문" })).toHaveValue("");
    },
  );

  it("안전하지 않은 파일은 덮어쓰기 없이 파일 시스템 정리만 안내한다", () => {
    renderCard(state({ ...absent, status: "unsafe_file", error: "심볼릭 링크입니다." }));

    expect(screen.getByText("앱에서 이 파일을 덮어쓸 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByText(/파일 시스템에서 항목을 정리/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "새 형식으로 덮어쓰기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "사용자 규칙 Markdown 본문" })).not.toBeInTheDocument();
  });

  it("외부 변경 중에도 초안을 유지하고 다시 불러오기 전 저장을 막는다", () => {
    const customActions = actions();
    const { rerender } = renderCard(state(), customActions);
    const body = screen.getByRole("textbox", { name: "사용자 규칙 Markdown 본문" });
    fireEvent.change(body, { target: { value: "아직 저장하지 않은 본문" } });

    const external = {
      ...saved,
      body: "외부에서 바뀐 본문",
      contentHash: "sha256:external",
    };
    rerender(<CustomRulesCard actions={customActions} activeLeaseCount={0} state={state(external, { preview })} />);

    expect(body).toHaveValue("아직 저장하지 않은 본문");
    expect(screen.getByText("앱 밖에서 파일이 바뀌었습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "다시 불러오기" })[0]);
    expect(screen.getByText("저장하지 않은 변경을 버리고 다시 불러올까요?")).toBeInTheDocument();
    expect(customActions.reload).not.toHaveBeenCalled();
  });

  it("편집 중이 아니면 정상 외부 변경을 다음 조회에서 초안에 반영한다", async () => {
    const customActions = actions();
    const { rerender } = renderCard(state(), customActions);
    const external = {
      ...saved,
      body: "외부에서 바뀐 최신 본문",
      contentHash: "sha256:external-clean",
    };

    rerender(<CustomRulesCard actions={customActions} activeLeaseCount={0} state={state(external)} />);

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "사용자 규칙 Markdown 본문" })).toHaveValue(
        "외부에서 바뀐 최신 본문",
      ),
    );
    expect(screen.queryByText("앱 밖에서 파일이 바뀌었습니다")).not.toBeInTheDocument();
  });

  it("다시 불러오기가 실패하면 저장하지 않은 초안을 버리지 않는다", async () => {
    const customActions = actions({ reload: vi.fn().mockResolvedValue(false) });
    renderCard(state(), customActions);
    const body = screen.getByRole("textbox", { name: "사용자 규칙 Markdown 본문" });
    fireEvent.change(body, { target: { value: "실패해도 남아야 하는 본문" } });

    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    fireEvent.click(screen.getByRole("button", { name: "변경 버리고 다시 불러오기" }));

    await waitFor(() => expect(customActions.reload).toHaveBeenCalledTimes(1));
    expect(body).toHaveValue("실패해도 남아야 하는 본문");
  });

  it("저장 충돌과 잠금 재시도를 구분하고 초안을 유지한다", () => {
    const conflict: SaveCustomRulesResult = {
      status: "conflict",
      document: { ...saved, contentHash: "sha256:external" },
      reason: "외부 변경을 발견했습니다.",
    };
    const { rerender } = renderCard(state(saved, { preview, saveResult: conflict }));
    expect(screen.getByText("다른 변경과 충돌해 저장하지 않았습니다")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "사용자 규칙 Markdown 본문" })).toHaveValue(saved.body);

    const retry: SaveCustomRulesResult = {
      status: "retry_required",
      document: saved,
      reason: "마이그레이션 잠금 사용 중",
    };
    rerender(<CustomRulesCard actions={actions()} activeLeaseCount={0} state={state(saved, { preview, saveResult: retry })} />);
    expect(screen.getByText("지금은 저장할 수 없습니다")).toBeInTheDocument();
    expect(screen.getByText("마이그레이션 잠금 사용 중")).toBeInTheDocument();
  });

  it("백엔드 저장 원문과 역할별 세 출처를 순서와 적용 사유까지 보여준다", () => {
    renderCard(state(saved, { preview }));

    expect(screen.getByTestId("custom-rules-serialized").textContent).toBe(preview.serialized);
    fireEvent.click(screen.getByRole("tab", { name: "아키텍트" }));
    const sources = screen.getAllByRole("listitem");
    expect(sources).toHaveLength(3);
    expect(within(sources[0]).getByText("공통 규칙")).toBeInTheDocument();
    expect(within(sources[1]).getByText("architect 역할 계약")).toBeInTheDocument();
    expect(within(sources[2]).getByText("사용자 정의 규칙")).toBeInTheDocument();
    expect(within(sources[2]).getByText("적용 안 함")).toBeInTheDocument();
    expect(within(sources[2]).getByText("적용 역할에서 제외됨")).toBeInTheDocument();
    expect(sources[2].querySelector("pre")?.textContent).toBe(saved.body);
    expect(screen.getAllByText(/앱 기본 규칙과 역할 계약/).length).toBeGreaterThanOrEqual(2);
  });

  it("활성 lease는 안내만 하고 검토한 미리보기의 저장을 막지 않는다", () => {
    const customActions = actions();
    renderCard(state(saved, { preview }), customActions, 2);

    const saveButton = screen.getByRole("button", { name: "저장" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    expect(customActions.save).toHaveBeenCalledTimes(1);
  });

  it("Markdown 원시 HTML과 링크, 외부 이미지를 실행 가능한 DOM으로 만들지 않는다", () => {
    const dangerousBody = [
      "<script>window.bad = true</script>",
      "<img src=x onerror=alert(1)>",
      "[외부 링크](https://example.com)",
      "[위험 링크](javascript:alert(1))",
      "![외부 이미지](https://example.com/a.png)",
    ].join("\n\n");
    const dangerousPreview = {
      ...preview,
      draft: { ...preview.draft, body: dangerousBody },
    };
    const { container } = renderCard(
      state({ ...saved, body: dangerousBody }, { preview: dangerousPreview }),
    );

    const markdown = container.querySelector(".custom-rules-markdown-preview");
    expect(markdown?.querySelector("script")).toBeNull();
    expect(markdown?.querySelector("a")).toBeNull();
    expect(markdown?.querySelector("img")).toBeNull();
    expect(within(markdown as HTMLElement).getByText("외부 링크")).toBeInTheDocument();
    expect(within(markdown as HTMLElement).getByText("위험 링크")).toBeInTheDocument();
  });

  it("비밀 값, 다음 세션 적용과 활성 lease 안내를 항상 보여준다", () => {
    renderCard(state(), actions(), 2);

    expect(screen.getByText(/API 키, 비밀번호, 토큰/)).toBeInTheDocument();
    expect(screen.getByText(/앱을 다시 시작할 필요는 없지만/)).toBeInTheDocument();
    expect(screen.getByText(/실행 중인 작업 2개/)).toBeInTheDocument();
    expect(screen.getByText(/이전 규칙을 사용하고 있을 수 있습니다/)).toBeInTheDocument();
  });
});

function absentDraft() {
  return { enabled: false, appliesTo: [], body: "" };
}
