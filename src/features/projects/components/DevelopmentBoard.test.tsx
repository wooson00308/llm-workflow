import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOLLOW_UP_LABEL } from "../domain/specDecisionLabels";
import type {
  TaskDependency,
  TaskDependencyState,
  TaskOverlapBlock,
  TaskQaBatchEntry,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
import { DevelopmentBoard } from "./DevelopmentBoard";

const today = new Date();

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

const todayKey = localDateKey(today);
const otherDayKey = localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() === 1 ? 2 : 1));

function localDateKeyOf(at: string) {
  return localDateKey(new Date(at));
}

function dayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(year, month - 1, day));
}

function dayCell(container: HTMLElement, key: string) {
  const cell = container.querySelector(`time[datetime="${key}"]`)?.parentElement;
  if (!cell) throw new Error(`${key} 칸을 찾지 못했습니다.`);
  return cell;
}

afterEach(cleanup);
// 접힘 검사가 저장소에 쓰지만 따로 비울 것이 없다. 이 환경의 전역 `localStorage`는 메서드가 없는 빈
// 객체이고 값은 `stubStorage()`가 검사마다 새로 만드는 `Map`에만 쌓이므로, 이 한 줄이 곧 정리다.
afterEach(() => vi.unstubAllGlobals());

const tasks: WorkflowItemSummary[] = [
  { fileName: "TASK-001.md", id: "TASK-001", title: "파서 구현", status: "in_progress", updatedAt: "2026-07-30T09:00:00Z", dueAt: todayKey, excerpt: "문서 상태를 읽는다." },
  { fileName: "TASK-002.md", id: "TASK-002", title: "사용자 QA", status: "qa_waiting", updatedAt: "2026-07-30T08:00:00Z", dueAt: null, excerpt: "실제 흐름을 확인한다." },
];

// 확인 사실 10의 실제 재현 데이터. TASK-049 요약문 원문이고 33자 무공백 런이 그대로 들어 있다.
// 이 런을 접게 하는 CSS 선언 자체는 `boardCardOverflow.test.ts`가 확인한다.
const overflowRun = "(`HeartbeatCard.tsx:246`~`:252`).";
const overflowExcerpt = `SPEC-016 R2·R4·R7·R8·R9·R10·R11을 구현한다. TASK-048이 스냅샷에 실어 둔 단계 목록을 화면이 처음으로 읽는다. 지금 안내는 명령 두 줄이고 미설치 분기에만 붙어 있다${overflowRun}`;

function workflowWith(
  items: WorkflowItemSummary[] = tasks,
  specs: WorkflowItemSummary[] = [],
): WorkflowSummary {
  return {
    id: "wf_1",
    directory: "feature--wf_1",
    name: "Feature",
    status: "active",
    createdAt: "2026-07-30T00:00:00Z",
    counts: { ideas: 0, specs: specs.length, decisions: 0, tasks: items.length, reports: 0 },
    items: { ideas: [], specs, tasks: items },
  };
}

function taskReader(item: WorkflowItemSummary = tasks[1]) {
  return vi.fn().mockResolvedValue({
    summary: item,
    body: `# ${item.title}\n\n## 작업 범위\n\n${item.excerpt}`,
  });
}

function openDefaultQaTask() {
  fireEvent.click(screen.getByRole("button", { name: /사용자 QA QA 시작/ }));
  fireEvent.click(screen.getByRole("button", { name: "문제 있는 단계 열기" }));
}

function structuredTaskBody({ includeRisk = true, incomplete = false } = {}) {
  return [
    `# ${tasks[1].title}`,
    "",
    "## 결정권자 요약",
    "",
    "### 제안",
    "",
    "작업 QA 화면에 결정 보드를 둔다.",
    "",
    "### 현재",
    "",
    "완료 결과와 영향 범위를 한눈에 비교하기 어렵다.",
    "",
    "### 변경 후",
    "",
    "확인 결과와 유지 영역을 나눠 읽는다.",
    "",
    "### 사용자 결과",
    "",
    "QA 도장을 찍기 전에 결과를 빠르게 확인한다.",
    "",
    "### 영향 범위",
    "",
    "- 변경: 단건 작업 QA의 기본 요약 화면",
    ...(incomplete ? [] : ["- 유지: QA 기록 인자와 원문 Markdown"]),
    ...(includeRisk ? ["", "### 비용과 위험", "", "반려하면 작업이 개발 준비로 돌아간다."] : []),
    "",
    "### 결정 요청",
    "",
    "단건 QA 결과가 기대와 같은지 확인한다.",
    "",
    "## 확인 동선",
    "",
    "작업 카드를 열고 결정 보드와 QA 도장을 확인한다.",
    "",
    "## 작업 범위",
    "",
    "원문 마지막에서 검증 범위를 다시 설명한다.",
  ].join("\n");
}

function dependencyReader(
  dependencies: TaskDependency[],
  dependencyFormatError = false,
  overlapBlocks: TaskOverlapBlock[] = [],
) {
  const item = tasks[0];
  return vi.fn().mockResolvedValue({
    summary: item,
    body: `# ${item.title}`,
    dependencies,
    dependencyFormatError,
    overlapBlocks,
  });
}

function laneTask(
  id: string,
  status: string,
  sourceSpecId: string | null,
  extra: Partial<WorkflowItemSummary> = {},
): WorkflowItemSummary {
  return {
    fileName: `${id}.md`,
    id,
    title: `${id} 작업`,
    status,
    updatedAt: "2026-08-01T00:00:00Z",
    dueAt: null,
    excerpt: "",
    sourceSpecId,
    ...extra,
  };
}

/** 묶기를 켠 보드를 그린다. 레인 검사가 전부 이 상태에서 시작한다. */
function renderLanes(workflow: WorkflowSummary) {
  const view = render(
    <DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflow} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "기획서별 묶기" }));
  return view;
}

/** 일괄 확인 콜백을 갈아 끼운 채 묶기를 켠 보드를 그린다. 일괄 검사가 전부 이 상태에서 시작한다. */
function renderBatchLanes(
  workflow: WorkflowSummary,
  onTaskQaBatch: (fileNames: string[], comment: string) => Promise<TaskQaBatchEntry[] | null>,
) {
  const view = render(
    <DevelopmentBoard
      busy={false}
      onReadTask={taskReader()}
      onTaskQa={vi.fn()}
      onTaskQaBatch={onTaskQaBatch}
      workflow={workflow}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "기획서별 묶기" }));
  return view;
}

/** 일괄 확인 화면을 연다. 레인 헤더의 액션 하나가 유일한 입구다. */
function openBatchDialog(count: number) {
  fireEvent.click(screen.getByRole("button", { name: `이 그룹 ${count}건 QA 확인` }));
  return screen.getByRole("dialog");
}

/** 성공으로 기록된 건별 결과. 앱이 요청 순서 그대로 돌려주는 모양이다. */
function recordedEntry(id: string): TaskQaBatchEntry {
  return { fileName: `${id}.md`, taskId: id, recorded: true, message: null };
}

/** 무장하고 한 번 더 눌러 실제로 실행한다. 확인 사실 10의 2단계 무장 확인이다. */
function fireBatch(dialog: HTMLElement, count: number) {
  fireEvent.click(within(dialog).getByRole("button", { name: `선택한 ${count}건 확인 완료` }));
  fireEvent.click(within(dialog).getByRole("button", { name: "한 번 더 누르면 완료" }));
}

/** 레인 하나를 그 안 보드의 region 이름으로 집는다. */
function laneOf(container: HTMLElement, label: string) {
  const lane = within(container).getByRole("region", { name: label }).closest(".task-lane");
  if (!lane) throw new Error(`${label} 레인을 찾지 못했습니다.`);
  return lane as HTMLElement;
}

function laneCountsOf(container: HTMLElement, label: string) {
  return laneOf(container, label).querySelector(".task-lane-counts");
}

const LANE_COLLAPSE_KEY = "workflow-labs.spec-lane-collapse.v1";

/** `browserSpecLaneCollapseStore.test.ts`와 같은 대체 저장소. 화면이 쓴 값을 그대로 읽어 볼 수 있다. */
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

/**
 * 레인 하나를 접기 버튼으로 집는다. 접힌 레인에는 보드 region이 없어 `laneOf`가 닿지 않는다.
 *
 * `key`는 레인 키다 — 기획서 id이거나 미분류 레인의 `미분류`. 버튼 이름이 제목이 아니라 이 키로
 * 지어지므로 제목이 겹치는 레인이 있어도 하나만 집힌다.
 */
function laneByToggle(key: string) {
  const toggle = screen.getByRole("button", { name: new RegExp(`^${key} 레인 `) });
  const lane = toggle.closest(".task-lane");
  if (!lane) throw new Error(`${key} 레인을 찾지 못했습니다.`);
  return { lane: lane as HTMLElement, toggle };
}

/** 저장소에 쌓인 이 화면의 접힘 맵. 화면이 실제로 쓴 값을 그대로 읽는다. */
function storedCollapse(stored: Map<string, string>, directory = "feature--wf_1") {
  return JSON.parse(stored.get(LANE_COLLAPSE_KEY) ?? "{}")[directory];
}

async function openDependencyDetail(
  dependencies: TaskDependency[],
  dependencyFormatError = false,
  overlapBlocks: TaskOverlapBlock[] = [],
  /** 목록 payload. 선행의 제목을 여기서 찾으므로 제목 검사가 이 값을 갈아 끼운다. */
  items: WorkflowItemSummary[] = tasks,
) {
  render(
    <DevelopmentBoard
      busy={false}
      onReadTask={dependencyReader(dependencies, dependencyFormatError, overlapBlocks)}
      onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()}
      workflow={workflowWith(items)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));
  return await screen.findByRole("region", { name: "선행 작업" });
}

