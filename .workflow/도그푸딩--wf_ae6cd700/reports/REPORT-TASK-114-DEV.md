# TASK-114 개발자 핸드오프 (qa_waiting)

- 대상: TASK-114 (설치 2·3단계를 앱이 대신 실행한다)
- 근거: SPEC-037 R2·R5·R7·R9 및 확인 필요 1번의 승인안,
  DECISION-6C2F2639 (`schema: workflow-labs/decision@1`, `spec_id: SPEC-037`, `outcome: approved`,
  `created_by: user`, 2026-08-05T03:10:59.967916+00:00 — 직접 확인. SPEC-037의 결정 문서는 이 1건뿐이라
  더 늦은 결정이 없고 승인이 유효하다)
- 역할: 개발자 (developer-claude), 2026-08-05T06:14~06:27Z
- 결과: **`qa_waiting`**. 완료 조건 1~9를 닫았다. 다만 **검증 절차 3번을 그대로 수행하지 않았다** —
  아래 "실행하지 않은 검증"에 사유와 대체 실측을 적었다.
- 선점: `acquire TASK-114 developer-claude 30` exit 0 → `lease-4493-20260805061447` →
  `in_progress`(06:15:00Z) → 구현·검증 → `renew` exit 0 → `qa_waiting` → `release`.

## 선행·겹침 확인 (착수 시점 2026-08-05T06:14Z)

- `depends_on: [TASK-113]`. TASK-113은 `qa_waiting`이므로 선행 충족이다.
- 착수 시점 `todo`는 TASK-114~118 5건. 선행이 충족된 것은 셋이었다 — TASK-114·116(둘 다 TASK-113
  선행, `qa_waiting`)과 TASK-118(TASK-111 선행, `completed`). TASK-115는 TASK-114가, TASK-117은
  TASK-114·115·116이 아직 `todo`라 미충족이었다. `in_progress`인 작업은 없었으므로 재개 대상도 없다.
  셋 중 TASK-114를 골랐다 — TASK-115가 이것 하나만 기다리고 TASK-117이 그 뒤에 서 있어, 뒤에 막힌
  작업이 가장 많은 자리다.
- 미만료 lease 없음. 남아 있던 둘은 모두 만료였다 — `IDEA-886DAB21.yml`(만료 2026-08-05T00:25:31Z),
  `SPEC-009.yml`(만료 2026-08-03T01:20:00Z). 판정 시각 06:13:52Z. **두 파일은 읽기만 했다.**
- 겹침 없음. 미만료 lease가 하나도 없으므로 `scope_files`를 비교할 상대가 없다.
- `.workflow/.runtime/migration.lock` 없음.

## 착수 전 계약 재대조 (완료 조건 8)

`docs/heartbeat.md`의 인용 절이 "이 값에 기대는 작업은 착수 시점의 계약 문서를 다시 읽어 이 절과
대조하라"고 적어 두었으므로, 데몬 저장소(`~/Git/claude-heartbeat`)를 읽어 대조했다.

| 확인한 것 | 결과 |
| --- | --- |
| 저장소 HEAD | `e4a76ec feat: v0.8.0 — jobs.d 기반 + 앱 연동 표면(…) (#21)` — TASK-113이 본 것과 같다 |
| `docs/config-contract.md` 줄 수 | 264줄 — 인용 시점과 같다 |
| `install-service` 문자열 | **계약 문서 전체에 0건.** `docs/heartbeat.md` 5번 절의 서술 그대로다 |
| `heartbeat init` 문자열 | 19줄 1건뿐. `jobs.d` 디렉토리 생성을 서술하는 문장이고 종료 코드 언급 없음 |

즉 이 두 명령에 대해 계약이 정한 종료 코드 의미는 여전히 없다. 그래서 앱은 **0과 비0만** 쓴다.
이 작업이 쓰는 표면은 인용 절 4번·5번 둘뿐이고, 1번(`heartbeat update`)은 TASK-113의 자리,
2번(`--version`)·3번(`_daemon.version`)은 TASK-115의 자리라 건드리지 않았다.

## 변경한 파일

`scope_files` 6개 안에서만 작업했다. 이 밖의 파일은 만지지 않았다.

| 파일 | 변경 |
| --- | --- |
| `src-tauri/src/domain/project.rs` | `HeartbeatSetupStage`에 `runnable: bool` 한 필드 (+5줄) |
| `src-tauri/src/infrastructure/heartbeat_setup.rs` | 네 단계 함수가 그 값을 채운다 + 검사 1건 (+38줄) |
| `src-tauri/src/application/heartbeat_setup_run_service.rs` | **신규 400줄** — 식별자 검증·매핑·결과 |
| `src-tauri/src/application/mod.rs` | 모듈 등록 (+2줄) |
| `src-tauri/src/commands/heartbeat.rs` | `run_heartbeat_setup_step` 커맨드 (+55줄) |
| `src-tauri/src/lib.rs` | `invoke_handler` 등록 (+2줄) |

