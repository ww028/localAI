import {
  Brain,
  Clipboard,
  Database,
  Download,
  Ellipsis,
  FileText,
  Globe2,
  Languages,
  PenLine,
  RefreshCw,
  RotateCcw,
  Save,
  WandSparkles,
  SquareArrowOutUpRight,
  ThumbsDown,
  ThumbsUp,
  LoaderCircle,
  PanelLeft,
  PanelRightOpen,
  Plus,
  Send,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type AiTask,
  type CapabilityStatus,
  type Locale,
  inspectCapabilities,
  runAiTask,
} from "./lib/chromeAi";
import {
  type ConversationStatus,
  type StoredConversation,
  type StoredChatMessage,
  type StoredTaskState,
  getConversation,
  isConversationActive,
  listConversations,
  saveConversation,
} from "./lib/conversationStore";
import { buildAssistantPrompt } from "./lib/assistantPrompt";
import {
  executeDeterministicTask,
  formatDeterministicExecution,
} from "./lib/assistantDeterministicExecutor";
import { detectAssistantIntent } from "./lib/assistantIntent";
import { createAssistantPlan } from "./lib/assistantPlanner";
import {
  type AssistantMemory,
  type AssistantMemoryCommand,
  type AssistantMemoryType,
  deleteAssistantMemory,
  deleteAssistantMemoriesByQuery,
  exportAssistantMemories,
  listAssistantMemories,
  parseAssistantMemoryCommand,
  saveAssistantMemory,
  searchAssistantMemories,
  updateAssistantMemory,
} from "./lib/assistantMemoryStore";
import {
  type KnowledgeDocument,
  type KnowledgeMatch,
  type KnowledgeSpace,
  clearKnowledgeDocuments,
  createKnowledgeSpace,
  deleteKnowledgeDocument,
  importKnowledgeFiles,
  listKnowledgeDocuments,
  listKnowledgeSpaces,
  rebuildKnowledgeIndex,
  searchKnowledge,
} from "./lib/knowledgeStore";

type ChatMessage = StoredChatMessage;
type MessageSource = NonNullable<ChatMessage["sources"]>[number];
type Surface = "popup" | "sidepanel" | "tab";
type WebPageAction = "summary" | "qa" | "todos" | "notes";
type TextAction = Extract<AiTask, "summarize" | "translate" | "write" | "rewrite">;
type WebPageSnapshot = {
  title: string;
  url: string;
  text: string;
  extractedAt?: number;
};
const SURFACE_CHANNEL = "localai-surface";
const MAX_PAGE_CONTEXT_LENGTH = 16000;

const translations: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    heroQuestion: string;
    placeholder: string;
    send: string;
    checking: string;
    complete: string;
    copy: string;
    copied: string;
    clearKnowledge: string;
    deleteKnowledge: string;
    emptyKnowledge: string;
    importKnowledge: string;
    knowledgeImported: string;
    knowledgeCleared: string;
    knowledgeDeleted: string;
    knowledgeFiles: string;
    knowledgeSpace: string;
    newKnowledgeSpace: string;
    knowledgeSpaceCreated: string;
    rebuildKnowledgeIndex: string;
    knowledgeIndexRebuilt: string;
    knowledgeIndexEmpty: string;
    webPage: string;
    summarizePage: string;
    askPage: string;
    extractPageTodos: string;
    createPageNotes: string;
    savePageToKnowledge: string;
    pageSavedToKnowledge: string;
    readingPage: string;
    pageReadError: string;
    sourcePreview: string;
    closeSourcePreview: string;
    noKnowledgeUsed: string;
    appAlreadyOpen: string;
    openSidePanel: string;
    openTab: string;
    openSurfaceError: string;
    chatLabel: string;
    inputLabel: string;
    assistantLabel: string;
    userLabel: string;
    history: string;
    emptyHistory: string;
    newConversation: string;
    knowledge: string;
    moreSkills: string;
    unavailableHint: string;
    statusLabels: Record<string, string>;
    inspectError: string;
    taskError: string;
    continueTask: string;
    taskResumed: string;
    memorySaved: string;
    memoryDeleted: string;
    memoryNotFound: string;
    memories: string;
    memoryCount: string;
    emptyMemories: string;
    editMemory: string;
    saveMemory: string;
    cancelEdit: string;
    exportMemories: string;
    memoryUpdated: string;
    summarizeText: string;
    translateText: string;
    writeText: string;
    rewriteText: string;
    textActionInputRequired: string;
  }
> = {
  zh: {
    eyebrow: "Chrome 内置 AI",
    title: "新工作任务",
    subtitle: "本地模型 · 浏览器内运行",
    heroQuestion: "有什么我能帮你的吗？",
    placeholder: "发消息或按住 Fn 说话，/ 选择技能",
    send: "发送",
    checking: "检查中",
    complete: "完成",
    copy: "复制",
    copied: "复制成功",
    clearKnowledge: "清空知识库",
    deleteKnowledge: "删除知识文件",
    emptyKnowledge: "暂无知识文件",
    importKnowledge: "导入本地知识",
    knowledgeImported: "已导入知识库",
    knowledgeCleared: "已清空知识库",
    knowledgeDeleted: "已删除知识文件",
    knowledgeFiles: "知识文件",
    knowledgeSpace: "知识空间",
    newKnowledgeSpace: "新建空间",
    knowledgeSpaceCreated: "已创建知识空间",
    rebuildKnowledgeIndex: "重建索引",
    knowledgeIndexRebuilt: "知识索引已重建",
    knowledgeIndexEmpty: "当前空间没有知识文件",
    webPage: "当前网页",
    summarizePage: "摘要",
    askPage: "问网页",
    extractPageTodos: "待办",
    createPageNotes: "笔记",
    savePageToKnowledge: "保存到知识库",
    pageSavedToKnowledge: "网页已保存到知识库",
    readingPage: "正在读取网页",
    pageReadError: "无法读取当前网页",
    sourcePreview: "引用片段",
    closeSourcePreview: "关闭引用预览",
    noKnowledgeUsed: "未检索到相关知识",
    appAlreadyOpen: "插件已经打开了",
    openSidePanel: "打开侧边栏",
    openTab: "打开新标签页",
    openSurfaceError: "当前浏览器不支持这个打开方式",
    chatLabel: "本地 AI 对话",
    inputLabel: "消息",
    assistantLabel: "localAI",
    userLabel: "你",
    history: "历史对话",
    emptyHistory: "暂无历史对话",
    newConversation: "新建对话",
    knowledge: "浏览器知识",
    moreSkills: "更多技能",
    unavailableHint: "当前 Prompt API 不可用，请检查 Chrome 版本、flags 或模型下载状态。",
    statusLabels: {
      available: "可用",
      downloadable: "可下载",
      downloading: "下载中",
      unavailable: "不可用",
      missing: "缺失",
      unknown: "未知",
      checking: "检查中",
    },
    inspectError: "检查 Chrome AI API 失败。",
    taskError: "AI 任务执行失败。",
    continueTask: "继续任务",
    taskResumed: "任务已继续",
    memorySaved: "已记住",
    memoryDeleted: "已删除相关记忆",
    memoryNotFound: "没有找到相关记忆",
    memories: "个人记忆",
    memoryCount: "记忆",
    emptyMemories: "暂无记忆",
    editMemory: "编辑记忆",
    saveMemory: "保存记忆",
    cancelEdit: "取消编辑",
    exportMemories: "导出记忆",
    memoryUpdated: "记忆已更新",
    summarizeText: "摘要文本",
    translateText: "中英互译",
    writeText: "写作",
    rewriteText: "润色改写",
    textActionInputRequired: "请输入要处理的文本",
  },
  en: {
    eyebrow: "Chrome Built-in AI",
    title: "New Work Task",
    subtitle: "Local model · Runs in the browser",
    heroQuestion: "What can I help with?",
    placeholder: "Send a message, hold Fn to talk, or use / for skills",
    send: "Send",
    checking: "checking",
    complete: "Complete",
    copy: "Copy",
    copied: "Copied",
    clearKnowledge: "Clear knowledge",
    deleteKnowledge: "Delete knowledge file",
    emptyKnowledge: "No knowledge files",
    importKnowledge: "Import local knowledge",
    knowledgeImported: "Knowledge imported",
    knowledgeCleared: "Knowledge cleared",
    knowledgeDeleted: "Knowledge file deleted",
    knowledgeFiles: "Knowledge files",
    knowledgeSpace: "Knowledge space",
    newKnowledgeSpace: "New space",
    knowledgeSpaceCreated: "Knowledge space created",
    rebuildKnowledgeIndex: "Rebuild index",
    knowledgeIndexRebuilt: "Knowledge index rebuilt",
    knowledgeIndexEmpty: "No knowledge files in this space",
    webPage: "Current page",
    summarizePage: "Summary",
    askPage: "Ask page",
    extractPageTodos: "Todos",
    createPageNotes: "Notes",
    savePageToKnowledge: "Save to knowledge",
    pageSavedToKnowledge: "Page saved to knowledge",
    readingPage: "Reading page",
    pageReadError: "Failed to read current page",
    sourcePreview: "Source snippet",
    closeSourcePreview: "Close source preview",
    noKnowledgeUsed: "No relevant knowledge found",
    appAlreadyOpen: "localAI is already open",
    openSidePanel: "Open side panel",
    openTab: "Open chat tab",
    openSurfaceError: "This browser does not support this launch mode",
    chatLabel: "Local AI chat",
    inputLabel: "Message",
    assistantLabel: "localAI",
    userLabel: "You",
    history: "Conversation history",
    emptyHistory: "No conversations yet",
    newConversation: "New conversation",
    knowledge: "Browser knowledge",
    moreSkills: "More skills",
    unavailableHint: "Prompt API is unavailable. Check Chrome version, flags, or model download state.",
    statusLabels: {
      available: "available",
      downloadable: "downloadable",
      downloading: "downloading",
      unavailable: "unavailable",
      missing: "missing",
      unknown: "unknown",
      checking: "checking",
    },
    inspectError: "Failed to inspect Chrome AI APIs.",
    taskError: "AI task failed.",
    continueTask: "Resume task",
    taskResumed: "Task resumed",
    memorySaved: "Memory saved",
    memoryDeleted: "Deleted related memories",
    memoryNotFound: "No related memory found",
    memories: "Memories",
    memoryCount: "memories",
    emptyMemories: "No memories yet",
    editMemory: "Edit memory",
    saveMemory: "Save memory",
    cancelEdit: "Cancel edit",
    exportMemories: "Export memories",
    memoryUpdated: "Memory updated",
    summarizeText: "Summarize text",
    translateText: "Translate zh/en",
    writeText: "Write",
    rewriteText: "Polish rewrite",
    textActionInputRequired: "Enter text to process",
  },
};

