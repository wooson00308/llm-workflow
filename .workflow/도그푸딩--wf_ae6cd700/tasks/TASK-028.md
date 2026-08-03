---
schema: workflow-labs/task@1
id: TASK-028
title: 연동 잡의 실행 한도 사용량을 백엔드가 계산해 스냅샷에 싣는다
status: todo
source_spec_id: SPEC-009
source_decision_id: DECISION-85491D81
updated_at: 2026-08-03T00:45:00Z
history:
  - { at: 2026-08-03T00:45:00Z, kind: created }
---

# 연동 잡의 실행 한도 사용량을 백엔드가 계산해 스냅샷에 싣는다

SPEC-009 R1·R2·R5·R6의 백엔드 몫을 구현한다. 앱이 이미 읽고 있는 `state.json`에서 `recent_runs`를
꺼내고, 관리 블록의 `max_per`와 짝지어 잡별 사용량·소진 여부·회복 예상 시각을 연동 스냅샷에 싣는다.
화면은 건드리지 않는다.

## 의존성

- 선행 작업 없음.
- **TASK-029와 병행 금지.** 둘 다 `src-tauri/src/domain/project.rs`를 만진다. 순서는 어느 쪽이
  먼저여도 된다.
- 이 작업의 산출물(`JobQuota`)을 TASK-030·TASK-031이 화면에서 쓴다.

## 범위

- `src-tauri/src/infrastructure/heartbeat_jobs.rs` — `max_per`·기간 파서를 값으로 돌려주는 형태로 확장.
- `src-tauri/src/infrastructure/heartbeat_status.rs` — `recent_runs` 조회, 읽은 상태 파일 결과 전달.
- `src-tauri/src/domain/project.rs` — `JobQuota` 타입, `HeartbeatRoleStatus.quota`.
- `src-tauri/src/application/heartbeat_service.rs` — 사용량 조립, `DreamIntegration.quota`.
- 그 외 파일은 건드리지 않는다. 화면·타입스크립트 타입·대기 물량 판정은 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- 읽기 전용이다(R6). 이 작업 때문에 `~/.claude` 아래 어떤 파일도 쓰지 않고 디렉터리도 만들지 않는다.
- **`state.json` 읽기 횟수를 늘리지 않는다.** 지금 조회 경로는 역할 잡용 1회
  (`heartbeat_status.rs:52`의 `read_job_runs`)와 dream용 1회(`heartbeat_service.rs:527`) 총 2회다.
  SPEC-003이 "한 번만 읽어 나눠 쓰면 상태 파일을 읽지 못했을 때 어느 카드의 값이 비었는지 알 수
  없다"는 이유로 의도적으로 나눈 것이다(`heartbeat_service.rs:521`~`:523`의 주석). 기획서 확인 사실
  8번과 완료 조건 17은 1회 읽기를 전제로 적혀 있지만, 이 작업은 **"각 경로가 이미 연 결과에서 필드
  하나를 더 꺼낸다"**로 구현한다. 두 읽기를 하나로 합치는 리팩터링은 SPEC-003의 판단을 뒤집는
  일이라 범위 밖이다.
- 한도 값의 기준은 **관리 블록에 적힌 값**이다(R1). `role.default_settings()`나
  `heartbeat_dream::default_settings()`를 대신 쓰지 않는다.
- 앱이 하트비트보다 엄격하게 굴지 않는다(R5). `max_per` 형식이 계약과 다르면 하트비트는 그 잡을
  한도 없는 잡으로 다루므로, 앱도 소진 판정과 회복 시각 계산을 하지 않는다.
- 사용 횟수를 `recent_runs`의 배열 길이로 세지 않는다(R1). 하트비트는 그 잡의 한도를 검사할 때만
  창 밖 항목을 정리하므로, 데몬이 멈춰 있거나 잡이 꺼져 있으면 오래된 값이 파일에 남는다.

### 1. `max_per`·기간을 값으로 돌려주는 파서 (`heartbeat_jobs.rs`)

