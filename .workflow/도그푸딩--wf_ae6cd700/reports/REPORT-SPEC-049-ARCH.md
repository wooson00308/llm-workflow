# SPEC-049 아키텍트 분해 보고서 (전문)

> 기록 경위: 하네스가 서브에이전트(tl-dev-136)의 보고서 파일 작성을 차단해, 발신된 전문을 TL이 대리 기록한다. 내용은 발신 전문 그대로다. (수신 2026-08-06T14:06Z경, TL 세션)

- 대상: SPEC-049 (자격 판정과 작업 문서 구조를 개선해 세션의 규격 준수 비용을 낮춘다)
- 승인: DECISION-30E36EFB (outcome: approved, created_by: user, 2026-08-06T13:47:55Z)
- 산출: TASK-139, TASK-140, TASK-141 모두 status: todo
- 세션: 2026-08-06T13:50Z~14:03Z, 아키텍트 역할 (architect-fable)
- 선점: acquire SPEC-049 → exit 0, lease_id lease-40702-20260806135052. renew exit 0, release exit 0 (반납 완료)

## 생성·수정한 파일 (절대경로)

- /Users/catze/project/workflow-labs/.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-139.md (신규)
- /Users/catze/project/workflow-labs/.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-140.md (신규)
- /Users/catze/project/workflow-labs/.workflow/도그푸딩--wf_ae6cd700/tasks/TASK-141.md (신규)
- /Users/catze/project/workflow-labs/docs/development-logs/2026-08-06.md (세션 섹션 추가)

선점 시각 기준 find -newermt로 확인한 결과 위 4건이 내 변경 전부다. 같은 구간에 나타난 ideas/IDEA-BE2D48EC.md, specs/SPEC-050.md, leases/IDEA-BE2D48EC.yml은 병행 중인 planner-claude 세션 것이라 손대지 않았다. decisions/ 최신 mtime은 13:49Z로 내 선점(13:50:52Z) 이전이며 미접촉이다. 커밋하지 않았다.

## 대상 선택 근거

판정 시각 2026-08-06T13:50:15Z. wf-eligible.sh architect가 eligible/exit 0.

결정 문서 전수(52건)에서 기획서별 최신 결정을 뽑고 outcome: approved만 남긴 뒤, source_decision_id로 참조하는 작업이 0건인 것을 찾으니 하나였다: DECISION-30E36EFB (SPEC-049). created_by: user이고 SPEC-049의 유일한 결정이라 최신이다. 선점 직후 같은 대조를 다시 돌려 파생 작업 0건을 재확인했다.

만료 lease SPEC-009.yml은 expires_at 2026-08-03T01:20:00Z로 아무것도 막지 않으며 §4대로 무접촉.

## 분해 결정과 근거

### 나눈 기준

확인 필요 1번 확정("아키텍트 단계에서 겹치지 않는 작업으로 나눠 병렬 가능하게")에 따라 제안 단위가 아니라 고치는 자산 단위로 나눴다. 제안 단위로 나누면 R2와 R4가 같은 파일의 같은 계약을 고치게 되어 병렬이 애초에 불가능하다.

- TASK-139 = R1 / 조건 스크립트 두 본문 + 앱 내부 판정 / CONDITION_SCRIPT_VERSION 11→12
- TASK-140 = R2·R3·R4 / 역할 계약 본문 + 버전 상수 / ARCHITECT_RULES_VERSION 8→9, DEVELOPER_RULES_VERSION 9→10
- TASK-141 = 포함 범위 마지막 항목 + 완료 조건 11 / 측정 스크립트·문서(신규) / 버전 축 없음

### R2·R3·R4를 한 작업으로 묶은 이유

셋 다 src-tauri/src/infrastructure/project_instructions.rs 한 파일의 계약 문장을 고친다. 게다가 R2(작업 문서 우선 착수)와 R4(보고서 필수 절·분량 상한)는 둘 다 개발자 계약이라 DEVELOPER_RULES_VERSION이라는 같은 버전 축을 공유한다. 나누면 병렬 이득은 0인데 버전만 두 번 올라가고 설치본 갱신도 두 번 일어난다. TASK-130이 공통 규칙 문체 절 + 세 역할 계약 + 버전 상수를 한 작업으로 처리한 선례와 같은 형태다.

### TASK-140에 선행을 건 이유 (겹침 실측)

TL이 경고한 겹침이 실재했다. src-tauri/src/infrastructure/fs_project_repository.rs의 검사가 버전 값을 문자열로 고정하고 있다.

- 아키텍트: 3613행 .replace("rules_version: 8", ...), 3637행 .contains("rules_version: 8")
- 개발자·기획자: 4196행·4215행에서 rules_version: 9
- 공통 규칙: 2290·2318·2329·4696·4713행에서 rules_version: 14

