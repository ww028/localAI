import type { AssistantMemory } from "./assistantMemoryStore";
import type { Locale } from "./chromeAi";
import type { AssistantIntent } from "./assistantIntent";
import type { KnowledgeMatch } from "./knowledgeStore";

export type ContextSubject = "user_profile_query" | "entity_profile_query" | "user" | "assistant" | "external";
export type ContextMemoryMode = "none" | "implicit" | "answer_source";
export type ContextKnowledgeMode = "none" | "cite";
export type ContextVisibleSource = "memory" | "knowledge";

export type ContextPlan = {
  subject: ContextSubject;
  targetEntity?: string;
  memoryMode: ContextMemoryMode;
  knowledgeMode: ContextKnowledgeMode;
  requiresLocalEvidence: boolean;
  visibleSources: ContextVisibleSource[];
  shouldCompareWithGeneralKnowledge: boolean;
  responseConstraints: string[];
  rationale: string;
};

type CreateContextPlanInput = {
  question: string;
  locale: Locale;
  intent: AssistantIntent;
  sources: KnowledgeMatch[];
  memories: AssistantMemory[];
  sourceMemories?: AssistantMemory[];
};

export function createContextPlan({
  question,
  locale,
  intent,
  sources,
  memories,
  sourceMemories,
}: CreateContextPlanInput): ContextPlan {
  const normalizedQuestion = normalizeQuestion(question);
  const entityName = extractEntityProfileTarget(normalizedQuestion, locale);
  const subject = detectSubject(normalizedQuestion, locale, entityName);
  const hasKnowledge = sources.length > 0;
  const hasBuiltinKnowledge = sources.some((source) => source.spaceId === "builtin");
  const hasMemories = memories.length > 0;
  const hasVisibleMemories = (sourceMemories ?? memories).length > 0;
  const memoryMode = decideMemoryMode(subject, hasMemories, hasVisibleMemories);
  const knowledgeMode = hasKnowledge && (hasBuiltinKnowledge || shouldUseKnowledge(intent, subject)) ? "cite" : "none";
  const requiresLocalEvidence = subject === "entity_profile_query";
  const shouldCompareWithGeneralKnowledge = subject === "external" && (hasVisibleMemories || knowledgeMode === "cite");
  const visibleSources: ContextVisibleSource[] = [
    ...(knowledgeMode === "cite" ? (["knowledge"] as const) : []),
    ...(memoryMode === "answer_source" && hasVisibleMemories ? (["memory"] as const) : []),
  ];

  return {
    subject,
    targetEntity: entityName,
    memoryMode,
    knowledgeMode,
    requiresLocalEvidence,
    shouldCompareWithGeneralKnowledge,
    visibleSources,
    responseConstraints: buildResponseConstraints(
      subject,
      memoryMode,
      knowledgeMode,
      shouldCompareWithGeneralKnowledge,
      locale,
    ),
    rationale: buildRationale(subject, memoryMode, knowledgeMode, shouldCompareWithGeneralKnowledge, locale),
  };
}

export function shouldExpandMemorySearch(question: string, locale: Locale) {
  const normalizedQuestion = normalizeQuestion(question);
  const subject = detectSubject(normalizedQuestion, locale, extractEntityProfileTarget(normalizedQuestion, locale));
  return subject === "user_profile_query";
}

export function extractContextQueryTarget(question: string, locale: Locale) {
  return extractEntityProfileTarget(normalizeQuestion(question), locale);
}

function decideMemoryMode(
  subject: ContextSubject,
  hasMemories: boolean,
  hasVisibleMemories: boolean,
): ContextMemoryMode {
  if (!hasMemories || subject === "assistant") {
    return "none";
  }

  if (subject === "user_profile_query" || subject === "entity_profile_query") {
    return "answer_source";
  }

  if (hasVisibleMemories) {
    return "answer_source";
  }

  return "implicit";
}

function shouldUseKnowledge(intent: AssistantIntent, subject: ContextSubject) {
  if (subject === "assistant") {
    return false;
  }

  return subject === "entity_profile_query" || intent.type === "knowledge_qa" || intent.executionMode === "retrieve";
}

function detectSubject(question: string, locale: Locale, entityName: string | undefined): ContextSubject {
  if (isAssistantIdentityQuestion(question, locale)) {
    return "assistant";
  }

  if (isUserProfileQuestion(question, locale)) {
    return "user_profile_query";
  }

  if (entityName) {
    return "entity_profile_query";
  }

  return "external";
}

