# How Bytebell compares

Bytebell sits at the intersection of code-specific knowledge graphs and MCP-native local retrieval — adjacent tools tend to optimize one axis at the cost of another. The closest neighbours, and what each one is built for:

- **[PageIndex][pageindex]** — vectorless, reasoning-based RAG over long professional documents (PDFs, filings).
- **[GitNexus][gitnexus]** — zero-server, MCP-native code knowledge graph built from Tree-sitter ASTs; runs in the browser or as a local CLI.
- **[Microsoft GraphRAG][graphrag]** — general-purpose entity-and-community RAG over narrative text, shipped as a Python library.
- **[Sourcegraph + Cody][sourcegraph]** — enterprise-scale code search and IDE-integrated AI coding assistant; self-hosted or SaaS, multi-tenant.
- **[Augment Code][augment]** — proprietary SaaS context engine + IDE agents tuned for very large multi-repo codebases.

The rest of this doc is one feature table across all six tools, then a short pros / cons sketch of each competitor framed against Bytebell.

> One-liner: Bytebell is the only one of the six that is simultaneously code-specific, MCP-native by design, fully local with zero outbound calls except OpenRouter, graph-based with LLM-generated per-file semantics, and BYO-infra single-tenant — every other tool drops at least one of those.

## Feature comparison

| Axis                           | Bytebell                                                               | PageIndex                        | GitNexus                              | GraphRAG                                               | Sourcegraph + Cody               | Augment Code                    |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------- | ------------------------------------- | ------------------------------------------------------ | -------------------------------- | ------------------------------- |
| Primary domain                 | Code repos                                                             | Long professional documents      | Code repos                            | General text / narrative                               | Code repos                       | Code repos                      |
| Deployment model               | Local Bun daemon (BYO infra)                                           | Python lib + cloud agent         | Browser (WASM) or local CLI           | Python library                                         | Self-hosted / SaaS multi-tenant  | SaaS context engine             |
| Indexing technique             | Per-file LLM: narrative + entity / relationship extraction             | Tree-of-contents reasoning index | Tree-sitter AST + community detection | Per-chunk LLM entity extraction + community clustering | Search index + LSIF / SCIP       | Proprietary semantic index      |
| Storage                        | Neo4j + MongoDB                                                        | TOC tree (no vector DB)          | LadybugDB (embedded, ex-Kuzu)         | Parquet / GraphML files                                | Proprietary code-graph index     | Proprietary cloud index         |
| Retrieval surface              | MCP-native (3 tools) + HTTP                                            | Python SDK / cloud API           | MCP + browser UI                      | Python `query` API                                     | IDE plugins, web UI, REST        | IDE plugins + recent MCP server |
| LLM-derived per-node semantics | `purpose` + `summary` + `businessContext` per file                     | None (structural TOC)            | Optional per-symbol                   | Community summaries (text clusters)                    | None (search-index based)        | Yes, proprietary embeddings     |
| Diff-aware re-indexing         | Per-file content SHA-256 (commit SHA for early-bail; LLM cost ∝ churn) | Full re-parse                    | Git-diff impact + auto re-index hook  | Full re-extract                                        | Incremental indexing             | Continuous (managed)            |
| Outbound network calls         | OpenRouter only; binds 127.0.0.1                                       | Cloud agent option               | None (zero-server)                    | None (offline lib) + LLM provider                      | Code snippets ≤28 KB → cloud LLM | Source code → SaaS              |
| Multi-tenant / auth            | None — `orgId="local"`, no auth                                        | None (lib)                       | None (single-user)                    | None (lib)                                             | SSO / SCIM / RBAC                | Org accounts                    |
| License                        | AGPL-3.0 + non-commercial clause                                       | MIT                              | Apache-2.0                            | MIT                                                    | Proprietary (Cody fair-source)   | Proprietary (SaaS)              |

## Pros and cons of each alternative

### PageIndex

**Pros**

1. State-of-the-art on long-document QA (98.7% on FinanceBench).
2. Vectorless and chunkless — every retrieval path is fully explainable, traceable to a section and page.
3. Reasoning-based traversal preserves document hierarchy, so the agent navigates the way a human would.
4. MIT-licensed and easy to embed.

