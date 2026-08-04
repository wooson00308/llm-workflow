# TASK-089 개발자 핸드오프

> 기록 경위: 하네스가 서브에이전트(tl-dev-089)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-04T10:15Z, TL 세션)

- 대상: TASK-089 (상태 배지가 좁은 자리에서 접히지 않게 하고 선언을 회귀 검사로 고정한다)
- 근거: SPEC-026 R1~R5, DECISION-8D4A2E96 (outcome: approved, created_by: user — 직접 확인)
- 역할: 개발자 (tl-dev-089)
- 선점: acquire exit 0 → `lease-1346-20260804095702` → in_progress(09:57:30Z) → 구현 → 검증 → qa_waiting(10:08:30Z) → renew exit 0, release exit 0
- 선행: `depends_on: [TASK-074]` 착수 시점 `qa_waiting` 확인. 산출물 `boardCardOverflow.test.ts`가 작업 트리에 실재하는 것을 읽어 확인.

## 변경한 파일 (넷, 전부 작업 문서 범위)

- `src/App.css` — 두 줄. `.status-pill`(:227)에 `white-space: nowrap`, `.idea-preview h2`(:268)에 `overflow-wrap: anywhere`. 다른 규칙 무변경.
- `src/test/cssRules.ts` — 신설. `declarationsOf` 하나를 내보낸다.
- `src/features/projects/components/statusPillWrap.test.ts` — 신설. 회귀 검사 7건(2 describe).
- `src/features/projects/components/boardCardOverflow.test.ts` — 헬퍼 정의 삭제 + import 한 줄로 교체.

`.tsx` 다섯 개 마크업 무변경, `IdeaInbox.tsx`·`IdeaInbox.test.tsx` 무변경, `src-tauri/` 무변경, 보호 상태 무변경, git 커밋·푸시 없음.

## 핵심 결정과 근거

- `flex-shrink: 0`을 함께 걸지 않았다(작업 문서 지시). nowrap이 자동 최소 크기를 문구 전체 폭으로 올리는 것으로 여덟 자리 전부에 충분하고, 그중 셋은 그리드·표라 `flex-shrink`가 하는 일이 없다.
- 선언 위치는 선례를 따랐다 — `.idea-state-tag`(:256)·`.idea-preview > footer code`(:277)가 `white-space`를 규칙 끝에, TASK-074의 `.task-card > strong`(:425)이 `overflow-wrap`을 끝에 둔다. stylelint 설정은 저장소에 없다.
- 판독기는 복제하지 않고 옮겼다. `cssRules.ts`의 `declarationsOf`는 같은 선택자 규칙이 둘 이상이면 던지는 TASK-074의 동작을 그대로 가져왔다.

## 완료 조건 7 — 검사가 실제로 빨간불이 되는지

`.status-pill`에서 `white-space: nowrap`만 임시로 지우고 실행 → `Tests 1 failed | 5 passed (6)`.

```
FAIL … > 상태 배지 접힘 방지 선언 > 배지 문구가 한 줄을 지킨다
AssertionError: expected undefined to be 'nowrap' // Object.is equality
- Expected: "nowrap"
+ Received: undefined
 ❯ statusPillWrap.test.ts:28:63
```

되돌린 뒤 전건 통과 확인. 되돌릴 때 `letter-spacing: .02em; }`가 파일에 두 곳이라 규칙 전문으로 교체했고 `sed -n '227p;268p'`로 최종 상태를 확인했다.

## 완료 조건 8 — 여덟 자리 화면 확인 (실측)

측정 방법: 앱 데이터 계층(`tauriProjectGateway`)이 Tauri `invoke`를 직접 불러 브라우저 폴백이 없어 vite dev만으로는 이 화면에 도달하지 못한다. 스크래치패드에 하네스를 만들어 **실제 App.css 전문을 싣고** 여덟 자리의 조상 사슬·실제 최소 폭·실제 문구(`stateLabels`·`statusLabels` 원문)를 재현한 뒤 설치된 Chrome을 `--headless=new --dump-dom`으로 돌려 쟀다. **저장소에는 아무것도 추가하지 않았다**(브라우저 검사 도구 도입은 범위 밖). 측정값은 배지 텍스트 줄 상자 수(Range.getClientRects().length), 배지 폭·높이, 컨테이너 scrollWidth−clientWidth. `.status-pill`의 white-space를 normal↔nowrap 토글해 같은 페이지에서 전/후 비교.

