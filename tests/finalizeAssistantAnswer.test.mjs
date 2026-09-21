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

  const source = await readFile(new URL("../src/lib/finalizeAssistantAnswer.ts", import.meta.url), "utf8");
  const patchedSource = source.replace('./assistantOutputGuard', guardUrl);
  const output = ts.transpileModule(patchedSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  return import(dataUrl);
}

const modulePromise = loadModulePair();

test("finalizeAssistantAnswer falls back for missing local evidence", async () => {
  const { finalizeAssistantAnswer } = await modulePromise;
  const result = finalizeAssistantAnswer({
    rawText: "张三是项目负责人。",
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

  assert.equal(result.text, "我目前没有保存关于“张三”的信息。");
});

test("finalizeAssistantAnswer removes memory metadata", async () => {
  const { finalizeAssistantAnswer } = await modulePromise;
  const result = finalizeAssistantAnswer({
    rawText: "用户偏好：喜欢简洁回答\n[M1] the user's preferred language is Chinese.",
    locale: "en",
    contextPlan: {
      subject: "user_profile_query",
      memoryOperation: { action: "none" },
      memoryMode: "answer_source",
      knowledgeMode: "none",
      requiresLocalEvidence: false,
      visibleSources: ["memory"],
      shouldCompareWithGeneralKnowledge: false,
      responseConstraints: [],
      rationale: "test",
    },
    messageSources: [
      {
        sourceType: "memory",
        sourceLabel: "[M1]",
        documentName: "Memories",
        chunkIndex: 0,
        text: "I prefer concise answers.",
      },
    ],
  });

  assert.doesNotMatch(result.text, /\[M1\]/);
  assert.doesNotMatch(result.text, /preference/i);
});
