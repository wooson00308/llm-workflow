import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserIntegrationCollapseStore } from "./browserIntegrationCollapseStore";

const STORAGE_KEY = "workflow-labs.integration-collapse.v1";

/**
 * 테스트 환경의 `localStorage`는 메서드가 없는 빈 객체다. 실제 저장 동작을 보려면 직접 세워야 한다.
 * `DevelopmentBoard.test.tsx`의 `vi.stubGlobal` 방식을 따른다.
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

describe("browserIntegrationCollapseStore", () => {
  it("reads back what it stored", () => {
    browserIntegrationCollapseStore.save({ heartbeat: true, dream: false });

    expect(browserIntegrationCollapseStore.load()).toEqual({ heartbeat: true, dream: false });
  });

  it("starts from an empty map when nothing was stored", () => {
    expect(browserIntegrationCollapseStore.load()).toEqual({});
  });

  // 손상된 값은 전부 기본값으로 돌아간다. 표시 상태라 사용자에게 알릴 것이 없다.
  it.each([
    ["JSON이 아닌 문자열", "{not json"],
    ["배열", "[true]"],
    ["null", "null"],
    ["숫자", "42"],
    ["문자열", '"heartbeat"'],
  ])("falls back to an empty map when the stored value is %s", (_case, stored) => {
    storage.set(STORAGE_KEY, stored);

    expect(() => browserIntegrationCollapseStore.load()).not.toThrow();
    expect(browserIntegrationCollapseStore.load()).toEqual({});
  });

  it("drops only the entries that are not booleans", () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify({ heartbeat: true, dream: "yes", gone: null, other: false }),
    );

    expect(browserIntegrationCollapseStore.load()).toEqual({ heartbeat: true, other: false });
  });

  it("keeps ids that no integration uses anymore", () => {
    storage.set(STORAGE_KEY, JSON.stringify({ "gone-integration": true }));

    expect(browserIntegrationCollapseStore.load()).toEqual({ "gone-integration": true });
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

    expect(() => browserIntegrationCollapseStore.save({ heartbeat: true })).not.toThrow();
    expect(browserIntegrationCollapseStore.load()).toEqual({});
  });

  // 이 저장소 자체가 없는 환경(메서드 없는 전역)에서도 읽기·쓰기가 던지지 않는다.
  it("swallows a storage that has no methods at all", () => {
    vi.stubGlobal("localStorage", {});

    expect(() => browserIntegrationCollapseStore.save({ heartbeat: true })).not.toThrow();
    expect(browserIntegrationCollapseStore.load()).toEqual({});
  });
});
