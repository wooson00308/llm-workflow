# TASK-011 개발자 핸드오프

- 대상 작업: TASK-011 (dream 연동 카드 추가와 정제 상태 읽기 전용 표시)
- 근거 문서: SPEC-003 R2·R3·R6, DECISION-5276FDBF (approved)
- 세션 역할: 개발자
- 작성 시각: 2026-08-02T09:52Z
- 상태: `qa_waiting`

## 결과

연동 스냅샷에 dream payload를 얹고, 내장 연동 목록에 dream 카드를 추가했다. 카드는 읽기 전용이다. 설치 상태 세 가지, 정제 상태, 설치될 잡의 조건 명령 원문, 중복 dream 잡 경고를 보여준다.

TASK-010이 만든 섹션·카드 골격·배지·경고 컴포넌트는 한 줄도 바뀌지 않았다. dream 카드는 골격만 공유하고 하트비트 전용 타입·컴포넌트를 쓰지 않는다.

쓰기 경로(`install_heartbeat_jobs`, dream 잡 설치)는 손대지 않았다. dream 잡 설치·토글·편집은 TASK-012 몫이다.

## 변경한 파일

| 파일 | 내용 |
| --- | --- |
| `src-tauri/src/application/heartbeat_service.rs` | `DreamIntegration` payload와 `dream_integration()` 추가. 스냅샷에 `dream` 필드. 중복 잡 분배를 `duplicates_of()` 하나로. 신규 테스트 4개 |
| `src/features/projects/domain/types.ts` | `DreamRefinement`·`DreamIntegration` 추가, `IntegrationsSnapshot`에 `dream` |
| `src/features/projects/components/integrations/DreamCard.tsx` | 신규. dream 카드 본문 |
| `src/features/projects/components/integrations/registry.ts` | 내장 연동 목록에 `dream` 항목 추가 (두 번째) |
| `src/features/projects/components/integrations/DreamCard.test.tsx` | 신규. dream 카드 전용 테스트 9개 |
| `src/features/projects/components/SettingsView.test.tsx` | 스냅샷 픽스처에 dream 추가, 카드 수 단언 1 → 2 |

### 범위 밖이지만 바꾼 파일

`src/features/projects/application/useProjectWorkspace.test.ts` 하나다. 파일 상단의 `IntegrationsSnapshot` 픽스처에 `dream` 필드를 더한 것이 전부이고, 시나리오와 단언은 그대로다. `dream`이 필수 필드라 이 픽스처를 고치지 않으면 `npm run typecheck`가 통과하지 않는다(완료 조건 9).

`src-tauri/src/domain/project.rs`는 범위에 있었지만 손대지 않았다. TASK-009가 만든 `DreamStatus`·`DreamRefinement`를 그대로 쓰면 충분했다.

## 설계 판단

