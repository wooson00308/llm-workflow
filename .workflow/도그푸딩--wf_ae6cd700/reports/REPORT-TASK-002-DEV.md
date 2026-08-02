# TASK-002 개발자 핸드오프

- 대상 작업: TASK-002 (하트비트 가이드 참조 무결성 확보)
- 출처 기획서: SPEC-001
- 승인 결정: DECISION-367DD9BF (`outcome: approved`, `created_by: user`)
- 세션 역할: 개발자
- 작성 시각: 2026-08-01T17:28:08Z

## 결과

SPEC-001의 R5를 구현했다. `scripts/wf-eligible.sh`를 git 추적 대상에 넣고, `README.md` 문서 링크 문단에 하트비트 가이드 링크를 추가했다. 작업 상태를 `qa_waiting`으로 올렸다.

## 선행 조건 판단

TASK-001은 `qa_waiting`이고 아직 `completed`가 아니다. 그래도 착수한 근거다.

- 의존성의 실제 사유는 산출물 존재다. TASK-002 문서가 "`docs/heartbeat.md`가 없는 상태에서 README 링크를 추가하면 깨진 링크가 된다"라고만 적었고, 그 파일은 이미 존재한다.
- 공통 규칙 5장은 기획서가 `user_review`일 때만 구현 진행을 막는다. 선행 작업의 QA 대기를 이유로 후속 작업을 막는 조항은 없다.
- TASK-001 리포트도 "이 작업의 산출물이 준비됐으므로 TASK-002는 즉시 착수 가능하다"로 마무리했다.
- TASK-001에 활성 lease가 없고 두 작업은 파일이 겹치지 않는다.

TASK-001이 QA에서 수정 요청으로 돌아가더라도 파일 경로는 유지되므로 이번 링크는 깨지지 않는다.

## 변경한 파일

| 파일 | 변경 | 내용 |
| --- | --- | --- |
| `scripts/wf-eligible.sh` | 추적 추가 | `git add`만 수행. 내용·파일 모드 변경 없음 |
| `README.md` | 수정 | 문서 링크 문단 끝에 하트비트 가이드 링크 1줄 추가 |
| `.workflow/.../tasks/TASK-002.md` | 수정 | `status: todo` → `in_progress` → `qa_waiting`, `updated_at` 갱신 |
| `.workflow/.../reports/REPORT-TASK-002-DEV.md` | 신규 | 이 리포트 |

앱 코드(`src/`, `src-tauri/`), `.gitignore`, `.workflow/rules/*`, `docs/heartbeat.md`는 이 세션에서 변경하지 않았다.

추가한 README 문장이다. 기존 문단의 `... 는 [링크](경로)에 정의되어 있습니다.` 계열 서술과 존댓말 종결을 따랐다.

```
역할 세션을 주기적으로 기동하는 잡 구성 방법은 [하트비트 가이드](docs/heartbeat.md)에 정리되어 있습니다.
```

## 검증

프로젝트 루트에서 실행했다.

```sh
git ls-files scripts/wf-eligible.sh
```

- `scripts/wf-eligible.sh` 출력. 추적됐다.

```sh
shasum -a 256 scripts/wf-eligible.sh   # 스테이징 전후 동일
stat -f '%Sp %p' scripts/wf-eligible.sh
```

- 해시 `e2cb2d4e...d76464`가 전후 동일하고 모드는 `100644`로 유지됐다. `git ls-files -s`도 `100644`을 보고한다.

```sh
git diff -- README.md
git diff --cached -- README.md
```

- 추가 2줄(빈 줄 1 + 링크 1), 삭제 0, 수정 0. 아래 "완료 조건 대조"의 4번 항목을 볼 것.

```sh
test -f docs/heartbeat.md && echo OK
```

- `OK`. 링크 대상이 실제로 있다.

```sh
git status --short
git diff --stat HEAD
```

- 이번 세션이 만든 추적 대상 변경은 `README.md`와 `scripts/wf-eligible.sh` 둘이다.
- 목록에 `docs/development-logs/2026-08-01.md`와 `src-tauri/src/infrastructure/mod.rs`도 남아 있다. 아래 "검증 절차와 실제 상태의 차이"를 볼 것.

## 완료 조건 대조

