import { useLayoutEffect, useMemo, useRef } from "react";
import { Icon } from "../../../shared/ui/Icon";
import type {
  AgentLeaseSummary,
  ProjectSummary,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
import { eventKinds } from "./DevelopmentBoard";
import type { SearchItemKind } from "./ProjectSearchDialog";

interface ResolvedTarget {
  item: WorkflowItemSummary;
  kind: SearchItemKind;
  workflow: WorkflowSummary;
}

interface Props {
  onOpenDocument(result: ResolvedTarget): void;
  project: ProjectSummary;
  /** 선택된 워크플로우. 문서 해석의 우선순위에 쓴다. 없을 수 있다. */
  workflow: WorkflowSummary | undefined;
}

/**
 * 계약이 정한 세 역할의 이름. 그 밖의 값은 번역하지 않고 원문 그대로 보여준다 — 계약을 어긴
 * 세션을 드러내는 것이 이 화면의 목적이라 앱이 모르는 값을 숨기지 않는다.
 */
const roleLabels: Record<string, string> = {
  planner: "기획자",
  architect: "아키텍트",
  developer: "개발자",
};

const kindLabels: Record<SearchItemKind, string> = {
  ideas: "아이디어",
  specs: "기획서",
  tasks: "개발 작업",
};

const kindIcons: Record<SearchItemKind, "idea" | "stamp" | "board"> = {
  ideas: "idea",
  specs: "stamp",
  tasks: "board",
};

/** 문서 번호가 워크플로우마다 따로 매겨지므로 한 워크플로우 안에서도 보는 순서를 고정한다. */
const documentKinds: SearchItemKind[] = ["ideas", "specs", "tasks"];

/**
 * 개발 작업 전이의 이름은 개발 화면 타임라인의 정의를 그대로 쓴다. 같은 사실을 두 화면이 다른
 * 말로 부르지 않게 이 파일에 값을 다시 적지 않는다.
 */
const taskEventLabels = new Map<string, string>(
  eventKinds.map((entry) => [entry.kind, entry.label]),
);

/**
 * 기획서 결정의 이름. `revision_requested`는 원천에 따라 다른 사건이라 작업 전이와 같은 값을
 * 다른 말로 부른다 — 기획서에서는 사용자의 수정 요청이고 작업에서는 QA 반려다.
 */
const specEventLabels = new Map<string, string>([
  ["approved", "승인"],
  ["revision_requested", "수정 요청"],
  ["rejected", "폐기"],
]);

/** 피드가 한 번에 보여주는 최근 항목 수. 넘으면 잘렸다는 사실을 함께 알린다. */
const feedLimit = 30;

/**
 * 피드의 마지막 스크롤 자리. 문서로 이동하면 이 뷰가 언마운트되므로 세션 동안만 기억했다가
 * 다시 마운트할 때 되돌린다. 새 저장소를 만들지 않는다는 제약 때문에 파일도 브라우저 저장소도
 * 쓰지 않는다.
 */
let feedScrollTop = 0;

interface ActivityEntry {
  at: string;
  instant: number;
  kind: string;
  source: "spec" | "task";
  item: WorkflowItemSummary;
}

export function ActivityView({ onOpenDocument, project, workflow }: Props) {
  // 새 폴링을 만들지 않는다. 2.5초 주기 조회가 다시 렌더할 때 남은 시간이 갱신된다.
  const now = Date.now();
  const feedRef = useRef<HTMLUListElement>(null);
  // 2.5초마다 프로젝트를 다시 읽으므로 항목 목록이 매 렌더 새 배열이 되지 않게 한다.
  const entries = useMemo(() => activityEntries(workflow?.items), [workflow?.items]);
  const visible = entries.slice(0, feedLimit);

  useLayoutEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedScrollTop;
  }, []);

  return (
    <section aria-label="활동" className="activity-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">ACTIVITY</p>
          <h1>활동</h1>
          <p>지금 무엇이 돌고 있는지 프로젝트 전체의 활성 워커를 봅니다.</p>
        </div>
        <span><strong>{project.activeLeases.length}</strong><small>활성 워커</small></span>
      </div>

      <section className="activity-section">
        <div className="section-heading"><h2>지금 작업 중</h2></div>
        {project.activeLeases.length > 0 ? (
          <ul className="worker-list">
            {project.activeLeases.map((lease) => (
              <WorkerCard
                key={lease.leaseId}
                lease={lease}
                now={now}
                onOpenDocument={onOpenDocument}
                project={project}
                selectedDirectory={workflow?.directory}
              />
            ))}
          </ul>
        ) : (
          <div className="panel-empty compact">
            <Icon name="activity" />
            <strong>지금은 조용합니다</strong>
            <span>활성 lease가 없습니다. LLM 세션이 문서를 선점하면 여기에 나타납니다.</span>
          </div>
        )}
      </section>

      <section aria-label="최근 활동" className="activity-section">
        <div className="section-heading"><h2>최근 활동</h2></div>
        {workflow && visible.length > 0 ? (
          <>
            <ul
              className="activity-feed"
              onScroll={(event) => { feedScrollTop = event.currentTarget.scrollTop; }}
              ref={feedRef}
            >
              {visible.map((entry, index) => (
                <li key={`${entry.source}:${entry.item.fileName}:${entry.kind}:${entry.at}:${index}`}>
                  <button
                    onClick={() => onOpenDocument({
                      item: entry.item,
                      kind: entry.source === "spec" ? "specs" : "tasks",
                      workflow,
                    })}
                    type="button"
                  >
                    <span className={`activity-mark event-${entry.kind}`}>{entryLabel(entry)}</span>
                    <small>{entry.item.id}</small>
                    <strong>{entry.item.title}</strong>
                    <time dateTime={entry.at}>{formatMoment(entry.at)}</time>
                  </button>
                </li>
              ))}
            </ul>
            {entries.length > visible.length && (
              <p className="activity-notice">
                최근 {feedLimit}건만 보여줍니다. 전체 기록은 개발 화면의 타임라인에 있습니다.
              </p>
            )}
          </>
        ) : (
          <div className="panel-empty compact">
            <Icon name="activity" />
            <strong>아직 기록이 없습니다</strong>
            <span>작업 전이나 기획서 결정이 생기면 여기에 쌓입니다.</span>
          </div>
        )}
      </section>
    </section>
  );
}

