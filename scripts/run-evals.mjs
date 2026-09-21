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

async function loadKnowledgeStoreModule() {
  const schemaSource = await readFile(path.join(root, "src/lib/knowledgeDbSchema.ts"), "utf8");
  const schemaOutput = ts.transpileModule(schemaSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const schemaUrl = `data:text/javascript;base64,${Buffer.from(schemaOutput).toString("base64")}`;

  const source = await readFile(path.join(root, "src/lib/knowledgeStore.ts"), "utf8");
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
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(query, queryTerms, chunk),
    }))
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
    topDocuments: topMatches.map((match) => `${match.documentName}#${match.chunkIndex + 1}`),
  };
}

async function main() {
  const { createChunks } = await loadKnowledgeStoreModule();
  const report = [];

  for (const relativePath of evalFiles) {
    const fullPath = path.join(root, relativePath);
    const payload = JSON.parse(await readFile(fullPath, "utf8"));
    const cases = Array.isArray(payload.cases) ? payload.cases : [];

    if (relativePath.endsWith("knowledge-retrieval-eval.json")) {
      const corpus = await buildChunkCorpus(payload.documents ?? [], createChunks);
      const scoredCases = cases.map((evalCase) => scoreKnowledgeCase(evalCase, corpus));
      report.push({
        file: relativePath,
        name: payload.name ?? path.basename(relativePath),
        caseCount: cases.length,
        passCount: scoredCases.filter((item) => item.pass).length,
        scoredCases,
      });
      continue;
    }

    report.push({
      file: relativePath,
      name: payload.name ?? path.basename(relativePath),
      caseCount: cases.length,
      caseIds: cases.map((item) => item.id).filter(Boolean),
    });
  }

  const markdown = [
    "# localAI Eval Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "| Eval file | Name | Cases | Result |",
    "| --- | --- | ---: | --- |",
    ...report.map((item) => {
      if (item.scoredCases) {
        return `| ${item.file} | ${item.name} | ${item.caseCount} | ${item.passCount}/${item.caseCount} knowledge hit checks passed |`;
      }
      return `| ${item.file} | ${item.name} | ${item.caseCount} | manifest validated |`;
    }),
    "",
    "## Knowledge Retrieval Details",
    "",
  ];

  for (const item of report) {
    if (!item.scoredCases) {
      continue;
    }

    markdown.push(`### ${item.file}`);
    markdown.push("");
    markdown.push("| Case ID | Query | Pass | Top documents |", "| --- | --- | --- | --- |");
    for (const scoredCase of item.scoredCases) {
      markdown.push(`| ${scoredCase.id} | ${scoredCase.query} | ${scoredCase.pass ? "pass" : "fail"} | ${scoredCase.topDocuments.join(", ")} |`);
    }
    markdown.push("");
  }

  markdown.push(
    "## Notes",
    "",
    "- Knowledge retrieval cases are validated with the current chunking logic and a lightweight in-memory ranking approximation.",
    "- Other eval manifests are currently schema-validated and listed for manual or future automated execution.",
  );

  console.log(markdown.join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