지금 `is_duration`(`:305`)과 `is_quota`(`:312`)는 형식이 맞는지만 돌려준다. 같은 규칙을 두 번 적지
않도록 파싱 함수를 만들고 검증을 그 위에 얹는다.

- `pub fn parse_duration(value: &str) -> Option<u64>` — 초 단위. `s`=1, `m`=60, `h`=3600, `d`=86400.
  숫자부가 비어 있거나 ASCII 숫자가 아니면 `None`. 곱셈은 `checked_mul`로 하고 넘치면 `None`이다.
- `pub fn parse_quota(value: &str) -> Option<Quota>` — `Quota { count: u64, window_seconds: u64,
  window: String }`. `window`는 `max_per`의 기간 **원문**(`24h`)이다. 화면이 초를 다시 문자열로
  만들지 않게 여기서 그대로 넘긴다.
- `is_duration`·`is_quota`는 각각 `parse_*(value).is_some()`으로 다시 적는다.

기존 검증 동작은 한 줄도 바뀌면 안 된다. `install_managed_jobs`가 거부하던 값은 계속 거부하고
`InvalidValue` 문구도 그대로다. 기존 테스트가 그것을 지킨다.

### 2. 상태 파일에서 `recent_runs`를 꺼낸다 (`heartbeat_status.rs`)

`JobRuns`(`:118`)에 조회 하나를 더한다. `get`(`:122`)은 그대로 둔다.

```rust
pub fn recent_runs(&self, job_name: &str) -> Option<Vec<f64>>
```

- 상태 파일이 없거나 깨졌거나 잡 키가 없거나 `recent_runs`가 배열이 아니면 `None`이다. 이것이
  "실행 기록 없음"이고, 0회와 구분된다(R5).
- 배열이면 숫자 항목만 모아 돌려준다. 숫자가 아닌 항목은 버린다. **빈 배열은 `Some(vec![])`이고
  이것은 0회다.** 배열이 있다는 것 자체가 기록이다.
- 창 안 판정은 이 모듈이 하지 않는다. 이 모듈은 관리 블록을 모르므로 창 길이를 알 수 없다.

`HeartbeatRead`(`:38`)에 `pub(crate) runs: JobRuns`를 더한다. 지금 `read_heartbeat_status`는
`runs`를 지역 변수로 쓰고 버린다(`:52`). 그것을 구조체에 실어 돌려주면 서비스가 같은 읽기를 재사용해
파일을 다시 열지 않는다.

### 3. 사용량 타입 (`domain/project.rs`)

```rust
/// 잡 하나의 실행 한도 사용량. "값을 모른다"·"한도가 없다"·"기록이 없다"를 서로 다른 값으로
/// 구분한다(R5). 화면이 `used == 0`을 "기록 없음"으로 오독할 수 없어야 한다.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum JobQuota {
    /// 앱이 한도 값을 모른다. 관리 블록을 읽지 못했거나 그 잡이 블록에 없다.
    Unknown,
    /// `max_per` 형식이 계약과 달라 하트비트가 한도 없는 잡으로 다룬다. 원문을 함께 담는다.
    Unlimited { value: String },
    /// 한도는 알지만 실행 기록이 없다. 0회로 단정하지 않는다.
    NoRuns { limit: u64, window: String },
    Counted {
        used: u64,
        limit: u64,
        window: String,
        exhausted: bool,
        /// 소진 상태에서 한 번 분의 여유가 생기는 예상 시각. RFC3339(UTC)이고 화면이 로컬로
        /// 바꾼다. `TaskEvent.at`과 같은 규칙이다.
        recovers_at: Option<String>,
    },
}
```

- variant 이름과 필드 이름이 모두 camelCase로 나가야 한다. `serde`가 enum-level `rename_all`로
  variant만 바꾸므로, 필드가 있는 variant에는 `#[serde(rename_all = "camelCase")]`를 따로 붙이거나
  enum에 `rename_all_fields`를 쓴다. 컴파일되는 쪽을 택하고 결과 JSON 키를 테스트로 못 박는다.
