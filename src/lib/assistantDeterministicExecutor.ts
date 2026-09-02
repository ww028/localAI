import type { Locale } from "./chromeAi";
import type { AssistantIntent } from "./assistantIntent";
import type { AssistantPlan } from "./assistantPlanner";

export type DeterministicExecution = {
  handled: boolean;
  tool?: "calculator" | "date-calculator" | "sorter" | "formatter" | "text-statistics";
  resultText?: string;
  resultData?: unknown;
  error?: string;
};

type SortDirection = "asc" | "desc";
type FormatTarget = "json" | "csv" | "markdown" | "table" | "list";
type ParsedSortRecord = {
  raw: string;
  fields: Record<string, string>;
};

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
    case "date_time":
      return executeDateTime(input, locale);
    case "sort":
      return executeSort(input, locale);
    case "format_convert":
      return executeFormatConvert(input, intent, locale);
    case "text_stats":
      return executeTextStats(input, locale);
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
  const aggregateExecution = executeAggregateCalculation(input, locale);
  if (aggregateExecution) {
    return aggregateExecution;
  }

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

function executeAggregateCalculation(input: string, locale: Locale): DeterministicExecution | undefined {
  const numbers = extractNumbers(input);
  if (numbers.length < 2) {
    return undefined;
  }

  const isAverage = /平均|均值|average|mean/i.test(input);
  const isMinimum = /最小值|最小|minimum|min\b/i.test(input);
  const isMaximum = /最大值|最大|maximum|max\b/i.test(input);
  const isRatio = /百分比|占比|占.+%|percentage|ratio/i.test(input);
  const isSum = /求和|合计|总共|加起来|sum|total/i.test(input);

  if (!isAverage && !isMinimum && !isMaximum && !isRatio && !isSum) {
    return undefined;
  }

  let operation: "sum" | "average" | "minimum" | "maximum" | "percentage";
  let result: number;

  if (isRatio) {
    operation = "percentage";
    result = (numbers[0] / numbers[1]) * 100;
  } else if (isAverage) {
    operation = "average";
    result = numbers.reduce((total: number, value: number) => total + value, 0) / numbers.length;
  } else if (isMinimum) {
    operation = "minimum";
    result = Math.min(...numbers);
  } else if (isMaximum) {
    operation = "maximum";
    result = Math.max(...numbers);
  } else {
    operation = "sum";
    result = numbers.reduce((total: number, value: number) => total + value, 0);
  }

  const operationLabel = formatCalculationOperation(operation, locale);
  return {
    handled: true,
    tool: "calculator",
    resultText: locale === "zh"
      ? `操作：${operationLabel}\n输入：${numbers.map(formatNumber).join(", ")}\n结果：${formatNumber(result)}${operation === "percentage" ? "%" : ""}`
      : `Operation: ${operationLabel}\nInput: ${numbers.map(formatNumber).join(", ")}\nResult: ${formatNumber(result)}${operation === "percentage" ? "%" : ""}`,
    resultData: {
      operation,
      numbers,
      result,
      unit: operation === "percentage" ? "percent" : undefined,
    },
  };
}

function extractNumbers(input: string) {
  return (input.match(/-?\d+(?:\.\d+)?%?/g) ?? []).map((value) =>
    value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : Number(value),
  );
}

function formatCalculationOperation(
  operation: "sum" | "average" | "minimum" | "maximum" | "percentage",
  locale: Locale,
) {
  const labels: Record<typeof operation, Record<Locale, string>> = {
    sum: { zh: "求和", en: "sum" },
    average: { zh: "平均值", en: "average" },
    minimum: { zh: "最小值", en: "minimum" },
    maximum: { zh: "最大值", en: "maximum" },
    percentage: { zh: "百分比", en: "percentage" },
  };

  return labels[operation][locale];
}