function isAssistantIdentityQuestion(question: string, locale: Locale) {
  const patterns = locale === "zh"
    ? [/你是谁/, /你叫什么/, /介绍(?:一下)?你自己/, /你是什么(?:助手|模型|工具)?/]
    : [/\bwho are you\b/i, /\bwhat are you\b/i, /\bintroduce yourself\b/i];

  return patterns.some((pattern) => pattern.test(question));
}

function isUserProfileQuestion(question: string, locale: Locale) {
  const patterns = locale === "zh"
    ? [
        /我是谁/,
        /我叫什么/,
        /我是什么人/,
        /我是(?:谁|什么|做什么的)/,
        /你应该叫我什么/,
        /应该叫我什么/,
        /怎么称呼我/,
        /如何称呼我/,
        /叫我什么/,
        /我的身份/,
        /我的名字/,
        /我的昵称/,
        /我的称呼/,
        /我的偏好/,
        /我(?:喜欢|偏好|习惯|常用|通常|一般)/,
        /我(?:的)?(?:职业|工作|岗位|职务|职位|角色)/,
        /我(?:在|负责|参与|做)(?:什么)?(?:项目|业务|工作)/,
        /我的(?:项目|业务|工作|习惯|偏好|喜好)/,
        /你(?:还)?记得我/,
        /你记住了什么/,
        /关于我.*(?:记得|知道|了解)/,
        /你知道我什么/,
        /你了解我/,
      ]
    : [
        /\bwho am i\b/i,
        /\bwhat is my name\b/i,
        /\bwhat am i\b/i,
        /\bwhat should you call me\b/i,
        /\bhow should you address me\b/i,
        /\bmy identity\b/i,
        /\bmy name\b/i,
        /\bmy nickname\b/i,
        /\bmy preferences?\b/i,
        /\bmy habits?\b/i,
        /\bwhat do i like\b/i,
        /\bwhat do i prefer\b/i,
        /\bmy (?:job|work|role|position|occupation)\b/i,
        /\bwhat do i do\b/i,
        /\bmy (?:project|projects|business)\b/i,
        /\bwhat do you remember about me\b/i,
        /\bwhat do you know about me\b/i,
        /\bdo you remember me\b/i,
        /\bdo you know me\b/i,
      ];

  return patterns.some((pattern) => pattern.test(question));
}

