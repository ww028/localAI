# localAI AI Engineering Changelog

## Summary

This changelog summarizes the AI engineering upgrades that were added after the initial localAI Chrome Built-in AI assistant prototype.

The goal of these changes was to move the project from a prompt-driven assistant prototype toward a more engineering-oriented assistant with:

- stronger answer guardrails
- unified answer finalization
- richer task-level observability
- executable evaluation baselines
- automated regression protection

---

## 1. AI runtime and architecture upgrades

### Offscreen runtime migrated into source-managed TypeScript
The old static `public/offscreen.js` flow was migrated into a source-managed runtime:

- `src/offscreen.ts`
- `offscreen.html`
- Vite multi-entry build via `vite.config.ts`

This removed the previous drift risk between foreground and background execution logic and made offscreen code part of the normal typed build flow.

### Shared Chrome AI helper layer introduced
A shared module was added:

- `src/lib/chromeAiShared.ts`

This centralizes reusable logic such as:

- prompt option candidates
- summarize / translate / rewrite option candidates
- translation direction detection
- fallback prompt generation

This reduces duplication between:

- `src/lib/chromeAi.ts`
- `src/offscreen.ts`

---

## 2. Knowledge system upgrades

### Knowledge search moved toward inverted-index retrieval
The knowledge store now maintains an additional term index layer inside IndexedDB.

Related files:

- `src/lib/knowledgeStore.ts`
- `src/lib/knowledgeDbSchema.ts`

Key improvements:

- knowledge DB schema centralized into a shared schema module
- `termIndex` store introduced
- retrieval now uses indexed candidate collection before rerank
- chunk import, rebuild, delete, and clear all keep term index in sync

### Large file protection and progress reporting added
Knowledge import now supports:

- max file size limit (`5MB`)
- per-file / per-chunk progress callbacks
- better UX feedback during import and save-to-knowledge flows

This reduces UI freezing and improves import transparency.

### Chunking robustness improved
Chunk splitting now handles:

- oversized paragraphs
- no-natural-boundary text
- sentence-level split before sliding-window fallback

This improves retrieval quality and avoids giant chunks.

---

## 3. Backup and restore safety upgrades

### Backup import now has rollback protection
The IndexedDB import flow was upgraded so that before applying new backup data it first snapshots the current local data.

If import fails:

- it attempts to restore the previous snapshot
- if rollback fails, it throws a stronger explicit error message

Related file:

- `src/lib/indexedDbBackup.ts`

### Backup schema now tracks knowledge term index too
The backup layer was updated to understand the newer knowledge DB structure, including:

- `documents`
- `chunks`
- `spaces`
- `termIndex`

This keeps restore behavior aligned with runtime knowledge storage.

---

## 4. Output guard and answer finalization layer

### Unified output guard introduced
A new module was added:

- `src/lib/assistantOutputGuard.ts`

Current implemented guard rules include:

- generated `Sources` / `References` section stripping
- invalid citation removal
- local-evidence-required answer blocking
- memory metadata cleanup

### Unified answer finalizer introduced
A new module was added:

- `src/lib/finalizeAssistantAnswer.ts`

This centralizes the final answer pipeline:

```text
raw model output
  -> source section strip
  -> output guards
  -> safe fallback if blocked
  -> memory tone normalization
  -> context-aware formatting
  -> final answer
```

This means model output is no longer finalized differently depending on which execution path produced it.

### Finalization is now shared across main answer paths
The unified finalization flow is now used by:

- normal chat
- regenerate
- continue task
- offscreen background answer
- web page assistant
- text-action flows

This significantly reduces behavioral drift between paths.

---

## 5. Task-state observability and debug improvements

### Task state now stores AI guard and trace fields
`StoredTaskState` was extended with:

- `contextPlan`
- `guardEvents`
- `traceId`
- `rawModelOutput`
- `finalizedOutput`

Related file:

- `src/lib/conversationStore.ts`

### Debug mode added
A debug mode flag was introduced and persisted locally.

The settings popover now exposes a debug toggle that enables richer task-level introspection.

### Task card now exposes AI debug information
The task details UI can now show:

- plan
- deterministic execution details
- output guard events
- trace ID
- prompt preview
- selected sources
- selected memories
- context plan
- raw model output
- finalized output

This gives the project a usable developer-facing observability layer for AI behavior.

---

## 6. Evaluation baselines and regression coverage

### New evaluation baseline manifests added
The project now contains multiple evaluation datasets:

- `examples/knowledge-retrieval-eval.json`
- `examples/memory-answer-eval.json`
- `examples/memory-operation-eval.json`
- `examples/prompt-injection-eval.json`

These baselines cover:

- retrieval relevance
- memory answer quality
- memory operation parsing
- prompt injection handling expectations

### Eval runner added
A minimal eval runner was added:

- `scripts/run-evals.mjs`
- script: `npm run eval`

Current capabilities:

- knowledge retrieval baseline checks using chunked in-memory approximation
- memory answer eval execution
- memory operation eval execution
- prompt injection eval execution
- markdown summary report output

### Eval runner is now test-covered
A dedicated test ensures the eval command itself remains usable:

- `tests/evalRunner.test.mjs`

---

## 7. Regression test coverage expanded

### New answer-level regression tests
Added:

- `tests/assistantAnswerRegression.test.mjs`

Coverage includes:

- valid citation kept, invalid citation removed
- entity-profile fallback when no local evidence exists
- memory answer tone normalization
- memory comparison note preservation

### New output-guard tests
Added:

- `tests/assistantOutputGuard.test.mjs`

### New finalize tests
Added:

- `tests/finalizeAssistantAnswer.test.mjs`

### New eval-related tests
Added:

- `tests/memoryOperationEval.test.mjs`
- `tests/promptInjectionEval.test.mjs`
- `tests/evalRunner.test.mjs`

This means regression protection now exists at multiple levels:

- low-level deterministic utilities
- memory logic
- prompt building
- output guards
- final answer behavior
- eval infrastructure

---

## 8. Documentation updates

### New roadmap document added
Added:

- `docs/ai-engineering-roadmap.md`

This documents the staged AI engineering direction for the project.

### Knowledge evaluation doc expanded
Updated:

- `docs/knowledge-retrieval-evaluation.md`

It now explains both the original knowledge retrieval baseline and the expanded evaluation direction.

### README updated
README now includes:

- evaluation files
- `npm run eval`
- roadmap entry
- clearer developer references

---

## Current Engineering State

After these changes, localAI now has a meaningful AI engineering foundation with three major layers:

### 1. Control layer
- intent detection
- plan generation
- deterministic execution
- context usage planning
- output guardrails

### 2. Debug layer
- task-level AI details
- debug mode
- trace ID
- raw / finalized output visibility
- source / memory / context observability

### 3. Regression layer
- eval manifests
- runnable eval script
- answer-level regression tests
- output guard tests
- eval-runner tests

This is a significant upgrade over a plain prompt-driven assistant architecture.

---

## Suggested Next Steps

The next most valuable directions are:

1. Make the eval runner closer to real extension-runtime behavior.
2. Introduce a dedicated `AssistantDebugTrace` object instead of reusing task state fields only.
3. Add trace history and export.
4. Expand prompt-injection evaluation beyond minimal regression checks.
5. Add richer answer-level regression fixtures tied to evaluation manifests.

---

## Validation Status

At the time of writing, the project passes:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run eval`
