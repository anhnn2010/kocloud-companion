import {
  normalizeBookName,
} from "../core/book-names.js";
import {
  createConcurrencyLimiter,
} from "../core/concurrency.js";

/**
 * Plan KOCloud library imports without performing remote mutations.
 */
export class ImportPlanner {
  /**
   * @param {object} options
   * @param {object} options.libraryService
   */
  constructor({ libraryService }) {
    this.library = libraryService;
  }

  /**
   * Initialize Picker-selected files for import preview.
   *
   * @param {Array<object>} books
   * @returns {Array<object>}
   */
  createSelection(books) {
    return books.map((book) => ({
      ...book,
      importStatus: "selected",
      importMessage: "",
      duplicateAction: "skip",
      existingFile: null,
    }));
  }

  /**
   * Recompute destination/selection duplicates for selected files.
   *
   * @param {Array<object>} selection
   * @param {string} destinationFolderId
   * @returns {Promise<number>}
   */
  async refreshSelectionDuplicates(
    selection,
    destinationFolderId
  ) {
    const existingBooks =
      await this.library.listFiles(
        destinationFolderId
      );

    const existingByName = new Map();

    for (const existingBook of existingBooks) {
      const key =
        normalizeBookName(existingBook.name);

      if (!existingByName.has(key)) {
        existingByName.set(key, existingBook);
      }
    }

    const seenSelectionNames = new Set();
    let duplicateCount = 0;

    for (const book of selection) {
      if (
        book.importStatus === "done" ||
        book.importStatus === "replaced"
      ) {
        continue;
      }

      const key = normalizeBookName(book.name);
      const existingFile =
        existingByName.get(key) || null;
      const duplicateInSelection =
        seenSelectionNames.has(key);

      if (existingFile || duplicateInSelection) {
        book.existingFile = existingFile;
        book.importStatus = "duplicate";
        book.importMessage = "";

        if (
          book.duplicateAction !== "replace" &&
          book.duplicateAction !== "keep-both"
        ) {
          book.duplicateAction = "skip";
        }

        duplicateCount += 1;
      } else {
        book.existingFile = null;
        book.importStatus = "selected";
        book.importMessage = "";
        book.duplicateAction = "skip";
      }

      seenSelectionNames.add(key);
    }

    return duplicateCount;
  }

  /**
   * Build a whole-folder import plan and annotate duplicate preview state.
   *
   * @param {object} tree
   * @param {string} sourceFolderId
   * @param {string} destinationFolderId
   * @param {string} destinationPath
   * @returns {Promise<object>}
   */
  async createWholeFolderPlan(
    tree,
    sourceFolderId,
    destinationFolderId,
    destinationPath,
    options = {}
  ) {
    const progress = {
      checkedFolders: 0,
      totalFolders: tree.folderCount || 1,
      currentPath: "",
    };

    const limiter =
      options.limiter ||
      createConcurrencyLimiter(
        options.maxConcurrency || 4
      );

    const duplicateCount =
      await this.#countWholeFolderDuplicates(
        tree,
        destinationFolderId,
        {
          ...options,
          progress,
          path: [],
          limiter,
        }
      );

