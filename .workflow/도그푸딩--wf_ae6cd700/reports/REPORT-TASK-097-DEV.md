# TASK-097 개발자 핸드오프

- 대상: TASK-097 (조건 스크립트 기획자 분기가 `created_by`를 두 자리에서 읽게 하고 버전을 올린다)
- 근거: SPEC-030 R1·R2·R3·R5, 완료 조건 1~6·9~15, DECISION-4B917B03 (`outcome: approved`,
  `created_by: user`, `spec_id: SPEC-030` — 직접 확인. SPEC-030의 결정 문서는 이 1건뿐이라 더 늦은
  결정이 없다)
- 역할: 개발자 (developer-claude)
- 선점: acquire exit 0 → `lease-36315-20260804123948` → `in_progress`(12:40:00Z) → 구현 → 검증 →
  `qa_waiting`. 중간에 renew exit 0 1회(12:45:27Z).
- 선행 확인: `depends_on` 선언 없음. SPEC-030 파생 작업 중 먼저 오는 작업이다.

승인된 확인 필요 1번대로 후보 선택과 비교 루프 두 자리 모두에 `created_by` 필터를 넣었다. 새 판정을
설계하지 않고 아키텍트 분기가 이미 쓰던 두 줄을 기획자 분기로 옮긴 것이 전부다.

## 병행 안전 재확인 (착수 시점 12:38Z 실측)

작업 문서가 요구한 확인이다. `heartbeat_condition.rs`·`role_eligibility.rs`를 범위에 둔
`todo`·`in_progress`·`blocked` 작업이 새로 생겼는지 착수 직전에 다시 봤다.

