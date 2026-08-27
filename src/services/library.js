/**
 * KOCloud book-library domain service.
 *
 * UI/workflow code talks to this service instead of depending on the Google
 * Drive API directly for KOCloud/Books operations. Google Drive remains the
 * only storage backend in Companion today, but keeping the domain boundary
 * here makes a later provider adapter possible without rewriting the UI.
 */
export class LibraryService {
  /**
   * @param {object} options
   * @param {object} options.driveApi
   * @param {() => string|null} options.getAccessToken
   */
  constructor({ driveApi, getAccessToken }) {
    this.driveApi = driveApi;
    this.getAccessToken = getAccessToken;
  }

  /**
   * Resolve the existing KOCloud root and Books folder.
   *
   * @param {string|null} accessToken
   * @returns {Promise<{root: object, books: object}>}
   */
  async resolveStorage(accessToken = null) {
    return this.driveApi.resolveBooksStorage(
      this.#requireAccessToken(accessToken)
    );
  }

  /**
   * List direct child folders under one library folder.
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
   * List all direct non-folder files for duplicate detection.
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
   * List KOCloud-managed books in one folder.
   *
   * @param {string} folderId
   * @returns {Promise<Array<object>>}
   */
  async listManagedBooks(folderId) {
    return this.driveApi.listManagedBooks(
      this.#requireAccessToken(),
      folderId
    );
  }

  /**
   * List one KOCloud library folder for browsing.
   *
   * @param {string} folderId
   * @returns {Promise<{folders: Array<object>, books: Array<object>}>}
   */
  async listFolder(folderId) {
    const [folders, books] = await Promise.all([
      this.listFolders(folderId),
      this.listManagedBooks(folderId),
    ]);

    return { folders, books };
  }

  /**
   * Create a child folder inside the KOCloud Books library.
   *
   * @param {string} parentFolderId
   * @param {string} name
   * @returns {Promise<object>}
   */
  async createFolder(parentFolderId, name) {
    return this.driveApi.createBookFolder(
      this.#requireAccessToken(),
      parentFolderId,
      name
    );
  }

  /**
   * Return whether a selected file uses a supported KOReader book format.
   *
   * @param {{name: string}} file
   * @returns {boolean}
   */
  isSupportedBook(file) {
    return this.driveApi.isSupportedBook(file);
  }

  /**
   * Return the MIME type used for uploading one book.
   *
   * @param {File} file
   * @returns {string}
   */
  getBookMimeType(file) {
    return this.driveApi.getBookMimeType(file);
  }

  /**
   * Create a resumable session for a new KOCloud book.
   *
   * @param {File} file
   * @param {string} destinationFolderId
   * @param {string} driveName
   * @returns {Promise<string>}
   */
  async createUploadSession(
    file,
    destinationFolderId,
    driveName = file.name
  ) {
    return this.driveApi.createBookUploadSession(
      this.#requireAccessToken(),
      file,
      destinationFolderId,
      driveName
    );
  }

  /**
   * Create a resumable session that replaces an existing book's content.
   *
   * @param {File} file
   * @param {string} existingFileId
   * @returns {Promise<string>}
   */
  async createReplaceSession(file, existingFileId) {
    return this.driveApi.createBookReplaceSession(
      this.#requireAccessToken(),
      file,
      existingFileId
    );
  }

  /**
   * Read registration metadata for an existing Drive book.
   *
   * Registration is currently hidden in the UI, but keeping this domain
   * operation here prevents legacy code from reaching into Drive API directly.
   *
   * @param {string} fileId
   * @returns {Promise<object>}
   */
  async getRegistrationSource(fileId) {
    return this.driveApi.getBookRegistrationSource(
      this.#requireAccessToken(),
      fileId
    );
  }

  /**
   * Register an existing file as a KOCloud-managed book.
   *
   * @param {string} fileId
   * @param {object} existingAppProperties
   * @returns {Promise<object>}
   */
  async registerExistingBook(
    fileId,
    existingAppProperties = {}
  ) {
    return this.driveApi.registerExistingBook(
      this.#requireAccessToken(),
      fileId,
      existingAppProperties
    );
  }

  /**
   * Return an access token or fail with one consistent service-level error.
   *
   * @param {string|null} explicitToken
   * @returns {string}
   */
  #requireAccessToken(explicitToken = null) {
    const accessToken =
      explicitToken || this.getAccessToken();

    if (!accessToken) {
      throw new Error(
        "Google authorization is no longer available. " +
          "Connect Google Drive again."
      );
    }

    return accessToken;
  }
}
