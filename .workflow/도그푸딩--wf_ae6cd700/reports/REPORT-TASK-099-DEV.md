# TASK-099 개발자 핸드오프

- 대상: TASK-099 (확인 전용 일괄 QA 명령을 앱에 만들고 게이트웨이·훅까지 잇는다)
- 근거: SPEC-031 R3·R4·R6·R7, 완료 조건 4·5·7·9·10·12·13·14·15,
  DECISION-1FAA8251 (`outcome: approved`, `created_by: user`, `spec_id: SPEC-031` — 직접 확인.
  SPEC-031의 결정 문서는 이 1건뿐이라 더 늦은 결정이 없다)
- 역할: 개발자 (developer-claude)
- 선점: acquire exit 0 → `lease-69300-20260804155436` → `in_progress`(15:54:40Z) → 구현 → 검증 →
  `qa_waiting`. 중간에 renew exit 0 1회.

## 선행 확인

`depends_on: [TASK-095, TASK-096]`.

- TASK-095: `completed`
- TASK-096: `qa_waiting`

둘 다 충족이다. 착수 시점에 `.workflow/.runtime/leases/`에는 만료된 `SPEC-009.yml` 하나뿐이었고
TASK-099를 덮는 리스는 없었다. `sh .workflow/rules/wf-eligible.sh developer`가 exit 0(`eligible`)이고,
`todo` 작업 5건(TASK-099~103) 중 선행이 충족된 것은 TASK-099 하나였다.

## 한 것

### Rust

- `domain/project.rs`: `TaskQaBatchResult`·`TaskQaBatchEntry` 추가. 기획서가 적어 준 모양 그대로이고
  파일의 다른 타입과 같이 `#[serde(rename_all = "camelCase")]`다.
- `fs_project_repository.rs`:
  - 건 하나를 처리하던 `record_task_qa`의 본체(`safe_markdown_file` → 문서 읽기 → `qa_waiting` 확인 →
    `QA-` 결정 문서 쓰기 → 작업 프론트매터 갱신)를 free function `record_one_task_qa`로 뽑았다.
    **판정 순서·에러 종류·기록 형식은 한 글자도 바꾸지 않았고**, 뽑기 전에는 없던 반환값으로 작업
    id만 준다(일괄이 건별 결과에 쓴다). `record_task_qa`는 그 함수를 부르는 한 줄이 되었다.
  - `confirm_task_qa_batch` 추가. 호출당 한 번 하는 일(코멘트 검증 → `canonical_project_root` →
    매니페스트 → `validate_workflow_directories` → `require_current_schema` →
    `install_project_instructions` → `install_claim_helper` → `registered_workflow_root` → 마지막
    `summary_from_manifest`)을 앞뒤에 한 번씩 두고, 가운데에서 `file_names`를 요청 순서대로 돌며
    `record_one_task_qa`를 부른다. 건 하나의 실패는 `recorded: false` + `message`
    (`ProjectError::to_string()`)로 남고 루프는 멈추지 않는다.
  - `task_id_of` 추가(4줄). 실패한 건의 작업 id를 채우는 자리다. 문서를 읽지 못하면 `None`이고
    파일 이름에서 추정하지 않는다. 성공 경로는 이 함수를 부르지 않는다.
- `project_service.rs`·`commands/projects.rs`·`lib.rs`: 위임 한 줄, 명령 하나, `generate_handler!`
  항목 하나.

`outcome` 파라미터는 만들지 않았다. 이름(`confirm_...`)이 확인 전용이라는 것을 말한다.
리스는 보지 않는다. 결정 문서는 단건과 같은 형식이고 `created_at`은 건마다 `Utc::now()`다.

### 프론트

- `types.ts`: `TaskQaBatchEntry`·`TaskQaBatchResult`와 `ProjectGateway.confirmTaskQaBatch`.
- `tauriProjectGateway.ts`: `invoke("confirm_task_qa_batch", ...)` 래퍼 하나.
- `useProjectWorkspace.ts`: `confirmTaskQaBatch(workflowDirectory, fileNames, comment)` 콜백.
  성공하면 `setProject(result.summary)` 뒤 `result.results`, 호출 자체가 실패하면
  `setError(messageFrom(reason))` 뒤 `null`. `busy` 처리는 기존 어법과 같다.
  **건별 실패는 `setError`로 올리지 않는다.**
