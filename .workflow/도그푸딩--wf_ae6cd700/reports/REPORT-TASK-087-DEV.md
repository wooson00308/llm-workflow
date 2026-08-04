# TASK-087 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(tl-dev-087)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T10:12Z, TL 세션)

- 대상 작업: TASK-087 (대리 결정이 있는 기획서에 앱이 재가를 기록할 수 있음을 테스트로 고정한다)
- 근거 문서: SPEC-028 R3 / 완료 조건 5·6·13·15, DECISION-2A9D7B31 (`outcome: approved`, `created_by: user` 직접 확인)
- 상태: `qa_waiting` (lease-821-20260804095634, acquire exit 0 / renew exit 0 / release exit 0)

## 이 테스트가 고정하는 보장 (TASK-088의 계약 문언이 올라탈 자리)

한 문장으로: **`created_by`가 `user`가 아닌 결정 문서는 앱의 기획서 결정 읽기 경로에 존재하지 않는다. 그래서 대리 결정이 있는 기획서는 `user_review`로 남고, 사용자가 뒤늦게 앱 도장으로 재가할 수 있다.**

세 갈래로 쪼개져 테스트에 박혀 있다.

1. **대리 결정은 기획서 상태를 움직이지 못한다.** `created_by: user-delegate`인 `approved` 결정이 디렉터리에 있어도 `apply_latest_decision`을 지난 기획서 상태가 `user_review` 그대로다.
2. **그래서 재가 도장이 앱에서 실제로 찍힌다.** 같은 상태에서 `record_spec_decision`이 `SpecNotAwaitingDecision`을 내지 않고 결정 문서를 쓴다. SPEC-028 완료 조건 5.
3. **재가 결정이 그 기획서의 최신 결정이 된다.** 기록 뒤 앱이 세는 결정은 방금 쓴 재가 결정 하나뿐이고, `latest_spec_decisions`가 그 문서의 `created_at`·`outcome`을 돌려주며 `apply_latest_decision`이 기획서를 `approved`로 만든다. 완료 조건 6.

TASK-088이 "누가 무엇을 하면 대리 결정이 정식 결정으로 갈음되는가"를 계약 문언으로 적을 때, 그 절차가 앱에서 성립한다는 근거가 이 세 단언이다. `created_by` 필터가 나중에 느슨해지면(예: 앱이 `user-delegate`도 세도록 바뀌면) 1번이 먼저 깨지고 이어 2번이 `SpecNotAwaitingDecision`으로 깨진다. 계약 문언이 가리키는 경로가 조용히 막히는 대신 테스트가 먼저 실패한다.

## 변경한 파일 (하나, 테스트 모듈만)

`src-tauri/src/infrastructure/fs_project_repository.rs` — `#[cfg(test)] mod tests` 안에만 추가.

- `:3912` `spec_status_after_latest_decision` (헬퍼)
- `:3923` `app_recorded_decision` (헬퍼)
- `:3947` `records_a_user_reapproval_on_a_spec_that_carries_a_delegate_decision` (본 테스트)
- `:4015` `refuses_a_second_decision_on_a_spec_the_app_already_decided` (대조군)
- `:1801`~`:1805` `use super::{...}`에 `apply_latest_decision`·`latest_spec_decisions`·`normalize_spec_status`·`read_markdown_document`·`read_spec_decisions` 다섯 추가. rustfmt가 기존 줄을 다시 접어 블록이 재배치됐다. 추가한 다섯 외에 제거·개명한 항목 없음.

워크플로우 문서는 `tasks/TASK-087.md` 하나(상태·`updated_at`·history 3행). 제품 코드·다른 파일 무변경. 기존 테스트 삭제·비활성화·약화 없음. 커밋·푸시·체크아웃·스태시 안 했다.

## 핵심 결정과 근거

1. **픽스처는 기존 `spec_decision` 헬퍼에 `created_by` 한 값만 바꿔 만든다.** `.replace("created_by: user", "created_by: user-delegate")` 한 줄. 나머지 프론트매터(`schema: workflow-labs/decision@1`, `spec_id`, `outcome: approved`, `created_at`)가 앱이 쓰는 문서와 같은 모양이어야 이 테스트가 검사하는 것이 `created_by` 하나가 된다. 작업 문서가 명시한 요건이고, 같은 파일의 기존 `skips_unreadable_spec_decisions_and_keeps_the_others`(`created_by: agent`)와 같은 어법이다.
2. **판정 헬퍼는 제품 경로의 세 줄을 그대로 옮겼다.** `record_spec_decision`이 도장 가능 여부를 판정할 때 실행하는 것이 `read_markdown_document` → `normalize_spec_status` → `apply_latest_decision`(`:340`~`:342`)이다. 헬퍼가 같은 셋을 같은 순서로 부른다. 화면 경로(`inspect`)로 우회하면 다른 것을 재게 되므로 거부 판정이 실제로 읽는 값을 직접 만들었다. `inspect` 결과도 함께 단언해 두 경로가 갈리지 않는 것을 같이 고정했다.
3. **"최신 결정이 재가 결정이다"를 두 겹으로 단언했다.** `apply_latest_decision`이 `approved`인 것만으로는 대리 결정이 세어진 경우와 구별되지 않는다. 그래서 `read_spec_decisions`가 돌려주는 결정 id 목록이 방금 앱이 쓴 문서 하나뿐임을 먼저 단언하고, `latest_spec_decisions`가 그 문서의 `created_at`을 돌려주는 것을 확인한 뒤 상태를 본다.
4. **대조군을 대칭으로 짰다.** 같은 픽스처에서 `created_by`만 `user`로 두고 `created_at`은 앱 형식(`2026-08-04T07:34:27.458543+00:00`, 확인 사실 6의 실제 표기)을 썼다. 기획서가 `approved`가 되고 `record_spec_decision`이 `SpecNotAwaitingDecision`을 낸다. 결정 디렉터리에 새 문서가 생기지 않은 것까지 단언했다 — 거부가 "에러만 돌려주고 파일은 썼다"가 아님을 함께 고정한다.

