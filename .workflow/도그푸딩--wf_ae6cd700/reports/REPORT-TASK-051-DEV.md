# TASK-051 개발자 핸드오프

- 대상 작업: TASK-051 (실행 한도에 제한 없음 상태를 도입하고 데몬이 한도로 인정하지 않는 값을 저장에서 막는다)
- 근거 문서: SPEC-017 R2·R3·R4와 R5의 저장 몫, DECISION-EC07DE7E (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T09:45Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 사용자가 병렬 작업을 승인했고 이 세션은 TASK-051 하나만 배정받았다. 다른 `todo`는 고르지 않았다.
- `migration.lock` 없음. 착수 시점(09:21Z) `.workflow/.runtime/leases/`에는 `SPEC-009.yml`과
  `SPEC-018.yml`만 있었고 TASK-051을 덮는 lease는 없었다.
- `depends_on: [TASK-028]`이고 TASK-028은 `qa_waiting`이라 의존성이 충족된다(developer 역할 계약
  "충족된 의존성").
- `.workflow/rules/wf-claim.sh`가 아직 없어 공통 규칙 §4의 미설치 폴백대로 `set -C`로 lease를
  배타 생성했다.

## 결정과 근거

### 1. 한도 값의 두 상태를 `MaxPer`로 표현하고 렌더에서 줄을 뺀다

`heartbeat_jobs.rs`에 `MaxPer { Unlimited, Limit(String) }`을 두고 `ManagedJob.max_per`의 타입을
`String`에서 이것으로 바꿨다. `render_block`은 `Limit`일 때만 `- max_per:` 줄을 쓴다. 나머지
여덟 줄의 내용과 순서는 그대로다.

`max_per: none` 같은 새 표기를 만들지 않은 이유는 기획서 R2 그대로다. 그 값은 데몬에서 형식
위반으로 떨어져 결과가 같지만, 파일만 보는 사람에게는 한도가 있는 것처럼 읽힌다.

### 2. 거부 사유를 `Format`·`Ignored` 둘로 나눈다

`check_quota(&str) -> Result<Quota, QuotaRejection>`를 판정의 유일한 자리로 두고, `parse_quota`는
`check_quota(value).ok()`로 남겼다. 호출처(`job_quota`)의 뜻이 "데몬이 한도로 인정하는가"이므로
이름과 반환값을 바꾸지 않는 편이 읽기 쉽다.

판정 순서는 기획서대로다. 형식을 먼저 보고, 통과한 뒤 횟수가 0이거나 기간이 0초면 `Ignored`다.
`4/0h`는 `parse_duration("0h")`이 `Some(0)`이라 형식은 맞으므로 `Format`이 아니라 `Ignored`다.

`Ignored` 문구는 작업 문서가 정한 문장을 그대로 상수(`QUOTA_IGNORED_MESSAGE`)로 뒀다. TASK-053이
화면 검증에 옮길 때 이 상수를 기준으로 삼으면 된다.

`validate_job`은 이제 `is_quota` 대신 `check_quota`를 직접 부른다. 이 변경으로 쓰이지 않게 된
`is_quota`만 지웠다. `parse_duration`·`is_duration`은 건드리지 않았다 — 그 함수는 `interval`·
`timeout` 검증도 겸하고 두 필드의 "없음" 표현은 이 기획서의 제외 범위다.

### 3. 기본값 정의를 `JobDefaults` 쪽으로 뒤집었다

`RoleJobSettings.max_per`·`DreamJobSettings.max_per`가 `MaxPer`가 되면 그 설정에서
`JobDefaults`(화면 payload, `max_per: String`)를 만드는 기존 방향으로는 `Unlimited`를 문자열로
바꿀 수 없는 자리가 생긴다. 앱 기본값은 언제나 한도가 있는 값이므로(R1) 정의를 `JobDefaults`에
두고 설정을 그것에서 만든다.

- `HeartbeatRole::default_settings()`·`heartbeat_dream::default_settings()`의 반환 타입이
  `JobDefaults`가 됐다. 값 자체는 지금과 같다.
- `From<RoleJobSettings> for JobDefaults`·`From<DreamJobSettings> for JobDefaults`를 지우고
  반대 방향(`From<JobDefaults> for RoleJobSettings`·`for DreamJobSettings`)을 뒀다.
- `heartbeat_service.rs`의 `From<RoleJobSettings> for JobSettings`·`From<DreamJobSettings> for
  JobSettings` 둘을 `From<JobDefaults> for JobSettings` 하나로 대신했다. 두 impl이 쓰이던 자리가
  전부 "기본값을 병합 기준으로 만드는" 곳이었다.
- 역방향(`From<JobSettings> for RoleJobSettings`·`for DreamJobSettings`)은 그대로 두고 `max_per`가
  `MaxPer`를 그대로 옮긴다.

`JobDefaults`의 필드 구성과 화면에 내려가는 payload는 바뀌지 않았다(완료 조건 9).

### 4. 저장 요청에 세 번째 상태를 줬다

    #[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    pub enum MaxPerRequest {
        Unlimited,
        Limit { value: String },
    }

