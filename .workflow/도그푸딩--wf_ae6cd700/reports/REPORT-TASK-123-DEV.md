# TASK-123 개발자 핸드오프 (qa_waiting)

## 결정권자 요약

커밋 컷마다 손으로 치던 두 명령을 앱 안쪽이 대신 실행할 수 있게 됐다. 앱이 이 기기에서 직접 읽어 낸
서비스 이름과 등록물 경로로 명령이 조립되고, 셸을 거치지 않으며 화면이 준 문자열이 명령에 닿지 않는다.

대상을 확정하지 못하면 아무것도 실행하지 않는다. 등록물 없음·대상 모호·이 플랫폼 아님·읽지 못함 넷에서
프로세스가 뜨지 않고, 앱이 내장한 이름으로 대신 시도하는 길도 없다. 결과는 명령이 어떻게 끝났는지까지만
말하고 데몬이 내려갔다고 단정하지 않는다.

버튼은 아직 없다. 화면은 TASK-124가 받으므로 이번 확인은 검사 숫자를 믿는 일이 된다. 다만 이 기기에서
실제로 껐다 켜 보는 걸음은 하지 못했다 — 이 세션 자신이 그 서비스가 띄운 프로세스라 내리면 그 자리에서
죽는다. 그 한 걸음이 사용자 몫으로 남는다.

---

- 대상: TASK-123 (앱이 launchctl로 등록된 서비스를 내리고 다시 올린다)
- 근거: SPEC-036 R1·R4·R5·R7·R8 / DECISION-3D9A30F2 (`schema: workflow-labs/decision@1`,
  `spec_id: SPEC-036`, `outcome: approved`, `created_by: user`,
  `created_at: 2026-08-05T06:52:32.742176+00:00`) — 이 세션 시점에도 SPEC-036의 유일한 결정이다.
- 세션: 2026-08-05T14:11Z~14:45Z. 죽은 세션 인수 아님(`todo`에서 집었다).
- 선점: `sh .workflow/rules/wf-claim.sh acquire TASK-123 developer-claude 45` → exit 0,
  `lease_id: lease-71482-20260805141122`. 작업 중 `renew` 2회(전부 exit 0), 종료 시 `release`.
- 기기: Apple Silicon / macOS (arm64). 설치된 rustc 타깃은 `aarch64-apple-darwin` 하나다.

## 선택 경위

`sh .workflow/rules/wf-eligible.sh developer` → `eligible`/0. 미완료 11건 중 `qa_waiting` 여섯
(119·120·121·122·125·127), `todo` 다섯(123·124·126·128·129). 선행 충족은 셋이다 — TASK-123
(122 `qa_waiting`), TASK-126(125 `qa_waiting`), TASK-128(120·121·127 전부 `qa_waiting`). TASK-124는
123이, TASK-129는 128이 `todo`라 미충족이다. `in_progress` 0건이라 인수 대상이 없었고, lease 파일은
`SPEC-009.yml` 하나뿐인데 `expires_at: 2026-08-03T01:20:00Z`로 이미 만료라 겹침으로 막힌 작업도 없었다.

셋 중 TASK-123을 집었다. 선행이 방금 착지한 TASK-122의 값을 쓰는 자리이고, 이 작업이 풀려야 TASK-124가
열린다. 계약이 순서를 정하지 않는 구간이므로 판단이다.

## 바꾼 것

범위 파일 여섯 전부를 손댔고 범위 밖 파일은 열지 않았다.

### 1. 새 모듈 — 고정 인자 실행 (R1)

`src-tauri/src/infrastructure/launchctl.rs` (신규). `heartbeat_process.rs`에 얹지 않은 이유를 머리주석에
적었다 — 그 모듈은 후보 탐색 규약(PATH → `~/.local/bin`)을 가지고 있고 그 규약이 `heartbeat`에만
성립하며 `launchctl`은 후보가 없다. 같은 주석이 **앱이 부르는 실행 파일이 둘이 됐다**는 사실과, 그래서
"임의의 명령을 조립하지 않는다"의 근거가 인자 고정 하나로 옮겨졌다는 사실을 함께 적는다(확인 필요 1번의
승인된 한계).

공개 표면은 다섯이다.

