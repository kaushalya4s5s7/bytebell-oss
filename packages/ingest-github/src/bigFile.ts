import { askLLM, type AskLlmUsage } from "@bb/llm";
import type { FileAnalysis } from "@bb/mongo";
import {
  CONDENSE_CONTEXT_LIMIT,
  CONDENSE_PROMPT_OVERHEAD,
  FALLBACK_LANGUAGE,
  MAX_TOKENS_PER_CHUNK,
  SMALL_FILE_DEDUP_THRESHOLD,
  emptyAnalysis,
  estimateTokens,
  parseFileAnalysisJson,
  tryParse,
} from "./analysisShared.ts";

export interface AnalyzedFile {
  language: string;
  analysis: FileAnalysis;
  usage: AskLlmUsage | null;
}

interface ChunkResult {
  language: string;
  analysis: FileAnalysis;
}

interface UsageAccumulator {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}

export async function analyzeBigFile(relativePath: string, content: string): Promise<AnalyzedFile> {
  const chunks = splitIntoChunks(content, MAX_TOKENS_PER_CHUNK);
  const usage: UsageAccumulator = { model: null, inputTokens: 0, outputTokens: 0 };
  const perChunk: ChunkResult[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const result = await analyzeChunk(relativePath, index, chunks.length, chunk, usage);
    perChunk.push(result);
  }

  const merged =
    perChunk.length <= SMALL_FILE_DEDUP_THRESHOLD
      ? dedupAnalyses(perChunk)
      : await condenseRecursively(relativePath, perChunk, 0, usage);

  return { language: merged.language, analysis: merged.analysis, usage: finalize(usage) };
}

function splitIntoChunks(content: string, maxTokensPerChunk: number): string[] {
  const lines = content.split("\n");
  const chunks: string[] = [];
  let buf: string[] = [];
  let bufTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    if (lineTokens > maxTokensPerChunk) {
      if (buf.length > 0) {
        chunks.push(buf.join("\n"));
        buf = [];
        bufTokens = 0;
      }
      for (const segment of splitLongLine(line, maxTokensPerChunk)) {
        chunks.push(segment);
      }
      continue;
    }
    if (bufTokens + lineTokens > maxTokensPerChunk && buf.length > 0) {
      chunks.push(buf.join("\n"));
      buf = [];
      bufTokens = 0;
    }
    buf.push(line);
    bufTokens += lineTokens;
  }
  if (buf.length > 0) {
    chunks.push(buf.join("\n"));
  }
  return chunks;
}

