# TASK-108 개발자 핸드오프

- 대상: TASK-108 (084 경고 자리에서 갱신 절차를 읽고 복사한다 — 공용 안내와 역할 잡 카드)
- 근거: SPEC-034 R1~R6·R8, 완료 조건 1~9·11~15,
  DECISION-3ECEDCA1 (`schema: workflow-labs/decision@1`, `spec_id: SPEC-034`, `outcome: approved`,
  `created_by: user`, 2026-08-04T16:56:16Z — 직접 확인. SPEC-034의 결정 문서는 이 1건뿐이라 더 늦은
  결정이 없다. 본문이 비어 있고 기획서 "확인 필요" 머리글이 "승인 시 아래 제안대로 진행한다"이므로
  네 항목 모두 제안대로다)
- 역할: 개발자 (developer-claude)
- 선점: `acquire TASK-108 developer-claude 40` exit 0 → `lease-59958-20260804200017` →
  `in_progress`(2026-08-04T20:00:30Z) → 구현 → 검증 → `qa_waiting`. 중간에 renew exit 0 1회.

## 선행 확인

`depends_on: [TASK-107]`. TASK-107은 `qa_waiting`이라 충족이다.

- 착수 시점 `todo`는 TASK-106·108·109 3건. 106은 `depends_on: [TASK-104]`이고 TASK-104가
  `in_progress`라 미충족, 109는 `[TASK-108]`이라 미충족. 선행이 충족된 `todo`는 TASK-108 하나뿐이었고
  `wf-eligible.sh developer`도 exit 0 / `eligible`이었다.
- 착수 시점 lease 둘은 모두 만료였다 — `SPEC-009.yml`(만료 2026-08-03T01:20:00Z),
  `TASK-104.yml`(만료 2026-08-04T19:37:05Z, 판정 시각 20:00:20Z). TASK-108을 덮는 lease는 없었다.
- 범위가 겹치는 열린 작업이 없다. `in_progress`인 TASK-104는 `src-tauri/`의 조건 판정이 범위이고,
  `todo`인 TASK-106은 조건 스크립트 회귀 검사, TASK-109는 dream 카드 배선이다. 이 작업은
  `src/`의 역할 잡 카드 통로만 만졌다.
- `.workflow/.runtime/migration.lock` 없음.

## 계약 확인 (TASK-107이 실은 값)

`src-tauri/src/infrastructure/heartbeat_update.rs`의 상수 다섯을 직접 읽고 그대로 옮겼다.

| Rust 필드 | camelCase | 타입 |
| --- | --- | --- |
| `identify_command` | `identifyCommand` | `string` |
| `package_command` | `packageCommand` | `string` |
| `source_command` | `sourceCommand` | `string` |
| `service_lookup_command` | `serviceLookupCommand` | `string \| null` |
| `service_restart_command` | `serviceRestartCommand` | `string \| null` |

payload 값이 모자란 자리는 없었다. TASK-107 재작업으로 넘길 것이 없다.

## 만든 것

### 1. 화면 계약 (`src/features/projects/domain/types.ts`)

- `HeartbeatUpdateGuide` 인터페이스 하나. 위 표대로 다섯 필드다.
- `IntegrationsSnapshot`에 `updateGuide: HeartbeatUpdateGuide` 필드 하나. 섹션 공통 영역이고
  `managedBlockFailure`·`jobsFilePath` 옆이다 — 두 카드가 같은 값을 같은 문구로 보여야 하기
  때문이다(R7).
- 게이트웨이(`tauriProjectGateway.ts`)는 손대지 않았다. `invoke<IntegrationsSnapshot>`가 통과시킬
  뿐이라 옮겨 적을 자리가 없다.

### 2. 공용 안내 컴포넌트 (`components/integrations/HeartbeatUpdateGuide.tsx`, 새 파일)

props는 payload 값 하나(`guide`)다. 문구를 props로 받지 않는다 — 두 카드가 다른 문구를 넘길 자리를
만들면 R7이 화면 테스트로 내려간다. 복사 상태는 컴포넌트 인스턴스가 스스로 든다.

문구 상수 전문 (완료 조건 4의 인용):

