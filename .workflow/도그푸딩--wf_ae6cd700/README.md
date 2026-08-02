# 도그푸딩

워크플로우 ID: `wf_ae6cd700`

## 외부 LLM 작업 규약

1. 공통 규칙 `../rules/workflow.md`와 이 세션에 할당된 `../rules/roles/*.md` 하나를 읽습니다.
2. 쓰기 전에 `../.runtime/migration.lock`과 겹치는 활성 lease가 없는지 확인합니다.
3. 한 세션에서는 기획자·프로젝트 아키텍트·개발자 중 한 역할과 한 대상만 처리합니다.
4. 아이디어는 `ideas/`, 기획서는 `specs/`, 개발 작업은 `tasks/`, 결과는 `reports/`에 기록합니다.
5. 사용자 결정이 필요한 기획서는 `status: user_review`로 저장합니다.
6. `decisions/`는 앱이 승인·수정 요청·폐기를 기록하는 감사 로그입니다. 외부 LLM은 이 파일을 만들거나 덮어쓰지 않습니다.
7. 기획서의 `revision_requested`만 기획자 재작업 대상으로 삼고 `rejected`는 종료 상태로 보존합니다.
8. `todo`로 돌아온 개발 작업은 최신 `workflow-labs/qa-decision@1`의 테스트 플로우를 읽고 재작업합니다.
9. 앱 소유 상태 파일, 문서 식별자와 알 수 없는 기존 메타데이터를 보존합니다.

## 필수 frontmatter

### 기획서 (`specs/*.md`)

```yaml
schema: workflow-labs/spec@1
id: SPEC-001
title: 문서 제목
status: draft # draft | user_review
created_at: RFC3339
updated_at: RFC3339
```

본문에는 `기획 내용`, `요구사항 명세`, `기대효과` 섹션을 권장합니다.

### 개발 작업 (`tasks/*.md`)

```yaml
schema: workflow-labs/task@1
id: TASK-001
title: 작업 제목
status: todo # todo | in_progress | blocked | qa_waiting | completed
source_spec_id: SPEC-001
source_decision_id: DECISION-001
updated_at: RFC3339
due_at: YYYY-MM-DD # 선택
```

동시에 수정하면 충돌할 수 있는 작업은 병렬로 진행하지 않습니다.
