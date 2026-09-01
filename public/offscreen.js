const DB_NAME = "local-ai";
const DB_VERSION = 1;
const STORE_NAME = "conversations";
const runningTasks = new Set();

function getPromptOptionCandidates(locale) {
  const preferredLanguages = locale === "zh" ? ["zh", "zh-Hans", "en"] : ["en"];
  return [
    ...preferredLanguages.map((language) => ({
      expectedInputs: [{ type: "text", languages: [language] }],
      expectedOutputs: [{ type: "text", languages: [language] }],
    })),
    undefined,
  ];
}

function getTranslateOptionCandidates(locale, text = "") {
  const direction = detectTranslationDirection(text, locale);
  const languagePairs = direction === "zh-to-en"
    ? [
        { sourceLanguage: "zh", targetLanguage: "en" },
        { sourceLanguage: "zh-Hans", targetLanguage: "en" },
      ]
    : [
        { sourceLanguage: "en", targetLanguage: "zh" },
        { sourceLanguage: "en", targetLanguage: "zh-Hans" },
      ];

  return languagePairs;
}

function getRewriteOptionCandidates() {
  return [
    {
      tone: "more-formal",
      format: "plain-text",
      length: "as-is",
    },
    undefined,
  ];
}

const taskDefinitions = {
  prompt: {
    globalName: "LanguageModel",
    method: "prompt",
    getOptionCandidates: getPromptOptionCandidates,
  },
  summarize: {
    globalName: "Summarizer",
    method: "summarize",
    options: {
      type: "key-points",
      format: "markdown",
      length: "medium",
    },
  },
  translate: {
    globalName: "Translator",
    method: "translate",
    getOptionCandidates: getTranslateOptionCandidates,
  },
  write: {
    globalName: "Writer",
    method: "write",
  },
  rewrite: {
    globalName: "Rewriter",
    method: "rewrite",
    getOptionCandidates: getRewriteOptionCandidates,
  },
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

async function updateConversationStatus(conversation, status) {
  await saveConversation({
    ...conversation,
    status,
    taskState: conversation.taskState
      ? {
          ...conversation.taskState,
          status,
          updatedAt: Date.now(),
        }
      : undefined,
    updatedAt: Date.now(),
  });
}

async function runAiTask(task, text, locale, onStatus) {
  const definition = taskDefinitions[task] ?? taskDefinitions.prompt;
  const factory = window[definition.globalName];
  if (!factory?.create) {
    if (task !== "prompt") {
      return runPromptFallbackTask(task, text, locale, onStatus);
    }
    throw new Error(locale === "zh" ? `${definition.globalName} 在当前后台页面不可用。` : `${definition.globalName} is unavailable in the background page.`);
  }

  try {
    const session = await createTaskSession(factory, definition, locale, text, onStatus);
    try {
      const method = session[definition.method];
      if (typeof method !== "function") {
        throw new Error(locale === "zh" ? "后台 AI 会话不支持该任务。" : "The background AI session does not support this task.");
      }
      await onStatus?.("running");
      return await method.call(session, text);
    } finally {
      session.destroy?.();
    }
  } catch (error) {
    if (task !== "prompt") {
      return runPromptFallbackTask(task, text, locale, onStatus);
    }
    throw error;
  }
}

async function runPromptFallbackTask(task, text, locale, onStatus) {
  const languageModel = window.LanguageModel;
  if (!languageModel?.create) {
    throw new Error(locale === "zh" ? "当前后台页面没有可用的 Chrome AI 能力。" : "No Chrome AI capability is available in the background page.");
  }

  const session = await createTaskSession(languageModel, taskDefinitions.prompt, locale, text, onStatus);
  try {
    await onStatus?.("running");
    return await session.prompt(buildFallbackPrompt(task, text, locale));
  } finally {
    session.destroy?.();
  }
}

function buildFallbackPrompt(task, text, locale) {
  const direction = detectTranslationDirection(text, locale);
  const prompts = {
    zh: {
      summarize: `请用中文把下面内容总结为清晰的要点，保留关键信息：\n\n${text}`,
      translate:
        direction === "zh-to-en"
          ? `请把下面中文翻译成自然准确的英文，只输出译文：\n\n${text}`
          : `请把下面英文翻译成自然准确的中文，只输出译文：\n\n${text}`,
      write: `请根据下面要求写一段清晰、自然、可直接使用的文本：\n\n${text}`,
      rewrite: `请把下面文本润色改写为更清晰自然的表达，尽量保持原意和长度，只输出改写结果：\n\n${text}`,
    },
    en: {
      summarize: `Summarize the following content into clear bullet points while preserving key details:\n\n${text}`,
      translate:
        direction === "zh-to-en"
          ? `Translate the following Chinese text into natural, accurate English. Only output the translation:\n\n${text}`
          : `Translate the following English text into natural, accurate Chinese. Only output the translation:\n\n${text}`,
      write: `Write clear, natural, ready-to-use text based on this request:\n\n${text}`,
      rewrite: `Polish the following text for clearer, more natural wording. Keep the original meaning and roughly the same length. Only output the rewritten text:\n\n${text}`,
    },
  };

  return prompts[locale]?.[task] ?? text;
}

async function createTaskSession(factory, definition, locale, text, onStatus) {
  let lastError;

  for (const options of getOptionCandidates(definition, locale, text)) {
    try {
      await onStatus?.("checking");
      if (factory.availability) {
        const availability = await factory.availability(options);
        if (availability === "unavailable") {
          continue;
        }
      }

      await onStatus?.("creating-session");
      return await factory.create({
        ...options,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", () => {
            void onStatus?.("downloading");
          });
        },
      });
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(locale === "zh" ? "Prompt API 在当前浏览器或设备上不可用。" : "Prompt API is unavailable on this browser or device.");
}

function getOptionCandidates(definition, locale, text) {
  if (definition.getOptionCandidates) {
    return definition.getOptionCandidates(locale, text);
  }

  return [definition.options];
}

function detectTranslationDirection(text, locale) {
  if (!text.trim()) {
    return locale === "zh" ? "en-to-zh" : "zh-to-en";
  }

  const cjkMatches = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinMatches = text.match(/[A-Za-z]/g)?.length ?? 0;

  if (cjkMatches > 0 && cjkMatches >= latinMatches * 0.25) {
    return "zh-to-en";
  }

  return "en-to-zh";
}

async function handleRunTask(payload) {
  if (!payload || runningTasks.has(payload.conversation.id)) {
    return;
  }

  runningTasks.add(payload.conversation.id);

  try {
    const task = payload.task ?? "prompt";
    const text = payload.text ?? payload.prompt;
    const result = await runAiTask(task, text, payload.conversation.locale, (status) =>
      updateConversationStatus(payload.conversation, status),
    );
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
      status: "completed",
      taskState: payload.conversation.taskState
        ? {
            ...payload.conversation.taskState,
            status: "completed",
            updatedAt: Date.now(),
            completedAt: Date.now(),
          }
        : undefined,
      updatedAt: Date.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveConversation({
      ...payload.conversation,
      messages: [
        ...payload.conversation.messages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: message,
          sources: payload.sources ?? [],
        },
      ],
      status: "failed",
      taskState: payload.conversation.taskState
        ? {
            ...payload.conversation.taskState,
            status: "failed",
            error: message,
            updatedAt: Date.now(),
            completedAt: Date.now(),
          }
        : undefined,
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
