---
schema: workflow-labs/task@1
id: TASK-050
title: 마법사의 각 단계 명령을 한 번의 조작으로 복사하게 한다
status: completed
source_spec_id: SPEC-016
source_decision_id: DECISION-4F1083FF
depends_on: [TASK-049]
updated_at: 2026-08-04T11:43:27.726102+00:00
history:
  - { at: 2026-08-03T07:45:00Z, kind: created }
  - { at: 2026-08-03T12:46:49Z, kind: in_progress }
  - { at: 2026-08-03T12:54:52Z, kind: qa_waiting }
  - { at: 2026-08-04T11:43:27.726102+00:00, kind: completed }
---

# 마법사의 각 단계 명령을 한 번의 조작으로 복사하게 한다

SPEC-016 R6을 구현한다. TASK-049가 그린 각 단계의 명령 원문에 복사 수단을 붙이고, 복사됐다는 사실과
실패했다는 사실을 사용자에게 보인다.

기획서 확인 필요 5번이 복사 수단을 아키텍트에게 맡겼고, DECISION-4F1083FF가 클립보드 플러그인
의존성 추가에 반대하지 않는다고 답했다. **Tauri 클립보드 플러그인을 쓴다.** 웹 표준
`navigator.clipboard`는 보안 컨텍스트를 요구하는데, Tauri가 앱을 띄우는 커스텀 스킴이 모든 플랫폼에서
보안 컨텍스트로 잡힌다는 보장이 없다. 하필 SPEC-015가 열어 주는 Windows가 그 위험이 가장 큰 자리라,
"복사 버튼이 그 플랫폼에서만 조용히 안 되는" 결과를 피한다.

## 의존성

- **선행 필수: TASK-049.** 복사 버튼이 붙을 자리가 그 작업에서 생긴다. 마법사 없이 이 작업만
  들어가면 붙일 곳이 없다.
- **TASK-046과 병행 금지.** 둘 다 `HeartbeatCard.tsx`와 `IntegrationsView.test.tsx`를 만진다.
- **TASK-030·TASK-033·TASK-034·TASK-036·TASK-038과 병행 금지.** `src/App.css`가 겹친다.
- 백엔드 소스(`src-tauri/src/**`)를 만지지 않는다. `lib.rs`의 플러그인 등록 한 줄과 매니페스트·
  권한 파일만 바뀌므로 SPEC-013·SPEC-015 계열 백엔드 작업과 겹치는 코드가 없다.

## 범위

- `package.json` — `@tauri-apps/plugin-clipboard-manager` 추가.
- `package-lock.json` — 위 설치 결과.
- `src-tauri/Cargo.toml` — `tauri-plugin-clipboard-manager` 추가.
- `src-tauri/Cargo.lock` — 위 설치 결과.
- `src-tauri/src/lib.rs` — 플러그인 등록 한 줄.
- `src-tauri/capabilities/default.json` — 쓰기 권한 한 항목.
- `src/features/projects/infrastructure/clipboard.ts` — 신설. 플러그인 호출을 감싼 얇은 모듈.
- `src/features/projects/components/integrations/HeartbeatCard.tsx` — 복사 버튼과 결과 표시.
- `src/App.css` — 복사 버튼·결과 표시 스타일.
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 복사 성공·실패 테스트.
- 그 외 파일은 건드리지 않는다. 특히 `types.ts`·`DreamCard.tsx`·`IntegrationCard.tsx`·
  `IntegrationsView.tsx`·`src-tauri/src/` 아래의 다른 파일은 이 작업에서 바뀌지 않는다.

## 작업 내용

### 0. 먼저 읽을 제약

- **앱은 클립보드를 읽지 않는다.** 쓰기만 필요하다. 권한도 쓰기만 켠다.
- **복사에 실패해도 명령 원문은 화면에 남고 선택할 수 있어야 한다**(R6). 복사는 편의이고, 그것이
  안 되는 환경에서도 마법사는 제 일을 해야 한다.
- **실행 버튼을 만들지 않는다**(R11). 단계의 조작은 명령 복사까지다. 복사 버튼이 실행처럼 읽히지
  않는 이름이어야 한다.
- **복사 결과를 전역 오류 통로로 보내지 않는다.** `writeError`는 관리 블록 쓰기 실패의 자리다.
  복사 실패는 그 단계 안에서만 알린다.

### 1. 의존성과 권한

- npm과 cargo 양쪽에 클립보드 플러그인을 더하고 `lib.rs`의 빌더 체인에 등록한다. 등록 순서는
  기존 네 플러그인(`process`·`updater`·`dialog`·`opener`) 뒤다.
- `capabilities/default.json`의 `permissions`에 **쓰기만 허용하는 항목**을 더한다. 플러그인의
  `default` 권한 집합이 읽기까지 포함하면 `default`를 쓰지 않고 쓰기 항목만 명시한다. 설치한 버전의
  권한 목록을 실제로 확인하고 고른다. 추측으로 적지 않는다.
- `desktop.json`은 만지지 않는다. 복사는 데스크톱 플랫폼별 기능이 아니다.

### 2. 클립보드 모듈

`src/features/projects/infrastructure/clipboard.ts`를 만든다. `jobValueMemoryStore`와 같은 결이다 —
브라우저·런타임 API를 화면 대신 만지는 얇은 모듈이고, 실패를 값으로 돌려준다.

- `copy(text: string): Promise<boolean>` 하나만 내보낸다. 성공이면 참, 실패면 거짓이다.
- 예외를 밖으로 던지지 않는다. 클립보드가 없는 환경(테스트, 권한 거부)에서 화면이 깨지면 안 된다.
- 이 모듈이 유일하게 플러그인을 import 하는 자리다. 화면은 플러그인을 직접 부르지 않는다.

