# TASK-088 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(tl-dev-087, TASK-088 담당 재배정)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T10:36Z, TL 세션)

- 대상: TASK-088 (공통 규칙에 대리 결정 요건과 재가 절차를 넣고 rules_version을 올린다)
- 원천: SPEC-028 R1·R2·R3문언·R5문언·R6 / DECISION-2A9D7B31 (`outcome: approved`, `created_by: user` 직접 확인)
- 선행: TASK-086·TASK-087 둘 다 `qa_waiting` 확인.
- 상태: `in_progress`(10:20:58Z) → `qa_waiting`(10:30:25Z). 선점 exit 0 / renew exit 0 / release exit 0.

## 결론부터: blocked 아님. 부분 착지로 완료했다

TL이 상신한 항목 둘 중 **하나는 애초에 이 작업의 완료 조건이 아니었고, 하나는 실측해 보니 절반만 참이라 참인 만큼만 적었다.**

1. **"재가는 두 번째 작업 세트를 만들지 않는다"는 TASK-088의 완료 조건에 없다.** 완료 조건 14개를 전부 대조했다 — R4는 이 작업의 조건 목록에 들어와 있지 않다. 작업 문서 "왜 이 작업이 마지막인가"가 그 문장을 순서 근거로 언급할 뿐이다. TASK-086 보고서 5절이 그 문장을 거짓으로 판정했으므로 **한 글자도 적지 않았다.** 계약 본문 어디에도 재가와 이중 분해를 연결하는 문장이 없다. blocked 사유가 성립하지 않는다.

2. **완료 조건 8("남긴 파일이 판정에 끼어들지 않는다")은 무조건 참이 아니다 — 실측했다.** 작업 문서는 "TASK-086이 그것을 참으로 만들었다"라고 적었지만, 아키텍트 분기에서만 참이고 기획자 분기에서는 거짓이다. 그래서 **범위를 명시한 형태로 적었다.**

## 실측: 남긴 대리 결정 파일이 판정에 끼어드는가

추정하지 않고 스크립트를 돌렸다. 픽스처는 임시 디렉터리에 만들었고 저장소 파일은 읽기만 했다.

**기획자 분기 — 끼어든다.** SPEC-X에 `DECISION-REV`(`revision_requested`, `created_by: user`, 08-01)만 있을 때 `planner exit=0`(eligible). 여기에 `DECISION-DELEGATE`(`approved`, `created_by: user-delegate`, 08-02) 하나를 더하자 **`planner exit=1`(no-target)**. 원인은 `heartbeat_condition.rs:150`~`:158`의 비교 대상 루프에 `created_by` 필터가 없다는 것이다. 앱의 `latest_revision_requests`는 `read_spec_decisions`(`:1579`)가 거른 목록만 받으므로 그 수정 요청을 여전히 최신으로 센다. **즉 앱과 하트비트가 갈린다.** TASK-086 보고서 후속 3번이 "비대칭이 남는다"로 예고한 자리이고, 이번에 실행값으로 확인됐다.

**아키텍트 분기 — 안 끼어든다.** 상수에서 버전 6 본문을 추출해 돌렸다. (가) 대리 승인 하나만 있는 기획서: v6 `no-target`(1), 착수 전 설치본 v4는 `eligible`(0) — TASK-086이 닫은 자리다. (나) 앱 승인 + 파생 작업이 있는 기획서에 남긴 대리 결정을 더해도 전후 모두 `no-target`(1) — 최신 자리를 뺏지 않는다.

**앱 — 안 끼어든다.** 기획서 결정을 읽는 경로가 전부 `read_spec_decisions` 하나에서 갈라진다(`spec_references`·`latest_spec_decisions`·`latest_revision_requests`·`latest_approvals`·`spec_decision_events`·`apply_latest_decision`). TASK-086이 새로 넣은 `latest_approvals`도 같은 목록을 받는다. TASK-087이 이 성질을 테스트로 고정해 뒀다.