역할 계약 버전을 올리면 이 검사가 깨지므로 TASK-140은 이 파일을 반드시 고쳐야 한다. 그런데 TASK-139도 같은 파일의 호출부(793행)와 두 판정 대조 검사(5024행부터)를 고친다. scope_files가 이 한 경로에서 겹쳐 병렬 불가이므로 depends_on: [TASK-139]로 순서를 정했다.

순서 방향은 변경 성격으로 정했다. TASK-139는 그 파일의 구조(호출부·대조 검사)를 바꾸고 TASK-140은 같은 파일에서 문자열만 고친다. 구조 변경을 먼저 반영해야 문자열 수정이 나중에 재작성될 함수 안에 놓이는 상황을 피한다.

### 버전 축 충돌은 없다

TL이 우려한 CONDITION_SCRIPT_VERSION과 WORKFLOW_RULES_VERSION 동시 인상은 발생하지 않는다. 전자는 heartbeat_condition.rs 20행, 후자는 project_instructions.rs 21~24행으로 파일이 갈려 있다. SPEC-032/033이 겪은 것과 달리 여기서 선행 선언이 필요했던 실제 겹침은 fs_project_repository.rs 한 곳뿐이다.

### TASK-139가 화면 payload를 건드리지 않게 못박은 이유

R1은 앱 내부 판정도 대상·후보·제외 사유를 반환하라고 요구한다. 그런데 반환 타입 PendingRoleWork(src-tauri/src/domain/project.rs 69행)는 Copy 파생이 붙은 역할별 불리언 세 개이고, ProjectSummary의 pending_work 필드로 화면에 직렬화되며, 프런트엔드가 src/features/projects/domain/types.ts 143행에서 같은 모양을 따로 선언하고 IntegrationCard.tsx·HeartbeatCard.tsx가 그걸 쓴다.

여기에 후보 목록을 직접 얹으면 Copy가 깨지고 범위가 프런트엔드 파일 3개로 번진다. 프런트엔드는 다른 파이프라인이 자주 건드리는 자리라 겹침 위험도 커진다. 그래서 넓어진 정보는 별도 타입으로 두고 기존 payload를 거기서 파생시키라고 설계 지침에 못박고, 화면 노출은 범위 밖으로 명시했다.

### TASK-141이 측정 시점을 인자로 받게 한 이유

측정 대상에 역할 계약 본문이 들어간다. TASK-140이 계약에 문장을 더하면 문서가 커지므로, 측정이 TASK-140보다 늦게 실행되면 "변경 전" 기준값이 오염된다. 순서로 풀면 TASK-141이 TASK-140의 선행이 되어 병렬 room이 사라진다. 대신 스크립트가 커밋 식별자를 인자로 받아 그 시점 파일 내용을 읽게 설계했다. 그 결과 TASK-141은 셋 중 유일하게 무조건 병렬 가능하다.

### 설치본을 범위에 넣지 않은 이유

