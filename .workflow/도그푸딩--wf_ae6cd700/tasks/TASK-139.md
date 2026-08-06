---
schema: workflow-labs/task@1
id: TASK-139
title: 자격 확인 도구와 앱 판정이 대상 문서와 후보별 제외 사유를 함께 답한다
status: completed
source_spec_id: SPEC-049
source_decision_id: DECISION-30E36EFB
scope_files: [src-tauri/src/domain/project.rs, src-tauri/src/infrastructure/fs_project_repository.rs, src-tauri/src/infrastructure/heartbeat_condition.rs, src-tauri/src/infrastructure/role_eligibility.rs]
updated_at: 2026-08-06T15:13:24.909513+00:00
history:
  - { at: 2026-08-06T13:57:00Z, kind: created }
  - { at: 2026-08-06T14:08:00Z, kind: in_progress }
  - { at: 2026-08-06T14:32:00Z, kind: qa_waiting }
  - { at: 2026-08-06T15:13:24.909513+00:00, kind: completed }
---

# 자격 확인 도구와 앱 판정이 대상 문서와 후보별 제외 사유를 함께 답한다

## 결정권자 요약

자격 확인 도구가 일감의 유무만 답하던 것을 대상 문서와 후보별 제외 사유까지 답하도록 넓혔다.
세션은 문서 전체를 직접 대조하는 대신 도구가 알려 준 대상과 사유를 확인만 하면 된다.
판정 결과와 종료 코드는 이번 변경으로 달라지지 않았다. 넓어진 것은 답의 내용뿐이다.
앱 내부 판정도 같은 대상과 같은 후보 목록을 답하며, 그것을 기존 대조 검사 예순 건 전부가 확인한다.
화면에 전달되는 값의 모양도 그대로라 프런트엔드는 한 줄도 바뀌지 않았다.
문서 수가 늘어도 상수 비용으로 판정하는 기존 성능 특성과 기존 자동 검사를 그대로 유지했다.
러스트 검사 582건과 프런트엔드 검사 761건, 타입 검사, 배포 빌드가 통과했다.
윈도우용 구현은 이 기기에서 실행할 수 없어 통합 검사의 윈도우 러너가 확인한다.

## 목적

SPEC-049의 R1을 구현한다. 지금은 조건 스크립트와 앱 내부 판정이 역할별로 "일감이 있다" 또는
"일감이 없다" 한 가지만 답한다. 어느 문서가 대상인지, 다른 후보가 왜 제외됐는지는 답에 없어서
세션이 아이디어·결정·작업 문서 전체를 직접 대조해야 한다. 두 판정이 대상 식별자와 후보 목록,
후보별 제외 사유를 함께 답하게 만들어 이 대조를 없앤다.

## 현재 상태

착수 전에 확인한 값이다.

- 조건 스크립트 본문은 `src-tauri/src/infrastructure/heartbeat_condition.rs`에 두 벌 있다.
  POSIX 셸 본문 `CONDITION_SCRIPT_SH`(27행부터)와 PowerShell 본문 `CONDITION_SCRIPT_PS1`(615행부터)이며,
  두 본문은 같은 답을 내야 한다.
- 버전 상수 `CONDITION_SCRIPT_VERSION`은 같은 파일 20행에 있고 현재 값은 11이다.
- 앱 내부 판정은 `src-tauri/src/infrastructure/role_eligibility.rs`의 `pending_role_work`이며,
  `has_planner_work`·`has_architect_work`·`has_developer_work` 세 함수가 각각 불리언 하나를 반환한다.
- 반환 타입 `PendingRoleWork`는 `src-tauri/src/domain/project.rs` 69행에 있고 역할별 불리언 세 개를
  가진다. 이 타입은 `ProjectSummary`의 `pending_work` 필드로 화면에 직렬화되며,
  `src/features/projects/domain/types.ts` 143행이 같은 모양을 따로 선언하고 있다.
- 호출부는 `src-tauri/src/infrastructure/fs_project_repository.rs` 793행이다.
- 두 판정이 같은 답을 내는지 고정하는 검사는 두 곳에 있다.
  `role_eligibility.rs`의 `assert_matches_condition_script`(186행부터)와
  `fs_project_repository.rs`의 `pending_work_matching_condition_script`(5024행부터)다.
  두 검사 모두 실제 조건 스크립트를 픽스처에서 실행해 앱 판정과 대조한다.

## 변경 범위

- `heartbeat_condition.rs`: 셸 본문과 PowerShell 본문 양쪽에 대상 식별자, 후보 목록, 후보별 제외
  사유 출력을 넣는다. `CONDITION_SCRIPT_VERSION`을 11에서 12로 올린다.
- `role_eligibility.rs`: 세 역할 판정이 대상과 후보별 제외 사유를 함께 산출하도록 넓히고, 두 판정을
  대조하는 검사에 새 시나리오를 더한다.
- `domain/project.rs`: 넓어진 판정 결과를 담을 타입을 둔다.
- `fs_project_repository.rs`: 호출부와 대조 검사를 넓어진 결과에 맞춘다.