그래서 계약에 이렇게 적었다 — "Two judgements ignore it and one does not"로 셋을 각각 나열하고, 기획자 분기가 `created_by`를 안 읽어 대리 결정이 수정 요청을 하트비트에서 가린다는 것과 그동안 앱과 하트비트가 갈린다는 것을 명시했다. 작업 문서가 요구한 "'남아 있지만 앱은 모르는 문서'가 생기는 것을 문언이 감추지 않는다"에 정확히 부합하고, 거짓 문장은 넣지 않았다.

## 변경 파일 (하나)

`src-tauri/src/infrastructure/project_instructions.rs`

- `:21` `WORKFLOW_RULES_VERSION` 7 → 8 (착수 시점 값을 읽고 +1).
- `:48` `WORKFLOW_RULES` 본문 프론트매터 `rules_version` 7 → 8.
- `:64`~`:107` §2 개정 + `### Delegated decisions` + `### Ratifying a delegated decision` 두 하위 절 신설.
- 테스트 단언 `rules.contains("rules_version: 7")` → `8` **일곱 곳**(현재 줄 `:694`·`:716`·`:752`·`:776`·`:818`·`:856`·`:887`).

**작업 문서와 다른 점 하나:** 문서는 이 단언이 둘(`:662`·`:684`)이라고 적었으나 실제로는 일곱이다. 분해 이후 이 파일에 테스트가 늘었다. 값을 가정하지 말라는 지시대로 착수 시점 값을 세어 전부 갱신했다. 오래된 픽스처 입력값(`rules_version: 4`·`3`·`2` — 구버전 설치본을 흉내 내는 문자열)은 그대로 뒀다.

워크플로우 문서는 `tasks/TASK-088.md` 하나(상태·`updated_at`·history 3행). 그 외 파일 무변경. git commit/push/checkout/stash 안 했다.

## 핵심 결정과 근거

1. **예외와 금지를 같은 자리에 뒀다.** 새 절을 문서 끝이 아니라 §2 바로 밑 하위 절로 넣었다. 작업 문서가 지적한 실패 모드가 "§2가 금지만 적고 예외를 안 적어 해석이 갈렸다"인데, 예외를 다른 절로 떼면 같은 일이 방향만 바꿔 재발한다. §2 불릿에서 "a delegated decision, as defined below"로 걸어 두 문장이 함께 읽히게 했다.
2. **제목은 번호 없이 달았다.** 기존 §5가 `### Ideas and specifications` 식이라 `### 2.1`을 쓰면 이 문서에서 혼자 다른 어법이 된다. 본문 참조도 "as defined below"로 맞췄다.
3. **"유효하지 않다"를 결과까지 적었다.** "not a decision"만으로는 발견한 세션이 무엇을 해야 하는지가 안 나온다. "It approves nothing, no work may be derived from it, and a session that finds one reports the gap instead of acting on it"으로 행동까지 적었다.
4. **DECISION-4E8C1D67의 두 실패 모드를 각각 문장으로 박았다.** 지어낸 승인(§2 마지막 불릿의 "recording a delegated decision for a delegation the user never gave")과 **위임은 진짜였는데 문서가 안 된 경우**(§2.1 마지막 문단)를 나눠 적었다. 후자가 그 사례의 실제 모양이고 지금 §2가 안 겨누던 쪽이다.
5. **역할 계약 세 파일은 손대지 않았다.** 기획서 제외 범위대로 문언은 두고 구현을 문언에 맞추는 쪽(TASK-086)이 이미 끝났다.

## 완료 조건 대조 (14개)

