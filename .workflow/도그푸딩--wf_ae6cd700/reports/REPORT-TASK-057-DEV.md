# TASK-057 개발자 핸드오프

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.

- 대상 작업: TASK-057 (참조 기획서가 모두 반려로 끝난 아이디어를 네 번째 파생 상태로 판정한다)
- 근거 문서: SPEC-018 R6, DECISION-1224D86C (approved, created_by: user, 확인 필요 1번 = "구분만 한다")
- 세션 역할: 개발자 (TL 배정, 병렬 웨이브, 에이전트명 dev-057)
- 작성 시각: 2026-08-03T12:32Z
- 상태: `qa_waiting`

## 착수 조건 확인

- **선행 TASK-056 반영 실측.** `role_eligibility.rs:86`의 `has_planner_work`가 `idea.status == "inbox" && !lease_ids.contains(&idea.id)`다. `!= "adopted"`가 아니다. TASK-056 문서도 `qa_waiting`이다. 작업 문서가 "선행이 반영되지 않은 상태에서 시작하지 않는다"고 못박은 조건이 충족돼 있어 착수했다.
- `.workflow/.runtime/migration.lock` 없음.
- 선점 헬퍼 `.workflow/rules/wf-claim.sh`는 아직 미설치라(TASK-039 산출물) 공통 규칙 §4의 폴백을 썼다. `set -o noclobber`로 `leases/TASK-057.yml` 배타 생성(lease_id `lease-a7b1b458-a66d-4fc3-8515-6bb58e9d99e1`, 유효기간 45분, 만료 2026-08-03T13:08:06Z). 착수 시점 남의 lease는 `SPEC-009.yml`(만료), `TASK-043.yml`, `TASK-048.yml`이었고 하나도 건드리지 않았다.
- 선점 직후 실작업 전에 `TASK-057.md`를 `in_progress`로 옮기고 같은 편집에서 `history`에 `{ at: 2026-08-03T12:23:06Z, kind: in_progress }`를 append했다. 시각은 전부 `date -u`로 실측했다.

## 변경한 파일 (2건, 작업 범위 그대로)

- `src-tauri/src/infrastructure/fs_project_repository.rs`
  - `SpecReference`에 `is_rejected` 필드 추가.
  - `spec_references`가 `latest_spec_decisions` 결과를 한 번만 조회해 `is_draft`와 `is_rejected`를 같은 자리에서 낸다.
  - `derive_idea_states`의 판정 순서를 넷으로 늘렸다.
  - 테스트 6건 신규, 3건 확장.
- `src-tauri/src/domain/project.rs` — `WorkflowItemSummary::status`의 doc 주석 한 문단(파생값이 넷). 편집 직전에 파일을 다시 읽어 dev-048의 최신 상태 위에 얹었다.

범위 밖 무변경(한 줄도 안 건드림): `role_eligibility.rs`, `heartbeat_condition.rs`, `project_instructions.rs`, `scripts/wf-eligible.sh`, `docs/file-contract.md`, `src/features/projects/domain/types.ts`, 화면 전부.

## 판정 규칙

`derive_idea_states`의 앞 조건이 먼저 이긴다.

1. 참조 기획서도 선점도 없으면 `inbox`.
2. 미만료 lease가 선점했거나 참조 기획서 중 `draft`가 있으면 `drafting`.
3. 참조 기획서가 하나 이상이고 전부 최신 결정이 `rejected`면 `closed`.
4. 그 밖은 `adopted`.

`stalled_spec_ids`의 뜻과 채우는 조건은 바뀌지 않았다. `closed`에서는 빈 목록이다.

### 구현 결정 셋

**1. 반려 판정을 `latest_spec_decisions`에 얹었다.** 작업 문서 1절이 "결정 판정 규칙을 새로 쓰지 않는다"고 했고, `is_draft`가 이미 그 맵을 보고 있었다. `decided.contains_key`를 `decided.get(...).map(|(_, outcome)| outcome.as_str())` 한 번으로 바꿔 두 값을 같은 조회에서 냈다. 결정이 없으면 `None`이라 반려가 아니고, `rejected` 뒤에 다른 결정이 붙으면 그 맵이 이미 뒤엣것을 최신으로 들고 있어 반려가 아니다. TASK-056이 `latest_revision_requests`를 따로 둔 것과는 상황이 다르다 — 그쪽은 조건 스크립트와 동률 처리를 맞춰야 했고, 여기는 대조할 스크립트 판정이 없다. 이 판정은 앱 전용이고 스크립트는 `closed`라는 값을 알지도 못한다.

