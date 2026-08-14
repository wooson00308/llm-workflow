---
schema: workflow-labs/task@1
id: TASK-122
title: 앱이 조작 대상 서비스와 함께 멈추는 잡을 읽어 스냅샷에 싣는다
status: verified
source_spec_id: SPEC-036
source_decision_id: DECISION-3D9A30F2
scope_files:
- src-tauri/Cargo.toml
- src-tauri/Cargo.lock
- src-tauri/src/infrastructure/launch_agents.rs
- src-tauri/src/infrastructure/mod.rs
- src-tauri/src/infrastructure/heartbeat_status.rs
- src-tauri/src/application/heartbeat_service.rs
- src-tauri/src/domain/project.rs
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-05T07:22:00Z
  kind: created
- at: 2026-08-05T11:41:00Z
  kind: in_progress
- at: 2026-08-05T12:05:00Z
  kind: qa_waiting
- at: 2026-08-05T16:44:14.790863+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-3D9A30F2
work_group_revision: 1
---

# 앱이 조작 대상 서비스와 함께 멈추는 잡을 읽어 스냅샷에 싣는다

## 결정권자 요약

앱이 이 기기에 실제로 등록된 하트비트 서비스의 이름을 처음으로 알게 됐다. 지금까지 앱이 아는
이름은 내장 상수 하나뿐이었고 이 기기의 실제 이름은 그것과 달라서, 설치 3단계가 언제나 "확인
불가"로 나오는 것도 갱신 안내의 재기동 명령에 라벨 자리가 빈칸으로 나가는 것도 같은 무지에서
나왔다. 이제 앱이 등록물을 직접 읽어 그 이름을 확정하고, 확정하지 못하는 경우 넷을 서로 다른
값으로 갈라 말한다.

함께 실은 값이 하나 더 있다. 데몬을 끄면 무엇이 함께 멈추는지다. 이 기기에서 실행 기록이 있는
잡은 열한 개이고 그중 이 프로젝트의 것은 셋인데, 앱이 그 목록을 읽은 그대로 싣는다.

이 작업은 읽기만 한다. 버튼도 만들지 않고 서비스를 건드리지도 않는다. 조작은 TASK-123, 화면은
TASK-124가 받으므로 화면에 보이는 변화는 아직 없고, 확인은 아래 확인 동선의 숫자를 믿는 일이 된다.

## 확인 동선

**볼 화면이 없는 작업이다.** 이번에 선 것은 앱 안쪽의 읽기 하나이고, 그 값을 사용자가 보는 자리는
TASK-124가 만든다. 지금 앱을 띄워도 연동 탭은 어제와 같다 — 설치 3단계도 판정과 문구가 그대로다
(그것이 완료 조건 13이다). 그래서 이 작업은 자동 검사와 실측으로 닫았고, 확인 도장은 **아래 숫자를
믿는다**는 뜻이 된다.

### 1. 검사 두 개를 다시 돌린다

