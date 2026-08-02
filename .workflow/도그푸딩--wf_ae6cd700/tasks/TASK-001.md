---
schema: workflow-labs/task@1
id: TASK-001
title: 하트비트 가이드 문서 docs/heartbeat.md 작성
status: completed
source_spec_id: SPEC-001
source_decision_id: DECISION-367DD9BF
updated_at: 2026-08-02T04:16:50.483744+00:00
---

# 하트비트 가이드 문서 docs/heartbeat.md 작성

SPEC-001의 R1~R4를 문서 하나로 구현한다. 문서는 앱 기능이 아니라 저장소 운용 가이드다.

## 의존성

- 선행 작업 없음. TASK-002가 이 작업의 산출물(`docs/heartbeat.md`)을 README에서 링크하므로 TASK-002보다 먼저 완료해야 한다.

## 범위

- 신규 파일 `docs/heartbeat.md` 1개만 생성한다.
- 다른 파일은 건드리지 않는다. README 링크와 스크립트 추적은 TASK-002가 담당한다.

## 작업 내용

### 1. 문서 신설 (R1)

- 경로는 `docs/heartbeat.md`다. 기획서 `확인 필요` 항목의 소문자 파일명 제안이 DECISION-367DD9BF로 승인됐다.
- 한국어로 작성하고 `docs/file-contract.md`·`docs/releasing.md`의 문체와 구조 수준을 따른다. 두 문서 모두 `# 제목` 뒤에 도입 문단을 두고 `##` 섹션으로 나누며, 평서형 종결(`~한다`)을 쓴다.
- 첫머리에 하트비트가 무엇인지, 왜 앱이 아니라 사용자 환경의 책임인지 2~3문장으로 밝힌다.

### 2. 역할 잡 3종 예시 (R2)

기획자·프로젝트 아키텍트·개발자 각각에 대해 독립된 잡 예시를 하나씩, 총 3개 제시한다.

- 세 예시 모두 공통 구조를 갖는다: 조건 검사 → 대상이 있을 때만 역할 세션 실행 → 세션 종료 후 아무것도 하지 않음(다음 주기에 재검사).
- 각 역할이 무엇을 대상으로 깨어나는지 명시한다.
  - 기획자: 미처리 아이디어 또는 `revision_requested` 결정
  - 프로젝트 아키텍트: 최신 결정이 `approved`인 기획서
  - 개발자: `todo` 상태 작업
- 각 예시에 역할 세션에 넘길 프롬프트의 요지를 포함한다: 역할 고정, 공통 규칙과 역할 계약 준수, 대상 없으면 `NO_ELIGIBLE_WORK` 보고 후 정지.
- 실행 주기 권장값과 근거를 적는다. 근거는 "작업 1건 소요 시간 대비 지나치게 짧은 주기는 중복 기동만 늘린다"는 논지를 담아야 한다. 구체적 숫자는 작성자가 정한다.
- 공급자 중립을 지킨다. 예시는 "조건 검사 명령 + 역할 세션 실행 명령"의 조합 형태로 제시하고, 실행 명령 자리는 사용자가 쓰는 LLM CLI로 교체 가능한 자리표시자임을 설명한다. 특정 제품 전용 설정을 유일한 정답으로 규정하지 않는다.

### 3. 조건 스크립트 사용법 (R3)

`scripts/wf-eligible.sh`의 현재 동작을 그대로 기술한다. 아래는 아키텍트가 원본을 읽고 확인한 사실이며, 작성 전에 스크립트를 직접 다시 읽어 대조한다.

- 실행 위치: 프로젝트 루트. 스크립트가 `.workflow/...` 상대 경로를 쓰므로 다른 위치에서 실행하면 판정이 틀어진다.
- 호출: `sh scripts/wf-eligible.sh <role>`. 인자는 `planner` | `architect` | `developer` 중 하나.
- 종료 코드: `0` = 처리 가능한 대상 있음, `1` = 없음, `2` = 잘못된 사용법. 인자를 생략한 경우도 `2`다.
- `.workflow/.runtime/migration.lock`이 있으면 역할 인자를 해석하기 전에 `1`을 반환한다. 마이그레이션 중에는 잘못된 역할 이름을 줘도 `2`가 아니라 `1`이 나온다.
- 역할별 판정 기준:
  - `planner`: 아이디어의 `id`에 대해, 그 id를 `source_idea_id`로 참조하는 기획서가 있으면 제외하고 `leases/<아이디어-id>.yml`이 있으면 제외한다.
  - `architect`: `outcome: approved`인 결정의 `id`에 대해, 그 id를 `source_decision_id`로 참조하는 작업이 있으면 제외하고, 그 결정의 `spec_id`로 만든 `leases/<기획서-id>.yml`이 있으면 제외한다. 아키텍트가 선점하는 대상은 결정이 아니라 기획서이므로 lease 이름도 기획서 id를 쓴다.
  - `developer`: `status: todo`인 작업의 `id`에 대해 `leases/<작업-id>.yml`이 있으면 제외한다.

