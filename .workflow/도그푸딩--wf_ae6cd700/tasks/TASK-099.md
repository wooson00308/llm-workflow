---
schema: workflow-labs/task@1
id: TASK-099
title: 확인 전용 일괄 QA 명령을 앱에 만들고 게이트웨이·훅까지 잇는다
status: completed
source_spec_id: SPEC-031
source_decision_id: DECISION-1FAA8251
depends_on: [TASK-095, TASK-096]
updated_at: 2026-08-04T23:35:09.476542+00:00
history:
  - { at: 2026-08-04T15:04:10Z, kind: created }
  - { at: 2026-08-04T15:54:40Z, kind: in_progress }
  - { at: 2026-08-04T16:04:25Z, kind: qa_waiting }
  - { at: 2026-08-04T23:35:09.476542+00:00, kind: completed }
---

# 확인 전용 일괄 QA 명령을 앱에 만들고 게이트웨이·훅까지 잇는다

승인된 확인 필요 1번의 본체다. 목록을 통째로 받아 건별로 QA 확인을 기록하고 건별 결과와 요약을
한 번에 돌려주는 명령을 앱에 만들고, 게이트웨이·훅까지 배선한다. 화면은 TASK-100이 붙인다.
SPEC-031의 R3·R4·R6·R7과 완료 조건 4·5·7·9·12의 기록 몫을 닫는다.

## 의존성

`depends_on: [TASK-095, TASK-096]`.

- **이 작업의 범위에는 `DevelopmentBoard.tsx`·`App.css`가 없다.** 확인 사실 20이 가리키는 파일 겹침은
  이 작업에 없고, 겹치는 것은 TASK-100이다.
- 그럼에도 선행을 적는 이유는 하나다. **SPEC-031 R8 마지막 항목과 완료 조건 14가 "이 기획서의 작업은
  SPEC-029의 TASK-095·TASK-096이 끝난 뒤에 선다"를 요구하고, 분해가 그것을 선행 선언으로 적으라고
  했다.** 승인된 조건이므로 아키텍트가 뒤집지 않는다.
- 두 선행은 착수 시점에 `qa_waiting` 이상이어야 한다. TASK-095는 이 문서를 쓰는 시점에 `qa_waiting`,
  TASK-096은 `in_progress`다. **사용자 QA가 그중 하나를 `todo`로 되돌리면 이 작업도 다시 대기 상태가
  된다.** 파일이 겹치지 않는데도 막히는 자리이므로, 그 일이 실제로 일어나면 고쳐서 진행하지 말고
  아키텍트 후속으로 넘긴다.

## 승인된 확인 필요가 이 작업의 설계다

DECISION-1FAA8251은 세 항목 모두 기획서 제안대로 승인했다. 이 작업이 닫는 것은 1번과 2번이다.

1. **일괄 한 번은 앱 호출 한 번이다.** 프론트가 단건 명령을 N번 부르는 대안은 뒤집혔다. 확인 사실 6의
   호출당 약 508건 읽기와 확인 사실 8의 전역 에러 하나가 그 근거다.
2. **코멘트는 공통 하나다.** 건별 코멘트를 받지 않는다. 명령 시그니처에 건별 코멘트 자리를 만들지
   않는다.
3. 대상 범위(확인 필요 3번)는 화면의 판단이라 TASK-100이 닫는다. 이 명령은 **받은 목록을 그대로**
   처리하고 무엇을 골랐는지 묻지 않는다.

## 범위