function executeDateTime(input: string, locale: Locale): DeterministicExecution {
  const timeZoneConversion = executeTimeZoneConversion(input, locale);
  if (timeZoneConversion) {
    return timeZoneConversion;
  }

  const dates = extractDates(input);
  const offsetMatch = input.match(/(-?\d+)\s*(?:天|days?)\s*(后|前|after|before)?/i);

  if (offsetMatch) {
    const baseDate = dates[0] ?? startOfUtcDay(new Date());
    const amount = Number(offsetMatch[1]) * (/前|before/i.test(offsetMatch[2] ?? "") ? -1 : 1);
    const resultDate = addDays(baseDate, amount);
    return {
      handled: true,
      tool: "date-calculator",
      resultText: locale === "zh"
        ? `基准日期：${formatDate(baseDate)}\n偏移天数：${amount}\n结果日期：${formatDate(resultDate)}`
        : `Base date: ${formatDate(baseDate)}\nDay offset: ${amount}\nResult date: ${formatDate(resultDate)}`,
      resultData: {
        operation: "date-offset",
        baseDate: formatDate(baseDate),
        days: amount,
        resultDate: formatDate(resultDate),
      },
    };
  }

  if (dates.length >= 2 && /工作日|workdays?|business days?/i.test(input)) {
    const businessDays = countBusinessDays(dates[0], dates[1]);
    return {
      handled: true,
      tool: "date-calculator",
      resultText: locale === "zh"
        ? `开始日期：${formatDate(dates[0])}\n结束日期：${formatDate(dates[1])}\n工作日：${businessDays}`
        : `Start date: ${formatDate(dates[0])}\nEnd date: ${formatDate(dates[1])}\nBusiness days: ${businessDays}`,
      resultData: {
        operation: "business-days",
        startDate: formatDate(dates[0]),
        endDate: formatDate(dates[1]),
        businessDays,
      },
    };
  }

  if (dates.length >= 2) {
    const days = Math.abs(diffDays(dates[0], dates[1]));
    return {
      handled: true,
      tool: "date-calculator",
      resultText: locale === "zh"
        ? `开始日期：${formatDate(dates[0])}\n结束日期：${formatDate(dates[1])}\n相差天数：${days}`
        : `Start date: ${formatDate(dates[0])}\nEnd date: ${formatDate(dates[1])}\nDays between: ${days}`,
      resultData: {
        operation: "date-difference",
        startDate: formatDate(dates[0]),
        endDate: formatDate(dates[1]),
        days,
      },
    };
  }

  return {
    handled: true,
    tool: "date-calculator",
    error: locale === "zh" ? "没有找到可计算的日期、时间或时区信息。" : "No calculable date, time, or time-zone information was found.",
  };
}

function executeTimeZoneConversion(input: string, locale: Locale): DeterministicExecution | undefined {
  if (!/时区|北京时间|UTC|GMT|timezone|time zone|convert/i.test(input)) {
    return undefined;
  }

  const timeMatch = input.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!timeMatch) {
    return undefined;
  }

  const zones = detectTimeZones(input);
  if (!zones) {
    return undefined;
  }

  const sourceMinutes = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  const convertedMinutes = normalizeMinutes(sourceMinutes + (zones.target.offset - zones.source.offset) * 60);
  const convertedTime = `${String(Math.floor(convertedMinutes / 60)).padStart(2, "0")}:${String(convertedMinutes % 60).padStart(2, "0")}`;
  const sourceTime = `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2]}`;

  return {
    handled: true,
    tool: "date-calculator",
    resultText: locale === "zh"
      ? `${sourceTime} ${zones.source.label} = ${convertedTime} ${zones.target.label}`
      : `${sourceTime} ${zones.source.label} = ${convertedTime} ${zones.target.label}`,
    resultData: {
      operation: "timezone-conversion",
      sourceTime,
      sourceZone: zones.source.label,
      targetZone: zones.target.label,
      resultTime: convertedTime,
      offsetHours: zones.target.offset - zones.source.offset,
    },
  };
}

function extractDates(input: string) {
  const matches = [
    ...input.matchAll(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g),
    ...input.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g),
  ];

  return matches
    .map((match) => createUtcDate(Number(match[1]), Number(match[2]), Number(match[3])))
    .filter((date) => !Number.isNaN(date.getTime()));
}

function createUtcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function startOfUtcDay(date: Date) {
  return createUtcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function diffDays(startDate: Date, endDate: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfUtcDay(endDate).getTime() - startOfUtcDay(startDate).getTime()) / millisecondsPerDay);
}