function extractEntityProfileTarget(question: string, locale: Locale) {
  const patterns = locale === "zh"
    ? [
        /^(?:请问)?(.{1,24}?)(?:是谁|是誰|是哪位|呢)[?？。!！]*$/,
      ]
    : [
        /^(?:who is|who's)\s+(.{1,48}?)[?.!]*$/i,
        /^tell me about\s+(.{1,48}?)[?.!]*$/i,
      ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    const target = match?.[1]?.trim();
    if (target && !isSelfReference(target, locale)) {
      return target;
    }
  }

  return undefined;
}

function isSelfReference(target: string, locale: Locale) {
  const patterns = locale === "zh"
    ? [/^(我|我的|本人|自己|你|你的|localai)$/i]
    : [/^(i|me|my|myself|you|your|localai)$/i];

  return patterns.some((pattern) => pattern.test(target));
}

function buildResponseConstraints(
  subject: ContextSubject,
  memoryMode: ContextMemoryMode,
  knowledgeMode: ContextKnowledgeMode,
  shouldCompareWithGeneralKnowledge: boolean,
  locale: Locale,
) {
  const constraints = locale === "zh"
    ? [
        "不要在回答正文中生成“引用来源”或“Sources”段落；系统会在回答下方用独立 UI 展示相关上下文来源。",
        "如果使用本地知识库，请只在相关结论后使用 [1] 这类编号。",
      ]
    : [
        "Do not generate a Sources or References section in the answer body; the system renders sources below the answer.",
        "When using local knowledge, cite relevant claims with numbers like [1].",
      ];

  if (subject === "user_profile_query" || subject === "user") {
    constraints.push(
      locale === "zh"
        ? "用户问题中的“我、我的、本人”指用户本人，不是 localAI。"
        : 'In the user question, "I", "me", and "my" refer to the user, not localAI.',
    );
  }

  if (subject === "entity_profile_query") {
    constraints.push(
      locale === "zh"
        ? "用户正在询问某个具体对象是谁；只能根据命中的个人记忆或本地知识库回答，不要根据最近对话、名称联想或模型通识编造身份。"
        : "The user is asking who a specific entity is. Answer only from matched personal memories or local knowledge; do not infer from recent conversation, name association, or model general knowledge.",
    );
  }

  if (memoryMode === "answer_source") {
    constraints.push(
      subject === "user_profile_query"
        ? locale === "zh"
          ? "用户正在询问自己的身份、称呼、偏好、职业、项目、习惯、事实或你记得什么时，优先根据个人记忆直接回答。"
          : "When the user asks about their identity, name, preferences, job, projects, habits, facts, or what you remember, answer directly from personal memories first."
        : subject === "entity_profile_query"
          ? locale === "zh"
            ? "如果个人记忆命中了该对象，直接用自然口吻回答该对象是谁；面向用户说“你”，不要说“用户”；不要额外说“这是根据你保存的内容”，来源会由下方 UI 展示。"
            : 'If personal memories match this entity, answer who it is in a natural tone. Address the user as "you", not "the user". Do not add a note like based on saved content; sources are shown in the UI below.'
        : locale === "zh"
          ? "如果个人记忆命中了当前问题，个人记忆是用户保存的本地事实源，优先级高于模型通识。"
          : "If personal memories match the current question, they are user-saved local facts and take priority over model general knowledge.",
    );
  }

  if (memoryMode !== "none") {
    constraints.push(
      locale === "zh"
        ? "个人记忆中的第一人称表达来自用户原话；回答时必须先理解事实，再改写成面向用户的自然二人称表达，不要照抄成助手自己的第一人称，也不要用生硬的第三人称称呼用户。"
        : 'First-person wording in personal memories comes from the user. When answering, convert it to natural second-person wording, such as "your"; never make it sound like the assistant owns or did it, and avoid stiff phrasing like "the user\'s".',
    );
    constraints.push(
      locale === "zh"
        ? "不要机械复述个人记忆原句；用像在和用户对话的口吻回答。"
        : "Do not mechanically repeat the saved memory text; answer conversationally in the user's perspective.",
    );
    constraints.push(
      locale === "zh"
        ? "使用个人记忆时，不要输出“长期事实”“用户偏好”等内部分类元数据，也不要在正文中编号或引用个人记忆。"
        : "When using personal memories, do not output internal category metadata such as fact or preference, and do not number or cite memories in the answer body.",
    );
  }

  if (knowledgeMode === "cite") {
    constraints.push(
      locale === "zh"
        ? "如果本地知识库命中了当前问题，本地知识库是用户提供的事实源，优先级高于模型通识。"
        : "If local knowledge matches the current question, it is a user-provided fact source and takes priority over model general knowledge.",
    );
  }

  if (shouldCompareWithGeneralKnowledge) {
    constraints.push(
      locale === "zh"
        ? "回答顺序必须是：第一句先按用户保存的本地上下文直接回答；第二句自然说明“这是根据你保存的内容”；如果和通识不同，再补充“按通识来说……”的通常答案。不要先给通识答案。"
        : 'The response order must be: first answer directly from the user-saved local context; second, naturally explain that this is based on saved content; if it differs from general knowledge, then add "In general..." with the usual answer. Do not start with the general-knowledge answer.',
    );
  }

  if (knowledgeMode === "none") {
    constraints.push(
      locale === "zh"
        ? "没有可用本地知识库来源时，不要声称引用了本地知识库。"
        : "When no local knowledge source is available, do not claim that local knowledge was cited.",
    );
  }

  return constraints;
}

function buildRationale(
  subject: ContextSubject,
  memoryMode: ContextMemoryMode,
  knowledgeMode: ContextKnowledgeMode,
  shouldCompareWithGeneralKnowledge: boolean,
  locale: Locale,
) {
  const payload = { subject, memoryMode, knowledgeMode, shouldCompareWithGeneralKnowledge };
  return locale === "zh"
    ? `上下文策略基于用户问题主体和可用上下文确定：${JSON.stringify(payload)}`
    : `Context policy was selected from the question subject and available context: ${JSON.stringify(payload)}`;
}

function normalizeQuestion(question: string) {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}