| # | 자리 | 담는 상자 | 지금 접히나 | nowrap 뒤 칸을 미나 | 실측 (전 → 후) |
|---|---|---|---|---|---|
| 1 | `IdeaInbox.tsx:210` | `.idea-preview > header` 플렉스 | **접힌다** | 아니다 | **3줄 23.8px → 1줄 43.2px**, 넘침 0 → 0 |
| 2 | `SpecWorkspace.tsx:117` | `.spec-list-panel button` 그리드 | 아니다 | 아니다 | 1줄 68.8px → 변화 없음, 넘침 0 |
| 3 | `SpecWorkspace.tsx:139` | `.spec-reader-panel > header` 플렉스 | **접힌다** | 아니다 | **3줄 40.6px → 1줄 65.8px**, 넘침 0 → 0 |
| 4 | `DevelopmentBoard.tsx:262` | `.view-heading` 플렉스 | 아니다 | 아니다 | 1줄 **92px → 92px**, 넘침 0 |
| 5 | `DevelopmentBoard.tsx:430` | `.task-list td` 표 칸 | 접힐 수 있다 | 아니다 | 1줄 53.6px → 변화 없음, **상태 칸 109.4px → 109.4px** |
| 6 | `DevelopmentBoard.tsx:575` | `.task-card > div` 플렉스 | 아니다 | 아니다 | 1줄 46.3px → 변화 없음, 넘침 0 |
| 7 | `WorkspaceShell.tsx:486` | `.archive-grid button` 그리드 | 아니다 | 아니다 | 1줄 33.5px → 변화 없음, 넘침 0 |
| 8 | `WorkspaceShell.tsx:495` | `.archive-grid article` 그리드 | 아니다 | 아니다 | 1줄 33.5px → 변화 없음, 넘침 0 |

**아키텍트의 여덟 판정이 전부 맞았다.** 화면이 달라지는 곳은 1·3번뿐, 나머지 여섯은 선언만 붙고 그림 그대로. **컨테이너 가로 넘침은 전·후 모두 여덟 자리 전부 0 — 배지가 칸을 밀어내는 자리가 없다.**

**4번(작업 상세) 특별 확인:** 배지 폭이 nowrap 전에도 후에도 정확히 92px로 같다. `.view-heading > span`(:215, 특이도 0-1-1)의 `min-width: 92px`가 `.status-pill`(0-1-0)을 이긴다. **작업 상세 화면은 이 변경으로 아무것도 안 바뀌는 것이 정상이다 — QA에서 결함으로 보지 말 것.** 기획서 확인 사실 10의 "구조까지 같아 같은 증상이 난다"는 이 자리에 한해 사실과 다르고, 작업 문서의 정정이 실측으로 확인됐다.

1번은 61자 제목(IDEA-7BCB8947 실제 파생값)·36자 런 제목(IDEA-CAB890F1)·짧은 제목 셋으로 각각 쟀다. **짧은 제목은 전·후가 1줄 43.2px로 완전히 동일** — 완료 조건 6의 근거.

## 완료 조건 9

확인 필요 1번이 넓게 승인되어 여덟 자리 전부에 처방이 걸렸다. **같은 결함이 남는 자리는 없다.**

## R2 / 완료 조건 4 — `overflow-wrap: anywhere`의 실제 효과 + 전제 정정 1건

같은 하네스로 overflow-wrap도 토글(문서뷰 열 최소 360px, 헤더 가용 310px):

| 제목 | 두 선언 없음 | nowrap만 | 두 선언 모두 |
|---|---|---|---|
| A. 61자 (IDEA-7BCB8947) | 배지 3줄, 넘침 0 | 배지 1줄, 넘침 0 | 배지 1줄, 넘침 0 |
| B. IDEA-CAB890F1 실제 파생 제목 | 배지 3줄, 넘침 0 | 배지 1줄, 넘침 0 | 배지 1줄, 넘침 0 |
| C. 36자 런이 통째로 든 제목 | 배지 3줄, **헤더 넘침 91px** | 배지 1줄, **헤더 넘침 110px** | 배지 1줄, **넘침 0** |

**정정:** 작업 문서는 36자 런 `~/.claude/heartbeat/jobs.d/<slug>.md`가 IDEA-CAB890F1 제목에 실린다고 적었지만, 60자 절단이 그 런 한가운데 떨어져 **지금 파생 제목에 남는 것은 앞 20자(`~/.claude/heartbeat…`)뿐이다.** 26건 파생 제목을 전부 훑은 결과 제목 안 최장 무공백 런은 그 20자이고 지금 폭에서 넘치지 않는다(B행).

따라서 `overflow-wrap: anywhere`는 **오늘 데이터에서는 화면을 바꾸지 않는 예방 선언**이다. 다만 근거는 있다 — C행대로 런이 통째로 실리면 nowrap이 헤더 넘침을 91→110px로 **키우고** anywhere가 0으로 끊는다. 본문에는 38자 런(`merge_block(heartbeat_service.rs:425)이`, IDEA-A61F6A81)까지 있어 절단 위치만 달랐으면 제목에 실렸을 입력이다. R2가 조건 없이 요구하므로 유지했고, 이 사실을 검사 파일 주석에 남겼다.

## 게이트 수치