| # | 결과 | 근거 |
| --- | --- | --- |
| 1 | 충족 | "The body records how the delegation was given, when the user gave it, and what it covers." — 경위·시각·범위 셋 |
| 2 | 충족 | "`created_by` is `user-delegate`." TASK-086 확정값·TASK-087 픽스처와 같은 문자열 |
| 3 | 충족 | "A record that misses any of these is not a decision. It approves nothing, no work may be derived from it…" |
| 4 | 충족 | 본문 §2 세 줄 전후 대조(아래) |
| 5 | 충족 | 금지 유지 인용(아래) |
| 6 | 충족 | 판정 대입 두 건(아래) |
| 7 | 충족 | `### Ratifying a delegated decision` 절 전체 |
| 8 | **범위 명시로 충족** | 남긴다 + 셋 중 둘이 무시하고 하나가 안 무시함을 나열. 위 실측 참조 |
| 9 | 충족 | `WORKFLOW_RULES_VERSION = 8`(`:21`), 본문 `rules_version: 8`(`:48`) |
| 10 | 충족 | `project_instructions` 테스트 **14 passed / 0 failed** (설치·검증 경로 포함) |
| 11 | 충족 | 역할 계약 무변경(아래) |
| 12 | 충족 | 단독 편집 확인(아래) |
| 13 | 충족 | 이 파일 `#[test]` 14 → 14(순증 0, 삭제 0), `#[ignore]` 0건. 단언은 갱신만 |
| 14 | 충족 | 게이트(아래) |

### 완료 조건 4 — §2 세 줄 전후 대조

| 전 | 후 |
| --- | --- |
| "The app owns `project.yml`, every `workflow.yml`, `.workflow/.runtime/`, and `decisions/*.md`." | 그대로 (무변경) |
| "A user decision is valid only when the app recorded it in a decision document with `created_by: user`." | "A decision the app recorded carries `created_by: user`. Only the app writes that value. It is the user's own stamp, and a decision carrying it needs nothing further to be valid." + 새 불릿 "An agent may write one other kind of decision document and only one: a delegated decision, as defined below, carrying `created_by: user-delegate`. Anything else an agent writes decides nothing." |
| "Do not approve, reject, archive, migrate, or impersonate a user through a Markdown edit." | 같은 문장 유지 + "Writing `created_by: user` yourself is impersonation, and so is recording a delegated decision for a delegation the user never gave." |

바뀐 것은 둘째 줄의 어법이다. "앱이 기록한 것만 유효"를 "앱 도장은 `created_by: user`이고 그것만으로 유효, 에이전트가 쓸 수 있는 결정은 대리 결정 한 종류뿐"으로 갈랐다. 금지가 예외로 뒤집히지 않게 셋째 줄에 사칭의 정의를 두 갈래로 붙였다.

### 완료 조건 5 — 금지가 유지된다는 인용

> Do not approve, reject, archive, migrate, or impersonate a user through a Markdown edit. Writing `created_by: user` yourself is impersonation, and so is **recording a delegated decision for a delegation the user never gave**.

그리고 §2.1에 "An agent never delegates to itself, and an instruction from another agent is never a user delegation."

### 완료 조건 6 — 판정 대입 (건수는 규칙으로 셈)

건수를 상수로 안 적고 `created_at` 표기로 셌다. **총 29건 / 앱 형식 8건 / 수기 21건 / `user-delegate` 0건.** 앱 형식 8건은 SPEC-001·002·003·004·009·019·020·021의 결정으로 확인 사실 5의 불가침 집합과 정확히 일치하고 늘지 않았다. 기획서 작성 시점 17건이 21건으로 는 것도 확인된다.

**(가) DECISION-4E8C1D67 (필수 지정):** `created_by: user`, `created_at: 2026-08-04T09:38:00Z`(초 단위 Z → 수기). 판정 = **유효한 대리 결정이 아니다.** 첫 요건(`created_by`가 `user-delegate`)에서 탈락한다. 본문은 경위·시각·범위를 다 적고 있어 둘째 요건은 만족하지만 값 하나로 갈린다. 그래서 마지막 문단이 답한다 — 규칙 이전에 적힌 문서라 앱은 여전히 자기 도장과 구분 못 해 승인으로 읽고, 그래서 재가 경로가 그 문서에 닿지 않으며, `created_by`는 앱의 필드이므로 고쳐 쓰지 말고 간극을 보고하라. **문언만으로 결정적인 답이 나온다.**