| 함수 | 하는 일 |
| --- | --- |
| `program()` | 띄울 실행 파일(`launchctl`). 검사가 다른 실행 파일을 넣을 수 있게 함수로 낸다 |
| `arguments(operation, uid, label, plist_path)` | 조작 하나의 인자 목록 |
| `manual_command(&arguments)` | 그 인자 목록에서 만든 명령 원문 |
| `user_uid(user_home)` | 홈 소유자 uid. 프로세스를 띄우지 않는다 |
| `run(program, &arguments)` | 한 번 띄우고 종료 코드·stdout·stderr를 함께 받아 온다 |

- **두 조작.** 내리기가 `bootout gui/<uid>/<라벨>`, 올리기가 `bootstrap gui/<uid> <plist 경로>`다.
  `stop`·`kill`·`uninstall-service`를 쓰지 않는 이유(확인 사실 7·9, R8)를 상수 주석에 적었다.
- **uid는 프로세스 없이 얻는다.** `std::os::unix::fs::MetadataExt::uid`이고 `id -u`를 부르는 코드가
  이 변경분에 없다. `#[cfg(unix)]`로 갈라 두고 unix 아닌 갈래는 `None`을 돌려준다 — 대상 해석이 macOS
  밖에서 이미 멈추므로 그 값이 쓰이는 경로가 없다(R9).
- **원문은 인자 목록에서만 나온다.** 인자와 원문이 갈리는 자리를 만들지 않는다
  (`manual_command_for`가 같은 어법의 선례다).
- **0이 아닌 종료 코드가 실패가 아니다.** 실패는 "띄우지 못했다" 하나이고 `std::io::Result`로 나간다.

### 2. 새 모듈 — 판정·순서·결과 (R4·R5·R7)

`src-tauri/src/application/heartbeat_service_control.rs` (신규). 순서가 하나다 — 대상을 확정한다 →
확정되지 않으면 프로세스를 띄우지 않는다 → 확정됐으면 띄운다. 상수 `com.claude-heartbeat`을 대상으로
삼는 갈래가 이 모듈에 없다.

결과는 여섯이고 어느 둘도 같은 값으로 접히지 않는다.

| 값 | 프로세스 | 담는 것 |
| --- | --- | --- |
| `NotRegistered` | 뜨지 않음 | — |
| `Ambiguous` | 뜨지 않음 | 찾은 plist 경로 전부 |
| `UnsupportedPlatform` | 뜨지 않음 | — |
| `Unreadable` | 뜨지 않음 | 읽지 못한 경로 |
| `NotRun` | 띄우지 못함 | 사유 + 사용자가 그대로 칠 명령 원문 |
| `Ran` | 띄웠고 끝남 | 종료 코드, stdout, stderr, 실제로 쓴 라벨·plist 경로 |

**`Unreadable`이 uid 실패도 받는다.** 라벨과 경로를 알아도 도메인을 만들지 못하면 대상이 확정되지 않은
것이다. 이 자리에서 uid를 지어내거나 생략한 명령을 만들면 그것이 곧 R5가 막는 빈칸이 된다. 값이 못 읽은
경로를 담으므로 화면은 등록물 쪽 실패와 구분할 수 있다.

**`Ran`에 성공·실패 필드가 없다.** `HeartbeatSetupRun::Ran`이 가진 `succeeded`를 여기서는 두지 않았다 —
`bootout`은 로드되지 않은 서비스에, `bootstrap`은 이미 로드된 서비스에 0이 아닌 코드로 끝나므로 0/비0을
성공/실패로 옮기는 것 자체가 R7이 금한 번역이다. 숫자와 원문을 그대로 싣고 뜻은 화면이 말한다.

**아는 조작은 둘뿐이다.** 식별자(`stop`·`start`)는 이 모듈의 상수이고, 그 밖의 값은 대상을 읽지도
프로세스를 띄우지도 않고 오류로 끝난다. 결과 여섯에 일곱째를 더하지 않기 위해 조작 아님은 결과가 아니라
오류로 두었다(완료 조건 5의 "여섯 갈래").

### 3. 커맨드 하나 (완료 조건 11·13)

`commands/heartbeat.rs`에 `control_heartbeat_service`를 더하고 `lib.rs`의 `invoke_handler`에 등록했다.
`run_heartbeat_setup_step`과 같은 모양이다.

- 인자는 조작 식별자 하나(`app` 제외). `path`를 받지 않는다 — 데몬은 기기 하나에 하나라 프로젝트와 무관한
  조작이다(확인 사실 14).
