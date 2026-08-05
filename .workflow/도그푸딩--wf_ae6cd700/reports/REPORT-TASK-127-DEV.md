# TASK-127 개발자 핸드오프 (qa_waiting)

## 결정권자 요약

승인이 끝난 기획서에도 수정 요청을 보낼 수 있게 됐다. 정확히는 앱 안쪽의 기록 경로가 그것을
받아들이게 됐고, 누르는 자리는 다음 작업이 만든다.

열린 칸은 하나뿐이다. 승인된 기획서에 후속 수정 요청만 허용하고, 재승인과 폐기는 지금처럼 막는다.
막힌 열한 칸을 전부 조합으로 확인했고, 거절될 때 결정 문서가 늘지 않는 것까지 봤다.

승인 뒤에 수정 요청이 붙은 기획서는 이 프로젝트에 아직 한 건도 없었다. 그 상태를 실물로 만들어
세 역할의 대기 물량 판정이 무엇을 답하는지 처음 확인했다 — 그 수정 요청이 기획자 몫이 되고,
파생 작업이 없던 승인은 아키텍트 몫에서 빠지며, 이미 파생된 작업은 개발자 몫으로 그대로 남는다.
앱의 판정과 조건 스크립트가 세 역할 모두에서 같은 답을 냈다. 판정 본문은 한 줄도 고치지 않았다.

지금 필요한 것은 QA 확인이다. 볼 화면이 없는 작업이라 확인은 숫자를 믿는 일이 되고, 무엇을 어떻게
확인했는지는 작업 문서의 확인 동선에 적어 두었다. 두 게이트 모두 통과한 상태로 넘긴다.

---

- 대상: TASK-127 (승인된 기획서에 후속 수정 요청을 기록하는 길이 쓰기 경로에 난다)
- 근거: SPEC-042 R1·R2·R6·R8 / DECISION-FB4A8439 (`schema: workflow-labs/decision@1`,
  `spec_id: SPEC-042`, `outcome: approved`, `created_by: user`,
  `created_at: 2026-08-05T09:06:39.470527+00:00`) — 이 세션 시작 시점에 SPEC-042의 최신 결정이다.
- 세션: 2026-08-05T10:52Z~11:10Z. 죽은 세션 인수 아님(`todo`에서 집었다).
- 선점: `sh .workflow/rules/wf-claim.sh acquire TASK-127 developer-claude 45` → exit 0,
  `lease_id: lease-90466-20260805105211`. 작업 중 `renew` 2회(전부 exit 0), 종료 시 `release`.
- 기기: Apple M2 / macOS 26.5.2 (arm64).

## 선택 경위

`sh .workflow/rules/wf-eligible.sh developer` → `eligible`/0. 미완료 작업 11건 중 개발자 후보는
넷이었다 — TASK-121·TASK-122·TASK-126·TASK-127. 나머지 넷(TASK-123·124·128·129)은 선행 미충족,
셋(TASK-119·120·125)은 `qa_waiting`이다. `in_progress` 작업이 하나도 없어 인수 대상은 없었고,
미만료 lease도 없어 겹침으로 막힌 작업도 없었다(`SPEC-009.yml`이 유일한 lease 파일이고
2026-08-03T01:20:00Z에 만료됐다).

넷 중 TASK-127을 집은 이유는 선행이 없고 범위 파일이 하나이며 SPEC-042 사슬의 맨 앞이라
TASK-128·TASK-129를 함께 여는 자리이기 때문이다. 계약이 순서를 정하지 않는 구간이므로 판단이다.

## 바꾼 것

범위 파일 하나, `src-tauri/src/infrastructure/fs_project_repository.rs`다.

### 1. 판정이 두 값을 받는다 (R1·R2)

`record_spec_decision`이 `apply_latest_decision` 뒤에 보던 조건이 `spec.status != "user_review"`
하나였다. 상태만 보고 보내려는 결정 종류를 보지 않았다. 그 자리를 함수 하나로 옮겼다.

```rust
fn spec_decision_is_allowed(status: &str, outcome: &SpecDecisionOutcome) -> bool {
    matches!(
        (status, outcome),
        ("user_review", _) | ("approved", SpecDecisionOutcome::RevisionRequested)
    )
}
```

- 허용은 두 칸이다 — `user_review` 행 셋과 `approved` 행의 수정 요청 하나. 나머지 열둘과 표에 없는
  상태값은 전부 막는다. 표에 없는 상태값은 `_` 갈래가 받는다.
