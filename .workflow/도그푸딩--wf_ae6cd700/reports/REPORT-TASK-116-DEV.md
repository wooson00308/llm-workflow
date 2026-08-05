# TASK-116 개발자 핸드오프 (qa_waiting)

- 대상: TASK-116 (연동 카드가 업데이트를 한 번의 조작으로 끝낸다)
- 근거: SPEC-037 R1·R3·R4·R5·R6과 확인 필요 3·6번의 승인안,
  DECISION-6C2F2639 (`schema: workflow-labs/decision@1`, `spec_id: SPEC-037`, `outcome: approved`,
  `created_by: user`, 2026-08-05T03:10:59.967916+00:00 — 직접 확인. SPEC-037의 결정 문서는 이 1건뿐이라
  더 늦은 결정이 없고 승인이 유효하다)
- 역할: 개발자 (developer-claude), 2026-08-05T07:30~07:55Z
- 결과: **`qa_waiting`**. 완료 조건 1~12를 닫았다. 다만 **검증 절차 5(앱을 띄워 실제로 눌러 보기)를
  이 세션에서 수행하지 못했다.** 아래 "하지 못한 검증"에 사유와 대신 확인한 사실을 적었다.
- 선점: `acquire TASK-116 developer-claude 45` exit 0 → `lease-5382-20260805073037` →
  `in_progress`(07:31Z) → 구현·검증 → `renew` exit 0 → `qa_waiting` → `release`.

## 선행·겹침 확인 (착수 시점 2026-08-05T07:30Z)

- `depends_on: [TASK-113]`. TASK-113은 `qa_waiting`이므로 선행 충족이다.
- 착수 시점 `todo`는 TASK-116~124 9건. 선행이 충족된 것은 TASK-116(113 → qa_waiting),
  TASK-118(111 → completed), TASK-122(선언 없음) 셋이었고 나머지 여섯은 선행이 `todo`라 미충족이었다.
  셋 중 TASK-116을 골랐다 — 뒤에 가장 많은 작업(117 → 119·124 …)이 걸려 있다.
- `in_progress` 작업이 없어 인수인계 대상이 없었다. 순서 규칙("멈춘 작업 먼저")은 적용되지 않는다.
- 미만료 lease 없음. 남아 있던 `SPEC-009.yml`은 만료였다(만료 2026-08-03T01:20:00Z, 판정 07:30Z).
  **그 파일은 읽기만 했다.** 겹침으로 막힌 것이 없다.
- `sh .workflow/rules/wf-eligible.sh developer` → exit 0 / `eligible`.
- `.workflow/.runtime/migration.lock` 없음.

## 만든 것

TASK-113이 만든 커맨드 `update_heartbeat`를 화면까지 이었다. 배선은 이 저장소가 이미 쓰는 통로 그대로다
— 게이트웨이에 호출을 더하고, 훅이 진행·결과 상태를 들고, 뷰가 값을 그대로 카드에 넘긴다.
`heartbeatRuns`(지금 실행)가 같은 모양의 선례다.

### 자리

업데이트 통로는 **하트비트 카드의 공통 자리**(설치 마법사 아래, 역할 잡 목록 위)에 섰다. 역할별
조작이 아니라 설치 전체의 일이기 때문이다. 검사가 그것을 고정한다 — 어느 잡 행에도 이 버튼이 없다.

`installation !== "not_installed"` 분기 **안**에 두었다. 미설치 상태에는 갱신할 설치본이 없고, 그
자리의 안내는 설치 마법사다. 관리 블록을 읽지 못한 상태(`managedBlockFailure`)에서는 남는다 — 잡을
읽는 것과 설치본을 갱신하는 것은 서로를 막지 않는다(R9). 둘 다 검사로 고정했다.

dream 카드에는 이 통로를 만들지 않았다. `DreamCard.tsx`는 0줄 변경이다.

### R3 — 확인 화면

버튼은 누르는 즉시 실행하지 않는다. "지금 실행" 확인 화면과 같은 자리·같은 모양(`heartbeat-confirm`,
`role="group"`)을 쓰되 첫 줄에서 갈랐다 — 그쪽은 "이 조작은 어떤 파일도 쓰지 않습니다"이고, 이쪽은
"확인 후 하트비트가 자기 저장소를 갱신하고 자신을 재기동합니다"다.

싣는 것 셋: (1) 무엇이 바뀌는지 세 줄, (2) 지금 끊기는 세션, (3) 되돌릴 수 없다는 것.