/**
 * 파일에 이미 있는 두 원천을 한 타임라인으로 모은다. 새 기록을 만들지 않고 읽기만 한다.
 * 시각을 읽을 수 없거나 이름을 붙일 수 없는 종류는 그 항목만 버려, 하나가 잘못되어 피드
 * 전체가 비지 않게 한다.
 */
function activityEntries(items: WorkflowSummary["items"] | undefined): ActivityEntry[] {
  if (!items) return [];
  const entries = [
    ...collectEntries(items.tasks, "task"),
    ...collectEntries(items.specs, "spec"),
  ];
  // 같은 순간이면 문서 식별자로 갈라 조회마다 순서가 흔들리지 않게 한다.
  entries.sort((a, b) => b.instant - a.instant || a.item.id.localeCompare(b.item.id));
  return entries;
}

function collectEntries(items: WorkflowItemSummary[], source: ActivityEntry["source"]) {
  const labels = source === "spec" ? specEventLabels : taskEventLabels;
  const entries: ActivityEntry[] = [];
  for (const item of items) {
    for (const event of item.events ?? []) {
      if (!labels.has(event.kind)) continue;
      const instant = Date.parse(event.at);
      if (Number.isNaN(instant)) continue;
      entries.push({ at: event.at, instant, kind: event.kind, source, item });
    }
  }
  return entries;
}

function entryLabel(entry: ActivityEntry) {
  const labels = entry.source === "spec" ? specEventLabels : taskEventLabels;
  return labels.get(entry.kind);
}

function WorkerCard({
  lease,
  now,
  onOpenDocument,
  project,
  selectedDirectory,
}: {
  lease: AgentLeaseSummary;
  now: number;
  onOpenDocument(result: ResolvedTarget): void;
  project: ProjectSummary;
  selectedDirectory: string | undefined;
}) {
  const target = lease.taskId
    ? resolveTarget(project, selectedDirectory, lease.taskId)
    : null;
  const role = lease.role === null ? null : roleLabels[lease.role] ?? lease.role;

  return (
    <li className="worker-card">
      <div className="worker-identity">
        <span className="pulse" />
        <strong>{lease.agent}</strong>
        {role && <span className="worker-role">{role}</span>}
      </div>

      {target ? (
        <button className="worker-target" onClick={() => onOpenDocument(target)} type="button">
          <Icon name={kindIcons[target.kind]} />
          <span>
            <strong>{target.item.title}</strong>
            <small>{kindLabels[target.kind]} · {target.item.id} · {target.workflow.name}</small>
          </span>
          <Icon className="chevron" name="chevron" />
        </button>
      ) : (
        <p className="worker-target plain">{lease.taskId ?? "워크플로우 작업"}</p>
      )}

      <dl className="worker-times">
        <div><dt>마지막 심장박동</dt><dd>{formatMoment(lease.heartbeatAt)}</dd></div>
        <div><dt>만료까지</dt><dd>{formatRemaining(lease.expiresAt, now)}</dd></div>
      </dl>
    </li>
  );
}

/**
 * lease가 문 식별자를 프로젝트 안의 문서로 해석한다. 선택된 워크플로우를 먼저 보고 그다음
 * 등록 순서로 본다 — 문서 번호가 워크플로우마다 따로 매겨져 같은 id가 둘 이상 있을 수 있다.
 */
function resolveTarget(
  project: ProjectSummary,
  selected: string | undefined,
  id: string,
): ResolvedTarget | null {
  const ordered = [
    ...project.workflows.filter((item) => item.directory === selected),
    ...project.workflows.filter((item) => item.directory !== selected),
  ];
  for (const workflow of ordered) {
    for (const kind of documentKinds) {
      const item = workflow.items[kind].find((entry) => entry.id === id);
      if (item) return { item, kind, workflow };
    }
  }
  return null;
}

/** lease 파일의 `heartbeat_at` 원문을 로컬 시각으로 읽는다. 최초 시작 시각이 아니다. */
function formatMoment(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatRemaining(expiresAt: string, now: number) {
  // 주기 조회 사이에 만료가 지나갈 수 있어 0 이하를 따로 말한다.
  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) return "곧 만료";
  const minutes = Math.floor(remaining / 60_000);
  return minutes < 1 ? "1분 미만 남음" : `${minutes}분 남음`;
}
