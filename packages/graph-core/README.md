# `@bb/graph-core`

Provider-agnostic interfaces for the graph database layer.

## Responsibilities

Defines the contract that every graph database backend (Neo4j, etc.) must implement. Contains no I/O — pure TypeScript interfaces and shared input/output types.

## Public Interfaces

- `IGraphDatabaseProvider` — composite of all repository interfaces plus `connect`/`close`/`ping`/`runCypher`
- `IGraphKnowledgeRepository` — knowledge node CRUD in the graph
- `IGraphFileRepository` — file node upsert, delete, version snapshot
- `IGraphFolderRepository` — folder node upsert
- `IGraphRepoRepository` — repo node upsert
- `IGraphIndexRepository` — index creation
- `IGraphSearchRepository` — read-side queries used by MCP (smart-search channels, keyword lookup, knowledge listing, file metadata, repo-name hydration). Lets MCP stay provider-agnostic — each backend owns its own query dialect.
- `GraphPingResult` — health probe result shape
- Input types: `NodeScope`, `UpsertFileNodeInput`, `UpsertFolderNodeInput`, `UpsertRepoNodeInput`, `SnapshotFilesInput`, and summary payload types
- Search types: `SmartSearchChannel`, `SmartSearchChannelInput`, `ScoredHit`, `KeywordLookupInput`, `KeywordLookupMatch`, `KeywordLookupRow`, `KnowledgeListRow`, `FileMetadataRow`, `RepoNameRow`

## Data Ownership

None. This package owns no data — it only describes shapes.

## Tier

Strategy (interfaces consumed by `@bb/graph-db` and implemented by `@bb/neo4j`)
