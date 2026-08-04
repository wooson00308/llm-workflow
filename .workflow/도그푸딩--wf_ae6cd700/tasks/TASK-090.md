---
schema: workflow-labs/task@1
id: TASK-090
title: 문서뷰가 개행 한 번을 줄바꿈으로 그리는 옵트인 경로를 만든다
status: completed
source_spec_id: SPEC-027
source_decision_id: DECISION-6F1B8C53
updated_at: 2026-08-04T11:42:32.423949+00:00
history:
  - { at: 2026-08-04T10:08:00Z, kind: created }
  - { at: 2026-08-04T10:12:29Z, kind: in_progress }
  - { at: 2026-08-04T10:16:40Z, kind: qa_waiting }
  - { at: 2026-08-04T11:42:32.423949+00:00, kind: completed }
---

# 문서뷰가 개행 한 번을 줄바꿈으로 그리는 옵트인 경로를 만든다

SPEC-027의 표현 계층 처방을 `MarkdownBody` 한 곳에 만든다. **이 작업은 능력만 만들고 어떤 화면도
켜지 않는다.** 켜는 일과 적용 범위를 고정하는 일은 TASK-091이 맡는다. 이 작업이 끝난 시점의 화면은
지금과 픽셀 하나 다르지 않아야 한다.

## 아키텍트가 다시 읽은 값 (2026-08-04T10:05Z, 작업 트리)

기획서 확인 사실 중 이 작업이 기대는 것을 직접 확인했다. 전부 같은 값이었다.

- `MarkdownBody`는 react-markdown에 `remarkGfm` 하나만 물리고 `a` 컴포넌트만 덮어쓴다. 프롭은 `body`
  하나다(`src/features/projects/components/MarkdownBody.tsx:1`~`:19`).
- 호출부는 셋이고 전부 옵션 없이 부른다 — `IdeaInbox.tsx:236`, `SpecWorkspace.tsx:144`,
  `DevelopmentBoard.tsx:274`. 줄 번호까지 기획서 확인 사실 6과 같다.
- `.markdown-body` 계열 어디에도 `white-space` 선언이 없다(`src/App.css:309`~`:329`).
- `MarkdownBody.test.tsx`의 테스트는 한 건이고, 본문 상수(`:7`~`:25`)가 전부 빈 줄로 나뉘어 있어
  소프트 개행을 지나간다.
- `remark-breaks`는 `node_modules`에 없다. 레지스트리의 최신은 4.0.0이고 의존이
  `unified: ^11`, `@types/mdast: ^4`, `mdast-util-newline-to-break: ^2`다. 설치된 값은 unified 11.0.5,
  @types/mdast 4.0.4, react-markdown 10.1.0, remark-gfm 4.0.1이다. **범위가 맞고 unified 트리가
  갈라지지 않는다.** 레지스트리는 이 세션에서 `npm ping`으로 닿는 것을 확인했다.

## 구현 수단 결정: `remark-breaks`를 의존성으로 들인다

기획서 확인 사실 14가 수단 선택을 아키텍트에게 넘겼다. 셋을 비교했다.

- **채택: `remark-breaks` 플러그인 + 옵트인 프롭.** 변경이 플러그인 배열 한 줄과 프롭 하나로 끝나고,
  켜지 않은 호출부는 지금과 완전히 같은 경로를 탄다. 저장소가 이미 같은 계열(`remark-gfm`)을
  의존성으로 쓰고 있어 어법이 새로 생기지 않는다.
- 대안 (가) **뷰어 안에 지역 플러그인을 짠다.** mdast를 걸어 `text` 노드의 `\n`을 `break`로 쪼개는
  15줄 안팎이다. 의존성은 늘지 않지만 `mdast-util-newline-to-break`가 하는 일을 손으로 다시 짜는
  것이고, 검증 책임이 이 저장소로 넘어온다. 얻는 것 없이 판정 대상만 는다.
- 대안 (나) **CSS `white-space: pre-wrap`.** R3 위반이라 쓰지 않는다. Markdown이 만든 목록 들여쓰기와
  원문 공백이 그대로 화면에 나오고, 기획서 제외 범위인 표현 조정에도 걸린다.

## 의존성

없다. 선행 작업 없이 착수한다.

## 병행 안전 확인 결과

- **`MarkdownBody.tsx`·`MarkdownBody.test.tsx`를 범위에 둔 미완료 작업이 없다.** `tasks/` 전체에서
  `todo`·`in_progress`·`blocked` 문서를 훑어 두 파일 이름이 나오지 않는 것을 확인했다.
- **`package.json`·`package-lock.json`을 범위에 둔 미완료 작업도 없다.** 작업 트리의 `package.json`
  미커밋 변경은 `@tauri-apps/plugin-clipboard-manager` 한 줄 추가뿐이고, 이 작업이 더할 자리와 겹치지
  않는다.
- **세 호출부 파일은 이 작업의 범위 밖이다.** 그래서 같은 승인에서 나온 TASK-091과도 파일이 겹치지
  않는다. 두 작업의 순서는 파일 충돌이 아니라 프롭이 없으면 켤 수 없다는 이유로 생긴다.
- 저장소에 미커밋 변경이 크다. **줄 번호는 전부 작업 트리 기준이고, 쓰기 직전에 대상을 다시 읽는다.**

## 범위

- `package.json` — `dependencies`에 `remark-breaks` 한 줄. 그 밖의 필드는 건드리지 않는다.
- `package-lock.json` — `npm install`이 만든 변경분. 손으로 고치지 않는다.
- `src/features/projects/components/MarkdownBody.tsx` — 프롭 하나와 플러그인 배열.
- `src/features/projects/components/MarkdownBody.test.tsx` — 단언 추가. **기존 테스트는 이름도 내용도
  한 글자 고치지 않는다.**
