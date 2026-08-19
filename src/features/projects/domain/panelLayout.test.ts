import { describe, expect, it } from "vitest";
import {
  COLLAPSED_PANEL_WIDTH,
  MAIN_CONTENT_MIN_WIDTH,
  PANEL_KEYBOARD_STEP,
  PANEL_LIMITS,
  PANEL_REGIONS,
  READING_WIDTH_MAX,
  READING_WIDTH_MIN,
  clampPanelWidth,
  defaultPanelWidth,
  measureReclaimedWidth,
  resolveReadingWidth,
  resolveRenderedPanelWidths,
  stepPanelWidth,
} from "./panelLayout";

describe("한계값 표", () => {
  it("사이드바는 최소 190px, 최대 380px, 기본 250px이다", () => {
    expect(PANEL_LIMITS.sidebar.minWidth).toBe(190);
    expect(PANEL_LIMITS.sidebar.maxWidth).toBe(380);
    expect(PANEL_LIMITS.sidebar.defaultWidth).toBe(250);
  });

  it("사이드바의 기본 너비는 창 폭 980px 이하에서 210px이다", () => {
    expect(PANEL_LIMITS.sidebar.narrowDefaultWidth).toBe(210);
    expect(defaultPanelWidth("sidebar", 1440)).toBe(250);
    expect(defaultPanelWidth("sidebar", 981)).toBe(250);
    expect(defaultPanelWidth("sidebar", 980)).toBe(210);
    expect(defaultPanelWidth("sidebar", 760)).toBe(210);
  });

  it("기획서 화면 두 패널은 최소 190px, 최대 420px이다", () => {
    expect(PANEL_LIMITS.specList.minWidth).toBe(190);
    expect(PANEL_LIMITS.specList.maxWidth).toBe(420);
    expect(PANEL_LIMITS.specDecision.minWidth).toBe(190);
    expect(PANEL_LIMITS.specDecision.maxWidth).toBe(420);
  });

  it("아이디어 화면 목록 패널은 최소 300px, 최대 520px이다", () => {
    expect(PANEL_LIMITS.ideaList.minWidth).toBe(300);
    expect(PANEL_LIMITS.ideaList.maxWidth).toBe(520);
  });

  // 사이드바 밖의 세 패널에 기본 px 너비를 만들면, 한 번도 조절하지 않은 화면이 비율 배치를 잃고
  // 지금과 달라진다(SPEC-080 R11).
  it("사이드바 밖의 세 패널에는 기본 px 너비가 없다", () => {
    for (const region of ["specList", "specDecision", "ideaList"] as const) {
      expect(PANEL_LIMITS[region].defaultWidth).toBeUndefined();
      expect(PANEL_LIMITS[region].narrowDefaultWidth).toBeUndefined();
      expect(defaultPanelWidth(region, 1440)).toBeUndefined();
      expect(defaultPanelWidth(region, 760)).toBeUndefined();
    }
  });

  it("표가 네 영역을 모두 담는다", () => {
    expect(PANEL_REGIONS).toEqual(["sidebar", "specList", "specDecision", "ideaList"]);
    expect(Object.keys(PANEL_LIMITS).sort()).toEqual([...PANEL_REGIONS].sort());
  });
});

describe("드래그 값 보정", () => {
  it("한계 아래의 값은 최소값으로 자른다", () => {
    expect(clampPanelWidth("specList", 100)).toBe(190);
    expect(clampPanelWidth("ideaList", 0)).toBe(300);
  });

  it("한계 위의 값은 최대값으로 자른다", () => {
    expect(clampPanelWidth("specList", 900)).toBe(420);
    expect(clampPanelWidth("sidebar", 400)).toBe(380);
  });

  it("한계 안의 값은 그대로 돌려준다", () => {
    expect(clampPanelWidth("specList", 300)).toBe(300);
    expect(clampPanelWidth("sidebar", 190)).toBe(190);
    expect(clampPanelWidth("sidebar", 380)).toBe(380);
  });
});