세션 고지의 원천은 `project.activeLeases`다. 앱이 새로 계산하지 않고 활동 뷰가 쓰는 값을 그대로
내렸다. 배선은 `WorkspaceShell` → `IntegrationsView` → 카드이고 뷰는 값을 들여다보지 않는다.
**문구가 0개일 때와 하나 이상일 때 갈린다** — 0개면 "지금 끊길 세션이 없습니다", 하나 이상이면
"지금 끊기는 세션 N개"와 `에이전트 · 대상 문서` 목록이다. 앱이 세션을 정리하지도 lease에 손대지도
않는다는 사실을 문구에 남겼다.

### R1 — 겹쳐 누르기와 진행 표시

확인 버튼을 누르면 확인 화면이 닫히므로 같은 버튼을 두 번 눌러도 실행은 한 번이다. 실행 중에는
버튼이 비활성이고 진행 표시가 뜬다. 훅에도 `useRef` 방어선을 두어 버튼이 잠기지 않아도 커맨드가
두 번 나가지 않는다. 셋 다 검사로 고정했다.

진행·결과 상태의 주인은 훅이다. 카드가 들면 다른 메뉴를 다녀와 언마운트된 순간 갈라진다 —
"지금 실행"이 같은 이유로 같은 모양을 쓴다.

### R4 — 결과

`HeartbeatUpdate`의 세 갈래를 서로 다른 화면으로 그린다.

- **`contract`** — 데몬이 낸 단계 줄만 순서 그대로 그린다. 낸 적 없는 단계를 "건너뜀"으로 지어내지
  않는다(검사가 이것을 고정한다: `result=failed exit=11`이면 단계가 하나뿐이고 의존성·재기동 줄이
  화면에 없다). 결과 낱말은 셋이고 `partial`은 자기 낱말·자기 색(`result-partial`)을 갖는다 —
  성공의 낱말도 실패의 낱말도 그 상태에 붙지 않고, "지금 도는 프로세스는 갱신 전 코드를 그대로
  들고 있을 수 있습니다"가 함께 선다.
- **종료 코드**는 계약이 가른 대로 원인별 문장이 다르다(0·10~14·20·30~32). 숫자는 언제나 보인다.
  **계약에 없는 코드는 뜻을 붙이지 않는다** — "종료 코드 15 — 앱이 아는 코드가 아닙니다"로 끝난다.
  코드 10은 wheel 설치라는 뜻이므로 pip 갱신 쪽 안내로 잇는 문장을 넣었다.
- **stderr 원문**은 접힌 `<details>`에 그대로 둔다. 요약하지도 잘라내지도 않는다. 검사가 픽스처의
  문자열과 화면의 `textContent`를 **정확히 같은지**로 비교한다.
- **`offContract`** — "이 설치본이 계약대로 답하지 않았습니다". 성공으로도 실패로도 부르지 않고,
  종료 코드는 숫자만 싣는다(계약 밖 출력에는 코드의 뜻도 계약 밖이라 코드 표의 문장을 끌어다 쓰지
  않는다 — 검사가 이것을 고정한다). stdout·stderr 원문 둘 다 남긴다.
- **`notRun`** — 찾지 못했다는 사실, 앱이 **실제로 본 후보 경로**, 명령 원문과 복사 버튼. 앱이
  찾은 척하는 경로를 지어내지 않는다(본 것이 없으면 목록 자체가 없다).

### R5·R6 — 안내의 자리

하트비트 카드의 084 경고 안에서 `HeartbeatUpdateGuide`가 **접힌 자리**로 내려갔다. 감싸기는
`FoldedUpdateGuide` 하나이고 안내 컴포넌트 자체는 **0줄 변경**이다 — 문구와 다섯 값이 그대로여야
dream 카드와 글자까지 같다(SPEC-034 R7). 접기는 언마운트가 아니라 `hidden`이다(설치 가이드와 같은
idiom).

**접힘·펼침을 가르는 것은 "직전 업데이트가 무엇으로 끝났는가" 하나다.** 앱은 사전 탐색으로 실행
가능 여부를 판정하지 않는다 — 조회 주기에 프로세스를 띄우지 않는다는 이 저장소의 선을 지키기
위해서다. `notRun`이면 펼쳐진 주 통로가 되고, 그 밖에는 접힌다(실행 전 포함). 그 값이 뒤집히면
사용자가 고른 접힘도 함께 초기화된다 — 호출부의 `key`가 그 일을 한다.

