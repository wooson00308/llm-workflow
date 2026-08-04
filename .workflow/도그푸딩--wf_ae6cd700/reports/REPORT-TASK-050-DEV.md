# TASK-050 구현 보고 (developer)

> 기록 경위: 세션 하네스가 보고서 파일 작성을 차단해, 세션이 채팅으로 보낸 전문을 TL이 그대로 기록했다.

- 작업: 마법사의 각 단계 명령을 한 번의 조작으로 복사하게 한다
- 기획서/결정: SPEC-016 R6 / DECISION-4F1083FF (확인 필요 5번 — 클립보드 플러그인 의존성 추가 허용)
- 세션: dev-050, lease `lease-dev050-1785761209-70853` (반납 완료)
- 선행: TASK-049(`qa_waiting`)가 그린 `HeartbeatSetupWizard`에 붙였다. TASK-048의 `setupStages[].command`를 그대로 복사한다.

## 변경 파일

작업 문서가 정한 범위만 바꿨다. `types.ts`·`DreamCard.tsx`·`IntegrationCard.tsx`·`IntegrationsView.tsx`·`desktop.json`과 `src-tauri/src/` 아래의 다른 파일은 한 줄도 손대지 않았다.

- `package.json` / `package-lock.json` — `@tauri-apps/plugin-clipboard-manager` `^2.3.2` 추가.
- `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` — `tauri-plugin-clipboard-manager = "2"` 추가(해석된 버전 2.3.2, JS 쪽과 같은 버전).
- `src-tauri/src/lib.rs` — `.plugin(tauri_plugin_clipboard_manager::init())` 한 줄. 기존 넷(`process`·`updater`·`dialog`·`opener`) 뒤다.
- `src-tauri/capabilities/default.json` — `permissions`에 `clipboard-manager:allow-write-text` 한 항목.
- `src/features/projects/infrastructure/clipboard.ts` — 신설. `copy(text): Promise<boolean>` 하나만 내보낸다.
- `src/features/projects/components/integrations/HeartbeatCard.tsx` — `copy` import, `HeartbeatSetupWizard`에 복사 상태 하나와 `copyCommand()`, 단계마다 복사 버튼·결과 표시.
- `src/App.css` — `.heartbeat-setup-copy*` 규칙 7줄을 `.heartbeat-setup-mark.mark-unknown` 아래에 새 블록으로만 추가. 기존 규칙은 고치지 않았다.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 클립보드 모듈 `vi.mock`, 복사 시나리오 4건, 기존 R11 단정 보강.

## 핵심 결정과 근거

### 권한은 `default`가 아니라 `allow-write-text`를 명시했다

작업 문서는 "플러그인의 `default` 권한 집합이 읽기까지 포함하면 `default`를 쓰지 말라"고 했다. 설치한 2.3.2의 권한 목록을 실제로 읽어 보니 사정이 반대였다 — 이 플러그인의 `default`는 **빈 집합**이다(`permissions = []`). 플러그인 자신이 "클립보드는 본질적으로 위험할 수 있어 읽기·쓰기 중 무엇이 필요한지는 앱마다 다르므로 기본으로는 아무것도 켜지 않는다"고 적어 두었다. 즉 `default`를 써도 읽기가 새어 들어오지는 않지만, **쓰기도 안 켜져 복사가 동작하지 않는다.**

그래서 `clipboard-manager:allow-write-text`를 직접 적었다. 생성된 ACL(`src-tauri/gen/schemas/`)로 결과를 확인했다.

```
default 능력의 권한: core:default, opener:default, dialog:default, clipboard-manager:allow-write-text
allow-write-text -> {'allow': ['write_text'], 'deny': []}
```

허용된 클립보드 명령은 `write_text` 하나다. `read_text`·`read_image`는 물론 `write_html`·`write_image`·`clear`도 켜지 않았다. 완료 조건 4를 파일이 아니라 생성 결과에서 확인한 값이다.

### 복사 결과는 단계별 상태 하나로 들고, 전역 통로로 보내지 않는다

`{ step, ok } | null` 하나만 마법사가 들고 있다. 단계마다 상태를 두지 않은 것이 요구(잇달아 복사하면 마지막 것만 남는다)를 자료구조로 만든 것이다 — 두 단계에 동시에 "복사됨"이 떠 있을 수 있는 표현 자체가 없다.

`writeError`에 손대지 않았다. 그 통로는 관리 블록 쓰기 실패의 자리이고, 복사 실패는 명령 원문을 직접 선택하면 되는 편의의 실패다. 카드 상단 경고로 올리면 사용자는 파일이 안 써진 줄 안다.

