---
schema: workflow-labs/agent-role@1
role: developer
managed_by: workflow-labs
rules_version: 13
---

# Developer role

Implement and verify one eligible development task, then hand it to the user for QA.

## Runtime reservation handoff

When the runtime supplies `targetId` and `leaseId`, renew that exact lease before implementation and
do not call `acquire` again. Keep the supplied result prefix in the handoff report when relevant;
the runtime prompt never replaces this contract or adds provider-specific role instructions.

## Eligibility

- The task must be `todo` or `in_progress`, its dependencies must be satisfied, and its source decision must remain approved.
- An `in_progress` task qualifies only while no unexpired lease covers it. A missing lease file and an expired one mean the same thing here, and `.workflow/rules/workflow.md` §4 is where "unexpired" is defined. Every other condition on this list holds for it exactly as it holds for a `todo` task; none of them is loosened because the task was already started.
- A `blocked` task never qualifies, whatever its lease says. `blocked` is a state a session declared on purpose after hitting a real impediment, so it is not the trace of a session that stopped — a session that stopped leaves the state it was working in.
- No unexpired lease may cover work that overlaps the task's `scope_files`. "Overlapping work" below is that judgement.
- If the task returned from user QA, read the latest `workflow-labs/qa-decision@1` comment and follow its test flow.

## Choose in this order

- Take a resumable `in_progress` task before a `todo` task. Work that stopped has already been paid for, and while it stays stopped every task that names it in `depends_on` is stopped with it — satisfied dependencies count only `qa_waiting` and `completed`, so a task nobody resumes starves the ones behind it too.
- When the claim fails, move on to the next target in this order. When every target is already claimed, change no files and report `NO_ELIGIBLE_WORK`.
- One session still processes exactly one task. The condition script and the app's pending-work display answer only whether work exists, never which work comes first, so do not read either as an order.

## Taking over a stopped task

- The document is already `in_progress`, so do not move it there again. Append the `in_progress` entry `.workflow/rules/workflow.md` §5 asks for, and hand off at `qa_waiting` the way any other session does.
- Evaluate the stopped session's residue as `.workflow/rules/workflow.md` §4 requires, and report the split it asks for.
- The body of the task document — its scope and its completion conditions — belongs to the architect, and a takeover does not edit it. What the stopped session failed to finish and what the task is defined to be are different things, and this line is what keeps them apart.
- If the stopped session damaged that body, report it as an out-of-role finding and stop. Repairing it is not this role's work.

## Satisfied dependencies

A task declares what it waits for in the optional `depends_on` frontmatter field, a list of task ids in the same workflow. A task without the key, or with an empty list, waits for nothing.

Dependencies are satisfied only when every declared id names a task document whose status is `qa_waiting` or `completed`. They are unsatisfied when any of the following holds:

- a declared task is `todo`, `in_progress`, or `blocked`
- a declared id has no task document
- the declaration names the task itself, or the declarations form a cycle
- the value cannot be read as a list

The judgement is derived when read and stored nowhere, so a dependency returning to `todo` after a QA revision request makes the waiting task unsatisfied again.

Never select a task whose dependencies are unsatisfied. If only such tasks remain, change no files and report `NO_ELIGIBLE_WORK`. Do not move them to `blocked` either: `blocked` is the state of a task that was started and then hit a real impediment, not of a task whose turn has not come.

## Overlapping work

A task declares the files it touches in the optional `scope_files` frontmatter field, and `.workflow/rules/workflow.md` §6 defines that notation. `depends_on` orders tasks that one architect session saw together; this declaration is what catches an overlap between tasks that were decomposed from different approvals and never named each other.

A task is blocked by overlap while an unexpired lease exists whose target is some other document and any of the following holds:

- the task's own declaration is missing or malformed, whatever that lease holds
- the lease's target is a task document whose declaration is missing or malformed
- the lease's target is a task document, and the two declarations name at least one identical path

Nothing else blocks. When the lease holds something that is not a task document and this task's declaration is readable, there is no declaration to compare against and the task stays open. Only unexpired leases count, judged for expiry exactly as `.workflow/rules/workflow.md` §4 describes, and the status of the task the lease holds does not matter — expiry is the only thing that releases it. A lease on the task itself is not overlap; the eligibility rule above already excludes that task.

The judgement only reads lease files. Never create, edit, or delete one to change its outcome.

If only tasks blocked by overlap remain, change no files and report `NO_ELIGIBLE_WORK`. Do not move them to `blocked` either, for the same reason as an unsatisfied dependency: another session's lease is not this task's impediment, and it goes away on its own.

## Start from the task document

Read the assigned task document first and start the work from that document alone. It is written to be the whole instruction sheet: the architect puts every completion condition and verification step the task needs inside it, and `.workflow/rules/roles/architect.md` is where that obligation is stated.

Open the linked specification and the decision when the task document is ambiguous, or when it does not carry enough ground for a judgement the work forces you to make. This section decides which path is the default one and nothing more. The reading itself stays permitted, exactly as `## Allowed` below lists it.

If you opened the specification or the decision, write in the report which part of the task document was insufficient and what you had to go outside it to find. That note is how a later architect session learns where its task documents fall short.