```sh
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

**정상이면 앞엣것이 520 passed / 0 failed / 0 ignored, 뒤엣것이 22 files / 646 tests passed다.**
이 세션이 넘길 때의 값이고, 다른 세션이 그 사이에 검사를 더했으면 숫자는 늘 수 있다. 늘어도
`failed`가 0이면 정상이다.

### 2. 이 작업이 새로 만든 검사만 돌려 본다

```sh
cargo test --manifest-path src-tauri/Cargo.toml -- launch_agents
cargo test --manifest-path src-tauri/Cargo.toml -- job_names recorded_jobs service_target
```

**정상이면 앞엣것이 `9 passed`, 뒤엣것이 `6 passed`이고 둘 다 `0 failed`다.** 앞의 아홉이 대상
해석 다섯 갈래(확정·등록물 없음·대상 모호·이 플랫폼이 아님·읽지 못함)와 쓰기 없음을 고정하고,
뒤의 여섯이 잡 목록과 이 프로젝트 판정을 고정한다.

### 3. 앱이 읽은 값이 이 기기의 실제와 같은지 본다

이 작업의 실물 확인이다. 아래 셋을 터미널에서 돌려 앱이 실은 값과 대조한다.

```sh
ls ~/Library/LaunchAgents/ | grep -i heartbeat
plutil -extract Label raw ~/Library/LaunchAgents/com.catze.dream-heartbeat.plist
python3 -c "import json;d=json.load(open('$HOME/.claude/heartbeat/state.json'));print(len([k for k in d if not k.startswith('_')]))"
```

**이 세션이 앱의 조회 경로로 실측한 값은 이렇다.**

| 항목 | 값 |
| --- | --- |
| 대상 plist | `~/Library/LaunchAgents/com.catze.dream-heartbeat.plist` 하나 |
| 라벨 | `com.catze.dream-heartbeat` (내장 상수 `com.claude-heartbeat`이 아니다) |
| 함께 멈추는 잡 | 11개 |
| 그중 이 프로젝트의 것 | 3개 (planner·architect·developer) |

세 명령의 출력이 위 표와 같으면 앱이 읽은 값이 이 기기의 실제와 같다는 뜻이다. 잡이 열한 개가
아니어도 정상이다 — 그 사이에 잡이 늘거나 줄었으면 세 번째 명령의 수와 앱의 수가 같기만 하면 된다.

### 4. 남의 자리를 건드리지 않았는지

`~/Library/LaunchAgents`에 앱이 쓰기를 하지 않는다는 것은 검사가 고정한다
(`resolving_the_target_does_not_touch_the_user_home`). 확인하고 싶으면 앱을 몇 주기 띄워 둔 뒤
`ls -la ~/Library/LaunchAgents`의 수정 시각이 그대로인지 보면 된다.

## 이 작업이 닫는 것

SPEC-036 R4·R5·R9의 판정 쪽과 R2의 값 쪽이다. 기획서 완료 조건 5·8·9·15·17의 백엔드 절반이
여기서 선다.

## 조작 대상 해석

새 모듈 `src-tauri/src/infrastructure/launch_agents.rs`가 소유한다. 이 모듈은 **파일을 쓰지
않고 디렉터리를 만들지 않으며 프로세스를 띄우지 않는다.** `heartbeat_setup.rs`의 머리주석이
세운 규칙이 여기서도 그대로다 — 그 모듈이 이미 같은 디렉터리의 파일 하나를 존재만 확인하고
있고, 이 모듈은 같은 디렉터리를 목록으로 읽는 것까지 간다.

찾는 규칙은 데몬의 `LaunchdAdapter._heartbeat_plists`와 같은 것을 쓴다. 두 쪽이 서로 다른
집합을 보면 `heartbeat update`의 재기동과 이 토글이 다른 서비스를 대상으로 삼는다.

- 디렉터리는 `<사용자 홈>/Library/LaunchAgents`다.
- 대상은 확장자가 `.plist`이고 **확장자를 뺀 이름에 `heartbeat`가 들어간 파일**이다. 비교는
  소문자로 내려 한다(데몬이 `p.stem.lower()`를 쓴다).
- 디렉터리가 없거나 읽지 못하면 "등록물 없음"이 아니라 **읽지 못함**이다. 없음으로 접으면 앱이
  모르는 것을 안다고 말하게 된다.

판정 결과는 다섯이고 서로 다른 값이다. R5가 "하나의 실패 문구로 뭉뚱그리지 않는다"고 한 넷에
다섯째가 하나 더 붙는다.

1. **확정** — 대상 plist가 정확히 하나이고 그 `Label`을 읽었다. 라벨과 plist 경로를 함께 담는다.
   plist 경로는 TASK-123의 `bootstrap`이 인자로 쓴다.
2. **등록물 없음** — 디렉터리는 읽었는데 대상 plist가 없다. 데몬 계약이 같은 상태를
   `skipped/not-registered`로 부르는 자리다.
3. **대상 모호** — 대상 plist가 둘 이상이다. **앱이 고르지 않는다.** 확인 필요 3번의 승인안이고,
   틀렸을 때 데몬은 계속 도는데 화면은 껐다고 말하며 그 어긋남을 앱이 확인할 수단이 없다. 찾은
   plist 파일 경로를 전부 담아 사용자가 무엇을 정리해야 하는지 보이게 한다.
4. **이 플랫폼이 아님** — macOS가 아니다. `cfg!(target_os = "macos")`로 가른다.
   `heartbeat_setup.rs`의 `service_stage`와 `heartbeat_update.rs`의 `update_guide`가 쓰는 어법과
   같다. Linux·Windows의 절차를 지어내지 않는다(R9).
5. **이름을 읽지 못함** — plist는 하나인데 그 `Label`을 읽지 못했다(파일을 열지 못했거나, plist가
   아니거나, `Label` 키가 없거나 문자열이 아니다). 읽지 못한 파일 경로를 담는다.

다섯째를 데몬처럼 파일 이름으로 대신하지 않는다. 데몬의 `_label_of`는 못 읽으면 `p.stem`을
돌려주지만, 그것은 재기동 실패가 무해한 쪽의 선택이다. 이쪽은 R4가 "대상을 확정하지 못하면
조작하지 않는다"를 명령하는 자리이고, 추측한 이름으로 `bootout`을 던지면 성공도 실패도 아닌
상태가 남는다. 데몬과 답이 갈리는 자리이므로 그 사실을 모듈 주석에 적는다.

### plist를 읽는 수단

`plist` 크레이트를 의존성에 더한다(`src-tauri/Cargo.toml`, 플랫폼 갈래 없이 일반 의존성).

이유는 둘이다. 첫째, 데몬이 `plistlib`으로 읽는 값을 앱이 손으로 만든 XML 훑기로 읽으면 두
쪽의 답이 갈릴 수 있고, 특히 중첩 `dict` 안의 `Label` 키를 잘못 집는 오독이 곧 "엉뚱한 서비스를
내린다"가 된다. 둘째, 바이너리 plist가 `~/Library/LaunchAgents`에 있을 수 있고 텍스트 훑기는
그것을 읽지 못한다.

플랫폼 갈래를 두지 않는 것은 이 저장소가 Windows clippy까지 굴리기 때문이다. macOS 전용
의존성으로 두면 파싱 코드가 `#[cfg]`로 갈려 다른 플랫폼에서는 검사도 돌지 않는다. 동작의 갈림은
지금 코드가 쓰는 `cfg!(target_os = "macos")` 런타임 분기로 충분하다.

