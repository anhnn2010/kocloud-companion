import {
  createAvailableBookName,
  normalizeBookName,
} from "../core/book-names.js";

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
    if (node.bookCount === 0 || node.cycle) {
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
    };
  }
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
