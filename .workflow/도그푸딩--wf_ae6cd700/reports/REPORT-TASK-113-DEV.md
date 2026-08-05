# TASK-113 개발자 핸드오프 (qa_waiting)

- 대상: TASK-113 (앱이 heartbeat update를 실행하고 계약 출력을 구조화한다)
- 근거: SPEC-037 R1·R4·R5·R7·R8,
  DECISION-6C2F2639 (`schema: workflow-labs/decision@1`, `spec_id: SPEC-037`, `outcome: approved`,
  `created_by: user`, 2026-08-05T03:10:59.967916+00:00 — 직접 확인. SPEC-037의 결정 문서는 이 1건뿐이라
  더 늦은 결정이 없고 승인이 유효하다)
- 역할: 개발자 (developer-claude), 2026-08-05T05:43~05:58Z
- 결과: **`qa_waiting`**. 완료 조건 1~11을 전부 닫았다.
- 선점: `acquire TASK-113 developer-claude 30` exit 0 → `lease-16484-20260805054341` →
  `in_progress`(05:43:46Z) → 구현·검증 → `renew` exit 0 → `qa_waiting` → `release`.

## 선행·겹침 확인 (착수 시점 2026-08-05T05:43Z)

- `depends_on: [TASK-112]`. TASK-112는 `qa_waiting`이므로 선행 충족이다.
- 착수 시점 `todo`는 TASK-113~117 5건. 114·115는 (직간접) TASK-113을 선행으로 두고, 116은 TASK-113,
  117은 TASK-114·115·116을 선행으로 두어 넷 다 미충족이었다. 후보는 TASK-113 하나였다.
- 미만료 lease 없음. 남아 있던 둘은 모두 만료였다 — `IDEA-886DAB21.yml`(만료 2026-08-05T00:25:31Z),
  `SPEC-009.yml`(만료 2026-08-03T01:20:00Z). 판정 시각 05:43Z. **두 파일은 읽기만 했다.**
- `sh .workflow/rules/wf-eligible.sh developer` → exit 0 / `eligible`.
- `.workflow/.runtime/migration.lock` 없음.

## 착수 전 계약 재대조 (완료 조건 10)

`docs/heartbeat.md`의 인용 절이 "이 값에 기대는 작업은 착수 시점의 계약 문서를 다시 읽어 이 절과
대조하라"고 적어 두었으므로, 데몬 저장소를 읽어 대조했다.

| 확인한 것 | 결과 |
| --- | --- |
| `~/Git/claude-heartbeat`의 `docs/config-contract.md` 줄 수 | 264줄 — TASK-112가 인용한 것과 같다 |
| 그 파일을 마지막으로 만진 커밋 | `611604f` — TASK-112가 인용한 바로 그 커밋 |
| 125~231줄(`heartbeat update` 계약) 본문 | 직접 읽어 `docs/heartbeat.md` 1번 절과 대조. 어긋남 0건 |

즉 **앱이 쓰는 표면은 인용 절에 적힌 것뿐이고, 인용 절과 계약 문서가 어긋나지 않는다.** 이 작업은
그중 1번(`heartbeat update`) 하나만 쓴다. 2번(`--version`)·3번(`_daemon.version`)은 TASK-115의 자리라
건드리지 않았고, 4번·5번은 TASK-114의 자리다.

한편 저장소 상태는 TASK-112 실측 이후 사용자 쪽에서 움직였다. TASK-112가 본 `611604f`(브랜치
`claude/app-update-surface`, `main` 미병합)가 그 뒤 PR #21로 병합되어, 착수 시점의 `main` HEAD는
`e4a76ec feat: v0.8.0 — jobs.d 기반 + 앱 연동 표면(버전·_daemon·heartbeat update) (#21)`이다.
**계약 문서의 내용은 병합 과정에서 바뀌지 않았다**(위 표의 줄 수·커밋 대조). TASK-112 보고서가 남긴
"병합 과정에서 계약이 달라질 수 있다"는 리스크는 이 대조로 닫혔다.

## 만든 것

### 1. 출력을 버리지 않는 실행 (`infrastructure/heartbeat_process.rs`)

- `Captured { program, code, stdout, stderr }` — 캡처 실행의 결과.
- `run_capturing(candidates, arguments) -> Result<Captured, RunFailure>` — 고정 인자로 띄우고 셋을
  함께 돌려준다. 후보 순서와 폴스루 규칙(앞 후보가 `NotFound`일 때만 다음 후보)은 `run_once`와 같다.