function getStatusTone(status: CapabilityStatus["availability"]) {
  if (status === "available") return "ready";
  if (status === "downloadable" || status === "downloading") return "pending";
  if (status === "missing" || status === "unavailable") return "blocked";
  return "neutral";
}

function getInitialSurface(): Surface {
  const surface = new URLSearchParams(window.location.search).get("surface");
  if (surface === "sidepanel" || surface === "tab") {
    return surface;
  }
  if (surface === "window") {
    return "tab";
  }

  const chromeApi = getChromeExtensionApi();
  if (chromeApi?.runtime?.id && (window.innerWidth < 700 || window.innerHeight > 700)) {
    return "sidepanel";
  }

  return "popup";
}

function getDefaultComposerHeight(surface: Surface) {
  if (surface === "sidepanel") {
    return clampComposerHeight(216, surface);
  }

  if (surface === "tab") {
    return clampComposerHeight(180, surface);
  }

  return 108;
}

function getMinComposerHeight(surface: Surface) {
  if (surface === "sidepanel") {
    return 176;
  }

  if (surface === "tab") {
    return 160;
  }

  return 108;
}

function clampComposerHeight(height: number, surface: Surface) {
  const minHeight = getMinComposerHeight(surface);
  const maxHeight = Math.max(minHeight, Math.floor(window.innerHeight / 3));
  return Math.min(Math.max(height, minHeight), maxHeight);
}

