---
schema: workflow-labs/task@1
id: TASK-035
title: 아이디어 파생 상태를 수집됨·반영중·채택으로 판정하고 중단 의심 근거를 화면까지 나른다
status: verified
source_spec_id: SPEC-012
source_decision_id: DECISION-9B93CEA0
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T04:00:00Z
  kind: created
- at: 2026-08-03T08:42:00Z
  kind: in_progress
- at: 2026-08-03T08:54:00Z
  kind: qa_waiting
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-9B93CEA0
work_group_revision: 1
---

# 아이디어 파생 상태를 수집됨·반영중·채택으로 판정하고 중단 의심 근거를 화면까지 나른다

SPEC-012의 백엔드 몫 전부를 구현한다. 지금 두 갈래(참조 있음/없음)인 아이디어 파생 판정을 세 갈래로
바꾸고, 중단 의심일 때 걸려 있는 draft 기획서의 문서 id를 payload에 싣는다. 목록 조회와 아이디어 전문
읽기가 같은 함수를 쓰게 만들어 두 경로의 결론이 갈리지 않게 한다.

화면은 한 줄도 건드리지 않는다. `IdeaInbox.tsx`·`App.css`는 TASK-036이다. 이 작업이 끝난 시점의 화면은
지금과 똑같이 보인다 — 새 상태값 `drafting`을 화면이 아직 모르므로 "수집됨"으로 떨어진다. 그 중간 상태는
의도된 것이고, TASK-036이 곧바로 이어받는다.

## 의존성

- 선행 작업 없음. SPEC-012의 첫 작업이다.
- 이 작업의 산출물(아이디어 항목의 세 상태값과 `stalledSpecIds`)을 TASK-036이 화면에서 쓴다. TASK-036은
  이 작업 없이는 그릴 값이 없다.
- **TASK-036과 병행 금지.** 이 작업이 `src/features/projects/domain/types.ts`를 바꾸고 TASK-036이 그
  타입을 읽는다.
- **SPEC-009 계열 TASK-028·TASK-029와 병행 금지.** 셋 다 `src-tauri/src/domain/project.rs`를 만지고,
  TASK-029는 `fs_project_repository.rs`와 `docs/file-contract.md`까지 겹친다. 둘 다 아직 `todo`다.
  순서는 어느 쪽이 먼저여도 된다.
- **SPEC-011 계열 TASK-032와 병행 금지.** `domain/project.rs`·`fs_project_repository.rs`·`types.ts`·
  `docs/file-contract.md` 네 파일이 전부 겹친다. TASK-032가 `read_active_leases`와 `AgentLeaseSummary`를
  고치는데 이 작업이 그 결과값을 읽는다. 순서는 어느 쪽이 먼저여도 되지만, TASK-032가 먼저면 이 작업은
  늘어난 필드를 무시하기만 하면 된다.
- **SPEC-009 계열 TASK-030과 병행 금지.** `types.ts`가 겹친다.

## 범위

- `src-tauri/src/domain/project.rs` — `WorkflowItemSummary`에 `stalled_spec_ids` 추가, `status` 필드의
  주석.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — 판정 함수 신설, `workflow_items`·`read_idea`·
  `summary_from_manifest`·`create_workflow`의 배선, `adopted_idea_ids` 제거, 테스트.
- `src/features/projects/domain/types.ts` — `WorkflowItemSummary.stalledSpecIds`.
- `docs/file-contract.md` — 아이디어 파생 상태를 설명하는 문단(`:75`).
- 그 외 파일은 건드리지 않는다. 특히 `IdeaInbox.tsx`·`App.css`·`heartbeat_condition.rs`·
  `project_instructions.rs`는 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **판정은 읽기이고 파생이다**(R6, 완료 조건 17·21). 아이디어·기획서·lease 파일에 쓰지 않는다. 아이디어
  문서의 `status` 필드는 파일에서 계속 `inbox`로 남는다. 앱이 판정 결과를 어딘가에 저장하지도 않는다.