    return {
      tree,
      sourceFolderId,
      destinationFolderId,
      destinationPath,
      duplicateCount,
    };
  }

  /**
   * Re-plan an existing source tree for a new destination.
   *
   * @param {object} plan
   * @param {string} destinationFolderId
   * @param {string} destinationPath
   * @returns {Promise<object>}
   */
  async refreshWholeFolderPlan(
    plan,
    destinationFolderId,
    destinationPath,
    options = {}
  ) {
    return this.createWholeFolderPlan(
      plan.tree,
      plan.sourceFolderId,
      destinationFolderId,
      destinationPath,
      options
    );
  }

  /**
   * @param {object} node
   * @param {string} destinationParentId
   * @returns {Promise<number>}
   */
  async #countWholeFolderDuplicates(
    node,
    destinationParentId,
    options = {}
  ) {
    this.#clearDuplicateMarks(node);
    throwIfAborted(options.signal);

    const destinationEntries =
      await options.limiter.run(() =>
        this.#listEntries(destinationParentId)
      );

    throwIfAborted(options.signal);

    const destinationFolder =
      this.#findFolderByName(
        destinationEntries.folders,
        node.name
      );

    if (!destinationFolder) {
      return this.#markInternalDuplicates(
        node,
        options
      );
    }

    return this.#markAgainstDestination(
      node,
      destinationFolder.id,
      options
    );
  }

  /**
   * @param {Array<object>} folders
   * @param {string} name
   * @returns {object|null}
   */
  #findFolderByName(folders, name) {
    const key = normalizeBookName(name);

    return (
      folders.find(
        (folder) =>
          normalizeBookName(folder.name) === key
      ) || null
    );
  }

  /**
   * @param {object} node
   */
  #clearDuplicateMarks(node) {
    for (const file of node.files) {
      file.previewDuplicate = false;
    }

    for (const child of node.children) {
      this.#clearDuplicateMarks(child);
    }
  }

  /**
   * @param {object} node
   * @returns {number}
   */
  #markInternalDuplicates(node, options = {}) {
    throwIfAborted(options.signal);

    let duplicateCount = 0;
    const names = new Set();

    this.#reportDuplicateProgress(node, options);

    for (const file of node.files) {
      const key = normalizeBookName(file.name);

      if (names.has(key)) {
        file.previewDuplicate = true;
        duplicateCount += 1;
      } else {
        names.add(key);
      }
    }

    for (const child of node.children) {
      duplicateCount +=
        this.#markInternalDuplicates(
          child,
          this.#childOptions(options, node)
        );
    }

    return duplicateCount;
  }

  /**
   * @param {object} node
   * @param {string} destinationFolderId
   * @returns {Promise<number>}
   */
  async #markAgainstDestination(
    node,
    destinationFolderId,
    options = {}
  ) {
    throwIfAborted(options.signal);

    const destinationEntries =
      await options.limiter.run(() =>
        this.#listEntries(destinationFolderId)
      );

    throwIfAborted(options.signal);

    this.#reportDuplicateProgress(node, options);

    const destinationNames = new Set(
      destinationEntries.files.map((file) =>
        normalizeBookName(file.name)
      )
    );

    const sourceNames = new Set();
    let duplicateCount = 0;

    for (const file of node.files) {
      const key = normalizeBookName(file.name);
      const isDuplicate =
        destinationNames.has(key) ||
        sourceNames.has(key);

      file.previewDuplicate = isDuplicate;

      if (isDuplicate) {
        duplicateCount += 1;
      }

      sourceNames.add(key);
    }

    const childCounts = await Promise.all(
      node.children.map(async (child) => {
        const destinationChild =
          this.#findFolderByName(
            destinationEntries.folders,
            child.name
          );

        if (destinationChild) {
          return this.#markAgainstDestination(
            child,
            destinationChild.id,
            this.#childOptions(options, node)
          );
        }

        return this.#markInternalDuplicates(
          child,
          this.#childOptions(options, node)
        );
      })
    );

    return childCounts.reduce(
      (total, count) => total + count,
      duplicateCount
    );
  }

  /**
   * List direct destination entries in one provider call when supported.
   *
   * @param {string} folderId
   * @returns {Promise<{folders: Array<object>, files: Array<object>}>}
   */
  async #listEntries(folderId) {
    if (typeof this.library.listEntries === "function") {
      return this.library.listEntries(folderId);
    }

    const [folders, files] = await Promise.all([
      this.library.listFolders(folderId),
      this.library.listFiles(folderId),
    ]);

    return { folders, files };
  }

  /**
   * Advance duplicate-analysis progress for one source-tree node.
   *
   * @param {object} node
   * @param {object} options
   */
  #reportDuplicateProgress(node, options) {
    const progress = options.progress;

    if (!progress) {
      return;
    }

    progress.checkedFolders += 1;
    progress.currentPath = [
      ...(options.path || []),
      node.name || "Folder",
    ].join(" / ");

    options.onProgress?.({ ...progress });
  }

  /**
   * Build recursion options while preserving shared progress/cancellation.
   *
   * @param {object} options
   * @param {object} node
   * @returns {object}
   */
  #childOptions(options, node) {
    return {
      ...options,
      path: [
        ...(options.path || []),
        node.name || "Folder",
      ],
    };
  }

}


/**
 * @param {AbortSignal|null|undefined} signal
 */
function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("Scan cancelled.");
  error.name = "AbortError";
  throw error;
}
