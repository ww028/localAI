import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const evalFiles = [
  "examples/knowledge-retrieval-eval.json",
  "examples/memory-answer-eval.json",
  "examples/memory-operation-eval.json",
  "examples/prompt-injection-eval.json",
];

function transpileToDataUrl(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

async function loadKnowledgeStoreModule() {
  const schemaSource = await readFile(path.join(root, "src/lib/knowledgeDbSchema.ts"), "utf8");
  const schemaUrl = transpileToDataUrl(schemaSource);
  const source = await readFile(path.join(root, "src/lib/knowledgeStore.ts"), "utf8");
  const patchedSource = source.replace('./knowledgeDbSchema', schemaUrl);
  return import(transpileToDataUrl(patchedSource));
}

async function loadContextPlanModule() {
  const source = await readFile(path.join(root, "src/lib/assistantContextPlan.ts"), "utf8");
  return import(transpileToDataUrl(source));
}

async function loadFinalizeModule() {
  const guardSource = await readFile(path.join(root, "src/lib/assistantOutputGuard.ts"), "utf8");
  const guardUrl = transpileToDataUrl(guardSource);
  const finalizeSource = await readFile(path.join(root, "src/lib/finalizeAssistantAnswer.ts"), "utf8");
  const patchedSource = finalizeSource.replace('./assistantOutputGuard', guardUrl);
  return import(transpileToDataUrl(patchedSource));
}

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

async function buildChunkCorpus(documents, createChunks) {
  const corpus = [];
  for (const document of documents) {
    const fullPath = path.join(root, document.path);
    const content = await readFile(fullPath, "utf8");
    const chunks = createChunks(content);
    chunks.forEach((chunk, index) => {
      corpus.push({
        documentName: document.name ?? path.basename(document.path),
        chunkIndex: index,
        text: chunk,
        terms: tokenize(chunk),
      });
    });
  }
  return corpus;
}

function scoreChunk(query, queryTerms, chunk) {
  const normalizedChunk = normalizeText(chunk.text);
  const chunkTerms = new Set(chunk.terms);
  const keywordScore = queryTerms.reduce((sum, term) => sum + (chunkTerms.has(term) ? Math.min(term.length, 8) : 0), 0);
  const phraseScore = normalizedChunk.includes(normalizeText(query)) ? 10 : 0;
  const densityScore = queryTerms.length
    ? queryTerms.reduce((count, term) => count + (normalizedChunk.includes(term) ? 1 : 0), 0) / queryTerms.length
    : 0;
  return keywordScore + phraseScore + densityScore;
}

function searchKnowledgeInMemory(query, corpus, limit = 3) {
  const queryTerms = tokenize(query);
  return corpus
    .map((chunk) => ({ ...chunk, score: scoreChunk(query, queryTerms, chunk) }))
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score || left.chunkIndex - right.chunkIndex)
    .slice(0, limit);
}

function scoreKnowledgeCase(evalCase, corpus, limit = 3) {
  const topMatches = searchKnowledgeInMemory(evalCase.query, corpus, limit);
  const pass = (evalCase.expectedHits ?? []).every((expectedHit) =>
    topMatches.some((match) =>
      match.documentName === expectedHit.documentName &&
      (expectedHit.mustAppearInSnippet ?? []).every((keyword) => normalizeText(match.text).includes(normalizeText(keyword))),
    ),
  );
  return {
    id: evalCase.id,
    query: evalCase.query,
    pass,
    detail: topMatches.map((match) => `${match.documentName}#${match.chunkIndex + 1}`).join(', '),
  };
}

function buildMemoryFixture(content, index) {
  return {
    id: `memory-${index + 1}`,
    type: 'fact',
    content,
    keywords: tokenize(content),
    createdAt: 1,
    updatedAt: 1,
  };
}

async function scoreMemoryAnswerCase(createContextPlan, finalizeAssistantAnswer, evalCase) {
  const memories = (evalCase.memoryFixtures ?? []).map(buildMemoryFixture);
  const contextPlan = createContextPlan({
    question: evalCase.query,
    locale: 'zh',
    intent: {
      type: 'chat',
      confidence: 0.5,
      executionMode: 'answer',
      requiredTools: ['language-model'],
      entities: {},
      rationale: 'eval',
    },
    sources: [],
    memories,
    sourceMemories: memories,
  });
  const rawText = evalCase.memoryFixtures?.length ? evalCase.memoryFixtures.join('\n') : `${evalCase.query} 的信息暂缺。`;
  const messageSources = (evalCase.memoryFixtures ?? []).map((content, index) => ({
    sourceType: 'memory',
    sourceLabel: `[M${index + 1}]`,
    documentName: 'Memories',
    chunkIndex: index,
    text: content,
  }));
  const finalized = finalizeAssistantAnswer({
    rawText,
    locale: 'zh',
    contextPlan,
    messageSources,
  });
  const normalized = normalizeText(finalized.text);
  const includesPass = (evalCase.expectedOutputIncludes ?? []).every((item) => normalized.includes(normalizeText(item)));
  const excludesPass = (evalCase.expectedOutputExcludes ?? []).every((item) => !normalized.includes(normalizeText(item)));
  return {
    id: evalCase.id,
    query: evalCase.query,
    pass: includesPass && excludesPass,
    detail: finalized.text,
  };
}

