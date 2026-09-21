import {
  KNOWLEDGE_CHUNK_STORE,
  KNOWLEDGE_DB_NAME,
  KNOWLEDGE_DB_STORES,
  KNOWLEDGE_DB_VERSION,
  KNOWLEDGE_DOCUMENT_STORE,
  KNOWLEDGE_SPACE_STORE,
  KNOWLEDGE_TERM_INDEX_STORE,
} from "./knowledgeDbSchema";

export type KnowledgeDocument = {
  id: string;
  spaceId: string;
  name: string;
  type: string;
  size: number;
  embeddingModel: string;
  embeddingDimensions: number;
  createdAt: number;
};

export type KnowledgeChunk = {
  id: string;
  spaceId: string;
  documentId: string;
  documentName: string;
  index: number;
  text: string;
  terms: string[];
  embedding: number[];
  embeddingModel: string;
  createdAt: number;
};

type KnowledgeTermIndexRecord = {
  id: string;
  spaceId: string;
  term: string;
  chunkId: string;
};

export type KnowledgeMatch = {
  documentId: string;
  spaceId: string;
  documentName: string;
  chunkIndex: number;
  text: string;
  score: number;
};

export type KnowledgeSpace = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type RebuildKnowledgeIndexResult = {
  documentCount: number;
  chunkCount: number;
  embeddingModel: string;
  embeddingDimensions: number;
};

export type KnowledgeImportProgress = {
  completedFiles: number;
  totalFiles: number;
  completedChunks: number;
  totalChunks: number;
  currentFileName: string;
  ratio: number;
  message: string;
};

const DEFAULT_SPACE_ID = "default";
export const MAX_KNOWLEDGE_FILE_SIZE = 5 * 1024 * 1024;
const MAX_CHUNK_LENGTH = 900;
const CHUNK_OVERLAP = 120;
const EMBEDDING_DIMENSIONS = 384;
const EMBEDDING_MODEL = "local-feature-hash-v1";
const VECTOR_WEIGHT = 100;
const KEYWORD_WEIGHT = 0.2;
const MIN_RERANK_CANDIDATES = 20;
const RERANK_CANDIDATE_MULTIPLIER = 4;
const RERANK_VECTOR_WEIGHT = 80;
const RERANK_KEYWORD_WEIGHT = 0.35;
const RERANK_COVERAGE_WEIGHT = 32;
const RERANK_PHRASE_WEIGHT = 18;
const RERANK_TITLE_WEIGHT = 10;
const RERANK_DENSITY_WEIGHT = 6;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KNOWLEDGE_DB_NAME, KNOWLEDGE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeSpec of KNOWLEDGE_DB_STORES) {
        const store = db.objectStoreNames.contains(storeSpec.name)
          ? request.transaction?.objectStore(storeSpec.name)
          : db.createObjectStore(storeSpec.name, { keyPath: "id" });

        if (!store) {
          continue;
        }

        for (const index of storeSpec.indexes) {
          if (!store.indexNames.contains(index.name)) {
            store.createIndex(index.name, index.keyPath);
          }
        }
      }
      migrateKnowledgeDatabase(request.transaction);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open knowledge database."));
  });
}

function migrateKnowledgeDatabase(transaction: IDBTransaction | null) {
  if (!transaction) {
    return;
  }

  const now = Date.now();
  transaction.objectStore(KNOWLEDGE_SPACE_STORE).put({
    ...getDefaultKnowledgeSpace(),
    createdAt: now,
    updatedAt: now,
  });

  const documentStore = transaction.objectStore(KNOWLEDGE_DOCUMENT_STORE);
  documentStore.openCursor().onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (!cursor) {
      return;
    }

    const document = cursor.value as Partial<KnowledgeDocument>;
    if (!document.spaceId) {
      cursor.update({
        ...document,
        spaceId: DEFAULT_SPACE_ID,
      });
    }
    cursor.continue();
  };

  const chunkStore = transaction.objectStore(KNOWLEDGE_CHUNK_STORE);
  const termStore = transaction.objectStore(KNOWLEDGE_TERM_INDEX_STORE);
  chunkStore.openCursor().onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (!cursor) {
      return;
    }

    const chunk = cursor.value as Partial<KnowledgeChunk>;
    const migratedChunk = {
      ...chunk,
      spaceId: chunk.spaceId ?? DEFAULT_SPACE_ID,
      terms: chunk.terms?.length ? chunk.terms : tokenize(chunk.text ?? ""),
    } as KnowledgeChunk;
    if (!chunk.spaceId || !chunk.terms?.length) {
      cursor.update(migratedChunk);
    }
    for (const record of createTermIndexRecords(migratedChunk)) {
      termStore.put(record);
    }
    cursor.continue();
  };
}