`src-tauri/Cargo.lock`이 함께 바뀐다. 이 저장소는 lock을 추적하므로 범위에 든다.

## 함께 멈추는 잡

R2의 값이다. `heartbeat_status.rs`의 `JobRuns`가 이미 `state.json` 전체를 `Value`로 물고 있고
(`daemon_version()`이 `_daemon`을 꺼내 쓰는 것이 선례다), 잡 목록은 그 값의 최상위 키다. 파일을
다시 열지 않는다.

- 최상위 키에서 `_daemon`을 뺀 것이 잡 이름 목록이다. 정렬은 이름 오름차순으로 고정한다 — JSON
  객체의 키 순서에 화면이 기대게 두지 않는다.
- 상태 파일이 없거나 깨졌으면 빈 목록이다. 오류가 아니다(모듈 머리주석의 규칙).
- **잡 이름을 해석하지 않는다.** 이름에서 프로젝트 이름을 뽑아내거나 역할을 번역하지 않는다.
  `wf-planner-Users-catze-project-mecha-arena`는 그 문자열 그대로 실린다. R2가 "앱이 그 파일에서
  읽는 값 이상을 말하지 않는다"고 한 자리다.
- 각 잡에 **이 프로젝트의 것인가** 하나만 앱이 더한다. 판정은 앱이 이미 가진 slug로 만든
  이름들과의 완전 일치다 — 역할 잡 셋(`heartbeat_roles::job_name`)과 dream 잡
  (`heartbeat_dream::job_name`). 부분 일치나 접두사 판정을 쓰지 않는다.
- 이 값은 "지금 돌고 있는 잡"이 아니라 "실행 기록이 있는 잡"이다. 그 뜻 차이를 필드 주석에 적는다.
  화면이 "이만큼이 멈춘다"로 단정하지 않게 하는 근거가 그 주석이다.

## 스냅샷에 싣는 자리

둘 다 `HeartbeatIntegration` payload에 더한다(`heartbeat_service.rs`). dream 카드는 이 값을 읽지
않으므로 섹션 공통 값(`update_guide`·`jobs_file_path`가 있는 자리)이 아니다. 타입은
`domain/project.rs`에 둔다 — `HeartbeatSetupStage`·`HeartbeatUpdateGuide`가 있는 자리다.

- 기존 필드를 바꾸지 않고 더하기만 한다. `setup_stages`의 판정과 문구는 그대로다(완료 조건 18).
- `installation`·`daemon_running`의 판정도 그대로다. 데몬 생존 판정 방식의 변경은 기획서
  제외 범위다.

## 완료 조건

1. 대상 plist가 하나일 때 그 `Label` 값과 plist 경로가 스냅샷에 실린다. 이 기기에서 그 값은
   `com.catze.dream-heartbeat`이고 상수 `com.claude-heartbeat`이 아니다.
2. 찾는 집합이 데몬의 `_heartbeat_plists`와 같다 — `.plist` 확장자, 확장자 뺀 이름에 소문자
   `heartbeat` 포함.
3. 판정 다섯(확정·등록물 없음·대상 모호·이 플랫폼이 아님·이름을 읽지 못함)이 서로 다른 값으로
   구분된다. 어느 둘도 같은 값으로 접히지 않는다. (R5·완료 조건 9)
