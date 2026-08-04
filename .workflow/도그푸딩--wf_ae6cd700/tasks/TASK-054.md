---
schema: workflow-labs/task@1
id: TASK-054
title: dream 잡 편집 폼이 역할 잡과 같은 규칙으로 제한 없음을 다룬다
status: completed
source_spec_id: SPEC-017
source_decision_id: DECISION-EC07DE7E
depends_on: [TASK-053, TASK-031]
updated_at: 2026-08-04T11:45:23.607723+00:00
history:
  - { at: 2026-08-03T08:40:00Z, kind: created }
  - { at: 2026-08-03T10:22:00Z, kind: in_progress }
  - { at: 2026-08-03T10:40:00Z, kind: qa_waiting }
  - { at: 2026-08-04T11:45:23.607723+00:00, kind: completed }
---

# dream 잡 편집 폼이 역할 잡과 같은 규칙으로 제한 없음을 다룬다

SPEC-017 R1이 요구하는 "잡 종류별로 다른 규칙을 만들지 않는다"의 나머지 절반이다. TASK-053이 만든 한도
입력 필드를 dream 카드에 붙이고, 시딩·검증·요청 조립·차이 표시·값 기억을 역할 잡 카드와 같은 규칙으로
맞춘다.

새 규칙을 정하지 않는다. 이 작업에서 판단이 필요한 자리가 나오면 그것은 TASK-053이 정한 규칙과 어긋난
것이므로, 그 작업의 결정을 따른다.

## 의존성

- **선행 필수: TASK-053.** `MaxPerField`와 `maxPerFieldError`, 그리고 `jobValueMemoryStore`의 넓어진
  저장 형태가 그 작업에서 생긴다.
- **선행: TASK-031.** SPEC-009가 이 카드에 사용량 줄과 경고를 올렸다. 지금 `qa_waiting`이라 코드는
  트리에 있다. QA 반려로 되돌아오면 겹치므로 순서를 선언한다(기획서 확인 필요 4).
- **TASK-046과 병행 금지.** 둘 다 `DreamCard.tsx`와 `DreamCard.test.tsx`를 만진다. 순서는 어느 쪽이
  먼저여도 된다.
- 백엔드 소스(`src-tauri/src/**`)를 만지지 않는다. dream 잡의 저장·검증·표시는 역할 잡과 같은 코드를
  지나므로 TASK-051·TASK-052에서 이미 끝나 있다.

## 범위

- `src/features/projects/components/integrations/DreamCard.tsx` — 폼 상태·시딩·요청 조립·검증·
  차이 표시·값 기억.
- `src/features/projects/components/integrations/DreamCard.test.tsx` — 위 시나리오 테스트.
- 그 외 파일은 건드리지 않는다. 특히 `MaxPerField.tsx`·`HeartbeatCard.tsx`·`jobValueMemoryStore.ts`·
  `types.ts`·`App.css`는 이 작업에서 바뀌지 않는다. 그 파일들을 고쳐야 한다면 TASK-053의 결정과
  어긋난 것이므로 먼저 그 이유를 보고서에 적는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **dream 전용 규칙을 만들지 않는다**(R1). 잡 종류별로 다른 한도 규칙을 만들 이유가 없다는 것이
  기획서의 판단이고, dream 잡의 편집 폼과 검증은 지금도 역할 잡과 같은 결이다.
- **dream 잡의 앱 기본값(`6/24h`)은 그대로 둔다.**
- **`MaxPerField`를 고치지 않는다.** dream 때문에 그 필드에 분기가 생기면 두 카드의 규칙이 갈린다.

### 1. 붙일 자리

`DreamCard.tsx`의 편집 필드 순회에서 `maxPer`를 `MaxPerField`로 바꾼다. `model`이 `ModelField`로
빠져 있는 것과 같은 형태다.

- `DreamForm`에 `maxPerUnlimited: boolean`을 더한다.
- `formFrom`의 시딩 규칙은 TASK-053의 2절과 같다. 잡이 블록에 있고 한도 줄이 없으면 제한 없음,
  줄이 있으면 그 값 그대로, 블록에 없으면 앱 기본값이다.
- `edit`이 값 변경과 선택 변경을 모두 지정으로 기록한다.
- `request`는 지정됐을 때만 `{ kind: "unlimited" }` 또는 `{ kind: "limit", value }`를 싣는다.
  `resetRequest`는 그대로 앱 기본값을 `limit`으로 보낸다.
- `invalidFields`(또는 이 카드의 대응 자리)는 제한 없음이면 한도 칸을 검사하지 않고, 아니면
  `maxPerFieldError`를 쓴다. `fieldRules.maxPer`의 정규식은 지운다.
- 차이 표시의 한도 칸은 TASK-053의 4절과 같다. 잡이 블록에 있고 줄이 없으면 `"제한 없음"`,
  블록에 없으면 `null`이다.
- `toggle`의 값 기억도 같다. `dream.managedJob.maxPer`를 `?? undefined` 없이 그대로 넘기고, 되살릴 때
  `null`이면 제한 없음으로 편다.

### 2. 테스트

`DreamCard.test.tsx`에 둔다. 역할 잡 카드에서 확인한 것과 같은 사실을 dream 잡으로 확인한다.