describe("방향키 한 걸음", () => {
  it("늘리면 16px 넓어진다", () => {
    expect(PANEL_KEYBOARD_STEP).toBe(16);
    expect(stepPanelWidth("sidebar", 250, "grow")).toBe(266);
  });

  it("줄이면 16px 좁아진다", () => {
    expect(stepPanelWidth("sidebar", 250, "shrink")).toBe(234);
  });

  it("최소값에서 더 줄여도 움직이지 않는다", () => {
    expect(stepPanelWidth("sidebar", 190, "shrink")).toBe(190);
    expect(stepPanelWidth("ideaList", 300, "shrink")).toBe(300);
  });

  it("최대값에서 더 늘려도 움직이지 않는다", () => {
    expect(stepPanelWidth("sidebar", 380, "grow")).toBe(380);
    expect(stepPanelWidth("specDecision", 420, "grow")).toBe(420);
  });

  // 한 걸음이 한계를 넘어서면 걸음 폭이 아니라 한계값에서 멈춘다.
  it("한계를 넘어서는 걸음은 한계값에서 멈춘다", () => {
    expect(stepPanelWidth("sidebar", 375, "grow")).toBe(380);
    expect(stepPanelWidth("sidebar", 195, "shrink")).toBe(190);
  });
});

describe("그리는 너비 계산", () => {
  it("넉넉한 창에서는 저장된 너비가 그대로 나온다", () => {
    expect(
      resolveRenderedPanelWidths({
        windowWidth: 1440,
        storedWidths: { sidebar: 300, specList: 300 },
        collapsed: [],
      }),
    ).toEqual({ sidebar: 300, specList: 300 });
  });

  it("접힌 영역은 28px이다", () => {
    expect(COLLAPSED_PANEL_WIDTH).toBe(28);
    expect(
      resolveRenderedPanelWidths({
        windowWidth: 1440,
        storedWidths: { specList: 300 },
        collapsed: ["sidebar", "specDecision"],
      }),
    ).toEqual({ sidebar: 28, specList: 300, specDecision: 28 });
  });

  // 접기는 조절한 너비보다 뒤에 있다. 접힌 영역은 저장된 값이 있어도 세로 바 폭으로 그린다.
  it("접힌 영역은 저장된 너비가 있어도 28px이다", () => {
    expect(
      resolveRenderedPanelWidths({
        windowWidth: 1440,
        storedWidths: { sidebar: 320 },
        collapsed: ["sidebar"],
      }),
    ).toEqual({ sidebar: 28 });
  });

  it("좁은 창에서는 본문 340px을 지키는 만큼만 돌려주는 너비가 줄어든다", () => {
    const storedWidths = { sidebar: 300, specList: 300 };

    const rendered = resolveRenderedPanelWidths({ windowWidth: 900, storedWidths, collapsed: [] });

    expect(rendered).toEqual({ sidebar: 280, specList: 280 });
    expect(900 - 280 - 280).toBeGreaterThanOrEqual(MAIN_CONTENT_MIN_WIDTH);
    // 저장된 값은 계산이 건드리지 않는다(SPEC-080 R10).
    expect(storedWidths).toEqual({ sidebar: 300, specList: 300 });
  });

  it("여유에 비례해 줄이고도 본문 340px을 지킨다", () => {
    const rendered = resolveRenderedPanelWidths({
      windowWidth: 1000,
      storedWidths: { sidebar: 380, specList: 420, specDecision: 420 },
      collapsed: [],
    });
    const occupied = (rendered.sidebar ?? 0) + (rendered.specList ?? 0) + (rendered.specDecision ?? 0);

    expect(1000 - occupied).toBeGreaterThanOrEqual(MAIN_CONTENT_MIN_WIDTH);
    expect(rendered.sidebar).toBeGreaterThanOrEqual(PANEL_LIMITS.sidebar.minWidth);
    expect(rendered.specList).toBeGreaterThanOrEqual(PANEL_LIMITS.specList.minWidth);
    expect(rendered.specDecision).toBeGreaterThanOrEqual(PANEL_LIMITS.specDecision.minWidth);
  });

  it("최소값까지 줄여도 340px을 지킬 수 없으면 최소값을 돌려준다", () => {
    expect(
      resolveRenderedPanelWidths({
        windowWidth: 600,
        storedWidths: { sidebar: 300, specList: 300 },
        collapsed: [],
      }),
    ).toEqual({ sidebar: 190, specList: 190 });
  });

  it("창을 다시 넓히면 같은 저장된 값에서 원래 너비가 다시 나온다", () => {
    const storedWidths = { sidebar: 300, specList: 300 };

    resolveRenderedPanelWidths({ windowWidth: 900, storedWidths, collapsed: [] });
    const widened = resolveRenderedPanelWidths({ windowWidth: 1440, storedWidths, collapsed: [] });

    expect(widened).toEqual({ sidebar: 300, specList: 300 });
  });

  // 저장된 값도 접힘도 없는 영역에 px 값을 만들어 주면, 이 기능을 한 번도 쓰지 않은 화면이 비율
  // 배치를 잃는다(SPEC-080 R11, 완료 판정 A12).
  it("저장된 너비도 접힘도 없는 영역에는 px 값을 돌려주지 않는다", () => {
    expect(
      resolveRenderedPanelWidths({ windowWidth: 1440, storedWidths: {}, collapsed: [] }),
    ).toEqual({});

    const rendered = resolveRenderedPanelWidths({
      windowWidth: 1440,
      storedWidths: { specList: 300 },
      collapsed: [],
    });

    expect(rendered).toEqual({ specList: 300 });
    expect("sidebar" in rendered).toBe(false);
    expect("specDecision" in rendered).toBe(false);
  });

  it("조절하지 않은 영역은 창이 좁아져도 px 값을 받지 않는다", () => {
    const rendered = resolveRenderedPanelWidths({
      windowWidth: 700,
      storedWidths: { sidebar: 300 },
      collapsed: [],
    });

    expect(Object.keys(rendered)).toEqual(["sidebar"]);
  });
});