async function scoreMemoryOperationCase(createContextPlan, evalCase) {
  const contextPlan = createContextPlan({
    question: evalCase.input,
    locale: 'zh',
    intent: {
      type: 'memory_operation',
      confidence: 0.9,
      executionMode: 'deterministic',
      requiredTools: ['memory-planner', 'memory-store'],
      entities: {},
      rationale: 'eval',
    },
    sources: [],
    memories: [],
  });
  const operation = contextPlan.memoryOperation;
  const expectedPlan = evalCase.expectedPlan ?? {};
  const actionPass = !expectedPlan.action || operation.action === expectedPlan.action;
  const contentPass = !expectedPlan.content || operation.content === expectedPlan.content;
  const targetsPass = !expectedPlan.targets || JSON.stringify(operation.targets) === JSON.stringify(expectedPlan.targets);
  return {
    id: evalCase.id,
    query: evalCase.input,
    pass: actionPass && contentPass && targetsPass,
    detail: JSON.stringify(operation),
  };
}

async function scorePromptInjectionCase(finalizeAssistantAnswer, evalCase) {
  const finalized = finalizeAssistantAnswer({
    rawText: `The page contains a malicious instruction that says: ${evalCase.content}\n\nSources:\n[1] fake`,
    locale: 'en',
    contextPlan: {
      subject: 'external',
      memoryOperation: { action: 'none' },
      memoryMode: 'none',
      knowledgeMode: 'none',
      requiresLocalEvidence: false,
      visibleSources: [],
      shouldCompareWithGeneralKnowledge: false,
      responseConstraints: [],
      rationale: 'eval',
    },
    messageSources: [],
  });
  const normalized = normalizeText(finalized.text);
  const includesPass = (evalCase.expectedOutputIncludes ?? []).every((item) => normalized.includes(normalizeText(item)));
  const excludesPass = (evalCase.expectedOutputExcludes ?? []).every((item) => !normalized.includes(normalizeText(item)));
  return {
    id: evalCase.id,
    query: evalCase.query,
    pass: includesPass && excludesPass,
    detail: finalized.text,
  };
}

async function main() {
  const { createChunks } = await loadKnowledgeStoreModule();
  const { createContextPlan } = await loadContextPlanModule();
  const { finalizeAssistantAnswer } = await loadFinalizeModule();
  const report = [];

  for (const relativePath of evalFiles) {
    const fullPath = path.join(root, relativePath);
    const payload = JSON.parse(await readFile(fullPath, 'utf8'));
    const cases = Array.isArray(payload.cases) ? payload.cases : [];

    if (relativePath.endsWith('knowledge-retrieval-eval.json')) {
      const corpus = await buildChunkCorpus(payload.documents ?? [], createChunks);
      const scoredCases = cases.map((evalCase) => scoreKnowledgeCase(evalCase, corpus));
      report.push({ file: relativePath, name: payload.name ?? path.basename(relativePath), caseCount: cases.length, scoredCases });
      continue;
    }

    if (relativePath.endsWith('memory-answer-eval.json')) {
      const scoredCases = [];
      for (const evalCase of cases) {
        scoredCases.push(await scoreMemoryAnswerCase(createContextPlan, finalizeAssistantAnswer, evalCase));
      }
      report.push({ file: relativePath, name: payload.name ?? path.basename(relativePath), caseCount: cases.length, scoredCases });
      continue;
    }

    if (relativePath.endsWith('memory-operation-eval.json')) {
      const scoredCases = [];
      for (const evalCase of cases) {
        scoredCases.push(await scoreMemoryOperationCase(createContextPlan, evalCase));
      }
      report.push({ file: relativePath, name: payload.name ?? path.basename(relativePath), caseCount: cases.length, scoredCases });
      continue;
    }

    if (relativePath.endsWith('prompt-injection-eval.json')) {
      const scoredCases = [];
      for (const evalCase of cases) {
        scoredCases.push(await scorePromptInjectionCase(finalizeAssistantAnswer, evalCase));
      }
      report.push({ file: relativePath, name: payload.name ?? path.basename(relativePath), caseCount: cases.length, scoredCases });
      continue;
    }
  }

  const markdown = [
    '# localAI Eval Report',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '| Eval file | Name | Cases | Result |',
    '| --- | --- | ---: | --- |',
    ...report.map((item) => `| ${item.file} | ${item.name} | ${item.caseCount} | ${item.scoredCases.filter((caseItem) => caseItem.pass).length}/${item.caseCount} passed |`),
    '',
  ];

  for (const item of report) {
    markdown.push(`## ${item.file}`, '');
    markdown.push('| Case ID | Query | Pass | Detail |', '| --- | --- | --- | --- |');
    for (const scoredCase of item.scoredCases) {
      markdown.push(`| ${scoredCase.id} | ${scoredCase.query} | ${scoredCase.pass ? 'pass' : 'fail'} | ${String(scoredCase.detail).replace(/\n/g, ' ')} |`);
    }
    markdown.push('');
  }

  markdown.push('## Notes', '', '- Eval runner now validates knowledge retrieval, memory answer normalization, memory operation parsing, and prompt injection guard behavior.', '- Retrieval checks still use a lightweight in-memory approximation and can be upgraded later to a browser-runtime runner.');

  console.log(markdown.join('\n'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
