---
schema: workflow-labs/task@1
id: TASK-037
title: 개발 작업의 선행 선언을 읽어 충족 여부와 영원히 열리지 않는 선언을 작업 상세 payload에 싣는다
status: completed
source_spec_id: SPEC-013
source_decision_id: DECISION-73D4BC1B
updated_at: 2026-08-03T12:42:56Z
history:
  - { at: 2026-08-03T05:05:00Z, kind: created }
  - { at: 2026-08-03T09:05:30Z, kind: in_progress }
  - { at: 2026-08-03T09:17:36Z, kind: qa_waiting }
---

# 개발 작업의 선행 선언을 읽어 충족 여부와 영원히 열리지 않는 선언을 작업 상세 payload에 싣는다

SPEC-013 R1의 읽기 몫과 R2의 충족 판정, R5의 백엔드 몫을 구현한다. 개발 작업 프론트매터의 선행 선언을
읽어 각 선행 작업의 판정 결과를 작업 상세 조회 결과에 싣는다. 화면은 한 줄도 건드리지 않는다.

이 작업이 정하는 판정 규칙이 TASK-040의 조건 스크립트가 sh로 구현할 규칙과 같아야 한다. 두 곳이 갈리면
화면과 실행이 서로 다른 말을 한다(R2 마지막 줄). 규칙은 아래 "판정 규칙" 절에 한 번만 적고, TASK-040은
그 절을 그대로 옮긴다.

## 의존성

- 선행 작업 없음. SPEC-013의 첫 작업이다.
- 이 작업의 산출물(작업 상세 payload의 선행 판정)을 TASK-038이 화면에서 쓴다.
- 이 작업이 확정하는 판정 규칙을 TASK-040이 sh로 옮긴다. 순서는 어느 쪽이 먼저여도 되지만, 두 구현이
  갈리면 안 된다. 규칙 본문은 이 문서에 있다.
- **TASK-039와 병행 금지.** 둘 다 `src-tauri/src/infrastructure/fs_project_repository.rs`를 만진다.
  TASK-039가 이 작업을 선행으로 선언했다.
- **SPEC-009 계열 TASK-029와 병행 금지.** 둘 다 `domain/project.rs`·`fs_project_repository.rs`를
  만지고, TASK-029는 `read_markdown_document`를 함께 고친다. 순서는 어느 쪽이 먼저여도 된다.
- **SPEC-011 계열 TASK-032, SPEC-012 계열 TASK-035와 병행 금지.** 같은 두 파일이 겹친다. 순서는 어느
  쪽이 먼저여도 된다.

## 범위

- `src-tauri/src/domain/project.rs` — `TaskDocument`의 새 필드 둘, `TaskDependency`,
  `TaskDependencyState`.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — 선언 파싱, 판정 함수, `read_task` 배선,
  테스트.
- 그 외 파일은 건드리지 않는다. 특히 화면·`types.ts`·`heartbeat_condition.rs`·
  `project_instructions.rs`·`docs/file-contract.md`는 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **앱은 이 기능 때문에 작업 문서를 쓰지 않는다**(R5, 완료 조건 17). 판정은 읽는 시점의 파생이고
  어디에도 저장하지 않는다. 그래서 QA 반려로 선행이 `todo`로 돌아가면 후행은 다시 미충족이 되고
  되돌림 처리가 필요 없다(R2).
- **목록 payload를 늘리지 않는다.** `WorkflowItemSummary`에 필드를 더하지 않는다. `inspect`는 2.5초마다
  돌고, 판정에는 워크플로우의 모든 작업 문서를 한 번 더 읽어야 한다. R5가 요구하는 것은 상세 화면이다.
  목록에 선행 표시를 얹는 것은 이 기획서 범위가 아니다.
- **선언은 YAML 파서로 읽지 않는다.** 아래 "1. 선언 파싱"의 이유를 먼저 읽는다.
- **스키마 식별자를 바꾸지 않는다**(R1). `workflow-labs/task@1` 그대로이고, 선언이 없는 기존 작업
  문서는 전부 그대로 유효하다.
- **선언 필드를 앱이 채우거나 고치지 않는다**(기획서 제외 범위). 이 필드는 아키텍트가 쓴다.

