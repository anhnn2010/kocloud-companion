const DEFAULT_FOLDER_CONCURRENCY = 4;

function normalizeSize(value) {
  const size = Number(value);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function checksumFor(file) {
  if (file?.sha256Checksum) {
    return ["sha256", file.sha256Checksum];
  }
  if (file?.sha1Checksum) {
    return ["sha1", file.sha1Checksum];
  }
  if (file?.md5Checksum) {
    return ["md5", file.md5Checksum];
  }
  return null;
}

/**
 * Build a stable exact-content fingerprint from Drive metadata.
 * Returns null when Drive did not expose a content checksum.
 *
 * @param {object} file
 * @returns {string|null}
 */
export function createExactFingerprint(file) {
  const checksum = checksumFor(file);
  const size = normalizeSize(file?.size);

  if (!checksum || size === null) {
    return null;
  }

  const [algorithm, value] = checksum;
  return `${algorithm}:${value}:${size}`;
}

function joinPath(parentPath, name) {
  return parentPath ? `${parentPath}/${name}` : name;
}

function compactFile(file, path) {
  return {
    id: file.id,
    name: file.name || "Untitled",
    path,
    size: normalizeSize(file.size) ?? 0,
    modifiedTime: file.modifiedTime || "",
    mimeType: file.mimeType || "",
  };
}

function buildGroups(seen) {
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

/**
 * Recursively scan a KOCloud library tree for exact duplicate books.
 *
 * Only recognized book files participate in duplicate grouping. The scanner
 * uses Drive-provided checksums and never downloads book content.
 */
export class DuplicateScanner {
  /**
   * @param {object} options
   * @param {object} options.libraryService
   * @param {number} [options.folderConcurrency]
   */
  constructor({
    libraryService,
    folderConcurrency = DEFAULT_FOLDER_CONCURRENCY,
  }) {
    this.libraryService = libraryService;
    this.folderConcurrency = Math.max(
      1,
      Math.floor(Number(folderConcurrency) || 1)
    );
  }

  /**
   * @param {object} options
   * @param {string} options.rootFolderId
   * @param {string} [options.rootPath]
   * @param {AbortSignal|null} [options.signal]
   * @param {(progress: object) => void} [options.onProgress]
   * @returns {Promise<object>}
   */
  async scan({
    rootFolderId,
    rootPath = "Books",
    signal = null,
    onProgress = () => {},
  }) {
    if (!rootFolderId) {
      throw new Error("A library root folder is required.");
    }

    const startedAt = Date.now();
    const queue = [
      {
        id: rootFolderId,
        path: rootPath,
        isRoot: true,
      },
    ];
    const seen = new Map();
    const visitedFolders = new Set([rootFolderId]);
    let duplicateGroupCount = 0;

    const progress = {
      foldersScanned: 0,
      filesScanned: 0,
      booksScanned: 0,
      fingerprintedBooks: 0,
      duplicateGroups: 0,
      folderErrors: 0,
      currentPath: rootPath,
      elapsedMs: 0,
    };

    let active = 0;
    let settled = false;

    const emitProgress = (currentPath = progress.currentPath) => {
      progress.currentPath = currentPath;
      progress.elapsedMs = Date.now() - startedAt;
      progress.duplicateGroups = duplicateGroupCount;
      onProgress({ ...progress });
    };

    const throwIfAborted = () => {
      if (signal?.aborted) {
        const error = new Error("Duplicate scan cancelled.");
        error.name = "AbortError";
        throw error;
      }
    };

    return new Promise((resolve, reject) => {
      const finishIfDone = () => {
        if (settled || active !== 0 || queue.length !== 0) {
          return;
        }

        settled = true;
        const groups = buildGroups(seen);
        const duplicateCopies = groups.reduce(
          (sum, group) => sum + group.duplicateCopies,
          0
        );
        const reclaimableBytes = groups.reduce(
          (sum, group) => sum + group.reclaimableBytes,
          0
        );

        emitProgress();
        resolve({
          groups,
          duplicateCopies,
          reclaimableBytes,
          ...progress,
        });
      };

      const fail = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      const processFolder = async (folder) => {
        throwIfAborted();
        emitProgress(folder.path);

        let entries;
        try {
          entries = await this.libraryService.listEntries(folder.id);
        } catch (error) {
          if (folder.isRoot) {
            throw error;
          }
          progress.folderErrors += 1;
          emitProgress(folder.path);
          return;
        }

        throwIfAborted();
        progress.foldersScanned += 1;

        for (const file of entries.files || []) {
          progress.filesScanned += 1;

          if (!this.libraryService.isSupportedBook(file)) {
            continue;
          }

          progress.booksScanned += 1;
          const fingerprint = createExactFingerprint(file);
          if (!fingerprint) {
            continue;
          }

          progress.fingerprintedBooks += 1;
          const files = seen.get(fingerprint) || [];
          files.push(
            compactFile(
              file,
              joinPath(folder.path, file.name || "Untitled")
            )
          );
          if (files.length === 2) {
            duplicateGroupCount += 1;
          }
          seen.set(fingerprint, files);
        }

        for (const child of entries.folders || []) {
          if (!child?.id || visitedFolders.has(child.id)) {
            continue;
          }

          visitedFolders.add(child.id);
          queue.push({
            id: child.id,
            path: joinPath(folder.path, child.name || "Folder"),
            isRoot: false,
          });
        }

        emitProgress(folder.path);
      };

      const pump = () => {
        if (settled) {
          return;
        }

        try {
          throwIfAborted();
        } catch (error) {
          fail(error);
          return;
        }

        while (
          !settled &&
          active < this.folderConcurrency &&
          queue.length > 0
        ) {
          const folder = queue.shift();
          active += 1;

          Promise.resolve()
            .then(() => processFolder(folder))
            .catch(fail)
            .finally(() => {
              active -= 1;
              if (!settled) {
                pump();
                finishIfDone();
              }
            });
        }

        finishIfDone();
      };

      emitProgress(rootPath);
      pump();
    });
  }
}
