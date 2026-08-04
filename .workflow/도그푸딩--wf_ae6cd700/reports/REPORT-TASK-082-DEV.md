# TASK-082 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(tl-dev-081, TASK-082 담당 재배정)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T10:39Z, TL 세션)

- 대상: TASK-082 (옛 파일에 남은 이 프로젝트의 잡을 저장할 때 치우고 남은 동안 감지한다)
- 근거: SPEC-024 R3, DECISION-3C8F1A42 확인 필요 2번의 승인된 제안 / 상태: `qa_waiting`
- lease: `lease-59160-20260804102353` (acquire·renew·release 전부 exit 0)
- 선행: TASK-081·TASK-077 둘 다 `qa_waiting`. 두 보고서를 읽고 착수했다.

## 변경한 파일

둘뿐이다.

- `src-tauri/src/application/heartbeat_service.rs` — 정리 단계 추가, 심볼 둘 복원, `install_tests`에 시험 일곱.
- `src-tauri/src/infrastructure/heartbeat_status.rs` — `find_duplicate_jobs`의 판정 범위, 마커 헬퍼 제거, `mod tests` 갱신.

프론트엔드 무변경(중복 경고를 그리는 통로는 이미 있고 문구는 TASK-083 몫이다). `heartbeat_jobs.rs`·`heartbeat_roles.rs`·`heartbeat_dream.rs`·`heartbeat_setup.rs`·`commands/` 무변경. 보호 상태 무변경. git 커밋·푸시·checkout·restore·stash 없음.

**실기기 `~/.claude` 무변경.** 이 작업이 만든 것이 바로 그 전역 파일에 쓰는 경로라 특히 확인했다 — `~/.claude/HEARTBEAT.md`는 100바이트·17:50:43으로 세션 전과 같고, `jobs.d`의 두 파일도 17:50:43·16:58:15 그대로다(현재 19:32 KST). 모든 시험이 `workspace()`/`tempdir()`만 쓴다.

## 정리 (완료 조건 1~5)

`heartbeat_service.rs`에 함수 하나를 더하고 두 저장 경로에서 부른다.

```rust
fn remove_legacy_jobs(heartbeat_home: &Path, slug: &str) {
    let _ = install_managed_jobs(
        &heartbeat_home.join(HEARTBEAT_FILE),
        &[],
        &owned_job_names(slug),
    );
}
```

호출 자리는 `install`·`install_dream` 둘 다 `write_project_jobs(&path, &jobs)?` 바로 다음, `self.inspect(...)` 앞이다. 정리를 스냅샷보다 먼저 두어야 그 저장이 돌려주는 화면 값이 정리 결과를 반영한다(완료 조건 8).

**새로 짠 로직은 없다.** 작업 문서대로 남길 잡 목록을 비우고 소유 목록만 넘기는 것이 곧 "내 잡만 빼기"다 — TASK-064가 만든 `install_managed_jobs`의 두 목록 분리가 그대로 성립한다. 소유 목록에 있고 남길 목록에 없는 잡은 지워지고, 어느 쪽에도 없는 남의 잡은 원문 그대로 남고, 블록에 아무것도 안 남으면 마커째 사라진다.

**TASK-081이 지운 심볼 둘을 되살렸다** — 그 세션의 핸드오프에 적어 둔 그대로다. `const HEARTBEAT_FILE`(옛 파일 이름)과 `fn owned_job_names(slug)`(역할 3종 + dream의 잡 이름). `owned_job_names`의 본문은 TASK-064가 넣었던 것과 같고, doc 주석의 "`install_managed_jobs`가 남의 잡을 가려내는 근거"라는 설명도 유지했다.

### 실패를 삼키는 자리와 그 근거

