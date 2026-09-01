export type AssistantMemoryType = "preference" | "fact" | "project" | "task";

export type AssistantMemory = {
  id: string;
  type: AssistantMemoryType;
  content: string;
  keywords: string[];
  createdAt: number;
  updatedAt: number;
};

export type AssistantMemoryCommand =
  | {
      type: "remember";
      content: string;
    }
  | {
      type: "forget";
      query: string;
    };

const DB_NAME = "local-ai-assistant-memory";
const DB_VERSION = 1;
const MEMORY_STORE = "memories";

export function parseAssistantMemoryCommand(input: string): AssistantMemoryCommand | undefined {
  const text = input.trim();
  const rememberMatch = matchFirst(text, [
    /^(?:请)?(?:帮我)?记住[:：\s]*(.+)$/i,
    /^(?:你要记住|记一下)[:：\s]*(.+)$/i,
    /^remember(?: that)?[:\s]+(.+)$/i,
    /^please remember(?: that)?[:\s]+(.+)$/i,
  ]);

  if (rememberMatch) {
    return {
      type: "remember",
      content: rememberMatch,
    };
  }

  const forgetMatch = matchFirst(text, [
    /^(?:请)?(?:忘记|忘掉|忘了|删除记忆|删掉记忆|不要记住|别记了)[:：\s]*(.+)$/i,
    /^(?:请)?把(.+?)(?:忘记|忘掉|删掉|删除)(?:吧)?$/i,
    /^forget(?: that)?[:\s]+(.+)$/i,
    /^delete memory[:\s]+(.+)$/i,
  ]);

  if (forgetMatch) {
    return {
      type: "forget",
      query: normalizeForgetQuery(forgetMatch),
    };
  }

  return undefined;
}

export async function saveAssistantMemory(content: string, type = classifyMemoryType(content)) {
  const now = Date.now();
  const memory: AssistantMemory = {
    id: crypto.randomUUID(),
    type,
    content: content.trim(),
    keywords: tokenize(content),
    createdAt: now,
    updatedAt: now,
  };

  const db = await openDatabase();

  return new Promise<AssistantMemory>((resolve, reject) => {
    const transaction = db.transaction(MEMORY_STORE, "readwrite");
    transaction.objectStore(MEMORY_STORE).put(memory);
    transaction.oncomplete = () => {
      db.close();
      resolve(memory);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to save assistant memory."));
    };
  });
}

export async function listAssistantMemories(): Promise<AssistantMemory[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEMORY_STORE, "readonly");
    const request = transaction.objectStore(MEMORY_STORE).getAll();

    request.onsuccess = () => {
      db.close();
      resolve(request.result.sort((left, right) => right.updatedAt - left.updatedAt));
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Failed to list assistant memories."));
    };
  });
}

export async function getAssistantMemory(memoryId: string): Promise<AssistantMemory | undefined> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEMORY_STORE, "readonly");
    const request = transaction.objectStore(MEMORY_STORE).get(memoryId);

    request.onsuccess = () => {
      db.close();
      resolve(request.result);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Failed to read assistant memory."));
    };
  });
}

export async function updateAssistantMemory(
  memoryId: string,
  updates: Partial<Pick<AssistantMemory, "type" | "content">>,
): Promise<AssistantMemory> {
  const currentMemory = await getAssistantMemory(memoryId);
  if (!currentMemory) {
    throw new Error("Assistant memory not found.");
  }

  const content = updates.content?.trim() ?? currentMemory.content;
  const memory: AssistantMemory = {
    ...currentMemory,
    ...updates,
    content,
    keywords: tokenize(content),
    updatedAt: Date.now(),
  };
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEMORY_STORE, "readwrite");
    transaction.objectStore(MEMORY_STORE).put(memory);
    transaction.oncomplete = () => {
      db.close();
      resolve(memory);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to update assistant memory."));
    };
  });
}

export async function searchAssistantMemories(query: string, limit = 5): Promise<AssistantMemory[]> {
  const queryTerms = tokenize(query);
  if (!queryTerms.length) {
    return [];
  }

  const memories = await listAssistantMemories();
  return memories
    .map((memory) => ({
      memory,
      score: scoreMemory(query, queryTerms, memory),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.memory.updatedAt - left.memory.updatedAt)
    .slice(0, limit)
    .map((item) => item.memory);
}

export async function deleteAssistantMemory(memoryId: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEMORY_STORE, "readwrite");
    transaction.objectStore(MEMORY_STORE).delete(memoryId);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to delete assistant memory."));
    };
  });
}

export async function deleteAssistantMemoriesByQuery(query: string, limit = 5): Promise<AssistantMemory[]> {
  const matches = await searchAssistantMemories(query, limit);
  for (const memory of matches) {
    await deleteAssistantMemory(memory.id);
  }
  return matches;
}

export async function clearAssistantMemories(): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEMORY_STORE, "readwrite");
    transaction.objectStore(MEMORY_STORE).clear();
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to clear assistant memories."));
    };
  });
}

export async function exportAssistantMemories(): Promise<string> {
  const memories = await listAssistantMemories();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      memories,
    },
    null,
    2,
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEMORY_STORE)) {
        const store = db.createObjectStore(MEMORY_STORE, { keyPath: "id" });
        store.createIndex("type", "type");
        store.createIndex("updatedAt", "updatedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open assistant memory database."));
  });
}

function classifyMemoryType(content: string): AssistantMemoryType {
  const text = content.toLowerCase();

  if (/(偏好|喜欢|习惯|默认|倾向|prefer|preference|like|default|always)/i.test(text)) {
    return "preference";
  }

  if (/(项目|仓库|代码库|repo|repository|workspace|project)/i.test(text)) {
    return "project";
  }

  if (/(任务|待办|进度|下次|继续|todo|task|next|progress)/i.test(text)) {
    return "task";
  }

  return "fact";
}

function scoreMemory(query: string, queryTerms: string[], memory: AssistantMemory) {
  const normalizedQuery = query.toLowerCase();
  const normalizedContent = memory.content.toLowerCase();
  const memoryTerms = new Set(memory.keywords);
  const keywordScore = queryTerms.reduce((score, term) => score + (memoryTerms.has(term) ? term.length : 0), 0);
  const substringScore = normalizedContent.includes(normalizedQuery) || normalizedQuery.includes(normalizedContent) ? 20 : 0;

  return keywordScore + substringScore;
}

function matchFirst(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const content = match?.[1]?.trim();
    if (content) {
      return content;
    }
  }

  return undefined;
}

function normalizeForgetQuery(query: string) {
  return query
    .trim()
    .replace(/^(?:关于|有关|我说过的|你记住的)\s*/i, "")
    .replace(/[。.!！?？\s]+$/g, "")
    .replace(/(?:这件事|这个信息|这条记忆|这件事情)?(?:吧|哈|呀|啊|哦|了)$/i, "")
    .trim();
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
