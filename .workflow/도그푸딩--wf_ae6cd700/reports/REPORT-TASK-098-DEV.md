# TASK-098 개발자 핸드오프

- 대상: TASK-098 (계약에서 기획자 분기 임시 불릿을 걷어내고 `rules_version`을 올린다)
- 근거: SPEC-030 R4·R5, 완료 조건 7·8·10·13·14·15, DECISION-4B917B03 (`outcome: approved`,
  `created_by: user`, `spec_id: SPEC-030` — 직접 확인. SPEC-030의 결정 문서는 이 1건뿐이라 더 늦은
  결정이 없다)
- 역할: 개발자 (developer-claude)
- 선점: acquire exit 0 → `lease-26737-20260804151137` → `in_progress`(15:12:00Z) → 구현 → 검증 →
  `qa_waiting`. 중간에 renew exit 0 1회.
- 선행 확인: `depends_on: [TASK-097]`. TASK-097은 `qa_waiting`이라 충족이다. 실제로 판정 구현이
  작업 트리에 착지해 있는 것도 코드에서 확인했다(아래 "선행 사실 확인").

계약이 자기 결함을 명시해 둔 임시 불릿 하나를 지우고, 그 불릿을 세던 앞 문장을 고치고, 규칙 자산의
버전 축 두 자리를 +1 했다. 그 외 파일은 만지지 않았다.

## 선행 사실 확인 (불릿을 지워도 되는가)

지울 불릿이 말하던 상태가 실제로 거짓이 되었는지 착수 직후 코드에서 직접 읽었다.

- `heartbeat_condition.rs`의 sh 본문 기획자 분기: 후보 선택 `:147`(`cb=... created_by ...`,
  `:148`에서 `user`가 아니면 건너뜀), 비교 루프 `:160`(`ocb=...`)에 필터가 있다.
- 같은 파일 ps1 본문 기획자 분기: 후보 선택 `:433`, 비교 루프 `:445`에 같은 필터가 있다.
- `CONDITION_SCRIPT_VERSION` = 7 (TASK-097이 6 → 7로 올린 값).
- `role_eligibility.rs`의 "알려진 차이 5"가 이미 "남는 차이는 두 분기가 보지 않는 `outcome` 값 목록
  하나다"로 갱신되어 있다.

즉 지금 `created_by`를 안 보는 판정 자리는 없다. 불릿의 "does not read `created_by`"는 거짓이 되었다.

## 병행 안전 재확인 (착수 시점 15:11Z 실측)

작업 문서가 요구한 확인이다. `project_instructions.rs`를 범위로 삼은 다른 미완료 작업이 생겼는지
착수 직전에 다시 봤다.

- 파일명을 언급하는 작업 18건 중 미완료는 TASK-098(이 작업 자신)과 TASK-099 둘이다.
- 분해 시점에 `qa_waiting`이던 TASK-086·TASK-088은 **둘 다 `completed`로 넘어갔다.** QA 반려로
  `todo`로 돌아온 것이 없다.
- TASK-099는 이 파일을 **범위로 삼지 않는다.** 언급은 처리 규칙 절에서 호출 함수 이름
  `install_project_instructions`를 나열한 한 줄뿐이고(`tasks/TASK-099.md:103`), 게다가 그 작업은
  `depends_on: [TASK-095, TASK-096]` 중 TASK-096이 `in_progress`라 지금 착수 자격도 없다.

따라서 이 파일을 범위로 삼은 작업은 이 작업 하나뿐이다. `blocked` 상신 사유가 없어 그대로 착수했다.

## 착수 시점 버전 값 (완료 조건 5)

작업 문서가 고정값을 가정하지 말라고 요구한 자리다. **착수 시점 값은 8이었다** (분해 시점 값과 같다).

- `project_instructions.rs:21` `WORKFLOW_RULES_VERSION` = 8
- `WORKFLOW_RULES` 본문 프론트매터 `rules_version: 8`

두 자리 모두 **8 → 9**로 올렸다. 착지 후 실측:

```
21:const WORKFLOW_RULES_VERSION: u32 = 9;
48: rules_version: 9
```

`src-tauri/src` 전체에 `rules_version: 8`을 기대하는 문자열은 0건이다(grep 결과 없음).

## 불릿 삭제와 절의 정합 (완료 조건 1·2·3)

### 변경 전

```
That leaves a document sitting in `decisions/` that the app does not see. Two judgements ignore it and one does not:

- The app ignores it wherever it reads specification decisions. ...
- The architect eligibility judgement ignores it. ...
- The condition script's planner branch does not read `created_by`. It compares `created_at` across
  every decision document of the specification, so a delegated decision later than a pending
  `revision_requested` hides that revision request from the heartbeat while the app still counts it.
  Until that branch reads `created_by` too, the app and the heartbeat disagree about such a
  specification.
```

### 변경 후

```
That leaves a document sitting in `decisions/` that the app does not see. Every judgement ignores it:

- The app ignores it wherever it reads specification decisions. It never sets a specification's status and never reaches the decision feed.
- The architect eligibility judgement ignores it. It is not architect work, and it cannot displace another decision from being the latest one.
```