## 설계 지침

- 화면 payload를 바꾸지 않는다. `PendingRoleWork`는 역할별 불리언 세 개를 그대로 유지하고, 넓어진
  정보는 별도 타입으로 둔 뒤 기존 payload를 그것에서 파생시킨다. 이렇게 하면 프런트엔드 타입과 두
  화면 구성 요소(`IntegrationCard.tsx`, `HeartbeatCard.tsx`)를 건드리지 않아도 되고, 이 작업이
  프런트엔드 작업과 파일에서 겹치지 않는다. 화면에 이 정보를 노출하는 일은 이번 범위가 아니다.
- 새로운 판정 기준을 만들지 않는다. 제외 사유는 각 분기가 이미 적용하는 조건(선점 여부, 상태값,
  선행 선언 충족 여부, 겹침 선언 충돌 여부)을 사람이 읽을 수 있는 형태로 옮긴 것이어야 한다.
- 문서 수가 늘어도 대상 문서마다 상수 비용으로 판정하는 조건 스크립트의 기존 성능 특성을 되돌리지
  않는다. 후보 목록을 만들기 위해 전체 문서를 여러 번 훑는 구현은 이 특성을 깨뜨린다.
- `role_eligibility.rs` 머리말에 적힌 스크립트와 앱의 알려진 차이 다섯 가지는 이번 작업에서 해소
  대상이 아니다. 넓어진 답에서도 그 차이가 그대로 남는 것이 정상이며, 새로 벌어지는 차이만 막는다.
- 조건 스크립트는 앱 관리 자산이다. 관리 마커가 없는 파일을 덮어쓰지 않고 설치본이 앱보다 새
  버전이면 멈추는 기존 안전 절차를 그대로 따른다.
- 저장소의 `.workflow/rules/wf-eligible.sh`는 앱이 설치하는 사본이므로 직접 편집하지 않는다.

## 손대지 않는 것

- 화면에 표시하는 payload의 모양과 프런트엔드 코드
- 선점, 결정, 역할 분리의 판정 규칙
- 역할 계약과 공통 규칙의 본문
- 조건 스크립트와 앱 판정의 성능 최적화

## 완료 조건

1. 일감이 있는 상태에서 조건 스크립트의 기획자·아키텍트·개발자 세 분기 모두 대상 문서 식별자를
   출력에 포함한다.
2. 후보가 여럿이고 그중 일부가 제외되는 상태에서, 출력에 후보 목록과 제외된 후보별 사유가 담긴다.
3. 일감이 없는 상태에서 지금과 같은 결과를 낸다. 판정 결과와 종료 코드가 이번 변경으로 달라지지
   않는다.
4. 앱 내부 판정이 1번에서 3번과 같은 대상, 같은 후보 목록, 같은 제외 사유를 답한다.
5. 셸 본문과 PowerShell 본문이 같은 대상, 같은 후보 목록, 같은 제외 사유를 답한다.
6. `CONDITION_SCRIPT_VERSION`이 11에서 12로 올라가고, 설치본의 버전 표기와 앱 내부 상수가 일치한다.
7. 화면에 전달되는 payload의 모양이 이번 변경으로 달라지지 않는다.
8. 기존 자동 검사를 삭제하거나 비활성화하지 않는다.

## 검증 절차

1. `cargo test`를 `src-tauri`에서 실행해 러스트 검사 전체가 통과하는지 확인한다.
2. 여러 후보 중 일부는 선점되고 일부는 상태 조건을 만족하지 않는 픽스처를 만들어, 조건 스크립트의
   출력에 대상 식별자와 후보별 제외 사유가 있는지 확인한다.
3. 같은 픽스처에서 앱 내부 판정을 실행해 대상, 후보 목록, 제외 사유가 조건 스크립트와 같은지
   대조한다. 기존 대조 검사에 이 시나리오를 더해 고정한다.
4. 일감이 없는 픽스처에서 기존 조건 스크립트 검사가 수정 없이 통과하는지 확인한다.
5. 설치본의 버전 표기와 `CONDITION_SCRIPT_VERSION`을 대조하는 기존 검사가 12로 통과하는지 확인한다.
6. `npm run check`를 실행해 프런트엔드 검사가 그대로 통과하는지 확인한다. 이 작업은 프런트엔드
   파일을 바꾸지 않으므로 결과가 착수 전과 같아야 한다.

## 확인 동선

이 작업에는 볼 화면이 없다. 화면에 나가는 값을 일부러 그대로 두었기 때문이다. 확인은 터미널에서
한다. 아래 1~3번은 임시 저장소를 하나 만들어 눈으로 보는 경로이고, 4~6번은 자동 검사가 닫은
부분을 다시 돌려 보는 경로다.

### 1. 확인용 임시 저장소를 만든다

프로젝트 루트에서 아래를 그대로 붙여 넣는다. 조건 스크립트 본문을 앱 코드에서 꺼내 임시 저장소에
설치하고, 개발자 후보 네 건과 선점 파일 하나를 세운다.

