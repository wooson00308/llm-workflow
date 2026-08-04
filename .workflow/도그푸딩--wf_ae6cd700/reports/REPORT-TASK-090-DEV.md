# TASK-090 개발자 핸드오프

- 대상: TASK-090 (문서뷰가 개행 한 번을 줄바꿈으로 그리는 옵트인 경로를 만든다)
- 근거: SPEC-027 R1·R2·R3·R6, DECISION-6F1B8C53 (`outcome: approved`, `created_by: user` — 직접 확인)
- 역할: 개발자 (developer-claude)
- 선점: acquire exit 0 → `lease-29406-20260804101229` → `in_progress`(10:12:29Z) → 구현 → 검증 → `qa_waiting`(10:16Z)
- 선행: `depends_on` 없음. 착수 조건 확인만 하고 바로 들어갔다.

**이 작업이 끝난 시점의 화면은 지금과 픽셀 하나 다르지 않다.** 세 호출부가 전부 새 프롭을 넘기지
않으므로 기본값 `false` 경로를 그대로 탄다. 켜는 일은 TASK-091이 맡는다.

## 변경한 파일 (넷, 전부 작업 문서 범위)

- `package.json` — `dependencies`에 `"remark-breaks": "^4.0.0"` 한 줄. 그 밖의 필드 무변경.
- `package-lock.json` — `npm install remark-breaks`가 만든 변경분. 손으로 고치지 않았다.
- `src/features/projects/components/MarkdownBody.tsx` — 8줄 변경(+7/−1). import 한 줄, 시그니처,
  `remarkPlugins` 한 줄.
- `src/features/projects/components/MarkdownBody.test.tsx` — 47줄 추가, 삭제 0. **기존 테스트는 이름도
  내용도 한 글자 고치지 않았다.**

세 호출부(`IdeaInbox.tsx`·`SpecWorkspace.tsx`·`DevelopmentBoard.tsx`) 무변경, `src/App.css` 무변경,
`src-tauri/` 무변경(완료 조건 6·7), 보호 상태 무변경, git 커밋·푸시 없음.

## 완료 조건 8 — 의존성 실측값

- **해석된 버전: `remark-breaks` 4.0.0.** `package.json` 범위는 `^4.0.0`.
- **`package-lock.json` 변경 규모: 30줄 추가, 삭제 0.** (`git diff --stat`은 40줄로 나오는데, 그중 10줄은
  이 세션 전부터 작업 트리에 있던 `@tauri-apps/plugin-clipboard-manager` 분이다. 설치 직전 값 10줄을
  재어 두고 차를 냈다.) 새 `node_modules/*` 엔트리는 둘 — `remark-breaks`, `mdast-util-newline-to-break`.
  npm 보고도 `added 2 packages`, `found 0 vulnerabilities`.
- **`unified`는 여전히 한 벌이다.** 설치 전후 모두 `find node_modules -type d -name unified` → 
  `node_modules/unified` 하나뿐, 버전 11.0.5. 아키텍트 판정이 기댄 값이 유지됐다.

설치는 한 번에 성공했다(1초, 261 패키지 감사). `blocked` 경로로 갈 일이 없었고, 떨어진 대안(지역
플러그인·CSS)을 되살리지 않았다.

## 구현

```tsx
export function MarkdownBody({
  body,
  preserveLineBreaks = false,
}: { body: string; preserveLineBreaks?: boolean }) {
  …
  remarkPlugins={preserveLineBreaks ? [remarkGfm, remarkBreaks] : [remarkGfm]}
```

`a` 컴포넌트 덮어쓰기와 `.markdown-body` 감싸개는 그대로 두었다. 링크의 `target="_blank"`·
`rel="noopener noreferrer"`가 켠 상태에서도 같은 것을 검사 4가 확인한다(완료 조건 5).

## 검사 (기존 1건 + 신규 4건 = 5건 전부 통과)

| # | 이름 | 고정하는 것 | 결과 |
|---|---|---|---|
| 0 | `renders GitHub flavored markdown` (기존) | 무수정 통과 | 통과 (완료 조건 4) |
| 1 | `renders a single newline as a line break when preserveLineBreaks is on` | `"첫 줄\n둘째 줄\n셋째 줄"` → `<p>` 1개·`<br>` 2개 | 통과 (R1 / 완료 조건 1) |
| 2 | `still starts a new paragraph on a blank line when preserveLineBreaks is on` | `<p>` 2개, 앞 문단에만 `<br>` 1개 | 통과 (R2 / 완료 조건 2) |
| 3 | `swallows single newlines when preserveLineBreaks is not passed` | 같은 본문에서 `<br>` 0개·`<p>` 2개 | 통과 (R6 / 완료 조건 5) |
| 4 | `renders GitHub flavored markdown the same way when preserveLineBreaks is on` | 기존 본문 상수(`:7`~`:25`)를 켠 상태로 다시 그려 제목·강조·인라인 코드·코드 블록·인용·표·취소선·목록·체크박스·링크 확인 | 통과 (R3 / 완료 조건 3) |

