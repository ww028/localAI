import type { Locale } from "./chromeAi";
import type { AssistantIntent } from "./assistantIntent";
import type { AssistantPlan } from "./assistantPlanner";

export type DeterministicExecution = {
  handled: boolean;
  tool?: "calculator" | "sorter" | "formatter";
  resultText?: string;
  resultData?: unknown;
  error?: string;
};

type SortDirection = "asc" | "desc";
type FormatTarget = "json" | "csv" | "markdown" | "table" | "list";

export function executeDeterministicTask(
  input: string,
  intent: AssistantIntent,
  plan: AssistantPlan,
  locale: Locale,
): DeterministicExecution {
  if (!plan.steps.some((step) => step.deterministic)) {
    return { handled: false };
  }

  switch (intent.type) {
    case "calculate":
      return executeCalculation(input, locale);
    case "sort":
      return executeSort(input, locale);
    case "format_convert":
      return executeFormatConvert(input, intent, locale);
    default:
      return { handled: false };
  }
}

export function formatDeterministicExecution(execution: DeterministicExecution, locale: Locale) {
  if (!execution.handled) {
    return locale === "zh" ? "确定性执行：无" : "Deterministic execution: none";
  }

  const serialized = JSON.stringify({
    tool: execution.tool,
    resultData: execution.resultData,
    error: execution.error,
  }, null, 2);

  const label = locale === "zh" ? "确定性执行结果" : "Deterministic execution result";
  return `${label}：\n${execution.resultText ?? ""}\n\n\`\`\`json\n${serialized}\n\`\`\``;
}

function executeCalculation(input: string, locale: Locale): DeterministicExecution {
  const expression = extractMathExpression(input);
  if (!expression) {
    return {
      handled: true,
      tool: "calculator",
      error: locale === "zh" ? "没有找到可安全计算的数学表达式。" : "No safely calculable expression was found.",
    };
  }

  try {
    const result = evaluateMathExpression(expression);
    return {
      handled: true,
      tool: "calculator",
      resultText: locale === "zh"
        ? `表达式：${expression}\n结果：${formatNumber(result)}`
        : `Expression: ${expression}\nResult: ${formatNumber(result)}`,
      resultData: {
        expression,
        result,
      },
    };
  } catch (error) {
    return {
      handled: true,
      tool: "calculator",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function executeSort(input: string, locale: Locale): DeterministicExecution {
  const direction = detectSortDirection(input);
  const items = extractSortableItems(input);
  if (items.length < 2) {
    return {
      handled: true,
      tool: "sorter",
      error: locale === "zh" ? "没有找到至少两个可排序项目。" : "At least two sortable items are required.",
    };
  }

  const sortedItems = [...items].sort((left, right) => compareSortableItems(left, right, direction));
  return {
    handled: true,
    tool: "sorter",
    resultText: locale === "zh"
      ? `排序方向：${direction === "asc" ? "升序" : "降序"}\n结果：${sortedItems.join(", ")}`
      : `Direction: ${direction === "asc" ? "ascending" : "descending"}\nResult: ${sortedItems.join(", ")}`,
    resultData: {
      direction,
      items,
      sortedItems,
    },
  };
}

function executeFormatConvert(input: string, intent: AssistantIntent, locale: Locale): DeterministicExecution {
  const target = detectFormatTarget(input, intent);
  const rawContent = extractFormatContent(input);
  const records = parseRecords(rawContent);

  if (!records.length) {
    return {
      handled: true,
      tool: "formatter",
      error: locale === "zh" ? "没有找到可转换的内容。" : "No convertible content was found.",
    };
  }

  const result = renderFormat(records, target);
  return {
    handled: true,
    tool: "formatter",
    resultText: result,
    resultData: {
      target,
      records,
    },
  };
}

function extractMathExpression(input: string) {
  const numbers = input.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length >= 2 && /平均|average/i.test(input)) {
    return `(${numbers.join("+")})/${numbers.length}`;
  }
  if (numbers.length >= 2 && /百分比|占比|占.+%|percentage|ratio/i.test(input)) {
    return `(${numbers[0]}/${numbers[1]})*100`;
  }
  if (numbers.length >= 2 && /求和|合计|总共|加起来|sum|total/i.test(input)) {
    return numbers.join("+");
  }

  const normalized = input
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/，/g, ",")
    .replace(/加/g, "+")
    .replace(/减/g, "-")
    .replace(/乘以|乘/g, "*")
    .replace(/除以|除/g, "/")
    .replace(/求和|合计|总共|等于|计算|算一下|是多少|多少/g, " ")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/％/g, "%");
  const candidates = normalized.match(/[0-9+\-*/().%\s]+/g)
    ?.map((candidate) => candidate.trim())
    .filter((candidate) => /\d/.test(candidate) && /[+\-*/%]/.test(candidate)) ?? [];

  return candidates.sort((left, right) => right.length - left.length)[0];
}

function evaluateMathExpression(expression: string) {
  const tokens = tokenizeMath(expression);
  const parser = createMathParser(tokens);
  const value = parser.parseExpression();
  if (!parser.isAtEnd()) {
    throw new Error("Unexpected token in expression.");
  }
  if (!Number.isFinite(value)) {
    throw new Error("Calculation result is not finite.");
  }
  return value;
}

type MathToken = {
  type: "number" | "operator" | "leftParen" | "rightParen";
  value: string;
};

function tokenizeMath(expression: string): MathToken[] {
  const tokens: MathToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[+\-*/%]/.test(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "leftParen", value: char });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rightParen", value: char });
      index += 1;
      continue;
    }
    const numberMatch = expression.slice(index).match(/^\d+(?:\.\d+)?/);
    if (!numberMatch) {
      throw new Error("Unsupported character in expression.");
    }
    const number = numberMatch[0];
    tokens.push({ type: "number", value: number });
    index += number.length;
  }

  return tokens;
}

