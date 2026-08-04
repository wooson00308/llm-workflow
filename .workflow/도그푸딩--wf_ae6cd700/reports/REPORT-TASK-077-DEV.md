# TASK-077 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(tl-dev-077)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T10:20Z, TL 세션)

- 대상: TASK-077 (앱이 `last_condition_output`을 읽어 건너뜀 사유를 카드에 보여준다, SPEC-023 R1·R2·R3)
- 근거 결정: DECISION-9E5D2C71 (`outcome: approved`, `created_by: user` 직접 확인)
- 상태: **`qa_waiting`** (lease-1285-20260804095659, 전 단계 exit 0)

## 대상 선정 / 선점 경위

`depends_on: [TASK-076, TASK-065]` 둘 다 `qa_waiting` 착지를 문서에서 확인하고 착수했다. TASK-076이 정한 사유 코드 어휘를 이 작업의 대응표가 받는 구조라 순서가 강제된다.

파일 충돌(`HeartbeatCard.tsx`·`IntegrationsView.test.tsx`) 병행 금지 보호를 위해 TL 지시로 TASK-073을 선claim하려 했으나 **TASK-073 선점은 exit 3으로 실패했다** — `developer-claude` 세션이 `lease-98662-20260804095035`로 2026-08-04T10:35:35Z까지 이미 쥐고 있었다. 지시대로 077만 진행했고 073은 손대지 않았다. (077 lease는 acquire exit 0, 중간 renew exit 0.)

## 핵심 결정과 근거

1. **네 번째 값은 기존 세 값과 같은 취급.** `JobRuns::get`이 같은 잡 항목에서 `text_field`로 함께 꺼낸다. 그 헬퍼가 문자열 아닌 타입을 값 없음으로 다루므로 계약 밖의 값이 와도 백엔드가 실패하지 않는다(R2). 검증·정규화·잘라내기를 백엔드에 두지 않았다 — `result`의 "원문 그대로 전달" 규칙과 같게 맞췄다.
2. **화면 타입에서 `conditionOutput`은 선택 필드(`?`)다.** 값 없음이 정상 상태이고 화면 코드가 `null`·`undefined`를 같은 경로로 처리한다. 필수 필드로 두면 이 작업과 무관한 기존 픽스처 약 20줄을 함께 고쳐야 해서, 손대는 줄을 요청 범위 안으로 묶는 쪽을 골랐다. 백엔드는 `Option<String>`을 그대로 직렬화하므로 실제 전문에는 늘 키가 있다.
3. **사유는 `skipped`에만 붙인다.** `quota_skipped`에는 붙이지 않는다 — 데몬의 한도 초과 분기가 이 키를 지우지 않아 이전 조건 검사의 문장이 이번 사유로 읽힌다(R3). 성공·실패에도 붙이지 않는다. 작업 문서가 지정한 쪽 그대로다.
4. **대응표는 어휘 넷을 전부 덮고, 어휘 밖은 받은 문자열 그대로 낸다.** 데몬이 직접 만드는 사유(`condition 타임아웃 (10s)`, `condition 실행 실패 (<예외이름>)`)는 코드가 아니라 문장이라 폴백으로 나가야 한다(R1 셋째 항목). `eligible`은 건너뜀 옆에 오지 않는 값이지만 어휘 안의 코드가 ASCII 날문자로 새는 자리를 남기지 않으려고 함께 넣었다.
5. **값이 없거나 공백뿐이면 지금 화면 그대로다.** `skippedReasonNote` 원문을 한 글자도 고치지 않았고, 빈 자리나 "없음" 같은 새 표시를 만들지 않았다(R2).
6. **두 카드는 코드를 공유하지 않고 문구만 맞췄다.** 저장소의 기존 선택을 바꾸지 않았다(범위 밖 항목).

## 변경한 파일 (다섯 + 작업 문서)

1. `src-tauri/src/domain/project.rs` — `HeartbeatJobRun`에 `condition_output: Option<String>` 하나. camelCase 직렬화 그대로(`conditionOutput`).
2. `src-tauri/src/infrastructure/heartbeat_status.rs` — `JobRuns::get`에 `condition_output: text_field(entry, "last_condition_output")` 한 줄. `mod tests`에 헬퍼 `developer_run` 하나와 신규 테스트 넷.
3. `src/features/projects/domain/types.ts` — `HeartbeatJobRun`에 `conditionOutput?: string | null`.
4. `src/features/projects/components/integrations/HeartbeatCard.tsx` — 상수 `skippedReasonLabels`·함수 `skippedReason` 신설, `run.result === "skipped"` 렌더 분기가 `skippedReason(run.conditionOutput) ?? skippedReasonNote`로. `runResultLabels`의 "앱은 둘을 구분할 방법이 없다" 주석과 `skippedReasonNote` 독 주석을 지금 동작에 맞게 고쳤다(사용자 문구 원문 무변경, 주석만).
5. `src/features/projects/components/integrations/DreamCard.tsx` — 같은 상수·함수·렌더 분기, 같은 주석 정리.
6. 테스트: `IntegrationsView.test.tsx`(기존 describe "IntegrationsView 연동 섹션"에 시나리오 7 + 픽스처 헬퍼 `skipped`), `DreamCard.test.tsx`(기존 describe에 시나리오 4).

