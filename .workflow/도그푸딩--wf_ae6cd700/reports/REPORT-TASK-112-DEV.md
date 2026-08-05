# TASK-112 개발자 핸드오프 (blocked)

- 대상: TASK-112 (데몬 계약의 착지를 확인하고 앱이 인용할 표면을 문서에 고정한다)
- 근거: SPEC-037 R7 · 확인 필요 5번의 승인안,
  DECISION-6C2F2639 (`schema: workflow-labs/decision@1`, `spec_id: SPEC-037`, `outcome: approved`,
  `created_by: user`, 2026-08-05T03:10:59.967916+00:00 — 직접 확인. SPEC-037의 결정 문서는 이 1건뿐이라
  더 늦은 결정이 없고, 승인이 유효하다)
- 역할: 개발자 (developer-claude)
- 결과: **`blocked`**. 착수 조건 (a)·(b)가 둘 다 미충족이라 `docs/heartbeat.md`에 아무것도 쓰지 않았다.
- 선점: `acquire TASK-112 developer-claude 30` exit 0 → `lease-23446-20260805042605` →
  `in_progress`(2026-08-05T04:26:15Z) → 실측 → `blocked`(2026-08-05T04:27:42Z) → `release`.
  `renew`는 부르지 않았다(작업이 lease 유효 구간 안에서 끝났다).

## 선점 경위 — 처음 고른 대상은 TASK-110이었다

이 세션이 처음 고른 대상은 TASK-110이었다. `acquire TASK-110 developer-claude 30`이 exit 3을 냈고,
`.workflow/.runtime/leases/TASK-110.yml`에 `agent: tl-dev-110`,
`lease_id: lease-23024-20260805042515`, `expires_at: 2026-08-05T04:55:15Z`가 있었다. 판정 시각은
2026-08-05T04:25:55Z이므로 미만료다. 다른 세션이 40초 앞서 잡은 것이고, 공통 규칙 4절대로 그 대상을
버리고 다음 후보로 옮겼다. **그 lease 파일은 읽기만 했다.**

## 선행·겹침 확인 (착수 시점 2026-08-05T04:26Z)

- `depends_on` 키가 없다. 기다리는 것이 없으므로 선행은 충족이다.
- `scope_files: [docs/heartbeat.md]`. 판정 시점의 미만료 lease는 `TASK-110.yml` 하나뿐이고, 그것이
  잡은 TASK-110의 선언은
  `[src-tauri/src/infrastructure/heartbeat_condition.rs, src-tauri/src/infrastructure/role_eligibility.rs, src-tauri/src/infrastructure/fs_project_repository.rs]`
  다. 같은 경로가 하나도 없어 겹침이 아니다.
- 나머지 lease 둘은 만료였다 — `IDEA-886DAB21.yml`(만료 2026-08-05T00:25:31Z),
  `SPEC-009.yml`(만료 2026-08-03T01:20:00Z).
- 착수 시점 `todo`는 TASK-110~117 8건. 111은 `depends_on: [TASK-102, TASK-110]`에서 TASK-110이 `todo`라
  미충족, 113~117은 모두 TASK-112를 (직간접) 선행으로 두어 미충족이다. TASK-110이 선점된 뒤 남은 후보는
  TASK-112 하나였다. `sh .workflow/rules/wf-eligible.sh developer`도 exit 0 / `eligible`이었다.
- `.workflow/.runtime/migration.lock` 없음.

## 실측 — (a)·(b) 모두 미충족

작업 지시대로 아키텍트의 2026-08-05T03:1xZ 관찰을 근거로 쓰지 않고 다시 측정했다. 측정 시각
2026-08-05T04:26~04:27Z, 대상 `~/Git/claude-heartbeat`(브랜치 `claude/app-update-surface`).

### (a) 데몬 변경이 커밋됐다 → 미충족

`git status --short`:

