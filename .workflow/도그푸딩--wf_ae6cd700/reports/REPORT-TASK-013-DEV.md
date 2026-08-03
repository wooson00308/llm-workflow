# TASK-013 개발자 핸드오프

- 대상 작업: TASK-013 (잡 model 필드를 지원 모델 선택 UI로 전환)
- 근거 문서: SPEC-004 R1~R5, DECISION-1D79E1AB (approved)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T07:42Z
- 상태: `qa_waiting`

## 대상 선정 근거

이 세션이 TASK-009가 아니라 TASK-013을 잡은 이유를 남긴다.

- TASK-009~TASK-012는 전부 TASK-008을 선행 필수로 건다. TASK-008은 `qa_waiting`이고 `decisions/`에
  `workflow-labs/qa-decision@1` 기록이 아직 없다. 개발자 계약의 "의존성 충족"을 사용자 QA 완료로 읽어
  대상에서 뺐다. TASK-008 보고서도 같은 기준을 적어 두었다.
- TASK-013은 선행 필수 작업이 없다고 문서에 명시돼 있다. 병행 금지 조건(SPEC-003 작업과 같은 화면 파일)
  은 lease 디렉터리가 비어 있고 TASK-009~012가 위 사유로 착수 불가라 자동으로 성립한다. 즉 지금 시점에
  적법하게 처리 가능한 작업은 TASK-013 하나다.
- 결과적으로 TASK-013 문서가 말한 "TASK-012보다 먼저 착수" 경로로 진행했다. 대상은 역할 잡 3종뿐이다.
  아래 "TASK-012 구현자에게" 항목이 그 경우 문서가 요구한 통지다.

## 결과

`model` 자유 입력을 선택 UI로 바꾸고, 목록 밖 값을 위한 직접 입력 경로를 남겼다. 프론트만 바뀌었고
`src-tauri/` 아래는 한 줄도 손대지 않았다.

## 지원 모델 집합 재확인 (작업 지시 1번)

착수 시점에 실제로 실행한 결과다.

```
$ claude --help | grep -A4 -- "--model"
  --model <model>   Model for the current session. Provide an alias for the
                    latest model (e.g. 'fable', 'opus', or 'sonnet') or a
                    model's full name (e.g. 'claude-fable-5').
```

- 도움말 본문이 예시로 든 별칭은 `fable`·`opus`·`sonnet` 세 개다. `haiku`는 예시에 없다.
- 설치 바이너리(`/opt/homebrew/bin/claude`) 문자열에는 `fable`·`opus`·`sonnet`·`haiku`가 모두 있다.
  기획서가 확인한 사실과 같다. 목록을 별칭 네 개로 유지했다.
