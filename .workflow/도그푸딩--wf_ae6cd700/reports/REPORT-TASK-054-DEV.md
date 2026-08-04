# TASK-054 개발자 핸드오프

- 대상 작업: TASK-054 (dream 잡 편집 폼이 역할 잡과 같은 규칙으로 제한 없음을 다룬다)
- 근거 문서: SPEC-017 R1의 dream 몫, DECISION-EC07DE7E (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T10:38Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 사용자가 병렬 작업을 승인했고 이 세션은 TASK-054 하나만 배정받았다.
- `migration.lock` 없음. 착수 시점(10:21Z) lease는 `SPEC-009`·`TASK-045`·`TASK-047`뿐이었다.
- `depends_on: [TASK-053, TASK-031]` 둘 다 `qa_waiting`이라 충족. `MaxPerField`·`maxPerFieldError`와
  넓어진 `jobValueMemoryStore` 저장 형태가 TASK-053에서 생겼다.
- §4 미설치 폴백대로 `set -C`로 배타 생성했다.

## 결정과 근거

**새 규칙을 정하지 않았다.** 작업 문서가 적은 대로, 판단이 필요해 보이는 자리는 전부 TASK-053이 이미
정한 규칙을 그대로 옮기는 것으로 풀렸다. dream 전용 분기는 하나도 만들지 않았다.

옮긴 것은 여섯 가지다. 역할 잡 카드의 같은 이름 코드와 짝이 맞는다.

1. **폼 상태** — `DreamForm`에 `maxPerUnlimited: boolean`. `maxPer` 문자열은 한도 지정일 때의 값으로
   남고, 제한 없음일 때도 지우지 않아 되돌아갈 때 칸이 비지 않는다.
2. **시딩** — `formFrom`이 `maxPerUnlimited: Boolean(job) && job?.maxPer == null`이다. 블록에 있고
   줄만 없으면 제한 없음, 줄이 있으면 그 값 그대로(`0/24h`도 갈아치우지 않는다), 블록에 없으면 앱
   기본값이다.
3. **선택 전환** — `switchMaxPer`가 지정으로 친다. 모델의 입력 방식 전환과 갈리는 이유는 TASK-053
   보고서에 적은 그대로다. 제한 없음을 고르는 것은 관리 블록에서 줄을 빼는 결정이라 그 자체가 값이다.
4. **검증** — `fieldRules`에서 `maxPer`를 지우고 타입을 `Record<Exclude<EditableField, "maxPer">, ...>`로
   좁혔다. `invalidFields`는 제한 없음이면 건너뛰고 아니면 `maxPerFieldError`를 쓴다. 거부 문구가
   역할 잡 카드·백엔드와 같은 이유는 **같은 상수를 함께 쓰기 때문**이고 글자를 옮겨 적지 않았다.
5. **요청 조립** — `request`가 지정됐을 때만 `{ kind: "unlimited" }` 또는 `{ kind: "limit", value }`를
   싣는다. `resetRequest`는 그대로 앱 기본값을 `limit`으로 보낸다.
6. **차이 표시와 값 기억** — `fileValue`·`formValue` 두 헬퍼를 같은 규칙으로 두고 다섯 자리에 적용했다.
   `toggle`은 `dream.managedJob.maxPer`를 `?? undefined` 없이 그대로 넘기고, 되살릴 때 `null`이면
   제한 없음으로 편다.

`MaxPerField.tsx`·`HeartbeatCard.tsx`·`jobValueMemoryStore.ts`·`types.ts`·`App.css`는 건드리지
않았다. dream 때문에 공용 필드에 분기가 생기면 두 카드의 규칙이 갈린다.

TASK-053 보고서가 리스크 1번으로 남긴 "두 카드의 규칙이 잠시 다른 상태"가 여기서 닫혔다.

## 변경 파일

- `src/features/projects/components/integrations/DreamCard.tsx` — 폼 상태·시딩·요청 조립·검증·
  차이 표시·값 기억
- `src/features/projects/components/integrations/DreamCard.test.tsx` — 새 시나리오와 기존 단정의
  라벨 갱신, 저장소 스텁
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — dream 한도 단정 한 줄의
  라벨 갱신 (아래 참고)

백엔드는 건드리지 않았다. dream 잡의 저장·검증·표시는 역할 잡과 같은 코드를 지나므로 TASK-051·
TASK-052에서 이미 끝나 있다.

## 갱신한 기존 테스트

삭제하거나 비활성화한 테스트는 없다. 한도 칸의 접근성 이름이 갈리면서 **값**을 단정하던 다섯 자리가
`"dream 정제 실행 한도"` → `"dream 정제 실행 한도 값"`으로 바뀌었다. 넷은 `DreamCard.test.tsx`,
하나는 `IntegrationsView.test.tsx`의 dream 값 기억 테스트다. 단정하던 사실은 그대로다.

관리 블록을 읽지 못한 상태의 테스트(`queryByLabelText("dream 정제 실행 한도")`가 없어야 한다)는
그대로 뒀다. 그 화면은 폼 전체를 그리지 않아 선택 컨트롤도 값 칸도 없다.

`IntegrationsView.test.tsx`는 이 작업의 범위 절에 없지만, dream 폼을 렌더하는 테스트가 그 파일에도
하나 있어 라벨을 함께 옮겼다. 이 파일의 다른 부분은 건드리지 않았다(dev-041이 `IntegrationsView.tsx`
본체를 만지는 중이라 그 소스 파일은 열지 않았다).

## 추가한 테스트 (17개)

새 describe `dream 잡 실행 한도`에 모았다. 역할 잡 카드의 같은 이름 테스트와 짝이 맞는다.

- `sends unlimited when the user chooses it` (완료 조건 1)
- `explains what unlimited means and hides the value input` (R1)
- `keeps the typed value when switching back to a limit`
- `opens a job without a quota line as unlimited and seeds no app default` — dream 앱 기본값
  `6/24h`가 카드 어디에도 없음까지 본다 (완료 조건 2)
- `specifies nothing when an unlimited job is saved untouched` (완료 조건 3)
- `leaves the quota unspecified when only another field is edited` (완료 조건 4)
- `blocks %s and names both the job toggle and unlimited` — `0/24h`·`4/0h`·`0/1s`·`4/0d` 넷
  (완료 조건 5·6)
- `accepts the smallest quota the daemon honours` — `1/1s` 경계값
- `shows %s from the file and blocks the save until it is fixed` — `0/24h`·`4/0h` (완료 조건 7)
- `stops blocking once the job with a broken quota is turned off`
- `reads an untouched unlimited job as changing nothing` (완료 조건 8)
- `labels the quota of an unlimited job as 제한 없음 and not as 없음` (완료 조건 8)
- `shows the switch from a limit to unlimited as a change` — `6/24h → 제한 없음 — 바뀜`
- `still reads a job absent from the block as a missing value`
- `recalls the chosen unlimited after the job is turned off and on` (완료 조건 9)
- `still recalls a limit after the job is turned off and on`
- `resets an unlimited job back to the app default limit`

## 이 작업에서 알게 된 것

`DreamCard.test.tsx`에는 `localStorage` 스텁이 없었다. 테스트 환경의 `localStorage`는 메서드가 없는
빈 객체라 저장소 접근이 조용히 실패하고, `jobValueMemoryStore`가 그 실패를 삼킨다. **그래서 이
파일에는 dream 잡의 값 기억을 확인하는 테스트가 지금까지 하나도 없었다** — 그 동작은
`IntegrationsView.test.tsx`가 자기 스텁으로만 덮고 있었다.

값 기억 시나리오 둘을 세우려면 스텁이 필요해서, 연동 뷰 테스트와 같은 형태로 새 describe 안에만
`beforeEach`/`afterEach`를 뒀다. 파일의 다른 describe는 지금 그대로다.

## 검증

- `npm run check` — 315 passed / 0 failed (294 → 315, +21), `tsc -b`·`vite build` 통과
- `cargo test --manifest-path src-tauri/Cargo.toml` — 324 passed / 0 failed. 회귀 확인용이고 이
  작업은 백엔드를 건드리지 않았다. 306에서 늘어난 몫은 병렬 세션의 것이다.
- 두 카드의 한도 규칙 대조 — 작업 문서가 지시한 `grep -n "maxPer"`를 두 파일에 돌려 눈으로 맞췄다.
  헬퍼 이름(`fileValue`·`formValue`·`switchMaxPer`), 시딩 식, 검증 분기, 요청 조립, `MaxPerField`
  호출 인자가 모두 짝이 맞는다. dream 전용 분기는 없다.

## 리스크와 후속

1. **`MaxPerField`가 이제 두 카드의 공용 자산이다.** 한쪽 카드의 사정으로 그 필드에 분기를 더하면
   R1이 깨진다. 앞으로 이 필드를 고칠 때는 두 카드를 함께 봐야 한다.

2. **거부 문구가 세 곳에 있다.** `heartbeat_jobs.rs`의 `QUOTA_IGNORED_MESSAGE`,
   `MaxPerField.tsx`의 `ignoredMessage`, 그리고 두 카드의 테스트가 대조하는 조각이다. 화면 두 곳은
   같은 상수를 쓰므로 실제로 갈릴 수 있는 것은 백엔드와 화면 사이 하나뿐이다.

3. **끄기 안내 문구가 값 기억과 어긋난다(이 작업의 변경 아님).** 두 카드 모두 "다시 켜면 기본값으로
   시작합니다"라고 적어 두었는데 값 기억 스토어가 들어온 뒤로 사실이 아니다. TASK-053 보고서에서
   핸드오프로 남긴 항목이고, 이번에도 범위 밖이라 손대지 않았다. **두 카드가 같은 문장을 쓰므로
   고칠 때도 함께 고쳐야 한다.**

4. **SPEC-017의 사슬이 여기서 닫힌다.** TASK-051(저장 경로·요청 계약) → TASK-052(사용량 payload
   구분) → TASK-053(역할 폼) → TASK-054(dream 폼)로 R1~R6이 모두 구현됐다. 남은 것은 사용자 QA다.

## 사용자 QA 항목

- dream 잡을 제한 없음으로 저장한 뒤 `~/.claude/HEARTBEAT.md`에서 그 잡의 `max_per` 줄이 사라졌는지.
  **같은 저장에서 역할 잡들의 한도 줄은 그대로인지.**
- 화면을 다시 열었을 때 제한 없음이 그대로 보이는지.
- 두 카드의 한도 입력과 거부 문구가 같은 모양인지. 역할 잡 하나와 dream 잡에 각각 `0/24h`를 넣어
  두 문구를 나란히 읽어 보면 된다.
