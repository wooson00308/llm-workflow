import type { AgentRunEvent } from "./types";

/**
 * 도구 이름을 묶는 사용자 유형. 사용자가 읽을 것은 이 여섯 값뿐이고 도구 이름 원문은 화면에
 * 나가지 않는다 — 런타임이 어떤 이름을 새로 만들어도 화면의 어휘는 늘어나지 않는다.
 *
 * `unnamed`는 도구 이름 필드가 생기기 전에 저장된 이벤트다. 이름을 확인하지 못한 것이지 도구를
 * 쓰지 않은 것이 아니므로 총 횟수에는 들어가고 유형만 따로 남는다.
 */
export type ToolCategory =
  | "fileRead"
  | "fileEdit"
  | "command"
  | "search"
  | "other"
  | "unnamed";

/** 화면이 유형별 집계를 늘어놓는 순서. 집계 결과는 이 순서를 따른다. */
export const TOOL_CATEGORY_ORDER: readonly ToolCategory[] = [
  "fileRead",
  "fileEdit",
  "command",
  "search",
  "other",
  "unnamed",
];

/**
 * 아는 도구 이름의 유형. 키는 소문자로 맞춘 이름이다.
 *
 * Claude는 도구 사용 블록의 이름을 그대로 싣고, Codex는 이름이 없는 항목에 항목 유형을 싣는다
 * (런타임 계약의 로그 절). 두 어휘가 한 표에 함께 있는 것은 그 때문이다.
 */
const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  read: "fileRead",
  notebookread: "fileRead",
  edit: "fileEdit",
  multiedit: "fileEdit",
  write: "fileEdit",
  notebookedit: "fileEdit",
  apply_patch: "fileEdit",
  bash: "command",
  bashoutput: "command",
  killshell: "command",
  command_execution: "command",
  grep: "search",
  glob: "search",
  websearch: "search",
};

/** 줄로 남는 이벤트. 진행과 도구는 집계에만 반영하므로 여기 없다. */
export type RunSignalKind =
  | "started"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

const SIGNAL_KINDS = new Set<string>([
  "started",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);

export interface ToolUsage {
  category: ToolCategory;
  count: number;
}

export interface RunSignal {
  kind: RunSignalKind;
  /** 이벤트가 일어난 시각. 시작 시각이나 경과 초가 없으면 null이다. */
  at: string | null;
  /** 런타임이 준 상세 원문. 시작 이벤트에는 없다. */
  detail: string | null;
}

export interface RunActivity {
  /** 도구 이벤트 전체 수. 이름 유무와 상관없이 센다. */
  toolTotal: number;
  /** 유형별 횟수. 한 번도 나오지 않은 유형은 실리지 않는다. */
  usage: ToolUsage[];
  /** 마지막 이벤트가 일어난 시각. 계산할 수 없으면 null이다. */
  lastActivityAt: string | null;
  signals: RunSignal[];
}

/** 활동 없음으로 판정하는 기준. */
export const IDLE_THRESHOLD_SECONDS = 300;

/**
 * 저장된 이벤트 하나를 계약이 정한 형태로 읽는다. 계약 밖 값은 지어내지 않고 null로 남긴다.
 *
 * 이벤트는 백엔드가 해석 없이 나르는 JSON 값이라 화면에 닿을 때까지 형태가 보장되지 않는다.
 */
export function readRunEvent(value: unknown): AgentRunEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.kind !== "string") return null;
  const toolName = typeof row.toolName === "string" ? row.toolName.trim() : "";
  return {
    kind: row.kind,
    toolName: toolName === "" ? null : toolName,
    startedAt: typeof row.startedAt === "string" ? row.startedAt : null,
    elapsedSeconds:
      typeof row.elapsedSeconds === "number" && Number.isFinite(row.elapsedSeconds)
        ? row.elapsedSeconds
        : null,
    detail: typeof row.detail === "string" ? row.detail : null,
  };
}

/** 아는 이름은 그 유형으로, 모르는 이름은 기타로, 이름이 없으면 이름 없음으로 묶는다. */
export function toolCategoryOf(toolName: string | null): ToolCategory {
  if (!toolName) return "unnamed";
  return TOOL_CATEGORIES[toolName.toLowerCase()] ?? "other";
}

/**
 * 이벤트가 일어난 시각. 저장된 이벤트에는 절대 시각 필드가 없고 실행 시작 시각과 경과 초만 있으므로
 * 둘을 더해 계산한다.
 */
export function eventOccurredAt(event: AgentRunEvent): string | null {
  if (!event.startedAt || event.elapsedSeconds === null) return null;
  const startedAt = Date.parse(event.startedAt);
  if (Number.isNaN(startedAt)) return null;
  return new Date(startedAt + event.elapsedSeconds * 1_000).toISOString();
}

/** 이벤트 묶음 하나를 요약 카드와 신호가 읽을 값으로 접는다. */
export function summarizeRunActivity(events: readonly unknown[]): RunActivity {
  const counts = new Map<ToolCategory, number>();
  const signals: RunSignal[] = [];
  let toolTotal = 0;
  let lastActivityAt: string | null = null;

  for (const value of events) {
    const event = readRunEvent(value);
    if (!event) continue;
    const at = eventOccurredAt(event);
    if (at) lastActivityAt = at;
    if (event.kind === "tool") {
      toolTotal += 1;
      const category = toolCategoryOf(event.toolName);
      counts.set(category, (counts.get(category) ?? 0) + 1);
      continue;
    }
    if (SIGNAL_KINDS.has(event.kind)) {
      signals.push({
        kind: event.kind as RunSignalKind,
        at,
        detail: event.kind === "started" ? null : event.detail,
      });
    }
  }

  return {
    toolTotal,
    usage: TOOL_CATEGORY_ORDER.filter((category) => counts.has(category)).map(
      (category) => ({ category, count: counts.get(category) ?? 0 }),
    ),
    lastActivityAt,
    signals,
  };
}

/** 마지막 활동에서 지금까지 흐른 초. 활동 시각을 모르면 null이다. */
export function idleSeconds(lastActivityAt: string | null, nowMs: number): number | null {
  if (!lastActivityAt) return null;
  const last = Date.parse(lastActivityAt);
  if (Number.isNaN(last)) return null;
  return Math.max(0, Math.floor((nowMs - last) / 1_000));
}

/**
 * 활동 없음 신호를 보여야 하는가. 활동 시각을 모르면 거짓이다 — 모르는 것을 멈춘 것으로 읽지 않는다.
 * 이 판정은 실행 상태를 바꾸지 않는다.
 */
export function isRunIdle(lastActivityAt: string | null, nowMs: number): boolean {
  const seconds = idleSeconds(lastActivityAt, nowMs);
  return seconds !== null && seconds >= IDLE_THRESHOLD_SECONDS;
}

/** 화면에 내보내기 전에 자격증명처럼 보이는 값을 지운다. 문장의 나머지는 그대로 둔다. */
export function redactSecrets(text: string): string {
  return text.replace(/(?:token|secret|api.?key)\s*[:=]\s*\S+/gi, "[민감정보 제거됨]");
}
