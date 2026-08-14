---
schema: workflow-labs/task@1
id: TASK-107
title: 갱신 안내의 명령 원문을 백엔드가 완성해 싣는다
status: verified
source_spec_id: SPEC-034
source_decision_id: DECISION-3ECEDCA1
updated_at: 2026-08-14T09:08:07.880257+00:00
history:
- at: 2026-08-04T17:35:00Z
  kind: created
- at: 2026-08-04T19:41:20Z
  kind: in_progress
- at: 2026-08-04T19:47:30Z
  kind: qa_waiting
- at: 2026-08-05T03:08:51.333746+00:00
  kind: completed
- at: 2026-08-14T09:08:07.880257+00:00
  kind: migrated_verified
work_group_id: GROUP-DECISION-3ECEDCA1
work_group_revision: 1
---

# 갱신 안내의 명령 원문을 백엔드가 완성해 싣는다

SPEC-034의 R3(명령 원문을 화면이 조립하지 않는다)과 R4의 재시작 걸음이 쓸 값을 만든다. 화면 쪽은
TASK-108(역할 잡 카드)과 TASK-109(dream 카드)의 몫이고, **이 작업은 payload까지다.**

## 승인된 확인 필요 넷이 이 작업의 전제다

DECISION-3ECEDCA1은 본문이 비어 있고, 기획서 "확인 필요" 머리글이 "승인 시 아래 제안대로 진행한다"
이므로 네 항목 모두 제안대로다.

- 1번(갈래를 보인다) → **명령이 하나가 아니다.** 갈래 둘과 공통 재시작이 각각 명령 원문을 갖는다.
  기획 보고(`REPORT-SPEC-034-PLAN.md` 47번 메모)가 "갈래가 둘이면 화면이 고를 목록이 필요하다"로
  이 작업의 존재 조건을 미리 적어 두었다.
- 2번(버전 판정·표시는 뺀다) → **이 변경분에 데몬 버전을 읽는 코드가 없다.** 완료 조건 8이 그것을 본다.
- 3번(마법사 1단계는 다루지 않는다) → `heartbeat_setup.rs`의 `PACKAGE_COMMAND`(`:29`)를 **고치지
  않는다.**
- 4번(084 경고가 뜰 때만 보인다) → 표시 조건은 화면의 일이라 이 작업에 없다. **다만 payload는 조건과
  무관하게 언제나 실린다** — 아래 "판정을 만들지 않는다"를 본다.

## 값이 놓일 자리: 섹션 공통

`IntegrationsSnapshot`의 공통 영역에 필드 하나를 더한다(`heartbeat_service.rs:41`~`:66`).

- 두 카드가 **같은 값을 같은 문구로** 보여야 한다(R7). 연동별 payload에 각자 실으면 두 자리가
  갈라질 수 있고, 그 갈라짐을 막는 일이 화면 테스트로 내려간다.