같은 사례의 앞 단계도 검증했다. TL이 위임 범위 안에서 포함을 결정하고도 결정 문서 없이 TASK-065 배정에 지시로 실었던 국면 — 새 문언의 "A delegation described in a task assignment, a report, or a message approves nothing until it exists as a decision document"와 "A session told to proceed on an approval that has no decision document must refuse and report it. Refusing is what this contract asks for, not an overstep."가 **TASK-065의 거부를 옳은 행동으로 유지한다.** TL이 지적한 "'TL이 지시했으면 따른다'로 읽히면 안 된다"가 문언에서 막힌다.

**(나) DECISION-2A9D7B31 (임의 선택 — 이 작업 자신의 근거 결정):** `created_by: user`, `created_at: 2026-08-04T09:32:00Z`(수기). 판정 = **유효한 대리 결정이 아니다.** 같은 이유이고 같은 문단이 답한다. 이 문서 자신이 본문에 "이 기획서가 구현하는 재가 절차가 가동되면 이 결정을 포함한 수기 결정 전체가 소급 재가의 대상"이라고 적었는데, 새 문언은 그 기대를 **정정한다** — `created_by: user`인 채로는 앱이 승인으로 읽어 재가 도장이 안 찍힌다. 계약이 그 사실을 감추지 않는다.

### 완료 조건 11 — 역할 계약 무변경 (심볼 단위)

줄 번호가 밀리므로 상수 이름으로 본문을 추출해 착수·종료 해시를 대조했다.

- `PLANNER_RULES` `af85880dc94f7d42242781f67630f412` → 동일
- `ARCHITECT_RULES` `4c5bb24edc3d8973fd6a72468c6f3a7a` → 동일
- `DEVELOPER_RULES` `13739115e2183803c3b639fecaab949c` → 동일
- `ROLE_RULES_VERSION` = **5** (착수 시점과 같음), 본문 `rules_version`은 planner **5** / architect **4** / developer **4**
- `architect.contains("rules_version: 4")`·`developer.contains(…4)`·`planner.contains(…5)` 단언 전부 **수정 없이 통과**
- `AGENTS_BLOCK`·`CLAUDE_BLOCK`(관리 블록)도 그대로, 본문이 세션 시작 때 읽은 것과 문자 단위로 동일

(주의: 중간에 이 두 관리 블록 해시가 달라 보인 적이 있는데, 추출 종료 패턴이 `-->"#;`로 끝나는 줄을 못 잡아 뒤 상수까지 빨아들인 도구 버그였다. 경계를 고쳐 재확인했고 실제 변경은 없다. 판정을 도구 결함으로 오염시키지 않으려고 적어 둔다.)

### 완료 조건 12 — 단독 편집

작업 문서 전체에서 `project_instructions`를 언급하는 것은 15건인데 13건이 `completed`, 나머지가 TASK-086(`qa_waiting`)과 이 작업이다. TASK-086은 `:148`의 **범위 밖** 절에서 "계약 문언 개정과 `rules_version` 인상. TASK-088이 한다"로 넘겼을 뿐이고, 그 보고서도 `project_instructions.rs`·`WORKFLOW_RULES_VERSION`·`ROLE_RULES_VERSION` 무변경을 명시한다. SPEC-028 파생 셋(086 `qa_waiting` / 087 `qa_waiting` / 088) 중 이 파일을 **편집한 것은 이 작업 하나**다. TASK-041 선례 유지.

## 게이트 (실행값 그대로)

