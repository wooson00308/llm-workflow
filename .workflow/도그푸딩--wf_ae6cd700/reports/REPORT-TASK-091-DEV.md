# TASK-091 개발자 핸드오프

- 대상: TASK-091 (아이디어 문서뷰에만 개행 표시를 켜고 적용 범위를 양쪽 검사로 고정한다)
- 근거: SPEC-027 R1·R2·R6·R7, DECISION-6F1B8C53 (`outcome: approved`, `created_by: user` — 직접 확인)
- 역할: 개발자 (developer-claude)
- 선점: acquire exit 0 → `lease-23175-20260804104550` → `in_progress`(10:46:00Z) → 구현 → 검증 → `qa_waiting`(10:52Z). renew도 exit 0.
- 선행: TASK-090 `qa_waiting`, TASK-079 `qa_waiting`. 둘 다 충족이라 착수했다. TASK-090의 산출물인
  `preserveLineBreaks` 프롭이 `MarkdownBody.tsx:7`에 실제로 있는 것을 켜기 전에 확인했다.

## 변경한 파일

셋뿐이다. 작업 문서의 범위와 정확히 같다.

- `src/features/projects/components/IdeaInbox.tsx` — 호출부 한 줄.
- `src/features/projects/components/IdeaInbox.test.tsx` — 검사 하나 추가(+23줄).
- `src/features/projects/components/DevelopmentBoard.test.tsx` — 검사 하나 추가(+19줄, 주석 2줄 포함).

`SpecWorkspace.tsx`·`DevelopmentBoard.tsx`·`MarkdownBody.tsx`·CSS·`src-tauri/` 전부 무변경(완료 조건
9·13). 보호 상태 무변경. git 커밋·푸시·checkout·restore·stash 없음.

## 제품 코드

```tsx
<MarkdownBody body={body.body} preserveLineBreaks />
```

`IdeaInbox.tsx:236`. **이 한 줄이 이 작업의 제품 코드 변경 전부다.** `SpecWorkspace.tsx:144`와
`DevelopmentBoard.tsx:274`는 손대지 않았다 — 승인된 확인 필요 1번이 아이디어 뷰 한정으로 정했고 R6
첫째 항목이 두 화면의 무변경을 요구한다.

## 검사 둘

### `keeps the line breaks the user typed in the idea body` (IdeaInbox.test.tsx)

본문 상수는 이 저장소 아이디어의 실제 형식을 따라 배경·원인·방향 세 줄을 개행 한 번씩으로 나누고,
빈 줄 뒤에 문단 하나를 더 뒀다. 한 상수로 R1과 R2를 함께 본다.

작업 문서가 경고한 대로 `getByText`를 쓰지 않았다 — `<br>`가 들어가면 `textContent`가 이어 붙어
맞지 않는다. `container.querySelectorAll(".markdown-body p")`로 구조를 세고 내용은 `toHaveTextContent`로
본다. 단언은 `<p>` 둘 / 앞 문단의 `<br>` 둘 / 세 줄이 모두 앞 문단 안 / 뒷 문단은 별개의 `<p>`이고
`<br>` 없음.

`documentFor(firstIdea, body)`와 `onReadIdea` 목을 쓰는 기존 어법(`:272`~`:291`)을 그대로 따랐다.

### `leaves a soft line break unbroken in the task detail` (DevelopmentBoard.test.tsx)

개행 한 번으로 나눈 두 줄을 작업 상세에서 열고 `.markdown-body`에 `<br>`가 하나도 없으며 두 줄이
`<p>` 하나 안에 있는 것을 본다(R7 셋째 항목 / 완료 조건 10).

본문은 작업 문서의 지시대로 `vi.fn().mockResolvedValue({ summary, body })` 목을 검사 안에 뒀다
(`dependencyReader`의 어법). `taskReader`는 본문을 제목·요약에서 조립하므로 맞지 않는다. **기존 헬퍼
둘은 고치지 않았다.**

이 검사가 지금 트리에서 그냥 통과한다는 사실과, 그래도 남기는 이유(막는 대상이 지금의 결함이 아니라
적용 범위 결정이 나중에 조용히 넓어지는 일이라는 것)를 검사 위 주석 두 줄로 적고 DECISION-6F1B8C53의
확인 필요 1번을 근거로 인용했다.

