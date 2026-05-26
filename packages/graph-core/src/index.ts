import { KnowledgeState } from "@bb/types";
import type {
  KnowledgeDoc,
  NodeScope,
  RepoSummaryPayload,
  UpsertRepoNodeInput,
  FolderSummaryPayload,
  UpsertFolderNodeInput,
  SnapshotFilesInput,
  UpsertFileNodeInput,
  GraphPingResult,
} from "@bb/types";

export type {
  NodeScope,
  RepoSummaryPayload,
  UpsertRepoNodeInput,
  FolderSummaryPayload,
  UpsertFolderNodeInput,
  SnapshotFilesInput,
  UpsertFileNodeInput,
  GraphPingResult,
};

export interface IGraphKnowledgeRepository {
  upsertKnowledgeNode(doc: KnowledgeDoc): Promise<void>;
  setKnowledgeStateInGraph(knowledgeId: string, state: KnowledgeState): Promise<void>;
  setKnowledgeBranchInGraph(knowledgeId: string, branch: string): Promise<void>;
  deleteKnowledgeGraph(knowledgeId: string): Promise<void>;
}

export interface IGraphFileRepository {
  upsertFileNode(input: UpsertFileNodeInput): Promise<void>;
  deleteFileNodes(knowledgeId: string, paths: string[]): Promise<void>;
  snapshotFilesToVersion(input: SnapshotFilesInput): Promise<void>;
  upsertFileNodesBatch?(inputs: readonly UpsertFileNodeInput[]): Promise<void>;
  bulkUpsertFiles?(knowledgeId: string, fileStream: AsyncIterable<UpsertFileNodeInput>): Promise<void>;
}

export interface IGraphFolderRepository {
  upsertFolderNode(input: UpsertFolderNodeInput): Promise<void>;
  upsertFolderNodesBatch?(inputs: readonly UpsertFolderNodeInput[]): Promise<void>;
}

export interface IGraphRepoRepository {
  upsertRepoNode(input: UpsertRepoNodeInput): Promise<void>;
}

export interface IGraphIndexRepository {
  ensureKnowledgeIndexes(): Promise<void>;
  ensureFlatFolderIndexes(): Promise<void>;
}

export type SmartSearchChannel =
  | "purpose"
  | "businessContext"
  | "paths"
  | "keywords"
  | "classes"
  | "functions"
  | "importsInternal"
  | "importsExternal";

export interface SmartSearchChannelInput {
  knowledgeId: string | null;
  pathPrefix: string | null;
  queryTerms: readonly string[];
  resultCap: number;
  excludeSuffixes: readonly string[];
  excludeContains: readonly string[];
}

export interface ScoredHit {
  path: string;
  knowledgeId: string;
  score: number;
}

export type KeywordLookupMatch = "keyword" | "class" | "function" | "module";

export interface KeywordLookupInput {
  match: KeywordLookupMatch;
  term: string;
  knowledgeId: string | null;
  keywordLimit: number;
  filesPerKeyword: number;
}

export interface KeywordLookupRow {
  name: string;
  path: string | null;
  purpose: string | null;
  summary: string | null;
  repoName: string | null;
  knowledgeId: string | null;
}

export interface KnowledgeListRow {
  knowledgeId: string;
  repoName: string;
  sourceKind: string;
  sourceUrl: string;
  branch: string | null;
  state: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
}

export interface FileMetadataRow {
  path: string;
  language: string | null;
  sizeBytes: number | null;
  purpose: string | null;
  summary: string | null;
  businessContext: string | null;
  keywords: string[];
  classes: string[];
  functions: string[];
  importsInternal: string[];
  importsExternal: string[];
}

export interface RepoNameRow {
  knowledgeId: string;
  repoName: string | null;
}

export interface IGraphSearchRepository {
  runSmartSearchChannel(channel: SmartSearchChannel, params: SmartSearchChannelInput): Promise<ScoredHit[]>;
  keywordLookup(input: KeywordLookupInput): Promise<KeywordLookupRow[]>;
  listKnowledgeBases(): Promise<KnowledgeListRow[]>;
  fetchFileMetadata(knowledgeId: string, paths: readonly string[]): Promise<FileMetadataRow[]>;
  fetchRepoNames(knowledgeIds: readonly string[]): Promise<RepoNameRow[]>;
}

export interface IGraphDatabaseProvider {
  knowledge: IGraphKnowledgeRepository;
  files: IGraphFileRepository;
  folders: IGraphFolderRepository;
  repo: IGraphRepoRepository;
  indexes: IGraphIndexRepository;
  search: IGraphSearchRepository;

  connect(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<GraphPingResult>;
  runCypher(query: string, params?: Record<string, unknown>): Promise<unknown>;
  toNeo4jInt?(value: number): unknown;
}
