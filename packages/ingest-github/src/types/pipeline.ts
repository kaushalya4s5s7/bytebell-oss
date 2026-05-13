import type { FileAnalysis } from "@bb/mongo";

export interface ScannedFile {
  kind: "file";
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  content: string;
}

export interface OversizedFile {
  kind: "oversized";
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
}

export type ScanEntry = ScannedFile | OversizedFile;

export interface AnalyzedFileResult {
  language: string;
  analysis: FileAnalysis;
}

export interface FileAnalyzer {
  analyze(input: { relativePath: string; content: string }): Promise<AnalyzedFileResult>;
}

export interface PipelineSummary {
  filesAnalyzed: number;
  foldersSummarised: number;
  repoSummarised: boolean;
  graphNodesWritten: number;
  commitHash: string;
}

export interface PipelineDeps {
  reposRootDir: string;
}

export type SkipDecision = "accept" | "reject-static" | "reject-llm" | "accept-llm";

export interface SkipDeciderInput {
  relativePath: string;
  absolutePath: string;
  ext: string;
}

export interface SkipDecider {
  decide(input: SkipDeciderInput): Promise<SkipDecision>;
}
