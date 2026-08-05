---
schema: workflow-labs/task@1
id: TASK-123
title: 앱이 launchctl로 등록된 서비스를 내리고 다시 올린다
status: completed
source_spec_id: SPEC-036
source_decision_id: DECISION-3D9A30F2
depends_on: [TASK-122]
scope_files: [src-tauri/src/infrastructure/launchctl.rs, src-tauri/src/infrastructure/mod.rs, src-tauri/src/application/heartbeat_service_control.rs, src-tauri/src/application/mod.rs, src-tauri/src/commands/heartbeat.rs, src-tauri/src/lib.rs]
updated_at: 2026-08-05T16:44:14.779197+00:00
history:
  - { at: 2026-08-05T07:22:00Z, kind: created }
  - { at: 2026-08-05T14:12:00Z, kind: in_progress }
  - { at: 2026-08-05T14:45:00Z, kind: qa_waiting }
  - { at: 2026-08-05T16:44:14.779197+00:00, kind: completed }
---

# 앱이 launchctl로 등록된 서비스를 내리고 다시 올린다

## 결정권자 요약

커밋 컷마다 손으로 치던 두 명령을 앱 안쪽이 대신 실행할 수 있게 됐다. 08-04·08-05 두 컷에서 사용자가
매번 터미널로 옮겨 친 것이 그 둘이고, 이제 앱이 이 기기에서 직접 읽어 낸 서비스 이름과 등록물 경로로
같은 명령을 조립한다. 셸을 거치지 않고, 화면이 준 문자열이 명령에 닿는 길이 없다.

대상을 확정하지 못하면 아무것도 실행하지 않는다. 등록물 없음·대상 모호·이 플랫폼 아님·읽지 못함
넷에서 프로세스가 뜨지 않고, 앱이 내장한 이름으로 대신 시도하는 길도 없다. 결과는 명령이 어떻게
끝났는지까지만 말하고 데몬이 실제로 내려갔다고 단정하지 않는다.

버튼은 아직 없다. 화면은 TASK-124가 받는다. 이 기기에서 실제로 껐다 켜 보는 걸음은 이 세션이 하지
못했다 — 세션 자신이 그 서비스가 띄운 프로세스라, 내리면 그 자리에서 죽고 다시 올릴 세션이 없다.

## 확인 동선

**볼 화면이 없는 작업이다.** 이번에 선 것은 앱 안쪽의 실행 경로 하나이고, 버튼은 TASK-124가 만든다.
지금 앱을 띄워도 연동 탭은 어제와 같다. 그래서 이 작업은 자동 검사로 닫았고, 확인 도장은 **아래
숫자를 믿는다**는 뜻이 된다. 다만 마지막 3번은 사용자만 할 수 있는 확인이다.

### 1. 검사 두 개를 다시 돌린다