```sh
rm -rf /tmp/wf-check && mkdir -p /tmp/wf-check/.workflow/wf-demo/tasks /tmp/wf-check/.workflow/.runtime/leases
python3 - <<'PY'
import pathlib
src = pathlib.Path('src-tauri/src/infrastructure/heartbeat_condition.rs').read_text()
body = src.split('const CONDITION_SCRIPT_SH: &str = r#"', 1)[1].split('"#;', 1)[0]
out = pathlib.Path('/tmp/wf-check/.workflow/rules')
out.mkdir(parents=True, exist_ok=True)
(out / 'wf-eligible.sh').write_text(body)
PY
cd /tmp/wf-check
for n in 001 003; do printf -- '---\nschema: workflow-labs/task@1\nid: TASK-%s\nstatus: todo\nscope_files: [src/shared.rs]\n---\n' "$n" > .workflow/wf-demo/tasks/TASK-$n.md; done
printf -- '---\nschema: workflow-labs/task@1\nid: TASK-002\nstatus: todo\ndepends_on: [TASK-404]\n---\n' > .workflow/wf-demo/tasks/TASK-002.md
printf -- '---\nschema: workflow-labs/task@1\nid: TASK-004\nstatus: todo\nscope_files: [src/four.rs]\n---\n' > .workflow/wf-demo/tasks/TASK-004.md
EXP=$(date -u -v+30M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+30 minutes' +%Y-%m-%dT%H:%M:%SZ)
printf 'schema_version: 1\nlease_id: l\nagent: a\ntask_id: TASK-001\nheartbeat_at: %s\nexpires_at: %s\n' "$EXP" "$EXP" > .workflow/.runtime/leases/TASK-001.yml
```

### 2. 대상과 후보별 제외 사유가 나오는지 본다

```sh
cd /tmp/wf-check && sh .workflow/rules/wf-eligible.sh developer 2>&1 >/dev/null
```

이렇게 나오면 맞다. 후보 넷 중 셋이 서로 다른 사유로 빠지고 넷째가 대상이다.

```
candidate: leased TASK-001
candidate: dependencies-unsatisfied TASK-002
candidate: overlap TASK-003
candidate: eligible TASK-004
target: TASK-004
```

`TASK-004.md`를 지우고 같은 명령을 다시 실행하면 대상 줄이 사라지고 앞의 세 줄만 남는다. 대상이
없을 때 후보 목록이 그 역할이 본 후보 전부라는 것이 이 자리에서 보인다.

### 3. 데몬이 옮기는 값은 그대로인지 본다

```sh
cd /tmp/wf-check && sh .workflow/rules/wf-eligible.sh developer 2>/dev/null; echo "exit=$?"
```

`eligible` 한 줄과 `exit=0`만 나오면 맞다(2번에서 지운 `TASK-004.md`를 되살린 상태여야 한다.
지운 상태라면 `no-target`과 `exit=1`이 나오고, 그것도 이번 변경 전과 같은 값이다). 넓어진 답은
표준 오류로만 나가므로 이 자리는 이번 변경 전과 같아야 한다. 이것이 화면의 대기 물량 표시와
하트비트 기록이 그대로인 근거다.

### 4. 앱 판정이 같은 답을 내는지 본다

```sh
cd src-tauri && cargo test --lib role_eligibility
```

60건 통과가 맞다. 이 검사들은 픽스처마다 앱 판정과 조건 스크립트를 함께 돌려 종료 코드, 대상,
후보 목록 셋을 대조한다. 대상이나 사유가 한 자리라도 갈리면 여기서 실패한다.

### 5. 러스트 검사 전체를 돌린다

```sh
cd src-tauri && cargo test
```

582건 통과가 맞다. 조건 스크립트 시나리오 표와 판정 비용 검사가 여기 함께 들어 있다.

### 6. 프런트엔드가 그대로인지 본다

```sh
npm run check
```

타입 검사 통과, 검사 761건 통과, 배포 빌드 성공이 맞다. 이 작업은 프런트엔드 파일을 바꾸지
않았으므로 결과가 착수 전과 같아야 한다.

### 확인이 끝난 뒤

저장소에 설치된 `.workflow/rules/wf-eligible.sh`는 앱이 관리하는 파일이라 이 세션이 손대지
않았고, 아직 이전 버전이다. 그래서 이 저장소에서 그 파일을 직접 실행하면 2번의 후보 줄이 나오지
않는다. 앱이 관리 자산을 동기화하면 새 버전으로 바뀐다.

윈도우용 구현은 이 기기에 PowerShell이 없어 실행하지 못했다. 두 시나리오 표가 통합 검사의 윈도우
러너에서 같은 픽스처를 돌리므로, 그 러너의 결과가 이 부분을 대신 확인한다.

## 범위와 선행

선행 작업은 없다. 지금 바로 착수할 수 있다.

같은 승인에서 나온 TASK-140이 `fs_project_repository.rs`를 함께 수정하므로, TASK-140이 이 작업을
선행으로 선언해 두었다. 두 작업은 동시에 진행하지 않는다. TASK-141은 이 작업과 파일이 겹치지 않아
병렬로 진행할 수 있다.