`let _ =`로 결과를 버린다. 근거 둘을 그 자리 doc 주석에 남겼다. 첫째, 이 시점에 잡 파일 쓰기는 이미 성공했고 데몬은 jobs.d를 이기므로 사용자의 편집은 실제로 적용된 상태다 — 여기서 오류를 올리면 성공한 저장이 "저장 실패"로 보고된다. 둘째, 옛 파일의 마커가 손상돼 있으면 `install_managed_jobs`는 언제나 거부하므로, 오류를 올리면 이 프로젝트와 무관한 파일 하나가 앱의 저장을 영구히 막는다.

삼킨 사실이 사라지지 않는다는 것도 시험으로 고정했다 — 정리하지 못한 잡이 같은 저장의 반환 스냅샷에 중복 잡으로 실린다.

## 감지 (완료 조건 6~8)

`find_duplicate_jobs`에서 "관리 블록 밖"이라는 필터를 없앴다. 나머지 판정(같은 slug + 어느 연동의 조건 참조)과 결과 타입, `DUPLICATE_RULES`, 화면 통로는 그대로다.

그 결과 `managed_block`과 전용 헬퍼 `marker_lines`의 호출자가 사라져 지웠고(작업 문서가 지시한 조건 그대로), 딸려서 `use std::ops::RangeInclusive`와 `MANAGED_END`·`MANAGED_START` 임포트가 프로덕션 쪽에서 빠졌다. 두 마커 상수는 `mod tests`가 픽스처를 만들 때 계속 쓰므로 그쪽에서 `heartbeat_jobs`로부터 직접 임포트하도록 옮겼다.

## 완료 조건 대조

1. **두 slug 섞인 블록에서 내 잡만 빠진다** — `saving_role_jobs_takes_this_projects_jobs_out_of_the_legacy_block`. 픽스처 `seed_mixed_block`은 블록 안에 이 프로젝트의 역할 잡 셋과 남의 잡 둘을 함께 넣는다.
2. **남의 잡 원문이 바이트 단위로 남는다** — 같은 시험. 판정은 "정리 뒤 파일이 `other_project_document()`와 바이트 단위로 같다"이다. 남의 잡만 있던 픽스처와 완전히 일치해야 하므로 잡의 존재뿐 아니라 값·필드 순서·자리까지 고정된다. dream 저장 경로도 같은 판정으로 `saving_the_dream_job_takes_this_projects_jobs_out_of_the_legacy_block`.
3. **전부 끄는 저장에서도 1·2 성립** — `turning_every_job_off_still_takes_this_projects_jobs_out_of_the_legacy_block`. 잡 파일이 사라지는 것(`None`)과 옛 파일이 남의 잡만 남는 것을 함께 본다.
4. **내 잡만 있던 블록은 마커째 사라진다** — `a_legacy_block_holding_only_this_projects_jobs_goes_away_with_its_markers`. 블록 밖 잡(`## my-job`)과 전역 설정(`- tick: 5m`)이 그대로라서, 파일이 블록 설치 전 내용으로 정확히 되돌아간다(`remove_block`이 구분 빈 줄까지 복원).
5. **마커 손상돼도 저장 성공** — `a_legacy_block_the_cleanup_cannot_touch_still_reaches_the_screen_as_a_duplicate`(역할 잡 경로)와 TASK-081이 남긴 `damaged_markers_in_the_legacy_file_no_longer_stop_the_dream_install`(dream 경로). 둘 다 `expect`로 성공을 받고 옛 파일이 한 바이트도 안 바뀐 것을 확인한다.
6. **잔여가 중복 목록에 실린다** — 블록 **밖**은 위 5번 시험(스냅샷의 `duplicate_jobs`에 `wf-developer<slug>` 하나), 블록 **안**은 `a_job_of_this_project_inside_the_managed_block_is_detected_too`(status 모듈)와 `the_snapshot_stops_reporting_duplicates_once_the_cleanup_succeeds`의 정리 전 단정(역할 셋이 순서대로).
7. **남의 slug는 안 잡힌다** — 블록 안까지 포함해 `another_projects_job_inside_the_managed_block_is_not_detected`(신규). 기존 `other_slug_or_other_condition_is_not_detected`는 블록 밖을 그대로 지킨다.
8. **정리 뒤 조회하면 목록이 빈다** — `the_snapshot_stops_reporting_duplicates_once_the_cleanup_succeeds`. 같은 시험이 정리 전 3건 → 정리 후 0건을 한 흐름에서 본다. 두 연동 payload 모두 빈 것을 확인한다.
9. **기존 테스트 미삭제·미비활성화** — 아래.
10. **게이트** — 아래.