- 이미 같은 이유로 공통 영역에 있는 값이 둘이다 — `managed_block_failure`("두 연동이 HEARTBEAT.md 한
  파일을 공유하므로")와 `jobs_file_path`("두 연동이 같은 파일을 쓰므로"). 같은 규칙의 세 번째다.
- `heartbeat.setup_stages`에 얹지 않는다. 그 목록은 설치 마법사의 것이고 "dream 카드는 이 값을 읽지
  않는다"가 필드 주석에 박혀 있다.

## 만들 값

`src-tauri/src/infrastructure/heartbeat_update.rs`를 새로 만들고 `infrastructure/mod.rs`에 등록한다.
구조체는 `domain/project.rs`의 `HeartbeatSetupStage`(`:323`) 옆에 둔다 — payload 타입이 사는 자리다.

```rust
pub struct HeartbeatUpdateGuide {
    pub identify_command: String,
    pub package_command: String,
    pub source_command: String,
    pub service_lookup_command: Option<String>,
    pub service_restart_command: Option<String>,
}
```

`#[serde(rename_all = "camelCase")]`는 같은 파일의 다른 payload 구조체와 같다.

명령 원문은 **모듈 상수**로 둔다. `heartbeat_setup.rs:29`~`:32`가 같은 모양이고, R3이 가리키는
선례가 그것이다.

| 필드 | 값 | 근거 |
| --- | --- | --- |
| `identify_command` | `pip show claude-heartbeat` | 확인 사실 4. 확인 필요 1번의 승인된 제안이 "`Editable project location` 유무"를 갈래 판별 방법으로 지정했다. |
| `package_command` | `pip install -U claude-heartbeat` | 확인 필요 1번 본문이 pip 갈래의 어법으로 이 문자열을 적었다. 마법사 1단계와 같은 설치 모델이라 R6도 함께 지킨다. |
| `source_command` | `git pull` | 확인 사실 4·아이디어의 실제 절차. **경로를 붙이지 않는다** — 체크아웃 디렉터리는 앱이 알지 못하는 값이다(R2). |
| `service_lookup_command` | macOS: `launchctl list \| grep heartbeat` / 그 밖: `None` | R4가 요구하는 "사용자가 확인할 방법". 확인 사실 11이 이 기기의 라벨이 표준이 아님을 실측했다. |
| `service_restart_command` | macOS: `launchctl kickstart -k gui/$(id -u)/<라벨>` / 그 밖: `None` | R4의 마지막 걸음. `<라벨>`은 **사용자가 바꿔 넣는 빈자리**이고 앱이 지어낸 값이 아니다. `KeepAlive`가 참이므로(확인 사실 11) 이 한 줄이 재시작이다. |

### `<라벨>`을 남겨 두는 것이 R2와 어긋나지 않는 이유

R2가 금지하는 것은 "앱이 알아낼 수 없는 값을 **사실처럼** 적는 것"이다. 표준 라벨 하나를 골라
넣으면 그것이 사실처럼 적는 일이고, 확인 사실 11의 기기에서 바로 틀린다. 비어 있는 자리는 앱이
모른다는 것을 그 자리에서 말한다. **비었다는 사실을 문구로도 말하는 것은 화면의 몫이고**
TASK-108 완료 조건 5가 그것을 본다.

### macOS 밖이 `None`인 이유

`heartbeat_setup.rs`의 `service_stage`(`:100`~`:120`)가 이미 같은 어법을 쓴다 — `cfg!(target_os =
"macos")`로 갈라 이 플랫폼에서 볼 것이 없으면 `None`을 싣고, 화면이 "없다"와 "확인할 방법이 없다"를
그 있음·없음으로 구분해 말한다. Linux(systemd)·Windows(Task Scheduler)의 재시작 절차는 이 저장소가
확인한 적이 없고, 확인하지 않은 명령을 싣는 것이 R2가 막는 바로 그 일이다. **런타임 값이 아니라
컴파일 시점 값이다.** 테스트도 같은 조건으로 갈라 쓴다.

## 판정을 만들지 않는다

- **파일을 읽지 않는다.** 설치 여부·데몬 실행 여부·잡 존재를 보지 않는다. 다섯 값 중 넷은 상수이고
  나머지 둘의 갈림은 컴파일 시점 플랫폼 하나다.
- **명령을 실행하지 않는다.** 실행 파일을 찾아 다니지도 않는다. `heartbeat_setup.rs`의 머리주석이
  같은 규칙을 적어 두었고(`:3`~`:5`), 확인 사실 10이 그 경로가 이 기기에서 실패한다는 것을 보인다.
- **버전을 읽지 않는다.** 승인된 확인 필요 2번이다. `--version`을 부르는 경로도, `state.json`에서
  버전을 찾는 코드도 만들지 않는다.
- **표시 조건을 백엔드에 두지 않는다.** 084 경고가 뜨는 조건은 `missingRunEvidence`(화면)가 이미
  갖고 있다. 같은 결론을 내는 자리를 둘로 만들지 않는다 — `HeartbeatCard.tsx:134`~`:144`의 주석이
  그 규칙을 적어 두었다.

## 범위

- `src-tauri/src/infrastructure/heartbeat_update.rs` — 새 파일. 상수와 조립 함수, 그리고 `mod tests`.
- `src-tauri/src/infrastructure/mod.rs` — 모듈 등록 한 줄.
- `src-tauri/src/domain/project.rs` — `HeartbeatUpdateGuide` 구조체.
- `src-tauri/src/application/heartbeat_service.rs` — `IntegrationsSnapshot`의 필드 하나와 조립
  자리(`:348`~`:369`), 그리고 `mod tests`의 검사.
- **그 외 파일은 건드리지 않는다.** 프론트엔드는 TASK-108의 몫이고, `heartbeat_setup.rs`는 승인된
  확인 필요 3번이 잘라 두었다.

저장소에 미커밋 변경이 크다. **줄 번호는 분해 시점 작업 트리 기준이고, 쓰기 직전에 대상 줄을 다시
읽는다.**

## 검사

`heartbeat_update.rs`의 `mod tests`와 `heartbeat_service.rs`의 `mod tests`에 넣는다. **기존 검사는
이름도 내용도 고치지 않는다.**

1. 조회 결과에 갱신 안내가 실린다. 다섯 필드가 상수와 같다.
2. 안내가 상태와 무관하게 같다. 빈 홈(미설치)과 잡이 설치된 홈에서 값이 같고, 데몬 pid 파일 유무로도
   달라지지 않는다. `heartbeat_service.rs:1161`의 빈 홈 픽스처가 출발점이다.
3. 플랫폼 갈래. macOS에서 재시작 두 값이 `Some`이고 그 밖에서 둘 다 `None`이다.
   `heartbeat_setup.rs:245` 근처의 `cfg!` 갈래 검사가 어법의 본이다.
4. 명령 원문에 앱이 알 수 없는 값이 박혀 있지 않다. `identify`·`package`·`source` 세 값에
   `/Users/`·`.pyenv`·`com.` 어느 조각도 없다. 재시작 명령의 자리 표시자는 `<라벨>` 하나뿐이다.
5. 마법사가 그대로다. `setup_stages`가 내는 1단계 `command`가 `pip install claude-heartbeat`이고
   네 단계의 값이 착수 시점과 같다(승인된 확인 필요 3번).
6. 조회가 `.workflow` 아래도 하트비트 홈도 쓰지 않는다. `reading_the_setup_stages_does_not_touch_
   either_home`(`heartbeat_service.rs:1292`)이 **수정 없이** 통과한다.

## 완료 조건

괄호 안은 SPEC-034의 완료 조건 번호다.

1. `IntegrationsSnapshot`의 공통 영역에 갱신 안내가 실리고, 다섯 값이 위 표대로다. 검증: 검사 1. (6)
2. 명령 원문이 백엔드 상수다. 화면이 조각을 붙일 자리가 없다. 검증: 상수 정의를 보고서에 인용한다. (6)
3. 재시작 두 값이 macOS에서만 `Some`이고, 라벨을 앱이 지어내지 않는다. 검증: 검사 3·4. (7)
4. 안내가 설치·실행 상태에 따라 달라지지 않는다. 검증: 검사 2. (5)
5. 이 변경분에 파일을 읽거나 명령을 실행하는 코드가 없다. 검증: 새 모듈 전문을 보고서에 인용하고
   `fs::`·`Command`가 없음을 밝힌다. (11)
6. 마법사 1단계 문구가 그대로이고, 갱신 안내의 pip 명령이 같은 설치 모델을 말한다. 검증: 검사 5. (9)
7. 설치 판정·잡 저장·"지금 실행"의 동작이 달라지지 않는다. 검증: `heartbeat_service.rs`의 기존
   테스트가 **수정 없이** 통과한다. (12)
8. 데몬 버전을 읽는 코드가 이 변경분에 없다. 검증: 변경분에 `--version`·`version` 조회 경로가 없음을
   보고서에 밝힌다. (11)
9. 기존 자동 테스트가 삭제되거나 비활성화되지 않았다(`#[ignore]` 신규 0건). 착수 시점
   `heartbeat_service.rs`의 검사 개수를 세어 보고서에 적는다. (14)
10. `cargo test --manifest-path src-tauri/Cargo.toml`과 `npm run check`가 통과한다. (15)

## 검증 문구 규칙

무변경은 파일·심볼 단위로 확인한다. **"`git diff`가 비어 있다"를 쓰지 않는다** — 이 작업 트리에는
여러 세션의 미커밋 변경이 겹쳐 있다.

## 하지 않는 것

- **화면 변경 일체.** `types.ts`도 이 작업이 만지지 않는다. TASK-108이 계약을 받아 간다.
- **`launchctl` 실행.** 조사도 재시작도 하지 않는다. 이 기기의 데몬은 지금 확인 사실 7의 상태이고,
  재시작하면 역할 잡 여섯이 멈춘다. `launchctl list`까지가 읽기이고 그마저 필요하지 않다 —
  이 작업이 만드는 것은 고정 문자열이다.
- **마법사 1단계 수정과 PyPI 배포 관련 일체.** 확인 필요 3번, 확인 사실 15·16.
- **버전 판정·표시.** 확인 필요 2번.
- **갱신을 대신 실행하는 명령·API.** R5.