- `manual_command_for(arguments)` — 인자 목록에서 명령 원문을 만든다(`heartbeat update`).
- `output_of(program, arguments)` — stdout·stderr를 파이프로 받고 stdin은 닫는다.

**0이 아닌 종료 코드가 이 경로에서 실패가 아니다.** 계약이 코드로 원인을 가르므로(0·10~14·20·30~32)
실패로 접으면 원인도 stdout·stderr도 함께 사라진다. `run_once`의 규약은 반대이고 그대로 두었다.

`run_once`·`status_of`·`manual_command`·`candidates`·`candidates_for`와 기존 테스트 7건은 한 줄도
고치지 않았다(완료 조건 2). `tauri-plugin-shell`을 붙이지 않았고 셸을 거치지 않는다.

### 2. 계약 출력을 값으로 옮기는 서비스 (`application/heartbeat_update_service.rs`, 신규)

- `const ARGUMENTS: [&str; 1] = ["update"]` — 실행 인자는 이 상수 하나다.
- `UpdateStep { step, status, detail }` — 단계 줄 하나.
- `HeartbeatUpdate` — 결과 타입. `#[serde(tag = "kind", rename_all = "camelCase")]`
  (`domain/project.rs`의 `JobQuota`가 같은 어법의 선례다). 세 변형:
  - `contract { steps, result, version, code, stdout, stderr }`
  - `offContract { code, stdout, stderr }`
  - `notRun { message, command, looked }`
- `HeartbeatUpdateService::update(user_home)` / 후보를 직접 받는 `update_with`.

### 3. 커맨드 (`commands/heartbeat.rs`, `lib.rs`)

`update_heartbeat(app) -> Result<HeartbeatUpdate, String>`. 인자는 `app` 하나이고 `path`를 받지
않는다. `async` + `spawn_blocking`(`run_heartbeat_job`의 선례). `invoke_handler`에 등록했다.
`Err(String)`은 홈 해석 실패와 블로킹 작업 합류 실패 두 가지뿐이고, 실행 실패는 `Ok(notRun)`이다 —
R5가 그것을 일급 결과로 두라고 적었다.

## 판정에서 갈린 자리 두 곳 (아키텍트·QA가 볼 값)

### 계약 안/밖을 가르는 기준은 stdout의 모양 하나다. 종료 코드가 아니다.

작업 지시 1번은 "`result=` 줄이 있고 **종료 코드가 계약이 적은 값**이다 → 정상 경로"로 적었고, 같은
절 끝은 "계약에 없는 종료 코드는 번역하지 않고 숫자 그대로 싣는다 … 화면이 '모르는 코드'로 말할 수
있어야 한다"로 적었다. 둘을 같이 만족시키려면 코드가 기준이 될 수 없다.

**모르는 코드를 계약 안에 두고 숫자를 그대로 실었다.** 근거는 계약 문서 자신이다 — "새 원인이 생기면
같은 자리수 안에서 번호가 는다"(계약 230~231줄)와 "모르는 key는 무시한다. 키 추가는 하위호환
변경이다"(계약 140~141줄). 모르는 코드를 "계약 밖"으로 부르면 앱이 **새 데몬 앞에서 스스로 깨진다.**
어느 쪽이든 숫자는 결과에 그대로 실리므로 화면이 잃는 정보는 없다.

가르는 검사는 이렇다. 마지막 줄이 `result` 키를 가져야 하고, 앞의 줄은 전부 `step` 키를 가져야 하며,
모든 줄의 모든 토큰이 빈 키가 아닌 `key=value`여야 한다. 한 군데라도 어긋나면 계약 밖이다.
("`result=` 줄은 정확히 하나이고 마지막"이므로, 마지막이 아닌 자리의 두 번째 `result` 줄도 여기 걸린다.)

### 단계 줄에서 읽는 키는 `step`·`status`·`detail` 셋이다.

작업 지시가 "단계 줄은 `status`와 `detail`을 싣는다"로 적은 그대로다. 계약이 더 붙을 수 있다고 적은
`from=`·`to=`(repo updated)와 `label=`(service)은 **구조화된 필드로 꺼내지 않았다.** 다만
`stdout` 원문을 결과에 통째로 실으므로 **버려지지는 않는다** — 화면이 필요하면 원문에서 본다.

