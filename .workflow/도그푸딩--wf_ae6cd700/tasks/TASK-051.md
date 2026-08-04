---
schema: workflow-labs/task@1
id: TASK-051
title: 실행 한도에 제한 없음 상태를 도입하고 데몬이 한도로 인정하지 않는 값을 저장에서 막는다
status: completed
source_spec_id: SPEC-017
source_decision_id: DECISION-EC07DE7E
depends_on: [TASK-028]
updated_at: 2026-08-03T12:42:56Z
history:
  - { at: 2026-08-03T08:40:00Z, kind: created }
  - { at: 2026-08-03T09:22:00Z, kind: in_progress }
  - { at: 2026-08-03T09:53:00Z, kind: qa_waiting }
---

# 실행 한도에 제한 없음 상태를 도입하고 데몬이 한도로 인정하지 않는 값을 저장에서 막는다

SPEC-017 R2·R3·R4와 R5의 저장 몫을 구현한다. 한도 값이 "있음"과 "없음" 두 상태를 갖게 만들고, 저장
요청이 "이번 편집에서 지정 안 함"·"제한 없음"·"한도 지정" 셋을 구분하게 만들며, 앱이 받아들이는 값을
데몬이 한도로 인정하는 값과 일치시킨다.

화면에는 아직 "제한 없음" 선택지가 생기지 않는다. 이 작업은 계약과 저장 경로만 바꾼다. 선택지와 표시는
TASK-053·TASK-054다.

## 의존성

- **선행: TASK-028.** SPEC-009가 넣은 `job_quota`와 그 배선이 이 작업이 고칠 `heartbeat_service.rs`
  안에 있다. 지금 `qa_waiting`이라 코드는 트리에 있다. QA 반려로 되돌아오면 이 작업의 전제가 흔들리므로
  순서를 선언한다(기획서 확인 필요 4).
- **TASK-052와 병행 금지.** 그 작업이 같은 `heartbeat_service.rs`와 같은 두 카드 파일을 만진다. 이
  작업이 먼저다 — `parse_quota`가 0 이하 값을 거부하게 되어야 TASK-052의 표시 규칙이 성립한다.
- **TASK-044·TASK-045·TASK-048과 병행 금지.** 셋 다 `heartbeat_service.rs`를 만진다. 순서는 어느 쪽이
  먼저여도 된다.
- **TASK-046·TASK-049·TASK-050과 병행 금지.** `HeartbeatCard.tsx`·`DreamCard.tsx`·
  `IntegrationsView.test.tsx`가 겹친다.

## 왜 이 작업이 프런트엔드까지 건드리는가

저장 요청의 `maxPer` 타입이 바뀐다. Rust 쪽만 바꾸면 다음 작업이 끝날 때까지 화면의 저장이 역직렬화에서
실패한다. 사용자 QA는 실행 중인 앱에서 이뤄지므로 그 상태를 남기지 않는다. 그래서 **요청을 조립하는 세
줄까지가 이 작업**이고, 입력 폼·검증 문구·표시는 다음 작업으로 넘긴다.

이 작업만 들어간 상태에서 앱은 이렇게 동작한다. 사실이니 QA에서 이 범위로 확인한다.

- 한도 줄이 없는 잡을 열면 폼에는 아직 앱 기본값이 보인다(TASK-053이 고친다). 그러나 그 칸을 건드리지
  않고 저장하면 요청에 `null`이 실려 파일의 상태가 그대로 보존된다. 되살아나지 않는다.
- `0/24h`를 입력하면 화면 검증은 아직 통과하지만(TASK-053이 고친다) 백엔드가 거부하고 아무 파일도 쓰지
  않는다. 이중 방어선 중 뒤쪽이 먼저 선다.

## 범위

- `src-tauri/src/infrastructure/heartbeat_jobs.rs` — `MaxPer`, `ManagedJob.max_per`, `render_block`,
  `parse_quota`, 거부 사유 구분, `validate_job`, 테스트.