```
title            "하트비트를 갱신하는 방법"
principle        "설치한 방법 그대로 갱신합니다. 앱은 이 기기에 하트비트가 어떻게 설치됐는지 알지
                  못하므로, 아래에서 자기 설치 방법에 맞는 갈래를 고릅니다."
identifyNote     "어느 갈래인지 먼저 확인합니다. 결과에 Editable project location 줄이 있으면 소스
                  체크아웃으로 설치한 것이고, 없으면 pip으로 설치한 것입니다."
packageNote      "pip으로 설치했다면 이 명령으로 갱신합니다."
sourceNote       "소스 체크아웃으로 설치했다면 체크아웃 디렉터리에서 이 명령을 실행합니다. 앱은 그
                  디렉터리가 어디인지 알지 못하므로 경로를 대신 적어 주지 못합니다."
restartNote      "갱신한 뒤에는 하트비트를 재시작합니다. 코드를 갱신해도 이미 돌고 있는 프로세스는
                  갱신 전 코드를 그대로 들고 있어서, 재시작하지 않으면 갱신한 것이 반영되지
                  않습니다."
lookupNote       "재시작할 등록물의 라벨을 확인합니다."
restartCommandNote
                 "확인한 라벨을 <라벨> 자리에 넣어 재시작합니다. 앱은 이 기기에 등록된 라벨을 알지
                  못하므로 그 자리를 채워 두지 못합니다."
unknownRestartNote
                 "앱은 이 플랫폼에서 하트비트를 재시작하는 방법을 알지 못합니다. 갱신한 뒤 하트비트를
                  직접 재시작하세요."
```

여덟 문구 어디에도 설치 경로·launchd 라벨·파이썬 환경이 사실처럼 적혀 있지 않다. `<라벨>`은 사용자가
바꿔 넣는 빈자리이고, 그 자리가 비어 있는 이유를 `restartCommandNote`가 그 자리에서 말한다.

### 3. 복사 어법

마법사(`HeartbeatCard.tsx`의 `heartbeat-setup-step`)와 실행 실패 표시가 쓰는 모양 그대로다. 새 어법을
만들지 않았다.

- 명령 원문은 `<pre><code>{step.command}</code></pre>`로 화면에 남는다.
- 버튼 글자는 `명령 복사`, `aria-label`은 `<걸음 이름> 명령 복사` 다섯이다.
- 결과 문구는 글자까지 같다 — `복사됨` /
  `복사하지 못했습니다 — 위 명령을 직접 선택해 복사하세요.`
- 확인 대화상자 없음. 복사는 `../../infrastructure/clipboard`의 `copy`를 부른다(플러그인 직접 import
  없음).

### 4. 역할 잡 카드 배선 (`HeartbeatCard.tsx`)

이 파일의 변경은 둘뿐이다.

- import 한 줄 (`./HeartbeatUpdateGuide`).
- 084 경고 안 `<p>{noRunEvidenceNote}</p>` 다음에 `<HeartbeatUpdateGuide guide={snapshot.updateGuide} />`
  한 줄과 그 주석.

표시 조건을 새로 만들지 않았다. `missingRunEvidence(Boolean(job), run)`가 이미 그 자리의 조건이고
안내는 그 안에 들어간다. `bodyWarning`(접힘 요약)과 어떤 버튼의 `disabled` 조건도 건드리지 않았다.

### 5. 스타일 (`src/App.css`)

`.heartbeat-update-*` 선택자 11개를 `.integration-warning` 바로 앞에 더했다. 기존 선택자는 하나도
고치지 않았다.

## 084 문구와 안내 문구를 나란히 (완료 조건 3)

084 (`noRunEvidenceNote`, 손대지 않음):

> 잡 파일에는 이 잡의 정의가 있는데 하트비트가 실행한 기록이 없습니다. 아직 첫 주기가 오지 않았을
> 수도 있고, 하트비트가 프로젝트별 잡 파일을 읽지 못하는 버전일 수도 있습니다. **앱은 하트비트 버전을
> 판정하지 않으므로 둘 중 어느 쪽인지 알지 못합니다.** 주기가 지나도 기록이 생기지 않으면 하트비트를
> 갱신하세요.

안내 첫 두 문장:

> 하트비트를 갱신하는 방법
> 설치한 방법 그대로 갱신합니다. **앱은 이 기기에 하트비트가 어떻게 설치됐는지 알지 못하므로**, 아래
> 에서 자기 설치 방법에 맞는 갈래를 고릅니다.

안내는 원인을 단정하지 않는다. "갱신하면 해결됩니다"도 "업데이트가 필요합니다"도 없고, 084가 이미
말한 "앱이 알지 못한다"를 한 겹 더 말한다(설치 방법도 모른다). 084의 마지막 문장이 **갱신하기로 한
사용자**에게 남긴 "그럼 어떻게?"를 받는 자리다. 검사 1이 두 문장이 같은 경고 안에 함께 있고 판정
문구가 새로 생기지 않았음을 본다.

## 검사 (`IntegrationsView.test.tsx`, 9건 신규)

`describe("IntegrationsView 갱신 안내")` 하나에 모았다. 기존 검사의 이름과 내용은 아래 "고친 검사"
1건을 빼고 그대로다.