function countBusinessDays(startDate: Date, endDate: Date) {
  const direction = diffDays(startDate, endDate) < 0 ? -1 : 1;
  let cursor = startOfUtcDay(startDate);
  const end = startOfUtcDay(endDate);
  let count = 0;

  while ((direction > 0 && cursor <= end) || (direction < 0 && cursor >= end)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      count += 1;
    }
    cursor = addDays(cursor, direction);
  }

  return count;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeMinutes(minutes: number) {
  const dayMinutes = 24 * 60;
  return ((minutes % dayMinutes) + dayMinutes) % dayMinutes;
}

function detectTimeZones(input: string) {
  const zones = [
    { key: "beijing", label: "Asia/Shanghai", offset: 8, patterns: [/北京时间|中国时间|CST\b|Asia\/Shanghai/i] },
    { key: "tokyo", label: "Asia/Tokyo", offset: 9, patterns: [/东京|日本时间|JST\b|Asia\/Tokyo/i] },
    { key: "utc", label: "UTC", offset: 0, patterns: [/\bUTC\b|\bGMT\b/i] },
    { key: "new-york", label: "America/New_York", offset: -5, patterns: [/纽约|美东|EST\b|America\/New_York/i] },
    { key: "los-angeles", label: "America/Los_Angeles", offset: -8, patterns: [/洛杉矶|美西|PST\b|America\/Los_Angeles/i] },
    { key: "london", label: "Europe/London", offset: 0, patterns: [/伦敦|英国时间|Europe\/London/i] },
  ];
  const matchedZones = zones.filter((zone) => zone.patterns.some((pattern) => pattern.test(input)));
  if (matchedZones.length < 2) {
    if (matchedZones.length === 1 && /北京时间|中国时间|Asia\/Shanghai/i.test(input) && /\bUTC\b|\bGMT\b/i.test(input)) {
      return {
        source: zones.find((zone) => zone.key === "utc")!,
        target: matchedZones[0],
      };
    }
    return undefined;
  }

  const toMatch = input.match(/(?:到|转|转为|转换为|to)\s*(北京时间|中国时间|东京|日本时间|UTC|GMT|纽约|美东|洛杉矶|美西|伦敦|英国时间|Asia\/Shanghai|Asia\/Tokyo|America\/New_York|America\/Los_Angeles|Europe\/London)/i)?.[1];
  const target = toMatch
    ? zones.find((zone) => zone.patterns.some((pattern) => pattern.test(toMatch)))
    : matchedZones[matchedZones.length - 1];
  const source = matchedZones.find((zone) => zone.key !== target?.key) ?? matchedZones[0];

  if (!target || !source || target.key === source.key) {
    return undefined;
  }

  return { source, target };
}

