# TASK-035 개발자 핸드오프

- 대상 작업: TASK-035 (아이디어 파생 상태를 수집됨·반영중·채택으로 판정하고 중단 의심 근거를 화면까지 나른다)
- 근거 문서: SPEC-012 R1·R3·R5·R6·R7, DECISION-9B93CEA0 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T08:52Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점(08:41Z) `todo`는 TASK-035~054 스무 건. 그중 번호가 가장 빠른 TASK-035를 골랐다.
  이 작업은 "선행 작업 없음. SPEC-012의 첫 작업이다"라고 스스로 선언한다.
- `migration.lock` 없음. `.workflow/.runtime/leases`에는 `SPEC-009.yml` 하나뿐이었고 만료 시각이
  01:20Z라 이미 만료 상태다(착수 시점 08:41Z). 남의 lease라 지우지 않았고 대상도 겹치지 않는다.
- 병행 금지 상대 전원이 `qa_waiting`이라 동시 작업이 없다: TASK-028·029·030·032 (SPEC-009·011
  계열, `domain/project.rs`·`fs_project_repository.rs`·`types.ts`·`docs/file-contract.md` 공유).
  TASK-036은 아직 `todo`이고 아무도 물지 않았다.
- 소스 결정 DECISION-9B93CEA0은 `outcome: approved`, `created_by: user`로 유효하다.
- 선점: `leases/TASK-035.yml` 배타 생성(`set -o noclobber`) → 즉시 `status: in_progress` +
  `history` 기록 → 구현 → `qa_waiting` → lease 반납.

## 요약

아이디어 파생 판정을 두 갈래(참조 있음/없음)에서 세 갈래(`inbox`·`drafting`·`adopted`)로 바꿨다.
판정 본체를 함수 하나로 모아 목록 조회와 전문 읽기가 그 함수만 부르게 했고, 중단 의심일 때 걸려 있는
`draft` 기획서 id를 payload에 실었다. 화면은 한 줄도 건드리지 않았다.

## 변경한 파일 (4건, 작업 범위 그대로)

- `src-tauri/src/domain/project.rs` — `WorkflowItemSummary.stalled_spec_ids` 추가, `status` 주석.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — `SpecReference`·`spec_references`·
  `derive_idea_states` 신설, `adopted_idea_ids` 제거, `workflow_items`·`PreparedWorkflow::read`·
  `summary_from_manifest`·`read_idea`·`create_workflow` 배선, 테스트 15건 추가·2건 수정.
- `src/features/projects/domain/types.ts` — `WorkflowItemSummary.stalledSpecIds`(선택 필드),
  `status` 주석.
- `docs/file-contract.md` — 아이디어 파생 상태 문단을 세 갈래로 고쳐 씀.

범위 밖 파일은 손대지 않았다. `IdeaInbox.tsx`·`App.css`·`heartbeat_condition.rs`·
`project_instructions.rs` 무변경. 프론트엔드 테스트 파일도 무변경.

## 구현 결정

- **`is_draft`는 화면 기준 상태다.** 파일에 적힌 글자가 아니라, 결정 문서가 없고 `status`가
  `user_review`로 명시되지 않은 경우만 `draft`로 본다. `normalize_spec_status`가 알 수 없는 값을
  `draft`로 떨어뜨리므로 "draft가 아니다"라고 말하려면 `user_review`가 명시돼 있어야 한다.
  결정 판정은 기존 `latest_spec_decisions`를 그대로 쓰고 규칙을 새로 쓰지 않았다.
- **판정 본체는 `derive_idea_states` 하나다.** 목록(`workflow_items`)과 전문 읽기(`read_idea`)가
  이 함수만 부른다. 세 갈래로 늘어난 판정을 두 곳에 각각 적으면 어긋난다(R7).
- **`spec_references`는 결정 목록을 인자로 받는다.** 작업 문서의 서명은 `workflow_root` 하나였지만,
  그 사이 `PreparedWorkflow`(TASK-029)가 결정을 이미 한 번 읽어 두게 바뀌어 있었다. 디렉터리를 다시
  훑지 않으려고 읽어 둔 목록을 넘기는 쪽을 골랐다. 판정 규칙은 그대로다.
- **두 값(`stalled`, `blocking_ids`)을 따로 싣지 않았다.** 반영중인데 lease가 없다는 것은 곧 draft
  참조가 있다는 뜻이라 두 값이 항상 같이 움직인다. 따로 두면 어긋난 조합이 표현 가능해지고 화면이
  어느 쪽을 믿을지 정해야 한다.
- **파일에 적힌 아이디어 `status`는 흘려보내지 않는다.** 세 분기 모두가 값을 쓴다. 기존 코드는
  `adopted`일 때만 덮어썼는데, 그러면 `status: adopted`라고 적힌 파일이 참조 없이도 채택으로 보인다.
  파일에 쓰지는 않는다(R6) — 읽은 값을 화면에 그대로 흘리지 않을 뿐이다.
