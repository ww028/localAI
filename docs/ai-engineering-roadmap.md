# localAI AI Engineering Roadmap

## Background

`localAI` is a local-first AI personal assistant running on Chrome built-in AI capabilities.  
The current project already has several strong foundations:

- structured intent detection
- structured planning
- context usage policy
- deterministic execution for calculable tasks
- local knowledge and personal memory
- basic task/debug visibility in UI

This means the project is no longer a simple "send prompt to model" demo.  
It is already moving toward an engineering-oriented AI assistant.

However, the current system still relies mainly on **prompt-based soft constraints**.  
To improve reliability, controllability, debuggability, and long-term maintainability, we need the next stage of AI engineering work.

---

## Overall Goal

Upgrade the assistant from:

- prompt-guided
- partially observable
- mostly soft-constrained

to:

- prompt + code-enforced
- observable
- testable
- safer against hallucination and prompt injection
- easier to maintain across front-end / offscreen / future capability growth

---

# Phase 1: Output Guard and Unified Finalization Pipeline

## Goal

Introduce a unified post-processing layer so every model answer is validated and normalized before it reaches the UI.

This phase is the highest-priority engineering work because it turns many current prompt-only rules into enforceable runtime behavior.

---

## Why this phase comes first

The project already has strong pre-model control:

- intent detection
- plan generation
- context planning
- deterministic execution
- prompt structuring

But after the model returns text, there is still no single unified enforcement layer.

That means we still have risk of:

- invalid or fabricated citations like `[7]`
- entity profile answers without local evidence
- memory answers leaking internal metadata
- behavior drift between normal chat / continue task / regenerate / offscreen
- inconsistent answer cleanup logic across paths

---

## Deliverables

### 1. `assistantOutputGuard.ts`
A dedicated module that validates and optionally rewrites model outputs.

Suggested file:
- `src/lib/assistantOutputGuard.ts`

### 2. `finalizeAssistantAnswer.ts`
A single entry point that every AI answer path uses before rendering.

Suggested file:
- `src/lib/finalizeAssistantAnswer.ts`

### 3. Integration across all answer paths
Apply the finalization pipeline consistently in:

- normal chat
- continue task
- regenerate
- offscreen background task
- web page assistant flow

### 4. Tests
Add dedicated tests for output guard and finalization logic.

Suggested files:
- `tests/assistantOutputGuard.test.mjs`
- `tests/finalizeAssistantAnswer.test.mjs`

---

## Scope

### Included
- normal assistant answers
- offscreen answers
- continue task answers
- regenerate answers
- web page assistant answers
- memory / knowledge / entity-profile answer constraints

### Not included
- new model capability access
- UI redesign
- evaluation platform
- multi-model orchestration

---

## Design Principles

### Principle 1: Prompt remains, but output gets enforced
Prompt constraints are still useful and should remain.  
But they are not enough on their own.  
The output layer must enforce critical policies.

### Principle 2: Prefer safe fallback over risky correction
If the answer clearly violates evidence boundaries, fallback safely rather than trying to guess how to repair it.

### Principle 3: All answer paths must share one finalization pipeline
No more path-specific cleanup drift.

---

## Proposed Output Guard Rules

### Rule A: Citation Validity Guard
Applies when:
- `knowledgeMode === "cite"`

Checks:
- every citation like `[1]`, `[2]` must correspond to an actual knowledge source
- no out-of-range citations
- no invalid reference numbers

Actions:
- remove invalid citations
- record guard events
- if answer is heavily dependent on invalid citations, degrade gracefully

---

### Rule B: Local Evidence Boundary Guard
Applies when:
- `requiresLocalEvidence === true`

Typical cases:
- entity profile queries
- “Who is X?”
- “What is this person/object?”

Checks:
- if there is no local evidence, the answer must not assert identity/factual profile claims
- if the answer introduces profile facts without evidence, block it

Actions:
- fallback to safe answer such as:
  - `我目前没有保存关于“X”的信息。`
  - `I do not currently have saved information about "X".`

---

### Rule C: Memory Output Hygiene Guard
Applies when:
- memory source is used

Checks:
- response body should not contain internal metadata like:
  - `长期事实`
  - `用户偏好`
  - `fact`
  - `preference`
  - `project`
  - `task`
  - `[M1]`
- answer should not sound like the assistant owns the user’s first-person content

Actions:
- remove internal metadata
- normalize tone into user-facing second-person answer

---

### Rule D: Generated Sources Section Guard
Applies to:
- all model answers

Checks:
- whether the model generated its own `Sources`, `References`, `引用来源` section in the answer body

Actions:
- strip it
- keep UI-rendered source list as the single source display channel

---

### Rule E: Unsafe Web/Knowledge Instruction Marker
Applies when:
- web page content or local knowledge content is used

