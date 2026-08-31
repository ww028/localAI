const DB_NAME = "local-ai";
const DB_VERSION = 1;
const STORE_NAME = "conversations";
const runningTasks = new Set();
const promptLanguageOptions = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

async function saveConversation(conversation) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(conversation);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to save conversation."));
    };
  });
}

async function runPrompt(text, locale) {
  const languageModel = window.LanguageModel;
  if (!languageModel?.create) {
    throw new Error(locale === "zh" ? "Prompt API 在当前后台页面不可用。" : "Prompt API is unavailable in the background page.");
  }

  if (languageModel.availability) {
    const availability = await languageModel.availability(promptLanguageOptions);
    if (availability === "unavailable") {
      throw new Error(locale === "zh" ? "Prompt API 在当前浏览器或设备上不可用。" : "Prompt API is unavailable on this browser or device.");
    }
  }

  const session = await languageModel.create(promptLanguageOptions);
  try {
    return await session.prompt(text);
  } finally {
    session.destroy?.();
  }
}

async function handleRunTask(payload) {
  if (!payload || runningTasks.has(payload.conversation.id)) {
    return;
  }

  runningTasks.add(payload.conversation.id);

  try {
    const result = await runPrompt(payload.prompt, payload.conversation.locale);
    await saveConversation({
      ...payload.conversation,
      messages: [
        ...payload.conversation.messages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: result,
          sources: payload.sources ?? [],
        },
      ],
      status: "idle",
      updatedAt: Date.now(),
    });
  } catch (error) {
    await saveConversation({
      ...payload.conversation,
      messages: [
        ...payload.conversation.messages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: error instanceof Error ? error.message : String(error),
          sources: payload.sources ?? [],
        },
      ],
      status: "idle",
      updatedAt: Date.now(),
    });
  } finally {
    runningTasks.delete(payload.conversation.id);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "offscreen" || message?.type !== "RUN_LOCAL_AI_TASK") {
    return;
  }

  void handleRunTask(message.payload);
});
