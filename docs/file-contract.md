# LLM Workflow 파일 계약

LLM Workflow와 외부 LLM은 프로세스나 API가 아니라 프로젝트의 Markdown/YAML 파일로 협업한다. 앱은 LLM을 실행하지 않으며, LLM은 앱의 내부 상태를 직접 조작하지 않는다.

`workflow-labs/*` 스키마 식별자는 기존 프로젝트와 앱 업데이트 호환성을 위해 이름 변경 후에도 유지한다.

## 디렉터리

```text
.                           # 선택한 프로젝트 루트
├── AGENTS.md               # Codex 및 공통 에이전트 진입점
├── CLAUDE.md               # Claude Code가 AGENTS.md를 import
└── .workflow/
    ├── project.yml
    ├── rules/
    │   ├── workflow.md       # 공급자 중립적인 공통 작업 규칙
    │   └── roles/
    │       ├── planner.md
    │       ├── architect.md
    │       └── developer.md
    ├── .runtime/             # Git 제외
    │   ├── leases/
    │   └── migrations/
    └── <slug>--<workflow-id>/
        ├── workflow.yml
        ├── ideas/
        ├── specs/
        ├── decisions/        # 앱이 기록하는 사용자 결정
        ├── tasks/
        ├── reports/
        └── state/
```

워크플로우를 처음 생성할 때 앱은 상세 규칙과 두 진입점을 함께 설치한다.

- 기존 `AGENTS.md`와 `CLAUDE.md`는 보존하고 앱 관리 마커 블록만 추가하거나 갱신한다.
- 기존 `CLAUDE.md`가 이미 `@AGENTS.md`를 import하면 중복 블록을 추가하지 않는다.
- 관리 마커가 손상됐거나 `.workflow/rules/workflow.md`가 앱 규격 파일이 아니면 덮어쓰지 않고 생성을 중단한다.
- 공통 규칙은 `schema: workflow-labs/agent-rules@1`, 역할 계약은 `schema: workflow-labs/agent-role@1`로 식별한다.
- 규칙 파일은 앱 관리 자산이며 기획서 결정 시 최신 역할 계약으로 안전하게 갱신한다.
- Codex의 `.codex/rules/*.rules`는 명령 승인 정책이므로 워크플로우 행동 규칙 저장소로 사용하지 않는다.

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

기획서 상태는 `draft` 또는 `user_review`를 사용한다. 승인·수정 요청·폐기는 기획서 원문에 쓰지 않는다.

## 사용자 결정

앱은 승인·수정 요청·폐기 시 `decisions/*.md`에 추가 전용 기록을 만든다.

```markdown
---
schema: workflow-labs/decision@1
id: DECISION-001
spec_id: SPEC-001
outcome: revision_requested
created_by: user
created_at: 2026-07-30T10:20:00Z
---

성공 조건을 더 구체적으로 작성해 주세요.
```

- `outcome`: `approved`, `revision_requested`, `rejected`
- 수정 요청과 폐기에는 코멘트가 필수다.
- `revision_requested`는 기획자 역할이 새 ID의 개선된 기획서를 만들 수 있는 재작업 요청이다.
- `rejected`는 종료 상태다. 사용자가 새 아이디어로 다시 요청하지 않는 한 외부 LLM이 되살리지 않는다.
- 동일 기획서에 결정이 여러 개 있으면 가장 최근 앱 기록을 사용한다.
- 앱은 `schema: workflow-labs/decision@1`, `created_by: user`인 기록만 사용자 결정으로 신뢰한다.
- 외부 LLM은 decision 파일을 수정하지 않고 후속 기획서에 결과를 반영한다.

## 에이전트 역할 계약

- 기획자는 미처리 아이디어 또는 `revision_requested` 결정 하나를 기획서로 가공하고 `user_review`에서 멈춘다.
- 프로젝트 아키텍트는 최신 결정이 `approved`인 기획서 하나를 `todo` 작업으로 분해하고 구현하지 않는다.
- 개발자는 의존성이 충족된 담당 `todo` 작업 하나를 구현·검증하고 `qa_waiting`에서 멈춘다.
- 세 역할 모두 한 세션에서 다음 역할로 넘어가지 않으며, 처리 대상이 없으면 파일을 바꾸지 않는다.

## 개발 작업

```markdown
---
schema: workflow-labs/task@1
id: TASK-001
title: 기획서 상태 파서 구현
status: in_progress
updated_at: 2026-07-30T10:30:00Z
due_at: 2026-08-07
---

작업 범위와 완료 조건을 작성한다.
```

지원 상태:

- `todo`: 시작 전
- `in_progress`: 작업 중
- `blocked`: 진행 불가
- `qa_waiting`: 작업 완료 후 사용자 QA 대기
- `completed`: QA까지 완료

개발 작업 카드를 선택하면 앱이 Markdown 본문을 상세 화면으로 보여준다. `qa_waiting` 작업에서는 사용자가 테스트 플로우와 확인 메모를 입력하고 다음 결정을 내린다.

- `confirmed`: 작업 상태를 `completed`로 변경한다. 확인 메모는 선택이다.
- `revision_requested`: 코멘트를 필수로 기록하고 작업 상태를 `todo`로 되돌린다.

QA 결정은 `decisions/*.md`에 `schema: workflow-labs/qa-decision@1`, `created_by: user`인 추가 전용 감사 로그로 남긴다. 개발자는 `todo` 작업에 최신 QA 수정 요청이 있으면 해당 테스트 플로우를 읽고 재작업한다.

`due_at`은 선택 필드이며 `YYYY-MM-DD` 형식의 작업 목표일이다. 캘린더뷰는 이 값을 기준으로 작업을 배치하고, 필드가 없거나 형식이 잘못된 작업은 일정 미지정으로 표시한다.

작업 범위가 겹치면 병렬 작업을 금지한다. 외부 LLM이 작업하는 동안에는 `.workflow/.runtime/leases/*.yml`에 만료 시간이 있는 lease를 두어 앱 마이그레이션을 막는다.

## 안전 규칙

- `.workflow/.runtime/migration.lock`이 존재하면 모든 외부 쓰기를 멈춘다.
- 앱은 활성 lease가 있으면 문서 마이그레이션을 실행하지 않는다.
- 앱 업데이트와 프로젝트 문서 마이그레이션은 별도 작업이다.
- 알 수 없는 메타데이터는 보존한다.
- 사용자 결정과 LLM 원문을 같은 파일에서 동시에 수정하지 않는다.
- 외부 LLM은 작업 시작 시 `.workflow/rules/workflow.md`를 읽고 만료 시간이 있는 lease를 만든다.
- 기획서 `user_review`는 사용자 선택 대기 상태이며, 외부 LLM이 승인·수정 요청·폐기를 대신 기록하지 않는다.
