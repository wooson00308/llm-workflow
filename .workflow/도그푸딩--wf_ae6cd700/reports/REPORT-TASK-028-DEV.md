# TASK-028 개발자 핸드오프

- 대상 작업: TASK-028 (연동 잡의 실행 한도 사용량을 백엔드가 계산해 스냅샷에 싣는다)
- 근거 문서: SPEC-009 R1·R2·R5·R6, DECISION-85491D81 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T04:16Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-028·029·030·031(SPEC-009), TASK-032·033·034(SPEC-011),
  TASK-035·036(SPEC-012) 아홉 건이다.
- TASK-028은 선행 작업이 없다. TASK-030·031은 이 작업의 산출물(`JobQuota`)을 쓰므로 지금은 착수할 수
  없고, TASK-029는 이 작업과 병행 금지(`domain/project.rs` 공유)다. 문서 번호가 앞서는 TASK-028을
  골랐다. 한 세션은 한 건만 처리한다.
- `.workflow/.runtime/migration.lock` 없음. `leases/`에는 만료된 `SPEC-009.yml`
  (expires_at 2026-08-03T01:20Z, 아키텍트 세션)만 있었다. 내 lease가 아니라 손대지 않았다.
- 배타 생성(`set -o noclobber`)으로 `leases/TASK-028.yml`을 만든 뒤 문서를 `in_progress`로 옮기고
  시작했다.
- SPEC-009 본문은 `status: user_review`지만 앱이 기록한 승인 결정(DECISION-85491D81)이 있으므로 공통
  규칙 5절의 구현 차단 조건에 걸리지 않는다.

## 결과

연동 스냅샷이 역할 잡 3종과 dream 잡 각각에 대해 실행 한도 사용량을 싣는다. 화면은 건드리지 않았고
프런트엔드 타입도 그대로다. payload만 바뀌었으므로 지금 화면에는 아무 변화가 없다.

값은 `JobQuota` 하나로 나가고, 네 경우가 서로 다른 값이다.