`RoleJobRequest.max_per`·`DreamJobRequest.max_per`가 `Option<MaxPerRequest>`가 됐다. JSON으로는
`null`, `{"kind":"unlimited"}`, `{"kind":"limit","value":"4/24h"}` 셋이다. 표기는 `JobQuota`가
이미 쓰는 `#[serde(tag = "kind")]`와 같은 결이다.

두 필드(`maxPer`·`maxPerUnlimited`)로 나누지 않았다. `("4/24h", true)`처럼 뜻이 충돌하는 조합이
계약에 생기고 그 우선순위 규칙이 코드 두 곳에 흩어진다.

`PartialSettings.max_per`는 `Option<MaxPer>`다. `None`이 "지정 안 함"이라는 뜻과 `over`의 규칙,
`specifies_nothing`은 그대로다.

### 5. 한도 줄이 없는 잡을 제한 없음으로 되읽는다

`block_role_settings`·`block_dream_settings`가 함께 쓰는 `block_max_per` 하나를 뒀다. 잡이 블록에
**있으면** `max_per`는 언제나 `Some(...)`이다 — 줄이 있으면 `Some(Limit(값))`, 줄이 없으면
`Some(Unlimited)`다. 잡이 블록에 **없으면** 지금처럼 `PartialSettings::default()`라 `None`이다.

여기가 R3의 핵심이고 줄이 되살아나던 원인이다. `interval`·`model`·`timeout`은 그대로 뒀다.

`ManagedRoleJob`·`ManagedDreamJob`의 `max_per: Option<String>`은 바꾸지 않았다. 그 값은 파일을
그대로 옮긴 것이고 기준값 대조(TASK-017)가 이 값을 그대로 비교하므로 규칙이 달라지지 않는다.

### 6. 화면은 요청을 조립하는 자리만 고쳤다

`types.ts`에 `MaxPerRequestValue`를 더하고 두 요청 타입의 `maxPer`를 `MaxPerRequestValue | null`로
바꿨다. 카드에서 고친 곳은 네 자리다.

- `HeartbeatCard.requestOf`·`DreamCard.request` — 지정된 필드면 `{ kind: "limit", value }`,
  아니면 `null`.
- `HeartbeatCard.resetRequestOf`·`DreamCard.resetRequest` — `{ kind: "limit", value: 기본값 }`.
  재설정은 앱 기본값으로 되돌리는 것이고 기본값은 언제나 한도 값이다.

폼 상태·검증·표시는 건드리지 않았다. 이 작업에서 `unlimited`를 만들어 보내는 경로는 아직 없다.

## 변경 파일

백엔드

- `src-tauri/src/infrastructure/heartbeat_jobs.rs` — `MaxPer`, `QuotaRejection`, `check_quota`,
  `ManagedJob.max_per` 타입, `render_block`, `validate_job`, `is_quota` 제거, 테스트
- `src-tauri/src/infrastructure/heartbeat_roles.rs` — `RoleJobSettings.max_per` 타입,
  `default_settings` 반환 타입, `From` 방향 전환, 테스트 픽스처
- `src-tauri/src/infrastructure/heartbeat_dream.rs` — 위와 같은 몫
- `src-tauri/src/infrastructure/heartbeat_status.rs` — `defaults` 배선 한 줄
- `src-tauri/src/application/heartbeat_service.rs` — `MaxPerRequest`, `PartialSettings`·
  `JobSettings`, `block_max_per`, 요청 병합, 테스트

프런트엔드

- `src/features/projects/domain/types.ts` — `MaxPerRequestValue` 추가, 두 요청 타입의 `maxPer`
- `src/features/projects/components/integrations/HeartbeatCard.tsx` — `requestOf`·`resetRequestOf`
- `src/features/projects/components/integrations/DreamCard.tsx` — `request`·`resetRequest`
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 요청 payload 단정 3곳
- `src/features/projects/components/integrations/DreamCard.test.tsx` — 요청 payload 단정 2곳
- `src/features/projects/application/useProjectWorkspace.test.ts` — 요청 payload 단정 3곳
  (작업 문서 범위 절에 없던 파일이다. 아래 "범위에서 벗어난 변경" 참고)

## 갱신한 기존 테스트

삭제하거나 비활성화한 테스트는 없다. 기획서가 뒤집는 동작을 단정하던 둘만 새 사실로 고쳤다.

