import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModules() {
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

const modulePromise = loadModules();

test("knowledge answers keep valid citations and drop invalid ones", async () => {
  const { finalizeAssistantAnswer } = await modulePromise;
  const result = finalizeAssistantAnswer({
    rawText: "这是根据资料得到的结论。[1][4]",
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
        text: "迭代 5 要先实现意图识别器。",
      },
    ],
  });

  assert.match(result.text, /\[1\]/);
  assert.doesNotMatch(result.text, /\[4\]/);
});

test("entity profile answers without evidence always degrade safely", async () => {
  const { finalizeAssistantAnswer } = await modulePromise;
  const result = finalizeAssistantAnswer({
    rawText: "张三是技术负责人。",
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

test("memory answers are normalized to user-facing wording", async () => {
  const { finalizeAssistantAnswer } = await modulePromise;
  const result = finalizeAssistantAnswer({
    rawText: "[M1] the user's preferred language is Chinese.",
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
        text: "I prefer Chinese.",
      },
    ],
  });

  assert.match(result.text, /your preferred language is Chinese/i);
  assert.doesNotMatch(result.text, /\[M1\]/);
});

test("memory answers with comparison note keep final note", async () => {
  const { finalizeAssistantAnswer } = await modulePromise;
  const result = finalizeAssistantAnswer({
    rawText: "You usually prefer concise answers.",
    locale: "en",
    contextPlan: {
      subject: "external",
      memoryOperation: { action: "none" },
      memoryMode: "answer_source",
      knowledgeMode: "none",
      requiresLocalEvidence: false,
      visibleSources: ["memory"],
      shouldCompareWithGeneralKnowledge: true,
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

  assert.match(result.text, /This is based on your saved content\./);
});
