import type { Locale } from "./chromeAi";
import type { AssistantMemory } from "./assistantMemoryStore";
import type { DeterministicExecution } from "./assistantDeterministicExecutor";
import type { AssistantIntent } from "./assistantIntent";
import type { AssistantPlan } from "./assistantPlanner";
import type { StoredChatMessage } from "./conversationStore";
import type { KnowledgeMatch } from "./knowledgeStore";

type BuildAssistantPromptInput = {
  question: string;
  locale: Locale;
  intent?: AssistantIntent;
  plan?: AssistantPlan;
  deterministicExecution?: DeterministicExecution;
  sources: KnowledgeMatch[];
  memories: AssistantMemory[];
  recentMessages: StoredChatMessage[];
};

const MAX_CONTEXT_MESSAGES = 6;
const MAX_CONTEXT_CHARS = 2800;

export function buildAssistantPrompt({
  question,
  locale,
  intent,
  plan,
  deterministicExecution,
  sources,
  memories,
  recentMessages,
}: BuildAssistantPromptInput) {
  const intentContext = buildIntentContext(intent, locale);
  const planContext = buildPlanContext(plan, locale);
  const deterministicContext = buildDeterministicExecutionContext(deterministicExecution, locale);
  const conversationContext = buildConversationContext(recentMessages, locale);
  const memoryContext = buildMemoryContext(memories, locale);
  const knowledgeContext = buildKnowledgeContext(sources, locale);

  if (locale === "zh") {
    return `你是 localAI，一个运行在 Chrome 浏览器内的本地优先个人助手。

工作原则：
- 先判断用户意图，再组织回答。
- 涉及本地知识库时，优先依据“本地知识库片段”回答，并在相关结论后标注引用编号，如 [1]。
- 如果资料不足，明确说明缺少的信息，不要编造。
- 如果问题需要计算、列表整理或步骤规划，先给出结构化结果，再补充必要说明。
- 保持回答简洁、可执行，默认使用中文和 Markdown。

${intentContext}

${planContext}

${deterministicContext}

${conversationContext}

${memoryContext}

${knowledgeContext}

用户问题：
${question}`;
  }

  return `You are localAI, a local-first personal assistant running inside Chrome.

Operating rules:
- Identify the user's intent before forming the answer.
- When local knowledge snippets are present, answer from them first and cite relevant claims with source numbers like [1].
- If the available material is insufficient, say what is missing instead of inventing facts.
- If the task requires calculation, organization, or planning, produce structured results before any extra explanation.
- Keep the answer concise, actionable, and in Markdown.

${intentContext}

${planContext}

${deterministicContext}

${conversationContext}

${memoryContext}

${knowledgeContext}

User question:
${question}`;
}

function buildIntentContext(intent: AssistantIntent | undefined, locale: Locale) {
  if (!intent) {
    return locale === "zh" ? "结构化意图：无" : "Structured intent: none";
  }

  const serialized = JSON.stringify({
    type: intent.type,
    confidence: intent.confidence,
    executionMode: intent.executionMode,
    requiredTools: intent.requiredTools,
    entities: intent.entities,
    rationale: intent.rationale,
  }, null, 2);

  return locale === "zh"
    ? `结构化意图：\n\`\`\`json\n${serialized}\n\`\`\``
    : `Structured intent:\n\`\`\`json\n${serialized}\n\`\`\``;
}

function buildPlanContext(plan: AssistantPlan | undefined, locale: Locale) {
  if (!plan) {
    return locale === "zh" ? "结构化计划：无" : "Structured plan: none";
  }

  const serialized = JSON.stringify({
    id: plan.id,
    intentType: plan.intentType,
    executionMode: plan.executionMode,
    summary: plan.summary,
    requiredTools: plan.requiredTools,
    steps: plan.steps,
    needsModelPolish: plan.needsModelPolish,
    rationale: plan.rationale,
  }, null, 2);

  return locale === "zh"
    ? `结构化计划：\n\`\`\`json\n${serialized}\n\`\`\``
    : `Structured plan:\n\`\`\`json\n${serialized}\n\`\`\``;
}

function buildDeterministicExecutionContext(execution: DeterministicExecution | undefined, locale: Locale) {
  if (!execution?.handled) {
    return locale === "zh" ? "确定性执行结果：无" : "Deterministic execution result: none";
  }

  const serialized = JSON.stringify({
    tool: execution.tool,
    resultData: execution.resultData,
    error: execution.error,
  }, null, 2);

  return locale === "zh"
    ? `确定性执行结果：\n${execution.resultText ?? execution.error ?? ""}\n\n\`\`\`json\n${serialized}\n\`\`\`\n请优先使用这个确定性结果，不要重新计算、重排或重新转换。`
    : `Deterministic execution result:\n${execution.resultText ?? execution.error ?? ""}\n\n\`\`\`json\n${serialized}\n\`\`\`\nUse this deterministic result first. Do not recalculate, re-sort, or reconvert it.`;
}

function buildMemoryContext(memories: AssistantMemory[], locale: Locale) {
  if (!memories.length) {
    return locale === "zh" ? "个人记忆：无" : "Personal memories: none";
  }

  const memoryText = memories
    .map((memory, index) => `[M${index + 1}] ${formatMemoryType(memory.type, locale)}: ${memory.content}`)
    .join("\n");

  return locale === "zh"
    ? `个人记忆：\n${memoryText}`
    : `Personal memories:\n${memoryText}`;
}

function formatMemoryType(type: AssistantMemory["type"], locale: Locale) {
  const labels: Record<AssistantMemory["type"], Record<Locale, string>> = {
    preference: { zh: "用户偏好", en: "preference" },
    fact: { zh: "长期事实", en: "fact" },
    project: { zh: "项目约定", en: "project" },
    task: { zh: "任务状态", en: "task" },
  };

  return labels[type][locale];
}

function buildConversationContext(messages: StoredChatMessage[], locale: Locale) {
  const recentMessages = messages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`)
    .join("\n\n");
  const context = truncateContext(recentMessages);

  if (!context) {
    return locale === "zh" ? "最近会话上下文：无" : "Recent conversation context: none";
  }

  return locale === "zh"
    ? `最近会话上下文：\n${context}`
    : `Recent conversation context:\n${context}`;
}

function buildKnowledgeContext(sources: KnowledgeMatch[], locale: Locale) {
  if (!sources.length) {
    return locale === "zh" ? "本地知识库片段：无" : "Local knowledge snippets: none";
  }

  const sourceText = sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.documentName} #${source.chunkIndex + 1}\n${source.text}`,
    )
    .join("\n\n");

  return locale === "zh"
    ? `本地知识库片段：\n${sourceText}`
    : `Local knowledge snippets:\n${sourceText}`;
}

function truncateContext(context: string) {
  if (context.length <= MAX_CONTEXT_CHARS) {
    return context;
  }

  return context.slice(-MAX_CONTEXT_CHARS).trimStart();
}
