# TASK-122 개발자 핸드오프 (qa_waiting)

## 결정권자 요약

앱이 이 기기에 등록된 하트비트 서비스의 이름을 처음으로 읽어 냈다. 실측값은 앱이 내장 상수로 알던
이름이 아니라 이 기기가 실제로 쓰는 이름이었고, 그 값을 앱이 조회 결과에 실어 나른다.

확정하지 못하는 경우도 함께 갈랐다. 등록물이 없는 것, 등록물이 여럿이라 대상이 모호한 것, 이
플랫폼이 아닌 것, 읽어야 할 것을 읽지 못한 것 넷이 서로 다른 값이다. 특히 못 읽은 것을 "없음"으로
접지 않았고, 이름을 읽지 못했을 때 파일 이름으로 대신 채우지도 않았다.

데몬을 끄면 함께 멈추는 잡 목록도 실었다. 이 기기에서 열한 개였고 그중 이 프로젝트의 것이 셋이다.
앱은 그 이름을 해석하지 않고 파일에 적힌 그대로 싣는다.

지금 필요한 것은 QA 확인이다. 볼 화면이 없는 작업이라 확인은 숫자를 믿는 일이 되고, 무엇을 어떻게
확인했는지는 작업 문서의 확인 동선에 적어 두었다. 두 게이트 모두 통과한 상태로 넘긴다.

---

- 대상: TASK-122 (앱이 조작 대상 서비스와 함께 멈추는 잡을 읽어 스냅샷에 싣는다)
- 근거: SPEC-036 R2·R4·R5·R9 / DECISION-3D9A30F2 (`schema: workflow-labs/decision@1`,
  `spec_id: SPEC-036`, `outcome: approved`, `created_by: user`,
  `created_at: 2026-08-05T06:52:32.742176+00:00`) — 이 세션 시작 시점에 SPEC-036의 유일한 결정이다.
- 세션: 2026-08-05T11:40Z~12:10Z. 죽은 세션 인수 아님(`todo`에서 집었다).
- 선점: `sh .workflow/rules/wf-claim.sh acquire TASK-122 developer-claude 45` → exit 0,
  `lease_id: lease-32118-20260805114043`. 작업 중 `renew` 2회(전부 exit 0), 종료 시 `release`.
- 기기: Apple Silicon / macOS (arm64), rustfmt 1.8.0-stable.

## 선택 경위

`sh .workflow/rules/wf-eligible.sh developer` → `eligible`/0. 미완료 작업 11건 중 개발자 후보는
셋이었다 — TASK-122·TASK-126·TASK-128. 나머지 셋(TASK-123·124·129)은 선행 미충족이고,
다섯(TASK-119·120·121·125·127)은 `qa_waiting`이다. `in_progress` 작업이 하나도 없어 인수 대상은
없었고, 미만료 lease도 없어 겹침으로 막힌 작업도 없었다 — lease 파일은 `SPEC-009.yml` 하나뿐이고
`expires_at: 2026-08-03T01:20:00Z`로 이미 만료됐다.

셋 중 TASK-122를 집은 이유는 선행이 없고 SPEC-036 사슬의 맨 앞이라 TASK-123·TASK-124를 함께 여는
자리이기 때문이다. 계약이 순서를 정하지 않는 구간이므로 판단이다.

## 바꾼 것

범위 파일 일곱 전부를 손댔다. 범위 밖 파일은 열지 않았다.

### 1. 새 모듈 — 등록물 해석 (R4·R5·R9)

`src-tauri/src/infrastructure/launch_agents.rs` (신규, 426줄). 공개 함수는 하나다.

```rust
pub fn resolve_service_target(user_home: &Path) -> HeartbeatServiceTarget
```

- macOS가 아니면 디렉터리를 **읽지도 않고** 곧바로 "이 플랫폼이 아님"이다. 갈림은
  `cfg!(target_os = "macos")` 런타임 분기이고, `heartbeat_setup.rs`의 `service_stage`·
  `heartbeat_update.rs`의 `update_guide`가 쓰는 어법과 같다.
- 찾는 집합이 데몬의 `_heartbeat_plists`와 같다 — 확장자가 `.plist`이고 확장자를 뺀 이름을
  소문자로 내렸을 때 `heartbeat`를 포함하는 파일.
