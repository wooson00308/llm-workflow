import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QaReviewDraft } from "./browserQaReviewDraftStore";
import { browserQaReviewDraftStore, createQaReviewRequestId } from "./browserQaReviewDraftStore";

const STORAGE_KEY = "workflow-labs.qa-review-draft.v2";
const V1_STORAGE_KEY = "workflow-labs.qa-review-draft.v1";

function stubStorage() {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  return stored;
}

function draft(overrides: Partial<QaReviewDraft> = {}): QaReviewDraft {
  return {
    startedAt: "2026-08-14T09:00:00Z",
    requestId: "qa-request-1",
    entries: {
      "QA-01": { outcome: "confirmed", comment: "확인", expectedUpdatedAt: "2026-08-14T08:00:00Z" },
    },
    ...overrides,
  };
}

let storage: Map<string, string>;

beforeEach(() => {
  storage = stubStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserQaReviewDraftStore v2", () => {
  it("creates a UUID request id even when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0);
        return bytes;
      },
    });

    expect(createQaReviewRequestId()).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("stores drafts independently by workflow, group and revision", () => {
    browserQaReviewDraftStore.save("wf-a", "GROUP-A", 1, draft());
    browserQaReviewDraftStore.save("wf-a", "GROUP-A", 2, draft({ requestId: "qa-request-2" }));
    browserQaReviewDraftStore.save("wf-b", "GROUP-A", 1, draft({ requestId: "qa-request-3" }));

    expect(browserQaReviewDraftStore.load("wf-a", "GROUP-A", 1)?.requestId).toBe("qa-request-1");
    expect(browserQaReviewDraftStore.load("wf-a", "GROUP-A", 2)?.requestId).toBe("qa-request-2");
    expect(browserQaReviewDraftStore.load("wf-b", "GROUP-A", 1)?.requestId).toBe("qa-request-3");
  });

  it("clears only the named revision", () => {
    browserQaReviewDraftStore.save("wf-a", "GROUP-A", 1, draft());
    browserQaReviewDraftStore.save("wf-a", "GROUP-A", 2, draft({ requestId: "qa-request-2" }));

    browserQaReviewDraftStore.clear("wf-a", "GROUP-A", 1);

    expect(browserQaReviewDraftStore.load("wf-a", "GROUP-A", 1)).toBeNull();
    expect(browserQaReviewDraftStore.load("wf-a", "GROUP-A", 2)?.requestId).toBe("qa-request-2");
  });

  it("does not migrate the task-based v1 draft", () => {
    storage.set(V1_STORAGE_KEY, JSON.stringify({ "wf-a": { "SPEC-A": draft() } }));

    expect(browserQaReviewDraftStore.load("wf-a", "GROUP-A", 1)).toBeNull();
    expect(storage.get(STORAGE_KEY)).toBeUndefined();
  });

  it("keeps readable revisions when adjacent values are malformed", () => {
    storage.set(STORAGE_KEY, JSON.stringify({
      "wf-a": {
        "GROUP-A": {
          1: { startedAt: 7, requestId: "bad", entries: {} },
          2: draft(),
          nope: draft(),
        },
      },
    }));

    expect(browserQaReviewDraftStore.load("wf-a", "GROUP-A", 1)).toBeNull();
    expect(browserQaReviewDraftStore.load("wf-a", "GROUP-A", 2)).toEqual(draft());
  });

  it("drops only malformed scenario entries", () => {
    storage.set(STORAGE_KEY, JSON.stringify({
      "wf-a": { "GROUP-A": { 1: {
        startedAt: "2026-08-14T09:00:00Z",
        requestId: "qa-request-1",
        entries: {
          "QA-01": { outcome: "wrong", comment: "", expectedUpdatedAt: "" },
          "QA-02": { outcome: "revision_requested", comment: "다름", expectedUpdatedAt: "now" },
        },
      } } },
    }));

    expect(browserQaReviewDraftStore.load("wf-a", "GROUP-A", 1)?.entries).toEqual({
      "QA-02": { outcome: "revision_requested", comment: "다름", expectedUpdatedAt: "now" },
    });
  });

  it("swallows unavailable storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    });

    expect(browserQaReviewDraftStore.load("wf-a", "GROUP-A", 1)).toBeNull();
    expect(() => browserQaReviewDraftStore.save("wf-a", "GROUP-A", 1, draft())).not.toThrow();
    expect(() => browserQaReviewDraftStore.clear("wf-a", "GROUP-A", 1)).not.toThrow();
  });
});