- 판정이 한 자리에 있다. 화면이 여는 조작과 대조할 기준이 이 함수 하나다(기획서 완료 조건 5의
  대조가 여기를 본다).
- `validate_decision`은 손대지 않았다. 코멘트 필수와 2,000자 상한이 그대로이고, 수정 요청은 이미
  코멘트가 필수인 쪽이다.
- 결정 문서를 쓰는 코드는 한 줄도 고치지 않았다. 고쳐지지 않았다는 것을 완료 조건 2의 테스트가
  프론트매터를 읽어 확인한다.

### 2. 거절 문면 (R6)

`ProjectError::SpecNotAwaitingDecision`의 `#[error(...)]` 문자열만 바꿨다. **열거값 이름은
그대로다** — 그래야 기존 테스트가 수정 없이 통과한다(완료 조건 4).

| | 문면 |
| --- | --- |
| 전 | 사용자 선택 대기 상태인 기획서만 승인·수정 요청·폐기할 수 있습니다. |
| 후 | 사용자 선택 대기 상태인 기획서에는 승인·수정 요청·폐기를, 승인된 기획서에는 수정 요청만 보낼 수 있습니다. 그 밖의 조합은 기록하지 않습니다. |

옛 문면은 이 변경 뒤에 사실이 아니다. 새 문면은 허용 두 칸을 말하고 나머지가 막힌다고 말한다.
`src/`·`docs/`·`.workflow/rules/` 어디에도 옛 문면을 복사한 자리는 없다(`grep` 0건).

### 3. 테스트 다섯

전부 같은 파일의 테스트 모듈에 넣었다.

| 테스트 | 닫는 완료 조건 |
| --- | --- |
| `records_a_follow_up_revision_request_on_an_approved_spec` | 1 |
| `a_follow_up_revision_request_writes_the_same_decision_frontmatter` | 2 |
| `refuses_every_spec_decision_the_table_blocks` | 3·5 |
| `a_follow_up_revision_request_moves_the_approval_out_of_architect_work` | 7(가)(나) |
| `a_follow_up_revision_request_leaves_the_derived_task_to_the_developer` | 7(다) |

헬퍼 넷을 함께 넣었다.

- `spec_in_state(status)` — 기획서 하나를 표의 한 행 상태로 만든 픽스처. `draft`·`user_review`는
  결정이 없고, 나머지 셋은 그 값의 결정 하나가 최신이다. 만든 상태가 맞는지를 픽스처 자신이
  `spec_status_after_latest_decision`으로 단언한다.
- `decision_count(workflow_root)` — 결정 문서 수.
- `pending_work_matching_condition_script(root)` — 앱의 `pending_work`와 조건 스크립트 종료 코드를
  세 역할에서 대조하고 앱의 판정을 낸다.
- `write_spec_with_status` / `app_recorded_decision_text` — 기존 `write_spec`과
  `app_recorded_decision`에서 갈라낸 것이다. 두 기존 헬퍼는 새 헬퍼를 부르는 형태로만 바뀌었고
  호출부와 동작은 그대로다.

## 조합 표 검증 (완료 조건 1·2·3·5)

### 막힌 칸 열하나

`refuses_every_spec_decision_the_table_blocks`가 픽스처를 행마다 새로 만들어 열한 조합을 돈다.
각 조합에서 (가) `ProjectError::SpecNotAwaitingDecision`으로 거절되고 (나) 결정 문서 수가 호출
전후로 같고 (다) 거절 문면이 허용 칸을 말하는지를 본다.

| 지금 상태 | 승인 | 수정 요청 | 폐기 |
| --- | --- | --- | --- |
| `draft` | 막힘 ✓ | 막힘 ✓ | 막힘 ✓ |
| `user_review` | 허용(기존 테스트) | 허용(기존 테스트) | 허용(기존 테스트) |
| `approved` | 막힘 ✓ | **허용 ✓(이번 변경)** | 막힘 ✓ |
| `revision_requested` | 막힘 ✓ | 막힘 ✓ | 막힘 ✓ |
| `rejected` | 막힘 ✓ | 막힘 ✓ | 막힘 ✓ |

`user_review` 행 셋은 기존 테스트가 이미 덮고 있어 새로 쓰지 않았다(완료 조건 8, R9).

### 열린 칸 하나

`records_a_follow_up_revision_request_on_an_approved_spec`이 확인하는 것 넷.

1. 호출이 `Ok`로 끝난다.
2. 결정 문서가 1건에서 2건이 된다.
3. 그 기획서의 화면 상태가 `revision_requested`가 된다 — 반환된 요약과
   `spec_status_after_latest_decision` 양쪽에서 같다.
