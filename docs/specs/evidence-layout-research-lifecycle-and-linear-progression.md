# Evidence layout, research lifecycle, and linear progression

> Status: implemented; automated verification passed on 2026-09-03
> Parent design: [product design v0.19](../scifork-product-design.md) and
> [software architecture v0.20](../scifork-software-architecture.md)
> Refines: [literature-grounded research expansion](progressive-research-expansion.md)

## Problem

Visible Evidence Assertions currently share a Dagre rank with other incoming
claim nodes, so Evidence can appear beside rather than immediately upstream of
the claim it supports or contradicts. The `Research & Expand` action reports only
submission acknowledgement and remains labelled `Started` or `Queued`, without
representing the corresponding Session's running lifecycle. Progressive Research
also permits a branching frontier without defining the single continuation path
expected for depth-oriented investigation.

## Goals and non-goals

Goals:

1. Give visible Evidence its own upstream layout layer immediately before its
   referenced claim: one column in LR layout and one row in TB layout.
2. Keep `Research & Expand` disabled with an indeterminate spinner from submit
   until the originating Session becomes idle again, then restore the action.
3. Make a Progressive Research Run reuse the same bounded one-layer expansion as
   the button while selecting exactly one newly retained Hypothesis to continue
   at the next level.

Non-goals:

- Do not change Evidence, scientific Edge, or Framing Link direction or storage.
- Do not reserve an empty Evidence layer while Evidence is hidden.
- Do not add a backend, persisted run state, per-turn identifier, cancellation,
  background work, or a new DSH dependency.
- Do not make the Companion button recursive or let a Prediction continue a run.
- Do not require human confirmation between progressive levels.

## Behavioral contract

### Evidence layout

Evidence projection remains `Evidence -> Node`. When at least one Evidence
Assertion is visible, layout assigns each referenced Node an Evidence layer
immediately upstream of that Node. Non-Evidence incoming relationships span that
inserted layer. Consequently an ordinary parent, visible Evidence, and referenced
Node occupy successive LR columns or TB rows. Multiple visible Evidence
Assertions for the same Node share its inserted layer, while no visible Evidence
entity shares its column or row with a non-Evidence entity. Hidden Evidence does
not alter the ordinary graph layout.

This is a presentation constraint only. No synthetic relationship is rendered or
persisted between the ordinary parent and Evidence.

### Research action lifecycle

A real click still submits exactly one Research Expansion Step through the
Page-Key-scoped `setDraft + submit` transaction. From submission until completion,
the button is disabled and displays an indeterminate spinner without `Started`,
`Queued`, `Study`, or other status text.

The pinned DSH contract exposes Session-level `running` but no per-turn completion
event. For this feature, completion therefore means that the originating Session
has been observed running after acceptance and subsequently reports
`running=false`. For an already-running Session, its pre-submit running state
satisfies the observation. The Bridge sends a completion message on the existing
scoped channel, and the Companion returns to idle. A submission or monitoring
failure preserves the existing Retry and Copy recovery behavior.

This is intentionally Session-level: other queued work in the same Session can
delay the button reset.

### Progressive Research Run

Only an explicit request in the current Chat authorizes a Progressive Research
Run. Natural-language requests for `deep research`, `深度研究`, or `深度调研` on
the current, selected, or focused graph entity are explicit requests for this
workflow, as are requests that say progressive, iterative, or multi-round
research. They must not be reduced to a literature report, Evidence enrichment
of the current entity, or a one-level Research Expansion Step, and they do not
require a subsequent Companion click or import confirmation. When the user does
not provide a depth, the model states a finite plan of at least two levels;
ordinary scientific stop conditions may still end the run after the first
level.

Each level executes the same Research Expansion Step as the button and may
retain zero to five qualifying direct Hypothesis or Prediction branches. All
qualifying branches remain saved.

After a level, the model automatically selects exactly one newly retained
Hypothesis that best advances the stated objective and unresolved Evidence Gap.
Only that Hypothesis becomes the next level's current entity. Other Hypotheses
remain terminal side branches for this run, and Predictions are always terminal
side branches. If no new Hypothesis qualifies, the run stops. The model does not
ask for per-level confirmation and reports the chosen continuation and stop
reason. `visited` remains transient duplicate and cycle protection; there is no
branching frontier to persist.

## Constraints and interfaces

- Core and Research Project schemas remain unchanged.
- Companion layout remains deterministic and uses the existing LR/TB breakpoints.
- The existing Page Key, nonce, prompt limits, one-click authorization, Queue
  behavior, and recovery controls remain in force.
- The Bridge observes only its captured originating Session and never changes,
  steers, cancels, or submits another Session.
- Progressive continuation is instruction-level model orchestration in the
  packaged `scifork-research` Skill; it does not add an execution engine.

## Acceptance criteria

- [x] With Evidence visible, a parent, its referenced claim's Evidence, and that
      claim occupy three ordered LR columns and three ordered TB rows.
- [x] With Evidence hidden, no empty Evidence column or row is introduced.
- [x] Research submission and accepted execution show one disabled spinner-only
      action; `Started`, `Queued`, and `Study` are not displayed.
- [x] The action returns to idle only after the originating Session is observed
      running and then idle, including a request queued behind an existing run.
- [x] Existing timeout, unavailable-Session, Retry, Copy, Page Key, and nonce
      behavior remains intact.
- [x] A Progressive Research Run saves all qualifying branches at each level but
      continues through exactly one newly retained Hypothesis chosen by the model.
- [x] Predictions and unselected Hypotheses do not continue, and a level without
      a new Hypothesis terminates the run.
- [x] The Companion button remains one level and never starts Progressive
      Research by itself.
- [x] Natural-language `deep research`, `深度研究`, and `深度调研` requests about
      the current graph selection route directly to a Progressive Research Run,
      rather than Evidence-only enrichment or a one-level step.

## Test plan

- Add graph-layout tests covering the inserted Evidence rank in LR and TB and
  keeping unrelated non-Evidence entities out of that layer; existing
  hidden-Evidence coverage proves the absence of an empty layer.
- Extend the existing channel and Bridge tests with one accepted-running-to-idle
  lifecycle case and the completion wire shape.
- Adjust the existing Companion render assertion for the disabled spinner-only
  state without adding browser combinations.
- Extend the existing Skill content test with the single-continuation Hypothesis
  rules. Run focused tests, then `pnpm check` and `git diff --check`.
