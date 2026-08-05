# TASK-109 개발자 핸드오프

- 대상: TASK-109 (dream 카드가 같은 갱신 안내를 같은 문구로 말한다)
- 근거: SPEC-034 R7, 완료 조건 1·2·6·8·10·12·13·14·15,
  DECISION-3ECEDCA1 (`schema: workflow-labs/decision@1`, `spec_id: SPEC-034`, `outcome: approved`,
  `created_by: user`, 2026-08-04T16:56:16Z — 직접 확인. SPEC-034의 결정 문서는 이 1건뿐이라 더 늦은
  결정이 없고, 승인이 유효하다)
- 역할: 개발자 (developer-claude)
- 선점: `acquire TASK-109 developer-claude 45` exit 0 → `lease-81198-20260804202343` →
  `in_progress`(2026-08-04T20:24:10Z) → 구현 → 검증 → `qa_waiting`. 중간에 `renew` exit 0 1회.

## 선행 확인

`depends_on: [TASK-108]`. TASK-108은 `qa_waiting`이라 충족이다.

- 착수 시점 `todo`는 TASK-106·109 2건. 106은 `depends_on: [TASK-104]`이고 TASK-104가 `in_progress`라
  미충족이다. 선행이 충족된 `todo`는 TASK-109 하나뿐이었고 `wf-eligible.sh developer`도 exit 0 /
  `eligible`이었다.
- 착수 시점 lease 둘은 모두 만료였다 — `SPEC-009.yml`(만료 2026-08-03T01:20:00Z),
  `TASK-104.yml`(만료 2026-08-04T19:37:05Z, 판정 시각 2026-08-04T20:22:48Z). TASK-109를 덮는 lease는
  없었다.
- 범위가 겹치는 열린 작업이 없다. `in_progress`인 TASK-104는 `src-tauri/`의 조건 판정이 범위이고
  `todo`인 TASK-106은 같은 파일의 회귀 검사다. 이 작업은 dream 카드 두 파일만 만졌다.
- `.workflow/.runtime/migration.lock` 없음.

## 만든 것

### 1. 배선 (`DreamCard.tsx`, +6줄)

이 파일의 변경은 둘뿐이다.

- import 한 줄 (`./HeartbeatUpdateGuide`). `JobChanges` 다음 자리로, 역할 잡 카드와 같은 순서다.
- 084 경고 안 `<p>{noRunEvidenceNote}</p>` 다음에 `<HeartbeatUpdateGuide guide={snapshot.updateGuide} />`
  한 줄과 그 주석 넉 줄.

작업 지시가 못 박은 자리 그대로다 — `HeartbeatCard.tsx:1177`~`:1185`와 같은 경고, 같은 순서.

- **표시 조건을 새로 만들지 않았다.** `missingRunEvidence(installed, dream.lastRun)`가 이미 그 자리의
  조건이고 안내는 그 안에 들어간다.
- **문구를 이 카드가 다시 쓰지 않았다.** 상수를 하나도 추가하지 않았고, 컴포넌트가 여덟 문구를 전부
  들고 있다.
- **접힘 요약(`DreamCard.tsx:311`)과 어떤 버튼의 `disabled` 조건도 건드리지 않았다.**
- **`App.css`를 만지지 않았다.** TASK-108이 더한 `.heartbeat-update-*` 11개가 카드에 매이지 않은
  전역 선택자라(`src/App.css:766`~`:777`) dream 카드에도 그대로 걸린다.

### 2. 검사 (`DreamCard.test.tsx`, 7건 신규)

`describe("dream 카드 갱신 안내")` 하나에 모았다. 기존 검사는 이름도 내용도 고치지 않았다.

| # | 이름 | 작업 지시 검사 | 보는 것 |
| --- | --- | --- | --- |
| 1 | puts the update steps inside the very warning that asks for the update | 1 | 084 경고 안에 안내가 있다. 084 문구가 그대로 남고 원인을 단정하는 문장이 새로 생기지 않는다 |
| 2 | stays out of sight wherever the warning itself is out of sight | 2 | 실행 기록 있는 잡·잡 꺼짐·미설치 셋에서 안내 없음 |
| 3 | shows every command the payload carries and assembles none of them | 3 | 명령 원문 다섯이 픽스처 값 그대로. 갈래 넷이 모두 있다 |
| 4 | copies each command exactly as it arrived | 4 | 걸음마다 복사 버튼, `copy`가 원문 그대로 불림, 표시는 하나뿐 |
| 5 | keeps the command on screen when the copy fails | 4 | 실패 문구가 뜨고 원문은 남는다 |
| 6 | adds copy buttons and nothing else | 6 | 안내의 버튼이 전부 복사 버튼이고 저장·재설정이 활성이다 |
| 7 | says the update guide with the very words the role job card says | 5 | 두 카드의 안내 영역 텍스트가 글자까지 같다 |