- `HeartbeatRoleStatus`(`:227`)에 `pub quota: JobQuota`를 더한다. `heartbeat_status.rs`는 관리 블록을
  모르므로 `JobQuota::Unknown`으로 만들고, 그 자리에 "한도 값은 관리 블록에 있어 이 모듈이 알지
  못한다. 서비스가 채운다"는 주석을 남긴다. 이 기본값은 임시값이 아니라 R5가 요구하는 값이다 —
  관리 블록을 읽지 못한 조회에서는 이대로 나가야 한다.

### 4. 서비스가 사용량을 조립한다 (`heartbeat_service.rs`)

조립 규칙은 함수 하나에만 적는다.

```rust
fn job_quota(max_per: Option<&str>, recent: Option<Vec<f64>>, now: DateTime<Utc>) -> JobQuota
```

- `max_per`가 `None`이면 `Unknown`이다. 관리 블록에 그 잡이 없거나 그 줄이 없는 경우다.
- `parse_quota`가 실패하면 `Unlimited { value }`다. 소진 판정도 회복 시각 계산도 하지 않는다(R5).
- `recent`가 `None`이면 `NoRuns { limit, window }`다.
- 그 외에는 `Counted`다.
  - `used`는 **창 안 항목 수**다. 하트비트와 같은 부등호를 쓴다: `지금 − t < 창 길이`(기획서 확인
    사실 1번). 경계는 `<`이고 `<=`가 아니다.
  - 유한하지 않거나 미래로 너무 나간 값 등 판정할 수 없는 타임스탬프는 창 밖으로 보고 버린다.
  - `exhausted = used >= limit`. `used > limit`도 오류가 아니라 소진이다(R5, 완료 조건 15).
  - `recovers_at`은 소진일 때만 채운다. 창 안 **가장 오래된** 실행 시각 + 창 길이다. 창 안 항목이
    하나도 없으면(`limit`이 0인 잡) `None`이다. epoch 초 → `DateTime<Utc>` 변환은 `chrono`의
    `DateTime::from_timestamp`를 쓰고, 변환에 실패하면 `None`으로 둔다.
- `now`는 `Utc::now()`를 `inspect`에서 한 번 구해 두 연동에 같은 값을 넘긴다. 잡마다 다시 구하면
  한 화면 안에서 기준 시각이 어긋난다.

배선은 두 곳이다.

- 역할 잡: `inspect`(`:260`)가 `read.runs`를 들고 있다가, `managed_role_jobs(document, &slug)`가 만든
  `ManagedRoleJob.max_per`와 역할로 짝지어 `JobQuota`를 만든다. `heartbeat_integration`(`:496`)이
  `status.roles`를 payload로 옮길 때 `HeartbeatRoleStatus { quota, ..role }` 형태로 채운다.
- dream 잡: `dream_integration`(`:514`)이 이미 자기 몫으로 `read_job_runs`를 부른다(`:527`). 같은
  `JobRuns`에서 `recent_runs`를 꺼내 `managed_dream_job`의 `max_per`와 짝짓고, `DreamIntegration`에
  `pub quota: JobQuota`를 더해 싣는다. dream을 위해 파일을 새로 열지 않는다.

관리 블록을 읽지 못한 조회(`managed_block_failure`가 `Some`)에서는 `managed_role_jobs`·
`managed_dream_job`이 빈 값을 돌려주므로 `max_per`가 `None`이 되고 결과는 자연히 `Unknown`이다.
이 경로에 따로 분기를 만들지 않는다(R5).

### 5. 테스트

- `heartbeat_jobs.rs`
  - `parse_duration`·`parse_quota`가 `s`·`m`·`h`·`d`를 초로 바꾸고 기간 원문을 그대로 돌려준다.
  - 형식이 깨진 값(`6`, `6/24`, `6/24x`, `/24h`, `6/`, 빈 문자열)에서 `None`이다.
  - 기존 `install_managed_jobs` 검증 동작이 그대로다. 형식이 깨진 `max_per`로 설치하면 여전히
    거부되고 파일이 쓰이지 않는다.