### 1. 선언 파싱 — 왜 YAML 파서를 쓰지 않는가

계약이 정하는 표기는 **열 0에서 시작하는 한 줄 흐름 시퀀스** 하나뿐이다.

```yaml
  depends_on: [TASK-001, TASK-002]
```

블록 표기를 계약에서 막는 이유가 둘이다.

1. **앱이 QA 전이를 기록할 때 문서가 깨진다.** `append_task_history`(`:767`)는 `history:` 헤더 다음의
   들여쓴 연속 줄을 끝까지 스캔한 뒤 그 자리에 항목을 넣는다. 스캔은 들여쓰기가 없는 줄에서 멈춘다.
   선언이 `history:` 뒤에 블록 표기로 오면 그 항목들이 이력 블록으로 이어져 읽히고, 새 전이 항목이
   선언 목록의 원소로 삽입된다. 키를 열 0에 두는 것만으로는 막을 수 없고 값도 한 줄이어야 한다.
2. **조건 스크립트가 읽을 수 없다.** TASK-040이 같은 판정을 POSIX sh로 구현한다. 블록 표기를 sh가
   읽게 만들면 두 구현의 파싱 규칙이 갈라지고, 그 갈라짐은 "화면은 열렸다는데 하트비트가 안 돈다"로
   나타난다.

그래서 파싱도 줄 단위다. `serde_yaml`은 두 표기를 구분해 주지 않으므로 이 판정에 쓸 수 없다.
프론트매터를 줄 단위로 다루는 것은 이 저장소의 기존 방식이기도 하다(`update_task_frontmatter:720`,
`append_task_history:767`).

```rust
/// 프론트매터의 선행 선언 한 줄을 읽은 결과.
enum DependencyDeclaration {
    /// 키가 없다. 선행 작업이 없다는 뜻이다.
    Absent,
    /// 계약 형식의 목록을 읽었다. 빈 목록일 수 있다.
    Declared(Vec<String>),
    /// 키는 있는데 계약 형식이 아니다. 미충족으로 다룬다(R3).
    Malformed,
}

fn parse_dependency_declaration(frontmatter: &str) -> DependencyDeclaration
```

규칙은 이 순서다. TASK-040이 sh로 같은 결론을 내야 하므로 한 줄도 바꾸지 않는다.

1. 프론트매터에서 `depends_on:`으로 시작하는 열 0 줄을 모은다. 없으면 `Absent`.
2. 두 줄 이상이면 `Malformed`. (YAML 중복 키이기도 하다.)
3. 키 뒤 값을 trim한다. 비어 있으면 `Malformed`. 블록 표기가 여기서 걸린다.
4. 값이 `[`로 시작해 `]`로 끝나지 않으면 `Malformed`.
5. 대괄호 안쪽을 `,`로 나누고 각 토큰을 trim한다. 토큰이 전부 비어 있으면 `Declared(vec![])`.
6. 토큰 중 하나라도 비어 있거나 `[A-Za-z0-9_-]` 밖의 문자를 포함하면 `Malformed`. 따옴표로 감싼
   표기(`["TASK-001"]`)도 여기서 걸린다. 계약이 정하는 것은 따옴표 없는 문서 id다.
7. 그 밖은 `Declared(토큰들)`.

프론트매터 원문이 필요하다. `split_frontmatter`(`:990`)는 파싱된 값과 본문만 돌려주므로, 원문 구간을
돌려주는 작은 함수를 하나 더한다. `split_frontmatter`의 시그니처는 바꾸지 않는다 — 호출처가 둘이고
둘 다 이 값을 쓰지 않는다.

### 2. 판정 규칙

선행 작업 하나의 판정 결과를 `domain/project.rs`에 둔다.

```rust
/// 선언된 선행 작업 하나의 판정 결과(SPEC-013 R2).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskDependencyState {
    /// 선행 작업이 `qa_waiting` 또는 `completed`다. 후행이 딛고 설 코드가 트리에 있다.
    Satisfied,
    /// 선행 작업이 아직 그 상태에 이르지 못했다. 시간이 지나면 풀릴 수 있다.
    Pending,
    /// 그 id의 개발 작업 문서가 이 워크플로우에 없다. 영원히 충족되지 않는다.
    Missing,
    /// 선언을 따라가면 자기 자신으로 돌아온다. 영원히 충족되지 않는다.
    Cyclic,
}

/// 작업 하나가 선언한 선행 작업 하나.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDependency {
    pub id: String,
    pub state: TaskDependencyState,
}
```