### 3. 두 카드를 나란히 비교하는 방법 (검사 5)

작업 지시가 준 두 형태 중 **앞쪽(두 카드를 한 파일에서 렌더)** 을 썼다.

- 같은 `updateGuide` payload로 dream 카드를 그려 `.heartbeat-update-guide`의 `textContent`를 잡고,
  `cleanup()` 뒤 같은 스냅샷의 역할 잡 카드(`HeartbeatCard`)를 그려 같은 영역의 `textContent`와
  `toBe`로 비교한다.
- 뒤쪽 형태(컴포넌트 모듈에서 문구를 읽어 두 화면에 있음을 단언)는 쓸 수 없었다.
  `HeartbeatUpdateGuide.tsx`의 문구 여덟은 모듈 밖으로 나가지 않고, export를 더하는 것은 이 작업의
  범위 밖(TASK-108의 파일)이다.
- **"같은 컴포넌트를 쓰니까 같다"로 대신하지 않았다.** 어느 한쪽이 문구를 따로 들기 시작하면 이
  단언이 먼저 깨진다.
- 허수 통과를 막았다. 비교 전에 dream 쪽 텍스트가 안내 제목과 명령 원문을 담고 있음을 먼저
  단언하므로, 두 값이 모두 비어 같아지는 통과가 성립하지 않는다. 안내 영역을 고르는
  `getByText(guideTitle)` 자체도 없으면 던진다.
- 역할 잡 카드 픽스처(`roleJobWarned()`)는 dream 픽스처의 `snapshot()`을 그대로 쓰고 `heartbeat`만
  덮는다 — 개발자 잡만 파일에 있고 실행 기록이 없어 안내가 한 자리에만 뜬다. `updateGuide`는 같은
  값이다.

## 작업 지시에서 벗어난 자리 둘 — 먼저 보고한다

둘 다 **기존 검사의 이름·단언·기대값은 하나도 건드리지 않았고**, 기존 93건이 수정 없이 통과한다.
다만 `DreamCard.test.tsx`의 파일 수준 자산을 건드렸으므로 적어 둔다.

1. **클립보드 대역 추가** (`vi.hoisted` + `vi.mock("../../infrastructure/clipboard")`, 파일 머리).
   - 이유: 검사 4·5가 복사를 본다. 복사는 `actions` prop이 아니라 모듈 import라 주입할 자리가 없고,
     실제 플러그인은 Tauri 런타임을 요구한다. `IntegrationsView.test.tsx`가 같은 이유로 같은 대역을
     쓴다.
   - 기존 검사에 영향이 없다: `DreamCard.tsx`에 `copy`를 부르는 자리가 이 작업 전에는 없었고
     (`grep clipboard\|copy` 0건), 지금도 안내 컴포넌트 안뿐이다.
2. **픽스처 `updateGuide` 다섯 값을 구별 가능한 값으로 바꿈** (`pip show claude-heartbeat` →
   `fixture-identify claude-heartbeat` 등 5줄).
   - 이유: 검사 3이 "화면이 명령을 조립하지 않는다"(완료 조건 4)를 보는데, 픽스처가 실제 명령과 같은
     문자열이면 화면이 조각을 붙여 만들어도 통과한다. `IntegrationsView.test.tsx`의 같은 이름 픽스처가
     같은 이유로 `fixture-*`를 쓴다.
   - TASK-108이 그 자리에 `"이 파일은 필수 필드를 채우기만 하고, dream 카드의 시나리오는 TASK-109다"`
     라고 적어 두었고, 이 값을 읽는 기존 검사는 0건이다(그 상수의 유일한 참조가 `snapshot()`의 필드
     대입이었다).
   - 검사를 약화시키지 않았다: 바꾼 것은 기대값이 아니라 입력값이고, 단언은 전부 그 입력값을 그대로
     비교한다.

## 완료 조건 대조

1. dream 카드의 084 경고 자리에서 갱신 절차를 읽는다 → 검사 1. 다른 탭·외부 링크 없음.
2. 두 카드의 안내가 같은 조건에서 뜨고 문구가 글자까지 같다 → 검사 1·2·7. 조건은 `missingRunEvidence`
   하나를 두 카드가 각자 같은 판정으로 쓰고, 문구는 검사 7이 글자로 센다.
3. 명령 원문마다 복사 수단이 있고 복사 실패에도 원문이 남는다 → 검사 4·5.
4. 명령 문자열을 화면이 조립하지 않는다 → 검사 3. `DreamCard.tsx`의 변경 6줄에 문자열 결합·템플릿
   리터럴이 없다. 다섯 값은 `snapshot.updateGuide`를 통째로 컴포넌트에 넘길 뿐이다.
5. 갱신을 실행하는 버튼이 없다 → 검사 6. 안내 안의 버튼은 전부 `... 명령 복사`다.
6. dream 카드의 다른 동작이 달라지지 않았다 → `DreamCard.test.tsx`의 기존 93건이 **수정 없이**
   통과한다. 잡 저장·재설정·정제 상태·접힘 요약 시나리오가 모두 그 안에 있다
   (`marks the collapsed summary so the warning is not hidden by the fold` 포함).