- **dream payload는 `DreamStatus`를 펼쳐 담고, 화면이 쓸 두 문자열을 더한다.** `installation`·`heartbeat`·`refinement`는 TASK-009의 판정 결과 그대로이고, `skillPath`와 `conditionCommand`가 추가분이다. 하트비트 payload가 `HeartbeatStatus`를 펼쳐 담는 방식과 같다.
- **조건 명령은 실제로 설치될 잡에서 꺼낸다.** `heartbeat_dream::dream_job(slug).condition`이다. 화면용 문자열을 따로 만들면 잡 정의가 바뀔 때 화면이 조용히 거짓말을 한다. 프론트는 이 값을 그대로 출력하고 조립하지 않는다.
- **판정 경로도 백엔드가 만든다.** `skill_path(heartbeat_home)`의 절대 경로를 그대로 내려보낸다. 하트비트 카드가 `~/.claude/HEARTBEAT.md`를 프론트 상수로 두는 것과 다른데, dream은 "이 경로에 없으면 미설치로 본다"가 판정 근거 자체라서 실제로 확인한 경로를 보여주는 편이 사용자가 `ls`로 대조하기 쉽다. TASK-009가 `skill_path`를 `pub`으로 열어 둔 이유이기도 하다.
- **하트비트 설치 여부는 하트비트 연동의 판정을 넘겨받는다.** `inspect`가 `split_installation`으로 얻은 공통 값을 `dream_integration`에 넘긴다. 두 연동이 각자 `HEARTBEAT.md`를 확인하면 같은 경로가 `readFailures`에 두 번 들어간다(TASK-009의 "TASK-010 주의 1").
- **읽기 실패 목록은 dream payload가 자기 것만 담는다.** `read_dream_status`에 새 `Vec`을 넘겨 하트비트 홈을 읽다 난 실패와 섞이지 않게 했다. `~/.claude/projects/<slug>` 아래를 읽다 난 실패는 dream 카드에만 뜬다.
- **중복 잡 분배는 `duplicates_of()` 하나로 합쳤다.** 하트비트 payload가 쓰던 인라인 필터를 이 함수로 바꾸고 dream도 같은 함수를 쓴다. 판정 기준은 그대로(연동 이름 일치)이고 동작 변화는 없다.
- **배지는 두 값을 접지 않고 세 문구로 나눈다.** `하트비트 필요` / `미설치` / `설치됨`이다. "하트비트가 없어서 못 쓴다"와 "dream만 없다"는 사용자가 해야 할 일이 다르다. 색은 기존 CSS 클래스만 쓴다(`status-not_installed` 회색, 나머지는 `.integration-status` 기본 초록). `App.css`는 범위 밖이라 손대지 않았다.
- **설치 안내와 정제 상태는 배타적으로 보여준다.** R2의 "미설치일 때는 설치 안내만 보여준다"를 따라, 조건 명령 원문·정제 상태·slug는 "둘 다 설치됨" 상태에서만 나온다. 하트비트 미설치 상태에서는 `heartbeat install dream`을 먼저 권하지 않고 하트비트 카드를 가리킨다. 순서가 뒤바뀐 안내를 하지 않기 위해서다.
- **"정제 기록 없음"과 "트랜스크립트 없음"은 `settings-details` 본문에 그냥 값으로 쓴다.** 경고 상자(`integration-warning`)나 경고색을 쓰지 않는다. 기획서가 오류가 아니라고 못박은 상태다. 테스트가 이 카드에 경고 상자가 없다는 것까지 단언한다.
- **`skipped`는 이 작업에서 화면에 나오지 않는다.** dream 잡의 실행 기록 표시는 TASK-012 범위다(잡 설치 UI와 함께 나온다). 이 카드는 아직 잡을 모른다.
- **새 감시 장치를 만들지 않았다.** dream 값은 기존 스냅샷 조회에 얹혀 2.5초 주기를 그대로 따른다. 커맨드·게이트웨이 메서드·훅 상태는 하나도 늘지 않았다. TASK-010이 R1의 판단 기준으로 삼은 지점이 실제로 그렇게 동작하는지 확인한 셈이다.

## 검증

```
npm run check → 통과 (typecheck / vitest 66 passed / vite build)
cargo test --manifest-path src-tauri/Cargo.toml → 95 passed; 0 failed
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets → 경고 없음
cargo fmt --check → 차이 없음
```

기존 테스트는 삭제·비활성화하지 않았다. `SettingsView.test.tsx`에서 바뀐 단언은 카드 수 1 → 2 하나뿐이고, 이는 이 작업이 만드는 변화 그 자체다. (완료 조건 1)

TASK-010 경계 확인:

```
find src src-tauri/src -type f -newer .workflow/.runtime/leases/TASK-011.yml
→ heartbeat_service.rs, types.ts, DreamCard.tsx, DreamCard.test.tsx,
  registry.ts, SettingsView.test.tsx, useProjectWorkspace.test.ts
```

`IntegrationSection.tsx`·`IntegrationCard.tsx`는 이 세션에서 열지 않았다. `registry.ts`에 항목 하나와 본문 컴포넌트 하나만 더해 끝났다. TASK-010이 "이걸 고쳐야 하면 경계가 잘못된 것"이라고 한 조건에 걸리지 않았다. (완료 조건 3)