function getDefaultKnowledgeSpace(): KnowledgeSpace {
  return {
    id: DEFAULT_SPACE_ID,
    name: "个人资料",
    createdAt: 0,
    updatedAt: 0,
  };
}

async function ensureKnowledgeSpace(spaceId: string) {
  if (spaceId !== DEFAULT_SPACE_ID) {
    return;
  }

  const db = await openDatabase();
  const space = {
    ...getDefaultKnowledgeSpace(),
    updatedAt: Date.now(),
  };

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(KNOWLEDGE_SPACE_STORE, "readwrite");
    transaction.objectStore(KNOWLEDGE_SPACE_STORE).put(space);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to ensure default knowledge space."));
    };
  });
}

export async function importKnowledgeFiles(
  files: File[],
  spaceId = DEFAULT_SPACE_ID,
  options: {
    locale?: "zh" | "en";
    maxFileSize?: number;
    onProgress?: (progress: KnowledgeImportProgress) => void;
  } = {},
) {
  await ensureKnowledgeSpace(spaceId);
  const documents: KnowledgeDocument[] = [];
  const locale = options.locale ?? "zh";
  const maxFileSize = options.maxFileSize ?? MAX_KNOWLEDGE_FILE_SIZE;
  const preparedFiles = await Promise.all(files.map(async (file) => {
    if (file.size > maxFileSize) {
      throw new Error(formatKnowledgeImportTooLargeMessage(file.name, maxFileSize, locale));
    }

    const text = await file.text();
    return {
      file,
      text,
      chunks: createChunks(text),
    };
  }));
  const totalChunks = preparedFiles.reduce((sum, entry) => sum + Math.max(entry.chunks.length, 1), 0);
  let completedChunks = 0;
  let completedFiles = 0;

  const emitProgress = (currentFileName: string) => {
    const ratio = totalChunks ? completedChunks / totalChunks : 1;
    options.onProgress?.({
      completedFiles,
      totalFiles: preparedFiles.length,
      completedChunks,
      totalChunks,
      currentFileName,
      ratio,
      message: formatKnowledgeImportProgressMessage(currentFileName, completedFiles, preparedFiles.length, locale),
    });
  };

  for (const { file, text, chunks: preparedChunks } of preparedFiles) {
    const createdAt = Date.now();
    const documentId = crypto.randomUUID();
    const chunks: KnowledgeChunk[] = [];

    emitProgress(file.name);

    for (const [index, chunk] of preparedChunks.entries()) {
      const embedding = await createTextEmbedding(chunk);
      chunks.push({
        id: `${documentId}:${index}`,
        spaceId,
        documentId,
        documentName: file.name,
        index,
        text: chunk,
        terms: tokenize(chunk),
        embedding: embedding.values,
        embeddingModel: embedding.model,
        createdAt,
      });
      completedChunks += 1;
      emitProgress(file.name);
    }

    const document: KnowledgeDocument = {
      id: documentId,
      spaceId,
      name: file.name,
      type: file.type || "text/plain",
      size: file.size,
      embeddingModel: chunks[0]?.embeddingModel ?? EMBEDDING_MODEL,
      embeddingDimensions: chunks[0]?.embedding.length ?? EMBEDDING_DIMENSIONS,
      createdAt,
    };

    await saveDocumentWithChunks(document, chunks);
    documents.push(document);
    completedFiles += 1;
    completedChunks += preparedChunks.length ? 0 : 1;
    emitProgress(file.name);
  }

  return documents;
}