4. 대상이 둘 이상이면 앱이 하나를 고르지 않고, 찾은 plist 경로가 전부 실린다. (확인 필요 3번)
5. `Label`을 읽지 못한 경우 파일 이름으로 대신하지 않는다. 확정이 되지 않는다. (R4)
6. macOS가 아니면 언제나 "이 플랫폼이 아님"이고 디렉터리를 읽지 않는다. (R9·완료 조건 17)
7. 디렉터리가 없거나 읽지 못한 것이 "등록물 없음"으로 접히지 않는다.
8. 잡 목록이 `state.json` 최상위 키에서 오고 `_daemon`이 빠져 있으며 이름 오름차순이다. 상태
   파일이 없거나 깨졌으면 빈 목록이고 오류가 아니다. (R2·완료 조건 5)
9. 잡마다 이 프로젝트의 것인지가 slug로 만든 이름과의 완전 일치로 정해진다. 이름에서 프로젝트
   이름을 뽑아내는 코드가 없다.
10. 이 경로에서 앱이 파일을 쓰지 않는다. 특히 `~/Library/LaunchAgents`에 쓰기가 없다.
    (R8·완료 조건 15)
11. 이 경로에서 프로세스를 띄우지 않는다. `inspect_integrations`는 조회 주기마다 불리므로 여기에
    실행이 들어가면 2.5초마다 프로세스가 뜬다.
12. `heartbeat status`의 출력을 파싱하는 코드가 이 변경분에 없다. (완료 조건 14)
13. 설치 마법사 단계 넷의 판정·문구·`runnable`이 변경 전과 같다. `heartbeat_setup.rs`의 기존
    테스트가 기대값 수정 없이 통과한다. (R10·완료 조건 18)
14. 기존 자동 검사가 삭제되거나 비활성화되지 않고, `npm run check`와
    `cargo test --manifest-path src-tauri/Cargo.toml`이 통과한다. (완료 조건 19·20)

## 검증 절차

1. `cargo test --manifest-path src-tauri/Cargo.toml`.
2. 대상 해석 검사는 임시 디렉터리로 세운다. 개발 기기의 실제 `~/Library/LaunchAgents`를 보면
   판정이 기기마다 달라진다 — `heartbeat_setup.rs`의 `homes()` 헬퍼가 같은 이유로 임시 홈 둘을
   쓰는 선례다. 픽스처는 최소 여섯 — 빈 디렉터리, 디렉터리 없음, heartbeat 아닌 plist만 있음,
   heartbeat plist 하나, heartbeat plist 둘, `Label` 키가 없는 plist 하나.
3. 잡 목록 검사는 `state.json` 문자열을 직접 넣는 단위 검사로 세운다 — `_daemon`만 있는 파일,
   잡 여럿과 `_daemon`이 섞인 파일, 깨진 JSON, 파일 없음.
4. 이 프로젝트 판정은 실제 slug로 만든 이름 하나와 다른 프로젝트의 이름 하나를 함께 넣어 확인한다.
5. 쓰기 없음은 `heartbeat_run_service.rs`가 쓰는 검사 어법(실행 전후 디렉터리 스냅샷 비교)을 그대로
   쓴다. 대상은 사용자 홈과 하트비트 홈 둘이다.
6. `npm run check` — 프론트엔드는 이 작업에서 바뀌지 않지만 기존 검사가 그대로 통과해야 한다.
7. 이 기기에서 앱을 띄워 `inspect_integrations`가 실제로 무엇을 실었는지 보고서에 적는다. 라벨이
   `com.catze.dream-heartbeat`으로 나오는지, 잡 목록이 열한 개인지가 이 작업의 실물 확인이다.
   나오지 않으면 그 사실을 그대로 적는다.

## 범위 파일

- `src-tauri/src/infrastructure/launch_agents.rs` — 새 모듈. 대상 plist 탐색과 `Label` 읽기.
- `src-tauri/src/infrastructure/mod.rs` — 모듈 등록.
- `src-tauri/src/infrastructure/heartbeat_status.rs` — `JobRuns`에 잡 이름 목록.
- `src-tauri/src/application/heartbeat_service.rs` — payload 조립.
- `src-tauri/src/domain/project.rs` — payload 타입 둘.
- `src-tauri/Cargo.toml`·`src-tauri/Cargo.lock` — `plist` 의존성.

`heartbeat_setup.rs`는 만지지 않는다. 설치 3단계의 판정을 이 값으로 바꾸는 것은 기획서 제외
범위이고(완료 조건 18), 그 판정과 이 판정이 같은 디렉터리를 보면서도 서로 다른 질문에 답한다는
것이 이 선의 뜻이다. 프론트엔드와 `commands/`·`lib.rs`도 범위 밖이다.

## 선행

없다. 이 작업이 SPEC-036의 첫 걸음이다.
