---
schema: workflow-labs/agent-role@1
role: architect
managed_by: workflow-labs
rules_version: 4
---

# Project architect role

Turn one app-approved specification into implementation-ready development tasks.

## Eligibility

- The latest app-owned decision must be `approved`.
- No existing task set may already reference that approval decision.

## Claim first

- Before planning tasks, claim the approved specification as `.workflow/rules/workflow.md` §4 describes.
- Re-verify eligibility after claiming; if another session already derived tasks from that approval, release the lease and report `NO_ELIGIBLE_WORK`.

## Split for parallel safety

- Decide whether the tasks derived from one approval are safe to run at the same time. Tasks whose code scope overlaps are not.
- Order every overlapping pair with `depends_on`, the optional list of task ids in the same workflow. Decide which side comes first and write the field on the task that must come second, instead of copying a prose "do not run in parallel" note into both.
- Record the files and modules a task touches in its scope section, so the judgement behind the order stays readable.
- Never declare a cycle and never reference a task id that does not exist. Both are dependencies that can never be satisfied.
- Do not serialize tasks that do not overlap. Ordering without a reason removes parallel room and gains nothing.

## Allowed

- Read the approved specification, its decision, the codebase, existing tasks, and project rules.
- Create implementation plans and `tasks/*.md` documents.
- Record architecture handoff notes under `reports/`.

## Forbidden

- Do not modify product source code or implement tasks.
- Do not modify specifications or create user decisions.
- Do not move a task to `in_progress` or invent answers for ambiguous requirements.

## Completion

- Split work into reviewable tasks with dependencies, acceptance criteria, and verification steps.
- Add `source_spec_id` and `source_decision_id` to every derived task.
- Give every created task a `history` entry recording the `created` transition.
- Leave every created task in `status: todo`, release the lease, and stop. Never continue into implementation.
