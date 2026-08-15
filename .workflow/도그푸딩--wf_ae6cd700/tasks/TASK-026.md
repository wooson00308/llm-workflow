---
schema: workflow-labs/task@1
id: TASK-026
title: 아이디어 전문을 읽는 앱 경로를 만들고 화면 앞단까지 배선한다
status: verified
source_spec_id: SPEC-008
source_decision_id: DECISION-E03D1301
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-03T02:31:06.877388+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-E03D1301
work_group_revision: 1
---

# 아이디어 전문을 읽는 앱 경로를 만들고 화면 앞단까지 배선한다

SPEC-008 R7과 R1의 전제를 구현한다. 지금 아이디어에는 문서 하나를 읽어 본문을 돌려주는 경로가
없다. 기획서·개발 작업이 쓰는 읽기 경로와 같은 모양으로 아이디어용 경로를 만들고, Rust 저장소부터
화면이 부를 수 있는 훅까지 배선한다. 화면 변경은 이 작업에 없다. TASK-027이 그 위에 올라간다.

## 의존성

- 선행 없음.
- **TASK-027이 이 작업에 의존한다.** 두 작업을 병행하지 않는다.
- TASK-019·020·021(SPEC-006 연동 화면)과 파일이 겹치지 않는다. 다만 `useProjectWorkspace.ts`와
  `types.ts`는 지금 커밋되지 않은 연동 작업 변경이 올라와 있는 파일이다. 착수 전 작업 트리 상태를
  확인한다.

## 범위

- `src-tauri/src/domain/project.rs` — `IdeaDocument` 추가.
- `src-tauri/src/infrastructure/fs_project_repository.rs` — `read_idea` 추가와 테스트.
- `src-tauri/src/application/project_service.rs` — 통과 메서드.
- `src-tauri/src/commands/projects.rs` — `read_idea` 커맨드.
- `src-tauri/src/lib.rs` — 커맨드 등록.
- `src/features/projects/domain/types.ts` — `IdeaDocument`, `ProjectGateway.readIdea`.
- `src/features/projects/infrastructure/tauriProjectGateway.ts` — `readIdea` 구현.
- `src/features/projects/application/useProjectWorkspace.ts` — `readIdea` 반환.
- `src/features/projects/application/useProjectWorkspace.test.ts` — 게이트웨이 스텁과 테스트.
- 그 외 파일은 건드리지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- 읽기는 읽기다(R7). 이 경로는 어떤 파일도 쓰지 않는다. 아이디어 파일의 내용도 수정 시각도 바뀌지
  않는다.
- 조회 대상은 등록된 워크플로우 디렉터리 안의 아이디어 문서뿐이다(R7). 상위 경로를 가리키는 파일명은
  거부된다. 기획서·개발 작업과 같은 기준이고, 같은 함수를 쓴다.
- `excerpt` 생성 규칙(`markdown_excerpt`, `fs_project_repository.rs:935`)은 건드리지 않는다. 목록이
  계속 쓴다(R3, 기획서 제외 범위).
- 새 의존성을 넣지 않는다. 필요한 함수는 이미 이 파일 안에 다 있다.

### 1. Rust 읽기 함수

`domain/project.rs`의 `TaskDocument`(`:112`) 옆에 같은 모양으로 `IdeaDocument`를 만든다.
필드는 `summary: WorkflowItemSummary`, `body: String` 둘이다. 파생 매크로와 `serde` 속성은 옆
구조체와 같게 맞춘다.

`fs_project_repository.rs`의 `read_task`(`:247`) 아래에 `read_idea`를 만든다. 본문은 `read_task`와
같은 순서다.

1. `canonical_project_root` → `read_manifest` → `validate_workflow_directories` →
   `registered_workflow_root`.
2. `safe_markdown_file(&workflow_root.join("ideas"), file_name)`.
3. `read_markdown_document(&path, "inbox")`. 기본 상태 `"inbox"`는 `workflow_items`(`:786`)가
   아이디어 목록에 쓰는 값과 같다.