판정 규칙이다. **이 절이 R2의 단일 정의이고 TASK-040이 그대로 옮긴다.**

- 선행 작업의 상태가 `qa_waiting` 또는 `completed`면 `Satisfied`, 그 밖의 값이면 `Pending`이다.
  계약에 없는 상태값도 `Pending`이다 — 모르는 값을 충족 쪽으로 넘기지 않는다.
- 그 id의 작업 문서가 없으면 `Missing`이다. 없는 참조를 "제약 없음"으로 읽지 않는다(R2).
- 선언 그래프에서 그 선행 작업으로부터 선언을 따라 지금 작업으로 돌아오는 경로가 있으면 `Cyclic`이다.
  자기 자신을 참조한 경우가 길이 1인 이 경우다. `Cyclic`은 상태 판정보다 우선한다 — R2가 순환을
  상태와 무관하게 미충족으로 정했다.
- 판정 순서는 `Missing` → `Cyclic` → 상태다.
- 선행 작업 자신의 선언이 `Malformed`인 것은 지금 작업의 판정을 바꾸지 않는다. 그 작업의 상태만 본다.
  형식 오류는 그 문서를 미충족으로 만들지, 그 문서에 기대는 문서까지 막지는 않는다.
- 작업 전체가 충족이라는 것은 선언이 `Absent`이거나 `Declared`이고 모든 항목이 `Satisfied`라는 뜻이다.
  `Malformed`는 그 자체로 미충족이다(R3).

순환 탐색은 방문 집합을 두고 선언 그래프를 따라간다. 방문 집합이 종료를 보장하므로 순환을 따라 무한히
돌지 않는다(R2). 그래프의 간선은 각 작업의 `Declared` 목록뿐이고, `Absent`·`Malformed`인 작업은 나가는
간선이 없다.

### 3. 그래프를 한 번만 모은다

판정에는 워크플로우의 모든 작업 문서에서 세 값이 필요하다: 문서 id, 상태, 선언. 한 번 훑어 모은다.

```rust
/// 판정에 필요한 값만 담은 워크플로우의 작업 목록. 문서 id로 찾는다.
fn task_dependency_graph(tasks_root: &Path) -> HashMap<String, (String, DependencyDeclaration)>
```

- `tasks/*.md`를 훑는다. 디렉터리가 없으면 빈 맵이다.
- 문서 id와 상태는 기존 규칙을 그대로 쓴다. id는 프론트매터 `id`, 없으면 파일 stem
  (`read_markdown_document:929`). 상태는 프론트매터 `status`, 없으면 `todo`. 두 값은 `yaml_text`로
  읽는다 — 화면이 목록에서 보는 값과 같아야 하기 때문이다. 선언만 줄 단위로 읽는다(1절).
- 같은 id가 둘 이상이면 파일 이름이 앞서는 쪽을 남긴다. 결정적이면 충분하고, 중복 id는 계약 위반이라
  여기서 다루지 않는다.

### 4. 작업 상세에 배선한다

`read_task`(`:257`)가 판정 결과를 함께 돌려준다. `TaskDocument`(`domain/project.rs:123`)에 필드 둘을
더한다.

```rust
/// 선언된 선행 작업과 각각의 판정 결과. 선언이 없거나 형식 오류면 비어 있다.
pub dependencies: Vec<TaskDependency>,
/// 선언 줄이 계약 형식이 아니어서 목록으로 읽지 못했는가(SPEC-013 R3). 참이면 `dependencies`는
/// 비어 있고 이 작업은 미충족이다.
pub dependency_format_error: bool,
```

- 순서는 선언에 적힌 순서 그대로다. 아키텍트가 쓴 순서에 뜻이 있을 수 있고, 정렬하면 그 뜻이 사라진다.
- `read_task`는 지금 파일 하나만 읽는다. 여기에 `task_dependency_graph` 호출 하나가 는다. 사용자가
  카드를 눌렀을 때만 도는 경로이므로 `inspect`의 2.5초 주기와 다르다.
