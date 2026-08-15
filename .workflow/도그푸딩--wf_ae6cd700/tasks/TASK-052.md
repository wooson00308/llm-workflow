---
schema: workflow-labs/task@1
id: TASK-052
title: 사용량 payload가 고른 무제한과 값이 어긋나 생긴 무제한을 구분한다
status: verified
source_spec_id: SPEC-017
source_decision_id: DECISION-EC07DE7E
depends_on:
- TASK-051
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T08:40:00Z
  kind: created
- at: 2026-08-03T09:44:00Z
  kind: in_progress
- at: 2026-08-03T09:57:00Z
  kind: qa_waiting
- at: 2026-08-04T11:45:31.412911+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-EC07DE7E
work_group_revision: 1
---

# 사용량 payload가 고른 무제한과 값이 어긋나 생긴 무제한을 구분한다

SPEC-017 R5의 표시 몫과 R6을 구현한다. SPEC-009가 올린 사용량 표시가 지금 두 값에 대해 사실과 정반대를
말한다 — `0/24h`는 언제나 소진으로 보이고 `4/0h`는 영원히 차지 않는데, 실제로는 둘 다 무제한으로 돈다.
그 표시를 데몬의 판정에 맞추고, 사용자가 고른 제한 없음을 그와 다른 상태로 내보낸다.

## 의존성

- **선행 필수: TASK-051.** 그 작업에서 `parse_quota`가 `0/24h`·`4/0h`를 거부하게 되어야 이 작업의
  판정이 성립한다. 또 "블록에 있는데 한도 줄이 없는 잡"을 제한 없음으로 읽는 규칙도 그 작업이 만든다.
- **TASK-051과 병행 금지.** 같은 `heartbeat_service.rs`와 같은 두 카드 파일을 만진다.
- **TASK-035·TASK-037·TASK-048과 병행 금지.** 넷 다 `src-tauri/src/domain/project.rs`를 만진다. 순서는
  어느 쪽이 먼저여도 된다.
- **TASK-038·TASK-048과 병행 금지.** `src/features/projects/domain/types.ts`가 겹친다.
- **TASK-046·TASK-049·TASK-050과 병행 금지.** 두 카드 파일과 `IntegrationsView.test.tsx`가 겹친다.

## 범위