TASK-116이 그 셋을 화면에 그려야 한다고 판단하면 필드를 더하는 것이 이 모듈의 한 줄짜리 변경이다.
지금 넣지 않은 이유는 작업 지시가 든 것이 둘이고, 쓰지 않을 필드를 계약으로 굳히지 않기 위해서다.

## 완료 조건 대조

| # | 조건 | 확인 |
| --- | --- | --- |
| 1 | 고정 인자 실행 경로, 후보 순서·폴스루 기존과 동일 | `run_capturing`. 폴스루 검사 2건 + 후보 순서 검사(기존) 통과 |
| 2 | `run_once`와 그 테스트 그대로 | 함수·테스트 무수정. `git diff`에 해당 줄 없음 |
| 3 | 단계 줄 0~3개 + `result` 줄 하나를 순서대로, 없는 단계 안 만듦 | `a_step_the_daemon_never_emitted_is_not_invented` |
| 4 | `result` 세 값과 종료 코드 그대로, `partial` 안 접힘 | `partial_stays_partial` |
| 5 | stderr 원문 그대로, 비면 빈 채로 | `stderr_is_carried_verbatim` |
| 6 | `result` 줄 없는 출력이 성공이 아님, 계약 밖으로 구분 | `output_without_a_result_line_is_not_read_as_success` 외 3건 |
| 7 | 못 찾으면 후보 목록 + 명령 원문 | `a_missing_executable_reports_the_paths_it_looked_at_and_the_command_to_type` |
| 8 | 이 경로에서 파일을 쓰지 않음 | `updating_writes_no_files_to_the_home_or_the_project` |
| 9 | 화면 문자열이 인자로 흘러갈 경로 없음 | 커맨드 인자가 `app` 하나. 인자는 상수 `ARGUMENTS` |
| 10 | 쓰는 표면이 인용 절에 적힌 것뿐 | 위 "착수 전 계약 재대조" |
| 11 | 기존 검사 유지, 두 게이트 통과 | 아래 검증 |

## 검증

| 게이트 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0. **472 passed; 0 failed**; 0 ignored (직전 453 → 신규 19건) |
| `npm run check` | exit 0. Test Files 20 passed (20), Tests **546 passed (546)**, `tsc -b && vite build` 성공 |
| `cargo fmt --check` | exit 0 (rustfmt 적용 후 클린) |
| `cargo clippy --all-targets -- -D warnings` | exit 0 |

- 기존 테스트 이름·단언을 고치지 않았고 삭제·비활성화하지 않았다. 프론트엔드는 한 줄도 만지지
  않았으므로 546건은 착수 전과 같은 수다.
- 신규 19건: `heartbeat_process` 5건(명령 원문, NotFound 후보 목록, stdout·stderr·코드 동시 수급,
  0 아닌 코드가 실패 아님, 캡처 폴스루), `heartbeat_update_service` 14건.
- 계약 출력의 대표 다섯을 픽스처로 고정했다(검증 절차 2) — `result=ok`(3단계 성공),
  `result=failed` 종료 코드 11(dirty-tree), `result=partial` 종료 코드 31, `result` 줄 없는 출력,
  빈 stdout.
- 파싱 검사는 stdout 문자열을 직접 넣고, 실행 검사는 recorder 스크립트 어법으로 세웠다(검증 절차 1).
- `cargo`는 PATH에 `~/.cargo/bin`을 더해 실행했다.

### 검증 절차 4 — 이 기기에서 실제로 부른 결과

`heartbeat update`를 이 기기에서 한 번 실행해 앱이 받게 될 값을 그대로 확인했다. 종료 코드 0,
stderr 비어 있음, stdout은 이렇다.

```
step=repo status=ok detail=up-to-date
step=deps status=skipped detail=not-needed
step=service status=skipped detail=not-needed
result=ok version=0.8.0 exit=0
```

이 출력은 파서가 `contract`로 읽는다 — 단계 셋(`repo`/`ok`/`up-to-date`, `deps`/`skipped`/
`not-needed`, `service`/`skipped`/`not-needed`), `result=ok`, `version=0.8.0`, `code=0`,
`stderr=""`. 계약 문서의 어휘와 정확히 일치한다.