```
 M pyproject.toml
 M src/heartbeat/__init__.py
 M src/heartbeat/cli.py
 M src/heartbeat/core.py
 M src/heartbeat/service/__init__.py
 M src/heartbeat/service/base.py
 M src/heartbeat/service/launchd.py
 M src/heartbeat/service/systemd.py
 M src/heartbeat/service/task_scheduler.py
?? src/heartbeat/update.py
```

`git log --oneline -1`:

```
25e372e commit
```

- HEAD는 `25e372e123c819990c163252fb5d5cd119c19ac1`. 아키텍트가 본 `25e372e`와 같은 커밋이고, 그 사이에
  새 커밋이 없다.
- `git ls-files --error-unmatch src/heartbeat/update.py` →
  `error: pathspec ... did not match any file(s) known to git`. `update.py`는 여전히 추적되지 않는다.
  즉 하트비트 쪽 변경이 작업 트리에만 있는 상태다.
- 아키텍트 실측과 다른 점 하나: 수정 파일이 넷이 아니라 아홉으로 보인다. `service/`를 디렉터리
  한 줄로 센 것과 파일별로 센 것의 차이이고, 판정에는 영향이 없다.

### (b) `docs/config-contract.md`에 계약이 적혔다 → 미충족

`docs/config-contract.md`는 84줄이고, 마지막으로 이 파일을 만진 커밋은
`6042cc3 feat: per-project jobs.d, barrier-free scheduler, condition reason channel (v0.8.0 candidate)`
다. 세 문자열을 찾은 결과가 전부 0건이다.

| 찾은 것 | 결과 |
| --- | --- |
| `update` | 0건 |
| `--version` | 0건 |
| `_daemon` | 0건 |
| `version` | 0건 (넓혀서 찾아도 없다) |

절 구성(줄 번호)은 이렇고, `heartbeat update`·버전 표면이 들어갈 자리가 아직 없다.

```
 1: # 설정 계약 (config contract)
 7: ## 파일 위치와 소유
23: ## 잡 문법
26: ## <잡 이름>
42: ## 병합 우선순위
50: ## condition의 실행 환경과 사유 통로
58: ## 실행 모델
67: ## state.json에서 계약인 키
80: ## 마이그레이션
```

가장 가까운 자리인 `## state.json에서 계약인 키`(67~79줄)는 잡별 키 다섯(`last_run`·`last_result`·
`last_duration`·`last_condition_output`·`recent_runs`)만 계약으로 적고 "이 밖의 키는 내부 구현이다"로
닫는다. `_daemon`은 그 목록에 없고, 그 문장대로라면 **지금은 내부 구현**이다. 앱이 인용할 근거가 없다.

- 커밋된 `docs/` 전체에서도 `heartbeat update`·`heartbeat --version`·`_daemon`이 0건이다
  (`git grep HEAD -- docs`).
- `docs/`에 미추적·수정 파일이 없다(`git status --short docs/`가 빈 출력). 작업 트리 어딘가에 초안이
  있어서 놓친 것이 아니다.

## 하지 않은 것

- `docs/heartbeat.md`에 "앱이 의존하는 데몬 표면" 절을 **쓰지 않았다.** 계약이 없는 값을 계약처럼 적는
  것이 작업 지시가 금지한 것이고, 이 저장소가 계약 문서를 대신 쓰는 것도 (b)의 충족이 아니다.
- 데몬 저장소를 고치지 않았다. 읽기 명령(`git status`/`git log`/`git grep`/`git ls-files`/`sed`)만 썼다.
- 이 저장소의 소스와 테스트도 한 줄도 바꾸지 않았다. 이 세션이 만진 파일은 TASK-112 문서와 이 보고서
  둘뿐이다.

## 검증