- `useProjectWorkspace.test.ts`: `gatewayFor`의 가짜 게이트웨이에 메서드 한 줄 추가. 기존 검사는
  이름도 내용도 고치지 않았다.

## 검사

새로 넣은 것 9건. Rust 7 + 훅 2.

| # | 이름 | 닫는 조건 |
| --- | --- | --- |
| 1 | `a_batch_confirms_every_task_it_was_given` | 완료 조건 1 (SPEC 4) |
| 2 | `a_batch_leaves_tasks_outside_the_list_untouched` | 완료 조건 1 (SPEC 4) |
| 3 | `a_batch_records_the_rest_when_one_task_is_not_awaiting_qa` | 완료 조건 2 (SPEC 5) |
| 4 | `a_batch_writes_nothing_when_the_comment_is_too_long` | 완료 조건 3 (SPEC 7) |
| 5 | `a_batch_confirms_a_task_covered_by_an_unexpired_lease` | 완료 조건 4 (SPEC 9) |
| 6 | `a_repeated_file_name_fails_only_the_second_time` | 중복 동작 고정 |
| 7 | `an_empty_batch_returns_the_summary_with_no_results` | 빈 목록 동작 고정 |
| 8 | `일괄 확인을 게이트웨이 한 번으로 부르고 건별 결과를 그대로 돌려준다` | 완료 조건 5 (SPEC 12) |
| 9 | `일괄 확인 호출이 실패하면 null과 전역 사유가 남는다` | 호출 실패 경로 |

검사 1·2·3·5는 결정 문서와 작업 문서를 **파일에서 직접 읽어** 단언한다.

## 완료 조건 확인

1. **결정 문서 1:1, `created_by: user`, `completed` 전이 1건, 목록 밖 무변경** — 검사 1·2 통과.
2. **`qa_waiting`이 아닌 건만 실패, 순서 보존** — 검사 3 통과. 결과 배열이
   `[("TASK-001.md", true), ("TASK-002.md", false), ("TASK-003.md", true)]`이고 실패 건의
   `task_id`가 `Some("TASK-002")`다(문서를 읽은 뒤 실패한 자리라 채워진다).
3. **공통 코멘트, 빈 코멘트 허용, 2,000자 초과 거절** — 검사 1·4 통과. 초과 시 작업 파일 원문이
   그대로이고 QA 결정 문서가 0건이다.
4. **미만료 리스가 걸려도 기록** — 검사 5 통과.
5. **앱 호출 한 번** — 검사 8이 `toHaveBeenCalledTimes(1)`로 고정. 명령 본체의
   `summary_from_manifest` 호출 개수를 코드로 세었다: `confirm_task_qa_batch` 본문 안에 **1건**
   (`awk '/pub fn confirm_task_qa_batch/,/^    }$/' | grep -c summary_from_manifest` → `1`).
6. **단건 경로 무변경** — 착수 시점 Rust 검사 **404건**을 직접 세었고(작업 문서가 적은 "89건"은
   기획 시점 수치라 실측값을 쓴다), 그 404건이 **하나도 고치지 않고** 통과한다. 최종 411건 =
   404 + 새 검사 7건.
7. **기존 자동 테스트 삭제·비활성화 없음** — `git diff --numstat` 기준 내가 만진 9개 파일 중
   삭제 라인이 있는 것은 3개뿐이고 전부 삭제가 아니라 이동·정리다:
   `fs_project_repository.rs`(-31: 전부 `record_one_task_qa`로 옮겨 간 본체 29줄 + import 줄바꿈 2줄),
   `project_service.rs`(-1: import 줄바꿈), `commands/projects.rs`(-1: import 줄바꿈).
   나머지 6개 파일은 `-0`이다. 검사 파일에서 지워진 줄은 없다(`useProjectWorkspace.test.ts` +91 -0).