### 버튼 이름이 실행으로 읽히지 않게 했다 (R11)

보이는 글자는 "명령 복사", 접근성 이름은 `<단계 이름> 명령 복사`다. 단계 이름은 화면이 이미 쓰던 `stepLabels[step] ?? stage.command` 규칙을 그대로 재사용해, 이름의 정의가 둘이 되지 않게 했다. 확인 대화상자를 끼우지 않아 한 번의 조작으로 끝난다.

### `navigator.clipboard`를 쓰지 않은 이유는 모듈 주석에 남겼다

작업 문서의 근거(Tauri 커스텀 스킴이 모든 플랫폼에서 보안 컨텍스트로 잡힌다는 보장이 없고, SPEC-015가 여는 Windows가 그 위험이 가장 큰 자리)를 `clipboard.ts` 주석에 적었다. 다음 사람이 "플러그인 대신 웹 API로 줄이자"고 되돌리지 않게 하는 자리다.

## 기존 테스트 수정 내역

고친 것은 TASK-049의 R11 테스트 하나뿐이고, 삭제·비활성화·약화한 테스트는 없다.

- 대상: `IntegrationsView.test.tsx`의 `offers no button of its own and keeps saying the app does not install for you`
- 이름을 `offers no button but the copy one and keeps saying the app does not install for you`로 바꿨다.
- 원래 단정: `expect(within(wizard).queryAllByRole("button")).toHaveLength(0)` — 마법사 안 버튼이 0개.
- 복사 버튼이 생겼으니 그대로 둘 수 없다. 개수 단정을 지우는 대신 **더 좁은 단정으로 바꿨다.**
  1. 마법사 안 모든 버튼의 `aria-label`이 정확히 `["패키지 설치 명령 복사", "heartbeat init 명령 복사", "heartbeat install-service 명령 복사", "dream 스킬 명령 복사"]`와 순서까지 일치한다. 목록에 없는 버튼이 하나라도 생기면 깨진다.
  2. 각 버튼의 보이는 글자가 정확히 `"명령 복사"`다.
  3. 각 버튼의 `aria-label`에 `"복사"`가 있고 `"실행"`이 없다.
- 즉 "실행 버튼이 없다"는 사실은 개수 0을 단정하던 때보다 촘촘하게 고정된다. 버튼이 없다는 것에서, 있는 버튼 전부가 복사 버튼이고 그 이름이 실행으로 읽히지 않는다는 것으로 넓어졌다.
- 같은 테스트의 나머지 단정(대행 안 함 문구, 자동 재확인 문구, 주기 숫자 없음, 저장소 링크, macOS/Windows/Linux 문자열 없음)은 손대지 않았다.

## 검증 — 게이트 최종 수치

전부 통과했다. 아래가 최종 코드 상태에서 실측한 값이다. (TL 실측 생략 — 이 수치가 기록 원본)

| 명령 | 결과 |
| --- | --- |
| `npm run check` (typecheck + vitest + build) | 테스트 파일 14개, **331 tests passed**, 0 failed. `tsc -b` 통과, `vite build` 성공(319 modules, `dist/assets/index-Cf_a0U7Y.js` 468.18 kB / gzip 141.23 kB, css 59.76 kB / gzip 12.40 kB) |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | exit 0, 출력 없음 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | exit 0, 경고 0건 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **352 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out** (5.46s). 나머지 두 타깃은 0 테스트 |
| `cargo build --manifest-path src-tauri/Cargo.toml` | exit 0 (작업 문서 검증 절차에 있어 함께 돌렸다) |

`IntegrationsView.test.tsx` 단독 실행은 **131 passed**(복사 4건 신규, 이전 127건 유지).

병렬 세션(dev-059·dev-060) 작업이 트리에 섞인 상태에서 돌린 수치다. cargo 게이트가 그 상태로도 통과했다.

플러그인을 부르는 자리가 하나인지 확인했다(완료 조건 3).

```
$ grep -rn "clipboard" src/ src-tauri/src/ src-tauri/capabilities/
src/features/projects/infrastructure/clipboard.ts:1:import { writeText } from "@tauri-apps/plugin-clipboard-manager";
src/features/projects/components/integrations/HeartbeatCard.tsx:26:import { copy } from "../../infrastructure/clipboard";
src-tauri/src/lib.rs:13:        .plugin(tauri_plugin_clipboard_manager::init())
src-tauri/capabilities/default.json:12:    "clipboard-manager:allow-write-text"
```