- **착수 시점 `IdeaInbox.test.tsx`: 36건 전부 통과**(09:57Z 실측). 기획서 23건은 낡은 값. 이 파일 **무수정** — `shows each derived state in the preview badge`(:89) 포함 전건 통과 (조건 10·11·12).
- **`boardCardOverflow.test.ts` 여섯 단언 이름·내용 그대로 전부 통과.** 이 파일은 TASK-074가 커밋 전이라 git **untracked**여서 `git diff`가 빈 출력이다. 조건 13은 파일·심볼 단위로 확인했다: 머리 주석 17줄 그대로, `overflowRun = "(\`HeartbeatCard.tsx:246\`~\`:252\`)."` 그대로, 6개 `it(...)`·2개 `describe` 그대로. 변경은 `import cssText from "../../../App.css?raw"` + `type Rule` + `collectRules` + `rules` + `declarationsOf`(55줄) 삭제 후 `import { declarationsOf } from "../../../test/cssRules";` 한 줄 삽입뿐. **삭제·비활성화·약화된 테스트 없음.**
- **내 범위 3파일 합산 49건 통과**(36 + 6 + 7).
- **`npm run check` 통과** (10:07Z): typecheck 무오류 → `Test Files 18 passed (18)`, `Tests 452 passed (452)` → `vite build ✓ built in 920ms`.

### 게이트 중 만난 남의 실패 (내 변경과 무관, 해소됨)

10:05Z 실행에서 `IntegrationsView.test.tsx`가 typecheck 오류 6건(`Cannot find name 'skipped'`), 다음 실행에서는 `:536`의 `expect(row).not.toHaveTextContent("없음")` 실패. 그 파일 mtime이 실행 중인 10:05:56Z였고 총 테스트 수가 441→448→452로 움직였다 — **병행 워커가 그 파일을 쓰는 중이었다.** 내 산출물과 연결 없음: 그 파일은 `cssRules`·`App.css`·`status-pill`·`idea-preview` 어느 것도 참조하지 않고, jsdom 컴포넌트 트리엔 스타일시트가 실리지도 않는다. 10:07Z 재실행 452건 전건 통과로 해소. 내 파일은 건드리지 않았다.

## 사용자 QA에 남기는 것 (조건 1~6)

이 세션은 앱을 띄우지 못했다(Tauri IPC 필요). 위 실측은 실제 App.css를 실은 하네스를 Blink로 잰 값이지 **앱 화면 자체는 아니다.**

1. **창 폭 주의** — 두 열이 유지되는 폭에서 볼 것. 980px 이하는 한 열로 바뀌어 결함이 안 보인다. 실측은 문서뷰 열 360px 지점(레이아웃 673px)과 1440px 창에서 했다. QA는 **1000~1200px 언저리 + 최대화** 두 가지 권장.
2. IDEA-7BCB8947(61자, 신고자)을 열어 오른쪽 위 배지가 한 줄인지.
3. 네 상태(수집됨·반영중·종결·채택) 각각에서 같은지.
4. IDEA-CAB890F1을 좁은 폭에서 열어 헤더가 가로로 안 넘치는지.
5. 제목이 여러 줄로 접히며 **전부 보이는지**(말줄임·잘림이 생기면 그게 결함 — 승인된 처방은 제목을 자르지 않는다).
6. 짧은 제목 아이디어에서 헤더 모양이 이전과 같은지.
7. 덤으로 **기획서 작업대**(3번 자리) 헤더 배지도 함께 펴진다.

## 후속 / 리스크

- **후속(범위 밖).** `.spec-reader-panel > header`의 h2(:301)에는 `overflow-wrap`을 걸지 않았다. 그 자리 배지 접힘은 닫았지만 제목 쪽 긴 런은 그대로다. 근거 없이 넓히지 않았다.
- **후속(문서).** SPEC-026 확인 사실 13의 "23건"은 36건, 확인 사실 6의 "25건 중 9건"은 지금 **26건 중 10건**(IDEA-0C30206C 증가). 역할 계약상 기획서는 고치지 않았다.
- **리스크(검사 한계).** 레이아웃을 재지 않는다. "선언이 그 규칙에 있다"까지만 보장하고 "그래서 안 접힌다"는 보장 못 한다. 선언을 남긴 채 다른 규칙이 덮으면 검사는 통과하고 화면은 깨진다. 확인 필요 2번이 그 한계를 안고 승인한 것이라 그대로 두고 파일 머리 주석에 적었다.
- **리스크(공유 판독기).** `declarationsOf`는 같은 선택자 규칙이 둘 이상이면 던진다. 앞으로 `.status-pill`이나 `.idea-preview h2`를 두 번째로 선언하면 두 검사 파일이 함께 빨간불이 된다. 그것이 의도다.
- **병행.** App.css에 다른 워커의 새 규칙이 함께 들어올 수 있고, 이 세션은 두 규칙 구간만 만졌다.