**2. 3번을 2번 뒤에 뒀다.** R6의 "반려가 섞여 있어도 살아 있는 기획서가 하나라도 있으면 종결이 아니다"가 그 순서로만 성립한다. 반려된 기획서와 `draft` 기획서가 함께 있으면 아직 쓰는 중이므로 `drafting`이고, 선점도 마찬가지다. 두 경우를 각각 테스트로 고정했다.

**3. `all_rejected`에 `referenced &&`를 함께 뒀다.** `Iterator::all`은 빈 반복자에서 참이라 그것만으로는 참조가 없는 아이디어까지 종결로 떨어진다. 실제로는 1번 가지가 먼저 잡아 도달하지 않지만, 조건 자체가 스스로 참이어야 다음 사람이 가지 순서를 바꿔도 무너지지 않는다.

## 테스트

신규 6건 (전부 `fs_project_repository::tests`):

| 테스트 | 고정하는 사실 |
| --- | --- |
| `treats_an_idea_as_closed_when_every_referenced_spec_ended_rejected` | 반려 기획서 둘만 참조하면 `closed` (완료 조건 1 / 기획서 18) |
| `keeps_an_idea_adopted_when_a_live_spec_sits_next_to_a_rejected_one` | 반려+승인, 반려+`user_review` 둘 다 `adopted` (완료 조건 2 / 기획서 19) |
| `prefers_drafting_when_a_draft_and_a_rejected_spec_share_an_idea` | 반려+`draft`는 `drafting`, 중단 근거는 `draft` 쪽 |
| `prefers_drafting_when_a_lease_preempts_an_otherwise_closed_idea` | 미만료 lease가 선점하면 `drafting` |
| `does_not_close_an_idea_whose_rejection_was_superseded` | `rejected` 뒤에 `approved`가 붙으면 `closed`가 아니다 |
| `a_closed_idea_is_not_planner_work_in_either_judgement` | `closed`만 있는 프로젝트에서 앱 판정 셋과 조건 스크립트 종료 코드 셋이 일치하고 기획자 대기가 없다 (완료 조건 3 / 기획서 20) |

기존 테스트 확장 3건:

- `treats_a_decided_spec_as_adopting_the_idea_for_every_outcome` → **`derives_the_idea_state_from_the_latest_decision_outcome`으로 이름을 바꿨다.** 이 테스트가 세 outcome 전부에 대해 `adopted`를 기대하고 있었고, 그중 `rejected`가 이 작업이 바꾸는 바로 그 판정이다. 삭제·비활성화·약화가 아니라 기대값 표를 셋 다 유지한 채(`approved`→`adopted`, `revision_requested`→`adopted`, `rejected`→`closed`) 강화한 것이다. 이름을 그대로 두면 "for_every_outcome as adopting"이 거짓이 되어 바꿨다. 테스트 목록 diff에서 이름 하나가 사라진 것처럼 보이는 유일한 항목이다.
- `reports_the_same_idea_state_from_the_list_and_the_full_read` — IDEA-004(반려 픽스처)를 더해 목록 조회와 전문 읽기가 `closed`에서도 같은 결론을 내는지 본다 (완료 조건 5).
- `inspecting_the_project_does_not_touch_the_workflow_files` — 아이디어·기획서·반려 결정 픽스처를 더했다. 조회 전후 `.workflow` 아래 모든 파일의 수정 시각이 같은지 보는 기존 성질에 새 가지가 지나가게 만든 것이다 (완료 조건 4 / 기획서 21).

`closed` 판정은 조회 시점 파생이다. 아이디어 파일에 쓰지 않고 새 프론트매터 필드도 새 원천도 만들지 않았다.

## 검증

착지 시점 실행 결과이고, TL 확인 요청으로 한 번 더 돌린 값도 같다.

| 게이트 | 결과 |
| --- | --- |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 종료 코드 0, diff 없음 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 344 passed / 0 failed / 0 ignored |
| `npm run check` | vitest 14 파일 315 tests passed, `tsc -b` + `vite build` 정상 |

내 범위 테스트 16건을 따로 돌려 전부 통과하는 것도 확인했다.

## 병렬 세션 때문에 겪은 것 (리스크 아님, 기록용)

세션 중반에 작업 트리가 두 번 빨간불이었고 둘 다 내 변경과 무관했다. 둘 다 dev-048(TASK-048)의 중간 상태였고, 그 세션이 착지하자 사라졌다.

