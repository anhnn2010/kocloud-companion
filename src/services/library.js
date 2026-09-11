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
   * @param {() => string|null|Promise<string|null>} options.getAccessToken
   * @param {() => string|Promise<string>} [options.refreshAccessToken]
   */
  constructor({
    driveApi,
    getAccessToken,
    refreshAccessToken = null,
  }) {
    this.driveApi = driveApi;
    this.getAccessToken = getAccessToken;
    this.refreshAccessToken = refreshAccessToken;
  }

  async resolveStorage(accessToken = null) {
    return this.#withAccessToken(
      (token) => this.driveApi.resolveBooksStorage(token),
      accessToken
    );
  }

  async listFolders(folderId) {
    return this.#withAccessToken((token) =>
      this.driveApi.listChildFolders(token, folderId)
    );
  }

  async listFiles(folderId) {
    return this.#withAccessToken((token) =>
      this.driveApi.listBooksInFolder(token, folderId)
    );
  }

  async listEntries(folderId) {
    if (typeof this.driveApi.listFolderEntries === "function") {
      return this.#withAccessToken((token) =>
        this.driveApi.listFolderEntries(token, folderId)
      );
    }

    const [folders, files] = await Promise.all([
      this.listFolders(folderId),
      this.listFiles(folderId),
    ]);

    return { folders, files };
  }

  async listManagedBooks(folderId) {
    return this.#withAccessToken((token) =>
      this.driveApi.listManagedBooks(token, folderId)
    );
  }

  async trashFile(fileId) {
    return this.#withAccessToken((token) =>
      this.driveApi.trashFile(token, fileId)
    );
  }

  async listFolder(folderId) {
    const [folders, books] = await Promise.all([
      this.listFolders(folderId),
      this.listManagedBooks(folderId),
    ]);

    return { folders, books };
  }

  async createFolder(parentFolderId, name) {
    return this.#withAccessToken((token) =>
      this.driveApi.createBookFolder(
        token,
        parentFolderId,
        name
      )
    );
  }

  isSupportedBook(file) {
    return this.driveApi.isSupportedBook(file);
  }

  getBookMimeType(file) {
    return this.driveApi.getBookMimeType(file);
  }

  async createUploadSession(
    file,
    destinationFolderId,
    driveName = file.name,
    { isBook = true } = {}
  ) {
    return this.#withAccessToken((token) =>
      this.driveApi.createBookUploadSession(
        token,
        file,
        destinationFolderId,
        driveName,
        { isBook }
      )
    );
  }

  async createReplaceSession(file, existingFileId) {
    return this.#withAccessToken((token) =>
      this.driveApi.createBookReplaceSession(
        token,
        file,
        existingFileId
      )
    );
  }

  async getRegistrationSource(fileId) {
    return this.#withAccessToken((token) =>
      this.driveApi.getBookRegistrationSource(token, fileId)
    );
  }

  async registerExistingBook(
    fileId,
    existingAppProperties = {}
  ) {
    return this.#withAccessToken((token) =>
      this.driveApi.registerExistingBook(
        token,
        fileId,
        existingAppProperties
      )
    );
  }

  /**
   * Run one provider operation with a current token. If Drive rejects the
   * token with 401, refresh once and retry the same operation. This catches
   * revocation/expiry races that can happen between proactive refresh checks
   * and the actual network request.
   */
  async #withAccessToken(operation, explicitToken = null) {
    const token = explicitToken || (await this.getAccessToken());

    if (!token) {
      const authError = new Error(
        "Google authorization is no longer available. " +
          "Connect Google Drive again."
      );
      authError.code = "GOOGLE_AUTH_REQUIRED";
      throw authError;
    }

    try {
      return await operation(token);
    } catch (error) {
      if (
        error?.status !== 401 ||
        typeof this.refreshAccessToken !== "function"
      ) {
        throw error;
      }

      let refreshedToken;
      try {
        refreshedToken = await this.refreshAccessToken();
      } catch (refreshError) {
        refreshError.code =
          refreshError.code || "GOOGLE_AUTH_REQUIRED";
        throw refreshError;
      }

      if (!refreshedToken) {
        const authError = new Error(
          "Google authorization expired. Connect Google Drive again."
        );
        authError.code = "GOOGLE_AUTH_REQUIRED";
        throw authError;
      }

      return operation(refreshedToken);
    }
  }
}