```sh
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

**정상이면 앞엣것이 538 passed / 0 failed / 0 ignored, 뒤엣것이 22 files / 646 tests passed다.**
이 세션이 넘길 때의 값이고, 다른 세션이 그 사이에 검사를 더했으면 숫자는 늘 수 있다. 늘어도
`failed`가 0이면 정상이다. 프론트엔드는 이 작업에서 한 줄도 바뀌지 않았다.

### 2. 이 작업이 새로 만든 검사만 돌려 본다

```sh
cargo test --manifest-path src-tauri/Cargo.toml -- launchctl
cargo test --manifest-path src-tauri/Cargo.toml -- heartbeat_service_control
```

**정상이면 둘 다 `9 passed` / `0 failed`다.** 앞의 아홉이 두 명령의 인자 모양과 명령 원문에 빈칸이
없음과 0이 아닌 종료 코드가 실패로 접히지 않음을 고정하고, 뒤의 아홉이 대상 미확정 넷에서 프로세스가
뜨지 않음과 결과 여섯 갈래와 쓰기 없음을 고정한다.

### 3. 앱이 낼 명령이 이 기기에서 실제로 맞는지 (사용자 확인)

**이 세션이 하지 못한 확인이다.** 이 세션은 그 데몬이 띄운 프로세스라, 내리는 명령을 돌리면 그
자리에서 죽고 다시 올리는 걸음이 남지 않는다(작업 문서 검증 절차 8이 경계한 상태다).

앱이 이 기기에서 조립할 명령은 아래 둘이다. uid 501과 라벨·경로는 이 세션이 실측한 값이다.

```sh
launchctl bootout gui/501/com.catze.dream-heartbeat
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.catze.dream-heartbeat.plist
```

터미널에서 위 두 줄을 차례로 쳐 보면 된다. **정상이면 첫 줄 뒤 `launchctl list | grep dream-heartbeat`
에서 항목이 사라지고, 둘째 줄 뒤 다시 나타난다.** 사이에 `~/.claude/heartbeat/heartbeat.pid`가 남아
있을 수 있는데 그것도 정상이다 — 앱의 실행 여부 판정이 그 파일 하나이고, 결과 값이 데몬 상태를
단정하지 않는 이유가 바로 그 한계다(기획서 R7).

**반드시 둘째 줄까지 치고 끝낸다.** 내린 채로 두면 다음 세션이 깨어나지 않는다.

이미 실측한 것이 하나 있다. 이미 올라가 있는 서비스에 둘째 줄을 쳐 보면 종료 코드 5와
`Bootstrap failed: 5: Input/output error`가 나오고 데몬은 그대로 돈다. 앱은 이 값을 실패로 접지
않고 코드와 원문 그대로 싣는다 — 그것이 이 작업의 완료 조건 8이다.

## 이 작업이 닫는 것

SPEC-036 R1(실행 어법)·R4(대상 확정)·R5(사유 구분과 명령 원문)·R7(확인한 것까지만)·R8(등록물을
건드리지 않음)의 백엔드다. 기획서 완료 조건 2·8·10·13·15의 백엔드 절반이 여기서 선다.

## 실행 모듈

새 모듈 `src-tauri/src/infrastructure/launchctl.rs`가 소유한다. `heartbeat_process.rs`에 얹지
않는다 — 그 모듈은 머리주석부터 "하트비트 실행 파일 후보 해석과 프로세스 실행"이고, 후보 탐색
규약(PATH → `~/.local/bin`)이 `heartbeat`에만 성립한다. `launchctl`은 후보가 없다.

지키는 선은 `heartbeat_process.rs`의 것을 그대로 잇는다. 머리주석에 그 사실과 위의 "실행 파일이
둘이 됐다"는 사실을 함께 적는다.

- **셸을 거치지 않는다.** `std::process::Command`로 직접 띄운다. `$(id -u)` 같은 셸 확장을 쓰지
  않는다.
- **인자는 백엔드에서만 만든다.** 화면이 준 문자열이 명령줄에 이어 붙는 경로가 없다. 인자에 들어가는
  값 중 상수가 아닌 것은 둘뿐이고 둘 다 앱이 자기 파일 시스템에서 읽은 값이다 — TASK-122가 낸
  라벨과 plist 경로다.
- **표준 입력을 닫고 stdout·stderr·종료 코드를 함께 받아 온다.** `run_capturing`과 같은 이유다 —
  실패 사유가 stderr에 있고 그것을 버리면 R5가 요구하는 구분이 불가능하다.
- **0이 아닌 종료 코드는 실행 실패가 아니다.** `bootout`은 로드되지 않은 서비스에 대해, `bootstrap`은
  이미 로드된 서비스에 대해 0이 아닌 코드로 끝난다. 그 값이 결과에 실려야 R7의 "확인한 것까지만"이
  성립한다. 실패로 접으면 사유가 사라진다.

### 두 조작

- 내리기: `launchctl bootout gui/<uid>/<라벨>`
- 올리기: `launchctl bootstrap gui/<uid> <plist 경로>`

`<uid>`는 사용자 홈 디렉터리의 소유자 uid로 얻는다(`std::os::unix::fs::MetadataExt::uid`). 프로세스를
하나 더 띄워 `id -u`를 부르지 않고, 셸 확장도 쓰지 않는다. unix 갈래에서만 컴파일되는 자리이므로
`#[cfg(unix)]`로 가른다 — 최근 커밋이 Windows clippy 때문에 `TempDir` import를 unix로 가른 것과
같은 어법이다.

