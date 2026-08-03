/**
 * 앱이 소유하는 지원 모델 목록. 앱 안에서 이 값이 정의된 곳은 여기 하나뿐이다.
 *
 * 갱신 방법: 앱 릴리스로만 갱신한다. 앱은 목록을 얻으려고 외부 명령을 실행하거나 네트워크를
 * 호출하지 않는다. 클로드 CLI에는 모델 목록을 기계가 읽을 형태로 내보내는 명령이 없다.
 * 확인처: `claude --help`의 `--model` 항목. 별칭(예: opus)과 정식 모델명(예: claude-opus-5)을
 * 모두 받는다고 기술한다.
 *
 * 별칭만 담는다. 별칭은 "그 계열의 최신"을 가리켜 모델 세대가 바뀌어도 유효하지만, 정식
 * 모델명은 출시마다 낡는다. 목록에 없는 값은 직접 입력으로 지정한다(아래 customModelOption).
 * 그래서 이 목록이 낡아도 사용자가 막히지 않는다.
 */
const supportedModels = ["opus", "sonnet", "haiku", "fable"] as const;

/** 선택 컨트롤에서 직접 입력을 고르기 위한 값. 모델 이름과 겹치지 않아야 한다. */
const customModelOption = "__custom__";

export function isSupportedModel(value: string): boolean {
  return (supportedModels as readonly string[]).includes(value);
}

/**
 * 잡의 model 값을 고르는 필드.
 *
 * 직접 입력 여부(`custom`)는 값에서 유도하지 않고 호출자가 상태로 들고 있다. 값에서 유도하면
 * 사용자가 `opusX`를 적는 도중 `opus`를 지나는 순간 입력 칸이 사라진다. 다만 그 상태는 화면
 * 상태일 뿐이라 설치 요청 payload에 섞이지 않는다.
 */
export function ModelField({
  custom,
  fieldLabel,
  id,
  jobLabel,
  message,
  onCustomChange,
  onValueChange,
  value,
}: {
  custom: boolean;
  fieldLabel: string;
  id: string;
  jobLabel: string;
  message: string | undefined;
  onCustomChange(custom: boolean): void;
  onValueChange(value: string): void;
  value: string;
}) {
  // 기존 라벨 규약을 그대로 쓴다. 선택 컨트롤이 "<잡 이름> 모델"이고, 직접 입력 칸은 그 이름과
  // 겹치지 않게 접미사를 붙인다.
  const name = `${jobLabel} ${fieldLabel}`;
  const customId = `${id}-custom`;

  return (
    <div className="heartbeat-job-field">
      <span className="heartbeat-field-label">{fieldLabel}</span>
      <select
        aria-label={name}
        id={id}
        onChange={(event) => {
          const next = event.target.value;
          if (next === customModelOption) {
            // 값은 그대로 둔다. 고르는 것만으로 편집 중인 값이 바뀌면 안 된다.
            onCustomChange(true);
            return;
          }
          onCustomChange(false);
          onValueChange(next);
        }}
        value={custom ? customModelOption : value}
      >
        {supportedModels.map((model) => (
          <option key={model} value={model}>{model}</option>
        ))}
        <option value={customModelOption}>직접 입력</option>
      </select>

      {custom && (
        <>
          <input
            aria-describedby={message ? `${customId}-error` : undefined}
            aria-invalid={message ? true : undefined}
            aria-label={`${name} 직접 입력`}
            id={customId}
            onChange={(event) => onValueChange(event.target.value)}
            value={value}
          />
          {message && <p className="heartbeat-field-error" id={`${customId}-error`}>{message}</p>}
          <p className="integration-note">
            앱은 이 이름이 실제로 있는 모델인지 확인하지 못합니다. 값이 틀리면 잡은 매 주기 실패하고, 실행 쿼터는 실패해도 이미 차감된 뒤입니다.
          </p>
        </>
      )}
    </div>
  );
}