| # | 이름 | 보는 것 |
| --- | --- | --- |
| 1 | puts the update steps inside the very warning that asks for the update | 084 경고 안에 안내가 있다. 판정 문구가 새로 생기지 않았다 |
| 2 | stays out of sight wherever the warning itself is out of sight | 실행 기록 있음·잡 꺼짐·미설치·잡 파일 읽기 실패 넷에서 안내 없음 |
| 3 | shows every command the payload carries and assembles none of them | 명령 원문 다섯이 픽스처 값 그대로. 갈래 넷이 모두 있다 |
| 4 | copies each command exactly as it arrived | 걸음마다 복사 버튼, `copy`가 원문 그대로 불림, 표시는 하나뿐 |
| 5 | keeps the command on screen when the copy fails | 실패 문구가 뜨고 원문은 남는다 |
| 6 | says it does not know how to restart instead of inventing a command | 재시작 값 `null`에서 명령 없음, `<라벨>`·`launchctl` 화면에 없음 |
| 7 | keeps one guide's copy result out of the other's | 두 역할이 동시에 경고를 받아도 복사 결과가 서로 안 샌다 |
| 8 | adds copy buttons and nothing else | 안내의 버튼 다섯이 전부 복사 버튼, "실행" 없음 |
| 9 | disables no button that the warning left enabled | 저장·재설정·지금 실행이 모두 활성 |

픽스처 값은 실제 상수와 알아볼 수 있게 다르게 뒀다 — `fixture-identify claude-heartbeat`,
`fixture-package -U claude-heartbeat`, `fixture-source pull`, `fixture-lookup | grep heartbeat`,
`fixture-restart gui/$(id -u)/<라벨>`. 화면이 조각을 조립하면 이 값이 그대로 나올 수 없다.

## 고친 검사 1건 — 작업 지시에서 벗어난 자리

작업 지시는 "기존 검사는 이름도 내용도 고치지 않는다"였고, 아래 1건이 그 선을 넘는다. 먼저 보고한다.

- 자리: `IntegrationsView.test.tsx`의 `IntegrationsView 하트비트 잡 지금 실행 > 실행 실패와 실행 종료`
  두 검사 — `hands the backend's command to the clipboard untouched`,
  `keeps the command on screen and says so when the copy fails`.
- 바꾼 것: `row.querySelector("pre code")` → `row.querySelector(".heartbeat-run-failure-command code")`
  (각 1줄, 두 검사 합쳐 2줄). 이름·다른 단언·기대값은 그대로다.
- 이유: 두 검사의 픽스처는 실행 기록이 없는 개발자 잡이라 084 경고도 함께 뜬다. 안내가 그 경고 안에
  들어가면서 같은 `<li>` 안의 **첫** `pre code`가 실행 실패 명령이 아니라 안내의 첫 명령이 됐다.
  선택자가 겨냥하던 요소를 이름으로 못 박은 것이고, 단언의 뜻("실행 실패 명령 원문이 화면에 남는다")은
  그대로다. 오히려 다른 `<pre>`에 걸리지 않게 좁혔다.
- 대안을 안 쓴 이유: 픽스처에서 084를 끄면(실행 기록을 넣으면) 그 검사가 보는 상태 자체가 달라진다.
  검사를 지우거나 `.skip` 하는 것은 계약이 금지한다. 안내 위치는 작업 지시가 못 박은 자리라 옮길 수
  없다.
- 검사를 약화시키지 않았다는 근거: 두 검사 모두 여전히 실행 실패 명령 원문 전문을 기대값으로 비교하고,
  복사 호출 횟수·인자·복사 결과 문구 단언도 그대로 통과한다.

## 완료 조건 대조

1. 084 경고 자리에서 갱신 절차를 읽는다 → 검사 1. 외부 링크·다른 탭 없음.
2. 명령마다 복사 수단, 실패해도 원문 남음 → 검사 4·5.
3. 084 문구와 모순 없음 → 위 "084 문구와 안내 문구를 나란히".
4. 설치 경로·launchd 라벨·파이썬 환경이 사실처럼 없음 → 검사 6과 위 문구 상수 전문.
5. 갈래 판별·pip·소스·재시작 넷이 있고 하나로 단정하지 않음 → 검사 3.
6. 화면이 명령을 조립하지 않음 → 검사 3. 컴포넌트에 명령을 만드는 문자열 결합·템플릿 리터럴이 없다.
   파일의 템플릿 리터럴은 둘뿐이고 둘 다 명령이 아니다 — `aria-label`(`` `${step.name} 명령 복사` ``)과
   `className`(`` `heartbeat-update-copied${...}` ``). 다섯 명령은 전부 `guide.*` 값을 그대로 JSX에
   넣는다.