function formatKnowledgeImportTooLargeMessage(fileName: string, maxFileSize: number, locale: "zh" | "en") {
  const sizeLabel = formatKnowledgeFileSize(maxFileSize);
  return locale === "zh"
    ? `知识文件 ${fileName} 超过大小限制 ${sizeLabel}。`
    : `Knowledge file ${fileName} exceeds the size limit of ${sizeLabel}.`;
}

function formatKnowledgeImportProgressMessage(
  fileName: string,
  completedFiles: number,
  totalFiles: number,
  locale: "zh" | "en",
) {
  return locale === "zh"
    ? `正在导入知识文件 ${completedFiles}/${totalFiles}: ${fileName}`
    : `Importing knowledge file ${completedFiles}/${totalFiles}: ${fileName}`;
}

function formatKnowledgeFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export async function listKnowledgeDocuments(spaceId = DEFAULT_SPACE_ID): Promise<KnowledgeDocument[]> {
  await ensureKnowledgeSpace(spaceId);
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KNOWLEDGE_DOCUMENT_STORE, "readonly");
    const request = transaction.objectStore(KNOWLEDGE_DOCUMENT_STORE).index("spaceId").getAll(spaceId);

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

export async function listKnowledgeSpaces(): Promise<KnowledgeSpace[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KNOWLEDGE_SPACE_STORE, "readonly");
    const request = transaction.objectStore(KNOWLEDGE_SPACE_STORE).getAll();

    request.onsuccess = () => {
      db.close();
      const spaces = request.result.sort((left, right) => left.createdAt - right.createdAt);
      resolve(spaces.length ? spaces : [getDefaultKnowledgeSpace()]);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Failed to list knowledge spaces."));
    };
  });
}