### 설계 판단 셋

1. **실행 가능 표식은 백엔드가 싣는다.** `HeartbeatSetupStage.runnable`이 payload로 나가고
   (`camelCase`라 화면에는 `runnable`), init·service만 참이다. 화면이 단계 종류를 보고 스스로
   갈리지 않는다.
2. **식별자 → 인자 매핑은 `heartbeat_setup_run_service.rs`의 상수 하나다.** 화면이 보내는 것은
   `"init"`·`"service"` 같은 단계 식별자이고, 명령 문자열이 아니다. 그 밖의 값은 `arguments_for`가
   `None`을 돌려 **프로세스를 띄우기 전에** 끝난다.
3. **두 자리가 갈라지지 않게 검사로 묶었다.** 마법사가 실은 `runnable`과 이 서비스가 실제로 받는
   식별자 집합이 같은지를 한 검사가 단정한다
   (`the_runnable_flag_of_every_stage_matches_what_this_service_accepts`). 표식은
   `heartbeat_setup.rs`가 쓰고 통로는 서비스가 쓰므로, 한쪽만 고치면 이 검사가 깨진다.

### 결과 값의 모양

`HeartbeatSetupRun`은 세 갈래이고 셋 다 사용자가 할 다음 행동이 다르다.

| kind | 언제 | 싣는 것 |
| --- | --- | --- |
| `ran` | 띄웠고 끝났다 | `succeeded`(종료 코드 0인가), `code`, `stdout`, `stderr` 원문 |
| `notRun` | 실행 수단을 못 찾았거나 못 띄웠다 | `message`, `command`(칠 명령 원문), `looked`(본 후보) |
| `notRunnable` | 실행 대상이 아닌 식별자 | `message`. 프로세스를 띄우지 않았다 |

`succeeded`의 갈림은 종료 코드가 0인지 **하나뿐이다.** 그보다 잘게 원인을 가르는 문구를 앱이 만들지
않는다 — 계약에 그 근거가 없다. 실패 사유는 `stderr` 원문이 말한다. 시그널로 끝난 것(`code`가
`None`)은 성공이 아니다.

## 검증

| 검사 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **480 passed / 0 failed** |
| `npm run check` (typecheck + vitest + build) | **20 files / 546 tests passed**, 빌드 성공 |
| `cargo clippy --all-targets -- -D warnings` | 경고 0 |
| `cargo fmt -- --check` | 차이 없음 |

새로 더한 검사는 8건이다. 기존 검사는 하나도 지우거나 비활성화하지 않았고, 기대값도 고치지 않았다.

- `only_the_init_and_service_steps_are_runnable_by_the_app` — 입력 6조합 전부에서 표식이
  `(package,false) (init,true) (service,true) (dream,false)`로 고정 (완료 조건 6).
- `the_runnable_flag_of_every_stage_matches_what_this_service_accepts` — 표식과 실행 통로가 같다.
- `each_runnable_step_runs_with_its_own_fixed_argument` — recorder 스크립트가 받은 인자가
  `init` / `install-service`. 화면이 준 문자열이 명령줄에 흘러가지 않는다 (완료 조건 1·3).
- `a_step_that_is_not_runnable_never_spawns_the_candidate` — `package`·`dream`·`정체불명` 셋 모두
  `notRunnable`이고, **띄웠으면 남았을 흔적 파일이 없다** (완료 조건 2).
- `a_nonzero_exit_code_is_a_failure_that_carries_the_output_verbatim` — 종료 코드 1에
  `succeeded: false`, stdout·stderr 원문 그대로 (완료 조건 4).
- `a_missing_executable_reports_the_paths_it_looked_at_and_the_command_to_type` — 본 후보와
  `heartbeat install-service` 원문 (완료 조건 5, R5).
- `running_a_setup_step_writes_no_files_from_the_app` — 실행 전후 홈·프로젝트 디렉터리 목록이 같다.
- `the_results_serialize_to_the_wire_contract` — 세 갈래의 JSON 모양.

완료 조건 7(네 단계의 순서·상태 판정·`required`·`command`·`evidence` 불변)은 `heartbeat_setup.rs`의
기존 검사 4건이 **기대값 수정 없이** 통과하는 것으로 확인했다. 필드 추가는 그 넷 어디에도 닿지 않는다.

## 실행하지 않은 검증 — 검증 절차 3번

작업 문서의 검증 절차 3번은 "이 기기에서 두 식별자를 각각 한 번 부른 결과를 보고서에 적는다"이다.
**두 명령을 이 기기에 실제로 실행하지는 않았다.** 사유는 이렇다.