확인 사실 7의 불릿은 본문에서 사라졌다. 남은 두 불릿은 사실이 달라지지 않아 한 글자도 고치지 않았다.

### 앞 문장의 셈 (완료 조건 2)

`Two judgements ignore it and one does not:` 는 두 절 모두 거짓이 되었다. 항목이 셋에서 둘로 줄었고,
TASK-097 이후에는 기획자 판정까지 포함해 **셋 다 무시한다.** 그래서 셈을 세는 대신 성격을 말하는
문장으로 바꿨다 — `Every judgement ignores it:`. 남은 항목 둘의 성격(둘 다 "ignores it")과 맞고,
목록에 없는 기획자 판정까지 포함해 참이다.

기획자 판정을 새 불릿으로 되살리지는 않았다. 그 자리에 적을 내용이 "이제는 차이가 없다"뿐이고, 없어진
차이를 계약이 계속 말하지 않는 것이 R4의 요구다.

### 절이 답하던 질문에 계약이 여전히 답한다 (완료 조건 3)

질문은 "재가 뒤 남는 대리 결정 파일을 무엇이 어떻게 취급하는가"다. 답을 담은 문장은 그대로 있다.

> The delegated decision file stays where it is. Several decisions on one specification is the design
> here — "when was this approved, and when was it sent back" is what the audit log answers — and the
> app has no path that edits or deletes a decision document, so removing one would mean a human
> editing app-owned state, which is what these rules exist to prevent.

> That leaves a document sitting in `decisions/` that the app does not see. Every judgement ignores
> it:

> - The app ignores it wherever it reads specification decisions. It never sets a specification's
>   status and never reaches the decision feed.
> - The architect eligibility judgement ignores it. It is not architect work, and it cannot displace
>   another decision from being the latest one.

파일은 남고, 아무 판정도 그것을 세지 않는다 — 이 답이 삭제 전후로 같다. 그 뒤의 "Decisions written
before this rule..." 문단도 손대지 않았다.

## 남은 차이를 새로 감추지 않았다 (완료 조건 4)

남은 차이는 "sh·ps1 두 분기가 `outcome` 값 목록을 보지 않는다"이다(`role_eligibility.rs`의 알려진
차이 5). **계약 본문에는 이 차이에 관해 아무것도 새로 적지 않았다.**

근거: SPEC-030 R4 셋째 항목이 "계약이 그 차이를 원래 적지 않았으므로 새로 적을 필요도 없다"로 적었고,
실제로 변경 전 `WORKFLOW_RULES` 본문에 `outcome` 값 목록의 차이를 말하는 문장이 없었다. 없던 것을
그대로 두는 것은 감추는 것이 아니다. 그 차이는 코드 주석(알려진 차이 5)에 남아 있어 다음 사람이 찾을
자리도 그대로다.

## 역할 계약 무변경 (완료 조건 7)

`git diff`가 비어 있다는 문구를 쓰지 말라는 작업 문서 요구대로, 심볼 단위로 착수 시점 값과 대조했다.
아래 네 값은 착수 시점과 착지 후가 같다.

| 자리 | 착수 시점 | 착지 후 |
| --- | --- | --- |
| `ROLE_RULES_VERSION` (`:24`) | 5 | 5 |
| planner 본문 `rules_version` (`:236`) | 5 | 5 |
| architect 본문 `rules_version` (`:288`) | 4 | 4 |
| developer 본문 `rules_version` (`:337`) | 4 | 4 |

이 값을 기대하는 단언(`planner.contains("rules_version: 5")`, `architect`·`developer`의
`"rules_version: 4"`)은 **수정 없이 그대로 통과했다.** 이 작업의 diff에 세 역할 계약 본문 줄은 한 줄도
없다.

## 검증

| 항목 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **404 passed, 0 failed, 0 ignored** |
| 그중 `project_instructions` 필터 | **14 passed** (`install_project_instructions`· `validate_project_instructions` 경로 포함) |
| `cargo fmt --check` | exit 0 (위반 0건) |
| `cargo clippy --all-targets -- -D warnings` | 경고 0건 |
| `npm run check` | **실패 — 이 작업 소유 아님. 아래 절 참조** |

### 완료 조건 6 (설치·검증 경로)

새 값 9로 다음 테스트가 통과한다. 코드 변경 없이 상수만 따라간 것을 확인했다.

- `installs_rules_and_both_agent_entrypoints`
- `validates_the_instructions_it_just_installed`
- `upgrades_managed_v1_rules_and_installs_role_contracts`
- `upgrades_rules_installed_before_the_transition_history_contract`
- `upgrades_rules_installed_before_the_lease_role_field`
- `preserves_existing_content_and_is_idempotent`
- `refuses_to_downgrade_future_managed_rules`
- 그 외 7건 (총 14건)

### 완료 조건 8 (테스트 삭제·비활성화 없음)

`project_instructions.rs`의 `#[test]` 수는 HEAD 14건, 착지 후 14건으로 같다. 파일 전체의 `#[ignore]`는
0건이고 이 작업의 diff에 `#[ignore]` 추가는 0건이다. 전체 스위트도 `0 ignored`다.

