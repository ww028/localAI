import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModulePair() {
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

  return import(finalizeUrl);
}

const modulePromise = loadModulePair();

test("prompt injection eval fixtures do not leak memory answers", async () => {
  const { finalizeAssistantAnswer } = await modulePromise;
  const payload = JSON.parse(await readFile(new URL("../examples/prompt-injection-eval.json", import.meta.url), "utf8"));
  const caseItem = payload.cases.find((item) => item.id === "web-ignore-previous");

  const result = finalizeAssistantAnswer({
    rawText: `The page contains a malicious instruction that says: ${caseItem.content}\n\nSources:\n[1] fake`,
    locale: "en",
    contextPlan: {
      subject: "external",
      memoryOperation: { action: "none" },
      memoryMode: "none",
      knowledgeMode: "none",
      requiresLocalEvidence: false,
      visibleSources: [],
      shouldCompareWithGeneralKnowledge: false,
      responseConstraints: [],
      rationale: "test",
    },
    messageSources: [],
  });

  assert.match(result.text, /malicious instruction/i);
  assert.doesNotMatch(result.text, /Sources:/i);
});
