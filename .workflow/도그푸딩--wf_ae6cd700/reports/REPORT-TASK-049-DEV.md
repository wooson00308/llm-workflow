# TASK-049 구현 보고 (developer)

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.

- 작업: 하트비트 카드의 설치 안내를 단계별 마법사로 바꾼다
- 기획서/결정: SPEC-016 / DECISION-4F1083FF
- 세션: dev-049, lease `lease-task049-dev049-20260803T123516Z` (반납 완료)
- 선행: TASK-048(`qa_waiting`)이 실은 `setupStages` payload를 화면이 처음으로 읽는다.

## 변경 파일

작업 문서가 정한 셋만 바꿨다. 백엔드·`types.ts`·`IntegrationCard.tsx`·`IntegrationsView.tsx`·`DreamCard.tsx`·`useProjectWorkspace.ts`는 한 줄도 손대지 않았다.

- `src/features/projects/components/integrations/HeartbeatCard.tsx`
  - `stepLabels`·`stateLabels`·`stepNote()` 추가(`installationNote` 아래).
  - `HeartbeatSetupWizard` 컴포넌트 추가.
  - 미설치 분기 안에 있던 `.integration-guide` 안내 블록 제거, 마법사를 그 분기 밖으로 이동.
  - 기존 삼항(`not_installed ? 안내 : 폼`)을 `installation !== "not_installed" && 폼`으로 바꿔 역할 잡 폼 분기는 그대로 두고 마법사만 독립시켰다.
- `src/App.css` — `.heartbeat-setup*` 규칙 12줄을 `.heartbeat-confirm-actions`와 `.integration-warning` 사이에 **새 블록으로만** 추가. 기존 규칙은 하나도 고치지 않았다(`.integration-guide`·`.integration-note` 포함 — dream 카드가 같은 클래스를 쓴다).
- `src/features/projects/components/integrations/IntegrationsView.test.tsx`
  - `describe("IntegrationsView 하트비트 설치 마법사")` 9건 추가.
  - `HeartbeatSetupState`·`HeartbeatSetupStep` 타입 import 추가.
  - `setupStages()` 픽스처의 주석 한 줄 갱신("그리는 일은 아직 없고" → 마법사가 그린다). 기존 테스트는 하나도 지우거나 고치거나 약화하지 않았다.

## 핵심 결정과 근거

### 1. 단계 이름 두 개를 payload의 명령에서 가져온다

작업 문서 §2는 단계 이름을 `패키지 설치 / heartbeat init / heartbeat install-service / dream 스킬`로 정했고, 같은 문서의 검증 절차는 `grep "pip install\|install-service\|..."`가 **비어 있어야 한다**고 정했다. 두 조건을 문자 그대로 동시에 만족시킬 수 없다.

`stepLabels`를 `Record<step, string | null>`로 두고 2·3단계는 `null` → `stage.command`를 이름으로 쓰는 쪽을 택했다. 화면에 보이는 이름은 작업 문서가 적은 그대로이면서, 명령 문자열의 정의는 백엔드 하나로 남는다(R10). 도구가 하위 명령을 바꾸면 이름도 같이 바뀐다. grep은 비어 있다(확인함).

### 2. 마법사 머리 문구의 뒷부분을 고쳤다

기존: "앱이 하트비트를 대신 설치하지 않습니다. 아래 명령으로 직접 설치한 뒤 **다시 확인하세요**."
변경: "앱이 하트비트를 대신 설치하지 않습니다. 아래 단계는 사용자가 자기 터미널에서 직접 실행합니다."

R7이 "자동으로 다시 확인 중"을 화면에 밝히라고 요구하는데 같은 블록에 "다시 확인하세요"가 남으면 사용자가 뭔가 눌러야 한다고 읽는다. 두 문장이 정면으로 충돌한다. 작업 문서 §0이 유지하라고 지목한 것은 "앱이 하트비트를 대신 설치하지 않습니다…"(말줄임표까지가 인용)이고 기존 테스트가 고정하는 문자열도 앞 문장뿐이라 뒷부분만 R7에 맞췄다. 기존 테스트는 수정 없이 통과한다.