8. **`DevelopmentBoard.tsx`·`App.css`·`WorkspaceShell.tsx`·`App.tsx` 미포함** — 이 세션이 편집한
   파일은 아래 9개(+ 작업 문서·이 보고서)뿐이고 넷 중 어느 것도 없다.
   `git diff --stat`에 `DevelopmentBoard.tsx`·`DevelopmentBoard.test.tsx`·`App.css`가 보이지만
   **세션 시작 시점의 `git status`에 이미 수정 상태로 있던 미커밋 변경**이고 이 작업의 변경분이
   아니다.
9. **`npm run check`·`cargo test` 통과** — 아래 검증 명령 참조.

## 검증 명령

| 명령 | 결과 |
| --- | --- |
| `sh .workflow/rules/wf-eligible.sh developer` (착수 전) | exit 0, `eligible` |
| `cargo test --manifest-path src-tauri/Cargo.toml` (착수 전 기준선) | 404 passed, 0 failed |
| `cargo test --manifest-path src-tauri/Cargo.toml` (최종) | **411 passed, 0 failed** |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 차이 없음 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 0 |
| `npm run check` (typecheck + vitest + build) | **19 파일 510 tests passed**, 빌드 성공 |

## 만진 파일

- `src-tauri/src/domain/project.rs`
- `src-tauri/src/infrastructure/fs_project_repository.rs`
- `src-tauri/src/application/project_service.rs`
- `src-tauri/src/commands/projects.rs`
- `src-tauri/src/lib.rs`
- `src/features/projects/domain/types.ts`
- `src/features/projects/infrastructure/tauriProjectGateway.ts`
- `src/features/projects/application/useProjectWorkspace.ts`
- `src/features/projects/application/useProjectWorkspace.test.ts`

## 사용자 QA 안내

이 작업에는 화면이 없다. 레인 헤더의 일괄 확인 UI는 TASK-100의 몫이라, 지금은 앱에서 눌러 볼 자리가
없다. 확인은 자동 검사로 닫는 것이 이 작업의 설계다(위 표의 9건 + 기존 404건 무수정 통과).

직접 보고 싶다면 `cargo test --manifest-path src-tauri/Cargo.toml confirm_task_qa` 또는
`npm run test -- useProjectWorkspace`로 새 검사만 돌려 볼 수 있다.

## 남는 리스크 · 후속 (역할 밖 — 아키텍트/기획자 몫)

- **`task_id_of`의 두 번째 읽기.** 건이 실패했을 때만 작업 문서를 한 번 더 읽는다. 실패 경로에서만
  일어나고 성공 경로 비용은 0이라 그대로 두었다. 실패가 많은 목록에서 읽기가 두 배가 되는 것이
  문제가 되면 실패 정보에 id를 실어 나르는 형태로 바꾸는 선택지가 있다. 지금은 기획서가 요구하지
  않았다.
- **선행이 되돌아올 때.** TASK-096은 아직 `qa_waiting`이다. 사용자 QA가 그것을 `todo`로 되돌리면
  작업 문서가 지시한 대로 이 작업도 다시 대기 자리로 돌아간다. 파일이 겹치지 않는데도 막히는
  자리라, 실제로 그 일이 일어나면 고쳐서 진행하지 말고 아키텍트 후속으로 넘기라는 것이 작업
  문서의 지시다.
- **TASK-100 인계 사항.** 훅의 `confirmTaskQaBatch`는 `TaskQaBatchEntry[] | null`을 돌려준다.
  `null`은 호출 자체의 실패(전역 에러 문구가 이미 채워진 상태)이고, 배열이면 건별 성공·실패가
  요청 순서 그대로 들어 있다. 건별 실패 문구는 전역 에러로 올라가지 않으므로 **화면이 그 배열을
  직접 그려야 한다.** 대상 범위 판단(확인 필요 3번)도 TASK-100의 몫이다 — 이 명령은 받은 목록을
  그대로 처리하고 무엇을 골랐는지 묻지 않는다.