- `src-tauri/src/infrastructure/fs_project_repository.rs` — 일괄 처리 본체와 테스트.
- `src-tauri/src/application/project_service.rs` — 위임 한 줄.
- `src-tauri/src/commands/projects.rs` — 명령 하나.
- `src-tauri/src/lib.rs` — `generate_handler!`에 항목 하나(확인 사실 17).
- `src-tauri/src/domain/project.rs` — 결과 타입 둘.
- `src/features/projects/domain/types.ts` — 결과 타입 둘과 `ProjectGateway` 메서드 하나.
- `src/features/projects/infrastructure/tauriProjectGateway.ts` — `invoke` 래퍼 하나.
- `src/features/projects/application/useProjectWorkspace.ts` — 훅 콜백 하나.
- `src/features/projects/application/useProjectWorkspace.test.ts` — 가짜 게이트웨이에 메서드 추가와
  단언 추가. **기존 검사는 이름도 내용도 고치지 않는다.** `gatewayFor`(`:69`)의 객체에 한 줄이 는다.
- 그 외 파일은 건드리지 않는다. **`DevelopmentBoard.tsx`·`App.css`·`WorkspaceShell.tsx`·`App.tsx`는
  이 작업의 범위가 아니다.**

저장소에 미커밋 변경이 크다. **줄 번호는 작업 트리 기준이고, 쓰기 직전에 대상 줄을 다시 읽는다.**

## 작업 내용

### 명령의 이름과 모양

- 이름은 **`confirm_task_qa_batch`**로 한다(게이트웨이는 `recordTaskQaBatch`가 아니라
  `confirmTaskQaBatch`). **`outcome` 파라미터를 만들지 않는다.** 일괄 반려는 기획서 제외 범위이고,
  파라미터로 열어 두면 다음 사람이 그것을 뚫린 길로 읽는다. 이름이 확인 전용이라는 것을 말한다.
- 시그니처:

  ```rust
  pub fn confirm_task_qa_batch(
      &self,
      root: &Path,
      workflow_directory: &str,
      file_names: &[String],
      comment: &str,
  ) -> Result<TaskQaBatchResult, ProjectError>
  ```

- 결과 타입은 `domain/project.rs`에 둔다. 이 파일의 다른 타입과 같이 `#[serde(rename_all = "camelCase")]`다.

  ```rust
  pub struct TaskQaBatchResult {
      pub summary: ProjectSummary,
      /// 요청 순서 그대로. 화면이 목록과 나란히 읽는다.
      pub results: Vec<TaskQaBatchEntry>,
  }

  pub struct TaskQaBatchEntry {
      pub file_name: String,
      /// 문서를 읽지 못하면 `None`. 추정으로 채우지 않는다.
      pub task_id: Option<String>,
      pub recorded: bool,
      /// 실패 사유. 성공이면 `None`.
      pub message: Option<String>,
  }
  ```

### 처리 규칙

- **호출당 한 번 하는 일**: 코멘트 검증, `canonical_project_root`, 매니페스트 읽기,
  `validate_workflow_directories`, `require_current_schema`, `install_project_instructions`,
  `install_claim_helper`, `registered_workflow_root`, 그리고 **마지막의 `summary_from_manifest` 한
  번**. 확인 사실 6·7의 비용이 건수만큼 늘지 않게 하는 것이 이 작업의 이유다.
- **건마다 하는 일**: `safe_markdown_file` → 문서 읽기 → `status == "qa_waiting"` 확인 → `QA-` 결정
  문서 쓰기 → 작업 프론트매터 상태·`history` 갱신. 지금 `record_task_qa`(`:391`~`:419`)가 하는 것과
  같은 순서다.
- **코멘트 검증은 앞에서 한 번**이다. `validate_task_qa(&TaskQaOutcome::Confirmed, comment)`를 그대로
  쓴다(확인 사실 11). 2,000자를 넘으면 아무 건도 쓰지 않고 `Err`로 끝난다. 확인은 빈 코멘트를
  허용한다.
- **한 건이 실패해도 멈추지 않는다**(R4 첫째 항목). 실패는 그 건의 `recorded: false`와 `message`로
  남고 다음 건으로 넘어간다. 실패 사유 문자열은 `ProjectError`를 `to_string()`한 값이다 — 명령
  경계에서 문자열로 바뀌는 지금 어법(`commands/projects.rs`)과 같다.
