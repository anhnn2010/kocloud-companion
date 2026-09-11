import {
  createAvailableBookName,
  normalizeBookName,
} from "../core/book-names.js";
import {
  createConcurrencyLimiter,
} from "../core/concurrency.js";

/**
 * Execute KOCloud imports from a remote source into the library.
 */
export class ImportExecutor {
  /**
   * @param {object} options
   * @param {object} options.source
   * @param {object} options.libraryService
   */
  constructor({ source, libraryService }) {
    this.source = source;
    this.library = libraryService;
  }

  /**
   * Import a Picker selection sequentially.
   *
   * @param {Array<object>} selection
   * @param {string} destinationFolderId
   * @param {string} destinationPath
   * @param {(book: object) => void} onUpdate
   * @returns {Promise<object>}
   */
  async importSelection(
    selection,
    destinationFolderId,
    destinationPath,
    onUpdate = () => {}
  ) {
    const pendingBooks = selection.filter(
      (book) =>
        book.importStatus !== "done" &&
        book.importStatus !== "replaced" &&
        book.importStatus !== "skipped" &&
        book.importStatus !== "blocked"
    );

    const counts = this.#createCounts();

    if (pendingBooks.length === 0) {
      return counts;
    }

    const existingBooks =
      await this.library.listFiles(
        destinationFolderId
      );

    const existingByName =
      this.#buildNameMap(existingBooks);

    for (const book of pendingBooks) {
      const normalizedName =
        normalizeBookName(book.name);

      const cloudExisting =
        existingByName.get(normalizedName) ||
        null;

      book.existingFile = cloudExisting;

      if (
        cloudExisting &&
        book.duplicateAction === "skip"
      ) {
        book.importStatus = "skipped";
        book.importMessage =
          "Skipped · already exists";
        counts.skipped += 1;
        onUpdate(book);
        continue;
      }

      book.importStatus = "checking";
      book.importMessage = "";
      onUpdate(book);

      try {
        const sourceFile =
          await this.source.getFile(book.id);

        book.name = sourceFile.name || book.name;
        book.mimeType =
          sourceFile.mimeType || book.mimeType;

        if (!sourceFile.capabilities?.canCopy) {
          book.importStatus = "blocked";
          book.importMessage =
            "Owner or administrator does not allow copying.";
          counts.blocked += 1;
          onUpdate(book);
          continue;
        }

        const refreshedName =
          normalizeBookName(book.name);

        const refreshedExisting =
          existingByName.get(refreshedName) ||
          cloudExisting;

        if (
          refreshedExisting &&
          book.duplicateAction === "skip"
        ) {
          book.importStatus = "skipped";
          book.importMessage =
            "Skipped · already exists";
          counts.skipped += 1;
          onUpdate(book);
          continue;
        }

        const isReplace =
          Boolean(refreshedExisting) &&
          book.duplicateAction === "replace";

        const isKeepBoth =
          Boolean(refreshedExisting) &&
          book.duplicateAction === "keep-both";

        let driveName = book.name;

        if (isKeepBoth) {
          driveName = createAvailableBookName(
            book.name,
            existingByName
          );
        }

        book.importStatus = "importing";
        book.importMessage = isReplace
          ? "Copying replacement in Google Drive…"
          : "Copying directly in Google Drive…";
        onUpdate(book);

        const copiedFile =
          await this.source.copyFile(
            book.id,
            destinationFolderId,
            driveName
          );

        if (isReplace) {
          await this.#replaceExisting(
            refreshedExisting,
            copiedFile
          );

          book.importStatus = "replaced";
          book.importMessage =
            "Replaced · old copy moved to Trash";
          book.existingFile = copiedFile;
          counts.replaced += 1;

          existingByName.set(
            refreshedName,
            copiedFile
          );
        } else {
          book.importStatus = "done";
          book.importMessage =
            driveName === book.name
              ? `Imported to ${destinationPath}`
              : `Imported as ${driveName} in ${destinationPath}`;
          counts.imported += 1;

          existingByName.set(
            normalizeBookName(driveName),
            copiedFile
          );
        }
      } catch (error) {
        book.importStatus = "error";
        book.importMessage = getErrorMessage(error);
        counts.failed += 1;
      }

      onUpdate(book);
    }