export function App() {
  const [surface] = useState<Surface>(() => getInitialSurface());
  const canResizeComposer = surface !== "popup";
  const [locale, setLocale] = useState<Locale>("zh");
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [conversationCreatedAt, setConversationCreatedAt] = useState(() => Date.now());
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [progressRatio, setProgressRatio] = useState<number | undefined>();
  const [toast, setToast] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus | undefined>();
  const [taskState, setTaskState] = useState<StoredTaskState | undefined>();
  const [isReadingPage, setIsReadingPage] = useState(false);
  const [capabilities, setCapabilities] = useState<CapabilityStatus[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<StoredConversation[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [knowledgeSpaces, setKnowledgeSpaces] = useState<KnowledgeSpace[]>([]);
  const [activeKnowledgeSpaceId, setActiveKnowledgeSpaceId] = useState("default");
  const [newKnowledgeSpaceName, setNewKnowledgeSpaceName] = useState("");
  const [isRebuildingKnowledge, setIsRebuildingKnowledge] = useState(false);
  const [assistantMemories, setAssistantMemories] = useState<AssistantMemory[]>([]);
  const [editingMemoryId, setEditingMemoryId] = useState<string | undefined>();
  const [editingMemoryContent, setEditingMemoryContent] = useState("");
  const [editingMemoryType, setEditingMemoryType] = useState<AssistantMemoryType>("fact");
  const [sourcePreview, setSourcePreview] = useState<{
    messageId: string;
    index: number;
    source: MessageSource;
  } | undefined>();
  const [composerHeight, setComposerHeight] = useState(() => getDefaultComposerHeight(surface));
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSaveRef = useRef(false);
  const composerHeightRef = useRef(composerHeight);

  const copy = translations[locale];
  const promptCapability = useMemo(
    () => capabilities.find((capability) => capability.task === "prompt"),
    [capabilities],
  );
  const promptStatus = promptCapability?.availability ?? "checking";

  async function refreshCapabilities() {
    setError("");

    try {
      setCapabilities(await inspectCapabilities(locale));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.inspectError);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.surface = surface;
    void loadLatestConversation();
    void refreshKnowledgeSpaces();
    void refreshAssistantMemories();
  }, [surface]);

  useEffect(() => {
    void refreshKnowledgeCount();
  }, [activeKnowledgeSpaceId]);

  useEffect(() => {
    void refreshCapabilities();
  }, [locale]);

  useEffect(() => {
    composerHeightRef.current = composerHeight;
  }, [composerHeight]);

  useEffect(() => {
    if (!canResizeComposer) {
      return;
    }

    const handleResize = () => {
      setComposerHeight((height) => clampComposerHeight(height, surface));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [canResizeComposer, surface]);

  useEffect(() => {
    const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(SURFACE_CHANNEL);
    const runtime = getChromeExtensionApi()?.runtime;

    if (channel) {
      channel.onmessage = (event) => {
        if (surface === "sidepanel" && event.data?.type === "CLOSE_SIDE_PANEL") {
          window.close();
        }
      };
    }

    if (surface === "popup") {
      channel?.postMessage({ type: "CLOSE_SIDE_PANEL" });
      void notifyIfChatTabOpen();
    }

    const handleRuntimeMessage = (message: { target?: string; type?: string }) => {
      if (surface === "tab" && message?.target === "app" && message?.type === "SHOW_APP_ALREADY_OPEN") {
        setToast(copy.appAlreadyOpen);
      }
    };
    runtime?.onMessage?.addListener?.(handleRuntimeMessage);

    return () => {
      channel?.close();
      runtime?.onMessage?.removeListener?.(handleRuntimeMessage);
    };
  }, [copy.appAlreadyOpen, surface]);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) {
      return;
    }

    requestAnimationFrame(() => {
      messageList.scrollTo({
        top: messageList.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [messages, isRunning, progress]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(""), 1600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!messages.length || isRunning || !pendingSaveRef.current) {
      return;
    }

    const now = Date.now();
    const userTitle = messages.find((message) => message.role === "user")?.text.trim();

    void saveConversation({
      id: conversationId,
      title: userTitle ? userTitle.slice(0, 48) : copy.title,
      locale,
      messages,
      createdAt: conversationCreatedAt,
      updatedAt: now,
    }).then(() => {
      pendingSaveRef.current = false;
      void refreshHistory();
    });
  }, [conversationCreatedAt, conversationId, copy.title, isRunning, locale, messages]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const timer = window.setInterval(() => {
      void syncActiveConversation();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [conversationId, isRunning]);

  async function refreshHistory() {
    setHistory(await listConversations());
  }

  async function refreshKnowledgeCount(spaceId = activeKnowledgeSpaceId) {
    const documents = await listKnowledgeDocuments(spaceId);
    setKnowledgeDocuments(documents);
    setKnowledgeCount(documents.length);
  }

  async function refreshKnowledgeSpaces() {
    const spaces = await listKnowledgeSpaces();
    setKnowledgeSpaces(spaces);
    if (!spaces.some((space) => space.id === activeKnowledgeSpaceId)) {
      setActiveKnowledgeSpaceId(spaces[0]?.id ?? "default");
    }
  }

  async function refreshAssistantMemories() {
    setAssistantMemories(await listAssistantMemories());
  }

  async function loadLatestConversation() {
    const conversations = await listConversations();
    setHistory(conversations);

    const latestConversation = conversations[0];
    if (!latestConversation) {
      return;
    }

    setConversationId(latestConversation.id);
    setConversationCreatedAt(latestConversation.createdAt);
    setLocale(latestConversation.locale);
    setMessages(latestConversation.messages);
    setSourcePreview(undefined);
    setConversationStatus(latestConversation.status);
    setTaskState(latestConversation.taskState);
    setIsRunning(isConversationActive(latestConversation.status));
    if (isConversationActive(latestConversation.status)) {
      setProgress(formatTaskStatus(latestConversation.status, latestConversation.locale));
    }
  }

  async function syncActiveConversation() {
    const conversation = await getConversation(conversationId);
    if (!conversation) {
      return;
    }

    setMessages(conversation.messages);
    setConversationStatus(conversation.status);
    setTaskState(conversation.taskState);
    setSourcePreview((preview) =>
      preview && conversation.messages.some((message) => message.id === preview.messageId)
        ? preview
        : undefined,
    );
    const stillRunning = isConversationActive(conversation.status);
    setIsRunning(stillRunning);
    if (stillRunning) {
      setProgress(formatTaskStatus(conversation.status, conversation.locale));
    } else {
      setProgress("");
      setProgressRatio(undefined);
    }
    setHistory(await listConversations());
  }

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
  }

  async function handleRun() {
    const trimmedInput = input.trim();
    if (!trimmedInput || isRunning) {
      return;
    }

    setIsRunning(true);
    setError("");
    setProgressRatio(undefined);
    setInput("");

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmedInput,
    };

    pendingSaveRef.current = true;
    const nextMessages = [...messages, userMessage];
    const memoryCommand = parseAssistantMemoryCommand(trimmedInput);
    if (memoryCommand) {
      await handleMemoryCommand(memoryCommand, nextMessages, trimmedInput);
      return;
    }

    const sources = await searchKnowledge(trimmedInput, 5, activeKnowledgeSpaceId);
    const memories = await searchAssistantMemories(trimmedInput, 5);
    const intent = detectAssistantIntent(trimmedInput, locale);
    const plan = createAssistantPlan(intent, trimmedInput, locale);
    const deterministicExecution = executeDeterministicTask(trimmedInput, intent, plan, locale);
    const prompt = buildAssistantPrompt({
      question: trimmedInput,
      locale,
      intent,
      plan,
      deterministicExecution,
      sources,
      memories,
      recentMessages: messages,
    });
    const now = Date.now();
    const nextTaskState = createStoredTaskState({
      kind: "chat",
      aiTask: "prompt",
      status: "queued",
      originalInput: trimmedInput,
      promptText: prompt,
      sources,
      intent,
      plan,
      deterministicExecution,
      now,
    });
    const conversation: StoredConversation = {
      id: conversationId,
      title: trimmedInput.slice(0, 48),
      locale,
      messages: nextMessages,
      status: "queued",
      taskState: nextTaskState,
      createdAt: conversationCreatedAt,
      updatedAt: now,
    };

    setMessages(nextMessages);
    setConversationStatus(conversation.status);
    setTaskState(nextTaskState);
    await saveConversation(conversation);
    await refreshHistory();

    try {
      if (await submitBackgroundTask(conversation, prompt, sources)) {
        setProgress(locale === "zh" ? "后台推理中" : "Running in background");
      } else {
        const result = await runAiTask({
          task: "prompt",
          text: prompt,
          locale,
          onProgress(nextProgress) {
            setProgress(nextProgress.message);
            setProgressRatio(nextProgress.ratio);
          },
        });
        const completedConversation = {
          ...conversation,
          messages: [
            ...nextMessages,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              text: result,
              sources,
            },
          ],
          status: "completed" as const,
          taskState: updateStoredTaskState(nextTaskState, "completed"),
          updatedAt: Date.now(),
        };
        await saveConversation(completedConversation);
        setMessages(completedConversation.messages);
        setConversationStatus(completedConversation.status);
        setTaskState(completedConversation.taskState);
        setIsRunning(false);
        setProgress(copy.complete);
        await refreshHistory();
        await refreshCapabilities();
      }
    } catch (reason) {
      const message = deterministicExecution.handled
        ? formatDeterministicExecution(deterministicExecution, locale)
        : reason instanceof Error ? reason.message : copy.taskError;
      const failedConversation = {
        ...conversation,
        messages: [
          ...nextMessages,
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            text: message,
            sources,
          },
        ],
        status: deterministicExecution.handled ? "completed" as const : "failed" as const,
        taskState: updateStoredTaskState(
          nextTaskState,
          deterministicExecution.handled ? "completed" : "failed",
          deterministicExecution.handled ? undefined : message,
        ),
        updatedAt: Date.now(),
      };
      await saveConversation(failedConversation);
      setError(message);
      setMessages(failedConversation.messages);
      setConversationStatus(failedConversation.status);
      setTaskState(failedConversation.taskState);
      setProgress("");
      setIsRunning(false);
    } finally {
      pendingSaveRef.current = false;
    }
  }

  async function handleTextAction(task: TextAction) {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      setToast(copy.textActionInputRequired);
      return;
    }
    if (isRunning) {
      return;
    }

    setIsRunning(true);
    setError("");
    setProgressRatio(undefined);
    setInput("");

    const userText = formatTextActionUserMessage(task, trimmedInput, locale);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: userText,
    };
    const nextMessages = [...messages, userMessage];
    const now = Date.now();
    const nextTaskState = createStoredTaskState({
      kind: "text-action",
      aiTask: task,
      status: "queued",
      originalInput: trimmedInput,
      promptText: trimmedInput,
      sources: [],
      now,
    });
    const conversation: StoredConversation = {
      id: conversationId,
      title: userText.slice(0, 48),
      locale,
      messages: nextMessages,
      status: "queued",
      taskState: nextTaskState,
      createdAt: conversationCreatedAt,
      updatedAt: now,
    };

    pendingSaveRef.current = true;
    setMessages(nextMessages);
    setConversationStatus(conversation.status);
    setTaskState(nextTaskState);
    await saveConversation(conversation);
    await refreshHistory();

    try {
      if (await submitBackgroundTask(conversation, trimmedInput, [], task)) {
        setProgress(locale === "zh" ? "后台推理中" : "Running in background");
      } else {
        const result = await runAiTask({
          task,
          text: trimmedInput,
          locale,
          onProgress(nextProgress) {
            setProgress(nextProgress.message);
            setProgressRatio(nextProgress.ratio);
          },
        });
        const completedConversation = {
          ...conversation,
          messages: [
            ...nextMessages,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              text: result,
            },
          ],
          status: "completed" as const,
          taskState: updateStoredTaskState(nextTaskState, "completed"),
          updatedAt: Date.now(),
        };
        await saveConversation(completedConversation);
        setMessages(completedConversation.messages);
        setConversationStatus(completedConversation.status);
        setTaskState(completedConversation.taskState);
        setIsRunning(false);
        setProgress(copy.complete);
        await refreshHistory();
        await refreshCapabilities();
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : copy.taskError;
      const failedConversation = {
        ...conversation,
        messages: [
          ...nextMessages,
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            text: message,
          },
        ],
        status: "failed" as const,
        taskState: updateStoredTaskState(nextTaskState, "failed", message),
        updatedAt: Date.now(),
      };
      await saveConversation(failedConversation);
      setError(message);
      setMessages(failedConversation.messages);
      setConversationStatus(failedConversation.status);
      setTaskState(failedConversation.taskState);
      setProgress("");
      setIsRunning(false);
    } finally {
      pendingSaveRef.current = false;
    }
  }

  async function handleWebPageAction(action: WebPageAction) {
    if (isRunning || isReadingPage) {
      return;
    }

    setIsReadingPage(true);
    setIsRunning(true);
    setError("");
    setProgress(copy.readingPage);
    setProgressRatio(undefined);
    let activeTaskState: StoredTaskState | undefined;

    try {
      const question = input.trim();
      const page = await fetchActivePageText();
      const userText = formatWebPageUserMessage(action, page, question, locale);
      const prompt = buildWebPagePrompt(action, page, question, locale);
      setInput("");

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: userText,
      };
      const nextMessages = [...messages, userMessage];
      const now = Date.now();
      const nextTaskState = createStoredTaskState({
        kind: "web-page",
        aiTask: "prompt",
        status: "queued",
        originalInput: userText,
        promptText: prompt,
        sources: [],
        now,
      });
      activeTaskState = nextTaskState;
      const conversation: StoredConversation = {
        id: conversationId,
        title: userText.slice(0, 48),
        locale,
        messages: nextMessages,
        status: "queued",
        taskState: nextTaskState,
        createdAt: conversationCreatedAt,
        updatedAt: now,
      };

      pendingSaveRef.current = true;
      setMessages(nextMessages);
      setConversationStatus(conversation.status);
      setTaskState(nextTaskState);
      await saveConversation(conversation);
      await refreshHistory();

      if (await submitBackgroundTask(conversation, prompt, [])) {
        setProgress(locale === "zh" ? "后台推理中" : "Running in background");
      } else {
        const result = await runAiTask({
          task: "prompt",
          text: prompt,
          locale,
          onProgress(nextProgress) {
            setProgress(nextProgress.message);
            setProgressRatio(nextProgress.ratio);
          },
        });
        const completedConversation = {
          ...conversation,
          messages: [
            ...nextMessages,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              text: result,
            },
          ],
          status: "completed" as const,
          taskState: updateStoredTaskState(nextTaskState, "completed"),
          updatedAt: Date.now(),
        };
        await saveConversation(completedConversation);
        setMessages(completedConversation.messages);
        setConversationStatus(completedConversation.status);
        setTaskState(completedConversation.taskState);
        setIsRunning(false);
        setProgress(copy.complete);
        await refreshHistory();
        await refreshCapabilities();
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : copy.pageReadError;
      const failedTaskState = updateStoredTaskState(activeTaskState, "failed", message);
      if (failedTaskState) {
        const failedConversation: StoredConversation = {
          id: conversationId,
          title: failedTaskState.originalInput.slice(0, 48),
          locale,
          messages,
          status: "failed",
          taskState: failedTaskState,
          createdAt: conversationCreatedAt,
          updatedAt: Date.now(),
        };
        await saveConversation(failedConversation);
        setConversationStatus(failedConversation.status);
        setTaskState(failedTaskState);
        await refreshHistory();
      }
      setError(message);
      setToast(message);
      setProgress("");
      setIsRunning(false);
    } finally {
      setIsReadingPage(false);
      pendingSaveRef.current = false;
    }
  }

  async function handleSavePageToKnowledge() {
    if (isRunning || isReadingPage) {
      return;
    }

    setIsReadingPage(true);
    setError("");
    setProgress(copy.readingPage);
    setProgressRatio(undefined);

    try {
      const page = await fetchActivePageText();
      const file = createWebPageKnowledgeFile(page);
      const documents = await importKnowledgeFiles([file], activeKnowledgeSpaceId);
      await refreshKnowledgeCount();
      setToast(`${copy.pageSavedToKnowledge}: ${documents[0]?.name ?? page.title}`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : copy.pageReadError;
      setError(message);
      setToast(message);
    } finally {
      setIsReadingPage(false);
      setProgress("");
    }
  }

  async function handleContinueTask() {
    if (!taskState || isRunning || !conversationStatus) {
      return;
    }
    if (conversationStatus !== "failed" && !isConversationActive(conversationStatus)) {
      return;
    }

    const resumedTaskState = updateStoredTaskState(taskState, "queued");
    if (!resumedTaskState) {
      return;
    }

    const conversation: StoredConversation = {
      id: conversationId,
      title: taskState.originalInput.slice(0, 48),
      locale,
      messages,
      status: "queued",
      taskState: resumedTaskState,
      createdAt: conversationCreatedAt,
      updatedAt: Date.now(),
    };

    pendingSaveRef.current = true;
    setError("");
    setConversationStatus("queued");
    setTaskState(resumedTaskState);
    setIsRunning(true);
    setProgress(formatTaskStatus("queued", locale));
    await saveConversation(conversation);
    await refreshHistory();

    try {
      if (await submitBackgroundTask(conversation, taskState.promptText, taskState.sources, taskState.aiTask)) {
        setToast(copy.taskResumed);
        setProgress(formatTaskStatus("queued", locale));
      } else {
        const result = await runAiTask({
          task: taskState.aiTask,
          text: taskState.promptText,
          locale,
          onProgress(nextProgress) {
            setProgress(nextProgress.message);
            setProgressRatio(nextProgress.ratio);
          },
        });
        const completedConversation: StoredConversation = {
          ...conversation,
          messages: [
            ...messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: result,
              sources: taskState.sources,
            },
          ],
          status: "completed",
          taskState: updateStoredTaskState(resumedTaskState, "completed"),
          updatedAt: Date.now(),
        };
        await saveConversation(completedConversation);
        setMessages(completedConversation.messages);
        setConversationStatus(completedConversation.status);
        setTaskState(completedConversation.taskState);
        setIsRunning(false);
        setProgress(copy.complete);
        await refreshHistory();
      }
    } catch (reason) {
      const message = taskState.deterministicExecution?.handled
        ? formatDeterministicExecution(taskState.deterministicExecution, locale)
        : reason instanceof Error ? reason.message : copy.taskError;
      const failedConversation: StoredConversation = {
        ...conversation,
        messages: [
          ...messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: message,
            sources: taskState.sources,
          },
        ],
        status: taskState.deterministicExecution?.handled ? "completed" : "failed",
        taskState: updateStoredTaskState(
          resumedTaskState,
          taskState.deterministicExecution?.handled ? "completed" : "failed",
          taskState.deterministicExecution?.handled ? undefined : message,
        ),
        updatedAt: Date.now(),
      };
      await saveConversation(failedConversation);
      setMessages(failedConversation.messages);
      setConversationStatus(failedConversation.status);
      setTaskState(failedConversation.taskState);
      setError(taskState.deterministicExecution?.handled ? "" : message);
      setProgress("");
      setIsRunning(false);
      await refreshHistory();
    } finally {
      pendingSaveRef.current = false;
    }
  }

  async function handleMemoryCommand(command: AssistantMemoryCommand, nextMessages: ChatMessage[], title: string) {
    try {
      const resultText = await executeMemoryCommand(command, locale);
      const now = Date.now();
      const completedConversation: StoredConversation = {
        id: conversationId,
        title: title.slice(0, 48),
        locale,
        messages: [
          ...nextMessages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: resultText,
          },
        ],
        status: "completed",
        createdAt: conversationCreatedAt,
        updatedAt: now,
      };

      setMessages(completedConversation.messages);
      await saveConversation(completedConversation);
      await refreshHistory();
      await refreshAssistantMemories();
      setProgress(copy.complete);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : copy.taskError;
      setError(message);
      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: message,
        },
      ]);
    } finally {
      setIsRunning(false);
      setProgress("");
      pendingSaveRef.current = false;
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleRun();
    }
  }

  function clearChat() {
    pendingSaveRef.current = false;
    setConversationId(crypto.randomUUID());
    setConversationCreatedAt(Date.now());
    setMessages([]);
    setSourcePreview(undefined);
    setConversationStatus(undefined);
    setTaskState(undefined);
    setError("");
    setProgress("");
    setProgressRatio(undefined);
    setIsRunning(false);
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    setToast(copy.copied);
  }

  async function handleKnowledgeImport(files: FileList | null) {
    const supportedFiles = Array.from(files ?? []).filter((file) =>
      /\.(md|txt)$/i.test(file.name),
    );

    if (!supportedFiles.length) {
      return;
    }

    const documents = await importKnowledgeFiles(supportedFiles, activeKnowledgeSpaceId);
    await refreshKnowledgeCount();
    setToast(`${copy.knowledgeImported} ${documents.length}`);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleKnowledgeDelete(documentId: string) {
    await deleteKnowledgeDocument(documentId);
    await refreshKnowledgeCount();
    setToast(copy.knowledgeDeleted);
  }

  async function handleKnowledgeClear() {
    if (!knowledgeDocuments.length) {
      return;
    }

    await clearKnowledgeDocuments(activeKnowledgeSpaceId);
    await refreshKnowledgeCount();
    setToast(copy.knowledgeCleared);
  }

  async function handleKnowledgeRebuild() {
    if (!knowledgeDocuments.length || isRebuildingKnowledge) {
      return;
    }

    setIsRebuildingKnowledge(true);
    try {
      const result = await rebuildKnowledgeIndex(activeKnowledgeSpaceId);
      await refreshKnowledgeCount();
      setToast(
        result.chunkCount
          ? `${copy.knowledgeIndexRebuilt}: ${result.chunkCount}`
          : copy.knowledgeIndexEmpty,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.taskError);
    } finally {
      setIsRebuildingKnowledge(false);
    }
  }

  async function handleKnowledgeSpaceCreate() {
    const name = newKnowledgeSpaceName.trim();
    if (!name) {
      return;
    }

    const space = await createKnowledgeSpace(name);
    setNewKnowledgeSpaceName("");
    setActiveKnowledgeSpaceId(space.id);
    await refreshKnowledgeSpaces();
    await refreshKnowledgeCount(space.id);
    setToast(`${copy.knowledgeSpaceCreated}: ${space.name}`);
  }

  function startMemoryEdit(memory: AssistantMemory) {
    setEditingMemoryId(memory.id);
    setEditingMemoryContent(memory.content);
    setEditingMemoryType(memory.type);
  }

  function cancelMemoryEdit() {
    setEditingMemoryId(undefined);
    setEditingMemoryContent("");
    setEditingMemoryType("fact");
  }

  async function handleMemorySave(memoryId: string) {
    const content = editingMemoryContent.trim();
    if (!content) {
      return;
    }

    await updateAssistantMemory(memoryId, {
      type: editingMemoryType,
      content,
    });
    cancelMemoryEdit();
    await refreshAssistantMemories();
    setToast(copy.memoryUpdated);
  }

  async function handleMemoryDelete(memoryId: string) {
    await deleteAssistantMemory(memoryId);
    if (editingMemoryId === memoryId) {
      cancelMemoryEdit();
    }
    await refreshAssistantMemories();
    setToast(copy.memoryDeleted);
  }

  async function handleMemoryExport() {
    const json = await exportAssistantMemories();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `localai-memories-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setToast(copy.exportMemories);
  }

  async function openSidePanel() {
    const chromeApi = getChromeExtensionApi();
    if (!chromeApi?.runtime?.id || !chromeApi.sidePanel?.open || !chromeApi.windows?.getLastFocused) {
      setToast(copy.openSurfaceError);
      return;
    }

    try {
      const currentWindow = await chromeApi.windows.getLastFocused();
      if (typeof currentWindow.id !== "number") {
        setToast(copy.openSurfaceError);
        return;
      }

      await chromeApi.sidePanel.open({
        windowId: currentWindow.id,
      });
      window.close();
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : copy.openSurfaceError);
    }
  }

  async function openChatTab() {
    const chromeApi = getChromeExtensionApi();
    const extensionUrl = chromeApi?.runtime?.getURL?.("index.html?surface=tab");
    const url = extensionUrl ?? `${window.location.origin}${window.location.pathname}?surface=tab`;

    try {
      if (chromeApi?.runtime?.id && chromeApi.runtime.sendMessage) {
        const response = await chromeApi.runtime.sendMessage({
          target: "background",
          type: "OPEN_CHAT_TAB",
        });
        if (!response?.ok) {
          throw new Error(response?.error ?? copy.openSurfaceError);
        }
        window.close();
        return;
      }

      window.open(url, "_blank");
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : copy.openSurfaceError);
    }
  }

  async function notifyIfChatTabOpen() {
    const chromeApi = getChromeExtensionApi();
    if (!chromeApi?.runtime?.id || !chromeApi.runtime.sendMessage) {
      return;
    }

    try {
      const response = await chromeApi.runtime.sendMessage({
        target: "background",
        type: "GET_CHAT_TAB_STATE",
      });
      if (response?.open) {
        setToast(copy.appAlreadyOpen);
      }
    } catch {
      // The popup should still be usable if the background check is unavailable.
    }
  }

  function startComposerResize(event: PointerEvent<HTMLButtonElement>) {
    if (!canResizeComposer) {
      return;
    }

    event.preventDefault();
    const startY = event.clientY;
    const startHeight = composerHeightRef.current;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = startY - moveEvent.clientY;
      setComposerHeight(clampComposerHeight(startHeight + delta, surface));
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  const composerStyle = canResizeComposer
    ? ({
        "--composer-height": `${composerHeight}px`,
        "--composer-textarea-height": `${Math.max(composerHeight - 106, 48)}px`,
      } as CSSProperties)
    : undefined;
  const canContinueTask = Boolean(taskState && conversationStatus === "failed" && !isRunning);
  const shouldShowTaskStatus = Boolean(taskState && conversationStatus && conversationStatus !== "completed");
  const taskStatusText = taskState && conversationStatus
    ? `${formatTaskKind(taskState.kind, locale)} · ${formatTaskStatus(conversationStatus, locale)}`
    : "";

  return (
    <main className={`app-shell ${surface}-surface`}>
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <div className="history-control">
              <button className="history-button" type="button" title={copy.history} aria-label={copy.history}>
                <PanelLeft size={22} />
              </button>
              <div className="history-popover" role="list" aria-label={copy.history}>
                <div className="history-title">{copy.history}</div>
                {history.length ? (
                  history.map((conversation) => (
                    <button
                      key={conversation.id}
                      className="history-item"
                      type="button"
                      onClick={() => {
                        pendingSaveRef.current = false;
                        setConversationId(conversation.id);
                        setConversationCreatedAt(conversation.createdAt);
                        setLocale(conversation.locale);
                        setMessages(conversation.messages);
                        setConversationStatus(conversation.status);
                        setTaskState(conversation.taskState);
                        setIsRunning(isConversationActive(conversation.status));
                        setSourcePreview(undefined);
                        setError("");
                        setProgress(isConversationActive(conversation.status)
                          ? formatTaskStatus(conversation.status, conversation.locale)
                          : "");
                        setProgressRatio(undefined);
                      }}
                    >
                      <span>{conversation.title}</span>
                      <time>{formatHistoryTime(conversation.updatedAt, locale)}</time>
                    </button>
                  ))
                ) : (
                  <div className="history-empty">{copy.emptyHistory}</div>
                )}
              </div>
            </div>
            <button className="new-chat-button" type="button" onClick={clearChat} title={copy.newConversation} aria-label={copy.newConversation}>
              <SquarePen size={22} />
            </button>
          </div>
          <div className="title-block">
            <h1>{copy.title}</h1>
            <p className="eyebrow">{copy.eyebrow}</p>
          </div>
          <div className="topbar-actions">
            {surface !== "sidepanel" && (
              <button
                className="topbar-icon-button"
                type="button"
                onClick={() => void openSidePanel()}
                title={copy.openSidePanel}
                aria-label={copy.openSidePanel}
              >
                <PanelRightOpen size={18} />
              </button>
            )}
            {surface !== "tab" && (
              <button
                className="topbar-icon-button"
                type="button"
                onClick={() => void openChatTab()}
                title={copy.openTab}
                aria-label={copy.openTab}
              >
                <SquareArrowOutUpRight size={18} />
              </button>
            )}
            <div className="locale-switch" aria-label="Language">
              <button
                className={locale === "zh" ? "locale-option active" : "locale-option"}
                type="button"
                onClick={() => changeLocale("zh")}
              >
                中
              </button>
              <button
                className={locale === "en" ? "locale-option active" : "locale-option"}
                type="button"
                onClick={() => changeLocale("en")}
              >
                EN
              </button>
            </div>
          </div>
        </header>

        <section className={`panel chat-panel ${shouldShowTaskStatus ? "has-task-state" : ""}`} aria-label={copy.chatLabel}>
          {typeof progressRatio === "number" && (
            <div className="progress-track">
              <div className="progress-bar" style={{ width: `${Math.min(progressRatio * 100, 100)}%` }} />
            </div>
          )}

          {!shouldShowTaskStatus && (promptStatus === "missing" || promptStatus === "unavailable") ? (
            <div className={`status-banner ${getStatusTone(promptStatus as CapabilityStatus["availability"])}`}>
              {copy.unavailableHint}
            </div>
          ) : null}

          {shouldShowTaskStatus ? (
            <div className={`task-state-banner ${conversationStatus === "failed" ? "failed" : ""}`}>
              <div>
                <strong>{taskStatusText}</strong>
                <span>{taskState?.originalInput}</span>
              </div>
              {canContinueTask ? (
                <button type="button" onClick={() => void handleContinueTask()}>
                  <RotateCcw size={15} />
                  {copy.continueTask}
                </button>
              ) : null}
            </div>
          ) : null}

          <div ref={messageListRef} className="message-list" aria-live="polite">
            {messages.length === 0 && !isRunning ? (
              <div className="empty-state">
                <h2>{copy.heroQuestion}</h2>
                <p>{copy.subtitle}</p>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <article key={message.id} className={`message ${message.role}`}>
                    <div className="message-author">
                      {message.role === "user" ? copy.userLabel : copy.assistantLabel}
                    </div>
                    <div className="message-body">
                      {message.role === "assistant" ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                      ) : (
                        message.text
                      )}
                    </div>
                    {message.role === "assistant" && (
                      <div className="message-actions" aria-label="Message actions">
                        <button type="button" className="message-action" onClick={() => void copyMessage(message.text)} title={copy.copy}>
                          <Clipboard size={17} />
                        </button>
                        <button type="button" className="message-action" title="Like">
                          <ThumbsUp size={17} />
                        </button>
                        <button type="button" className="message-action" title="Dislike">
                          <ThumbsDown size={17} />
                        </button>
                        <button type="button" className="message-action" title="Regenerate">
                          <RotateCcw size={17} />
                        </button>
                        <button type="button" className="message-action" title="More">
                          <Ellipsis size={17} />
                        </button>
                      </div>
                    )}
                    {message.role === "assistant" && message.sources?.length ? (
                      <>
                        <div className="message-sources">
                          {message.sources.map((source, index) => (
                            <button
                              type="button"
                              key={`${source.documentName}-${source.chunkIndex}-${index}`}
                              onClick={() => setSourcePreview({ messageId: message.id, index, source })}
                              className={
                                sourcePreview?.messageId === message.id && sourcePreview.index === index
                                  ? "active"
                                  : undefined
                              }
                            >
                              [{index + 1}] {source.documentName}
                            </button>
                          ))}
                        </div>
                        {sourcePreview?.messageId === message.id ? (
                          <div className="source-preview">
                            <div className="source-preview-header">
                              <div>
                                <strong>{copy.sourcePreview}</strong>
                                <span>
                                  [{sourcePreview.index + 1}] {sourcePreview.source.documentName} #
                                  {sourcePreview.source.chunkIndex + 1}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="source-preview-close"
                                onClick={() => setSourcePreview(undefined)}
                                title={copy.closeSourcePreview}
                                aria-label={copy.closeSourcePreview}
                              >
                                <X size={16} />
                              </button>
                            </div>
                            <pre>{sourcePreview.source.text}</pre>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </article>
                ))}
                {isRunning && (
                  <article className="message assistant">
                    <div className="message-author">{copy.assistantLabel}</div>
                    <div className="message-body typing">
                      <LoaderCircle size={17} className="spin" />
                      <span>{progress || copy.checking}</span>
                    </div>
                  </article>
                )}
              </>
            )}
          </div>

          <div className="composer" style={composerStyle}>
            {canResizeComposer && (
              <button
                className="composer-resize-handle"
                type="button"
                onPointerDown={startComposerResize}
                aria-label={locale === "zh" ? "调整输入框高度" : "Resize composer"}
                title={locale === "zh" ? "调整输入框高度" : "Resize composer"}
              />
            )}
            <label className="sr-only" htmlFor="input">
              {copy.inputLabel}
            </label>
            <textarea
              id="input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={copy.placeholder}
              spellCheck={false}
            />
            <div className="composer-toolbar">
              <div className="tool-group">
                <div className="skill-control">
                  <button className="tool-icon-button" type="button" title={copy.moreSkills} aria-label={copy.moreSkills}>
                    <Plus size={21} />
                  </button>
                  <div className="skill-popover" role="dialog" aria-label={copy.moreSkills}>
                    <button type="button" onClick={() => void handleTextAction("summarize")}>
                      <FileText size={16} />
                      <span>{copy.summarizeText}</span>
                    </button>
                    <button type="button" onClick={() => void handleTextAction("translate")}>
                      <Languages size={16} />
                      <span>{copy.translateText}</span>
                    </button>
                    <button type="button" onClick={() => void handleTextAction("write")}>
                      <PenLine size={16} />
                      <span>{copy.writeText}</span>
                    </button>
                    <button type="button" onClick={() => void handleTextAction("rewrite")}>
                      <WandSparkles size={16} />
                      <span>{copy.rewriteText}</span>
                    </button>
                  </div>
                </div>
                <span className="divider" />
                <div className="page-control">
                  <button
                    className="tool-chip page-chip"
                    type="button"
                    title={copy.webPage}
                    aria-label={copy.webPage}
                    disabled={isRunning || isReadingPage}
                  >
                    {isReadingPage ? <LoaderCircle size={18} className="spin" /> : <Globe2 size={18} />}
                    <span>{copy.webPage}</span>
                  </button>
                  <div className="page-popover" role="dialog" aria-label={copy.webPage}>
                    <button type="button" onClick={() => void handleWebPageAction("summary")}>
                      {copy.summarizePage}
                    </button>
                    <button type="button" onClick={() => void handleWebPageAction("qa")}>
                      {copy.askPage}
                    </button>
                    <button type="button" onClick={() => void handleWebPageAction("todos")}>
                      {copy.extractPageTodos}
                    </button>
                    <button type="button" onClick={() => void handleWebPageAction("notes")}>
                      {copy.createPageNotes}
                    </button>
                    <span className="page-popover-divider" />
                    <button type="button" onClick={() => void handleSavePageToKnowledge()}>
                      {copy.savePageToKnowledge}
                    </button>
                  </div>
                </div>
                <div className="knowledge-control">
                  <button
                    className="tool-chip knowledge-chip"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title={copy.importKnowledge}
                    aria-label={copy.importKnowledge}
                  >
                    <Database size={18} />
                    <span>{copy.knowledge}{knowledgeCount ? ` ${knowledgeCount}` : ""}</span>
                  </button>
                  <div className="knowledge-popover" role="dialog" aria-label={copy.knowledgeFiles}>
                    <div className="knowledge-popover-header">
                      <div>
                        <strong>{copy.knowledgeFiles}</strong>
                        <span>{knowledgeCount}</span>
                      </div>
                      <button
                        className="knowledge-header-action"
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        title={copy.importKnowledge}
                        aria-label={copy.importKnowledge}
                      >
                        <Plus size={17} />
                      </button>
                    </div>
                    <div className="knowledge-space-control">
                      <label className="sr-only" htmlFor="knowledge-space-select">
                        {copy.knowledgeSpace}
                      </label>
                      <select
                        id="knowledge-space-select"
                        value={activeKnowledgeSpaceId}
                        onChange={(event) => setActiveKnowledgeSpaceId(event.target.value)}
                        aria-label={copy.knowledgeSpace}
                      >
                        {knowledgeSpaces.map((space) => (
                          <option value={space.id} key={space.id}>
                            {space.name}
                          </option>
                        ))}
                      </select>
                      <div className="knowledge-space-create">
                        <input
                          value={newKnowledgeSpaceName}
                          onChange={(event) => setNewKnowledgeSpaceName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleKnowledgeSpaceCreate();
                            }
                          }}
                          placeholder={copy.newKnowledgeSpace}
                          aria-label={copy.newKnowledgeSpace}
                        />
                        <button
                          className="knowledge-header-action"
                          type="button"
                          onClick={() => void handleKnowledgeSpaceCreate()}
                          disabled={!newKnowledgeSpaceName.trim()}
                          title={copy.newKnowledgeSpace}
                          aria-label={copy.newKnowledgeSpace}
                        >
                          <Plus size={17} />
                        </button>
                      </div>
                    </div>
                    <div className="knowledge-list" role="list">
                      {knowledgeDocuments.length ? (
                        knowledgeDocuments.map((document) => (
                          <div className="knowledge-item" role="listitem" key={document.id}>
                            <FileText size={18} />
                            <div className="knowledge-item-main">
                              <span>{document.name}</span>
                              <time>
                                {formatHistoryTime(document.createdAt, locale)} · {formatFileSize(document.size)}
                              </time>
                            </div>
                            <button
                              className="knowledge-delete-button"
                              type="button"
                              onClick={() => void handleKnowledgeDelete(document.id)}
                              title={copy.deleteKnowledge}
                              aria-label={`${copy.deleteKnowledge}: ${document.name}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="knowledge-empty">{copy.emptyKnowledge}</div>
                      )}
                    </div>
                    <div className="knowledge-footer-actions">
                      <button
                        className="knowledge-rebuild-button"
                        type="button"
                        onClick={() => void handleKnowledgeRebuild()}
                        disabled={!knowledgeDocuments.length || isRebuildingKnowledge}
                      >
                        <RefreshCw size={16} className={isRebuildingKnowledge ? "spin" : undefined} />
                        <span>{copy.rebuildKnowledgeIndex}</span>
                      </button>
                      <button
                        className="knowledge-clear-button"
                        type="button"
                        onClick={() => void handleKnowledgeClear()}
                        disabled={!knowledgeDocuments.length || isRebuildingKnowledge}
                      >
                        <Trash2 size={16} />
                        <span>{copy.clearKnowledge}</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="memory-control">
                  <button
                    className="tool-chip memory-chip"
                    type="button"
                    title={copy.memories}
                    aria-label={copy.memories}
                  >
                    <Brain size={18} />
                    <span>{copy.memories}{assistantMemories.length ? ` ${assistantMemories.length}` : ""}</span>
                  </button>
                  <div className="memory-popover" role="dialog" aria-label={copy.memories}>
                    <div className="memory-popover-header">
                      <div>
                        <strong>{copy.memories}</strong>
                        <span>{assistantMemories.length}</span>
                      </div>
                      <button
                        className="memory-header-action"
                        type="button"
                        onClick={() => void handleMemoryExport()}
                        disabled={!assistantMemories.length}
                        title={copy.exportMemories}
                        aria-label={copy.exportMemories}
                      >
                        <Download size={17} />
                      </button>
                    </div>
                    <div className="memory-list" role="list">
                      {assistantMemories.length ? (
                        assistantMemories.map((memory) => {
                          const isEditing = editingMemoryId === memory.id;

                          return (
                            <div className="memory-item" role="listitem" key={memory.id}>
                              {isEditing ? (
                                <div className="memory-edit">
                                  <select
                                    value={editingMemoryType}
                                    onChange={(event) => setEditingMemoryType(event.target.value as AssistantMemoryType)}
                                    aria-label={copy.editMemory}
                                  >
                                    {(["preference", "fact", "project", "task"] as AssistantMemoryType[]).map((type) => (
                                      <option value={type} key={type}>
                                        {formatMemoryType(type, locale)}
                                      </option>
                                    ))}
                                  </select>
                                  <textarea
                                    value={editingMemoryContent}
                                    onChange={(event) => setEditingMemoryContent(event.target.value)}
                                    aria-label={copy.editMemory}
                                    rows={3}
                                  />
                                  <div className="memory-edit-actions">
                                    <button
                                      className="memory-action-button"
                                      type="button"
                                      onClick={() => void handleMemorySave(memory.id)}
                                      disabled={!editingMemoryContent.trim()}
                                      title={copy.saveMemory}
                                      aria-label={copy.saveMemory}
                                    >
                                      <Save size={16} />
                                    </button>
                                    <button
                                      className="memory-action-button"
                                      type="button"
                                      onClick={cancelMemoryEdit}
                                      title={copy.cancelEdit}
                                      aria-label={copy.cancelEdit}
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="memory-item-main">
                                    <span>{memory.content}</span>
                                    <time>
                                      {formatMemoryType(memory.type, locale)} · {formatHistoryTime(memory.updatedAt, locale)}
                                    </time>
                                  </div>
                                  <div className="memory-item-actions">
                                    <button
                                      className="memory-action-button"
                                      type="button"
                                      onClick={() => startMemoryEdit(memory)}
                                      title={copy.editMemory}
                                      aria-label={`${copy.editMemory}: ${memory.content}`}
                                    >
                                      <SquarePen size={16} />
                                    </button>
                                    <button
                                      className="memory-action-button"
                                      type="button"
                                      onClick={() => void handleMemoryDelete(memory.id)}
                                      title={copy.memoryDeleted}
                                      aria-label={`${copy.memoryDeleted}: ${memory.content}`}
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="memory-empty">{copy.emptyMemories}</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="tool-group right">
                <span className={`mini-status ${getStatusTone(promptStatus as CapabilityStatus["availability"])}`}>
                  {formatStatus(promptStatus, locale)}
                </span>
                <button
                  className="send-button"
                  type="button"
                  onClick={handleRun}
                  disabled={isRunning || !input.trim()}
                  title={copy.send}
                  aria-label={copy.send}
                >
                  {isRunning ? <LoaderCircle size={18} className="spin" /> : <Send size={18} />}
                </button>
              </div>
            </div>
          </div>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            multiple
            onChange={(event) => void handleKnowledgeImport(event.target.files)}
          />
          {error && <div className="sr-only">{error}</div>}
          {toast && <div className="toast" role="status">{toast}</div>}
        </section>
      </section>
    </main>
  );
}

function formatStatus(status: string, locale: Locale) {
  return translations[locale].statusLabels[status] ?? status;
}

function createStoredTaskState({
  kind,
  aiTask,
  status,
  originalInput,
  promptText,
  sources,
  intent,
  plan,
  deterministicExecution,
  now,
}: {
  kind: StoredTaskState["kind"];
  aiTask: AiTask;
  status: ConversationStatus;
  originalInput: string;
  promptText: string;
  sources: StoredTaskState["sources"];
  intent?: StoredTaskState["intent"];
  plan?: StoredTaskState["plan"];
  deterministicExecution?: StoredTaskState["deterministicExecution"];
  now: number;
}): StoredTaskState {
  return {
    id: crypto.randomUUID(),
    kind,
    aiTask,
    status,
    originalInput,
    promptText,
    sources,
    intent,
    plan,
    deterministicExecution,
    createdAt: now,
    updatedAt: now,
  };
}

function updateStoredTaskState(
  currentTaskState: StoredTaskState | undefined,
  status: ConversationStatus,
  error?: string,
): StoredTaskState | undefined {
  if (!currentTaskState) {
    return undefined;
  }

  const now = Date.now();
  return {
    ...currentTaskState,
    status,
    error,
    updatedAt: now,
    completedAt: status === "completed" || status === "failed" ? now : currentTaskState.completedAt,
  };
}

function formatTaskStatus(status: StoredConversation["status"], locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    zh: {
      queued: "任务排队中",
      checking: "正在检查本地 AI 能力",
      "creating-session": "正在创建本地 AI 会话",
      downloading: "正在下载模型资源",
      running: "正在本地推理",
      failed: "任务失败，可继续",
      completed: "任务完成",
    },
    en: {
      queued: "Task queued",
      checking: "Checking local AI capability",
      "creating-session": "Creating local AI session",
      downloading: "Downloading model assets",
      running: "Running local inference",
      failed: "Task failed, can resume",
      completed: "Task completed",
    },
  };

  return labels[locale][status ?? ""] ?? (locale === "zh" ? "后台推理中" : "Running in background");
}

function formatTaskKind(kind: StoredTaskState["kind"], locale: Locale) {
  const labels: Record<StoredTaskState["kind"], Record<Locale, string>> = {
    chat: { zh: "对话任务", en: "Chat task" },
    "text-action": { zh: "文本动作", en: "Text action" },
    "web-page": { zh: "网页任务", en: "Web page task" },
  };

  return labels[kind][locale];
}

function formatTextActionUserMessage(task: TextAction, text: string, locale: Locale) {
  const copy = translations[locale];
  if (task === "translate") {
    const direction = detectTranslationDirection(text, locale);
    const label =
      locale === "zh"
        ? direction === "zh-to-en"
          ? "翻译为英文"
          : "翻译为中文"
        : direction === "zh-to-en"
          ? "Translate to English"
          : "Translate to Chinese";
    return `${label}：${text}`;
  }

  if (task === "rewrite") {
    const label = locale === "zh" ? "润色改写为更清晰自然的表达" : "Polish for clearer, more natural wording";
    return `${label}：${text}`;
  }

  const labels: Record<Exclude<TextAction, "translate" | "rewrite">, string> = {
    summarize: copy.summarizeText,
    write: copy.writeText,
  };

  return `${labels[task]}：${text}`;
}

function detectTranslationDirection(text: string, locale: Locale): "zh-to-en" | "en-to-zh" {
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

async function executeMemoryCommand(command: AssistantMemoryCommand, locale: Locale) {
  const copy = translations[locale];

  if (command.type === "remember") {
    const memory = await saveAssistantMemory(command.content);
    return locale === "zh"
      ? `${copy.memorySaved}：${memory.content}\n\n类型：${formatMemoryType(memory.type, locale)}`
      : `${copy.memorySaved}: ${memory.content}\n\nType: ${formatMemoryType(memory.type, locale)}`;
  }

  const deletedMemories = await deleteAssistantMemoriesByQuery(command.query);
  if (!deletedMemories.length) {
    return copy.memoryNotFound;
  }

  const deletedList = deletedMemories.map((memory) => `- ${memory.content}`).join("\n");
  return locale === "zh"
    ? `${copy.memoryDeleted} ${deletedMemories.length} 条：\n${deletedList}`
    : `${copy.memoryDeleted}: ${deletedMemories.length}\n${deletedList}`;
}

function formatMemoryType(type: "preference" | "fact" | "project" | "task", locale: Locale) {
  const labels = {
    preference: { zh: "用户偏好", en: "preference" },
    fact: { zh: "长期事实", en: "fact" },
    project: { zh: "项目约定", en: "project" },
    task: { zh: "任务状态", en: "task" },
  };

  return labels[type][locale];
}

async function fetchActivePageText(): Promise<WebPageSnapshot> {
  const runtime = getChromeExtensionApi()?.runtime;
  if (!runtime?.id || !runtime.sendMessage) {
    throw new Error("Chrome extension runtime is unavailable.");
  }

  const response = await runtime.sendMessage({
    target: "background",
    type: "GET_ACTIVE_PAGE_TEXT",
  });

  if (!response?.ok || !response.page?.text) {
    throw new Error(response?.error ?? "Failed to read current page.");
  }

  return {
    title: response.page.title,
    url: response.page.url,
    text: response.page.text,
    extractedAt: response.page.extractedAt,
  };
}

function createWebPageKnowledgeFile(page: WebPageSnapshot) {
  const title = page.title || page.url || "Untitled page";
  const capturedAt = new Date(page.extractedAt ?? Date.now()).toISOString();
  const markdown = `# ${title}

Source URL: ${page.url}
Captured at: ${capturedAt}

${page.text}
`;
  const fileName = `${sanitizeFileName(title)}.md`;

  return new File([markdown], fileName, {
    type: "text/markdown",
    lastModified: page.extractedAt ?? Date.now(),
  });
}

function sanitizeFileName(name: string) {
  const sanitized = name
    .replace(/[\\/:*?"<>|#{}%~&]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return sanitized || "web-page";
}

function formatWebPageUserMessage(action: WebPageAction, page: WebPageSnapshot, question: string, locale: Locale) {
  const title = page.title || page.url;
  const labels: Record<WebPageAction, Record<Locale, string>> = {
    summary: { zh: "总结当前网页", en: "Summarize current page" },
    qa: { zh: "基于当前网页回答", en: "Answer from current page" },
    todos: { zh: "提取当前网页待办", en: "Extract todos from current page" },
    notes: { zh: "整理当前网页笔记", en: "Create notes from current page" },
  };

  if (action === "qa" && question) {
    return locale === "zh"
      ? `${labels.qa.zh}：${question}\n${title}`
      : `${labels.qa.en}: ${question}\n${title}`;
  }

  return `${labels[action][locale]}：${title}`;
}

function buildWebPagePrompt(action: WebPageAction, page: WebPageSnapshot, question: string, locale: Locale) {
  const pageText = page.text.slice(0, MAX_PAGE_CONTEXT_LENGTH);
  const pageBlock = locale === "zh"
    ? `网页标题：${page.title}\n网页地址：${page.url}\n\n网页正文：\n${pageText}`
    : `Page title: ${page.title}\nPage URL: ${page.url}\n\nPage text:\n${pageText}`;

  if (locale === "zh") {
    const instruction: Record<WebPageAction, string> = {
      summary: "请基于网页正文生成简洁摘要，先给出 3-5 条关键结论，再列出重要细节。",
      qa: question
        ? `请只基于网页正文回答这个问题：${question}。如果正文不足以回答，请明确说明缺少什么信息。`
        : "请基于网页正文回答：这篇网页主要讲了什么？",
      todos: "请从网页正文中提取可执行待办。按任务、上下文、优先级或截止信息组织；如果没有明确待办，请列出可推导的后续行动并标明依据不足。",
      notes: "请把网页正文整理成结构化笔记，包括主题、关键点、重要术语、可复用结论和待确认问题。",
    };

    return `你是 localAI 的网页助手。只使用下面的网页正文完成任务，不要编造网页中没有的信息。使用 Markdown 输出。

任务：
${instruction[action]}

${pageBlock}`;
  }

  const instruction: Record<WebPageAction, string> = {
    summary: "Create a concise summary from the page text. Start with 3-5 key takeaways, then list important details.",
    qa: question
      ? `Answer this question using only the page text: ${question}. If the page does not contain enough information, say what is missing.`
      : "Answer this from the page text: what is this page mainly about?",
    todos: "Extract actionable todos from the page text. Organize by task, context, priority, or deadline when available. If there are no explicit todos, list reasonable follow-ups and mark them as inferred.",
    notes: "Turn the page text into structured notes with topic, key points, important terms, reusable conclusions, and open questions.",
  };

  return `You are localAI's web page assistant. Use only the page text below. Do not invent information that is not present. Use Markdown.

Task:
${instruction[action]}

${pageBlock}`;
}

async function submitBackgroundTask(
  conversation: StoredConversation,
  text: string,
  sources: KnowledgeMatch[],
  task: AiTask = "prompt",
) {
  const runtime = (
    globalThis as {
      chrome?: {
        runtime?: {
          id?: string;
          sendMessage?: (message: unknown) => Promise<{ ok?: boolean; error?: string }>;
        };
      };
    }
  ).chrome?.runtime;

  if (!runtime?.id || !runtime.sendMessage) {
    return false;
  }

  const response = await runtime.sendMessage({
    target: "background",
    type: "RUN_LOCAL_AI_TASK",
    payload: {
      conversation,
      task,
      text,
      prompt: text,
      sources,
    },
  });

  if (!response?.ok) {
    throw new Error(response?.error ?? "Failed to start background AI task.");
  }

  return true;
}

function formatHistoryTime(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getChromeExtensionApi() {
  return (
    globalThis as {
      chrome?: {
        runtime?: {
          id?: string;
          getURL?: (path: string) => string;
          sendMessage?: (message: unknown) => Promise<{
            ok?: boolean;
            open?: boolean;
            error?: string;
            page?: WebPageSnapshot;
          }>;
          onMessage?: {
            addListener?: (listener: (message: { target?: string; type?: string }) => void) => void;
            removeListener?: (listener: (message: { target?: string; type?: string }) => void) => void;
          };
        };
        sidePanel?: {
          open?: (options: { windowId?: number }) => Promise<void>;
        };
        windows?: {
          getLastFocused?: () => Promise<{ id?: number }>;
        };
      };
    }
  ).chrome;
}