## 고친 테스트와 그 이유 (완료 조건 9)

**삭제하거나 `#[ignore]`한 테스트는 없다.** 신규 8, 단정 변경 2(둘 다 판정 범위 확대의 직접 결과), 이름 변경 1(그 둘 중 하나).

### 단정이 바뀐 둘 (`heartbeat_status.rs`)

1. `job_inside_the_managed_block_is_not_detected` → **`a_job_of_this_project_inside_the_managed_block_is_detected_too`**. 이 테스트가 고정하던 성질이 이 작업이 없애는 성질 그 자체다. 픽스처(블록 밖 `wf-developer` + 블록 안 `wf-developer<slug>`)는 그대로 두고 단정을 `len == 1`에서 "둘 다, 파일에 적힌 순서대로"로 바꿨다. 이름을 바꾼 이유는 옛 이름이 이제 거짓이기 때문이다.
2. `duplicate_dream_job_outside_the_managed_block_is_detected` — 픽스처에 블록 안 dream 잡(`wf-dream-Users-catze-project-workflow-labs`)이 이미 들어 있었고 그것이 세어지지 않는다는 전제로 `len == 1`이었다. 이제 둘 다 잡히므로 이름·연동·역할을 함께 보는 목록 단정으로 바꿨다. 이름은 그대로 뒀다 — 블록 밖 잡이 감지된다는 원래 주장은 여전히 참이고, 주석에 블록 안 잡도 함께 잡힌다는 사실을 적었다.

블록을 안 쓰는 중복 감지 시험 다섯(`duplicate_job_outside_the_managed_block_is_detected`, `other_slug_or_other_condition_is_not_detected`, `duplicates_of_both_integrations_are_reported_with_their_integration`, PowerShell 둘)은 한 글자도 안 고쳤고 그대로 통과한다.

### 픽스처 값 하나 (`heartbeat_service.rs`)

`OTHER_SLUG`를 `-projects-mecha-arena` → **`-Users-catze-Git-mech-arena`**로 바꿨다. 완료 조건 1이 이 값을 명시하고, SPEC-024 확인 사실 2가 실측한 slug다(TASK-081 완료 조건 4도 같은 값을 요구했는데 그때 기존 상수를 그대로 뒀다 — 여기서 닫는다). 어느 단정도 이 리터럴에 의존하지 않는다(전부 `format!` 파생). 남의 slug라는 역할은 동일하다.

### 신규 여덟

`heartbeat_status.rs` 하나: `another_projects_job_inside_the_managed_block_is_not_detected`.

`heartbeat_service.rs` `install_tests` 일곱: 위 완료 조건 대조에 나온 여섯 + `the_cleanup_does_not_create_the_legacy_file_when_it_is_absent`.

마지막 것은 완료 조건에 없지만 이 변경이 만드는 실질 위험이라 넣었다. **옛 파일의 존재는 설치 판정(세 갈래 OR의 `document_present`)과 설치 안내 2단계의 근거다.** 정리가 빈 파일이나 마커만 있는 파일을 남기면 `heartbeat init`을 하지 않은 기기가 "설치됨"으로 보이고 안내 단계가 건너뛰어진다. `install_managed_jobs`가 "파일 없음 + 빈 목록"에서 아무것도 쓰지 않는 성질에 기대고 있으므로 그 의존을 시험으로 고정했다.

### 손대지 않은 것