### 3. 상태 표식은 낱말로, 기호는 CSS `::before`로

`완료` / `남은 일` / `확인 불가` 세 낱말이 DOM에 텍스트로 있고 `✓` `→` `?` 기호는 `.mark-*::before`가 붙인다. 의미는 낱말이 지고 기호는 보강이라 접근성 트리에 기호가 섞이지 않고, 테스트가 `getByText("확인 불가")`로 바로 고를 수 있다. 색은 `남은 일`이 경고색(#87512f/#f8e9da), `확인 불가`가 중립색(#73786f/#f1f0ea)으로 갈라진다 — R4가 금지한 "같은 색"을 피했다.

### 4. 없는 조합에는 문구를 두지 않았다

`stepNote()`는 백엔드가 만들 수 있는 조합에만 문구를 준다. 1·3단계에 `not_done`이, 4단계에 `unknown`이 오지 않는다는 것은 `heartbeat_setup.rs`의 판정과 그 테스트(`the_package_step_follows_the_init_step_and_never_reports_not_done`, `the_service_step_never_reports_not_done`)에서 읽었다. `done`인 2·3·4단계는 표식과 판정 근거만 보이고 설명 문구가 없다 — 끝난 단계에 할 말이 없다.

### 5. 마법사 표시 조건에 `supported`와 `installation`을 넣지 않았다

`setupStages.some(s => s.required && s.state !== "done")` 하나로만 판정한다. dream은 `required`가 거짓이라 자연히 빠진다(R9). 미지원 플랫폼에서도 마법사는 보인다 — 안내는 쓰기 액션이 아니고 미지원 배너는 뷰가 따로 그린다.

## 검증

| 명령 | 결과 |
| --- | --- |
| `npm run check` | 통과 — typecheck, 14파일 327테스트 전부 통과, vite build 성공 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 통과 (exit 0) |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 통과 (경고 0) |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 통과 — 352 passed, 0 failed |
| `grep -n "pip install\|install-service\|LaunchAgents\|macOS\|Windows\|Linux" HeartbeatCard.tsx` | 비어 있음(exit 1) = 정상 |

`IntegrationsView.test.tsx` 단독은 127건 통과(기존 118 + 신규 9). 백엔드는 무변경이라 cargo 3종은 병렬 세션 수렴 확인 목적으로 마지막에 한 번 돌렸고 전부 초록이었다.

### 신규 테스트 9건이 고정하는 것

1. 미설치에서 네 단계가 고정 순서로 보이고, 1단계 확인 불가·2단계 남은 일·4단계만 "선택" 표기. 1단계 확인 불가 문구에 PATH 사유와 "넘어가도 됩니다"가 있다(기획서 확인 필요 1번의 절충 조건).
2. `installation: installed` + 3단계 확인 불가에서 마법사가 보이고, 판정 근거 경로가 그 단계 안에 있으며, **마법사와 역할 잡 폼이 함께 보인다**(R8이 겨냥한 화면).
3. 확인 불가가 미완료와 다른 수식 클래스·다른 문구를 갖고 `.mark-not_done`이 붙지 않는다.
4. 3단계 확인 불가 + `daemonRunning` 참/거짓 두 문구 (DECISION-4F1083FF의 "다른 이름으로 등록").
5. `evidence`가 없는 3단계에서 "확인할 방법이 없다" 문구가 나오고 명령은 그대로 안내된다.
6. 필수 3단계 완료 + dream 미완료에서 마법사가 접히고 그 뒤 화면이 지금과 같다.
7. `rerender`로 스냅샷만 갈아 끼우면 사용자 조작 없이 체크가 채워진다(완료 조건 6).
8. 마법사 안에 버튼 0개, 대행 안 함 문구 있음, 자동 재확인 문구 있음, "다시 확인하세요" 없음, 주기 숫자 없음, OS 이름 없음.

## 리스크와 핸드오프

- **기본 픽스처가 이제 마법사를 그린다.** `setupStages()`의 3단계가 `unknown`이라 `snapshot()`을 쓰는 기존 테스트 전부에서 마법사가 함께 렌더된다. 전부 통과하지만, 앞으로 이 파일에 카드 전체 `textContent`를 대조하는 테스트를 더할 때는 마법사 문구가 섞인다는 것을 알고 써야 한다.
- **TASK-050(명령 복사)의 자리.** 명령은 `<pre><code>{stage.command}</code></pre>`이고 단계 행은 `.heartbeat-setup-step`이다. 복사 버튼이 붙으면 신규 테스트 8번(`queryAllByRole("button")).toHaveLength(0)`)이 깨진다 — R11이 금지한 것은 **실행** 버튼이므로 그 테스트의 단정을 "실행 버튼이 없다"로 좁히는 것은 TASK-050의 정당한 수정이다. 지금 시점에는 마법사에 버튼이 하나도 없는 것이 맞아서 0으로 뒀다.
- **`DreamCard.tsx:29`의 `installCommand`가 `"heartbeat install dream"`을 화면 상수로 갖는다.** 마법사의 4단계 명령은 payload에서 온다. 같은 문자열의 정의가 둘이지만 R9대로 dream 카드는 이 작업에서 고치지 않았다. dream 카드 개편 때 payload 쪽으로 합치는 것을 검토할 자리다.
- **TASK-046과의 충돌 지점 없음.** 그 작업은 `runResultLabels.skipped`를 만지고 이 작업은 안내 블록만 바꿨다. 두 변경이 같은 줄에 닿지 않는다.
- 병렬 세션 관찰: dev-058이 `App.css`를 함께 만졌다. 내 규칙은 새 블록 추가 전용이고 편집 직전에 파일을 다시 읽어 최신 상태 위에 얹었다. 최종 게이트 4종이 전부 초록이라 이 시점의 트리는 수렴해 있다.
- 범위 밖 관찰(고치지 않음): `installationNote`의 미설치 문구가 "~/.claude/HEARTBEAT.md와 ~/.claude/heartbeat/를 찾지 못했습니다"로 경로를 화면 상수로 들고 있다. 마법사와 달리 payload에서 오지 않는다. 배지와 짝을 이루는 문장이라 작업 문서가 그대로 두라고 했고 그대로 뒀다.

## 사용자 QA 제안

앱을 띄우고 연동 화면의 `claude-heartbeat` 카드를 펼친 뒤 확인한다.

### 1. 이 기기(도그푸딩 머신)에서 3단계가 어떻게 보이는지 — 가장 중요한 동선

이 저장소의 머신은 `com.catze.dream-heartbeat.plist`로 등록해 데몬이 돌고 있다. 표준 아티팩트(`com.claude-heartbeat.plist`)가 없으므로 화면은 이렇게 나와야 한다.

- 배지: "설치됨 · 데몬 실행 중"
- 마법사가 **보인다** (3단계가 확인 불가라 접히지 않는다)
- 1단계 `패키지 설치` — 회색 "? 완료"가 아니라 초록 "✓ 완료". 문구는 "다음 단계가 끝나 있어 패키지도 있는 것으로 봅니다. 앱이 따로 확인한 값은 아닙니다."
- 2단계 `heartbeat init` — 초록 "✓ 완료", 판정 근거에 `~/.claude/HEARTBEAT.md` 실제 경로
- 3단계 `heartbeat install-service` — **회색 "? 확인 불가"**, 문구 전문:
  > 표준 등록물을 아래 경로에서 찾지 못했습니다. 그것만으로 등록되지 않았다고 단정하지 않습니다 — 데몬은 이미 돌고 있는 것으로 보이며, 다른 이름으로 등록했다면 이 단계는 끝난 것입니다.

  그 아래 `heartbeat install-service` 명령 원문, 그 아래 "판정 근거: /Users/catze/Library/LaunchAgents/com.claude-heartbeat.plist"
- 4단계 `dream 스킬` + "선택" 표기

**여기서 3단계가 주황 "→ 남은 일"로 보이면 DECISION-4F1083FF가 깨진 것이다.** 정상 설치를 영구히 미완료로 표시하지 말라는 것이 그 결정의 전부였다. 반대로 3단계가 "✓ 완료"로 보여도 잘못이다 — 앱은 그 라벨을 모른다.

읽고 나서 판단할 것: 저 문구를 처음 보는 사용자가 "아, 내 건 이미 끝난 거구나"로 읽는지, 아니면 "뭔가 덜 됐나?" 하고 불안해하는지. 데몬이 도는 사람에게 회색 물음표가 계속 남아 있는 것이 견딜 만한지가 이 화면의 핵심 절충이다.

### 2. 마법사와 역할 잡 폼이 같이 보이는지

1의 상태에서 마법사 아래에 역할 잡 폼(기획자/아키텍트/개발자 토글과 입력칸)이 그대로 있어야 한다. 마법사가 폼을 밀어내면 R8이 겨냥한 화면이 아니다. 예전에는 "설치됨"이면 안내가 통째로 사라지던 자리다.

### 3. 자동 재감지 — 사용자가 아무것도 안 눌러야 한다

터미널에서 `mv ~/.claude/HEARTBEAT.md ~/.claude/HEARTBEAT.md.bak`을 하고 **앱을 건드리지 않은 채** 몇 초 본다.
- 2단계가 "→ 남은 일"로 바뀌고 문구가 "아래 명령을 터미널에서 실행하세요."로 바뀐다
- 1단계가 "✓ 완료"에서 "? 확인 불가"로 함께 내려간다 (R5의 함의가 역방향으로도 도는지)
- 배지도 "미설치"로 바뀐다

되돌리면(`mv ~/.claude/HEARTBEAT.md.bak ~/.claude/HEARTBEAT.md`) 조작 없이 다시 채워져야 한다. 이 두 번의 전환에서 사용자가 누를 것이 하나도 없다는 것이 R7의 요점이고, "다시 확인" 버튼을 안 만든 근거다. 몇 초 기다려도 안 바뀌면 그 판단이 틀린 것이니 보고해 달라.

### 4. 접힘

표준 라벨로 `heartbeat install-service`를 한 설치가 있는 기기라면 마법사가 통째로 사라지고 화면이 이전과 같아야 한다. dream 미설치는 접힘을 막지 않는다(4단계가 "→ 남은 일"이어도 마법사는 없다).

### 5. 두 회색이 눈으로 갈리는지

"→ 남은 일"(주황 배경)과 "? 확인 불가"(회색 배경)가 한 화면에 같이 있을 때 구분되는지. 확인 불가가 "안 한 일"처럼 읽히면 색이나 낱말을 다시 봐야 한다. 1의 상태에서는 3단계 회색 하나뿐이라, 2·3단계를 동시에 보려면 3번 동선(HEARTBEAT.md 잠깐 치우기)에서 함께 확인하면 된다.

### 6. 대행 인상

체크리스트가 되면서 "앱이 눌러 주는 건가?" 하는 인상이 드는지. 마법사 안에 버튼이 하나도 없고 머리에 "앱이 하트비트를 대신 설치하지 않습니다. 아래 단계는 사용자가 자기 터미널에서 직접 실행합니다."가 있는 것으로 충분한지가 판단이 필요한 자리다. 부족하면 문구를 단계마다 반복할지 검토해야 한다.
