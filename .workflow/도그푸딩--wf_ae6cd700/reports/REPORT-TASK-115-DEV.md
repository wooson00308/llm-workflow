# TASK-115 개발자 핸드오프 (qa_waiting)

- 대상: TASK-115 (도는 데몬과 디스크의 버전을 읽어 어긋남을 판정한다)
- 근거: SPEC-037 확인 필요 2번의 승인안, R5·R7·R9,
  DECISION-6C2F2639 (`schema: workflow-labs/decision@1`, `spec_id: SPEC-037`, `outcome: approved`,
  `created_by: user`, 2026-08-05T03:10:59.967916+00:00 — 직접 확인. SPEC-037의 결정 문서는 이 1건뿐이라
  더 늦은 결정이 없고 승인이 유효하다)
- 역할: 개발자 (developer-sasha), 2026-08-05T06:34~06:50Z
- 결과: **`qa_waiting`**. 완료 조건 1~8을 닫았고 검증 절차 1~4를 모두 수행했다.
- 선점: `acquire TASK-115 developer-sasha 30` exit 0 → `lease-89994-20260805063440` →
  `in_progress`(06:35:00Z) → 구현·검증 → `renew` exit 0(06:44Z) → `qa_waiting` → `release`.

## 선행·겹침 확인 (착수 시점 2026-08-05T06:33Z)

- `depends_on: [TASK-114]`. TASK-114는 `qa_waiting`이므로 선행 충족이다.
- 착수 시점 `todo`는 TASK-115~118 4건. 선행이 충족된 것은 셋이었다 — TASK-115(TASK-114 `qa_waiting`),
  TASK-116(TASK-113 `qa_waiting`), TASK-118(TASK-111 `completed`). TASK-117은 TASK-115·116이 아직
  `todo`라 미충족이다. `in_progress`인 작업은 없었으므로 재개 대상(우선순위 1)도 없다.
  셋 중 TASK-115를 골랐다 — TASK-117이 이것과 TASK-116 둘을 함께 기다리는 자리다.
- 미만료 lease는 둘 있었다 — `IDEA-886DAB21.yml`(만료 07:00:49Z), `IDEA-B828F62D.yml`(만료 07:01:36Z).
  판정 시각 06:33:32Z. **둘 다 대상이 아이디어 문서이고 작업 문서가 아니다.** 개발자 계약 "겹치는 작업"
  절이 "lease가 문 것이 작업 문서가 아니고 이 작업의 선언이 읽히면 대조할 상대가 없어 열려 있다"로
  적은 경우다. 이 작업의 `scope_files`는 다섯 경로가 읽히는 모양으로 선언돼 있다. `SPEC-009.yml`은
  만료(2026-08-03T01:20:00Z)다. **세 파일 모두 읽기만 했다.**
- `.workflow/.runtime/migration.lock` 없음.

## 착수 전 계약 재대조 (완료 조건 6)

`docs/heartbeat.md`의 인용 절이 "이 값에 기대는 작업은 착수 시점의 계약 문서를 다시 읽어 이 절과
대조하라"고 적어 두었으므로, 데몬 저장소(`~/Git/claude-heartbeat`)를 읽어 대조했다.

| 확인한 것 | 결과 |
| --- | --- |
| 저장소 HEAD | `e4a76ec feat: v0.8.0 — jobs.d 기반 + 앱 연동 표면(버전·_daemon·heartbeat update) (#21)`, 작업 트리 깨끗함 |
| 2번 절(`heartbeat --version`) | 계약 80~102줄("버전 표면"). "출력은 `heartbeat <X.Y.Z>` 형식, stdout, 종료 코드 0" — 인용 절과 같다 |
| 3번 절(`_daemon`) | 계약 103~123줄. 예약 키 규약, `version`·`pid`·`started_at` 셋, "한 번도 뜬 적 없으면 키 자체가 없다" — 인용 절과 같다 |
| 용도 문장 | 계약 121~123줄. "`_daemon.version`이 `heartbeat --version`과 다르면 디스크는 갱신됐는데 프로세스는 옛 코드" — 이 작업의 판정 설계 그대로다 |

