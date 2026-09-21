import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModulePair() {
  const schemaSource = await readFile(new URL("../src/lib/knowledgeDbSchema.ts", import.meta.url), "utf8");
  const schemaOutput = ts.transpileModule(schemaSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const schemaUrl = `data:text/javascript;base64,${Buffer.from(schemaOutput).toString("base64")}`;

  const source = await readFile(new URL("../src/lib/knowledgeStore.ts", import.meta.url), "utf8");
  const patchedSource = source.replace('./knowledgeDbSchema', schemaUrl);
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

test("createChunks splits paragraphs without natural boundaries", async () => {
  const { createChunks } = await modulePromise;
  const chunks = createChunks("a".repeat(2500));

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 900));
});

test("createChunks splits oversized sentence groups", async () => {
  const { createChunks } = await modulePromise;
  const sentence = "这是一个很长的句子。";
  const chunks = createChunks(sentence.repeat(120));

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 900));
});
