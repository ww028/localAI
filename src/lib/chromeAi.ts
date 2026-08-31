export type AiTask =
  | "prompt"
  | "summarize"
  | "translate"
  | "detect-language"
  | "write"
  | "rewrite";

export type Locale = "zh" | "en";

export type CapabilityStatus = {
  task: AiTask;
  label: string;
  globalName: keyof Window;
  availability: ChromeAiAvailability | "missing" | "unknown";
  ready: boolean;
};

export type TaskProgress = {
  message: string;
  ratio?: number;
};

export type RunTaskInput = {
  task: AiTask;
  text: string;
  locale?: Locale;
  onProgress?: (progress: TaskProgress) => void;
};

type CapabilityDefinition = {
  task: AiTask;
  label: string;
  globalName: keyof Window;
  availabilityOptions?: Record<string, unknown>;
  createOptions?: Record<string, unknown>;
};

const promptLanguageOptions = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

export const capabilityDefinitions: CapabilityDefinition[] = [
  {
    task: "prompt",
    label: "Prompt",
    globalName: "LanguageModel",
    availabilityOptions: promptLanguageOptions,
    createOptions: promptLanguageOptions,
  },
  {
    task: "summarize",
    label: "Summarizer",
    globalName: "Summarizer",
    availabilityOptions: {
      type: "key-points",
      format: "markdown",
      length: "medium",
    },
    createOptions: {
      type: "key-points",
      format: "markdown",
      length: "medium",
    },
  },
  {
    task: "translate",
    label: "Translator",
    globalName: "Translator",
    availabilityOptions: {
      sourceLanguage: "en",
      targetLanguage: "zh",
    },
    createOptions: {
      sourceLanguage: "en",
      targetLanguage: "zh",
    },
  },
  {
    task: "detect-language",
    label: "Language Detector",
    globalName: "LanguageDetector",
  },
  {
    task: "write",
    label: "Writer",
    globalName: "Writer",
  },
  {
    task: "rewrite",
    label: "Rewriter",
    globalName: "Rewriter",
  },
];

const fallbackPrompts: Record<Locale, Record<AiTask, string>> = {
  zh: {
    prompt: "用三条要点说明 Chrome 内置 AI 能在浏览器里做什么。",
    summarize:
      "Chrome 内置 AI 让网站和扩展可以使用浏览器本地模型完成隐私友好、低延迟的任务。它可以在相关 API 可用时支持提示词对话、摘要、翻译、语言检测、写作和改写。",
    translate: "Chrome runs this translation locally in the browser.",
    "detect-language": "Chrome 内置 AI 在浏览器本地运行。",
    write: "为一个本地优先的浏览器 AI 功能写一段简短产品介绍。",
    rewrite: "这个功能使用浏览器本地模型，因此用户的私密文本可以留在自己的设备上。",
  },
  en: {
    prompt: "Explain what Chrome Built-in AI can do in three concise bullets.",
    summarize:
      "Chrome Built-in AI lets websites and extensions use local browser models for private, low-latency tasks. It can support prompting, summarization, translation, language detection, writing, and rewriting when the relevant APIs are available.",
    translate: "Chrome runs this translation locally in the browser.",
    "detect-language": "Chrome built-in AI runs locally in the browser.",
    write: "Create a short product note for a local-first AI browser feature.",
    rewrite:
      "This feature uses a browser model, so private text can stay on the user's device.",
  },
};

const messages: Record<Locale, Record<string, string>> = {
  zh: {
    inputRequired: "请输入要处理的文本。",
    unsupportedTask: "不支持的任务",
    apiMissing: "这个浏览器上下文没有暴露该 API",
    apiUnavailable: "该 API 在当前浏览器或设备上不可用",
    checkingAvailability: "正在检查 API 可用性",
    creatingSession: "正在创建本地 AI 会话",
    downloadingModel: "正在下载模型资源",
    runningInference: "正在本地推理",
    noLanguageDetected: "未检测到语言。",
    unknownLanguage: "未知语言",
  },
  en: {
    inputRequired: "Input text is required.",
    unsupportedTask: "Unsupported task",
    apiMissing: "API is not exposed in this browser context",
    apiUnavailable: "API is unavailable on this browser or device",
    checkingAvailability: "Checking API availability",
    creatingSession: "Creating local AI session",
    downloadingModel: "Downloading model assets",
    runningInference: "Running local inference",
    noLanguageDetected: "No language detected.",
    unknownLanguage: "unknown",
  },
};

