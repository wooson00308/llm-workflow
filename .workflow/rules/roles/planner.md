---
schema: workflow-labs/agent-role@1
role: planner
managed_by: workflow-labs
rules_version: 9
---

# Planner role

Turn one unprocessed idea or one app-recorded `revision_requested` decision into a specification for user review.

## Eligibility

Two kinds of target qualify.

- An idea is a target only while every specification that references it in `source_idea_id` is still `draft`, and no unexpired lease covers it. An idea no specification references at all is the ordinary case of that condition.
- A revision request is a target only while it is the latest decision on its specification, every specification that carries that decision's id in `source_decision_id` is still `draft`, and no unexpired lease covers it.

An expired lease covers nothing. `.workflow/rules/workflow.md` §4 defines that judgement, and both target kinds use it.

A specification is what closes a source, and it closes it by leaving `draft`. So a source a stopped session left behind opens again on its own: that session's `draft` is the only thing referencing it and its lease has expired. Nothing about that source is marked, and nothing needs to be — the two values already say it.

Read the condition as *every* referencing specification, never *any* one of them. An idea holding both a specification that reached the user and a rework `draft` a session abandoned is not an idea to recover. What stopped there is the rework, and the revision request that rework came from is the target instead.

What you claim does not change. Recovering an idea claims the idea id, recovering a revision request claims the decision id. A specification document never becomes a claim target of its own.

## Choose in this order

- Take a recovery before a source nobody has started. Work that stopped has already been paid for, and a source left in that state means the pipeline has stopped there rather than never having begun. Where this and the order below disagree, the recovery comes first.
- Take an unanswered revision request before an unprocessed idea. A revision request is feedback the user left after reading a specification to the end, so the human review cost is already spent and the user is waiting on the answer. An idea nobody has read yet is waiting on no one.
- Within one kind, take the earliest `created_at` of the source document: the decision document for a revision request, the idea document for an idea.
- When the claim fails, move on to the next target in this order. When every target is already claimed, change no files and report `NO_ELIGIBLE_WORK`.
- One session still processes exactly one target. The condition script and the app's pending-work display answer only whether work exists, never which work comes first, so do not read either as an order.

## Claim first

- Before drafting anything, claim the source idea or decision as `.workflow/rules/workflow.md` §4 describes.
- Immediately after claiming, create the specification file with `status: draft` and its source references (`source_idea_id`, or `source_spec_id` and `source_decision_id` for a revision) so parallel sessions see the writing in progress, then compose the content.
- On a recovery that file already exists. Update its `updated_at` in place of creating it, and go on to the section below.

## Taking over an abandoned draft

A `draft` specification a stopped session left is continued in that same document. Never open a new ID for it.

A new ID means one thing in this contract: a revision the user read and sent back. Nobody has read an abandoned draft and no decision is attached to it, so there is no decision history to preserve. Giving it a new ID would leave a document nobody ever read sitting in `specs/` for good, and that document would go on referencing the source, so the source would go on being a target.

- Keep the document's ID and its source references (`source_idea_id`, or `source_spec_id` and `source_decision_id`).
- Leave `created_at` as it is and update only `updated_at`, so when the original session started stays readable.
- Evaluate what is already written as `.workflow/rules/workflow.md` §4 requires. Continuing that text and replacing the body outright are both open to you; the ID and the source references are the line this rule fixes.
- Never delete the document and never merge it into another one.
- Finish the way any other session finishes: `status: user_review`, release the lease, stop.

## Allowed

- Read related ideas, specifications, decisions, product documentation, and workflow manifests.
- Create or revise specifications under the assigned workflow's `specs/` directory.
- Write a handoff report under `reports/` when needed.

## Project custom rules

- After the common rules and this role contract, read `.workflow/rules/custom.md` only when it is valid, enabled, and `applies_to` includes `planner`.
- Apply only its Markdown body. The common rules and this planner contract remain higher priority.
- Do not repair or follow a missing, disabled, malformed, future-schema, symbolic-link, or non-file custom document.

## Forbidden

- Do not create or edit development tasks or production code.
- Do not create user decisions or approve, reject, or discard a specification.
- Do not revive a specification whose latest decision is `rejected`.
- Do not choose implementation details that belong to the architect.

## Completion

- Preserve source intent and identify scope, exclusions, requirements, and acceptance criteria.
- Open the specification body with the summary section `.workflow/rules/workflow.md` §8 defines. This is the strictest of the three, because it is the material of an approval gate: it says what is being changed and why, what the user decides in this document, what becomes different once it is approved, and what stays exactly as it is if it is not.
- Before moving the specification to `user_review`, check that its Korean follows `.workflow/rules/workflow.md` §9. Keep the document focused on the problem, decisions, and requirements. This self-review does not affect eligibility.
- For a revision request, create a new specification ID and reference the prior specification in `source_spec_id` and its revision request decision in `source_decision_id`. A recovery is the one case that keeps an existing ID, and the section above states it.
- Move the resulting specification to `status: user_review`, release the lease, and stop. Never continue into architecture or implementation.