function splitLongLine(line: string, maxTokens: number): string[] {
  const segments: string[] = [];
  let remaining = line;
  while (remaining.length > 0) {
    if (estimateTokens(remaining) <= maxTokens) {
      segments.push(remaining);
      break;
    }
    let low = 0;
    let high = remaining.length;
    let best = Math.min(remaining.length, maxTokens * 2);
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (estimateTokens(remaining.substring(0, mid)) <= maxTokens) {
        best = mid;
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    if (best < 100) {
      best = Math.min(100, remaining.length);
    }
    segments.push(remaining.substring(0, best));
    remaining = remaining.substring(best);
  }
  return segments;
}

async function analyzeChunk(
  relativePath: string,
  chunkIndex: number,
  totalChunks: number,
  chunkContent: string,
  usage: UsageAccumulator,
): Promise<ChunkResult> {
  const prompt = buildChunkPrompt(relativePath, chunkIndex, totalChunks, chunkContent);
  let raw: string;
  try {
    const result = await askLLM(prompt);
    raw = result.content;
    addUsage(usage, result.usage);
  } catch {
    return { language: FALLBACK_LANGUAGE, analysis: emptyAnalysis() };
  }
  const parsed = tryParse(raw);
  if (parsed === null) {
    return { language: FALLBACK_LANGUAGE, analysis: emptyAnalysis() };
  }
  return parseFileAnalysisJson(parsed);
}

async function condenseRecursively(
  relativePath: string,
  items: ChunkResult[],
  depth: number,
  usage: UsageAccumulator,
): Promise<ChunkResult> {
  const first = items[0];
  if (items.length === 1 && first !== undefined) {
    return first;
  }
  const prompt = buildCondensePrompt(relativePath, items);
  if (estimateTokens(prompt) <= CONDENSE_CONTEXT_LIMIT) {
    return await condenseOne(prompt, items, usage);
  }
  const budget = Math.max(CONDENSE_CONTEXT_LIMIT - CONDENSE_PROMPT_OVERHEAD, 2_000);
  const batches = batchByTokenBudget(items, budget);
  const batchResults: ChunkResult[] = [];
  for (const batch of batches) {
    const batchPrompt = buildCondensePrompt(relativePath, batch);
    batchResults.push(await condenseOne(batchPrompt, batch, usage));
  }
  return await condenseRecursively(relativePath, batchResults, depth + 1, usage);
}

async function condenseOne(prompt: string, fallback: ChunkResult[], usage: UsageAccumulator): Promise<ChunkResult> {
  try {
    const result = await askLLM(prompt);
    addUsage(usage, result.usage);
    const parsed = tryParse(result.content);
    if (parsed !== null) {
      return parseFileAnalysisJson(parsed);
    }
  } catch {
    // fall through to dedup
  }
  return dedupAnalyses(fallback);
}

function batchByTokenBudget(items: ChunkResult[], budget: number): ChunkResult[][] {
  const batches: ChunkResult[][] = [];
  let current: ChunkResult[] = [];
  let currentTokens = 0;
  for (const item of items) {
    const itemTokens = estimateTokens(serializeItem(item));
    if (currentTokens + itemTokens > budget && current.length > 0) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(item);
    currentTokens += itemTokens;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

function dedupAnalyses(items: ChunkResult[]): ChunkResult {
  const language = items.find((i) => i.language !== FALLBACK_LANGUAGE)?.language ?? FALLBACK_LANGUAGE;
  const purposes = items.map((i) => i.analysis.purpose).filter((s) => s.length > 0);
  const summaries = items.map((i) => i.analysis.summary).filter((s) => s.length > 0);
  const contexts = items.map((i) => i.analysis.businessContext).filter((s) => s.length > 0);
  const classes = unique(items.flatMap((i) => i.analysis.classes));
  const functions = unique(items.flatMap((i) => i.analysis.functions));
  const imports = unique(items.flatMap((i) => i.analysis.imports));
  const keywords = unique(items.flatMap((i) => i.analysis.keywords)).slice(0, 10);
  return {
    language,
    analysis: {
      purpose: purposes.join(" | "),
      summary: summaries.join(" | "),
      businessContext: contexts.join(" "),
      classes,
      functions,
      imports,
      keywords,
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

function buildChunkPrompt(relativePath: string, chunkIndex: number, totalChunks: number, content: string): string {
  return `You are analyzing chunk ${chunkIndex + 1} of ${totalChunks} from a single source file for a code knowledge graph.
Focus on what exists in THIS CHUNK only. Do not infer content from other chunks.
Return ONLY a JSON object, no prose, no markdown fences, with EXACTLY these keys:

- purpose         : string  — <= 30 words, why the content in this chunk exists
- summary         : string  — <= 80 words, plain-English description of this chunk's contents
- businessContext : string  — 2-3 lines describing the business/product framing visible in this chunk. Empty string if not inferable.
- language        : string  — lowercase canonical name of the language identifiable from the contents (e.g. typescript, python, go, dockerfile, markdown, terraform, graphql). Return "unknown" if you cannot identify the language with confidence — do not guess generic labels like "text" or "plain".
- classes         : string[] — each item: "ClassName (~Lstart-end): one-line responsibility". Empty array if none.
- functions       : string[] — each item: "func_name (~Lstart-end): one-line responsibility". Top-level only; do not list methods of classes already listed above. Empty array if none.
- imports         : string[] — module identifiers as written in source. Empty array if none.
- keywords        : string[] — up to 10 technical/domain keywords. Lowercase, no generic words like "code" or "file".

Do not invent line ranges — derive from the actual content.

File path: ${relativePath}
Chunk content:
${content}`;
}

function buildCondensePrompt(relativePath: string, items: ChunkResult[]): string {
  const serialized = items.map((item, i) => `--- Item ${i + 1} ---\n${serializeItem(item)}`).join("\n\n");
  return `You are condensing ${items.length} partial analyses of a single file \`${relativePath}\` into ONE coherent file-level analysis.
Return ONLY a JSON object, no prose, no markdown fences, with EXACTLY these keys (same shape as the chunk analyses):

- purpose         : string  — merge all item purposes into ONE cohesive 2-3 sentence description.
- summary         : string  — <= 80 words plain-English summary of the entire file.
- businessContext : string  — merge into ONE short paragraph (2-3 lines) of business/product framing. Empty string if no item provided one.
- language        : string  — single lowercase canonical name. Use "unknown" if items disagree or none identified one.
- classes         : string[] — deduplicate. Keep ONLY exported/public classes, interfaces, types, enums and core abstractions. Drop internal helpers and DTOs. Preserve "Name (~Lstart-end): description" format. Aggressively filter to stay under ~3000 tokens total.
- functions       : string[] — deduplicate. Keep ONLY exported/public functions, entry points, API handlers, lifecycle methods. Drop private helpers, trivial getters/setters. Preserve "name (~Lstart-end): description" format. Aggressively filter to stay under ~3000 tokens total.
- imports         : string[] — deduplicate. Drop stdlib and trivial utils.
- keywords        : string[] — deduplicate, keep the top 10 most representative.

INPUT (${items.length} partial analyses):

${serialized}`;
}

function serializeItem(item: ChunkResult): string {
  const a = item.analysis;
  return [
    `language: ${item.language}`,
    `purpose: ${a.purpose}`,
    `summary: ${a.summary}`,
    `businessContext: ${a.businessContext}`,
    `classes (${a.classes.length}): ${JSON.stringify(a.classes)}`,
    `functions (${a.functions.length}): ${JSON.stringify(a.functions)}`,
    `imports (${a.imports.length}): ${JSON.stringify(a.imports)}`,
    `keywords (${a.keywords.length}): ${JSON.stringify(a.keywords)}`,
  ].join("\n");
}

function addUsage(acc: UsageAccumulator, usage: AskLlmUsage): void {
  if (acc.model === null) {
    acc.model = usage.model;
  }
  acc.inputTokens += usage.inputTokens;
  acc.outputTokens += usage.outputTokens;
}

function finalize(acc: UsageAccumulator): AskLlmUsage | null {
  if (acc.model === null) {
    return null;
  }
  return { model: acc.model, inputTokens: acc.inputTokens, outputTokens: acc.outputTokens };
}