- **`Err`로 끝나는 것은 프로젝트 전체가 못 읽히는 경우뿐**이다. 매니페스트·스키마·워크플로 디렉터리
  문제와 코멘트 검증 실패가 그것이다. 건 하나의 문제는 절대 `Err`가 아니다.
- **빈 목록**은 결과 배열이 빈 채로 `Ok`다. 새 에러 변형을 만들지 않는다. 화면이 이미 막고 있고(R2),
  일어나지 않는 시나리오에 에러를 만들지 않는다.
- **같은 파일 이름이 두 번 들어오면** 두 번째는 상태가 이미 `completed`라 `TaskNotAwaitingQa`로 실패한
  건이 된다. 별도 중복 제거를 넣지 않는다. 그 동작을 검사 하나로 고정만 한다.
- **리스를 보지 않는다**(R7 둘째 항목, 확인 사실 19). 일괄이 단건보다 엄격해지는 순간 같은 작업이
  카드에서는 찍히고 레인에서는 안 찍힌다.
- **결정 문서와 작업 문서의 형식이 단건과 똑같다**(R3 셋째 항목). `created_by: user`이고, 일괄임을
  표시하는 필드를 새로 넣지 않는다. `created_at`은 지금처럼 건마다 `Utc::now()`로 찍는다 — 한 시각으로
  묶지 않는다. 확인 사실 1이 읽은 것과 같은 모양의 기록이 남아야 한다.

### 단건 경로와의 관계

- **`record_task_qa`의 외부 동작은 한 글자도 바뀌지 않는다.** 시그니처·반환 타입·에러가 그대로다
  (R7 첫째 항목, 완료 조건 10).
- 건 하나를 처리하는 부분(`:391`~`:419`)을 **private 함수 하나로 뽑아 단건과 일괄이 함께 쓴다.**
  기획서 확인 필요 1번의 비용 항목이 "QA 기록 규칙이 지켜지는 자리가 둘이 된다"를 지목했고, 그 비용을
  줄이는 가장 싼 방법이 이것이다. 뽑은 함수는 워크플로 루트·파일 이름·outcome·코멘트를 받아 결정
  문서와 작업 문서를 쓴다.
- **뽑는 것이 전부다.** 단건 경로의 판정 순서·에러 종류를 바꾸는 리팩터링은 하지 않는다. 기존 Rust
  검사 89건이 수정 없이 통과하는 것으로 그것을 확인한다.

### 게이트웨이와 훅

- `types.ts`에 `TaskQaBatchEntry`·`TaskQaBatchResult`를 더하고 `ProjectGateway`에 메서드 하나를
  더한다. 인터페이스가 넓어지므로 `gatewayFor`(`useProjectWorkspace.test.ts:69`)도 그 메서드를 갖게
  한다.
- 훅의 `confirmTaskQaBatch(workflowDirectory, fileNames, comment)`는 **결과 배열 또는 `null`**을
  돌려준다. 성공하면 `setProject(result.summary)` 뒤 `result.results`, 호출 자체가 실패하면
  `setError(messageFrom(reason))` 뒤 `null`이다. `recordTaskQa`(`:262`~`:290`)의 어법을 그대로 따르되
  **boolean이 아니다** — R4의 건별 보고가 이 반환값을 타고 화면으로 간다.
- `busy` 처리는 기존과 같다. `setBusy(true)` → `finally { setBusy(false) }`.
- **건별 실패를 `setError`로 올리지 않는다.** 확인 사실 8의 전역 문구는 다음 호출이 덮는 자리라 R4가
  요구하는 건별 보고를 담을 수 없다.

### 검사

**Rust (`fs_project_repository.rs`의 `mod tests`)** — `qa_waiting_task`·`back_to_qa_waiting` 등 기존
헬퍼를 쓴다.

1. 세 건을 넘기면 결정 문서가 셋 생기고 각각 `created_by: user`·공통 코멘트를 담으며, 세 작업이
   `completed`가 되고 `history`에 `completed`가 하나씩 붙는다. **파일을 직접 읽어 단언한다.**
   (완료 조건 4)