**Cons**

1. Optimized for prose documents, not source code — no AST, no symbol graph, no notion of files / classes / imports.
2. No MCP integration — agents must wrap the SDK themselves.
3. No incremental re-indexing model for evolving sources.
4. The cloud-agent path sends content off-machine, which is the opposite of Bytebell's posture.

### GitNexus

**Pros**

1. Code-specific and MCP-native — closest in spirit to Bytebell's audience.
2. Zero-infra: runs in the browser via WASM, or as a local CLI; no databases to operate.
3. Deep structural features out of the box: blast-radius analysis, coordinated multi-file rename, architecture-doc generation.
4. Git-diff impact analysis on commit, with PreToolUse / PostToolUse hooks for Claude Code.

**Cons**

1. AST-first — no LLM-generated per-file `purpose` / `summary` / `businessContext`, which weakens natural-language retrieval ("which files implement our retry policy?").
2. Embedded LadybugDB locks the graph behind one tool — no Cypher queryability against an existing Neo4j you may already operate.
3. Browser-only mode is bounded by available WASM memory for very large repos.
4. Fewer fused-channel retrieval primitives — more weight falls on the agent to compose queries across structure and semantics.

### GraphRAG (Microsoft)

**Pros**

1. Battle-tested entity-extraction and community-summary pipeline.
2. Fully open-source (MIT) and runnable as a Python library; modular extract / summarize / query stages.
3. Strong on narrative or unstructured text where entity boundaries are fuzzy.
4. Backed by an active research effort with public benchmarks and a solution accelerator.

**Cons**

1. General-purpose text RAG, not designed for code — no notion of files, classes, imports, or symbols.
2. Library, not a server — no ingestion daemon, no MCP transport, no queue, no state machine.
3. Re-indexing is full-rebuild, not diff-aware — costly to keep current against an evolving repo.
4. Operationalising it for code over time effectively means rebuilding most of Bytebell's outer layer yourself.

### Sourcegraph (+ Cody)

**Pros**

1. Battle-hardened code search across enterprise-scale monorepos.
2. Full IDE integration (VS Code, JetBrains, web) with autocomplete, inline edit, and chat.
3. Precise code intelligence via LSIF / SCIP — go-to-definition, references, cross-repo navigation.
4. Enterprise table-stakes: SSO, SCIM, audit logs, RBAC.

**Cons**

1. Cody sends code (up to 28 KB per request) to a third-party cloud LLM — disqualifying for many compliance regimes.
2. Self-hosting Sourcegraph + Cody is a heavy ops lift compared with a single Bun daemon.
3. MCP is not the primary retrieval surface — agents that want fused semantic + structural search must adapt to Sourcegraph's API.
4. Commercial licence; non-commercial, personal, or academic use is not the design centre.

### Augment Code

**Pros**

1. Excellent semantic code understanding across very large multi-repo workspaces.
2. IDE-first ergonomics (VS Code, JetBrains) plus a CLI ("Auggie").
3. Reported large agent-performance gains via the Context Engine MCP.
4. Actively maintained, frequent improvements, benchmark-driven.

**Cons**

1. Closed-source SaaS — your source code is sent to Augment's cloud.
2. No self-hosted option — wrong fit for air-gapped or regulated environments.
3. Opaque ranking / retrieval — you cannot inspect why a particular file was selected.
4. Commercial licence, per-seat pricing — not aimed at solo, OSS, or academic users.

## Sources

[pageindex]: https://github.com/VectifyAI/PageIndex
[gitnexus]: https://github.com/abhigyanpatwari/GitNexus
[graphrag]: https://github.com/microsoft/graphrag
[sourcegraph]: https://sourcegraph.com/docs/cody
[augment]: https://www.augmentcode.com/context-engine

- PageIndex — <https://github.com/VectifyAI/PageIndex>
- GitNexus — <https://github.com/abhigyanpatwari/GitNexus>
- Microsoft GraphRAG — <https://github.com/microsoft/graphrag>
- Sourcegraph Cody — <https://sourcegraph.com/docs/cody>
- Augment Code Context Engine — <https://www.augmentcode.com/context-engine>
