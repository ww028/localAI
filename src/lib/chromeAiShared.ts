export type SharedLocale = "zh" | "en";
export type SharedAiTask =
  | "prompt"
  | "summarize"
  | "translate"
  | "detect-language"
  | "write"
  | "rewrite";

export type SharedChromeAiOptionCandidate = {
  availabilityOptions?: Record<string, unknown>;
  createOptions?: Record<string, unknown>;
};

export function getPromptOptionCandidates(): SharedChromeAiOptionCandidate[] {
  return [
    {
      availabilityOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      },
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      },
    },
    {},
  ];
}

export function getSummarizeOptionCandidates(locale: SharedLocale): SharedChromeAiOptionCandidate[] {
  if (locale === "zh") {
    return [];
  }

  const summarizeOptions = {
    type: "key-points",
    format: "markdown",
    length: "medium",
    outputLanguage: "en",
  };

  return [
    {
      availabilityOptions: summarizeOptions,
      createOptions: summarizeOptions,
    },
  ];
}

export function getTranslateOptionCandidates(locale: SharedLocale, text = ""): SharedChromeAiOptionCandidate[] {
  const direction = detectTranslationDirection(text, locale);
  const languagePairs =
    direction === "zh-to-en"
      ? [
          { sourceLanguage: "zh", targetLanguage: "en" },
          { sourceLanguage: "zh-Hans", targetLanguage: "en" },
        ]
      : [
          { sourceLanguage: "en", targetLanguage: "zh" },
          { sourceLanguage: "en", targetLanguage: "zh-Hans" },
        ];

  return languagePairs.map((pair) => ({
    availabilityOptions: pair,
    createOptions: pair,
  }));
}

export function getRewriteOptionCandidates(): SharedChromeAiOptionCandidate[] {
  const polishOptions = {
    tone: "more-formal",
    format: "plain-text",
    length: "as-is",
  };

  return [
    {
      availabilityOptions: polishOptions,
      createOptions: polishOptions,
    },
    {},
  ];
}

export function detectTranslationDirection(text: string, locale: SharedLocale): "zh-to-en" | "en-to-zh" {
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

export function buildFallbackPrompt(
  task: Exclude<SharedAiTask, "prompt" | "detect-language">,
  text: string,
  locale: SharedLocale,
) {
  const direction = detectTranslationDirection(text, locale);
  const prompts: Record<SharedLocale, Record<Exclude<SharedAiTask, "prompt" | "detect-language">, string>> = {
    zh: {
      summarize: `请用中文把下面内容总结为清晰的要点，保留关键信息：\n\n${text}`,
      translate:
        direction === "zh-to-en"
          ? `请把下面中文翻译成自然准确的英文，只输出译文：\n\n${text}`
          : `请把下面英文翻译成自然准确的中文，只输出译文：\n\n${text}`,
      write: `请根据下面要求写一段清晰、自然、可直接使用的文本：\n\n${text}`,
      rewrite: `请把下面文本润色改写为更清晰自然的表达，尽量保持原意和长度，只输出改写结果：\n\n${text}`,
    },
    en: {
      summarize: `Summarize the following content into clear bullet points while preserving key details:\n\n${text}`,
      translate:
        direction === "zh-to-en"
          ? `Translate the following Chinese text into natural, accurate English. Only output the translation:\n\n${text}`
          : `Translate the following English text into natural, accurate Chinese. Only output the translation:\n\n${text}`,
      write: `Write clear, natural, ready-to-use text based on this request:\n\n${text}`,
      rewrite: `Polish the following text for clearer, more natural wording. Keep the original meaning and roughly the same length. Only output the rewritten text:\n\n${text}`,
    },
  };

  return prompts[locale][task];
}