## 완료 조건 대조

1. `user-delegate` 결정이 있어도 `SpecNotAwaitingDecision`이 안 난다 — 충족(`record_spec_decision`을 `expect`로 받는다).
2. 기록 뒤 최신 결정이 재가 결정 — 충족(id 목록 + `latest_spec_decisions` + `apply_latest_decision` 세 단언).
3. `user` 결정에서는 `SpecNotAwaitingDecision`이 난다 — 충족(`matches!(error, ProjectError::SpecNotAwaitingDecision)`).
4. 앱 형식 기존 결정 8건의 해석 불변 — 충족. 판정 코드가 한 바이트도 안 바뀌었으므로 입력이 같으면 답이 같다(아래 해시 대조가 근거). 더해서 대조군이 앱 형식 `created_at`으로 지금과 같은 답을 내는 것을 실제 실행으로 확인한다.
5. 제품 코드 구간 무변경 — 충족(아래 심볼 단위 대조).
6. 기존 자동 테스트 삭제·비활성화 없음 — 충족. 이 파일의 `#[test]` 87 → 89(순증 2), `#[ignore]` 0건.
7. `cargo test` 통과 — 내 변경 반영 상태에서 두 번 통과. 이후 다른 세션 편집으로 크레이트가 일시적 컴파일 불가(아래 게이트 참조).

## 제품 코드 무변경 검증 (파일·심볼 단위)

`git diff`로는 판정 불가다. 이 파일에는 착수 시점에 이미 다른 세션들의 미커밋 변경이 `git diff --numstat` 기준 2499 추가 / 107 삭제만큼 얹혀 있어, HEAD 대비 diff의 대부분이 내 것이 아니다. 작업 문서가 경고한 그대로다. 그래서 착수 직후 해시를 떠 두고 종료 시점과 대조했다.

제품 코드 구간 = 1행부터 `#[cfg(test)]` 직전까지. 착수·종료 양쪽에서 `#[cfg(test)]`가 `:1790`, `mod tests {`가 `:1791`로 같아 구간 경계 자체가 안 움직였다.

- 제품 코드 구간 전체(1–1789): `d60a35235f50c51be8423758b5183c79` → 동일
- `record_spec_decision`(322–372): `38d8c29c6db7832b195e75e4b7c846d8` → 동일
- `latest_spec_decisions`(1634–1648): `0a632e1d4aacfe64669a7def99bb0b2b` → 동일
- `apply_latest_decision`(1669–1675): `578cbf6e83faa3d6431ab7a2fbdc53c6` → 동일
- QA 결정 `created_by` 필터(`:1492` 포함, 1476–1495): `a1f540e454a582dbd4abb965e85517fe` → 동일
- 기획서 결정 `created_by` 필터(`:1579` 포함, 1563–1604): `eed2ccd2685691ae2b1457a7f239224a` → 동일

완료 조건 5가 지정한 다섯 심볼이 전부 착수 시점과 같은 본문이고, 그 다섯을 포함하는 구간 전체도 바이트 동일하다. 종료 직전 재확인에서도 같은 값이었다. 이 작업이 손댄 것은 `#[cfg(test)] mod tests` 안쪽뿐이다.

## 게이트 (작업 트리가 실행 중에 움직였다 — 관측 그대로)