- **`drafts` 정렬.** `fs::read_dir` 순서는 플랫폼마다 다르므로 문서 id 오름차순으로 정렬했다.
  정렬하지 않으면 같은 상태에서 화면 문구가 조회마다 흔들린다.
- **`create_workflow`가 실제 lease를 읽게 고쳤다.** 이 호출은 기존 워크플로우의 아이디어까지 다시
  실어 보낸다. 빈 목록을 넘기면 살아 있는 lease가 무시되어 정상 반영중인 아이디어가 한 조회 동안
  중단 의심으로 보인다. 거짓 경고는 그 경고를 못 믿게 만든다.
- **`migrate`의 `Vec::new()`는 그대로 뒀다.** 그 경로는 활성 lease가 하나라도 있으면 위에서
  `Err(ActiveLeases)`로 끝나므로 빈 목록이 사실이다.
- **`read_idea`에서만 `unwrap_or_default()`를 쓴다.** 이 경로에는 마이그레이션 차단 같은 안전
  판정이 걸려 있지 않고, lease를 못 읽었다고 아이디어 전문이 통째로 안 열리는 편이 더 나쁘다.
  `inspect`의 `?`는 그대로 뒀다 — `read_active_leases`의 `Err`를 `migrate`가 마이그레이션 차단
  근거로 쓴다.
- **`stalledSpecIds`는 선택 필드다.** 백엔드는 항상 싣지만, 프론트엔드 테스트 픽스처가
  `WorkflowItemSummary` 리터럴을 여러 파일에서 직접 만들고 있어 필수로 두면 이 작업이 화면 테스트
  파일들을 건드리게 된다. 이 작업의 범위는 화면 밖이다.

## 테스트

Rust 15건 추가, 2건을 새 상태값에 맞게 고쳤다.

- 추가: `treats_an_unreferenced_idea_without_a_lease_as_collected`(파일의 `status: adopted`가 새지
  않는 것 포함), `treats_an_idea_with_a_draft_spec_as_drafting_and_names_the_stalled_spec`,
  `treats_a_preempted_idea_without_specs_as_drafting_without_a_stalled_spec`,
  `treats_an_idea_with_a_reviewed_spec_as_adopted`,
  `treats_a_decided_spec_as_adopting_the_idea_for_every_outcome`(승인·수정 요청·반려 셋),
  `prefers_drafting_when_a_draft_and_a_reviewed_spec_share_an_idea`,
  `lists_every_stalled_draft_spec_in_document_id_order`,
  `ignores_expired_leases_when_deriving_idea_states`,
  `ignores_leases_without_a_task_id_when_deriving_idea_states`,
  `keeps_an_idea_adopted_when_the_lease_points_at_its_spec`,
  `keeps_idea_derivation_inside_its_workflow`,
  `reports_the_same_idea_state_from_the_list_and_the_full_read`(세 상태 모두),
  `deriving_idea_states_does_not_touch_the_workflow_files`,
  `lists_ideas_when_the_lease_directory_is_missing`,
  `fills_the_stalled_spec_when_the_lease_expires`.
- 수정: `marks_ideas_referenced_by_specs_as_adopted` → 세 갈래 판정 테스트들로 대체.
  `reports_adopted_status_for_an_idea_referenced_by_a_spec` →
  `reports_the_stalled_draft_spec_when_reading_an_idea_in_full`(같은 픽스처가 이제 `drafting`이고
  `stalled_spec_ids`를 갖는다).
- 만료 경과는 lease 파일을 미만료로 한 번, 만료 시각으로 한 번 덮어써서 대신했다. 실제로 기다리면
  테스트가 느려지고 불안정해진다.
- `heartbeat_condition.rs`·프론트엔드 테스트는 한 줄도 고치지 않았고 그대로 통과한다.

## 검증 결과

```
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check     통과
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings   경고 0
cargo test --manifest-path src-tauri/Cargo.toml               214 passed, 0 failed
npm run check (typecheck + vitest + build)                    248 passed (14 files), 빌드 성공
```

`cargo test heartbeat_condition`도 따로 돌려 10건 통과를 확인했다(완료 조건 11). `git diff --stat`으로
`heartbeat_condition.rs`와 `.workflow/rules/wf-eligible.sh`가 무변경임을 확인했다.

화면 확인은 하지 않았다. 작업 문서가 정한 대로 payload만 바뀌고 화면은 아직 새 값을 읽지 않는다.

## 완료 조건 대응