- 홈을 인자로 받는다. 함수가 실제 홈을 직접 구하면 판정이 개발 기기의 파일에 묶여 검사가 기기마다
  달라진다(`heartbeat_setup.rs`의 같은 선례).
- 파일을 쓰지 않고 디렉터리를 만들지 않으며 프로세스를 띄우지 않는다. 그 규칙을 머리주석에 적었다.

### 2. 판정 다섯 (완료 조건 3·4·5·7)

`domain/project.rs`에 `HeartbeatServiceTarget`을 뒀다. `serde(tag = "kind")`인 다섯 갈래이고 어느
둘도 같은 값으로 접히지 않는다.

| 값 | 뜻 | 담는 것 |
| --- | --- | --- |
| `Resolved` | 대상 plist가 하나이고 `Label`을 읽었다 | 라벨, plist 경로 |
| `NotRegistered` | 디렉터리는 읽었는데 대상 plist가 없다 | — |
| `Ambiguous` | 대상이 둘 이상이다. 앱이 고르지 않는다 | 찾은 plist 경로 전부 |
| `UnsupportedPlatform` | macOS가 아니다 | — |
| `Unreadable` | 읽어야 할 것을 읽지 못했다 | 못 읽은 경로 |

**`Unreadable`이 두 경우를 함께 받는다.** 작업 문서가 "다섯"을 못 박았고(완료 조건 3) 그 다섯째를
"이름을 읽지 못함"으로 적었는데, 같은 문서가 "디렉터리가 없거나 읽지 못하면 등록물 없음이 아니라
읽지 못함"이라고도 적었다(완료 조건 7). 둘을 모두 만족시키는 형태가 이것 하나다 — 여섯 번째 값을
만들면 "다섯"이 깨지고, 디렉터리 실패를 `NotRegistered`로 접으면 완료 조건 7이 깨진다. 못 읽은
경로를 값이 담으므로 화면은 그 경로로 어느 쪽인지 구분할 수 있다.

`Ambiguous`에서 앱이 하나를 고르지 않는 것과, `Unreadable`에서 파일 이름으로 대신 채우지 않는 것이
데몬(`_label_of`가 못 읽으면 `p.stem`을 돌려준다)과 답이 갈리는 자리다. 그 사실과 근거(R4)를 모듈
머리주석에 적었다.

### 3. plist 읽는 수단

`src-tauri/Cargo.toml`에 `plist = "1"`을 일반 의존성으로 더했다. 이유 둘을 주석에 적었다 — 손으로
XML을 훑으면 데몬의 `plistlib`과 답이 갈릴 수 있고(특히 중첩 `dict` 안의 `Label` 오독), 바이너리
plist는 텍스트 훑기로 아예 읽히지 않는다. 플랫폼 갈래를 두지 않은 것은 macOS 전용 의존성으로 두면
파싱 코드가 다른 플랫폼의 clippy에서 검사되지 않기 때문이다.

**`Cargo.lock`은 한 줄만 늘었다.** `plist`가 이미 tauri의 전이 의존성으로 lock에 있어서 새로 받는
크레이트가 없고, 이 크레이트의 직접 의존 목록에 이름 하나가 더해진 것이 전부다.

### 4. 함께 멈추는 잡 (R2·완료 조건 8·9)

`heartbeat_status.rs`의 `JobRuns`에 `job_names()`를 더했다. 이 조회가 이미 연 상태 파일의 값을
쓰므로 **파일을 다시 열지 않는다.**

- 최상위 키에서 밑줄로 시작하는 키를 뺀 것이 잡 이름이다. 작업 문서는 `_daemon`을 빼라고 적었고,
  `docs/heartbeat.md` 3번 절은 "밑줄로 시작하는 최상위 키는 데몬 예약 영역이고 잡 이름이 아니다.
  잡 목록을 훑는 도구는 이 키들을 건너뛰어야 한다"고 적는다. 지금 예약 키는 `_daemon` 하나뿐이라
  두 규칙의 결과가 같고, 접두사 쪽이 예약 키가 느는 하위호환 변경에서도 계약과 어긋나지 않는다.
  같은 모듈의 `DAEMON_ENTRY` 주석이 이미 같은 문장을 적고 있다.
- 이름 오름차순으로 고정한다. JSON 객체의 키 순서에 화면이 기대게 두지 않는다.
- 상태 파일이 없거나 깨졌거나 최상위가 객체가 아니면 빈 목록이고 오류가 아니다.

