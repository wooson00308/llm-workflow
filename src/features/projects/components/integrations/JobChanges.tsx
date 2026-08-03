/**
 * 쓰기 전 확인 화면의 차이 표시(SPEC-005 R4).
 *
 * 잡 종류를 알지 못한다. 하트비트 카드와 dream 카드가 자기 잡을 아래 모양으로 만들어 넘기고, 이
 * 파일이 그 값을 그리는 방법을 혼자 정한다. 카드마다 각자 그리면 같은 화면이 갈라진다.
 *
 * 확인 절차 자체는 카드가 그대로 들고 있다. 이 요소는 그 화면에 담기는 정보만 바꾼다.
 */

/** 관리 블록에 그 줄이 없다는 표시. 값이 비어 있는 것과 잡이 새로 생기는 것을 같은 낱말로 읽는다. */
const MISSING = "없음";

/** 편집 가능 값 하나. `current`의 `null`은 그 줄이 관리 블록에 없다는 뜻이다. */
export interface JobFieldChange {
  label: string;
  current: string | null;
  next: string;
}

/** 관리 블록에 기록될 잡 하나. */
export interface WrittenJob {
  name: string;
  /** 관리 블록에 이 잡이 없으면 `true`. 세 필드의 현재 값이 모두 없는 상태와 함께 읽힌다. */
  added: boolean;
  fields: JobFieldChange[];
  /** 앱이 다시 쓸 값과 다른 앱 소유 필드 이름. 값은 담지 않는다. */
  appOwnedDrift: string[];
}

/** 관리 블록에서 빠질 잡 하나. 파일에 적힌 편집값이 함께 사라진다. */
export interface RemovedJob {
  name: string;
  fields: { label: string; current: string | null }[];
}

function changed(field: JobFieldChange): boolean {
  return field.current !== field.next;
}

function describe(field: { label: string; current: string | null }): string {
  return `${field.label} ${field.current ?? MISSING}`;
}

/**
 * 잡별로 파일의 현재 값과 쓰게 될 값을 함께 보여준다.
 *
 * 달라지는 값은 낱말로 구분한다. 색만으로 구분하면 확인 화면이 검증 수단이 되지 못한다.
 */
export function JobChanges({
  written,
  removed,
}: {
  written: WrittenJob[];
  removed: RemovedJob[];
}) {
  const unchanged =
    removed.length === 0 &&
    written.every(
      (job) => !job.added && job.appOwnedDrift.length === 0 && !job.fields.some(changed),
    );

  if (unchanged) {
    return <p>관리 블록에서 달라지는 값이 없습니다. 이대로 쓰면 파일 내용이 그대로 남습니다.</p>;
  }

  return (
    <>
      {written.length > 0 && (
        <ul>
          {written.map((job) => (
            <li key={job.name}>
              {job.name}
              {job.added && " — 관리 블록에 없던 잡입니다. 새로 추가됩니다."}
              <ul>
                {job.fields.map((field) => (
                  <li key={field.label}>
                    {describe(field)}
                    {changed(field) ? ` → ${field.next} — 바뀜` : " — 그대로"}
                  </li>
                ))}
              </ul>
              {job.appOwnedDrift.length > 0 && (
                <p>
                  되돌아감: {job.appOwnedDrift.join(", ")} — 관리 블록에서 고친 값이 앱 값으로 다시 쓰입니다.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {removed.map((job) => (
        <p key={job.name}>
          제거: {job.name} — {job.fields.map(describe).join(" · ")} 값이 함께 사라집니다.
        </p>
      ))}
    </>
  );
}