다음 두 가지는 반드시 문서에 반영한다. 문서가 이후 스크립트 변경의 계약 기준점이 되므로, 역할 계약의 이상적 서술과 스크립트의 실제 판정이 어긋나는 지점을 덮지 않는다.

- lease는 파일 존재 여부만 본다. `expires_at`을 읽지 않으므로 만료된 lease가 남아 있으면 그 대상은 계속 제외된다.
- `planner` 판정은 미처리 아이디어만 훑는다. `revision_requested` 결정에 따른 기획서 재작업은 현재 이 스크립트가 감지하지 못한다. `architect` 판정은 결정 파일 단위로 `approved`를 찾으며 그것이 해당 기획서의 최신 결정인지는 확인하지 않는다.

문서에 적는 경로·인자·종료 코드는 실제 스크립트와 일치해야 한다.

### 4. 선점 프로토콜과의 관계 (R4)

- 조건 스크립트는 "지금 깨울 가치가 있는가"를 판단하는 사전 필터이며 선점 그 자체가 아니라는 것을 명시한다.
- 실제 클레임은 세션이 `.workflow/.runtime/leases/<문서-id>.yml`을 배타적으로 생성해서 수행한다는 것을 다시 밝히고 `docs/file-contract.md`를 참조한다.
- 검사와 세션 시작 사이의 시간 간격 때문에, 스크립트가 `0`을 반환해도 세션이 `NO_ELIGIBLE_WORK`로 끝날 수 있으며 이것이 정상 동작임을 명시한다.
- 하트비트 잡이 절대 하면 안 되는 것을 적는다: 스크립트 결과를 근거로 세션 대신 lease를 만드는 것, 만료되지 않은 다른 세션의 lease를 지우거나 갱신하는 것.
- 여러 역할 잡을 동시에 돌려도 되는 조건을 밝힌다: 역할별 대상 문서가 다르고, 클레임이 파일시스템의 배타적 생성으로 보호되므로 동시 선점 중 한쪽은 반드시 실패한다.

## 완료 조건

1. `docs/heartbeat.md`가 존재하고 역할 잡 3종·스크립트 사용법·선점 프로토콜 관계 세 주제를 모두 다룬다.
2. 문서에 기재된 인자 3종과 종료 코드 `0`/`1`/`2`의 의미가 실제 스크립트 동작과 일치한다.
3. 문서에 "스크립트가 `0`을 반환해도 세션이 `NO_ELIGIBLE_WORK`로 끝날 수 있다"는 취지의 문장이 명시적으로 존재한다.
4. 역할 잡 예시 3개가 각각 대상·프롬프트 요지·주기 권장값과 근거를 포함한다.
5. R3의 lease 만료 미확인, `planner`의 `revision_requested` 미감지, `architect`의 최신 결정 미확인이 문서에 드러난다.
6. `docs/heartbeat.md` 외의 파일 변경이 없다.

## 검증 절차

프로젝트 루트에서 실행한다.

```sh
sh scripts/wf-eligible.sh planner; echo $?
sh scripts/wf-eligible.sh architect; echo $?
sh scripts/wf-eligible.sh developer; echo $?
sh scripts/wf-eligible.sh bogus; echo $?
sh scripts/wf-eligible.sh; echo $?
```

- `bogus`와 인자 없음은 저장소 상태와 무관하게 `2`여야 한다. 이 값은 그대로 대조한다.
- `planner`·`architect`·`developer`의 `0`/`1`은 실행 시점의 저장소 상태에 따라 달라진다. 값 자체를 문서에 적지 말고, 나온 값이 문서에 적은 판정 기준으로 설명되는지 확인한다. 예를 들어 이 작업을 진행하는 동안에는 `developer`가 자기 작업 lease 때문에 `1`이 될 수 있다.
- migration.lock 동작은 코드 읽기로만 검증한다. **검증 목적으로 `.workflow/.runtime/migration.lock`을 만들지 않는다.** 이 파일이 존재하면 모든 외부 쓰기가 중단되며 앱 마이그레이션 상태를 오염시킨다.

```sh
git diff --stat
git status --short
```

- 변경이 `docs/heartbeat.md` 신규 1건인지 확인한다.

## 범위 밖

- `scripts/wf-eligible.sh` 로직 변경. 현재 동작을 기술만 한다.
- `README.md` 수정과 스크립트 git 추적. TASK-002 담당이다.
- 앱 코드(`src/`, `src-tauri/`) 변경.
- `.workflow/rules/*` 수정. 앱 관리 자산이다.
- 실제 스케줄러(cron, launchd, GitHub Actions 등) 설치·등록·운영.
- lease 만료 교체 구간의 원자성 개선. 2026-08-01 로그의 기존 후속 과제다.

## 참고 사실

- 스크립트는 `.workflow/*/` 아래 등록된 모든 워크플로우 디렉터리를 훑는다. 판정 단위는 개별 워크플로우가 아니라 프로젝트 전체다. 문서에 넣을지는 작성자가 판단한다.
- 스크립트 파일 모드는 실행 권한 없이 `644`다. 호출 형태를 `sh scripts/wf-eligible.sh`로 적는 이유이며, 권한을 바꾸지 않는다.