| # | 조건 | 근거 |
|---|---|---|
| 1 | 참조·lease 없으면 `inbox` | `treats_an_unreferenced_idea_without_a_lease_as_collected` |
| 2 | `draft` 참조가 있으면 `drafting` | `..._names_the_stalled_spec`, `prefers_drafting_when_...` |
| 3 | 선점 lease만 있어도 `drafting` | `treats_a_preempted_idea_without_specs_as_drafting_...` |
| 4 | 나머지는 `adopted` (결정 셋 모두) | `treats_an_idea_with_a_reviewed_spec_as_adopted`, `treats_a_decided_spec_as_...` |
| 5 | 만료·`task_id` 없음·기획서 id lease는 판정을 안 바꾼다 | `ignores_expired_leases_...`, `ignores_leases_without_a_task_id_...`, `keeps_an_idea_adopted_when_the_lease_points_at_its_spec` |
| 6 | `stalled_spec_ids`는 반영중+lease 없음일 때만, id 오름차순 | `lists_every_stalled_draft_spec_in_document_id_order` |
| 7 | 목록과 전문이 같은 결론 | `reports_the_same_idea_state_from_the_list_and_the_full_read` |
| 8 | 조회가 파일을 안 바꾸고 `status`는 `inbox`로 남는다 | `deriving_idea_states_does_not_touch_the_workflow_files` |
| 9 | lease 디렉터리가 없어도 목록이 나온다 | `lists_ideas_when_the_lease_directory_is_missing` |
| 10 | lease 만료 후 `stalled_spec_ids`가 채워진다 | `fills_the_stalled_spec_when_the_lease_expires` |
| 11 | 조건 스크립트 판정 불변 | `heartbeat_condition` 테스트 10건 무수정 통과, 파일 무변경 |
| 12 | 화면 동작 불변 | 프론트엔드 248건 무수정 통과 |
| 13 | 네 가지 검증 명령 통과 | 위 검증 결과 |

## 사용자 QA 안내

이 작업만으로는 화면이 달라지지 않는다. 그것이 의도된 중간 상태다 — 화면이 아직 `drafting`을 모르므로
새 상태의 아이디어는 지금처럼 "수집됨"으로 떨어진다. QA에서 볼 것은 "달라지지 않았다"이다.

1. 앱을 띄우고 아이디어 인박스를 연다. 아이디어 배지와 목록이 이전과 같은지 본다.
2. 아이디어를 눌러 전문 미리보기를 연다. 이전과 같이 열리는지 본다.
3. 개발 화면·활동 화면·기록 화면이 이전과 같은지 훑는다.

이 저장소의 `.workflow`에는 지금 `drafting`으로 판정될 아이디어가 하나도 없다. SPEC-001~018이 전부
`status: user_review`이고 각각 사용자 결정을 받았으며, 미만료 lease는 이 세션의 `TASK-035.yml`뿐이라
아이디어를 가리키는 것이 없다. 즉 아이디어는 전부 `inbox` 아니면 `adopted`이고, 그 둘은 화면에서
이전과 같은 두 배지다. 중단 의심 표시의 화면 검증은 TASK-036에서 새 표시가 붙은 뒤 의미가 생긴다.

## 남은 위험

- **화면과 조건 스크립트의 결론이 갈린다.** 화면이 "반영중"이라고 부르는 아이디어도 조건
  스크립트에서는 참조가 있으므로 미처리가 아니다. 승인된 설계이고(기획서 제외 범위, 완료 조건 22)
  `docs/file-contract.md`에 그 사실을 적어 뒀다. 다음 기획자 세션이 화면 표시를 자격 판정으로
  오해하지 않게 하는 것이 그 문단의 목적이다.
- **버려진 draft 기획서는 여전히 자동으로 회수되지 않는다.** 이 작업은 그 상태를 "보이게" 만들 뿐,
  죽은 세션 회수·만료 lease 정리·draft 삭제는 범위 밖이다. 회수 정책은 IDEA-C95EABD2에 있다.
- **반려·수정 요청만 받은 기획서를 참조하는 아이디어가 `adopted`로 보인다.** DECISION-9B93CEA0이
  이 기획서 범위에서 수용한 사실이고 테스트로 고정했다.

## 후속 작업 (이 세션 범위 밖)

- **TASK-036**이 이 payload를 화면에서 쓴다. `IdeaInbox.tsx`가 세 상태와 중단 의심을 구분해 그리기
  전까지 `drafting`은 화면에서 "수집됨"으로 떨어진다. 이 작업 직후 이어받는 것이 맞다.

## 역할 밖 발견 (핸드오프 노트, 손대지 않음)

- `.workflow/.runtime/leases/SPEC-009.yml`이 2026-08-03T01:20Z 만료인 채로 남아 있다. 앱이 lease
  파일을 지우지 않으므로 정상 동작이지만, `lease_ids`(만료를 거르지 않는다)가 이 파일을 세기 때문에
  SPEC-009는 아키텍트 대기 물량에서 계속 빠진다. 만료 lease 정리 정책이 필요한지는 기획 판단이다.
