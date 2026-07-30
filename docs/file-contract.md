# Workflow Labs 파일 계약

Workflow Labs와 외부 LLM은 프로세스나 API가 아니라 프로젝트의 Markdown/YAML 파일로 협업한다. 앱은 LLM을 실행하지 않으며, LLM은 앱의 내부 상태를 직접 조작하지 않는다.

## 디렉터리

```text
.workflow/
├── project.yml
├── .runtime/                  # Git 제외
│   ├── leases/
│   └── migrations/
└── <slug>--<workflow-id>/
    ├── workflow.yml
    ├── ideas/
    ├── specs/
    ├── decisions/            # 앱이 기록하는 사용자 결정
    ├── tasks/
    ├── reports/
    └── state/
```

## 기획서

외부 LLM은 검토 가능한 기획서를 `specs/*.md`에 작성한다.

```markdown
---
schema: workflow-labs/spec@1
id: SPEC-001
title: 사용자 선택 대기 허브
status: user_review
created_at: 2026-07-30T10:00:00Z
updated_at: 2026-07-30T10:10:00Z
---

# 사용자 선택 대기 허브

## 기획 내용

...

## 요구사항 명세

...

## 기대효과

...
```

기획서 상태는 `draft` 또는 `user_review`를 사용한다. 승인과 폐기는 기획서 원문에 쓰지 않는다.

## 사용자 결정

앱은 승인 또는 폐기 시 `decisions/*.md`에 추가 전용 기록을 만든다.

```markdown
---
schema: workflow-labs/decision@1
id: DECISION-001
spec_id: SPEC-001
outcome: rejected
created_by: user
created_at: 2026-07-30T10:20:00Z
---

성공 조건을 더 구체적으로 작성해 주세요.
```

- `outcome`: `approved` 또는 `rejected`
- 폐기에는 코멘트가 필수다.
- 동일 기획서에 결정이 여러 개 있으면 가장 최근 앱 기록을 사용한다.
- 앱은 `schema: workflow-labs/decision@1`, `created_by: user`인 기록만 사용자 결정으로 신뢰한다.
- 외부 LLM은 decision 파일을 수정하지 않고 후속 기획서에 결과를 반영한다.

## 개발 작업

```markdown
---
schema: workflow-labs/task@1
id: TASK-001
title: 기획서 상태 파서 구현
status: in_progress
updated_at: 2026-07-30T10:30:00Z
---

작업 범위와 완료 조건을 작성한다.
```

지원 상태:

- `todo`: 시작 전
- `in_progress`: 작업 중
- `blocked`: 진행 불가
- `qa_waiting`: 작업 완료 후 사용자 QA 대기
- `completed`: QA까지 완료

작업 범위가 겹치면 병렬 작업을 금지한다. 외부 LLM이 작업하는 동안에는 `.workflow/.runtime/leases/*.yml`에 만료 시간이 있는 lease를 두어 앱 마이그레이션을 막는다.

## 안전 규칙

- `.workflow/.runtime/migration.lock`이 존재하면 모든 외부 쓰기를 멈춘다.
- 앱은 활성 lease가 있으면 문서 마이그레이션을 실행하지 않는다.
- 앱 업데이트와 프로젝트 문서 마이그레이션은 별도 작업이다.
- 알 수 없는 메타데이터는 보존한다.
- 사용자 결정과 LLM 원문을 같은 파일에서 동시에 수정하지 않는다.
