# TASK-053 개발자 핸드오프

- 대상 작업: TASK-053 (역할 잡 편집 폼이 제한 없음을 고르게 하고 데몬이 인정하지 않는 값을 화면에서 막는다)
- 근거 문서: SPEC-017 R1·R3의 화면 몫·R4의 화면 검증·R5의 폼 표시 규칙, DECISION-EC07DE7E
  (approved, created_by: user — 확인 필요 1·2번을 제안대로 확정)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T10:12Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 사용자가 병렬 작업을 승인했고 이 세션은 TASK-053 하나만 배정받았다.
- `migration.lock` 없음. 착수 시점(10:01Z) lease는 `SPEC-009`·`TASK-044`·`TASK-055`뿐이었고
  TASK-053을 덮는 것은 없었다.
- `depends_on: [TASK-052, TASK-030]` 둘 다 `qa_waiting`이라 충족. 요청 계약(TASK-051)과 사용량
  상태(TASK-052)가 이 폼이 보낼 값과 보여줄 상태의 전제다.
- `.workflow/rules/wf-claim.sh`가 아직 없어 §4 미설치 폴백대로 `set -C`로 배타 생성했다.

## 결정과 근거

### 1. `MaxPerField` — 선택과 값 입력의 조합

`ModelField.tsx` 옆에 `MaxPerField.tsx`를 만들었다. 두 카드가 같은 규칙을 써야 하고(R1), 검증
규칙이 정규식 하나로 적히지 않게 되었기 때문이다(R4).

선택 컨트롤(`한도 지정` / `제한 없음`)이 위에 있고 `한도 지정`일 때만 값 칸이 나온다. 자유 입력으로
특정 문구를 받는 대안을 쓰지 않은 이유는 기획서 확인 필요 1번 그대로다 — 파일 값과 구별되지 않는 새
어휘가 생기고 오타가 곧 검증 실패가 된다.

**`ModelField`와 갈리는 지점이 하나 있다. 선택 자체가 값이다.** 모델의 "직접 입력"으로 바꾸는 것은
파일에 쓰일 값을 바꾸지 않아 지정으로 치지 않지만, 제한 없음으로 바꾸는 것은 관리 블록에서 한도 줄을
빼는 결정이다. 그래서 호출자가 두 콜백 모두를 지정으로 기록한다(`switchMaxPer`).

값 문자열은 선택과 별개로 유지한다. 제한 없음으로 갔다가 한도 지정으로 되돌아와도 칸이 비어 있지
않다. 필드는 값을 스스로 지우지 않는다.

라벨 규약은 `ModelField`와 같다. 선택 컨트롤이 `<잡 이름> 실행 한도`이고 값 칸은 `<잡 이름> 실행
한도 값`이다.

### 2. `maxPerFieldError` — 백엔드와 같은 판정

TASK-051이 `check_quota`에 적은 규칙을 그대로 옮겼다. 두 곳이 갈리면 저장 버튼이 통과시킨 값이
백엔드에서 떨어진다.

- `<횟수>/<기간>` 형태가 아니면 형식 문구.
- 형태는 맞지만 횟수가 0이거나 기간이 초로 0이면 `Ignored` 문구. **글자까지 백엔드와 같다.**
- 기간의 초 환산까지 한다. 자릿수만 보는 규칙으로는 `4/0d`를 거를 수 없다.

`fieldRules`에서 `maxPer` 항목을 지웠다. 타입도 `Record<Exclude<EditableField, "maxPer">, ...>`로
좁혀, 그 규칙이 두 벌이 되는 것을 컴파일 단계에서 막는다.

### 3. 폼이 세 상태를 든다

`RoleForm`에 `maxPerUnlimited: boolean`을 더했다. `maxPer` 문자열은 한도 지정일 때의 값으로 남는다.

`roleFormFrom`의 시딩이 R3이 지목한 자리다.

- 블록에 있고 한도 줄이 있으면: `maxPerUnlimited: false`, `maxPer: 파일 값`. `0/24h`도 그대로
  보여준다(R5) — 앱이 몰래 앱 기본값이나 제한 없음으로 갈아치우지 않는다.
- 블록에 있고 한도 줄이 없으면: `maxPerUnlimited: true`, `maxPer: defaults.maxPer`. 앱 기본값은
  화면에 보이지 않고 한도 지정으로 되돌렸을 때 칸에 들어 있을 값으로만 쓰인다.
- 블록에 없으면(첫 설치·꺼진 잡): 지금과 같다.

`seed`가 부르는 경로가 하나라 파일 변경 후 되시딩과 재설정 뒤 되시딩도 같은 규칙을 따른다.

요청 조립은 세 상태를 그대로 옮긴다. 지정하지 않았으면 `null`, 지정했으면 `{ kind: "unlimited" }`
또는 `{ kind: "limit", value }`다. `resetRequestOf`는 TASK-051이 만든 모양 그대로다.

`invalidFields`는 제한 없음인 역할의 한도 칸을 검사하지 않는다. 검사할 값이 없다.

### 4. 차이 표시 — "제한 없음"과 "없음"을 가른다