### 완료 조건 9 (파일 단독 편집)

SPEC-030 파생 작업은 둘이고 범위가 겹치지 않는다.

- TASK-097: `heartbeat_condition.rs`, `role_eligibility.rs` (범위 밖 절에 "`project_instructions.rs`
  는 TASK-098" 취지가 적혀 있다)
- TASK-098(이 작업): `project_instructions.rs` 단독. 범위 밖 절이 `heartbeat_condition.rs`·
  `role_eligibility.rs`·`CONDITION_SCRIPT_VERSION` 무변경을 명시한다.

## 게이트 실패 귀속 (완료 조건 10)

**`npm run check`가 지금 실패한다. 이 작업이 만든 결과가 아니다.**

- typecheck 3건 전부 `src/features/projects/components/DevelopmentBoard.test.tsx`:
  `TS6133 'LANE_COLLAPSE_KEY'`(114), `TS6133 'stubStorage'`(117), `TS6133 'laneByToggle'`(129).
- 참고로 따로 돌린 `npm run test`: 19파일 중 **1파일 실패, 44 tests failed / 457 passed**. 실패는
  전부 같은 파일(`DevelopmentBoard.test.tsx`)이고, `getByRole("button", { name: "기획서별 묶기" })`가
  복수 매치로 터진다.

귀속 근거:

1. 이 작업의 diff에는 `src/` 아래 파일이 **한 건도 없다.** 바뀐 코드 파일은
   `src-tauri/src/infrastructure/project_instructions.rs` 하나이고, 그 파일은 프런트엔드 빌드·테스트
   경로에 들어가지 않는다.
2. 위 세 심볼과 실패하는 헬퍼는 **미커밋 상태인 타 세션 변경분에서 추가된 줄**이다
   (`git diff -U0 DevelopmentBoard.test.tsx`에서 `+const LANE_COLLAPSE_KEY`, `+function stubStorage`,
   `+function laneByToggle`로 확인).
3. 그 변경분의 주인은 **TASK-096(`레인 접힘을 화면에 붙이고 저장소와 잇는다`)**이다. 지금 상태가
   `in_progress`이고, lease `TASK-096.yml`은 `expires_at: 2026-08-04T13:40:52Z`로 이미 만료됐다 —
   중단된 세션의 작업 중 산출물이 트리에 남아 있는 상태다.
4. 시간축도 맞는다. TASK-097 세션 보고서(12:51Z 착지)는 같은 게이트를 `19 파일 501 tests passed,
   build ok`로 기록했다. TASK-096 세션이 13:05Z에 착수했고, 그 사이에만 회귀가 생겼다.

**확인 사실 13의 타 세션 위반 2건은 이미 사라졌다.** `heartbeat_status.rs` fmt 위반과
`heartbeat_process.rs:216` clippy 위반 모두 지금은 없다(`cargo fmt --check` exit 0,
`clippy -D warnings` 경고 0건). 대신 위의 TS 게이트 위반이 새 타 세션 소유 항목으로 남는다.

이 작업의 역할 계약상 다른 작업의 범위를 고칠 수 없어 그대로 두고 보고한다.

## 위험과 후속

1. **`npm run check`는 TASK-096이 마무리되어야 초록으로 돌아온다.** TASK-096은 `in_progress`인데
   lease가 만료된 채로 멈춰 있다. 이 작업의 QA에서 프런트엔드 게이트를 통과 기준으로 삼으면 TASK-096
   때문에 막힌다. 위 귀속 근거로 분리해서 봐 달라.
2. 설치본 `.workflow/rules/workflow.md`는 아직 `rules_version: 7`이다. 상수가 9가 되었으므로 앱이
   다음에 설치를 돌릴 때 7 → 9로 따라 올라간다. 이 작업은 설치본을 직접 고치지 않았다(범위 밖).
   설치본에는 아직 지운 불릿이 남아 있다 — 앱 설치 경로의 산출물이라 그 경로로만 갱신된다.
3. `ROLE_RULES_VERSION`(5)과 architect·developer 본문(4)이 서로 다른데, 이건 원래 설계다(상수 주석이
   "세 개의 최댓값"이라고 적는다). 이번 변경과 무관하다.
4. SPEC-030 완료 조건 11(실저장소 세 역할 판정 전후 동일)은 TASK-097 소유다. 이 작업은 스크립트
   판정 코드를 만지지 않아 판정에 영향이 없다.

## 역할 밖 발견 (핸드오프 노트)

- **TASK-096이 만료된 lease와 함께 `in_progress`로 남아 있다.** 트리에 반쯤 끝난 변경분이 있고
  프런트엔드 게이트를 깨고 있다. 개발자 자격 판정상 `todo`가 아니라 이 세션이 집을 수 없다. 사용자가
  그 세션을 다시 돌리거나 상태를 정리해 주어야 한다.
- 위 문제로 TASK-099·TASK-100도 `depends_on`이 미충족이라 대기 중이다(TASK-096이 `qa_waiting`이나
  `completed`가 되어야 풀린다).