| variant | 뜻 | 언제 |
| --- | --- | --- |
| `unknown` | 앱이 한도 값을 모른다 | 관리 블록을 못 읽었거나 그 잡이 블록에 없다 |
| `unlimited` | 하트비트가 한도 없는 잡으로 다룬다 | `max_per` 형식이 계약과 다르다 |
| `noRuns` | 한도는 알지만 실행 기록이 없다 | 상태 파일 없음·깨짐·잡 키 없음·`recent_runs` 없음 |
| `counted` | 사용량을 셌다 | 위 셋이 아닌 모든 경우. 빈 배열도 여기(0회) |

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/infrastructure/heartbeat_jobs.rs` | `Quota` 타입, `parse_duration`·`parse_quota` 공개, `is_duration`·`is_quota`를 그 위에 재작성, 테스트 7건 |
| `src-tauri/src/infrastructure/heartbeat_status.rs` | `JobRuns::recent_runs`, `HeartbeatRead.runs`, 역할 상태의 `quota: Unknown`, 테스트 4건 + 기존 픽스처 1건에 `recent_runs` 추가 |
| `src-tauri/src/domain/project.rs` | `JobQuota` enum, `HeartbeatRoleStatus.quota` |
| `src-tauri/src/application/heartbeat_service.rs` | `job_quota`·`recovery_time`, 역할·dream 배선, `DreamIntegration.quota`, 테스트 11건 |
| `.workflow/…/tasks/TASK-028.md` | `todo` → `in_progress` → `qa_waiting` |
| `.workflow/…/reports/REPORT-TASK-028-DEV.md` | 신규 |
| `.workflow/.runtime/leases/TASK-028.yml` | 선점 후 반납 |
| `docs/development-logs/2026-08-03.md` | 세션 항목 1개 추가 |

작업 문서의 범위 목록 밖은 손대지 않았다. `src/features/projects/domain/types.ts`를 포함한 프런트엔드
전체, 대기 물량 판정(R3), 하트비트 저장소 쪽은 무변경이다.

## 설계 판단

- **`state.json`을 합쳐 읽지 않았다.** 작업 문서가 지시한 대로 각 경로가 이미 연 결과에서 필드 하나를
  더 꺼내는 방식이다. `read_heartbeat_status`는 지역 변수로 쓰고 버리던 `JobRuns`를 `HeartbeatRead.runs`에
  실어 돌려주고, `dream_integration`은 자기 몫으로 부르던 `read_job_runs` 결과를 `last_run`과
  `recent_runs` 양쪽에 쓴다. 호출 지점 수는 그대로다(진단: `git diff`에 `read_job_runs` 호출 추가 없음).
  두 읽기를 합치면 SPEC-003이 남긴 "어느 카드의 값이 비었는지" 구분이 사라진다.
- **파서를 값 반환형으로 만들고 검증을 그 위에 얹었다.** `is_duration`·`is_quota`가
  `parse_*(value).is_some()` 한 줄이 되어 같은 규칙이 두 곳에 적히지 않는다. `parse_duration`은
  `strip_suffix(char)`를 써서 기존 구현과 같은 방식으로 단위 문자를 뗀다 — 바이트 인덱스로 자르면
  `30분` 같은 값에서 문자 경계를 깨뜨린다.
- **파서 도입으로 좁아진 입력이 하나 있다.** 숫자부가 `u64`를 넘거나 곱셈이 넘치는 값
  (`99999999999999999999s`, `9999999999999999d`)은 전에는 형식만 맞으면 통과했고 이제 거부된다.
  작업 문서가 `checked_mul`과 `None`을 명시했고, 초로 표현할 수 없는 값은 사용량 계산의 근거가 될 수
  없으므로 그대로 따랐다. 기존 테스트 중 이 구간에 걸리는 것은 없다. 거부 문구(`InvalidValue`)는
  글자 그대로 유지되며 테스트로 못 박았다.
- **`recovers_at`은 소진일 때만 채운다.** 근거는 창 안 가장 오래된 실행 시각 + 창 길이다. 창 안 항목이
  하나도 없는 경우(`limit`이 0인 잡)는 근거가 없으므로 `None`이다. epoch 초의 소수부는 나노초로
  살려 넘기고, `DateTime::from_timestamp`가 표현할 수 없는 값이면 `None`으로 둔다.
- **판정할 수 없는 타임스탬프를 창 밖으로 본다.** `is_finite()`가 아닌 값은 버린다. 유한하지만 아주 먼
  미래인 값은 하트비트와 같은 부등호(`지금 − t < 창 길이`)에서 창 안으로 계산되는데, 이 쪽을 택했다.
  화면에 보이는 수가 데몬이 실제로 쓰는 수와 같아야 한다는 것이 R5의 요지이기 때문이다. 그 값이
  가장 오래된 항목이 되면 `recovers_at`은 `from_timestamp` 실패로 `None`이 된다.
- **기준 시각을 `inspect`에서 한 번만 구한다.** `Utc::now()`를 두 연동에 같은 값으로 넘긴다. 잡마다 다시
  구하면 한 화면 안에서 창의 기준이 어긋난다.
- **`job_quota`는 관리 블록 읽기 실패에 분기를 만들지 않는다.** 그 경로에서는 `managed_role_jobs`·
  `managed_dream_job`이 빈 값을 돌려주므로 `max_per`가 `None`이 되고 결과가 자연히 `Unknown`이다.
- **직렬화는 variant마다 `rename_all`을 붙였다.** enum-level `rename_all`은 variant 이름만 바꾸므로,
  필드가 있는 variant에 따로 붙여야 `recoversAt`이 나온다. 결과 JSON 키 6개를 테스트로 고정했다.

## 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | 역할 잡 3종·dream의 사용량·한도·창 길이가 스냅샷에 실린다 | 충족. `the_dream_job_reports_its_quota_with_the_same_rule`(역할·dream 동시 단언), `the_limit_comes_from_the_managed_block_and_not_from_the_app_defaults` |
| 2 | 사용 횟수가 창 안 항목만 센 값 | 충족. `the_used_count_is_the_number_of_timestamps_inside_the_window` — 4개 배열에서 `used: 2`. 경계값 2개(정확히 86400초 전 = 창 밖, 86399초 전 = 창 안)로 `<` 부등호를 못 박았다 |
| 3 | 한도가 관리 블록의 값 | 충족. 블록에 `24/24h`(앱 기본값 `6/24h`)를 두고 `limit: 24` 단언 |
| 4 | 소진에 `exhausted`·`recoversAt`이 함께, 시각이 창 안 최고령 + 창 길이 | 충족. `an_exhausted_quota_recovers_one_window_after_its_oldest_run_in_the_window` — 픽스처의 최고령 값 + 86400을 직접 계산해 대조 |
| 5 | 상태 파일 없음·깨짐·기록 없음이 `noRuns` | 충족. `a_missing_broken_or_absent_record_reports_no_runs_and_not_zero` 세 경우 + `an_unknown_limit_…_are_three_values`가 빈 배열은 `counted 0`임을 함께 고정 |
| 6 | 관리 블록을 못 읽으면 전부 `unknown` | 충족. `an_unreadable_managed_block_leaves_every_quota_unknown`(unix 한정) — 역할 3종 + dream. `recent_runs`가 있는 상태 파일을 함께 둬서 "기록이 있어도 한도를 모르면 세지 않는다"를 확인 |
| 7 | 깨진 `max_per`가 `unlimited`, 소진 판정 없음 | 충족. `a_malformed_limit_is_reported_as_unlimited_without_an_exhaustion_verdict` — `6/24`에 기록 3건을 둬도 `Unlimited`만 나온다 |
| 8 | 사용 횟수 > 한도도 오류 없이 소진 | 충족. `a_used_count_above_the_limit_is_exhausted_and_not_an_error` — `2/24h`에 5건 |
| 9 | 조회가 하트비트 홈 아래 파일을 바꾸지 않는다 | 충족. 기존 `reading_the_status_does_not_touch_the_heartbeat_home` 픽스처에 `recent_runs`를 더한 뒤에도 통과 |
| 10 | `state.json` 읽기 시도가 연동별 1회, 합 2회로 이전과 같다 | 충족. `carrying_the_quota_does_not_add_a_state_file_read` — 상태 파일 자리를 디렉터리로 만들어 읽기를 실패시키면 `heartbeat.readFailures`·`dream.readFailures`에 각각 정확히 1건. diff에 `read_job_runs` 호출 추가 없음 |
| 11 | 기존 Rust 테스트가 수정 없이 통과, 삭제·비활성화 없음 | 충족. 163건 → 174건, 실패 0. 기존 테스트의 단언은 하나도 바꾸지 않았다. 픽스처 문자열 1곳(`reading_the_status_does_not_touch_the_heartbeat_home`)에 `recent_runs`를 더한 것이 전부이며 작업 문서가 지시한 항목이다 |
| 12 | `cargo fmt --check`·`clippy -D warnings`·`cargo test`·`npm run check` 통과 | 충족. 아래 |

## 검증 단계와 결과

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check   # 통과
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings   # 경고 0
cargo test --manifest-path src-tauri/Cargo.toml   # 174 passed / 0 failed
npm run check   # tsc + vitest 191 passed / 13 files + vite build 성공
```

