import {
  ChevronsUpDown,
  CircleX,
  Clipboard,
  Database,
  Ellipsis,
  FileText,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Laptop,
  LoaderCircle,
  PanelLeft,
  Plus,
  RefreshCw,
  Send,
  SquarePen,
  Sparkles,
  Trash2,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type CapabilityStatus,
  type Locale,
  inspectCapabilities,
  runAiTask,
} from "./lib/chromeAi";
import {
  type StoredConversation,
  type StoredChatMessage,
  getConversation,
  listConversations,
  saveConversation,
} from "./lib/conversationStore";
import {
  type KnowledgeDocument,
  type KnowledgeMatch,
  clearKnowledgeDocuments,
  deleteKnowledgeDocument,
  importKnowledgeFiles,
  listKnowledgeDocuments,
  searchKnowledge,
} from "./lib/knowledgeStore";

type ChatMessage = StoredChatMessage;

const translations: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    heroQuestion: string;
    placeholder: string;
    send: string;
    clear: string;
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
    noKnowledgeUsed: string;
    refreshApis: string;
    chatLabel: string;
    inputLabel: string;
    assistantLabel: string;
    userLabel: string;
    history: string;
    emptyHistory: string;
    newConversation: string;
    localComputer: string;
    selectProject: string;
    approval: string;
    knowledge: string;
    moreSkills: string;
    taskMode: string;
    unavailableHint: string;
    statusLabels: Record<string, string>;
    inspectError: string;
    taskError: string;
  }
> = {
  zh: {
    eyebrow: "Chrome 内置 AI",
    title: "新工作任务",
    subtitle: "本地模型 · 浏览器内运行",
    heroQuestion: "有什么我能帮你的吗？",
    placeholder: "发消息或按住 Fn 说话，/ 选择技能",
    send: "发送",
    clear: "清空对话",
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
    noKnowledgeUsed: "未检索到相关知识",
    refreshApis: "刷新 API 状态",
    chatLabel: "本地 AI 对话",
    inputLabel: "消息",
    assistantLabel: "localAI",
    userLabel: "你",
    history: "历史对话",
    emptyHistory: "暂无历史对话",
    newConversation: "新建对话",
    localComputer: "本地电脑",
    selectProject: "选择项目",
    approval: "按需确认",
    knowledge: "浏览器知识",
    moreSkills: "更多技能",
    taskMode: "工作任务 Auto",
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
  },
  en: {
    eyebrow: "Chrome Built-in AI",
    title: "New Work Task",
    subtitle: "Local model · Runs in the browser",
    heroQuestion: "What can I help with?",
    placeholder: "Send a message, hold Fn to talk, or use / for skills",
    send: "Send",
    clear: "Clear chat",
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
    noKnowledgeUsed: "No relevant knowledge found",
    refreshApis: "Refresh APIs",
    chatLabel: "Local AI chat",
    inputLabel: "Message",
    assistantLabel: "localAI",
    userLabel: "You",
    history: "Conversation history",
    emptyHistory: "No conversations yet",
    newConversation: "New conversation",
    localComputer: "Local computer",
    selectProject: "Select project",
    approval: "Ask before action",
    knowledge: "Browser knowledge",
    moreSkills: "More skills",
    taskMode: "Work Task Auto",
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
  },
};

function getStatusTone(status: CapabilityStatus["availability"]) {
  if (status === "available") return "ready";
  if (status === "downloadable" || status === "downloading") return "pending";
  if (status === "missing" || status === "unavailable") return "blocked";
  return "neutral";
}

