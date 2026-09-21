import type { ContextPlan } from "./lib/assistantContextPlan";
import type { StoredMessageSource } from "./lib/conversationStore";
import { finalizeAssistantAnswer } from "./lib/finalizeAssistantAnswer";
import {
  buildFallbackPrompt,
  detectTranslationDirection,
  getPromptOptionCandidates,
  getRewriteOptionCandidates,
  getSummarizeOptionCandidates,
  getTranslateOptionCandidates,
} from "./lib/chromeAiShared";

const DB_NAME = "local-ai";
const DB_VERSION = 1;
const STORE_NAME = "conversations";
const runningTasks = new Set<string>();

type OffscreenLocale = "zh" | "en";
type BackgroundTask = "prompt" | "summarize" | "translate" | "write" | "rewrite";
type OffscreenTaskDefinition = {
  globalName: keyof Window;
  method: string;
  getOptionCandidates?: (locale: OffscreenLocale, text?: string) => Array<Record<string, unknown>>;
};

const taskDefinitions: Record<BackgroundTask, OffscreenTaskDefinition> = {
  prompt: {
    globalName: "LanguageModel",
    method: "prompt",
    getOptionCandidates: (locale) => getPromptOptionCandidates().map(({ createOptions }) => createOptions ?? {}),
  },
  summarize: {
    globalName: "Summarizer",
    method: "summarize",
    getOptionCandidates: (locale) => getSummarizeOptionCandidates(locale).map(({ createOptions }) => createOptions ?? {}),
  },
  translate: {
    globalName: "Translator",
    method: "translate",
    getOptionCandidates: (locale, text) => getTranslateOptionCandidates(locale, text).map(({ createOptions }) => createOptions ?? {}),
  },
  write: {
    globalName: "Writer",
    method: "write",
  },
  rewrite: {
    globalName: "Rewriter",
    method: "rewrite",
    getOptionCandidates: () => getRewriteOptionCandidates().map(({ createOptions }) => createOptions ?? {}),
  },
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
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

async function saveConversation(conversation: Record<string, unknown>) {
  const db = await openDatabase();

  return new Promise<void>((resolve, reject) => {
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

async function updateConversationStatus(conversation: Record<string, unknown>, status: string) {
  await saveConversation({
    ...conversation,
    status,
    taskState: conversation.taskState
      ? {
          ...(conversation.taskState as Record<string, unknown>),
          status,
          updatedAt: Date.now(),
        }
      : undefined,
    updatedAt: Date.now(),
  });
}

async function runAiTask(task: BackgroundTask, text: string, locale: OffscreenLocale, onStatus?: (status: string) => Promise<void>) {
  const definition = taskDefinitions[task] ?? taskDefinitions.prompt;
  const factory = window[definition.globalName] as ChromeAiFactory<Record<string, unknown>> | undefined;
  if (!factory?.create) {
    if (task !== "prompt") {
      return runPromptFallbackTask(task, text, locale, onStatus);
    }
    throw new Error(locale === "zh" ? `${String(definition.globalName)} 在当前后台页面不可用。` : `${String(definition.globalName)} is unavailable in the background page.`);
  }

  try {
    const session = await createTaskSession(factory, definition, locale, text, onStatus);
    try {
      const method = session[definition.method as keyof typeof session];
      if (typeof method !== "function") {
        throw new Error(locale === "zh" ? "后台 AI 会话不支持该任务。" : "The background AI session does not support this task.");
      }
      await onStatus?.("running");
      return await method.call(session, text);
    } finally {
      (session as { destroy?: () => void }).destroy?.();
    }
  } catch (error) {
    if (task !== "prompt") {
      return runPromptFallbackTask(task, text, locale, onStatus);
    }
    throw error;
  }
}

async function runPromptFallbackTask(task: Exclude<BackgroundTask, "prompt">, text: string, locale: OffscreenLocale, onStatus?: (status: string) => Promise<void>) {
  const languageModel = window.LanguageModel as ChromeAiFactory<Record<string, unknown>> | undefined;
  if (!languageModel?.create) {
    throw new Error(locale === "zh" ? "当前后台页面没有可用的 Chrome AI 能力。" : "No Chrome AI capability is available in the background page.");
  }

  const session = await createTaskSession(languageModel, taskDefinitions.prompt, locale, text, onStatus);
  try {
    await onStatus?.("running");
    return await (session as LanguageModelSession).prompt(buildFallbackPrompt(task, text, locale));
  } finally {
    (session as { destroy?: () => void }).destroy?.();
  }
}

async function createTaskSession(
  factory: ChromeAiFactory<Record<string, unknown>>,
  definition: OffscreenTaskDefinition,
  locale: OffscreenLocale,
  text: string,
  onStatus?: (status: string) => Promise<void>,
) {
  let lastError: unknown;

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

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(locale === "zh" ? "Prompt API 在当前浏览器或设备上不可用。" : "Prompt API is unavailable on this browser or device.");
}

function getOptionCandidates(definition: OffscreenTaskDefinition, locale: OffscreenLocale, text: string) {
  if (definition.getOptionCandidates) {
    return definition.getOptionCandidates(locale, text);
  }

  return [{}];
}

type OffscreenPayload = {
  conversation: Record<string, unknown> & { id: string; locale: OffscreenLocale; messages: Array<Record<string, unknown>>; taskState?: Record<string, unknown> };
  task?: BackgroundTask;
  text?: string;
  prompt?: string;
  sources?: Array<Record<string, unknown>>;
};

async function handleRunTask(payload: OffscreenPayload) {
  if (!payload || runningTasks.has(payload.conversation.id)) {
    return;
  }

  runningTasks.add(payload.conversation.id);

  try {
    const task = payload.task ?? "prompt";
    const text = payload.text ?? payload.prompt ?? "";
    const result = await runAiTask(task, text, payload.conversation.locale, (status) =>
      updateConversationStatus(payload.conversation, status),
    );
    const responseSources = (payload.sources ?? []) as StoredMessageSource[];
    const cleanedResult = finalizeAssistantAnswer({
      rawText: result,
      contextPlan: payload.conversation.taskState?.contextPlan as ContextPlan | undefined,
      messageSources: responseSources,
      locale: payload.conversation.locale,
    });
    await saveConversation({
      ...payload.conversation,
      messages: [
        ...payload.conversation.messages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: cleanedResult.text,
          sources: responseSources,
        },
      ],
      status: "completed",
      taskState: payload.conversation.taskState
        ? {
            ...payload.conversation.taskState,
            status: "completed",
            guardEvents: cleanedResult.guardEvents,
            rawModelOutput: result,
            finalizedOutput: cleanedResult.text,
            updatedAt: Date.now(),
            completedAt: Date.now(),
          }
        : undefined,
      updatedAt: Date.now(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const deterministicExecution = payload.conversation.taskState?.deterministicExecution as { handled?: boolean; resultText?: string; error?: string; tool?: string; resultData?: unknown } | undefined;
    const hasDeterministicResult = Boolean(deterministicExecution?.handled && (deterministicExecution.resultText || deterministicExecution.error));
    const message = hasDeterministicResult
      ? formatDeterministicExecution(deterministicExecution ?? {}, payload.conversation.locale)
      : errorMessage;
    const status = hasDeterministicResult ? "completed" : "failed";
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
      status,
      taskState: payload.conversation.taskState
        ? {
            ...payload.conversation.taskState,
            status,
            error: hasDeterministicResult ? undefined : errorMessage,
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

function formatDeterministicExecution(
  execution: { tool?: string; resultData?: unknown; error?: string; resultText?: string },
  locale: OffscreenLocale,
) {
  const serialized = JSON.stringify({
    tool: execution.tool,
    resultData: execution.resultData,
    error: execution.error,
  }, null, 2);
  const label = locale === "zh" ? "确定性执行结果" : "Deterministic execution result";
  return `${label}：\n${execution.resultText ?? execution.error ?? ""}\n\n\`\`\`json\n${serialized}\n\`\`\``;
}

const chromeApi = (globalThis as { chrome?: { runtime?: { onMessage?: { addListener?: (listener: (message: Record<string, unknown>) => void) => void } } } }).chrome;
chromeApi?.runtime?.onMessage?.addListener?.((message: Record<string, unknown>) => {
  if (message.target !== "offscreen" || message.type !== "RUN_LOCAL_AI_TASK") {
    return;
  }

  void handleRunTask(message.payload as OffscreenPayload);
});
