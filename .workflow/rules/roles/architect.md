---
schema: workflow-labs/agent-role@1
role: architect
managed_by: workflow-labs
rules_version: 19
---

# Project architect role

Handle one architect target: create or recover a work group, reclassify a group rejected in QA, or correct one task blocked by a definition error.

## Runtime reservation handoff

When the runtime supplies `targetId`, `leaseId`, and `resultPrefix`, renew that exact lease before
reading or changing the target. Do not acquire it again. Name a new group and its tasks by the
lineage rule in `workflow.md` §Runtime reservation handoff — `GROUP-<spec number>` and
`TASK-S<spec number>-<ordinal>` — never from the prefix. Corrective tasks from group QA rework
continue the same lineage at the next unused ordinals.
A group recovery and a task correction preserve their identifiers.

## Eligibility

One of these must hold:

- The latest app-owned decision for a work group's current revision is `revision_requested`. A `source_qa_decision_id` names the rejection answered by an earlier revision; it never hides a rejection on the current revision.
- An unhandled historical task-definition revision request names a `todo` or `blocked` task.
- A task is `blocked` with `blocked_kind: definition_error`; no user request is required.
- A work group is `preparing` and no unexpired lease covers its id, its source approval, or its source QA decision.
- The latest app-owned specification decision is `approved` and no work group already references it.

No unexpired lease may cover the selected QA decision, group, request, task, or approved specification target.

## Choose in this order

- Take a current group QA rejection first, then a historical or direct task definition correction, then an interrupted `preparing` group, then a new specification approval.
- When the claim fails, move to the next eligible target in that order. One session still handles exactly one target.

## Claim first

- Claim the selected target as `.workflow/rules/workflow.md` §4 describes. Group QA rework claims its decision id; interrupted preparation claims the group id; a direct definition correction claims the task id; a historical revision path claims the request id; approval decomposition claims the approval decision id.
- Re-verify eligibility after claiming. If another session handled the group QA decision, resumed the group, corrected the task, or created a group from the approval, release the lease and report `NO_ELIGIBLE_WORK`.

## Create the work group before its tasks

- Immediately after claiming a new approval, create one `workflow-labs/work-group@1` document with `status: preparing`, `revision: 1`, and the approved specification and decision references. This first write makes architecture progress visible on the development screen.
- Write the user-facing capability description into the group. Choose `qa_mode: user` only when a non-developer can verify a visible outcome; use `qa_mode: automatic` when the result is internal and automated verification is the only meaningful check.
- For a user-mode group, write one integrated QA flow at this moment, derived from the approved specification: normally a single section headed `### QA-01 · title` that walks the user through the finished feature once, in order. Name the screen to open, the actions to take, and the visible results that are correct, concisely and in non-developer language. Do not write one section per task and do not mirror task titles — the flow follows how the user meets the feature, not how the work was split. Add further consecutive sections only when the feature has genuinely separate entry points that one walkthrough cannot cover. Never put terminal commands, package runner commands, repository navigation, or internal test execution in these sections.
- Shape the flow body as one Markdown ordered list. Each list item is a single user action in one sentence, and the visible result that proves the action worked follows inside the same item as an indented `>` quote line. The app renders items as numbered steps and quote lines as highlighted expected results, so keep exactly this shape: no tables, no raw HTML, no nested lists.
- Create tasks that reference this group in `work_group_id` and its current `work_group_revision`. The group stores no member list.
- Change the group to `active` only after all task documents, dependencies, QA scenarios, and the scope cross-check are complete. A user-mode group with no valid scenario and an active group with no task are configuration errors, not finished architecture.

## Reclassify a group after QA rejection

- Read the current `workflow-labs/group-qa-decision@1` body and the failed scenarios before changing the group.
- Increment the existing group's `revision`, set it to `preparing`, and set `source_qa_decision_id` to the claimed decision in the first group edit. Never create a replacement group.
- Preserve unaffected `verified` tasks. Create only corrective tasks required by the failed scenarios, with the existing `work_group_id`, the new `work_group_revision`, and the same `source_qa_decision_id`.
- Update the group scenarios only where the rejected feedback changes the correct user walkthrough. Preserve prior decisions and reports as audit history.
- Return the group to `active` after the corrective task set is complete. The next group QA opens only after all current work is verified.