`DreamCard.tsx`가 import 하는 것은 `IntegrationCard`(공통 골격)와 `domain/types`의 dream 타입뿐이다. `HeartbeatCard.tsx`를 참조하지 않는다. (완료 조건 3)

전역 파일 무변경:

```
shasum ~/.claude/HEARTBEAT.md
→ d012cd3a9bf2e0999b0eb565f5d437e49fdad5d6 (TASK-010 보고서의 값과 동일)
grep -c "wf-dream" ~/.claude/HEARTBEAT.md → 0
find ~/.claude/projects/-Users-catze-project-workflow-labs -newermt "-15 minutes" → 없음
```

`dream_integration`이 호출하는 것은 `read_dream_status`(읽기 전용, TASK-009가 검증), `skill_path`(경로 계산), `dream_job`(구조체 생성)뿐이다. 쓰기 호출은 없다. (완료 조건 8)

### 신규 테스트

백엔드 (`heartbeat_service.rs`)

| 테스트 | 덮는 것 |
| --- | --- |
| `the_dream_payload_carries_the_two_checks_behind_the_three_states` | 빈 홈 / 하트비트만 / 둘 다에서 `(heartbeat, installation)` 조합이 다르게 나온다 (R2) |
| `the_dream_payload_carries_the_condition_command_and_the_skill_path` | 조건 원문과 판정 경로가 payload에 실린다 |
| `the_dream_payload_carries_the_refinement_counts` | 전체 3 · 마킹 1 · 미정제 2 · `last_dream` · topic 1이 파일에서 그대로 온다 (R3) |
| `only_the_duplicates_of_this_integration_reach_the_dream_payload` | 하트비트 중복과 dream 중복이 함께 있는 문서에서 dream payload에 dream 것만 남는다 (R6) |

프론트 (`DreamCard.test.tsx`)

| 테스트 | 덮는 것 |
| --- | --- |
| `tells the three install states apart` | 세 상태의 카드 내용이 서로 다르다 |
| `shows the install command and the repository while the skill is missing` | `heartbeat install dream`과 저장소 주소 |
| `states the path behind the install decision and its limit` | 판정 경로와 `--slug` 한계 문구 |
| `shows the condition command as the backend built it, with the reason` | 조건 원문·PATH 한계·slug |
| `hides the refinement status and the condition command until both are installed` | 미설치 상태에서는 설치 안내만 |
| `shows the counts and the last refinement from the payload` | 전체·미정제·마지막 정제·topic 수 |
| `treats a missing refinement record as a normal state` | "정제 기록 없음", 미정제 = 전체, 경고 상자 없음 |
| `treats a missing project directory as a normal state` | "트랜스크립트 없음", 경고 상자 없음 |
| `says the unrefined count is a marking based one` | 마킹 기준 설명 문구 (완료 조건 5) |
| `warns about a duplicate dream job with its concrete risk` | 중복 경고가 dream 카드 안에 뜬다 (완료 조건 6) |

프론트 (`SettingsView.test.tsx`)

- `draws one card per built-in integration` — 카드가 둘이고 이름이 `claude-heartbeat`, `dream`이다.

### 이 세션에서 확인하지 못한 것

- **설정 화면 육안 확인.** GUI 앱을 띄워 클릭하는 절차라 이 세션에서 하지 못했다. TASK-010과 같은 한계다. 자동화로 덮은 범위는 위 테스트까지다.
- **하트비트 미설치 상태의 화면 재현.** 이 환경에는 하트비트가 설치돼 있어 실제로 만들 수 없다. 단위 테스트 픽스처로만 확인했다(작업 지시가 허용한 방식).
- **dream 미설치 상태의 화면 재현.** 실제 홈의 `~/.claude/skills/dream/SKILL.md`를 잠시 옮겼다 되돌리는 절차인데, 화면 확인을 할 수 없는 세션에서 실제 홈을 건드릴 이유가 없어 하지 않았다. 파일은 그대로다.

