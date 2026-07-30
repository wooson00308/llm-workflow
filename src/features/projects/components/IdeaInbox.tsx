import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import type { WorkflowItemSummary, WorkflowSummary } from "../domain/types";
import { IdeaComposer } from "./IdeaComposer";

interface Props {
  busy: boolean;
  disabled: boolean;
  onAdd(content: string): Promise<boolean>;
  workflow: WorkflowSummary;
}

export function IdeaInbox({ busy, disabled, onAdd, workflow }: Props) {
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

  return (
    <section className="idea-inbox-view">
      <ViewHeading
        count={workflow.items.ideas.length}
        description="정리되지 않은 생각을 먼저 수집하고, 기획으로 발전시킬 재료를 골라보세요."
        title="아이디어 인박스"
      />

      <IdeaComposer busy={busy} disabled={disabled} onAdd={onAdd} />

      <div className="idea-inbox-layout">
        <section className="idea-list-panel" aria-label="아이디어 목록">
          <header>
            <div><strong>최근 아이디어</strong><small>최신 업데이트 순</small></div>
            <span>{workflow.items.ideas.length}</span>
          </header>
          <div className="idea-list">
            {workflow.items.ideas.map((item) => (
              <button
                aria-pressed={item.id === selectedId}
                className={item.id === selectedId ? "active" : ""}
                key={item.fileName}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="idea-list-icon"><Icon name="idea" /></span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.excerpt || "내용 미리보기가 없습니다."}</small>
                </span>
                <time>{formatDate(item.updatedAt)}</time>
              </button>
            ))}
            {workflow.items.ideas.length === 0 && (
              <EmptyPanel
                description="위 입력창에 첫 번째 생각을 남겨보세요."
                title="인박스가 비어 있습니다"
              />
            )}
          </div>
        </section>

        <IdeaPreview item={selected} />
      </div>
    </section>
  );
}

function IdeaPreview({ item }: { item: WorkflowItemSummary | null }) {
  if (!item) {
    return (
      <section className="idea-preview empty">
        <Icon name="idea" />
        <strong>아이디어를 선택하세요</strong>
        <p>목록에서 항목을 선택하면 핵심 내용과 문서 정보를 확인할 수 있습니다.</p>
      </section>
    );
  }

  return (
    <article className="idea-preview">
      <header>
        <div>
          <p className="eyebrow">IDEA NOTE</p>
          <h2>{item.title}</h2>
        </div>
        <span className="status-pill">수집됨</span>
      </header>
      <div className="idea-preview-body">
        <p>{item.excerpt || "본문 미리보기가 없습니다."}</p>
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