- `src-tauri/src/infrastructure/heartbeat_roles.rs` — `RoleJobSettings.max_per`, 기본값 반환 타입,
  변환 impl, 테스트.
- `src-tauri/src/infrastructure/heartbeat_dream.rs` — 위와 같은 몫.
- `src-tauri/src/infrastructure/heartbeat_status.rs` — `defaults` 배선 한 줄.
- `src-tauri/src/application/heartbeat_service.rs` — `MaxPerRequest`, `PartialSettings`·`JobSettings`,
  블록 값 읽기, 요청 병합, 테스트.
- `src/features/projects/domain/types.ts` — 요청 타입 하나.
- `src/features/projects/components/integrations/HeartbeatCard.tsx` — 요청·재설정 요청 조립.
- `src/features/projects/components/integrations/DreamCard.tsx` — 같은 몫.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx`,
  `DreamCard.test.tsx` — 요청 payload를 단정하는 기존 테스트의 갱신.
- 그 외 파일은 건드리지 않는다. 특히 `domain/project.rs`·`App.css`·`ModelField.tsx`·
  `jobValueMemoryStore.ts`는 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **데몬을 고치지 않는다.** 무제한의 구현은 데몬의 기존 동작(줄 없음 = 한도 없음)을 그대로 쓴다.
- **`max_per: none` 같은 새 표기를 만들지 않는다**(R2). 그 값은 데몬에서 형식 위반으로 떨어져 결과는
  같지만, 파일만 보는 사람에게는 한도가 있는 것처럼 읽힌다.
- **`parse_duration`은 건드리지 않는다.** 0 거부는 `parse_quota` 안에서만 한다. `parse_duration`은
  `interval`·`timeout` 검증도 겸하는데, 그 두 필드의 "없음" 표현은 이 기획서의 제외 범위다.
- **앱 기본값을 바꾸지 않는다**(R1). 제한 없음은 사용자가 고르는 값이지 앱이 권하는 값이 아니다.
- **조회 경로에서 파일을 새로 열지 않는다.** 이 작업은 쓰기 경로만 바꾼다.

### 1. 한도 값에 두 상태를 준다

`heartbeat_jobs.rs`에 잡 하나의 한도를 나타내는 값을 둔다. 이 모듈이 `ManagedJob`을 소유하고, 렌더와
검증이 여기 있다.

```rust
/// 잡 하나의 실행 한도. `Unlimited`는 관리 블록에 `max_per` 줄을 쓰지 않는다는 뜻이다(R2).
/// 데몬이 줄 없는 잡을 한도 없는 잡으로 다루므로 새 표기를 만들지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MaxPer {
    Unlimited,
    Limit(String),
}
```

- `ManagedJob.max_per`의 타입을 `String`에서 `MaxPer`로 바꾼다.
- `render_block`은 `Limit`일 때만 `- max_per: {}` 줄을 쓴다. `Unlimited`면 그 줄을 건너뛴다. 나머지
  여덟 줄의 내용과 순서는 그대로다(R2, 완료 조건 3).
- `validate_job`은 `Limit`일 때만 한도 값을 검사한다. `Unlimited`에는 검사할 값이 없다.

### 2. 앱이 받는 값을 데몬이 인정하는 값과 맞춘다

`parse_quota`가 지금 통과시키는 `0/24h`·`4/0h`를 데몬과 같이 거부한다(R4). 거부 사유는 둘로 나눈다 —
사용자가 할 일이 다르다.

```rust
/// 한도 값이 거부되는 이유(R4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuotaRejection {
    /// `<횟수>/<기간>` 형태가 아니다.
    Format,
    /// 형태는 맞지만 횟수가 0이거나 기간이 0초다. 데몬이 한도로 인정하지 않아 결과가 무제한이 된다.
    Ignored,
}

