---
schema: workflow-labs/task@1
id: TASK-102
title: 세 계약이 겹침 선언을 쓰고 지목하게 하고 rules_version을 올린다
status: qa_waiting
source_spec_id: SPEC-032
source_decision_id: DECISION-0D79A7F0
depends_on: [TASK-098, TASK-101]
updated_at: 2026-08-04T18:00:00Z
history:
  - { at: 2026-08-04T15:46:00Z, kind: created }
  - { at: 2026-08-04T17:52:30Z, kind: in_progress }
  - { at: 2026-08-04T18:00:00Z, kind: qa_waiting }
---

# 세 계약이 겹침 선언을 쓰고 지목하게 하고 rules_version을 올린다

SPEC-032의 R4·R5와 완료 조건 9·10·15를 닫는다. 공통 규칙의 파일 계약에 `scope_files`를 올리고,
아키텍트 계약이 그것을 쓰도록, 개발자 계약이 그것을 겹침 판정의 근거로 지목하도록 문언을 고친다.
판정 구현은 TASK-101, 화면은 TASK-103이다.

## 이 기획서의 세 작업에는 선언이 없다

SPEC-032에서 나온 TASK-101·102·103 어디에도 `scope_files` 줄이 없다. 일부러다.

- **계약이 없는 필드를 아키텍트가 먼저 쓰면 이 작업의 순서 근거가 뒤집힌다.** 문언이 구현을 앞지르지
  않는다는 것이 아래 의존성 절의 논거인데, 선언이 계약을 앞지르면 같은 잘못을 아키텍트가 저지르는
  것이다.
- TASK-101의 완료 조건 12가 "이 저장소의 작업에는 `scope_files`가 하나도 없다"를 회귀 판정의 전제로
  쓴다. 이 분해가 선언을 남기면 그 전제가 깨진다.
- 표기가 어떻게 생겼는지는 TASK-101의 "아키텍트가 고정하는 값" 절이 예시까지 적어 두었다. 문언은
  그것을 읽고 옮긴다.

**선언을 처음 다는 것은 이 작업이 착지한 뒤 분해되는 작업들이다.** 기존 94건 소급 기입이 기획서 제외
범위인 것과 같은 선이다.

## 의존성

`depends_on: [TASK-098, TASK-101]`.

- **TASK-098**: 파일이 겹친다. 098이 `project_instructions.rs`를 범위로 적었고 이 작업이 만지는 파일이
  그 하나다. 098은 이 문서를 쓰는 시점에 `completed`이므로 선행은 이미 충족이다.
- **TASK-101**: **계약 문언이 구현을 앞지르지 않는다.** 판정이 `scope_files`를 읽지 않는 동안 계약이
  그것을 요구하면, 계약을 지킨 세션이 아무 보호도 받지 못하면서 판정은 여전히 사람 손에 기댄다.
  TASK-097 → TASK-098이 같은 이유로 세운 순서다. 파일은 겹치지 않는다.
- SPEC-032 완료 조건 14가 요구하는 TASK-097 뒤 순서는 TASK-101을 거쳐 성립한다 — 101이 097을 선행으로
  적었다. 이 작업은 `heartbeat_condition.rs`·`role_eligibility.rs`를 만지지 않으므로 097과 직접
  겹치는 자리가 없다.

## 범위

- `src-tauri/src/infrastructure/project_instructions.rs`
  - `WORKFLOW_RULES`(`:45`) §6 "Preserve the file contract" — `scope_files`의 표기와 판정 불가 처리.
  - `WORKFLOW_RULES_VERSION`(`:21`)과 `WORKFLOW_RULES` 프론트매터의 `rules_version` — 착수 시점 값 +1.
  - `ARCHITECT_RULES`(`:284`) "Split for parallel safety" — 새 작업에 선언을 쓰라는 요구.
  - `DEVELOPER_RULES`(`:333`) "Eligibility"와 새 절 — 겹침 조항이 지목하는 근거.
  - `ROLE_RULES_VERSION`(`:24`)과 두 계약 프론트매터의 `rules_version` — 착수 시점 값 +1.
  - `mod tests` — 문언과 버전을 단언하는 자리.