7. 재시작 걸음이 있고 라벨을 지어내지 않음 → 검사 6.
8. 갱신 실행 버튼 없음 → 검사 8.
9. 상시 표시 아님 → 검사 2.
10. 데몬 버전을 읽거나 보여주는 코드 없음 → 이 변경분(`HeartbeatUpdateGuide.tsx`, `types.ts`의 새 필드,
    `HeartbeatCard.tsx` 2줄, `App.css` 새 블록, 픽스처)에 `version`이라는 식별자·문구가 0건이다.
    `--version` 호출 경로도 `state.json` 조회도 없다.
11. 설치 마법사 그대로 → `heartbeat.setupStages`를 읽는 자리는 착수 시점과 같은 세 곳
    (`HeartbeatCard.tsx`의 `remaining` 계산, `requiredStages` 계산, 마법사 `.map`)이고 이 작업이 그
    셋을 만지지 않았다. 마법사 복사 버튼 넷을 세는 검사
    (`offers no button but the copy one and keeps saying the app does not install for you`)가 수정
    없이 통과한다.
12. 어떤 버튼도 비활성화되지 않음 → 검사 9. `disabled` 조건을 건드린 자리가 없다.
13. 기존 검사 삭제·비활성화 없음 → `IntegrationsView.test.tsx`에 `.skip`·`.todo` 0건(착수 시점도 0건).
    착수 시점 이 파일의 검사는 188건, 지금은 197건(신규 9건, 삭제 0건).
14. 게이트 통과 → 아래.

## 검증

- `npm run check` — typecheck + `vitest run` + `vite build` 전부 통과.
  테스트 20파일 539건 통과, 실패 0. (`IntegrationsView.test.tsx` 단독 197건 통과)
- `cargo test --manifest-path src-tauri/Cargo.toml` — 442건 통과, 실패 0, ignored 0.
  (`cargo`가 PATH에 없어 `export PATH="$HOME/.cargo/bin:$PATH"`를 앞에 붙여 실행했다)

무변경은 파일·심볼 단위로 확인했다. `DreamCard.tsx`는 열지 않았고, `src-tauri/`·
`tauriProjectGateway.ts`·`IntegrationCard.tsx`·`heartbeat_setup.rs`도 이 작업이 만지지 않았다.

## 만진 파일

- `src/features/projects/domain/types.ts` — 인터페이스 1개, 스냅샷 필드 1개
- `src/features/projects/components/integrations/HeartbeatUpdateGuide.tsx` — 새 파일
- `src/features/projects/components/integrations/HeartbeatCard.tsx` — import 1줄, 084 경고 안 1줄
- `src/App.css` — `.heartbeat-update-*` 블록 신규
- `src/features/projects/components/integrations/IntegrationsView.test.tsx` — 픽스처 + 검사 9건
  + 위 "고친 검사" 2줄
- `src/features/projects/components/integrations/DreamCard.test.tsx` — 픽스처만
- `src/features/projects/application/useProjectWorkspace.test.ts` — 픽스처만

## QA 절차 제안

1. 하트비트가 잡을 아직 한 번도 실행하지 않은 역할이 있는 프로젝트를 연다(또는 `state.json`에서 그
   역할의 실행 기록을 지운다). 연동 카드를 펼친다.
2. "하트비트가 이 잡을 실행한 기록이 없습니다" 경고 안에 "하트비트를 갱신하는 방법"이 이어져 있는지
   본다. 다른 탭으로 보내지 않는다.
3. 갈래 판별·pip·소스·라벨 확인·재시작 다섯 명령이 각각 원문과 `명령 복사` 버튼을 갖는지 본다.
4. 아무 버튼이나 눌러 `복사됨`이 뜨고 실제로 붙여넣기가 되는지, 원문이 화면에 그대로 남는지 본다.
   다른 걸음을 누르면 앞의 `복사됨`이 그 자리에서 사라지고 새 자리에 뜬다.
5. 저장·재설정·"지금 실행" 버튼이 그대로 눌리는지, 설치 마법사의 네 단계 문구·상태가 그대로인지 본다.

## 남은 것 / 리스크

- **dream 카드는 아직 이 안내를 그리지 않는다.** TASK-109의 몫이고, 완료 조건 10(두 카드가 같은
  문구)은 그 작업에서 닫힌다. 이 작업은 `DreamCard.test.tsx`의 픽스처만 채웠다.
- **macOS 밖의 재시작 절차는 여전히 없다.** payload가 `null`을 싣고 화면이 "앱이 방법을 알지 못한다"로
  말한다. 검사 6이 그 상태를 고정한다.
- **마법사 1단계의 `pip install claude-heartbeat`는 지금도 실패하는 명령이다**(SPEC-034 확인 사실 3).
  승인된 확인 필요 3번이 이 기획서에서 다루지 않기로 했고, 갱신 안내의 pip 명령도 같은 설치 모델을
  말하므로 두 문구가 어긋나지는 않는다. 해소는 데몬 저장소의 PyPI 배포 쪽이다.