- `async` + `spawn_blocking`. `bootout`은 데몬이 내려갈 때까지 걸린다.
- **스냅샷을 돌려주지 않는다.** 실행 결과만 돌려주고 상태 갱신은 화면이 `inspect_integrations`를 다시
  부르는 것으로 얻는다. 데몬 상태의 원천을 둘로 만들지 않는 것이 R7이다.
- `setup_stages`를 만지지 않는다. 이 커맨드의 성공·실패가 설치 마법사 단계 상태에 닿는 경로가 없다.
- 사용자가 확인 화면에서 누른 자리에서만 불린다는 것을 머리주석에 적었다.

### 4. 검사 열여덟

| 파일 | 수 | 무엇을 고정하나 |
| --- | --- | --- |
| `launchctl.rs` | 9 | 두 조작의 인자 모양, 명령 원문의 출처와 빈칸 없음, 0이 아닌 코드가 결과인 것, 띄우지 못하는 두 얼굴(파일 없음·실행 권한 없음), uid 출처 |
| `heartbeat_service_control.rs` | 9 | 승인된 명령으로 나가는 것, 대상 미확정 넷에서 프로세스가 뜨지 않는 것, 결과 여섯 구분, 원문에 빈칸 없음, 데몬 상태 단정 없음, 모르는 식별자, 쓰기 없음, 직렬화 계약 |

- 실행 검사는 전부 **recorder 스크립트**(받은 인자를 파일에 적고 끝나는 셸 스크립트)로 세웠다. 실제
  `launchctl`을 부르는 검사는 0건이다 — 개발 기기의 도는 데몬을 검사가 내리면 안 된다.
- 대상 미확정 넷은 TASK-122가 낸 판정 값을 직접 넣어 세웠고, **recorder가 남겼을 인자 파일이 생기지
  않았음**을 단정한다. 이것이 "표준 이름으로 대신 시도하지 않는다"의 검사 형태다.
- 명령 원문 검사는 `<`가 들어 있지 않은 것을 단정한다
  (`heartbeat_update.rs`의 `no_command_carries_a_value_the_app_cannot_know`가 반대 방향의 선례다).
- 데몬 상태 단정 없음은 직렬화된 객체의 **키 집합**을 고정해 확인한다. 종료 코드 0인 결과와 3인 결과가
  같은 키를 가지므로 성공·실패를 옮긴 필드가 낄 자리가 없다.
- 쓰기 없음은 실행 전후 사용자 홈·하트비트 홈의 목록 비교다(`heartbeat_setup_run_service.rs`의 어법).

## 실물 확인 (검증 절차 8) — 절반만 했고, 나머지는 사용자 몫이다

작업 문서는 "이 기기에서 커맨드를 실제로 한 번씩 불러 보고 데몬이 내려갔다 올라오는지, 그 사이
`daemon_running`이 어떻게 바뀌는지"를 적으라고 했다. **그 절반을 하지 못했다.**

이유는 이 세션의 처지다. 프로세스 계보가 이렇다.

```
875   1     dream-heartbeat start --foreground   ← launchctl이 띄운 서비스
69261 875   claude -p 개발자 역할로 진행해줘 ...  ← 이 세션
83261 69261 /bin/zsh -c ...                      ← 이 세션이 명령을 돌리는 셸
```

`launchctl bootout gui/501/com.catze.dream-heartbeat`은 그 잡의 프로세스를 전부 내린다. **이 세션이 그
잡 안에 있으므로 명령을 돌리는 순간 세션이 죽고, 다시 올리는 걸음이 남지 않는다.** 작업 문서가 "다시
올리는 것까지 확인하고 끝낸다 — 내린 채로 두면 다음 세션이 깨어나지 않는다"고 경계한 바로 그 상태이고,
기획서 기대효과가 든 TASK-104 고아 사례와 같은 모양이다. 그래서 돌리지 않았다.

**안전한 쪽은 실측했다.** 이미 올라가 있는 서비스에 올리는 명령을 그대로 쳤다.

```
$ ls ~/Library/LaunchAgents/ | grep -i heartbeat   → com.catze.dream-heartbeat.plist (1건)
$ stat -f "%u" ~                                   → 501
$ launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.catze.dream-heartbeat.plist
Bootstrap failed: 5: Input/output error
Try re-running the command as root for richer errors.
EXIT=5
$ launchctl list | grep dream-heartbeat            → 875  0  com.catze.dream-heartbeat (그대로 돈다)
$ ls -la ~/.claude/heartbeat/heartbeat.pid         → 그대로 있다
```