4. 목록과 같은 상태를 돌려주기 위해, `adopted_idea_ids(&workflow_root.join("specs"))`(`:799`)에
   이 문서의 `id`가 있으면 `summary.status`를 `"adopted"`로 바꾼다. `workflow_items`(`:787`~`:791`)가
   목록에 하는 것과 같은 처리다.
5. `Ok(IdeaDocument { summary, body })`.

`read_markdown_document`가 frontmatter를 걷어낸 본문을 돌려주므로(`:855`, `:890`) 화면에서 별도로
지울 것이 없다(기획서 완료 조건 5).

`read_spec`이 하는 `normalize_spec_status`·`apply_latest_decision`은 부르지 않는다. 기획서 상태
규칙이고 아이디어에는 없는 개념이다.

### 2. 서비스와 커맨드

- `project_service.rs`의 `read_task`(`:46`) 옆에 같은 모양의 `read_idea`를 만든다. 저장소 호출만
  통과시킨다.
- `commands/projects.rs`의 `read_task`(`:45`) 옆에 `read_idea` 커맨드를 만든다. 인자는
  `path`·`workflow_directory`·`file_name` 셋이고 `Result<IdeaDocument, String>`을 돌려준다.
- `lib.rs`의 핸들러 목록(`:17`~`:18`)에 `commands::projects::read_idea`를 더한다. **등록을 빠뜨리면
  타입 검사와 Rust 테스트는 전부 통과하는데 화면에서만 실패한다.** 목록에 들어갔는지 눈으로 확인한다.

### 3. TypeScript 계약

- `types.ts`의 `TaskDocument`(`:46`) 옆에 `IdeaDocument`를 더한다. 필드는 `summary`, `body`다.
- `ProjectGateway`의 `readTask`(`:271`) 옆에 `readIdea(path, workflowDirectory, fileName)`를 더한다.
  반환은 `Promise<IdeaDocument>`다.
- `tauriProjectGateway.ts`의 `readTask`(`:45`)와 같은 모양으로 `readIdea`를 구현한다. `invoke`에
  넘기는 커맨드 이름은 `read_idea`, 인자 키는 기존 두 함수와 같은 camelCase 규칙을 따른다.

### 4. 훅

`useProjectWorkspace.ts`의 `readTask`(`:143`)를 그대로 본떠 `readIdea`를 만들고 반환 객체(`:325`
부근)에 더한다. 실패 시 `setError`로 사유를 올리고 `null`을 돌려주는 동작까지 같게 한다.

이 시점에는 `readIdea`를 부르는 화면이 없다. TASK-027이 붙일 때까지 쓰이지 않는 반환값이 하나
생기는 것은 의도한 상태다. 타입 검사는 통과한다.

### 5. 테스트

`fs_project_repository.rs`의 테스트 모듈에 더한다. 기존
`reads_user_review_spec_and_records_approval_without_rewriting_it`(`:1390`)과
`rejects_document_path_traversal`(`:1537`)이 쓰는 준비 절차(`create_workflow` 뒤 파일 직접 쓰기)를
따른다.

- 네 줄 이상인 아이디어 파일을 만들고 `read_idea`가 돌려준 `body`에 네 번째 줄 이후 문자열이 있는지
  확인한다. 같은 문서의 `excerpt`에는 그 문자열이 없음도 함께 단정한다. 두 값이 다르다는 것이 이
  기획서의 핵심이다. (기획서 완료 조건 1의 뒷받침)
- `body`에 `schema:`·`id:` 같은 frontmatter 문자열이 없는지 확인한다. (기획서 완료 조건 5)
- 조회 전후로 아이디어 파일의 내용과 `fs::metadata(...).modified()`가 같은지 확인한다.
  (기획서 완료 조건 14)
- `"../README.md"` 같은 파일명으로 부르면 `ProjectError::UnsafeDocumentFile`이 나오는지 확인한다.
  (기획서 완료 조건 15)
- 그 아이디어를 `source_idea_id`로 가리키는 기획서를 두고 `read_idea`를 부르면 `summary.status`가
  `"adopted"`인지 확인한다.

`useProjectWorkspace.test.ts`:

- `gatewayFor`(`:63`)의 스텁에 `readIdea`를 더한다. 이 함수는 모든 테스트가 쓰므로 빠지면 타입
  검사가 깨진다.