## The confirmation walkthrough

A task you hand to user QA carries a section headed `## 확인 동선`, written in exactly those characters. `.workflow/rules/workflow.md` §8 names it; what it holds is defined here, because you are the one who writes it.

Write it into the assigned task document, in the same edit that records the `qa_waiting` transition. The task body is otherwise the architect's, and this section is the one part of it that is yours.

- The minimum shape is: which screen → which action → what appears when it is right.
- A task with no screen to look at — a contract wording change, a judgement inside a script — says so in plain words: that the work was closed by automated checks, and that the confirmation stamp means trusting those numbers. Do not leave the section empty and do not write it as though a screen existed.
- A defect fix that has reproduction conditions writes those conditions into the walkthrough.
- Paths, commands, and identifiers are welcome here. Reproducing something may need them, and the restrictions §8 places on the summary do not reach this section.
- A task returned by user QA is walked again, so bring this section up to what the rework actually changed.

The `## 사용자 QA 제안` heading some reports carry is free writing, not this obligation. The task document is where the user reads the walkthrough, because the app opens task bodies beside the confirmation stamp and does not open reports at all.

## Blocking a task

`blocked` is for an impediment you actually hit. The eligibility section above already says why a question or an approval request is not one, and nothing here loosens that.

When you do hit one, write the reason section `.workflow/rules/workflow.md` §5 defines into the assigned task, in the same edit that sets the status and appends the `blocked` entry. The heading and its four labels are that section's definition and are not restated here.

- The four values carry what you have checked and nothing else. Do not write a resolution you have not seen, and do not present as settled anything that is still open.
- The report says what you verified and what impediment remains. It does not become the place a reader goes for the current reason: the section in the task document is where that lives, and the report is read beside it, not instead of it.
- Reasons you wrote earlier are not edited away. A later block replaces the section with the reason that holds then, and the earlier one stays in the report that recorded it.

## What the report holds

The implementation report carries a fixed set of sections. Write all of them, and keep the body within the limit below.

- The decision-maker summary `.workflow/rules/workflow.md` §8 defines stays first, in the position and under the conditions that section sets. Nothing here moves it or relaxes it. A report is not one of the two kinds that carry the structured form, so this summary stays plain prose under the ten-line limit.
- Changed files and modules: what you edited, named so a reader can open it directly.
- Verification steps and their results: which command or check you ran, and the result it returned.
- Remaining risks: what this change could still break, and what stayed unverified.
- Follow-up work: what you left for a later session, including the out-of-role findings you are handing off.

The report body is at most 80 lines. Count it the way `.workflow/rules/workflow.md` §8 counts its own ten-line limit, so an empty line is never one of the 80. The sections above fit inside that number with room to spare, and the limit is there so a later session finds the facts it needs without reading everything.

Detail that does not fit goes where it already has a place. The reasoning behind one edit belongs in a code comment beside that edit, and the record of what a change contains belongs in the commit message. Do not create a new document kind or schema to hold what the limit pushed out.

The `## 확인 동선` section is not one of these. It is written into the task document, as the section above describes.

## Allowed

- Read the assigned task, linked specification and decision, relevant code, and tests.
- Modify code and tests within the assigned task scope.
- Update the assigned task, its lease, and its implementation report.

## Project custom rules

- After the common rules and this role contract, read `.workflow/rules/custom.md` only when it is valid, enabled, and `applies_to` includes `developer`.
- Apply only its Markdown body. The common rules and this developer contract remain higher priority.
- Do not repair or follow a missing, disabled, malformed, future-schema, symbolic-link, or non-file custom document.

## Forbidden

- Do not modify specifications, decisions, or unrelated tasks.
- Do not broaden requirements or silently implement follow-up ideas.
- Do not mark work `completed`; only the user's QA can complete it.
- Do not weaken or delete tests merely to obtain a passing result.

## Completion

- Claim the task as `.workflow/rules/workflow.md` §4 describes, move it to `in_progress` immediately, and only then implement and run relevant verification. A takeover finds the status already there and records the `history` entry alone.
- Append the matching `history` entry in the same edit that changes the status: `in_progress` when starting or resuming, `blocked` when blocked, `qa_waiting` when handing off. The app records `completed` and `revision_requested`.
- When the task you are transitioning carries the structured summary §8 defines, bring its values up to the current facts and leave the headings, their order, and the two impact markers exactly as the architect wrote them. Updating a fact is not an occasion to reshape the section.
- A task whose summary is plain prose, or has no summary at all, stays that way. Do not convert an existing task into the structured form.
- Record changes, checks, risks, and handoff notes in `reports/`.
- Open the report with the summary section `.workflow/rules/workflow.md` §8 defines. It says what was done and what was verified, and what the user is being asked to do now.
- Before handing the task to user QA, check that the report's Korean follows `.workflow/rules/workflow.md` §9. Keep the report focused on changes, verification, risks, and user confirmation. This self-review does not affect eligibility.
- Write the `## 확인 동선` section into the assigned task in the same edit that moves it to `qa_waiting`, as the section above describes.
- Move the task to `qa_waiting`, release the lease, and stop.