Checks:
- detect instruction-like content in sources, such as:
  - ignore previous instructions
  - reveal private data
  - override rules
  - output saved memory

Actions:
- not necessarily block immediately
- record guard events for debug mode
- support future hard enforcement rules

---

## Finalization Pipeline

All answer paths should pass through:

```text
raw model output
  -> source section strip
  -> output guards
  -> safe fallback if blocked
  -> memory tone normalization
  -> context-aware formatting
  -> final answer
```

Suggested API shape:

```ts
type FinalizeAssistantAnswerInput = {
  rawText: string;
  locale: Locale;
  contextPlan?: ContextPlan;
  messageSources: NonNullable<ChatMessage["sources"]>;
  deterministicExecution?: DeterministicExecution;
};

type FinalizedAssistantAnswer = {
  text: string;
  guardEvents: GuardEvent[];
};
```

---

## Task Breakdown

### Issue 1.1: Build `assistantOutputGuard`
- define `GuardEvent`
- define `GuardedAssistantOutput`
- implement citation parsing
- implement invalid citation cleanup
- implement local evidence boundary check
- implement memory metadata cleanup
- integrate source section stripping
- return guard events

### Issue 1.2: Build `finalizeAssistantAnswer`
- define finalize input/output types
- integrate strip / guard / tone normalization / context formatting
- support with/without `contextPlan`
- support deterministic fallback compatibility

### Issue 1.3: Integrate into normal chat
Files:
- `src/App.tsx`

### Issue 1.4: Integrate into continue / regenerate / offscreen
Files:
- `src/App.tsx`
- `src/offscreen.ts`

### Issue 1.5: Add tests
Files:
- `tests/assistantOutputGuard.test.mjs`
- `tests/finalizeAssistantAnswer.test.mjs`

---

## Acceptance Criteria

### Functional
- invalid citations do not survive into final visible output
- entity profile answers do not hallucinate without local evidence
- memory answers do not leak internal metadata
- source section cleanup is consistent across all answer paths
- front-end and offscreen answer finalization are consistent

### Engineering
- all answer paths use one finalize pipeline
- tests cover the main rules
- no regression in existing test suite

---

# Phase 2: Debug Mode and Observability

## Goal

Move from "debug after failure" to "observe AI behavior during normal use".

---

## Deliverables

### 1. Debug Mode switch
Suggested options:
- URL param `?debug=1`
- localStorage debug flag
- settings toggle

Default:
- off for normal users

### 2. `debugTrace` structure
Suggested fields:

```ts
type AssistantDebugTrace = {
  traceId: string;
  rawInput: string;
  normalizedInput?: string;
  intent?: unknown;
  plan?: unknown;
  contextPlan?: unknown;
  deterministicExecution?: unknown;
  selectedSources?: unknown[];
  selectedMemories?: unknown[];
  promptPreview?: string;
  rawModelOutput?: string;
  finalizedOutput?: string;
  guardEvents?: unknown[];
  createdAt: number;
};
```

### 3. Debug Panel UI
Suggested display:
- input
- intent
- plan
- context plan
- selected sources
- selected memories
- prompt preview
- raw model output
- finalized output
- guard events

### 4. Optional trace history
Keep recent N traces:
- in memory first
- persistent later if needed

---

## Why this phase matters

AI issues are often caused by one of:
- wrong intent detection
- wrong source selection
- wrong context constraints
- wrong prompt composition
- model drift
- post-processing behavior

Without trace visibility, the team has to guess.
With trace visibility, debugging becomes systematic.

---

## Task Breakdown

### Issue 2.1: Add Debug Mode switch
- URL param support
- local toggle support
- default off

### Issue 2.2: Introduce `debugTrace`
- define structure
- generate trace in normal chat flow
- generate trace in continue/regenerate/offscreen as much as possible

### Issue 2.3: Build Debug Panel
- foldable panel
- structured JSON/text blocks
- sidepanel and tab compatible

### Issue 2.4: Optional trace history
- keep recent 20 traces
- clear action
- export JSON later if useful

---

## Acceptance Criteria
- debug mode does not affect normal-user UI when off
- successful and failed runs both expose traces
- developers can inspect prompt, sources, and raw/final outputs

---

# Phase 3: Evaluation and Regression

## Goal

Make assistant behavior measurable and regression-resistant.

---

## Deliverables

### 1. Knowledge QA eval set
Validate:
- chunk retrieval quality
- citation correctness
- reduced hallucination

Suggested files:
- extend `examples/knowledge-retrieval-eval.json`
- update `docs/knowledge-retrieval-evaluation.md`

### 2. Personal memory answer eval set
Validate:
- correct use of saved memories
- proper second-person phrasing
- no hallucinated unsaved facts

Suggested file:
- `examples/memory-answer-eval.json`