이 프로젝트의 것인지는 `heartbeat_service.rs`의 `recorded_jobs`가 더한다. 판정은 저장 경로가 자기
잡을 가려낼 때 쓰는 목록(`owned_job_names`, 역할 잡 셋 + dream 잡)과의 **완전 일치**다. 부분 일치도
접두사 판정도 쓰지 않는다 — 이름에서 프로젝트를 뽑아내는 것이 곧 R2가 막는 해석이다.

### 5. 스냅샷에 싣는 자리

둘 다 `HeartbeatIntegration` payload에 더했다(`service_target`·`recorded_jobs`). dream 카드가 읽지
않는 값이라 섹션 공통 값이 아니다. 기존 필드는 하나도 바꾸지 않았고 더하기만 했다.

`recorded_jobs`의 필드 주석에 뜻 차이를 적었다 — 이 값은 "지금 돌고 있는 잡"이 아니라 "실행 기록이
있는 잡"이다. 화면이 "이만큼이 멈춘다"로 단정하지 않는 근거가 그 주석이다.

### 6. 검사 열여섯

| 파일 | 수 | 무엇을 고정하나 |
| --- | --- | --- |
| `launch_agents.rs` | 9 | 대상 해석 다섯 갈래, 라벨의 출처, 중첩 `Label` 오독 금지, 쓰기 없음 |
| `heartbeat_status.rs` | 3 | 잡 목록의 출처·정렬·예약 항목 제외, 없는·깨진·객체 아닌 파일 |
| `heartbeat_service.rs` | 4 | 스냅샷이 싣는 값, 이 프로젝트 판정, 3단계 불변 |

대상 해석 검사는 전부 임시 디렉터리로 세웠다. 개발 기기의 실제 `~/Library/LaunchAgents`를 보면
판정이 기기마다 달라진다 — `heartbeat_setup.rs`의 `homes()` 헬퍼가 같은 이유로 쓰는 선례다.
픽스처는 작업 문서가 요구한 여섯을 모두 덮는다: 빈 디렉터리, 디렉터리 없음, heartbeat 아닌 plist만,
heartbeat plist 하나, heartbeat plist 둘, `Label` 없는 plist 하나(여기에 plist가 아닌 파일과
`Label`이 문자열이 아닌 파일을 더해 셋으로 돌린다).

이 프로젝트 판정 검사에는 **접두사 함정**을 심었다 — 이 프로젝트의 개발자 잡 이름 뒤에 `-old`가
붙은 남의 잡이다. 접두사 판정으로 구현하면 그 자리에서 실패한다.

## 실물 확인 (검증 절차 7)

작업 문서는 "앱을 띄워 `inspect_integrations`가 실제로 무엇을 실었는지" 적으라고 했다. GUI를 띄우는
대신 **같은 코드 경로를 같은 인자로 불러** 측정했다 — `inspect_integrations`는
`HeartbeatService.inspect(프로젝트 경로, ~/.claude, $HOME)` 한 줄이 전부이고
(`commands/heartbeat.rs`), 그 호출을 임시 테스트로 한 번 돌린 뒤 그 테스트를 지웠다. 지금 저장소에
그 테스트는 없다(`grep real_machine_probe` 0건).

```
TARGET: Resolved {
  label: "com.catze.dream-heartbeat",
  plist_path: "/Users/catze/Library/LaunchAgents/com.catze.dream-heartbeat.plist"
}
JOB COUNT: 11
```

| 잡 이름 | 이 프로젝트 |
| --- | --- |
| `dream-catze` | 아니오 |
| `dream-unity` | 아니오 |
| `wf-architect` | 아니오 |
| `wf-architect-Users-catze-Git-mech-arena` | 아니오 |
| `wf-architect-Users-catze-project-workflow-labs` | **예** |
| `wf-developer` | 아니오 |
| `wf-developer-Users-catze-Git-mech-arena` | 아니오 |
| `wf-developer-Users-catze-project-workflow-labs` | **예** |
| `wf-planner` | 아니오 |
| `wf-planner-Users-catze-Git-mech-arena` | 아니오 |
| `wf-planner-Users-catze-project-workflow-labs` | **예** |

