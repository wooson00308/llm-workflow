import { describe, expect, it } from "vitest";
import {
  EXTERNAL_SESSION_STALE_MS,
  judgeExternalSessionHealth,
  type ExternalSessionActivity,
  type ExternalSessionHealthInput,
  type ExternalSessionRun,
} from "./externalSessionHealth";

const NOW = Date.parse("2026-08-19T15:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const readActivity = (minutes: number | null): ExternalSessionActivity => ({
  read: true,
  lastActivityAt: minutes === null ? null : minutesAgo(minutes),
});
const UNREAD: ExternalSessionActivity = { read: false };

function judge(overrides: Partial<ExternalSessionHealthInput> & { run: ExternalSessionRun | null }) {
  return judgeExternalSessionHealth({
    heartbeatAt: minutesAgo(20),
    now: NOW,
    activity: UNREAD,
    ...overrides,
  });
}

describe("judgeExternalSessionHealth", () => {
  it("A1: keeps a running row on the healthy line however stale its heartbeat is", () => {
    expect(judge({ run: { state: "running", reason: null }, activity: readActivity(45) })).toEqual({
      placement: "healthy",
      liveness: "alive",
      heartbeatStale: true,
      evidence: null,
    });
  });

  it("A1: reaches the same verdict when the activity record could not be read", () => {
    expect(judge({ run: { state: "running", reason: null }, activity: UNREAD })).toEqual({
      placement: "healthy",
      liveness: "alive",
      heartbeatStale: true,
      evidence: null,
    });
  });

  it("A2: cards a finished run and carries its state and last activity", () => {
    expect(judge({ run: { state: "succeeded", reason: null }, activity: readActivity(12) })).toEqual({
      placement: "attention",
      liveness: "ended",
      heartbeatStale: true,
      evidence: {
        kind: "run_ended",
        runState: "succeeded",
        lastActivityAt: minutesAgo(12),
        activityRead: true,
      },
    });
    expect(judge({ run: { state: "failed", reason: null }, activity: readActivity(12) })).toEqual({
      placement: "attention",
      liveness: "ended",
      heartbeatStale: true,
      evidence: {
        kind: "run_ended",
        runState: "failed",
        lastActivityAt: minutesAgo(12),
        activityRead: true,
      },
    });
  });

  it("A2: keeps the finished verdict when the last activity is unknown, and says which kind of unknown", () => {
    expect(judge({ run: { state: "cancelled", reason: null }, activity: UNREAD }).evidence).toEqual({
      kind: "run_ended",
      runState: "cancelled",
      lastActivityAt: null,
      activityRead: false,
    });
    expect(judge({ run: { state: "cancelled", reason: null }, activity: readActivity(null) }).evidence).toEqual({
      kind: "run_ended",
      runState: "cancelled",
      lastActivityAt: null,
      activityRead: true,
    });
  });

  it("A3: cards a stale lease that no run row claims instead of guessing it alive", () => {
    expect(judge({ heartbeatAt: minutesAgo(12), run: null })).toEqual({
      placement: "attention",
      liveness: "unknown",
      heartbeatStale: true,
      evidence: { kind: "run_missing" },
    });
  });

  it("A4: keeps an operationally stopped run alive while its activity is recent", () => {
    expect(
      judge({
        run: { state: "failed", reason: "supervisor_identity_unverified" },
        activity: readActivity(3),
      }),
    ).toEqual({ placement: "healthy", liveness: "alive", heartbeatStale: true, evidence: null });
    expect(judge({ run: { state: "recovery_required", reason: null }, activity: readActivity(3) })).toEqual({
      placement: "healthy",
      liveness: "alive",
      heartbeatStale: true,
      evidence: null,
    });
    expect(judge({ run: { state: "unrecognized", reason: null }, activity: readActivity(3) })).toEqual({
      placement: "healthy",
      liveness: "alive",
      heartbeatStale: true,
      evidence: null,
    });
    expect(
      judge({ run: { state: "cancelled", reason: "handle_mismatch" }, activity: readActivity(3) }),
    ).toEqual({ placement: "healthy", liveness: "alive", heartbeatStale: true, evidence: null });
  });

  it("A5: cards the same run once its activity is older than the threshold", () => {
    expect(
      judge({
        run: { state: "failed", reason: "supervisor_identity_unverified" },
        activity: readActivity(21),
      }),
    ).toEqual({
      placement: "attention",
      liveness: "unknown",
      heartbeatStale: true,
      evidence: { kind: "operational_stop" },
    });
  });

  it("cards an operationally stopped run whose activity record holds no time at all", () => {
    expect(
      judge({
        run: { state: "recovery_required", reason: null },
        activity: readActivity(null),
      }).evidence,
    ).toEqual({ kind: "operational_stop" });
  });

  it("cards an operationally stopped run whose activity record could not be read", () => {
    expect(
      judge({ run: { state: "recovery_required", reason: null }, activity: UNREAD }).evidence,
    ).toEqual({ kind: "operational_stop" });
  });

  it("judges the heartbeat and the last activity against the same ten minutes", () => {
    const run: ExternalSessionRun = { state: "failed", reason: "supervisor_identity_unverified" };
    const activityAt = (offset: number) => ({
      read: true as const,
      lastActivityAt: new Date(NOW - EXTERNAL_SESSION_STALE_MS - offset).toISOString(),
    });
    expect(judge({ run, activity: activityAt(0) }).placement).toBe("healthy");
    expect(judge({ run, activity: activityAt(1) }).placement).toBe("attention");
  });

  it("leaves a lease renewed exactly on the threshold on the healthy line without a stale note", () => {
    const heartbeatAt = new Date(NOW - EXTERNAL_SESSION_STALE_MS).toISOString();
    expect(judge({ heartbeatAt, run: { state: "succeeded", reason: null } })).toEqual({
      placement: "healthy",
      liveness: "alive",
      heartbeatStale: false,
      evidence: null,
    });
    const justOver = new Date(NOW - EXTERNAL_SESSION_STALE_MS - 1).toISOString();
    expect(judge({ heartbeatAt: justOver, run: { state: "succeeded", reason: null } }).placement).toBe(
      "attention",
    );
  });

  it("ignores the run record entirely while the heartbeat is recent", () => {
    expect(judge({ heartbeatAt: minutesAgo(9), run: { state: "failed", reason: null } })).toEqual({
      placement: "healthy",
      liveness: "alive",
      heartbeatStale: false,
      evidence: null,
    });
  });

  it("treats a lease whose heartbeat cannot be parsed as not stale", () => {
    expect(judge({ heartbeatAt: "", run: null })).toEqual({
      placement: "healthy",
      liveness: "alive",
      heartbeatStale: false,
      evidence: null,
    });
    expect(judge({ heartbeatAt: "어제", run: null }).placement).toBe("healthy");
  });
});