`stop`이나 `kill`을 쓰지 않는다. 데몬의 `heartbeat stop`은 pid에 SIGTERM을 보내는 것이고 이 기기의
plist는 `KeepAlive`가 참이라 launchd가 곧바로 다시 띄운다(확인 사실 7). `uninstall-service`도 쓰지
않는다 — 표준 라벨 plist 하나만 지우므로 이 기기에서 아무 일도 하지 않고, 등록 해제는 일시 정지가
아니다(확인 사실 9, R8).

### 사용자가 그대로 칠 명령 원문

R5의 마지막 항목이자 완료 조건 10이다. **원문에 빈칸이 없어야 한다.** 지금 갱신 안내가
`launchctl kickstart -k gui/$(id -u)/<라벨>`로 `<라벨>`을 글자 그대로 내미는 것이 이 요구가 막는
상태다(확인 사실 4).

- 원문은 실제로 띄울 인자 목록에서 만든다. 인자 목록과 원문이 갈리는 자리를 만들지 않는다
  (`manual_command_for`가 같은 어법의 선례다).
- 라벨과 plist 경로가 채워진 완성 문자열이다. `<uid>`도 숫자로 채운다.
- 대상이 확정되지 않은 상태에서는 원문을 만들지 않는다. 채울 값이 없는데 만들면 그것이 빈칸이다.

`heartbeat_update.rs`의 다섯 상수는 **바꾸지 않는다.** 갱신 안내는 SPEC-037·SPEC-034의 자리이고
기획서 제외 범위이며, 완료 조건 18이 "업데이트의 기존 동작이 달라지지 않는다"를 요구한다. 같은
무지의 다른 얼굴이라는 것은 기획서가 기대효과에 적어 두었고, 그 자리를 이 작업이 넘지 않는다.

## 조작 서비스

새 모듈 `src-tauri/src/application/heartbeat_service_control.rs`가 판정과 결과 타입을 소유한다.
`heartbeat_update_service.rs`·`heartbeat_setup_run_service.rs`가 같은 자리에 있는 선례다.

순서는 하나다. **대상을 확정한다 → 확정되지 않으면 프로세스를 띄우지 않는다 → 확정됐으면 띄운다.**

R4가 "대상을 확정하지 못하면 조작하지 않는다. 확정하지 못한 채 표준 이름으로 시도하는 경로를 만들지
않는다"고 못박은 자리다. 상수 `com.claude-heartbeat`을 대상으로 삼는 갈래가 이 모듈에 없어야 한다.

결과는 다음을 서로 다른 값으로 구분한다. 앞 넷은 TASK-122의 판정을 그대로 옮긴 것이고, 프로세스를
띄우지 않은 채 끝난다.

1. 등록물 없음
2. 대상 모호 — 찾은 plist 경로를 함께 담는다
3. 이 플랫폼이 아님
4. 이름을 읽지 못함 — 읽지 못한 경로를 담는다
5. **실행 수단 없음** — `launchctl`을 띄우지 못했다. 사유(파일 없음·권한 등)와 함께 사용자가 그대로
   칠 명령 원문을 담는다. 기획서 R5는 이 상태를 `heartbeat` 실행 파일의 후보 탐색 실패로 적었지만,
   확인 필요 1번이 승인되면서 조작 수단이 `launchctl`로 정해졌으므로 이 경로에서 그 상태는
   "`launchctl`을 띄우지 못함"으로 실현된다. 상태가 없어지는 것이 아니라 실현 방식이 바뀌는 것이고,
   R5가 요구하는 "넷을 뭉뚱그리지 않는다"는 그대로다.
6. **실행했음** — 종료 코드·stdout·stderr 원문과 실제로 쓴 라벨·plist 경로를 담는다.

### 6번이 "꺼졌습니다"가 아닌 이유

R7이다. 명령이 성공했다는 것과 데몬이 실제로 내려갔다는 것은 다른 사실이다. 앱의 실행 여부 판정은
pid 파일 존재 하나이고(확인 사실 1) 그 한계는 코드 주석이 이미 인정하고 있다.

