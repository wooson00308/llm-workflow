# TASK-001 개발자 핸드오프

- 대상 작업: TASK-001 (하트비트 가이드 문서 docs/heartbeat.md 작성)
- 출처 기획서: SPEC-001
- 승인 결정: DECISION-367DD9BF (`outcome: approved`, `created_by: user`)
- 세션 역할: 개발자
- 작성 시각: 2026-08-01T16:12:40Z

## 결과

SPEC-001의 R1~R4를 `docs/heartbeat.md` 신규 파일 1개로 구현했다. 작업 상태를 `qa_waiting`으로 올렸다. R5(스크립트 git 추적, README 링크)는 TASK-002 범위이므로 손대지 않았다.

## 변경한 파일

| 파일 | 변경 | 내용 |
| --- | --- | --- |
| `docs/heartbeat.md` | 신규 | 하트비트 가이드 본문 |
| `.workflow/.../tasks/TASK-001.md` | 수정 | `status: todo` → `in_progress` → `qa_waiting`, `updated_at` 갱신 |
| `.workflow/.../reports/REPORT-TASK-001-DEV.md` | 신규 | 이 리포트 |

앱 코드(`src/`, `src-tauri/`), `.workflow/rules/*`, `scripts/wf-eligible.sh`, `README.md`는 변경하지 않았다.

## 문서 구성

`docs/file-contract.md`·`docs/releasing.md`와 같이 `# 제목` + 도입 문단 + `##` 섹션, 평서형 종결로 작성했다.

- 도입: 앱이 LLM을 실행하지 않으므로 기동은 사용자 환경의 책임이라는 점 (R1)
- `하트비트의 기본 구조`: 조건 검사 → 대상이 있을 때만 세션 실행 → 종료 후 재검사. `<llm-cli>` 자리표시자로 공급자 중립 명시 (R2)
- `역할 잡 3종`: 기획자·아키텍트·개발자 각각 대상·예시 스크립트·프롬프트 요지·권장 주기 (R2)
- `주기를 정하는 근거`: 세션 소요 시간보다 짧은 주기는 lease에 막힌 중복 기동만 늘린다는 논지 (R2)
- `조건 스크립트 사용법`: 실행 위치·인자·종료 코드 표·migration.lock 동작·판정 단위·역할별 판정 기준 (R3)
- `현재 한계`: lease 만료 미확인, `planner`의 `revision_requested` 미감지, `architect`의 최신 결정 미확인 (R3)
- `선점 프로토콜과의 관계`: 사전 필터 대 클레임 구분, `NO_ELIGIBLE_WORK` 정상 종료, 금지 사항 2건, 병렬 실행 조건 (R4)

권장 주기는 기획자·아키텍트 30분, 개발자 15분으로 정했다. 개발자를 짧게 잡은 이유는 아키텍트 세션 한 번이 `todo` 작업을 여러 건 만들기 때문이다.

## 검증

프로젝트 루트에서 실행했다.

```sh
sh scripts/wf-eligible.sh planner; echo $?     # 1
sh scripts/wf-eligible.sh architect; echo $?   # 1
sh scripts/wf-eligible.sh developer; echo $?   # 0
sh scripts/wf-eligible.sh bogus; echo $?       # 2
sh scripts/wf-eligible.sh; echo $?             # 2
```

- `bogus`와 인자 없음은 저장소 상태와 무관한 값이며 문서에 적은 `2`와 일치한다.
- 나머지 셋은 실행 시점 상태값이고, 문서에 적은 판정 기준으로 전부 설명된다.
  - `planner: 1` — 아이디어 2건(IDEA-5061B2EC, IDEA-472E923E)이 모두 기획서의 `source_idea_id`로 참조되어 제외된다.
  - `architect: 1` — `approved` 결정 2건이 모두 작업의 `source_decision_id`로 참조되어 제외된다.
  - `developer: 0` — TASK-001은 이 세션의 lease와 `in_progress` 때문에 제외되지만, TASK-002~007이 lease 없는 `todo`로 남아 있다.
- migration.lock 동작은 코드 읽기로만 확인했다. 검증용 lock 파일을 만들지 않았다.

문서에 적은 인자 3종·종료 코드 3종·역할별 판정 기준을 `scripts/wf-eligible.sh` 원문과 한 줄씩 대조했다.

```sh
git status --short
git diff --stat
```

- 추적 대상 변경은 없고 `docs/heartbeat.md`가 미추적 신규 파일로 추가됐다. 스크립트 추적은 TASK-002 범위다.
- `docs/development-logs/2026-08-01.md`의 수정은 이 세션 이전부터 있던 변경이며 이 작업이 건드리지 않았다.

## 완료 조건 대조

| 조건 | 결과 |
| --- | --- |
| 1. 세 주제 모두 다룸 | 충족 |
| 2. 인자·종료 코드가 스크립트와 일치 | 충족 (위 검증) |
| 3. `0`이어도 `NO_ELIGIBLE_WORK` 가능 명시 | 충족 (`선점 프로토콜과의 관계`에 굵게 표기) |
| 4. 잡 3종 각각 대상·프롬프트 요지·주기와 근거 | 충족 |
| 5. 한계 3건 노출 | 충족 (`현재 한계`) |
| 6. `docs/heartbeat.md` 외 파일 변경 없음 | 충족 (작업 문서·리포트·lease는 워크플로우 프로토콜 산출물) |

## QA 참고

사용자가 확인할 지점이다.

- `docs/heartbeat.md`의 잡 예시를 실제 사용하는 LLM CLI로 치환했을 때 그대로 동작하는지. 예시는 `sh scripts/wf-eligible.sh <role> || exit 0` 뒤에 세션 실행 명령을 두는 형태다.
- 권장 주기 30분/15분이 실제 세션 소요 시간과 맞는지. 문서에도 실측으로 조정하라고 적었다.

## 리스크와 후속

- 예시가 쓴 `|| exit 0`는 종료 코드 `1`과 `2`를 구분하지 않는다. 인자 오타가 조용히 묻히는 문제라 문서에 주의 문구를 넣었지만, 예시 자체를 `case`문으로 바꾸는 선택지도 있다. 지금은 가독성을 택했다.
- 문서 안의 `[파일 계약](file-contract.md)` 링크와 `[현재 한계](#현재-한계)` 앵커는 GitHub 렌더링 기준이다. 다른 뷰어에서는 앵커가 다르게 잡힐 수 있다.
- TASK-002가 남아 있다. `scripts/wf-eligible.sh` git 추적과 README 링크 1줄이 붙어야 SPEC-001 완료 조건 4·5가 채워진다. 이 작업의 산출물이 준비됐으므로 TASK-002는 즉시 착수 가능하다.

## 범위 밖 발견 (핸드오프 노트)

이 세션에서 고치지 않았다.

- `scripts/wf-eligible.sh`의 `planner` 판정은 `revision_requested` 재작업을 감지하지 못한다. 하트비트로 기획자를 자동 기동하면 수정 요청 건은 영영 깨어나지 않는다. 스크립트 로직 변경이 필요하며 별도 아이디어·기획서 흐름을 타야 한다.
- 같은 스크립트의 lease 판정이 `expires_at`을 읽지 않아 만료된 lease가 대상을 영구 차단한다. 2026-08-01 로그의 lease 만료 교체 원자성 과제와 함께 다룰 여지가 있다.
