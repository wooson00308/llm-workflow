# TASK-026 개발자 핸드오프

- 대상 작업: TASK-026 (아이디어 전문을 읽는 앱 경로를 만들고 화면 앞단까지 배선한다)
- 근거 문서: SPEC-008 R7·R1 전제, DECISION-E03D1301 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T19:00Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-018·019·020·021·023·024·025·026·027 아홉 건이다. 이 중 선행 필수를 걸지
  않은 것은 TASK-026 하나뿐이다.
  - TASK-018은 TASK-014·016·017을 선행 필수로 걸고, 셋 다 `qa_waiting`이다(구현은 코드에 있으나
    사용자 QA 전이라 반려 시 재작업 대상).
  - TASK-019는 SPEC-005 네 건 전체를, TASK-020은 TASK-019를, TASK-021은 TASK-020을 선행 필수로 건다.
  - TASK-023은 TASK-022(`qa_waiting`)를, TASK-024·025는 TASK-023을 선행으로 건다.
  - TASK-027은 TASK-026을 선행 필수로 건다.
- 병행 금지 대상은 TASK-027(`todo`, 미착수)과 `App.css`를 공유하는 SPEC-006 작업들인데, 이 작업의 범위
  목록에는 `App.css`도 화면 파일도 없어 실제 충돌 지점이 없다.
- 착수 전 작업 트리를 확인했다(작업 문서가 요구한 절차). `useProjectWorkspace.ts`·`types.ts`에 SPEC-005·
  006 연동 변경이 커밋되지 않은 채 올라와 있다. 이 세션이 두 파일에서 건드린 구간은 워크플로우 문서
  읽기 영역이고 연동(heartbeat/dream) 영역과 겹치지 않는다.
- 착수 시점 `.workflow/.runtime/migration.lock` 없음, `leases/` 비어 있음. 배타 생성으로
  `leases/TASK-026.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- SPEC-008 본문은 `status: user_review`지만 앱이 기록한 승인 결정(DECISION-E03D1301)이 있으므로 공통
  규칙 5절의 구현 차단 조건에 걸리지 않는다.

## 결과

아이디어 문서 하나를 읽어 frontmatter를 걷어낸 본문 전체를 돌려주는 경로가 Rust 저장소부터 훅까지
생겼다. `read_spec`·`read_task`와 같은 다섯 단계(정규화 → 매니페스트 → 워크플로우 디렉터리 검증 →
등록 확인 → 파일명 검증)를 그대로 거치고, 마지막에 `read_markdown_document(path, "inbox")`를 부른다.

목록(`workflow_items`)이 하는 채택 판정을 같은 함수(`adopted_idea_ids`)로 한 번 더 해서, 전문 읽기가
돌려주는 `summary.status`가 목록의 상태와 갈리지 않게 했다.

화면은 이 작업에서 바뀌지 않는다. `readIdea`를 부르는 곳이 아직 없고, 그 상태로 타입 검사가 통과하는
것이 작업 문서가 의도한 중간 상태다. 화면 배선은 TASK-027이다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/domain/project.rs` | `IdeaDocument` 타입 추가(`TaskDocument` 옆, 같은 파생·serde 속성) |
| `src-tauri/src/infrastructure/fs_project_repository.rs` | `read_idea` 추가, import 갱신, 테스트 2건 신규·1건 단언 추가 |
| `src-tauri/src/application/project_service.rs` | `read_idea` 통과 메서드 |
| `src-tauri/src/commands/projects.rs` | `read_idea` 커맨드 |
| `src-tauri/src/lib.rs` | `commands::projects::read_idea` 핸들러 등록 |
| `src/features/projects/domain/types.ts` | `IdeaDocument`, `ProjectGateway.readIdea` |
| `src/features/projects/infrastructure/tauriProjectGateway.ts` | `readIdea` 구현(`read_idea` 호출) |
| `src/features/projects/application/useProjectWorkspace.ts` | `readIdea` 콜백과 반환 |
| `src/features/projects/application/useProjectWorkspace.test.ts` | `gatewayFor` 스텁 + 테스트 2건 |
| `.workflow/…/tasks/TASK-026.md` | `todo` → `in_progress` → `qa_waiting` |
| `.workflow/…/reports/REPORT-TASK-026-DEV.md` | 신규 |
| `.workflow/.runtime/leases/TASK-026.yml` | 선점 후 반납 |