읽을 값 셋이 있다.

1. **앱이 조립할 인자가 이 기기의 실제와 맞다.** uid 501, 라벨 `com.catze.dream-heartbeat`,
   plist 경로 하나. TASK-122가 실측한 값과 같고, 이 세션의 검사가 고정한 인자 모양과도 같다.
2. **0이 아닌 종료 코드가 정상 경로에서 나온다.** 코드 5와 stderr 한 줄이고, 이것을 실행 실패로 접으면
   사유가 통째로 사라진다. 완료 조건 8이 요구한 설계가 실제 값으로 확인된 자리다.
3. **`bootstrap`은 이미 올라간 서비스를 건드리지 않는다.** 데몬은 계속 돌고 pid 파일도 그대로다.

`bootout` 쪽은 사용자만 할 수 있다. 작업 문서의 `## 확인 동선` 3번에 그대로 칠 두 줄과 기대값을 적어
두었다.

## 게이트 (완료 조건 14)

| 검사 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **통과** — 538 passed, 0 failed, 0 ignored |
| `npm run check` | **통과** — 22 files, 646 tests passed, build ok |
| `cargo clippy --all-targets -- -D warnings` | 경고·오류 0건 |
| `rustfmt --check` (새 파일 둘) | 차이 0건 |

착지 전 520건이었으니 이 세션이 18건을 더했다. 프론트엔드는 한 줄도 바뀌지 않았고 646건이 그대로
통과한다. 삭제하거나 `#[ignore]`를 붙인 검사는 0건이다(완료 조건 14의 앞 절).

### 다른 플랫폼

이 저장소는 Windows clippy까지 굴린다. `#[cfg(unix)]`로 갈린 자리마다 그 갈래에서만 쓰이는 import를 같은
조건으로 갈라 두었다 — `launchctl.rs`의 `PathBuf`·`Executed`, `heartbeat_service_control.rs`의
`launchctl`·`STOP`·`START`. unix 아닌 갈래에도 uid 검사 하나를 두어 그쪽 함수가 검사 없이 남지 않게 했다.
**이 기기에 macOS 타깃만 있어 실제 컴파일은 확인하지 못했다**(리스크 1번).

## 하지 않은 것 (완료 조건 10·11·12)

- **`heartbeat` 실행 파일을 부르지 않는다.** 이 변경분에 그 실행 파일을 띄우는 코드가 없고,
  `heartbeat status`의 출력을 파싱하는 코드도 없다.
- **`heartbeat_update.rs`를 열지 않았다.** 다섯 상수와 그 검사가 변경 전과 같다. 갱신 안내의 `<라벨>`
  빈칸은 그대로 남아 있고 그것은 SPEC-037·SPEC-034의 자리다(기획서 제외 범위, 완료 조건 18).
- **파일을 쓰지 않는다.** `~/Library/LaunchAgents`에 쓰기·지우기가 없고 lease 파일 접근도 없다.
- **설치 마법사를 건드리지 않는다.** `heartbeat_setup.rs`·`setup_stages`를 열지 않았고, 이 커맨드는
  스냅샷을 돌려주지 않는다.
- 버튼과 고지 문구는 만들지 않았다. 프론트엔드는 TASK-124의 몫이다.

## 변경 파일

| 파일 | 성격 |
| --- | --- |
| `src-tauri/src/infrastructure/launchctl.rs` | 범위 파일. 신규 |
| `src-tauri/src/infrastructure/mod.rs` | 범위 파일. 모듈 등록 1줄 |
| `src-tauri/src/application/heartbeat_service_control.rs` | 범위 파일. 신규 |
| `src-tauri/src/application/mod.rs` | 범위 파일. 모듈 등록 1줄 |
| `src-tauri/src/commands/heartbeat.rs` | 범위 파일. 커맨드 하나 + import |
| `src-tauri/src/lib.rs` | 범위 파일. `invoke_handler` 1줄 |
| `.workflow/.../tasks/TASK-123.md` | 상태·이력·요약 갱신, `## 확인 동선` 신설 |
| `.workflow/.runtime/leases/TASK-123.yml` | 선점 헬퍼가 쓴 lease |