/// `<횟수>/<기간>`을 읽고 거부 사유를 함께 돌려준다. 판정 규칙은 이 함수에만 있다.
pub fn check_quota(value: &str) -> Result<Quota, QuotaRejection>
```

- `parse_quota`는 `check_quota(value).ok()`로 남긴다. 호출처(`job_quota`)의 뜻이 "데몬이 한도로
  인정하는가"이므로 이름과 반환값을 그대로 두는 편이 읽기 쉽다.
- 판정 순서: `/`가 없거나 횟수가 숫자가 아니거나 기간 형식이 아니면 `Format`. 형식을 통과한 뒤 횟수가
  0이거나 기간이 0초면 `Ignored`. **`4/0h`는 `Format`이 아니라 `Ignored`다** — `parse_duration("0h")`은
  `Some(0)`을 돌려주므로 형식은 맞다.
- `validate_job`은 `Format`이면 기존 문구를, `Ignored`면 아래 문구를 쓴다(R4, 완료 조건 8).

```
횟수는 1 이상, 기간은 1초 이상이어야 합니다. 하트비트는 0을 한도로 인정하지 않아, 이 값을 쓰면 잡이
멈추는 대신 오히려 제한 없이 실행됩니다. 이 잡을 돌리고 싶지 않다면 잡을 끄고, 한도 없이 돌리려면
실행 한도를 제한 없음으로 지정하세요.
```

이 문구는 TASK-053이 화면 검증에 그대로 옮긴다. 두 곳이 갈리면 사용자는 같은 거부에 대해 다른 설명을
듣는다.

### 3. 기본값과 설정 타입의 방향을 뒤집는다

`RoleJobSettings.max_per`·`DreamJobSettings.max_per`가 `MaxPer`가 되어야 병합 결과가 제한 없음을 실어
나른다. 그런데 지금은 그 설정에서 `JobDefaults`(화면 payload, `max_per: String`)를 만든다. 방향이 그대로면
`Unlimited`를 문자열로 바꿀 수 없는 자리가 생긴다.

앱 기본값은 언제나 한도가 있는 값이므로(R1) **정의를 `JobDefaults` 쪽에 두고 설정을 그것에서 만든다.**

- `HeartbeatRole::default_settings()`와 `heartbeat_dream::default_settings()`의 반환 타입을
  `JobDefaults`로 바꾼다. 값 자체는 지금과 같다.
- `impl From<RoleJobSettings> for JobDefaults`와 `impl From<DreamJobSettings> for JobDefaults`를 지우고,
  반대 방향 `impl From<JobDefaults> for RoleJobSettings`·`for DreamJobSettings`를 둔다. 여기서
  `max_per: MaxPer::Limit(defaults.max_per)`가 된다.
- `heartbeat_service.rs`의 `From<RoleJobSettings> for JobSettings`·`From<DreamJobSettings> for
  JobSettings`는 쓰이는 자리가 전부 "기본값을 병합 기준으로 만드는" 곳이므로 `From<JobDefaults> for
  JobSettings` 하나로 대신한다. 반대 방향(`From<JobSettings> for RoleJobSettings`·`for
  DreamJobSettings`)은 그대로 두되 `max_per`가 `MaxPer`를 그대로 옮긴다.
- `heartbeat_status.rs:63`의 `role.default_settings().into()`는 이제 변환이 필요 없다.
- 이 정리로 `JobDefaults`의 필드 구성과 화면 payload는 바뀌지 않는다. 화면은 이 작업에서 기본값에 대해
  달라지는 것이 없다.

### 4. 저장 요청에 세 번째 상태를 준다

R3이 요구하는 구분이다. 지금의 `Option<String>` 하나로는 "지정 안 함"과 "제한 없음"을 담을 수 없다.

```rust
/// 저장 요청이 정하는 실행 한도(R3). 필드가 `None`이면 "이번 편집에서 지정하지 않음"이라 파일 값이
/// 이긴다. 지정한 경우는 이 둘 중 하나다.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MaxPerRequest {
    Unlimited,
    Limit { value: String },
}
```

- `RoleJobRequest.max_per`와 `DreamJobRequest.max_per`를 `Option<MaxPerRequest>`로 바꾼다.
- 표기는 `JobQuota`가 이미 쓰는 `#[serde(tag = "kind")]`와 같은 결이다. JSON으로는 `null`,
  `{"kind":"unlimited"}`, `{"kind":"limit","value":"4/24h"}` 셋이다.