플러그인 import는 `clipboard.ts` 한 줄뿐이고 화면은 래퍼만 부른다.

### 새 테스트가 고정하는 것

`describe("명령 복사")` 4건. 클립보드 모듈을 `vi.mock`으로 대신했다(이 파일의 첫 `vi.mock`이다 — 다른 쓰기 액션은 `actions` prop으로 주입되지만 복사는 모듈 import라 주입할 자리가 없다).

- 2단계 복사 버튼을 누르면 `copy`에 `"heartbeat init"`이 그대로 넘어간다. 화면이 조각을 다시 조립하지 않는다는 확인(R6).
- 성공하면 그 단계 안에 "복사됨"이 보이고, 화면 전체에 그 표시는 하나뿐이다.
- 실패하면 실패 문구가 그 단계에 보이고, `<pre><code>` 원문은 그대로 남으며, 카드에 관리 블록 쓰기 실패 문구는 뜨지 않는다.
- 2단계를 복사한 뒤 4단계를 복사하면 표시가 4단계로 옮겨 가고 2단계에서는 사라진다.

## 리스크와 남는 것

- **의존성 무게가 생각보다 늘었다.** `tauri-plugin-clipboard-manager`가 `arboard`를 끌고 오고, 그것이 `image`·`x11rb`·`wayland-*`·`clipboard-win` 등을 딸려 와 `Cargo.lock`에 크레이트 **36개**가 새로 들어왔다(`Cargo.lock` diff +358줄). 우리가 쓰는 것은 `write_text` 하나다. 플러그인에 `[features]` 섹션이 아예 없어 이미지 지원만 떼어낼 방법이 없는 것을 2.3.2 소스에서 확인했다(`arboard`가 `wayland-data-control` 피처를 켠 채 무조건 의존). 결정이 의존성 추가를 허용했고 대안(웹 API)은 플랫폼 위험이 있어 그대로 진행했지만, 빌드 시간·번들 크기에 관심이 있다면 알고 있어야 할 비용이다.
- **자동화 테스트는 클립보드 모듈을 대신한 것까지만 본다.** 실제로 OS 클립보드에 들어가는지, 권한 설정이 런타임에 통하는지는 확인하지 못했다. 권한은 빌드 시점 ACL 생성까지만 확인한 상태다.
- **macOS에서만 확인했다.** Windows·Linux의 클립보드 경로는 이 세션에서 실행해 보지 못했다. SPEC-015가 Windows를 열면 그쪽에서 처음 밟는 경로다.
- **복사 표시는 사라지지 않는다.** 타이머를 두지 않아 다음 복사 전까지 남는다. 작업 문서가 둘 다 허용했고, 타이머는 테스트에 가짜 시계를 들여야 해서 남기는 쪽을 골랐다.
- 마법사가 접혔다 다시 펼쳐지면 이전 복사 표시가 남아 있을 수 있다. 컴포넌트가 언마운트되지 않기 때문인데, 그 표시가 가리키는 사실(그 명령이 마지막으로 복사됐다)은 여전히 참이라 손대지 않았다.

## 사용자 QA 제안

자동화가 대신할 수 없는 것만 적는다. 앱 창이 필요하다.

1. **붙여 넣기가 원문과 같은지.** 마법사의 각 단계에서 "명령 복사"를 누르고 터미널에 붙여 넣는다. 화면의 `<pre>`에 보이는 글자와 한 글자도 다르지 않아야 한다(기획서 완료 조건 5). 특히 4단계 `heartbeat install dream`처럼 공백이 있는 명령을 확인.
2. **어느 단계를 복사했는지 화면에서 구분되는지.** 2단계를 복사한 뒤 3단계를 복사했을 때, "복사됨" 표시가 3단계로 옮겨 가고 2단계에는 남지 않는지.
3. **복사 버튼이 실행으로 읽히지 않는지.** 버튼을 처음 보는 사람이 "앱이 이 명령을 실행하겠다"고 읽지 않는지. 읽힌다면 문구 문제이므로 되돌려 달라(R11).
4. **복사가 실패하는 상황을 만들 수 있다면**(권한 거부 등) 실패 문구가 그 단계 안에만 뜨고, 명령 원문을 마우스로 선택해 복사할 수 있는지.
5. 이 도그푸딩 머신은 데몬이 `com.catze.dream-heartbeat.plist`로 등록돼 있어 3단계가 확인 불가로 뜬다. 그 상태에서도 마법사가 보이고 복사 버튼이 정상 동작하는지 함께 봐 주면 좋다.