## 바꾼 파일

| 파일 | 무엇 |
| --- | --- |
| `src/features/projects/domain/types.ts` | `HeartbeatUpdateStep`·`HeartbeatUpdateResult`·`HeartbeatUpdateControls`, `IntegrationsState.heartbeatUpdate`, `ProjectGateway.updateHeartbeat` |
| `src/features/projects/infrastructure/tauriProjectGateway.ts` | `invoke("update_heartbeat")` (인자 없음) |
| `src/features/projects/application/useProjectWorkspace.ts` | 업데이트 상태·겹침 방어·`updateHeartbeat` 통로, 묶음 합류 |
| `src/features/projects/components/WorkspaceShell.tsx` | `activeLeases`·`heartbeatUpdate` 배선 |
| `src/features/projects/components/integrations/IntegrationsView.tsx` | 두 값을 카드에 그대로 넘김 |
| `src/features/projects/components/integrations/HeartbeatCard.tsx` | 업데이트 통로·확인 화면·진행·결과 셋·안내 접기 |
| `src/features/projects/components/integrations/IntegrationCard.tsx` | **범위 밖.** 카드 props 두 개 (아래 참조) |
| `src/App.css` | 새 자리의 스타일 |
| 검사 4종 | `IntegrationsView.test.tsx`·`WorkspaceShell.test.tsx`·`useProjectWorkspace.test.ts` |

`HeartbeatUpdateGuide.tsx`·`DreamCard.tsx`·`src-tauri/`는 0줄 변경이다.

## 범위 밖 파일을 하나 만졌다 (사실 보고)

**`src/features/projects/components/integrations/IntegrationCard.tsx`는 `scope_files`에 없는데
고쳤다.** 더한 것은 `IntegrationCardProps`의 선택 필드 둘(`activeLeases?`·`heartbeatUpdate?`)과
그 주석뿐이고 동작 변경은 없다.

사유: 작업 지시는 범위 파일에 "`types.ts` — 결과 타입과 **카드 props**"라고 적었는데, 이 저장소의
카드 props(`IntegrationCardProps`)는 `types.ts`가 아니라 `IntegrationCard.tsx`에 있다. 뷰가 카드에
값을 넘기려면 그 인터페이스에 필드가 있어야 하고, 없으면 TypeScript가 막는다. 즉 선언된 범위만으로는
완료 조건 2(세션 고지)와 1(업데이트 버튼)을 닫을 수 없다.

착수 시점에 미만료 lease가 하나도 없었으므로 이 추가 파일이 다른 세션과 부딪힐 자리는 없었다.
`scope_files`가 막는 것이 동시 편집이라는 점에서 실제 피해는 없다. 그래도 선언 밖이라는 사실은
그대로 남으므로 여기 적는다.

**아키텍트에게:** TASK-117·TASK-124도 같은 카드 props를 건드릴 가능성이 높다(설치 실행 버튼·데몬
토글이 같은 통로를 쓴다). 그 둘의 `scope_files`에 `IntegrationCard.tsx`를 넣는 것이 맞아 보인다.
이 세션에서는 그 두 문서를 읽기만 했고 고치지 않았다.

### 두 필드를 선택으로 둔 이유

`heartbeatRuns`는 카드 props에서 필수다(주석이 "선택으로 두면 배선을 빠뜨려도 컴파일이 통과한다"고
적는다). 새 둘을 필수로 하면 **`DreamCard.test.tsx`가 컴파일되지 않는다** — 그 파일이 props 리터럴을
직접 조립하고, 완료 조건 10이 "그 파일이 기대값 수정 없이 통과한다"를 요구하며, 그 파일은
`scope_files`에도 없다.

그래서 배선이 빠지는 것을 막는 자리를 **섹션 쪽 props로 옮겼다** — `IntegrationsView`의 Props에서는
둘 다 **필수**다. 뷰가 카드를 그릴 때 값이 없으면 컴파일이 통과하지 않는다. `WorkspaceShell`은
`heartbeatRuns`와 같은 자리에서 `heartbeatUpdate`를 함께 걸어, 값이 없으면 화면이 통째로 비어 바로
드러난다. `activeLeases`는 카드에서 `?? []`로 받는데, 그 배선이 실제로 닿는지는
`WorkspaceShell.test.tsx`의 검사 둘이 고정한다(lease 1건 → "지금 끊기는 세션 1개" + 목록,
0건 → "지금 끊길 세션이 없습니다").