이 작업이 쓰는 표면은 인용 절 2번·3번 둘뿐이다. 다른 표면에 기대지 않는다.

**인용 절의 한 문장이 낡았다(핸드오프 노트 1번).** `docs/heartbeat.md` 152줄이 "그 커밋은 브랜치
`claude/app-update-surface`에만 있고 `main`에 병합되지 않았다"고 적었는데, 지금 그 계약은 `main`의
HEAD(`e4a76ec`)에 병합돼 있다. 값 자체는 인용과 일치하므로 이 작업의 근거는 흔들리지 않는다.
`docs/heartbeat.md`는 이 작업의 `scope_files` 밖이라 고치지 않았다.

## 구현

### 1. `_daemon.version` 접근자 — `infrastructure/heartbeat_status.rs`

`JobRuns::daemon_version()`을 하나 더했다. `JobRuns`는 이미 `state.json` 전체를 한 번 읽어 들고
있으므로 파일을 다시 열지 않는다.

`None`이 "모름"이고 오류가 아니다. 파일 없음·JSON 깨짐·`_daemon` 없음·`version` 없음·`version`이
문자열이 아님이 전부 같은 값으로 끝나고, 넷 중 어느 것도 읽기 실패 목록에 올라가지 않는다. 이 모듈의
머리주석이 이미 세운 규약("대상 파일이 없거나 깨져 있어도 오류로 올리지 않는다")을 그대로 따랐다.

기존 코드는 손대지 않았다. 상수 둘(`_daemon`·`version` 키)과 메서드 하나, 검사 둘이 추가분의 전부다.

### 2. 판정 — `application/heartbeat_version_service.rs` (새 모듈)

결과 타입은 값 셋이다.

- `running`: `Known { version }` 또는 `Unknown`.
- `disk`: `Known { version }` / `NotFound { looked }` / `NotStarted { message }` /
  `OffContract { code, stdout, stderr }`.
- `verdict`: `Match` / `Mismatch` / `Undetermined { reasons }`.

**판정 불가의 사유를 목록으로 뒀다.** 이 기기처럼 실행 파일도 못 찾고 데몬도 한 번도 안 뜬 상태에서는
사유가 둘이다. 하나만 골라 실으면 나머지가 사라지고, 그것이 R4가 막는 뭉뚱그림이다. 사유 값은 넷이다 —
`executableNotFound`, `executableNotStarted`, `diskVersionOffContract`, `runningVersionUnknown`.
작업 본문이 요구한 셋에 `executableNotStarted` 하나가 더 있는데, 이것은 `run_capturing`이 이미 구분해
돌려주는 실패(찾긴 찾았는데 못 띄움)라 그 구분을 접지 않고 그대로 실었다. 사용자가 할 일이 설치 경로
쪽인지 파일 권한 쪽인지가 다르다.

**실행 파일을 찾았는지가 `disk` 값에서 확정된다.** `NotFound`면 본 후보 목록이 실리고, 그 밖의 값이면
찾은 것이다. TASK-117이 이 값을 그대로 쓸 수 있다.

**출력 파싱을 계약보다 좁게 잡았다.** 계약은 파싱하는 쪽에 "마지막 공백 뒤를 버전으로 읽으면 된다"고
적었지만, 그대로 하면 `heartbeat version 0.8.1`이나 `Traceback ... 0.8.1` 같은 줄에서도 앱이 뒤를
잘라 버전이라고 말하게 된다. 작업 본문의 "형식이 조금 다른 값을 앱이 버전처럼 잘라 내지 않는다"를
따라, 비어 있지 않은 줄이 정확히 하나이고 그 줄의 토큰이 정확히 둘이며 앞 토큰이 `heartbeat`이고
종료 코드가 0일 때만 읽는다. 어긋나면 `OffContract`로 두고 stdout·stderr 원문과 종료 코드를 보존한다.

반대로 **뒤 토큰의 모양은 검사하지 않는다.** 계약이 `X.Y.Z`를 검사하라고 적지 않았고, 앱이 거기에
자기 규칙을 더하면 데몬이 표기를 넓힐 때(예: `0.9.0.dev1`) 앱만 모름으로 떨어진다.