- 검증 절차 1·2는 위 "실측"이 그대로다.
- 검증 절차 3(`npm run check`, `cargo test --manifest-path src-tauri/Cargo.toml`)은 **돌리지 않았다.**
  완료 조건 4가 요구하는 것은 "소스가 안 바뀌었다"이고, 그 증거는 `git status --short -- src src-tauri`
  가 이 세션 전후로 같다는 것이다. 착수 전에 이미 있던 변경 둘(`src-tauri/src/infrastructure/
  heartbeat_condition.rs`, `docs/development-logs/2026-08-05.md`)은 이 세션의 것이 아니고 그대로 남아
  있다. 코드 변경이 0줄인 상태에서 두 명령을 돌려도 새로 얻는 정보가 없어 생략했다. 코드를 쓰는 경로,
  즉 (a)·(b)가 충족돼 이 작업이 다시 열리는 때에는 반드시 돌려야 한다.

## 이 상태는 스스로 풀리지 않는다 (사용자 조치 필요)

**데몬 쪽이 착지한 뒤, 사용자가 TASK-112의 `status`를 `blocked` → `todo`로 되돌려야 이 작업이 다시
열린다.** 앱에는 `blocked`을 `todo`로 되돌리는 경로가 없고, 개발자 자격 판정은 `todo`만 후보로 센다.
그대로 두면 SPEC-037의 나머지 다섯 작업(TASK-113~117)도 전부 이 작업을 선행으로 두므로 함께 잠긴다.

다시 열기 전에 확인할 것 둘, 즉 다음 세션의 첫 걸음:

1. `~/Git/claude-heartbeat`에서 `update.py`를 포함한 하트비트 변경이 커밋됐는지. HEAD가
   `25e372e`보다 뒤이고 `git ls-files src/heartbeat/update.py`가 그 파일을 알아야 한다.
2. `docs/config-contract.md`에 `heartbeat update`의 stdout 어휘(`step`·`status`·`detail`, 마지막
   `result` 줄)와 `result`의 세 값, 종료 코드 목록, `heartbeat --version` 한 줄의 모양,
   `state.json`의 `_daemon.version`이 계약으로 적혔는지.

## 리스크 / 후속

- SPEC-037이 승인된 채로 대기한다. 승인안이 스스로 적은 한계이고 이 작업이 새로 만든 문제가 아니다.
- `heartbeat init`·`heartbeat install-service`의 종료 코드 의미는 계약 문서가 다시 적히기 전에는
  판정할 수 없다. 지금 계약대로면 "0/비0만 쓴다"가 되고, 그 판정은 (b)가 충족되는 시점의 문서로
  다시 해야 한다. TASK-114가 무엇을 해도 되는지가 거기서 정해진다.
- 핸드오프 노트(역할 밖 관찰, 고치지 않았다): 데몬 저장소가 브랜치 `claude/app-update-surface`에서
  작업 중이다. 그 브랜치가 커밋·병합되는 것과 계약 문서가 적히는 것이 (a)·(b)이므로, 두 저장소의
  순서를 사람이 맞춰야 한다.

---

# TASK-112 개발자 핸드오프 2회차 (qa_waiting) — 차단 해제 후 완주

위 1회차 보고서는 `blocked` 시점의 기록이고 그대로 보존한다. 아래는 차단이 풀린 뒤 같은 작업을
완주한 세션의 기록이다.

- 세션: 개발자 (tl-dev-112), 2026-08-05T05:23~05:28Z
- 결과: **`qa_waiting`**. `docs/heartbeat.md`에 "앱이 의존하는 데몬 표면" 절을 더했다.
- 선점: `acquire TASK-112 tl-dev-112 30` exit 0 → `lease-85463-20260805052337` →
  `in_progress`(05:24:36Z) → 작업 → `renew` exit 0 → `qa_waiting`(05:28:35Z) → `release`.

## `blocked` → `in_progress`로 돌아온 경위

이 작업은 1회차 세션이 04:27:42Z에 `blocked`으로 둔 상태였다. 1회차 보고서가 적은 대로 앱에는
`blocked`을 `todo`로 되돌리는 경로가 없고 개발자 자격 판정은 `todo`만 후보로 세므로, 하트비트가
이 작업을 다시 집을 수 없다.