- **두 필드로 나누지 않는다.** `maxPer`와 `maxPerUnlimited`를 나란히 두면 `("4/24h", true)`처럼 뜻이
  충돌하는 조합이 계약에 생기고, 그 조합의 우선순위 규칙이 코드 두 곳에 흩어진다.

`PartialSettings.max_per`는 `Option<MaxPer>`가 된다. `None`이 "지정 안 함"이라는 뜻은 그대로이고,
`over`의 규칙도 그대로다. `specifies_nothing`도 그대로다.

### 5. 한도 줄이 없는 잡을 제한 없음으로 읽는다

여기가 R3의 핵심이고, 지금 줄이 되살아나는 원인이다.

`block_role_settings`·`block_dream_settings`는 관리 블록에서 읽은 잡으로 `PartialSettings`를 만든다.
지금은 `max_per: job.max_per.clone()`이라 **잡이 블록에 있는데 한도 줄만 없는 경우**가 "지정 안 함"으로
읽히고, 병합에서 앱 기본값이 채워진다.

- 그 잡이 블록에 **있으면** `max_per`는 `Some(...)`이다. 줄이 있으면 `Some(MaxPer::Limit(값))`,
  줄이 없으면 `Some(MaxPer::Unlimited)`다.
- 그 잡이 블록에 **없으면** 지금처럼 `PartialSettings::default()`이고 `max_per`는 `None`이다.
- `interval`·`model`·`timeout`은 지금 그대로 둔다. 그 세 필드의 "줄 없음"은 이 기획서의 대상이 아니다.

`ManagedRoleJob`·`ManagedDreamJob`의 `max_per: Option<String>`은 바꾸지 않는다. 그 값은 파일을 그대로
옮긴 것이고 `None`은 "그 줄이 블록에 없다"는 사실 하나만 뜻한다. 기준값 대조(TASK-017)도 이 값을 그대로
비교하므로 규칙이 달라지지 않는다.

### 6. 요청을 조립하는 자리만 화면에서 고친다

`types.ts`에 요청 타입을 더한다.

```ts
/** 저장 요청이 정하는 실행 한도. null은 "이번 편집에서 지정하지 않음"이다(R3). */
export type MaxPerRequestValue = { kind: "unlimited" } | { kind: "limit"; value: string };
```

`RoleJobRequest.maxPer`·`DreamJobRequest.maxPer`를 `MaxPerRequestValue | null`로 바꾸고, 두 카드에서
값을 실어 보내는 세 자리만 고친다.

- `requestOf`/`request` — 지정된 필드면 `{ kind: "limit", value: form의 값 }`, 아니면 `null`.
- `resetRequestOf`/`resetRequest` — `{ kind: "limit", value: defaults.maxPer }`. 재설정은 앱 기본값으로
  되돌리는 것이고 기본값은 언제나 한도 값이다.
- 폼 상태·검증·표시는 건드리지 않는다. 이 작업에서 `unlimited`를 만들어 보내는 경로는 아직 없다.

### 7. 테스트

Rust는 `heartbeat_jobs.rs`·`heartbeat_service.rs`의 테스트 모듈에 둔다.

렌더와 검증(1·2절):

- `Unlimited`인 잡을 쓰면 그 잡에 `- max_per:` 줄이 없고, 나머지 여덟 줄은 `Limit`일 때와 같다.
  (완료 조건 2, 3)
