export const KNOWLEDGE_DB_NAME = "local-ai-knowledge";
export const KNOWLEDGE_DB_VERSION = 3;
export const KNOWLEDGE_DOCUMENT_STORE = "documents";
export const KNOWLEDGE_CHUNK_STORE = "chunks";
export const KNOWLEDGE_SPACE_STORE = "spaces";
export const KNOWLEDGE_TERM_INDEX_STORE = "termIndex";

export const KNOWLEDGE_DB_STORES = [
  {
    name: KNOWLEDGE_DOCUMENT_STORE,
    indexes: [{ name: "spaceId", keyPath: "spaceId" }],
  },
  {
    name: KNOWLEDGE_CHUNK_STORE,
    indexes: [
      { name: "documentId", keyPath: "documentId" },
      { name: "spaceId", keyPath: "spaceId" },
    ],
  },
  {
    name: KNOWLEDGE_SPACE_STORE,
    indexes: [],
  },
  {
    name: KNOWLEDGE_TERM_INDEX_STORE,
    indexes: [
      { name: "spaceId", keyPath: "spaceId" },
      { name: "term", keyPath: "term" },
      { name: "chunkId", keyPath: "chunkId" },
      { name: "spaceTerm", keyPath: ["spaceId", "term"] },
    ],
  },
] as const;