## 빨간불 확인 (완료 조건 10)

두 검사 모두 돌렸다. 각각 원인을 심고 → 실패를 확인하고 → 되돌렸다.

**개발 작업 상세 쪽** — `DevelopmentBoard.tsx:274`의 `MarkdownBody` 호출에 `preserveLineBreaks`를 임시로
넣고 그 검사만 실행했다.

```
FAIL  DevelopmentBoard > leaves a soft line break unbroken in the task detail
AssertionError: expected <br></br> to have a length of +0 but got 1
- Expected  0
+ Received  1
 ❯ DevelopmentBoard.test.tsx:524:61
```

**아이디어 쪽** — 같은 절차를 반대로 했다. `IdeaInbox.tsx:236`에서 `preserveLineBreaks`를 임시로 빼고
새 검사만 실행했다.

```
FAIL  IdeaInbox > keeps the line breaks the user typed in the idea body
- Expected  2
+ Received  0
 ❯ IdeaInbox.test.tsx:396:50
```

앞의 것은 "범위가 넓어지면 빨간불", 뒤의 것은 "이 작업의 한 줄이 없으면 빨간불"을 보인다. 둘 다
되돌린 뒤 `grep`으로 확인했다 — `preserveLineBreaks`는 `MarkdownBody.tsx`(정의)와 `IdeaInbox.tsx`(호출)
두 곳에만 있고 `DevelopmentBoard.tsx`·`SpecWorkspace.tsx`에는 없다.

## 완료 조건 대조

| # | 조건 | 결과 |
|---|---|---|
| 1 | 두 줄이 두 줄로 보인다 | 새 아이디어 검사. 화면 확인은 사용자 QA 몫 |
| 2 | 세 줄 이상도 각 줄 유지 | 같은 검사가 `<br>` 둘을 센다 |
| 3 | 빈 줄은 다른 문단 | 문단 구조는 같은 검사(`<p>` 둘). 간격 차이는 사용자 QA |
| 4 | 기존 `IdeaInbox.test.tsx` 무수정 통과 | 아래 개수 참조 |
| 5 | 링크 `target`·`rel` | 기존 `renders markdown formatting like the other document views` 통과 |
| 6 | frontmatter 비노출 | 기존 `does not show frontmatter` 통과 |
| 7 | 목록 행 요약 규칙 | 기존 `keeps the list row excerpt` 통과. 변경분에 `markdown_excerpt` 없음 |
| 8 | 미리보기 메타·로딩·실패 표시 | 기존 검사 3건 통과 |
| 9 | 변경분에 `src-tauri/` 없음 | 이 세션이 건드린 파일 셋 전부 `src/` |
| 10 | 상세에서 개행 안 그려짐 | 새 검사 + 위 빨간불 절차 |
| 11 | **해당 없음** | 확인 필요 1번이 아이디어 뷰 한정으로 승인돼 개발 작업 문서 61건의 고정폭 랩 정리는 범위 밖 |
| 12 | 기존 검사 삭제·비활성화 없음 | 아래 개수 참조 |
| 13 | 기획서 리더 무변경 | 변경분에 `SpecWorkspace.tsx` 없음 |
| 14 | `npm run check` 통과 | 아래 검증 참조 |

### 검사 개수 (완료 조건 4·12)

착수 시점에 직접 셌다. **작업 문서의 "34건"은 선언 개수이고 러너가 실행하는 건수는 36건이다** —
`it.each`(`:634`) 하나가 3건으로 펼쳐진다. 그래서 두 값을 다 적는다.

| 파일 | 착수 시점 | 지금 | 차이 |
|---|---|---|---|
| `IdeaInbox.test.tsx` | 선언 34 / 실행 36 | 선언 35 / 실행 37 | 추가 하나뿐 |
| `DevelopmentBoard.test.tsx` | 선언 32 / 실행 32 | 선언 33 / 실행 33 | 추가 하나뿐 |

기존 이름을 하나도 안 고쳤다는 것은 착수 시점에 뜬 이름 33개를 그대로 받아 지금 파일에서
`grep -F`로 되찾는 방식으로 확인했다 — 누락 0건. `DevelopmentBoard.test.tsx`의 32건도 이름·내용
그대로 통과한다.

