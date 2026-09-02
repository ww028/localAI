import type { Locale } from "./chromeAi";
import type { AssistantIntent } from "./assistantIntent";

export type AssistantPlanStepStatus = "pending" | "ready" | "blocked" | "completed" | "failed";

export type AssistantPlanStep = {
  id: string;
  title: string;
  description: string;
  tool: string;
  status: AssistantPlanStepStatus;
  deterministic: boolean;
};

export type AssistantPlan = {
  id: string;
  intentType: AssistantIntent["type"];
  executionMode: AssistantIntent["executionMode"];
  summary: string;
  requiredTools: string[];
  steps: AssistantPlanStep[];
  needsModelPolish: boolean;
  rationale: string;
};

type PlanTemplate = {
  summary: Record<Locale, string>;
  steps: Array<{
    title: Record<Locale, string>;
    description: Record<Locale, string>;
    tool: string;
    deterministic: boolean;
  }>;
  needsModelPolish: boolean;
};

const planTemplates: Record<AssistantIntent["type"], PlanTemplate> = {
  chat: {
    summary: {
      zh: "直接回答用户问题，并结合必要上下文保持简洁。",
      en: "Answer directly and keep the response concise with necessary context.",
    },
    steps: [
      {
        title: { zh: "组织回答", en: "Compose answer" },
        description: {
          zh: "根据用户问题、最近会话和个人记忆生成回答。",
          en: "Generate the answer from the question, recent conversation, and personal memories.",
        },
        tool: "language-model",
        deterministic: false,
      },
    ],
    needsModelPolish: true,
  },
  knowledge_qa: {
    summary: {
      zh: "先检索本地知识库，再基于命中片段回答并标注引用。",
      en: "Retrieve local knowledge first, then answer with citations from matched snippets.",
    },
    steps: [
      {
        title: { zh: "检索知识库", en: "Retrieve knowledge" },
        description: {
          zh: "在当前知识空间检索与问题相关的文档 chunk。",
          en: "Search the active knowledge space for relevant document chunks.",
        },
        tool: "knowledge-search",
        deterministic: true,
      },
      {
        title: { zh: "生成引用回答", en: "Generate cited answer" },
        description: {
          zh: "优先依据检索片段回答，相关结论后标注引用编号。",
          en: "Answer from retrieved snippets first and cite relevant claims.",
        },
        tool: "language-model",
        deterministic: false,
      },
    ],
    needsModelPolish: true,
  },
  summarize: {
    summary: {
      zh: "提取文本关键结论并组织为简洁摘要。",
      en: "Extract key takeaways and organize them into a concise summary.",
    },
    steps: [
      {
        title: { zh: "识别重点", en: "Identify key points" },
        description: {
          zh: "从输入文本中提取主题、结论和重要细节。",
          en: "Extract topic, conclusions, and important details from the input.",
        },
        tool: "summarizer",
        deterministic: false,
      },
    ],
    needsModelPolish: true,
  },
  translate: {
    summary: {
      zh: "判断翻译方向并输出自然准确的译文。",
      en: "Detect translation direction and produce a natural, accurate translation.",
    },
    steps: [
      {
        title: { zh: "判断语言方向", en: "Detect language direction" },
        description: {
          zh: "根据输入文本判断中文转英文或英文转中文。",
          en: "Decide whether to translate Chinese to English or English to Chinese.",
        },
        tool: "language-detector",
        deterministic: true,
      },
      {
        title: { zh: "执行翻译", en: "Translate text" },
        description: {
          zh: "调用翻译能力；不可用时使用 Prompt API 兜底。",
          en: "Use Translator when available, with Prompt API fallback.",
        },
        tool: "translator",
        deterministic: false,
      },
    ],
    needsModelPolish: false,
  },
  write: {
    summary: {
      zh: "根据用户要求生成可直接使用的文本。",
      en: "Generate ready-to-use text from the user's request.",
    },
    steps: [
      {
        title: { zh: "生成草稿", en: "Generate draft" },
        description: {
          zh: "根据用户要求生成第一版文本。",
          en: "Create a first draft based on the request.",
        },
        tool: "writer",
        deterministic: false,
      },
    ],
    needsModelPolish: true,
  },
  rewrite: {
    summary: {
      zh: "在保持原意的前提下润色表达。",
      en: "Polish wording while preserving the original meaning.",
    },
    steps: [
      {
        title: { zh: "润色改写", en: "Polish rewrite" },
        description: {
          zh: "让表达更清晰自然，并尽量保持原意和长度。",
          en: "Make the wording clearer and more natural while keeping meaning and length.",
        },
        tool: "rewriter",
        deterministic: false,
      },
    ],
    needsModelPolish: false,
  },
  plan: {
    summary: {
      zh: "把目标拆解成可执行步骤和依赖工具。",
      en: "Break the goal into executable steps and required tools.",
    },
    steps: [
      {
        title: { zh: "澄清目标", en: "Clarify goal" },
        description: {
          zh: "识别目标、约束、输入和预期输出。",
          en: "Identify the goal, constraints, inputs, and expected output.",
        },
        tool: "planner",
        deterministic: true,
      },
      {
        title: { zh: "拆解步骤", en: "Break down steps" },
        description: {
          zh: "输出有顺序、可验证的执行步骤。",
          en: "Produce ordered, verifiable execution steps.",
        },
        tool: "planner",
        deterministic: true,
      },
      {
        title: { zh: "润色计划", en: "Polish plan" },
        description: {
          zh: "用模型把计划表达为简洁清楚的 Markdown。",
          en: "Use the model to express the plan clearly in Markdown.",
        },
        tool: "language-model",
        deterministic: false,
      },
    ],
    needsModelPolish: true,
  },
  memory_operation: {
    summary: {
      zh: "先把用户请求解析为结构化记忆操作计划，再由本地记忆存储确定性执行。",
      en: "Parse the user request into a structured memory operation plan, then execute it deterministically in local memory storage.",
    },
    steps: [
      {
        title: { zh: "解析记忆操作", en: "Parse memory operation" },
        description: {
          zh: "识别记忆操作类型、作用范围和一个或多个目标对象。",
          en: "Identify the memory operation type, scope, and one or more target objects.",
        },
        tool: "memory-planner",
        deterministic: true,
      },
      {
        title: { zh: "执行本地记忆变更", en: "Execute local memory change" },
        description: {
          zh: "只根据结构化计划访问本地 IndexedDB，新增或删除明确命中的个人记忆。",
          en: "Access local IndexedDB only through the structured plan, creating or deleting explicitly matched personal memories.",
        },
        tool: "memory-store",
        deterministic: true,
      },
    ],
    needsModelPolish: false,
  },
  calculate: {
    summary: {
      zh: "提取数值表达式，后续由确定性计算器执行，再解释结果。",
      en: "Extract numeric expressions for deterministic calculation, then explain the result.",
    },
    steps: [
      {
        title: { zh: "解析数值", en: "Parse numbers" },
        description: {
          zh: "从输入中提取数字、运算符和单位。",
          en: "Extract numbers, operators, and units from the input.",
        },
        tool: "calculator",
        deterministic: true,
      },
      {
        title: { zh: "执行计算", en: "Run calculation" },
        description: {
          zh: "使用确定性程序计算，避免让模型直接心算。",
          en: "Use deterministic code for computation instead of model arithmetic.",
        },
        tool: "calculator",
        deterministic: true,
      },
      {
        title: { zh: "解释结果", en: "Explain result" },
        description: {
          zh: "用模型把计算结果解释为用户易读的回答。",
          en: "Use the model to explain the computed result in a readable answer.",
        },
        tool: "language-model",
        deterministic: false,
      },
    ],
    needsModelPolish: true,
  },
  date_time: {
    summary: {
      zh: "解析日期、时间区间或时区要求，并使用确定性日期时间工具计算。",
      en: "Parse date, time range, or time-zone requests and calculate them with a deterministic date-time tool.",
    },
    steps: [
      {
        title: { zh: "解析日期时间", en: "Parse date and time" },
        description: {
          zh: "识别日期、天数、工作日范围、时间和目标时区。",
          en: "Identify dates, day offsets, business-day ranges, times, and target time zones.",
        },
        tool: "date-calculator",
        deterministic: true,
      },
      {
        title: { zh: "执行日期时间计算", en: "Run date-time calculation" },
        description: {
          zh: "用确定性规则计算日期差、几天后、工作日数量或时区转换。",
          en: "Use deterministic rules to calculate date differences, offsets, workdays, or time-zone conversion.",
        },
        tool: "date-calculator",
        deterministic: true,
      },
    ],
    needsModelPolish: true,
  },
  sort: {
    summary: {
      zh: "解析待排序项目和排序规则，后续由确定性排序器执行。",
      en: "Parse items and ordering rules for deterministic sorting.",
    },
    steps: [
      {
        title: { zh: "解析列表和规则", en: "Parse list and rule" },
        description: {
          zh: "提取待排序项目、排序字段和升降序。",
          en: "Extract sortable items, sort key, and direction.",
        },
        tool: "sorter",
        deterministic: true,
      },
      {
        title: { zh: "执行排序", en: "Sort items" },
        description: {
          zh: "使用确定性排序规则输出结果。",
          en: "Apply deterministic sorting rules to produce the result.",
        },
        tool: "sorter",
        deterministic: true,
      },
    ],
    needsModelPolish: true,
  },
  format_convert: {
    summary: {
      zh: "解析目标格式并使用确定性格式化工具转换内容。",
      en: "Parse the target format and convert content with a deterministic formatter.",
    },
    steps: [
      {
        title: { zh: "识别目标格式", en: "Identify target format" },
        description: {
          zh: "识别 JSON、CSV、Markdown、表格或列表等目标格式。",
          en: "Identify target formats such as JSON, CSV, Markdown, table, or list.",
        },
        tool: "formatter",
        deterministic: true,
      },
      {
        title: { zh: "转换格式", en: "Convert format" },
        description: {
          zh: "按目标格式输出结构化结果。",
          en: "Output structured content in the target format.",
        },
        tool: "formatter",
        deterministic: true,
      },
    ],
    needsModelPolish: true,
  },
  text_stats: {
    summary: {
      zh: "解析文本统计目标，并使用确定性文本统计工具输出计数结果。",
      en: "Parse text-statistics goals and output counts with a deterministic text statistics tool.",
    },
    steps: [
      {
        title: { zh: "解析统计目标", en: "Parse statistics goal" },
        description: {
          zh: "识别字数、词频、重复项、去重或分组计数等统计目标。",
          en: "Identify character counts, word frequency, duplicates, dedupe, or group counts.",
        },
        tool: "text-statistics",
        deterministic: true,
      },
      {
        title: { zh: "执行文本统计", en: "Run text statistics" },
        description: {
          zh: "按确定性规则输出统计结果和结构化数据。",
          en: "Output statistics and structured data using deterministic rules.",
        },
        tool: "text-statistics",
        deterministic: true,
      },
    ],
    needsModelPolish: true,
  },
  extract_todos: {
    summary: {
      zh: "从文本中提取任务、上下文和后续行动。",
      en: "Extract tasks, context, and follow-up actions from text.",
    },
    steps: [
      {
        title: { zh: "提取候选任务", en: "Extract task candidates" },
        description: {
          zh: "识别文本中的明确待办和可推导行动项。",
          en: "Identify explicit todos and inferred action items.",
        },
        tool: "text-parser",
        deterministic: true,
      },
      {
        title: { zh: "整理任务清单", en: "Organize task list" },
        description: {
          zh: "按任务、上下文、优先级和截止信息组织输出。",
          en: "Organize output by task, context, priority, and deadline when available.",
        },
        tool: "language-model",
        deterministic: false,
      },
    ],
    needsModelPolish: true,
  },
};

export function createAssistantPlan(intent: AssistantIntent, input: string, locale: Locale): AssistantPlan {
  const template = planTemplates[intent.type];
  const requiredTools = mergeTools(intent.requiredTools, template.steps.map((step) => step.tool));

  return {
    id: createPlanId(intent.type, input),
    intentType: intent.type,
    executionMode: intent.executionMode,
    summary: template.summary[locale],
    requiredTools,
    steps: template.steps.map((step, index) => ({
      id: `step-${index + 1}`,
      title: step.title[locale],
      description: step.description[locale],
      tool: step.tool,
      status: "pending",
      deterministic: step.deterministic,
    })),
    needsModelPolish: template.needsModelPolish,
    rationale: intent.rationale,
  };
}

export function formatAssistantPlan(plan: AssistantPlan, locale: Locale) {
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

function mergeTools(primaryTools: string[], secondaryTools: string[]) {
  return [...new Set([...primaryTools, ...secondaryTools])];
}

function createPlanId(intentType: AssistantIntent["type"], input: string) {
  const hash = Array.from(input).reduce((accumulator, character) => {
    return (accumulator * 31 + character.charCodeAt(0)) >>> 0;
  }, 2166136261);

  return `${intentType}-${hash.toString(36)}`;
}
