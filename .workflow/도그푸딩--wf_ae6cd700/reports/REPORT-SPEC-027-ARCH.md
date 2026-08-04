# SPEC-027 아키텍트 핸드오프

- 역할: 프로젝트 아키텍트 (architect)
- 대상: DECISION-6F1B8C53 (SPEC-027 승인, 2026-08-04T09:31:00Z)
- 산출 작업: TASK-090, TASK-091 (2건, 둘 다 `status: todo`)
- 세션: 2026-08-04T10:01Z ~ 10:12Z
- lease: `lease-10674-20260804100100` 취득(exit 0) → 갱신(exit 0) → 반납

## 선점과 경합

선점 시점에 파생 작업이 없는 승인 결정은 둘이었다.

- DECISION-6F1B8C53 (SPEC-027, 09:31:00Z)
- DECISION-4E8C1D67 (SPEC-022 보충 승인, 09:38:00Z)

둘 다 같은 기획서의 더 늦은 결정이 없어 최신이다(SPEC-022는 DECISION-7A3E5B90(08:52Z)이 앞서지만
보충 승인이 더 늦다). 직전 아키텍트 세션(REPORT-SPEC-026-ARCH)이 쓴 것과 같은 순서 규칙 — 가장 이른
것부터 — 으로 SPEC-027을 잡았다. 선점 뒤 파생 작업 유무를 다시 확인했고 여전히 0건이었다.

**DECISION-4E8C1D67은 미선점으로 남았다. 다음 아키텍트 세션 대상이다.** 결정 문서가 "SPEC-024 분해가
같은 화면 문구를 흡수할 수 있으면 별도 작업을 만들지 말 것"을 요구하므로, 그 세션은
REPORT-SPEC-024-ARCH와 SPEC-024 파생 작업(TASK-080~085 계열)의 범위를 먼저 읽어야 한다. 이번 세션은
그 판단을 하지 않았다 — 한 세션 한 대상 규칙이고, 이 결정과 코드 경로가 전혀 겹치지 않는다.

## 분해 결과

| 작업 | 내용 | 선행 | 파일 |
|---|---|---|---|
| TASK-090 | `MarkdownBody`에 `preserveLineBreaks` 옵트인 프롭 + `remark-breaks` 의존성 | 없음 | `package.json`, `package-lock.json`, `MarkdownBody.tsx`, `MarkdownBody.test.tsx` |
| TASK-091 | 아이디어 호출부에서만 켜고, 켠 쪽·안 켠 쪽을 검사로 고정 | TASK-090, TASK-079 | `IdeaInbox.tsx`, `IdeaInbox.test.tsx`, `DevelopmentBoard.test.tsx` |

**왜 둘로 나눴나.** 총 변경량은 작지만 심사 단위가 둘이다. 하나는 새 런타임 의존성과 뷰어의 능력이고,
다른 하나는 "아이디어 뷰에만"이라는 승인된 범위 결정이 코드에 남았는지다. 파일이 겹치지 않아 순서만
서면 서로를 막지 않는다. 반대로 둘을 합치면 `package-lock.json` 변경분과 범위 결정 검사가 한 심사에
섞인다.

**왜 셋으로 나누지 않았나.** 개발 작업 상세의 "켜지지 않았음" 검사를 따로 뗄 수도 있지만 단언 하나
짜리다. 그 검사와 아이디어 쪽 검사는 같은 결정의 앞뒷면이라 한 손에서 나오는 편이 이름도 맞춰진다.

## 구현 수단 결정 (기획서 확인 사실 14가 아키텍트에게 넘긴 항목)

`remark-breaks`를 의존성으로 들이고 프롭으로 켠다. 근거는 TASK-090 문서에 적었고, 요약하면 대안이
지역 플러그인(= `mdast-util-newline-to-break`를 손으로 다시 짜기)과 CSS `pre-wrap`(= R3 위반)이라
둘 다 얻는 것이 없다.

**호환성은 레지스트리와 설치 트리를 읽어 확인했다.** `remark-breaks` 최신은 4.0.0이고 의존이
`unified: ^11`, `@types/mdast: ^4`, `mdast-util-newline-to-break: ^2`다. 설치된 값은 unified 11.0.5,
@types/mdast 4.0.4, react-markdown 10.1.0, remark-gfm 4.0.1이라 범위가 맞고 unified 트리가 갈라지지
않는다. **다만 실제 설치는 하지 않았다** — 아키텍트는 제품 코드를 고치지 않는다. 해석된 버전과 lock
변경 규모를 TASK-090의 완료 조건 8이 보고하게 했고, 설치가 불가능하면 즉흥 대체 대신 `blocked`로
두게 했다.

## SPEC-008의 "세 뷰 동일 렌더"와의 관계 (결정 문서가 명시를 요구한 항목)

TASK-091 문서에 판단 셋을 적었다. 요약:

1. 어긋나는 범위는 문단 안의 소프트 개행 하나뿐이다. 세 화면은 여전히 같은 컴포넌트·같은 CSS를 쓰고,
   달라지는 것은 프롭 하나다.
2. `renders markdown formatting like the other document views`(`IdeaInbox.test.tsx:354`)를 고치지
   않는다. 그 검사가 실제로 확인하는 것은 불릿·링크·강조이고 셋 다 세 화면에서 여전히 같다. 기획서
   완료 조건 4가 이 파일의 기존 테스트를 "수정 없이" 통과시킬 것을 요구하기도 한다.
