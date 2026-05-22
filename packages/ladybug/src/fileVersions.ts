import { _runCypher } from "./client.ts";

/**
 * Snapshots the current `:File` set for a knowledge into `:FileVersion` nodes
 * tagged with `commitHash`. Run **before** the strategy overwrites the `:File`
 * nodes during a pull, so the prior commit's state is preserved as a version
 * snapshot rather than being lost.
 */
const SNAPSHOT_FILES_TO_VERSION = `
MATCH (f:File {knowledgeId: $knowledgeId})
MERGE (fv:FileVersion {
  id: $knowledgeId + "::" + f.relativePath + "::" + $commitHash
})
SET fv.knowledgeId = $knowledgeId,
    fv.relativePath = f.relativePath,
    fv.commitHash = $commitHash,
    fv.language = f.language,
    fv.sha = f.sha,
    fv.sizeBytes = f.sizeBytes,
    fv.purpose = f.purpose,
    fv.summary = f.summary,
    fv.businessContext = f.businessContext,
    fv.dataFlowDirection = f.dataFlowDirection,
    fv.ontologyConcepts = f.ontologyConcepts,
    fv.businessEntities = f.businessEntities,
    fv.systemCapabilities = f.systemCapabilities,
    fv.sideEffects = f.sideEffects,
    fv.configDependencies = f.configDependencies,
    fv.integrationSurface = f.integrationSurface,
    fv.contractsProvided = f.contractsProvided,
    fv.contractsConsumed = f.contractsConsumed,
    fv.sectionNames = f.sectionNames,
    fv.sectionDescriptions = f.sectionDescriptions,
    fv.snapshotAt = $snapshotAt
MERGE (f)-[:HAS_VERSION]->(fv)
`;

export interface SnapshotFilesInput {
  knowledgeId: string;
  /** The commit the current `:File` state corresponds to — i.e. the OLD commitId being archived. */
  commitHash: string;
}

/** Copies every live `:File` into a `:FileVersion(commitHash)` snapshot. */
export async function snapshotFilesToVersion(input: SnapshotFilesInput): Promise<void> {
  await _runCypher(SNAPSHOT_FILES_TO_VERSION, {
    knowledgeId: input.knowledgeId,
    commitHash: input.commitHash,
    snapshotAt: new Date().toISOString(),
  });
}