`JobChanges`는 `current`가 `null`이면 "없음"으로 그린다. 한도 줄의 없음은 이제 "제한 없음"이라
그 둘이 갈려야 한다(완료 조건 8).

`fileValue(job, field)`·`formValue(form, field)` 둘로 규칙을 모으고 네 자리에 모두 적용했다
(`writtenJobs`·`removedJobs`·`fileChanges`·`fileRemovals`, 그리고 `resetChanges`).

- 잡이 블록에 **있고** 한도 줄이 없으면 `current`는 `"제한 없음"`이다.
- 잡이 블록에 **없으면** `current`는 지금처럼 `null`이다. `added`가 그 사실을 따로 밝힌다.
- `next`는 폼이 제한 없음이면 `"제한 없음"`, 아니면 값 그대로다.

`JobChanges.tsx`는 고치지 않았다. 그 요소는 잡 종류도 필드 뜻도 모르는 채 문자열만 그린다.

여기서 얻은 부수 효과 하나를 테스트로 남겼다. 고치기 전에는 한도 줄이 없는 잡의 `current`가 `null`,
`next`가 앱 기본값이라 **손대지 않은 잡이 바뀌는 것처럼 보였다.** 이제 확인 화면이 "관리 블록에서
달라지는 값이 없습니다"로 접힌다.

### 5. 끈 잡의 제한 없음 기억

`RememberedJobValues`의 `maxPer`를 `string | null`로 넓혔다. **키가 없으면 "기억하지 못함",
`null`은 "제한 없음"이다.** 나머지 세 필드는 그대로 문자열이다.

- `load`는 `maxPer`에 한해 `null`도 받는다. 다른 필드의 `null`은 지금처럼 버린다.
- 카드의 `toggle`은 끄는 잡의 `installedJob.maxPer`를 그대로 넘긴다. 기존 `?? undefined`가 제한
  없음을 "기억하지 못함"으로 바꾸던 자리다.
- 다시 켤 때는 `maxPer`만 따로 옮긴다. 통째로 펼치면(`...recalled`) 칸에 `null`이 들어간다.
- 저장 키(`workflow-labs.job-value-memory.v1`)와 버전은 바꾸지 않았다. 형태가 넓어질 뿐이라 기존
  저장분(문자열)은 그대로 읽힌다.

TASK-051 보고서에서 후속으로 넘겼던 항목이 여기서 닫혔다.

## 변경 파일

- `src/features/projects/components/MaxPerField.tsx` — 신설. 필드와 `maxPerFieldError`
- `src/features/projects/components/integrations/HeartbeatCard.tsx` — 폼 상태·시딩·요청 조립·검증·
  차이 표시·토글의 값 기억
- `src/features/projects/infrastructure/jobValueMemoryStore.ts` — `maxPer`가 `null`을 받는다
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 새 시나리오와 기존
  단정의 라벨 갱신
- `src/features/projects/components/integrations/DreamCard.tsx` — 아래 "범위에서 벗어난 변경"

`App.css`·`types.ts`·`ModelField.tsx`·`JobChanges.tsx`·`src-tauri/src/**`는 건드리지 않았다.

## 갱신한 기존 테스트

삭제하거나 비활성화한 테스트는 없다. 한도 칸의 접근성 이름이 갈리면서 **값**을 단정하던 일곱 자리가
`"개발자 실행 한도"` → `"개발자 실행 한도 값"`으로 바뀌었다. 단정하던 사실은 그대로다.

이 이름 변경은 승인된 설계의 결과다. 선택 컨트롤이 `<잡 이름> 실행 한도`를 갖고 값 칸이 그와 겹치지
않는 이름을 쓰는 것이 `ModelField`의 기존 규약이다.

관리 블록을 읽지 못한 상태의 테스트(`queryByLabelText("개발자 실행 한도")`가 없어야 한다)는 그대로
뒀다. 그 화면은 폼 전체를 그리지 않아 선택 컨트롤도 값 칸도 없다.

## 추가한 테스트 (16개)

새 describe `IntegrationsView 역할 잡 실행 한도`에 모았다.

폼과 저장

- `sends unlimited for the job the user set it on and leaves the others unspecified` (완료 조건 1)
- `explains what unlimited means and hides the value input` (R1)
- `keeps the typed value when switching back to a limit`
- `opens a job without a quota line as unlimited and seeds no app default` — 앱 기본값 `6/24h`가
  그 잡 행 어디에도 없음까지 본다 (완료 조건 2)
- `specifies nothing when an unlimited job is saved untouched` (완료 조건 3)
- `leaves the quota unspecified when only another field is edited` (완료 조건 4)
- `blocks %s and names both the job toggle and unlimited` — `0/24h`·`4/0h`·`0/1s`·`4/0d` 넷.
  문구에 "제한 없이 실행됩니다"·"잡을 끄고"·"제한 없음으로 지정"이 모두 있고, 확인 화면이 열리지
  않으며 게이트웨이가 불리지 않는다 (완료 조건 5·6)
