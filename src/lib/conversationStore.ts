import type { Locale } from "./chromeAi";

export type StoredChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  sources?: Array<{
    documentName: string;
    chunkIndex: number;
    text: string;
  }>;
};

export type StoredConversation = {
  id: string;
  title: string;
  locale: Locale;
  messages: StoredChatMessage[];
  status?: "idle" | "running";
  createdAt: number;
  updatedAt: number;
};

const DB_NAME = "local-ai";
const DB_VERSION = 1;
const STORE_NAME = "conversations";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

export async function saveConversation(conversation: StoredConversation) {
  const db = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(conversation);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Failed to save conversation."));
    };
  });
}

export async function listConversations(): Promise<StoredConversation[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => {
      db.close();
      resolve(
        request.result
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, 12),
      );
    };

    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Failed to read conversations."));
    };
  });
}

export async function getConversation(id: string): Promise<StoredConversation | undefined> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);

    request.onsuccess = () => {
      db.close();
      resolve(request.result);
    };

    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Failed to read conversation."));
    };
  });
}