## 기존 검사를 고친 것 (사실 보고)

**삭제하거나 비활성화한 검사는 없다.** 기존 `IntegrationsView.test.tsx`의 갱신 안내 검사 6건에
`openGuide("개발자")` 한 줄씩을 더했다. 안내가 이제 접힌 자리에서 시작하므로(승인된 확인 필요 6번)
안내의 내용을 읽는 검사는 먼저 펼쳐야 한다. 단언 자체는 한 글자도 약해지지 않았다 — 다섯 명령 원문,
복사 호출 인자, 복사 실패 문구, 버튼 목록 전부 그대로다. 접힘 그 자체는 새 검사 셋이 따로 고정한다.

나머지 기존 검사 수정은 새 필수 prop 때문에 렌더 인자를 채운 것뿐이다(`activeLeases`,
`heartbeatUpdate`, 게이트웨이 스텁의 `updateHeartbeat`).

## 검증

| 절차 | 결과 |
| --- | --- |
| 1. `npm run check` | **통과** (typecheck + `20 files / 575 tests` + build). 착수 전 545건 → 575건, 신규 30건 |
| 2. 결과 픽스처 다섯 | 세움 — 성공(`ok`), 단계 실패(`failed`/11), `partial`(31), 계약 밖 출력, 실행 수단 없음 |
| 3. 세션 고지 0개·둘 이상 | 세움 — 문구가 갈리는 것까지 단언 |
| 4. `WorkspaceShell.test.tsx`의 `activeLeases` 도달 | 세움 — 메뉴 열기 → 카드 펼치기 → 버튼 → 확인 화면에서 lease 확인 |
| 5. 앱을 띄워 실제로 눌러 보기 | **하지 못했다.** 아래 참조 |

신규 검사 30건의 내역:

- `IntegrationsView.test.tsx` 22건 — 자리(잡 행 밖), 확인 전 미실행, 세 줄 + 되돌릴 수 없음,
  세션 0개/2개 문구, 취소, 두 번 눌러도 한 번, 실행 중 비활성 + 진행 표시, 단계 순서, 없는 단계
  미생성, `partial`의 셋째 상태, 종료 코드 8종이 서로 다른 문장, 모르는 코드, stderr 원문 일치,
  계약 밖 출력, 본 후보 + 명령 원문, 복사(실패 포함), 안내 접힘 3종, 다른 동작 미차단, 관리 블록
  읽기 실패에서도 남음, 미설치에서 없음
- `useProjectWorkspace.test.ts` 5건 — 결과 보관, 겹침 방어, 커맨드 거절 → `notRun` 변환, 새 실행이
  지난 결과를 지움, 조회·쓰기 상태 미간섭
- `WorkspaceShell.test.tsx` 3건 — lease 도달 2건 + 기존 리터럴 갱신 1건(수치상 2건)

`src-tauri/`를 만지지 않았으므로 `cargo test`는 돌리지 않았다.

## 하지 못한 검증 — 검증 절차 5

**이 세션에서 앱의 버튼을 실제로 누르지 못했다.** 사유 둘이다.

1. 이 세션은 비대화형이라 GUI 창을 조작할 수단이 없다.
2. `npm run tauri dev`를 두 번 시도했고 둘 다 앱을 띄우지 못했다 — 첫 번째는 이 셸의 PATH에 `cargo`가
   없어서(`~/.cargo/bin`을 붙여 해결), 두 번째는 **포트 1420이 이미 사용 중**이어서다. 그 포트를
   잡고 있는 것은 사용자가 15:28에 띄워 둔 vite(pid 79343)와 15:44에 뜬 앱(pid 51757)이다.
   **사용자의 프로세스이므로 죽이지 않았다.** 내 시도 둘은 모두 스스로 끝났고 남은 프로세스는 없다.

대신 그 실행의 결말을 정하는 사실을 실측했다.

| 후보 | 이 셸 | GUI 앱이 물려받는 PATH |
| --- | --- | --- |
| `heartbeat` (PATH) | `/Users/catze/.pyenv/versions/3.11.9/bin/heartbeat` — 찾음 | 못 찾음 (exit 1) |
| `~/.local/bin/heartbeat` | 없음 | 없음 |

