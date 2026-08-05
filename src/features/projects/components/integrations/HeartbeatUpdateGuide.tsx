/**
 * 084 경고가 "하트비트를 갱신하세요"로 끝나는 자리에서 그 갱신을 어떻게 하는지 말한다(SPEC-034 R1).
 *
 * 역할 잡 카드와 dream 카드가 함께 쓴다. 문구를 props로 받지 않는 것이 그 이유다 — 두 카드가 다른
 * 문구를 넘길 수 있는 자리를 만들면 "같은 것을 같은 문구로 말한다"(R7)가 화면 테스트로 내려간다.
 * `JobChanges.tsx`가 두 카드가 함께 쓰는 하위 블록의 선례다.
 *
 * **원인을 단정하지 않는다.** 084 문구는 "앱은 하트비트 버전을 판정하지 않으므로 둘 중 어느 쪽인지
 * 알지 못합니다"로 끝난다. 이 안내가 "갱신하면 해결됩니다"처럼 말하면 그 문장과 모순된다. 여기는
 * "갱신하기로 했다면 이렇게 한다"를 말하는 자리다.
 *
 * 명령 원문은 만들지 않는다. 다섯 값 전부 payload가 완성해 싣고 화면은 그리기만 한다(R3).
 */
import { useState } from "react";
import type { HeartbeatUpdateGuide as UpdateGuide } from "../../domain/types";
import { copy } from "../../infrastructure/clipboard";

const title = "하트비트를 갱신하는 방법";

/** 갈래가 둘인 이유가 이 문장이다. 앱이 이 기기의 설치 방법을 알지 못한다는 것이 전제다(R2). */
const principle =
  "설치한 방법 그대로 갱신합니다. 앱은 이 기기에 하트비트가 어떻게 설치됐는지 알지 못하므로, 아래에서 자기 설치 방법에 맞는 갈래를 고릅니다.";

const identifyNote =
  "어느 갈래인지 먼저 확인합니다. 결과에 Editable project location 줄이 있으면 소스 체크아웃으로 설치한 것이고, 없으면 pip으로 설치한 것입니다.";

const packageNote = "pip으로 설치했다면 이 명령으로 갱신합니다.";

/** 경로를 붙이지 못하는 이유를 그 자리에서 말한다. 앱이 모르는 값을 지어내지 않는다(R2). */
const sourceNote =
  "소스 체크아웃으로 설치했다면 체크아웃 디렉터리에서 이 명령을 실행합니다. 앱은 그 디렉터리가 어디인지 알지 못하므로 경로를 대신 적어 주지 못합니다.";

/** R4. 이 문장이 없으면 사용자는 갱신했는데 아무것도 달라지지 않는 상태를 만난다. */
const restartNote =
  "갱신한 뒤에는 하트비트를 재시작합니다. 코드를 갱신해도 이미 돌고 있는 프로세스는 갱신 전 코드를 그대로 들고 있어서, 재시작하지 않으면 갱신한 것이 반영되지 않습니다.";

const lookupNote = "재시작할 등록물의 라벨을 확인합니다.";

/** `<라벨>`이 사용자가 바꿔 넣는 자리라는 것과, 앱이 그 값을 알지 못한다는 것을 함께 말한다. */
const restartCommandNote =
  "확인한 라벨을 <라벨> 자리에 넣어 재시작합니다. 앱은 이 기기에 등록된 라벨을 알지 못하므로 그 자리를 채워 두지 못합니다.";

/**
 * 재시작 두 값이 없을 때. 명령을 지어내지 않고 앱이 모른다는 사실을 말한다. 설치 마법사 3단계가
 * 같은 상태를 같은 어법으로 말한다.
 */
const unknownRestartNote =
  "앱은 이 플랫폼에서 하트비트를 재시작하는 방법을 알지 못합니다. 갱신한 뒤 하트비트를 직접 재시작하세요.";