.workflow/rules/roles/*.md와 .workflow/rules/wf-eligible.sh는 앱이 설치하는 사본이고 원본은 각각 project_instructions.rs와 heartbeat_condition.rs에 있다. TASK-130이 같은 성격의 계약 변경을 project_instructions.rs 단독 범위로 처리한 선례를 따랐고, 세 작업 본문에 설치본 직접 편집 금지를 적었다.

## 작업별 scope_files·depends_on

TASK-139 — 자격 확인 도구와 앱 판정이 대상 문서와 후보별 제외 사유를 함께 답한다
- depends_on: 없음 (키 생략)
- scope_files: [src-tauri/src/domain/project.rs, src-tauri/src/infrastructure/fs_project_repository.rs, src-tauri/src/infrastructure/heartbeat_condition.rs, src-tauri/src/infrastructure/role_eligibility.rs]
- 완료 조건 8개, 검증 절차 6단계

TASK-140 — 역할 계약에 작업 문서 우선 착수와 완결 지시서, 보고서 규격 문장을 넣고 버전을 올린다
- depends_on: [TASK-139]
- scope_files: [src-tauri/src/infrastructure/fs_project_repository.rs, src-tauri/src/infrastructure/project_instructions.rs]
- 완료 조건 9개, 검증 절차 5단계

TASK-141 — 세션의 규격 준수 비용을 다시 잴 수 있는 측정 방법을 정하고 기준값을 남긴다
- depends_on: 없음 (키 생략)
- scope_files: [docs/compliance-cost-measurement.md, scripts/measure-compliance-cost.mjs] (둘 다 신규)
- 완료 조건 7개, 검증 절차 6단계. 확인 필요 3번 확정("구조를 완료 조건으로, 수치 측정은 후속 관찰")대로 절감 폭 자체는 완료 조건에서 뺐다.

세 문서 모두 status: todo, created history, source_spec_id: SPEC-049, source_decision_id: DECISION-30E36EFB를 갖췄고, 이번 승인의 R3이 요구하는 대로 기획서를 열지 않고 착수 가능한 완결된 지시서로 작성했다(현재 상태 실측값·완료 조건·검증 절차를 본문에 직접 수록).

## 판단을 개발자에게 남긴 자리

아키텍트가 임의로 정하면 근거 없는 값이 되는 항목이라 결정 절차만 계약으로 고정했다.

1. 보고서 분량 상한의 수치. 기획서가 "결정권자 요약의 열 줄 상한과 같은 방식으로"라고만 하고 숫자를 안 줬다. TASK-140에 단위(줄 수), 제외 규칙(빈 줄 미포함), 제약(필수 절이 모두 들어갈 것), 고른 값과 근거의 보고 의무를 조건으로 적었다.
2. 공통 규칙 본문 변경 여부. 포함 범위가 보고서 규격을 개발자 계약에 반영하라고 명시했으므로 WORKFLOW_RULES_VERSION은 14 유지를 기본값으로 적었다. 구현 중 공통 규칙을 고쳐야 한다고 판단되면 그 버전과 고정 문자열 검사를 함께 올리고 어느 쪽을 택했는지 보고하도록 조건을 달았다.

## 착지 후 세 역할 자격 재실측

sh .workflow/rules/wf-eligible.sh <role> 실행 결과다.

- 착수 전 13:50:15Z — architect: eligible (exit 0)
- 선점 보유 14:01:21Z — planner: no-target(1) / architect: no-target(1) / developer: eligible(0)
- 반납 후 14:01:31Z — planner: no-target(1) / architect: no-target(1) / developer: eligible(0)

해석:
- architect가 no-target으로 바뀐 것이 이번 분해의 직접 결과다. DECISION-30E36EFB를 참조하는 작업이 세 건 생겨 "파생 작업 없는 승인"이 사라졌다. lease 반납 뒤에도 같은 값이므로 lease 때문이 아니다.
- developer가 eligible이 된 것도 이번 결과다. TASK-139·TASK-141은 선행이 없어 바로 후보이고, TASK-140은 TASK-139가 todo라 선행 미충족이다.
- planner의 no-target은 이번 세션과 무관하다. 반납 직전 14:01:12Z에 다른 세션(planner-claude)이 IDEA-BE2D48EC를 선점했고, 그 lease가 살아 있어 해당 아이디어가 후보에서 빠졌다.

## 리스크

1. TASK-139의 성능 특성. 후보 목록과 제외 사유를 만들려고 전체 문서를 여러 번 훑으면 조건 스크립트의 "문서 수가 늘어도 대상마다 상수 비용" 성질이 무너진다. R1이 금지하고 작업 본문에도 적었으나 실제 준수는 구현에서 확인해야 한다.
2. 두 판정의 알려진 차이 5건. role_eligibility.rs 머리말이 스크립트와 앱의 기존 차이를 적어 두었다. 답이 넓어지면 그 차이가 더 드러날 수 있다. 이번 작업은 그 다섯을 해소 대상으로 삼지 않고 새로 벌어지는 차이만 막는다고 명시했다. 없애려면 별도 기획이 필요하다.
3. 완료 조건 7번의 표본 시점. 기획서 완료 조건 7번의 표본이 이번에 만든 세 작업인데, R3이 아직 계약에 들어가기 전에 작성됐다. 계약 문장이 확정된 뒤 표현이 어긋나면 TASK-140 세션이 그 차이를 보고에 남기는 편이 낫다.
4. 병행 세션. 반납 시점에 planner-claude가 IDEA-BE2D48EC를 보유 중이고 SPEC-050이 이미 생성됐다. 그 기획서가 승인되면 아키텍트 대기 물량이 다시 생긴다. 이번 세 작업과 파일이 겹칠지는 그 기획서를 봐야 판단 가능하다.

## 후속

- 개발 세션은 TASK-139와 TASK-141을 지금 병렬로 착수할 수 있다. 두 작업은 scope_files가 겹치지 않는다.
- TASK-140은 TASK-139가 qa_waiting 이상이 된 뒤에 열린다.
- 완료 조건 11번의 절감 폭 비교는 TASK-141이 만든 방법으로 이번 변경이 모두 반영된 뒤 별도 관찰한다(확인 필요 3번 확정 사항).
