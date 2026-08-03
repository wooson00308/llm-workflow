# TASK-027 개발자 핸드오프

- 대상 작업: TASK-027 (아이디어 미리보기가 요약 대신 전문을 문서 뷰어로 보여준다)
- 근거 문서: SPEC-008 R1·R2·R4·R5·R6, DECISION-E03D1301 (approved, created_by: user)
- 세션 역할: 개발자
- 작성 시각: 2026-08-03T02:20Z
- 상태: `qa_waiting`

## 대상 선정 근거

- 착수 시점 `todo`는 TASK-027·028·029·030·031 다섯 건이다.
  - TASK-030은 TASK-028·029를, TASK-031은 TASK-030을 선행 필수로 걸어 지금은 착수할 수 없다.
  - TASK-028·029는 선행이 없지만 서로 병행 금지이고, TASK-027이 문서 번호상 앞선다. 한 세션은 한 건만
    처리하므로 TASK-027을 골랐다.
- TASK-027의 선행 필수인 TASK-026은 `qa_waiting`이다. 구현이 코드에 들어 있어(`readIdea` 훅,
  `IdeaDocument` 타입, `read_idea` 커맨드) 이 작업이 필요로 하는 것은 갖춰져 있다. 코드로 존재 확인 후
  착수했다.
- 병행 금지 대상(TASK-019·020·021, TASK-030)은 전부 `qa_waiting`이거나 미착수이고 리스가 없다.
- 착수 시점 `.workflow/.runtime/migration.lock` 없음. `leases/`에는 만료된 `SPEC-009.yml`
  (expires_at 2026-08-03T01:20Z, 아키텍트 세션)만 있었다. 내가 claim한 항목이 아니므로 손대지 않았다.
  배타 생성으로 `leases/TASK-027.yml`을 만든 뒤 문서를 `in_progress`로 옮기고 시작했다.
- SPEC-008 본문은 `status: user_review`지만 앱이 기록한 승인 결정(DECISION-E03D1301)이 있으므로 공통
  규칙 5절의 구현 차단 조건에 걸리지 않는다.
- 착수 전 작업 트리를 확인했다(작업 문서가 요구한 절차). `WorkspaceShell.tsx`·`types.ts`·
  `useProjectWorkspace.ts`·`App.css`에 SPEC-005·006·007 산출물이 커밋되지 않은 채 올라와 있다. 이
  세션이 건드린 구간은 아이디어 영역뿐이고 연동·캘린더 변경과 겹치지 않는다.

## 결과

아이디어 미리보기가 요약(`excerpt`) 대신 문서 전문을 기획서·개발 작업과 같은 `MarkdownBody`로 그린다.
목록 행은 손대지 않았다.