- 그 외 파일은 건드리지 않는다. 세 호출부·CSS·Rust 전부 무변경이다.

## 작업 내용

### 의존성 추가

- `npm install remark-breaks`로 더한다. 버전은 설치가 해석한 값을 쓰고, **그 값과 `package-lock.json`
  변경 규모를 보고서에 적는다.**
- 설치 뒤 `node_modules/unified`가 여전히 한 벌인지 확인한다. 위 판정이 그 값에 기대고 있다.
- **설치가 불가능하면 이 작업을 `blocked`로 두고 보고한다.** 지역 플러그인으로 즉흥 대체하지 않는다.
  위 비교에서 떨어진 안을 구현 중에 되살리는 것은 결정 없이 수단을 바꾸는 일이다.

### 프롭

- 시그니처를 `{ body, preserveLineBreaks = false }: { body: string; preserveLineBreaks?: boolean }`로
  넓힌다. 이름은 호출부에서 무엇이 켜지는지 읽히는 값으로 골랐다.
- `remarkPlugins={preserveLineBreaks ? [remarkGfm, remarkBreaks] : [remarkGfm]}` 한 줄이 전부다.
- **기본값이 `false`다.** 프롭을 넘기지 않은 호출부의 렌더 결과가 지금과 같아야 한다(R6 첫째 항목).
- `a` 컴포넌트 덮어쓰기와 `.markdown-body` 감싸개를 그대로 둔다. 링크의 `target`·`rel`이 달라지면
  안 된다(완료 조건 5).

### 검사

기존 한 건을 그대로 두고 아래를 더한다.

1. **프롭을 켜면 소프트 개행이 줄바꿈이 된다.** `"첫 줄\n둘째 줄\n셋째 줄"`이 `<p>` 하나 안에서
   `<br>` 둘로 나뉜다. (R1)
2. **프롭을 켜도 빈 줄은 문단을 나눈다.** `"첫 줄\n둘째 줄\n\n새 문단"`이 `<p>` 둘이고, 앞 문단에만
   `<br>`가 하나다. (R2)
3. **프롭을 넘기지 않으면 아무것도 달라지지 않는다.** 같은 본문에서 `<br>`가 하나도 없고 `<p>`는
   여전히 둘이다. (R6)
4. **프롭을 켠 상태에서도 나머지 Markdown이 그대로다.** 기존 본문 상수(`:7`~`:25`)를 재사용해 켠
   상태로 한 번 더 그리고, 제목·목록·표·코드·인용·링크가 같은 모양으로 나오는지 확인한다. (R3)

**단언 방법 주의.** `<br>`가 들어가면 `screen.getByText("첫 줄")`이 맞지 않는다. `textContent`가
`"첫 줄둘째 줄"`로 이어 붙기 때문이다. 구조는 `container.querySelectorAll("p")`와
`querySelectorAll("br")`로 세고, 텍스트는 `toHaveTextContent`로 확인한다. 기획서 확인 사실 13대로
판정 대상이 DOM 구조라 jsdom에서 성립한다.

## 완료 조건

괄호 안은 SPEC-027의 완료 조건 번호다.

1. 프롭을 켠 `MarkdownBody`가 개행 한 번을 `<br>`로 그리고, 줄 수가 셋 이상이어도 각 줄이 유지된다.
   검증: 위 검사 1. (1·2의 뷰어 몫)
2. 프롭을 켠 상태에서 빈 줄이 문단을 나눈다. 검증: 위 검사 2. (3의 자동 검증 몫)
3. 프롭을 켜도 불릿·번호 목록·제목·표·코드 블록·인용·강조·링크 해석이 그대로다. 검증: 위 검사 4. (4)
4. 기존 `MarkdownBody.test.tsx` 테스트가 수정 없이 통과한다. (4·5·12)
5. 프롭을 넘기지 않은 렌더에 `<br>`가 생기지 않는다. 검증: 위 검사 3. 화면 쪽 나머지 절반(개발 작업
   상세)은 TASK-091이 맡는다. (10의 절반)
6. 변경분에 `src-tauri/` 파일이 없다. (9)
7. 변경분에 `src/App.css`와 세 호출부 `.tsx` 파일이 없다.
8. 해석된 `remark-breaks` 버전, `package-lock.json` 변경 규모, `unified`가 한 벌로 남았는지를
   보고서에 적는다.
9. `npm run check`가 통과한다. (13)

## 범위 밖

- **어떤 화면을 켤지.** TASK-091이 호출부에서 정한다. 이 작업은 호출부를 건드리지 않는다.
- **CSS 조정.** 기획서 제외 범위가 "문서뷰의 글꼴·여백·최대 폭 등 표현 조정"을 명시적으로 잘라 두었다.
  문단 간격과 줄 간격의 차이는 지금 규칙(`.markdown-body p`의 `margin: 7px 0`, `line-height: 1.75`,
  `font-size: 12px` → 줄 간격 21px, 문단 경계 28px)이 만드는 값 그대로 두고 사용자 QA의 눈 확인에
  맡긴다(SPEC-027 완료 조건 3).
- **빈 줄 수 보존.** 확인 필요 2번이 "연속 빈 줄은 문단 구분 하나"로 승인됐다. `remark-breaks`는 그
  동작을 바꾸지 않는다.
- **저장·읽기 경로.** R4대로 이 작업에 Rust 변경분이 없다. 화면 문제를 저장 시점의 문자열 조작으로
  우회하지 않는다.
- **요약(`excerpt`) 생성 규칙과 목록 행.** 기획서 확인 사실 11대로 이번 결함과 무관하다.