- `SpecDocument`·`IdeaDocument`에는 더하지 않는다. 선행 선언은 개발 작업만의 계약이다(R1).

### 5. QA 기록이 선언 줄을 건드리지 않는지 고정한다

`update_task_frontmatter`(`:720`)는 `status:`와 `updated_at:` 줄만 바꾸고 나머지는 원문 그대로 옮기므로
지금 코드로 이미 선언 줄을 보존한다. 코드를 고치지 않고 **테스트로 그 사실을 고정한다**(완료 조건 15).
선언 줄이 `history:` 앞에 있는 픽스처와 뒤에 있는 픽스처 둘 다 만든다. 뒤에 있는 경우가
`append_task_history`의 스캔이 열 0에서 멈추는지를 확인하는 자리다.

### 6. 테스트

전부 `fs_project_repository.rs`의 테스트 모듈에 둔다. 기존 `write_task_with_frontmatter`(`:1466`)
헬퍼를 쓰면 픽스처가 짧다.

파싱(1절):

- 키가 없는 작업의 선언이 `Absent`로 읽히고 상세 payload의 목록이 비어 있으며 형식 오류가 아니다.
  (완료 조건 1)
- 빈 목록 표기는 선행 없음과 같은 결론이다.
- 블록 표기, 값 없는 키, 대괄호가 닫히지 않은 값, 따옴표로 감싼 id, 빈 토큰이 각각 형식 오류다.
  (완료 조건 5)
- 같은 키가 두 줄이면 형식 오류다.
- 본문에 열 0으로 적힌 `depends_on:` 문자열은 선언으로 읽히지 않는다. 파싱 대상은 프론트매터다.

판정(2절):

- 선행이 `qa_waiting`인 경우와 `completed`인 경우가 각각 충족이다. (완료 조건 2)
- 선행이 `todo`·`in_progress`·`blocked`인 경우가 각각 미충족이다. (완료 조건 2)
- 계약에 없는 상태값을 가진 선행이 미충족이다.
- 둘을 선언했고 하나만 `completed`면 작업 전체가 미충족이고, 목록에는 두 항목이 각각의 판정으로
  담긴다. (완료 조건 13의 백엔드 몫)
- 없는 id를 선언하면 그 항목이 `missing`이다. (완료 조건 3)
- 자기 자신을 선언하면 그 항목이 `cyclic`이고 판정이 끝난다. (완료 조건 4)
- 두 작업이 서로를 선언하면 양쪽에서 `cyclic`이고 판정이 끝난다. (완료 조건 4)
- 세 작업이 고리를 이루는 경우에도 `cyclic`이고 판정이 끝난다.
- 선행이 `completed`인데 그 선행이 이 작업을 선언하고 있으면 `cyclic`이다. 상태 판정이 순환보다
  앞서면 여기서 갈라진다.
- 없는 id와 순환과 형식 오류가 서로 다른 값으로 구분된다. (완료 조건 14의 백엔드 몫)
- 선행이 다른 워크플로우에 같은 id로 있어도 `missing`이다. 판정 범위는 워크플로우 안이다(R1).

배선(4·5절):

- 선언이 없는 기존 모양의 작업 문서로 목록 조회와 상세 조회가 지금과 같은 결과를 낸다. 목록 항목의
  필드 구성이 이 작업 전후로 같다. (완료 조건 1)
- 선언을 가진 작업으로 QA 확인과 QA 반려를 각각 실행한 뒤 선언 줄이 원문 그대로 남고, 전이 항목이
  이력 블록 안에만 늘어난다. 선언 줄이 `history:` 앞인 픽스처와 뒤인 픽스처 둘 다 확인한다.
  (완료 조건 15)
- 상세 조회를 부른 전후로 작업 문서의 내용과 수정 시각이 같다. `heartbeat_status.rs`의
  `reading_the_status_does_not_touch_the_heartbeat_home`(`:604`)과 같은 형태로 만든다. (완료 조건 17)

## 완료 조건

1. 선언이 없는 작업 문서가 그대로 읽히고, 목록 항목의 payload 구성이 이 작업 전후로 같다.
   (기획서 완료 조건 1)
2. 선언된 선행이 모두 `qa_waiting`·`completed`면 충족, 하나라도 그 밖의 상태면 미충족으로 판정된다.
   (기획서 완료 조건 2)