| 조건 | 결과 |
| --- | --- |
| 1. `git ls-files`가 경로 출력 | 충족 |
| 2. 스크립트 내용·모드 동일 | 충족 (해시·모드 대조) |
| 3. README 링크를 따라갈 수 있고 대상 존재 | 충족 |
| 4. README 변경이 링크 1줄 추가에 한정 | 조건부 충족. 링크 본문은 1줄이고 삭제·수정 줄은 0이다. 다만 문단 구분용 빈 줄 1개가 함께 추가되어 diff는 `+2`다 |
| 5. `src/`, `src-tauri/`, `.workflow/rules/` 변경 없음 | 이 세션 기준 충족. 작업 트리에 이전 세션 변경이 남아 있다 |

### 4번 조건에 대한 판단

검증 절차는 "`+` 1줄뿐인지 확인한다"라고 적었지만, README의 문서 링크 문단은 문장마다 빈 줄로 분리된 구조다. 빈 줄 없이 1줄만 붙이면 Markdown이 앞 문장과 한 문단으로 합쳐서 렌더링한다. 파일의 기존 서식을 지키는 쪽을 택했고, 그 결과 diff가 `+2`가 됐다. 삭제 줄과 수정 줄은 없으므로 "링크 1줄 추가에 한정된다"는 완료 조건 자체는 지켰다. QA에서 문자 그대로의 `+1`을 원하면 되돌리기는 한 줄 삭제로 끝난다.

### 검증 절차와 실제 상태의 차이

검증 절차 3번은 변경 목록이 `docs/heartbeat.md`·`README.md`·`scripts/wf-eligible.sh` 셋으로 한정되고 `src-tauri/` 경로가 없어야 한다고 적었다. 실제로는 아래 둘이 더 있다.

- `src-tauri/src/infrastructure/mod.rs` (수정): TASK-003·TASK-004가 추가한 `pub mod heartbeat_condition;`, `pub mod heartbeat_jobs;` 2줄.
- `docs/development-logs/2026-08-01.md` (수정): 이전 세션들의 로그 추가분.
- 미추적 신규 파일 `src-tauri/src/infrastructure/heartbeat_condition.rs`, `heartbeat_jobs.rs`도 같은 출처다.

전부 이 세션 이전부터 있던 변경이고 이번 작업은 건드리지 않았다. TASK-003·TASK-004가 `qa_waiting`이라 아직 커밋되지 않았을 뿐이다. 작업 문서를 쓸 때 작업 트리가 깨끗하다고 가정한 결과이며, 이 작업의 결함은 아니다.

## QA 참고

사용자가 확인할 지점이다.

- README 하단 문서 링크 문단의 렌더링. 세 문장이 각각 별도 문단으로 보이면 의도대로다.
- 하트비트 가이드 링크가 GitHub에서 실제로 이동하는지.
- `scripts/wf-eligible.sh`는 스테이징만 했고 커밋하지 않았다. 커밋은 사용자 몫이다. 스테이징 경로를 명시해서 `.workflow/`, `AGENTS.md`, `CLAUDE.md`, `.serena/`는 인덱스에 들어가지 않았다.

## 리스크와 후속

- `scripts/wf-eligible.sh`가 실행 권한 없는 `100644`로 추적됐다. 작업 문서가 모드 변경을 금지했고 가이드도 `sh scripts/wf-eligible.sh` 호출을 전제하므로 그대로 뒀다. `chmod +x` 후 직접 실행하고 싶다면 별도 판단이 필요하다.
- SPEC-001은 TASK-001 QA가 끝나면 마무리된다. 남은 `todo`는 SPEC-002 계열(TASK-005·006·007)뿐이다.

## 범위 밖 발견 (핸드오프 노트)

이 세션에서 고치지 않았다.

- `.gitignore`에 `.workflow/.runtime/` 항목이 없다. `.workflow/`를 추적하는 순간 lease 파일이 함께 커밋된다. 작업 문서도 범위 밖으로 명시했고 별도 판단이 필요하다.
- `.serena/`도 미추적 상태로 남아 있다. 무시 규칙 대상인지 결정된 바 없다.
- 작업 트리에 TASK-003·TASK-004의 미커밋 산출물이 쌓여 있다. QA 대기 작업이 늘수록 이후 작업의 "변경 목록 한정" 류 검증 절차가 계속 어긋난다. 작업 문서 작성 시 이 전제를 다르게 잡거나, QA 승인 시점에 커밋하는 운영 규칙이 필요하다.
