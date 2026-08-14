---
schema: workflow-labs/task@1
id: TASK-053
title: 역할 잡 편집 폼이 제한 없음을 고르게 하고 데몬이 인정하지 않는 값을 화면에서 막는다
status: verified
source_spec_id: SPEC-017
source_decision_id: DECISION-EC07DE7E
depends_on:
- TASK-052
- TASK-030
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T08:40:00Z
  kind: created
- at: 2026-08-03T10:02:00Z
  kind: in_progress
- at: 2026-08-03T10:13:00Z
  kind: qa_waiting
- at: 2026-08-04T11:45:28.046069+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-EC07DE7E
work_group_revision: 1
---

# 역할 잡 편집 폼이 제한 없음을 고르게 하고 데몬이 인정하지 않는 값을 화면에서 막는다

SPEC-017 R1과 R3의 화면 몫, R4의 화면 검증, R5의 폼 표시 규칙을 역할 잡 카드에 구현한다. 두 카드가 함께
쓸 한도 입력 필드도 이 작업에서 만든다. dream 카드에 붙이는 것은 TASK-054다.

## 의존성

- **선행 필수: TASK-052.** 요청 계약(TASK-051)과 사용량 상태(TASK-052)가 먼저 서야 이 폼이 보낼 값과
  보여줄 상태가 존재한다.
- **선행: TASK-030.** SPEC-009가 이 카드에 사용량 줄과 경고를 올렸다. 지금 `qa_waiting`이라 코드는
  트리에 있다. QA 반려로 되돌아오면 이 작업이 얹는 표시와 겹치므로 순서를 선언한다(기획서 확인 필요 4).
- **TASK-046·TASK-049·TASK-050과 병행 금지.** 넷 다 `HeartbeatCard.tsx`와
  `IntegrationsView.test.tsx`를 만진다. 순서는 어느 쪽이 먼저여도 된다.
- **TASK-054가 이 작업의 산출물(`MaxPerField`)을 쓴다.** 이 작업이 먼저다.
- 백엔드 소스(`src-tauri/src/**`)를 만지지 않는다.

## 범위

- `src/features/projects/components/MaxPerField.tsx` — 신설. 한도 입력 필드와 검증 규칙.
- `src/features/projects/components/integrations/HeartbeatCard.tsx` — 폼 상태·시딩·요청 조립·검증·
  차이 표시.
- `src/features/projects/infrastructure/jobValueMemoryStore.ts` — 끈 잡의 제한 없음 기억.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 위 시나리오 테스트.
- 그 외 파일은 건드리지 않는다. 특히 `DreamCard.tsx`·`types.ts`·`ModelField.tsx`·`JobChanges.tsx`·
  `App.css`·`src-tauri/src/` 아래 파일은 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **앱 기본값은 그대로 둔다**(R1). 제한 없음은 사용자가 고르는 값이지 앱이 권하는 값이 아니다. 미설치
  잡과 재설정은 지금과 같은 값에서 시작한다.
- **파일의 값을 몰래 바꾸지 않는다**(R5). `0/24h`가 파일에 있으면 폼에 `0/24h`가 보여야 한다. 앱
  기본값이나 제한 없음으로 갈아치우지 않는다.
- **저장 요청은 폼과 지정 기록으로만 만든다.** 입력 방식 상태를 payload에 섞지 않는다는 `ModelField`의
  규칙과 같다. 다만 아래 1절의 이유로 **한도는 선택 자체가 값**이다.
- **App.css를 건드리지 않는다.** `ModelField`의 선택 컨트롤도 전용 스타일 없이 `.heartbeat-job-field`
  안에 놓인다. 같은 자리에 같은 모양으로 들어가므로 새 규칙이 필요 없다.
- **잡을 끄는 것과 제한 없음을 섞지 않는다.** 끄기는 잡을 블록에서 빼고, 제한 없음은 잡을 남긴 채 한도
  줄만 뺀다.

### 1. 한도 입력 필드

`ModelField.tsx` 옆에 `MaxPerField.tsx`를 만든다. 두 카드가 같은 규칙을 써야 하고(R1), 검증 규칙이
정규식 하나로 적히지 않게 되었기 때문이다(R4).

```tsx
/** 한도 값 하나의 거부 사유. 통과하면 null이다. 백엔드 검증(TASK-051)과 같은 규칙이다. */
export function maxPerFieldError(value: string): string | null

export function MaxPerField({
  fieldLabel, id, jobLabel, message, unlimited, value, onUnlimitedChange, onValueChange,
}: { ... })
```

- 형태는 `ModelField`와 같다. 선택 컨트롤(`한도 지정` / `제한 없음`)이 위에 있고, `한도 지정`일 때만
  값 입력 칸이 나온다. 기획서 확인 필요 1번의 승인된 제안이다.