이 세션은 하트비트의 자격 판정으로 들어온 것이 아니라 **사용자 승인 하의 TL 지시로 투입됐다**
(TASK-104 인수 선례). 그래서 `wf-eligible.sh developer`의 종료 코드로 이 작업을 판정하지 않았고,
대신 작업 문서가 정의한 착수 조건 (a)·(b)를 직접 재실측해 차단 사유의 해소를 판정했다. 둘 다
성립했으므로 `blocked`에서 `in_progress`로 되돌리고 history에 네 번째 항목을 덧붙였다. 같은 `kind`가
두 번 나오는 것은 공통 규칙 5절이 허용한다("재작업 뒤 같은 `kind`가 다시 나올 수 있다").

착수 조건이 성립하지 않았다면 아무것도 바꾸지 않고 중단했을 것이다. 아래가 그 판정의 근거다.

## 차단 해제 재판정 — (a)·(b) 모두 충족

측정 시각 2026-08-05T05:23~05:24Z, 대상 `~/Git/claude-heartbeat`(브랜치 `claude/app-update-surface`).
1회차와 마찬가지로 데몬 저장소는 읽기만 했다.

### (a) 데몬 변경이 커밋됐다 → 충족

`git status --short`의 출력이 **비어 있다**(작업 트리가 깨끗하다).

```
$ git status --short
$ git log --oneline -1
611604f docs: 설정 계약에 버전 표면·heartbeat update 절 추가
```

- HEAD는 `611604f4f9c435b91cf7379d129e95c0a3da95fb`. 1회차가 본 `25e372e`보다 커밋 2건 앞이다
  (`611604f docs: …` ← `a709f82 feat: 버전 표면, 데몬 정체 기록, heartbeat update` ← `25e372e commit`).
- `git ls-files --error-unmatch src/heartbeat/update.py` → `src/heartbeat/update.py`, exit 0.
  1회차에 추적되지 않던 `update.py`가 이제 추적된다. 하트비트 쪽 변경이 작업 트리에만 있는 상태가
  아니다.

### (b) `docs/config-contract.md`에 계약이 적혔다 → 충족

파일이 84줄에서 **264줄**로 늘었고, 1회차에 0건이던 세 문자열이 모두 나온다.

| 찾은 것 | 1회차 | 이번 |
| --- | --- | --- |
| `update` | 0건 | `## heartbeat update 계약`(125줄)을 비롯해 다수 |
| `--version` | 0건 | 86줄(`$ heartbeat --version`), 121줄 |
| `_daemon` | 0건 | 103·106·109·117·121·176줄 |

새로 생긴 절과 줄 번호는 이렇다.

```
 80: ## 버전 표면
103: ### state.json의 `_daemon`
125: ## `heartbeat update` 계약
130: ### 출력 규격
143: ### `step=repo` — 저장소 갱신
161: ### `step=deps` — 의존성 반영
173: ### `step=service` — 데몬 재기동
202: ### `result=` 줄과 종료 코드
233: ### 예시
```

기존 일곱 절(1·7·23·26·42·50·58·67줄)은 자리를 지켰고 `## 마이그레이션`이 80줄에서 260줄로 밀렸다.
작업 지시가 든 세 절(`## 버전 표면` 80줄, `### state.json의 _daemon` 103줄,
`## heartbeat update 계약` 125줄)이 실재하는 것을 직접 확인했다.

`docs/config-contract.md`를 마지막으로 만진 커밋도 `611604f`다.

## `docs/heartbeat.md`에 더한 절

제목은 작업 지시대로 "앱이 의존하는 데몬 표면"이고, 파일 끝(기존 `## 선점 프로토콜과의 관계` 뒤)에
새 `##` 절로 붙였다. **기존 절의 문구는 한 글자도 고치지 않았다.** 절은 인용 출처를 머리에 밝히고
(커밋 `611604f`, 확인 일자 2026-08-05, 아래 줄 번호는 전부 그 커밋 기준) 다섯 표면을 순서대로 적는다.