function executeSort(input: string, locale: Locale): DeterministicExecution {
  const direction = detectSortDirection(input);
  const sortField = detectSortField(input);
  const rawContent = extractSortContent(input);
  const records = parseSortRecords(rawContent);
  if (sortField && records.length >= 2 && records.every((record) => sortField in record.fields)) {
    const sortedRecords = [...records].sort((left, right) =>
      compareSortableItems(left.fields[sortField] ?? "", right.fields[sortField] ?? "", direction, locale),
    );
    return {
      handled: true,
      tool: "sorter",
      resultText: locale === "zh"
        ? `排序字段：${sortField}\n排序方向：${direction === "asc" ? "升序" : "降序"}\n结果：\n${renderMarkdownTable(sortedRecords.map((record) => record.fields), collectHeaders(sortedRecords.map((record) => record.fields)))}`
        : `Sort field: ${sortField}\nDirection: ${direction === "asc" ? "ascending" : "descending"}\nResult:\n${renderMarkdownTable(sortedRecords.map((record) => record.fields), collectHeaders(sortedRecords.map((record) => record.fields)))}`,
      resultData: {
        direction,
        sortField,
        records: records.map((record) => record.fields),
        sortedRecords: sortedRecords.map((record) => record.fields),
      },
    };
  }

  const items = extractSortableItems(input);
  if (items.length < 2) {
    return {
      handled: true,
      tool: "sorter",
      error: locale === "zh" ? "没有找到至少两个可排序项目。" : "At least two sortable items are required.",
    };
  }

  const sortedItems = [...items].sort((left, right) => compareSortableItems(left, right, direction, locale));
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

function executeTextStats(input: string, locale: Locale): DeterministicExecution {
  const content = extractTextStatsContent(input);
  if (!content) {
    return {
      handled: true,
      tool: "text-statistics",
      error: locale === "zh" ? "没有找到可统计的文本。" : "No text was found for statistics.",
    };
  }

  const tokens = tokenizeText(content);
  const frequency = countValues(tokens);
  const duplicateItems = Object.entries({
    ...countValues(extractListItems(content)),
    ...countValues(tokens),
  })
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
  const groupCounts = countGroups(content);
  const topFrequencies = Object.entries(frequency)
    .sort((left, right) => right[1] - left[1] || compareFrequencyToken(left[0], right[0], locale))
    .slice(0, 10)
    .map(([value, count]) => ({ value, count }));
  const resultData = {
    characterCount: Array.from(content).length,
    nonWhitespaceCharacterCount: Array.from(content.replace(/\s/g, "")).length,
    wordCount: tokens.length,
    lineCount: content.split(/\n/).filter((line) => line.trim()).length,
    topFrequencies,
    duplicateItems,
    groupCounts,
  };

  return {
    handled: true,
    tool: "text-statistics",
    resultText: locale === "zh"
      ? [
          `字符数：${resultData.characterCount}`,
          `非空白字符数：${resultData.nonWhitespaceCharacterCount}`,
          `词/词元数：${resultData.wordCount}`,
          `非空行数：${resultData.lineCount}`,
          `高频项：${topFrequencies.map((item) => `${item.value}=${item.count}`).join(", ") || "无"}`,
          `重复项：${duplicateItems.map((item) => `${item.value}=${item.count}`).join(", ") || "无"}`,
          `分组计数：${Object.entries(groupCounts).map(([key, count]) => `${key}=${count}`).join(", ") || "无"}`,
        ].join("\n")
      : [
          `Characters: ${resultData.characterCount}`,
          `Non-whitespace characters: ${resultData.nonWhitespaceCharacterCount}`,
          `Words/tokens: ${resultData.wordCount}`,
          `Non-empty lines: ${resultData.lineCount}`,
          `Top frequencies: ${topFrequencies.map((item) => `${item.value}=${item.count}`).join(", ") || "none"}`,
          `Duplicates: ${duplicateItems.map((item) => `${item.value}=${item.count}`).join(", ") || "none"}`,
          `Group counts: ${Object.entries(groupCounts).map(([key, count]) => `${key}=${count}`).join(", ") || "none"}`,
        ].join("\n"),
    resultData,
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
    while (matchOperator("*") || matchOperator("/")) {
      const operator = previous().value;
      const right = parseFactor();
      if (operator === "*") {
        value *= right;
      } else {
        value /= right;
      }
    }
    return value;
  };

  const parseFactor = (): number => {
    let value: number;
    if (matchOperator("-")) {
      return -parseFactor();
    }
    if (matchOperator("+")) {
      return parseFactor();
    }
    if (match("number")) {
      value = Number(previous().value);
    } else if (match("leftParen")) {
      value = parseExpression();
      if (!match("rightParen")) {
        throw new Error("Missing closing parenthesis.");
      }
    } else {
      throw new Error("Expected number or parenthesis.");
    }

    while (matchOperator("%")) {
      value /= 100;
    }

    return value;
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

function detectSortField(input: string) {
  return input.match(/(?:按|by)\s*([A-Za-z_\u3400-\u9fff][\w\u3400-\u9fff-]*)/i)?.[1];
}

function extractSortContent(input: string) {
  const parts = input.split(/[:：]\s*/);
  if (parts.length > 1) {
    return parts.slice(1).join(":").trim();
  }

  return stripCommandPrefix(input)
    .replace(/(?:按|by)\s*[A-Za-z_\u3400-\u9fff][\w\u3400-\u9fff-]*/iu, "")
    .trim();
}

function extractSortableItems(input: string) {
  const content = extractSortContent(input);
  const explicit = content.match(/[-+]?\d+(?:\.\d+)?/g);
  const numericRemainder = content
    .replace(/[-+]?\d+(?:\.\d+)?/g, "")
    .replace(/[,，、\n;\s.-]/g, "");
  if (explicit && explicit.length >= 2 && !numericRemainder) {
    return explicit;
  }

  return content
    .split(/[,，、\n;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/排序|升序|降序|从大到小|从小到大|sort|ascending|descending/i.test(item));
}

function parseSortRecords(content: string): ParsedSortRecord[] {
  return content
    .split(/\n|;|；/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ raw: line, fields: parseKeyValueFields(line) }))
    .filter((record) => Object.keys(record.fields).length > 0);
}

function extractTextStatsContent(input: string) {
  const parts = input.split(/[:：]\s*/);
  if (parts.length > 1) {
    return parts.slice(1).join(":").trim();
  }

  return input
    .replace(/^(?:请|帮我)?(?:统计|分析)?/u, "")
    .replace(/(?:字数|词频|重复项|去重|分组计数|分组统计|文本统计|word count|character count|frequency|duplicates?|dedupe|group count|text statistics)/iu, "")
    .trim();
}

function tokenizeText(content: string) {
  return content
    .toLowerCase()
    .match(/[a-z0-9]+(?:'[a-z0-9]+)?|[\u3400-\u9fff]/g) ?? [];
}

function extractListItems(content: string) {
  return content
    .split(/[,，、\n;；]/)
    .map((item) => item.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean);
}

function countValues(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function countGroups(content: string) {
  const counts: Record<string, number> = {};

  for (const item of extractListItems(content)) {
    const group = item.split(/[:：=,\s]+/)[0]?.trim();
    if (group && group !== item) {
      counts[group] = (counts[group] ?? 0) + 1;
    }
  }

  return counts;
}

function compareFrequencyToken(left: string, right: string, locale: Locale) {
  const leftAscii = /^[a-z0-9]/i.test(left);
  const rightAscii = /^[a-z0-9]/i.test(right);
  if (leftAscii !== rightAscii) {
    return leftAscii ? -1 : 1;
  }

  return left.localeCompare(right, locale === "zh" ? "zh-CN" : "en", { numeric: true, sensitivity: "base" });
}

function compareSortableItems(left: string, right: string, direction: SortDirection, locale: Locale) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  let result: number;
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    result = leftNumber - rightNumber;
  } else {
    const leftAscii = /^[A-Za-z0-9]/.test(left);
    const rightAscii = /^[A-Za-z0-9]/.test(right);
    result = leftAscii !== rightAscii
      ? leftAscii ? -1 : 1
      : left.localeCompare(right, locale === "zh" ? "zh-CN" : "en", { numeric: true, sensitivity: "base" });
  }

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
    // Fall through to structured text parsing.
  }

  const markdownRecords = parseMarkdownTable(trimmedContent);
  if (markdownRecords.length) {
    return markdownRecords;
  }

  const csvRecords = parseCsv(trimmedContent);
  if (csvRecords.length) {
    return csvRecords;
  }

  return trimmedContent
    .split(/\n|;|；/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = parseKeyValueFields(line);

      if (Object.keys(fields).length) {
        return fields;
      }

      return { item: line.replace(/^[-*]\s+/, "") };
    });
}

function parseKeyValueFields(line: string): Record<string, string> {
  const pairs = line.split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/[:：=]/).map((value) => value.trim()));

  if (!pairs.length || !pairs.every((pair) => pair.length >= 2 && pair[0])) {
    return {};
  }

  return Object.fromEntries(pairs.map(([key, ...value]) => [key, value.join(":")]));
}

function parseMarkdownTable(content: string): Array<Record<string, string>> {
  const tableLines = content.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (tableLines.length < 2) {
    return [];
  }

  const headers = splitMarkdownRow(tableLines[0]);
  const separator = splitMarkdownRow(tableLines[1]);
  if (!headers.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return [];
  }

  return tableLines.slice(2)
    .map(splitMarkdownRow)
    .filter((cells) => cells.length)
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function splitMarkdownRow(line: string) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || !lines[0].includes(",")) {
    return [];
  }

  const rows = lines.map(parseCsvLine);
  const headers = rows[0];
  if (!headers.length || rows.slice(1).some((row) => row.length !== headers.length)) {
    return [];
  }

  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];
    if (char === "\"" && inQuotes && nextChar === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell.trim());
  return cells;
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
    .replace(/(?:排序|排个序|按.+排|升序|降序|从大到小|从小到大|sort|ascending|descending)/giu, "")
    .trim();
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(10)).toString();
}
