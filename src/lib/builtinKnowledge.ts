import usageGuideZh from "../knowledge/localai-usage.zh.md?raw";
import type { Locale } from "./chromeAi";
import type { KnowledgeMatch } from "./knowledgeStore";

const BUILTIN_SPACE_ID = "builtin";
const USAGE_GUIDE_DOCUMENT_ID = "builtin:localai-usage";
const USAGE_GUIDE_DOCUMENT_NAME: Record<Locale, string> = {
  zh: "localAI 使用说明",
  en: "localAI usage guide",
};

const usageGuidePatterns: Record<Locale, RegExp[]> = {
  zh: [
    /(?:使用说明|使用文档|帮助文档|操作指南|新手指南|入门指南|教程)/,
    /(?:这个|这款|localai|ai|插件|助手).{0,8}(?:怎么用|如何用|如何使用|怎样用|怎样使用|能做什么|有什么功能|有哪些功能)/i,
    /(?:怎么用|如何使用|怎样使用).{0,8}(?:这个|这款|localai|ai|插件|助手)/i,
  ],
  en: [
    /\b(?:usage guide|user guide|help doc|documentation|getting started|tutorial)\b/i,
    /\b(?:how do i use|how to use|what can (?:this )?(?:ai|assistant|extension|localai) do)\b/i,
    /\b(?:localai|this ai|this assistant|this extension).{0,40}\b(?:use|work|features|capabilities)\b/i,
  ],
};

export function searchBuiltinKnowledge(query: string, locale: Locale): KnowledgeMatch[] {
  if (!isUsageGuideQuestion(query, locale)) {
    return [];
  }

  return [
    {
      documentId: USAGE_GUIDE_DOCUMENT_ID,
      spaceId: BUILTIN_SPACE_ID,
      documentName: USAGE_GUIDE_DOCUMENT_NAME[locale],
      chunkIndex: 0,
      text: usageGuideZh,
      score: 1000,
    },
  ];
}

export function isUsageGuideQuestion(query: string, locale: Locale) {
  const normalized = query.trim().replace(/\s+/g, " ");
  const primaryPatterns = usageGuidePatterns[locale];
  const fallbackPatterns = locale === "zh" ? usageGuidePatterns.en : usageGuidePatterns.zh;

  return [...primaryPatterns, ...fallbackPatterns].some((pattern) => pattern.test(normalized));
}
