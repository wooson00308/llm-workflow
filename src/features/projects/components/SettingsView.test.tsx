import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CustomRulesActions,
  CustomRulesState,
  ManagedAssetState,
  ManagedAssetSyncResult,
  ManagedAssetsState,
  ProjectSummary,
} from "../domain/types";
import type { AppUpdaterState } from "../../updater/domain/types";
import { SettingsView } from "./SettingsView";

afterEach(cleanup);

const project: ProjectSummary = {
  rootPath: "/projects/workflow-labs",
  initialized: true,
  projectId: "prj_1",
  name: "workflow-labs",
  compatibility: "current",
  activeLeases: [],
  workflows: [],
};

const updater: AppUpdaterState = {
  phase: "idle",
  version: null,
  progress: null,
  error: null,
  check: vi.fn().mockResolvedValue(undefined),
  install: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue(undefined),
};

const idleManagedAssets: ManagedAssetsState = {
  syncing: false,
  result: null,
  error: null,
  trigger: null,
};

const customRules: CustomRulesState = {
  document: {
    status: "absent",
    enabled: false,
    appliesTo: [],
    body: "",
    updatedAt: null,
    modifiedAt: null,
    raw: null,
    contentHash: null,
    error: null,
  },
  reading: false,
  previewing: false,
  saving: false,
  preview: null,
  previewBaselineContentHash: null,
  saveResult: null,
  readError: null,
  previewError: null,
  saveError: null,
};

const customRulesActions: CustomRulesActions = {
  preparePreview: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
  reload: vi.fn().mockResolvedValue(true),
  clearFeedback: vi.fn(),
};

// 백엔드가 내려주는 일곱 자산이다. 역할 계약 셋의 제공 버전이 서로 다른 것이 이 화면의 핵심이라
// 픽스처도 실제 값 8·7·8을 쓴다.
function currentAssets(): ManagedAssetState[] {
  return [
    { id: "workflow_rules", label: "공통 규칙", status: "current", installedVersion: 13, providedVersion: 13, reason: null },
    { id: "planner_rules", label: "기획자 역할 계약", status: "current", installedVersion: 8, providedVersion: 8, reason: null },
    { id: "architect_rules", label: "아키텍트 역할 계약", status: "current", installedVersion: 7, providedVersion: 7, reason: null },
    { id: "developer_rules", label: "개발자 역할 계약", status: "current", installedVersion: 8, providedVersion: 8, reason: null },
    { id: "agents_entry", label: "AGENTS 진입 안내", status: "current", installedVersion: null, providedVersion: null, reason: null },
    { id: "claude_entry", label: "CLAUDE 진입 안내", status: "current", installedVersion: null, providedVersion: null, reason: null },
    { id: "claim_helper", label: "선점 헬퍼", status: "current", installedVersion: 3, providedVersion: 3, reason: null },
  ];
}

function result(overrides: Partial<ManagedAssetSyncResult> = {}): ManagedAssetSyncResult {
  return {
    status: "current",
    assets: currentAssets(),
    updatedAssets: [],
    reason: null,
    affectedAsset: null,
    rollbackFailures: [],
    rollbackRecoveries: [],
    ...overrides,
  };
}

function renderSettings(
  managedAssets: ManagedAssetsState = idleManagedAssets,
  summary: ProjectSummary = project,
) {
  render(
    <SettingsView
      customRules={customRules}
      customRulesActions={customRulesActions}
      managedAssets={managedAssets}
      project={summary}
      updater={updater}
      onSwitchProject={vi.fn()}
    />,
  );
}

function managedCard() {
  return screen.getByRole("region", { name: "관리 규칙" });
}

// 같은 자산 이름이 요약 행과 자산 목록에 함께 나오므로, 이 헬퍼는 자산 목록 안에서만 찾는다.
function assetRow(label: string) {
  const rows = Array.from(
    managedCard().querySelectorAll<HTMLLIElement>(".managed-rules-assets > li"),
  );
  const row = rows.find((item) => item.querySelector("strong")?.textContent === label);
  if (!row) throw new Error(`${label} 자산 행을 찾지 못했습니다`);
  return within(row);
}

function detailRow(label: string) {
  const row = within(managedCard()).getByText(label).closest("div");
  if (!row) throw new Error(`${label} 요약 행을 찾지 못했습니다`);
  return within(row);
}

describe("SettingsView", () => {
  it("keeps the three app settings cards", () => {
    renderSettings();

    expect(screen.getByText("앱 업데이트")).toBeInTheDocument();
    expect(screen.getByText("현재 프로젝트")).toBeInTheDocument();
    expect(screen.getByText("파일 감시")).toBeInTheDocument();
  });

  // R3. 연동은 전용 뷰로 옮겼다. 같은 조작이 두 화면에 중복해 존재하면 사용자가 어느 쪽을 봐야
  // 하는지 알 수 없다.
  it("no longer holds the integrations section", () => {
    renderSettings();

    expect(screen.queryByRole("region", { name: "연동" })).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 프로젝트에 역할 잡 설치" })).not.toBeInTheDocument();
  });

  it("describes only what the screen still shows", () => {
    renderSettings();

    const description = screen.getByText(/앱 업데이트와 현재 프로젝트의/);
    expect(description).not.toHaveTextContent("연동");
  });
});

