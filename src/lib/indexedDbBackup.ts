type StoreSpec = {
  name: string;
  indexes: Array<{
    name: string;
    keyPath: string;
  }>;
  validateRecord: (record: unknown) => boolean;
};

type DatabaseSpec = {
  name: string;
  version: number;
  stores: StoreSpec[];
};

type DatabaseBackup = {
  name: string;
  version: number;
  stores: Record<string, unknown[]>;
};

type AppBackup = {
  app: "localAI";
  formatVersion: 1;
  exportedAt: string;
  databases: DatabaseBackup[];
};

type PortableKnowledgeRecord = {
  type: "knowledge";
  spaceId: string;
  spaceName: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  text: string;
  createdAt: string;
};

type PortableMemoryRecord = {
  type: "memory";
  memoryType: "preference" | "fact" | "project" | "task";
  content: string;
  keywords: string[];
  createdAt: string;
  updatedAt: string;
};

type ConversationBackupRecord = {
  id: string;
  title: string;
  locale: "zh" | "en";
  messages: ChatMessageBackupRecord[];
  createdAt: number;
  updatedAt: number;
};

type ChatMessageBackupRecord = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

type KnowledgeDocumentBackupRecord = {
  id: string;
  spaceId: string;
  name: string;
  type: string;
  size: number;
  embeddingModel: string;
  embeddingDimensions: number;
  createdAt: number;
};

