import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../../../shared/ui/Icon";
import type {
  IdeaDocument,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
import { IdeaComposer } from "./IdeaComposer";
import { MarkdownBody } from "./MarkdownBody";

type IdeaBodyState =
  | { kind: "loading" }
  | { kind: "loaded"; body: string }
  | { kind: "failed" };

type IdeaState = "inbox" | "drafting" | "closed" | "adopted";

/** 백엔드가 파생해 실어 보낸 값이다. 화면이 판정을 다시 하지 않는다(SPEC-012 R6). */
function ideaState(item: WorkflowItemSummary): IdeaState {
  return item.status === "drafting" || item.status === "closed" || item.status === "adopted"
    ? item.status
    : "inbox";
}

const stateLabels: Record<IdeaState, string> = {
  inbox: "수집됨",
  drafting: "반영중",
  closed: "종결",
  adopted: "채택",
};

const stateIcons: Record<IdeaState, IconName> = {
  inbox: "idea",
  drafting: "refresh",
  closed: "archive",
  adopted: "stamp",
};

const statePillClasses: Record<IdeaState, string> = {
  inbox: "",
  drafting: "status-drafting",
  closed: "status-rejected",
  adopted: "status-approved",
};

function isStalled(item: WorkflowItemSummary): boolean {
  return (item.stalledSpecIds?.length ?? 0) > 0;
}

interface Props {
  busy: boolean;
  disabled: boolean;
  onAdd(content: string): Promise<boolean>;
  onReadIdea(fileName: string): Promise<IdeaDocument | null>;
  workflow: WorkflowSummary;
}

export function IdeaInbox({ busy, disabled, onAdd, onReadIdea, workflow }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    workflow.items.ideas[0]?.id ?? null,
  );

  useEffect(() => {
    if (!workflow.items.ideas.some((item) => item.id === selectedId)) {
      setSelectedId(workflow.items.ideas[0]?.id ?? null);
    }
  }, [selectedId, workflow.items.ideas]);

  const selected = useMemo(
    () => workflow.items.ideas.find((item) => item.id === selectedId) ?? null,
    [selectedId, workflow.items.ideas],
  );

  const [body, setBody] = useState<IdeaBodyState | null>(null);

  // 폴링이 2.5초마다 조회 함수의 정체성을 바꾸므로 효과 의존성에 넣지 않는다.
  const readIdea = useRef(onReadIdea);
  useEffect(() => {
    readIdea.current = onReadIdea;
  }, [onReadIdea]);

  const selectedFileName = selected?.fileName ?? null;
  useEffect(() => {
    if (!selectedFileName) {
      setBody(null);
      return;
    }
    let cancelled = false;
    setBody({ kind: "loading" });
    void readIdea.current(selectedFileName).then(
      (document) => {
        if (cancelled) return;
        setBody(
          document ? { kind: "loaded", body: document.body } : { kind: "failed" },
        );
      },
      () => {
        if (!cancelled) setBody({ kind: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedFileName]);

  return (
    <section className="idea-inbox-view">
      <ViewHeading
        count={workflow.items.ideas.length}
        description="정리되지 않은 생각을 먼저 수집하고, 기획으로 발전시킬 재료를 골라보세요."
        title="아이디어 인박스"
      />

      <IdeaComposer busy={busy} disabled={disabled} onAdd={onAdd} workflowDirectory={workflow.directory} />

      <div className="idea-inbox-layout">
        <section className="idea-list-panel" aria-label="아이디어 목록">
          <header>
            <div><strong>최근 아이디어</strong><small>최신 업데이트 순</small></div>
            <span>{workflow.items.ideas.length}</span>
          </header>
          <div className="idea-list">
            {workflow.items.ideas.map((item) => (
              <IdeaListRow
                item={item}
                key={item.fileName}
                onSelect={() => setSelectedId(item.id)}
                selected={item.id === selectedId}
              />
            ))}
            {workflow.items.ideas.length === 0 && (
              <EmptyPanel
                description="위 입력창에 첫 번째 생각을 남겨보세요."
                title="인박스가 비어 있습니다"
              />
            )}
          </div>
        </section>

        <IdeaPreview body={body} item={selected} />
      </div>
    </section>
  );
}

function IdeaListRow({
  item,
  onSelect,
  selected,
}: {
  item: WorkflowItemSummary;
  onSelect(): void;
  selected: boolean;
}) {
  const state = ideaState(item);
  return (
    <button
      aria-pressed={selected}
      className={selected ? "active" : ""}
      onClick={onSelect}
    >
      <span className={`idea-list-icon ${state}`}>
        <Icon name={stateIcons[state]} />
      </span>
      <span>
        <strong>{item.title}</strong>
        <small>{item.excerpt || "내용 미리보기가 없습니다."}</small>
      </span>
      <span className="idea-list-meta">
        <time>{formatDate(item.updatedAt)}</time>
        {(state !== "inbox" || isStalled(item)) && (
          <span className="idea-list-tags">
            {state !== "inbox" && (
              <small className={`idea-state-tag ${state}`}>{stateLabels[state]}</small>
            )}
            {isStalled(item) && <small className="idea-state-tag stalled">중단 의심</small>}
          </span>
        )}
      </span>
    </button>
  );
}

function IdeaPreview({
  body,
  item,
}: {
  body: IdeaBodyState | null;
  item: WorkflowItemSummary | null;
}) {
  if (!item) {
    return (
      <section className="idea-preview empty">
        <Icon name="idea" />
        <strong>아이디어를 선택하세요</strong>
        <p>목록에서 항목을 선택하면 핵심 내용과 문서 정보를 확인할 수 있습니다.</p>
      </section>
    );
  }

  const state = ideaState(item);

  return (
    <article className="idea-preview">
      <header>
        <div>
          <p className="eyebrow">IDEA NOTE</p>
          <h2>{item.title}</h2>
        </div>
        <span className={`status-pill ${statePillClasses[state]}`}>{stateLabels[state]}</span>
      </header>
      {isStalled(item) && (
        <p className="idea-stall-note">
          <strong>중단 의심</strong>
          <span>
            이 아이디어를 선점한 세션이 없는데 작성 중이던 기획서가 남아 있습니다. 걸린 기획서:{" "}
            {item.stalledSpecIds?.join(", ")}. 자동 처리로 다시 잡히지 않으므로 직접 확인해야 합니다.
          </span>
        </p>
      )}
      {/*
        중단 의심과 함께 뜨지 않는다. `stalledSpecIds`는 반영중에서만 채워지므로 두 조건은 배타적이고,
        그래서 두 안내가 같은 자리·같은 모양을 나눠 쓴다(SPEC-018 R6).
      */}
      {state === "closed" && (
        <p className="idea-stall-note">
          <strong>종결</strong>
          <span>
            이 아이디어에서 나온 기획서가 모두 반려로 끝났습니다. 자동 처리로 다시 잡히지 않으므로,
            다시 진행하려면 위 입력창에서 새 아이디어로 요청해야 합니다.
          </span>
        </p>
      )}
      <div className="idea-preview-body" key={item.fileName}>
        {body?.kind === "loaded" ? (
          <MarkdownBody body={body.body} preserveLineBreaks />
        ) : (
          <p className="idea-preview-note">
            {body?.kind === "failed"
              ? "아이디어 전문을 불러오지 못했습니다."
              : "아이디어를 불러오는 중…"}
          </p>
        )}
      </div>
      <footer>
        <div><span>문서 ID</span><strong>{item.id}</strong></div>
        <div><span>업데이트</span><strong>{formatDate(item.updatedAt)}</strong></div>
        <code>{item.fileName}</code>
      </footer>
    </article>
  );
}

function ViewHeading({
  count,
  description,
  title,
}: {
  count: number;
  description: string;
  title: string;
}) {
  return (
    <div className="view-heading">
      <div><p className="eyebrow">IDEA INBOX</p><h1>{title}</h1><p>{description}</p></div>
      <span><strong>{count}</strong><small>수집된 생각</small></span>
    </div>
  );
}

function EmptyPanel({ description, title }: { description: string; title: string }) {
  return (
    <div className="panel-empty">
      <Icon name="idea" />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "시간 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}