여기에 이 보고서와 개발 로그 항목이 더해진다. 선점 시각 이후 수정된 파일을 `find -newermt`로 세어 위
목록과 정확히 일치하는 것을 확인했다. 작업 트리에는 이 세션 전부터 다른 작업들의 미커밋 변경이 40여
파일에 걸쳐 있었고, 위 목록은 그것과 이 세션의 몫을 가른 것이다.

## 남는 리스크

1. **다른 플랫폼의 컴파일을 실측하지 못했다.** 이 기기에 `aarch64-apple-darwin` 타깃만 있다.
   `#[cfg]`로 갈린 자리 다섯이 그 대상이고 미사용 경고가 남지 않게 갈라 두었으나 확인은 CI가 한다.
   TASK-122 보고서의 같은 리스크와 같은 자리다.
2. **내리는 명령의 실물 확인이 남아 있다.** 위에 적은 이유로 이 세션이 하지 못했고, 사용자가 확인 동선
   3번을 밟거나 TASK-124가 착지해 앱에서 누를 때 처음 확인된다. 코드 경로 자체는 recorder로 고정돼
   있지만, 실제 `launchctl`이 `bootout`에 무엇을 답하는지는 실측되지 않은 값이다.
3. **`Label`이 빈 문자열이면 그대로 인자가 된다.** TASK-122 보고서가 남긴 리스크 2번을 이 작업이 받았다.
   판정이 확정으로 읽으므로 `gui/501/`이 대상이 되고, launchd가 빈 라벨 등록을 받지 않아 실존하기
   어렵지만 이 작업이 막는 자리는 아니다 — 판정은 TASK-122의 몫이고 결과 여섯에 일곱째를 더하는 것이
   완료 조건 5와 어긋난다.
4. **읽는 시점과 조작 시점의 간극.** TASK-122가 남긴 물음에 이 작업은 "누를 때 다시 읽는다"로 답했다.
   커맨드가 조회 주기의 값을 받지 않고 자기가 해석한다. 대신 화면이 보여준 대상과 실제로 조작한 대상이
   다를 수 있으므로, `Ran`이 **실제로 쓴 라벨과 plist 경로**를 함께 싣는다. 화면이 그 값을 보여주면 그
   간극이 사용자에게 읽힌다 — TASK-124가 정할 자리다.
5. **모호 상태에서 앱과 데몬의 판단이 갈린다.** 앱은 거부하고 데몬의 `detect()`는 하나를 고른다(확인
   필요 3번의 승인된 한계). 이 기기는 등록물이 하나라 지금 그 상태가 아니다.

## 후속 (역할 밖 발견)

1. **`commands/heartbeat.rs`에 이 세션 것이 아닌 포맷 차이가 하나 있다.** `check_heartbeat_versions`의
   `spawn_blocking` 줄이고, 이 세션이 열지 않은 함수다. TASK-122 보고서가 후속 2번으로 이미 적은 자리와
   같은 파일이다. 범위 밖 줄이라 손대지 않았다 — **커밋 컷 전에 누군가 `cargo fmt`를 한 번 돌려야
   한다.**
2. **TASK-124가 결과 여섯을 문구 여섯으로 옮겨야 한다.** 백엔드는 값만 갈라 두었고 사용자가 읽을 문장은
   만들지 않았다. 특히 `Ran`은 "꺼졌습니다"가 아니라 "명령이 이렇게 끝났습니다"로 읽혀야 한다(R7,
   완료 조건 13). 종료 코드와 stderr 원문을 화면이 그대로 보이는 것이 앱이 지어내지 않는 방법이다.
3. **켜기 뒤 데몬 상태 표시는 늦게 따라온다.** 판정이 pid 파일 하나이고 조회 주기를 탄다. 그 늦음이
   정상이라는 것과, 그동안 화면이 모순된 두 상태를 동시에 말하지 않는 것이 TASK-124의 자리다.

## 사용자 QA 제안

작업 문서의 `## 확인 동선`에 셋을 적어 두었다. 1·2번은 이 세션이 이미 돌린 검사를 다시 돌리는 것이고,
**3번은 이 세션이 할 수 없어 사용자에게 남긴 실물 확인**이다. 터미널에서 두 줄을 차례로 치고 그 사이
`launchctl list`가 어떻게 바뀌는지 보는 일이며, 둘째 줄까지 반드시 치고 끝내야 한다 — 내린 채로 두면
다음 세션이 깨어나지 않는다.

화면에서 버튼으로 하는 확인은 TASK-124가 착지한 뒤에 온다.
