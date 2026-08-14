import type { WorkGroupQaOutcome } from "../domain/types";

/** 워크플로우 → 작업 그룹 → revision → 제출 전 검토. v1 태스크 검토는 뜻이 달라 읽지 않는다. */
type QaReviewDraftState = Record<string, Record<string, Record<string, QaReviewDraft>>>;

const STORAGE_KEY = "workflow-labs.qa-review-draft.v2";

/** 시나리오 하나에 사용자가 남긴 결과와 메모. */
export interface QaReviewDraftEntry {
  outcome: WorkGroupQaOutcome | null;
  comment: string;
  /** 이 시나리오를 마지막으로 확인할 때 읽은 그룹 갱신 시각. */
  expectedUpdatedAt: string;
}

/** 작업 그룹 revision 하나의 제출 전 검토. request id는 성공 여부를 모르는 재시도에서도 유지한다. */
export interface QaReviewDraft {
  startedAt: string;
  requestId: string;
  entries: Record<string, QaReviewDraftEntry>;
}

/** Web Crypto의 UUID를 우선 쓰고, 제한된 WebView에서도 RFC 4122 v4 형식을 보장한다. */
export function createQaReviewRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function readEntry(value: unknown): QaReviewDraftEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const outcome = entry.outcome;
  if (outcome !== null && outcome !== "confirmed" && outcome !== "revision_requested") return null;
  if (typeof entry.comment !== "string" || typeof entry.expectedUpdatedAt !== "string") return null;
  return { outcome, comment: entry.comment, expectedUpdatedAt: entry.expectedUpdatedAt };
}

function readDraft(value: unknown): QaReviewDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  if (typeof draft.startedAt !== "string" || typeof draft.requestId !== "string" || !draft.requestId) return null;
  const source = draft.entries;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const entries: Record<string, QaReviewDraftEntry> = {};
  for (const [scenarioId, raw] of Object.entries(source)) {
    const entry = readEntry(raw);
    if (entry) entries[scenarioId] = entry;
  }
  return { startedAt: draft.startedAt, requestId: draft.requestId, entries };
}

function readAll(): QaReviewDraftState {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const state: QaReviewDraftState = {};
    for (const [directory, rawGroups] of Object.entries(parsed)) {
      if (!rawGroups || typeof rawGroups !== "object" || Array.isArray(rawGroups)) continue;
      const groups: Record<string, Record<string, QaReviewDraft>> = {};
      for (const [groupId, rawRevisions] of Object.entries(rawGroups)) {
        if (!rawRevisions || typeof rawRevisions !== "object" || Array.isArray(rawRevisions)) continue;
        const revisions: Record<string, QaReviewDraft> = {};
        for (const [revision, rawDraft] of Object.entries(rawRevisions)) {
          if (!/^\d+$/.test(revision)) continue;
          const draft = readDraft(rawDraft);
          if (draft) revisions[revision] = draft;
        }
        groups[groupId] = revisions;
      }
      state[directory] = groups;
    }
    return state;
  } catch {
    return {};
  }
}

function load(workflowDirectory: string, groupId: string, revision: number): QaReviewDraft | null {
  return readAll()[workflowDirectory]?.[groupId]?.[String(revision)] ?? null;
}

function save(workflowDirectory: string, groupId: string, revision: number, draft: QaReviewDraft): void {
  try {
    const state = readAll();
    const groups = state[workflowDirectory] ?? {};
    const revisions = groups[groupId] ?? {};
    state[workflowDirectory] = {
      ...groups,
      [groupId]: { ...revisions, [String(revision)]: draft },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    return;
  }
}

function clear(workflowDirectory: string, groupId: string, revision: number): void {
  try {
    const state = readAll();
    const groups = state[workflowDirectory];
    const revisions = groups?.[groupId];
    const revisionKey = String(revision);
    if (!groups || !revisions || !(revisionKey in revisions)) return;
    const { [revisionKey]: removed, ...restRevisions } = revisions;
    void removed;
    const nextGroups = { ...groups };
    if (Object.keys(restRevisions).length === 0) delete nextGroups[groupId];
    else nextGroups[groupId] = restRevisions;
    state[workflowDirectory] = nextGroups;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    return;
  }
}

export const browserQaReviewDraftStore = { load, save, clear };
