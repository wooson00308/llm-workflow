import type {
  ProjectSummary,
  RecentProject,
  RecentProjectStore,
} from "../domain/types";

const STORAGE_KEY = "workflow-labs.recent-projects.v1";
const MAX_RECENT_PROJECTS = 8;

function load(): RecentProject[] {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentProject).slice(0, MAX_RECENT_PROJECTS);
  } catch {
    return [];
  }
}

function isRecentProject(value: unknown): value is RecentProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RecentProject>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.path === "string" &&
    typeof candidate.lastOpenedAt === "string"
  );
}

function remember(project: ProjectSummary): RecentProject[] {
  const next: RecentProject[] = [
    {
      name: project.name,
      path: project.rootPath,
      lastOpenedAt: new Date().toISOString(),
    },
    ...load().filter((item) => item.path !== project.rootPath),
  ].slice(0, MAX_RECENT_PROJECTS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export const browserRecentProjectStore: RecentProjectStore = { load, remember };