- **새 원천을 만들지 않는다**(R6). 쓰는 값은 기획서의 `source_idea_id`·상태와 미만료 lease의 `task_id`
  뿐이다. 새 파일·새 프론트매터 필드·새 조회 커맨드·새 폴링을 만들지 않는다.
- **조건 스크립트를 건드리지 않는다**(기획서 제외 범위, 완료 조건 22). `heartbeat_condition.rs`의 기획자
  자격 판정은 지금처럼 참조 유무만 본다. 여기에 상태 조건을 더하면 draft가 남은 아이디어를 다른 세션이
  다시 집게 되어 선점 프로토콜이 깨진다. 화면과 조건 스크립트의 결론이 갈리는 것은 승인된 설계다.
- **문서 계약을 늘리지 않는다**(기획서 제외 범위). 아이디어·기획서·lease의 스키마와 필수 필드를 바꾸지
  않는다. 늘어나는 것은 앱이 화면으로 내려보내는 payload뿐이다.
- **`read_active_leases`의 오류 처리를 바꾸지 않는다.** `migrate`가 이 함수의 `Err`를 마이그레이션 차단
  근거로 쓴다(`:412`). 오류를 빈 목록으로 접으면 활성 lease가 있는데도 마이그레이션이 도는 길이 열린다.

### 1. payload에 중단 의심 근거를 더한다

`WorkflowItemSummary`(`domain/project.rs:93`)에 필드 하나를 더한다.

```rust
/// 중단 의심의 근거. 이 아이디어가 반영중인데 선점한 미만료 lease가 없을 때, 걸려 있는 `draft`
/// 기획서의 문서 id다. 문서 id 오름차순이며 그 조합이 아니면 비어 있다. 비어 있지 않다는 것과
/// 중단 의심은 같은 뜻이다(SPEC-012 R5). 기획서·개발 작업 항목에서는 항상 비어 있다.
pub stalled_spec_ids: Vec<String>,
```

두 값(`stalled`, `blocking_ids`)을 따로 싣지 않는다. 반영중인데 lease가 없다는 것은 곧 draft 참조가 있다는
뜻이라(lease도 draft도 없으면 반영중이 아니다) 두 값이 항상 같이 움직인다. 따로 두면 서로 어긋난 조합을
표현할 수 있게 되고, 화면이 어느 쪽을 믿을지 정해야 한다.

같은 편집에서 `status` 필드에 주석을 남긴다. 아이디어 항목의 `status`는 이제 파일 값이 아니라 파생값이며
`inbox`·`drafting`·`adopted` 셋 중 하나라는 사실이다.

### 2. 아이디어 판정을 한 함수로 모은다

지금 판정은 `adopted_idea_ids`(`:867`) 한 줄짜리 규칙이고, `workflow_items`(`:851`)와 `read_idea`(`:287`)가
각자 호출한다. 세 갈래 판정으로 바뀌면 두 곳이 어긋날 여지가 생기므로 **판정 본체를 함수 하나로 두고 두
경로가 그 함수만 부른다**(R7, 완료 조건 19).

판정에 필요한 기획서 정보를 담는 내부 타입을 만든다.

```rust
/// 아이디어를 참조하는 기획서 하나. 판정에 필요한 값만 담는다.
struct SpecReference {
    idea_id: String,
    spec_id: String,
    /// 화면 기준 상태가 `draft`인가. 정규화와 결정 덮어쓰기를 반영한 결과다.
    is_draft: bool,
}

fn spec_references(workflow_root: &Path) -> Vec<SpecReference>
```

- `specs/*.md`를 읽어 `source_idea_id`가 있는 문서만 담는다. 없는 문서는 아이디어에서 출발하지 않은
  기획서이므로 판정 대상이 아니다.