- 라벨 규약도 `ModelField`와 같다. 선택 컨트롤의 접근성 이름이 `<잡 이름> 실행 한도`이고, 값 입력
  칸은 그와 겹치지 않는 이름을 쓴다.
- `제한 없음`을 고르면 그 잡이 실행 횟수 제한 없이 주기마다 돈다는 사실을 필드 안에 밝힌다(R1).
  `.integration-note`를 쓴다.
- **선택을 바꾸는 것은 값 변경이다.** `ModelField`에서 "직접 입력"으로 바꾸는 것은 값이 바뀌지 않아
  지정으로 치지 않았지만, 여기서는 선택 자체가 파일에 쓰일 값을 정한다. 호출자가 두 콜백 모두를
  지정으로 기록한다.
- `한도 지정`으로 되돌아갔을 때 값 입력 칸이 비어 있지 않도록, 값은 선택과 별개로 유지한다. 필드는
  값을 스스로 지우지 않는다.

`maxPerFieldError`의 규칙은 TASK-051이 백엔드에 적은 것과 같다. 두 곳이 갈리면 저장 버튼이 통과시킨 값이
백엔드에서 떨어진다.

- `<횟수>/<기간>` 형태가 아니면 기존 형식 문구.
- 형태는 맞지만 횟수가 0이거나 기간이 초로 0이면 TASK-051의 `Ignored` 문구를 그대로 쓴다. 그 문구가
  왜 거부되는지와 사용자가 갈 곳(잡 끄기 / 제한 없음)을 함께 밝힌다(R4, 완료 조건 8).
- 기간의 단위는 `s`·`m`·`h`·`d`이고 초 환산은 백엔드 `parse_duration`과 같다. `4/0d`도 0초다.

### 2. 폼이 세 상태를 든다

`RoleForm`에 `maxPerUnlimited: boolean`을 더한다. `maxPer` 문자열은 한도 지정일 때의 값으로 남는다.

시딩(`roleFormFrom`)은 이렇게 바뀐다. 여기가 R3이 지목한 `installed?.maxPer ?? defaults.maxPer`다.

- 잡이 블록에 있고 한도 줄이 있으면: `maxPerUnlimited: false`, `maxPer: 파일 값`. `0/24h`도 그대로
  보여준다(R5).
- 잡이 블록에 있고 한도 줄이 없으면: `maxPerUnlimited: true`, `maxPer: defaults.maxPer`. 앱 기본값은
  화면에 보이지 않고, 사용자가 `한도 지정`으로 되돌렸을 때 칸에 들어 있을 값으로만 쓰인다.
- 잡이 블록에 없으면(첫 설치·꺼진 잡): 지금과 같다. `maxPerUnlimited: false`, `maxPer: defaults.maxPer`.

`seed`가 부르는 경로가 하나이므로 파일 변경 후 되시딩·재설정 뒤 되시딩도 같은 규칙을 따른다.

### 3. 요청 조립과 검증

- `edit`으로 값 칸을 고치거나 선택을 바꾸면 둘 다 `specified[role].maxPer`를 세운다.
- `requestOf`는 지정됐을 때만 값을 싣는다. `maxPerUnlimited`면 `{ kind: "unlimited" }`, 아니면
  `{ kind: "limit", value: form[role].maxPer }`. 지정되지 않았으면 `null` 그대로다.
- `resetRequestOf`는 그대로 `{ kind: "limit", value: defaults.maxPer }`를 보낸다(TASK-051에서 이미
  그 모양이다). 재설정은 앱 기본값으로 되돌리는 것이고 기본값은 언제나 한도 값이다.
- `invalidFields`는 `maxPerUnlimited`인 역할의 한도 칸을 검사하지 않는다. 검사할 값이 없다. 나머지는
  `maxPerFieldError`를 쓴다. `fieldRules.maxPer`의 정규식은 지운다 — 그 규칙이 두 벌이 되면 안 된다.
- 꺼진 역할을 검사하지 않는 지금 규칙은 그대로다. 파일에 어긋난 값이 있는 잡을 끄면 그 잡이 블록에서
  빠지므로 검증할 값도 사라진다. 이는 기존 "끄면 사라진다" 규약과 같고 R5가 막는 대상이 아니다.

### 4. 차이 표시

확인 화면과 파일 변경 안내가 `JobChanges`에 넘기는 값 중 한도 칸만 바뀐다. 지금은 `null`이 "없음"으로
읽히는데, 한도 줄의 없음은 이제 "제한 없음"이다(완료 조건 12).

- 잡이 블록에 **있고** 한도 줄이 없으면 `current`는 `"제한 없음"`이다. `null`을 넘기면 "없음"으로
  읽혀 잡이 새로 생기는 경우와 섞인다.
