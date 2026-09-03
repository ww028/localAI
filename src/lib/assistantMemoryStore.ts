export type AssistantMemoryType = "preference" | "fact" | "project" | "task";

export type AssistantMemoryFact = {
  subject: string;
  predicate: string;
  value: string;
  confidence: number;
  sourceText: string;
  normalizedText: string;
};

export type AssistantMemory = {
  id: string;
  type: AssistantMemoryType;
  content: string;
  sourceText?: string;
  facts?: AssistantMemoryFact[];
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

export type AssistantMemorySuggestion = {
  type: AssistantMemoryType;
  content: string;
  confidence: number;
  risk: "low" | "medium";
  rationale: string;
};

export type AssistantMemoryConflict = {
  memory: AssistantMemory;
  score: number;
  reason: "duplicate" | "similar" | "same_fact_key";
};

export type AssistantMemoryImportResult = {
  imported: number;
  skipped: number;
};

export type AssistantMemoryWriteDecision = {
  action: "save_new" | "replace_existing" | "merge_with_existing" | "keep_both" | "ask_user";
  existingMemoryId?: string;
  content?: string;
  memoryType?: AssistantMemoryType;
  rationale?: string;
};

export type AssistantMemoryWriteResult = {
  decision: "saved" | "updated" | "merged" | "kept_both" | "needs_confirmation";
  success: boolean;
  savedMemory?: AssistantMemory;
  updatedMemory?: AssistantMemory;
  previousMemory?: AssistantMemory;
  writeDecision: AssistantMemoryWriteDecision;
};

type SaveAssistantMemoryOptions = {
  sourceText?: string;
  facts?: AssistantMemoryFact[];
};

const DB_NAME = "local-ai-assistant-memory";
const DB_VERSION = 1;
const MEMORY_STORE = "memories";

export function parseAssistantMemoryCommand(input: string): AssistantMemoryCommand | undefined {
  const text = input.trim();
  const rememberMatch = matchFirst(text, [
    /^(?:请)?(?:帮我)?记住[:：\s]*(.+)$/i,
    /^(?:请)?(?:帮我)?记住(.+)$/i,
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
    /^(?:请)?(?:删除|删掉|移除|清除)(?:个人记忆(?:里|中)?|记忆里|记忆中)?(?:关于|有关)?(.+?)(?:相关)?(?:的信息|的内容|的记忆|这条记忆|记忆)?(?:吧)?$/i,
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

export async function saveAssistantMemory(
  content: string,
  type = classifyMemoryType(content),
  options: SaveAssistantMemoryOptions = {},
) {
  const now = Date.now();
  const facts = normalizeMemoryFacts(options.facts, content);
  const memory: AssistantMemory = {
    id: crypto.randomUUID(),
    type,
    content: content.trim(),
    sourceText: options.sourceText,
    facts,
    keywords: tokenizeMemory(content, facts),
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

export async function findAssistantMemoryConflicts(
  content: string,
  type = classifyMemoryType(content),
  limit = 3,
): Promise<AssistantMemoryConflict[]> {
  const normalizedContent = normalizeMemoryContent(content);
  if (!normalizedContent) {
    return [];
  }

  const terms = tokenize(normalizedContent);
  const memories = await listAssistantMemories();
  return memories
    .filter((memory) => memory.type === type)
    .map((memory) => {
      const normalizedMemory = normalizeMemoryContent(memory.content);
      const score = normalizedMemory === normalizedContent
        ? 1
        : calculateSimilarity(terms, memory.keywords);
      return {
        memory,
        score,
        reason: score >= 1 ? "duplicate" as const : "similar" as const,
      };
    })
    .filter((conflict) => conflict.score >= 0.45)
    .sort((left, right) => right.score - left.score || right.memory.updatedAt - left.memory.updatedAt)
    .slice(0, limit);
}

export async function findAssistantMemoryFactConflicts(
  facts: AssistantMemoryFact[],
  limit = 5,
): Promise<AssistantMemoryConflict[]> {
  const factKeys = new Set(facts.map(getAssistantMemoryFactKey).filter(Boolean));
  if (!factKeys.size) {
    return [];
  }

  return (await listAssistantMemories())
    .map((memory) => {
      const matchedKeys = memory.facts?.map(getAssistantMemoryFactKey).filter((key) => key && factKeys.has(key)) ?? [];
      return {
        memory,
        score: matchedKeys.length,
        reason: "same_fact_key" as const,
      };
    })
    .filter((conflict) => conflict.score > 0)
    .sort((left, right) => right.score - left.score || right.memory.updatedAt - left.memory.updatedAt)
    .slice(0, limit);
}

export function getAssistantMemoryFactKey(fact: Pick<AssistantMemoryFact, "subject" | "predicate">) {
  const subject = normalizeMemoryFactKeyPart(fact.subject);
  const predicate = normalizeAssistantMemoryFactPredicate(fact.predicate);
  return subject && predicate ? `${subject}:${predicate}` : "";
}

export function hasSameAssistantMemoryFactSlot(left: AssistantMemoryFact[], right: AssistantMemoryFact[]) {
  const leftKeys = new Set(left.map(getAssistantMemoryFactKey).filter(Boolean));
  return right.some((fact) => leftKeys.has(getAssistantMemoryFactKey(fact)));
}

export function createAssistantMemoryWriteDecision({
  content,
  facts,
  memoryType,
  relatedMemories,
  modelDecision,
}: {
  content: string;
  facts: AssistantMemoryFact[];
  memoryType: AssistantMemoryType;
  relatedMemories: AssistantMemory[];
  modelDecision?: AssistantMemoryWriteDecision;
}): AssistantMemoryWriteDecision {
  const sameSlotMemories = relatedMemories.filter((memory) => memory.facts && hasSameAssistantMemoryFactSlot(facts, memory.facts));
  const fallbackDecision = createFallbackAssistantMemoryWriteDecision(content, facts, memoryType, sameSlotMemories);
  const decision = modelDecision ? normalizeAssistantMemoryWriteDecision(modelDecision, relatedMemories, fallbackDecision) : fallbackDecision;

  if (!sameSlotMemories.length) {
    return decision;
  }

  if (sameSlotMemories.length > 1) {
    return {
      action: "ask_user",
      content,
      memoryType,
      rationale: "Multiple existing memories share the same fact slot.",
    };
  }

  const existingMemory = sameSlotMemories[0];
  if (decision.action === "merge_with_existing" && decision.existingMemoryId === existingMemory.id) {
    return decision;
  }

  return {
    action: "replace_existing",
    existingMemoryId: existingMemory.id,
    content: decision.content || formatAssistantMemoryFactsAsContent(facts) || content,
    memoryType: decision.memoryType ?? memoryType,
    rationale: decision.rationale || "An existing memory uses the same subject and predicate, so the newer fact replaces it.",
  };
}

export async function writeAssistantMemoryWithDecision({
  content,
  facts,
  memoryType,
  sourceText,
  relatedMemories,
  modelDecision,
}: {
  content: string;
  facts: AssistantMemoryFact[];
  memoryType: AssistantMemoryType;
  sourceText?: string;
  relatedMemories: AssistantMemory[];
  modelDecision?: AssistantMemoryWriteDecision;
}): Promise<AssistantMemoryWriteResult> {
  const writeDecision = createAssistantMemoryWriteDecision({
    content,
    facts,
    memoryType,
    relatedMemories,
    modelDecision,
  });

  if (writeDecision.action === "ask_user") {
    return { decision: "needs_confirmation", success: false, writeDecision };
  }

  if (writeDecision.action === "replace_existing" || writeDecision.action === "merge_with_existing") {
    const targetMemory = relatedMemories.find((memory) => memory.id === writeDecision.existingMemoryId);
    if (targetMemory) {
      const nextFacts = mergeAssistantMemoryFacts(targetMemory.facts ?? [], facts);
      const nextContent = writeDecision.content?.trim() ||
        formatAssistantMemoryFactsAsContent(nextFacts) ||
        formatAssistantMemoryFactsAsContent(facts) ||
        content;
      const updatedMemory = await updateAssistantMemory(targetMemory.id, {
        content: nextContent,
        type: writeDecision.memoryType ?? memoryType,
        sourceText: sourceText ?? content,
        facts: nextFacts.length ? nextFacts : facts,
      });

      return {
        decision: writeDecision.action === "merge_with_existing" ? "merged" : "updated",
        success: true,
        updatedMemory,
        previousMemory: targetMemory,
        writeDecision,
      };
    }
  }

  const savedContent = writeDecision.content?.trim() || formatAssistantMemoryFactsAsContent(facts) || content;
  const savedMemory = await saveAssistantMemory(savedContent, writeDecision.memoryType ?? memoryType, {
    sourceText: sourceText ?? content,
    facts,
  });

  return {
    decision: writeDecision.action === "keep_both" ? "kept_both" : "saved",
    success: true,
    savedMemory,
    writeDecision,
  };
}

export function normalizeAssistantMemoryWriteDecision(
  decision: AssistantMemoryWriteDecision,
  relatedMemories: AssistantMemory[],
  fallback: AssistantMemoryWriteDecision,
): AssistantMemoryWriteDecision {
  const relatedIds = new Set(relatedMemories.map((memory) => memory.id));
  const requiresExistingId = decision.action === "replace_existing" || decision.action === "merge_with_existing";
  const existingMemoryId = decision.existingMemoryId && relatedIds.has(decision.existingMemoryId)
    ? decision.existingMemoryId
    : fallback.existingMemoryId;

  if (requiresExistingId && !existingMemoryId) {
    return fallback;
  }

  return {
    action: decision.action,
    existingMemoryId,
    content: decision.content?.trim() || fallback.content,
    memoryType: decision.memoryType ?? fallback.memoryType,
    rationale: decision.rationale?.trim() || fallback.rationale,
  };
}

export function formatAssistantMemoryFactsAsContent(facts: AssistantMemoryFact[]) {
  return facts.map((fact) => fact.normalizedText.trim()).filter(Boolean).join("\n");
}

export function filterSourceGroundedAssistantMemoryFacts(facts: AssistantMemoryFact[], sourceText: string) {
  return facts.filter((fact) => isAssistantMemoryFactSourceGrounded(fact, sourceText));
}

export function isAssistantMemoryFactSourceGrounded(fact: AssistantMemoryFact, sourceText: string) {
  return isAssistantMemoryTextGroundedInSource(fact.normalizedText, sourceText);
}

export function isAssistantMemoryTextGroundedInSource(text: string, sourceText: string) {
  const normalizedText = normalizeMemoryEvidenceText(text);
  const normalizedSource = normalizeMemoryEvidenceText(sourceText);
  if (!normalizedText || !normalizedSource) {
    return false;
  }

  return normalizedSource.includes(normalizedText) ||
    normalizedText.includes(normalizedSource) ||
    isSubsequence(normalizedText, normalizedSource);
}

export function mergeAssistantMemoryFacts(existingFacts: AssistantMemoryFact[], incomingFacts: AssistantMemoryFact[]) {
  const merged = new Map<string, AssistantMemoryFact>();

  for (const fact of normalizeMemoryFacts(existingFacts, "") ?? []) {
    const key = getAssistantMemoryFactKey(fact);
    if (key) {
      merged.set(key, fact);
    }
  }

  for (const fact of normalizeMemoryFacts(incomingFacts, "") ?? []) {
    const key = getAssistantMemoryFactKey(fact);
    if (key) {
      merged.set(key, fact);
    }
  }

  return [...merged.values()];
}

function createFallbackAssistantMemoryWriteDecision(
  content: string,
  facts: AssistantMemoryFact[],
  memoryType: AssistantMemoryType,
  sameSlotMemories: AssistantMemory[],
): AssistantMemoryWriteDecision {
  if (sameSlotMemories.length === 1) {
    return {
      action: "replace_existing",
      existingMemoryId: sameSlotMemories[0].id,
      content: formatAssistantMemoryFactsAsContent(facts) || content,
      memoryType,
      rationale: "Found one existing memory in the same fact slot.",
    };
  }

  if (!sameSlotMemories.length) {
    return {
      action: "save_new",
      content: formatAssistantMemoryFactsAsContent(facts) || content,
      memoryType,
      rationale: "No existing memory uses the same subject and predicate.",
    };
  }

  return {
    action: "ask_user",
    content,
    memoryType,
    rationale: "Multiple existing memories share the same fact slot.",
  };
}

export function normalizeAssistantMemoryFactPredicate(predicate: string) {
  const normalized = normalizeMemoryFactKeyPart(predicate);
  const aliases: Array<[string, string[]]> = [
    ["identity", ["identity", "身份", "身份或属性", "属性", "类型", "类别", "物种", "是什么", "is"]],
    ["preference", ["preference", "偏好", "喜好", "习惯", "倾向"]],
    ["name", ["name", "名字", "名称", "称呼", "昵称"]],
    ["location", ["location", "地点", "位置", "地址", "所在地", "住址"]],
    ["project", ["project", "项目", "仓库", "代码库"]],
    ["role", ["role", "角色", "职业", "职位", "职责"]],
    ["status", ["status", "状态", "进度"]],
    ["relationship", ["relationship", "关系", "关联"]],
  ];

  for (const [canonical, values] of aliases) {
    if (values.some((value) => normalizeMemoryFactKeyPart(value) === normalized)) {
      return canonical;
    }
  }

  return normalized;
}

export async function importAssistantMemories(json: string): Promise<AssistantMemoryImportResult> {
  const payload = JSON.parse(json) as unknown;
  const records = parseImportedMemories(payload);
  const db = await openDatabase();
  const now = Date.now();
  let imported = 0;
  let skipped = 0;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEMORY_STORE, "readwrite");
    const store = transaction.objectStore(MEMORY_STORE);

    for (const record of records) {
      const content = record.content.trim();
      if (!content) {
        skipped += 1;
        continue;
      }

      const memory: AssistantMemory = {
        id: record.id || crypto.randomUUID(),
        type: record.type,
        content,
        sourceText: record.sourceText,
        facts: record.facts,
        keywords: tokenizeMemory(content, record.facts),
        createdAt: normalizeTimestamp(record.createdAt, now),
        updatedAt: normalizeTimestamp(record.updatedAt, now),
      };
      store.put(memory);
      imported += 1;
    }

    transaction.oncomplete = () => {
      db.close();
      resolve({ imported, skipped });
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to import assistant memories."));
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
  updates: Partial<Pick<AssistantMemory, "type" | "content" | "sourceText" | "facts">>,
): Promise<AssistantMemory> {
  const currentMemory = await getAssistantMemory(memoryId);
  if (!currentMemory) {
    throw new Error("Assistant memory not found.");
  }

  const content = updates.content?.trim() ?? currentMemory.content;
  const facts = updates.facts ? normalizeMemoryFacts(updates.facts, content) : currentMemory.facts;
  const memory: AssistantMemory = {
    ...currentMemory,
    ...updates,
    content,
    facts,
    keywords: tokenizeMemory(content, facts),
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
  return deleteAssistantMemoriesByQueries([query], limit);
}

export async function deleteAssistantMemoriesByQueries(queries: string[], limit = 10): Promise<AssistantMemory[]> {
  const normalizedQueries = queries.map((query) => normalizeMemoryContent(query)).filter(Boolean);
  if (!normalizedQueries.length) {
    return [];
  }
  const deletionQueries = [...new Set(normalizedQueries.flatMap(expandDeletionQueries))];

  const matches = (await listAssistantMemories())
    .map((memory) => ({
      memory,
      score: Math.max(...deletionQueries.map((deletionQuery) => scoreMemoryDeletionMatch(deletionQuery, memory))),
    }))
    .filter((item) => item.score >= 1)
    .sort((left, right) => right.score - left.score || right.memory.updatedAt - left.memory.updatedAt)
    .slice(0, limit)
    .map((item) => item.memory);

  for (const memory of matches) {
    await deleteAssistantMemory(memory.id);
  }
  return matches;
}

export function isAssistantMemoryDeletionMatch(query: string, memory: Pick<AssistantMemory, "content" | "keywords">) {
  const normalizedQuery = normalizeMemoryContent(query);
  if (!normalizedQuery) {
    return false;
  }

  return expandDeletionQueries(normalizedQuery).some((deletionQuery) => scoreMemoryDeletionMatch(deletionQuery, memory) >= 1);
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

export function detectAssistantMemorySuggestion(input: string, locale: "zh" | "en"): AssistantMemorySuggestion | undefined {
  const content = normalizeSuggestedMemory(input);
  if (!content || content.length < 4 || content.length > 240) {
    return undefined;
  }
  if (parseAssistantMemoryCommand(input)) {
    return undefined;
  }

  const type = classifyMemoryType(content);
  const preferencePattern = locale === "zh"
    ? /我(?:喜欢|偏好|习惯|希望|通常|默认|倾向|不喜欢|讨厌|更愿意)/
    : /\bI\s+(?:like|prefer|usually|always|default to|tend to|do not like|don't like|hate|want you to)\b/i;
  const stableFactPattern = locale === "zh"
    ? /我(?:叫|是|在|有|养|负责|使用|住在)|我的(?:名字|职业|项目|习惯|偏好|宠物|公司|电脑|环境)/
    : /\b(my name is|I am|I work|I use|I have|my project|my preference|my habit)\b/i;

  if (preferencePattern.test(content)) {
    return {
      type: "preference",
      content,
      confidence: 0.86,
      risk: "low",
      rationale: locale === "zh" ? "这看起来是稳定的用户偏好。" : "This looks like a stable user preference.",
    };
  }

  if (stableFactPattern.test(content)) {
    return {
      type,
      content,
      confidence: 0.72,
      risk: "medium",
      rationale: locale === "zh" ? "这可能是长期有用的个人事实。" : "This may be a useful long-term personal fact.",
    };
  }

  return undefined;
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

export function classifyMemoryType(content: string): AssistantMemoryType {
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
  const normalizedContent = getSearchableMemoryText(memory).toLowerCase();
  const memoryTerms = new Set(memory.keywords);
  const keywordScore = queryTerms.reduce((score, term) => score + (memoryTerms.has(term) ? term.length : 0), 0);
  const substringScore = normalizedContent.includes(normalizedQuery) || normalizedQuery.includes(normalizedContent) ? 20 : 0;

  return keywordScore + substringScore;
}

function scoreMemoryDeletionMatch(query: string, memory: Pick<AssistantMemory, "content" | "keywords">) {
  const normalizedContent = normalizeMemoryContent(getSearchableMemoryText(memory));
  if (!query || !normalizedContent) {
    return 0;
  }

  if (normalizedContent === query) {
    return 100;
  }

  if (normalizedContent.includes(query) || query.includes(normalizedContent)) {
    return 80;
  }

  const queryTerms = tokenizeForDeletion(query);
  if (!queryTerms.length) {
    return 0;
  }

  const memoryTerms = new Set((memory.keywords?.length ? memory.keywords : tokenize(getSearchableMemoryText(memory))).filter(isInformativeMemoryToken));
  const matchedTerms = queryTerms.filter((term) => memoryTerms.has(term));
  const coverage = matchedTerms.length / queryTerms.length;
  const hasSpecificLongTerm = matchedTerms.some((term) => term.length >= 3 || /^[a-z0-9_]{4,}$/i.test(term));

  return coverage >= 0.72 && hasSpecificLongTerm ? coverage : 0;
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
    .replace(/^(?:个人记忆(?:里|中)?|记忆里|记忆中|我说过的|你记住的)\s*/i, "")
    .replace(/^(?:关于|有关)\s*/i, "")
    .replace(/[。.!！?？\s]+$/g, "")
    .replace(/(?:相关)?(?:的信息|的内容|的记忆|这条记忆|这件事|这个信息|这条记忆|这件事情)$/i, "")
    .replace(/(?:这件事|这个信息|这条记忆|这件事情)?(?:吧|哈|呀|啊|哦|了)$/i, "")
    .trim();
}

function expandDeletionQueries(query: string) {
  const normalizedQuery = normalizeMemoryContent(query);
  const parts = normalizedQuery
    .split(/(?:以及|和|与|及|跟|同|,|，|、|\/|&)/)
    .map((part) => normalizeForgetQuery(part))
    .filter((part) => part.length >= 2);

  return [...new Set([normalizedQuery, ...parts])];
}

function normalizeMemoryContent(content: string) {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function getSearchableMemoryText(memory: Pick<AssistantMemory, "content" | "facts">) {
  const factText = memory.facts?.map((fact) => `${fact.subject} ${fact.predicate} ${fact.value} ${fact.normalizedText}`).join(" ") ?? "";
  return `${memory.content} ${factText}`.trim();
}

function normalizeMemoryFactKeyPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeMemoryEvidenceText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s"'“”‘’`.,，。:：;；!?！？、()[\]{}<>《》【】]/g, "")
    .replace(/(?:一个|一种|一只|一条|一位|一名|的是|是|为|叫做|叫|的|the|a|an|is|are|am|be|as|called)/gi, "");
}

function isSubsequence(needle: string, haystack: string) {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index === needle.length) {
        return true;
      }
    }
  }

  return false;
}

function tokenizeForDeletion(text: string) {
  return tokenize(text).filter(isInformativeMemoryToken);
}

function isInformativeMemoryToken(token: string) {
  if (token.length < 2) {
    return false;
  }

  const lowInformationTokens = new Set([
    "我是",
    "我的",
    "是一",
    "一个",
    "一只",
    "一条",
    "这个",
    "那个",
    "记忆",
    "关于",
    "that",
    "this",
    "with",
    "have",
  ]);

  return !lowInformationTokens.has(token);
}

function calculateSimilarity(leftTerms: string[], rightTerms: string[]) {
  if (!leftTerms.length || !rightTerms.length) {
    return 0;
  }

  const left = new Set(leftTerms);
  const right = new Set(rightTerms);
  const intersection = [...left].filter((term) => right.has(term)).length;
  const union = new Set([...left, ...right]).size;

  return union ? intersection / union : 0;
}

function parseImportedMemories(payload: unknown): Array<{
  id?: string;
  type: AssistantMemoryType;
  content: string;
  sourceText?: string;
  facts?: AssistantMemoryFact[];
  createdAt?: number;
  updatedAt?: number;
}> {
  const rawMemories = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null && Array.isArray((payload as { memories?: unknown }).memories)
      ? (payload as { memories: unknown[] }).memories
      : undefined;

  if (!rawMemories) {
    throw new Error("Invalid memory export format.");
  }

  return rawMemories.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new Error("Invalid memory record.");
    }

    const record = item as Partial<AssistantMemory>;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!content) {
      throw new Error("Memory content is required.");
    }

    const type = isAssistantMemoryType(record.type) ? record.type : classifyMemoryType(content);
    return {
      id: typeof record.id === "string" && record.id ? record.id : undefined,
      type,
      content,
      sourceText: typeof record.sourceText === "string" ? record.sourceText : undefined,
      facts: normalizeMemoryFacts(record.facts, content),
      createdAt: typeof record.createdAt === "number" ? record.createdAt : undefined,
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : undefined,
    };
  });
}

function isAssistantMemoryType(value: unknown): value is AssistantMemoryType {
  return value === "preference" || value === "fact" || value === "project" || value === "task";
}

function normalizeTimestamp(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeSuggestedMemory(input: string) {
  return input
    .trim()
    .replace(/^[“"']|[”"']$/g, "")
    .replace(/[。.!！?？\s]+$/g, "")
    .trim();
}

function normalizeMemoryFacts(facts: unknown, fallbackSourceText: string): AssistantMemoryFact[] | undefined {
  if (!Array.isArray(facts)) {
    return undefined;
  }

  const normalizedFacts = facts
    .map((fact) => normalizeMemoryFact(fact, fallbackSourceText))
    .filter((fact): fact is AssistantMemoryFact => Boolean(fact));

  return normalizedFacts.length ? normalizedFacts : undefined;
}

function normalizeMemoryFact(fact: unknown, fallbackSourceText: string): AssistantMemoryFact | undefined {
  if (typeof fact !== "object" || fact === null) {
    return undefined;
  }

  const record = fact as Partial<AssistantMemoryFact>;
  const subject = typeof record.subject === "string" ? record.subject.trim() : "";
  const predicate = typeof record.predicate === "string" ? normalizeAssistantMemoryFactPredicate(record.predicate) : "";
  const value = typeof record.value === "string" ? record.value.trim() : "";
  if (!subject || !predicate || !value) {
    return undefined;
  }

  const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
    ? Math.min(Math.max(record.confidence, 0), 1)
    : 0.75;
  const sourceText = typeof record.sourceText === "string" && record.sourceText.trim()
    ? record.sourceText.trim()
    : fallbackSourceText.trim();
  const normalizedText = typeof record.normalizedText === "string" && record.normalizedText.trim()
    ? record.normalizedText.trim()
    : `${subject} ${predicate} ${value}`;

  return {
    subject,
    predicate,
    value,
    confidence,
    sourceText,
    normalizedText,
  };
}

function tokenizeMemory(content: string, facts: AssistantMemoryFact[] | undefined) {
  const factText = facts?.map((fact) => `${fact.subject} ${fact.predicate} ${fact.value} ${fact.normalizedText}`).join(" ") ?? "";
  return tokenize(`${content} ${factText}`);
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