- `Limit`인 잡의 렌더 결과가 지금과 같다.
- `0/24h`·`0/1s`·`4/0h`·`4/0m`가 각각 `Ignored`로 거부되고, `4번`·`4/24`·`/24h`가 `Format`으로
  거부된다. (완료 조건 7)
- `1/1s`는 통과한다. 경계값이다.
- `Ignored` 거부 문구에 "제한 없음"과 잡 끄기가 모두 나온다. (완료 조건 8)

저장 경로(3·4·5절):

- 요청이 `unlimited`를 지정하면 파일의 그 잡에 한도 줄이 없다. 역할 잡과 dream 잡 각각. (완료 조건 1, 2)
- 그 저장에서 나머지 필드와 앱 소유 필드가 지금과 같이 쓰인다. 저장 전후 블록을 대조해 한도 줄 외의
  차이가 없음을 확인한다. (완료 조건 3)
- 한도 줄이 없는 블록을 픽스처로 두고, 아무것도 지정하지 않은 요청(네 필드 모두 `null`)으로 저장하면
  한도 줄이 되살아나지 않는다. (완료 조건 5)
- 같은 픽스처에서 `model`만 지정한 요청으로 저장해도 한도 줄이 없다. (완료 조건 6)
- 같은 픽스처에서 이 요청이 정하지 않는 다른 잡(보존 잡)의 한도 줄도 되살아나지 않는다.
- 한도 줄이 없는 잡에 `limit`을 지정해 저장하면 그 줄이 생긴다. 되돌아갈 길이 있어야 한다.
- 블록에 `0/24h`가 있는 잡을 둔 채 다른 잡을 저장하면 `PreservedJob` 오류가 나고 파일이 바뀌지 않는다.
  (완료 조건 9의 백엔드 몫)
- 그 잡 자신에 값을 지정해 저장해도 `InvalidValue`로 거부되고 파일이 바뀌지 않는다.
- `4/0h`에 대해 같은 두 가지를 확인한다.
- 기본값 재설정 요청이 지금과 같은 값을 쓴다. (기존 SPEC-005 동작)

프런트엔드는 기존 테스트의 요청 단정을 새 모양으로 갱신하는 것까지다. 단정하던 사실(어느 필드를
지정으로 보냈는가)이 줄지 않게 한다. 새 시나리오는 TASK-053·TASK-054가 더한다.

## 완료 조건

1. 저장 요청이 "지정 안 함"·"제한 없음"·"한도 지정" 셋을 서로 다른 값으로 표현한다. (기획서 R3)
2. 제한 없음으로 저장하면 관리 블록의 그 잡에 `max_per` 줄이 없다. 역할 잡과 dream 잡 모두.
   (기획서 완료 조건 2)
3. 같은 저장에서 나머지 필드와 앱 소유 필드가 지금과 같이 쓰인다. (기획서 완료 조건 3)
4. 한도 줄이 없는 잡을 아무것도 바꾸지 않고 저장해도 줄이 되살아나지 않는다. (기획서 완료 조건 5)
5. 다른 필드만 지정해 저장해도 한도 줄이 없는 상태가 유지된다. (기획서 완료 조건 6)
6. 횟수가 0 이하이거나 기간이 0인 값은 백엔드 검증이 거부하고 파일이 바뀌지 않는다.
   (기획서 완료 조건 7의 백엔드 몫)
7. 거부 문구가 그 값이 데몬에서 무제한이 된다는 사실과, 잡 끄기·제한 없음의 차이를 밝힌다.
   (기획서 완료 조건 8)
8. 파일에 이미 어긋난 값이 있는 잡은 그 잡을 지정하든 안 하든 저장이 거부되고 파일이 바뀌지 않는다.
   (기획서 완료 조건 9의 백엔드 몫)