- Rust 테스트 151건 → 174건(+23). 삭제하거나 비활성화한 테스트 없음. 내역:
  `heartbeat_jobs` +7, `heartbeat_status` +4, `heartbeat_service` +12(그중 1건은 unix 한정).
- 실물 대조: 이 저장소의 `~/.claude/heartbeat/state.json`에서 개발자 잡 `recent_runs`는 21건이고 전부
  24h 창 안이며, `~/.claude/HEARTBEAT.md`의 `max_per`는 `16/24h`·`10/24h`·`26/24h`다. 즉 개발자 잡은
  `21/26 · 24h`, 미소진으로 나간다. 읽기만 했고 아무것도 쓰지 않았다.
- 이 세션은 `~/.claude/` 아래 어떤 파일도 쓰지 않았다. 모든 테스트가 `tempdir()` 안에서만 돈다.

## 사용자 QA 절차

화면에는 아직 아무것도 보이지 않는다. TASK-030·031이 이 값을 그리기 전까지는 payload 확인이 유일한
검증 경로다.

1. `npm run tauri dev`로 앱을 띄우고 연동 화면을 연다. 카드 표시가 이전과 **똑같아야** 한다. 사용량
   문구가 어디에도 나타나면 안 된다(이 작업의 범위 밖).
2. 개발자 도구 콘솔에서 스냅샷을 직접 확인한다.
   ```js
   await window.__TAURI_INTERNALS__.invoke("inspect_integrations", { projectRoot: "<프로젝트 절대경로>" })
   ```
   (커맨드 이름·인자는 `src-tauri/src/interface/commands.rs`에서 확인한다.)
   - `heartbeat.roles[].quota`가 역할 3종 모두 있어야 한다.
   - 개발자 잡은 `{ kind: "counted", used: <21 근처>, limit: 26, window: "24h", exhausted: false }`
     형태여야 한다. `limit`이 앱 기본값 `6`이 아니라 파일 값 `26`인지 본다.
   - `dream.quota`도 같은 모양이어야 한다.
3. 한도를 낮춰 소진을 재현한다. 연동 화면의 개발자 잡 편집 폼에서 `max_per`를 `1/24h`로 저장한 뒤 다시
   스냅샷을 본다. `exhausted: true`와 `recoversAt`(RFC3339 UTC)이 함께 있어야 하고, 그 시각이
   "창 안 가장 오래된 실행 + 24시간"이어야 한다. **확인이 끝나면 원래 값으로 되돌린다.**
4. 값이 없는 경우를 본다. `~/.claude/heartbeat/state.json`을 잠깐 다른 이름으로 옮기고 화면을
   새로고침한 뒤 스냅샷을 본다. `quota.kind`가 `"noRuns"`여야 하고 `used: 0`이 나오면 안 된다.
   확인 후 파일 이름을 되돌린다.
