import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModules() {
  const contextPlanSource = await readFile(new URL("../src/lib/assistantContextPlan.ts", import.meta.url), "utf8");
  const contextPlanOutput = ts.transpileModule(contextPlanSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const contextPlanUrl = `data:text/javascript;base64,${Buffer.from(contextPlanOutput).toString("base64")}`;

  const guardSource = await readFile(new URL("../src/lib/assistantOutputGuard.ts", import.meta.url), "utf8");
  const guardOutput = ts.transpileModule(guardSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const guardUrl = `data:text/javascript;base64,${Buffer.from(guardOutput).toString("base64")}`;

  const finalizeSource = await readFile(new URL("../src/lib/finalizeAssistantAnswer.ts", import.meta.url), "utf8");
  const finalizePatched = finalizeSource.replace('./assistantOutputGuard', guardUrl);
  const finalizeOutput = ts.transpileModule(finalizePatched, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const finalizeUrl = `data:text/javascript;base64,${Buffer.from(finalizeOutput).toString("base64")}`;

  return {
    contextPlan: await import(contextPlanUrl),
    finalize: await import(finalizeUrl),
  };
}

const modulePromise = loadModules();

function normalizeText(text) {
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(text) {
  const lower = normalizeText(text);
  const asciiTerms = lower.match(/[a-z0-9_]{2,}/g) ?? [];
  const cjkTerms = lower.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  const cjkBigrams = cjkTerms.flatMap((term) =>
    Array.from({ length: Math.max(term.length - 1, 0) }, (_, index) => term.slice(index, index + 2)),
  );
  return [...new Set([...asciiTerms, ...cjkTerms, ...cjkBigrams])];
}

test("memory answer eval fixtures produce expected finalized answers", async () => {
  const { contextPlan, finalize } = await modulePromise;
  const payload = JSON.parse(await readFile(new URL("../examples/memory-answer-eval.json", import.meta.url), "utf8"));

  for (const evalCase of payload.cases) {
    const memories = (evalCase.memoryFixtures ?? []).map((content, index) => ({
      id: `memory-${index + 1}`,
      type: "fact",
      content,
      keywords: tokenize(content),
      createdAt: 1,
      updatedAt: 1,
    }));
    const plan = contextPlan.createContextPlan({
      question: evalCase.query,
      locale: "zh",
      intent: {
        type: "chat",
        confidence: 0.5,
        executionMode: "answer",
        requiredTools: ["language-model"],
        entities: {},
        rationale: "eval",
      },
      sources: [],
      memories,
      sourceMemories: memories,
    });

    const rawText = evalCase.memoryFixtures?.length ? evalCase.memoryFixtures.join("\n") : `${evalCase.query} 的信息暂缺。`;
    const messageSources = (evalCase.memoryFixtures ?? []).map((content, index) => ({
      sourceType: "memory",
      sourceLabel: `[M${index + 1}]`,
      documentName: "Memories",
      chunkIndex: index,
      text: content,
    }));

    const result = finalize.finalizeAssistantAnswer({
      rawText,
      locale: "zh",
      contextPlan: plan,
      messageSources,
    });
    const normalized = normalizeText(result.text);

    for (const expected of evalCase.expectedOutputIncludes ?? []) {
      assert.ok(normalized.includes(normalizeText(expected)), `${evalCase.id} should include: ${expected}`);
    }
    for (const forbidden of evalCase.expectedOutputExcludes ?? []) {
      assert.ok(!normalized.includes(normalizeText(forbidden)), `${evalCase.id} should exclude: ${forbidden}`);
    }
  }
});
