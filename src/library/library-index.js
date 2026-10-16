import {
  createExactFingerprint,
  normalizeFileSize,
} from "./fingerprint.js";

const INDEX_SCHEMA_VERSION = 1;

function joinPath(parentPath, name) {
  if (!parentPath) {
    return name || "Untitled";
  }
  return `${String(parentPath).replace(/\/$/, "")}/${name || "Untitled"}`;
}

export function createLibraryIndexEntry(
  file,
  {
    parentId = "",
    parentPath = "",
    path = "",
    isBook = false,
  } = {}
) {
  const name = file?.name || "Untitled";
  return {
    id: file?.id || "",
    name,
    parentId: parentId || file?.parents?.[0] || "",
    path: path || joinPath(parentPath, name),
    size: normalizeFileSize(file?.size) ?? 0,
    modifiedTime: file?.modifiedTime || "",
    mimeType: file?.mimeType || "",
    md5Checksum: file?.md5Checksum || "",
    sha1Checksum: file?.sha1Checksum || "",
    sha256Checksum: file?.sha256Checksum || "",
    fingerprint: createExactFingerprint(file),
    isBook: Boolean(isBook),
  };
}

function buildDuplicateGroups(entries) {
  const seen = new Map();
  for (const entry of entries) {
    if (!entry.isBook || !entry.fingerprint) {
      continue;
    }
    const files = seen.get(entry.fingerprint) || [];
    files.push({ ...entry });
    seen.set(entry.fingerprint, files);
  }

  return Array.from(seen.entries())
    .filter(([, files]) => files.length > 1)
    .map(([fingerprint, files]) => {
      const size = files[0]?.size || 0;
      return {
        id: fingerprint,
        fingerprint,
        size,
        files,
        duplicateCopies: files.length - 1,
        reclaimableBytes: size * (files.length - 1),
      };
    })
    .sort((left, right) => {
      if (left.reclaimableBytes !== right.reclaimableBytes) {
        return right.reclaimableBytes - left.reclaimableBytes;
      }
      return String(left.files[0]?.name || "").localeCompare(
        String(right.files[0]?.name || ""),
        undefined,
        { sensitivity: "base", numeric: true }
      );
    });
}

export class LibraryIndex {
  constructor({ store }) {
    this.store = store;
    this.entries = new Map();
    this.meta = null;
    this.loaded = false;
  }

  async load(rootFolderId) {
    const snapshot = await this.store.load();
    const meta = snapshot.meta || null;

    if (
      !meta ||
      meta.schemaVersion !== INDEX_SCHEMA_VERSION ||
      meta.rootFolderId !== rootFolderId ||
      !meta.complete
    ) {
      this.entries = new Map();
      this.meta = null;
      this.loaded = true;
      return false;
    }

    this.entries = new Map(
      (snapshot.entries || []).map((entry) => [entry.id, entry])
    );
    this.meta = { ...meta };
    this.loaded = true;
    return true;
  }

  isReady(rootFolderId) {
    return Boolean(
      this.loaded &&
      this.meta?.complete &&
      this.meta?.rootFolderId === rootFolderId
    );
  }

  getMeta() {
    return this.meta ? { ...this.meta } : null;
  }

  async replaceAll(rootFolderId, entries) {
    const now = new Date().toISOString();
    const uniqueEntries = new Map();
    for (const entry of entries) {
      if (entry?.id) {
        uniqueEntries.set(entry.id, { ...entry });
      }
    }

    const meta = this.#buildMeta(rootFolderId, now, {
      builtAt: now,
      complete: true,
      entryCount: uniqueEntries.size,
    });

    await this.store.replace(meta, Array.from(uniqueEntries.values()));
    this.entries = uniqueEntries;
    this.meta = meta;
    this.loaded = true;
    return this.getReport();
  }

  async upsert(entry) {
    if (!entry?.id || !this.meta?.complete) {
      return false;
    }

    const normalized = { ...entry };
    this.entries.set(normalized.id, normalized);
    this.meta = this.#buildMeta(this.meta.rootFolderId, new Date().toISOString(), {
      builtAt: this.meta.builtAt,
      complete: true,
      entryCount: this.entries.size,
    });
    await this.store.putEntry(normalized, this.meta);
    return true;
  }

  async remove(fileId) {
    if (!fileId || !this.meta?.complete) {
      return false;
    }

    if (!this.entries.delete(fileId)) {
      return false;
    }

    this.meta = this.#buildMeta(this.meta.rootFolderId, new Date().toISOString(), {
      builtAt: this.meta.builtAt,
      complete: true,
      entryCount: this.entries.size,
    });
    await this.store.deleteEntry(fileId, this.meta);
    return true;
  }

  async clear() {
    await this.store.clear();
    this.entries = new Map();
    this.meta = null;
    this.loaded = true;
  }

  getReport() {
    const groups = buildDuplicateGroups(this.entries.values());
    const duplicateCopies = groups.reduce(
      (sum, group) => sum + group.duplicateCopies,
      0
    );
    const reclaimableBytes = groups.reduce(
      (sum, group) => sum + group.reclaimableBytes,
      0
    );
    const booksScanned = Array.from(this.entries.values()).filter(
      (entry) => entry.isBook
    ).length;
    const fingerprintedBooks = Array.from(this.entries.values()).filter(
      (entry) => entry.isBook && entry.fingerprint
    ).length;

    return {
      groups,
      duplicateCopies,
      reclaimableBytes,
      filesScanned: this.entries.size,
      booksScanned,
      fingerprintedBooks,
      duplicateGroups: groups.length,
      folderErrors: 0,
      foldersScanned: 0,
      fromIndex: true,
      indexMeta: this.getMeta(),
    };
  }

  #buildMeta(rootFolderId, updatedAt, overrides = {}) {
    return {
      schemaVersion: INDEX_SCHEMA_VERSION,
      rootFolderId,
      complete: true,
      builtAt: overrides.builtAt || this.meta?.builtAt || updatedAt,
      updatedAt,
      entryCount:
        overrides.entryCount ?? this.entries.size,
      ...overrides,
    };
  }
}
