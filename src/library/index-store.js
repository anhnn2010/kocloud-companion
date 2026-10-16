const DATABASE_NAME = "kocloud-companion";
const DATABASE_VERSION = 1;
const ENTRY_STORE = "library-index-entries";
const META_STORE = "library-index-meta";
const META_KEY = "library-index";

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}

/** In-memory store used by tests and as a browser fallback. */
export class MemoryLibraryIndexStore {
  constructor() {
    this.meta = null;
    this.entries = new Map();
  }

  async load() {
    return {
      meta: this.meta ? { ...this.meta } : null,
      entries: Array.from(this.entries.values(), (entry) => ({ ...entry })),
    };
  }

  async replace(meta, entries) {
    this.meta = { ...meta };
    this.entries = new Map(entries.map((entry) => [entry.id, { ...entry }]));
  }

  async putEntry(entry, meta) {
    this.entries.set(entry.id, { ...entry });
    this.meta = { ...meta };
  }

  async deleteEntry(fileId, meta) {
    this.entries.delete(fileId);
    this.meta = { ...meta };
  }

  async clear() {
    this.entries.clear();
    this.meta = null;
  }
}

/** IndexedDB-backed persistent index for the static companion. */
export class IndexedDBLibraryIndexStore {
  constructor(indexedDBFactory = globalThis.indexedDB) {
    this.indexedDB = indexedDBFactory;
    this.databasePromise = null;
  }

  async #database() {
    if (!this.indexedDB) {
      throw new Error("IndexedDB is not available in this browser.");
    }

    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

        request.addEventListener("upgradeneeded", () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(ENTRY_STORE)) {
            database.createObjectStore(ENTRY_STORE, { keyPath: "id" });
          }
          if (!database.objectStoreNames.contains(META_STORE)) {
            database.createObjectStore(META_STORE);
          }
        });

        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error));
      });
    }

    return this.databasePromise;
  }

  async load() {
    const database = await this.#database();
    const transaction = database.transaction(
      [ENTRY_STORE, META_STORE],
      "readonly"
    );
    const entriesRequest = transaction.objectStore(ENTRY_STORE).getAll();
    const metaRequest = transaction.objectStore(META_STORE).get(META_KEY);

    const [entries, meta] = await Promise.all([
      requestAsPromise(entriesRequest),
      requestAsPromise(metaRequest),
      transactionDone(transaction),
    ]);

    return { meta: meta || null, entries: entries || [] };
  }

  async replace(meta, entries) {
    const database = await this.#database();
    const transaction = database.transaction(
      [ENTRY_STORE, META_STORE],
      "readwrite"
    );
    const entryStore = transaction.objectStore(ENTRY_STORE);
    const metaStore = transaction.objectStore(META_STORE);

    entryStore.clear();
    for (const entry of entries) {
      entryStore.put(entry);
    }
    metaStore.put(meta, META_KEY);
    await transactionDone(transaction);
  }

  async putEntry(entry, meta) {
    const database = await this.#database();
    const transaction = database.transaction(
      [ENTRY_STORE, META_STORE],
      "readwrite"
    );
    transaction.objectStore(ENTRY_STORE).put(entry);
    transaction.objectStore(META_STORE).put(meta, META_KEY);
    await transactionDone(transaction);
  }

  async deleteEntry(fileId, meta) {
    const database = await this.#database();
    const transaction = database.transaction(
      [ENTRY_STORE, META_STORE],
      "readwrite"
    );
    transaction.objectStore(ENTRY_STORE).delete(fileId);
    transaction.objectStore(META_STORE).put(meta, META_KEY);
    await transactionDone(transaction);
  }

  async clear() {
    const database = await this.#database();
    const transaction = database.transaction(
      [ENTRY_STORE, META_STORE],
      "readwrite"
    );
    transaction.objectStore(ENTRY_STORE).clear();
    transaction.objectStore(META_STORE).delete(META_KEY);
    await transactionDone(transaction);
  }
}

export function createLibraryIndexStore() {
  if (globalThis.indexedDB) {
    return new IndexedDBLibraryIndexStore(globalThis.indexedDB);
  }
  return new MemoryLibraryIndexStore();
}