type KnowledgeChunkBackupRecord = {
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

type KnowledgeSpaceBackupRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

type AssistantMemoryBackupRecord = {
  id: string;
  type: "preference" | "fact" | "project" | "task";
  content: string;
  keywords: string[];
  createdAt: number;
  updatedAt: number;
};

export type IndexedDbImportResult = {
  databaseCount: number;
  storeCount: number;
  recordCount: number;
};

const DATABASE_SPECS: DatabaseSpec[] = [
  {
    name: "local-ai",
    version: 1,
    stores: [
      {
        name: "conversations",
        indexes: [{ name: "updatedAt", keyPath: "updatedAt" }],
        validateRecord: isConversationRecord,
      },
    ],
  },
  {
    name: "local-ai-knowledge",
    version: 2,
    stores: [
      {
        name: "documents",
        indexes: [{ name: "spaceId", keyPath: "spaceId" }],
        validateRecord: isKnowledgeDocumentRecord,
      },
      {
        name: "chunks",
        indexes: [
          { name: "documentId", keyPath: "documentId" },
          { name: "spaceId", keyPath: "spaceId" },
        ],
        validateRecord: isKnowledgeChunkRecord,
      },
      {
        name: "spaces",
        indexes: [],
        validateRecord: isKnowledgeSpaceRecord,
      },
    ],
  },
  {
    name: "local-ai-assistant-memory",
    version: 1,
    stores: [
      {
        name: "memories",
        indexes: [
          { name: "type", keyPath: "type" },
          { name: "updatedAt", keyPath: "updatedAt" },
        ],
        validateRecord: isAssistantMemoryRecord,
      },
    ],
  },
];

export async function exportAllIndexedDbData(): Promise<string> {
  const databases: DatabaseBackup[] = [];

  for (const databaseSpec of DATABASE_SPECS) {
    const db = await openDatabase(databaseSpec);
    const stores: Record<string, unknown[]> = {};

    try {
      for (const store of databaseSpec.stores) {
        stores[store.name] = await getAllRecords(db, store.name);
      }
    } finally {
      db.close();
    }

    databases.push({
      name: databaseSpec.name,
      version: databaseSpec.version,
      stores,
    });
  }

  return JSON.stringify(
    {
      app: "localAI",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      databases,
    } satisfies AppBackup,
    null,
    2,
  );
}

export async function exportPortableAiData(): Promise<string> {
  const knowledgeDb = await openDatabase(DATABASE_SPECS[1]);
  const memoryDb = await openDatabase(DATABASE_SPECS[2]);

  try {
    const spaces = (await getAllRecords(knowledgeDb, "spaces")).filter(isKnowledgeSpaceRecord);
    const chunks = (await getAllRecords(knowledgeDb, "chunks")).filter(isKnowledgeChunkRecord);
    const memories = (await getAllRecords(memoryDb, "memories")).filter(isAssistantMemoryRecord);
    const spaceNames = new Map(spaces.map((space) => [space.id, space.name]));
    const records: Array<PortableKnowledgeRecord | PortableMemoryRecord> = [
      ...chunks
        .sort((left, right) =>
          left.documentName.localeCompare(right.documentName) ||
          left.index - right.index,
        )
        .map((chunk) => ({
          type: "knowledge" as const,
          spaceId: chunk.spaceId,
          spaceName: spaceNames.get(chunk.spaceId) ?? chunk.spaceId,
          documentId: chunk.documentId,
          documentName: chunk.documentName,
          chunkIndex: chunk.index,
          text: chunk.text,
          createdAt: new Date(chunk.createdAt).toISOString(),
        })),
      ...memories
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((memory) => ({
          type: "memory" as const,
          memoryType: memory.type,
          content: memory.content,
          keywords: memory.keywords,
          createdAt: new Date(memory.createdAt).toISOString(),
          updatedAt: new Date(memory.updatedAt).toISOString(),
        })),
    ];

    return records.map((record) => JSON.stringify(record)).join("\n");
  } finally {
    knowledgeDb.close();
    memoryDb.close();
  }
}

export async function importAllIndexedDbData(json: string): Promise<IndexedDbImportResult> {
  const backup = parseBackup(json);
  const result = summarizeBackup(backup);

  for (const databaseSpec of DATABASE_SPECS) {
    const databaseBackup = backup.databases.find((database) => database.name === databaseSpec.name);
    if (!databaseBackup) {
      throw new Error(`Missing database: ${databaseSpec.name}`);
    }

    const db = await openDatabase(databaseSpec);
    try {
      await replaceDatabaseStores(db, databaseSpec, databaseBackup);
    } finally {
      db.close();
    }
  }

  return result;
}

function openDatabase(databaseSpec: DatabaseSpec): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseSpec.name, databaseSpec.version);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeSpec of databaseSpec.stores) {
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Failed to open ${databaseSpec.name}.`));
    request.onblocked = () => reject(new Error(`Database is blocked: ${databaseSpec.name}`));
  });
}

function getAllRecords(db: IDBDatabase, storeName: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Failed to read ${storeName}.`));
  });
}

function replaceDatabaseStores(db: IDBDatabase, databaseSpec: DatabaseSpec, backup: DatabaseBackup): Promise<void> {
  return new Promise((resolve, reject) => {
    const storeNames = databaseSpec.stores.map((store) => store.name);
    const transaction = db.transaction(storeNames, "readwrite");

    for (const storeSpec of databaseSpec.stores) {
      const objectStore = transaction.objectStore(storeSpec.name);
      objectStore.clear();
      for (const record of backup.stores[storeSpec.name] ?? []) {
        objectStore.put(record);
      }
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`Failed to import ${databaseSpec.name}.`));
  });
}

