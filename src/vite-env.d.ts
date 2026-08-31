/// <reference types="vite/client" />

type ChromeAiAvailability =
  | "unavailable"
  | "available"
  | "downloadable"
  | "downloading"
  | string;

type DownloadProgressEvent = Event & {
  loaded?: number;
  total?: number;
};

type ChromeAiMonitor = {
  addEventListener(
    type: "downloadprogress",
    listener: (event: DownloadProgressEvent) => void,
  ): void;
};

type ChromeAiCreateOptions = {
  monitor?: (monitor: ChromeAiMonitor) => void;
  [key: string]: unknown;
};

type LanguageModelSession = {
  prompt(input: string): Promise<string>;
  promptStreaming?(input: string): AsyncIterable<string>;
  destroy?: () => void;
};

type SummarizerSession = {
  summarize(input: string): Promise<string>;
  destroy?: () => void;
};

type TranslatorSession = {
  translate(input: string): Promise<string>;
  destroy?: () => void;
};

type LanguageDetectorSession = {
  detect(input: string): Promise<Array<{ detectedLanguage?: string; language?: string; confidence?: number }>>;
  destroy?: () => void;
};

type WriterSession = {
  write(input: string): Promise<string>;
  destroy?: () => void;
};

type RewriterSession = {
  rewrite(input: string): Promise<string>;
  destroy?: () => void;
};

type ChromeAiFactory<TSession> = {
  availability?: (options?: Record<string, unknown>) => Promise<ChromeAiAvailability> | ChromeAiAvailability;
  create: (options?: ChromeAiCreateOptions) => Promise<TSession>;
};

interface Window {
  LanguageModel?: ChromeAiFactory<LanguageModelSession>;
  Summarizer?: ChromeAiFactory<SummarizerSession>;
  Translator?: ChromeAiFactory<TranslatorSession>;
  LanguageDetector?: ChromeAiFactory<LanguageDetectorSession>;
  Writer?: ChromeAiFactory<WriterSession>;
  Rewriter?: ChromeAiFactory<RewriterSession>;
}