3. 대신 새 검사 둘의 이름이 예외를 말한다 — 아이디어 쪽은 "사용자가 친 줄을 지킨다", 개발 작업 상세
   쪽은 "지키지 않는다". 나란히 놓인 두 이름이 이 예외의 문서다.

## TASK-079와의 순서 (결정 문서가 판단을 요구한 항목)

**착지했다.** TASK-079는 `status: qa_waiting`이고 그 변경이 작업 트리에 들어 있다(`IdeaInbox.tsx`,
`IdeaInbox.test.tsx` 모두 미커밋 수정 상태). 그래서 지금 그 파일을 편집 중인 세션이 없다.

그럼에도 TASK-091에 `depends_on: [TASK-090, TASK-079]`로 순서를 적었다. `qa_waiting`은 선행 충족이라
지금 아무것도 막지 않고, 사용자 QA가 그 작업을 `todo`로 되돌리는 경우에만 발동해 같은 두 파일을 두
세션이 동시에 고치는 일을 막는다. 비용이 0이고 막는 것이 실재한다.

## 병행 안전 판정

- `MarkdownBody.tsx`·`MarkdownBody.test.tsx`·`package.json`·`package-lock.json`을 범위에 둔 미완료
  작업이 없다(`tasks/`의 `todo`·`in_progress`·`blocked` 전수 확인).
- `DevelopmentBoard.test.tsx`를 범위에 둔 미완료 작업이 없다. 같은 화면을 다루는 TASK-089는 CSS와 CSS
  판독 검사만 범위에 두고 `.tsx` 마크업·이 테스트 파일을 명시적으로 잘라 두었다.
- TASK-090과 TASK-091은 파일이 하나도 겹치지 않는다. 둘 사이의 순서는 충돌이 아니라 프롭 의존이다.
- 작업 트리의 `package.json` 미커밋 변경은 `@tauri-apps/plugin-clipboard-manager` 한 줄이고 이번
  추가 자리와 겹치지 않는다.

## 아키텍트가 실측한 값

기획서 확인 사실 중 분해가 기대는 것을 다시 읽었다. **어긋난 값이 없었다.** 줄 번호까지 같다.

- `MarkdownBody.tsx:1`~`:19` — 플러그인은 `remarkGfm` 하나, 프롭은 `body` 하나, 덮어쓴 컴포넌트는 `a`.
- 호출부 셋 — `IdeaInbox.tsx:236`, `SpecWorkspace.tsx:144`, `DevelopmentBoard.tsx:274`. 전부 옵션 없음.
- `.markdown-body` 계열에 `white-space` 선언 없음(`src/App.css:309`~`:329`).
- `remark-breaks` 미설치.
- 테스트 개수(2026-08-04T10:05Z): `IdeaInbox.test.tsx` 34건, `DevelopmentBoard.test.tsx` 32건,
  `MarkdownBody.test.tsx` 1건. 기획서 확인 사실 12가 지목한 대로 셋 다 소프트 개행 입력을 쓰지 않는다.

실행한 검증 명령은 읽기뿐이다 — `npm ping`(레지스트리 도달 확인), `npm view remark-breaks`,
`node -p`로 설치본 버전 확인, `sh .workflow/rules/wf-eligible.sh architect`(exit 0). 제품 코드와
`node_modules`는 건드리지 않았다.

## 남은 리스크와 후속

1. **문단 간격과 줄 간격의 차이가 약할 수 있다.** `.markdown-body p`가 `line-height: 1.75`,
   `font-size: 12px`, `margin: 7px 0`이라 줄 간격 21px, 문단 경계 28px이다. 33% 차이라 구별은 되지만
   기획서 완료 조건 3이 이 판정을 사용자 QA의 눈에 맡겼다. **CSS 조정은 기획서 제외 범위**이므로,
   QA에서 약하다는 판정이 나오면 TASK-091의 결함이 아니라 후속 아이디어 감이다. TASK-091 문서에
   그렇게 적었다.
2. **재현 데이터를 새로 만들어야 한다.** 기획서 확인 사실 10대로 저장소 아이디어 26건에는 문단 안
   개행이 없다. 사용자 QA도 저장된 문서가 아니라 입력창에 직접 친 새 아이디어로 확인해야 한다.
   TASK-091 완료 조건 1에 적었다.
3. **개발 작업 상세 쪽 검사는 TASK-090 이전에도 통과한다.** 그 검사가 막는 것은 지금의 결함이 아니라
   적용 범위가 나중에 조용히 넓어지는 일이다. 그래서 TASK-091에 빨간불 확인 절차(호출부에 프롭을
   임시로 넣어 실패를 보고 되돌리기)를 완료 조건으로 넣었다. TASK-089가 CSS 검사에 쓴 것과 같은 절차다.
4. **기획서 완료 조건 11은 해당 없음이다.** 확인 필요 1번이 아이디어 뷰 한정으로 승인되면서 R6 둘째
   항목이 발동하지 않았고, 개발 작업 문서 61건의 고정폭 랩 정리는 범위에 들어오지 않는다.
5. **아키텍트 대상 1건 미처리: DECISION-4E8C1D67 (SPEC-022 보충 승인).** lease 없음. 위 "선점과 경합"
   절에 그 분해가 먼저 읽어야 할 문서를 적었다.

## 역할 밖 발견 (핸드오프)

- 없음. 이번 분해에서 기획서와 어긋난 사실이나 역할 밖 수정이 필요한 자리를 발견하지 못했다.