- `spec_id`는 프론트매터 `id`이고, 없으면 파일 stem이다. `read_markdown_document`(`:929`)의 fallback과 같은
  규칙이어야 화면이 짚어 주는 id와 목록의 기획서 id가 어긋나지 않는다.
- `is_draft`는 **화면 기준 상태가 `draft`인가**이지 파일에 적힌 글자가 아니다. 화면 기준 상태는
  `normalize_spec_status`(`:884`)가 `draft`·`user_review`로 접은 뒤 `latest_spec_decisions`(`:1127`)의
  `outcome`으로 덮어쓴 값이다(`workflow_items:845`~`849`). 그래서 다음 두 조건이 동시에 참일 때만
  `is_draft`다.
  - 이 기획서를 가리키는 사용자 결정 문서가 없다.
  - 파일의 `status`가 `user_review`가 아니다. (정규화가 알 수 없는 값을 `draft`로 떨어뜨리므로,
    `draft`가 아니라고 말하려면 `user_review`가 명시돼 있어야 한다. 기획서 확인 사실 33번째 줄이 이 성질을
    명시했다.)
- `latest_spec_decisions`는 이미 있는 함수를 그대로 쓴다. 결정 판정 규칙을 새로 쓰지 않는다.

판정 본체는 아래 함수 하나다.

```rust
/// 아이디어 항목의 `status`와 `stalled_spec_ids`를 파생값으로 채운다.
/// 목록 조회와 전문 읽기가 같은 결론을 내도록 두 경로가 이 함수만 부른다(SPEC-012 R7).
fn derive_idea_states(
    ideas: &mut [WorkflowItemSummary],
    references: &[SpecReference],
    leases: &[AgentLeaseSummary],
)
```

아이디어 하나에 대한 규칙이다. 순서가 곧 우선순위다(R1).

1. `preempted` = 미만료 lease 중 `task_id`가 이 아이디어의 문서 id와 정확히 같은 것이 있는가.
   `task_id`가 `None`인 lease는 세지 않는다(R3). 만료 판정은 하지 않는다 — 받은 목록이 이미 미만료만
   담고 있다.
2. `drafts` = 이 아이디어를 참조하는 `SpecReference` 중 `is_draft`인 것들의 `spec_id`. 문서 id 오름차순
   으로 정렬한다. `fs::read_dir` 순서는 플랫폼마다 다르므로 정렬하지 않으면 같은 상태에서 화면 문구가
   흔들린다.
3. 참조가 하나도 없고 `preempted`도 아니면 → `status = "inbox"`, `stalled_spec_ids`는 빈 값.
4. 그 밖에 `preempted`이거나 `drafts`가 비어 있지 않으면 → `status = "drafting"`.
   `stalled_spec_ids`는 `preempted`이면 빈 값, 아니면 `drafts`.
5. 나머지(참조는 있고 반영중이 아님) → `status = "adopted"`, `stalled_spec_ids`는 빈 값.

세 상태는 이 분기에서 배타적이고 빠짐없다(R1 마지막 줄). 상태값 `drafting`은 화면의 "반영중"에 대응한다.
개발 작업의 `in_progress`를 재사용하지 않는다 — 같은 필드에 뜻이 다른 같은 글자가 들어가면 화면 코드가
문서 종류를 먼저 보고 해석해야 한다.

**파일에 적힌 아이디어 `status`는 payload로 흘려보내지 않는다.** 세 상태가 배타적이려면 판정이 세 경우
모두에 값을 써야 한다. 지금 코드는 `adopted`일 때만 덮어쓰고 나머지는 파일 값을 그대로 실어 보내는데,
그러면 `status: adopted`라고 적힌 아이디어 파일이 참조 없이도 채택으로 보인다. 파일은 여전히 쓰지 않는다
(R6) — 읽은 값을 화면에 그대로 흘리지 않을 뿐이다.

`adopted_idea_ids`(`:867`)는 이 함수로 대체되므로 지운다. 다른 호출처가 없다.

