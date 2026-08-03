import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../domain/types";
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

function renderSettings() {
  render(
    <SettingsView project={project} updater={updater} onSwitchProject={vi.fn()} />,
  );
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