9. 앱 기본값이 지금과 같고 화면에 내려가는 `JobDefaults` 구성이 바뀌지 않는다. (기획서 R1)
10. 기존 Rust·프런트엔드 테스트가 삭제·비활성화 없이 통과한다. (기획서 완료 조건 17)
11. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
    (기획서 완료 조건 18)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

## 사용자 QA 항목

자동화 테스트가 저장 결과 문서까지 확인한다. 아래는 실제 앱 창이 필요하다.

- 잡 하나의 한도 칸에 `0/24h`를 넣고 저장을 눌렀을 때 거부 문구가 뜨고 `~/.claude/HEARTBEAT.md`가
  바뀌지 않는지. (이 단계에서는 화면 검증이 아니라 백엔드 오류로 뜬다)
- 손으로 한도 줄을 지운 잡이 있는 상태에서 다른 값을 저장했을 때 그 줄이 되살아나지 않는지.

## 범위 밖

- 편집 폼의 "제한 없음" 선택지와 화면 검증. TASK-053·TASK-054다.
- 사용량 표시와 `JobQuota`의 상태 구분. TASK-052다.
- `interval`·`timeout`·`model`의 "없음" 표현. 이 기획서의 대상은 `max_per` 하나다.
- 하트비트 쪽 변경 전부.
- 앱이 조회만으로 어긋난 값을 고치는 것.
- 한도 프리셋·추천값·자동 조정.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `render_block`(`heartbeat_jobs.rs:160`)은 잡마다 여덟 줄을 순서대로 쓰고 마지막이
  `- max_per: {}`다. 줄을 빼는 표현이 지금 없다.
- `validate_job`(`:280`)은 `is_quota`를 강제하고, `is_quota`(`:356`)는 `parse_quota`(`:340`)에
  기댄다. `parse_quota`는 횟수가 ASCII 숫자이기만 하면 통과시키므로 `0/24h`가 유효하고,
  `parse_duration("0h")`이 `Some(0)`이라 `4/0h`도 유효하다.
- `parse_duration`(`:322`)은 `interval`·`timeout` 검증도 겸한다(`is_duration`, `:352`).
- `PartialSettings::over`(`heartbeat_service.rs:186`)가 병합 규칙 전부다. 기준 설정을 만들 때와 요청을
  반영할 때 같은 함수를 쓴다.
- `block_role_settings`(`:428`)·`block_dream_settings`(`:442`)는 블록에 잡이 없으면
  `PartialSettings::default()`를 돌려준다. 잡이 있고 줄만 없는 경우와 지금은 구분되지 않는다.
- `managed_role_jobs`(`:759`)·`managed_dream_job`(`:795`)은 `job.field("max_per")`를 그대로 옮기므로
  줄이 없으면 `None`이다.
- `RoleJobSettings`(`heartbeat_roles.rs:61`)·`DreamJobSettings`(`heartbeat_dream.rs:55`)는 각각
  `JobDefaults`로 가는 `From` impl을 갖고 있고, `JobDefaults`(`domain/project.rs:295`)의 `max_per`는
  `String`이다.
- `default_settings`를 부르는 자리는 여덟 곳이다. 그중 `heartbeat_status.rs:63`과
  `heartbeat_service.rs:641`은 화면 payload용이고, 나머지는 병합 기준이거나 테스트다.
- `RoleJobRequest`(`heartbeat_service.rs:140`)·`DreamJobRequest`(`:153`)의 `max_per`는
  `Option<String>`이고, `None`이 "이번 편집에서 지정하지 않음"이라는 뜻은 SPEC-005가 정했다.
- 화면에서 요청을 조립하는 자리는 넷이다. `HeartbeatCard.tsx:574`(`requestOf`)·`:546`
  (`resetRequestOf`), `DreamCard.tsx:514`(`request`)·`:493`(`resetRequest`).
- `JobQuota`(`domain/project.rs:266`)가 이미 `#[serde(tag = "kind", rename_all = "camelCase")]`를 쓴다.
