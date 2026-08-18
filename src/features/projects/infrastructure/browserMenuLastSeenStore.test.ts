import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVELOPMENT_MENU_KEY,
  IDEAS_MENU_KEY,
  browserMenuLastSeenStore,
} from "./browserMenuLastSeenStore";

const STORAGE_KEY = "workflow-labs.menu-last-seen.v1";

// 한 `localStorage`를 나눠 쓰는 다른 저장소들의 키. 각 저장소 파일에서 그대로 읽어 왔다.
const OTHER_STORAGE_KEYS = [
  "workflow-labs.heartbeat-setup-guide-collapse.v1",
  "workflow-labs.idea-draft.v1",
  "workflow-labs.integration-collapse.v1",
  "workflow-labs.job-value-memory.v1",
  "workflow-labs.qa-review-draft.v1",
  "workflow-labs.qa-review-draft.v2",
  "workflow-labs.recent-projects.v1",
  "workflow-labs.spec-lane-collapse.v1",
];

const feature = "feature--wf_1";
const other = "other--wf_2";

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

describe("browserMenuLastSeenStore", () => {
  it("starts with no record when nothing was stored", () => {
    expect(browserMenuLastSeenStore.load(feature)).toEqual({});
  });

  it("reads back the timestamp it stored", () => {
    browserMenuLastSeenStore.save(feature, IDEAS_MENU_KEY, "2026-08-18T04:00:00Z");

    expect(browserMenuLastSeenStore.load(feature)).toEqual({
      [IDEAS_MENU_KEY]: "2026-08-18T04:00:00Z",
    });
    expect(storage.has(STORAGE_KEY)).toBe(true);
  });

  it("leaves other workflows alone when one is saved", () => {
    browserMenuLastSeenStore.save(other, IDEAS_MENU_KEY, "2026-08-17T00:00:00Z");
    browserMenuLastSeenStore.save(feature, IDEAS_MENU_KEY, "2026-08-18T04:00:00Z");

    expect(browserMenuLastSeenStore.load(other)).toEqual({
      [IDEAS_MENU_KEY]: "2026-08-17T00:00:00Z",
    });
  });

  it("leaves the other menu of the same workflow alone when one is saved", () => {
    browserMenuLastSeenStore.save(feature, IDEAS_MENU_KEY, "2026-08-17T00:00:00Z");
    browserMenuLastSeenStore.save(feature, DEVELOPMENT_MENU_KEY, "2026-08-18T04:00:00Z");

    expect(browserMenuLastSeenStore.load(feature)).toEqual({
      [IDEAS_MENU_KEY]: "2026-08-17T00:00:00Z",
      [DEVELOPMENT_MENU_KEY]: "2026-08-18T04:00:00Z",
    });
  });

  // 저장소 여럿이 한 `localStorage`를 나눠 쓴다. 남의 키를 건드리면 다른 기억이 지워진다.
  it("leaves the other stores' values untouched", () => {
    for (const key of OTHER_STORAGE_KEYS) {
      storage.set(key, JSON.stringify({ kept: key }));
    }

    browserMenuLastSeenStore.save(feature, IDEAS_MENU_KEY, "2026-08-18T04:00:00Z");
    browserMenuLastSeenStore.load(feature);

    for (const key of OTHER_STORAGE_KEYS) {
      expect(storage.get(key)).toBe(JSON.stringify({ kept: key }));
    }
  });

  // 손상된 값은 전부 기록 없음으로 돌아간다. 표시 상태라 사용자에게 알릴 것이 없다.
  it.each([
    ["JSON이 아닌 문자열", "{not json"],
    ["배열", '[{"ideas":"2026-08-18T04:00:00Z"}]'],
    ["null", "null"],
    ["숫자", "42"],
    ["문자열", '"2026-08-18T04:00:00Z"'],
  ])("falls back to no record when the stored value is %s", (_case, stored) => {
    storage.set(STORAGE_KEY, stored);

    expect(() => browserMenuLastSeenStore.load(feature)).not.toThrow();
    expect(browserMenuLastSeenStore.load(feature)).toEqual({});
  });

  it("drops only the menu entries that are not timestamps", () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        [feature]: {
          [IDEAS_MENU_KEY]: "2026-08-18T04:00:00Z",
          [DEVELOPMENT_MENU_KEY]: "어제",
          broken: 42,
        },
        [other]: ["array is not a menu map"],
      }),
    );

    expect(browserMenuLastSeenStore.load(feature)).toEqual({
      [IDEAS_MENU_KEY]: "2026-08-18T04:00:00Z",
    });
    expect(browserMenuLastSeenStore.load(other)).toEqual({});
  });

  it("returns no record and does not throw when storage access fails", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("접근 거부");
      },
      setItem: () => {
        throw new Error("접근 거부");
      },
    });

    expect(() =>
      browserMenuLastSeenStore.save(feature, IDEAS_MENU_KEY, "2026-08-18T04:00:00Z"),
    ).not.toThrow();
    expect(() => browserMenuLastSeenStore.load(feature)).not.toThrow();
    expect(browserMenuLastSeenStore.load(feature)).toEqual({});
  });
});