export function getDefaultInput(task: AiTask, locale: Locale = "zh") {
  return fallbackPrompts[locale][task];
}

export async function inspectCapabilities(): Promise<CapabilityStatus[]> {
  return Promise.all(capabilityDefinitions.map(inspectCapability));
}

async function inspectCapability(definition: CapabilityDefinition): Promise<CapabilityStatus> {
  const factory = window[definition.globalName] as ChromeAiFactory<unknown> | undefined;

  if (!factory?.create) {
    return {
      task: definition.task,
      label: definition.label,
      globalName: definition.globalName,
      availability: "missing",
      ready: false,
    };
  }

  if (!factory.availability) {
    return {
      task: definition.task,
      label: definition.label,
      globalName: definition.globalName,
      availability: "unknown",
      ready: true,
    };
  }

  const availability = await factory.availability(definition.availabilityOptions);

  return {
    task: definition.task,
    label: definition.label,
    globalName: definition.globalName,
    availability,
    ready: availability !== "unavailable",
  };
}

export async function runAiTask({ task, text, locale = "zh", onProgress }: RunTaskInput): Promise<string> {
  const trimmedText = text.trim();
  const copy = messages[locale];

  if (!trimmedText) {
    throw new Error(copy.inputRequired);
  }

  const definition = capabilityDefinitions.find((item) => item.task === task);
  if (!definition) {
    throw new Error(`${copy.unsupportedTask}: ${task}`);
  }

  const factory = window[definition.globalName] as ChromeAiFactory<unknown> | undefined;
  if (!factory?.create) {
    throw new Error(`${definition.label} ${copy.apiMissing}.`);
  }

  onProgress?.({ message: copy.checkingAvailability });
  if (factory.availability) {
    const availability = await factory.availability(definition.availabilityOptions);
    if (availability === "unavailable") {
      throw new Error(`${definition.label} ${copy.apiUnavailable}.`);
    }
  }

  onProgress?.({ message: copy.creatingSession });
  const session = await factory.create({
    ...definition.createOptions,
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        const loaded = typeof event.loaded === "number" ? event.loaded : undefined;
        const total = typeof event.total === "number" && event.total > 0 ? event.total : undefined;
        onProgress?.({
          message: copy.downloadingModel,
          ratio: total ? loaded! / total : loaded,
        });
      });
    },
  });

  try {
    onProgress?.({ message: copy.runningInference });
    return await executeSessionTask(task, session, trimmedText, locale);
  } finally {
    destroySession(session);
  }
}

async function executeSessionTask(task: AiTask, session: unknown, text: string, locale: Locale): Promise<string> {
  switch (task) {
    case "prompt":
      return (session as LanguageModelSession).prompt(text);
    case "summarize":
      return (session as SummarizerSession).summarize(text);
    case "translate":
      return (session as TranslatorSession).translate(text);
    case "detect-language":
      return formatLanguageDetection(await (session as LanguageDetectorSession).detect(text), locale);
    case "write":
      return (session as WriterSession).write(text);
    case "rewrite":
      return (session as RewriterSession).rewrite(text);
  }
}

function formatLanguageDetection(
  results: Array<{ detectedLanguage?: string; language?: string; confidence?: number }>,
  locale: Locale,
) {
  const copy = messages[locale];

  if (!results.length) {
    return copy.noLanguageDetected;
  }

  return results
    .map((result, index) => {
      const language = result.detectedLanguage ?? result.language ?? copy.unknownLanguage;
      const confidence =
        typeof result.confidence === "number" ? ` (${Math.round(result.confidence * 100)}%)` : "";
      return `${index + 1}. ${language}${confidence}`;
    })
    .join("\n");
}

function destroySession(session: unknown) {
  const maybeSession = session as { destroy?: () => void };
  maybeSession.destroy?.();
}