`git diff`로 "추가뿐"을 직접 보이지는 못했다. **저장소에 이 세션 이전의 미커밋 변경이 크고 두 테스트
파일도 거기 포함돼(TASK-079 등) HEAD 대비 diff에 남의 삭제 줄이 섞이기 때문이다.** 대신 위 두 가지로
대체했다: 선언 개수가 파일당 정확히 +1, 기존 이름 전수 보존.

## 검증

- `npx vitest run IdeaInbox.test.tsx DevelopmentBoard.test.tsx` → 70 passed (착수 시점 68 + 새 검사 2).
- `npm run check` (= `tsc -b` → `vitest run` → `tsc -b && vite build`) → exit 0, 18개 파일 459건 통과,
  빌드 성공. **연속 3회 돌려 전부 exit 0.**
- 빨간불 절차 2회 (위 참조).

### 재현되지 않은 exit 1 하나

`npm run check`를 처음 확인용으로 돌릴 때 출력을 `/dev/null`로 버린 실행 하나가 exit 1을 냈다. 로그를
버려서 원인을 못 봤고, 같은 명령을 출력을 남기며 **3회 연속 돌린 결과는 전부 exit 0에 실패 0건이었다.**
그 직전·직후의 전체 출력에도 실패나 타입 오류가 없다. 재현되지 않았으므로 이 작업의 결함으로 보지
않지만, 지어내지 않고 있는 그대로 남긴다.

## 사용자 QA에 부탁하는 것

자동 검사가 닿지 못하는 두 가지다.

1. **입력창에 직접 친 새 아이디어로 확인해 주세요.** 저장된 아이디어 26건에는 재현 형태가 없다(확인
   사실 10). 개행 한 번으로 나눈 두세 줄과, 빈 줄로 나눈 문단을 섞어서 한 건 넣고 미리보기를 본다.
2. **문단 간격과 줄 간격이 눈으로 구별되는지** (완료 조건 3). CSS를 바꾸지 않았으므로 지금 값 그대로다
   — `.markdown-body p`가 `line-height: 1.75`, `font-size: 12px`, `margin: 7px 0`이라 줄 간격 21px,
   문단 경계 28px이다.

## 리스크와 후속

- **간격이 약하다는 판정이 나오면 그것은 이 작업의 결함이 아니라 후속 아이디어 감이다.** 기획서 제외
  범위가 표현 조정을 잘라 뒀으므로 CSS를 고치지 않았다. 그 판정이 나오면 새 아이디어로 올려야 한다.
- **개발 작업 문서 61건의 고정폭 랩은 그대로다.** 확인 필요 1번이 아이디어 뷰 한정으로 승인되면서 R6
  둘째 항목이 발동하지 않았다(완료 조건 11 해당 없음).
- **기존 테스트 이름 `renders markdown formatting like the other document views`를 고치지 않았다.** 그
  이름이 실제로 확인하는 셋(불릿 두 개, 링크 `href`, 강조)은 이번 변경 뒤에도 세 화면에서 같으므로
  거짓이 되지 않는다. 완료 조건 4가 이 파일의 기존 검사를 "수정 없이" 통과시킬 것을 요구하기도 한다.
  SPEC-008의 "세 뷰 동일 렌더"에서 어긋나는 범위는 문단 안의 소프트 개행 하나뿐이고, 그 예외는 나란히
  놓인 두 새 검사의 이름이 문서 노릇을 한다.

## 역할 밖 관찰 (핸드오프 노트, 고치지 않음)

- 저장소에 이 세션과 무관한 미커밋 변경이 크다(`src-tauri/` 다수, `docs/`, `package.json`,
  `scripts/wf-eligible.sh` 삭제 등). 완료 조건 12의 `git diff` 검증을 그대로 못 쓴 이유이기도 하다.
  누군가 정리 시점을 잡는 편이 이후 작업의 검증을 쉽게 만든다.
- `.workflow/.runtime/leases/SPEC-009.yml`이 2026-08-03T01:20:00Z로 만료된 채 남아 있다. 판정은 만료
  lease를 선점으로 세지 않으므로 아무것도 막지 않는다. 판정·헬퍼 어느 쪽도 남의 lease 파일을 지우지
  않으므로 그대로 뒀다.