- 잡이 블록에 **없으면** `current`는 지금처럼 `null`이다. `added`가 그 사실을 따로 밝힌다.
- `next`는 폼이 제한 없음이면 `"제한 없음"`, 아니면 값 그대로다.
- 같은 규칙을 네 자리에 모두 적용한다. `writtenJobs`·`removedJobs`·`fileChanges`·`fileRemovals`,
  그리고 `resetChanges`.
- `JobChanges.tsx`는 고치지 않는다. 그 요소는 잡 종류도 필드 뜻도 모르는 채 문자열만 그린다.

### 5. 끈 잡의 값 기억

`jobValueMemoryStore`는 끄는 잡의 파일 값을 담아 두었다가 다시 켤 때 되돌린다. 지금 저장 형태
(`Partial<Record<..., string>>`)로는 제한 없음을 담을 수 없어, 제한 없음인 잡을 껐다 켜면 앱 기본값으로
시작한다. 사용자가 정한 값이 사라지는 자리다.

- `RememberedJobValues`의 `maxPer`를 `string | null`로 넓힌다. **키가 없으면 "기억하지 못함", `null`은
  "제한 없음"이다.** 나머지 세 필드는 그대로 `string`이다.
- `load`는 `maxPer`에 한해 `null`도 받는다. 다른 필드의 `null`은 지금처럼 버린다.
- 카드의 `toggle`은 끄는 잡의 `installedJob.maxPer`를 그대로 넘긴다. 지금의 `?? undefined`가 제한
  없음을 "기억하지 못함"으로 바꾸는 자리다.
- 다시 켤 때 `recalled.maxPer`가 `null`이면 `maxPerUnlimited: true`로, 문자열이면 그 값으로 폼을
  채운다. 지금처럼 통째로 펼쳐(`...recalled`) 넣으면 `maxPer` 칸에 `null`이 들어간다. 이 필드만 따로
  옮긴다.
- 기억한 값은 파일에 없으므로 지정 필드로 실어 보내야 한다는 기존 규칙은 그대로다.
- 저장 형태가 넓어질 뿐이라 기존 저장분(`maxPer`가 문자열)은 그대로 읽힌다. 키 이름과 버전은 바꾸지
  않는다.

### 6. 테스트

`IntegrationsView.test.tsx`에 둔다. 기존 테스트가 쓰는 스냅샷 픽스처 헬퍼를 그대로 쓴다.

폼과 저장(1~3절):

- 잡의 한도를 제한 없음으로 고르고 저장하면 그 역할의 요청에 `{ kind: "unlimited" }`가 실린다. 다른
  역할의 한도는 `null`이다. (완료 조건 1)
- 제한 없음을 골랐다가 한도 지정으로 되돌리면 값 칸이 다시 보이고, 저장 요청에 그 값이 실린다.
- 한도 줄이 없는 잡(`maxPer: null`)의 폼이 제한 없음으로 열리고 앱 기본값이 그 자리에 보이지 않는다.
  (완료 조건 4)
- 그 잡에서 아무것도 바꾸지 않고 저장하면 그 역할의 `maxPer`가 `null`(지정 안 함)로 나간다.
  (완료 조건 5)
- 그 잡의 모델만 바꿔 저장해도 `maxPer`가 `null`로 나간다. (완료 조건 6)
- `0/24h`를 입력하면 저장이 막히고 거부 문구에 잡 끄기와 제한 없음이 모두 나온다. 게이트웨이가 호출되지
  않는다. (완료 조건 7, 8)
- `4/0h`도 같다. `1/1s`는 통과한다.
- 파일에 `0/24h`가 있는 잡은 폼에 그 값이 그대로 보이고, 고치지 않으면 다른 필드만 바꿔도 저장이
  막힌다. (완료 조건 9)
- 재설정 요청이 앱 기본값을 `{ kind: "limit", ... }`로 보낸다.

차이 표시(4절):

- 제한 없음인 잡의 확인 화면에서 한도 칸이 "제한 없음"으로 보이고, 아무것도 바꾸지 않았으면 "그대로"로
  읽힌다.
- 한도 있는 잡을 제한 없음으로 바꾸면 확인 화면에 `4/24h → 제한 없음 — 바뀜`이 보인다. (완료 조건 12)
- 블록에 없던 잡이 새로 켜지는 경우의 표시가 지금과 같다.

값 기억(5절):

- 제한 없음인 잡을 끄고 저장한 뒤 다시 켜면 폼이 제한 없음으로 돌아온다. 앱 기본값으로 시작하지 않는다.
- 한도가 있던 잡을 껐다 켜면 지금과 같이 그 값으로 돌아온다.

## 완료 조건

1. 역할 잡 3종의 편집 폼에서 실행 한도를 제한 없음으로 지정할 수 있고, 그 뜻이 화면에 밝혀진다.
   (기획서 완료 조건 1의 역할 잡 몫, R1)