- `heartbeat_status.rs`
  - `recent_runs`가 창 밖 항목까지 **자르지 않고** 그대로 돌려준다.
  - 상태 파일 없음·깨짐·잡 키 없음·`recent_runs`가 배열 아님에서 `None`이다.
  - 빈 배열에서 `Some(vec![])`이다.
  - 기존 `reading_the_status_does_not_touch_the_heartbeat_home`(`:604`) 픽스처에 `recent_runs`를
    더해도 홈 아래 파일의 수정 시각이 그대로다. (기획서 완료 조건 16)
- `heartbeat_service.rs`
  - 관리 블록의 `max_per`가 앱 기본값과 다를 때 그 값이 실린다. (기획서 완료 조건 3)
  - 창 밖 타임스탬프가 섞인 픽스처에서 배열 길이가 아니라 창 안 개수가 `used`다.
    (기획서 완료 조건 2)
  - 한도를 채운 픽스처에서 `exhausted`가 참이고 `recoversAt`이 `창 안 가장 오래된 시각 + 창 길이`와
    같다. (기획서 완료 조건 4)
  - `used`가 `limit`보다 큰 픽스처에서도 오류 없이 소진이다. (기획서 완료 조건 15)
  - 상태 파일 없음·깨짐·잡 키 없음 세 경우가 모두 `noRuns`다. `used: 0`이 아니다.
    (기획서 완료 조건 12)
  - 관리 블록을 읽지 못한 조회에서 역할 잡 셋과 dream이 모두 `unknown`이다. (기획서 완료 조건 13)
  - `max_per`가 `6/24`처럼 깨진 잡이 `unlimited`이고 소진 판정이 없다. (기획서 완료 조건 14)
  - dream 잡도 역할 잡과 같은 규칙으로 사용량을 낸다. (기획서 완료 조건 1의 dream 몫)
  - 직렬화 키가 `kind`·`used`·`limit`·`window`·`exhausted`·`recoversAt`로 나간다.
  - **읽기 횟수가 늘지 않았다.** `heartbeat/state.json` 자리를 파일이 아니라 디렉터리로 만들어
    읽기를 실패시키면, 그 경로가 `heartbeat.readFailures`에 한 번, `dream.readFailures`에 한 번
    들어간다. 읽기 실패 목록은 읽기 시도마다 쌓이므로 시도 횟수의 관찰 가능한 대리값이다. 이 작업
    전후로 각각 1회여야 한다. (기획서 완료 조건 17)

## 완료 조건

1. 관리 블록에 설치된 역할 잡 3종과 dream 잡의 사용량·한도·창 길이가 연동 스냅샷에 실린다.
   (기획서 완료 조건 1)
2. 사용 횟수가 창 안 항목만 센 값이다. 배열 길이가 아니다. (기획서 완료 조건 2)
3. 한도 값이 관리 블록의 값이다. 앱 기본값이 대신 쓰이지 않는다. (기획서 완료 조건 3)
4. 소진 상태에 `exhausted`와 `recoversAt`이 함께 실리고, 시각이 `창 안 가장 오래된 실행 시각 + 창
   길이`와 같다. (기획서 완료 조건 4)
5. 상태 파일 없음·깨짐·잡 기록 없음이 `noRuns`로 나가고 `used: 0`으로 나가지 않는다.
   (기획서 완료 조건 12)
6. 관리 블록을 읽지 못한 조회에서 모든 잡이 `unknown`이다. (기획서 완료 조건 13)
7. `max_per` 형식이 깨진 잡이 `unlimited`이고 소진 판정을 받지 않는다. (기획서 완료 조건 14)
8. 사용 횟수가 한도보다 커도 오류 없이 소진이다. (기획서 완료 조건 15)
9. 조회가 하트비트 홈 아래 파일을 바꾸지 않는다. (기획서 완료 조건 16)
10. `state.json` 읽기 시도 횟수가 연동별 1회씩, 합쳐 2회로 이 작업 전과 같다.
    (기획서 완료 조건 17, 아래 "범위 밖" 참고)
11. SPEC-002~SPEC-006 계열의 기존 Rust 테스트가 수정 없이 통과한다. 삭제·비활성화된 테스트가 없다.
    (기획서 완료 조건 18)
12. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
    (기획서 완료 조건 19)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

화면 확인은 이 작업에서 하지 않는다. payload만 바뀌고 화면은 아직 이 값을 읽지 않는다. 필요하면
`~/.claude/heartbeat/state.json`의 실제 `recent_runs`(개발자 잡에 17개 있음)로 값이 어떻게 나오는지
Rust 테스트 픽스처로 재현해 확인한다.

## 범위 밖

- 화면의 어떤 변경도. 표시·경고·접힘 요약은 TASK-030·TASK-031이다.
- `src/features/projects/domain/types.ts`를 포함한 프런트엔드 타입. TASK-030이 한다.
- 대기 물량 판정과 그에 따른 경고(R3). TASK-029·TASK-030·TASK-031이다.
- **`state.json`의 두 읽기를 하나로 합치는 리팩터링.** SPEC-003이 연동별 읽기 실패 귀속을 위해
  의도적으로 나눈 구조다. 합치면 "상태 파일을 못 읽었을 때 어느 카드의 값이 비었는지"가 사라진다.
- 하트비트 저장소 쪽 변경. `quota_skipped` 시 알림, 한도 자동 조정 전부.
- 앱이 한도 값을 자동으로 바꾸는 것. 편집 경로는 지금의 폼 하나 그대로다.
- 사용량 이력 그래프, 실행 로그 열람, 로그 파일 파싱.
- 관리 블록 밖 사용자 잡과 다른 slug 잡의 사용량.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `JobRuns::get`(`heartbeat_status.rs:122`)은 잡 기록에서 `last_run`·`last_result`·`last_duration`만
  꺼낸다. 같은 기록 안에 `recent_runs`가 있고 앱은 지금 그것을 읽지 않는다.
- `read_heartbeat_status`(`:46`)가 `read_job_runs`를 한 번 부르고(`:52`) 그 결과로 역할 셋의
  `last_run`을 채운 뒤 버린다. `HeartbeatRead`(`:38`)에는 `status`와 `document`만 있다.
- `dream_integration`(`heartbeat_service.rs:514`)이 `read_job_runs`를 한 번 더 부른다(`:527`).
  `:521`~`:523`에 그렇게 나눈 이유가 주석으로 적혀 있다.
- 관리 블록의 값은 `managed_role_jobs`(`:655`)와 `managed_dream_job`(`:690`)이 읽어
  `ManagedRoleJob.max_per`·`ManagedDreamJob.max_per`에 담는다. 블록이 없으면 각각 빈 목록과 `None`이다.
- 이 저장소의 실제 관리 블록 값은 역할 잡 `8/24h`·`8/24h`, 개발자 `24/24h`이고 앱 기본값
  (`heartbeat_roles.rs:43`의 `default_settings`)은 `4/24h`·`4/24h`·`6/24h`다. 셋 다 파일 값이 다르다.
- `is_quota`(`heartbeat_jobs.rs:312`)는 `<횟수>/<기간>`을 요구하고 `is_duration`(`:305`)은 숫자 뒤
  `s`·`m`·`h`·`d` 한 글자를 요구한다. 관리 블록은 사람이 손으로 고칠 수 있으므로 형식이 깨진 값이
  파일에 있을 수 있다.
- `HeartbeatJobRun.at`(`domain/project.rs:253`)은 타임존 없는 로컬 시각 문자열이라 원문 그대로
  전달한다. `recent_runs`는 epoch 초(부동소수)여서 성질이 다르다.
- `TaskEvent.at`(`domain/project.rs:111`)은 RFC3339 원문을 그대로 싣고 화면이 로컬 날짜로 바꾼다.
  회복 예상 시각도 같은 규칙을 따른다.
- `chrono`는 `0.4`, `serde`는 `1`이다(`src-tauri/Cargo.toml`).
- `heartbeat_status.rs`의 테스트 픽스처는 이미 `recent_runs`가 들어 있는 상태 파일을 쓴다(`:394`).
  값은 읽히지 않고 무시되고 있다.