1. `heartbeat_jobs::tests::a_quota_carries_the_count_the_window_seconds_and_the_window_text`
   — `parse_quota("0/30m")`이 `Some`이라는 단정을 경계값 `parse_quota("1/1s")`로 바꿨다.
   `0/30m` 계열은 새로 만든 `a_quota_the_daemon_ignores_has_no_value_either`가 덮는다.
2. `heartbeat_service::tests::a_zero_limit_is_exhausted_without_a_recovery_time`
   → `a_limit_the_daemon_ignores_is_reported_as_unlimited_and_not_as_exhausted`.
   `0/24h`가 `Counted { exhausted: true }`로 나가던 것이 `Unlimited`로 바뀐다. 기획서 R5가
   요구하는 방향이고(확인 사실 7·8), SPEC-009 화면이 사실과 정반대를 말하던 상태의 원인이다.
   `4/0h`도 같은 자리에서 함께 확인한다.

`parse_quota`가 `job_quota`의 판정 근거이므로 이 변화는 R4를 구현하면 따라 나온다. "사용자가 고른
제한 없음"과 "값이 어긋나 무제한"을 화면에서 나누는 몫은 TASK-052가 이어받는다.

## 추가한 테스트 (12개)

`heartbeat_jobs.rs` (4)

- `a_quota_the_daemon_ignores_has_no_value_either` — `0/24h`·`0/1s`·`4/0h`·`4/0m`
- `the_rejection_reason_separates_a_broken_format_from_an_ignored_value` — 위 넷은 `Ignored`,
  `4번`·`4/24`·`/24h`·`여섯/24h`는 `Format` (완료 조건 7)
- `an_unlimited_job_is_written_without_the_quota_line` — 한도 줄이 없고 나머지 여덟 줄은 같다.
  렌더 결과를 `Limit`일 때와 바이트로 대조하고, 되읽었을 때 `max_per` 필드가 없음까지 본다
  (완료 조건 2·3)
- `an_ignored_quota_is_rejected_with_a_message_naming_both_escape_routes` — 거부 문구에
  "제한 없이 실행됩니다"·"잡을 끄고"·"제한 없음으로 지정"이 모두 있고 파일이 만들어지지 않는다
  (완료 조건 8)

`heartbeat_service.rs` install_tests (8)

- `saving_a_role_job_as_unlimited_removes_only_its_quota_line` — 저장 전후 블록을 대조해 한도 줄
  하나 말고는 차이가 없음을 확인한다 (완료 조건 1·2·3)
- `saving_the_dream_job_as_unlimited_removes_only_its_quota_line` — dream 쪽 짝 (완료 조건 2)
- `a_job_without_a_quota_line_does_not_get_one_back_from_a_save` — 네 필드 모두 미지정 요청
  (완료 조건 4)
- `saving_another_field_keeps_the_quota_line_absent` — `model`만 지정. 같은 저장에서 보존 잡
  둘의 한도 줄도 되살아나지 않는다 (완료 조건 5)
- `specifying_a_limit_brings_the_quota_line_back` — 되돌아갈 길이 있어야 한다
- `a_quota_the_daemon_ignores_is_rejected_without_writing_the_file` — 그 잡 자신을 지정한 경우
  (완료 조건 6)
- `an_ignored_quota_already_in_the_file_stops_a_save_that_does_not_specify_it` — 그 잡을 지정하지
  않아도 `PreservedJob`으로 막히고 파일이 바뀌지 않는다 (완료 조건 8, 기획서 확인 필요 3번)
- `resetting_an_unlimited_job_writes_the_app_default_quota_again` — 재설정은 앱 기본값으로
  되돌린다 (완료 조건 9, 기존 SPEC-005 동작)

## 검증

작업 문서의 검증 절차 그대로 돌렸다.

    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
    cargo test --manifest-path src-tauri/Cargo.toml
    npm run check

검증 수치 (2026-08-03T09:52Z)

- `cargo test` — 293 passed / 0 failed. 이 세션이 12개를 더했다. 총계에는 같은 트리에서 병렬로
  진행 중인 다른 작업의 테스트도 포함된다. 이 세션의 변경만 있던 시점의 수치는 251 → 263이었다.
- `npm run check` — 266 passed / 0 failed, `tsc -b`와 `vite build`까지 통과.
- `cargo fmt --check` — 이 세션이 만진 다섯 파일 전부 통과(`rustfmt --check`로 파일별 확인).
  크레이트 전체로는 다른 세션의 작업 중 파일 둘(`heartbeat_condition.rs`·`managed_script.rs`)에
  차이가 남아 있다.
- `cargo clippy --all-targets -D warnings` — 이 세션이 만진 파일에는 지적이 없다. 크레이트
  전체로는 다른 세션의 `managed_script.rs`가 `dead_code` 둘로 막혀 있어 명령 자체는 실패한다.