- 결과 값은 **명령이 어떻게 끝났는가**까지만 말한다. 데몬 상태를 단정하는 필드를 만들지 않는다.
- 종료 코드를 뜻으로 번역하지 않는다. `bootout`의 "No such process"와 `bootstrap`의 "already
  loaded"는 launchctl이 stderr로 말하는 것이고, 앱이 그 문장을 자기 어휘로 옮기면 옮긴 만큼이
  지어낸 것이 된다. 숫자와 원문을 그대로 싣고 화면이 말한다.
- `heartbeat status`를 부르지 않는다. 그 출력 형식은 계약이 아니다(확인 사실 12, 완료 조건 14).
- 데몬 상태 표시는 조회 주기가 `installation_of`로 따라온다. 그 늦음은 정상이고, 이 결과가 그것을
  앞질러 단정하지 않는 것이 R7의 요구다.

## 커맨드

`commands/heartbeat.rs`에 커맨드 하나를 더하고 `lib.rs`의 `invoke_handler`에 등록한다.

- 인자는 조작 식별자 하나다(`app` 제외). `run_heartbeat_setup_step`이 단계 식별자 하나를 받는 것과
  같은 모양이고, 식별자는 백엔드 상수의 고정 인자로 옮겨진다. 상수에 없는 식별자는 프로세스를 띄우지
  않고 실패로 끝난다.
- `path`를 받지 않는다. 데몬은 기기 하나에 하나라 프로젝트와 무관한 조작이다(확인 사실 14).
- `async` + `tauri::async_runtime::spawn_blocking`. `bootout`은 데몬이 내려갈 때까지 걸린다.
- **스냅샷을 돌려주지 않는다.** 실행 결과만 돌려주고 상태 갱신은 화면이 `inspect_integrations`를
  다시 부르는 것으로 얻는다. `run_heartbeat_setup_step`이 같은 이유로 같은 모양이고, 데몬 상태의
  원천을 둘로 만들지 않는 것이 R7의 "모순된 두 상태를 동시에 말하지 않는다"이다.
- 앱은 이 경로에서 **어떤 파일도 쓰지 않는다.** 특히 `~/Library/LaunchAgents`에 쓰거나 지우지
  않는다(R8). lease 파일도 읽지도 쓰지도 않는다 — 남의 lease에 손대는 것은
  `.workflow/rules/workflow.md` §4가 금한다(R3).
- 사용자가 확인 화면에서 누른 자리에서만 불린다는 것을 머리주석에 적는다. 조회 주기·화면 진입에서
  부르지 않는다.

## 완료 조건

1. 내리기가 `launchctl bootout gui/<uid>/<라벨>`로, 올리기가
   `launchctl bootstrap gui/<uid> <plist 경로>`로 나간다. 라벨과 경로는 TASK-122가 읽어 낸 값이고
   상수가 아니다. (완료 조건 2·R1)
2. 셸을 거치지 않고 인자가 고정이다. 화면이 준 문자열이 인자로 흘러가는 경로가 없다. 커맨드가 받는
   값에 명령 조각이 없다. (R1)
3. `<uid>`가 프로세스를 띄우지 않고 얻어진다. `id -u`를 부르는 코드가 없다.
4. 대상이 확정되지 않은 다섯 갈래 중 앞 넷에서 프로세스가 뜨지 않는다. 표준 라벨
   `com.claude-heartbeat`을 대신 시도하는 갈래가 없다. (R4·완료 조건 8)
5. 결과가 여섯 갈래로 구분된다. 어느 둘도 같은 값으로 접히지 않는다. (R5·완료 조건 9)
6. 실행 수단 없음일 때 사유와 함께 사용자가 그대로 칠 명령 원문이 실리고, 그 원문에 `<라벨>`·
   `<uid>`·`<plist 경로>` 같은 빈칸이 없다. (R5·완료 조건 10)