- `readIdea`가 게이트웨이를 프로젝트 루트·워크플로우 디렉터리·파일명으로 부르고 결과를 그대로
  돌려주는지 확인한다.
- 게이트웨이가 던지면 `null`을 돌려주고 `error`가 채워지는지 확인한다.

## 완료 조건

1. 아이디어 문서 하나를 읽어 frontmatter를 걷어낸 본문 전체를 돌려주는 앱 경로가 있다.
   (기획서 완료 조건 5의 백엔드 부분)
2. 그 경로가 어떤 파일도 쓰지 않고, 아이디어 파일의 내용과 수정 시각을 바꾸지 않는다.
   (기획서 완료 조건 14)
3. 워크플로우 디렉터리 밖을 가리키는 파일명 조회가 거부된다. (기획서 완료 조건 15)
4. 돌려주는 요약의 상태가 목록이 보여주는 상태와 같다(채택된 아이디어는 `adopted`).
5. 커맨드가 `lib.rs` 핸들러 목록에 등록되어 있다.
6. 화면에서 부를 수 있는 게이트웨이·훅 경로가 있고, 실패 시 `null`을 돌려준다.
7. 기존 목록 조회 동작과 `excerpt` 생성 규칙이 바뀌지 않았다. (기획서 완료 조건 7의 백엔드 부분)
8. `npm run check`와 Rust 검사 3종이 통과한다. (기획서 완료 조건 16)

## 검증 절차

```sh
npm run check
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## 범위 밖

- 화면 변경 일체. `IdeaInbox.tsx`·`WorkspaceShell.tsx`·`App.css`는 TASK-027이 만진다.
- `excerpt` 생성 규칙 변경. 목록이 계속 쓴다.
- 아이디어 편집·삭제·상태 변경 경로.
- 목록 조회(`inspect`)에 본문을 실어 보내는 방식. 문서 하나를 읽는 경로다. 목록에 전문을 실으면
  2.5초마다 모든 아이디어 파일을 읽게 된다.
- 아이디어 문서의 캐시. 선택할 때마다 읽는다.

## 참고 사실

확인 시점 2026-08-02. 추정 없이 파일에서 읽은 값이다.

- `read_spec`은 `fs_project_repository.rs:229`, `read_task`는 `:247`이다. 둘 다 같은 다섯 단계를
  거치고 마지막에 `read_markdown_document`를 부른다.
- `safe_markdown_file`(`:758`)이 파일명 검증을 전담한다. 단일 경로 성분이고 확장자가 `.md`여야 하며,
  심볼릭 링크도 거부한다. 새로 만들 필요가 없다.
- `read_markdown_document`(`:849`)는 `split_frontmatter`(`:894`)로 frontmatter를 떼고
  `body.trim()`을 돌려준다(`:890`). 요약의 `excerpt`는 같은 함수가 `markdown_excerpt`(`:935`)로
  만든다.
- `markdown_excerpt`는 빈 줄과 `#`으로 시작하는 줄을 뺀 뒤 앞 세 줄을 이어 붙이고 160자에서 자른다.
  기획서가 문제 삼은 그 규칙이고, 이 작업은 건드리지 않는다.
- 아이디어 목록의 기본 상태 문자열은 `"inbox"`다(`workflow_items`, `:786`). 채택 판정은
  `adopted_idea_ids`(`:799`)가 `specs/`의 `source_idea_id`를 모아 하는 것이다.
- `lib.rs` 핸들러 목록은 `:13`에서 시작하고 `read_spec`·`read_task`가 `:17`~`:18`에 있다.
- 프론트엔드 게이트웨이 인터페이스는 `types.ts:266`~`:275`, 구현은 `tauriProjectGateway.ts:37`~`:52`다.
- 훅의 `readSpec`은 `useProjectWorkspace.ts:125`, `readTask`는 `:143`이다. 둘 다 실패를 `setError`로
  올리고 `null`을 돌려준다.
- 검증 명령은 `npm run check`(typecheck + test + build)와 CI의 Rust 3종이다
  (`.github/workflows/ci.yml`).