- 이 셸의 PATH에는 `heartbeat`가 있다(`/Users/catze/.pyenv/versions/3.11.9/bin/heartbeat`,
  `heartbeat 0.8.0`). 그래서 실셸에서 서비스를 부르면 두 명령이 **진짜로 실행된다.**
- `heartbeat init`은 하트비트 홈에 문서를 쓰고, `heartbeat install-service`는 서비스 등록물을 만들고
  **데몬을 다시 띄운다**(`--print-only` 없이는 실제 등록이다 — help 확인). 데몬 재기동은 지금 도는
  세션을 끊는다. 08-05에 TASK-104가 고아가 된 것이 그 모양이고, SPEC-037 R3이 그 고지를 요구하는
  이유이기도 하다. 사용자 확인 없이 개발자 세션이 대신 누를 조작이 아니라고 판단했다.

대신 **앱이 실제로 놓이는 환경 그대로** 두 식별자를 각각 한 번 불렀다. GUI로 띄운 앱이 물려받는
PATH는 사용자 셸의 것과 다르고(확인 사실 4), pyenv 경로가 거기 없으며 `~/.local/bin/heartbeat`도 이
기기에 없다 — 확인 사실 11이 말한 "실행 파일을 찾지 못하는" 상태가 이것이다. `PATH=/usr/bin:/bin:
/usr/sbin:/sbin`으로 `HeartbeatSetupRunService::run`을 직접 불러 얻은 값은 이렇다.

```
init    => NotRun { message: "하트비트 실행 파일을 찾지 못해 이 단계를 실행하지 못했습니다.",
                    command: "heartbeat init",
                    looked: ["heartbeat", "/Users/catze/.local/bin/heartbeat"] }
service => NotRun { message: "하트비트 실행 파일을 찾지 못해 이 단계를 실행하지 못했습니다.",
                    command: "heartbeat install-service",
                    looked: ["heartbeat", "/Users/catze/.local/bin/heartbeat"] }
```

**두 값 모두 R5의 모양이다** — 찾지 못했다는 사실, 사용자가 그대로 칠 명령 원문, 실제로 본 후보 둘.
지어낸 경로는 없다. 이 실측은 일회용 검사로 얻었고 **저장소에 남기지 않았다**(검사 수 480은 실측
전후가 같다).

즉 3번이 요구한 "부른 결과"는 적었으나, 실행까지 간 경로는 이 기기에서 밟지 않았다. **실제 실행은
QA에서 사용자가 확인 화면을 거쳐 눌러 보는 것이 맞다고 본다.** 다만 그 버튼은 TASK-117이 만들므로,
이 작업만으로는 화면에서 누를 자리가 아직 없다(아래 QA 안내 참조).

## QA에서 확인할 것

이 작업은 **백엔드만** 만든다. 설치 마법사에 실행 버튼이 생기는 것은 TASK-117이고, 그 전까지는
화면에서 눈에 보이는 변화가 없다. 그래서 QA는 "달라지지 않았음"을 보는 쪽이다.

1. 연동 화면의 설치 마법사가 지금과 똑같이 보인다. 네 단계의 순서·상태·명령 원문·근거 경로가 전과
   같고, 복사 버튼도 그대로다.
2. "지금 실행"과 잡 저장, 084 경고, 업데이트(TASK-113) 어느 것도 달라지지 않았다.
3. 실행 버튼이 아직 없는 것이 정상이다. 있으면 그것이 오히려 이상이다.

## 남는 위험·후속

- **`runnable`을 화면이 아직 읽지 않는다.** payload에는 실렸지만 `src/features/projects/domain/
  types.ts`의 `HeartbeatSetupStage`에는 필드가 없다. TypeScript는 여분 필드를 문제 삼지 않아
  `npm run check`가 통과한다. 그 필드를 더해 버튼을 세우는 것이 TASK-117이다.
- **커맨드는 등록됐지만 부르는 화면이 없다.** `run_heartbeat_setup_step`은 TASK-117이 이을 때까지
  호출자가 없다. 백엔드만 먼저 서는 것은 TASK-113과 같은 모양이다.
- **`notRunnable`은 정상 경로에서 나오지 않는 값이다.** 화면이 `runnable`만 보고 버튼을 세우면 이
  갈래에 닿지 않는다. 나온다면 화면과 백엔드의 답이 갈라졌다는 신호다.
- **범위를 넓히지 않았다.** 1단계(`pip install claude-heartbeat`)와 4단계
  (`heartbeat install dream`)는 실행 대상이 아니고, 표식도 통로도 거짓·거부다. 4단계는 데몬이 명령을
  소유하므로 기술적으로는 실행할 수 있으나, 승인안이 든 것이 둘이라 넓히지 않았다. 넓힐지는
  아키텍트의 자리다.
- 역할 밖 발견 없음. `docs/heartbeat.md`·SPEC-037·다른 작업 문서는 읽기만 했다.