- `cargo test`: **392 passed / 0 failed / 0 ignored**
- `cargo test --lib project_instructions`: **14 passed / 0 failed** — `installs_rules_and_both_agent_entrypoints`, `validates_the_instructions_it_just_installed`, `upgrades_rules_installed_before_the_lease_role_field`, `upgrades_rules_installed_before_the_transition_history_contract`, `upgrades_managed_v1_rules_and_installs_role_contracts`, `refuses_to_downgrade_future_managed_rules` 포함. 설치·검증 경로가 새 버전 값으로 동작한다(완료 조건 10)
- `cargo fmt -- --check`: 내 파일 **청정**. `rustfmt --check src/infrastructure/project_instructions.rs` **exit 0, 출력 없음**. 크레이트 전체로는 `heartbeat_status.rs` 한 파일만 걸리는데 타 세션 미커밋 변경이라 안 건드렸다(`cargo fmt` 미실행 — 남의 in-flight 파일을 재포매팅하게 된다)
- `cargo clippy --all-targets -- -D warnings`: `heartbeat_process.rs:216` `cloned_ref_to_slice_refs` **1건**으로 실패. TL이 타 세션 소유로 지정한 그 건이고 **`project_instructions.rs` 진단은 0건**
- `npm run check`: **18 test files / 456 passed**, `tsc -b && vite build` 성공

성공 판정: 신규·갱신 단언 전부 통과 + 기존 테스트 무삭제·무비활성 + 백엔드 실패 0. clippy 1건은 타 세션 신규 파일 소유.

## 후속 / 리스크

1. **(상신) 기획자 분기의 `created_by` 비대칭이 계약에 적힌 채로 남았다.** 실측으로 확인한 실제 갈림이고, 계약이 지금 "Until that branch reads `created_by` too, the app and the heartbeat disagree"라고 자기 결함을 명시한다. 이건 임시 문언이어야 한다 — 기획자 분기 비교 루프(`heartbeat_condition.rs:150`~`:158`)에 아키텍트 분기와 같은 두 줄을 넣으면 닫히고, 그때 이 문장을 지우면서 `rules_version`을 9로 올리면 된다. SPEC-028 제외 범위(SPEC-023 겹침)라 이번에 안 건드렸다. **후속 아이디어로 올릴 것을 권한다.**
2. **설치본 `.workflow/rules/workflow.md`는 아직 `rules_version: 7`이다.** 앱이 다음에 `install_project_instructions`를 돌릴 때 8로 갱신된다. TASK-086의 조건 스크립트 설치본(버전 4)과 같은 상황이고 같은 선례를 따라 손으로 안 고쳤다. 완료 조건 1·2·3·7·8의 "설치본 본문 확인"은 그래서 **상수 본문과 설치 테스트의 단언으로 대신했다** — QA 시 앱을 한 번 띄우면 설치본이 8로 올라가면서 육안 확인이 가능해진다.
3. **`user-delegate`를 단 결정은 아직 0건이다.** 새 규칙은 앞으로 적히는 문서에만 걸린다. 기존 수기 21건은 `created_by: user`라 앱이 승인으로 계속 읽고 재가 경로가 안 닿는다 — 계약이 그 사실을 명시하지만 간극 자체는 남는다. 소급 정리는 기획서 제외 범위다.
4. **`rules_version` 8과 설치본 7이 어긋난 동안** 검증 경로는 "설치본이 상수보다 낮으면 업그레이드"로 동작하므로 문제가 없다(`refuses_to_downgrade_future_managed_rules`가 반대 방향만 막는다). 다만 QA 전에 앱을 안 띄우면 에이전트 세션은 여전히 버전 7 본문을 읽는다 — 새 계약이 실제로 세션에 닿는 시점이 앱 설치 시점이라는 것을 QA에서 확인해 주면 좋겠다.
5. **`heartbeat_status.rs` fmt 위반과 `heartbeat_process.rs:216` clippy 위반은 타 세션 소유**로 남아 있다. 게이트를 완전 녹색으로 받으려면 그 세션들이 착지해야 한다.
