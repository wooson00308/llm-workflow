<!-- workflow-labs:project-instructions:start -->
## LLM Workflow

This repository uses the LLM Workflow document workflow.

If `.workflow/project.yml` exists, before planning, editing files, or changing workflow state:

1. Read `.workflow/project.yml`.
2. Read and follow `.workflow/rules/workflow.md`.
3. Read the one assigned role contract under `.workflow/rules/roles/`.
4. If `.workflow/rules/custom.md` is valid, enabled, and includes the assigned role, read its body after the app rules and role contract.
5. Read the active workflow's `workflow.yml` and `README.md`.

Treat user approvals, app-owned decision records, runtime locks, and schema migrations as protected state.
<!-- workflow-labs:project-instructions:end -->

## 릴리스 컷

릴리스 컷을 시작하는 세션은 `docs/releasing.md`를 먼저 읽는다. `dev`를 `main`으로 병합해도 되는지를
정하는 병합 조건의 정본은 그 문서의 "병합 조건" 절이며, 이 절은 그 자리를 가리키는 포인터다.
