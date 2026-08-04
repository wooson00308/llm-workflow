# TASK-093 개발자 핸드오프

- 대상: TASK-093 (목록 payload의 작업 항목에 source_spec_id를 싣는다)
- 근거: SPEC-029 R8 셋째 항목·완료 조건 10·11, DECISION-DD348ED0 (`outcome: approved`,
  `created_by: user`, `spec_id: SPEC-029` — 직접 확인. SPEC-029에 더 늦은 결정 없음, 결정 문서 1건뿐)
- 역할: 개발자 (developer-claude)
- 선점: acquire exit 0 → `lease-76126-20260804113609` → `in_progress`(11:36:13Z) → 구현 → 검증 →
  `qa_waiting`(11:39:07Z). 중간에 renew exit 0 1회.
- 선행 확인: `depends_on` 없음. 후행 TASK-095가 이 값을 쓰지만 아직 `todo`라 순서가 뒤집히지 않았다.

필드 하나와 그 값을 꺼내는 한 줄. 판정도 파생도 없고 동작 변경도 없다. 값을 읽는 화면 코드는
TASK-095 몫이라 이 작업은 타입을 열어 두는 것으로 끝난다.

## 변경한 파일 (셋, 작업 문서 범위 그대로)

- `src-tauri/src/domain/project.rs:117`~`:119` — `WorkflowItemSummary`에 `source_spec_id` 필드 하나와
  주석 두 줄. 자리는 `source_decision_id` 바로 앞.
- `src-tauri/src/infrastructure/fs_project_repository.rs:1180`, `:1192` — `read_markdown_document`의
  값 추출 한 줄과 구조체 리터럴 한 줄. `:2825`~`:2830` — 기존 테스트에 단언 세 줄.
- `src/features/projects/domain/types.ts:48`~`:49` — `sourceSpecId?: string | null`과 주석 한 줄.

`.tsx`·CSS 무변경, 보호 상태 무변경, 커밋·푸시 없음.

## 구현

```rust
// domain/project.rs:117
/// 이 작업이 어떤 기획서에서 나왔는지. 아이디어·기획서에서는 항상 `None`이다.
/// 보드가 이 값으로 작업을 기획서별 레인에 모은다(SPEC-029 R8).
pub source_spec_id: Option<String>,

// fs_project_repository.rs:1180
let source_spec_id = yaml_text(metadata.as_ref(), "source_spec_id");
```

`source_decision_id`(`:1181`)가 하는 것과 완전히 같은 모양이다. 값이 없으면 `None`이고, 그것이
미분류 레인의 근거가 된다. `serde(rename_all = "camelCase")`가 이미 걸려 있어 프론트로는
`sourceSpecId`로 나간다.

`WorkflowItemSummary` 구조체 리터럴은 작업 트리 전체에서 `read_markdown_document` 한 곳뿐임을
착수 시 재확인했다(`grep "WorkflowItemSummary\s*{"` → 정의 1건, 리터럴 1건, 테스트 헬퍼 반환형 1건).

## 테스트 이름 — 그대로 두기로 했다

작업 문서가 허용한 두 선택지 중 **이름을 그대로 두고 단언만 더하는 쪽**을 골랐다.
`reads_the_source_decision_of_a_task_and_leaves_it_empty_elsewhere`는 이름 그대로다.

이유: 이 이름을 이미 인용한 문서가 있다. `reports/REPORT-TASK-029-DEV.md:106`이
`sourceDecisionId` 적재의 근거로 이 테스트를 이름으로 가리킨다. 보고서는 지나간 감사 기록이라
이 세션이 고칠 자리가 아니고(다른 작업의 산출물), 이름을 바꾸면 그 인용만 갈 곳을 잃는다.
이름이 이제 두 필드 중 하나만 말하게 되는 값은 치렀지만, 단언 본문이 두 필드를 다 보여 준다.

삭제·비활성화가 아니라 확장이다: 기존 단언 세 줄과 픽스처는 한 글자도 건드리지 않았고, 뒤에 세 줄을
붙였을 뿐이다. 픽스처는 이미 `source_spec_id: SPEC-001`을 프론트매터에 넣고 있어(`:2815`) 새로
만들 것이 없었다.

## 완료 조건별 확인

| # | 조건 | 결과 |
|---|---|---|
| 1 | 작업 항목이 `sourceSpecId`를 싣고 아이디어·기획서에서는 비어 있다 | 통과 — 단언 3건 |
| 2 | 이번에 payload에 더해진 필드가 `source_spec_id` 하나뿐 | 통과 — 아래 필드 목록 |
| 3 | 의존 선언은 여전히 payload에 실리지 않는다 | 통과 — 아래 |
| 4 | 아이디어·기획서 항목의 다른 값이 안 달라진다 | 통과 — Rust 401건 전부 통과 |
| 5 | 삭제·비활성화된 테스트 없음 | 통과 — 단언만 추가, 이름 변경도 없음, `#[ignore]` 0건 |
| 6 | `cargo test`와 `npm run check` 통과 | 통과 — 아래 |