TASK-081이 남긴 SPEC-022 네 시험(`saving_role_jobs_keeps_another_projects_jobs_in_the_block` 계열)은 한 글자도 안 고쳤고 그대로 통과한다. 남의 잡만 든 블록에서는 정리가 렌더한 블록이 원본과 바이트로 같아 `plan_block`이 쓰기를 건너뛰기 때문이다 — 정리가 도는데도 파일이 안 바뀐다는 사실이 그 네 시험으로 확인된다.

## 게이트

`src-tauri`에서:

- `cargo test` — **399 passed, 0 failed, 0 ignored.** 신규 8 전부 이름 지정 실행으로도 통과 확인. (이 작업 착수 시점 391 → 종료 399. 순증 8이 신규 시험 수와 같다. 다른 세션이 같은 트리에 착지 중이라 절대 수치는 판정 근거가 못 되고, 판정은 "실패 0 + 삭제 0"이다.)
- `cargo fmt -- --check` — 통과. 포매팅 대상 파일이 이 작업의 두 파일뿐인 것을 먼저 확인하고(`Diff in` 목록에 그 둘만) `cargo fmt`를 돌렸다. 다른 세션의 미커밋 변경은 건드리지 않았다.
- `cargo clippy --all-targets -- -D warnings` — **에러 1개로 실패하고, TASK-081 때와 같은 그 한 건이다.** `src/infrastructure/heartbeat_process.rs:216`의 `cloned_ref_to_slice_refs`이며 git 미추적 파일(타 세션 소유)이다. 그 lint만 `-A`로 빼면 `--all-targets`가 깨끗이 통과한다 — 이 작업의 변경분이 만든 지적은 0이다.

프로젝트 루트에서:

- `npm run check` — 통과. 18 test files / 456 tests passed, `tsc -b && vite build` 성공. 프론트엔드는 한 줄도 안 고쳤다.

## 후속 / 리스크

1. **중복 경고 문구가 지금 사실과 어긋난다.** 화면 문구는 "관리 블록 밖"을 전제로 쓰였는데 판정이 블록 안까지 넓어졌다. 작업 문서가 범위 밖으로 명시했고 TASK-083이 고친다. 두 작업이 함께 QA에 올라가면 사라지는 구간이다.
2. **마커 방어 세 겹의 커버리지가 돌아왔다.** TASK-081 핸드오프의 2번 항목이 닫혔다 — `remove_legacy_jobs`가 `install_managed_jobs`의 프로덕션 호출자를 되살렸고, `a_legacy_block_the_cleanup_cannot_touch_...`가 마커 개수 거부 갈래를 실제로 태운다. 다만 마커 **순서** 뒤바뀜(`MarkerOrder`)과 **흡수 줄**(`AbsorbedLine`) 두 갈래는 여전히 전용 시험이 없다. 정리가 실패를 삼키므로 서비스 계층에서는 세 갈래가 전부 "아무 일도 안 일어남"으로 같아 보인다 — 갈래를 구별하려면 `heartbeat_jobs.rs`의 `mod tests`에 넣는 것이 맞고, 그 파일은 이 작업의 범위 밖이었다.
3. **정리는 저장할 때만 돈다.** 조회만 하는 사용자의 옛 잔여는 화면에 계속 보이되 치워지지 않는다. R3이 요구하는 것은 "적용되거나, 적용되지 않는다는 사실이 드러난다" 둘 중 하나이고 후자가 성립한다. 자동 정리는 승인된 범위 밖이다.
4. **`installed` 판정은 그대로다.** 정리가 옛 파일을 지워 없앨 수는 있다(블록만 있던 파일이 빈 파일로 남는 것이 아니라, 블록 밖 내용이 없으면 빈 문자열 파일이 된다). 그 경우 `document_present`는 파일 존재로 여전히 참이라 판정이 흔들리지 않는다. 다만 옛 파일이 빈 파일로 남는 모양은 QA에서 눈에 띌 수 있어 사실로 남긴다 — 이 작업이 그 파일을 지우지는 않는다.
