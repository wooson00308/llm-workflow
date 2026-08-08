---
schema: workflow-labs/task@1
id: TASK-148
title: blocked 작업 재개를 원자적 사용자 감사 전이로 기록한다
status: completed
source_spec_id: SPEC-054
source_decision_id: DECISION-DC3ED4B7
depends_on: [TASK-S051-01]
scope_files: [docs/file-contract.md, src-tauri/src/application/project_service.rs, src-tauri/src/commands/projects.rs, src-tauri/src/domain/project.rs, src-tauri/src/infrastructure/fs_project_repository.rs, src-tauri/src/infrastructure/project_instructions.rs, src-tauri/src/lib.rs]
updated_at: 2026-08-08T07:53:13.588508+00:00
history:
  - { at: 2026-08-07T16:08:52Z, kind: created }
  - { at: 2026-08-08T03:49:10Z, kind: in_progress }
  - { at: 2026-08-08T04:09:16Z, kind: qa_waiting }
  - { at: 2026-08-08T07:53:13.588508+00:00, kind: completed }
---

# blocked 작업 재개를 원자적 사용자 감사 전이로 기록한다

## 결정권자 요약

사용자는 막힌 작업에 해결 근거를 남기고 개발 준비 상태로 되돌릴 수 있다.
상태, 재개 이력과 사용자 감사 기록은 같은 요청에서 함께 남고 일부 성공을 정상으로 숨기지 않는다.
문서가 바뀌었거나 다른 세션이 선점한 경우에는 아무 기록도 추가하지 않는다.
같은 요청을 반복해도 재개 이력과 감사 기록이 중복되지 않는다.
에이전트와 일반 문서 편집은 사용자 재개 기록을 만들 수 없고 기존 승인과 품질 확인 의미도 유지된다.
사용자는 자동 검사에서 충돌, 잠금, 선점과 저장 실패 시 원본 보존을 확인하면 된다.

## 확인 동선

이 작업에는 눈으로 볼 화면이 없다. 재개 버튼과 패널 배치는 이 작업의 범위 밖이고, 여기서 만든 것은
`resume_task` 명령과 저장 계약, 그리고 관리 규칙·파일 계약의 문언이다. 그래서 확인 도장은 아래
자동 검사 수치를 신뢰한다는 뜻이다.

- `cargo test --manifest-path src-tauri/Cargo.toml task_resume` → 15 passed, 0 failed
- `cargo test --manifest-path src-tauri/Cargo.toml` → 609 passed, 0 failed
- `npm run check` → 타입 검사 통과, 25개 파일 831 tests 통과, 배포 빌드 성공

수치 대신 동작을 직접 보고 싶다면 임시 프로젝트에서 다음을 재현할 수 있다. 화면이 없으므로 명령은
개발용 호출로 확인한다.

1. `.workflow/<워크플로우>/tasks/`에 `status: blocked`인 작업 문서를 두고, 그 문서의 `updated_at`
   값과 비어 있지 않은 해결 근거, 임의의 요청 식별자로 `resume_task`를 호출한다.
2. 작업 문서의 상태가 `todo`로 바뀌고 `history` 끝에 `{ at: <재개 시각>, kind: resumed }` 한 줄이
   붙는다. 같은 시각으로 `decisions/RESUME-XXXXXXXX.md`가 한 건 생기고 본문에는 입력한 해결 근거가
   그대로 있다. 기존 `## 막힌 사유` 절과 알 수 없는 프론트매터 필드는 그대로 남는다.
3. 같은 요청 식별자로 한 번 더 호출하면 성공을 다시 받지만 `resumed` 이력과 감사 파일은 각각 한 건
   그대로다.
4. `updated_at`을 다른 값으로 보내거나, `.workflow/.runtime/leases/<작업-id>.yml`에 미만료 lease를
   두거나, `.workflow/.runtime/migration.lock`이 있는 상태로 호출하면 거절되고 `tasks/`와
   `decisions/`의 파일 내용이 호출 전과 같다.

## 목적

SPEC-054의 R8부터 R11 중 앱 소유 상태 전이, 감사 기록과 자격 재계산 기반을 구현한다. 현재 작업 상태
계약에는 `blocked`에서 `todo`로 돌아가는 전이와 이력 종류가 없고 QA 결정 경로는 다른 의미를 가진다.
별도 Tauri 명령과 저장 계약을 추가해 사용자만 해결 근거와 함께 재개할 수 있게 한다.

## 현재 상태

- 작업 이력은 여섯 kind만 읽으며 앱은 QA 확인과 반려에서 `completed`와 `revision_requested`를 쓴다.
- QA 기록 경로는 결정 문서와 작업 문서를 차례로 저장하므로 blocked 재개에 필요한 stale 갱신 시각,
  대상 lease 검사와 별도 감사 의미를 제공하지 않는다.