5. 앱을 여러 번 새로고침한 뒤 `~/.claude` 아래 파일의 수정 시각이 그대로인지 본다.
   ```sh
   find ~/.claude -maxdepth 2 -newermt '-10 minutes' -not -path '*/projects/*'
   ```
   하트비트 데몬이 도는 중이면 데몬이 쓴 것과 구분해야 하므로, 확실히 하려면 데몬을 잠깐 멈추고
   확인한다.

3·4번은 자동화 테스트가 이미 픽스처로 덮고 있다. 실제 파일에서도 같은 결론이 나오는지 확인하는
절차다.

## 다음 작업자에게

- `JobQuota`는 `src-tauri/src/domain/project.rs`에 있다. TASK-030이 만들 프런트엔드 타입은 4-variant
  판별 유니온이고 판별자는 `kind`다. 키는 `kind`·`value`·`used`·`limit`·`window`·`exhausted`·`recoversAt`
  이며 `the_quota_serializes_with_camel_case_keys`가 이것을 못 박고 있다.
- `unknown`과 `noRuns`를 화면에서 합치면 안 된다. 전자는 "한도를 모른다"(사용량 표시 자체를 하지
  않는다), 후자는 "한도는 알지만 기록이 없다"(한도는 보여줄 수 있다)다. `counted { used: 0 }`은 또
  다른 값이고 이것만 "0회"다.
- `recoversAt`은 RFC3339 UTC 원문이다. `TaskEvent.at`과 같은 규칙이므로 화면이 로컬로 바꾼다. 카드가
  이미 쓰는 `HeartbeatJobRun.at`(타임존 없는 로컬 문자열, 해석 금지)과 성질이 다르니 같은 헬퍼를 쓰면
  안 된다.
- `window`는 파일에 적힌 기간 원문(`24h`)이다. 초를 다시 문자열로 만들 필요가 없다.
- TASK-029는 `domain/project.rs`를 이 작업과 공유한다. 이 작업은 `HeartbeatRoleStatus`에 필드 하나와
  `JobQuota` 타입을 더했을 뿐 `WorkflowItemSummary` 계열은 건드리지 않았으므로 충돌 지점은 파일 하나
  안의 서로 다른 구간이다.
- `parse_duration`·`parse_quota`는 `pub`이다. 다른 곳에서 기간·한도를 값으로 다뤄야 하면 다시 적지
  말고 이것을 쓴다.

## 후속 / 리스크

- **작업 문서의 참고 사실이 인용한 관리 블록 값이 바뀌었다.** 문서는 `8/24h`·`8/24h`·`24/24h`로 적고
  있는데 지금 파일은 `16/24h`·`10/24h`·`26/24h`다. 코드는 파일 값을 읽으므로 동작에는 영향이 없고,
  기획서 완료 조건 3번의 취지("앱 기본값과 다른 값이어야 한다")는 그대로 성립한다.
- **아주 먼 미래의 타임스탬프는 창 안으로 센다.** 하트비트와 같은 부등호를 쓰기로 한 결과다. 그런 값이
  파일에 들어가려면 데몬이 아닌 무언가가 상태 파일을 고쳐야 하고, 그 경우 `recoversAt`은 `None`이 되어
  화면에 시각이 뜨지 않는다.
- **`recovers_at`은 "그때 한 번 분의 여유가 생긴다"는 뜻이다.** 데몬이 멈춰 있거나 tick 주기 때문에
  실제 재개는 그보다 늦을 수 있다. R2가 "예상임을 표기에서 드러낸다"고 요구하므로 TASK-030·031의
  문구가 그것을 밝혀야 한다.
- **보관 상한 때문에 사용량이 실제보다 적게 보일 수 있다.** 하트비트가 기록 시점에 배열을
  `recent[-(count * 2):]`로 자르므로, 사용자가 한도를 크게 낮춘 직후에는 잘린 이력만큼 사용량이
  덜 세어진다(SPEC-009 확인 사실 6번). 앱이 손댈 수 있는 것이 아니다.
- 역할 밖 발견 (수정하지 않음):
  - `.workflow/.runtime/leases/SPEC-009.yml`이 만료된 채(expires_at 2026-08-03T01:20Z) 남아 있다.
    REPORT-TASK-027-DEV와 REPORT-SPEC-012-ARCH도 같은 것을 지적했다. 아키텍트 세션이 반납하지 않은
    것으로 보이고, 내 lease가 아니라 손대지 않았다.
  - `tasks/TASK-022.md` 파일 안에 문서가 두 벌 들어 있다. `TASK-022`(completed) 뒤에
    `id: TASK-001` / `title: 파서 구현` / `status: qa_waiting`인 두 번째 frontmatter 블록이 붙어 있어
    프론트매터를 줄 단위로 훑는 도구가 잘못 읽을 수 있다. 내 작업 대상이 아니라 건드리지 않았다.
  - `.serena/`가 추적되지 않은 채 작업 트리에 있다. 이 세션이 만든 것이 아니다.