/** 걸음 하나. `name`은 복사 버튼의 aria-label 앞자리이고 `key`는 복사 결과를 붙일 자리다. */
interface GuideStep {
  key: string;
  name: string;
  note: string;
  command: string;
}

const branchSteps = (guide: UpdateGuide): GuideStep[] => [
  { key: "identify", name: "설치 갈래 확인", note: identifyNote, command: guide.identifyCommand },
  { key: "package", name: "pip 설치 갱신", note: packageNote, command: guide.packageCommand },
  { key: "source", name: "소스 체크아웃 갱신", note: sourceNote, command: guide.sourceCommand },
];

/**
 * 재시작 걸음 둘. 두 값은 함께 실리거나 함께 빠지므로 한쪽만 있는 상태는 그리지 않는다 —
 * 라벨을 확인할 방법 없이 재시작 명령만 내밀면 `<라벨>` 자리를 채울 수가 없다.
 */
function restartSteps(guide: UpdateGuide): GuideStep[] | null {
  const { serviceLookupCommand, serviceRestartCommand } = guide;
  if (serviceLookupCommand === null || serviceRestartCommand === null) return null;
  return [
    { key: "lookup", name: "서비스 라벨 확인", note: lookupNote, command: serviceLookupCommand },
    { key: "restart", name: "하트비트 재시작", note: restartCommandNote, command: serviceRestartCommand },
  ];
}

export function HeartbeatUpdateGuide({ guide }: { guide: UpdateGuide }) {
  // 복사 결과를 컴포넌트가 스스로 든다. 역할 잡 카드는 이 안내를 역할마다 그릴 수 있어(경고가
  // 역할별이다) 카드가 상태를 들면 한 화면의 여러 자리에 "복사됨"이 함께 뜬다. 마지막으로 복사한
  // 명령 하나만 표시하는 것은 설치 마법사와 같다.
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);

  async function copyCommand(step: GuideStep) {
    setCopied({ key: step.key, ok: await copy(step.command) });
  }

  function stepItem(step: GuideStep) {
    const result = copied?.key === step.key ? copied : null;
    return (
      <li className="heartbeat-update-step" key={step.key}>
        <p>{step.note}</p>
        {/* 복사에 실패해도 원문은 여기 남아 사용자가 직접 선택할 수 있다(R1). 복사 버튼이 원문을
            대체하지 않는다. 마법사와 실행 실패 표시가 같은 이유로 같은 모양을 쓴다. */}
        <pre className="heartbeat-update-command"><code>{step.command}</code></pre>
        <div className="heartbeat-update-copy">
          {/* 갱신을 대신 실행하지 않는다(R5). 조작은 복사까지이고 확인 대화상자를 끼우지 않는다. */}
          <button
            aria-label={`${step.name} 명령 복사`}
            className="secondary-button heartbeat-update-copy-button"
            onClick={() => void copyCommand(step)}
            type="button"
          >
            명령 복사
          </button>
          {result && (
            <span
              className={`heartbeat-update-copied${result.ok ? "" : " copy-failed"}`}
              role="status"
            >
              {result.ok ? "복사됨" : "복사하지 못했습니다 — 위 명령을 직접 선택해 복사하세요."}
            </span>
          )}
        </div>
      </li>
    );
  }

  const restart = restartSteps(guide);

  return (
    <div className="heartbeat-update-guide">
      <strong>{title}</strong>
      <p>{principle}</p>
      {/* 번호를 매기지 않는다. 갈래 둘은 함께 하는 일이 아니라 둘 중 하나를 고르는 일이다. */}
      <ul className="heartbeat-update-steps">{branchSteps(guide).map(stepItem)}</ul>
      <p>{restartNote}</p>
      {restart === null ? (
        <p>{unknownRestartNote}</p>
      ) : (
        <ul className="heartbeat-update-steps">{restart.map(stepItem)}</ul>
      )}
    </div>
  );
}
