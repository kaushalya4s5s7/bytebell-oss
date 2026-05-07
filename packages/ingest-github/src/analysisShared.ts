import type { FileAnalysis } from "@bb/mongo";

export const FALLBACK_LANGUAGE = "unknown";
export const BIG_FILE_TOKEN_THRESHOLD = 12_000;
export const MAX_TOKENS_PER_CHUNK = 6_000;
export const CONDENSE_CONTEXT_LIMIT = 12_000;
export const CONDENSE_PROMPT_OVERHEAD = 1_500;
export const SMALL_FILE_DEDUP_THRESHOLD = 3;

export interface ParsedFileAnalysis {
  language: string;
  analysis: FileAnalysis;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function emptyAnalysis(): FileAnalysis {
  return {
    purpose: "",
    summary: "",
    businessContext: "",
    classes: [],
    functions: [],
    imports: [],
    keywords: [],
  };
}

export function tryParse(raw: string): Record<string, unknown> | null {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/```\s*$/u, "");
  try {
    const value: unknown = JSON.parse(trimmed);
    if (typeof value === "object" && value !== null) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      out.push(item);
    }
  }
  return out;
}

export function parseFileAnalysisJson(parsed: Record<string, unknown>): ParsedFileAnalysis {
  const parsedLang = parsed["language"];
  const parsedPurpose = parsed["purpose"];
  const parsedSummary = parsed["summary"];
  const parsedBusinessContext = parsed["businessContext"];
  return {
    language: typeof parsedLang === "string" && parsedLang.length > 0 ? parsedLang : FALLBACK_LANGUAGE,
    analysis: {
      purpose: typeof parsedPurpose === "string" ? parsedPurpose : "",
      summary: typeof parsedSummary === "string" ? parsedSummary : "",
      businessContext: typeof parsedBusinessContext === "string" ? parsedBusinessContext : "",
      classes: stringArray(parsed["classes"]),
      functions: stringArray(parsed["functions"]),
      imports: stringArray(parsed["imports"]),
      keywords: stringArray(parsed["keywords"]),
    },
  };
}
