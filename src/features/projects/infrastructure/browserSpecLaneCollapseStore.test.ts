import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UNASSIGNED_LANE_KEY,
  browserSpecLaneCollapseStore,
} from "./browserSpecLaneCollapseStore";

const STORAGE_KEY = "workflow-labs.spec-lane-collapse.v1";

// 한 `localStorage`를 나눠 쓰는 다른 저장소들의 키. 각 저장소 파일에서 그대로 읽어 왔다.
const DRAFT_STORAGE_KEY = "workflow-labs.idea-draft.v1";
const INTEGRATION_STORAGE_KEY = "workflow-labs.integration-collapse.v1";
const GUIDE_STORAGE_KEY = "workflow-labs.heartbeat-setup-guide-collapse.v1";
const RECENT_STORAGE_KEY = "workflow-labs.recent-projects.v1";

const feature = "feature--wf_1";
const other = "other--wf_2";

/**
 * 테스트 환경의 `localStorage`는 메서드가 없는 빈 객체다. 실제 저장 동작을 보려면 직접 세워야 한다.
 * `browserIdeaDraftStore.test.ts`의 방식을 따른다.
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

describe("browserSpecLaneCollapseStore", () => {
  it("reads back the collapse state it stored", () => {
    browserSpecLaneCollapseStore.save(feature, { "SPEC-029": true, "SPEC-030": false });

    expect(browserSpecLaneCollapseStore.load(feature)).toEqual({
      "SPEC-029": true,
      "SPEC-030": false,
    });
    expect(storage.has(STORAGE_KEY)).toBe(true);
  });

  it("keeps one workflow's collapse state out of another's", () => {
    browserSpecLaneCollapseStore.save(feature, { "SPEC-029": true });
    browserSpecLaneCollapseStore.save(other, { "SPEC-029": false });

    expect(browserSpecLaneCollapseStore.load(feature)).toEqual({ "SPEC-029": true });
    expect(browserSpecLaneCollapseStore.load(other)).toEqual({ "SPEC-029": false });
  });

  it("leaves other workflows alone when one is saved", () => {
    browserSpecLaneCollapseStore.save(other, { "SPEC-001": true });
    browserSpecLaneCollapseStore.save(feature, { "SPEC-029": true });

    expect(browserSpecLaneCollapseStore.load(other)).toEqual({ "SPEC-001": true });
  });

  // 저장소 다섯이 한 `localStorage`를 나눠 쓴다. 남의 키를 건드리면 다른 기억이 지워진다.
  it("leaves the other stores' values untouched", () => {
    storage.set(DRAFT_STORAGE_KEY, JSON.stringify({ [feature]: "쓰다 만 아이디어" }));
    storage.set(INTEGRATION_STORAGE_KEY, JSON.stringify({ heartbeat: true }));
    storage.set(GUIDE_STORAGE_KEY, JSON.stringify(false));
    storage.set(RECENT_STORAGE_KEY, JSON.stringify([{ name: "labs", path: "/labs" }]));

    browserSpecLaneCollapseStore.save(feature, { "SPEC-029": true });
    browserSpecLaneCollapseStore.load(feature);

    expect(storage.get(DRAFT_STORAGE_KEY)).toBe(
      JSON.stringify({ [feature]: "쓰다 만 아이디어" }),
    );
    expect(storage.get(INTEGRATION_STORAGE_KEY)).toBe(JSON.stringify({ heartbeat: true }));
    expect(storage.get(GUIDE_STORAGE_KEY)).toBe(JSON.stringify(false));
    expect(storage.get(RECENT_STORAGE_KEY)).toBe(
      JSON.stringify([{ name: "labs", path: "/labs" }]),
    );
  });

  it("starts from an empty map when nothing was stored", () => {
    expect(browserSpecLaneCollapseStore.load(feature)).toEqual({});
  });

  // 손상된 값은 전부 빈 맵으로 돌아간다. 표시 상태라 사용자에게 알릴 것이 없다.
  it.each([
    ["JSON이 아닌 문자열", "{not json"],
    ["배열", '[{"SPEC-029":true}]'],
    ["null", "null"],
    ["숫자", "42"],
    ["문자열", '"SPEC-029"'],
  ])("falls back to an empty map when the stored value is %s", (_case, stored) => {
    storage.set(STORAGE_KEY, stored);

    expect(() => browserSpecLaneCollapseStore.load(feature)).not.toThrow();
    expect(browserSpecLaneCollapseStore.load(feature)).toEqual({});
  });

  it("drops only the lane entries that are not booleans", () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        [feature]: { "SPEC-029": true, "SPEC-030": "yes", "SPEC-031": null, "SPEC-032": false },
      }),
    );

    expect(browserSpecLaneCollapseStore.load(feature)).toEqual({
      "SPEC-029": true,
      "SPEC-032": false,
    });
  });

  it("skips a workflow entry that is not a map and keeps the rest", () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify({ [other]: "접힘", [feature]: { "SPEC-029": true } }),
    );

    expect(browserSpecLaneCollapseStore.load(feature)).toEqual({ "SPEC-029": true });
    expect(browserSpecLaneCollapseStore.load(other)).toEqual({});
  });

  it("swallows a storage that throws on every access", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("접근이 차단되었습니다");
      },
      setItem: () => {
        throw new Error("접근이 차단되었습니다");
      },
    });

    expect(() => browserSpecLaneCollapseStore.save(feature, { "SPEC-029": true })).not.toThrow();
    expect(browserSpecLaneCollapseStore.load(feature)).toEqual({});
  });

  // 이 저장소 자체가 없는 환경(메서드 없는 전역)에서도 읽기·쓰기가 던지지 않는다.
  it("swallows a storage that has no methods at all", () => {
    vi.stubGlobal("localStorage", {});

    expect(() => browserSpecLaneCollapseStore.save(feature, { "SPEC-029": true })).not.toThrow();
    expect(browserSpecLaneCollapseStore.load(feature)).toEqual({});
  });

  // 카드가 없어 목록에서 빠졌던 레인이 돌아왔을 때 접힘 상태가 남아 있어야 한다.
  it("keeps lane keys that no specification uses anymore", () => {
    storage.set(STORAGE_KEY, JSON.stringify({ [feature]: { "SPEC-000": true } }));

    expect(() => browserSpecLaneCollapseStore.load(feature)).not.toThrow();
    expect(browserSpecLaneCollapseStore.load(feature)).toEqual({ "SPEC-000": true });
  });

  it("stores the unassigned lane under its own key", () => {
    browserSpecLaneCollapseStore.save(feature, { [UNASSIGNED_LANE_KEY]: true });

    expect(browserSpecLaneCollapseStore.load(feature)).toEqual({ [UNASSIGNED_LANE_KEY]: true });
    expect(UNASSIGNED_LANE_KEY).toBe("#unassigned");
  });
});