    return counts;
  }

  /**
   * Recursively discover and import a source folder in one pass.
   *
   * Unlike the legacy preview flow, this method does not build a complete
   * source tree or scan the whole destination before copying. Each source
   * folder is listed once, its matching destination folder is resolved
   * lazily, and files are handled immediately according to the global
   * duplicate policy.
   *
   * @param {object} plan
   * @param {{id: string, name: string}} plan.sourceFolder
   * @param {string} plan.destinationFolderId
   * @param {string} plan.destinationPath
   * @param {"skip"|"replace"|"keep-both"} duplicatePolicy
   * @param {object} options
   * @param {AbortSignal} [options.signal]
   * @param {(progress: object) => void} [options.onProgress]
   * @param {number} [options.maxConcurrency]
   * @returns {Promise<object>}
   */
  async importWholeFolderDirect(
    plan,
    duplicatePolicy,
    options = {}
  ) {
    const counts = this.#createCounts();
    const progress = {
      foldersProcessed: 0,
      filesFound: 0,
      booksFound: 0,
      filesProcessed: 0,
      currentPath: plan.sourceFolder?.name || "Source folder",
      startedAt: Date.now(),
    };
    const maxConcurrency = Math.max(
      1,
      Math.floor(Number(options.maxConcurrency) || 4)
    );
    const networkLimiter =
      options.limiter || createConcurrencyLimiter(maxConcurrency);
    const folderLimiter = createConcurrencyLimiter(maxConcurrency);
    const destinationCache = new Map();
    const reporter = this.#createProgressReporter(
      progress,
      counts,
      options.onProgress
    );

    try {
      throwIfAborted(options.signal);

      const destinationParent =
        await this.#getDestinationEntries(
          plan.destinationFolderId,
          destinationCache,
          networkLimiter,
          options.signal
        );

      const destinationRoot =
        await this.#ensureFolderFromEntries(
          plan.destinationFolderId,
          plan.sourceFolder.name,
          destinationParent,
          destinationCache,
          networkLimiter,
          options.signal
        );

      await this.#walkSourceNodeDirect(
        {
          sourceFolder: plan.sourceFolder,
          destinationFolder: destinationRoot,
          path: [],
          ancestorIds: new Set(),
        },
        duplicatePolicy,
        counts,
        progress,
        reporter,
        destinationCache,
        networkLimiter,
        folderLimiter,
        options
      );

      reporter(true);
      return counts;
    } catch (error) {
      reporter(true);

      if (error?.name === "AbortError") {
        error.counts = { ...counts };
        error.progress = { ...progress };
      }

      throw error;
    }
  }

  /**
   * Walk one source subtree while bounding whole-folder work separately from
   * individual Drive requests. Keeping these two queues separate prevents a
   * wide tree from flooding the network limiter with thousands of recursive
   * list/copy operations.
   *
   * @param {object} job
   * @param {string} duplicatePolicy
   * @param {object} counts
   * @param {object} progress
   * @param {(force?: boolean) => void} reporter
   * @param {Map<string, Promise<object>>} destinationCache
   * @param {object} networkLimiter
   * @param {object} folderLimiter
   * @param {object} options
   * @returns {Promise<void>}
   */
  async #walkSourceNodeDirect(
    job,
    duplicatePolicy,
    counts,
    progress,
    reporter,
    destinationCache,
    networkLimiter,
    folderLimiter,
    options
  ) {
    const children = await folderLimiter.run(() =>
      this.#processSourceNodeDirect(
        job,
        duplicatePolicy,
        counts,
        progress,
        reporter,
        destinationCache,
        networkLimiter,
        options
      )
    );

    await Promise.all(
      children.map((childJob) =>
        this.#walkSourceNodeDirect(
          childJob,
          duplicatePolicy,
          counts,
          progress,
          reporter,
          destinationCache,
          networkLimiter,
          folderLimiter,
          options
        )
      )
    );
  }

  /**
   * Process one source folder and return child jobs without recursing while a
   * folder-worker slot is held.
   *
   * @param {object} job
   * @param {string} duplicatePolicy
   * @param {object} counts
   * @param {object} progress
   * @param {(force?: boolean) => void} reporter
   * @param {Map<string, Promise<object>>} destinationCache
   * @param {object} networkLimiter
   * @param {object} options
   * @returns {Promise<Array<object>>}
   */
  async #processSourceNodeDirect(
    job,
    duplicatePolicy,
    counts,
    progress,
    reporter,
    destinationCache,
    networkLimiter,
    options
  ) {
    throwIfAborted(options.signal);

    const {
      sourceFolder,
      path,
      ancestorIds,
    } = job;

    if (ancestorIds.has(sourceFolder.id)) {
      return [];
    }

    const nextAncestorIds = new Set(ancestorIds);
    nextAncestorIds.add(sourceFolder.id);

    const currentPath = [
      ...path,
      sourceFolder.name || "Folder",
    ];

    let destinationFolder = job.destinationFolder;
    let sourceEntries;
    let destinationEntries;

    try {
      if (!destinationFolder) {
        destinationFolder =
          await this.#ensureFolderFromEntries(
            job.destinationParentId,
            sourceFolder.name,
            job.destinationParentEntries,
            destinationCache,
            networkLimiter,
            options.signal
          );
      }

      [sourceEntries, destinationEntries] =
        await Promise.all([
          networkLimiter.run(async () => {
            throwIfAborted(options.signal);
            const entries = await this.source.listEntries(
              sourceFolder.id
            );
            throwIfAborted(options.signal);
            return entries;
          }),
          this.#getDestinationEntries(
            destinationFolder.id,
            destinationCache,
            networkLimiter,
            options.signal
          ),
        ]);
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        isAuthenticationError(error)
      ) {
        throw error;
      }

      console.error(
        "KOCloud direct recursive folder failed:",
        sourceFolder,
        error
      );
      counts.folderFailed += 1;
      progress.currentPath = currentPath.join(" / ");
      reporter(true);
      return [];
    }

    progress.foldersProcessed += 1;
    progress.filesFound += sourceEntries.files.length;
    progress.booksFound += sourceEntries.files.filter(
      (file) => this.source.isBook?.(file) ?? false
    ).length;
    progress.currentPath = currentPath.join(" / ");
    reporter();

    for (const file of sourceEntries.files) {
      throwIfAborted(options.signal);

      try {
        if (file.capabilities?.canCopy === false) {
          counts.blocked += 1;
          progress.filesProcessed += 1;
          reporter();
          continue;
        }

        const key = normalizeBookName(file.name);
        const existing =
          destinationEntries.filesByName.get(key) || null;

        if (existing && duplicatePolicy === "skip") {
          counts.skipped += 1;
          progress.filesProcessed += 1;
          reporter();
          continue;
        }

        const isReplace =
          Boolean(existing) && duplicatePolicy === "replace";
        const isKeepBoth =
          Boolean(existing) && duplicatePolicy === "keep-both";

        let driveName = file.name;

        if (isKeepBoth) {
          driveName = createAvailableBookName(
            file.name,
            destinationEntries.filesByName
          );
        }

        // Keep copy + replacement cleanup in the same network slot. If the
        // copy completes, the old-file Trash request must not be queued behind
        // thousands of unrelated recursive operations.
        const copied = await networkLimiter.run(async () => {
          throwIfAborted(options.signal);
          const newCopy = await this.source.copyFile(
            file.id,
            destinationFolder.id,
            driveName
          );

          if (isReplace) {
            await this.#replaceExistingInCurrentSlot(
              existing,
              newCopy
            );
          }

          return newCopy;
        });

        if (isReplace) {
          counts.replaced += 1;
          destinationEntries.filesByName.set(key, copied);
        } else {
          counts.imported += 1;
          destinationEntries.filesByName.set(
            normalizeBookName(driveName),
            copied
          );
        }
      } catch (error) {
        if (
          error?.name === "AbortError" ||
          isAuthenticationError(error)
        ) {
          throw error;
        }

        console.error(
          "KOCloud direct recursive import failed:",
          file,
          error
        );
        counts.failed += 1;
      }

      progress.filesProcessed += 1;
      reporter();
    }

    return sourceEntries.folders.map((childFolder) => ({
      sourceFolder: childFolder,
      destinationFolder: null,
      destinationParentId: destinationFolder.id,
      destinationParentEntries: destinationEntries,
      path: currentPath,
      ancestorIds: nextAncestorIds,
    }));
  }

  /**
   * Load one destination folder once per direct-import run.
   *
   * @param {string} folderId
   * @param {Map<string, Promise<object>>} cache
   * @param {object} limiter
   * @param {AbortSignal|undefined} signal
   * @returns {Promise<object>}
   */
  async #getDestinationEntries(
    folderId,
    cache,
    limiter,
    signal
  ) {
    if (!cache.has(folderId)) {
      cache.set(
        folderId,
        limiter.run(async () => {
          throwIfAborted(signal);
          const entries =
            typeof this.library.listEntries === "function"
              ? await this.library.listEntries(folderId)
              : {
                  folders: await this.library.listFolders(folderId),
                  files: await this.library.listFiles(folderId),
                };
          throwIfAborted(signal);

          return {
            foldersByName: this.#buildNameMap(entries.folders),
            filesByName: this.#buildNameMap(entries.files),
          };
        })
      );
    }

    return cache.get(folderId);
  }

  /**
   * Reuse or lazily create one destination child folder.
   *
   * @param {string} parentFolderId
   * @param {string} name
   * @param {object} parentEntries
   * @param {Map<string, Promise<object>>} cache
   * @param {object} limiter
   * @param {AbortSignal|undefined} signal
   * @returns {Promise<object>}
   */
  async #ensureFolderFromEntries(
    parentFolderId,
    name,
    parentEntries,
    cache,
    limiter,
    signal
  ) {
    const key = normalizeBookName(name);
    const existing = parentEntries.foldersByName.get(key);

    if (existing) {
      return existing;
    }

    const created = await limiter.run(async () => {
      throwIfAborted(signal);
      return this.library.createFolder(parentFolderId, name);
    });

    parentEntries.foldersByName.set(key, created);

    // A folder created by this import is known to be empty. Seed the cache so
    // its first source node does not trigger an unnecessary Drive listing.
    cache.set(
      created.id,
      Promise.resolve({
        foldersByName: new Map(),
        filesByName: new Map(),
      })
    );

    return created;
  }

  /**
   * Finish a replacement while the caller still owns its network slot.
   *
   * Keeping copy -> trash together prevents replacement cleanup from being
   * starved behind a large FIFO queue produced by recursive folder traversal.
   */
  async #replaceExistingInCurrentSlot(existing, copied) {
    try {
      await this.source.trashFile(existing.id);
    } catch (replaceError) {
      try {
        await this.source.trashFile(copied.id);
      } catch {
        // Keep the original replacement error below.
      }

      throw new Error(
        "Replacement copy was created, but the old book " +
          "could not be moved to Trash: " +
          getErrorMessage(replaceError)
      );
    }
  }

  /**
   * Throttle UI-facing progress updates while keeping counters exact.
   */
  #createProgressReporter(
    progress,
    counts,
    onProgress = () => {}
  ) {
    let lastReportAt = 0;
    let lastProcessed = -1;

    return (force = false) => {
      const now = Date.now();
      const enoughFiles =
        progress.filesProcessed - lastProcessed >= 10;
      const enoughTime = now - lastReportAt >= 250;

      if (!force && !enoughFiles && !enoughTime) {
        return;
      }

      lastReportAt = now;
      lastProcessed = progress.filesProcessed;
      onProgress({
        ...progress,
        ...counts,
      });
    };
  }

  /**
   * Import one recursively-scanned source tree.
   *
   * @param {object} plan
   * @param {"skip"|"replace"|"keep-both"} duplicatePolicy
   * @returns {Promise<object>}
   */
  async importWholeFolder(
    plan,
    duplicatePolicy
  ) {
    const counts = this.#createCounts();

    await this.#importTreeNode(
      plan.tree,
      plan.destinationFolderId,
      duplicatePolicy,
      counts
    );

    return counts;
  }

  /**
   * @param {object} node
   * @param {string} destinationParentId
   * @param {string} duplicatePolicy
   * @param {object} counts
   */
  async #importTreeNode(
    node,
    destinationParentId,
    duplicatePolicy,
    counts
  ) {
    const totalFiles =
      node.fileCount ??
      node.bookCount ??
      node.files?.length ??
      0;

    if (totalFiles === 0 || node.cycle) {
      return;
    }

    const destinationFolder =
      await this.#ensureFolder(
        destinationParentId,
        node.name
      );

    const destinationFiles =
      await this.library.listFiles(
        destinationFolder.id
      );

    const existingByName =
      this.#buildNameMap(destinationFiles);

    for (const file of node.files) {
      try {
        const sourceFile =
          await this.source.getFile(file.id);

        if (!sourceFile.capabilities?.canCopy) {
          counts.blocked += 1;
          continue;
        }

        const sourceName =
          sourceFile.name || file.name;

        const key =
          normalizeBookName(sourceName);

        const existing =
          existingByName.get(key) || null;

        if (
          existing &&
          duplicatePolicy === "skip"
        ) {
          counts.skipped += 1;
          continue;
        }

        const isReplace =
          Boolean(existing) &&
          duplicatePolicy === "replace";

        const isKeepBoth =
          Boolean(existing) &&
          duplicatePolicy === "keep-both";

        let driveName = sourceName;

        if (isKeepBoth) {
          driveName = createAvailableBookName(
            sourceName,
            existingByName
          );
        }

        const copied =
          await this.source.copyFile(
            file.id,
            destinationFolder.id,
            driveName
          );

        if (isReplace) {
          await this.#replaceExisting(
            existing,
            copied
          );

          counts.replaced += 1;
          existingByName.set(key, copied);
        } else {
          counts.imported += 1;
          existingByName.set(
            normalizeBookName(driveName),
            copied
          );
        }
      } catch (error) {
        console.error(
          "KOCloud recursive import failed:",
          file,
          error
        );
        counts.failed += 1;
      }
    }

    for (const child of node.children) {
      await this.#importTreeNode(
        child,
        destinationFolder.id,
        duplicatePolicy,
        counts
      );
    }
  }

  /**
   * @param {string} parentFolderId
   * @param {string} name
   * @returns {Promise<object>}
   */
  async #ensureFolder(parentFolderId, name) {
    const children =
      await this.library.listFolders(
        parentFolderId
      );

    const key = normalizeBookName(name);

    const existing = children.find(
      (folder) =>
        normalizeBookName(folder.name) === key
    );

    if (existing) {
      return existing;
    }

    return this.library.createFolder(
      parentFolderId,
      name
    );
  }

  /**
   * Preserve the old file if trashing it fails after the replacement copy.
   *
   * @param {object} existing
   * @param {object} copied
   */
  async #replaceExisting(existing, copied) {
    try {
      await this.source.trashFile(existing.id);
    } catch (replaceError) {
      try {
        await this.source.trashFile(copied.id);
      } catch {
        // Keep the original replacement error below.
      }

      throw new Error(
        "Replacement copy was created, but the old book " +
          "could not be moved to Trash: " +
          getErrorMessage(replaceError)
      );
    }
  }

  /**
   * @param {Array<object>} files
   * @returns {Map<string, object>}
   */
  #buildNameMap(files) {
    const result = new Map();

    for (const file of files) {
      const key = normalizeBookName(file.name);

      if (!result.has(key)) {
        result.set(key, file);
      }
    }

    return result;
  }

  /**
   * @returns {object}
   */
  #createCounts() {
    return {
      imported: 0,
      replaced: 0,
      skipped: 0,
      blocked: 0,
      failed: 0,
      folderFailed: 0,
    };
  }
}

/**
 * Throw a conventional AbortError at safe request/file boundaries.
 *
 * @param {AbortSignal|undefined} signal
 */
function isAuthenticationError(error) {
  return (
    error?.code === "GOOGLE_AUTH_REQUIRED" ||
    error?.status === 401
  );
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("Import cancelled.");
  error.name = "AbortError";
  throw error;
}

/**
 * Return a concise message from an unknown thrown value.
 *
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