4. 기존 승인 결정 파일(`DECISION-APP.md`)이 그 자리에 그대로 있다. 감사 로그는 덧쓰기만 한다.

### 쓰인 결정 문서의 모양

`a_follow_up_revision_request_writes_the_same_decision_frontmatter`가 앱이 방금 쓴 문서를 읽어
프론트매터 키를 순서째로 단언한다.

```
schema, id, spec_id, outcome, created_by, created_at
```

여섯이고 새 필드가 없다. 값도 `schema: workflow-labs/decision@1`, `spec_id: SPEC-001`,
`outcome: revision_requested`, `created_by: user` 넷을 그대로 확인한다.

## 세 역할 판정 (완료 조건 6·7)

승인 뒤에 수정 요청이 붙은 기획서는 이 저장소에 0건이라(SPEC-042 확인 사실 11) 그 상태에서
판정이 돌아본 적이 없다. 픽스처 둘로 그 상태를 만들고 앱과 조건 스크립트를 대조했다. 대조 어법은
같은 파일의 `a_closed_idea_is_not_planner_work_in_either_judgement`과 같다 — `role_eligibility.rs`의
대조 헬퍼는 자기 테스트 모듈 안에 있어 다른 모듈에서 부를 수 없다.

### 픽스처 A — 파생 작업이 없는 승인 ((가)(나))

| 시점 | planner | architect | developer |
| --- | --- | --- | --- |
| 후속 수정 요청 전 | false | **true** | false |
| 후속 수정 요청 후 | **true** | **false** | false |

(나)가 여기서 읽힌다. 승인이 최신 자리에서 밀려나 아키텍트 대기 물량에서 빠지고, 그 수정 요청이
곧바로 기획자 대기 물량이 된다. 두 시점 모두 세 역할에서 조건 스크립트의 종료 코드와 일치했다.

### 픽스처 B — 그 승인에서 파생된 작업이 있는 경우 ((가)(다))

`TASK-001`(`todo`, `source_decision_id: DECISION-APP`, `scope_files: []`)을 심었다.

| 시점 | planner | architect | developer |
| --- | --- | --- | --- |
| 후속 수정 요청 전 | false | false | **true** |
| 후속 수정 요청 후 | **true** | false | **true** |

(다)가 여기서 읽힌다. 파생 작업은 그대로 개발자 후보로 남고 상태도 `todo` 그대로다 — 앱이
되돌리거나 닫지 않는다. 아키텍트가 두 시점 모두 false인 것은 그 승인에 이미 파생 작업이 있기
때문이고, 그래서 (나)를 픽스처 A로 따로 봤다.

**두 픽스처 · 네 시점 · 세 역할 열두 대조가 전부 일치했다.** 앱과 스크립트가 갈라진 자리는 없다.

### 판정 본문 불변

`role_eligibility.rs`와 조건 스크립트 두 본문(`heartbeat_condition.rs`)은 이 세션이 **열지도
않았다**. 아래 "변경 파일"의 실측이 근거다. `CONDITION_SCRIPT_VERSION`도 그대로다.

## 게이트 (완료 조건 11)

| 검사 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **통과** — 504 passed, 0 failed, 0 ignored |
| `npm run check` | **통과** — 22 files, 642 tests passed, build ok |
| `cargo fmt -- --check` (범위 파일) | 범위 파일 차이 0건 |
| `cargo clippy --all-targets` | 경고·오류 0건 |

`cargo fmt`는 크레이트 전체에는 차이를 낸다. 그 차이는 전부 이 세션이 열지 않은 파일
(`heartbeat_version_service.rs`·`commands/heartbeat.rs` 등)의 것이라 손대지 않았다. 범위 파일에
난 두 자리는 내 편집이 만든 것이라 직접 맞췄다.

### 테스트가 헛돌지 않는다는 확인

새 테스트가 변경 없이도 통과하는 종류가 아닌지 봤다. 판정 호출 한 줄만 옛 조건
(`spec.status != "user_review"`)으로 임시로 되돌려 돌리자 **네 건이 실패했다** — 새로 연 칸을
확인하는 넷이다. 확인 뒤 파일을 백업본에서 그대로 되돌렸고, 되돌린 상태에서 504건이 다시 통과한다.
`refuses_every_spec_decision_the_table_blocks`는 그때도 통과한다. 막힌 칸만 보는 테스트라 옛
조건에서도 같은 답이 나오는 것이 맞다.

## 변경 파일 (완료 조건 9·10)

