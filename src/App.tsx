import {
  Brain,
  Clipboard,
  Database,
  Download,
  FileText,
  Globe2,
  Languages,
  PenLine,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Upload,
  WandSparkles,
  SquareArrowOutUpRight,
  LoaderCircle,
  Menu,
  PanelLeft,
  PanelRightOpen,
  Plus,
  Search,
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
import {
  type ContextPlan,
  createContextPlan,
  shouldExpandMemorySearch,
} from "./lib/assistantContextPlan";
import { detectAssistantIntent } from "./lib/assistantIntent";
import { createAssistantPlan } from "./lib/assistantPlanner";
import { searchBuiltinKnowledge } from "./lib/builtinKnowledge";
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
import {
  exportAllIndexedDbData,
  exportPortableAiData,
  importAllIndexedDbData,
} from "./lib/indexedDbBackup";

type ChatMessage = StoredChatMessage;
type MessageSource = NonNullable<ChatMessage["sources"]>[number];
type Surface = "popup" | "sidepanel" | "tab";
type OpenPopover = "history" | "skills" | "page" | "knowledge" | "memory" | "settings";
type WebPageAction = "summary" | "qa" | "todos" | "notes";
type TextAction = Extract<AiTask, "summarize" | "translate" | "write" | "rewrite">;
type WebPageSnapshot = {
  title: string;
  url: string;
  text: string;
  extractedAt?: number;
};
const SURFACE_CHANNEL = "localai-surface";
const LOCALE_STORAGE_KEY = "localai-locale";
const SIDEPANEL_WIDTH_GUIDE_STORAGE_KEY = "localai-sidepanel-width-guide-dismissed";
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
    downloadResponse: string;
    regenerateResponse: string;
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
    references: string;
    sourceChunk: string;
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
    collapseSidebar: string;
    openSidebar: string;
    recentTopics: string;
    searchConversations: string;
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
    sidePanelWidthGuide: string;
    sidePanelWidthGuideAction: string;
    settings: string;
    exportBackup: string;
    exportPortableData: string;
    importData: string;
    dataExported: string;
    portableDataExported: string;
    dataImported: string;
    dataImportInvalid: string;
    importDataConfirm: string;
  }