export function App() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [conversationCreatedAt, setConversationCreatedAt] = useState(() => Date.now());
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [progressRatio, setProgressRatio] = useState<number | undefined>();
  const [toast, setToast] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [capabilities, setCapabilities] = useState<CapabilityStatus[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<StoredConversation[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSaveRef = useRef(false);

  const copy = translations[locale];
  const promptCapability = useMemo(
    () => capabilities.find((capability) => capability.task === "prompt"),
    [capabilities],
  );
  const promptStatus = promptCapability?.availability ?? "checking";

  async function refreshCapabilities() {
    setIsRefreshing(true);
    setError("");

    try {
      setCapabilities(await inspectCapabilities());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.inspectError);
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshCapabilities();
    void loadLatestConversation();
    void refreshKnowledgeCount();
  }, []);

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

  async function refreshKnowledgeCount() {
    const documents = await listKnowledgeDocuments();
    setKnowledgeDocuments(documents);
    setKnowledgeCount(documents.length);
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
    setIsRunning(latestConversation.status === "running");
  }

  async function syncActiveConversation() {
    const conversation = await getConversation(conversationId);
    if (!conversation) {
      return;
    }

    setMessages(conversation.messages);
    const stillRunning = conversation.status === "running";
    setIsRunning(stillRunning);
    if (!stillRunning) {
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
    const sources = await searchKnowledge(trimmedInput, 5);
    const prompt = buildKnowledgePrompt(trimmedInput, sources, locale);
    const now = Date.now();
    const conversation: StoredConversation = {
      id: conversationId,
      title: trimmedInput.slice(0, 48),
      locale,
      messages: nextMessages,
      status: "running",
      createdAt: conversationCreatedAt,
      updatedAt: now,
    };

    setMessages(nextMessages);
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
          status: "idle" as const,
          updatedAt: Date.now(),
        };
        await saveConversation(completedConversation);
        setMessages(completedConversation.messages);
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
            sources,
          },
        ],
        status: "idle" as const,
        updatedAt: Date.now(),
      };
      await saveConversation(failedConversation);
      setError(message);
      setMessages(failedConversation.messages);
      setProgress("");
      setIsRunning(false);
    } finally {
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

    const documents = await importKnowledgeFiles(supportedFiles);
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

    await clearKnowledgeDocuments();
    await refreshKnowledgeCount();
    setToast(copy.knowledgeCleared);
  }

  return (
    <main className="app-shell">
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
                        setError("");
                        setProgress("");
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

        <section className="panel chat-panel" aria-label={copy.chatLabel}>
          {typeof progressRatio === "number" && (
            <div className="progress-track">
              <div className="progress-bar" style={{ width: `${Math.min(progressRatio * 100, 100)}%` }} />
            </div>
          )}

          {promptStatus === "missing" || promptStatus === "unavailable" ? (
            <div className={`status-banner ${getStatusTone(promptStatus as CapabilityStatus["availability"])}`}>
              {copy.unavailableHint}
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
                      <div className="message-sources">
                        {message.sources.map((source, index) => (
                          <span key={`${source.documentName}-${source.chunkIndex}`}>
                            [{index + 1}] {source.documentName}
                          </span>
                        ))}
                      </div>
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

          <div className="composer">
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
                <button className="tool-icon-button" type="button" title={copy.moreSkills}>
                  <Plus size={21} />
                </button>
                <span className="divider" />
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
                    <button
                      className="knowledge-clear-button"
                      type="button"
                      onClick={() => void handleKnowledgeClear()}
                      disabled={!knowledgeDocuments.length}
                    >
                      <Trash2 size={16} />
                      <span>{copy.clearKnowledge}</span>
                    </button>
                  </div>
                </div>
                <button className="tool-chip active" type="button">
                  <Sparkles size={18} />
                  <span>{copy.taskMode}</span>
                  <ChevronsUpDown size={16} />
                </button>
                <button className="tool-chip" type="button">
                  <Laptop size={18} />
                  <span>{copy.localComputer}</span>
                  <CircleX size={15} />
                </button>
              </div>
              <div className="tool-group right">
                <button className="tool-icon-button" type="button" onClick={clearChat} title={copy.clear}>
                  <Trash2 size={18} />
                </button>
                <button className="tool-icon-button" type="button" onClick={refreshCapabilities} title={copy.refreshApis}>
                  <RefreshCw size={18} className={isRefreshing ? "spin" : undefined} />
                </button>
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

function buildKnowledgePrompt(question: string, sources: KnowledgeMatch[], locale: Locale) {
  if (!sources.length) {
    return question;
  }

  const sourceText = sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.documentName} #${source.chunkIndex + 1}\n${source.text}`,
    )
    .join("\n\n");

  if (locale === "zh") {
    return `请优先根据下面的本地知识库片段回答用户问题。若片段不足以回答，请明确说明缺少哪些信息。回答尽量使用 Markdown，并在相关结论后标注引用编号，如 [1]。

本地知识库片段：
${sourceText}

用户问题：
${question}`;
  }

  return `Answer the user's question using the local knowledge snippets first. If the snippets are insufficient, say what is missing. Use Markdown and cite relevant claims with source numbers like [1].

Local knowledge snippets:
${sourceText}

User question:
${question}`;
}

async function submitBackgroundTask(conversation: StoredConversation, prompt: string, sources: KnowledgeMatch[]) {
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
      prompt,
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
