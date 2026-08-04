# TASK-052 개발자 핸드오프

- 대상 작업: TASK-052 (사용량 payload가 고른 무제한과 값이 어긋나 생긴 무제한을 구분한다)
- 근거 문서: SPEC-017 R5의 표시 몫과 R6, DECISION-EC07DE7E (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T09:56Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 사용자가 병렬 작업을 승인했고 이 세션은 TASK-052 하나만 배정받았다. 다른 `todo`는 고르지 않았다.
- `migration.lock` 없음. 착수 시점(09:42Z) `.workflow/.runtime/leases/`에는 `SPEC-009.yml`·
  `TASK-039.yml`·`TASK-042.yml`만 있었고 TASK-052를 덮는 lease는 없었다.
- `depends_on: [TASK-051]`이고 TASK-051은 `qa_waiting`이라 의존성이 충족된다. 그 작업에서
  `parse_quota`가 `0/24h`·`4/0h`를 거부하게 됐고, 블록에 있고 줄만 없는 잡을 제한 없음으로 읽는
  규칙도 그 작업이 만들었다. 이 작업의 판정이 그 위에 선다.
- `.workflow/rules/wf-claim.sh`가 아직 없어 공통 규칙 §4의 미설치 폴백대로 `set -C`로 lease를
  배타 생성했다.

## 결정과 근거

### 1. 세 무제한을 두 값으로 나눴다

지금까지 `JobQuota::Unlimited { value }` 하나가 "형식이 깨져 데몬이 한도 없이 다룬다"는 이상
신호였다. 여기에 사용자가 고른 제한 없음이 더해지면 두 상태가 같은 낱말을 쓰게 된다(기획서 확인
사실 8번).

    pub enum JobQuota {
        Unknown,
        /// 사용자가 고른 제한 없음. 그 잡이 블록에 있고 `max_per` 줄이 없다. 정상 상태다.
        Unlimited,
        /// 값이 있으나 데몬이 한도로 인정하지 않아 결과가 무제한이다. 손볼 곳이라는 신호다.
        IgnoredLimit { value: String },
        NoRuns { limit, window },
        Counted { .. },
    }

`Unlimited`는 값을 담지 않는 단위 변형이 됐다. 보여줄 원문이 없다 — 파일에 그 줄 자체가 없다.
기존 `Unlimited { value }`가 하던 일은 `IgnoredLimit { value }`가 그대로 받는다.

이름을 옮긴 이유는 작업 문서가 적은 그대로다. 기존 이름을 남기고 새 상태에 다른 이름을 주면
코드에서 "unlimited"가 이상 신호를 뜻하고 화면에서는 정상 상태를 뜻하는 어긋남이 남는다.

### 2. 판정 입력을 두 겹으로 받는다

`job_quota`가 받던 `Option<&str>` 하나로는 "그 잡이 블록에 없다"와 "블록에 있는데 한도 줄이 없다"를
구분할 수 없었다. 두 겹으로 바꿨다.

    fn job_quota(max_per: Option<Option<&str>>, recent: Option<Vec<f64>>, now: DateTime<Utc>) -> JobQuota

바깥은 그 잡이 관리 블록에 있는가, 안쪽은 그 잡에 `max_per` 줄이 있는가다. 판정 순서는 넷이다.

1. 바깥이 `None`이면 `Unknown`. 관리 블록을 읽지 못한 조회에서 이 값이 그대로 나간다(SPEC-009 R5).
2. 안쪽이 `None`이면 `Unlimited`. **`recent`를 보지 않는다.**
3. `parse_quota`가 `None`이면 `IgnoredLimit { value }`. TASK-051 이후 이 갈래에 형식 위반뿐 아니라
   0 이하 횟수와 0 기간이 함께 들어온다.
4. 그 밖은 지금과 같다. `recent`가 없으면 `NoRuns`, 있으면 창 안 항목을 세어 `Counted`.

배선은 호출처에서 한 겹을 덜 접는 것뿐이다. 역할 잡은 `.and_then(|job| job.max_per.as_deref())`가
`.map(...)`이 됐고 dream 잡도 같다. 그 `and_then`이 두 상태를 접고 있던 자리다.

### 3. 제한 없음에서 무엇을 하지 않는가 (R6)

코드로는 2절의 2번에서 이미 결정되지만 근거를 남긴다.

- **소진 판정을 하지 않는다.** 막을 한도가 없으므로 그 잡이 대기 물량 때문에 멈춰 있을 수 없다.
- **한도 경고를 띄우지 않는다.** 경고는 `Counted` + `exhausted` + 대기 물량의 조합이다.
- **사용 횟수를 표시하지 않는다.** 데몬은 무제한 잡의 실행을 `recent_runs`에 기록하지 않는다
  (기획서 확인 사실 3번). 파일에 남은 값은 한도가 있던 시절의 이력이고, 그것을 사용량으로 보여주면
  늘지 않는 숫자가 화면에 굳는다. `IgnoredLimit`도 같은 이유로 숫자를 보여주지 않는다.
- **마지막 실행 기록 표시는 그대로 둔다.** 그 값은 `last_run`에서 오고 한도와 무관하다. 이 작업은
  `last_run` 경로를 건드리지 않았다.

`quotaWarned`와 `JobQuotaLine`의 판정 조건(`kind === "counted"`)은 손대지 않았다. 두 새 상태가
경고와 회복 시각 표시에서 빠지는 것은 그 조건 덕분이고, 그 사실을 테스트로 고정했다.

### 4. 화면 문구

두 카드의 `quotaUsageLabel`에 갈래를 더했다. 글자는 두 파일이 같다.

- `unlimited` — `제한 없음 — 실행 횟수 제한 없이 주기마다 실행됩니다.`
  숫자도 `max_per`라는 낱말도 없다. 정상 상태로 읽혀야 한다.
- `ignoredLimit` — `한도 없음 — max_per 값 "0/24h"을 하트비트가 한도로 인정하지 않아 이 잡이 제한
  없이 실행됩니다. 값을 고치기 전에는 이 잡을 저장할 수 없습니다.`

기존 문구는 "형식이 올바르지 않아"라고 단정했는데 `0/24h`는 형식이 맞으므로 그 말이 틀린다. 데몬이
한도로 인정하지 않는다는 사실로 바꿨고, 고쳐야 저장된다는 사실(TASK-051이 세운 저장 거부)을 함께
밝힌다.

## 변경 파일

백엔드

- `src-tauri/src/domain/project.rs` — `JobQuota`의 `Unlimited`를 단위 변형으로 바꾸고
  `IgnoredLimit { value }`를 더했다
- `src-tauri/src/application/heartbeat_service.rs` — `job_quota` 시그니처와 판정, 역할 잡·dream 잡
  두 배선, 테스트

프런트엔드

- `src/features/projects/domain/types.ts` — `JobQuota` 유니온
- `src/features/projects/components/integrations/HeartbeatCard.tsx` — `quotaUsageLabel` 두 갈래
- `src/features/projects/components/integrations/DreamCard.tsx` — 같은 몫
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 표시 테스트
- `src/features/projects/components/integrations/DreamCard.test.tsx` — 같은 몫

작업 문서의 범위 절 그대로다. 범위를 벗어난 파일은 없다.

## 갱신한 기존 테스트

삭제하거나 비활성화한 테스트는 없다. 이름이 뜻과 어긋나게 된 셋만 고쳤다.

1. `a_limit_the_daemon_ignores_is_reported_as_unlimited_and_not_as_exhausted`
   → `a_limit_the_daemon_ignores_is_reported_as_an_ignored_limit_with_its_original_text`.
   TASK-051이 이 테스트를 `Unlimited { value }`로 만들어 뒀는데, 그 변형이 이제 사용자가 고른
   상태를 뜻하므로 `IgnoredLimit`으로 옮겼다. `4번`(형식 위반)을 같은 갈래로 함께 확인한다.
2. `an_unknown_limit_a_malformed_limit_and_a_missing_record_are_three_values`
   → `an_unknown_limit_two_kinds_of_unlimited_and_a_missing_record_are_four_values`.
   무제한 둘이 갈리는 것이 이 작업이 더한 구분이라 그 값을 단정에 넣었다.
3. `a_malformed_limit_is_reported_as_unlimited_without_an_exhaustion_verdict`
   → `..._as_an_ignored_limit_...`. 조회 경로에서 같은 이름 정리다.

직렬화 테스트(`the_quota_serializes_with_camel_case_keys`)는 `unlimited`가 `{"kind":"unlimited"}`
하나로 줄어든 것과 `{"kind":"ignoredLimit","value":"6/24"}`가 새로 나가는 것을 함께 못 박는다.

프런트엔드에서는 "malformed max_per" 픽스처 둘의 `kind`를 `ignoredLimit`으로 옮겼다. 단정하던
사실(한도 없음 문구가 보이고 경고가 없다)은 그대로다.

## 추가한 테스트 (11개)

Rust `heartbeat_service.rs` (5)

- `an_ignored_limit_makes_no_exhaustion_verdict_even_with_runs_in_the_window` — 창 안 실행 기록이
  넷이어도 소진이 아니다. 이 픽스처가 지금까지 `Counted { exhausted: true }`를 만들던 자리다
- `a_job_without_a_quota_line_is_the_unlimited_the_user_chose` — 기록 없음·빈 배열·항목 있음 셋
  모두 `Unlimited`다 (완료 조건 3)
- `a_job_whose_quota_line_was_removed_reports_the_chosen_unlimited` — 조회 경로에서 역할 잡과
  dream 잡 모두 확인하고, 블록에 없는 두 역할이 여전히 `Unknown`이라 제한 없음과 섞이지 않음을
  함께 본다
- `the_chosen_unlimited_and_an_ignored_limit_leave_the_snapshot_as_different_values` — 한 화면에
  두 상태를 두고 `assert_ne!`로 대조한다 (완료 조건 1)
- `inspecting_a_document_with_an_ignored_limit_does_not_touch_it` — 어긋난 값(`4/0h`)을 둔 채
  조회를 세 번 거쳐도 내용과 수정 시각이 같다 (완료 조건 6)

프런트엔드 (6, 두 카드에 각 3)

- `shows the chosen unlimited without any usage count` — 숫자 표기가 없고(`/\d+\/\d+ ·/` 불일치),
  "한도 없음"이라는 낱말도 쓰지 않으며, 마지막 실행 기록은 그대로 보인다 (완료 조건 3·4)
- `raises no quota warning for the chosen unlimited even with pending work` — 대기 물량이 있어도
  경고가 없고 카드 접힘 요약에도 올라가지 않는다 (완료 조건 2)
- `words the chosen unlimited and an ignored limit differently` — 두 문구를 실제로 렌더해 대조하고,
  어긋난 값 쪽만 원문과 "저장할 수 없습니다"를 담으며 "형식이 올바르지 않아"라고 말하지 않는지
  확인한다 (완료 조건 1)

dream 카드도 같은 세 가지를 미정제 트랜스크립트 기준으로 확인한다.

완료 조건 7(조회가 여는 파일 수)은 기존 `carrying_the_quota_does_not_add_a_state_file_read`가 그대로
덮는다. 이 작업은 이미 손에 든 값의 겹을 하나 덜 접을 뿐이라 새로 여는 파일이 없어서, 테스트를
더하지 않고 기존 것이 통과하는지만 확인했다.

## 검증

작업 문서의 검증 절차 그대로 돌렸고 넷 다 통과했다.

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` — 통과 (크레이트 전체)
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — 통과
- `cargo test --manifest-path src-tauri/Cargo.toml` — 298 passed / 0 failed (293 → 298, +5)
- `npm run check` — 272 passed / 0 failed (266 → 272, +6), `tsc -b`·`vite build` 통과

TASK-051 때와 달리 이번에는 크레이트 전체 fmt·clippy가 깨끗하다. 병렬 세션의 작업 중 파일이
그 사이 정리됐다.

검증은 전부 `tempfile::tempdir()` 픽스처만 쓴다. 실제 `~/.claude/HEARTBEAT.md`를 읽거나 쓰는
자동화 검증이 없으므로 백업·원복 대상이 없었다.

## 리스크와 후속

1. **`ignoredLimit` 문구가 아직 일어나지 않은 일을 말한다.** "값을 고치기 전에는 이 잡을 저장할 수
   없습니다"는 TASK-051이 세운 백엔드 거부에 근거한 사실이다. 다만 지금은 화면 검증이 `0/24h`를
   통과시키므로 사용자는 저장을 눌러 본 뒤에야 그 거부를 만난다. 문구가 먼저 알려 주는 셈이라
   틀리지는 않지만, TASK-053이 화면 검증을 세워야 두 방어선이 같은 말을 하게 된다.

2. **폼은 아직 제한 없음을 시딩하지 않는다.** 한도 줄이 없는 잡의 사용량 줄은 이 작업 이후
   "제한 없음"으로 보이지만, 바로 위 편집 폼의 실행 한도 칸에는 앱 기본값이 채워져 있다. 한 잡에
   대해 두 줄이 다른 말을 하는 상태다. TASK-053이 폼 시딩을 고치면 해소된다. **QA에서 이
   불일치를 결함으로 보지 않도록 여기 적어 둔다.**

3. **`JobQuota`를 읽는 자리가 늘면 갈래를 빠뜨릴 수 있다.** 지금은 두 카드의 `quotaUsageLabel`이
   `switch`로 전부 다루고 TypeScript가 누락을 잡는다. Rust 쪽도 `match`가 강제한다. 새 소비자가
   생길 때 이 성질을 유지해야 한다.

4. **사용자 잡(관리 블록 밖)은 이 판정의 대상이 아니다.** 기획서 제외 범위 그대로다.

## 사용자 QA 항목

작업 문서의 항목 그대로다. 실제 앱 창과 손으로 만든 파일 상태가 필요하다.

- `~/.claude/HEARTBEAT.md`의 관리 블록에서 잡 하나의 `max_per` 줄을 지우고 앱을 열었을 때, 그 잡의
  사용량 줄이 "제한 없음 — 실행 횟수 제한 없이 주기마다 실행됩니다."로 보이고 경고가 없는지.
  (편집 폼의 실행 한도 칸에는 아직 앱 기본값이 보인다. 위 리스크 2번이다)
- 같은 잡의 `max_per`를 `0/24h`로 바꿨을 때 표시가 "한도 없음 —"으로 바뀌고, "항상 소진"과 한도
  경고가 사라지는지. 기획서 기대효과가 겨냥한 자리다.
- 두 상태의 문구가 서로 구분되는지.
