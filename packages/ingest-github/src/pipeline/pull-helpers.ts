import { recordProcessingStats } from "@bb/mongo";
import { estimateCostFromBreakdown } from "@bb/llm";

export interface PersistPullStatsInput {
  knowledgeId: string;
  repoName: string;
  commitHash: string;
  filesAnalyzed: number;
  foldersSummarised: number;
  processingTimeMs: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
}

export async function persistPullStats(
  input: PersistPullStatsInput,
): Promise<{ inputTokens: number; outputTokens: number }> {
  const estimatedCost = await estimateCostFromBreakdown({});
  return await recordProcessingStats({
    knowledgeId: input.knowledgeId,
    repoName: input.repoName,
    commitHash: input.commitHash,
    modelTokens: {
      total: {
        inputTokens: input.tokenUsage.inputTokens,
        outputTokens: input.tokenUsage.outputTokens,
      },
    },
    estimatedCost,
    totalBatches: 1,
    totalFiles: input.filesAnalyzed,
    totalFolders: input.foldersSummarised,
    filesAnalyzed: input.filesAnalyzed,
    processingTimeMs: input.processingTimeMs,
  });
}

export function repoNameFromUrl(repoUrl: string): string {
  try {
    const segments = new URL(repoUrl).pathname
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const repo = segments.at(-1)?.replace(/\.git$/u, "");
    const owner = segments.at(-2);
    if (owner !== undefined && repo !== undefined) {
      return `${owner}/${repo}`;
    }
  } catch {
    // fall through
  }
  return repoUrl;
}

export function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
