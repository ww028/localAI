import type { Locale } from "./chromeAi";

export type AssistantIntentType =
  | "chat"
  | "knowledge_qa"
  | "summarize"
  | "translate"
  | "write"
  | "rewrite"
  | "plan"
  | "calculate"
  | "sort"
  | "format_convert"
  | "extract_todos";

export type AssistantIntentExecutionMode =
  | "answer"
  | "retrieve"
  | "deterministic"
  | "ai"
  | "hybrid";

export type AssistantIntent = {
  type: AssistantIntentType;
  confidence: number;
  executionMode: AssistantIntentExecutionMode;
  requiredTools: string[];
  entities: Record<string, string>;
  rationale: string;
};

type IntentPattern = {
  type: AssistantIntentType;
  executionMode: AssistantIntentExecutionMode;
  requiredTools: string[];
  confidence: number;
  zh: RegExp[];
  en: RegExp[];
  rationale: Record<Locale, string>;
};

const intentPatterns: IntentPattern[] = [
  {
    type: "calculate",
    executionMode: "deterministic",
    requiredTools: ["calculator"],
    confidence: 0.9,
    zh: [/计算|算一下|求和|平均|百分比|占比|加起来|减去|乘以|除以|等于|总共|合计/],
    en: [/\b(calculate|sum|average|percentage|ratio|plus|minus|times|divide|total)\b/i],
    rationale: {
      zh: "用户要求进行数值计算，适合后续由确定性程序执行。",
      en: "The user asks for numeric computation, suitable for deterministic execution.",
    },
  },
  {
    type: "sort",
    executionMode: "deterministic",
    requiredTools: ["sorter"],
    confidence: 0.86,
    zh: [/排序|排个序|按.+排|升序|降序|从大到小|从小到大/],
    en: [/\b(sort|order|ascending|descending|rank)\b/i],
    rationale: {
      zh: "用户要求排序，适合后续由确定性排序工具处理。",
      en: "The user asks for ordering, suitable for a deterministic sorter.",
    },
  },
  {
    type: "format_convert",
    executionMode: "deterministic",
    requiredTools: ["formatter"],
    confidence: 0.84,
    zh: [/转成|转换成|格式化|改成\s*(json|csv|markdown|表格|列表)|生成\s*(json|csv|markdown|表格)/i],
    en: [/\b(convert|format|transform)\b.*\b(json|csv|markdown|table|list)\b/i],
    rationale: {
      zh: "用户要求格式转换，适合后续由确定性格式化工具处理。",
      en: "The user asks for format conversion, suitable for a deterministic formatter.",
    },
  },
  {
    type: "extract_todos",
    executionMode: "hybrid",
    requiredTools: ["text-parser", "language-model"],
    confidence: 0.82,
    zh: [/待办|todo|行动项|下一步|任务清单|提取任务/i],
    en: [/\b(todo|todos|action items|next steps|task list)\b/i],
    rationale: {
      zh: "用户要求提取或整理待办，需要结构化解析并可由模型润色。",
      en: "The user asks for todos or action items, requiring structured extraction and polishing.",
    },
  },
  {
    type: "plan",
    executionMode: "hybrid",
    requiredTools: ["planner", "language-model"],
    confidence: 0.8,
    zh: [/计划|规划|方案|步骤|路线图|怎么做|如何实现|拆解/],
    en: [/\b(plan|roadmap|steps|strategy|how to implement|break down)\b/i],
    rationale: {
      zh: "用户要求规划或拆解任务，需要输出结构化步骤。",
      en: "The user asks for planning or decomposition, requiring structured steps.",
    },
  },
  {
    type: "summarize",
    executionMode: "ai",
    requiredTools: ["summarizer", "language-model"],
    confidence: 0.78,
    zh: [/总结|摘要|概括|提炼|归纳/],
    en: [/\b(summarize|summary|recap|outline)\b/i],
    rationale: {
      zh: "用户要求总结文本，适合调用摘要能力或 Prompt 兜底。",
      en: "The user asks for summarization, suitable for summarizer or Prompt fallback.",
    },
  },
  {
    type: "translate",
    executionMode: "ai",
    requiredTools: ["translator", "language-model"],
    confidence: 0.78,
    zh: [/翻译|译成|中英互译|英文怎么说|中文怎么说/],
    en: [/\b(translate|translation|in chinese|in english)\b/i],
    rationale: {
      zh: "用户要求翻译，适合调用翻译能力或 Prompt 兜底。",
      en: "The user asks for translation, suitable for translator or Prompt fallback.",
    },
  },
  {
    type: "rewrite",
    executionMode: "ai",
    requiredTools: ["rewriter", "language-model"],
    confidence: 0.78,
    zh: [/改写|润色|优化表达|更自然|更清晰|更正式/],
    en: [/\b(rewrite|polish|rephrase|make it clearer|make it more formal)\b/i],
    rationale: {
      zh: "用户要求改写表达，适合调用改写能力或 Prompt 兜底。",
      en: "The user asks for rewriting or polishing, suitable for rewriter or Prompt fallback.",
    },
  },
  {
    type: "write",
    executionMode: "ai",
    requiredTools: ["writer", "language-model"],
    confidence: 0.74,
    zh: [/写一|帮我写|生成文案|起草|草拟/],
    en: [/\b(write|draft|compose|generate copy)\b/i],
    rationale: {
      zh: "用户要求生成文本，适合调用写作能力或 Prompt 兜底。",
      en: "The user asks for text generation, suitable for writer or Prompt fallback.",
    },
  },
  {
    type: "knowledge_qa",
    executionMode: "retrieve",
    requiredTools: ["knowledge-search", "language-model"],
    confidence: 0.68,
    zh: [/知识库|文档|资料|根据.+回答|从.+里|引用|本地知识/],
    en: [/\b(knowledge base|document|docs|according to|based on|cite|source)\b/i],
    rationale: {
      zh: "用户问题可能需要检索本地知识库并引用来源。",
      en: "The user likely needs retrieval from local knowledge with citations.",
    },
  },
];