`launchctl getenv PATH`가 비어 있어 GUI 앱은 시스템 기본 PATH(`/usr/bin:/bin:/usr/sbin:/sbin`)를
물려받고, 거기에 pyenv가 없다. 즉 **이 기기에서 버튼은 `notRun`("실행 수단을 찾지 못했다")으로
끝날 가능성이 매우 높다.** 기획서 확인 사실 11이 그대로 유효하고, TASK-113의 보고서가 적은 같은
표와 일치한다. 그 경로에서 안내가 펼쳐진 주 통로가 되는지는 검사 하나가 고정하고 있으나,
**실물 확인은 사용자 QA의 몫으로 남는다.**

QA에 도움이 될 사실 하나: 사용자가 띄워 둔 앱(pid 51757, 15:44 빌드)의 바이너리에는
`update_heartbeat` 커맨드가 이미 들어 있고, vite dev 서버가 이 세션의 프론트엔드 변경을 HMR로
서빙한다. **그 창을 그대로 두고 연동 화면을 열면 새 버튼이 이미 보일 가능성이 높다.**

## QA에서 봐 주었으면 하는 것

1. 연동 → claude-heartbeat 카드 펼치기 → 설치 마법사 아래에 "하트비트 업데이트" 버튼이 있는가.
2. 버튼을 누르면 확인 화면이 먼저 뜨고, 거기에 세 줄과 "지금 끊길 세션이 없습니다"(또는 활성
   세션 목록)와 "되돌릴 수 없습니다"가 있는가. **취소하면 아무 일도 없는가.**
3. 확인을 누르면 이 기기에서 무엇으로 끝나는가. 예상은 "앱이 하트비트 업데이트를 실행하지
   못했습니다" + 본 후보 둘 + `heartbeat update` 복사 버튼이다.
4. 그 뒤 084 경고 안의 갱신 안내가 **펼쳐진 채**로 바뀌는가(그전에는 "갱신 안내 펼치기"로 접혀
   있어야 한다).
5. 업데이트가 실패한 상태에서도 저장·재설정·지금 실행 버튼이 그대로 눌리는가.
6. dream 카드의 갱신 안내 표시가 변경 전과 같은가(접히지 않고 그대로여야 한다).

**주의:** 3번의 확인 버튼은 실행 수단을 찾은 기기에서는 실제로 저장소를 당기고 데몬을 재기동한다.
지금 이 기기의 GUI 앱은 실행 파일을 찾지 못할 것으로 보이지만, 터미널 PATH가 상속되는 방식으로
앱을 띄웠다면 진짜로 돈다. 활성 lease가 있는 동안에는 누르지 않는 편이 안전하다.

## 하지 않은 것

- 설치 마법사의 실행 버튼과 버전 어긋남 표시를 만들지 않았다. TASK-117의 자리다. TASK-114·115가 만든
  `run_heartbeat_setup_step`·`check_heartbeat_versions` 커맨드에는 손대지 않았다.
- `src-tauri/`를 만지지 않았다. 이 작업의 범위 밖이다.
- `HeartbeatUpdateGuide.tsx`의 문구와 다섯 값을 바꾸지 않았다(0줄 변경). 접는 것은 하트비트 카드
  쪽의 감싸기다.
- `DreamCard.tsx`·`DreamCard.test.tsx`를 만지지 않았다.
- 업데이트 결과를 카드 접힘 요약의 경고 신호(`bodyWarning`)에 넣지 않았다. 작업 지시에 없고
  R9("지금 되는 것이 그대로 된다")에 가까운 쪽을 골랐다. 필요하면 후속에서 정할 일이다.

## 위험과 후속

- **이 기기에서는 새 버튼이 거의 늘 실패 경로로 떨어진다.** 기획서 확인 필요 4번이 그것을 한계로
  적었고 승인안이 "폴백으로 처리한다"였다. 실행형의 실제 값이 이 결정에 크게 걸려 있다는 사실은
  그대로 남는다.
- 확인 화면의 세션 목록은 `activeLeases`의 스냅샷이다. 확인을 누르는 사이에 lease가 새로 생기면
  그 세션은 목록에 없이 끊긴다. 앱이 세션을 정리하지 않는다는 승인안의 성질상 감수하는 자리다.
- 종료 코드 문장은 `docs/heartbeat.md`의 인용 절(claude-heartbeat `611604f`)을 옮긴 것이다. 그
  커밋은 아직 `main`에 병합되지 않았다고 인용 절 자신이 적는다. 병합 과정에서 코드 번호나 어휘가
  바뀌면 이 문장 표를 함께 고쳐야 한다.