- 같은 바이너리에 `opusplan`도 있으나 R2가 목록을 네 개로 고정했으므로 넣지 않았다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src/features/projects/components/ModelField.tsx` | 신규. 지원 모델 목록 + 선택·직접 입력 UI |
| `src/features/projects/components/SettingsView.tsx` | `model` 필드 렌더만 교체, 직접 입력 모드 상태 추가 |
| `src/features/projects/components/SettingsView.test.tsx` | 테스트 이관 1건, 신규 7건 |

`src-tauri/`, `src/App.css`, 그 외 프론트 파일은 변경하지 않았다.

## 설계 판단

- **목록 정의 지점은 `ModelField.tsx` 하나다.** 목록·직접 입력 sentinel·`isSupportedModel`이 한 파일에
  있고, `SettingsView.tsx`는 목록을 알지 못한 채 `isSupportedModel`만 호출한다. 잡이 늘어도 목록은
  갈라지지 않는다 (R2·R5).
- **직접 입력 여부는 `customModel` 별도 상태다.** 값에서 유도하지 않는다. 그리고 설치 요청은 그대로
  `roleOrder.map((role) => ({ role, ...form[role] }))`이므로 payload는 다섯 키 그대로다. 기존
  `toHaveBeenCalledWith` 단언이 손대지 않은 채 통과하는 것으로 확인된다.
- **직접 입력을 고르는 순간 값은 바뀌지 않는다.** 선택만으로 편집 중인 값이 사라지면 안 되기 때문이다.
  `opus` 상태에서 직접 입력을 고르면 칸에 `opus`가 그대로 있고, 거기서 고쳐 쓰는 흐름이 된다.
- **검증 오류는 직접 입력 칸에만 붙는다.** 선택 컨트롤은 목록 값만 내놓으므로 `/^\S+$/`를 어길 수 없다.
  `aria-invalid`·`aria-describedby`는 직접 입력 `<input>`에 달았고 메시지 문구는 기존 그대로다.
- **접근성 이름은 규약대로다.** 선택 컨트롤이 `개발자 모델`, 직접 입력 칸이 `개발자 모델 직접 입력`이다.
  `getByLabelText("개발자 모델")`은 여전히 선택 컨트롤 하나만 가리킨다(정확 일치).
- **경고 문구는 직접 입력 칸 바로 아래 있다.** 직접 입력을 고르기 전에는 보이지 않는다. 상시 노출은
  선택 경로 사용자에게 불필요한 경고다.
- **`roleJobDefaults`와 `fieldRules.model`은 그대로 뒀다.** 기본값 `opus`는 목록 안 값이라 선택 상태로 열린다.

## 테스트 목록 전후 (기획서 완료 조건 10)

지운 케이스도 `skip` 처리한 케이스도 없다. 이관 1건뿐이다.

| 전 | 후 |
| --- | --- |
| `it.each` 3행 중 `["개발자 모델", "claude opus", "공백 없는 한 줄 값이어야…"]` | 삭제 아님 — `reports %s in the direct input and writes nothing`의 `a value with a space` 행으로 이관 |
| `it.each` 나머지 2행(주기·실행 한도) | 그대로 |

이관 사유: 선택 컨트롤에는 목록 밖 문자열을 넣을 수 없으므로, 잘못된 `model` 값이 도달할 수 있는 경로가
직접 입력 칸으로 바뀌었다. 그 행이 덮던 것(잘못된 값 → 입력 위치에 사유 표시 + 확인 화면 안 열림 +
설치 함수 미호출)은 이관된 케이스가 같은 단언으로 그대로 덮는다. 이관 지점에 주석을 남겼다.

신규 7건 (`describe("SettingsView 모델 선택")`):

1. `offers the supported aliases as their own values plus a direct input path` — 선택지 5개의 표기와 값 대조
2. `carries a picked model into the install request without any typing` — 타이핑 없이 `sonnet` 저장, payload 5키 단언
3. `carries a directly entered model name into the install request unchanged` — `claude-opus-5`가 그대로 실림
4. `reports ... in the direct input and writes nothing` — 공백 포함 / 빈 값 2케이스
5. `opens a model value outside the list in the direct input and keeps it` — 파일 값 `claude-opus-5` 보존
6. `states the risk of a directly entered model name next to the input` — 경고 문구
7. `keeps the model field of each job independent` — 잡별 독립 동작

## 검증

전부 이 세션에서 실제로 실행한 결과다.

| 명령 | 결과 |
| --- | --- |
| `npm run check` | 통과 (typecheck · 50 tests / 10 files · build) |
| `npx vitest run SettingsView.test.tsx` | 24 passed (전 17 → 신규 8, 이관으로 `it.each` 1행 감소) |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 77 passed / 0 failed (TASK-008 시점과 동일) |
| `git diff --stat -- src-tauri` | 이 세션 기여분 없음. 나온 4개 파일은 TASK-008의 미커밋 변경분 그대로다 |
| `grep "invoke\|Command\|fetch" ModelField.tsx` | 결과 없음 (작업 지시 1번) |
| `shasum -a 256 ~/.claude/HEARTBEAT.md` | `96e15096…db88a7`. TASK-008 보고서 기록값과 동일, 세션 중 변화 없음 |

`cargo`가 PATH에 없어 `~/.cargo/bin/cargo`로 실행했다. 결과는 같다.

## 실행하지 않은 검증

작업 문서 검증 절차 중 아래 두 가지는 하지 않았다. 사용자 QA 몫으로 넘긴다.

- `~/.claude/HEARTBEAT.md`의 `model`을 손으로 목록 밖 값으로 바꾼 뒤 앱 화면을 확인하는 절차. 전역 파일을
  건드리는 조작이고 GUI 실행이 필요하다. 같은 내용을 단위 테스트 5번이 덮는다(파일 값이 목록 밖이면 직접
  입력 상태로 열리고 값이 그대로 보인다).
- 같은 값 재저장 멱등 확인. 쓰기 경로와 백엔드는 이번에 바뀌지 않았고 SPEC-002의 백엔드 테스트가 그대로
  통과한다.

## 사용자 QA 제안

1. 설정 화면 → 연동 → 각 역할 잡의 "모델"이 선택 컨트롤인지, 목록에 `opus`·`sonnet`·`haiku`·`fable`과
   `직접 입력`이 이 순서로 보이는지 확인한다.
2. 타이핑 없이 개발자 모델을 `sonnet`으로 바꿔 저장하고, `~/.claude/HEARTBEAT.md`의 해당 줄이
   `- model: sonnet`이 되는지 본다. 확인 후 `opus`로 되돌린다.
3. `직접 입력`을 고르고 `claude-opus-5`를 적어 저장한 뒤 파일에 그대로 기록되는지 본다. 옆에 검증 불가·
   매 주기 실패·쿼터 소모 경고가 보이는지도 함께 확인한다.
4. 직접 입력 칸을 비우거나 공백이 든 값을 넣고 저장을 눌러, 확인 화면이 열리지 않고 칸 아래에 사유가
   뜨는지 본다.
5. 파일을 백업한 뒤 관리 블록의 `- model: opus`를 손으로 `claude-opus-5`로 바꾸고, 앱 화면을 열어
   10초 이상 둔다. 해당 필드가 직접 입력 상태로 그 값을 보여야 하고, 아무것도 저장하지 않으면
   `md5 ~/.claude/HEARTBEAT.md`가 진입 전과 같아야 한다. 끝나면 백업을 되돌린다.

## TASK-012 구현자에게 (작업 문서가 요구한 통지)

TASK-013이 TASK-012보다 먼저 들어갔다. dream 잡 카드를 만들 때 `model` 필드를 `<input>`으로 새로 만들지
말고 `./ModelField`의 `ModelField`를 그대로 쓸 것. 목록과 직접 입력 규칙은 그 파일 하나에만 있어야 한다
(SPEC-004 R2·R5). 필요한 상태는 두 가지다.

- 값: 기존 폼 상태의 `model` 문자열. 설치 요청 payload에는 이 값만 들어간다.
- 직접 입력 여부: 폼과 분리된 별도 상태. 파일을 읽어 화면을 여는 시점에만 `isSupportedModel`로 정하고,
  그 뒤에는 값에서 다시 유도하지 않는다. `SettingsView.tsx`의 `customModelFrom`·`switchModelInput`이 예다.

이대로 하지 않으면 dream 잡의 `model`만 자유 입력으로 남아 R5가 깨진다. TASK-012 문서는 이 작업의
범위가 아니라 고치지 않았다.

## 범위 밖 발견 / 핸드오프 노트

- **선택 컨트롤에 전용 스타일이 없다.** `App.css`에 `.heartbeat-job-field select` 규칙이 없어
  (`select` 스타일은 `.development-toolbar select`뿐) 새 `<select>`는 브라우저 기본 모양으로 그려진다.
  같은 줄의 `<input>`들은 `.heartbeat-job-field input` 규칙을 받으므로 생김새가 어긋나 보일 수 있다.
  작업 문서의 범위가 프론트 3개 파일로 못 박혀 있고 검증 절차가 `git status`로 그것을 확인하게 해서
  `App.css`를 건드리지 않았다. 기능에는 영향이 없다. 별도 작업으로 다룰 항목이다.
- 직접 입력 경고 문구는 `.integration-note`를 재사용했다. 새 클래스를 만들면 CSS가 필요해서다.
- `.gitignore`에 `.workflow/.runtime/` 항목이 없고 `.serena/`가 추적되지 않은 채 남아 있다. 이전 보고서가
  이미 올린 항목이고 이번에도 손대지 않았다.
- 조건 스크립트 이중화와 `revision_requested` 미감지는 여전히 미해결이다.

## 상태

TASK-013은 `qa_waiting`. `.workflow/.runtime/leases/TASK-013.yml`은 반납했다.