**조건 스크립트 본문 변경분 없음.** `heartbeat_condition.rs`·`role_eligibility.rs`를 열지 않았고 `CONDITION_SCRIPT_SH`·`CONDITION_SCRIPT_PS1`·`CONDITION_SCRIPT_VERSION` 무변경(완료 조건 11, R7). `pending_work`·자격 판정 경로 무변경. 보호 상태 무변경, 커밋 없음. 기존 테스트 삭제·비활성화·약화 없음이고 **기존 픽스처도 고치지 않았다**(결정 2번이 그 이유다).

## 완료 조건 대조

- 1: `replaces the skip guidance with the reason the condition reported` — `no-target` 픽스처에서 문장이 보이고 안내가 사라진다. 라벨 "건너뜀"은 그대로.
- 2: `keeps the current wording when no reason arrived` — `null`·`undefined`·`""`·`"   "` 넷 모두 안내 그대로, `.integration-note` 개수 1.
- 3: `draws an unexpected reason string without breaking the card` — 540자 ASCII·500자 한글·줄바꿈·제어문자·`<script>alert(1)</script>` 다섯 값에서 카드의 나머지 줄이 그대로고 `script` 요소가 없다.
- 4: `leaves a quota skip without a reason even when a stale one is still recorded` + dream 쪽 `leaves a quota skip without a reason`.
- 5: `the_state_file_is_opened_once_per_status_read` — 상태 파일 자리에 디렉터리를 놓아 읽기를 실패시키면 조회 한 번이 남기는 실패가 정확히 1건. 사유용으로 파일을 다시 여는 구현이면 2가 된다.
- 6: `a_daemon_written_reason_passes_through_unchanged`(Rust) + `shows a reason the daemon wrote itself as it arrived`(화면) + dream 쪽 `shows a reason outside the vocabulary as it arrived`.
- 7: 아래 어휘 대조.
- 8: 아래 두 카드 문구 대조.
- 9: 문장 넷이 두 TS 파일에만 있다. 두 파일에 `platform`·`navigator`·`process.platform` 출현 0회(grep 실측). 스크립트 두 본문은 ASCII 코드만 내보내므로 플랫폼이 문장을 고를 자리가 없다.
- 10·11·12: 위 "변경한 파일"과 아래 "게이트 수치".

### 어휘 대조 (완료 조건 7)

TASK-076 보고서의 코드 목록, `heartbeat_condition.rs:846`의 `REASON_CODES`, 이 작업의 `skippedReasonLabels` 키가 셋 다 같은 넷이다 — `eligible`·`no-target`·`migration-lock`·`usage`. 범위가 같다. 대조를 테스트로도 남겼다: `puts a sentence in front of every reason code the condition script can emit`이 네 코드를 하나씩 그려 문장이 보이고 ASCII 코드가 화면에 남지 않는지 본다.

문장은 이렇게 옮겼다: `eligible`→"조건 검사는 처리할 대상이 있다고 판정했습니다." / `no-target`→"처리할 대상이 없어 건너뛰었습니다." / `migration-lock`→"마이그레이션 잠금 때문에 판정을 멈췄습니다." / `usage`→"조건 문자열의 역할 인자가 잘못됐습니다."

### 두 카드 문구 대조 (완료 조건 8)

두 파일에서 `skippedReasonLabels` 값 넷 + `skippedReasonNote` + `skippedReason` 본문을 뽑아 `diff`했고 바이트까지 동일하다(각 548바이트, 차이 0).

변이 확인: `DreamCard.tsx`의 `no-target` 문장 끝 마침표를 느낌표로 바꾸자 `shows one reason wording shared by the role job card and the dream card`가 기대 2 대 실제 1로 실패했다. 원문 복구 후 재통과(복구는 `.bak` 원본 되돌림, 잔여 파일 0개 확인). 한쪽만 고치는 실수를 이 테스트가 실제로 잡는다.

## 게이트 수치

- `npm run check`: 18 파일 **452 테스트 전부 통과**, `tsc -b && vite build` 통과. 실패 0.
- `cargo test`(src-tauri): **390 통과 0 실패.** `heartbeat_status` 모듈만 보면 24 통과 0 실패이고 그중 신규 넷(`the_condition_output_comes_from_the_same_job_entry`, `a_daemon_written_reason_passes_through_unchanged`, `an_absent_or_non_string_condition_output_is_no_value`, `the_state_file_is_opened_once_per_status_read`) 전부 통과.
- `cargo fmt -- --check`: 내 파일 둘 diff 0 (유일한 diff는 범위 밖 `heartbeat_service.rs:2381`).
- `cargo clippy --all-targets -- -D warnings`: 내 파일 경고 0. 남은 1건은 범위 밖 병행 이슈 `heartbeat_process.rs:216`(TASK-076 보고서가 이미 같은 건을 적었다).