7. 대상이 확정되지 않은 갈래에서는 명령 원문을 만들지 않는다.
8. 0이 아닌 종료 코드가 실행 실패로 접히지 않고 stdout·stderr 원문과 함께 결과에 실린다.
9. 결과 값에 데몬 상태를 단정하는 필드가 없다. 종료 코드를 뜻으로 번역하는 표가 없다. (R7·완료 조건 13)
10. `heartbeat` 실행 파일을 부르는 코드가 이 변경분에 없고, `heartbeat status`의 출력을 파싱하는
    코드도 없다. (완료 조건 14)
11. `heartbeat_update.rs`의 다섯 상수와 그 테스트가 변경 전과 같다. (완료 조건 18)
12. 이 경로에서 앱이 파일을 쓰지 않는다. `~/Library/LaunchAgents`에 쓰기·지우기가 없고 lease 파일
    접근도 없다. (R3·R8·완료 조건 15)
13. 설치 마법사의 단계 상태가 이 커맨드의 성공·실패로 달라지지 않는다. 이 커맨드가 스냅샷을
    돌려주지 않는 것과 `setup_stages`를 만지지 않는 것이 그 근거다. (완료 조건 11)
14. 기존 자동 검사가 삭제되거나 비활성화되지 않고, `npm run check`와
    `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다. (완료 조건 19·20)

## 검증 절차

1. `cargo test --manifest-path src-tauri/Cargo.toml`.
2. 인자와 후보 확인은 `heartbeat_process.rs`의 recorder 스크립트 어법(받은 인자를 파일에 적고
   끝나는 셸 스크립트)을 그대로 쓴다. 실제 `launchctl`을 부르지 않는다 — 개발 기기의 도는 데몬을
   테스트가 내리면 안 된다.
3. 실행 경로 픽스처 넷 — 종료 코드 0, 0이 아닌 코드와 stderr, 실행 파일 없음, 실행 권한 없음.
4. 대상 미확정 넷은 TASK-122가 낸 판정 값을 직접 넣어 세운다. 그 갈래에서 recorder가 호출되지
   않았음(인자 파일이 생기지 않았음)을 단정한다.
5. 명령 원문 검사는 문자열을 직접 확인한다. `<`가 들어 있지 않은 것을 단정한다 —
   `heartbeat_update.rs`의 `no_command_carries_a_value_the_app_cannot_know`가 반대 방향으로 같은
   검사를 하는 선례다.
6. 쓰기 없음은 실행 전후 디렉터리 스냅샷 비교로 확인한다. 대상은 사용자 홈과 하트비트 홈이다.
7. `npm run check`.
8. 이 기기에서 커맨드를 실제로 한 번씩 불러 본 결과를 보고서에 적는다. 데몬이 실제로 내려갔다가
   올라오는지, 종료 코드가 무엇이었는지, 그 사이 `daemon_running`이 어떻게 바뀌었는지가 이 작업의
   실물 확인이다. **다시 올리는 것까지 확인하고 끝낸다** — 내린 채로 두면 다음 세션이 깨어나지
   않는다.

## 범위 파일

- `src-tauri/src/infrastructure/launchctl.rs` — 새 모듈. 고정 인자 실행과 명령 원문.
- `src-tauri/src/infrastructure/mod.rs` — 모듈 등록.
- `src-tauri/src/application/heartbeat_service_control.rs` — 새 모듈. 판정·순서·결과 타입.
- `src-tauri/src/application/mod.rs` — 모듈 등록.
- `src-tauri/src/commands/heartbeat.rs` — 커맨드 하나.
- `src-tauri/src/lib.rs` — `invoke_handler` 등록.

`launch_agents.rs`는 부르기만 하고 고치지 않는다. `heartbeat_process.rs`·`heartbeat_update.rs`·
`heartbeat_setup.rs`·`domain/project.rs`와 프론트엔드는 범위 밖이다. 결과 타입은 서비스 모듈에 둔다.

## 선행

- `TASK-122` — 이 작업이 조작할 대상(라벨과 plist 경로)을 읽어 내는 작업. 그 판정 없이는 무엇을
  `bootout`할지가 정해지지 않고, R4가 금한 "표준 이름으로 시도"밖에 남지 않는다.
  `infrastructure/mod.rs`를 두 작업이 함께 만지므로 순서도 여기서 정해진다.
