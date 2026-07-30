import type { RecentProject } from "../domain/types";
import { Icon } from "../../../shared/ui/Icon";

interface Props {
  busy: boolean;
  error: string | null;
  recentProjects: RecentProject[];
  onOpenFolder(): void;
  onOpenRecent(path: string): void;
}

export function ProjectPicker({
  busy,
  error,
  recentProjects,
  onOpenFolder,
  onOpenRecent,
}: Props) {
  return (
    <main className="launch-shell">
      <section className="launch-hero" aria-labelledby="launch-title">
        <div className="brand-mark"><Icon name="workflow" /></div>
        <p className="eyebrow">LOCAL WORKFLOW CLIENT</p>
        <h1 id="launch-title">생각에서 실행까지,<br />한 프로젝트 안에서.</h1>
        <p className="launch-copy">
          Markdown은 그대로 두고, 아이디어·기획·승인·개발 흐름을 한눈에 관리하세요.
        </p>
        <button className="primary-button large" disabled={busy} onClick={onOpenFolder}>
          <Icon name="folder" />
          {busy ? "프로젝트 확인 중…" : "프로젝트 폴더 열기"}
        </button>
        {error && <div className="error-banner" role="alert">{error}</div>}
      </section>

      <section className="recent-panel" aria-labelledby="recent-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RECENT</p>
            <h2 id="recent-title">최근 프로젝트</h2>
          </div>
          <span>{recentProjects.length}</span>
        </div>
        {recentProjects.length === 0 ? (
          <div className="empty-recent">
            <Icon name="folder" />
            <p>아직 연 프로젝트가 없습니다.</p>
            <span>프로젝트 폴더를 선택하면 여기에 고정됩니다.</span>
          </div>
        ) : (
          <div className="recent-list">
            {recentProjects.map((project) => (
              <button
                className="recent-project"
                key={project.path}
                onClick={() => onOpenRecent(project.path)}
              >
                <span className="recent-icon"><Icon name="folder" /></span>
                <span className="recent-copy">
                  <strong>{project.name}</strong>
                  <small>{project.path}</small>
                </span>
                <Icon className="chevron" name="chevron" />
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