**두 문자열을 그대로 비교한다.** 앞뒤를 다듬거나 표기를 맞추지 않는다 — 정규화는 다른 두 값을 같게
만드는 일이고, 그것이 어긋남을 감춘다.

읽기 실패 목록은 이 경로에서 버린다. 그 목록은 연동 카드가 "무엇을 못 읽었나"를 보이는 자리이고,
이 커맨드가 답할 것은 버전 하나다 — 파일을 못 읽든 없든 이쪽의 답은 똑같이 "모름"이다.

### 3. 커맨드 — `commands/heartbeat.rs`, `lib.rs`

`check_heartbeat_versions`. 인자 없음, `async` + `spawn_blocking`. 커맨드 머리주석에
"조회 주기·화면 진입의 자동 갱신에서는 부르지 않는다"를 적었다. `inspect_integrations`에는 한 줄도
얹지 않았다. `invoke_handler`에 등록했다.

이름을 `inspect_`로 시작하지 않게 뒀다. 이 저장소에서 `inspect_`는 프로세스를 띄우지 않는 값싼 조회의
이름이고(`inspect_project`·`inspect_integrations`), 이것은 프로세스를 하나 띄운다.

## 검증

### 검증 절차 1~3

| 명령 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **498 passed / 0 failed** (새 검사 18건 포함) |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 경고 0 |
| `npm run check` (typecheck + vitest + build) | **546 passed / 20 파일**, 빌드 성공 |

`state.json` 픽스처는 다섯을 세웠다 — 정상 `_daemon`, `_daemon` 없음, `version` 없음, `version`이
문자열 아님, 깨진 JSON, 파일 없음. `--version` 출력은 여섯을 세웠다 — 정상 한 줄, 빈 출력, 여러 줄,
토큰 셋(`heartbeat version 0.8.1`), 앞 토큰 다름(`claude-heartbeat 0.8.1`), 계약 모양인데 종료 코드
비0. 어긋남 판정은 세 조합으로 세웠다 — 같음, 다름, 한쪽 모름, 그리고 둘 다 모름.

완료 조건 5의 검사는 `inspecting_the_integrations_starts_no_process`다. 첫 후보 자리
(`~/.local/bin/heartbeat`)에 실행되면 흔적 파일을 남기는 스크립트를 세워 두고 `HeartbeatService.inspect`
를 한 번 부른 뒤 그 흔적이 없다는 것을 본다. 조회 쪽에 판정을 부르는 줄이 생기면 이 검사가 깨진다.

### 검증 절차 4 — 이 기기 실측 (2026-08-05T06:40Z 전후)

`HeartbeatVersionService.versions()`를 이 기기의 실제 홈으로 한 번 돌렸다. 임시 검사를 붙여 실행하고
결과를 받은 뒤 지웠다 — 저장소에 남아 있지 않다.

`~/.claude/heartbeat/state.json`의 `_daemon` 항목 원문:

```json
{"version": "0.8.0", "pid": 875, "started_at": "2026-08-05T10:35:49.785635"}
```

**같은 코드가 PATH에 따라 두 결과로 갈렸다.**

1. 셸 PATH 그대로(개발 셸):

```
running: Known { version: "0.8.0" }
disk:    Known { version: "0.8.0" }
verdict: Match
```

2. GUI가 물려주는 것에 가까운 PATH(`/usr/bin:/bin:/usr/sbin:/sbin`)로 같은 바이너리를 다시 실행:

```
running: Known { version: "0.8.0" }
disk:    NotFound { looked: ["heartbeat", "/Users/catze/.local/bin/heartbeat"] }
verdict: Undetermined { reasons: [ExecutableNotFound] }
```

**확인 사실 11이 그대로 재현됐고, 판정 불가의 사유는 실행 파일 쪽이다.** 이 기기의 실행 파일은
`/Users/catze/.pyenv/versions/3.11.9/bin/heartbeat`에 있고 `~/.local/bin/heartbeat`는 없다.
개발 셸에서 1번이 나온 것은 그 셸의 PATH에 pyenv가 들어 있어 첫 후보인 맨 이름 `heartbeat`가 풀렸기
때문이고, `heartbeat_process.rs`의 주석이 적은 "GUI로 띄운 앱이 물려받는 PATH는 사용자 셸의 PATH와
다르다"가 정확히 이 차이다.