export async function createKnowledgeSpace(name: string): Promise<KnowledgeSpace> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Knowledge space name is required.");
  }

  const now = Date.now();
  const space: KnowledgeSpace = {
    id: crypto.randomUUID(),
    name: trimmedName,
    createdAt: now,
    updatedAt: now,
  };
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KNOWLEDGE_SPACE_STORE, "readwrite");
    transaction.objectStore(KNOWLEDGE_SPACE_STORE).put(space);
    transaction.oncomplete = () => {
      db.close();
      resolve(space);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to create knowledge space."));
    };
  });
}

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([KNOWLEDGE_DOCUMENT_STORE, KNOWLEDGE_CHUNK_STORE, KNOWLEDGE_TERM_INDEX_STORE], "readwrite");
    transaction.objectStore(KNOWLEDGE_DOCUMENT_STORE).delete(documentId);

    const chunkStore = transaction.objectStore(KNOWLEDGE_CHUNK_STORE);
    const index = chunkStore.index("documentId");
    const request = index.openKeyCursor(IDBKeyRange.only(documentId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }

      chunkStore.delete(cursor.primaryKey);
      deleteTermIndexForChunk(transaction.objectStore(KNOWLEDGE_TERM_INDEX_STORE), String(cursor.primaryKey));
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

export async function clearKnowledgeDocuments(spaceId = DEFAULT_SPACE_ID): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([KNOWLEDGE_DOCUMENT_STORE, KNOWLEDGE_CHUNK_STORE, KNOWLEDGE_TERM_INDEX_STORE], "readwrite");
    const documentStore = transaction.objectStore(KNOWLEDGE_DOCUMENT_STORE);
    const documentIndex = documentStore.index("spaceId");
    const documentRequest = documentIndex.openKeyCursor(IDBKeyRange.only(spaceId));
    documentRequest.onsuccess = () => {
      const cursor = documentRequest.result;
      if (!cursor) {
        return;
      }
      documentStore.delete(cursor.primaryKey);
      cursor.continue();
    };

    const chunkStore = transaction.objectStore(KNOWLEDGE_CHUNK_STORE);
    const chunkIndex = chunkStore.index("spaceId");
    const chunkRequest = chunkIndex.openKeyCursor(IDBKeyRange.only(spaceId));
    chunkRequest.onsuccess = () => {
      const cursor = chunkRequest.result;
      if (!cursor) {
        return;
      }
      chunkStore.delete(cursor.primaryKey);
      cursor.continue();
    };

    const termStore = transaction.objectStore(KNOWLEDGE_TERM_INDEX_STORE);
    const termRequest = termStore.index("spaceId").openKeyCursor(IDBKeyRange.only(spaceId));
    termRequest.onsuccess = () => {
      const cursor = termRequest.result;
      if (!cursor) {
        return;
      }
      termStore.delete(cursor.primaryKey);
      cursor.continue();
    };

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

export async function searchKnowledge(query: string, limit = 5, spaceId = DEFAULT_SPACE_ID): Promise<KnowledgeMatch[]> {
  const queryTerms = tokenize(query);
  const queryProfile = createQueryProfile(query, queryTerms);
  const queryEmbedding = await createTextEmbedding(query);
  let localQueryEmbedding: TextEmbedding | undefined;

  if (!queryTerms.length && !queryEmbedding.values.length) {
    return [];
  }

  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([KNOWLEDGE_CHUNK_STORE, KNOWLEDGE_TERM_INDEX_STORE], "readonly");
    const chunkStore = transaction.objectStore(KNOWLEDGE_CHUNK_STORE);
    const termStore = transaction.objectStore(KNOWLEDGE_TERM_INDEX_STORE);
    const candidateLimit = Math.max(limit * RERANK_CANDIDATE_MULTIPLIER, MIN_RERANK_CANDIDATES);

    collectCandidateChunkIds(termStore, spaceId, queryTerms, candidateLimit * 3)
      .then((candidateIds) => readCandidateChunks(chunkStore, spaceId, candidateIds))
      .then((chunks) => {
        const candidates = chunks
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
            const coarseScore = vectorScore * VECTOR_WEIGHT + keywordScore * KEYWORD_WEIGHT;

            return {
              chunk,
              vectorScore,
              keywordScore,
              coarseScore,
              documentId: chunk.documentId,
              spaceId: chunk.spaceId ?? DEFAULT_SPACE_ID,
              documentName: chunk.documentName,
              chunkIndex: chunk.index,
              text: chunk.text,
            };
          })
          .filter((candidate: SearchCandidate) => candidate.coarseScore > 0)
          .sort((left: SearchCandidate, right: SearchCandidate) => right.coarseScore - left.coarseScore)
          .slice(0, candidateLimit);
        const matches = rerankKnowledgeCandidates(candidates, queryProfile).slice(0, limit);
        db.close();
        resolve(matches);
      })
      .catch((error) => {
        db.close();
        reject(error instanceof Error ? error : new Error("Failed to search knowledge."));
      });
  });
}

export async function rebuildKnowledgeIndex(spaceId = DEFAULT_SPACE_ID): Promise<RebuildKnowledgeIndexResult> {
  const chunks = await listKnowledgeChunks(spaceId);
  if (!chunks.length) {
    return {
      documentCount: 0,
      chunkCount: 0,
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
    };
  }

  const rebuiltChunks: KnowledgeChunk[] = [];
  for (const chunk of chunks) {
    const embedding = await createTextEmbedding(chunk.text);
    rebuiltChunks.push({
      ...chunk,
      embedding: embedding.values,
      embeddingModel: embedding.model,
      terms: tokenize(chunk.text),
    });
  }

  const firstEmbedding = rebuiltChunks[0];
  await saveRebuiltIndex(spaceId, rebuiltChunks, {
    embeddingModel: firstEmbedding.embeddingModel,
    embeddingDimensions: firstEmbedding.embedding.length,
  });

  return {
    documentCount: new Set(rebuiltChunks.map((chunk) => chunk.documentId)).size,
    chunkCount: rebuiltChunks.length,
    embeddingModel: firstEmbedding.embeddingModel,
    embeddingDimensions: firstEmbedding.embedding.length,
  };
}