- 개발자 자격 판정은 `blocked`를 항상 제외하고 `todo`가 되면 선행, 승인 결정, migration lock, lease와
  파일 겹침을 기존 규칙으로 다시 계산한다.
- TASK-S052-01도 현재 blocked이고 같은 규칙 파일을 대상으로 한다. 이 복구 경로를 그 작업에
  의존시키면 순환 대기가 생기므로 현재 앱 계약 위에서 먼저 구현하고, 이후 재개되는 규칙 작업이 새
  계약과 버전을 보존하게 한다.

## 재개 요청과 감사 계약

### 요청

- 새 `resume_task` 명령은 워크플로 디렉터리, 작업 파일 이름, 사용자가 확인한 `updatedAt`, 비어 있지
  않은 해결 근거와 요청 식별자를 받는다.
- 해결 근거는 양끝 공백을 제거한 뒤 비어 있으면 거절하고 2,000자를 넘지 않는다. 앱은 자동 검사나
  관련 작업을 근거로 제안할 수 있지만 사실 문장을 만들어 저장하지 않는다.
- 명령은 앱 UI를 통한 사용자 조작에서만 공개한다. managed agent rules는 에이전트와 일반 Markdown
  편집이 `resumed` 이력이나 사용자 작성 감사 기록을 만들 수 없다고 명시한다.

### 커밋 전 판정

- 프로젝트 쓰기 잠금을 배타적으로 획득한 뒤 대상 문서를 다시 읽는다. 기존 migration lock이 있으면
  잠금 획득부터 실패하고 아무 문서도 쓰지 않는다.
- 상태가 정확히 `blocked`이고 현재 `updated_at`이 사용자가 확인한 값과 문자 단위로 같아야 한다.
- 대상 작업을 덮는 미만료 lease가 하나라도 있으면 다른 소유자 여부와 무관하게 거절한다. lease 파일을
  삭제, 갱신하거나 수정하지 않는다.
- 작업 식별자와 파일 이름을 다시 대조하고 등록되지 않은 워크플로, unsafe 경로, 미래 프로젝트 규격과
  읽을 수 없는 문서는 기존 안전 오류로 거절한다.
- 요청 식별자가 이미 같은 작업의 성공 감사 기록에 있으면 새 기록을 만들지 않고 기존 성공 결과를
  반환한다. 상태가 이미 todo인데 대응 기록이 없으면 성공으로 추측하지 않는다.

### 한 전이의 기록

- 작업 frontmatter의 상태를 `todo`로, `updated_at`을 재개 시각으로 바꾸고 기존 history 끝에
  `{ at: <재개 시각>, kind: resumed }` 한 항목을 추가한다. 기존 `## 막힌 사유`, 본문과 알 수 없는
  frontmatter 필드는 그대로 보존한다.
- 같은 시각의 app-owned 감사 문서를 `decisions/`에 아래 계약으로 한 건 쓴다.

  ```yaml
  schema: workflow-labs/task-resume@1
  id: RESUME-XXXXXXXX
  task_id: TASK-001
  outcome: resumed
  request_id: 사용자 요청 식별자
  previous_updated_at: 사용자가 확인한 작업 갱신 시각
  created_by: user
  created_at: RFC3339
  ```

- 감사 문서 본문은 사용자가 입력한 해결 근거 원문만 보존한다. 승인 결정과 QA 결정 스키마나 결과값을
  재사용하지 않는다.
- 두 결과를 임시 파일에 완성한 뒤 프로젝트 쓰기 잠금 아래 커밋한다. 둘 중 하나만 영속화되면 정상
  성공을 반환하지 않으며, 자체 rollback에 실패한 경우 생성된 경로와 필요한 복구 행동을 구조화해
  반환한다. 다음 조회가 부분 상태를 완료로 추측하지 않는다.
- 같은 요청의 성공 재시도, 더블 클릭과 응답 유실에서도 history와 감사 문서는 각각 한 건뿐이어야 한다.

## 읽기와 호환성

- task history 허용 목록에 `resumed`를 추가하고 task-resume 감사 기록도 같은 작업 이벤트로 읽는다.
  같은 kind와 시각이 두 원천에 있으면 활동 payload에는 한 번만 보인다.
- 기존 여섯 kind, specification 결정과 QA 결정의 읽기·상태 의미는 바꾸지 않는다. 앱 소유 재개 기록은
  기획서 최신 결정이나 QA 최신 결과 판정에 참여하지 않는다.
