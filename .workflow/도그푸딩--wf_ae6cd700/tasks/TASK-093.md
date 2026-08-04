---
schema: workflow-labs/task@1
id: TASK-093
title: 목록 payload의 작업 항목에 source_spec_id를 싣는다
status: completed
source_spec_id: SPEC-029
source_decision_id: DECISION-DD348ED0
updated_at: 2026-08-04T11:42:09.356322+00:00
history:
  - { at: 2026-08-04T11:30:00Z, kind: created }
  - { at: 2026-08-04T11:36:13Z, kind: in_progress }
  - { at: 2026-08-04T11:39:07Z, kind: qa_waiting }
  - { at: 2026-08-04T11:42:09.356322+00:00, kind: completed }
---

# 목록 payload의 작업 항목에 source_spec_id를 싣는다

레인 키를 화면까지 내린다. SPEC-029 확인 사실 4·5대로 값은 작업 문서 88건 전부에 있는데 목록
payload가 싣지 않아 화면이 모르는 상태다. 이 작업은 필드 하나를 더하는 것이 전부이고, 그 값을 쓰는
화면 변경은 TASK-095가 한다. SPEC-029의 R8 셋째 항목과 완료 조건 10·11을 닫는다.

## 승인된 확인 필요 2번이 이 작업의 상한이다

DECISION-DD348ED0은 확인 필요 2번을 기획서 제안대로 승인했다. **이번 범위에 더하는 payload 필드는
`source_spec_id` 하나뿐이다.** 의존 선언(`depends_on`)은 싣지 않는다.

그래서 확인 사실 6의 앞선 결정 — `fs_project_repository.rs:285`~`:287`과 `:769`~`:770`의 주석이
말하는 "목록 payload는 의존 선언을 싣지 않는다(SPEC-013 R5 / TASK-037)" — 은 이 변경 뒤에도 그대로
참이다. **두 주석을 고치지 않는다.** 주석이 말하는 대상은 의존 선언이지 프론트매터 전반이 아니다.

## 범위

- `src-tauri/src/domain/project.rs` — `WorkflowItemSummary`(`:105`~`:129` 부근)에 필드 하나 추가.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — `read_markdown_document`(`:1150`~`:1199`)의
  값 추출과 구조체 리터럴, 그리고 기존 payload 테스트에 단언 추가.
- `src/features/projects/domain/types.ts` — `WorkflowItemSummary`에 대응 필드 추가.
- 그 외 파일은 건드리지 않는다. `.tsx`·CSS 무변경이다.

작업 트리 기준으로 `WorkflowItemSummary` 구조체 리터럴은 `read_markdown_document` 한 곳뿐이다.
저장소에 미커밋 변경이 크므로 **줄 번호는 전부 작업 트리 기준이고, 착수 시 다시 확인한다.**

## 작업 내용

### Rust

- `WorkflowItemSummary`에 `pub source_spec_id: Option<String>`을 더한다. 자리는
  `source_decision_id` 바로 앞이나 뒤로 둔다. 두 필드가 같은 성격이라 나란히 두는 편이 읽힌다.
- 문서 주석을 `source_decision_id`의 것과 같은 어법으로 단다. 담을 사실 둘: **이 작업이 어떤
  기획서에서 나왔는지이고, 아이디어·기획서 항목에서는 늘 `None`이다.** 용도(보드의 기획서별 레인)를
  한 줄로 적고 SPEC-029를 인용한다.
- `read_markdown_document`에서 `yaml_text(metadata.as_ref(), "source_spec_id")`로 꺼내 리터럴에
  넣는다. `source_decision_id`(`:1180`)가 하는 것과 완전히 같은 모양이다. **판정도 파생도 없다.**
  값이 없으면 `None`이고, 그것이 미분류 레인의 근거가 된다.
- `serde(rename_all = "camelCase")`가 이미 걸려 있으므로 프론트로는 `sourceSpecId`로 나간다.