## QA에서 봐 주면 좋은 것

이 환경의 현재 상태는 아래와 같고(전부 읽기로 확인), 화면 값이 이와 같아야 한다.

| 항목 | 파일에서 확인한 값 | 화면에 나와야 하는 것 |
| --- | --- | --- |
| dream 스킬 | `~/.claude/skills/dream/SKILL.md` 있음 | 배지 `설치됨` |
| 전체 트랜스크립트 | `*.jsonl` 24개 | `24개` |
| `dream_meta.md` | 없음 | `정제 기록 없음`, 미정제 `24개` |
| `memory/` | 비어 있음 | 메모리 topic `0개` |
| 조건 명령 | — | `dream-prep check-unprocessed --slug=-Users-catze-project-workflow-labs` |

1. 설정 화면에 연동 카드가 둘이고, dream 카드가 위 표대로 보이는지. 트랜스크립트 수는 이 세션 이후에도 늘어나므로 확인 시점의 `ls ~/.claude/projects/-Users-catze-project-workflow-labs/*.jsonl | wc -l`과 대조한다.
2. 하트비트 카드의 문구·배지·역할 잡 UI가 이 변경 전과 같은지. dream 카드가 아래에 얹혔을 뿐이어야 한다.
3. 설치 액션 없이 화면을 열고 새로고침을 여러 번 거친 뒤 `shasum ~/.claude/HEARTBEAT.md`가 `d012cd3a…` 그대로인지.
4. dream 미설치 상태를 보고 싶으면 `~/.claude/skills/dream/SKILL.md`를 잠시 옮겼다가 되돌린다. `heartbeat install dream`과 저장소 주소가 나와야 한다.

## 후속 / 리스크

- **`heartbeat_dream.rs`의 `#![allow(dead_code)]`가 남아 있다.** 파일 안 주석은 "커맨드 계층(TASK-012)이 호출하면 지운다"고 적혀 있는데, 이 작업으로 `read_dream_status`·`skill_path`·`dream_job`이 이미 호출된다. 그 파일은 이 작업의 범위 밖이라 손대지 않았다. TASK-012가 지우면 된다. `heartbeat_status.rs`도 같은 상태다.
- **`writeError`가 아직 섹션 단위다.** dream 카드는 지금 이 값을 쓰지 않아 증상이 없지만, TASK-012가 dream 쓰기 경로를 만들면 두 카드가 같은 실패 문구를 받는다. TASK-010이 남긴 후속 그대로다.
- **TASK-012 주의 1**: dream 카드 본문의 "둘 다 설치됨" 분기 안에 잡 UI를 넣으면 된다. 조건 원문·slug 표시는 그 자리에 이미 있다.
- **TASK-012 주의 2**: `conditionCommand`는 `dream_job(slug).condition`에서 온다. 설치 커맨드가 같은 함수로 잡을 만들면 화면에 보인 명령과 파일에 쓰이는 명령이 자동으로 일치한다. 다른 경로로 만들면 이 보장이 깨진다.
- **`useProjectWorkspace.test.ts` 픽스처가 손으로 관리된다.** 연동이 셋이 되면 이 파일도 또 고쳐야 한다. 지금은 두 곳(이 파일과 `SettingsView.test.tsx`)뿐이라 그대로 뒀다.
- **선행 작업 TASK-008·009·010이 모두 `qa_waiting`이다.** 이 작업은 그 코드 위에 섰다. 셋 중 하나라도 QA에서 수정 요청으로 돌아오면 이 작업도 함께 다시 봐야 한다. TASK-008부터 이어서 QA 하는 편이 안전하다.
- 세션 기록은 `docs/development-logs/`에 남기지 않았다. 워크플로우 작업의 세션 기록은 `reports/`에 남기는 것이 이 저장소의 규약이고, 작업 범위도 그 밖의 파일을 금지한다.
