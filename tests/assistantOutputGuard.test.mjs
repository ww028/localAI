import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModule() {
  const source = await readFile(new URL("../src/lib/assistantOutputGuard.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  return import(dataUrl);
}

const modulePromise = loadModule();

test("runAssistantOutputGuard removes invalid citations", async () => {
  const { runAssistantOutputGuard } = await modulePromise;
  const result = runAssistantOutputGuard({
    text: "根据资料，这是下一步。[1][7]",
    locale: "zh",
    contextPlan: {
      subject: "external",
      memoryOperation: { action: "none" },
      memoryMode: "none",
      knowledgeMode: "cite",
      requiresLocalEvidence: false,
      visibleSources: ["knowledge"],
      shouldCompareWithGeneralKnowledge: false,
      responseConstraints: [],
      rationale: "test",
    },
    messageSources: [
      {
        sourceType: "knowledge",
        sourceLabel: "[1]",
        documentName: "roadmap.md",
        chunkIndex: 0,
        text: "...",
      },
    ],
  });

  assert.match(result.text, /\[1\]/);
  assert.doesNotMatch(result.text, /\[7\]/);
  assert.equal(result.blocked, false);
});

test("runAssistantOutputGuard blocks entity answers without local evidence", async () => {
  const { runAssistantOutputGuard } = await modulePromise;
  const result = runAssistantOutputGuard({
    text: "张三是项目负责人。",
    locale: "zh",
    contextPlan: {
      subject: "entity_profile_query",
      targetEntity: "张三",
      memoryOperation: { action: "none" },
      memoryMode: "none",
      knowledgeMode: "none",
      requiresLocalEvidence: true,
      visibleSources: [],
      shouldCompareWithGeneralKnowledge: false,
      responseConstraints: [],
      rationale: "test",
    },
    messageSources: [],
  });

  assert.equal(result.blocked, true);
  assert.equal(result.fallbackReason, "missing_local_evidence");
});