**재기동은 일어나지 않았다.** 실행 전후로 `state.json`의 `_daemon`이 같다(`version 0.8.0`, `pid 875`,
`started_at 2026-08-05T10:35:49`). `step=service`가 `not-needed`로 끝난 것과 같은 사실이다. 실행이
안전한 no-op임을 먼저 확인하고 불렀다 — 로컬 HEAD(`e4a76ec`)와 `origin/main`이 같아 repo 단계가
움직일 수 없고, 도는 데몬 버전 `0.8.0`과 디스크 버전(`heartbeat --version` → `heartbeat 0.8.0`)이
같아 service 단계도 움직일 수 없다. 실행 뒤 `git status --short`는 여전히 비어 있고 HEAD도 그대로다
(원격 추적 ref만 갱신하는 `git fetch`가 이 명령이 한 전부다).

작업 지시는 "실행 파일을 찾지 못해 R5의 모양으로 끝날 가능성이 높다"고 예상했는데, **터미널에서는
찾았다.** 갈리는 것은 PATH다.

| 후보 | 셸(이 세션) | GUI로 띄운 앱이 물려받는 PATH |
| --- | --- | --- |
| `heartbeat`(PATH) | `/Users/catze/.pyenv/versions/3.11.9/bin/heartbeat` — 찾음 | `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin` 로 조회 시 exit 1 — 못 찾음 |
| `~/.local/bin/heartbeat` | 없음 | 없음 |

즉 **확인 사실 11은 여전히 유효하다.** 이 세션의 셸 PATH에 pyenv가 들어 있어 찾은 것이고, GUI로 띄운
앱에서는 두 후보 다 비어 R5의 `notRun` 경로로 떨어진다. 그 경로의 값은 단위 검사가 고정하고 있다.
사용자 QA에서 앱의 버튼을 눌렀을 때 나오는 것은 이 표의 오른쪽, 즉 "찾지 못했다 + `heartbeat update`"
쪽일 가능성이 높다.

## 검증 도중 실제로 데몬을 부른 일이 있었다 (사실 보고)

**처음 쓴 검사 하나가 진짜 `heartbeat update`를 실행했다.** 완료 조건 8을 확인하는
`updating_writes_no_files_to_the_home_or_the_project`가 `update(temp_home)`을 불렀는데, 그 경로는
`candidates()`가 만든 맨 이름 `heartbeat`를 첫 후보로 두고 그 이름이 **검사를 돌리는 셸의 PATH에서
해석된다.** 이 기기의 셸 PATH에 pyenv가 있어 실물이 떴다.

- 언제: 첫 `cargo test`와 두 번째 `cargo test`, 2026-08-05T05:50~05:53Z 사이 (`.git/FETCH_HEAD`
  mtime 14:52:52 KST가 마지막 fetch다).
- 무엇이 바뀌었나: **아무것도 바뀌지 않았다.** 그 시점에 이미 로컬 HEAD와 `origin/main`이 같아
  repo 단계가 `up-to-date`였고, HEAD가 안 움직여 deps는 `not-needed`, 도는 데몬과 디스크 버전이 같아
  service도 `not-needed`였다. 확인 근거: `git reflog`에 그 시간대의 HEAD 이동이 없고(14:50:07의
  `checkout main` + `pull --ff-only`는 사용자 쪽 조작이다), `git status --short`가 비어 있으며,
  데몬은 여전히 pid 875 / `started_at 10:35:49`로 재기동되지 않았다.
- 고친 것: 그 검사가 `update_with(&missing(&home))`만 부르도록 바꿨다. 이제 이 저장소의 어떤 검사도
  `update()`를 부르지 않는다(`grep '\.update('` 0건). `heartbeat_run_service.rs`의 같은 검사가
  후보를 직접 주는 이유가 이것이었고, 그 선례를 따르지 않은 것이 원인이다. 왜 그래야 하는지를 검사
  머리주석에 적어 두었다.

결과적으로 피해는 없지만, **`update()`를 부르는 검사는 실물을 실행한다**는 사실은 TASK-114·115가 같은
실행 기반을 쓰므로 그대로 물려받는 함정이다. 후보를 직접 주는 형태로만 검사를 세워야 한다.

## 하지 않은 것

