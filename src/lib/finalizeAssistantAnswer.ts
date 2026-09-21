import type { ContextPlan } from "./assistantContextPlan";
import type { Locale } from "./chromeAi";
import type { StoredMessageSource } from "./conversationStore";
import {
  runAssistantOutputGuard,
  type GuardEvent,
} from "./assistantOutputGuard";

export type FinalizeAssistantAnswerInput = {
  rawText: string;
  locale: Locale;
  contextPlan?: ContextPlan;
  messageSources: StoredMessageSource[];
};

export type FinalizedAssistantAnswer = {
  text: string;
  guardEvents: GuardEvent[];
};

export function finalizeAssistantAnswer({
  rawText,
  locale,
  contextPlan,
  messageSources,
}: FinalizeAssistantAnswerInput): FinalizedAssistantAnswer {
  const guarded = runAssistantOutputGuard({
    text: rawText,
    locale,
    contextPlan,
    messageSources,
  });

  if (guarded.blocked) {
    return {
      text: createNoLocalEntityAnswer(contextPlan, messageSources, locale) ?? guarded.text,
      guardEvents: guarded.guardEvents,
    };
  }

  const usesVisibleMemory = messageSources.some((source) => source.sourceType === "memory");
  const usesVisibleKnowledge = messageSources.some((source) => source.sourceType === "knowledge");
  const naturalText = usesVisibleMemory
    ? normalizeMemoryAnswerTone(guarded.text, usesVisibleKnowledge, locale)
    : guarded.text;

  if (!contextPlan || !usesVisibleMemory || !contextPlan.shouldCompareWithGeneralKnowledge) {
    return {
      text: naturalText,
      guardEvents: guarded.guardEvents,
    };
  }

  const hasSavedContentExplanation = locale === "zh"
    ? /根据你(?:之前)?保存的内容|按你保存的内容|你保存的内容|你的记忆|长期记忆/.test(naturalText)
    : /\bbased on (?:your )?saved content\b|\byou saved\b|\byour memory\b|\blong-term memory\b/i.test(naturalText);

  if (hasSavedContentExplanation) {
    return {
      text: naturalText,
      guardEvents: guarded.guardEvents,
    };
  }

  const note = locale === "zh"
    ? "这是根据你保存的内容回答的。"
    : "This is based on your saved content.";

  return {
    text: `${naturalText.trimEnd()}\n\n${note}`,
    guardEvents: guarded.guardEvents,
  };
}

export function createNoLocalEntityAnswer(
  contextPlan: ContextPlan | undefined,
  sources: StoredMessageSource[],
  locale: Locale,
) {
  if (!contextPlan?.requiresLocalEvidence || sources.length) {
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
