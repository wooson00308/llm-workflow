import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import type {
  ProjectSummary,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";

export type SearchItemKind = "ideas" | "specs" | "tasks";

interface SearchResult {
  item: WorkflowItemSummary;
  kind: SearchItemKind;
  workflow: WorkflowSummary;
}

interface Props {
  project: ProjectSummary;
  onClose(): void;
  onOpen(result: SearchResult): void;
}

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

export function ProjectSearchDialog({ project, onClose, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    const allResults = project.workflows.flatMap((workflow) =>
      (["ideas", "specs", "tasks"] as const).flatMap((kind) =>
        workflow.items[kind].map((item) => ({ item, kind, workflow })),
      ),
    );

    return allResults
      .filter(({ item, workflow }) => {
        if (!normalized) return true;
        return [
          workflow.name,
          item.title,
          item.id,
          item.fileName,
          item.excerpt,
        ].some((value) => value.toLocaleLowerCase("ko-KR").includes(normalized));
      })
      .sort((left, right) =>
        (right.item.updatedAt ?? "").localeCompare(left.item.updatedAt ?? ""),
      )
      .slice(0, 12);
  }, [project.workflows, query]);

  useEffect(() => setActiveIndex(0), [query]);

  function select(result: SearchResult) {
    onOpen(result);
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      select(results[activeIndex]);
    }
  }

  return (
    <div
      className="project-search-overlay"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-labelledby="project-search-title"
        aria-modal="true"
        className="project-search-dialog"
        role="dialog"
      >
        <h2 className="visually-hidden" id="project-search-title">프로젝트 검색</h2>
        <div className="project-search-field">
          <Icon name="search" />
          <input
            aria-label="프로젝트 검색"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="아이디어, 기획서, 개발 작업 검색"
            value={query}
          />
          <button aria-label="검색 닫기" onClick={onClose} type="button">Esc</button>
        </div>

        <div className="project-search-summary">
          <span>{query.trim() ? `“${query.trim()}” 검색 결과` : "최근 변경된 문서"}</span>
          <small>{results.length}개</small>
        </div>

        <div className="project-search-results" role="listbox">
          {results.map((result, index) => (
            <button
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              key={`${result.workflow.directory}:${result.kind}:${result.item.fileName}`}
              onClick={() => select(result)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <span className={`search-result-icon kind-${result.kind}`}>
                <Icon name={kindIcons[result.kind]} />
              </span>
              <span className="search-result-copy">
                <strong>{result.item.title}</strong>
                <small>{result.workflow.name} · {kindLabels[result.kind]} · {result.item.id}</small>
                {result.item.excerpt && <p>{result.item.excerpt}</p>}
              </span>
              <Icon className="search-result-chevron" name="chevron" />
            </button>
          ))}
          {results.length === 0 && (
            <div className="project-search-empty">
              <Icon name="search" />
              <strong>일치하는 문서가 없습니다</strong>
              <span>제목, ID, 내용 또는 워크플로우 이름을 바꿔 검색해 보세요.</span>
            </div>
          )}
        </div>

        <footer className="project-search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
          <span><kbd>↵</kbd> 열기</span>
          <span><kbd>Esc</kbd> 닫기</span>
        </footer>
      </section>
    </div>
  );
}