1. **`heartbeat update`**(계약 125~231줄) — 출력 규격(130~141줄: stdout은 계약 줄만·진단은 stderr,
   공백으로 나뉜 `key=value`, 값에 공백 없음, 단계 줄 0~3개 뒤 `result=` 줄 정확히 하나가 마지막,
   `repo`→`deps`→`service` 순서, 모르는 key 무시). 단계별 `status`·`detail` 세 표를 계약의 143~159·
   161~171·173~200줄에서 그대로 옮겼다. `result=<값> version=<X.Y.Z> exit=<코드>` 세 키(202~209줄),
   `result`의 세 값 `ok`·`partial`·`failed`(211~215줄), 종료 코드 10가지 0·10·11·12·13·14·20·30·31·32
   (217~231줄).
2. **`heartbeat --version`**(계약 80~101줄) — `heartbeat <X.Y.Z>` 한 줄, stdout, 종료 코드 0.
   `heartbeat version` 서브커맨드가 같은 줄을 낸다. 파싱은 마지막 공백 뒤. 단일 원천은
   `__init__.py`의 `__version__`이고 `importlib.metadata`는 원천이 아니다(95~101줄).
3. **`state.json`의 `_daemon.version`**(계약 103~123줄) — 밑줄 키는 데몬 예약 영역이라 잡 목록을
   훑는 도구가 건너뛰어야 한다. 기동마다 덮어쓰이고 `version`·`pid`·`started_at`을 담는다. 키의
   존재는 "지금 돌고 있다"가 아니라 "마지막으로 뜬 데몬이 이랬다"이며, 생사는 `heartbeat status`가
   본다. 읽는 쪽 용도는 하나 — `heartbeat --version`과 다르면 디스크는 갱신됐는데 프로세스는 옛
   코드다(121~123줄).
4. **`heartbeat init`** — **종료 코드의 의미가 계약에 없다.** 계약 문서에서 이 명령이 나오는 자리는
   19줄 하나뿐이고 그 문장은 `jobs.d` 디렉터리를 만들어 둔다는 서술이다. 출력 형식도 종료 코드의
   의미도 없다. 그래서 절에 **"앱은 0과 비0만 쓴다"**를 적었다.
5. **`heartbeat install-service`** — **계약 문서에 문자열 자체가 0건이다.** 같은 이유로
   **"앱은 0과 비0만 쓴다"**를 적었다.

4번·5번에 딸린 마지막 소절이 그 제한을 명시한다: `heartbeat update`는 종료 코드가 원인별로 갈려
앱이 원인별 문구로 번역할 근거가 있지만 `init`·`install-service`에는 없고, 계약이 그 의미를 적기
전까지 앱이 할 수 있는 것은 성공·실패 두 갈래와 명령이 낸 출력의 전달뿐이다. **TASK-114가 무엇을
해도 되는지가 여기서 정해진다.**

계약에 없는 것은 절에 싣지 않았다. 배포 채널(PyPI·brew)은 SPEC-037이 제외 범위로 둔 것이고 계약
문서에도 없으므로 한 줄도 적지 않았다.

## 절이 새로 기록한 사실 — 계약이 `main`에 없다

인용하면서 확인한 것이고 1회차에는 없던 사실이다. **커밋 `611604f`는 브랜치
`claude/app-update-surface`에만 있고 `main`에 병합되지 않았다.**

```
$ git branch --contains 611604f
* claude/app-update-surface
$ git log --oneline -1 main
b1486ac fix(heartbeat): log monotonic + wall elapsed on timeout (#19) (#20)
$ git merge-base --is-ancestor 611604f main → 비0 (main의 조상이 아니다)
```

