export type KnowledgeDocument = {
  id: string;
  name: string;
  type: string;
  size: number;
  embeddingModel: string;
  embeddingDimensions: number;
  createdAt: number;
};

export type KnowledgeChunk = {
  id: string;
  documentId: string;
  documentName: string;
  index: number;
  text: string;
  terms: string[];
  embedding: number[];
  embeddingModel: string;
  createdAt: number;
};

export type KnowledgeMatch = {
  documentId: string;
  documentName: string;
  chunkIndex: number;
  text: string;
  score: number;
};

const DB_NAME = "local-ai-knowledge";
const DB_VERSION = 1;
const DOCUMENT_STORE = "documents";
const CHUNK_STORE = "chunks";
const MAX_CHUNK_LENGTH = 900;
const CHUNK_OVERLAP = 120;
const EMBEDDING_DIMENSIONS = 384;
const EMBEDDING_MODEL = "local-feature-hash-v1";
const VECTOR_WEIGHT = 100;
const KEYWORD_WEIGHT = 0.2;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        db.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        const store = db.createObjectStore(CHUNK_STORE, { keyPath: "id" });
        store.createIndex("documentId", "documentId");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open knowledge database."));
  });
}

export async function importKnowledgeFiles(files: File[]) {
  const documents: KnowledgeDocument[] = [];

  for (const file of files) {
    const text = await file.text();
    const createdAt = Date.now();
    const documentId = crypto.randomUUID();
    const chunks: KnowledgeChunk[] = [];

    for (const [index, chunk] of createChunks(text).entries()) {
      const embedding = await createTextEmbedding(chunk);
      chunks.push({
        id: `${documentId}:${index}`,
        documentId,
        documentName: file.name,
        index,
        text: chunk,
        terms: tokenize(chunk),
        embedding: embedding.values,
        embeddingModel: embedding.model,
        createdAt,
      });
    }

    const document: KnowledgeDocument = {
      id: documentId,
      name: file.name,
      type: file.type || "text/plain",
      size: file.size,
      embeddingModel: chunks[0]?.embeddingModel ?? EMBEDDING_MODEL,
      embeddingDimensions: chunks[0]?.embedding.length ?? EMBEDDING_DIMENSIONS,
      createdAt,
    };

    await saveDocumentWithChunks(document, chunks);
    documents.push(document);
  }

  return documents;
}

export async function listKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOCUMENT_STORE, "readonly");
    const request = transaction.objectStore(DOCUMENT_STORE).getAll();

    request.onsuccess = () => {
      db.close();
      resolve(request.result.sort((left, right) => right.createdAt - left.createdAt));
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Failed to list knowledge documents."));
    };
  });
}

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENT_STORE, CHUNK_STORE], "readwrite");
    transaction.objectStore(DOCUMENT_STORE).delete(documentId);

    const chunkStore = transaction.objectStore(CHUNK_STORE);
    const index = chunkStore.index("documentId");
    const request = index.openKeyCursor(IDBKeyRange.only(documentId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }

      chunkStore.delete(cursor.primaryKey);
      cursor.continue();
    };
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to delete knowledge document."));
    };
  });
}

export async function clearKnowledgeDocuments(): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENT_STORE, CHUNK_STORE], "readwrite");
    transaction.objectStore(DOCUMENT_STORE).clear();
    transaction.objectStore(CHUNK_STORE).clear();

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to clear knowledge documents."));
    };
  });
}

export async function searchKnowledge(query: string, limit = 5): Promise<KnowledgeMatch[]> {
  const queryTerms = tokenize(query);
  const queryEmbedding = await createTextEmbedding(query);
  let localQueryEmbedding: TextEmbedding | undefined;

  if (!queryTerms.length && !queryEmbedding.values.length) {
    return [];
  }

  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CHUNK_STORE, "readonly");
    const request = transaction.objectStore(CHUNK_STORE).getAll();

    request.onsuccess = () => {
      db.close();
      const matches = request.result
        .map((chunk: KnowledgeChunk) => {
          const chunkEmbedding = selectCompatibleEmbedding(chunk, queryEmbedding);
          const compatibleQueryEmbedding =
            chunkEmbedding.model === queryEmbedding.model
              ? queryEmbedding
              : (localQueryEmbedding ??= createLocalTextEmbedding(query));

          const vectorScore = cosineSimilarity(
            compatibleQueryEmbedding.values,
            chunkEmbedding.values,
          );
          const keywordScore = scoreChunk(queryTerms, chunk);

          return {
            documentId: chunk.documentId,
            documentName: chunk.documentName,
            chunkIndex: chunk.index,
            text: chunk.text,
            score: vectorScore * VECTOR_WEIGHT + keywordScore * KEYWORD_WEIGHT,
          };
        })
        .filter((match: KnowledgeMatch) => match.score > 0)
        .sort((left: KnowledgeMatch, right: KnowledgeMatch) => right.score - left.score)
        .slice(0, limit);
      resolve(matches);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Failed to search knowledge."));
    };
  });
}

function saveDocumentWithChunks(document: KnowledgeDocument, chunks: KnowledgeChunk[]) {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([DOCUMENT_STORE, CHUNK_STORE], "readwrite");
        transaction.objectStore(DOCUMENT_STORE).put(document);
        const chunkStore = transaction.objectStore(CHUNK_STORE);
        chunks.forEach((chunk) => chunkStore.put(chunk));
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("Failed to save knowledge document."));
        };
      }),
  );
}