/** 선행 한 건의 문장. id 칩 옆에 서므로 그 칩을 기준으로 집는다. */
function sentenceOf(block: HTMLElement, id: string) {
  return within(block).getByText(id).parentElement?.querySelector("p")?.textContent;
}

/**
 * 시작 가능 여부의 한 줄. 선행 상자 헤더가 아니라 상태 배지 옆에 서므로 화면 전체에서 집는다
 * (SPEC-039 R5).
 */
function startState(label: "시작 가능" | "시작할 수 없음") {
  return screen.queryByText(label);
}

describe("DevelopmentBoard", () => {
  it("groups development tasks by their actual status", () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

    expect(screen.getByRole("region", { name: "개발 작업 칸반 보드" })).toBeInTheDocument();
    expect(screen.getByText("파서 구현")).toBeInTheDocument();
    expect(screen.getAllByText("사용자 QA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("진행 중").length).toBeGreaterThan(0);
    expect(screen.getAllByText("QA 대기").length).toBeGreaterThan(0);
  });

  it("turns ready spec work into one user journey and keeps unfinished specs out", async () => {
    const readyUi = laneTask("TASK-S051-09", "qa_waiting", "SPEC-051", {
      title: "에이전트 설치 화면 확인",
      excerpt: "에이전트 화면에서 설치 계획을 열고 적용 결과를 확인한다.",
    });
    const readyEvidence = laneTask("TASK-S051-07", "qa_waiting", "SPEC-051", {
      title: "역할 정책 저장 계약",
      excerpt: "화면은 이 작업의 범위가 아니다. 자동 검사 결과로 확인한다.",
    });
    const items = [
      laneTask("TASK-S051-01", "completed", "SPEC-051"),
      readyEvidence,
      readyUi,
      laneTask("TASK-S055-03", "qa_waiting", "SPEC-055", {
        title: "아키텍트 판정 계약",
        excerpt: "이 작업에는 눈으로 볼 화면이 없다. 자동 검사 결과로 확인한다.",
      }),
      laneTask("TASK-S055-04", "todo", "SPEC-055", { title: "정의 수정 화면" }),
    ];
    const specs = [
      laneTask("SPEC-051", "approved", null, { title: "프로젝트 에이전트 실행", excerpt: "설치부터 실행까지 확인합니다." }),
      laneTask("SPEC-055", "approved", null, { title: "막힌 작업 정의 수정" }),
    ];
    const onTaskQaBatch = vi.fn().mockResolvedValue([
      recordedEntry("TASK-S051-07"),
      recordedEntry("TASK-S051-09"),
    ]);
    const { container } = render(
      <DevelopmentBoard busy={false} onReadTask={taskReader(readyUi)} onTaskQa={vi.fn()} onTaskQaBatch={onTaskQaBatch} workflow={workflowWith(items, specs)} />,
    );

    const hub = screen.getByRole("region", { name: "사용자 QA" });
    expect(within(hub).getByRole("heading", { name: "확인할 기능" })).toBeInTheDocument();
    expect(within(hub).getByText("프로젝트 에이전트 실행")).toBeInTheDocument();
    expect(within(hub).queryByText("막힌 작업 정의 수정")).not.toBeInTheDocument();
    expect(within(hub).queryByText("TASK-S051-09")).not.toBeInTheDocument();
    expect(within(hub).getByText("직접 확인 1단계")).toBeInTheDocument();
    expect(within(hub).getByText("자동 검증 1건")).toBeInTheDocument();
    expect(container.querySelector(".task-column.tone-review")).toBeNull();
    expect(screen.getByText("내 확인 1")).toBeInTheDocument();
    expect(screen.getByText("3개 표시 · 완료는 최근 3개만 표시")).toBeInTheDocument();

    fireEvent.click(within(hub).getByRole("button", { name: "프로젝트 에이전트 실행 QA 시작" }));
    expect(screen.getByRole("heading", { name: "프로젝트 에이전트 실행" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "직접 확인 단계" })).getByText("에이전트 설치 화면 확인")).toBeInTheDocument();
    expect(screen.queryByText("TASK-S051-09")).not.toBeInTheDocument();
    expect(screen.getByText("자동으로 확인된 항목 1건")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/확인 메모/), { target: { value: "설치와 실행 흐름 확인" } });
    fireEvent.click(screen.getByRole("button", { name: "이 기능 확인 완료" }));
    fireEvent.click(screen.getByRole("button", { name: "한 번 더 누르면 완료" }));
    await waitFor(() => expect(onTaskQaBatch).toHaveBeenCalledWith(
      ["TASK-S051-07.md", "TASK-S051-09.md"],
      "설치와 실행 흐름 확인",
    ));
  });

  it("carries the recorded overflow excerpt into the user QA step", () => {
    // jsdom은 레이아웃을 계산하지 않으므로 이 시나리오가 보장하는 것은 "이 데이터가 단계에 실린다"까지다.
    // 상자 크기를 묻지 않는다 — 물으면 전부 0이 돌아와 통과하는 것처럼 보이는 거짓 검사가 된다.
    const items: WorkflowItemSummary[] = [{ ...tasks[1], excerpt: overflowExcerpt }];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);

    fireEvent.click(screen.getByRole("button", { name: /사용자 QA QA 시작/ }));
    expect(within(screen.getByRole("list", { name: "직접 확인 단계" })).getByText(overflowExcerpt)).toHaveTextContent(overflowRun);
  });

  it("shares search and status filters across view modes", () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

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

  it("places tasks on the timeline by transition time instead of due_at", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T04:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const timeline = screen.getByRole("region", { name: "개발 작업 타임라인" });
    expect(within(dayCell(timeline, todayKey)).getByText("시작")).toBeInTheDocument();
  });

  it("drops the due_at placement wording from the timeline header", () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    expect(screen.getByText("상태 전이 기록 기준")).toBeInTheDocument();
    expect(screen.queryByText("일정 미지정")).not.toBeInTheDocument();
    expect(screen.queryByText(/due_at을 추가하면/)).not.toBeInTheDocument();
  });

  it("folds a day into one chip per event kind", () => {
    const items: WorkflowItemSummary[] = [1, 2, 3].map((index) => ({
      fileName: `TASK-10${index}.md`,
      id: `TASK-10${index}`,
      title: `작업 ${index}`,
      status: "qa_waiting",
      updatedAt: `${todayKey}T00:00:00Z`,
      dueAt: null,
      excerpt: "",
      events: [
        { kind: "in_progress", at: `${todayKey}T01:00:00Z` },
        { kind: "qa_waiting", at: `${todayKey}T02:00:00Z` },
      ],
    }));
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(cell.querySelectorAll(".calendar-count")).toHaveLength(2);
    expect(within(cell).getByText("시작").parentElement).toHaveTextContent("시작3");
    expect(within(cell).getByText("QA 대기").parentElement).toHaveTextContent("QA 대기3");
  });

  it("keeps every completed task on the timeline while the board still truncates", () => {
    const completed = [1, 2, 3, 4].map((day) => ({
      fileName: `TASK-00${day}.md`,
      id: `TASK-00${day}`,
      title: `완료 작업 ${day}`,
      status: "completed",
      updatedAt: `2026-07-0${day}T00:00:00Z`,
      dueAt: null,
      excerpt: "",
      events: [{ kind: "completed", at: `${todayKey}T05:00:00Z` }],
    }));
    render(<DevelopmentBoard busy={false} onReadTask={taskReader(completed[0])} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(completed)} />);

    expect(screen.getByText("3개 표시 · 완료는 최근 3개만 표시")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(within(cell).getByText("완료").parentElement).toHaveTextContent("완료4");
    expect(screen.getByText("4개 표시 · 완료 작업까지 전부 표시")).toBeInTheDocument();
    expect(screen.queryByText(/완료는 최근 3개만 표시/)).not.toBeInTheDocument();
  });

  it("narrows timeline events with the shared search and status filters", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T01:00:00Z` }] },
      { ...tasks[1], dueAt: null, events: [{ kind: "qa_waiting", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const cell = () => dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(cell().querySelectorAll(".calendar-count")).toHaveLength(2);

    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "qa_waiting" } });
    expect(within(cell()).getByText("QA 대기")).toBeInTheDocument();
    expect(within(cell()).queryByText("시작")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "파서" } });
    expect(within(cell()).getByText("시작")).toBeInTheDocument();
    expect(within(cell()).queryByText("QA 대기")).not.toBeInTheDocument();
  });

  it("skips unreadable event times and unknown kinds without breaking the grid", () => {
    const items: WorkflowItemSummary[] = [
      {
        ...tasks[0],
        dueAt: null,
        events: [
          { kind: "created", at: "어제" },
          { kind: "탈락", at: `${todayKey}T03:00:00Z` },
          { kind: "blocked", at: `${todayKey}T03:00:00Z` },
        ],
      },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const cell = dayCell(screen.getByRole("region", { name: "개발 작업 타임라인" }), todayKey);
    expect(cell.querySelectorAll(".calendar-count")).toHaveLength(1);
    expect(within(cell).getByText("막힘")).toBeInTheDocument();
  });

  it("groups events by the local date of the transition instant", () => {
    const at = `${todayKey}T23:00:00Z`;
    const localKey = localDateKeyOf(at);
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "completed", at }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const timeline = screen.getByRole("region", { name: "개발 작업 타임라인" });
    expect(within(dayCell(timeline, localKey)).getByText("완료")).toBeInTheDocument();
    if (localKey !== todayKey) {
      expect(within(dayCell(timeline, todayKey)).queryByText("완료")).not.toBeInTheDocument();
    }
  });

  it("opens a day's events in time order with the task id, title and kind", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "qa_waiting", at: `${todayKey}T08:00:00Z` }] },
      { ...tasks[1], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 2건` }));

    const entries = screen.getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("시작");
    expect(entries[0]).toHaveTextContent("TASK-002");
    expect(entries[0]).toHaveTextContent("사용자 QA");
    expect(entries[1]).toHaveTextContent("QA 대기");
    expect(entries[1]).toHaveTextContent("TASK-001");
    expect(entries[1]).toHaveTextContent("파서 구현");
  });

  it("opens the task detail from a timeline event entry", async () => {
    const onReadTask = taskReader(tasks[0]);
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "blocked", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={onReadTask} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 1건` }));
    fireEvent.click(within(screen.getByRole("listitem")).getByRole("button"));

    await waitFor(() => expect(onReadTask).toHaveBeenCalledWith("TASK-001.md"));
    expect(await screen.findByRole("button", { name: "← 개발 작업으로" })).toBeInTheDocument();
  });

  it("leaves days without events out of the keyboard order", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const timeline = screen.getByRole("region", { name: "개발 작업 타임라인" });
    expect(dayCell(timeline, todayKey).tagName).toBe("BUTTON");
    expect(timeline.querySelectorAll(".calendar-grid > button")).toHaveLength(1);
  });

  it("selects a day with the keyboard and exposes the selection", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
      { ...tasks[1], dueAt: null, events: [{ kind: "qa_waiting", at: `${otherDayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));

    const target = screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 1건` });
    const other = screen.getByRole("button", { name: `${dayLabel(otherDayKey)}, 이벤트 1건` });
    expect(target).toHaveAttribute("aria-pressed", "false");

    // 기본 키보드 조작을 그대로 쓰므로, 날짜 칸이 초점을 받는 진짜 button인지까지 확인한다.
    target.focus();
    expect(document.activeElement).toBe(target);
    expect(target.tagName).toBe("BUTTON");

    fireEvent.click(target);
    expect(target).toHaveAttribute("aria-pressed", "true");
    expect(other).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the month and filters untouched while opening and closing a day", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "파서" } });

    const monthTitle = screen.getByRole("heading", { level: 2 }).textContent;
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 1건` }));
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(monthTitle ?? "");
    expect(screen.getByRole("textbox", { name: "작업 검색" })).toHaveValue("파서");
  });

  it("lists both entries when one task transitions twice on the same day", () => {
    const items: WorkflowItemSummary[] = [
      {
        ...tasks[0],
        dueAt: null,
        events: [
          { kind: "in_progress", at: `${todayKey}T02:00:00Z` },
          { kind: "qa_waiting", at: `${todayKey}T06:00:00Z` },
        ],
      },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 2건` }));

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("clears the day selection when the month changes", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    fireEvent.click(screen.getByRole("button", { name: `${dayLabel(todayKey)}, 이벤트 1건` }));
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
  });

  it("reports tasks that never reach the timeline and drops the notice once they do", () => {
    const withEvents: WorkflowItemSummary = { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] };
    const view = render(
      <DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith([withEvents, { ...tasks[1], dueAt: null }])} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    expect(screen.getByText("기록이 없어 타임라인에 표시되지 않는 작업 1건")).toBeInTheDocument();

    view.rerender(
      <DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith([withEvents])} />,
    );
    expect(screen.queryByText(/기록이 없어 타임라인에 표시되지 않는 작업/)).not.toBeInTheDocument();
  });

  it("tells an empty month apart from a month emptied by filters", () => {
    const items: WorkflowItemSummary[] = [
      { ...tasks[0], dueAt: null, events: [{ kind: "in_progress", at: `${todayKey}T02:00:00Z` }] },
    ];
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />);
    fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
    expect(screen.queryByText("이 달에 기록된 전이가 없습니다.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.getByText("이 달에 기록된 전이가 없습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "오늘" }));
    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "없는작업" } });
    expect(screen.getByText("필터 조건에 맞는 기록이 이 달에 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("이 달에 기록된 전이가 없습니다.")).not.toBeInTheDocument();
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
    render(<DevelopmentBoard busy={false} onReadTask={taskReader(completed[0])} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(completed)} />);

    expect(screen.getByText("완료 작업 4")).toBeInTheDocument();
    expect(screen.getByText("완료 작업 3")).toBeInTheDocument();
    expect(screen.getByText("완료 작업 2")).toBeInTheDocument();
    expect(screen.queryByText("완료 작업 1")).not.toBeInTheDocument();
  });

  it("lets the user confirm a QA waiting task", async () => {
    const onTaskQa = vi.fn().mockResolvedValue(true);
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={onTaskQa} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

    openDefaultQaTask();
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
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={onTaskQa} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

    openDefaultQaTask();
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
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={onTaskQa} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

    openDefaultQaTask();
    await screen.findByLabelText("테스트 플로우와 확인 메모");
    const submit = screen.getByRole("button", { name: "개발 준비로 되돌리기" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("테스트 플로우와 확인 메모"), {
      target: { value: "빈 상태에서 다시 확인해 주세요." },
    });

    fireEvent.click(submit);
    expect(onTaskQa).not.toHaveBeenCalled();
    expect(screen.getByText("작업을 개발 준비로 되돌리고 수정 요청을 기록합니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "한 번 더 누르면 되돌리기" }));
    await waitFor(() =>
      expect(onTaskQa).toHaveBeenCalledWith(
        "TASK-002.md",
        "revision_requested",
        "빈 상태에서 다시 확인해 주세요.",
      ),
    );
  });

  // 승인된 기획에 할 말이 있어 누른 것이 개발 작업의 반려가 되는 사고가 두 자리가 같은 이름을 쓴
  // 데서 났다. 무장 전후 두 문면과 확인 문구가 기획서 쪽 이름을 쓰지 않는다(SPEC-042 R5).
  it("does not call the QA rejection what a specification decision is called", async () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn().mockResolvedValue(true)} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

    openDefaultQaTask();
    await screen.findByLabelText("테스트 플로우와 확인 메모");
    fireEvent.change(screen.getByLabelText("테스트 플로우와 확인 메모"), {
      target: { value: "빈 상태에서 다시 확인해 주세요." },
    });

    for (const name of ["수정 요청", "수정 요청 기록", FOLLOW_UP_LABEL, `${FOLLOW_UP_LABEL} 기록`]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }

    // 무엇이 대상이고 무엇이 일어나는지가 이름과 확인 문구에서 함께 읽힌다.
    fireEvent.click(screen.getByRole("button", { name: "개발 준비로 되돌리기" }));
    expect(screen.getByRole("button", { name: "한 번 더 누르면 되돌리기" })).toBeInTheDocument();
    expect(screen.getByText("작업을 개발 준비로 되돌리고 수정 요청을 기록합니다.")).toBeInTheDocument();
  });

  it("resizes the QA side panel and remembers the width", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

    openDefaultQaTask();
    const handle = await screen.findByRole("separator", { name: "QA 패널 너비 조절" });
    expect(handle).toHaveAttribute("aria-valuenow", "340");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "364");
    expect(storage.get("llm-workflow.task-qa-panel-width")).toBe("364");

    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute("aria-valuenow", "340");
  });

  it("opens a non-QA card as a read-only detail page", async () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader(tasks[0])} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    await screen.findByRole("button", { name: "← 개발 작업으로" });
    expect(screen.getByText("문서 상태를 읽는다.")).toBeInTheDocument();
    expect(screen.queryByLabelText("테스트 플로우와 확인 메모")).not.toBeInTheDocument();
    expect(screen.getByText("QA 대기 상태가 되면 확인 도구가 활성화됩니다.")).toBeInTheDocument();
  });

  // 이 검사가 막는 것은 지금의 결함이 아니라 개행 표시가 이 화면까지 조용히 넓어지는 일이다.
  // DECISION-6F1B8C53의 승인된 확인 필요 1번이 적용 범위를 아이디어 문서뷰 한 곳으로 정했다.
  it("leaves a soft line break unbroken in the task detail", async () => {
    const body = ["첫 줄은 배경이다.", "둘째 줄은 원인이다."].join("\n");
    const onReadTask = vi.fn().mockResolvedValue({ summary: tasks[0], body });
    const { container } = render(
      <DevelopmentBoard busy={false} onReadTask={onReadTask} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    await screen.findByRole("button", { name: "← 개발 작업으로" });
    const paragraphs = container.querySelectorAll(".markdown-body p");
    expect(paragraphs).toHaveLength(1);
    expect(container.querySelectorAll(".markdown-body br")).toHaveLength(0);
    expect(paragraphs[0]).toHaveTextContent("첫 줄은 배경이다.");
    expect(paragraphs[0]).toHaveTextContent("둘째 줄은 원인이다.");
  });

  it("leaves the detail untouched when a task declares no dependency", async () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader(tasks[0])} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    await screen.findByRole("button", { name: "← 개발 작업으로" });
    expect(screen.queryByRole("region", { name: "선행 작업" })).not.toBeInTheDocument();
  });

  it("reads every declared dependency as ready when all are satisfied", async () => {
    const block = await openDependencyDetail([
      { id: "TASK-100", state: "satisfied" },
      { id: "TASK-101", state: "satisfied" },
    ]);

    expect(sentenceOf(block, "TASK-100")).toBe("선행 작업 TASK-100의 진행이 끝났습니다.");
    expect(sentenceOf(block, "TASK-101")).toBe("선행 작업 TASK-101의 진행이 끝났습니다.");
    expect(startState("시작 가능")).toBeInTheDocument();
    expect(within(block).queryByText(/선언을 고쳐야/)).not.toBeInTheDocument();
  });

  it("calls a dependency by the title the task list already carries", async () => {
    const block = await openDependencyDetail([{ id: "TASK-002", state: "pending" }]);

    expect(sentenceOf(block, "TASK-002")).toBe(
      '선행 작업 "사용자 QA"의 진행이 아직 끝나지 않았습니다. 그 작업이 끝나면 이 선언은 풀립니다.',
    );
    // 제목으로 불러도 id가 문장 옆에 남는다.
    expect(within(block).getByText("TASK-002")).toBeInTheDocument();
  });

  it("speaks with the id alone when the list has no title for the dependency", async () => {
    const block = await openDependencyDetail([{ id: "TASK-404", state: "missing" }]);

    expect(sentenceOf(block, "TASK-404")).toBe(
      "선행 작업 TASK-404의 문서가 없습니다. 기다려서 풀리지 않고 선언을 고쳐야 열립니다.",
    );
  });

  it("tells a satisfied dependency apart from a pending one", async () => {
    const block = await openDependencyDetail([
      { id: "TASK-100", state: "satisfied" },
      { id: "TASK-101", state: "pending" },
    ]);

    expect(sentenceOf(block, "TASK-100")).toBe("선행 작업 TASK-100의 진행이 끝났습니다.");
    expect(sentenceOf(block, "TASK-101")).toBe(
      "선행 작업 TASK-101의 진행이 아직 끝나지 않았습니다. 그 작업이 끝나면 이 선언은 풀립니다.",
    );
    expect(startState("시작할 수 없음")).toBeInTheDocument();
    // 기다리면 풀리는 판정에는 선언을 고치라는 말이 붙지 않는다.
    expect(within(block).queryByText(/선언을 고쳐야/)).not.toBeInTheDocument();
  });

  it("marks a missing dependency id as never satisfied", async () => {
    const block = await openDependencyDetail([{ id: "TASK-404", state: "missing" }]);

    expect(sentenceOf(block, "TASK-404")).toContain("문서가 없습니다");
    expect(sentenceOf(block, "TASK-404")).toContain("기다려서 풀리지 않고 선언을 고쳐야 열립니다.");
    expect(startState("시작할 수 없음")).toBeInTheDocument();
  });

  it("marks a cyclic declaration as never satisfied and apart from a missing id", async () => {
    const block = await openDependencyDetail([{ id: "TASK-100", state: "cyclic" }]);

    expect(sentenceOf(block, "TASK-100")).toBe(
      "선행 작업 TASK-100의 선언이 돌아서 어느 쪽도 먼저일 수 없습니다. 기다려서 풀리지 않고 선언을 고쳐야 열립니다.",
    );
    expect(within(block).queryByText(/문서가 없습니다/)).not.toBeInTheDocument();
  });

  it("says a dependency state outside the contract is outside it", async () => {
    const block = await openDependencyDetail([{ id: "TASK-100", state: "archived" as TaskDependencyState }]);

    expect(sentenceOf(block, "TASK-100")).toBe("선행 작업 TASK-100의 판정값이 규격 밖입니다(받은 값 archived).");
    // 규격 밖 값이 기다리면 풀리는 쪽인지 앱은 모른다. 아는 척하지 않는다.
    expect(within(block).queryByText(/선언을 고쳐야/)).not.toBeInTheDocument();
    expect(startState("시작할 수 없음")).toBeInTheDocument();
  });

  it("reports a broken declaration without inventing the list it could not read", async () => {
    const block = await openDependencyDetail([], true);

    expect(
      within(block).getByText("선행 선언을 목록으로 읽지 못했습니다. 기다려서 풀리지 않고 선언을 고쳐야 열립니다."),
    ).toBeInTheDocument();
    expect(block.querySelectorAll(".task-dependency")).toHaveLength(0);
    expect(startState("시작할 수 없음")).toBeInTheDocument();
  });

  it("keeps the declared order instead of sorting the dependencies", async () => {
    const block = await openDependencyDetail([
      { id: "TASK-900", state: "pending" },
      { id: "TASK-100", state: "satisfied" },
      { id: "TASK-500", state: "missing" },
    ]);

    const ids = [...block.querySelectorAll(".task-dependency > strong")].map((entry) => entry.textContent);
    expect(ids).toEqual(["TASK-900", "TASK-100", "TASK-500"]);
  });

  it("stops calling a task startable while an active lease overlaps it", async () => {
    const block = await openDependencyDetail(
      [{ id: "TASK-100", state: "satisfied" }],
      false,
      [{ leaseTargetId: "TASK-101", sharedFiles: ["src/App.css", "src/features/projects/domain/types.ts"] }],
    );

    expect(sentenceOf(block, "TASK-100")).toBe("선행 작업 TASK-100의 진행이 끝났습니다.");
    expect(startState("시작 가능")).not.toBeInTheDocument();
    expect(startState("시작할 수 없음")).toBeInTheDocument();
    expect(sentenceOf(block, "TASK-101")).toBe(
      "범위가 겹치는 상대는 다른 세션이 잡은 문서 TASK-101입니다."
        + " 겹친 경로는 src/App.css, src/features/projects/domain/types.ts입니다."
        + " 그 세션의 lease가 풀리면 이 겹침은 사라집니다.",
    );
  });

  it("draws the overlap of a task that declares no dependency at all", async () => {
    const block = await openDependencyDetail([], false, [
      { leaseTargetId: "TASK-104", sharedFiles: ["src-tauri/src/infrastructure/heartbeat_condition.rs"] },
    ]);

    expect(block.querySelectorAll(".task-dependency")).toHaveLength(0);
    expect(sentenceOf(block, "TASK-104")).toContain(
      "겹친 경로는 src-tauri/src/infrastructure/heartbeat_condition.rs입니다.",
    );
    expect(startState("시작할 수 없음")).toBeInTheDocument();
  });

  it("tells an undeclared scope apart from a shared path when it reports an overlap", async () => {
    const block = await openDependencyDetail([], false, [{ leaseTargetId: "TASK-104", sharedFiles: [] }]);

    expect(sentenceOf(block, "TASK-104")).toBe(
      "범위가 겹치는 상대는 다른 세션이 잡은 문서 TASK-104입니다."
        + " 두 작업 중 한쪽의 범위 선언이 없거나 형식이 잘못되어 겹친 것으로 봅니다."
        + " 그 세션의 lease가 풀리면 이 겹침은 사라집니다.",
    );
    expect(within(block).queryByText(/겹친 경로/)).not.toBeInTheDocument();
  });

  it("keeps an overlap out of the sentence reserved for declarations that never open", async () => {
    const block = await openDependencyDetail([], false, [
      { leaseTargetId: "TASK-104", sharedFiles: ["src/App.css"] },
    ]);

    expect(within(block).queryByText(/선언을 고쳐야/)).not.toBeInTheDocument();
    expect(sentenceOf(block, "TASK-104")).toContain("그 세션의 lease가 풀리면 이 겹침은 사라집니다.");
  });

  it("shows an unsatisfied dependency and an overlap side by side", async () => {
    const block = await openDependencyDetail(
      [{ id: "TASK-100", state: "missing" }],
      false,
      [{ leaseTargetId: "TASK-104", sharedFiles: ["src/App.css"] }],
    );

    expect(sentenceOf(block, "TASK-100")).toContain("기다려서 풀리지 않고 선언을 고쳐야 열립니다.");
    expect(sentenceOf(block, "TASK-104")).toContain("그 세션의 lease가 풀리면 이 겹침은 사라집니다.");
  });

  it("leaves the startable reading alone when nothing overlaps the task", async () => {
    const block = await openDependencyDetail([{ id: "TASK-100", state: "satisfied" }], false, []);

    expect(startState("시작 가능")).toBeInTheDocument();
    expect(block.querySelectorAll(".task-overlap")).toHaveLength(0);
    expect(within(block).queryByText(/lease가 풀리면/)).not.toBeInTheDocument();
  });

  it("reads the startable state beside the status badge instead of inside the dependency box", async () => {
    const block = await openDependencyDetail([{ id: "TASK-100", state: "satisfied" }]);

    // 옮긴 것이지 복제한 것이 아니다. 같은 사실이 선행 상자에 남아 있으면 두 자리에서 말하게 된다.
    expect(within(block).queryByText("시작 가능")).not.toBeInTheDocument();
    const state = startState("시작 가능")?.closest(".task-detail-state");
    expect(state).not.toBeNull();
    // 지금 상태와 시작 가능 여부가 같은 자리에서 읽힌다.
    expect(within(state as HTMLElement).getByText("진행 중")).toBeInTheDocument();
  });

  it("says nothing about startability when a task declares no structure at all", async () => {
    render(<DevelopmentBoard busy={false} onReadTask={taskReader(tasks[0])} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    await screen.findByRole("button", { name: "← 개발 작업으로" });
    // 판정할 구조가 없는 작업을 "시작 가능"이라고 부르면 자리를 옮기는 대신 새 사실을 만드는 것이다.
    expect(startState("시작 가능")).not.toBeInTheDocument();
    expect(startState("시작할 수 없음")).not.toBeInTheDocument();
  });

  it("opens a task body at its decision summary and keeps the source one toggle away", async () => {
    const body = [
      `# ${tasks[0].title}`,
      "",
      "## 결정권자 요약",
      "",
      "이 작업이 끝나면 평문이 먼저 열립니다.",
      "",
      "## 작업 범위",
      "",
      "작업자가 작업자에게 쓴 본문입니다.",
    ].join("\n");
    const onReadTask = vi.fn().mockResolvedValue({ summary: tasks[0], body });
    render(<DevelopmentBoard busy={false} onReadTask={onReadTask} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    await screen.findByRole("button", { name: "← 개발 작업으로" });
    expect(screen.getByText("이 작업이 끝나면 평문이 먼저 열립니다.")).toBeInTheDocument();
    expect(screen.queryByText("작업자가 작업자에게 쓴 본문입니다.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "원문 전문 보기" }));
    expect(await screen.findByText("작업자가 작업자에게 쓴 본문입니다.")).toBeInTheDocument();
    expect(screen.getByText("이 작업이 끝나면 평문이 먼저 열립니다.")).toBeInTheDocument();
  });

  it("keeps a structured task board, walkthrough, and QA callback in one keyboard flow", async () => {
    const user = userEvent.setup();
    const onReadTask = vi.fn().mockResolvedValue({ summary: tasks[1], body: structuredTaskBody() });
    const onTaskQa = vi.fn().mockResolvedValue(true);
    const onTaskQaBatch = vi.fn();
    const { container } = render(
      <DevelopmentBoard
        busy={false}
        onReadTask={onReadTask}
        onTaskQa={onTaskQa}
        onTaskQaBatch={onTaskQaBatch}
        workflow={workflowWith()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /사용자 QA QA 시작/ }));
    await user.click(screen.getByRole("button", { name: "문제 있는 단계 열기" }));
    const board = await screen.findByRole("region", { name: "결정 보드" });
    expect(within(board).getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "결정 보드", "제안", "현재", "변경 후", "사용자 결과", "영향 범위", "비용과 위험", "결정 요청",
    ]);
    expect(within(board).getByText("단건 QA 결과가 기대와 같은지 확인한다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "개발 준비로 되돌리기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확인 완료" })).toBeInTheDocument();
    expect(screen.getAllByText("작업 카드를 열고 결정 보드와 QA 도장을 확인한다.")).toHaveLength(1);
    expect(onReadTask).toHaveBeenCalledTimes(1);
    expect(onTaskQa).not.toHaveBeenCalled();
    expect(onTaskQaBatch).not.toHaveBeenCalled();

    screen.getByRole("button", { name: "← QA로 돌아가기" }).focus();
    await user.tab();
    const sourceToggle = screen.getByRole("button", { name: "원문 전문 보기" });
    expect(sourceToggle).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "결정권자 요약" })).toBeInTheDocument();
    expect(within(documentOf(container)).getByText("원문 마지막에서 검증 범위를 다시 설명한다.")).toBeInTheDocument();
    expect(screen.getAllByText("작업 카드를 열고 결정 보드와 QA 도장을 확인한다.")).toHaveLength(2);

    await user.tab();
    expect(screen.getByRole("separator", { name: "QA 패널 너비 조절" })).toHaveFocus();
    await user.tab();
    const memo = screen.getByLabelText("테스트 플로우와 확인 메모");
    expect(memo).toHaveFocus();
    await user.type(memo, "보드와 원문을 키보드로 확인함");
    await user.tab();
    expect(screen.getByRole("button", { name: "개발 준비로 되돌리기" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "확인 완료" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(onTaskQa).toHaveBeenCalledWith("TASK-002.md", "confirmed", "보드와 원문을 키보드로 확인함"),
    );
  });

  it("falls back for an incomplete task and keeps inactive QA read-only on a riskless board", async () => {
    const onTaskQa = vi.fn();
    const incompleteReader = vi.fn().mockResolvedValue({
      summary: tasks[1],
      body: structuredTaskBody({ incomplete: true }),
    });
    const view = render(
      <DevelopmentBoard
        busy={false}
        onReadTask={incompleteReader}
        onTaskQa={onTaskQa}
        onTaskQaBatch={vi.fn()}
        workflow={workflowWith()}
      />,
    );

    openDefaultQaTask();
    await screen.findByLabelText("테스트 플로우와 확인 메모");
    expect(screen.queryByRole("region", { name: "결정 보드" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "제안" })).toBeInTheDocument();
    expect(screen.queryByText(/빠진|오류|보완/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확인 완료" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "← QA로 돌아가기" }));
    fireEvent.click(screen.getByRole("button", { name: "← 개발 작업으로" }));
    const inactiveReader = vi.fn().mockResolvedValue({
      summary: tasks[0],
      body: structuredTaskBody({ includeRisk: false }),
    });
    view.rerender(
      <DevelopmentBoard
        busy={false}
        onReadTask={inactiveReader}
        onTaskQa={onTaskQa}
        onTaskQaBatch={vi.fn()}
        workflow={workflowWith()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));
    await screen.findByText("QA 대기 상태가 되면 확인 도구가 활성화됩니다.");
    expect(screen.getByRole("region", { name: "결정 보드" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "비용과 위험" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("테스트 플로우와 확인 메모")).not.toBeInTheDocument();
    expect(onTaskQa).not.toHaveBeenCalled();
  });

  it("starts at the summary again after the detail is closed and opened", async () => {
    const body = [
      `# ${tasks[0].title}`,
      "",
      "## 결정권자 요약",
      "",
      "이 작업이 끝나면 평문이 먼저 열립니다.",
      "",
      "## 작업 범위",
      "",
      "작업자가 작업자에게 쓴 본문입니다.",
    ].join("\n");
    const onReadTask = vi.fn().mockResolvedValue({ summary: tasks[0], body });
    render(<DevelopmentBoard busy={false} onReadTask={onReadTask} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));
    await screen.findByRole("button", { name: "← 개발 작업으로" });
    fireEvent.click(screen.getByRole("button", { name: "원문 전문 보기" }));
    fireEvent.click(screen.getByRole("button", { name: "← 개발 작업으로" }));

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));
    await screen.findByRole("button", { name: "← 개발 작업으로" });
    // 토글 상태를 저장하지 않는다. 문서를 열 때마다 평문에서 시작한다.
    expect(screen.getByRole("button", { name: "원문 전문 보기" })).toBeInTheDocument();
    expect(screen.queryByText("작업자가 작업자에게 쓴 본문입니다.")).not.toBeInTheDocument();
  });

  // 확인 동선이 도장 옆에서 읽힌다(SPEC-039 R7). 대상은 단건 QA 패널뿐이고, 일괄 QA 다이얼로그는
  // 목록 payload에 본문이 없어 이번 범위 밖이다.
  const WALKTHROUGH_LINE = "개발 작업 화면에서 QA 대기 카드를 열면 도장 옆에 동선이 보입니다.";

  function walkthroughBody(section: string) {
    return [
      `# ${tasks[1].title}`,
      "",
      "## 결정권자 요약",
      "",
      "이 작업이 끝나면 평문이 먼저 열립니다.",
      "",
      section,
      "",
      WALKTHROUGH_LINE,
      "",
      "## 작업 범위",
      "",
      "작업자가 작업자에게 쓴 본문입니다.",
    ].join("\n");
  }

  function panelOf(container: HTMLElement) {
    return container.querySelector(".task-qa-panel") as HTMLElement;
  }

  function documentOf(container: HTMLElement) {
    return container.querySelector(".task-detail-document") as HTMLElement;
  }

  it("brings the confirmation walkthrough next to the QA stamp", async () => {
    const onReadTask = vi.fn().mockResolvedValue({ summary: tasks[1], body: walkthroughBody("## 확인 동선") });
    const { container } = render(
      <DevelopmentBoard busy={false} onReadTask={onReadTask} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />,
    );

    openDefaultQaTask();

    await screen.findByLabelText("테스트 플로우와 확인 메모");
    const walkthrough = within(panelOf(container)).getByRole("region", { name: "확인 동선" });
    expect(within(walkthrough).getByText(WALKTHROUGH_LINE)).toBeInTheDocument();
    // 확인 메모와 도장이 같은 패널에 있다. 동선을 읽으러 왼쪽 본문을 뒤지지 않는다.
    expect(within(panelOf(container)).getByLabelText("테스트 플로우와 확인 메모")).toBeInTheDocument();
    expect(within(panelOf(container)).getByRole("button", { name: "확인 완료" })).toBeInTheDocument();
    // 옮긴 것이지 복제한 것이 아니다. 기본 뷰에는 같은 문단이 남지 않는다.
    expect(within(documentOf(container)).queryByText(WALKTHROUGH_LINE)).not.toBeInTheDocument();
    expect(screen.getAllByText(WALKTHROUGH_LINE)).toHaveLength(1);

    // 원문은 자르지 않은 본문 그대로다. 토글 뒤에서는 동선 절도 보인다.
    fireEvent.click(screen.getByRole("button", { name: "원문 전문 보기" }));
    expect(within(documentOf(container)).getByText(WALKTHROUGH_LINE)).toBeInTheDocument();
  });

  it("leaves the QA panel as it is when the task document has no walkthrough", async () => {
    const body = [`# ${tasks[1].title}`, "", "## 작업 범위", "", "작업자가 작업자에게 쓴 본문입니다."].join("\n");
    const onReadTask = vi.fn().mockResolvedValue({ summary: tasks[1], body });
    const { container } = render(
      <DevelopmentBoard busy={false} onReadTask={onReadTask} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />,
    );

    openDefaultQaTask();

    await screen.findByLabelText("테스트 플로우와 확인 메모");
    expect(screen.queryByRole("region", { name: "확인 동선" })).not.toBeInTheDocument();
    // 없다는 문구를 붙이지 않는다. 이 저장소의 옛 작업 대부분에 그 절이 없어 같은 줄이 거의 모든
    // 화면에 뜨게 된다.
    expect(panelOf(container).textContent).not.toContain("확인 동선");
    expect(within(documentOf(container)).getByText("작업자가 작업자에게 쓴 본문입니다.")).toBeInTheDocument();
  });

  it("finds the walkthrough by one heading and guesses no other candidate", async () => {
    const onReadTask = vi.fn().mockResolvedValue({ summary: tasks[1], body: walkthroughBody("## 확인 절차") });
    const { container } = render(
      <DevelopmentBoard busy={false} onReadTask={onReadTask} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />,
    );

    openDefaultQaTask();

    await screen.findByLabelText("테스트 플로우와 확인 메모");
    expect(screen.queryByRole("region", { name: "확인 동선" })).not.toBeInTheDocument();
    expect(within(panelOf(container)).queryByText(WALKTHROUGH_LINE)).not.toBeInTheDocument();
  });

  it("leaves the walkthrough out of a detail that has no QA tools", async () => {
    const body = walkthroughBody("## 확인 동선");
    const onReadTask = vi.fn().mockResolvedValue({ summary: tasks[0], body });
    const { container } = render(
      <DevelopmentBoard busy={false} onReadTask={onReadTask} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /파서 구현/ }));

    await screen.findByRole("button", { name: "← 개발 작업으로" });
    // 확인 도구가 없는 자리에 확인 동선만 띄우지 않는다.
    expect(screen.queryByRole("region", { name: "확인 동선" })).not.toBeInTheDocument();
    expect(within(panelOf(container)).getByText("QA 대기 상태가 되면 확인 도구가 활성화됩니다.")).toBeInTheDocument();
  });

  it("splits the board into lanes by the source spec of each task", () => {
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-001"), laneTask("TASK-202", "qa_waiting", "SPEC-002")];
    const { container } = renderLanes(workflowWith(items));

    const first = laneOf(container, "SPEC-001 칸반 보드");
    const second = laneOf(container, "SPEC-002 칸반 보드");
    expect(within(first).getByText("TASK-201 작업")).toBeInTheDocument();
    expect(within(first).queryByText("TASK-202 작업")).not.toBeInTheDocument();
    expect(within(second).getByText("TASK-202 작업")).toBeInTheDocument();
  });

  it("starts with grouping off and returns the plain board when it is turned off again", () => {
    const { container } = render(
      <DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />,
    );

    const toggle = screen.getByRole("button", { name: "기획서별 묶기" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("region", { name: "개발 작업 칸반 보드" })).toBeInTheDocument();
    expect(container.querySelectorAll(".task-lane")).toHaveLength(0);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll(".task-lane").length).toBeGreaterThan(0);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("region", { name: "개발 작업 칸반 보드" })).toBeInTheDocument();
    expect(container.querySelectorAll(".task-lane")).toHaveLength(0);
    expect(screen.getByText("파서 구현")).toBeInTheDocument();
    expect(screen.queryByText(/레인의 수치와 QA 신호는/)).not.toBeInTheDocument();
  });

  it("names the spec behind a lane and falls back to the bare id when the spec is unknown", () => {
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-001"), laneTask("TASK-202", "qa_waiting", "SPEC-777")];
    const base = workflowWith(items);
    const workflow: WorkflowSummary = {
      ...base,
      items: {
        ...base.items,
        specs: [
          {
            fileName: "SPEC-001.md",
            id: "SPEC-001",
            title: "레인 기획",
            status: "user_review",
            updatedAt: "2026-08-01T00:00:00Z",
            excerpt: "",
          },
        ],
      },
    };
    const { container } = renderLanes(workflow);

    const known = laneOf(container, "SPEC-001 칸반 보드").querySelector(".task-lane-header");
    expect(known).toHaveTextContent("레인 기획");
    expect(known).toHaveTextContent("SPEC-001");

    const unknown = laneOf(container, "SPEC-777 칸반 보드").querySelector(".task-lane-header");
    expect(unknown?.querySelector("strong")).toHaveTextContent("SPEC-777");
    expect(unknown?.querySelectorAll("small")).toHaveLength(0);
  });

  it("breaks the lane header count down by status instead of one percentage", () => {
    const items = [
      laneTask("TASK-201", "todo", "SPEC-001"),
      laneTask("TASK-202", "qa_waiting", "SPEC-001"),
      laneTask("TASK-203", "qa_waiting", "SPEC-001"),
    ];
    const { container } = renderLanes(workflowWith(items));

    const counts = laneCountsOf(container, "SPEC-001 칸반 보드");
    expect(counts).toHaveTextContent("전체 기준");
    expect(counts).toHaveTextContent("준비 1");
    expect(counts).toHaveTextContent("진행 중 0");
    expect(counts).toHaveTextContent("막힘 0");
    expect(counts).toHaveTextContent("QA 대기 2");
    expect(counts).toHaveTextContent("완료 0");
    expect(container.textContent).not.toContain("%");
  });

  it("lights the lane signal only when nothing but QA waiting is left", () => {
    const items = [
      laneTask("TASK-201", "qa_waiting", "SPEC-001"),
      laneTask("TASK-202", "qa_waiting", "SPEC-002"),
      laneTask("TASK-203", "todo", "SPEC-002"),
    ];
    const { container } = renderLanes(workflowWith(items));

    expect(within(laneOf(container, "SPEC-001 칸반 보드")).getByText("QA 대기만 남음 · 통째로 QA 가능")).toBeInTheDocument();
    expect(
      within(laneOf(container, "SPEC-002 칸반 보드")).queryByText("QA 대기만 남음 · 통째로 QA 가능"),
    ).not.toBeInTheDocument();
  });

  it("keeps a todo hidden by the status filter from lighting the lane signal", () => {
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-002"), laneTask("TASK-202", "todo", "SPEC-002")];
    const { container } = renderLanes(workflowWith(items));
    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "qa_waiting" } });

    const lane = laneOf(container, "SPEC-002 칸반 보드");
    expect(within(lane).queryByText("TASK-202 작업")).not.toBeInTheDocument();
    expect(lane.querySelector(".task-lane-counts")).toHaveTextContent("준비 1");
    expect(within(lane).queryByText("QA 대기만 남음 · 통째로 QA 가능")).not.toBeInTheDocument();
  });

  it("counts every completed task in the header while the board still truncates the cards", () => {
    const items = [1, 2, 3, 4].map((day) =>
      laneTask(`TASK-30${day}`, "completed", "SPEC-003", { updatedAt: `2026-07-0${day}T00:00:00Z` }),
    );
    const { container } = renderLanes(workflowWith(items));

    // 헤더는 전체 4건을 말하고 카드는 절단된 3장만 보인다. 이 어긋남이 정상이다.
    const lane = laneOf(container, "SPEC-003 칸반 보드");
    expect(lane.querySelector(".task-lane-counts")).toHaveTextContent("완료 4");
    expect(lane.querySelectorAll(".task-card")).toHaveLength(3);
  });

  it("keeps tasks without a source spec in an unassigned lane and never signals it", () => {
    const items = [laneTask("TASK-201", "qa_waiting", null), laneTask("TASK-202", "qa_waiting", "SPEC-001")];
    const { container } = renderLanes(workflowWith(items));

    const lane = laneOf(container, "미분류 칸반 보드");
    expect(within(lane).getByText("TASK-201 작업")).toBeInTheDocument();
    expect(lane.querySelector(".task-lane-header")).toHaveTextContent("미분류");
    expect(lane.querySelector(".task-lane-counts")).toHaveTextContent("QA 대기 1");
    expect(within(lane).queryByText("QA 대기만 남음 · 통째로 QA 가능")).not.toBeInTheDocument();
  });

  it("drops a lane with no card left and says how many lanes went missing", () => {
    const items = [
      laneTask("TASK-401", "completed", "SPEC-004", { updatedAt: "2026-07-01T00:00:00Z" }),
      laneTask("TASK-501", "completed", "SPEC-005", { updatedAt: "2026-07-05T00:00:00Z" }),
      laneTask("TASK-502", "completed", "SPEC-005", { updatedAt: "2026-07-06T00:00:00Z" }),
      laneTask("TASK-503", "completed", "SPEC-005", { updatedAt: "2026-07-07T00:00:00Z" }),
    ];
    const { container } = renderLanes(workflowWith(items));

    expect(container.querySelectorAll(".task-lane")).toHaveLength(1);
    expect(screen.getByText("완료만 있어 표시하지 않은 기획서 1개")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "작업 검색" }), { target: { value: "TASK-501" } });
    expect(screen.getByText("조건에 맞는 카드가 없어 표시하지 않은 기획서 1개")).toBeInTheDocument();
    expect(screen.queryByText("완료만 있어 표시하지 않은 기획서 1개")).not.toBeInTheDocument();
  });

  it("puts signalled lanes first, then id order, and the unassigned lane last", () => {
    const items = [
      laneTask("TASK-201", "qa_waiting", null),
      laneTask("TASK-202", "todo", "SPEC-002"),
      laneTask("TASK-203", "qa_waiting", "SPEC-003"),
      laneTask("TASK-204", "qa_waiting", "SPEC-001"),
    ];
    const { container } = renderLanes(workflowWith(items));

    const titles = [...container.querySelectorAll(".task-lane-header strong")].map((entry) => entry.textContent);
    expect(titles).toEqual(["SPEC-001", "SPEC-003", "SPEC-002", "미분류"]);
  });

  it("keeps an off-contract status in the lane count and in the review column", () => {
    const items = [laneTask("TASK-201", "탈락", "SPEC-006"), laneTask("TASK-202", "qa_waiting", "SPEC-006")];
    const { container } = renderLanes(workflowWith(items));

    const lane = laneOf(container, "SPEC-006 칸반 보드");
    expect(lane.querySelector(".task-lane-counts")).toHaveTextContent("규격 밖 1");
    expect(within(lane).getByText("확인 필요")).toBeInTheDocument();
    expect(within(lane).getByText("TASK-201 작업")).toBeInTheDocument();
    expect(within(lane).queryByText("QA 대기만 남음 · 통째로 QA 가능")).not.toBeInTheDocument();
  });

  it("collapses a lane to its header while the counts and the signal stay in view", () => {
    stubStorage();
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-001"), laneTask("TASK-202", "qa_waiting", "SPEC-002")];
    const base = workflowWith(items);
    const workflow: WorkflowSummary = {
      ...base,
      items: {
        ...base.items,
        specs: [
          {
            fileName: "SPEC-001.md",
            id: "SPEC-001",
            title: "레인 기획",
            status: "user_review",
            updatedAt: "2026-08-01T00:00:00Z",
            excerpt: "",
          },
        ],
      },
    };
    const { container } = renderLanes(workflow);

    // 제목이 있어도 버튼 이름은 레인 키로 지어진다. 제목이 겹치는 레인이 있어도 하나만 집힌다.
    fireEvent.click(laneByToggle("SPEC-001").toggle);

    const { lane, toggle } = laneByToggle("SPEC-001");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(lane).toHaveClass("collapsed");
    expect(screen.queryByRole("region", { name: "SPEC-001 칸반 보드" })).not.toBeInTheDocument();
    expect(within(lane).queryByText("TASK-201 작업")).not.toBeInTheDocument();

    // 접기는 카드를 줄이는 것이지 사실을 감추는 것이 아니다. 헤더는 통째로 남는다.
    expect(within(lane).getByText("레인 기획")).toBeInTheDocument();
    expect(lane.querySelector(".task-lane-counts")).toHaveTextContent("QA 대기 1");
    expect(within(lane).getByText("QA 대기만 남음 · 통째로 QA 가능")).toBeInTheDocument();

    expect(within(laneOf(container, "SPEC-002 칸반 보드")).getByText("TASK-202 작업")).toBeInTheDocument();
  });

  it("brings the cards back when a collapsed lane is expanded again", () => {
    stubStorage();
    const { container } = renderLanes(workflowWith([laneTask("TASK-201", "qa_waiting", "SPEC-001")]));

    fireEvent.click(laneByToggle("SPEC-001").toggle);
    expect(screen.queryByRole("region", { name: "SPEC-001 칸반 보드" })).not.toBeInTheDocument();

    fireEvent.click(laneByToggle("SPEC-001").toggle);

    expect(laneByToggle("SPEC-001").toggle).toHaveAttribute("aria-expanded", "true");
    expect(laneByToggle("SPEC-001").lane).not.toHaveClass("collapsed");
    expect(within(laneOf(container, "SPEC-001 칸반 보드")).getByText("TASK-201 작업")).toBeInTheDocument();
  });

  it("keeps a lane collapsed after the board is mounted again", () => {
    const stored = stubStorage();
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-001"), laneTask("TASK-202", "qa_waiting", "SPEC-002")];
    renderLanes(workflowWith(items));
    fireEvent.click(laneByToggle("SPEC-001").toggle);
    expect(storedCollapse(stored)).toEqual({ "SPEC-001": true });

    cleanup();
    renderLanes(workflowWith(items));

    expect(laneByToggle("SPEC-001").toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "SPEC-001 칸반 보드" })).not.toBeInTheDocument();
    // 접은 적 없는 레인은 펼침으로 돌아온다.
    expect(laneByToggle("SPEC-002").toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "SPEC-002 칸반 보드" })).toBeInTheDocument();
  });

  it("stores the collapse under the versioned key and splits it by workflow directory", () => {
    const stored = stubStorage();
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-001")];
    const { rerender } = renderLanes(workflowWith(items));
    fireEvent.click(laneByToggle("SPEC-001").toggle);

    expect([...stored.keys()]).toEqual(["workflow-labs.spec-lane-collapse.v1"]);
    expect(JSON.parse(stored.get(LANE_COLLAPSE_KEY)!)).toEqual({ "feature--wf_1": { "SPEC-001": true } });

    // 디렉터리가 다른 워크플로에는 접힘이 따라오지 않는다. `WorkspaceShell`이 이 컴포넌트에 `key`를
    // 주지 않아 워크플로를 바꿔도 마운트가 유지되므로, 다시 그리는 것이 아니라 프롭을 갈아 끼워 본다.
    rerender(
      <DevelopmentBoard
        busy={false}
        onReadTask={taskReader()}
        onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()}
        workflow={{ ...workflowWith(items), directory: "other--wf_2" }}
      />,
    );
    expect(laneByToggle("SPEC-001").toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "SPEC-001 칸반 보드" })).toBeInTheDocument();

    // 돌아오면 그 워크플로의 접힘도 돌아온다.
    rerender(
      <DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith(items)} />,
    );
    expect(laneByToggle("SPEC-001").toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "SPEC-001 칸반 보드" })).not.toBeInTheDocument();
  });

  it("draws every lane when the stored collapse points at a spec that is gone", () => {
    const stored = stubStorage();
    stored.set(LANE_COLLAPSE_KEY, JSON.stringify({ "feature--wf_1": { "SPEC-404": true, "SPEC-001": true } }));
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-001"), laneTask("TASK-202", "qa_waiting", "SPEC-002")];
    const { container } = renderLanes(workflowWith(items));

    expect(container.querySelectorAll(".task-lane")).toHaveLength(2);
    expect(laneByToggle("SPEC-001").toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(laneOf(container, "SPEC-002 칸반 보드")).getByText("TASK-202 작업")).toBeInTheDocument();

    // 지금 없는 기획서의 값을 정리하지 않는다. 그 레인이 돌아왔을 때 접힘이 남아 있어야 한다.
    fireEvent.click(laneByToggle("SPEC-002").toggle);
    expect(storedCollapse(stored)).toEqual({ "SPEC-404": true, "SPEC-001": true, "SPEC-002": true });
  });

  it("keeps the board and the collapse working when localStorage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("접근이 거부되었습니다.");
      },
      setItem: () => {
        throw new Error("한도를 넘었습니다.");
      },
    });
    const { container } = renderLanes(workflowWith([laneTask("TASK-201", "qa_waiting", "SPEC-001")]));

    expect(within(laneOf(container, "SPEC-001 칸반 보드")).getByText("TASK-201 작업")).toBeInTheDocument();

    fireEvent.click(laneByToggle("SPEC-001").toggle);
    expect(laneByToggle("SPEC-001").toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "SPEC-001 칸반 보드" })).not.toBeInTheDocument();

    fireEvent.click(laneByToggle("SPEC-001").toggle);
    expect(screen.getByRole("region", { name: "SPEC-001 칸반 보드" })).toBeInTheDocument();

    // 표시 상태의 저장 실패를 사용자에게 알리지 않는다.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/실패|오류/);
  });

  it("wraps only the lane board in a scroll box and leaves the header outside it", () => {
    stubStorage();
    renderLanes(workflowWith([laneTask("TASK-201", "qa_waiting", "SPEC-001")]));

    // 좁은 창에서 950px 보드가 레인 테두리 밖으로 빠져나가지 않게 하는 상자다(QA-F25FD89E).
    // 선언 자체는 `specLaneOverflow.test.ts`가 지키고, 여기서는 상자가 실제로 보드를 감싸는지 본다.
    const scroll = screen.getByRole("region", { name: "SPEC-001 칸반 보드" }).parentElement;
    expect(scroll).toHaveClass("task-lane-scroll");
    expect(scroll?.parentElement).toHaveClass("task-lane");
    // 헤더가 상자 밖이라 보드를 옆으로 밀어도 집계와 신호가 남는다.
    expect(scroll?.querySelector(".task-lane-header")).toBeNull();

    // 묶기를 끈 보드에는 이 상자가 생기지 않는다.
    cleanup();
    render(<DevelopmentBoard busy={false} onReadTask={taskReader()} onTaskQa={vi.fn()} onTaskQaBatch={vi.fn()} workflow={workflowWith()} />);
    expect(screen.getByRole("region", { name: "개발 작업 칸반 보드" }).parentElement).not.toHaveClass("task-lane-scroll");
  });

  it("collapses the unassigned lane under its own key instead of a spec id", () => {
    const stored = stubStorage();
    const items = [laneTask("TASK-201", "qa_waiting", null), laneTask("TASK-202", "qa_waiting", "SPEC-001")];
    renderLanes(workflowWith(items));

    fireEvent.click(laneByToggle("미분류").toggle);

    expect(laneByToggle("미분류").lane).toHaveClass("collapsed");
    expect(screen.queryByRole("region", { name: "미분류 칸반 보드" })).not.toBeInTheDocument();
    // 저장 키가 기획서 id와 섞이지 않는다. `browserSpecLaneCollapseStore`의 `UNASSIGNED_LANE_KEY`다.
    expect(storedCollapse(stored)).toEqual({ "#unassigned": true });
    expect(screen.getByRole("region", { name: "SPEC-001 칸반 보드" })).toBeInTheDocument();
  });

  it("puts the batch QA action only on a lane whose signal is lit", () => {
    const items = [
      laneTask("TASK-201", "qa_waiting", "SPEC-001"),
      laneTask("TASK-202", "qa_waiting", "SPEC-001"),
      laneTask("TASK-203", "qa_waiting", "SPEC-002"),
      laneTask("TASK-204", "todo", "SPEC-002"),
      laneTask("TASK-205", "qa_waiting", null),
    ];
    const { container } = renderBatchLanes(workflowWith(items), vi.fn());

    // 문구의 건수가 그 레인의 `qa_waiting` 수와 같다.
    const signalled = laneOf(container, "SPEC-001 칸반 보드");
    expect(within(signalled).getByRole("button", { name: "이 그룹 2건 QA 확인" })).toBeInTheDocument();

    // 신호가 꺼진 레인과 미분류 레인에는 액션 자체가 없다. `lane.signal` 하나로 갈린다.
    expect(within(laneOf(container, "SPEC-002 칸반 보드")).queryByRole("button", { name: /QA 확인$/ })).not.toBeInTheDocument();
    expect(within(laneOf(container, "미분류 칸반 보드")).queryByRole("button", { name: /QA 확인$/ })).not.toBeInTheDocument();
  });

  it("lists every target with its id and title and lets each one be dropped", () => {
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-001"), laneTask("TASK-202", "qa_waiting", "SPEC-001")];
    renderBatchLanes(workflowWith(items), vi.fn());
    const dialog = openBatchDialog(2);

    expect(within(dialog).getByText("TASK-201")).toBeInTheDocument();
    expect(within(dialog).getByText("TASK-201 작업")).toBeInTheDocument();
    // 처음에는 전부 선택이다.
    expect(within(dialog).getAllByRole("checkbox").every((box) => (box as HTMLInputElement).checked)).toBe(true);

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /TASK-201/ }));
    expect(within(dialog).getByRole("button", { name: "선택한 1건 확인 완료" })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /TASK-202/ }));
    expect(within(dialog).getByRole("button", { name: "선택한 0건 확인 완료" })).toBeDisabled();
  });

  it("counts the whole lane even when the status filter hides some of its cards", () => {
    const items = [
      laneTask("TASK-201", "qa_waiting", "SPEC-001"),
      laneTask("TASK-202", "qa_waiting", "SPEC-001"),
      laneTask("TASK-203", "completed", "SPEC-001"),
    ];
    const { container } = renderBatchLanes(workflowWith(items), vi.fn());
    fireEvent.change(screen.getByRole("combobox", { name: "상태 필터" }), { target: { value: "completed" } });

    // 카드는 완료 1장만 남았는데 액션은 여전히 2건을 말한다. 승인된 확인 필요 3번이 정한 어긋남이다.
    const lane = laneOf(container, "SPEC-001 칸반 보드");
    expect(within(lane).queryByText("TASK-201 작업")).not.toBeInTheDocument();

    const dialog = openBatchDialog(2);
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(dialog).getByText("TASK-201 작업")).toBeInTheDocument();
    expect(within(dialog).getByText("필터와 무관하게 이 레인의 QA 대기 전체를 셉니다")).toBeInTheDocument();
  });

  it("calls the app once with every selected file name and the shared comment", async () => {
    const onTaskQaBatch = vi.fn().mockResolvedValue([recordedEntry("TASK-201"), recordedEntry("TASK-203")]);
    const items = [
      laneTask("TASK-201", "qa_waiting", "SPEC-001"),
      laneTask("TASK-202", "qa_waiting", "SPEC-001"),
      laneTask("TASK-203", "qa_waiting", "SPEC-001"),
    ];
    renderBatchLanes(workflowWith(items), onTaskQaBatch);
    const dialog = openBatchDialog(3);

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /TASK-202/ }));
    fireEvent.change(within(dialog).getByLabelText("전 건에 함께 남길 확인 메모"), {
      target: { value: "레인 유저 플로우를 한 번 타 봤습니다." },
    });
    fireBatch(dialog, 2);

    // 일괄 한 번이 앱 호출 한 번이다. 선택된 건수만큼 반복해 부르지 않는다.
    await waitFor(() => expect(onTaskQaBatch).toHaveBeenCalledTimes(1));
    expect(onTaskQaBatch).toHaveBeenCalledWith(
      ["TASK-201.md", "TASK-203.md"],
      "레인 유저 플로우를 한 번 타 봤습니다.",
    );
  });

  it("reads out the recorded count and every failure with its task id and reason", async () => {
    const onTaskQaBatch = vi.fn().mockResolvedValue([
      recordedEntry("TASK-201"),
      { fileName: "TASK-202.md", taskId: "TASK-202", recorded: false, message: "QA 대기 상태가 아닙니다." },
      recordedEntry("TASK-203"),
    ]);
    const items = [
      laneTask("TASK-201", "qa_waiting", "SPEC-001"),
      laneTask("TASK-202", "qa_waiting", "SPEC-001"),
      laneTask("TASK-203", "qa_waiting", "SPEC-001"),
    ];
    renderBatchLanes(workflowWith(items), onTaskQaBatch);
    const dialog = openBatchDialog(3);
    fireBatch(dialog, 3);

    await waitFor(() => expect(within(dialog).getByText("2건을 기록했습니다.")).toBeInTheDocument());
    // 작업 id가 목록에도 있으므로 실패 목록 안에서만 읽는다.
    const failures = dialog.querySelector(".lane-qa-failures");
    expect(failures?.querySelectorAll("li")).toHaveLength(1);
    expect(failures).toHaveTextContent("TASK-202");
    expect(failures).toHaveTextContent("QA 대기 상태가 아닙니다.");
  });

  it("closes the dialog when every selected task is recorded", async () => {
    const onTaskQaBatch = vi.fn().mockResolvedValue([recordedEntry("TASK-201"), recordedEntry("TASK-202")]);
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-001"), laneTask("TASK-202", "qa_waiting", "SPEC-001")];
    renderBatchLanes(workflowWith(items), onTaskQaBatch);
    const dialog = openBatchDialog(2);
    fireBatch(dialog, 2);

    // 전 건 성공은 읽을 실패가 없다. 결과 화면을 붙들지 않고 닫힌다.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says the call itself failed inside the dialog instead of leaving it to a global message", async () => {
    const onTaskQaBatch = vi.fn().mockResolvedValue(null);
    renderBatchLanes(workflowWith([laneTask("TASK-201", "qa_waiting", "SPEC-001")]), onTaskQaBatch);
    const dialog = openBatchDialog(1);
    fireBatch(dialog, 1);

    await waitFor(() =>
      expect(within(dialog).getByText("일괄 확인 호출이 실패해 건별 결과를 받지 못했습니다.")).toBeInTheDocument(),
    );
  });

  it("runs with an empty comment and caps the shared one at two thousand characters", async () => {
    const onTaskQaBatch = vi.fn().mockResolvedValue([recordedEntry("TASK-201")]);
    renderBatchLanes(workflowWith([laneTask("TASK-201", "qa_waiting", "SPEC-001")]), onTaskQaBatch);
    const dialog = openBatchDialog(1);

    expect(within(dialog).getByLabelText("전 건에 함께 남길 확인 메모")).toHaveAttribute("maxlength", "2000");
    fireBatch(dialog, 1);

    await waitFor(() => expect(onTaskQaBatch).toHaveBeenCalledWith(["TASK-201.md"], ""));
  });

  it("arms before it runs, names the count in the warning, and locks the dialog while running", async () => {
    let finish!: (value: TaskQaBatchEntry[] | null) => void;
    const onTaskQaBatch = vi.fn(
      () => new Promise<TaskQaBatchEntry[] | null>((resolve) => {
        finish = resolve;
      }),
    );
    const items = [laneTask("TASK-201", "qa_waiting", "SPEC-001"), laneTask("TASK-202", "qa_waiting", "SPEC-001")];
    renderBatchLanes(workflowWith(items), onTaskQaBatch);
    const dialog = openBatchDialog(2);

    fireEvent.click(within(dialog).getByRole("button", { name: "선택한 2건 확인 완료" }));
    expect(onTaskQaBatch).not.toHaveBeenCalled();
    expect(within(dialog).getByText("선택한 2건을 완료 처리합니다. 되돌릴 수 없습니다.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "한 번 더 누르면 완료" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "선택한 2건 확인 완료" })).toBeDisabled());
    expect(within(dialog).getAllByRole("checkbox")[0]).toBeDisabled();

    await act(async () => {
      finish([recordedEntry("TASK-201"), recordedEntry("TASK-202")]);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the batch action on a collapsed lane", () => {
    stubStorage();
    renderBatchLanes(workflowWith([laneTask("TASK-201", "qa_waiting", "SPEC-001")]), vi.fn());

    fireEvent.click(laneByToggle("SPEC-001").toggle);

    // 접기는 카드를 줄이는 것이지 사실을 감추는 것이 아니다. 헤더가 남으므로 액션도 남는다.
    const { lane } = laneByToggle("SPEC-001");
    expect(lane).toHaveClass("collapsed");
    expect(within(lane).getByRole("button", { name: "이 그룹 1건 QA 확인" })).toBeInTheDocument();
  });
});