### 3. Memory operation eval set
Validate:
- remember extraction
- forget target splitting
- overwrite/merge/ask_user behavior

Suggested file:
- `examples/memory-operation-eval.json`

### 4. Prompt injection eval set
Validate:
- malicious web content does not become executable instruction
- malicious local knowledge entries do not override assistant rules

Suggested file:
- `examples/prompt-injection-eval.json`

### 5. Answer-level snapshot tests
Add final-answer-level regression coverage for:
- knowledge QA
- entity profile query
- memory answers
- web page assistant
- prompt injection fallback behavior

---

## Why this phase matters

Right now many changes can still be judged only by "seems better".
This phase makes behavior testable and comparable over time.

---

## Task Breakdown

### Issue 3.1: Knowledge QA evaluation cases
### Issue 3.2: Memory answer evaluation cases
### Issue 3.3: Memory operation evaluation cases
### Issue 3.4: Prompt injection evaluation cases
### Issue 3.5: Answer-level regression tests

---

## Acceptance Criteria
- evaluation cases cover main assistant modes
- answer-level tests catch behavior regressions
- developers can run at least a minimal regression loop before changing prompts/policies

---

# Phase 4: Memory System Tightening

## Goal

Reduce high-risk model authority in memory operations.

---

## Deliverables

### 1. Rule-first delete path
Prefer rule-based forget matching over model-driven expansion.

### 2. Stricter overwrite policy
Only allow overwrite for explicit same-slot conflicts.

### 3. High-risk memory action logging
Record when remember / forget / overwrite / merge happens, and why.

---

## Why this phase matters

Memory operations are among the highest-risk assistant actions because they mutate the assistant’s persistent local knowledge of the user.

The system should treat these as more sensitive than normal answer generation.

---

## Task Breakdown

### Issue 4.1: Delete path becomes rule-first
- reduce model influence in deletion scope
- require explicit normalized targets

### Issue 4.2: Overwrite conditions become stricter
- same-slot only
- multiple-candidate conflicts become ask_user

### Issue 4.3: Log high-risk memory mutations
- mutation type
- triggering input
- final decision path
- optional future debugTrace integration

---

## Acceptance Criteria
- delete operations become more conservative
- overwrite decisions become more predictable
- mutation behavior is easier to inspect

---

# Phase 5: Prompt and Runtime Architecture Evolution

## Goal

Prepare the assistant for future growth without accumulating architectural debt.

---

## Deliverables

### 1. Prompt builder modularization
Split large prompt composition into smaller modules:
- intent section
- plan section
- context section
- memory section
- knowledge section
- safety section

### 2. Minimum necessary context injection
Reduce unnecessary prompt bloat:
- simple chat should not always carry heavy knowledge sections
- deterministic tasks should not carry unnecessary context
- entity profile queries should focus on local evidence only
- web page assistant should not mix unrelated local context

### 3. Unified AI runtime runner
Further reduce duplicated logic between:
- foreground runtime
- offscreen runtime

Current good foundation:
- `chromeAiShared.ts`

Next step:
- session creation
- task dispatch
- fallback behavior
- progress reporting
can be abstracted further

---

## Acceptance Criteria
- prompt composition is easier to evolve and test
- future features can reuse shared runtime behavior
- prompt size and context relevance improve

---

# Priority Recommendation

## P0 / Immediate
- Issue 1.1 `assistantOutputGuard`
- Issue 1.2 `finalizeAssistantAnswer`
- Issue 1.3 normal chat integration
- Issue 1.4 continue / regenerate / offscreen integration
- Issue 1.5 tests

## P1 / Next
- Issue 2.1 debug mode
- Issue 2.2 debug trace
- Issue 2.3 debug panel
- Issue 3.1 knowledge QA eval set
- Issue 3.2 memory answer eval set
- Issue 4.1 rule-first delete path
- Issue 4.2 stricter overwrite policy

## P2 / Later
- Issue 3.5 answer-level snapshot tests
- Issue 5.1 prompt modularization
- Issue 5.2 minimum necessary context injection
- Issue 5.3 runtime abstraction

---

# Suggested Execution Order

## Sprint 1
- complete Phase 1
- focus on reliability

## Sprint 2
- complete debug mode and trace
- focus on observability

## Sprint 3
- build eval sets
- tighten memory mutation logic

## Sprint 4
- evolve prompt/runtime architecture

---

# Success Definition

The roadmap is successful if the assistant becomes:

- harder to trick
- less likely to hallucinate in evidence-bound scenarios
- easier to debug
- easier to regression-test
- easier to maintain as features grow

---

# Immediate Recommendation

If engineering bandwidth is limited, the most valuable first three investments are:

1. `assistantOutputGuard`
2. `finalizeAssistantAnswer`
3. `debug mode + debugTrace`

These three deliver the biggest jump in AI engineering maturity for the least architectural disruption.