판정 기준은 "신규 테스트 전부 통과 + 기존 테스트 무수정 + 실패 0". 총계는 병행 착지로 계속 움직였다(작업 중 Rust 386→390 관측).

**병행 세션 관측 기록(전부 내 범위 밖).** 작업 중간 `cargo test`가 두 번 깨졌다. (1) `application/heartbeat_service.rs`의 `HEARTBEAT_FILE`·`install_managed_jobs`·`MANAGED_START` 등 미해결 심볼 7건 — 다른 워커의 편집 중간 상태. (2) 그 뒤 `a_failed_condition_script_install_leaves_the_heartbeat_file_alone` 픽스처 실패와 `role_eligibility` 대조 단언 1건. 재확인 시점에 그 테스트는 `..._leaves_the_jobs_file_alone`으로 이름이 바뀌어 있었고(같은 워커의 진행 중 편집), 수렴 후 최종 게이트에서 390/0 통과. 내 파일 둘은 세 시점 모두 컴파일·통과했다. **다른 세션 파일을 고치지 않았다.**

## 후속 / 리스크

- **실물 값은 아직 오지 않는다.** 이 기기 `~/.claude/heartbeat/state.json` 잡 항목에 아직 `last_condition_output`이 없다. TASK-076 설치본이 v5로 덮인 뒤 역할 잡이 한 번 돌아야 사유가 생긴다. QA에서 "사유 안 보임"이면 그 순서를 먼저 확인해야 한다 — R2 설계상 정상 화면이다.
- **아주 긴 ASCII 사유의 가로 넘침은 확인하지 못했다.** jsdom이 레이아웃을 계산하지 않아 테스트가 잡을 수 없고, `App.css`는 이 작업 범위 밖이라 줄바꿈 규칙을 손대지 않았다. 한국어는 글자 단위로 접히고 데몬 계약이 첫 줄 200자를 보장해 실제 위험은 낮지만, 공백 없는 긴 ASCII를 내는 조건 도구가 생기면 `.integration-note`에 `overflow-wrap` 한 줄이 필요할 수 있다. (TASK-073이 App.css를 만지므로 그 세션에 얹기 좋은 후속.)
- **어휘가 늘면 두 곳을 함께 고쳐야 한다.** 조건 스크립트의 `REASON_CODES`와 두 카드의 `skippedReasonLabels`는 언어가 달라 컴파일러가 묶어 주지 못한다. 화면 쪽 대조 테스트가 표를 들고 있어 코드만 늘리면 그 테스트가 먼저 깨진다.
- **dream 카드는 통로만 열었다.** dream 조건(`dream-prep check-unprocessed`)은 저장소 밖이라 실제로 사유가 올지는 그 도구에 달려 있다. 범위 밖 항목 그대로다.
- **TASK-073 미착수.** 위 선점 경위대로 `developer-claude`가 계속 쥐고 있다(10:35:35Z 만료). TL이 그 세션의 진행 상황을 확인해 재배정 여부를 정해야 한다.

## 정정 (같은 세션의 후속 발신, 수신 2026-08-04T10:16Z)

바로 위 항목을 정정한다. **TASK-073은 이미 끝났다.** 077 작업 동안 lease를 쥐고 있던 `developer-claude` 세션이 완료했다.

실측 근거 셋:
- `tasks/TASK-073.md`가 `status: qa_waiting`이고 history에 `{ at: 2026-08-04T09:51:00Z, kind: in_progress }` → `{ at: 2026-08-04T09:58:00Z, kind: qa_waiting }`가 찍혀 있다.
- `reports/REPORT-TASK-073-DEV.md`가 존재한다.
- `TASK-073.yml` lease 파일이 정상 release되어 사라졌다.

즉 077 선점 직후 073 선점의 exit 3은 끼어들기 사고가 아니라 이미 진행 중인 세션과 정상적으로 경합해 진 것이었고, 그 세션이 끝까지 마쳤다. 073에 새 워커를 붙일 필요 없다.

**충돌 없음 확인.** 073이 09:58Z에 착지한 뒤 이 세션이 같은 `HeartbeatCard.tsx`·`IntegrationsView.test.tsx`를 편집했으므로, 이 세션의 변경은 그들의 변경 위에 얹혔지 덮어쓰지 않았다. 재확인 결과:
- 두 테스트 파일 265개 전부 통과(19:15 로컬 재실행).
- 077 심볼 생존 — 두 카드에 `skippedReasonLabels`/`skippedReason` 각 4회, `heartbeat_status.rs`에 `condition_output` 9회, `domain/project.rs`에 1회.
- 073 산출물 생존 — `heartbeat-run-failure-command`·`heartbeat-run-failure-copy` 등 렌더 구간 그대로.

앞서 보고한 077 게이트 수치는 073 착지 이후 시점의 트리에서 잰 값이라 그대로 유효하다. lease 정리: TASK-077 release exit 0, TASK-073은 애초에 획득한 적 없음.