- `accepts the smallest quota the daemon honours` — `1/1s` 경계값
- `shows %s from the file and blocks the save until it is fixed` — `0/24h`·`4/0h`. 폼에 그 값이
  그대로 보이고, 모델만 바꿔도 저장이 막힌다 (완료 조건 7)
- `stops blocking once the job with a broken quota is turned off` — 끄면 블록에서 빠지므로 검증할
  값도 사라진다. 기존 "끄면 사라진다" 규약과 같다

차이 표시

- `reads an untouched unlimited job as changing nothing` (완료 조건 8)
- `labels the quota of an unlimited job as 제한 없음 and not as 없음` (완료 조건 8)
- `shows the switch from a limit to unlimited as a change` — `24/24h → 제한 없음 — 바뀜`
- `still reads a job absent from the block as a missing value` — 그 "없음"은 잡 자체가 없다는 뜻이다

값 기억

- `recalls the chosen unlimited after the job is turned off and on` (완료 조건 9)
- `resets an unlimited job back to the app default limit`
- `still recalls a limit after the job is turned off and on` — 기존 동작을 깨지 않는다

## 검증

- `npm run check` — 293 passed / 0 failed (272 → 293, +21), `tsc -b`·`vite build` 통과
- `cargo test --manifest-path src-tauri/Cargo.toml` — 306 passed / 0 failed. 회귀 확인용이고 이
  작업은 백엔드를 건드리지 않았다. (298에서 늘어난 몫은 병렬 세션의 것이다)

## 범위에서 벗어난 변경

`src/features/projects/components/integrations/DreamCard.tsx`의 `toggle` 한 곳을 고쳤다. 작업 문서는
이 파일을 "바뀌지 않는다"로 적었지만, 같은 문서의 5절이 지시한 저장소 타입 확장이 이 파일과 타입으로
엮여 있다. dream 카드도 `...recalled`를 `DreamForm`에 펼치는데 그 폼의 `maxPer`는 `string`이라
`string | null`이 들어가지 못한다. 두 지시가 충돌하는 자리다.

동작을 바꾸지 않는 쪽으로 최소 수정했다. 기억한 `maxPer`가 `null`이면 폼에도 지정 기록에도 넣지 않고
흘려보낸다 — 그 키가 없던 때와 정확히 같이 동작한다. dream 카드가 제한 없음을 폼에 세우는 것은
TASK-054가 `MaxPerField`를 붙이면서 할 일이다.

덧붙여 dream 카드의 `remember`는 아직 `?? undefined`라 `null`을 저장하지 않는다. 그 자리도 TASK-054
몫이라 손대지 않았다.

## 리스크와 후속

1. **dream 카드는 아직 제한 없음을 고를 수 없다.** TASK-054가 `MaxPerField`를 붙일 때까지 dream 잡의
   한도 칸은 자유 입력이고 `0/24h`를 통과시킨다. 백엔드(TASK-051)가 막으므로 파일은 안전하지만,
   사용자에게는 화면 검증이 아니라 저장 실패로 뜬다. **두 카드의 규칙이 잠시 다른 상태다.**

2. **`Ignored` 문구가 이제 두 곳에 있다.** `heartbeat_jobs.rs`의 `QUOTA_IGNORED_MESSAGE`와
   `MaxPerField.tsx`의 `ignoredMessage`다. 글자까지 같게 두었고 양쪽에 서로를 가리키는 주석을
   달았다. 한쪽만 고치면 사용자가 같은 거부에 대해 다른 설명을 듣는다.

3. **아주 큰 수의 처리가 두 검증에서 갈린다.** 백엔드는 `u64` 파싱과 곱셈 오버플로를 형식 오류로
   떨어뜨리지만 화면은 자릿수만 본다. `99999999999999999999/24h` 같은 값이 화면을 통과하고 백엔드에서
   거부된다. 현실적인 입력이 아니고 고치기 전 정규식도 같은 성질이었다. 이중 방어선의 뒤쪽이 잡으므로
   파일은 안전하다.

4. **끄기 안내 문구가 값 기억과 어긋난다(이 작업의 변경 아님).** 잡을 끌 때 뜨는 "다시 켜면
   기본값으로 시작합니다"는 값 기억 스토어가 들어온 뒤로 사실이 아니다. 이 작업의 범위 밖이고
   `HeartbeatCard.tsx`를 함께 만지는 TASK-046·049·050이 있어 손대지 않았다. **핸드오프로 남긴다.**

## 사용자 QA 항목

작업 문서의 항목 그대로다. 실제 앱 창과 파일이 필요하다.

- 역할 잡 하나를 제한 없음으로 저장한 뒤 `~/.claude/HEARTBEAT.md`에서 그 잡의 `max_per` 줄이
  사라졌는지.
- 그 화면을 다시 열었을 때 제한 없음이 그대로 보이고, 아무것도 바꾸지 않고 다시 저장해도 줄이
  되살아나지 않는지.
- 한도 칸에 `0/24h`를 넣었을 때 거부 문구가 뜨고, 그 문구만 읽고도 잡 끄기와 제한 없음 중 어디로
  갈지 알 수 있는지.