describe("되찾은 폭", () => {
  it("기준 너비를 모르는 영역만 있으면 0이다", () => {
    expect(measureReclaimedWidth([{ collapsed: false }])).toBe(0);
    expect(measureReclaimedWidth([{ renderedWidth: 220, collapsed: false }])).toBe(0);
    expect(measureReclaimedWidth([])).toBe(0);
  });

  it("좁힌 영역은 좁힌 만큼을 보탠다", () => {
    expect(
      measureReclaimedWidth([{ baselineWidth: 300, renderedWidth: 220, collapsed: false }]),
    ).toBe(80);
  });

  it("접힌 영역은 기준 너비에서 28px을 뺀 만큼을 보탠다", () => {
    expect(measureReclaimedWidth([{ baselineWidth: 250, collapsed: true }])).toBe(222);
  });

  it("아직 조절하지 않은 영역은 0을 보탠다", () => {
    expect(measureReclaimedWidth([{ baselineWidth: 300, collapsed: false }])).toBe(0);
  });

  it("한 화면의 영역들을 더해 돌려준다", () => {
    expect(
      measureReclaimedWidth([
        { baselineWidth: 250, renderedWidth: 190, collapsed: false },
        { baselineWidth: 300, collapsed: true },
        { collapsed: false },
      ]),
    ).toBe(60 + 272);
  });

  // 넓힌 영역은 음수를 보탠다. 읽기 폭 계산이 그 값을 0 이하로 받아 620px에서 멈춘다.
  it("넓힌 영역은 넓힌 만큼을 뺀다", () => {
    expect(
      measureReclaimedWidth([{ baselineWidth: 250, renderedWidth: 380, collapsed: false }]),
    ).toBe(-130);
  });
});

describe("읽기 폭 상한", () => {
  it("되찾은 폭이 0이면 620px이다", () => {
    expect(READING_WIDTH_MIN).toBe(620);
    expect(resolveReadingWidth(0)).toBe(620);
  });

  it("되찾은 만큼 올라간다", () => {
    expect(resolveReadingWidth(100)).toBe(720);
  });

  it("860px에서 멈춘다", () => {
    expect(READING_WIDTH_MAX).toBe(860);
    expect(resolveReadingWidth(400)).toBe(860);
    expect(resolveReadingWidth(240)).toBe(860);
  });

  it("되찾은 폭이 음수이면 620px이다", () => {
    expect(resolveReadingWidth(-130)).toBe(620);
  });
});