### 3. 두 경로에 배선한다

**목록 경로.** `workflow_items`(`:842`)가 lease 목록을 받게 한다.

```rust
fn workflow_items(workflow_root: &Path, leases: &[AgentLeaseSummary]) -> WorkflowItems
```

`summary_from_manifest`(`:623`)가 `active_leases`를 이미 인자로 받고 있다(`:627`). 워크플로우 목록을 먼저
만들고 나서 `active_leases`를 `ProjectSummary`로 옮기면 빌림과 이동이 부딪히지 않는다.

**전문 읽기 경로.** `read_idea`(`:273`)가 같은 함수를 부른다.

```rust
let leases = read_active_leases(&control_root).unwrap_or_default();
derive_idea_states(std::slice::from_mut(&mut summary), &spec_references(&workflow_root.join("specs")), &leases);
```

여기서만 `unwrap_or_default()`를 쓴다. 이 경로에는 마이그레이션 차단 같은 안전 판정이 걸려 있지 않고,
lease를 못 읽었다고 아이디어 전문이 통째로 안 열리는 편이 더 나쁘다(R6 마지막 줄). `inspect`는 `?`를
그대로 둔다 — lease 디렉터리가 없는 경우는 `read_active_leases`가 이미 빈 목록으로 돌려주므로(`:570`)
완료 조건 18은 이 변경 없이 성립한다. 두 경로의 오류 처리가 갈리는 지점은 "디렉터리는 있는데 읽지
못하는" 경우뿐이고, 그때 `inspect`는 목록 자체를 못 만들므로 두 화면이 어긋난 상태를 사용자가 볼 수 없다.

**`create_workflow`가 빈 lease 목록을 넘기는 것을 고친다**(`:186`). 이 호출은 방금 만든 워크플로우뿐 아니라
기존 워크플로우의 아이디어까지 다시 실어 보낸다. 지금은 `activeLeases`만 비어서 배너가 잠깐 사라지는
정도였지만, 이 작업 뒤에는 살아 있는 lease가 무시되어 정상 반영중인 아이디어가 한 조회 동안 중단 의심으로
보인다. 경고를 거짓으로 띄우는 것은 그 경고를 못 믿게 만든다. `read_active_leases(&control_root)?`로 바꾼다.

`migrate`(`:428`)의 `Vec::new()`는 그대로 둔다. 그 경로는 활성 lease가 하나라도 있으면 위에서 이미
`Err(ActiveLeases)`로 끝나므로(`:412`) 빈 목록이 사실이다.

### 4. 타입스크립트 타입

```ts
export interface WorkflowItemSummary {
  // ...
  /**
   * 중단 의심의 근거. 아이디어가 반영중인데 선점한 미만료 lease가 없을 때 걸려 있는 draft 기획서의
   * 문서 id다. 비어 있지 않다는 것과 중단 의심은 같은 뜻이다. 기획서·개발 작업 항목에서는 비어 있다.
   */
  stalledSpecIds?: string[];
}
```

`events`·`dueAt`와 같이 선택 필드로 둔다. 백엔드는 항상 실어 보내지만, 이 저장소의 프론트엔드 테스트
픽스처가 `WorkflowItemSummary` 리터럴을 여러 파일에서 직접 만들고 있어서(`IdeaInbox.test.tsx:6`,
`DevelopmentBoard.test.tsx` 등) 필수로 두면 이 작업이 화면 테스트 파일들을 건드리게 된다. 이 작업의 범위는
화면 밖이다.

아이디어 `status`가 세 값의 파생값이라는 사실도 같은 주석 블록에 남긴다.

### 5. 파일 계약 문서

`docs/file-contract.md:75`의 문장이 지금 판정을 이렇게 설명한다.

> 앱은 이 참조를 읽어 해당 아이디어를 `기획서 채택` 상태로 표시하며, 어떤 기획서도 참조하지 않는
> 아이디어만 미처리 아이디어로 본다.