- managed 공통 규칙과 파일 계약은 `resumed`가 사용자 재개 사실이고 `in_progress`를 대신하지 않음을
  명시한다. 개발자 역할은 todo 작업을 claim한 뒤 기존대로 별도 `in_progress`를 추가한다.
- 이전 앱이 모르는 history 항목과 감사 스키마를 만나도 원문을 보존하도록 기존 frontmatter 갱신 검사를
  확장한다. 프로젝트·문서 schema version은 변경하지 않는다.
- 재개 성공 뒤 기존 `summary_from_manifest`와 developer 자격 판정을 다시 계산한 ProjectSummary를
  반환한다. 재개 명령 자체가 provider를 시작하거나 task를 `in_progress`로 바꾸지 않는다.

## 손대지 않는 것

- 실제 재개 버튼과 패널 레이아웃
- agent runtime provider와 설치·업데이트 계약
- 기존 blocked 작업의 자동 또는 일괄 변환
- 앱 밖 주체의 사용자 감사 기록 작성
- 기존 기획 승인, QA 확인·반려와 프로젝트 schema migration

## 완료 조건

1. blocked 작업과 일치하는 갱신 시각, 비어 있지 않은 해결 근거로 재개하면 status가 todo가 되고
   resumed history와 task-resume 감사 문서가 같은 시각으로 한 번씩 남는다.
2. 기존 막힌 사유 절, 본문, 이전 history와 알 수 없는 frontmatter 필드가 바이트 의미를 잃지 않고
   보존된다.
3. stale 갱신 시각, 이미 재개된 상태, migration lock, 대상 활성 lease, 잘못된 경로와 미래 규격에서는
   작업과 decisions 디렉터리가 모두 바뀌지 않는다.
4. 같은 요청 식별자를 반복하거나 성공 응답을 잃고 재시도해도 history와 감사 기록이 중복되지 않는다.
5. 작업 저장 실패, 감사 저장 실패와 rollback 실패를 각각 주입했을 때 부분 성공을 정상으로 반환하지
   않고 원본 또는 명시적 복구 결과가 남는다.
6. 감사 기록의 작성자는 user이며 에이전트가 쓸 수 있는 managed 규칙 경로에는 같은 작성 권한이 없다.
7. resumed 이벤트는 작업 목록과 활동 payload에 한 번만 나타나고 기존 여섯 이벤트의 순서·이름과 QA
   중복 제거가 변경 전과 같다.
8. 재개 뒤 developer 판정이 다시 계산된다. 선행 미충족이나 scope 겹침이 있으면 todo로 남고 판정은
   계속 자격 없음이며 provider 실행은 0회다.
9. 이전 앱 경로가 resumed와 task-resume 원문을 삭제하거나 기존 결정으로 오인하지 않는다.
10. 프로젝트, task와 decision schema version은 바뀌지 않는다.
11. 기존 승인·QA 기록과 관리 자산 동기화 검사가 삭제되거나 약화되지 않는다.

## 검증 절차

1. `cargo test --manifest-path src-tauri/Cargo.toml task_resume`를 실행한다.
2. 임시 프로젝트의 blocked 작업을 재개하고 task와 감사 문서의 시각, 요청 식별자, 이전 갱신 시각과
   해결 근거를 대조한다.
3. stale 갱신 시각, todo 상태, migration lock과 미만료 lease를 각각 만들어 전후 파일 해시가 같은지
   확인한다.
4. 감사 파일 생성, task 교체와 rollback 실패를 각각 주입해 성공 응답 부재와 복구 결과를 검사한다.
5. 같은 요청을 직렬·동시로 반복해 성공 기록이 한 건뿐인지 확인한다.
6. resumed를 모르는 기존 QA frontmatter 갱신 픽스처로 새 이력과 알 수 없는 감사 문서가 보존되는지
   확인한다.
7. 재개된 todo 작업에 미충족 선행과 scope 겹침을 각각 넣고 developer 판정과 provider 비호출을
   대조한다.
8. `cargo test --manifest-path src-tauri/Cargo.toml`을 실행한다.
9. `npm run check`를 실행해 새 command 등록이 프런트엔드 기존 계약을 깨지 않는지 확인한다.

## 범위와 선행

TASK-S051-01의 예약·판정 관리 자산 변경을 보존해야 하므로 그 작업이 선행한다. 현재 blocked인
TASK-S052-01이나 그 뒤의 TASK-143을 선행으로 두지 않는다. 재개 경로가 그 작업들을 기다리면 어떤
작업도 blocked에서 나올 수 없는 순환이 생기기 때문이다. TASK-146·147과 파일이 겹치지 않아 세 작업은
병렬로 진행할 수 있다.