describe("SettingsView 관리 규칙 카드", () => {
  // 완료 조건 1. 현재 프로젝트 카드와 섞이면 프로젝트 정보와 규칙 설치 상태를 구분할 수 없다.
  it("stands apart from the current project card", () => {
    renderSettings({ ...idleManagedAssets, result: result(), trigger: "project_open" });

    const card = managedCard();
    expect(within(card).getByText("관리 규칙")).toBeInTheDocument();
    expect(within(card).queryByText("현재 프로젝트")).not.toBeInTheDocument();
    expect(within(card).queryByText("/projects/workflow-labs")).not.toBeInTheDocument();
  });

  // 완료 조건 2. 세 역할 계약을 하나의 공통 숫자로 합치면 어느 계약이 뒤처졌는지 알 수 없다.
  it("shows each role contract version on its own row", () => {
    renderSettings({ ...idleManagedAssets, result: result(), trigger: "project_open" });

    expect(assetRow("공통 규칙").getByText("설치 13 · 제공 13")).toBeInTheDocument();
    expect(assetRow("기획자 역할 계약").getByText("설치 8 · 제공 8")).toBeInTheDocument();
    expect(assetRow("아키텍트 역할 계약").getByText("설치 7 · 제공 7")).toBeInTheDocument();
    expect(assetRow("개발자 역할 계약").getByText("설치 8 · 제공 8")).toBeInTheDocument();
    expect(assetRow("선점 헬퍼").getByText("설치 3 · 제공 3")).toBeInTheDocument();
  });

  // 화면 계약. 버전이 없는 진입 안내에 숫자를 만들지 않는다.
  it("never invents a version for the entry guides", () => {
    renderSettings({ ...idleManagedAssets, result: result(), trigger: "project_open" });

    expect(assetRow("AGENTS 진입 안내").getByText("버전을 쓰지 않는 자산")).toBeInTheDocument();
    expect(assetRow("CLAUDE 진입 안내").getByText("버전을 쓰지 않는 자산")).toBeInTheDocument();
    expect(assetRow("AGENTS 진입 안내").queryByText(/설치/)).not.toBeInTheDocument();
  });

  // 완료 조건 2. 설치 버전을 읽지 못한 것과 버전을 쓰지 않는 것은 다른 사실이다.
  it("says the installed version could not be read instead of leaving it blank", () => {
    const assets = currentAssets().map((asset) =>
      asset.id === "workflow_rules"
        ? { ...asset, status: "update_required" as const, installedVersion: null }
        : asset,
    );
    renderSettings({
      ...idleManagedAssets,
      result: result({ assets }),
      trigger: "project_open",
    });

    expect(assetRow("공통 규칙").getByText("설치 확인 못 함 · 제공 13")).toBeInTheDocument();
  });

  // 완료 조건 3. 네 결과는 상태 이름도 후속 행동도 서로 달라야 한다.
  it("separates the four sync results", () => {
    renderSettings({ ...idleManagedAssets, result: result(), trigger: "project_open" });
    expect(within(managedCard()).getByText("현재 상태")).toBeInTheDocument();
    expect(within(managedCard()).getByText(/파일을 쓰지 않았습니다/)).toBeInTheDocument();
    cleanup();

    renderSettings({
      ...idleManagedAssets,
      result: result({ status: "updated", updatedAssets: ["developer_rules"] }),
      trigger: "manual_refresh",
    });
    expect(within(managedCard()).getByText("갱신됨")).toBeInTheDocument();
    expect(detailRow("갱신한 자산").getByText("개발자 역할 계약")).toBeInTheDocument();
    cleanup();

    renderSettings({
      ...idleManagedAssets,
      result: result({
        status: "retry_required",
        reason: "다른 프로젝트 쓰기 작업이 진행 중입니다.",
      }),
      trigger: "project_open",
    });
    expect(within(managedCard()).getByText("재시도 필요")).toBeInTheDocument();
    expect(within(managedCard()).getByText(/잠시 뒤 새로 고침/)).toBeInTheDocument();
    cleanup();

    renderSettings({
      ...idleManagedAssets,
      result: result({ status: "conflict", reason: "선점 헬퍼: 관리 형식이 아닙니다." }),
      trigger: "manual_refresh",
    });
    expect(within(managedCard()).getByText("충돌")).toBeInTheDocument();
    expect(within(managedCard()).getByText(/파일을 정리한 뒤/)).toBeInTheDocument();
  });

  // 완료 조건 5. 기다리면 풀리는 잠금과 사용자가 파일을 봐야 하는 충돌을 같은 문구로 합치지 않는다.
  it("does not reuse one sentence for the lock and the conflict", () => {
    renderSettings({
      ...idleManagedAssets,
      result: result({ status: "retry_required", reason: "쓰기 잠금" }),
      trigger: "project_open",
    });
    const retryGuide = within(managedCard()).getByText(/다른 쓰기 작업 때문에/).textContent;
    cleanup();

    renderSettings({
      ...idleManagedAssets,
      result: result({ status: "conflict", reason: "충돌" }),
      trigger: "project_open",
    });
    const conflictGuide = within(managedCard()).getByText(/덮어쓰지 않았습니다/).textContent;

    expect(retryGuide).not.toEqual(conflictGuide);
  });

  // 완료 조건 4. 어느 자산을 왜 확인해야 하는지 카드에서 바로 읽혀야 한다.
  it("names the conflicting asset and the backend reason", () => {
    const assets = currentAssets().map((asset) =>
      asset.id === "architect_rules"
        ? {
            ...asset,
            status: "conflict" as const,
            installedVersion: 9,
            reason: "설치 버전 9가 앱이 제공하는 7보다 높습니다.",
          }
        : asset,
    );
    renderSettings({
      ...idleManagedAssets,
      result: result({
        status: "conflict",
        assets,
        affectedAsset: "architect_rules",
        reason: "아키텍트 역할 계약: 설치 버전 9가 앱이 제공하는 7보다 높습니다.",
      }),
      trigger: "manual_refresh",
    });

    expect(within(managedCard()).getByText("확인할 자산")).toBeInTheDocument();
    expect(assetRow("아키텍트 역할 계약").getByText("충돌")).toBeInTheDocument();
    expect(assetRow("아키텍트 역할 계약").getByText("설치 9 · 제공 7")).toBeInTheDocument();
    expect(
      assetRow("아키텍트 역할 계약").getByText("설치 버전 9가 앱이 제공하는 7보다 높습니다."),
    ).toBeInTheDocument();
  });

  it("keeps the recovery paths the rollback left behind", () => {
    renderSettings({
      ...idleManagedAssets,
      result: result({
        status: "conflict",
        reason: "선점 헬퍼: 저장하지 못했습니다.",
        affectedAsset: "claim_helper",
        rollbackFailures: [{
          assetId: "workflow_rules",
          label: "공통 규칙",
          reason: "원본을 되돌리지 못했습니다.",
          recoveryPath: "/projects/workflow-labs/.workflow/rules/workflow.md.bak",
        }],
      }),
      trigger: "manual_refresh",
    });

    expect(within(managedCard()).getByText("공통 규칙 되돌리기 실패")).toBeInTheDocument();
    expect(
      within(managedCard()).getByText(/workflow.md.bak/),
    ).toBeInTheDocument();
  });

  // 화면 계약. 마지막 동기화를 실행한 계기가 결과와 함께 보여야 한다.
  it("records which action ran the last synchronization", () => {
    renderSettings({ ...idleManagedAssets, result: result(), trigger: "manual_refresh" });

    expect(within(managedCard()).getByText("마지막 동기화")).toBeInTheDocument();
    expect(within(managedCard()).getByText("수동 새로 고침")).toBeInTheDocument();
  });

  // 화면 계약. 화면이 스스로 현재 여부를 추정하지 않는다.
  it("explains why a compatibility-limited project has no result yet", () => {
    renderSettings(idleManagedAssets, { ...project, compatibility: "migration_required" });

    expect(within(managedCard()).getByText("아직 동기화하지 않았습니다")).toBeInTheDocument();
    expect(
      within(managedCard()).getByText(/현재 문서 규격이 아닌 프로젝트/),
    ).toBeInTheDocument();
    expect(within(managedCard()).queryByText("현재 상태")).not.toBeInTheDocument();
  });

  it("reports a failed synchronization command without hiding the project", () => {
    renderSettings({
      ...idleManagedAssets,
      error: "관리 자산 동기화 명령을 호출하지 못했습니다.",
      trigger: "project_open",
    });

    expect(within(managedCard()).getByText("동기화 명령이 실패했습니다")).toBeInTheDocument();
    expect(
      within(managedCard()).getByText("관리 자산 동기화 명령을 호출하지 못했습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("현재 프로젝트")).toBeInTheDocument();
  });

  // 완료 조건 7·8. 다음 세션부터 적용된다고만 적고, 실행 중인 세션에 적용됐다고는 하지 않는다.
  it("promises the next session and never the running one", () => {
    renderSettings({ ...idleManagedAssets, result: result({ status: "updated", updatedAssets: ["workflow_rules"] }), trigger: "project_open" });

    const note = within(managedCard()).getByText(/다음에 시작하는 에이전트 세션부터/);
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent("실행 중인 세션이 새 규칙을 읽었는지는 앱이 알 수 없습니다");
  });

  // 완료 조건 11. 이 작업은 커스텀 가드레일 편집을 포함하지 않는다.
  it("adds no custom rule editing control", () => {
    renderSettings({ ...idleManagedAssets, result: result(), trigger: "project_open" });

    expect(within(managedCard()).queryByRole("button")).not.toBeInTheDocument();
    expect(within(managedCard()).queryByRole("textbox")).not.toBeInTheDocument();
  });
});