세 갈래 판정으로 고쳐 쓴다. 담을 사실은 넷이다.

- 앱이 아이디어를 수집됨·반영중·채택 세 상태로 표시한다는 것.
- 반영중의 근거가 "미만료 lease의 선점" 또는 "`draft` 참조 기획서"라는 것.
- 이 판정이 조회 시점 파생이고 앱이 아이디어 파일을 쓰지 않는다는 것.
- **조건 스크립트의 미처리 판정은 지금과 같다는 것.** 화면이 반영중이라고 말하는 아이디어도 조건
  스크립트에서는 참조가 있으므로 미처리가 아니다. 이 문서를 읽는 에이전트가 화면 표시를 자격 판정으로
  오해하지 않게 한다.

lease 문단(`:158`)은 건드리지 않는다. lease 계약이 바뀌지 않는다.

### 6. 테스트

Rust(`fs_project_repository.rs`). 기존 `marks_ideas_referenced_by_specs_as_adopted`(`:1416`)와
`reports_adopted_status_for_an_idea_referenced_by_a_spec`(`:2355`)이 두 경로의 선례다. 새 상태값에 맞게
고치고 아래를 더한다. lease 픽스처는 `reports_only_non_expired_agent_leases`(`:1352`)의 모양을 따른다.

- 참조 기획서가 없고 lease도 없는 아이디어가 `inbox`이고 `stalled_spec_ids`가 비어 있다. (완료 조건 1)
- 참조 기획서가 `draft` 하나뿐이고 lease가 없으면 `drafting`이고 `stalled_spec_ids`에 그 기획서 id가 있다.
  (완료 조건 2·3·14·16)
- 참조 기획서가 없고 `task_id`가 그 아이디어 id인 미만료 lease가 있으면 `drafting`이고
  `stalled_spec_ids`는 비어 있다. (완료 조건 4·15)
- 참조 기획서가 `status: user_review`이고 lease가 없으면 `adopted`다. (완료 조건 5)
- 참조 기획서에 사용자 결정이 있으면 `approved`·`revision_requested`·`rejected` 셋 모두에서 `adopted`다.
  결정 문서의 프론트매터는 `latest_spec_decisions`가 요구하는 대로 `schema: workflow-labs/decision@1`과
  `created_by: user`를 갖춘다. (완료 조건 6)
- 같은 아이디어를 `draft` 기획서와 `user_review` 기획서가 함께 참조하면 `drafting`이고
  `stalled_spec_ids`에는 `draft` 쪽만 담긴다. (완료 조건 7)
- 만료된 lease만 있고 참조 기획서가 없으면 `inbox`다. (완료 조건 8)
- `task_id: null`인 미만료 lease는 어떤 아이디어의 판정도 바꾸지 않는다. (완료 조건 9)
- `task_id`가 기획서 id(`SPEC-*`)인 미만료 lease가 있고 그 기획서가 이 아이디어를 참조하며 결정까지
  받았으면 `adopted`다. `drafting`으로 넘어가지 않는다. (완료 조건 10)
- `draft` 기획서가 둘이면 `stalled_spec_ids`가 둘 다 담고 문서 id 오름차순이다.
- 같은 프로젝트에 워크플로우가 둘이면 각 아이디어가 자기 워크플로우의 기획서만 본다. lease는 프로젝트
  전역이라 워크플로우를 가리지 않는다(R3 마지막 줄, 전제 그대로).
- 세 상태 각각에 대해 `inspect`의 목록 항목과 `read_idea`의 요약이 같은 `status`·`stalled_spec_ids`를
  갖는다. (완료 조건 19)
- `inspect`와 `read_idea`를 부른 전후로 `.workflow` 아래 아이디어·기획서·lease 파일의 내용과 수정 시각이
  같다. `heartbeat_status.rs`의 `reading_the_status_does_not_touch_the_heartbeat_home`(`:604`)과 같은
  형태로 만든다. (완료 조건 17·21)
