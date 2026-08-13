import { describe, expect, it } from "vitest";
import {
  IDLE_THRESHOLD_SECONDS,
  eventOccurredAt,
  idleSeconds,
  isRunIdle,
  readRunEvent,
  redactSecrets,
  summarizeRunActivity,
  toolCategoryOf,
} from "./runActivity";

const startedAt = "2026-08-12T10:00:00.000Z";

function event(kind: string, elapsedSeconds: number, extra: Record<string, unknown> = {}) {
  return { kind, provider: "codex", role: "developer", targetId: "TASK-1", startedAt, elapsedSeconds, rawId: null, detail: null, ...extra };
}

function tool(elapsedSeconds: number, toolName: string | null) {
  return event("tool", elapsedSeconds, { toolName });
}

describe("도구 사용 집계", () => {
  it("유형별 횟수의 합이 도구 이벤트 수와 같다", () => {
    const events = [
      event("started", 0),
      ...Array.from({ length: 8 }, (_, index) => event("progress", index + 1)),
      tool(10, "Edit"), tool(11, "Write"), tool(12, "Bash"),
      tool(13, "command_execution"), tool(14, "Grep"), tool(15, "Glob"),
      tool(16, "Read"),
    ];

    const activity = summarizeRunActivity(events);

    expect(activity.toolTotal).toBe(7);
    expect(activity.usage.reduce((sum, usage) => sum + usage.count, 0)).toBe(activity.toolTotal);
    expect(activity.usage).toEqual([
      { category: "fileRead", count: 1 },
      { category: "fileEdit", count: 2 },
      { category: "command", count: 2 },
      { category: "search", count: 2 },
    ]);
  });

  it("이름 없는 이벤트도 총 횟수에 들어가고 알지 못하는 이름은 기타가 된다", () => {
    const events = [tool(1, null), tool(2, "   "), tool(3, "mcp__vendor__secret_tool"), tool(4, "Read")];

    const activity = summarizeRunActivity(events);

    expect(activity.toolTotal).toBe(4);
    expect(activity.usage).toEqual([
      { category: "fileRead", count: 1 },
      { category: "other", count: 1 },
      { category: "unnamed", count: 2 },
    ]);
    expect(toolCategoryOf("mcp__vendor__secret_tool")).toBe("other");
    expect(toolCategoryOf(null)).toBe("unnamed");
  });

  it("진행과 도구 이벤트는 줄로 남지 않고 시작과 종료만 남는다", () => {
    const events = [event("started", 0), event("progress", 1), tool(2, "Read"), event("failed", 3, { detail: "provider error" })];

    const activity = summarizeRunActivity(events);

    expect(activity.signals.map((signal) => signal.kind)).toEqual(["started", "failed"]);
    expect(activity.signals[1].detail).toBe("provider error");
    expect(activity.signals[0].detail).toBeNull();
  });

  it("구조가 아닌 값과 종류가 없는 값은 세지 않는다", () => {
    const activity = summarizeRunActivity([null, "이벤트", 7, {}, { kind: 3 }, tool(1, "Read")]);

    expect(activity.toolTotal).toBe(1);
    expect(activity.signals).toEqual([]);
  });
});

describe("마지막 활동 시각", () => {
  it("마지막 이벤트의 시작 시각과 경과 초를 더한 값이다", () => {
    const activity = summarizeRunActivity([event("started", 0), tool(90, "Read"), event("progress", 125)]);

    expect(activity.lastActivityAt).toBe("2026-08-12T10:02:05.000Z");
    expect(eventOccurredAt(readRunEvent(tool(90, "Read"))!)).toBe("2026-08-12T10:01:30.000Z");
  });

  it("시작 시각이나 경과 초를 확인할 수 없으면 계산하지 않는다", () => {
    expect(summarizeRunActivity([{ kind: "tool", toolName: "Read" }]).lastActivityAt).toBeNull();
    expect(summarizeRunActivity([{ kind: "tool", startedAt: "언제인지 모름", elapsedSeconds: 5 }]).lastActivityAt).toBeNull();
    expect(summarizeRunActivity([event("started", 0), { kind: "progress" }]).lastActivityAt).toBe(startedAt);
  });
});

describe("활동 없음 판정", () => {
  const lastActivityAt = "2026-08-12T10:00:00.000Z";
  const idleAt = Date.parse(lastActivityAt) + IDLE_THRESHOLD_SECONDS * 1_000;

  it("기준 시간이 지나야 참이 된다", () => {
    expect(isRunIdle(lastActivityAt, idleAt - 1_000)).toBe(false);
    expect(isRunIdle(lastActivityAt, idleAt)).toBe(true);
  });

  it("새 활동이 오면 다시 거짓이 된다", () => {
    const fresh = new Date(idleAt).toISOString();

    expect(isRunIdle(fresh, idleAt)).toBe(false);
    expect(idleSeconds(fresh, idleAt)).toBe(0);
  });

  it("활동 시각을 모르면 멈춘 것으로 읽지 않는다", () => {
    expect(isRunIdle(null, idleAt)).toBe(false);
    expect(idleSeconds("언제인지 모름", idleAt)).toBeNull();
  });
});

describe("상세 문장", () => {
  it("자격증명만 지우고 나머지 문장은 그대로 둔다", () => {
    expect(redactSecrets("role session exited with code 2: token=abc123")).toBe(
      "role session exited with code 2: [민감정보 제거됨]",
    );
  });
});