작업 문서의 범위 목록 밖은 손대지 않았다. `IdeaInbox.tsx`·`WorkspaceShell.tsx`·`App.tsx`·`App.css`는
그대로다. `markdown_excerpt`도 `workflow_items`도 고치지 않았다.

## 설계 판단

- **`IdeaDocument`를 `TaskDocument`와 별개 타입으로 만들었다.** 필드가 같아 `TaskDocument`를 재사용할
  수도 있지만, 작업 문서가 지목한 모양이고 서로 다른 문서 종류가 나중에 갈릴 때 타입을 쪼개는 비용이
  더 크다. `SpecDocument`/`TaskDocument`가 이미 같은 필드로 따로 있는 선례다.
- **채택 판정을 `read_idea` 안에서 한 번 더 한다.** `adopted_idea_ids`는 `specs/`를 통째로 훑는다.
  문서 하나를 읽을 때마다 그 비용을 내지만, 사용자가 아이디어를 고를 때만 도는 경로다. 목록 조회에
  얹거나 캐시를 두는 쪽은 작업 문서가 범위 밖으로 못박았다.
- **`normalize_spec_status`·`apply_latest_decision`은 부르지 않았다.** 기획서 상태 규칙이고 아이디어에는
  `inbox`/`adopted` 둘뿐이다.
- **훅의 `readIdea`는 `readTask`를 그대로 본떴다.** 실패 시 `setError` + `null` 반환까지 같다.
  미리보기 하나가 실패하는 것으로 화면이 서면 안 되고, 사유는 기존 오류 표시가 이미 처리한다.
- **경로 검증을 새로 만들지 않았다.** `safe_markdown_file`이 단일 경로 성분·`.md` 확장자·심볼릭 링크를
  이미 전담한다. 기획서·개발 작업과 같은 함수를 쓰는 것이 같은 기준을 보장하는 유일한 방법이다.

## 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | frontmatter를 걷어낸 본문 전체를 돌려주는 경로가 있다 | 충족. `reads_full_idea_body_without_touching_the_file` — 4번째 줄이 `body`에 있고 `excerpt`에는 없음, `schema:`·`id: IDEA-001` 부재 단언 |
| 2 | 어떤 파일도 쓰지 않고 내용·수정 시각이 그대로다 | 충족. 같은 테스트에서 읽기 전후 `read_to_string`과 `fs::metadata(..).modified()` 동일 단언 |
| 3 | 워크플로우 디렉터리 밖 파일명 조회가 거부된다 | 충족. `rejects_document_path_traversal`에 `read_idea("../README.md")` → `UnsafeDocumentFile` 단언 추가 |
| 4 | 요약 상태가 목록과 같다(채택은 `adopted`) | 충족. `reports_adopted_status_for_an_idea_referenced_by_a_spec` |
| 5 | 커맨드가 `lib.rs` 핸들러 목록에 등록되어 있다 | 충족. `lib.rs:19` `commands::projects::read_idea` — 눈으로 확인 |
| 6 | 게이트웨이·훅 경로가 있고 실패 시 `null`을 돌려준다 | 충족. `reads one idea document through the gateway`, `reports a failed idea read as null with the reason` |
| 7 | 기존 목록 조회 동작과 `excerpt` 생성 규칙이 그대로다 | 충족. `markdown_excerpt`·`workflow_items`·`read_markdown_summaries` 무수정, 기존 테스트 전건 통과 |
| 8 | `npm run check`와 Rust 검사 3종 통과 | 충족 |

## 검증 단계와 결과

```sh
npm run check
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

- `cargo test` — 138 passed / 0 failed. 직전 세션 기록(REPORT-TASK-022-DEV)의 136에 이번 신규 2건을
  더한 수와 일치한다.
- `npm run check` (typecheck + vitest + vite build) — 114 passed / 0 failed, 빌드 성공. 직전 112에
  이번 신규 2건을 더한 수다.
- `cargo fmt --check` 차이 없음(초안이 한 줄에서 걸려 `cargo fmt`로 정리한 뒤 재확인).
  `cargo clippy --all-targets -- -D warnings` 경고 없음.
- 삭제하거나 비활성화한 테스트 없음. 기존 테스트 본문 수정은
  `rejects_document_path_traversal`에 단언 2줄을 더한 것뿐이고, 기존 `read_spec` 단언은 그대로다.
- 전역 파일 무쓰기: Rust 테스트는 전부 `tempdir()`에서 돈다. 이 세션은 `~/.claude/` 아래 어떤 파일도
  건드리지 않았다.

## 사용자 QA 절차

이 작업에는 화면 변경이 없다. 눈으로 확인할 수 있는 것은 "기존 화면이 그대로인가"와 "커맨드가 실제로
응답하는가" 둘이다.

```sh
# 1) 회귀 — 앱을 띄우고 아이디어 목록을 연다
#    → 목록 행의 두 줄 말줄임, 상태 아이콘, 날짜, `기획 반영` 표시가 전과 같아야 한다
#    → 미리보기도 전과 같다(전문 표시는 TASK-027이다)