### 3. 복사 버튼

각 단계의 명령 옆에 버튼 하나를 둔다.

- 한 번의 조작으로 끝난다(R6). 확인 대화상자를 끼우지 않는다.
- 복사됐다는 사실이 그 단계 안에 보인다. 잠깐 뒤 사라지는 표시여도 되고 남아 있어도 되지만,
  **어느 단계의 명령이 복사됐는지 알 수 있어야 한다.** 표시 상태는 단계별로 따로 갖는다.
- 실패하면 실패했다는 사실과, 아래 명령을 직접 선택해 복사하라는 안내를 보인다.
- 명령 원문의 `<pre><code>`는 그대로 남는다. 버튼이 원문을 대체하지 않는다.
- 여러 단계를 잇달아 복사하면 마지막에 복사한 단계에만 표시가 남는다. 두 단계에 동시에 "복사됨"이
  떠 있으면 사용자는 무엇이 클립보드에 있는지 알 수 없다.

### 4. 테스트

`IntegrationsView.test.tsx`에서 클립보드 모듈을 `vi.mock`으로 대신한다. 실제 플러그인을 부르지
않는다.

- 단계의 복사 버튼을 누르면 그 단계의 명령 원문이 그대로 복사 함수에 넘어간다. 화면이 조각을 다시
  조립하지 않는다는 확인이다(R6).
- 복사에 성공하면 그 단계에 복사됐다는 표시가 보인다.
- 복사에 실패하면 실패 표시가 보이고, 명령 원문은 여전히 화면에 있다. (R6)
- 두 단계를 잇달아 복사하면 표시가 하나만 남는다.
- 마법사에 실행 버튼이 없다는 기존 단정(TASK-049)이 복사 버튼 추가 뒤에도 성립한다. 그 테스트가
  버튼 개수로 단정하고 있으면 복사 버튼을 세는 형태로 고치되, 확인하던 사실(실행 버튼이 없다)이
  줄지 않게 한다.

## 완료 조건

1. 각 단계의 명령을 한 번의 조작으로 복사할 수 있고, 복사 결과가 그 단계 안에서 사용자에게 보인다.
   (기획서 완료 조건 5, R6)
2. 복사에 실패하면 실패가 사용자에게 보이고, 명령 원문은 화면에 남아 선택할 수 있다. (R6)
3. 클립보드 호출이 `clipboard.ts` 한 곳에만 있고 화면은 플러그인을 직접 부르지 않는다.
4. 권한 설정에 클립보드 **쓰기**만 켜져 있고 읽기 권한이 들어가지 않았다.
5. 마법사에 실행 버튼이 없다. 복사 버튼은 실행이 아니다. (R11)
6. 기존 프런트엔드 테스트가 삭제·비활성화 없이 통과한다.
7. `npm run check`와 `cargo test`가 통과하고, 앱이 빌드된다.

## 검증 절차

```sh
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```

플러그인을 부르는 자리가 하나인지 확인한다.

```sh
grep -rn "clipboard" src/ src-tauri/src/ src-tauri/capabilities/
```

## 사용자 QA 항목

자동화 테스트는 클립보드 모듈을 대신한 것까지만 확인한다. 아래는 실제 앱 창이 필요하므로 개발자
세션이 테스트 통과로 대신 닫지 않는다.

- 실행 중인 앱에서 각 단계의 복사 버튼을 누르고, 터미널에 붙여 넣어 명령 원문이 그대로 들어오는지.
  (기획서 완료 조건 5)
- 복사 표시가 어느 단계의 것인지 화면에서 구분되는지.

## 범위 밖

- 마법사의 단계 표시·표시 조건·문구. TASK-049다.
- 단계 판정과 payload. TASK-048이다.
- dream 카드와 다른 화면의 명령 블록에 복사 버튼을 다는 것. 이 기획서의 범위는 마법사다.
- 클립보드 읽기. 앱이 클립보드를 읽을 이유가 없다.
- 명령을 앱이 실행하는 것. 아이디어와 기획서가 원칙으로 못박았다.

## 참고 사실

확인 시점 2026-08-03. 추정 없이 파일에서 읽은 값이다.

- 클립보드 플러그인은 지금 의존성에 없다. `package.json`의 Tauri 의존성은 `@tauri-apps/api`,
  `plugin-dialog`, `plugin-opener`, `plugin-process`, `plugin-updater` 다섯이고 `src-tauri/Cargo.toml`도
  같은 짝이다.
- `lib.rs:9`~`:12`가 플러그인 넷을 등록한다.
- `capabilities/default.json`의 `permissions`는 `core:default`·`opener:default`·`dialog:default`
  셋이고, `desktop.json`이 `updater:default`·`process:default`를 플랫폼 셋에 건다.
- 화면이 인프라 모듈을 직접 import 하는 선례가 있다. `HeartbeatCard.tsx:21`이
  `browserJobValueMemoryStore`를 그렇게 쓴다. 그 모듈은 실패를 전부 값으로 삼키고 예외를 던지지
  않는다.
- `IntegrationsView.test.tsx`는 지금 Tauri 모듈을 mock 하지 않는다. 쓰기 액션이 `actions` prop으로
  주입되기 때문이다. 클립보드는 prop이 아니라 모듈 import이므로 이 테스트 파일에 첫 `vi.mock`이
  생긴다.
- 카드 골격의 props(`IntegrationCardProps`)는 연동 공통이다. 복사 수단을 prop으로 넣으면 골격
  파일을 고쳐야 하므로 넣지 않는다.
