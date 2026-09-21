import type { ContextPlan } from "./assistantContextPlan";
import type { Locale } from "./chromeAi";
import type { StoredMessageSource } from "./conversationStore";

export type GuardEvent = {
  type:
    | "generated_sources_section_removed"
    | "invalid_citation_removed"
    | "entity_answer_blocked_without_local_evidence"
    | "memory_metadata_removed";
  level: "info" | "warn" | "block";
  detail: string;
};

export type GuardedAssistantOutput = {
  text: string;
  guardEvents: GuardEvent[];
  blocked: boolean;
  fallbackReason?: string;
};

type AssistantOutputGuardInput = {
  text: string;
  locale: Locale;
  contextPlan?: ContextPlan;
  messageSources: StoredMessageSource[];
};

export function stripGeneratedSourceSection(text: string) {
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

export function runAssistantOutputGuard({
  text,
  locale,
  contextPlan,
  messageSources,
}: AssistantOutputGuardInput): GuardedAssistantOutput {
  const guardEvents: GuardEvent[] = [];
  let nextText = stripGeneratedSourceSection(text);

  if (nextText !== text.replace(/\r\n/g, "\n").trimEnd()) {
    guardEvents.push({
      type: "generated_sources_section_removed",
      level: "info",
      detail: locale === "zh" ? "已移除模型自行生成的来源段落。" : "Removed model-generated sources section.",
    });
  }

  if (contextPlan?.requiresLocalEvidence && !messageSources.length) {
    return {
      text: nextText,
      guardEvents: [
        ...guardEvents,
        {
          type: "entity_answer_blocked_without_local_evidence",
          level: "block",
          detail: locale === "zh" ? "缺少本地证据，已阻断实体身份回答。" : "Blocked entity-profile answer because no local evidence was available.",
        },
      ],
      blocked: true,
      fallbackReason: "missing_local_evidence",
    };
  }

  if (contextPlan?.knowledgeMode === "cite") {
    const citationResult = removeInvalidCitations(nextText, messageSources, locale);
    nextText = citationResult.text;
    guardEvents.push(...citationResult.guardEvents);
  }

  if (messageSources.some((source) => source.sourceType === "memory")) {
    const memoryHygieneResult = removeMemoryMetadata(nextText, locale);
    nextText = memoryHygieneResult.text;
    guardEvents.push(...memoryHygieneResult.guardEvents);
  }

  return {
    text: nextText.trimEnd(),
    guardEvents,
    blocked: false,
  };
}

function removeInvalidCitations(text: string, messageSources: StoredMessageSource[], locale: Locale) {
  const guardEvents: GuardEvent[] = [];
  const validKnowledgeLabels = new Set(
    messageSources
      .filter((source) => source.sourceType === "knowledge")
      .map((source, index) => source.sourceLabel ?? `[${index + 1}]`),
  );

  const cleanedText = text
    .replace(/\[(\d+)\]/g, (match) => {
      if (validKnowledgeLabels.has(match)) {
        return match;
      }

      guardEvents.push({
        type: "invalid_citation_removed",
        level: "warn",
        detail: locale === "zh" ? `已移除无效引用 ${match}。` : `Removed invalid citation ${match}.`,
      });
      return "";
    })
    .replace(/\s+([,.;!?，。；！？])/g, "$1")
    .replace(/ {2,}/g, " ");

  return {
    text: cleanedText,
    guardEvents,
  };
}

function removeMemoryMetadata(text: string, locale: Locale) {
  const guardEvents: GuardEvent[] = [];
  let nextText = text;
  const patterns = [
    /\[M\d+\]\s*/g,
    /(?:^|\n)\s*(?:本地个人事实|local personal fact)\s*[:：]\s*/gi,
    /(?:^|\n)\s*(?:长期事实|用户偏好|项目约定|任务状态|fact|preference|project|task)\s*[:：]\s*/gi,
  ];

  for (const pattern of patterns) {
    const updatedText = nextText.replace(pattern, (match, offset) => (offset > 0 ? "\n" : ""));
    if (updatedText !== nextText) {
      nextText = updatedText;
      guardEvents.push({
        type: "memory_metadata_removed",
        level: "info",
        detail: locale === "zh" ? "已移除记忆内部元数据。" : "Removed internal memory metadata from answer.",
      });
    }
  }

  return {
    text: nextText.replace(/\n{3,}/g, "\n\n"),
    guardEvents,
  };
}
