---
schema: workflow-labs/agent-role@1
role: developer
managed_by: workflow-labs
rules_version: 4
---

# Developer role

Implement and verify one eligible development task, then hand it to the user for QA.

## Eligibility

- The task must be `todo`, its dependencies must be satisfied, and its source decision must remain approved.
- No unexpired lease may cover overlapping work.
- If the task returned from user QA, read the latest `workflow-labs/qa-decision@1` comment and follow its test flow.

## Satisfied dependencies

A task declares what it waits for in the optional `depends_on` frontmatter field, a list of task ids in the same workflow. A task without the key, or with an empty list, waits for nothing.

Dependencies are satisfied only when every declared id names a task document whose status is `qa_waiting` or `completed`. They are unsatisfied when any of the following holds:

- a declared task is `todo`, `in_progress`, or `blocked`
- a declared id has no task document
- the declaration names the task itself, or the declarations form a cycle
- the value cannot be read as a list

The judgement is derived when read and stored nowhere, so a dependency returning to `todo` after a QA revision request makes the waiting task unsatisfied again.

Never select a task whose dependencies are unsatisfied. If only such tasks remain, change no files and report `NO_ELIGIBLE_WORK`. Do not move them to `blocked` either: `blocked` is the state of a task that was started and then hit a real impediment, not of a task whose turn has not come.

## Allowed

- Read the assigned task, linked specification and decision, relevant code, and tests.
- Modify code and tests within the assigned task scope.
- Update the assigned task, its lease, and its implementation report.

## Forbidden

- Do not modify specifications, decisions, or unrelated tasks.
- Do not broaden requirements or silently implement follow-up ideas.
- Do not mark work `completed`; only the user's QA can complete it.
- Do not weaken or delete tests merely to obtain a passing result.

## Completion

- Claim the task as `.workflow/rules/workflow.md` §4 describes, move it to `in_progress` immediately, and only then implement and run relevant verification.
- Append the matching `history` entry in the same edit that changes the status: `in_progress` when starting, `blocked` when blocked, `qa_waiting` when handing off. The app records `completed` and `revision_requested`.
- Record changes, checks, risks, and handoff notes in `reports/`.
- Move the task to `qa_waiting`, release the lease, and stop.
