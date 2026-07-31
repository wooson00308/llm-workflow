import { Icon } from "../../../shared/ui/Icon";

const flow = [
  { actor: "나", title: "아이디어를 적는다", detail: "떠오르는 생각을 형식 없이 기록합니다." },
  { actor: "LLM", title: "기획서가 올라온다", detail: "기획자 세션이 아이디어를 기획서로 다듬습니다." },
  { actor: "나", title: "도장을 찍는다", detail: "승인 · 수정 요청 · 폐기 중 하나를 결정합니다." },
  { actor: "LLM", title: "개발이 진행된다", detail: "아키텍트가 작업을 나누고 개발자가 구현합니다." },
  { actor: "나", title: "QA로 마무리한다", detail: "결과를 확인하고 완료 또는 수정 요청을 남깁니다." },
] as const;

const roles = [
  { name: "기획자", detail: "아이디어를 기획서로 만들고 검토 대기에서 멈춥니다." },
  { name: "아키텍트", detail: "승인된 기획서를 개발 작업으로 나눕니다." },
  { name: "개발자", detail: "작업 하나를 구현하고 QA 대기로 올립니다." },
];

export function HelpView() {
  return (
    <section className="help-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">HELP</p>
          <h1>도움말</h1>
          <p>이 앱이 어떻게 돌아가는지 한눈에 봅니다.</p>
        </div>
      </div>

      <p className="help-lede">
        아이디어를 적고, 기획서에 도장을 찍고, 결과를 확인하세요.
        나머지는 전부 LLM의 일입니다.
      </p>
      <p className="help-lede-sub">
        앱과 LLM은 <code>.workflow/</code> 폴더의 문서로 협업합니다. 앱이 LLM을 실행하지는 않습니다.
      </p>

      <ol className="help-flow">
        {flow.map((step) => (
          <li className={step.actor === "나" ? "me" : "llm"} key={step.title}>
            <span aria-hidden="true">{step.actor}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="help-details">
        <details>
          <summary>
            <Icon name="workflow" />LLM에게 어떻게 시키나요?
            <Icon className="chevron" name="chevron" />
          </summary>
          <div>
            <p>
              프로젝트 폴더에서 Claude Code나 Codex를 열고 역할 하나만 맡기세요.
              규칙은 워크플로우를 만들 때 자동으로 설치돼 있습니다.
            </p>
            <code className="help-prompt">기획자 역할로 대기 중인 아이디어 하나를 기획서로 만들어줘.</code>
            <dl className="help-roles">
              {roles.map((role) => (
                <div key={role.name}>
                  <dt>{role.name}</dt>
                  <dd>{role.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </details>

        <details>
          <summary>
            <Icon name="spark" />알아두면 좋아요
            <Icon className="chevron" name="chevron" />
          </summary>
          <div>
            <ul className="help-tips">
              <li>문서 변경은 몇 초 안에 화면에 자동 반영됩니다.</li>
              <li><kbd>⌘K</kbd>로 아이디어 · 기획서 · 작업을 한 번에 검색합니다.</li>
              <li>모든 문서는 Markdown 파일이라 편집기로 직접 열어도 됩니다.</li>
              <li>완료 처리는 사용자만 할 수 있습니다. LLM은 QA 대기까지만 진행합니다.</li>
            </ul>
          </div>
        </details>
      </div>
    </section>
  );
}
