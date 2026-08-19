import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserPanelLayoutStore, expandedPanelWidth } from "./browserPanelLayoutStore";

const STORAGE_KEY = "workflow-labs.panel-layout.v1";

// 한 `localStorage`를 나눠 쓰는 다른 저장소들의 키. 각 저장소 파일에서 그대로 읽어 왔다.
const DRAFT_STORAGE_KEY = "workflow-labs.idea-draft.v1";
const LANE_STORAGE_KEY = "workflow-labs.spec-lane-collapse.v1";
const RECENT_STORAGE_KEY = "workflow-labs.recent-projects.v1";

/**
 * 테스트 환경의 `localStorage`는 메서드가 없는 빈 객체다. 실제 저장 동작을 보려면 직접 세워야 한다.
 * `browserSpecLaneCollapseStore.test.ts`의 방식을 따른다.
 */
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

let storage: Map<string, string>;

beforeEach(() => {
  storage = stubStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserPanelLayoutStore", () => {
  it("영역별 너비와 접힘과 기준 너비를 그대로 읽어 온다", () => {
    browserPanelLayoutStore.save({
      sidebar: { width: 300, collapsed: false, baselineWidth: 250 },
      specDecision: { collapsed: true, baselineWidth: 280 },
    });

    expect(browserPanelLayoutStore.load()).toEqual({
      sidebar: { width: 300, collapsed: false, baselineWidth: 250 },
      specDecision: { collapsed: true, baselineWidth: 280 },
    });
  });

  // 저장 단위는 이 컴퓨터의 앱 전체다(SPEC-080 R6). 키가 하나뿐이라 워크플로를 옮겨도 같은 배치다.
  it("항목 하나에 담고 키에 프로젝트나 워크플로를 넣지 않는다", () => {
    browserPanelLayoutStore.save({ sidebar: { width: 300 } });

    expect([...storage.keys()]).toEqual([STORAGE_KEY]);
    expect(STORAGE_KEY).toBe("workflow-labs.panel-layout.v1");
  });

  // 저장소 여럿이 한 `localStorage`를 나눠 쓴다. 남의 키를 건드리면 다른 기억이 지워진다.
  it("다른 저장소의 값은 건드리지 않는다", () => {
    storage.set(DRAFT_STORAGE_KEY, JSON.stringify({ "feature--wf_1": "쓰다 만 아이디어" }));
    storage.set(LANE_STORAGE_KEY, JSON.stringify({ "feature--wf_1": { "SPEC-080": true } }));
    storage.set(RECENT_STORAGE_KEY, JSON.stringify([{ name: "labs", path: "/labs" }]));

    browserPanelLayoutStore.save({ sidebar: { width: 300 } });
    browserPanelLayoutStore.load();

    expect(storage.get(DRAFT_STORAGE_KEY)).toBe(
      JSON.stringify({ "feature--wf_1": "쓰다 만 아이디어" }),
    );
    expect(storage.get(LANE_STORAGE_KEY)).toBe(
      JSON.stringify({ "feature--wf_1": { "SPEC-080": true } }),
    );
    expect(storage.get(RECENT_STORAGE_KEY)).toBe(
      JSON.stringify([{ name: "labs", path: "/labs" }]),
    );
  });

  it("저장된 것이 없으면 빈 상태에서 시작한다", () => {
    expect(browserPanelLayoutStore.load()).toEqual({});
  });

  // 손상된 값은 전부 빈 상태로 돌아간다. 표시 상태라 사용자에게 알릴 것이 없다.
  it.each([
    ["값 없음", ""],
    ["JSON이 아닌 문자열", "{not json"],
    ["배열", '[{"sidebar":{"width":300}}]'],
    ["null", "null"],
    ["숫자", "42"],
    ["문자열", '"sidebar"'],
  ])("저장된 값이 %s이면 빈 상태를 돌려준다", (_case, stored) => {
    storage.set(STORAGE_KEY, stored);

    expect(() => browserPanelLayoutStore.load()).not.toThrow();
    expect(browserPanelLayoutStore.load()).toEqual({});
  });

  it("숫자가 아닌 너비는 버리고 나머지 값은 살린다", () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        sidebar: { width: "300px", collapsed: true, baselineWidth: null },
        specList: { width: 300 },
      }),
    );

    expect(browserPanelLayoutStore.load()).toEqual({
      sidebar: { collapsed: true },
      specList: { width: 300 },
    });
  });

  it("참거짓이 아닌 접힘값은 버리고 나머지 값은 살린다", () => {
    storage.set(STORAGE_KEY, JSON.stringify({ sidebar: { width: 300, collapsed: "yes" } }));

    expect(browserPanelLayoutStore.load()).toEqual({ sidebar: { width: 300 } });
  });

  it("영역 하나의 값이 깨져도 나머지 영역의 값은 살려 읽는다", () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        sidebar: "접힘",
        specList: ["300"],
        specDecision: { width: 300 },
        ideaList: { collapsed: true },
      }),
    );

    expect(browserPanelLayoutStore.load()).toEqual({
      specDecision: { width: 300 },
      ideaList: { collapsed: true },
    });
  });

  it("읽기와 쓰기가 모두 실패하는 저장소에서도 던지지 않는다", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("접근이 차단되었습니다");
      },
      setItem: () => {
        throw new Error("접근이 차단되었습니다");
      },
    });

    expect(() => browserPanelLayoutStore.save({ sidebar: { width: 300 } })).not.toThrow();
    expect(browserPanelLayoutStore.load()).toEqual({});
  });

  // 이 저장소 자체가 없는 환경(메서드 없는 전역)에서도 읽기·쓰기가 던지지 않는다.
  it("저장소에 메서드가 아예 없어도 던지지 않는다", () => {
    vi.stubGlobal("localStorage", {});

    expect(() => browserPanelLayoutStore.save({ sidebar: { width: 300 } })).not.toThrow();
    expect(browserPanelLayoutStore.load()).toEqual({});
  });
});

describe("펼칠 때 쓰는 너비", () => {
  it("조절한 너비가 있으면 그 값이다", () => {
    expect(expandedPanelWidth({ width: 300, collapsed: true, baselineWidth: 250 })).toBe(300);
  });

  it("조절한 적이 없으면 기준 너비다", () => {
    expect(expandedPanelWidth({ collapsed: true, baselineWidth: 250 })).toBe(250);
  });

  it("둘 다 없으면 값이 없다", () => {
    expect(expandedPanelWidth({ collapsed: true })).toBeUndefined();
    expect(expandedPanelWidth(undefined)).toBeUndefined();
  });
});
