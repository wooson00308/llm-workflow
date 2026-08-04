import { useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import { browserIdeaDraftStore } from "../infrastructure/browserIdeaDraftStore";

interface Props {
  busy: boolean;
  compact?: boolean;
  disabled: boolean;
  onAdd(content: string): Promise<boolean>;
  /**
   * 초안이 담길 워크플로의 디렉터리. 워크플로가 없으면 `undefined`이고 그때는 읽지도 쓰지도 않는다.
   *
   * 이 값이 바뀌면 호출부가 `key`로 이 컴포넌트를 다시 마운트한다. 그래야 워크플로를 바꿨을 때
   * 이전 워크플로의 글이 입력창에 남아 엉뚱한 곳에 제출되지 않는다(SPEC-025 R3).
   */
  workflowDirectory: string | undefined;
}

export function IdeaComposer({
  busy,
  compact = false,
  disabled,
  onAdd,
  workflowDirectory,
}: Props) {
  // 마운트할 때 한 번만 읽는다. 두 입력창이 동시에 보이는 일이 없으므로, 한쪽이 언마운트되고 다른
  // 쪽이 마운트할 때 같은 키를 읽는 것으로 "두 입력창의 초안은 하나"가 성립한다.
  const [idea, setIdea] = useState(() =>
    workflowDirectory ? browserIdeaDraftStore.load(workflowDirectory) : "",
  );

  /**
   * 사용자가 입력창을 고쳤을 때만 저장한다.
   *
   * 첫 마운트에서 읽은 값을 되쓰지 않는 것이 이 배선의 핵심이다. 되쓰면 비활성 상태로 화면이 그려지는
   * 것만으로 빈 값이 저장되어 사용자가 쓰던 글이 사라진다(완료 조건 12). 사용자가 직접 비운 경우는
   * 이 경로를 그대로 타서 저장된 초안도 없어진다(R2).
   */
  function edit(value: string) {
    setIdea(value);
    if (workflowDirectory) browserIdeaDraftStore.save(workflowDirectory, value);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!idea.trim()) return;
    // 담기지 못했으면 지역 상태와 저장된 초안을 둘 다 남긴다. 실패한 글을 잃지 않는 현행 규칙을
    // 저장된 초안까지 넓힌 것이다(R2).
    if (await onAdd(idea.trim())) {
      setIdea("");
      if (workflowDirectory) browserIdeaDraftStore.clear(workflowDirectory);
    }
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
          onChange={(event) => edit(event.target.value)}
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