`heartbeat --version`의 실제 출력은 `heartbeat 0.8.0` 한 줄, 종료 코드 0이었다. 계약이 적은 모양이다.

**앱을 GUI로 띄워 화면에서 부른 것은 아니다.** 화면 호출은 TASK-117의 자리이고 지금은 이 커맨드를
부르는 화면이 없다. 2번이 GUI 경로의 근사이지 그 자체는 아니라는 것을 QA에서 감안해 달라.

### 완료 조건 대조

| # | 조건 | 결과 |
| --- | --- | --- |
| 1 | `_daemon.version` 경로, 파일 없음·깨짐·항목 없음이 모두 "모름" | 닫힘 (`daemon_version()` + 검사 2건) |
| 2 | `--version`에서 디스크 버전, 계약 밖 형식은 "모름"이고 원문 보존 | 닫힘 (`parse_version` + `OffContract`) |
| 3 | 판정 셋이 구분되고 판정 불가 사유가 갈린다 | 닫힘 (`VersionVerdict` + `UndeterminedReason` 넷) |
| 4 | 못 찾으면 후보 목록이 실리고 도는 버전은 그래도 실린다 | 닫힘 (검사 + 이 기기 실측 2번) |
| 5 | `inspect_integrations` 경로에 들어가지 않는다, 검사로 남는다 | 닫힘 (`inspecting_the_integrations_starts_no_process`) |
| 6 | 앱이 쓰는 표면이 인용 절에 적힌 것뿐 | 닫힘 (2번·3번 절만 사용, 착수 시점 계약 재대조) |
| 7 | 설치 판정·잡 저장·"지금 실행"·084 경고 불변, 기존 검사가 기대값 수정 없이 통과 | 닫힘 (기존 검사 무수정, 기존 코드 경로 무변경) |
| 8 | 기존 자동 검사 삭제·비활성화 없음, `npm run check`·`cargo test` 통과 | 닫힘 (삭제·`#[ignore]` 0건) |

## 변경한 파일

`scope_files` 다섯 안에서만 고쳤다.

- `src-tauri/src/application/heartbeat_version_service.rs` — 새 모듈. 두 값 읽기·판정·결과 타입.
- `src-tauri/src/application/mod.rs` — 모듈 등록 한 줄.
- `src-tauri/src/commands/heartbeat.rs` — `check_heartbeat_versions` 커맨드와 import 한 줄.
- `src-tauri/src/lib.rs` — `invoke_handler` 등록 한 줄.
- `src-tauri/src/infrastructure/heartbeat_status.rs` — `daemon_version()` 접근자, 상수 둘, 검사 둘.

## QA에서 봐 줄 것

지금은 이 커맨드를 부르는 화면이 없다(화면은 TASK-117). 그래서 사용자 QA에서 볼 수 있는 것은
백엔드 검사와 위 실측 둘이다. 화면에서의 확인은 TASK-117의 QA 자리다.

## 핸드오프 노트 (이 역할의 범위 밖)

1. `docs/heartbeat.md` 152줄의 "그 커밋은 `main`에 병합되지 않았다"가 낡았다. 계약은 지금 데몬
   저장소 `main`의 HEAD `e4a76ec`에 있다. 값은 인용과 일치하므로 판정에 영향이 없다. 그 문서는 이
   작업의 `scope_files` 밖이라 고치지 않았다.
2. 계약이 `heartbeat version` 서브커맨드도 같은 한 줄을 낸다고 적었지만 이 작업은 `--version`만
   쓴다. 두 형태 중 하나면 충분하고 둘을 다 부르면 프로세스가 둘이 된다.
3. `state.json` 최상위의 밑줄 예약 키를 잡 목록으로 훑는 코드가 이 저장소에 있는지는 확인하지
   않았다. 지금 잡 조회(`JobRuns::get`)는 이름으로 정확히 찾는 형태라 예약 키에 걸리지 않지만,
   나중에 최상위를 순회하는 코드가 생기면 계약 106줄의 "예약 키를 건너뛰어야 한다"가 걸린다.