- 한도를 제한 없음으로 고르고 저장하면 요청에 `{ kind: "unlimited" }`가 실린다. (완료 조건 1)
- 한도 줄이 없는 dream 잡(`maxPer: null`)의 폼이 제한 없음으로 열리고 앱 기본값이 그 자리에 보이지
  않는다. (완료 조건 2)
- 그 상태에서 아무것도 바꾸지 않고 저장하면 `maxPer`가 `null`로 나가고, 모델만 바꿔 저장해도 같다.
  (완료 조건 3, 4)
- `0/24h`와 `4/0h`가 화면 검증에서 막히고 게이트웨이가 호출되지 않는다. 거부 문구가 역할 잡 카드와
  같다. (완료 조건 5, 6)
- 파일에 `0/24h`가 있으면 폼에 그대로 보이고 고치기 전에는 저장되지 않는다. (완료 조건 7)
- 확인 화면에서 제한 없음이 "없음"과 구분된다. (완료 조건 8)
- 제한 없음인 dream 잡을 껐다 켜면 그 상태로 돌아온다. (완료 조건 9)
- 사용량 줄과 경고에 대한 기존 단정(TASK-031·TASK-052)이 그대로 통과한다.

## 완료 조건

1. dream 잡의 편집 폼에서 실행 한도를 제한 없음으로 지정할 수 있고, 그 뜻이 화면에 밝혀진다.
   (기획서 완료 조건 1의 dream 몫, R1)
2. 한도 줄이 없는 dream 잡을 다시 열면 제한 없음으로 보이고 앱 기본값이 시딩되지 않는다.
   (기획서 완료 조건 4)
3. 제한 없음 상태에서 아무것도 바꾸지 않고 저장하면 요청이 그 필드를 지정하지 않는다.
   (기획서 완료 조건 5)
4. 다른 필드만 편집해 저장해도 제한 없음이 유지된다. (기획서 완료 조건 6)
5. 횟수가 0 이하이거나 기간이 0인 값은 화면 검증이 막고 저장 요청이 나가지 않는다.
   (기획서 완료 조건 7의 화면 몫)
6. 거부 문구가 역할 잡 카드·백엔드와 같다. (기획서 완료 조건 8)
7. 파일에 어긋난 값이 있는 dream 잡은 폼에 그 값이 그대로 보이고, 고치지 않으면 저장이 되지 않는다.
   (기획서 완료 조건 9)
8. 확인 화면과 파일 변경 안내에서 제한 없음이 "없음"과 구분된다. (기획서 완료 조건 12)
9. 제한 없음인 dream 잡을 껐다 켜도 그 상태가 돌아온다.
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

두 카드의 한도 규칙이 갈라지지 않았는지 눈으로 확인한다.

```sh
grep -n "maxPer" src/features/projects/components/integrations/HeartbeatCard.tsx \
  src/features/projects/components/integrations/DreamCard.tsx
```

## 사용자 QA 항목

- dream 잡을 제한 없음으로 저장한 뒤 `~/.claude/HEARTBEAT.md`에서 그 잡의 `max_per` 줄이 사라졌는지.
  같은 저장에서 역할 잡들의 한도 줄은 그대로인지. (기획서 완료 조건 2, 3)
- 화면을 다시 열었을 때 제한 없음이 그대로 보이는지. (기획서 완료 조건 4)
- 두 카드의 한도 입력과 거부 문구가 같은 모양인지. (기획서 R1)

## 범위 밖

- 역할 잡 카드와 공용 필드. TASK-053이다.
- 사용량 표시 문구와 `JobQuota` 상태. TASK-052다.
- 요청 계약과 백엔드 검증. TASK-051이다.
- dream 잡의 앱 기본값 변경.
- dream 정제 상태·조건 명령·스킬 경로에 대한 어떤 변경도.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `DreamCard.tsx`의 `editableFields`(`:94`)·`fieldLabels`(`:100`)·`fieldRules`(`:111`)는 역할 잡
  카드와 같은 모양이고, `maxPer` 정규식도 같은 `/^\d+\/\d+[smhd]$/`다.
- `formFrom`(`:137`)의 `maxPer: job?.maxPer ?? defaults.maxPer`가 역할 잡 카드의 같은 자리와 짝이다.
- `request`(`:514`)·`resetRequest`(`:493`)가 요청을 조립한다. TASK-051이 이 두 자리의 `maxPer` 모양을
  이미 바꿔 둔다.
- `toggle`(`:333`)이 `jobValueMemoryStore`를 역할 잡 카드와 같은 방식으로 쓴다. 네 필드 모두
  `?? undefined`로 넘긴다.
- dream 잡의 앱 기본값은 `heartbeat_dream`의 `default_settings()`에서 오고 `maxPer`는 `6/24h`다.
- `quotaUsageLabel`·`quotaWarned`는 두 카드에 따로 있고 낱말만 맞춘다(`DreamCard.tsx:49`, `:90`).
  TASK-052가 두 곳을 함께 고치므로 이 작업에서는 바뀌지 않는다.
- dream 잡은 관리 블록에서 역할 잡 3종 다음에 온다. 병합 순서는 `merge_block`이 고정한다.