**작업 문서가 기대한 값 그대로다** — 라벨이 `com.catze.dream-heartbeat`이고(상수
`com.claude-heartbeat`이 아니다) 잡이 열한 개다. 소속 셋도 기획서 확인 사실 14와 일치한다
(workflow-labs 셋, mech-arena 셋, dream 둘, 슬러그 없는 옛 이름 셋).

같은 값을 앱 밖에서도 대조했다. 세 명령 전부 위 표와 일치한다.

```
$ ls ~/Library/LaunchAgents/ | grep -i heartbeat   → com.catze.dream-heartbeat.plist (1건)
$ plutil -extract Label raw ~/.../com.catze.dream-heartbeat.plist → com.catze.dream-heartbeat
$ python3 -c "...len([k for k in d if not k.startswith('_')])" → 11
```

## 게이트 (완료 조건 14)

| 검사 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **통과** — 520 passed, 0 failed, 0 ignored |
| `npm run check` | **통과** — 22 files, 646 tests passed, build ok |
| `cargo clippy --all-targets -- -D warnings` | 경고·오류 0건 |
| `cargo fmt -- --check` (범위 파일) | 범위 파일 차이 0건 |

착지 전 513건이었으니 이 세션이 16건을 더했다. 프론트엔드는 이 작업에서 바뀌지 않았고 646건이
그대로 통과한다.

`cargo fmt`는 크레이트 전체에는 차이를 낸다. 네 자리이고 전부 이 세션이 열지 않은 파일이다 —
아래 후속 2번에 적었다.

### 다른 플랫폼에서 깨질 자리를 미리 막았다

이 저장소는 Windows clippy까지 굴린다. macOS에서만 도는 검사를 `#[cfg]`로 갈라 두면 그 검사만
쓰는 헬퍼와 import가 다른 플랫폼에서 미사용이 되어 `-D warnings`에 걸린다. 두 자리를 같은 조건으로
갈라 두었고(`agent_path` 헬퍼, `HeartbeatServiceTarget` import) 그 이유를 각 자리에 주석으로 적었다.
이 기기에 macOS 타깃만 설치돼 있어 **다른 플랫폼의 컴파일은 실측하지 못했다.** 그것이 아래 리스크
1번이다.

### 기존 검사 불변 (완료 조건 13·14)

`heartbeat_setup.rs`는 열지 않았다. 설치 마법사 단계 넷의 판정·문구·`runnable`이 그대로이고, 그
모듈의 기존 테스트가 기대값 수정 없이 통과한다. 삭제하거나 `#[ignore]`를 붙인 검사는 0건이다.

새 검사 하나(`resolving_the_target_does_not_move_the_service_setup_stage`)가 그 불변을 정면으로
본다 — 표준 라벨이 아닌 등록물만 있는 기기에서 대상은 **확정**인데 설치 3단계는 여전히 **확인
불가**다. 같은 디렉터리를 보면서도 두 판정이 서로 다른 질문에 답한다는 것이 그 단정의 뜻이다.

## 하지 않은 것 (완료 조건 10·11·12)

- **쓰기 없음.** 조회 경로에서 파일을 쓰지 않는다. 사용자 홈 스냅샷 비교 검사가 고정한다.
- **실행 없음.** 이 경로에서 프로세스를 띄우지 않는다. `inspect_integrations`는 조회 주기마다
  불리므로 여기에 실행이 들어가면 2.5초마다 프로세스가 뜬다.
- **`heartbeat status` 파싱 없음.** 이 변경분에 그 출력을 읽는 코드가 없다.
- 버튼도 커맨드도 만들지 않았다. `commands/`·`lib.rs`·프론트엔드는 열지 않았다 — TASK-123·124의
  몫이다.

## 변경 파일

이 세션이 손댄 파일은 범위 파일 일곱과 워크플로 문서 셋이다.

| 파일 | 성격 |
| --- | --- |
| `src-tauri/src/infrastructure/launch_agents.rs` | 범위 파일. 신규 426줄 |
| `src-tauri/src/infrastructure/mod.rs` | 범위 파일. 모듈 등록 1줄 |
| `src-tauri/src/domain/project.rs` | 범위 파일. payload 타입 둘 |
| `src-tauri/src/infrastructure/heartbeat_status.rs` | 범위 파일. `job_names()`와 검사 셋 |
| `src-tauri/src/application/heartbeat_service.rs` | 범위 파일. payload 조립과 검사 넷 |
| `src-tauri/Cargo.toml` · `src-tauri/Cargo.lock` | 범위 파일. `plist` 의존성 |
| `.workflow/.../tasks/TASK-122.md` | 상태·이력·요약·확인 동선 |
| `.workflow/.runtime/leases/TASK-122.yml` | 선점 헬퍼가 쓴 lease |