function createMathParser(tokens: MathToken[]) {
  let position = 0;

  const parseExpression = (): number => {
    let value = parseTerm();
    while (matchOperator("+") || matchOperator("-")) {
      const operator = previous().value;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };

  const parseTerm = (): number => {
    let value = parseFactor();
    while (matchOperator("*") || matchOperator("/") || matchOperator("%")) {
      const operator = previous().value;
      const right = parseFactor();
      if (operator === "*") {
        value *= right;
      } else if (operator === "/") {
        value /= right;
      } else {
        value %= right;
      }
    }
    return value;
  };

  const parseFactor = (): number => {
    if (matchOperator("-")) {
      return -parseFactor();
    }
    if (matchOperator("+")) {
      return parseFactor();
    }
    if (match("number")) {
      return Number(previous().value);
    }
    if (match("leftParen")) {
      const value = parseExpression();
      if (!match("rightParen")) {
        throw new Error("Missing closing parenthesis.");
      }
      return value;
    }
    throw new Error("Expected number or parenthesis.");
  };

  const match = (type: MathToken["type"]) => {
    if (tokens[position]?.type !== type) {
      return false;
    }
    position += 1;
    return true;
  };

  const matchOperator = (operator: string) => {
    if (tokens[position]?.type !== "operator" || tokens[position].value !== operator) {
      return false;
    }
    position += 1;
    return true;
  };

  const previous = () => tokens[position - 1];

  return {
    parseExpression,
    isAtEnd: () => position >= tokens.length,
  };
}

function detectSortDirection(input: string): SortDirection {
  if (/降序|从大到小|descending|desc|largest|highest/i.test(input)) {
    return "desc";
  }
  return "asc";
}

function extractSortableItems(input: string) {
  const explicit = input.match(/[-+]?\d+(?:\.\d+)?/g);
  if (explicit && explicit.length >= 2) {
    return explicit;
  }

  return stripCommandPrefix(input)
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/排序|升序|降序|从大到小|从小到大|sort|ascending|descending/i.test(item));
}

function compareSortableItems(left: string, right: string, direction: SortDirection) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const result = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber - rightNumber
    : left.localeCompare(right, "zh-CN", { numeric: true });

  return direction === "asc" ? result : -result;
}

function detectFormatTarget(input: string, intent: AssistantIntent): FormatTarget {
  const explicitTarget = intent.entities.targetFormat ?? input.match(/\b(json|csv|markdown)\b|表格|列表/i)?.[0];
  const normalized = explicitTarget?.toLowerCase();

  if (normalized === "json") return "json";
  if (normalized === "csv") return "csv";
  if (normalized === "markdown") return "markdown";
  if (normalized === "表格" || /table/i.test(normalized ?? "")) return "table";
  if (normalized === "列表" || /list/i.test(normalized ?? "")) return "list";
  return "json";
}

function extractFormatContent(input: string) {
  const parts = input.split(/[:：]\s*/);
  if (parts.length > 1) {
    return parts.slice(1).join(":").trim();
  }

  return input
    .replace(/^(?:请|帮我)?(?:把|将)?/u, "")
    .replace(/(?:转成|转换成|格式化为|改成|生成)\s*(?:json|csv|markdown|表格|列表)?/iu, "")
    .trim();
}

function parseRecords(content: string): Array<Record<string, string>> {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmedContent) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => normalizeRecord(item));
    }
    if (typeof parsed === "object" && parsed !== null) {
      return [normalizeRecord(parsed)];
    }
  } catch {
    // Fall through to loose text parsing.
  }

  return trimmedContent
    .split(/\n|;|；/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pairs = line.split(/[,，]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.split(/[:：=]/).map((value) => value.trim()));

      if (pairs.length && pairs.every((pair) => pair.length >= 2 && pair[0])) {
        return Object.fromEntries(pairs.map(([key, ...value]) => [key, value.join(":")]));
      }

      return { value: line };
    });
}

function normalizeRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return { value: String(value) };
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      typeof item === "string" ? item : JSON.stringify(item),
    ]),
  );
}

function renderFormat(records: Array<Record<string, string>>, target: FormatTarget) {
  const headers = collectHeaders(records);

  switch (target) {
    case "json":
      return JSON.stringify(records.length === 1 ? records[0] : records, null, 2);
    case "csv":
      return [
        headers.map(escapeCsv).join(","),
        ...records.map((record) => headers.map((header) => escapeCsv(record[header] ?? "")).join(",")),
      ].join("\n");
    case "markdown":
    case "table":
      return renderMarkdownTable(records, headers);
    case "list":
      return records.map((record) => `- ${headers.map((header) => `${header}: ${record[header] ?? ""}`).join(", ")}`).join("\n");
  }
}

function renderMarkdownTable(records: Array<Record<string, string>>, headers: string[]) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...records.map((record) => `| ${headers.map((header) => record[header] ?? "").join(" | ")} |`),
  ].join("\n");
}

function collectHeaders(records: Array<Record<string, string>>) {
  return [...new Set(records.flatMap((record) => Object.keys(record)))];
}

function escapeCsv(value: string) {
  if (!/[",\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function stripCommandPrefix(input: string) {
  return input
    .replace(/^(?:请|帮我)?(?:把|将)?/u, "")
    .replace(/(?:排序|排个序|按.+排|升序|降序|从大到小|从小到大|sort|ascending|descending)/iu, "")
    .trim();
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(10)).toString();
}