착수 조건 (a)는 "커밋됐는가"이지 "병합됐는가"가 아니므로 이 사실이 (a)를 뒤집지 않는다. 다만 병합
과정에서 계약이 달라질 수 있어서, 절에 그 사실과 "이 값에 기대는 작업은 착수 시점의 계약 문서를 다시
읽어 이 절과 대조하라"를 함께 적었다.

## 검증

- 검증 절차 1·2는 위 재판정이 그대로다.
- 검증 절차 3을 이번에는 돌렸다(1회차는 코드 변경이 0줄이라 생략했다).

| 게이트 | 결과 |
| --- | --- |
| `npm run check` | exit 0. Test Files 20 passed (20), Tests **546 passed (546)**, `tsc -b && vite build` 성공 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0. **453 passed; 0 failed**; 0 ignored (main.rs 0건, Doc-tests 0건) |

- 완료 조건 4("소스와 테스트가 한 줄도 바뀌지 않는다")의 증거: `git status --short -- src src-tauri`가
  이 세션 전후로 같다. 착수 전에 이미 있던 변경 넷(`fs_project_repository.rs`,
  `heartbeat_condition.rs`, `project_instructions.rs`, `role_eligibility.rs`)은 다른 세션의 것이고
  그대로 남아 있다. 이 세션이 만진 파일은 `docs/heartbeat.md`, `tasks/TASK-112.md`, 이 보고서 셋뿐이다.
- 기존 테스트 이름·단언을 고치지 않았고 삭제·비활성화하지 않았다.
- `cargo`는 PATH에 `~/.cargo/bin`을 더해 실행했다.

## 하지 않은 것

- 결정 문서를 쓰지 않았다. 이 세션은 어떤 승인도 기록하지 않는다.
- 두 저장소 어디에서도 `git commit`·`git push`를 하지 않았다.
- 데몬 저장소를 고치지 않았다. 읽기 명령(`git status`/`log`/`ls-files`/`branch`/`merge-base`/`grep`/
  `wc`/`sed`)만 썼다. 데몬 재시작·`launchctl`도 부르지 않았다.
- lease 파일을 직접 편집하지 않았다. `wf-claim.sh`만 썼다.
- 타 세션의 워크플로 문서를 건드리지 않았다.

## 리스크 / 후속

- **계약이 `main`에 없다.** 병합 전에 계약이 손질되면 이 절의 값이 실제와 어긋난다. TASK-113~117이
  착수할 때 계약 문서를 다시 읽어 대조해야 하고, 절에도 그 지시를 적어 두었다. 두 저장소의 병합
  순서를 사람이 맞춰야 하는 것은 1회차 핸드오프 노트와 같은 문제다.
- **`init`·`install-service`의 종료 코드 의미가 여전히 없다.** 1회차가 "(b) 충족 시점의 문서로 다시
  판정해야 한다"로 남긴 항목이고, 이번에 판정한 결과가 "없다"이다. 계약이 갱신되기 전까지 TASK-114는
  두 명령의 결과를 원인별로 나눠 보일 수 없다. 계약에 그 의미를 넣을지는 데몬 저장소의 몫이라
  이 저장소가 결정하지 않는다.
- SPEC-037은 `status: user_review`이고 승인은 DECISION-6C2F2639(`created_by: user`,
  `outcome: approved`) 하나다. 이 작업은 그 승인에서 나온 것이고 승인은 유효하다.
- 이 작업이 `qa_waiting`이 되면서 TASK-113~117의 선행이 충족된다(선행은 `qa_waiting` 또는
  `completed`에서 충족). 다섯 작업이 함께 열리므로, 그중 `scope_files`가 겹치는 것들을 동시에 돌리지
  않도록 주의가 필요하다.
- 사용자 QA 관점: 확인할 것은 `docs/heartbeat.md` 끝의 새 절이고, 대조 대상은
  `~/Git/claude-heartbeat`의 `docs/config-contract.md`(커밋 `611604f`) 80~231줄이다.
