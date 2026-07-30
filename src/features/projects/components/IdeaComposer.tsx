import { useState } from "react";
import { Icon } from "../../../shared/ui/Icon";

interface Props {
  busy: boolean;
  compact?: boolean;
  disabled: boolean;
  onAdd(content: string): Promise<boolean>;
}

export function IdeaComposer({ busy, compact = false, disabled, onAdd }: Props) {
  const [idea, setIdea] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!idea.trim()) return;
    if (await onAdd(idea.trim())) setIdea("");
  }

  return (
    <section className={`idea-composer${compact ? " compact" : ""}`}>
      <div className="composer-icon"><Icon name="idea" /></div>
      <form onSubmit={submit}>
        <label htmlFor={compact ? "quick-idea" : "idea-inbox-input"}>
          {compact ? "무엇을 만들어볼까요?" : "새로운 생각을 인박스에 담기"}
        </label>
        <textarea
          disabled={disabled}
          id={compact ? "quick-idea" : "idea-inbox-input"}
          maxLength={10_000}
          onChange={(event) => setIdea(event.target.value)}
          placeholder="떠오른 아이디어를 편하게 적어주세요. 아직 구체적이지 않아도 괜찮습니다."
          value={idea}
        />
        <div className="composer-footer">
          <span>Markdown으로 안전하게 저장됩니다</span>
          <button
            className="primary-button"
            disabled={busy || disabled || !idea.trim()}
            type="submit"
          >
            <Icon name="plus" />아이디어 추가
          </button>
        </div>
      </form>
    </section>
  );
}