- lease 디렉터리가 없는 프로젝트에서 `inspect`가 성공하고 아이디어 목록이 나온다. (완료 조건 18)
- 같은 tempdir에서 lease 파일을 미만료로 두고 한 번, 만료 시각으로 덮어쓰고 한 번 조회하면 `drafting`은
  그대로이고 `stalled_spec_ids`만 비었다가 채워진다. 파일을 두 번 쓰는 것으로 시각 경과를 대신한다 —
  실제로 기다리면 테스트가 느려지고 불안정해진다. (완료 조건 20)

Rust(`heartbeat_condition.rs`): 새 테스트를 쓰지 않는다. 기존 조건 스크립트 테스트가 **수정 없이** 통과
하는 것이 완료 조건 22의 검증이다. 통과하지 않는다면 이 작업이 범위를 넘은 것이다.

프론트엔드: 새 테스트를 쓰지 않는다. 기존 프론트엔드 테스트가 수정 없이 통과해야 한다. `stalledSpecIds`가
선택 필드라 픽스처가 그대로 유효하다.

## 완료 조건

1. 참조 기획서가 없고 선점 lease도 없는 아이디어의 상태가 `inbox`다. (기획서 완료 조건 1)
2. `draft` 참조 기획서가 있으면 lease 유무와 무관하게 `drafting`이다. (기획서 완료 조건 2·3·7)
3. 참조 기획서가 없어도 `task_id`가 그 아이디어를 가리키는 미만료 lease가 있으면 `drafting`이다.
   (기획서 완료 조건 4)
4. 참조 기획서가 모두 `draft`가 아니고 선점 lease가 없으면 `adopted`다. 결정이 승인·수정 요청·반려 어느
   쪽이든 같다. (기획서 완료 조건 5·6)
5. 만료된 lease, `task_id`가 없는 lease, 기획서 id를 가리키는 lease가 아이디어 판정을 바꾸지 않는다.
   (기획서 완료 조건 8·9·10)
6. 반영중이면서 선점 lease가 없을 때만 `stalled_spec_ids`가 걸린 `draft` 기획서 id를 담고, 순서가
   문서 id 오름차순이다. (기획서 완료 조건 14·15·16의 백엔드 몫)
7. 목록 조회와 전문 읽기가 세 상태 모두에서 같은 결론을 낸다. (기획서 완료 조건 19)
8. 조회가 아이디어·기획서·lease 파일을 바꾸지 않고, 아이디어 문서의 `status`가 파일에서 `inbox`로 남는다.
   (기획서 완료 조건 17·21)
9. lease 디렉터리가 없어도 아이디어 목록이 나온다. (기획서 완료 조건 18)
10. lease가 만료되면 다음 조회에서 같은 아이디어의 `stalled_spec_ids`가 채워진다. (기획서 완료 조건 20)
11. 조건 스크립트의 기획자 자격 판정이 이 변경 전후로 같다. 기존 테스트가 수정 없이 통과한다.
    (기획서 완료 조건 22)
12. 화면 동작이 바뀌지 않는다. 기존 프론트엔드 테스트가 수정 없이 통과한다.
13. `npm run check`와 `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`가 통과한다.
    (기획서 완료 조건 23)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

화면 확인은 이 작업에서 하지 않는다. payload만 바뀌고 화면은 아직 새 값을 읽지 않는다.

## 범위 밖

- 화면의 어떤 변경도. 세 상태 표시·중단 의심 표시·`기획 반영` 태그 정리는 TASK-036이다.
- 조건 스크립트(`heartbeat_condition.rs`)의 자격 판정 변경. 기획서 제외 범위이고 완료 조건 22가 현행
  동작을 고정한다.