- `src-tauri/src/domain/project.rs` — `JobQuota`의 상태 구분.
- `src-tauri/src/application/heartbeat_service.rs` — `job_quota`와 그 배선, 테스트.
- `src/features/projects/domain/types.ts` — `JobQuota` 유니온.
- `src/features/projects/components/integrations/HeartbeatCard.tsx` — `quotaUsageLabel` 문구.
- `src/features/projects/components/integrations/DreamCard.tsx` — 같은 몫.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx`,
  `DreamCard.test.tsx` — 표시 테스트.
- 그 외 파일은 건드리지 않는다. 특히 `heartbeat_jobs.rs`·`heartbeat_roles.rs`·`heartbeat_dream.rs`·
  `App.css`는 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **SPEC-009가 정한 규칙 자체를 바꾸지 않는다**(기획서 제외 범위). 한도가 있는 잡의 사용량 표시·소진
  판정·회복 예상 시각·경고는 그대로다. 이 작업은 상태를 둘 더하고 그 둘에서 무엇을 하지 않을지만 정한다.
- **조회가 여는 파일 수를 늘리지 않는다**(R7). 판정에 필요한 값은 이미 읽은 관리 블록과 상태 파일에 다
  있다.
- **조회가 파일을 쓰지 않는다**(R5). 어긋난 값을 앱이 고치거나 지우지 않는다.
- **경고 규칙을 새로 만들지 않는다.** `quotaWarned`는 지금도 `kind === "counted"`를 요구하므로 두 새
  상태는 자동으로 경고에서 빠진다. 그 사실을 테스트로 고정한다.

### 1. 세 무제한을 두 값으로 나눈다

지금 `JobQuota::Unlimited { value }` 하나가 "형식이 깨져 데몬이 한도 없이 다룬다"는 뜻이다. 여기에
사용자가 고른 제한 없음이 더해지면 두 상태가 같은 낱말을 쓰게 된다(기획서 확인 사실 8번).

```rust
pub enum JobQuota {
    /// 앱이 한도 값을 모른다. 관리 블록을 읽지 못했거나 그 잡이 블록에 없다.
    Unknown,
    /// 사용자가 고른 제한 없음. 그 잡이 블록에 있고 `max_per` 줄이 없다(R6). 정상 상태다.
    Unlimited,
    /// `max_per` 값이 있으나 데몬이 한도로 인정하지 않아 결과가 무제한이다(R5). 손볼 곳이라는
    /// 신호이고 원문을 함께 담는다. 형식 위반·0 이하 횟수·0 기간이 모두 여기다.
    IgnoredLimit { value: String },
    NoRuns { limit: u64, window: String },
    Counted { .. },
}
```

- `Unlimited`는 값을 담지 않는 단위 변형이 된다. 보여줄 원문이 없다 — 파일에 그 줄 자체가 없다.
- 기존 `Unlimited { value }`가 하던 일은 `IgnoredLimit { value }`가 그대로 받는다. 이름을 바꾸는
  이유는 두 상태를 같은 낱말로 부르지 않기 위해서다. 지금 이름을 남기고 새 상태에 다른 이름을 주면,
  코드에서 "unlimited"가 이상 신호를 뜻하고 화면에서는 정상 상태를 뜻하는 어긋남이 남는다.

### 2. 판정 입력을 두 겹으로 받는다

`job_quota`는 지금 `Option<&str>` 하나를 받고 `None`을 `Unknown`으로 읽는다. 그 하나로는 "그 잡이 블록에
없다"와 "블록에 있는데 한도 줄이 없다"를 구분할 수 없다.

```rust
/// `max_per`의 바깥 `Option`은 그 잡이 관리 블록에 있는가이고, 안쪽 `Option`은 그 잡에 `max_per`
/// 줄이 있는가다. 바깥이 `None`이면 `Unknown`, 안쪽만 `None`이면 사용자가 고른 제한 없음이다.
fn job_quota(max_per: Option<Option<&str>>, recent: Option<Vec<f64>>, now: DateTime<Utc>) -> JobQuota
```

판정 순서다.

1. 바깥이 `None`이면 `Unknown`. 관리 블록을 읽지 못한 조회에서 이 값이 그대로 나가야 한다(SPEC-009 R5).
2. 안쪽이 `None`이면 `Unlimited`. `recent`를 보지 않는다.
3. `parse_quota`가 `None`이면 `IgnoredLimit { value }`. TASK-051 이후 이 갈래에 형식 위반뿐 아니라
   0 이하 횟수와 0 기간이 함께 들어온다(R5).
4. 그 밖은 지금과 같다. `recent`가 없으면 `NoRuns`, 있으면 창 안 항목을 세어 `Counted`.

배선은 호출처에서 한 겹을 더 넘기는 것뿐이다.

- 역할 잡: `managed_jobs.iter().find(...)` 결과를 `.map(|job| job.max_per.as_deref())`로 넘긴다. 지금의
  `.and_then(...)`이 두 상태를 접고 있는 자리다.
- dream 잡: `managed_job.as_ref().map(|job| job.max_per.as_deref())`.

### 3. 제한 없음에서 무엇을 하지 않는지 정한다

R6이다. 코드로는 2절의 2번에서 이미 결정되지만, 왜 그런지는 여기 남긴다.

- **소진 판정을 하지 않는다.** 막을 한도가 없으므로 그 잡이 대기 물량 때문에 멈춰 있을 수 없다.
- **한도 경고를 띄우지 않는다.** 경고는 `Counted` + `exhausted` + 대기 물량의 조합이다.
- **사용 횟수를 표시하지 않는다.** 데몬은 무제한 잡의 실행을 `recent_runs`에 기록하지 않는다(기획서 확인
  사실 3번). 파일에 남은 값은 한도가 있던 시절의 이력이고, 그것을 사용량으로 보여주면 늘지 않는 숫자가
  화면에 굳는다. `IgnoredLimit`도 같은 이유로 숫자를 보여주지 않는다.
- **마지막 실행 기록 표시는 그대로 둔다.** 그 값은 `last_run`에서 오고 한도와 무관하다. 이 작업은
  `last_run` 경로를 건드리지 않는다.

### 4. 화면 문구

`types.ts`의 유니온을 백엔드와 같은 모양으로 바꾸고, 두 카드의 `quotaUsageLabel`에 갈래를 더한다.

```ts
export type JobQuota =
  | { kind: "unknown" }
  | { kind: "unlimited" }
  | { kind: "ignoredLimit"; value: string }
  | { kind: "noRuns"; limit: number; window: string }
  | { kind: "counted"; ... };