export function detectAssistantIntent(input: string, locale: Locale): AssistantIntent {
  const text = normalizeInput(input);
  const matchedPattern = intentPatterns.find((pattern) => matchesPattern(text, locale, pattern));
  const baseIntent = matchedPattern
    ? buildIntentFromPattern(matchedPattern, locale)
    : buildDefaultIntent(locale);

  return {
    ...baseIntent,
    entities: extractEntities(text, baseIntent.type),
  };
}

export function formatAssistantIntent(intent: AssistantIntent, locale: Locale) {
  const payload = {
    type: intent.type,
    confidence: intent.confidence,
    executionMode: intent.executionMode,
    requiredTools: intent.requiredTools,
    entities: intent.entities,
    rationale: intent.rationale,
  };
  const serialized = JSON.stringify(payload, null, 2);

  return locale === "zh"
    ? `结构化意图：\n\`\`\`json\n${serialized}\n\`\`\``
    : `Structured intent:\n\`\`\`json\n${serialized}\n\`\`\``;
}

function buildIntentFromPattern(pattern: IntentPattern, locale: Locale): AssistantIntent {
  return {
    type: pattern.type,
    confidence: pattern.confidence,
    executionMode: pattern.executionMode,
    requiredTools: pattern.requiredTools,
    entities: {},
    rationale: pattern.rationale[locale],
  };
}

function buildDefaultIntent(locale: Locale): AssistantIntent {
  return {
    type: "chat",
    confidence: 0.5,
    executionMode: "answer",
    requiredTools: ["language-model"],
    entities: {},
    rationale: locale === "zh"
      ? "没有命中明确工具型意图，按普通对话处理。"
      : "No explicit tool-oriented intent matched, so handle it as normal chat.",
  };
}

function matchesPattern(text: string, locale: Locale, pattern: IntentPattern) {
  const localePatterns = locale === "zh" ? pattern.zh : pattern.en;
  const fallbackPatterns = locale === "zh" ? pattern.en : pattern.zh;
  return [...localePatterns, ...fallbackPatterns].some((regex) => regex.test(text));
}

function normalizeInput(input: string) {
  return input.trim().replace(/\s+/g, " ");
}

function extractEntities(text: string, type: AssistantIntentType) {
  const entities: Record<string, string> = {};
  const numbers = text.match(/-?\d+(?:\.\d+)?%?/g);

  if (numbers?.length && (type === "calculate" || type === "sort")) {
    entities.numbers = numbers.join(", ");
  }

  const targetFormat = text.match(/\b(json|csv|markdown)\b|表格|列表/i)?.[0];
  if (targetFormat && type === "format_convert") {
    entities.targetFormat = targetFormat.toLowerCase();
  }

  return entities;
}