- 두 파일 이름을 언급하는 미완료 작업은 TASK-097(이 작업 자신)과 TASK-098 둘이었다.
- TASK-098은 두 파일을 **범위 밖 절에서만** 언급한다("이 작업에 `heartbeat_condition.rs`·
  `role_eligibility.rs` 변경분은 없다"). 범위로 삼은 것이 아니므로 겹치지 않는다.
- 따라서 두 파일을 범위로 삼은 작업은 이 작업 하나뿐이다. `blocked` 상신 사유가 없어 그대로 착수했다.

## 착수 시점 버전 값 (완료 조건 7)

작업 문서가 고정값을 가정하지 말라고 요구한 자리다. **착수 시점 값은 6이었다.**

- `heartbeat_condition.rs:20` `CONDITION_SCRIPT_VERSION` = 6
- `CONDITION_SCRIPT_SH` 본문 `# condition_script_version: 6`
- `CONDITION_SCRIPT_PS1` 본문 `# condition_script_version: 6`

세 자리 모두 **6 → 7**로 올렸다. 착지 후 실측:

```
20:const CONDITION_SCRIPT_VERSION: u32 = 7;
29:# condition_script_version: 7
255:# condition_script_version: 7
```

### 확인 사실 8과 다른 점 (인계 사항)

기획서 확인 사실 8은 설치본 `.workflow/rules/wf-eligible.sh`가 버전 4라고 적었지만, **착수 시점
설치본은 6이었다**(`sed -n 's/^# condition_script_version: //p'` 실행값). 기획서 작성 이후 앱이 설치를
한 번 더 돌린 것으로 보인다. 상수와 설치본이 어긋난다는 확인 사실 8의 취지(설치본은 앱이 따라
올린다)는 그대로이고, 지금은 상수 7 / 설치본 6이다. 이 작업은 설치본을 손대지 않았다.

## 변경한 파일

### `src-tauri/src/infrastructure/heartbeat_condition.rs`

- `CONDITION_SCRIPT_SH`의 `planner)` 절
  - 후보 선택: `outcome: revision_requested` 검사 뒤에
    `cb=$(sed -n 's/^created_by: *//p' "$d" | head -1)` / `[ "$cb" = "user" ] || continue` 추가.
  - 비교 루프: 스키마 검사 뒤에 `ocb=...` / `[ "$ocb" = "user" ] || continue` 추가.
  - 두 자리 모두 아키텍트 분기와 같은 어법이고 값 전체 비교다. 주석도 아키텍트 분기의 문장을 옮겼다.
- `CONDITION_SCRIPT_PS1`의 `'planner'` 절 — 같은 두 자리에
  `if ((Get-Value $lines 'created_by') -cne 'user') { continue }`. ASCII만 썼다.
- 버전 세 자리 6 → 7.
- `mod tests`
  - 픽스처 헬퍼 `write_revision_request_document` **신설**. 기존
    `write_later_revision_request`는 `created_by: user`와 `created_at`을 본문에 박아 두어 새 두 행을
    세우지 못한다. 작업 문서 지시대로 **기존 헬퍼 시그니처를 바꾸지 않고 하나를 더했다.**
  - `SCENARIOS`에 기획자 행 2개 추가(아래 절).
  - 버전 문자열을 기대하던 기존 단언 3곳을 새 값으로 갱신
    (`installs_condition_script_with_managed_markers`,
    `updates_a_managed_script_from_the_previous_version`, `the_error_messages_are_unchanged`).

### `src-tauri/src/infrastructure/role_eligibility.rs`

- 모듈 머리 "알려진 차이 5" 갱신(아래 절).
- `mod tests`에 앱↔스크립트 대조 단언 2개 추가(아래 절).
- **판정 함수 본문은 변경분 0줄이다.** 작업 문서가 "판정 함수 본문에 변경분이 있으면 방향을 잘못 잡은
  것"이라고 적은 자리다. `git diff`의 이 파일 삭제 라인은 모듈 머리 주석 4줄뿐이다.

## 시나리오 표에 더한 두 행 (완료 조건 1~4)

기획서 확인 사실 4·5의 두 픽스처를 그대로 행으로 세웠다.

1. **가림 방향** — "기획자: 수정 요청 뒤에 대리 승인이 붙었다".
   `SPEC-001`에 `revision_requested`/`user`/08-01과 `approved`/`user-delegate`/08-02.
   기대 `eligible` / 종료 코드 0. 비교 루프가 `created_by`를 보는지를 잡는다.
2. **헛기동 방향** — "기획자: created_by가 user가 아닌 수정 요청만 있다".
   `SPEC-001`에 `revision_requested`/`user-delegate` 하나뿐. 기대 `no-target` / 종료 코드 1.
   **이 행이 값 전체 비교를 고정한다** — 접두 일치로 구현하면 `user-delegate`가 통과해 깨진다.

사유 코드는 늘리지 않았다(`eligible`·`no-target` 둘 다 기존 어휘).
`the_scenario_table_only_expects_known_reason_codes` ok.

### 두 행이 실제로 판별하는지 실측

새 본문에서 통과하는 것만으로는 행이 판별력을 갖는지 알 수 없어, **같은 픽스처를 착수 시점 설치본
(버전 6, 필터 없는 기획자 분기)에 직접 돌렸다.** 임시 디렉터리에 픽스처를 세우고 설치본을 복사해
읽기만 했다.

| 픽스처 | 구 본문(v6) 실행값 | 새 본문(v7) 기대·실측 |
| --- | --- | --- |
| 가림 방향 | `no-target` / exit 1 | `eligible` / exit 0 |
| 헛기동 방향 | `eligible` / exit 0 | `no-target` / exit 1 |

두 방향 모두 확인 사실 4·5가 적은 대로 뒤집혔다. 즉 두 행은 이 변경이 없으면 실패한다.

## 앱과의 대조 (완료 조건 9, R3 첫·둘째 항목)

`role_eligibility.rs`에 앱 판정과 스크립트 종료 코드를 함께 보는 단언 2개를 더했다. 두 테스트 모두
기존 헬퍼 `assert_matches_condition_script`를 쓰므로 planner·architect·developer 세 판정이 한 번에
대조된다.

- `a_delegate_approval_does_not_supersede_a_users_revision_request` — 가림 방향. 앱·스크립트 모두
  planner 대기 있음.
- `a_revision_request_created_by_a_delegate_is_not_planner_work` — 헛기동 방향. 앱·스크립트 모두
  planner 대기 없음.

기존 단언은 하나도 줄지 않았다. `role_eligibility` 테스트 수 40 → 42.

## "알려진 차이 5" (완료 조건 8)

변경 전:

> 5. 기획서 결정을 앱은 `created_by: user`와 세 `outcome` 값으로 한 번 더 거른다. 스크립트의
>    `architect)` 분기는 `created_by`를 같은 값으로 거르지만(SPEC-028 R5) `planner)` 분기는
>    스키마 줄과 `spec_id` 유무만 본다. 그래서 남는 차이는 기획자 분기의 `created_by`와 두 분기가
>    보지 않는 `outcome` 값 목록이다. (…)

변경 후:

> 5. 기획서 결정을 앱은 `created_by: user`와 세 `outcome` 값으로 한 번 더 거른다. 스크립트의
>    `planner)`·`architect)` 두 분기도 `created_by`를 같은 값으로 거르지만(SPEC-028 R5,
>    SPEC-030 R1) `outcome` 값 목록은 보지 않는다. 그래서 남는 차이는 두 분기가 보지 않는
>    `outcome` 값 목록 하나다. (…)

**항목 수와 머리글 정합:** 항목 5는 사라진 것이 아니라 좁아졌으므로 목록은 여전히 다섯 항목이고,
머리글 "아래 다섯은 남는다"는 그대로 맞다. 번호 매김도 1~5 그대로다.

## 기존 픽스처를 고친 자리 (검토 필요, 인계 사항 아님)

새 필터가 들어가자 기존 테스트 3건이 깨졌다. **단언을 약화하지 않고 픽스처를 고쳤다.**

- `a_revision_request_opens_planner_work_without_any_idea`
- `only_the_latest_decision_of_a_spec_opens_planner_work`
- (`an_answered_or_claimed_revision_request_closes_planner_work`는 통과했지만 같은 픽스처를 쓴다)

이 픽스처들의 결정 문서 문자열에 **`created_by` 줄이 아예 없었다.** 앱이 쓰는 결정 문서에는 항상
있는 줄이고(확인 사실 3의 `read_spec_decisions`가 그것을 요구한다), 이 저장소 결정 120건도 전부
갖고 있다. 즉 픽스처가 실제 문서보다 모자랐던 것이고, 새 필터는 그것을 옳게 걸러냈다. 각 문자열에
`created_by: user`를 더해 실제 문서와 같은 모양으로 맞췄다. **단언 값·테스트 이름·테스트 수는 그대로다.**

`an_answered_or_claimed_revision_request_closes_planner_work`도 같이 고쳤다. 고치지 않아도 exit 1로
통과하지만, 그 통과가 "후속 기획서가 닫았다"가 아니라 "`created_by`가 없어 후보에서 빠졌다"가 되어
테스트가 원래 보던 것을 더는 보지 않게 되기 때문이다.

`a_task_qa_revision_request_does_not_open_planner_work`의 QA 결정 픽스처는 손대지 않았다. 스키마
줄에서 먼저 걸리므로 `created_by` 필터에 닿지 않고, 그 테스트가 보던 것이 그대로 남는다.

## 판정 불변 실측 (완료 조건 11)

실저장소에서 세 역할을 착수 전·착지 후로 돌렸다. 착수 전은 설치본(v6), 착지 후는 새 `sh` 본문을
상수에서 추출해(v7) 같은 저장소 루트에서 돌렸다.

| 역할 | 착수 전 (v6 설치본) | 착지 후 (v7 새 본문) |
| --- | --- | --- |
| planner | `no-target` / exit 1 | `no-target` / exit 1 |
| architect | `no-target` / exit 1 | `no-target` / exit 1 |
| developer | `eligible` / exit 0 | `eligible` / exit 0 |

세 역할 모두 같다. 확인 사실 10대로 이 워크플로우의 결정은 전부 `created_by: user`라 필터가
무동작이어야 하고, 실제로 그랬다. 착수 시점 실측 tally: `120 created_by: user` 한 줄
(`user-delegate` 0건). 기획서가 적은 75건에서 120건으로 늘었지만 값은 전부 `user`로 같다.

## 아키텍트·개발자 분기 무변경 (완료 조건 13)

작업 문서의 검증 문구 규칙대로 `git diff`가 비어 있다가 아니라 **본문 단위로 대조**했다. `HEAD`의
같은 파일에서 네 절을 뽑아 현재 본문과 `diff`했다.

| 절 | 결과 |
| --- | --- |
| `sh` `architect)` (36줄) | SAME |
| `sh` `developer)` (21줄) | SAME |
| `ps1` `'architect'` (40줄) | SAME |
| `ps1` `'developer'` (21줄) | SAME |

네 절 모두 착수 시점과 바이트 단위로 같다.

## 표 무삭제 (완료 조건 12)

`SCENARIOS` 행 수 **17 → 19**. `git diff`의 이 파일 삭제 라인에 `Scenario {`가 하나도 없다(삭제
라인 전체를 뽑아 확인). 기존 17행이 그대로 있고 통과한다.

## 검증

`cargo`는 PATH에 없어 `~/.cargo/bin`을 붙여 돌렸다.

| 명령 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **403 passed / 0 failed / 0 ignored** |
| `npm run check` (typecheck + vitest + build) | **19 파일 501 tests passed**, build ok |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 위반 0 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 0 |

지목 테스트 개별 실행도 ok: `the_installed_script_matches_the_scenario_table`,
`the_powershell_implementation_is_ascii`(완료 조건 6),
`the_scenario_table_only_expects_known_reason_codes`, 새 대조 단언 2건.

`#[ignore]` 신규 0건(변경분에서 `+.*#[ignore]` 0). 테스트 수는 늘기만 했다:
`heartbeat_condition` 38 → 41, `role_eligibility` 40 → 42.

### 확인 사실 13의 타 세션 위반 (완료 조건 16)

기획서가 적은 두 위반 — `heartbeat_status.rs` fmt 1건, `heartbeat_process.rs:216` clippy 1건 —
**지금은 둘 다 없다.** fmt·clippy 모두 위반 0으로 통과했다. 기획서 작성 이후 다른 세션이 착지시킨
것으로 보인다. 따라서 이 작업이 만든 결과와 구분해 적을 타 세션 위반이 남아 있지 않다.

### 플랫폼 (완료 조건 5)

**로컬은 macOS(darwin) 한 플랫폼만 돌았다.** 시나리오 표는 현재 플랫폼에 설치된 구현을 돌리므로 여기서
검증된 것은 `sh` 구현이다. **PowerShell 구현은 로컬에서 실행되지 않았고**, `ps1` 본문에 대해 로컬이
확인한 것은 ASCII 검사와 컴파일뿐이다. sh↔ps1 동일 판정은 CI의 Windows 러너가 같은 표를 돌아야
확정된다. 두 구현을 같은 커밋에서 함께 고쳤다(R2 셋째 항목).

## 범위 준수

변경한 파일은 셋뿐이다: `heartbeat_condition.rs`, `role_eligibility.rs`, 그리고 작업 문서
`TASK-097.md`. `project_instructions.rs` 변경분 0줄(TASK-098 몫), 설치본
`.workflow/rules/wf-eligible.sh` 무변경(앱 설치 경로의 산출물).

### SPEC-030 파생 작업 둘의 범위 목록 (완료 조건 15, 완료 조건 9 대응)

- **TASK-097 (이 작업):** `heartbeat_condition.rs`, `role_eligibility.rs`.
- **TASK-098:** `project_instructions.rs`.

겹치는 파일이 없다. `heartbeat_condition.rs`를 범위에 올린 작업은 이번 분해에서 이 하나뿐이고,
`project_instructions.rs`도 TASK-098 하나뿐이다.

## 후속 / 리스크

1. **TASK-098이 이제 착수 가능하다.** 선행이 이 작업 하나였고 `qa_waiting`이 되므로 선행 충족이다.
   계약 문언(임시 불릿)이 말하는 상태는 이 변경으로 거짓이 됐다.
2. **설치본과 상수가 다시 어긋나 있다** — 상수 7 / 설치본 6. 앱이 다음 설치를 돌릴 때 따라 올라간다.
   그때까지 하트비트는 필터 없는 v6 판정을 쓴다. 실저장소에는 `user-delegate` 결정이 0건이라 판정이
   달라지지 않지만, **대리 결정이 처음 기록되는 시점 전에 설치가 한 번 돌아야 한다.**
3. **Windows 러너 확인이 남았다.** 위 플랫폼 절대로 `ps1` 두 자리는 로컬에서 실행되지 않았다.
   CI 세 러너에서 새 두 행이 통과하는 것을 QA 전에 봐야 완료 조건 5가 닫힌다.
4. **남은 알려진 차이는 하나다** — 두 분기가 `outcome` 값 목록을 보지 않는 것. 기획서 제외 범위이고
   후속 아이디어감이다.
5. **역할 밖 발견(핸드오프):** 기획서 확인 사실 8의 설치본 버전(4)과 확인 사실 10의 결정 문서 수(75)가
   현재 값(6, 120)과 다르다. 기획서 작성 이후 저장소가 움직인 것이고 판정에는 영향이 없다. 문서를
   고치지 않고 여기 적어 둔다.
6. **역할 밖 발견(핸드오프):** `.workflow/.runtime/leases/SPEC-009.yml`에 만료된 lease가 남아 있다
   (`expires_at: 2026-08-03T01:20:00Z`, `agent: architect-claude`). 판정은 만료 lease를 선점으로 세지
   않으므로 막는 것은 없다. 규칙상 세션이 남의 lease 파일을 지우지 않으므로 그대로 두었다.

## QA 안내

1. `cargo test --manifest-path src-tauri/Cargo.toml` — 403 통과 확인.
2. `npm run check` — 501 통과와 빌드 확인.
3. 새 두 행의 판별력을 보려면 `SCENARIOS`의 기획자 두 행을 두고 `planner)` 절의
   `[ "$cb" = "user" ] || continue` 한 줄을 지웠을 때
   `the_installed_script_matches_the_scenario_table`이 깨지는지 확인하면 된다.
4. CI에서 Windows 러너의 시나리오 표 결과를 확인해 주면 완료 조건 5가 닫힌다.