세션 시작(10:52Z) 이후 수정된 파일을 `find -newermt`로 확인했다. 빌드 산출물(`target/`·`dist/`·
`node_modules/`)을 뺀 전부가 아래 넷이다.

| 파일 | 성격 |
| --- | --- |
| `src-tauri/src/infrastructure/fs_project_repository.rs` | 범위 파일. +370 / -21 |
| `.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-127.md` | 상태·이력·요약·확인 동선 |
| `.workflow/.runtime/leases/TASK-127.yml` | 선점 헬퍼가 쓴 lease |
| `tsconfig.tsbuildinfo` | `npm run check`의 빌드 산출물 |

여기에 이 보고서와 개발 로그 항목이 더해진다.

- **`role_eligibility.rs`·`heartbeat_condition.rs` 둘 다 목록에 없다.** 판정 본문과 조건 스크립트
  두 본문이 이 변경분에서 달라지지 않았다(완료 조건 6).
- **`.workflow/rules/*`와 `docs/file-contract.md`도 목록에 없다.** 역할 계약 문언과 파일 계약
  문서가 달라지지 않았다(완료 조건 10).
- 범위 파일의 `HEAD` 대비 변경분에서 삭제된 `#[test]` 줄이 0건이고 `#[ignore]` 추가도 0건이다
  (완료 조건 9). 삭제로 잡히는 함수 줄은 `app_recorded_decision` 시그니처 하나인데, 그 함수는
  주석이 바뀌어 그렇게 보이는 것이고 지금도 같은 이름으로 있다.

작업 트리에는 이 세션 전부터 다른 작업들의 미커밋 변경이 45개 파일에 걸쳐 있다. 위 실측은 그것과
이 세션의 몫을 가르기 위한 것이다.

## 남는 리스크

1. **화면은 아직 이 칸을 열지 않는다.** `SpecWorkspace.tsx`의 결정 도구는 여전히 `user_review`
   에서만 그려지므로, 사용자가 앱에서 후속 수정 요청을 보낼 수 있게 되는 것은 TASK-128이 착지한
   뒤다. 지금 상태에서 쓰기 경로만 넓어진 것은 기획서 완료 조건 5가 요구한 순서 그대로다 —
   화면이 먼저 열리면 사용자가 버튼을 누르고 오류를 본다.
2. **거절 문면을 문자열로 단언했다.** `refuses_every_spec_decision_the_table_blocks`가 문면의
   일부(`승인된 기획서에는 수정 요청만`)를 확인한다. 문구를 다듬으면 이 테스트가 먼저 걸린다.
   의도한 결합이다 — R6이 요구하는 것이 문면과 규칙의 일치이므로, 문구를 바꿀 때 규칙과 맞는지
   다시 보게 만드는 자리가 필요하다.
3. **후속 수정 요청을 취소할 길은 여전히 없다.** 수정 요청 상태에 후속 결정을 얹는 칸을 이 표가
   막기 때문이다(SPEC-042 확인 필요 2번의 승인된 선택). 잘못 보내면 답이 될 기획서가 나올 때까지
   기다리는 수밖에 없다. 새로 생긴 위험이 아니라 지금과 같은 상태다.

## 후속 (역할 밖 발견)

1. **`cargo fmt`가 크레이트 전체에 차이를 낸다.** 이 세션이 열지 않은 파일 최소 셋
   (`application/heartbeat_version_service.rs`·`commands/heartbeat.rs`와 그 외)에 rustfmt 차이가
   남아 있다. 지금 CI가 `cargo fmt --check`를 돌리지 않아 드러나지 않는 것으로 보인다. 손대지
   않았다 — 무관한 파일이고 이 작업의 몫이 아니다.
2. **TASK-128이 대조할 기준.** 화면이 여는 조작은 `spec_decision_is_allowed`의 두 갈래와 같아야
   한다(기획서 완료 조건 5). 그 함수가 판정을 한 자리에 모아 둔 것이 그 대조의 재료다.
3. **`SPEC-042`는 아직 `user_review`다.** 파일의 `status`가 그렇고 결정은 승인 둘
   (`DECISION-6C1F8B55`·`DECISION-FB4A8439`)이라 화면 상태는 승인이다. 계약대로 앱이 상태를
   덮어쓰는 구조이므로 손대지 않았다.

## 사용자 QA 제안

작업 문서의 `## 확인 동선`에 무엇으로 확인했는지 적어 두었다. 화면이 없는 작업이라 확인 도장은
"이 숫자들을 믿는다"는 뜻이 된다. 화면에서 직접 누르는 확인은 TASK-128이 착지한 뒤에 온다.
