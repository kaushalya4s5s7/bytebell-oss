import type { FileAnalysis } from "@bb/types";
import { _runCypher } from "./client.ts";

const UPSERT_FILE = `
MERGE (f:File {id: $id})
SET f.knowledgeId = $knowledgeId,
    f.relativePath = $relativePath,
    f.orgId = $orgId,
    f.repoId = $repoId,
    f.language = $language,
    f.sha = $sha,
    f.sizeBytes = $sizeBytes,
    f.purpose = $purpose,
    f.summary = $summary,
    f.businessContext = $businessContext,
    f.dataFlowDirection = $dataFlowDirection,
    f.ontologyConcepts = $ontologyConcepts,
    f.businessEntities = $businessEntities,
    f.systemCapabilities = $systemCapabilities,
    f.sideEffects = $sideEffects,
    f.configDependencies = $configDependencies,
    f.integrationSurface = $integrationSurface,
    f.contractsProvided = $contractsProvided,
    f.contractsConsumed = $contractsConsumed,
    f.sectionNames = $sectionNames,
    f.sectionDescriptions = $sectionDescriptions,
    f.isBigFile = $isBigFile,
    f.totalChunks = $totalChunks,
    f.totalTokenCount = $totalTokenCount,
    f.updatedAt = $updatedAt
WITH f
MATCH (k:Knowledge {knowledgeId: $knowledgeId})
MERGE (k)-[:HAS_FILE]->(f)
`;

const ATTACH_FILE_TO_FOLDER = `
MATCH (f:File {id: $id})
MATCH (folder:Folder {id: $folderId})
MERGE (folder)-[:CONTAINS]->(f)
`;

const CLEAR_KEYWORDS = `
MATCH (f:File {id: $id})-[r:HAS_KEYWORD]->()
DELETE r
`;

const CLEAR_CLASSES = `
MATCH (f:File {id: $id})-[r:HAS_CLASS]->()
DELETE r
`;

const CLEAR_FUNCTIONS = `
MATCH (f:File {id: $id})-[r:HAS_FUNCTION]->()
DELETE r
`;

const CLEAR_IMPORTS_INTERNAL = `
MATCH (f:File {id: $id})-[r:HAS_IMPORT_INTERNAL]->()
DELETE r
`;

const CLEAR_IMPORTS_EXTERNAL = `
MATCH (f:File {id: $id})-[r:HAS_IMPORT_EXTERNAL]->()
DELETE r
`;

const ATTACH_KEYWORDS = `
MATCH (f:File {id: $id})
UNWIND $names AS name
MERGE (kw:Keyword {name: name})
CREATE (f)-[:HAS_KEYWORD]->(kw)
`;

const ATTACH_CLASSES = `
MATCH (f:File {id: $id})
UNWIND $signatures AS signature
MERGE (c:Class {signature: signature})
CREATE (f)-[:HAS_CLASS]->(c)
`;

const ATTACH_FUNCTIONS = `
MATCH (f:File {id: $id})
UNWIND $signatures AS signature
MERGE (fn:Function {signature: signature})
CREATE (f)-[:HAS_FUNCTION]->(fn)
`;

const ATTACH_IMPORTS_INTERNAL = `
MATCH (f:File {id: $id})
UNWIND $names AS name
MERGE (m:Module {name: name})
CREATE (f)-[:HAS_IMPORT_INTERNAL]->(m)
`;

const ATTACH_IMPORTS_EXTERNAL = `
MATCH (f:File {id: $id})
UNWIND $names AS name
MERGE (m:Module {name: name})
CREATE (f)-[:HAS_IMPORT_EXTERNAL]->(m)
`;

export interface UpsertFileNodeInput {
  orgId?: string;
  knowledgeId: string;
  repoId?: string;
  relativePath: string;
  language: string;
  sha: string;
  sizeBytes: number;
  analysis: FileAnalysis;
  folderPath?: string;
  isBigFile?: boolean;
  totalChunks?: number;
  totalTokenCount?: number;
}

const DELETE_FILES = `
MATCH (f:File {knowledgeId: $knowledgeId})
WHERE f.relativePath IN $relativePaths
DETACH DELETE f
`;

export async function deleteFileNodes(knowledgeId: string, relativePaths: string[]): Promise<void> {
  if (relativePaths.length === 0) {
    return;
  }
  await _runCypher(DELETE_FILES, { knowledgeId, relativePaths });
}

export async function upsertFileNode(input: UpsertFileNodeInput): Promise<void> {
  const orgId = input.orgId ?? "local";
  const repoId = input.repoId ?? input.knowledgeId;
  const id = `${input.knowledgeId}::${input.relativePath}`;

  const params = { id, knowledgeId: input.knowledgeId };
  const sectionMap = input.analysis.sectionMap ?? [];

  await _runCypher(UPSERT_FILE, {
    id,
    knowledgeId: input.knowledgeId,
    relativePath: input.relativePath,
    orgId,
    repoId,
    language: input.language,
    sha: input.sha,
    sizeBytes: input.sizeBytes,
    purpose: input.analysis.purpose,
    summary: input.analysis.summary,
    businessContext: input.analysis.businessContext,
    dataFlowDirection: input.analysis.dataFlowDirection ?? "",
    ontologyConcepts: input.analysis.ontologyConcepts ?? [],
    businessEntities: input.analysis.businessEntities ?? [],
    systemCapabilities: input.analysis.systemCapabilities ?? [],
    sideEffects: input.analysis.sideEffects ?? [],
    configDependencies: input.analysis.configDependencies ?? [],
    integrationSurface: input.analysis.integrationSurface ?? [],
    contractsProvided: input.analysis.contractsProvided ?? [],
    contractsConsumed: input.analysis.contractsConsumed ?? [],
    sectionNames: sectionMap.map((s) => s.name),
    sectionDescriptions: sectionMap.map((s) => s.description),
    isBigFile: input.isBigFile ?? false,
    totalChunks: input.totalChunks ?? 0,
    totalTokenCount: input.totalTokenCount ?? 0,
    updatedAt: new Date().toISOString(),
  });

  if (input.folderPath !== undefined) {
    const folderId = `${orgId}::${input.knowledgeId}::${repoId}::${input.folderPath}`;
    await _runCypher(ATTACH_FILE_TO_FOLDER, { id, folderId });
  }

  await _runCypher(CLEAR_KEYWORDS, params);
  await _runCypher(CLEAR_CLASSES, params);
  await _runCypher(CLEAR_FUNCTIONS, params);
  await _runCypher(CLEAR_IMPORTS_INTERNAL, params);
  await _runCypher(CLEAR_IMPORTS_EXTERNAL, params);

  if (input.analysis.keywords.length > 0) {
    await _runCypher(ATTACH_KEYWORDS, { id, names: input.analysis.keywords.map((k) => k.toLowerCase()) });
  }
  if (input.analysis.classes.length > 0) {
    await _runCypher(ATTACH_CLASSES, { id, signatures: input.analysis.classes });
  }
  if (input.analysis.functions.length > 0) {
    await _runCypher(ATTACH_FUNCTIONS, { id, signatures: input.analysis.functions });
  }
  if (input.analysis.importsInternal.length > 0) {
    await _runCypher(ATTACH_IMPORTS_INTERNAL, { id, names: input.analysis.importsInternal });
  }
  if (input.analysis.importsExternal.length > 0) {
    await _runCypher(ATTACH_IMPORTS_EXTERNAL, { id, names: input.analysis.importsExternal });
  }
}