- 그 외 파일은 건드리지 않는다. **`heartbeat_condition.rs`·`role_eligibility.rs`·
  `fs_project_repository.rs`·프론트엔드는 이 작업의 범위가 아니다.**

저장소에 미커밋 변경이 크다. **줄 번호는 작업 트리 기준이고, 쓰기 직전에 대상 줄을 다시 읽는다.**

## 작업 내용

### 공통 규칙 §6 (R1)

파일 계약 절에 `scope_files` 한 항목을 더한다. 담을 것은 넷이다.

- 선택 필드이고, 값은 프로젝트 루트 기준 상대 경로의 한 줄 흐름 시퀀스다. `[a/b.rs, c/d.ts]` 꼴.
- 열 0에서 시작하는 한 줄이고 같은 키가 두 번 나오면 안 된다. `depends_on`·`history`와 같은 제약이고
  같은 이유다.
- 경로는 적힌 그대로 비교한다. 정규화·글롭·디렉터리 접두 일치·대소문자 접기가 없다.
- 형식이 계약과 다르면 판정 불가이고, 판정 불가는 안전한 쪽으로 기운다.

**`depends_on`을 설명하는 자리와 나란히 둔다.** 두 필드는 하는 일이 다르다 — `depends_on`은 순서를
정하고 `scope_files`는 동시 착수를 막는다. 그 차이를 한 문장으로 적는다.

### 아키텍트 계약 (R5)

"Split for parallel safety" 절을 고친다.

- 새로 만드는 모든 작업에 `scope_files`를 쓴다.
- **`depends_on` 순서 규칙은 그대로 남는다.** 지우지 않는다. 두 장치는 서로를 대체하지 않는다 —
  순서는 여전히 아키텍트가 정하고, 선언은 그 판단이 낡았을 때를 위한 그물이다. R5 둘째 항목이 그것을
  명시한다.
- "Record the files and modules a task touches in its scope section"(`:309`)은 남긴다. 산문 범위 절은
  근거 서술로 계속 쓰이고, **어긋나면 판정이 이긴다**는 것을 한 문장으로 적는다(R1 둘째 항목).
- 범위를 좁게 적으면 겹침을 놓치고 넓게 적으면 병렬 여지가 준다는 것을 적는다. 승인된 확인 필요 1번의
  비용 문단이 그대로 이 자리의 문장이 된다.

### 개발자 계약 (R4)

- "Eligibility"의 `No unexpired lease may cover overlapping work.`(`:347`)가 **`scope_files`를 근거로
  지목하게** 고친다. 확인 사실 1의 조항이 실행 가능한 문장이 되는 것이 이 작업의 이유다.
- "Satisfied dependencies" 절 옆에 겹침 절을 새로 둔다. 담을 것은 TASK-101이 구현하는 판정 규칙과 같은
  값이어야 한다. **구현을 읽고 옮긴다. 새로 설계하지 않는다.**
  - 미만료 lease만 센다.
  - 선언이 없거나 형식 오류인 작업은 활성 lease가 있는 동안 착수 대상이 아니다(승인된 확인 필요 2번).
  - lease가 잡은 작업의 선언이 없거나 형식 오류여도 같다.
  - 두 선언이 같은 경로를 하나라도 함께 가리키면 겹침이다.
- **겹치는 작업만 남으면 파일을 바꾸지 않고 `NO_ELIGIBLE_WORK`를 보고한다**(R4 셋째 항목). 선행
  미충족일 때와 같은 처리다. `blocked`로 옮기지 않는다 — 같은 절이 이미 그 문장을 갖고 있으므로
  (`:363`) 그 어법을 그대로 쓴다.

### 버전 축

- `WORKFLOW_RULES_VERSION`과 `WORKFLOW_RULES` 프론트매터의 `rules_version`이 **착수 시점 값 +1**로
  함께 오른다.
- `ROLE_RULES_VERSION`과 **문언을 고친 두 계약**(`architect.md`·`developer.md`)의 `rules_version`이
  착수 시점 값 +1로 오른다.