2. 한도 줄이 없는 잡을 다시 열면 제한 없음으로 보이고 앱 기본값이 시딩되지 않는다.
   (기획서 완료 조건 4)
3. 제한 없음 상태에서 아무것도 바꾸지 않고 저장하면 요청이 그 필드를 지정하지 않는다.
   (기획서 완료 조건 5)
4. 다른 필드만 편집해 저장해도 제한 없음이 유지된다. (기획서 완료 조건 6)
5. 횟수가 0 이하이거나 기간이 0인 값은 화면 검증이 막고 저장 요청이 나가지 않는다.
   (기획서 완료 조건 7의 화면 몫)
6. 거부 문구가 그 값이 데몬에서 무제한이 된다는 사실과, 잡 끄기·제한 없음의 차이를 밝힌다. 백엔드
   문구와 같다. (기획서 완료 조건 8)
7. 파일에 `0/24h`나 `4/0h`가 있는 잡은 폼에 그 값이 그대로 보이고, 고치지 않으면 저장이 되지 않는다.
   (기획서 완료 조건 9)
8. 확인 화면과 파일 변경 안내에서 제한 없음이 "없음"과 구분된다. (기획서 완료 조건 12)
9. 제한 없음인 잡을 껐다 켜도 그 상태가 돌아온다.
10. 기존 프런트엔드 테스트가 삭제·비활성화 없이 통과한다. (기획서 완료 조건 17)
11. `npm run check`가 통과한다. (기획서 완료 조건 18)

## 검증 절차

```sh
npm run check
```

백엔드는 이 작업에서 바뀌지 않는다. 회귀 확인용으로 한 번 돌린다.

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

## 사용자 QA 항목

자동화 테스트는 요청 payload와 화면 문구까지만 확인한다. 아래는 실제 앱 창과 파일이 필요하다.

- 역할 잡 하나를 제한 없음으로 저장한 뒤 `~/.claude/HEARTBEAT.md`에서 그 잡의 `max_per` 줄이 사라졌는지.
  (기획서 완료 조건 1, 2)
- 그 화면을 다시 열었을 때 제한 없음이 그대로 보이고, 아무것도 바꾸지 않고 다시 저장해도 줄이
  되살아나지 않는지. (기획서 완료 조건 5)
- 한도 칸에 `0/24h`를 넣었을 때 거부 문구가 뜨고, 그 문구만 읽고도 잡 끄기와 제한 없음 중 어디로 갈지
  알 수 있는지. (기획서 완료 조건 8)

## 범위 밖

- dream 카드. TASK-054가 같은 필드를 붙인다.
- 사용량 표시 문구와 `JobQuota` 상태. TASK-052다.
- 요청 계약과 백엔드 검증. TASK-051이다.
- `interval`·`timeout`·`model`의 "없음" 표현.
- 한도 프리셋·추천값·자동 조정.
- 앱이 조회만으로 어긋난 값을 고치는 것.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `roleFormFrom`(`HeartbeatCard.tsx:172`)의 `maxPer: installed?.maxPer ?? defaults.maxPer`가 손으로
  지운 줄을 되살리는 화면 쪽 자리다. 백엔드 쪽 자리는 TASK-051이 고친다.
- `fieldRules`(`:119`)의 `maxPer` 정규식은 `/^\d+\/\d+[smhd]$/`라 0을 받는다.
- `invalidFields`(`:493`)는 활성 역할의 네 필드를 모두 검사하고, `requestConfirm`(`:505`)은 걸리면
  확인 화면을 열지 않는다.
- `edit`(`:443`)이 값 변경과 지정 기록을 함께 처리한다. `switchModelInput`(`:451`)은 지정으로 치지
  않는다 — 값이 바뀌지 않기 때문이다.
- `toggle`(`:457`)이 끄는 잡의 값을 기억하고 켜는 잡의 값을 되살린다. 지금은 네 필드 모두
  `?? undefined`로 넘긴다.
- `jobValueMemoryStore`의 저장 키는 `workflow-labs.job-value-memory.v1`이고, `load`는 값이 문자열인
  필드만 받는다.
- `JobChanges`(`JobChanges.tsx`)는 `current`가 `null`이면 "없음"으로 그리고, `current !== next`일 때만
  "바뀜"으로 읽는다. 잡 종류도 필드 뜻도 모른다.
- `ModelField.tsx`에는 전용 테스트 파일이 없다. 두 카드 테스트가 그 동작을 함께 확인한다.
- `App.css`에 `.heartbeat-job-field select` 규칙이 없다. 모델 선택 컨트롤도 지금 그대로 놓여 있다.
- `HeartbeatCard.tsx`가 인프라 모듈을 직접 import 하는 선례가 `:21`의 `browserJobValueMemoryStore`다.