판정은 작업 문서 지시대로 `container.querySelectorAll("p"|"br")`로 구조를 세고 텍스트는
`toHaveTextContent`로 봤다.

### 작업 문서의 단언 예시 1건 정정 (판정 내용은 그대로)

작업 문서 "단언 방법 주의"는 켠 상태의 `textContent`가 `"첫 줄둘째 줄"`로 **붙는다**고 적었다.
실제로는 `"첫 줄 둘째 줄"`로 **한 칸 띄어 나온다** — react-markdown이 `<br>` 뒤에 개행 텍스트 노드를
같이 뱉고, `toHaveTextContent`가 그 공백을 정규화하기 때문이다. 처음 지시대로 쓴 두 단언이 이 한
가지 이유로만 빨간불이 났고(구조 단언 `<br>` 2개·1개, `<p>` 1개·2개는 첫 실행부터 전부 맞았다),
기대 문자열을 정규화된 형태로 고쳐 통과시켰다. **판정 대상이 DOM 구조라는 전제와 결론은 그대로다.**
지시를 우회한 것이 아니라 지시가 예측한 문자열이 한 칸 틀렸던 것이라, 완화가 아니라 정정으로 다뤘다.

## 게이트 수치

- **`MarkdownBody.test.tsx` 단독: `Tests 5 passed (5)`** (19:14:12 KST 실행).
- **`npm run check` 통과** (10:14Z):
  - `tsc -b --pretty false` 무오류
  - `Test Files 18 passed (18)`, `Tests 456 passed (456)` — 직전 세션 보고값 452건에서 정확히 내가 더한
    4건만큼 늘었고 줄어든 건 없다. **삭제·비활성화·약화된 테스트 없음.**
  - `vite build ✓ built in 990ms` (`dist`는 gitignore 대상)

### 병행 세션 관측

검증 중 `src-tauri/src/application/heartbeat_service.rs`와
`src-tauri/src/infrastructure/role_eligibility.rs`의 mtime이 움직였다. TASK-077·081·086이
`in_progress`인 시간대라 다른 워커의 작업이고, **내 변경분에는 들어 있지 않다**(범위 넷을 파일 단위로
확인). 이 작업의 검사는 jsdom 프런트엔드 단독이라 그쪽과 접점이 없고, `npm run check`는 Rust를 타지
않는다.

## 사용자 QA에 남기는 것

**이 작업만으로는 화면에서 볼 것이 없다.** 그것이 정상이고, 아이디어 문서뷰에서 개행이 보이기
시작하는 것은 TASK-091이 착지한 뒤다. 이 작업의 QA는 "아무것도 안 바뀌었는지"를 보는 쪽이다.

1. 아이디어 인박스·기획서 작업대·개발 작업 상세의 문서뷰가 지금까지와 똑같이 보이는지(문단 간격,
   목록, 표, 코드 블록, 링크).
2. 링크를 눌렀을 때 새 창으로 열리는 동작이 그대로인지.

## 후속 / 리스크

- **후속(다음 작업).** TASK-091이 `IdeaInbox.tsx` 호출부에서 `preserveLineBreaks`를 켠다. 이 세션은
  호출부를 건드리지 않았으므로 그 작업과 파일이 겹치지 않는다.
- **리스크(의존성).** `remark-breaks` 4.0.0이 `unified: ^11`을 요구하고 설치된 값이 11.0.5라 지금은
  한 벌이다. 앞으로 unified 12를 끌어오는 패키지가 들어오면 트리가 갈라져 플러그인이 조용히 무시될
  수 있다. 그때 빨간불이 되는 것은 검사 1·2다.
- **리스크(검사 한계).** jsdom DOM 구조까지만 본다. `<br>`가 들어간 뒤 실제 줄 간격(21px)과 문단
  경계(28px)의 시각적 차이는 재지 않았고, SPEC-027 완료 조건 3대로 사용자 눈 확인에 맡긴다. CSS는
  기획서 제외 범위라 한 줄도 손대지 않았다.
- **역할 밖 관찰(고치지 않음).** DECISION-6F1B8C53은 아키텍트에게 기존 테스트 이름
  `renders markdown formatting like the other document views`의 처리를 명시하라고 적었는데, 작업 트리의
  실제 이름은 `renders GitHub flavored markdown`이다. 이름이 "세 뷰 동일 렌더"를 문언으로 약속하고
  있지 않아 이번 옵트인과 충돌하지 않는다. 기존 테스트는 무수정으로 두었다.