3. 없는 id를 선언하면 미충족이고 그 항목이 `missing`으로 구분된다. (기획서 완료 조건 3)
4. 자기 참조와 순환은 상태와 무관하게 미충족이고 `cyclic`으로 구분되며 판정이 끝난다.
   (기획서 완료 조건 4)
5. 계약 형식이 아닌 선언은 미충족이고 형식 오류로 구분된다. (기획서 완료 조건 5)
6. 작업 상세 payload가 선언 순서대로 각 선행의 id와 판정을 담는다. (기획서 완료 조건 13의 백엔드 몫)
7. `missing`·`cyclic`·형식 오류가 서로 다른 값으로 나간다. (기획서 완료 조건 14의 백엔드 몫)
8. QA 결정을 기록한 뒤에도 선언 줄이 원문 그대로 남고 전이 항목이 이력 블록 안에만 추가된다.
   (기획서 완료 조건 15)
9. 조회가 작업 문서를 바꾸지 않는다. (기획서 완료 조건 17)
10. 기존 Rust·프런트엔드 테스트가 수정 없이 통과한다. 삭제·비활성화된 테스트가 없다.
    (기획서 완료 조건 18)
11. `cargo fmt --check`·`cargo clippy -D warnings`·`cargo test`와 `npm run check`가 통과한다.
    (기획서 완료 조건 29)

## 검증 절차

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

화면 확인은 이 작업에서 하지 않는다. payload만 바뀌고 화면은 아직 새 값을 읽지 않는다.

## 범위 밖

- 화면의 어떤 변경도. 선행 표시는 TASK-038이다.
- `src/features/projects/domain/types.ts`를 포함한 프런트엔드 타입. TASK-038이 한다.
- 조건 스크립트. 같은 규칙의 sh 구현은 TASK-040이다.
- 역할 계약·공통 규칙·`docs/file-contract.md`의 계약 문구. TASK-041이다.
- 목록 화면·보드·리스트에 선행 표시를 얹는 것. R5가 요구하는 것은 상세다.
- 앱이 선언을 채우거나 고치는 것, 파일 경로 겹침을 앱이 계산해 충돌을 판정하는 것(기획서 제외 범위).
- 기존 작업 문서의 산문 의존을 새 필드로 옮기는 것(확정된 결정 3번).
- 기획서·아이디어·결정 문서 사이의 의존.
- 의존 그래프 시각화, 임계경로 분석, 병목 리포트.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- `read_markdown_document`(`fs_project_repository.rs:917`)는 프론트매터를 `serde_yaml`로 통째로 파싱한
  뒤 필요한 키만 꺼낸다. 모르는 키는 무시되므로 선언 필드를 더해도 기존 읽기 경로는 깨지지 않는다.
- 프론트매터가 YAML로 파싱되지 않으면 `split_frontmatter`(`:990`)가 `None`을 돌려주고, id는 파일
  stem으로 상태는 기본값으로 떨어진다.
- `update_task_frontmatter`(`:720`)는 `status:`·`updated_at:` 줄만 교체하고 나머지 줄은 원문 그대로
  옮긴다. `append_task_history`(`:767`)는 `history:` 헤더 다음의 들여쓴 연속 줄을 끝까지 스캔한 뒤 그
  자리에 한 줄을 넣고, 스캔은 들여쓰기가 없는 줄에서 멈춘다.
- `read_task`(`:257`)는 지금 작업 파일 하나만 읽고 `TaskDocument`를 만든다.
- `WorkflowItemSummary`(`domain/project.rs:93`)는 `Serialize`만 파생하고 `camelCase`로 나간다.
  프런트엔드의 대응 타입은 `src/features/projects/domain/types.ts:36`이다.
- 이 워크플로우의 작업 문서 41건 중 어느 것도 선행 선언 필드를 갖고 있지 않다. 지금 `todo`인 작업의
  의존은 전부 본문 산문이고, 확정된 결정 3번이 그것을 옮기지 않기로 했다.
- 조건 스크립트의 `developer` 분기는 지금 `^status: todo` 여부와 lease 파일 존재만 본다
  (`.workflow/rules/wf-eligible.sh`). 본문도 선언도 보지 않는다.