- 프론트엔드를 만지지 않았다. `src/` 아래 변경 0줄이다. 화면은 TASK-116·117의 자리다.
- `domain/project.rs`를 만지지 않았다. 결과 타입은 서비스 모듈에 두었다(작업 지시대로).
- `heartbeat_update.rs`의 안내(SPEC-034)를 건드리지 않았다. R6의 폴백은 그대로 남아 있다.
- `--version`·`_daemon.version`·`init`·`install-service` 어느 표면도 쓰지 않았다. TASK-114·115의 자리다.
- 종료 코드를 사용자 문구로 번역하지 않았다. R4가 요구하는 원인별 문구는 화면의 자리다.
- 결정 문서를 쓰지 않았다. 이 세션은 어떤 승인도 기록하지 않는다.
- `git commit`·`git push`를 하지 않았다. 데몬 저장소는 읽기 명령만 썼다.
- lease 파일을 직접 편집하지 않았다. `wf-claim.sh`만 썼다.
- 타 세션이 이미 고쳐 둔 파일(`fs_project_repository.rs`, `heartbeat_condition.rs`,
  `project_instructions.rs`, `role_eligibility.rs`)을 건드리지 않았다.

## 리스크 / 후속

- **`update()`를 부르는 검사는 실물 데몬을 실행한다.** 위에 적은 함정이고, TASK-114·115가 같은 실행
  기반(`run_capturing`)을 쓰므로 그대로 적용된다. 검사는 후보를 직접 주는 형태로만 세워야 한다.
- **`from=`·`to=`·`label=`이 구조화된 필드로 없다.** 원문은 `stdout`에 있다. TASK-116이 그 값을
  화면에 그려야 한다고 보면 필드를 더하는 것이 이 모듈의 작은 변경이다. 지금 넣지 않은 것은 작업
  지시가 든 키가 `status`·`detail` 둘이어서다.
- **모르는 종료 코드가 `contract`로 읽힌다.** 화면이 "아는 코드"의 목록을 갖고 그 밖을 "모르는 코드"로
  말해야 R4의 마지막이 닫힌다. 그 목록은 계약의 열 가지(0·10·11·12·13·14·20·30·31·32)이고, 백엔드는
  숫자만 싣는다. TASK-116의 자리다.
- **`result` 값이 문자열이다.** 세 값 중 하나가 아닌 값이 와도 그대로 실린다. 접지 않는 쪽이 완료
  조건 4이므로 의도한 것이고, 화면이 아는 세 값 밖을 어떻게 말할지는 TASK-116이 정한다.
- 이 작업이 `qa_waiting`이 되면서 **TASK-114와 TASK-116의 선행이 충족된다.** 둘은 `scope_files`가
  겹치지 않으므로(백엔드 5개 vs 프론트엔드 11개) 병렬로 돌려도 된다. TASK-115는 TASK-114를,
  TASK-117은 셋 모두를 기다린다.
- 핸드오프 노트(역할 밖 관찰, 고치지 않았다): 데몬 저장소의 `claude/app-update-surface`가 PR #21로
  `main`에 병합됐고 계약이 `main`에 실렸다. TASK-112 보고서가 남긴 "계약이 `main`에 없다" 리스크는
  해소됐다. `docs/heartbeat.md`의 인용 절은 아직 "그 커밋은 브랜치에만 있고 main에 병합되지
  않았다"(152줄)로 적고 있어 지금 사실과 다르다. 그 파일은 TASK-112의 `scope_files`이고 이 세션의
  범위가 아니라 고치지 않았다 — 사용자 QA나 후속 작업에서 다룰 자리다.

## 사용자 QA 관점

- 확인 대상은 백엔드 커맨드 `update_heartbeat` 하나다. **화면에는 아직 버튼이 없다** — 버튼은
  TASK-116의 자리이므로, 이 작업의 QA는 앱 UI가 아니라 코드와 검사로 한다.
- 두 게이트를 직접 돌려 보는 것이 가장 빠른 확인이다:
  `cargo test --manifest-path src-tauri/Cargo.toml`(472 passed), `npm run check`(546 passed).
- 계약 대조를 직접 하려면 `docs/heartbeat.md`의 "앱이 의존하는 데몬 표면" 1번 절과
  `~/Git/claude-heartbeat`의 `docs/config-contract.md` 125~231줄을 나란히 본다.
- 이 기기에서 `heartbeat update`를 손으로 쳐 보면 위 "검증 절차 4"의 출력이 그대로 나온다(지금은
  no-op이라 데몬이 재기동되지 않는다).