검증은 전부 `tempfile::tempdir()` 픽스처만 쓴다. 실제 `~/.claude/HEARTBEAT.md`를 읽거나 쓰는
자동화 검증이 없으므로 백업·원복 대상이 없었다.

## 리스크와 후속

1. **폼 시딩은 아직 앱 기본값을 보여준다.** 한도 줄이 없는 잡을 열면 폼에 앱 기본값이 뜬다
   (`installed?.maxPer ?? defaults.maxPer`). 그 칸을 건드리지 않으면 요청에 `null`이 실려 파일
   상태는 보존되지만, 화면이 파일과 다른 값을 보여주는 상태는 남는다. TASK-053의 몫이고 작업
   문서가 이 사실을 QA 범위로 명시했다.

2. **`jobValueMemoryStore`가 제한 없음을 기억하지 못한다.** 끄는 잡의 값을 기억할 때
   `maxPer: installedJob.maxPer ?? undefined`라 한도 줄이 없던 잡은 `maxPer`를 기억하지 않는다.
   그 잡을 껐다 켜면 그 필드가 미지정이 되고, 잡이 블록에서 빠진 상태이므로 병합이 앱 기본값을
   채워 한도 줄이 생긴다. 이 작업의 범위 절이 `jobValueMemoryStore.ts`를 명시적으로 제외했고,
   저장소 값의 모양을 바꾸는 일은 폼 상태 표현이 정해진 뒤라야 한다. 승인 결정(DECISION-EC07DE7E)
   이 아키텍트에게 남긴 유의사항의 뒷부분이 여기다. **TASK-053·TASK-054에서 함께 판단할 항목으로
   넘긴다.**

3. **화면 검증은 아직 `0/24h`를 통과시킨다.** `fieldRules.maxPer`의 `/^\d+\/\d+[smhd]$/`가 0을
   받는다. 지금은 백엔드가 거부하므로 파일은 안전하지만, 사용자에게는 화면 검증이 아니라 저장
   실패로 뜬다. 작업 문서가 이 상태를 QA 범위로 명시했고 TASK-053이 앞쪽 방어선을 세운다.

4. **`Ignored` 문구가 두 곳에 생길 예정이다.** 지금은 `heartbeat_jobs.rs`의
   `QUOTA_IGNORED_MESSAGE` 하나뿐이다. TASK-053이 화면 검증에 옮길 때 글자까지 같아야 한다.
   두 곳이 갈리면 사용자는 같은 거부에 대해 다른 설명을 듣는다.

## 범위에서 벗어난 변경

`src/features/projects/application/useProjectWorkspace.test.ts`가 작업 문서의 범위 절에 없지만
세 자리를 고쳤다. 이 파일이 게이트웨이에 넘어가는 `RoleJobRequest`·`DreamJobRequest` payload를
그대로 단정하고 있어서, 요청 계약의 `maxPer` 타입이 바뀌면 타입 검사(`tsc -b`)에서 실패한다.
단정하던 사실(어느 필드를 지정으로 보냈는가)은 줄이지 않고 값의 모양만 새 계약으로 옮겼다.

## 병렬 작업에서 관찰한 사실 (내 변경 아님)

검증 중에 같은 작업 트리의 다른 세션이 만든 중간 상태를 지나쳤다. 기록만 남긴다.

- `src-tauri/src/infrastructure/claim_helper.rs`가 `cargo fmt --check`에 걸린다(267행). 내 변경이
  아니라 그 파일을 만드는 세션의 몫이라 손대지 않았다. 크레이트 전체를 `cargo fmt`로 포매팅하면
  그 세션의 작업 중 파일을 건드리게 되므로 내 파일 둘만 손으로 맞췄다.
- `heartbeat_condition.rs`가 아직 없는 `infrastructure::managed_script` 모듈을 import하는 중간
  상태를 지나갔다(dev-040 진행 중). 그 상태에서는 크레이트가 컴파일되지 않는다.
- `HeartbeatCard.tsx`·`DreamCard.tsx`의 `skipped` 표시 문구가 바뀌는 중간 상태에서
  `IntegrationsView.test.tsx`·`DreamCard.test.tsx`가 잠깐 실패했다. 그 세션이 테스트를 맞추면서
  해소됐다.

## 사용자 QA 항목

작업 문서의 항목 그대로다. 자동화 테스트가 저장 결과 문서까지 확인하므로 아래는 실제 앱 창이
필요한 것만이다.

- 잡 하나의 한도 칸에 `0/24h`를 넣고 저장을 눌렀을 때 거부 문구가 뜨고 `~/.claude/HEARTBEAT.md`가
  바뀌지 않는지. 이 단계에서는 화면 검증이 아니라 백엔드 오류로 뜬다.
- 손으로 한도 줄을 지운 잡이 있는 상태에서 다른 값을 저장했을 때 그 줄이 되살아나지 않는지.