### 프론트 타입

- `types.ts`의 `WorkflowItemSummary`에 `sourceSpecId?: string | null`을 더한다. `sourceDecisionId`
  (`:48` 부근)와 같은 선택 필드 어법이고, 주석도 같은 어법으로 한 줄 단다.
- **타입만 더한다.** 이 작업은 그 값을 읽는 코드를 쓰지 않는다.

### 검사

- `fs_project_repository.rs`의 기존 테스트
  `reads_the_source_decision_of_a_task_and_leaves_it_empty_elsewhere`(`:2791` 부근)가 이미
  `source_spec_id: SPEC-001`을 프론트매터에 넣어 문서를 만들고 있다(`:2813`). **그 테스트에 단언
  세 줄을 더한다** — 작업 항목이 `Some("SPEC-001")`이고, 아이디어·기획서 항목이 `None`이다.
  테스트 이름이 `source_decision`만 말하게 되므로, 두 필드를 함께 보는 이름으로 바꾸는 것을 허용한다
  (예: `reads_the_source_spec_and_decision_of_a_task_and_leaves_them_empty_elsewhere`).
  이름을 그대로 두고 단언만 더해도 된다. **둘 중 하나를 고르고 그 이유를 보고서에 적는다.**
  삭제·비활성화가 아니라 확장이라는 근거를 남기기 위해서다.
- `keeps_the_declaration_out_of_the_list_payload`(`:4763` 부근)가 **수정 없이 통과해야 한다.** 그
  테스트가 지키는 것이 확인 필요 2번의 상한이다. 착수 전후로 이 테스트를 반드시 돌린다.
- 프론트 검사는 더하지 않는다. 값을 읽는 코드가 없기 때문이다.

## 완료 조건

괄호 안은 SPEC-029의 완료 조건 번호다.

1. 목록 payload의 작업 항목이 `sourceSpecId`를 싣고, 아이디어·기획서 항목에서는 비어 있다. 검증:
   위 Rust 테스트의 단언. (10)
2. 이번 변경으로 payload에 더해진 필드가 `source_spec_id` 하나뿐이다. 검증: `git diff`의
   `WorkflowItemSummary` 변경분이 필드 한 줄과 그 주석뿐임을 확인하고, **변경된 필드 목록을 보고서에
   적는다.** (11)
3. 의존 선언은 여전히 목록 payload에 실리지 않는다. 검증:
   `keeps_the_declaration_out_of_the_list_payload`가 수정 없이 통과한다. 확인 사실 6의 주석 두 곳이
   변경분에 없다. (11)
4. 아이디어·기획서 항목의 다른 값이 달라지지 않는다. 검증: 기존 Rust 테스트 전부 통과. (R8 셋째 항목)
5. 기존 자동 테스트가 삭제되거나 비활성화되지 않는다. 검증: 변경분이 추가(와 위 1건의 이름 변경)뿐임을
   확인한다. (14)
6. `cargo test --manifest-path src-tauri/Cargo.toml`과 `npm run check`가 통과한다. (16)

## 범위 밖

- **`depends_on`을 payload에 싣는 것.** 확인 필요 2번이 제안대로 승인됐다. R7 둘째 항목이 발동한
  경우다.
- **`sourceSpecId`를 읽는 화면 코드.** TASK-095의 몫이다. 이 작업이 타입을 열어 두는 것으로 끝난다.
- **`source_spec_id`가 없는 문서를 고치는 일.** 확인 사실 5대로 오늘 그런 작업 문서는 0건이고, 있어도
  앱이 문서를 고치지 않는다(기획서 제외 범위).
- **아이디어·기획서 문서에서 `source_spec_id`를 읽는 것.** 그 문서들에는 없는 필드이고, `None`으로
  두는 것이 요구다.
- **확인 사실 6의 주석 정리.** 이 변경으로 거짓이 되지 않는다.
