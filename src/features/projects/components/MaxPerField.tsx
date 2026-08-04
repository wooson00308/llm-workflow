/** 선택 컨트롤의 두 값. 한도 값과 겹치지 않아야 한다. */
const limitOption = "__limit__";
const unlimitedOption = "__unlimited__";

/**
 * 기간 값을 초로 바꾼다. 백엔드 `parse_duration`과 같은 규칙이다. 형식이 다르면 `null`이다.
 *
 * 초 환산까지 하는 이유는 `4/0d`처럼 단위가 커도 0초인 값이 있기 때문이다. 자릿수만 보는 규칙으로는
 * 그 값을 거를 수 없다.
 */
function durationSeconds(value: string): number | null {
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const multiplier = multipliers[value.slice(-1)];
  if (multiplier === undefined) return null;
  const number = value.slice(0, -1);
  if (!/^\d+$/.test(number)) return null;
  return Number(number) * multiplier;
}

/** 형식이 어긋난 값의 문구. 백엔드 `QUOTA_FORMAT_MESSAGE`와 같은 글자다. */
const formatMessage = "<횟수>/<기간> 형태로 적어 주세요. 예: 4/24h";

/**
 * 데몬이 한도로 인정하지 않는 값의 문구. 백엔드 `QUOTA_IGNORED_MESSAGE`와 같은 글자다(R4).
 *
 * 이 값의 위험은 형식이 틀린 것이 아니라 의도와 정반대로 동작한다는 데 있다. 0을 넣는 동기는 대개
 * "이 잡을 돌리고 싶지 않다"인데 그 의도에 맞는 경로는 잡을 끄는 것이고, 반대편에 제한 없음이 있다.
 * 두 곳이 갈리면 사용자는 같은 거부에 대해 다른 설명을 듣는다.
 */
const ignoredMessage =
  "횟수는 1 이상, 기간은 1초 이상이어야 합니다. 하트비트는 0을 한도로 인정하지 않아, 이 값을 쓰면 잡이 멈추는 대신 오히려 제한 없이 실행됩니다. 이 잡을 돌리고 싶지 않다면 잡을 끄고, 한도 없이 돌리려면 실행 한도를 제한 없음으로 지정하세요.";

/**
 * 한도 값 하나의 거부 사유. 통과하면 `null`이다.
 *
 * 판정 규칙은 백엔드 `check_quota`와 같다. 이중 방어선 양쪽이 같은 값을 받고 같은 값을 거부해야
 * 저장 버튼이 통과시킨 값이 백엔드에서 떨어지지 않는다.
 */
export function maxPerFieldError(value: string): string | null {
  const separator = value.indexOf("/");
  if (separator < 0) return formatMessage;
  const count = value.slice(0, separator);
  const window = value.slice(separator + 1);
  if (!/^\d+$/.test(count)) return formatMessage;
  const seconds = durationSeconds(window);
  if (seconds === null) return formatMessage;
  // 형식은 맞다. 데몬이 한도로 인정하는 값인지는 여기서 갈린다.
  if (Number(count) === 0 || seconds === 0) return ignoredMessage;
  return null;
}

/**
 * 잡의 실행 한도를 정하는 필드. 두 카드가 같은 규칙을 쓴다(R1).
 *
 * 선택과 값 입력의 조합이다(기획서 확인 필요 1번의 승인된 제안). 자유 입력으로 특정 문구를 받으면
 * 파일 값과 구별되지 않는 새 어휘가 생기고 오타가 곧 검증 실패가 된다.
 *
 * `ModelField`와 달리 **선택 자체가 값이다.** 직접 입력으로 바꾸는 것은 파일에 쓰일 값을 바꾸지
 * 않지만, 제한 없음으로 바꾸는 것은 관리 블록에서 한도 줄을 빼는 결정이다. 그래서 호출자가 두 콜백
 * 모두를 지정으로 기록한다.
 */
export function MaxPerField({
  fieldLabel,
  id,
  jobLabel,
  message,
  onUnlimitedChange,
  onValueChange,
  unlimited,
  value,
}: {
  fieldLabel: string;
  id: string;
  jobLabel: string;
  message: string | undefined;
  onUnlimitedChange(unlimited: boolean): void;
  onValueChange(value: string): void;
  unlimited: boolean;
  value: string;
}) {
  // `ModelField`의 라벨 규약을 그대로 쓴다. 선택 컨트롤이 "<잡 이름> 실행 한도"이고, 값 입력 칸은
  // 그 이름과 겹치지 않게 접미사를 붙인다.
  const name = `${jobLabel} ${fieldLabel}`;
  const valueId = `${id}-value`;

  return (
    <div className="heartbeat-job-field">
      <span className="heartbeat-field-label">{fieldLabel}</span>
      <select
        aria-label={name}
        id={id}
        onChange={(event) => onUnlimitedChange(event.target.value === unlimitedOption)}
        value={unlimited ? unlimitedOption : limitOption}
      >
        <option value={limitOption}>한도 지정</option>
        <option value={unlimitedOption}>제한 없음</option>
      </select>

      {unlimited ? (
        <p className="integration-note">
          이 잡은 실행 횟수 제한 없이 주기마다 실행됩니다. 관리 블록에 한도 줄을 쓰지 않는 것으로 기록합니다.
        </p>
      ) : (
        <>
          <input
            aria-describedby={message ? `${valueId}-error` : undefined}
            aria-invalid={message ? true : undefined}
            aria-label={`${name} 값`}
            id={valueId}
            onChange={(event) => onValueChange(event.target.value)}
            value={value}
          />
          {message && <p className="heartbeat-field-error" id={`${valueId}-error`}>{message}</p>}
        </>
      )}
    </div>
  );
}