- 죽은 세션의 자동 회수, 만료 lease 파일 정리, 버려진 draft 기획서의 삭제·병합·상태 변경.
- 아이디어 파일 쓰기. `status` 필드를 앱이 고치는 경로를 만들지 않는다.
- lease 계약 확장. `role` 필드는 TASK-032(SPEC-011)의 몫이고 이 판정은 `task_id`만 쓴다.
- `read_active_leases`의 만료 판정·정렬·오류 처리 변경.
- 기획서 화면·개발 작업 화면의 상태 표시.
- 아이디어 목록의 정렬·필터·검색. 상태별로 걸러 보는 기능은 기획서 제외 범위다.
- 반려·수정 요청만 받은 기획서를 참조하는 아이디어를 채택과 구분하는 것. DECISION-9B93CEA0이 이 기획서
  범위에서 수용하기로 했고 회수 정책은 IDEA-C95EABD2로 따로 등록돼 있다.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `adopted_idea_ids`(`fs_project_repository.rs:867`)는 `specs/*.md`의 `source_idea_id`만 모은
  `HashSet`이다. 기획서 `status`도 결정 문서도 보지 않는다.
- `workflow_items`(`:842`)가 그 집합에 든 아이디어의 `status`를 `adopted`로 덮어쓰고(`:854`),
  `read_idea`(`:287`)가 같은 판정을 따로 한 번 더 한다.
- `workflow_items`의 기획서 상태 계산(`:843`~`:850`)이 `normalize_spec_status`와 `latest_spec_decisions`를
  쓴다. `normalize_spec_status`(`:884`)는 `draft`·`user_review` 밖의 값을 `draft`로 떨어뜨린다.
- `latest_spec_decisions`(`:1127`)는 `schema: workflow-labs/decision@1`이고 `created_by: user`인 결정만
  본다. 반환값은 `spec_id -> (created_at, outcome)`이다.
- `read_active_leases`(`:568`)는 `expires_at > now`인 lease만 담고 `expires_at` 오름차순으로 정렬한다.
  `task_id`는 `Option<String>`이다(`domain/project.rs:155`). 디렉터리가 없으면 빈 목록을 돌려주고
  (`:570`), 열지 못하거나 파싱 실패한 파일은 조용히 건너뛴다.
- `summary_from_manifest`(`:623`)는 `active_leases`를 인자로 받아 `ProjectSummary`에 그대로 싣는다.
  `workflow_items`는 이 값을 못 본다.
- `summary_from_manifest` 호출처는 다섯이다. `inspect`(`:107`)·`create_idea`(`:230` 경유)·
  `record_spec_decision`(`:336`)·`record_task_qa`(`:390`)는 실제 lease를 읽어 넘기고,
  `create_workflow`(`:182`)와 `migrate`(`:424`)는 `Vec::new()`를 넘긴다.
- `migrate`는 활성 lease가 있으면 `ProjectError::ActiveLeases`로 끝난다(`:412`).
- 이 저장소의 아이디어 파일은 `schema: workflow-labs/idea@1`, `status: inbox`를 갖는다. 앱이 만드는
  아이디어도 같다.
- `WorkflowItemSummary`(`domain/project.rs:93`)는 `Serialize`만 파생하고 `camelCase`로 나간다. 프론트엔드의
  대응 타입은 `src/features/projects/domain/types.ts:36`이고 `dueAt`·`events`가 선택 필드다.
- 화면에서 아이디어 `status`를 읽는 곳은 `IdeaInbox.tsx` 두 군데(`:96`~`:105`, `:148`)뿐이다.
  `ProjectSearchDialog`는 제목과 종류만 쓴다.
- `docs/file-contract.md:75`가 현행 두 갈래 판정을 설명한다. 같은 문서 `:158`이 lease 계약 문단이다.
- 이 저장소의 `.workflow/.runtime/leases`에는 만료된 `SPEC-009.yml`이 남아 있다. 앱은 lease 파일을 지우지
  않는다.