function parseBackup(json: string): AppBackup {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Backup file is not valid JSON.");
  }

  if (!isPlainObject(value) || value.app !== "localAI" || value.formatVersion !== 1 || !Array.isArray(value.databases)) {
    throw new Error("Backup file format is not supported.");
  }

  const backup = value as AppBackup;
  const expectedDatabaseNames = new Set(DATABASE_SPECS.map((database) => database.name));
  const databaseNames = new Set<string>();

  for (const database of backup.databases) {
    if (!isPlainObject(database) || typeof database.name !== "string" || !isPlainObject(database.stores)) {
      throw new Error("Backup file has an invalid database entry.");
    }
    if (!expectedDatabaseNames.has(database.name)) {
      throw new Error(`Unknown database in backup: ${database.name}`);
    }
    if (databaseNames.has(database.name)) {
      throw new Error(`Duplicate database in backup: ${database.name}`);
    }
    databaseNames.add(database.name);

    const spec = DATABASE_SPECS.find((item) => item.name === database.name);
    if (!spec) {
      throw new Error(`Unknown database in backup: ${database.name}`);
    }

    const expectedStoreNames = new Set(spec.stores.map((store) => store.name));
    for (const storeName of Object.keys(database.stores)) {
      if (!expectedStoreNames.has(storeName)) {
        throw new Error(`Unknown store in backup: ${database.name}/${storeName}`);
      }
    }

    for (const storeSpec of spec.stores) {
      const records = database.stores[storeSpec.name];
      if (!Array.isArray(records)) {
        throw new Error(`Missing store in backup: ${database.name}/${storeSpec.name}`);
      }
      for (const record of records) {
        if (!storeSpec.validateRecord(record)) {
          throw new Error(`Invalid record in backup: ${database.name}/${storeSpec.name}`);
        }
      }
    }
  }

  for (const databaseName of expectedDatabaseNames) {
    if (!databaseNames.has(databaseName)) {
      throw new Error(`Missing database in backup: ${databaseName}`);
    }
  }

  return backup;
}

function summarizeBackup(backup: AppBackup): IndexedDbImportResult {
  let storeCount = 0;
  let recordCount = 0;

  for (const database of backup.databases) {
    storeCount += Object.keys(database.stores).length;
    for (const records of Object.values(database.stores)) {
      recordCount += records.length;
    }
  }

  return {
    databaseCount: backup.databases.length,
    storeCount,
    recordCount,
  };
}

function isConversationRecord(value: unknown): value is ConversationBackupRecord {
  return isPlainObject(value) &&
    isString(value.id) &&
    isString(value.title) &&
    (value.locale === "zh" || value.locale === "en") &&
    Array.isArray(value.messages) &&
    value.messages.every(isChatMessageRecord) &&
    isNumber(value.createdAt) &&
    isNumber(value.updatedAt);
}

function isChatMessageRecord(value: unknown): value is ChatMessageBackupRecord {
  return isPlainObject(value) &&
    isString(value.id) &&
    (value.role === "assistant" || value.role === "user") &&
    isString(value.text);
}

function isKnowledgeDocumentRecord(value: unknown): value is KnowledgeDocumentBackupRecord {
  return isPlainObject(value) &&
    isString(value.id) &&
    isString(value.spaceId) &&
    isString(value.name) &&
    isString(value.type) &&
    isNumber(value.size) &&
    isString(value.embeddingModel) &&
    isNumber(value.embeddingDimensions) &&
    isNumber(value.createdAt);
}

function isKnowledgeChunkRecord(value: unknown): value is KnowledgeChunkBackupRecord {
  return isPlainObject(value) &&
    isString(value.id) &&
    isString(value.spaceId) &&
    isString(value.documentId) &&
    isString(value.documentName) &&
    isNumber(value.index) &&
    isString(value.text) &&
    isStringArray(value.terms) &&
    isNumberArray(value.embedding) &&
    isString(value.embeddingModel) &&
    isNumber(value.createdAt);
}

function isKnowledgeSpaceRecord(value: unknown): value is KnowledgeSpaceBackupRecord {
  return isPlainObject(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isNumber(value.createdAt) &&
    isNumber(value.updatedAt);
}

function isAssistantMemoryRecord(value: unknown): value is AssistantMemoryBackupRecord {
  return isPlainObject(value) &&
    isString(value.id) &&
    (value.type === "preference" || value.type === "fact" || value.type === "project" || value.type === "task") &&
    isString(value.content) &&
    isStringArray(value.keywords) &&
    isNumber(value.createdAt) &&
    isNumber(value.updatedAt);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber);
}