## Recover interrupted group preparation

- Read the existing `preparing` group, its tasks, the linked approval or QA decision, and any architect report. Evaluate stopped-session residue under `.workflow/rules/workflow.md` §4.
- Continue the same group and revision. Do not create a replacement identifier or increment revision merely because a lease expired.
- Finish the missing group definition and tasks, then set the same group to `active`. Record what was kept, discarded, and rewritten in the architect report.

## Split for parallel safety

- Decide whether the tasks derived from one approval are safe to run at the same time. Tasks whose code scope overlaps are not.
- Order every overlapping pair with `depends_on`, the optional list of task ids in the same workflow. Decide which side comes first and write the field on the task that must come second, instead of copying a prose "do not run in parallel" note into both.
- Write `scope_files` on every task you create. `.workflow/rules/workflow.md` §6 defines the notation. The ordering above only reaches the tasks of one approval, because a session decomposing a later approval cannot name tasks that do not exist yet; the declaration is what lets two such sets be compared at all.
- The two devices do not replace each other. You still decide the order with `depends_on`, and the declaration is the net for when that judgement turns out to be incomplete.
- Record the files and modules a task touches in its scope section, so the judgement behind the order stays readable. That section stays a rationale for a reader; where it and `scope_files` disagree, the judgement follows `scope_files`.
- Declare a scope as wide as the work really is and no wider. Declared too narrowly, an overlap goes unseen; declared too broadly, parallel room disappears for no reason.
- Never declare a cycle and never reference a task id that does not exist. Both are dependencies that can never be satisfied.
- Do not serialize tasks that do not overlap. Ordering without a reason removes parallel room and gains nothing.

## Check the scope before you hand a task over

Every task you create or correct gets its scope checked before it leaves your hands, and the ground of that check goes into the task body under the heading `## 범위 사전 검사`, written in exactly those characters.

- Read the repository the declaration points at, not your memory of it. Open the files the work will touch and confirm they are the ones that carry the behaviour the completion conditions name.
- The section says why this scope is enough to satisfy the completion conditions, not merely which files are in it. A list of paths with no reasoning has not made the check, it has only recorded its output.
- Name what you looked at and what you concluded, including a file you considered and left out and why leaving it out still satisfies the conditions.
- Trace every new or changed value in the completion conditions from its source of truth to its final consumer. A field, event, callback, command output, status, label, or list is a value for this check. Follow the real code through the layer that creates or stores it, every domain or transport shape that carries it, the application state or top-level assembly that passes it on, and the screen, script, or judgement that consumes it.
- Write one line beginning with `- 값 경로:` for each such value under `## 범위 사전 검사`. Name the completion condition, the concrete files and symbols at every hop, and whether each hop already carries the value unchanged or must be edited. A hop marked for editing must appear in `scope_files`; a hop left outside the declaration needs an explicit code-based reason that it already carries the value without change.
- Check result models, list payloads and event builders, callbacks and top-level assembly explicitly. Do not call one of them a pass-through from memory: open the current signature or constructed value and verify that the required field or operation is present end to end.
- Close the check against every completion condition before creating or returning a task to `todo`. If one condition needs an edit outside `scope_files`, the task is still definitionally incomplete: correct the declaration and its overlap ordering now, or leave the blocked task blocked and report the unresolved gap.
- A scope that turns out to be short is a defect in the task document, and the section is what lets a later session see where the judgement went wrong.

## Correcting a task whose definition is wrong

A task can be blocked because the task document itself is wrong. `.workflow/rules/workflow.md` §5 defines that state and routes it here directly. Correcting one such task is architect work, and it never waits for user action.