- **`PLANNER_RULES`는 손대지 않는다.** 기획자 계약에 이 기획서의 변경분이 없다.
- **고정값을 가정하지 않는다.** 분해 시점 값은 `WORKFLOW_RULES_VERSION` 9, `ROLE_RULES_VERSION` 5,
  아키텍트·개발자 계약 `rules_version` 각 4다. 착수 시점 값을 읽어 보고서에 적고 +1을 적용한다.
- `ROLE_RULES_VERSION`이 세 계약 `rules_version`의 최댓값이라는 관계가 깨지지 않게 한다
  (`:24` 주석). 기획자 계약이 뒤처지는 것은 그 관계와 무관하다.

### 설치본과의 관계

설치본(`.workflow/rules/*.md`)은 앱이 설치 경로로 덮어쓰는 산출물이다. **손으로 고치지 않는다.**
지금 상수와 설치본이 어긋나 있는 것(`workflow.md` 8 대 상수 9, `architect.md` 4)도 앱이 다음 설치에서
따라 올리는 종류의 차이다.

## 완료 조건

괄호 안은 SPEC-032의 완료 조건 번호다.

1. 개발자 계약이 겹침 판정의 근거로 `scope_files`를 지목하고, 겹치는 작업만 남았을 때 파일을 바꾸지
   않고 `NO_ELIGIBLE_WORK`를 보고하며 `blocked`로 옮기지 않는다고 적는다. 검증: 계약 본문과
   `ROLE_RULES_VERSION`을 단언하는 테스트. (9)
2. 아키텍트 계약이 새 작업에 `scope_files`를 쓰도록 요구하고 `depends_on` 순서 규칙을 유지한다.
   검증: 같은 자리의 테스트. 순서 규칙 문장이 남아 있는 것을 단언한다. (10)
3. 공통 규칙 §6이 `scope_files`의 표기와 판정 불가 처리를 적는다. 검증:
   `WORKFLOW_RULES_VERSION`과 본문을 단언하는 테스트. (1의 계약 절반)
4. 계약이 적은 판정 규칙이 TASK-101이 구현한 규칙과 같다. 검증: **양쪽 문장을 나란히 인용해 보고서에
   적는다.** 다르면 계약이 아니라 이 작업이 틀린 것이다.
5. 세 버전 상수와 각 문서의 `rules_version`이 착수 시점 값 +1로 함께 올랐고, 기획자 계약은 그대로다.
   **착수 시점 값을 보고서에 적는다.**
6. 기존 자동 테스트가 삭제되거나 비활성화되지 않았다. (13)
7. 변경분에 `project_instructions.rs` 말고 다른 파일이 없다. (14)
8. `cargo test --manifest-path src-tauri/Cargo.toml`과 `npm run check`가 통과한다. (15)

## 검증 문구 규칙

무변경은 파일·심볼 단위로 확인한다. **"`git diff`가 비어 있다"를 쓰지 않는다** — 이 작업 트리에는 여러
세션의 미커밋 변경이 겹쳐 있다.

## 범위 밖

- **판정 구현.** TASK-101의 몫이다. 이 작업에 스크립트 본문·앱 판정 변경분은 없다.
- **화면.** TASK-103의 몫이다.
- **기획자 계약의 문언.** 이 기획서에 변경분이 없다.
- **설치본 `.workflow/rules/*.md`의 직접 수정.**
- **기존 작업에 `scope_files`를 소급 기입하는 일.** 기획서 제외 범위다. SPEC-032에서 나온 세 작업도
  마찬가지로 선언을 갖지 않는다(위 절).
- **`depends_on` 문언의 판정 규칙 변경.** R9 첫째 항목이 불변을 요구한다.
- **동시 세션 수 옵트인 설정.** 승인된 확인 필요 3번이 잘랐다.
- **계약이 요구하는 선언을 아키텍트가 빠뜨렸을 때의 자동 검사.** 기획서가 요구하지 않았다. 후속
  아이디어로 올린다.