```

- `unlimited` — 제한 없음이 정상 상태라는 것이 읽혀야 한다. 사용 횟수를 적지 않는다. 예:
  `제한 없음 — 실행 횟수 제한 없이 주기마다 실행됩니다.`
- `ignoredLimit` — 원문과 함께, 이 값이 한도로 동작하지 않는다는 사실과 고쳐야 한다는 사실을 밝힌다.
  지금 문구는 "형식이 올바르지 않아"라고 단정하는데 `0/24h`는 형식이 맞으므로 그 말이 틀린다. 예:
  `한도 없음 — max_per 값 "0/24h"을 하트비트가 한도로 인정하지 않아 이 잡이 제한 없이 실행됩니다. 값을 고치기 전에는 이 잡을 저장할 수 없습니다.`
- 두 카드가 같은 낱말을 쓴다. 지금도 두 파일에 같은 함수가 따로 있고, 이 작업은 그 구조를 바꾸지 않는다.
- `quotaWarned`·`JobQuotaLine`의 판정 조건(`kind === "counted"`)은 그대로 둔다. 두 새 상태가 경고와
  회복 시각 표시에서 빠지는 것은 그 조건 덕분이다.

### 5. 테스트

Rust는 `heartbeat_service.rs` 테스트 모듈에 둔다.

- 잡이 블록에 없으면 `Unknown`이다. 관리 블록을 읽지 못한 조회에서도 `Unknown`이다. (기존 SPEC-009 단정)
- 블록에 잡이 있고 한도 줄이 없으면 `Unlimited`다. `recent_runs`에 항목이 있어도 `Unlimited`다.
  (완료 조건 13)
- `0/24h`·`4/0h`·`4번`이 각각 `IgnoredLimit`이고 원문을 담는다. (완료 조건 11)
- `0/24h`인 잡에 실행 기록이 창 안에 여러 개 있어도 소진 판정이 나오지 않는다. 지금은 이 픽스처가
  `Counted { exhausted: true }`를 만든다. 이 작업이 뒤집는 사실이다.
- 한도가 있는 잡의 `NoRuns`·`Counted`·`exhausted`·`recovers_at`이 지금과 같다. (완료 조건 15)
- dream 잡에서도 같은 네 갈래가 나온다.
- 조회 전후로 `~/.claude/HEARTBEAT.md`의 내용과 수정 시각이 같다. 어긋난 값이 있는 상태에서 확인한다.
  `heartbeat_status.rs`의 `reading_the_status_does_not_touch_the_heartbeat_home`과 같은 형태다.
  (완료 조건 10)
- 조회가 여는 파일 목록이 이 작업 전후로 같다. (완료 조건 16)

프런트엔드는 두 카드 테스트에 둔다.

- `unlimited` 사용량 줄이 제한 없음으로 보이고 숫자가 없다. (완료 조건 13)
- `unlimited` 상태에서 그 역할에 대기 물량이 있어도 한도 경고가 뜨지 않고, 카드 접힘 요약에도 경고가
  올라가지 않는다. (완료 조건 11)
- `ignoredLimit` 사용량 줄이 원문을 담고, 경고가 뜨지 않는다.
- 두 상태의 문구가 서로 다르다. (완료 조건 12)
- `unlimited`인 잡의 마지막 실행 기록 줄이 그대로 보인다. (완료 조건 14)
- 한도가 있는 잡의 표시·소진·회복 시각·경고에 대한 기존 단정이 그대로 통과한다. (완료 조건 15)

## 완료 조건

1. 사용자가 고른 제한 없음과 값이 어긋나 무제한이 된 상태가 서로 다른 값으로 나가고, 화면에서 다르게
   보인다. (기획서 완료 조건 12)
2. 형식 위반·0 이하 횟수·0 기간이 모두 한도 없음으로 표시되고, 셋 중 어느 것도 소진 판정과 경고를
   만들지 않는다. (기획서 완료 조건 11)
3. 제한 없음인 잡은 사용 횟수를 표시하지 않는다. `recent_runs`에 과거 이력이 남아 있어도 마찬가지다.
   (기획서 완료 조건 13)
4. 제한 없음인 잡의 마지막 실행 기록 표시가 그대로 남는다. (기획서 완료 조건 14)
5. 한도가 있는 잡의 사용량 표시·소진 판정·회복 예상 시각·경고가 SPEC-009의 기존 완료 조건대로
   동작한다. (기획서 완료 조건 15)
6. 앱은 조회만으로 관리 블록을 변경하지 않는다. (기획서 완료 조건 10)
7. 상태 조회가 여는 파일 수가 늘지 않는다. (기획서 완료 조건 16)
8. 기존 Rust·프런트엔드 테스트가 삭제·비활성화 없이 통과한다. (기획서 완료 조건 17)
9. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
   (기획서 완료 조건 18)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

## 사용자 QA 항목

아래는 실제 앱 창과 손으로 만든 파일 상태가 필요하다.

- `~/.claude/HEARTBEAT.md`의 관리 블록에서 잡 하나의 `max_per` 줄을 지우고 앱을 열었을 때, 그 잡의
  사용량 줄이 제한 없음으로 보이고 경고가 없는지.
- 같은 잡의 `max_per`를 `0/24h`로 바꿨을 때 표시가 한도 없음으로 바뀌고, "항상 소진"과 한도 경고가
  사라지는지. (기획서 기대효과)
- 두 상태의 문구가 서로 구분되는지.

## 범위 밖

- 편집 폼의 "제한 없음" 선택지와 화면 검증. TASK-053·TASK-054다.
- 저장 경로와 요청 계약. TASK-051이다.
- SPEC-009가 정한 사용량 표시·소진 판정·경고 규칙 자체의 변경.
- 앱이 조회만으로 어긋난 값을 자동 정정하는 것.
- 관리 블록 밖 사용자 잡의 한도.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `job_quota`(`heartbeat_service.rs:527`)가 조립 규칙 전부다. `max_per`가 `None`이면 `Unknown`,
  `parse_quota`가 `None`이면 `Unlimited { value }`, `recent`가 없으면 `NoRuns`, 그 밖은 `Counted`다.
- 역할 잡 배선(`:589`)은 `.and_then(|job| job.max_per.as_deref())`라 "잡이 없음"과 "줄이 없음"이 같은
  `None`으로 접힌다. dream 배선(`:627`)도 같다.
- `exhausted`는 `used >= quota.count`다(`:555`). `0/24h`에서는 `count`가 0이라 언제나 참이다.
- `4/0h`는 `window_seconds`가 0이라 창 안 항목이 하나도 없다. `used`가 늘 0이고 `limit`이 4라 영원히
  소진되지 않는다.
- `quotaWarned`는 두 카드 모두 `quota.kind === "counted" && quota.exhausted && 대기 물량`이다
  (`HeartbeatCard.tsx:98`, `DreamCard.tsx:90`).
- 카드 접힘 요약의 경고(`bodyWarning`, `HeartbeatCard.tsx:218`)도 같은 `quotaWarned`를 쓴다.
- `JobQuotaLine`(`HeartbeatCard.tsx:282`)은 `quotaUsageLabel`이 `null`이면 줄 자체를 그리지 않는다.
  `unknown`만 `null`이다.
- `HeartbeatRoleStatus.quota`는 상태 조회가 `Unknown`으로 두고 서비스가 채운다
  (`domain/project.rs:258`).
- 조회가 여는 파일은 하트비트 홈의 상태 문서·실행 기록·`HEARTBEAT.md`와 dream 스킬 경로뿐이다.
  이 작업은 그 목록을 늘리지 않는다.