function createChunks(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let buffer = "";

  for (const paragraph of normalized.split(/\n\s*\n/)) {
    if ((buffer + "\n\n" + paragraph).trim().length > MAX_CHUNK_LENGTH && buffer) {
      chunks.push(buffer.trim());
      buffer = buffer.slice(-CHUNK_OVERLAP);
    }
    buffer = `${buffer}\n\n${paragraph}`.trim();
  }

  if (buffer) {
    chunks.push(buffer.trim());
  }

  return chunks;
}

function tokenize(text: string) {
  const lower = text.toLowerCase();
  const asciiTerms = lower.match(/[a-z0-9_]{2,}/g) ?? [];
  const cjkTerms = lower.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  const cjkBigrams = cjkTerms.flatMap((term) =>
    Array.from({ length: Math.max(term.length - 1, 0) }, (_, index) => term.slice(index, index + 2)),
  );

  return [...new Set([...asciiTerms, ...cjkTerms, ...cjkBigrams])];
}

function scoreChunk(queryTerms: string[], chunk: KnowledgeChunk) {
  const terms = new Set(chunk.terms);
  return queryTerms.reduce((score, term) => score + (terms.has(term) ? term.length : 0), 0);
}

async function createTextEmbedding(text: string): Promise<TextEmbedding> {
  const browserEmbedding = await createBrowserEmbedding(text).catch(() => undefined);
  return browserEmbedding?.length
    ? { model: "browser-embedding", values: normalizeVector(browserEmbedding) }
    : createLocalTextEmbedding(text);
}

function createLocalTextEmbedding(text: string): TextEmbedding {
  return {
    model: EMBEDDING_MODEL,
    values: createHashedEmbedding(text),
  };
}

function selectCompatibleEmbedding(chunk: KnowledgeChunk, queryEmbedding: TextEmbedding): TextEmbedding {
  if (
    chunk.embedding?.length &&
    chunk.embeddingModel === queryEmbedding.model &&
    chunk.embedding.length === queryEmbedding.values.length
  ) {
    return {
      model: chunk.embeddingModel,
      values: chunk.embedding,
    };
  }

  return createLocalTextEmbedding(chunk.text);
}

async function createBrowserEmbedding(text: string): Promise<number[] | undefined> {
  const globalScope = globalThis as {
    EmbeddingModel?: BrowserEmbeddingFactory;
    ai?: {
      embedder?: BrowserEmbeddingFactory;
      embeddingModel?: BrowserEmbeddingFactory;
    };
  };
  const factory =
    globalScope.EmbeddingModel ??
    globalScope.ai?.embeddingModel ??
    globalScope.ai?.embedder;

  if (!factory?.create) {
    return undefined;
  }

  if (factory.availability && (await factory.availability()) === "unavailable") {
    return undefined;
  }

  const session = await factory.create();
  try {
    const rawEmbedding =
      (await session.embed?.(text)) ??
      (await session.embedForRetrieval?.(text)) ??
      (await session.getEmbedding?.(text));
    return parseEmbedding(rawEmbedding);
  } finally {
    session.destroy?.();
  }
}

function createHashedEmbedding(text: string) {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const terms = createEmbeddingFeatures(text);

  for (const term of terms) {
    const hash = hashText(term);
    const index = Math.abs(hash) % EMBEDDING_DIMENSIONS;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += sign * featureWeight(term);
  }

  return normalizeVector(vector);
}

function createEmbeddingFeatures(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const terms = tokenize(normalized);
  const cjkText = normalized.replace(/[^\u4e00-\u9fa5]/g, "");
  const cjkTrigrams = Array.from({ length: Math.max(cjkText.length - 2, 0) }, (_, index) =>
    cjkText.slice(index, index + 3),
  );
  const asciiWords = normalized.match(/[a-z0-9_]{2,}/g) ?? [];
  const asciiBigrams = asciiWords.slice(0, -1).map((word, index) => `${word}_${asciiWords[index + 1]}`);

  return [...terms, ...cjkTrigrams, ...asciiBigrams];
}

function featureWeight(term: string) {
  if (/^[\u4e00-\u9fa5]+$/.test(term)) {
    return Math.min(term.length, 6);
  }

  return Math.min(Math.log2(term.length + 1), 4);
}

function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }
  return dot;
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    return [];
  }

  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

function parseEmbedding(value: unknown): number[] | undefined {
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return value;
  }

  if (value instanceof Float32Array || value instanceof Float64Array) {
    return Array.from(value);
  }

  if (value && typeof value === "object" && "embedding" in value) {
    return parseEmbedding((value as { embedding: unknown }).embedding);
  }

  return undefined;
}

function hashText(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

type BrowserEmbeddingFactory = {
  availability?: () => Promise<ChromeAiAvailability | string>;
  create: () => Promise<BrowserEmbeddingSession>;
};

type BrowserEmbeddingSession = {
  embed?: (text: string) => Promise<unknown>;
  embedForRetrieval?: (text: string) => Promise<unknown>;
  getEmbedding?: (text: string) => Promise<unknown>;
  destroy?: () => void;
};

type TextEmbedding = {
  model: string;
  values: number[];
};