function saveDocumentWithChunks(document: KnowledgeDocument, chunks: KnowledgeChunk[]) {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([KNOWLEDGE_DOCUMENT_STORE, KNOWLEDGE_CHUNK_STORE, KNOWLEDGE_TERM_INDEX_STORE], "readwrite");
        transaction.objectStore(KNOWLEDGE_DOCUMENT_STORE).put(document);
        const chunkStore = transaction.objectStore(KNOWLEDGE_CHUNK_STORE);
        const termStore = transaction.objectStore(KNOWLEDGE_TERM_INDEX_STORE);
        chunks.forEach((chunk) => {
          chunkStore.put(chunk);
          createTermIndexRecords(chunk).forEach((record) => termStore.put(record));
        });
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

async function listKnowledgeChunks(spaceId: string): Promise<KnowledgeChunk[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KNOWLEDGE_CHUNK_STORE, "readonly");
    const request = transaction.objectStore(KNOWLEDGE_CHUNK_STORE).index("spaceId").getAll(spaceId);

    request.onsuccess = () => {
      db.close();
      resolve(request.result.sort((left, right) => left.index - right.index));
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Failed to list knowledge chunks."));
    };
  });
}

async function saveRebuiltIndex(
  spaceId: string,
  chunks: KnowledgeChunk[],
  metadata: Pick<KnowledgeDocument, "embeddingModel" | "embeddingDimensions">,
) {
  const db = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([KNOWLEDGE_DOCUMENT_STORE, KNOWLEDGE_CHUNK_STORE, KNOWLEDGE_TERM_INDEX_STORE], "readwrite");
    const chunkStore = transaction.objectStore(KNOWLEDGE_CHUNK_STORE);
    const termStore = transaction.objectStore(KNOWLEDGE_TERM_INDEX_STORE);
    const termRequest = termStore.index("spaceId").openKeyCursor(IDBKeyRange.only(spaceId));
    termRequest.onsuccess = () => {
      const cursor = termRequest.result;
      if (!cursor) {
        chunks.forEach((chunk) => {
          chunkStore.put(chunk);
          createTermIndexRecords(chunk).forEach((record) => termStore.put(record));
        });
        return;
      }
      termStore.delete(cursor.primaryKey);
      cursor.continue();
    };

    const documentStore = transaction.objectStore(KNOWLEDGE_DOCUMENT_STORE);
    const documentRequest = documentStore.index("spaceId").openCursor(IDBKeyRange.only(spaceId));
    documentRequest.onsuccess = () => {
      const cursor = documentRequest.result;
      if (!cursor) {
        return;
      }

      documentStore.put({
        ...cursor.value,
        ...metadata,
      });
      cursor.continue();
    };

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to rebuild knowledge index."));
    };
  });
}


function createTermIndexRecords(chunk: KnowledgeChunk): KnowledgeTermIndexRecord[] {
  return [...new Set(chunk.terms)].map((term) => ({
    id: `${chunk.spaceId}:${term}:${chunk.id}`,
    spaceId: chunk.spaceId,
    term,
    chunkId: chunk.id,
  }));
}

function deleteTermIndexForChunk(termStore: IDBObjectStore, chunkId: string) {
  const request = termStore.index("chunkId").openKeyCursor(IDBKeyRange.only(chunkId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      return;
    }
    termStore.delete(cursor.primaryKey);
    cursor.continue();
  };
}

async function collectCandidateChunkIds(
  termStore: IDBObjectStore,
  spaceId: string,
  queryTerms: string[],
  limit: number,
): Promise<string[]> {
  if (!queryTerms.length) {
    return [];
  }

  const scores = new Map<string, number>();
  await Promise.all(queryTerms.map((term) => collectTermMatches(termStore, spaceId, term, scores)));
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([chunkId]) => chunkId);
}