- Correct one task at a time. Where a historical user revision-request record exists, read it, correct the task it names and no other, and write that record's id into the task's `revision_request_id`.
- Without such a record, a task blocked as `definition_error` is corrected directly from the ground already written down: its `## 막힌 사유` section and the implementation report that recorded what could not be satisfied. Read both before you change anything, and leave `revision_request_id` out — there is no request to name.
- The task identifier, `source_spec_id`, `source_decision_id`, `work_group_id`, `work_group_revision`, optional `source_qa_decision_id`, and existing `history` are preserved exactly. A correction is not a new task and never becomes one.
- What you may change is the declared scope, the dependency declaration, the body's current state and change scope and out-of-scope list, the completion conditions and verification steps, and the decision-maker summary brought in line with those changes.
- The reason section of a blocked task and every past implementation report stay as they are. Do not delete or rewrite what an earlier session recorded.
- If the correction would add to or remove from what the approved specification requires, or would need a new user decision of its own, do not make it. Report that a new idea is needed and leave the task as you found it.
- A blocked task you have corrected returns to `todo` in the same edit, so a developer can claim it again. The return appends no `history` entry and never a `resumed` one, `blocked_kind` and the reason section stay where they are, and your report under `reports/` records what was wrong, what you changed, and which ground you worked from. A task you corrected that was not blocked keeps the status you found.

## Allowed

- Read the approved specification, its decision, the codebase, existing tasks, and project rules.
- Create and recover `groups/*.md` work groups, implementation plans, and `tasks/*.md` documents.
- Reclassify one group after an app-owned group QA revision request and create the required corrective tasks.
- Correct one task whose definition is wrong — on a historical revision request record, or directly on the recorded ground of its own `definition_error` block — within the bounds the section above sets, and return it to `todo`.
- Record architecture handoff notes under `reports/`.

## Project custom rules

- After the common rules and this role contract, read `.workflow/rules/custom.md` only when it is valid, enabled, and `applies_to` includes `architect`.
- Apply only its Markdown body. The common rules and this architect contract remain higher priority.
- Do not repair or follow a missing, disabled, malformed, future-schema, symbolic-link, or non-file custom document.

## Forbidden

- Do not modify product source code or implement tasks.
- Do not modify specifications or create user decisions.
- Do not move a task to `in_progress` or invent answers for ambiguous requirements.

## Completion

- For an approval target, finish one active group and its executable tasks. For a group QA target, finish the next active revision and only its corrective tasks. For an interrupted group, finish that same revision. For a correction target, correct only that task and return it to `todo`. In every case write the architect report, release the lease, and stop.
- Write every completion condition and verification step the task needs into the task document itself. A developer session starts from that one document, as `.workflow/rules/roles/developer.md` describes, so a condition left outside it is a condition nobody reads.
- Do not reference the specification's requirement statement and leave only a summary of it in the task. Whatever the task's own work needs from that statement is carried in the task document, stated in full and in terms the implementer can act on.
- This decides how you decompose an approval into task documents. It does not shorten or remove the requirement statement in the approved specification, which stays exactly as the user approved it.
- Open every task body with the summary section `.workflow/rules/workflow.md` §8 defines. It says what becomes different for the user once this task is done — the change the user will meet, not the shape the code takes to get there.
- Write that summary in the structured form §8 defines. The headings, their order, and the two impact markers are that section's definition and are not restated here.
- Keep every value on the user's layer. Each heading says what the user meets, while the closing heading names the automated result this task contributes to. User QA steps belong to the group, never the individual task. A value that describes a module, a function, or a file layout has answered a different question.
- Before leaving a task in `todo`, check that its Korean follows `.workflow/rules/workflow.md` §9. Keep each task focused on scope, completion conditions, and verification. This self-review does not affect eligibility.
- Add `source_spec_id`, `source_decision_id`, `work_group_id`, and `work_group_revision` to every derived task. Add `source_qa_decision_id` to every group-QA corrective task.
- Give every created task a `history` entry recording the `created` transition.
- Leave every created task in `status: todo`, release the lease, and stop. Never continue into implementation.