### 조건 2 — 이번 변경으로 더해진 payload 필드 목록

`source_spec_id` (프론트 `sourceSpecId`). **하나뿐이다.** `depends_on`은 싣지 않았다.

판정 방법: 작업 문서 지시대로 `git diff`의 `WorkflowItemSummary` 변경분만 보는 것은 성립하지 않았다.
저장소에 병행 세션의 미커밋 변경이 크게 남아 HEAD 대비 diff에는 이 세션과 무관한 필드
(`pending_work`, `stalled_spec_ids`, `events` 등)가 함께 `+`로 나온다.

대신 심볼 단위로 확인했다. 이 세션의 편집은 정확히 네 번이고 저장소 전체에서 `source_spec_id`를
재검색하면 이 세션이 만든 자리는 `project.rs:119`, `fs_project_repository.rs:1180`·`:1192`와
테스트 단언 3줄뿐이다. 나머지 검색 결과(`role_eligibility.rs`의 픽스처 문자열 3건,
`project_instructions.rs`의 규칙 문구 6건, `fs_project_repository.rs:1800`·`:2815`의 픽스처)는
모두 이 세션 이전부터 있던 것이고 손대지 않았다. `sourceSpecId`는 `types.ts:49` 한 곳뿐이다 —
읽는 코드가 없다는 뜻이고, 그것이 이 작업의 상한이다.

### 조건 3 — 확인 사실 6의 주석 두 곳

`keeps_the_declaration_out_of_the_list_payload`를 **수정 없이** 돌렸다: 통과.
주석 두 곳도 원문 그대로다.

- `fs_project_repository.rs:285`~`:287` — "…목록 payload는 이 값을 싣지 않는다(SPEC-013 R5)."
- `fs_project_repository.rs:769`~`:770` — "…목록 읽기는 선언을 담지 않으므로 (`WorkflowItemSummary`에
  필드를 더하지 않는다 — TASK-037) `tasks/`를 한 번 더 훑는다."

두 주석이 말하는 대상은 의존 선언이지 프론트매터 전반이 아니므로 이 변경 뒤에도 참이다.

## 검증

- `cargo test --manifest-path src-tauri/Cargo.toml` → 401 passed / 401, 0 failed, 0 ignored.
  (`cargo`가 PATH에 없어 `~/.cargo/bin/cargo`로 실행했다.)
- 착수 전후 대상 테스트 개별 실행 — `reads_the_source_decision_of_a_task_and_leaves_it_empty_elsewhere`
  통과, `keeps_the_declaration_out_of_the_list_payload` 통과.
- `npm run check` (typecheck → test → build) → 전부 통과. 18 파일 474건 통과, `tsc -b` 무오류,
  `vite build` 성공(325 modules).

## 남은 위험과 후속

- **TASK-095가 딛고 설 자리.** `sourceSpecId`가 `null`인 작업 항목이 미분류 레인으로 가는 것이
  요구다. 오늘 이 워크플로우의 작업 문서에는 전부 값이 있어 `null` 경로가 실데이터로는 밟히지 않는다.
  그 레인의 화면 검사는 픽스처로 만들어야 한다.
- **역할 밖 관찰(수정하지 않음).** `fs_project_repository.rs:770`의 괄호 문구
  "`WorkflowItemSummary`에 필드를 더하지 않는다 — TASK-037"은 대상이 의존 선언임을 앞 절이 밝히고
  있어 거짓은 아니지만, 필드가 하나 늘어난 지금은 문장만 떼어 읽으면 넓게 읽힌다. 작업 문서가
  "확인 사실 6의 주석 정리"를 범위 밖으로 못 박아 두어 손대지 않았다. 정리한다면 별도 작업이다.
- **역할 밖 관찰(수정하지 않음).** `.workflow/.runtime/leases/SPEC-009.yml`이
  2026-08-03T01:20:00Z에 만료된 채 남아 있다. 판정이 만료 lease를 선점으로 세지 않아 지금 막는 것은
  없고, 규칙상 세션이 남의 lease 파일을 지우지 않으므로 그대로 두었다.
- 사용자 QA 범위: 화면에 보이는 변화는 없다. payload 필드 추가와 타입 확장이 전부이므로,
  개발 보드·문서 목록이 이전과 똑같이 뜨는지(회귀 없음)만 확인하면 된다.
