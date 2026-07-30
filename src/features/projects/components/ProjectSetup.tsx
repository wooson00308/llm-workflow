import { useState } from "react";
import type { ProjectSummary } from "../domain/types";
import { Icon } from "../../../shared/ui/Icon";

interface Props {
  busy: boolean;
  error: string | null;
  project: ProjectSummary;
  onBack(): void;
  onCreate(name: string): Promise<boolean>;
}

export function ProjectSetup({ busy, error, project, onBack, onCreate }: Props) {
  const [name, setName] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim()) await onCreate(name.trim());
  }

  return (
    <main className="setup-shell">
      <button className="text-button back-button" onClick={onBack}>← 프로젝트 다시 선택</button>
      <section className="setup-card">
        <div className="brand-mark small"><Icon name="workflow" /></div>
        <p className="eyebrow">NEW WORKFLOW</p>
        <h1>{project.name}에<br />첫 워크플로우를 만듭니다.</h1>
        <p className="setup-description">
          원본 프로젝트는 그대로 유지됩니다. 기획과 작업 문서는 아래 전용 디렉터리에 생성됩니다.
        </p>
        <div className="path-preview">
          <Icon name="folder" />
          <span>{project.rootPath}/.workflow/</span>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="workflow-name">워크플로우 이름</label>
          <input
            autoFocus
            id="workflow-name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="예: 온보딩 개편"
            value={name}
          />
          <p className="field-help">기능, 릴리스 또는 실험 단위의 이름이 좋습니다.</p>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <div className="setup-actions">
            <button className="secondary-button" type="button" onClick={onBack}>취소</button>
            <button className="primary-button" disabled={busy || !name.trim()} type="submit">
              <Icon name="plus" /> {busy ? "생성 중…" : "워크플로우 만들기"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