2. 목록에 넣지 않은 `qa_waiting` 작업은 그대로 `qa_waiting`이고 결정 문서가 생기지 않는다. (완료 조건 4)
3. 대상 중 하나가 `qa_waiting`이 아니면 그 건만 `recorded: false`이고 나머지는 기록된다. 결과 배열의
   순서가 요청 순서와 같다. (완료 조건 5)
4. 코멘트가 2,000자를 넘으면 `Err`이고 **아무 파일도 쓰이지 않는다.** 빈 코멘트는 통과한다. (완료 조건 7)
5. 미만료 리스가 걸린 `qa_waiting` 작업이 그대로 기록된다. (완료 조건 9)
6. 같은 파일 이름이 두 번 들어오면 두 번째만 실패한다.
7. 빈 목록이면 결과가 비고 요약이 정상으로 돌아온다.

**훅 (`useProjectWorkspace.test.ts`)**

8. 성공하면 결과 배열이 그대로 돌아오고 프로젝트 상태가 응답의 `summary`로 바뀐다. 게이트웨이가
   **한 번** 불린다. (완료 조건 12)
9. 게이트웨이가 던지면 `null`이 돌아오고 전역 에러 문구가 채워진다.

## 완료 조건

괄호 안은 SPEC-031의 완료 조건 번호다.

1. 선택된 작업마다 결정 문서가 하나씩 생기고 `created_by`가 `user`이며, 작업이 `completed`가 되고
   `history`에 `completed`가 하나 붙는다. 목록 밖 작업은 손대지 않는다. 검증: 검사 1·2. (4)
2. 대상 중 `qa_waiting`이 아닌 건만 실패하고 나머지는 기록된다. 결과가 건별로 성공·실패를 말한다.
   검증: 검사 3. (5)
3. 공통 코멘트가 전 건의 결정 문서에 같은 값으로 들어가고, 빈 코멘트가 허용되며, 2,000자 초과는
   거절된다. 검증: 검사 1·4. (7)
4. 리스가 걸린 `qa_waiting` 작업을 일괄이 리스를 이유로 거절하지 않는다. 검증: 검사 5. (9)
5. 일괄 한 번이 앱 호출 한 번이다. 검증: 검사 8과, 명령 본체에 `summary_from_manifest` 호출이 하나뿐인
   것을 코드로 확인해 보고서에 적는다. (12)
6. 단건 QA 경로의 동작이 그대로다. 검증: 기존 Rust 검사가 **수정 없이** 통과한다. 착수 시점 개수를
   직접 세어 보고서에 적는다. (10 / R7)
7. 기존 자동 테스트가 삭제되거나 비활성화되지 않는다. 검증: `git diff`로 변경이 추가뿐임을 확인한다. (13)
8. 변경분에 `DevelopmentBoard.tsx`·`App.css`·`WorkspaceShell.tsx`·`App.tsx`가 없다. (14)
9. `npm run check`와 `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다. (15)

## 범위 밖

- **화면.** 레인 헤더의 액션, 확인 화면, 결과 표시 전부 TASK-100의 몫이다. 이 작업은 UI 컴포넌트를
  만들지 않는다.
- **일괄 반려.** 기획서 제외 범위다. `outcome` 파라미터도 만들지 않는다.
- **단건 경로의 동작 변경.** 공통 부분을 뽑는 것 외에 판정·에러·반환을 바꾸지 않는다.
- **리스 검사.** 기획서 제외 범위다.
- **되돌리기.** 기획서 제외 범위다.
- **확인 사실 6의 요약 비용 자체를 줄이는 최적화.** 이 작업은 호출 횟수를 1로 만들 뿐, 한 번의 요약이
  508건을 읽는 것은 그대로 둔다. 기획서가 요구하지 않았다.
- **수기 결정 21건의 소급 재가.** 기획서 제외 범위다.
- **건별 코멘트.** 승인된 확인 필요 2번이 잘랐다.
