import {
  normalizeBookName,
} from "../core/book-names.js";

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
   * Recompute destination/selection duplicates for selected books.
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
    destinationPath
  ) {
    const duplicateCount =
      await this.#countWholeFolderDuplicates(
        tree,
        destinationFolderId
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
    destinationPath
  ) {
    return this.createWholeFolderPlan(
      plan.tree,
      plan.sourceFolderId,
      destinationFolderId,
      destinationPath
    );
  }

  /**
   * @param {object} node
   * @param {string} destinationParentId
   * @returns {Promise<number>}
   */
  async #countWholeFolderDuplicates(
    node,
    destinationParentId
  ) {
    this.#clearDuplicateMarks(node);

    const destinationChildren =
      await this.library.listFolders(
        destinationParentId
      );

    const destinationFolder =
      this.#findFolderByName(
        destinationChildren,
        node.name
      );

    if (!destinationFolder) {
      return this.#markInternalDuplicates(node);
    }

    return this.#markAgainstDestination(
      node,
      destinationFolder.id
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
  #markInternalDuplicates(node) {
    let duplicateCount = 0;
    const names = new Set();

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
        this.#markInternalDuplicates(child);
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
    destinationFolderId
  ) {
    let duplicateCount = 0;

    const destinationFiles =
      await this.library.listFiles(
        destinationFolderId
      );

    const destinationNames = new Set(
      destinationFiles.map((file) =>
        normalizeBookName(file.name)
      )
    );

    const sourceNames = new Set();

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

    const destinationChildren =
      await this.library.listFolders(
        destinationFolderId
      );

    for (const child of node.children) {
      const destinationChild =
        this.#findFolderByName(
          destinationChildren,
          child.name
        );

      if (destinationChild) {
        duplicateCount +=
          await this.#markAgainstDestination(
            child,
            destinationChild.id
          );
      } else {
        duplicateCount +=
          this.#markInternalDuplicates(child);
      }
    }

    return duplicateCount;
  }
}