1. `cargo check`가 `heartbeat_service.rs`·신규 `heartbeat_setup.rs`에서 E0432/E0061/E0308로 실패했다. `crate::domain::project::HeartbeatSetupStage/State/Step`이 아직 없는 상태에서 import가 먼저 들어와 있었다.
2. `npm run check`의 `tsc -b`가 `HeartbeatIntegration.setupStages` 누락으로 `useProjectWorkspace.test.ts`·`DreamCard.test.tsx` 픽스처에서 실패했다.

내 파일에는 두 경우 모두 에러가 하나도 없었고, 위 표의 수치는 양쪽이 해소된 뒤 돌린 값이다. `cargo fmt`의 `heartbeat_service.rs:322` 잔여 diff도 같은 착지와 함께 사라져 지금은 크레이트 전체가 clean이다.

## 남은 리스크와 핸드오프

- **작업 문서와 코드 실상이 어긋난 지점 하나.** 작업 문서 4절이 "`role_eligibility.rs`의 기존 대조 헬퍼를 쓰되 그 파일은 고치지 않는다"고 적었는데, 그 헬퍼(`assert_matches_condition_script`)는 `role_eligibility.rs`의 비공개 `mod tests` 안에 있어 다른 모듈에서 부를 수 없다. 부르려면 그 파일을 고쳐야 하고, 고치지 말라는 것이 같은 문장의 후단이다. 그래서 그 파일을 건드리지 않는 쪽을 택하고, 같은 대조(앱 `pending_work` 셋 vs 조건 스크립트 종료 코드 셋)를 내 테스트 모듈 안에서 했다. 픽스처는 `install_condition_script`로 스크립트를 설치한 뒤 `sh .workflow/rules/wf-eligible.sh <role>`을 실제로 돌린다. 고정하는 사실은 같고, 대조 코드가 두 곳에 생긴 것이 비용이다. TASK-058 이후에 이 대조를 공용 테스트 헬퍼로 뽑을지는 별도 판단이 필요하다 — 이 작업에서 정하지 않았다.
- **`closed`를 아는 곳은 아직 백엔드뿐이다.** `types.ts`의 아이디어 상태 유니온과 화면 라벨은 TASK-058이다. 그때까지 프런트가 `closed`를 받으면 어떻게 그리는지는 이 작업이 보증하지 않는다. 현재 화면은 `IdeaInbox.tsx`가 아직 두 갈래(SPEC-012 표시가 미착지)라 실사용 노출은 없다.
- **저장소에 실제 반려 결정은 여전히 0건이다.** 기획서 확인 사실 21번 그대로다. 이 판정은 픽스처로만 검증됐고, 실물 반려는 사용자가 기획서를 반려하는 순간 처음 생긴다.
- 조건 스크립트는 `closed`라는 값을 모른다. 스크립트가 "참조 기획서가 있으면 건너뛴다"로 판정하고 앱이 `status == "inbox"`로 판정해 결론이 우연이 아니라 구조적으로 같다. 이 성질을 위 6번 테스트가 잡고 있다.

## 사용자 QA 제안

이 작업은 화면 변경이 없으므로 눈으로 볼 것은 없다. 아래 셋을 제안한다.

1. **자동화로 확인.** `cargo test --manifest-path src-tauri/Cargo.toml` 344건 통과와, `cargo test --manifest-path src-tauri/Cargo.toml -- closed rejected`로 걸리는 반려 관련 테스트가 전부 초록인지.
2. **실물 반려로 확인(선택).** 임시 프로젝트에서 아이디어 하나 → 기획서 하나(`source_idea_id` 연결) → 그 기획서를 앱에서 반려. 조회 payload의 그 아이디어 `status`가 `closed`인지, 같은 아이디어의 전문 읽기도 `closed`인지. 이어서 그 아이디어를 참조하는 기획서를 하나 더 만들면 `adopted`나 `drafting`으로 돌아오는지.
3. **되돌리지 않음 확인.** 위 상태에서 `sh .workflow/rules/wf-eligible.sh planner`의 종료 코드가 1인지. 종결 표시가 아이디어를 기획자 처리 대상으로 되살리지 않는다는 것이 R6의 핵심 조건이다.

TASK-058이 화면을 얹은 뒤에는 2번의 결과 화면에서 종결 배지와 "새 아이디어로 다시 요청" 안내가 닿는지까지 함께 보면 된다 — 그 부분은 이 작업의 보증 범위 밖이다.

QA에서 되돌아오면 `.workflow/도그푸딩--wf_ae6cd700/decisions/`의 최신 `workflow-labs/qa-decision@1` 코멘트를 읽고 그 테스트 플로우로 재작업하면 된다.