> = {
  zh: {
    eyebrow: "Chrome 内置模型 · Gemini Nano",
    title: "新对话",
    subtitle: "完全脱离互联网的本地模型。你不用担心任何隐私问题\n我们不会上传任何数据到服务器，所有数据都保存在你自己的电脑上",
    heroQuestion: "有什么我能帮你的吗？",
    placeholder: "输入消息，或点击 + 选择操作",
    send: "发送",
    checking: "检查中",
    complete: "完成",
    copy: "复制",
    copied: "复制成功",
    downloadResponse: "下载为 Word",
    regenerateResponse: "重新回答",
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
    references: "引用来源",
    sourceChunk: "片段",
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
    collapseSidebar: "收起侧边栏",
    openSidebar: "打开侧边栏",
    recentTopics: "近期话题",
    searchConversations: "搜索历史话题",
    knowledge: "知识库",
    moreSkills: "更多操作",
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
    sidePanelWidthGuide: "如果侧边栏太窄，可以拖动侧边栏左侧边缘向左拉宽。",
    sidePanelWidthGuideAction: "知道了",
    settings: "设置",
    exportBackup: "导出备份",
    exportPortableData: "导出通用数据",
    importData: "导入数据",
    dataExported: "备份已导出",
    portableDataExported: "通用数据已导出",
    dataImported: "数据已导入",
    dataImportInvalid: "导入文件格式不合规",
    importDataConfirm: "导入会覆盖当前本地数据，是否继续？",
  },
  en: {
    eyebrow: "Chrome built-in model · Gemini Nano",
    title: "New chat",
    subtitle: "Fully offline local model. You do not need to worry about privacy.\nWe do not upload any data to a server; everything stays on your computer.",
    heroQuestion: "What can I help with?",
    placeholder: "Type a message, or click + for actions",
    send: "Send",
    checking: "checking",
    complete: "Complete",
    copy: "Copy",
    copied: "Copied",
    downloadResponse: "Download as Word",
    regenerateResponse: "Regenerate response",
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
    references: "Sources",
    sourceChunk: "chunk",
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
    collapseSidebar: "Collapse sidebar",
    openSidebar: "Open sidebar",
    recentTopics: "Recent topics",
    searchConversations: "Search conversations",
    knowledge: "Knowledge base",
    moreSkills: "More actions",
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
    sidePanelWidthGuide: "If the side panel feels too narrow, drag its left edge to the left to make it wider.",
    sidePanelWidthGuideAction: "Got it",
    settings: "Settings",
    exportBackup: "Export backup",
    exportPortableData: "Export portable data",
    importData: "Import data",
    dataExported: "Backup exported",
    portableDataExported: "Portable data exported",
    dataImported: "Data imported",
    dataImportInvalid: "Import file format is invalid",
    importDataConfirm: "Importing will replace current local data. Continue?",
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
  if (chromeApi?.runtime?.id && window.innerWidth < 700) {
    return "sidepanel";
  }
  if (window.innerWidth > 900 || window.innerHeight > 700) {
    return "tab";
  }

  return "popup";
}

function getDefaultComposerHeight(surface: Surface) {
  if (surface === "sidepanel") {
    return clampComposerHeight(216, surface);
  }

  if (surface === "tab") {
    return clampComposerHeight(154, surface);
  }

  return 108;
}

function getMinComposerHeight(surface: Surface) {
  if (surface === "sidepanel") {
    return 176;
  }

  if (surface === "tab") {
    return 136;
  }

  return 108;
}

function clampComposerHeight(height: number, surface: Surface) {
  const minHeight = getMinComposerHeight(surface);
  const maxHeight = Math.max(minHeight, Math.floor(window.innerHeight / 3));
  return Math.min(Math.max(height, minHeight), maxHeight);
}

function getInitialLocale(): Locale {
  try {
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (storedLocale === "zh" || storedLocale === "en") {
      return storedLocale;
    }
  } catch {
    // Ignore storage access errors and fall back to browser language.
  }

  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function saveLocalePreference(locale: Locale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Locale preference is non-critical; the app can still run without persistence.
  }
}

function hasDismissedSidePanelWidthGuide() {
  try {
    return window.localStorage.getItem(SIDEPANEL_WIDTH_GUIDE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveSidePanelWidthGuideDismissed() {
  try {
    window.localStorage.setItem(SIDEPANEL_WIDTH_GUIDE_STORAGE_KEY, "true");
  } catch {
    // The guide can still be dismissed for the current session without persistence.
  }
}

export function App() {
  const [surface] = useState<Surface>(() => getInitialSurface());
  const canResizeComposer = surface !== "popup";
  const [locale, setLocale] = useState<Locale>(() => getInitialLocale());
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
  const [isHistorySidebarCollapsed, setIsHistorySidebarCollapsed] = useState(() => surface === "tab");
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [openPopover, setOpenPopover] = useState<OpenPopover | undefined>();
  const [showSidePanelWidthGuide, setShowSidePanelWidthGuide] = useState(
    () => !hasDismissedSidePanelWidthGuide(),
  );
  const [sourcePreview, setSourcePreview] = useState<{
    messageId: string;
    index: number;
    source: MessageSource;
  } | undefined>();
  const [composerHeight, setComposerHeight] = useState(() => getDefaultComposerHeight(surface));
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dataImportInputRef = useRef<HTMLInputElement | null>(null);
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
    if (!openPopover) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-popover-root]")) {
        return;
      }

      setOpenPopover(undefined);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenPopover(undefined);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openPopover]);

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
      clearChat();
      return;
    }

    setConversationId(latestConversation.id);
    setConversationCreatedAt(latestConversation.createdAt);
    setMessages(latestConversation.messages);
    setSourcePreview(undefined);
    setConversationStatus(latestConversation.status);
    setTaskState(latestConversation.taskState);
    setIsRunning(isConversationActive(latestConversation.status));
    if (isConversationActive(latestConversation.status)) {
      setProgress(formatTaskStatus(latestConversation.status, locale));
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
    saveLocalePreference(nextLocale);
    setLocale(nextLocale);
  }

  function togglePopover(popover: OpenPopover) {
    setOpenPopover((current) => current === popover ? undefined : popover);
  }

  function dismissSidePanelWidthGuide() {
    saveSidePanelWidthGuideDismissed();
    setShowSidePanelWidthGuide(false);
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

    const sources = await resolveKnowledgeSources(trimmedInput, locale, activeKnowledgeSpaceId);
    const intent = detectAssistantIntent(trimmedInput, locale);
    const memoryContext = await resolveAssistantMemories(trimmedInput, locale);
    const contextPlan = createContextPlan({
      question: trimmedInput,
      locale,
      intent,
      sources,
      memories: memoryContext.promptMemories,
      sourceMemories: memoryContext.sourceMemories,
    });
    const messageSources = createMessageSources(sources, memoryContext.sourceMemories, contextPlan, locale);
    const noLocalContextAnswer = createNoLocalEntityAnswer(contextPlan, messageSources, locale);
    if (noLocalContextAnswer) {
      const now = Date.now();
      const completedConversation: StoredConversation = {
        id: conversationId,
        title: trimmedInput.slice(0, 48),
        locale,
        messages: [
          ...nextMessages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: noLocalContextAnswer,
            sources: [],
          },
        ],
        status: "completed",
        createdAt: conversationCreatedAt,
        updatedAt: now,
      };

      await saveConversation(completedConversation);
      setMessages(completedConversation.messages);
      setConversationStatus(completedConversation.status);
      setTaskState(undefined);
      setIsRunning(false);
      setProgress("");
      setProgressRatio(undefined);
      pendingSaveRef.current = false;
      await refreshHistory();
      return;
    }
    const plan = createAssistantPlan(intent, trimmedInput, locale);
    const deterministicExecution = executeDeterministicTask(trimmedInput, intent, plan, locale);
    const prompt = buildAssistantPrompt({
      question: trimmedInput,
      locale,
      intent,
      plan,
      deterministicExecution,
      contextPlan,
      sources,
      memories: memoryContext.promptMemories,
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
      if (await submitBackgroundTask(conversation, prompt, messageSources)) {
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
        const cleanedResult = formatContextAwareAnswer(
          stripGeneratedSourceSection(result),
          contextPlan,
          messageSources,
          locale,
        );
        const completedConversation = {
          ...conversation,
          messages: [
            ...nextMessages,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              text: cleanedResult,
              sources: messageSources,
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
            sources: messageSources,
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
    setOpenPopover(undefined);
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
    setOpenPopover(undefined);
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
      const page = await fetchActivePageText(locale);
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
    setOpenPopover(undefined);
    if (isRunning || isReadingPage) {
      return;
    }

    setIsReadingPage(true);
    setError("");
    setProgress(copy.readingPage);
    setProgressRatio(undefined);

    try {
      const page = await fetchActivePageText(locale);
      const file = createWebPageKnowledgeFile(page, locale);
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

  function downloadMessageAsWord(message: ChatMessage) {
    const messageIndex = messages.findIndex((item) => item.id === message.id);
    const previousUserMessage = messageIndex > 0
      ? [...messages].slice(0, messageIndex).reverse().find((item) => item.role === "user")
      : undefined;
    const title = sanitizeFileName(previousUserMessage?.text ?? "localai-response");
    const html = createWordDocumentHtml(message.text, previousUserMessage?.text, locale);
    const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title}-${new Date().toISOString().slice(0, 10)}.doc`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setToast(copy.downloadResponse);
  }

  async function handleRegenerateMessage(messageId: string) {
    if (isRunning) {
      return;
    }

    const assistantIndex = messages.findIndex((message) => message.id === messageId);
    if (assistantIndex < 0 || messages[assistantIndex]?.role !== "assistant") {
      return;
    }

    const userIndex = [...messages]
      .slice(0, assistantIndex)
      .reverse()
      .findIndex((message) => message.role === "user");
    if (userIndex < 0) {
      return;
    }

    const originalUserIndex = assistantIndex - userIndex - 1;
    const userMessage = messages[originalUserIndex];
    const trimmedInput = userMessage.text.trim();
    if (!trimmedInput) {
      return;
    }

    const baseMessages = messages.slice(0, assistantIndex);
    const regeneratingMessages = messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            text: locale === "zh" ? "正在重新回答..." : "Regenerating response...",
            sources: [],
          }
        : message,
    );
    const sources = await resolveKnowledgeSources(trimmedInput, locale, activeKnowledgeSpaceId);
    const intent = detectAssistantIntent(trimmedInput, locale);
    const memoryContext = await resolveAssistantMemories(trimmedInput, locale);
    const contextPlan = createContextPlan({
      question: trimmedInput,
      locale,
      intent,
      sources,
      memories: memoryContext.promptMemories,
      sourceMemories: memoryContext.sourceMemories,
    });
    const messageSources = createMessageSources(sources, memoryContext.sourceMemories, contextPlan, locale);
    const noLocalContextAnswer = createNoLocalEntityAnswer(contextPlan, messageSources, locale);
    if (noLocalContextAnswer) {
      const completedMessages = messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              text: noLocalContextAnswer,
              sources: [],
            }
          : message,
      );
      const completedConversation: StoredConversation = {
        id: conversationId,
        title: trimmedInput.slice(0, 48),
        locale,
        messages: completedMessages,
        status: "completed",
        createdAt: conversationCreatedAt,
        updatedAt: Date.now(),
      };

      await saveConversation(completedConversation);
      setMessages(completedMessages);
      setConversationStatus(completedConversation.status);
      setTaskState(undefined);
      setIsRunning(false);
      setProgress("");
      setProgressRatio(undefined);
      pendingSaveRef.current = false;
      await refreshHistory();
      return;
    }
    const plan = createAssistantPlan(intent, trimmedInput, locale);
    const deterministicExecution = executeDeterministicTask(trimmedInput, intent, plan, locale);
    const prompt = buildAssistantPrompt({
      question: trimmedInput,
      locale,
      intent,
      plan,
      deterministicExecution,
      contextPlan,
      sources,
      memories: memoryContext.promptMemories,
      recentMessages: baseMessages.slice(0, -1),
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
    const queuedConversation: StoredConversation = {
      id: conversationId,
      title: trimmedInput.slice(0, 48),
      locale,
      messages: regeneratingMessages,
      status: "queued",
      taskState: nextTaskState,
      createdAt: conversationCreatedAt,
      updatedAt: now,
    };

    pendingSaveRef.current = true;
    setIsRunning(true);
    setError("");
    setSourcePreview(undefined);
    setProgressRatio(undefined);
    setProgress(formatTaskStatus("queued", locale));
    setMessages(regeneratingMessages);
    setConversationStatus("queued");
    setTaskState(nextTaskState);
    await saveConversation(queuedConversation);
    await refreshHistory();

    try {
      const result = await runAiTask({
        task: "prompt",
        text: prompt,
        locale,
        onProgress(nextProgress) {
          setProgress(nextProgress.message);
          setProgressRatio(nextProgress.ratio);
        },
      });
      const cleanedResult = formatContextAwareAnswer(
        stripGeneratedSourceSection(result),
        contextPlan,
        messageSources,
        locale,
      );
      const completedMessages = messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              text: cleanedResult,
              sources: messageSources,
            }
          : message,
      );
      const completedConversation: StoredConversation = {
        ...queuedConversation,
        messages: completedMessages,
        status: "completed",
        taskState: updateStoredTaskState(nextTaskState, "completed"),
        updatedAt: Date.now(),
      };
      await saveConversation(completedConversation);
      setMessages(completedMessages);
      setConversationStatus(completedConversation.status);
      setTaskState(completedConversation.taskState);
      setProgress(copy.complete);
      await refreshHistory();
      await refreshCapabilities();
    } catch (reason) {
      const message = deterministicExecution.handled
        ? formatDeterministicExecution(deterministicExecution, locale)
        : reason instanceof Error ? reason.message : copy.taskError;
      const failedMessages = messages.map((chatMessage) =>
        chatMessage.id === messageId
          ? {
              ...chatMessage,
              text: message,
              sources: messageSources,
            }
          : chatMessage,
      );
      const failedConversation: StoredConversation = {
        ...queuedConversation,
        messages: failedMessages,
        status: deterministicExecution.handled ? "completed" : "failed",
        taskState: updateStoredTaskState(
          nextTaskState,
          deterministicExecution.handled ? "completed" : "failed",
          deterministicExecution.handled ? undefined : message,
        ),
        updatedAt: Date.now(),
      };
      await saveConversation(failedConversation);
      setMessages(failedMessages);
      setConversationStatus(failedConversation.status);
      setTaskState(failedConversation.taskState);
      setError(deterministicExecution.handled ? "" : message);
      setProgress(deterministicExecution.handled ? copy.complete : "");
      await refreshHistory();
    } finally {
      setIsRunning(false);
      pendingSaveRef.current = false;
    }
  }

  async function handleKnowledgeImport(files: FileList | null) {
    setOpenPopover(undefined);
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

  async function handleDataExport() {
    setOpenPopover(undefined);
    try {
      const json = await exportAllIndexedDbData();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `localai-indexeddb-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setToast(copy.dataExported);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : copy.taskError;
      setError(message);
      setToast(message);
    }
  }

  async function handlePortableDataExport() {
    setOpenPopover(undefined);
    try {
      const jsonl = await exportPortableAiData();
      const blob = new Blob([jsonl], { type: "application/x-ndjson;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `localai-portable-data-${new Date().toISOString().slice(0, 10)}.jsonl`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setToast(copy.portableDataExported);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : copy.taskError;
      setError(message);
      setToast(message);
    }
  }

  async function handleDataImport(files: FileList | null) {
    setOpenPopover(undefined);
    const file = files?.[0];
    if (!file) {
      return;
    }

    try {
      const json = await file.text();
      if (!window.confirm(copy.importDataConfirm)) {
        return;
      }

      const result = await importAllIndexedDbData(json);
      await loadLatestConversation();
      const spaces = await listKnowledgeSpaces();
      const nextSpaceId = spaces.some((space) => space.id === activeKnowledgeSpaceId)
        ? activeKnowledgeSpaceId
        : spaces[0]?.id ?? "default";
      setKnowledgeSpaces(spaces);
      setActiveKnowledgeSpaceId(nextSpaceId);
      await refreshKnowledgeCount(nextSpaceId);
      await refreshAssistantMemories();
      setError("");
      setToast(`${copy.dataImported}: ${result.recordCount}`);
    } catch (reason) {
      const message = reason instanceof Error ? `${copy.dataImportInvalid}: ${reason.message}` : copy.dataImportInvalid;
      setError(message);
      setToast(message);
    } finally {
      if (dataImportInputRef.current) {
        dataImportInputRef.current.value = "";
      }
    }
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

  const isEmptyConversation = messages.length === 0 && !isRunning;
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

  function selectConversation(conversation: StoredConversation) {
    pendingSaveRef.current = false;
    setConversationId(conversation.id);
    setConversationCreatedAt(conversation.createdAt);
    setMessages(conversation.messages);
    setConversationStatus(conversation.status);
    setTaskState(conversation.taskState);
    setIsRunning(isConversationActive(conversation.status));
    setSourcePreview(undefined);
    setError("");
    setProgress(isConversationActive(conversation.status)
      ? formatTaskStatus(conversation.status, locale)
      : "");
    setProgressRatio(undefined);
    setOpenPopover(undefined);
  }

  function renderHistoryItems(items = history) {
    if (!items.length) {
      return <div className="history-empty">{copy.emptyHistory}</div>;
    }

    return items.map((conversation) => (
      <button
        key={conversation.id}
        className={conversation.id === conversationId ? "history-item active" : "history-item"}
        type="button"
        onClick={() => selectConversation(conversation)}
      >
        <span>{conversation.title}</span>
        <time>{formatHistoryTime(conversation.updatedAt, locale)}</time>
      </button>
    ));
  }

  const filteredHistory = historySearchQuery.trim()
    ? history.filter((conversation) => conversation.title.toLowerCase().includes(historySearchQuery.trim().toLowerCase()))
    : history;

  function renderSettingsPopover() {
    return (
      <div
        className={`settings-popover ${openPopover === "settings" ? "open" : ""}`}
        role="dialog"
        aria-label={copy.settings}
      >
        <button type="button" onClick={() => void handleDataExport()}>
          <Download size={18} />
          <span>{copy.exportBackup}</span>
        </button>
        <button type="button" onClick={() => void handlePortableDataExport()}>
          <FileText size={18} />
          <span>{copy.exportPortableData}</span>
        </button>
        <button type="button" onClick={() => dataImportInputRef.current?.click()}>
          <Upload size={18} />
          <span>{copy.importData}</span>
        </button>
      </div>
    );
  }

  return (
    <main className={`app-shell ${surface}-surface`}>
      <section className={`workspace ${surface === "tab" && isHistorySidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        {surface === "tab" ? (
          <aside
            className={`history-sidebar ${isHistorySidebarCollapsed ? "collapsed" : ""}`}
            aria-label={copy.history}
          >
            <div className="history-sidebar-brand">
              <span className="brand-mark" aria-hidden="true">L</span>
              <button
                className="sidebar-collapse-button"
                type="button"
                onClick={() => setIsHistorySidebarCollapsed(true)}
                title={copy.collapseSidebar}
                aria-label={copy.collapseSidebar}
              >
                <PanelLeft size={22} />
              </button>
            </div>
            <div className="history-sidebar-rail">
              <div className="history-sidebar-rail-main">
                <button
                  className="sidebar-expand-button"
                  type="button"
                  onClick={() => setIsHistorySidebarCollapsed(false)}
                  data-tooltip={copy.openSidebar}
                  title={copy.openSidebar}
                  aria-label={copy.openSidebar}
                >
                  <Menu size={23} />
                </button>
                <button
                  className="sidebar-rail-action"
                  type="button"
                  onClick={clearChat}
                  data-tooltip={copy.newConversation}
                  title={copy.newConversation}
                  aria-label={copy.newConversation}
                >
                  <SquarePen size={23} />
                </button>
              </div>
              <div className="settings-control sidebar-rail-settings" data-popover-root>
                <button
                  className="sidebar-rail-action"
                  type="button"
                  onClick={() => togglePopover("settings")}
                  data-tooltip={copy.settings}
                  title={copy.settings}
                  aria-label={copy.settings}
                  aria-expanded={openPopover === "settings"}
                  aria-haspopup="dialog"
                >
                  <Settings size={23} />
                </button>
                {renderSettingsPopover()}
              </div>
            </div>
            {isHistorySidebarCollapsed ? (
              null
            ) : (
              <>
                <button className="history-sidebar-action" type="button" onClick={clearChat}>
                  <SquarePen size={22} />
                  <span>{copy.newConversation}</span>
                </button>
                <label className="history-sidebar-search">
                  <Search size={22} />
                  <input
                    value={historySearchQuery}
                    onChange={(event) => setHistorySearchQuery(event.target.value)}
                    placeholder={copy.searchConversations}
                    aria-label={copy.searchConversations}
                  />
                </label>
                <div className="history-sidebar-title">
                  <span>{copy.recentTopics}</span>
                  <strong>{filteredHistory.length}</strong>
                </div>
                <div className="history-sidebar-list" role="list">
                  {renderHistoryItems(filteredHistory)}
                </div>
                <div className="settings-control history-sidebar-settings" data-popover-root>
                  <button
                    className="history-sidebar-action"
                    type="button"
                    onClick={() => togglePopover("settings")}
                    title={copy.settings}
                    aria-label={copy.settings}
                    aria-expanded={openPopover === "settings"}
                    aria-haspopup="dialog"
                  >
                    <Settings size={22} />
                    <span>{copy.settings}</span>
                  </button>
                  {renderSettingsPopover()}
                </div>
              </>
            )}
          </aside>
        ) : null}
        <header className="topbar">
          <div className="topbar-left">
            <div className="history-control" data-popover-root>
              <button
                className="history-button"
                type="button"
                onClick={() => togglePopover("history")}
                title={copy.history}
                aria-label={copy.history}
                aria-expanded={openPopover === "history"}
                aria-haspopup="dialog"
              >
                <PanelLeft size={22} />
              </button>
              <div
                className={`history-popover ${openPopover === "history" ? "open" : ""}`}
                role="list"
                aria-label={copy.history}
              >
                <div className="history-title">{copy.history}</div>
                {renderHistoryItems()}
              </div>
            </div>
            <button
              className="new-chat-button"
              type="button"
              onClick={clearChat}
              title={copy.newConversation}
              aria-label={copy.newConversation}
            >
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

        <section
          className={`panel chat-panel ${shouldShowTaskStatus ? "has-task-state" : ""} ${
            isEmptyConversation ? "empty-chat" : ""
          }`}
          aria-label={copy.chatLabel}
        >
          {surface === "sidepanel" && showSidePanelWidthGuide ? (
            <div className="sidepanel-width-guide" role="note">
              <span>{copy.sidePanelWidthGuide}</span>
              <button type="button" onClick={dismissSidePanelWidthGuide}>
                {copy.sidePanelWidthGuideAction}
              </button>
            </div>
          ) : null}

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
            {isEmptyConversation ? (
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
	                        <button
	                          type="button"
	                          className="message-action"
	                          onClick={() => void copyMessage(message.text)}
	                          data-tooltip={copy.copy}
	                          title={copy.copy}
	                          aria-label={copy.copy}
	                        >
                          <Clipboard size={17} />
                        </button>
	                        <button
	                          type="button"
	                          className="message-action"
	                          onClick={() => downloadMessageAsWord(message)}
	                          data-tooltip={copy.downloadResponse}
	                          title={copy.downloadResponse}
	                          aria-label={copy.downloadResponse}
	                        >
	                          <Download size={17} />
	                        </button>
	                        <button
	                          type="button"
	                          className="message-action"
	                          onClick={() => void handleRegenerateMessage(message.id)}
	                          disabled={isRunning}
	                          data-tooltip={copy.regenerateResponse}
	                          title={copy.regenerateResponse}
	                          aria-label={copy.regenerateResponse}
	                        >
	                          <RotateCcw size={17} />
	                        </button>
                      </div>
                    )}
                    {message.role === "assistant" && message.sources?.length ? (
                      <>
                        <div className="message-sources">
	                          <span className="message-sources-label">{copy.references}</span>
                          {message.sources.map((source, index) => (
                            <button
                              type="button"
                              key={`${source.sourceLabel ?? index}-${source.documentName}-${source.chunkIndex}`}
                              onClick={() => setSourcePreview({ messageId: message.id, index, source })}
                              className={
                                sourcePreview?.messageId === message.id && sourcePreview.index === index
                                  ? "active"
                                  : undefined
                              }
                            >
	                              {formatMessageSourceLabel(source, index, locale)}
                            </button>
                          ))}
                        </div>
                        {sourcePreview?.messageId === message.id ? (
                          <div className="source-preview">
                            <div className="source-preview-header">
                              <div>
                                <strong>{copy.sourcePreview}</strong>
                                <span>
                                  {formatMessageSourceLabel(sourcePreview.source, sourcePreview.index, locale)}
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
                <div className="skill-control" data-popover-root>
                  <button
                    className="tool-icon-button"
                    type="button"
                    onClick={() => togglePopover("skills")}
                    title={copy.moreSkills}
                    aria-label={copy.moreSkills}
                    aria-expanded={openPopover === "skills"}
                    aria-haspopup="dialog"
                  >
                    <Plus size={21} />
                  </button>
                  <div
                    className={`skill-popover ${openPopover === "skills" ? "open" : ""}`}
                    role="dialog"
                    aria-label={copy.moreSkills}
                  >
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
                <div className="page-control" data-popover-root>
                  <button
                    className="tool-chip page-chip"
                    type="button"
                    onClick={() => togglePopover("page")}
                    title={copy.webPage}
                    aria-label={copy.webPage}
                    aria-expanded={openPopover === "page"}
                    aria-haspopup="dialog"
                    disabled={isRunning || isReadingPage}
                  >
                    {isReadingPage ? <LoaderCircle size={18} className="spin" /> : <Globe2 size={18} />}
                    <span>{copy.webPage}</span>
                  </button>
                  <div
                    className={`page-popover ${openPopover === "page" ? "open" : ""}`}
                    role="dialog"
                    aria-label={copy.webPage}
                  >
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
                <div className="knowledge-control" data-popover-root>
                  <button
                    className="tool-chip knowledge-chip"
                    type="button"
                    onClick={() => togglePopover("knowledge")}
                    title={copy.knowledgeFiles}
                    aria-label={copy.knowledgeFiles}
                    aria-expanded={openPopover === "knowledge"}
                    aria-haspopup="dialog"
                  >
                    <Database size={18} />
                    <span>{copy.knowledge}{knowledgeCount ? ` ${knowledgeCount}` : ""}</span>
                  </button>
                  <div
                    className={`knowledge-popover ${openPopover === "knowledge" ? "open" : ""}`}
                    role="dialog"
                    aria-label={copy.knowledgeFiles}
                  >
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
                            {formatKnowledgeSpaceName(space, locale)}
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
                <div className="memory-control" data-popover-root>
                  <button
                    className="tool-chip memory-chip"
                    type="button"
                    onClick={() => togglePopover("memory")}
                    title={copy.memories}
                    aria-label={copy.memories}
                    aria-expanded={openPopover === "memory"}
                    aria-haspopup="dialog"
                  >
                    <Brain size={18} />
                    <span>{copy.memories}{assistantMemories.length ? ` ${assistantMemories.length}` : ""}</span>
                  </button>
                  <div
                    className={`memory-popover ${openPopover === "memory" ? "open" : ""}`}
                    role="dialog"
                    aria-label={copy.memories}
                  >
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
          <input
            ref={dataImportInputRef}
            className="sr-only"
            type="file"
            accept=".json,application/json"
            onChange={(event) => void handleDataImport(event.target.files)}
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
  const separator = locale === "zh" ? "：" : ": ";
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
    return `${label}${separator}${text}`;
  }

  if (task === "rewrite") {
    const label = locale === "zh" ? "润色改写为更清晰自然的表达" : "Polish for clearer, more natural wording";
    return `${label}${separator}${text}`;
  }

  const labels: Record<Exclude<TextAction, "translate" | "rewrite">, string> = {
    summarize: copy.summarizeText,
    write: copy.writeText,
  };

  return `${labels[task]}${separator}${text}`;
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
      ? `${copy.memorySaved}：${memory.content}`
      : `${copy.memorySaved}: ${memory.content}`;
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

async function resolveAssistantMemories(input: string, locale: Locale) {
  const matchedMemories = await searchAssistantMemories(input, 5);
  if (!shouldExpandMemorySearch(input, locale)) {
    return {
      promptMemories: matchedMemories,
      sourceMemories: matchedMemories,
    };
  }

  const profileMemories = (await listAssistantMemories())
    .filter((memory) => memory.type === "fact" || memory.type === "preference" || memory.type === "project")
    .slice(0, 5);
  const mergedMemories = new Map<string, AssistantMemory>();

  for (const memory of [...matchedMemories, ...profileMemories]) {
    mergedMemories.set(memory.id, memory);
  }

  const promptMemories = [...mergedMemories.values()].slice(0, 5);

  return {
    promptMemories,
    sourceMemories: matchedMemories.length ? matchedMemories : profileMemories.slice(0, 3),
  };
}

async function resolveKnowledgeSources(input: string, locale: Locale, spaceId: string) {
  const [builtinSources, userSources] = await Promise.all([
    Promise.resolve(searchBuiltinKnowledge(input, locale)),
    searchKnowledge(input, 5, spaceId),
  ]);

  return [...builtinSources, ...userSources].slice(0, 5);
}

function createMessageSources(
  sources: KnowledgeMatch[],
  memories: AssistantMemory[],
  contextPlan: ContextPlan,
  locale: Locale,
): NonNullable<ChatMessage["sources"]> {
  return [
    ...(
      contextPlan.visibleSources.includes("knowledge")
        ? sources.map((source, index) => ({
            sourceType: "knowledge" as const,
            sourceLabel: `[${index + 1}]`,
            documentName: source.documentName,
            chunkIndex: source.chunkIndex,
            text: source.text,
          }))
        : []
    ),
    ...(
      contextPlan.visibleSources.includes("memory")
        ? memories.map((memory, index) => ({
            sourceType: "memory" as const,
            sourceLabel: `[M${index + 1}]`,
            documentName: translations[locale].memories,
            chunkIndex: index,
            text: memory.content,
          }))
        : []
    ),
  ];
}

function formatMessageSourceLabel(source: MessageSource, fallbackIndex: number, locale: Locale) {
  const label = source.sourceLabel ?? `[${fallbackIndex + 1}]`;

  if (source.sourceType === "memory") {
    return `${label} ${translations[locale].memories}`;
  }

  return `${label} ${source.documentName} · ${translations[locale].sourceChunk} ${source.chunkIndex + 1}`;
}

function stripGeneratedSourceSection(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trimEnd();
  const lines = normalized.split("\n");
  const sourceHeadingPattern = /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*)?\s*(?:引用来源|参考来源|本地知识库来源|知识库来源|来源|Sources|References|Local knowledge sources?)\s*[:：]?\s*(?:\*\*)?\s*(?:（无）|\(none\)|none|无)?\s*$/i;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }

    if (sourceHeadingPattern.test(line)) {
      return lines.slice(0, index).join("\n").trimEnd();
    }
  }

  return normalized;
}

function formatContextAwareAnswer(
  text: string,
  contextPlan: ContextPlan,
  sources: NonNullable<ChatMessage["sources"]>,
  locale: Locale,
) {
  const usesVisibleMemory = sources.some((source) => source.sourceType === "memory");
  const usesVisibleKnowledge = sources.some((source) => source.sourceType === "knowledge");
  const naturalText = usesVisibleMemory ? normalizeMemoryAnswerTone(text, usesVisibleKnowledge, locale) : text;

  if (!usesVisibleMemory || !contextPlan.shouldCompareWithGeneralKnowledge) {
    return naturalText;
  }

  const hasSavedContentExplanation = locale === "zh"
    ? /根据你(?:之前)?保存的内容|按你保存的内容|你保存的内容|你的记忆|长期记忆/.test(naturalText)
    : /\bbased on (?:your )?saved content\b|\byou saved\b|\byour memory\b|\blong-term memory\b/i.test(naturalText);

  if (hasSavedContentExplanation) {
    return naturalText;
  }

  const note = locale === "zh"
    ? "这是根据你保存的内容回答的。"
    : "This is based on your saved content.";

  return `${naturalText.trimEnd()}\n\n${note}`;
}

function normalizeMemoryAnswerTone(text: string, hasKnowledgeSources: boolean, locale: Locale) {
  let normalized = text.trimEnd();

  if (!hasKnowledgeSources) {
    normalized = normalized.replace(/\s*(?:\[[0-9]+\]\s*)+$/g, "");
  }

  if (locale === "zh") {
    return normalizeChineseMemoryPerspective(normalized);
  }

  return normalized
    .replace(/\bthe user's\b/gi, "your")
    .replace(/\bthe user owns\b/gi, "you own")
    .replace(/\bbased on the user's\b/gi, "based on your");
}

function normalizeChineseMemoryPerspective(text: string) {
  const cjkFollowingFirstPerson = /我(?=[\u3400-\u9fff])/g;

  return text
    .replace(/根据用户/g, "根据你")
    .replace(/用户的/g, "你的")
    .replace(/用户/g, "你")
    .replace(/我的/g, "你的")
    .replace(cjkFollowingFirstPerson, "你");
}

function createNoLocalEntityAnswer(
  contextPlan: ContextPlan,
  sources: NonNullable<ChatMessage["sources"]>,
  locale: Locale,
) {
  if (!contextPlan.requiresLocalEvidence || sources.length) {
    return undefined;
  }

  const target = contextPlan.targetEntity?.trim();
  if (!target) {
    return locale === "zh"
      ? "我目前没有保存相关信息。"
      : "I do not currently have saved information about that.";
  }

  return locale === "zh"
    ? `我目前没有保存关于“${target}”的信息。`
    : `I do not currently have saved information about "${target}".`;
}

function formatKnowledgeSpaceName(space: KnowledgeSpace, locale: Locale) {
  if (space.id === "default" && space.name === "个人资料") {
    return locale === "zh" ? "个人资料" : "Personal profile";
  }

  return space.name;
}

async function fetchActivePageText(locale: Locale): Promise<WebPageSnapshot> {
  const runtime = getChromeExtensionApi()?.runtime;
  if (!runtime?.id || !runtime.sendMessage) {
    throw new Error(
      locale === "zh"
        ? "当前 Chrome 扩展运行时不可用。"
        : "Chrome extension runtime is unavailable.",
    );
  }

  const response = await runtime.sendMessage({
    target: "background",
    type: "GET_ACTIVE_PAGE_TEXT",
    locale,
  });

  if (!response?.ok || !response.page?.text) {
    throw new Error(response?.error ?? (locale === "zh" ? "无法读取当前网页。" : "Failed to read current page."));
  }

  return {
    title: response.page.title,
    url: response.page.url,
    text: response.page.text,
    extractedAt: response.page.extractedAt,
  };
}

function createWebPageKnowledgeFile(page: WebPageSnapshot, locale: Locale) {
  const title = page.title || page.url || (locale === "zh" ? "未命名网页" : "Untitled page");
  const capturedAt = new Date(page.extractedAt ?? Date.now()).toISOString();
  const markdown = locale === "zh"
    ? `# ${title}

来源地址：${page.url}
捕获时间：${capturedAt}

${page.text}
`
    : `# ${title}

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

function createWordDocumentHtml(markdown: string, question: string | undefined, locale: Locale) {
  const title = question?.trim() || (locale === "zh" ? "localAI 回答" : "localAI response");
  const body = markdownToWordHtml(markdown);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      color: #111111;
      font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.65;
    }
    h1, h2, h3, h4, h5, h6 {
      margin: 18pt 0 8pt;
      font-weight: 700;
      line-height: 1.3;
    }
    p {
      margin: 0 0 10pt;
    }
    ul, ol {
      margin: 0 0 10pt 20pt;
      padding: 0;
    }
    li {
      margin: 3pt 0;
    }
    code {
      font-family: Consolas, "Courier New", monospace;
      background: #f2f2f2;
    }
    pre {
      margin: 0 0 10pt;
      padding: 8pt;
      background: #f2f2f2;
      white-space: pre-wrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 10pt;
    }
    th, td {
      border: 1px solid #d9d9d9;
      padding: 6pt;
      text-align: left;
      vertical-align: top;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`;
}

function markdownToWordHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let listType: "ul" | "ol" | undefined;
  let codeLines: string[] | undefined;

  const closeList = () => {
    if (listType) {
      output.push(`</${listType}>`);
      listType = undefined;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (codeLines) {
        output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = undefined;
      } else {
        closeList();
        codeLines = [];
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      closeList();
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      output.push(`<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const unorderedMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    if (unorderedMatch) {
      if (listType !== "ul") {
        closeList();
        output.push("<ul>");
        listType = "ul";
      }
      output.push(`<li>${formatInlineMarkdown(unorderedMatch[1])}</li>`);
      continue;
    }

    const orderedMatch = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (orderedMatch) {
      if (listType !== "ol") {
        closeList();
        output.push("<ol>");
        listType = "ol";
      }
      output.push(`<li>${formatInlineMarkdown(orderedMatch[1])}</li>`);
      continue;
    }

    closeList();
    output.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
  }

  if (codeLines) {
    output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  closeList();

  return output.join("\n");
}

function formatInlineMarkdown(text: string) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatWebPageUserMessage(action: WebPageAction, page: WebPageSnapshot, question: string, locale: Locale) {
  const title = page.title || page.url;
  const separator = locale === "zh" ? "：" : ": ";
  const labels: Record<WebPageAction, Record<Locale, string>> = {
    summary: { zh: "总结当前网页", en: "Summarize current page" },
    qa: { zh: "基于当前网页回答", en: "Answer from current page" },
    todos: { zh: "提取当前网页待办", en: "Extract todos from current page" },
    notes: { zh: "整理当前网页笔记", en: "Create notes from current page" },
  };

  if (action === "qa" && question) {
    return `${labels.qa[locale]}${separator}${question}\n${title}`;
  }

  return `${labels[action][locale]}${separator}${title}`;
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
  sources: NonNullable<ChatMessage["sources"]>,
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