# 2) 커맨드 등록 확인 — 개발자 도구 콘솔에서 직접 부른다
#    (앱 창에서 우클릭 → 검사, 또는 개발 빌드의 devtools)
await window.__TAURI__.core.invoke('read_idea', {
  path: '<이 저장소 절대경로>',
  workflowDirectory: '도그푸딩--wf_ae6cd700',
  fileName: 'IDEA-253723D5.md',
})
#    → summary(status: inbox 또는 adopted)와 body가 돌아와야 한다
#    → body에 `schema:`·`id:` 같은 frontmatter 줄이 없어야 한다
#    → 목록 미리보기의 요약보다 길어야 한다(요약은 앞 세 줄에서 끊긴다)

# 3) 경로 거부
await window.__TAURI__.core.invoke('read_idea', {
  path: '<이 저장소 절대경로>',
  workflowDirectory: '도그푸딩--wf_ae6cd700',
  fileName: '../README.md',
})
#    → 오류(안전하지 않은 문서 파일)여야 한다

# 4) 읽기가 파일을 건드리지 않았는지
git status --short '.workflow/도그푸딩--wf_ae6cd700/ideas/'
#    → 아무것도 나오지 않아야 한다
```

2·3번의 devtools 경로가 번거로우면 건너뛰어도 된다. 같은 내용을 Rust 테스트 3건이 덮고 있고,
커맨드 등록은 TASK-027이 화면을 붙이는 순간 바로 드러난다.

## 다음 작업자에게

- 다음은 TASK-027(아이디어 미리보기가 요약 대신 전문을 문서 뷰어로 보여준다)이다. 이 작업이 만든
  `readIdea` 훅 반환값과 `IdeaDocument` 타입을 그대로 쓴다.
- 훅의 `readIdea`는 프로젝트가 없으면 `null`, 실패해도 `null`이다. 화면은 두 경우를 구별할 수 없으므로
  로딩·실패 상태는 화면 쪽에서 따로 들고 있어야 한다(작업 문서가 세 상태를 요구한다).
- `summary.status`는 목록과 같은 값이 온다. 미리보기 헤더는 계속 목록 요약(`item`)에서 그리라는 것이
  TASK-027의 제약이므로, `document.summary`를 헤더에 다시 쓰지 않도록 주의한다.
- `readIdea`는 지금 아무도 부르지 않는다. 타입 검사는 통과하지만 화면이 붙기 전까지 죽은 반환값이다.

## 후속 / 리스크

- **`adopted_idea_ids`가 문서 하나를 읽을 때마다 `specs/` 전체를 훑는다.** 지금 기획서가 8건이라 무시할
  수 있지만, 아이디어를 고를 때마다 도는 경로다. 목록 조회는 이미 같은 함수를 한 번 부르고 있어 새로
  생긴 성질은 아니다.
- **`read_idea`는 아이디어 상태를 `inbox`/`adopted` 둘로만 본다.** 파일에 다른 `status`가 적혀 있으면
  그 값이 그대로 나온다(기획서에 정규화 규칙이 없어 `normalize_spec_status` 같은 처리를 두지 않았다).
- 역할 밖 발견 (수정하지 않음):
  - 작업 트리에 이 작업 이전부터 커밋되지 않은 변경(SPEC-005·006·007 산출물)이 그대로 있다. 이 세션은
    위 표의 파일만 건드렸고, `types.ts`·`useProjectWorkspace.ts`에서 건드린 구간은 연동 변경과
    겹치지 않는다.
  - `.serena/`가 추적되지 않은 채 작업 트리에 있다. 이 세션이 만든 것이 아니다.
  - TASK-018·019~021·023~025는 선행이 `qa_waiting`에 묶여 있다. 사용자 QA가 진행되지 않으면 `todo`
    아홉 건 중 착수 가능한 것이 TASK-027 하나만 남는다.