여기에 이 보고서와 개발 로그 항목이 더해진다.

작업 트리에는 **이 세션 전부터** 다른 작업들의 미커밋 변경이 40여 개 파일에 걸쳐 있었다. 위 목록은
그것과 이 세션의 몫을 가른 것이다.

## 남는 리스크

1. **다른 플랫폼의 컴파일을 실측하지 못했다.** 이 기기에 `aarch64-apple-darwin` 타깃만 설치돼
   있어 Windows·Linux clippy는 CI에서 처음 돈다. `#[cfg]`로 갈린 자리 넷(검사 셋·헬퍼 하나·
   import 하나)이 그 대상이고, 미사용 경고가 남지 않도록 같은 조건으로 갈라 두었으나 확인은 CI가
   한다.
2. **`Label`이 빈 문자열인 plist는 확정으로 읽힌다.** 작업 문서가 "읽지 못함"으로 적은 넷(파일을
   열지 못함·plist가 아님·키 없음·문자열 아님)에 빈 문자열이 없어 규칙대로 두었다. launchd가 빈
   라벨의 등록을 받지 않으므로 실존하기 어려운 값이지만, TASK-123이 그 값을 `bootout`의 인자로
   쓰기 전에 한 번 볼 자리다.
3. **읽는 시점과 조작 시점 사이가 벌어질 수 있다.** 대상 해석은 조회 주기의 값이고 조작은 사용자가
   누르는 시점이다. 그 사이에 등록물이 바뀌면 화면이 든 값과 조작 대상이 갈린다. 조작을 만드는
   TASK-123이 누를 때 다시 해석할지 화면의 값을 믿을지 정할 자리다.
4. **`Ambiguous`에서 앱과 데몬의 판단이 갈린다.** 앱은 거부하고 데몬의 `detect()`는 하나를 고른다
   (기획서 확인 필요 3번의 승인된 한계). 같은 기기에서 `heartbeat update`는 재기동을 해내는데
   토글은 거부하는 상태가 남는다. 이 기기는 등록물이 하나라 지금 그 상태가 아니다.

## 후속 (역할 밖 발견)

1. **`update_guide`의 라벨 빈칸은 아직 그대로다.** 이제 앱이 라벨을 알지만
   `heartbeat_update.rs`의 재기동 명령 상수는 여전히 `<라벨>`을 글자 그대로 내보낸다. 그 모듈은
   이 작업의 범위 밖이고(SPEC-034의 자리다) 기획서도 그 교체를 요구하지 않았다. 채울지 말지는
   기획자·아키텍트의 판단이다.
2. **`cargo fmt`가 크레이트 전체에 차이를 낸다.** 이 세션이 열지 않은 파일 넷이다 —
   `application/heartbeat_version_service.rs`(2건, 아직 커밋되지 않은 새 파일),
   `commands/heartbeat.rs`, `infrastructure/project_instructions.rs`. CI가
   `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`를 돌리므로 **커밋 컷 전에 누군가
   맞춰야 한다.** 이 기기의 rustfmt가 1.8.0-stable이라 CI의 것과 버전이 다를 가능성도 있다.
   범위 밖이라 손대지 않았다.
3. **TASK-124가 읽을 값의 뜻.** `recorded_jobs`는 "지금 돌고 있는 잡"이 아니라 "실행 기록이 있는
   잡"이다. 화면 문구가 "이 잡들이 멈춥니다"로 단정하면 앱이 모르는 것을 아는 척하게 된다. 그
   뜻 차이를 필드 주석에 적어 두었다.

## 사용자 QA 제안

작업 문서의 `## 확인 동선`에 무엇으로 확인했는지 적어 두었다. 화면이 없는 작업이라 확인 도장은
"이 숫자들을 믿는다"는 뜻이 되고, 터미널 명령 셋으로 앱 밖에서 같은 값을 대조하는 길을 함께
적었다. 화면에서 직접 보는 확인은 TASK-124가 착지한 뒤에 온다.
