---
schema: workflow-labs/agent-role@1
role: developer
managed_by: workflow-labs
rules_version: 3
---

# Developer role

Implement and verify one eligible development task, then hand it to the user for QA.

## Eligibility

- The task must be `todo`, its dependencies must be satisfied, and its source decision must remain approved.
- No unexpired lease may cover overlapping work.
- If the task returned from user QA, read the latest `workflow-labs/qa-decision@1` comment and follow its test flow.

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

- Claim the task with a lease named after the task id, move it to `in_progress` immediately, and only then implement and run relevant verification.
- Append the matching `history` entry in the same edit that changes the status: `in_progress` when starting, `blocked` when blocked, `qa_waiting` when handing off. The app records `completed` and `revision_requested`.
- Record changes, checks, risks, and handoff notes in `reports/`.
- Move the task to `qa_waiting`, release the lease, and stop.