`IdeaInbox`가 선택된 항목의 `fileName`을 보는 효과에서 전문을 조회하고, 결과를 세 상태
(`loading` / `loaded` / `failed`) 중 하나로 들고 있다. 자동 선택된 첫 항목도 클릭 없이 전문이 나온다.
머리(제목·상태 배지)와 바닥(문서 ID·업데이트·파일명)은 계속 목록 요약에서 그리므로 조회가 실패해도
남는다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src/features/projects/components/IdeaInbox.tsx` | `onReadIdea` prop, 조회 효과, 세 상태, `MarkdownBody` 사용 |
| `src/features/projects/components/IdeaInbox.test.tsx` | 기존 2건 갱신 + 신규 11건, `afterEach(cleanup)` |
| `src/features/projects/components/WorkspaceShell.tsx` | `IdeaDocument` import, `onReadIdea` Props·구조분해·`IdeaInbox` 전달 |
| `src/features/projects/components/WorkspaceShell.test.tsx` | 렌더 8곳에 `onReadIdea` 스텁 |
| `src/App.tsx` | `onReadIdea={workspace.readIdea}` 한 줄 |
| `src/App.css` | `.idea-preview-body` 스크롤, `.idea-preview-body p` → `.idea-preview-note` |
| `.workflow/…/tasks/TASK-027.md` | `todo` → `in_progress` → `qa_waiting` |
| `.workflow/…/reports/REPORT-TASK-027-DEV.md` | 신규 |
| `.workflow/.runtime/leases/TASK-027.yml` | 선점 후 반납 |

작업 문서의 범위 목록 밖은 손대지 않았다. `IdeaInbox.tsx`의 목록 행(`:46`~`:65` 구간), `excerpt` 생성
규칙, Rust 쪽 어떤 파일도 그대로다.

## 설계 판단

- **조회를 `fileName` 하나만 의존성으로 하는 효과에 걸었다.** 작업 문서가 지시한 대로다. 조회 함수는
  `useRef`에 담고 ref 갱신 효과를 조회 효과보다 먼저 선언했다. 폴링(2.5초)이 `readIdea`의 정체성을
  계속 바꾸므로 함수를 의존성에 넣으면 2.5초마다 재조회가 돈다.
- **취소 표시로 늦은 응답을 버린다.** 효과 정리 함수에서 `cancelled`를 세우고 응답 처리 시 확인한다.
  목록을 빠르게 오갈 때 이전 문서 본문이 남는 것을 막는다.
- **`onReadIdea`가 reject하는 경우도 `failed`로 받는다.** 훅의 `readIdea`는 실패를 `null`로 바꿔 주지만
  prop 타입상 거부가 불가능하지 않고, 거부가 새면 화면이 `loading`에 영원히 멈춘다. `.then`의 두 번째
  인자 한 줄이라 비용이 없다.
- **로딩·실패 문구를 `.idea-preview-note`라는 자체 클래스로 뺐다.** 기존 `.idea-preview-body p`(serif
  16px)는 요약 한 문단을 위한 규칙이라 더 이상 쓰이지 않는다. 그 규칙을 남기면 `MarkdownBody` 안의
  문단과 선택자 특정성이 같아져(둘 다 0,1,1) 순서에만 기대게 된다. 이 작업 때문에 쓰이지 않게 된
  규칙만 지웠고 주변은 손대지 않았다.
- **스크롤 컨테이너에 `key={item.fileName}`을 줬다.** 문서가 바뀌면 다시 마운트되어 스크롤이 처음으로
  돌아간다. 스크롤 위치를 직접 되감는 코드보다 짧고 조회 중·실패 상태에서도 같은 결과가 나온다.
- **`afterEach(cleanup)`을 테스트 파일에 넣었다.** 이 저장소는 `globals: true`가 아니라 RTL 자동 정리가
  걸리지 않는다. 기존 2건은 렌더가 쌓여도 질의가 겹치지 않아 우연히 통과하던 상태였고, 13건으로
  늘리면서 렌더가 누적되면 질의가 깨진다. `DevelopmentBoard.test.tsx:29`가 같은 방식이라 그 선례를
  따랐다. 공용 `src/test/setup.ts`는 다른 파일 전체에 영향을 주므로 건드리지 않았다.

## 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | 선택·자동 선택 모두 전문이 보인다 | 충족. `renders the whole document instead of the excerpt`(넷째 줄 단언), `reads the auto-selected idea without a click`(클릭 없이 `IDEA-001.md` 조회 호출) |
| 2 | 다른 아이디어로 옮기면 이전 본문이 남지 않는다 | 충족. `replaces the body when another idea is selected` — 양방향으로 오가며 반대쪽 본문 부재 단언 |
| 3 | 선택된 아이디어가 없으면 기존 안내 화면 | 충족. `keeps the placeholder panel when no idea exists` — 안내 문구 + 조회 미호출 |
| 4 | frontmatter가 보이지 않는다 | 충족. `does not show frontmatter` — `/schema:/` 부재. 본문에서 frontmatter를 걷어내는 것은 TASK-026의 `read_markdown_document` |
| 5 | 기획서·개발 작업과 같은 문서 뷰어, 링크 동작 동일 | 충족. `renders markdown formatting like the other document views` — `listitem` 2건, 링크 `href`·`target="_blank"`·`rel="noopener noreferrer"` |
| 6 | 목록 행의 요약·행 높이가 그대로 | 충족. `keeps the list row excerpt` — 요약이 목록 행에만 1건 남고 그 행이 선택 상태. `.idea-list button small`의 2줄 클램프 CSS 무수정 |
| 7 | 머리·바닥 정보가 조회 상태와 무관하게 보인다 | 충족. `keeps the document information while loading and after a failure` — 로딩·실패 두 상태에서 제목·배지·문서 ID·업데이트·파일명 단언 |
| 8 | 불러오는 중·실패 표시, 실패 시 요약 미표시 | 충족. `tells the user while the document is loading`(해소되지 않는 Promise), `tells the user when the document could not be read`(요약이 목록에만 1건) |
| 9 | 실패한 뒤에도 다른 아이디어를 이어서 선택 | 충족. `keeps working after a failed read` |
| 10 | 긴 본문에서 2단 구조 유지·끝까지 스크롤 | 코드상 충족, 눈 확인은 QA. `.idea-preview-body`에 `max-height: 430px`(왼쪽 `.idea-list`와 같은 값)·`overflow: auto`·`min-height: 0` |
| 11 | 다른 아이디어로 옮기면 본문이 처음부터 | 코드상 충족, 눈 확인은 QA. 스크롤 컨테이너 `key={item.fileName}` 재마운트 |
| 12 | `npm run check` 통과 | 충족 |

10·11번은 jsdom에서 실제 스크롤 높이가 계산되지 않아 자동화 테스트로 못 박지 못했다. 아래 QA 절차
2·3번이 이 둘을 덮는다.

## 검증 단계와 결과

```sh
npm run check
```

- typecheck + vitest + vite build 전부 통과. 13개 파일 191 tests passed / 0 failed, 빌드 성공.
- `IdeaInbox.test.tsx`는 2건 → 13건. 기존 2건은 삭제하지 않고 살렸다.
- 기존 단언 중 바꾼 것은 하나다.
  `expect(screen.getAllByText("떠오른 생각을 바로 기록한다.")).toHaveLength(2)` → `toHaveLength(1)`.
  목록과 미리보기가 같은 요약을 쓰던 시절의 단언이고, 미리보기가 요약을 쓰지 않게 된 것이 이
  기획서가 노린 변화다. 값을 느슨하게 바꾼 것이 아니라 반대로 "요약은 목록에만 있다"를 고정한다.
- 삭제하거나 비활성화한 테스트 없음. Rust 쪽 변경이 없어 cargo 검사는 돌리지 않았다.
- 이 세션은 `~/.claude/` 아래 어떤 파일도 건드리지 않았다.

## 사용자 QA 절차

```sh
npm run tauri dev
```

1. 아이디어 화면에 들어간다. 아무것도 누르지 않은 상태에서 첫 항목의 전문이 오른쪽에 보여야 한다.
   요약처럼 세 줄에서 `…`으로 끊기지 않는다.
2. 불릿으로 적은 아이디어를 고른다. 지금까지 세 줄이 한 문단으로 붙어 나왔는데, 목록(•)으로 보여야
   한다. 굵은 글씨·링크도 서식대로 나온다.
3. 긴 아이디어(예: `IDEA-5052D893.md`)를 고른다.
   - 왼쪽 목록이 화면 밖으로 밀려나지 않고 2단 구조가 유지되어야 한다.
   - 오른쪽 본문만 스크롤되고 제목·상태 배지, 아래 문서 정보는 계속 보여야 한다.
   - 본문 끝까지 읽을 수 있어야 한다.
4. 3번에서 본문을 아래까지 내린 뒤 다른 아이디어를 고른다. 본문이 처음부터 보여야 한다.
5. 왼쪽 목록 행을 본다. 요약이 두 줄에서 잘리는 모습, 상태 아이콘, 날짜, `기획 반영` 표시가 전과
   같아야 한다.
6. 여러 아이디어를 빠르게 번갈아 눌러 본다. 이전 문서의 본문이 잠깐이라도 남아 있으면 안 된다.
7. 화면을 열어 둔 채 2.5초 이상 기다린다. 폴링이 도는 동안 본문이 로딩으로 깜빡이거나 스크롤 위치가
   튀면 안 된다.
8. (선택) 실패 표시 확인. 앱을 띄운 채 `.workflow/도그푸딩--wf_ae6cd700/ideas/`의 아이디어 파일 하나를
   다른 이름으로 잠깐 옮기고 목록에서 그 항목을 고른다. `아이디어 전문을 불러오지 못했습니다.`가
   보이고, 요약이 그 자리를 대신하지 않아야 한다. 제목·문서 정보는 그대로 남아 있고, 다른 아이디어를
   이어서 고를 수 있어야 한다. 확인 후 파일 이름을 되돌린다.

## 다음 작업자에게

- SPEC-008은 이 작업으로 끝난다. 남은 `todo`는 SPEC-009의 TASK-028·029(선행 없음, 서로 병행 금지)와
  그 뒤의 TASK-030·031이다.
- TASK-030은 `WorkspaceShell.tsx`·`App.css`를 이 작업과 공유한다고 적혀 있다. 이 작업이 만진 곳은
  `App.css`의 `.idea-preview-body`·`.idea-preview-note` 두 줄과 `WorkspaceShell.tsx`의 `onReadIdea`
  배선 세 곳뿐이라 연동 카드 쪽과 겹치지 않는다.
- `IdeaInbox.test.tsx`에 `afterEach(cleanup)`이 생겼다. 이 파일에 테스트를 더할 때 렌더가 쌓이지
  않는다는 전제로 써도 된다.

## 후속 / 리스크

- **`.idea-preview-body`의 `max-height: 430px`는 왼쪽 `.idea-list`와 맞춘 고정값이다.** 창을 세로로 크게
  늘려도 본문 영역은 430px에서 멈춘다. 기존 화면이 전부 이 방식(`.spec-paper.embedded`의 570px,
  `.spec-list-panel > div`의 570px)이라 같은 기준을 따랐다. 반응형 높이는 이 기획서 범위 밖이다.
- **미리보기의 상태 배지·문서 정보는 여전히 목록 요약에서 온다.** 조회가 돌려주는 `document.summary`는
  쓰지 않는다. R4가 요구한 것이고 TASK-026 보고서도 같은 주의를 남겼다.
- 역할 밖 발견 (수정하지 않음):
  - `.workflow/.runtime/leases/SPEC-009.yml`이 만료된 채(expires_at 2026-08-03T01:20Z) 남아 있다.
    아키텍트 세션이 반납하지 않은 것으로 보인다. 내 리스가 아니라 손대지 않았다.
  - 작업 트리에 SPEC-005·006·007 산출물이 커밋되지 않은 채 그대로 있다. TASK-014~026이 전부
    `qa_waiting`이라 사용자 QA가 밀려 있는 상태다.
  - `.serena/`가 추적되지 않은 채 작업 트리에 있다. 이 세션이 만든 것이 아니다.
  - `src/test/setup.ts`에 전역 `afterEach(cleanup)`이 없다. 지금은 파일마다 개별로 넣는 방식인데,
    새 테스트 파일이 이 사실을 모르고 시작하면 이번처럼 "여러 개 발견" 오류로 시간을 쓴다. 공용
    설정 변경은 이 작업 범위 밖이라 건드리지 않았다.
