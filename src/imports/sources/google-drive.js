import {
  createConcurrencyLimiter,
} from "../../core/concurrency.js";

/**
 * Google Drive import-source adapter.
 *
 * This module owns source-side Drive operations used by KOCloud imports.
 * Library/destination operations remain behind LibraryService.
 */
export class GoogleDriveImportSource {
  /**
   * @param {object} options
   * @param {object} options.driveApi
   * @param {() => string|null} options.getAccessToken
   * @param {(file: object) => boolean} options.isSupportedBook
   */
  constructor({
    driveApi,
    getAccessToken,
    isSupportedBook,
  }) {
    this.driveApi = driveApi;
    this.getAccessToken = getAccessToken;
    this.isSupportedBook = isSupportedBook;
  }

  /**
   * List direct child folders under one Drive folder.
   *
   * @param {string} folderId
   * @returns {Promise<Array<object>>}
   */
  async listFolders(folderId) {
    return this.driveApi.listChildFolders(
      this.#requireAccessToken(),
      folderId
    );
  }

  /**
   * List all direct non-folder files under one Drive folder.
   *
   * @param {string} folderId
   * @returns {Promise<Array<object>>}
   */
  async listFiles(folderId) {
    return this.driveApi.listBooksInFolder(
      this.#requireAccessToken(),
      folderId
    );
  }


  /**
   * List direct folders and files with one Drive traversal when available.
   *
   * @param {string} folderId
   * @returns {Promise<{folders: Array<object>, files: Array<object>}>}
   */
  async listEntries(folderId) {
    if (
      typeof this.driveApi.listFolderEntries ===
      "function"
    ) {
      return this.driveApi.listFolderEntries(
        this.#requireAccessToken(),
        folderId
      );
    }

    const [files, folders] = await Promise.all([
      this.listFiles(folderId),
      this.listFolders(folderId),
    ]);

    return { folders, files };
  }

  /**
   * List recognized KOReader book files directly under one Drive folder.
   *
   * @param {string} folderId
   * @returns {Promise<Array<object>>}
   */
  async listBooks(folderId) {
    const files = await this.listFiles(folderId);

    return files.filter((file) =>
      this.isSupportedBook(file)
    );
  }

  /**
   * Return whether one source file is a recognized KOReader book.
   * Recognition is informational for folder imports; all files are preserved.
   *
   * @param {{name: string}} file
   * @returns {boolean}
   */
  isBook(file) {
    return this.isSupportedBook(file);
  }

  /**
   * Read current metadata and copy capability for one source file.
   *
   * @param {string} fileId
   * @returns {Promise<object>}
   */
  async getFile(fileId) {
    return this.driveApi.getImportSource(
      this.#requireAccessToken(),
      fileId
    );
  }

  /**
   * Copy one source file directly into a KOCloud destination folder.
   *
   * @param {string} fileId
   * @param {string} destinationFolderId
   * @param {string} driveName
   * @returns {Promise<object>}
   */
  async copyFile(
    fileId,
    destinationFolderId,
    driveName
  ) {
    return this.driveApi.copyBookToFolder(
      this.#requireAccessToken(),
      fileId,
      destinationFolderId,
      driveName,
      {
        isBook: this.isSupportedBook({
          name: driveName,
        }),
      }
    );
  }

  /**
   * Move one Drive file to Trash.
   *
   * @param {string} fileId
   * @returns {Promise<object>}
   */
  async trashFile(fileId) {
    return this.driveApi.trashFile(
      this.#requireAccessToken(),
      fileId
    );
  }

  /**
   * Recursively scan a source folder into a provider-neutral tree.
   *
   * The callback reports monotonic counts as folders are discovered. The
   * overall folder count is intentionally unknown until traversal completes,
   * so the UI can show meaningful activity without inventing a percentage.
   *
   * @param {{id: string, name: string}} folder
   * @param {Set<string>} ancestorIds
   * @param {{
   *   signal?: AbortSignal,
   *   onProgress?: (progress: object) => void,
   *   path?: Array<string>,
   *   progress?: object
   * }} options
   * @returns {Promise<object>}
   */
  async scanTree(
    folder,
    ancestorIds = new Set(),
    options = {}
  ) {
    const signal = options.signal || null;
    const onProgress =
      options.onProgress || (() => {});
    const path = options.path || [];
    const progress = options.progress || {
      foldersScanned: 0,
      filesScanned: 0,
      booksFound: 0,
      currentPath: "",
    };
    const limiter =
      options.limiter ||
      createConcurrencyLimiter(
        options.maxConcurrency || 4
      );

    throwIfAborted(signal);

    const currentId = folder.id;
    const currentPath = [
      ...path,
      folder.name || "Folder",
    ];

    if (ancestorIds.has(currentId)) {
      return {
        id: currentId,
        name: folder.name,
        files: [],
        children: [],
        folderCount: 1,
        fileCount: 0,
        bookCount: 0,
        isShortcut: Boolean(folder.isShortcut),
        cycle: true,
      };
    }

    const nextAncestorIds =
      new Set(ancestorIds);

    nextAncestorIds.add(currentId);

    const { files: allFiles, folders: childFolders } =
      await limiter.run(async () => {
        throwIfAborted(signal);
        const entries =
          await this.listEntries(currentId);
        throwIfAborted(signal);
        return entries;
      });

    const recognizedBooks = allFiles.filter((file) =>
      this.isSupportedBook(file)
    );

    // Preserve every non-folder file in the recursive import tree. Extension
    // recognition is informational only; the KOReader plugin decides which
    // files are readable when browsing the library.
    const files = allFiles;

    progress.foldersScanned += 1;
    progress.filesScanned += allFiles.length;
    progress.booksFound += recognizedBooks.length;
    progress.currentPath = currentPath.join(" / ");

    onProgress({ ...progress });

    const children = await Promise.all(
      childFolders.map((childFolder) =>
        this.scanTree(
          childFolder,
          nextAncestorIds,
          {
            ...options,
            signal,
            onProgress,
            path: currentPath,
            progress,
            limiter,
          }
        )
      )
    );

    const folderCount =
      1 +
      children.reduce(
        (total, child) =>
          total + child.folderCount,
        0
      );

    const fileCount =
      files.length +
      children.reduce(
        (total, child) =>
          total + (child.fileCount || 0),
        0
      );

    const bookCount =
      recognizedBooks.length +
      children.reduce(
        (total, child) =>
          total + child.bookCount,
        0
      );

    return {
      id: currentId,
      name: folder.name,
      files,
      children,
      folderCount,
      fileCount,
      bookCount,
      isShortcut: Boolean(folder.isShortcut),
      cycle: false,
    };
  }

  /**
   * Return an access token or fail consistently.
   *
   * @returns {string}
   */
  #requireAccessToken() {
    const accessToken = this.getAccessToken();

    if (!accessToken) {
      throw new Error(
        "Google authorization is no longer available. " +
          "Connect Google Drive again."
      );
    }

    return accessToken;
  }
}


/**
 * Throw a conventional AbortError when a caller cancels a recursive scan.
 *
 * @param {AbortSignal|null} signal
 */
function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("Scan cancelled.");
  error.name = "AbortError";
  throw error;
}