- `cargo fmt -- --check`: **exit 0, 출력 없음.** 최초 실행에서 내 코드 두 곳(`use super` 블록, `app_recorded_decision` 호출 줄)이 지적돼 그 두 곳만 손으로 맞췄다. 크레이트 전체 재포매팅은 다른 세션의 미커밋 변경을 건드릴 수 있어 `cargo fmt`는 실행하지 않았다.
- `cargo test`: **386 passed / 0 failed / 0 ignored.** 내 변경이 반영된 상태에서 두 번 통과(첫 실행 382 passed, 두 번째 386 passed — 증가분 4는 그 사이 다른 세션이 넣은 테스트다). 신규 두 테스트는 이름 지정 개별 실행도 통과: `records_a_user_reapproval_on_a_spec_that_carries_a_delegate_decision ... ok`, `refuses_a_second_decision_on_a_spec_the_app_already_decided ... ok`.
- `cargo clippy --all-targets -- -D warnings`: **현재 실패. 원인이 전부 이 작업 범위 밖 파일이다.** 네 번 실행하는 동안 보고 위치가 `heartbeat_process.rs:216`(git 미추적 신규 파일) → `heartbeat_status.rs:490·511·540` → `heartbeat_service.rs:877·878·2090` + `project_instructions.rs:16·17` → `heartbeat_service.rs:2078`로 계속 바뀌었다. 하트비트 잡 모듈의 심볼을 옮기는 중이라 `super::HEARTBEAT_FILE`·`super::managed_block`·`install_managed_jobs` 미해결 참조가 뜬다. **네 번 모두 `fs_project_repository.rs`에서 나온 진단은 0건.**
- `cargo clippy -- -D warnings`(lib 타깃만): **exit 0, 출력 없음.** 제품 코드 빌드는 린트 청정.
- 마지막에 `cargo test` 재시도 루프를 백그라운드로 걸어 두고 기다렸으나, 세션 종료 시점까지 하트비트 모듈이 계속 편집 중이라 녹색 창이 안 왔다.

정리: 이 작업이 만든 코드에서 나온 게이트 실패는 없다. `cargo test`와 `--all-targets` clippy를 다시 녹색으로 받으려면 하트비트 모듈을 편집 중인 세션들이 착지한 뒤 재실행이 필요하다. `npm run check`는 이 작업이 프런트엔드를 안 건드려 실행하지 않았다.

## 후속 / 리스크

1. **QA 결정 경로는 같은 필터를 공유하지만 이 작업이 테스트를 더하지 않았다.** `:1492`의 `qa_decision_events`와 `:1579`의 `read_spec_decisions`가 쓰는 줄이 바이트 단위로 같다 — 양쪽 다 `|| yaml_text(metadata.as_ref(), "created_by").as_deref() != Some("user")`이고 다른 것은 앞줄의 스키마 문자열뿐이다. SPEC-028 제외 범위가 QA 결정의 대리 기록을 빼 두어 손대지 않았다. 나중에 QA 쪽을 다루면 이 작업의 픽스처를 `workflow-labs/qa-decision@1`로 바꾸는 것만으로 같은 보장을 세울 수 있다. 다만 QA는 작업 상태 전이와 얽혀 있어 "기록이 가능하다" 외에 "전이가 어떻게 되는가"를 따로 정해야 한다.
2. **이미 기록된 17건은 이 경로로 열리지 않는다.** 그 문서들은 `created_by: user`인 채라 앱이 여전히 승인으로 읽는다. 이 테스트가 고정한 것은 새 규칙으로 적히는 `user-delegate` 결정에만 해당한다. 근거 결정 DECISION-2A9D7B31 자신도 `created_by: user`인 수기 결정이라 이 17건에 속한다 — 소급 재가 간극은 그대로 남는다.
3. **`user-delegate` 문자열이 세 곳에서 같아야 한다.** TASK-086이 확정한 값이고 TASK-088의 계약 문언과 이 테스트 픽스처가 같아야 한다. 지금은 값을 문자열 리터럴로 박아 뒀다 — 앱 쪽에 그 값을 담은 상수가 없기 때문이다(앱은 `user`만 쓴다). TASK-088에서 다른 값으로 정해지면 이 리터럴도 함께 바뀌어야 한다.
4. **조건 스크립트는 이 보장 밖이다.** 확인 사실 4대로 `wf-eligible.sh`는 `created_by`를 안 읽으므로 `user-delegate` 결정을 앱은 무시하고 스크립트는 센다. 이 작업은 앱 쪽 보장만 고정했고 그 어긋남을 좁히지 않는다. SPEC-028이 확인 필요 1번의 비용으로 명시한 항목이다.

## 정정 (같은 세션의 후속 발신, 수신 2026-08-04T10:28Z)

게이트 절의 유일한 미결 항목이 닫혔다. "cargo test — 이후 다른 세션 편집으로 크레이트가 일시적 컴파일 불가"는 백그라운드 재시도 루프가 10번째 시도에서 녹색을 받으며 해소됐다.

- `cargo test`: **390 passed / 0 failed / 0 ignored**
- `records_a_user_reapproval_on_a_spec_that_carries_a_delegate_decision ... ok`
- `refuses_a_second_decision_on_a_spec_the_app_already_decided ... ok`

따라서 완료 조건 7은 조건부가 아니라 **완전 충족**이다. 하트비트 모듈 세션들(TASK-081 계열)이 착지하면서 컴파일이 정상화됐고, 그 상태에서 신규 두 테스트가 그대로 통과한다. 나머지 보고 내용은 변동 없다.