function collectTermMatches(
  termStore: IDBObjectStore,
  spaceId: string,
  term: string,
  scores: Map<string, number>,
) {
  return new Promise<void>((resolve, reject) => {
    const request = termStore.index("spaceTerm").openCursor(IDBKeyRange.only([spaceId, term]));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const record = cursor.value as KnowledgeTermIndexRecord;
      scores.set(record.chunkId, (scores.get(record.chunkId) ?? 0) + Math.min(term.length, 8));
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to collect knowledge term matches."));
  });
}

async function readCandidateChunks(chunkStore: IDBObjectStore, spaceId: string, candidateIds: string[]) {
  if (!candidateIds.length) {
    return readAllChunksForSpace(chunkStore, spaceId);
  }

  const chunks = await Promise.all(candidateIds.map((chunkId) => readChunk(chunkStore, chunkId)));
  return chunks.filter((chunk): chunk is KnowledgeChunk => Boolean(chunk));
}

function readChunk(chunkStore: IDBObjectStore, chunkId: string) {
  return new Promise<KnowledgeChunk | undefined>((resolve, reject) => {
    const request = chunkStore.get(chunkId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to read knowledge chunk."));
  });
}

function readAllChunksForSpace(chunkStore: IDBObjectStore, spaceId: string) {
  return new Promise<KnowledgeChunk[]>((resolve, reject) => {
    const request = chunkStore.index("spaceId").getAll(spaceId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to read knowledge chunks."));
  });
}

export function createChunks(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let buffer = "";

  const flushBuffer = (keepOverlap = true) => {
    const chunk = buffer.trim();
    if (chunk) {
      chunks.push(chunk);
      buffer = keepOverlap ? chunk.slice(-CHUNK_OVERLAP) : "";
    }
  };

  const appendPiece = (piece: string) => {
    const normalizedPiece = piece.trim();
    if (!normalizedPiece) {
      return;
    }

    const candidate = `${buffer}\n\n${normalizedPiece}`.trim();
    if (candidate.length <= MAX_CHUNK_LENGTH) {
      buffer = candidate;
      return;
    }

    if (buffer) {
      flushBuffer(true);
    }

    const overlappedCandidate = `${buffer}\n\n${normalizedPiece}`.trim();
    if (overlappedCandidate.length <= MAX_CHUNK_LENGTH) {
      buffer = overlappedCandidate;
      return;
    }

    if (buffer.trim()) {
      flushBuffer(false);
    }
    buffer = normalizedPiece;
  };

  for (const paragraph of normalized.split(/\n\s*\n/)) {
    for (const piece of splitOversizedParagraph(paragraph.trim())) {
      if (piece.length > MAX_CHUNK_LENGTH) {
        if (buffer.trim()) {
          flushBuffer(false);
        }
        chunks.push(...splitBySlidingWindow(piece));
        buffer = chunks.at(-1)?.slice(-CHUNK_OVERLAP) ?? "";
      } else {
        appendPiece(piece);
      }
    }
  }

  if (buffer.trim() && buffer.trim() !== chunks.at(-1)?.slice(-CHUNK_OVERLAP)) {
    chunks.push(buffer.trim());
  }

  return chunks;
}

function splitOversizedParagraph(paragraph: string) {
  if (paragraph.length <= MAX_CHUNK_LENGTH) {
    return [paragraph];
  }

  const sentences = paragraph
    .split(/(?<=[。！？!?；;.!?])\s*/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    return [paragraph];
  }

  const pieces: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    const candidate = `${buffer}${buffer ? " " : ""}${sentence}`.trim();
    if (candidate.length > MAX_CHUNK_LENGTH && buffer) {
      pieces.push(buffer);
      buffer = `${buffer.slice(-CHUNK_OVERLAP)} ${sentence}`.trim();
    } else {
      buffer = candidate;
    }
  }

  if (buffer) {
    pieces.push(buffer);
  }

  return pieces;
}

function splitBySlidingWindow(text: string) {
  const chunks: string[] = [];
  const step = Math.max(MAX_CHUNK_LENGTH - CHUNK_OVERLAP, 1);
  for (let start = 0; start < text.length; start += step) {
    chunks.push(text.slice(start, start + MAX_CHUNK_LENGTH));
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

function rerankKnowledgeCandidates(candidates: SearchCandidate[], queryProfile: QueryProfile): KnowledgeMatch[] {
  return candidates
    .map((candidate) => {
      const coverageScore = scoreTermCoverage(queryProfile.terms, candidate.chunk.terms);
      const phraseScore = scorePhraseMatch(queryProfile, candidate.chunk.text);
      const titleScore = scoreTitleMatch(queryProfile.terms, candidate.chunk.documentName);
      const densityScore = scoreTermDensity(queryProfile.terms, candidate.chunk.text);
      const score =
        candidate.vectorScore * RERANK_VECTOR_WEIGHT +
        candidate.keywordScore * RERANK_KEYWORD_WEIGHT +
        coverageScore * RERANK_COVERAGE_WEIGHT +
        phraseScore * RERANK_PHRASE_WEIGHT +
        titleScore * RERANK_TITLE_WEIGHT +
        densityScore * RERANK_DENSITY_WEIGHT;

      return {
        documentId: candidate.documentId,
        spaceId: candidate.spaceId,
        documentName: candidate.documentName,
        chunkIndex: candidate.chunkIndex,
        text: candidate.text,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);
}

function createQueryProfile(query: string, terms: string[]): QueryProfile {
  return {
    normalizedText: normalizeSearchText(query),
    compactCjkText: query.replace(/[^\u4e00-\u9fa5]/g, ""),
    terms,
  };
}

function scoreTermCoverage(queryTerms: string[], chunkTerms: string[]) {
  if (!queryTerms.length) {
    return 0;
  }

  const terms = new Set(chunkTerms);
  const matched = queryTerms.filter((term) => terms.has(term));
  const matchedWeight = matched.reduce((sum, term) => sum + Math.min(term.length, 8), 0);
  const totalWeight = queryTerms.reduce((sum, term) => sum + Math.min(term.length, 8), 0);
  return totalWeight ? matchedWeight / totalWeight : 0;
}

function scorePhraseMatch(queryProfile: QueryProfile, text: string) {
  const normalizedText = normalizeSearchText(text);
  if (queryProfile.normalizedText.length >= 4 && normalizedText.includes(queryProfile.normalizedText)) {
    return 1;
  }

  const compactText = text.replace(/[^\u4e00-\u9fa5]/g, "");
  if (queryProfile.compactCjkText.length >= 4 && compactText.includes(queryProfile.compactCjkText)) {
    return 0.9;
  }

  const longTerms = queryProfile.terms.filter((term) => term.length >= 4);
  if (!longTerms.length) {
    return 0;
  }

  const matchedLongTerms = longTerms.filter((term) => normalizedText.includes(term));
  return matchedLongTerms.length / longTerms.length;
}

function scoreTitleMatch(queryTerms: string[], documentName: string) {
  if (!queryTerms.length) {
    return 0;
  }

  const normalizedName = normalizeSearchText(documentName);
  const matched = queryTerms.filter((term) => normalizedName.includes(term));
  return matched.length / queryTerms.length;
}

function scoreTermDensity(queryTerms: string[], text: string) {
  if (!queryTerms.length) {
    return 0;
  }

  const normalizedText = normalizeSearchText(text);
  const hitCount = queryTerms.reduce((count, term) => count + (normalizedText.includes(term) ? 1 : 0), 0);
  const lengthPenalty = Math.max(normalizedText.length / MAX_CHUNK_LENGTH, 1);
  return hitCount / queryTerms.length / lengthPenalty;
}

function normalizeSearchText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
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

type SearchCandidate = Omit<KnowledgeMatch, "score"> & {
  chunk: KnowledgeChunk;
  vectorScore: number;
  keywordScore: number;
  coarseScore: number;
};

type QueryProfile = {
  normalizedText: string;
  compactCjkText: string;
  terms: string[];
};