7. 기존 검사 삭제·비활성화 없음 → `.skip`·`.todo` 0건(착수 시점도 0건). 착수 시점
   `DreamCard.test.tsx`의 검사는 **93건**, 지금은 **100건**(신규 7건, 삭제 0건). 착수 시점 값은
   착지 후 단독 실행 100건에서 신규 7건을 뺀 값이고, 저장소 전체 검사 수가
   539건(TASK-108 착지 시점) → 546건으로 정확히 7건 늘어난 것과 일치한다.
8. 변경분에 `DreamCard.tsx`와 `DreamCard.test.tsx` 말고 다른 파일이 없다 →
   `git diff --stat`에서 이 세션이 만진 소스는 그 둘뿐이다(+6 / +193). 작업 트리의 다른 미커밋
   변경은 앞선 세션들의 것이고 이 세션이 건드리지 않았다.
9. 게이트 통과 → 아래.

## 검증

- `npm run check` — typecheck + `vitest run` + `vite build` 전부 통과.
  테스트 20파일 **546건 통과, 실패 0**. (`DreamCard.test.tsx` 단독 100건 통과)
- `cargo test --manifest-path src-tauri/Cargo.toml` — **442건 통과, 실패 0, ignored 0.**
  (`cargo`가 PATH에 없어 `export PATH="$HOME/.cargo/bin:$PATH"`를 앞에 붙여 실행했다)

무변경은 파일·심볼 단위로 확인했다.

- `HeartbeatUpdateGuide.tsx` — 열어서 읽기만 했다. 문구 상수 여덟, `branchSteps`·`restartSteps`,
  `HeartbeatUpdateGuide` 본문이 착수 시점과 같다.
- `HeartbeatCard.tsx` — 이 세션이 만지지 않았다. 084 경고 안의 배선(`:1183`)도 그대로다.
- `types.ts`·`App.css`·`IntegrationsView.test.tsx`·`src-tauri/` — 이 세션이 열지 않았거나 읽기만 했다.

## QA 절차 제안

1. dream 잡이 잡 파일에 있고 하트비트가 아직 한 번도 실행하지 않은 프로젝트를 연다(또는
   `state.json`에서 dream 잡의 실행 기록을 지운다). 연동 탭에서 dream 카드를 펼친다.
2. "하트비트가 이 잡을 실행한 기록이 없습니다" 경고 안에 "하트비트를 갱신하는 방법"이 이어져 있는지
   본다. 다른 탭으로 보내지 않는다.
3. **같은 화면에서 하트비트(역할 잡) 카드도 펼쳐** 두 카드의 안내 문구가 눈으로 봐도 같은지 본다 —
   제목·원칙 문장·갈래 셋·재시작 둘.
4. 갈래 판별·pip·소스·라벨 확인·재시작 다섯 명령이 각각 원문과 `명령 복사` 버튼을 갖는지, 눌러서
   `복사됨`이 뜨고 실제로 붙여넣기가 되는지, 원문이 화면에 그대로 남는지 본다.
5. dream 잡을 껐다 켜고 저장·재설정 버튼이 그대로 눌리는지, 카드를 접었을 때 "확인할 경고가 있습니다"
   요약이 그대로인지 본다.
6. dream 잡이 한 번이라도 실행된 프로젝트에서는 이 안내가 아예 없는지 확인한다.

## 남은 것 / 리스크

- **안내의 문구·모양을 고칠 자리는 보이지 않았다.** 고쳐야 할 것이 있었으면 TASK-108 재작업으로
  넘겼을 자리인데, 두 카드가 같은 컴포넌트를 그대로 쓰는 것으로 R7이 닫힌다.
- **macOS 밖의 재시작 절차는 여전히 없다.** payload가 `null`을 실으면 화면이 "앱이 방법을 알지
  못한다"로 말한다. dream 카드에서 그 상태를 따로 세우지 않았다 — 컴포넌트가 같고
  `IntegrationsView.test.tsx`의 검사 6이 그 분기를 이미 고정한다. 필요하면 후속으로 dream 쪽
  시나리오를 더할 수 있다.
- **역할 외 발견 (핸드오프)**: `TASK-104`가 `in_progress`인 채로 lease가 만료돼 있다
  (`TASK-104.yml`, 만료 2026-08-04T19:37:05Z). 죽은 세션이 남긴 상태로 보이지만 개발자 계약의 자격은
  `todo`뿐이라 이 세션은 손대지 않았다. 그 작업을 이어받으려면 상태를 되돌리는 판단이 필요하고,
  그 판단은 이 역할의 몫이 아니다. TASK-106은 그 작업이 `qa_waiting`에 닿기 전까지 미충족으로 남는다.
