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
   * List supported book files directly under one Drive folder.
   *
   * @param {string} folderId
   * @returns {Promise<Array<object>>}
   */
  async listBooks(folderId) {
    const files =
      await this.driveApi.listBooksInFolder(
        this.#requireAccessToken(),
        folderId
      );

    return files.filter((file) =>
      this.isSupportedBook(file)
    );
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
      driveName
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
   * @param {{id: string, name: string}} folder
   * @param {Set<string>} ancestorIds
   * @returns {Promise<object>}
   */
  async scanTree(
    folder,
    ancestorIds = new Set()
  ) {
    const currentId = folder.id;

    if (ancestorIds.has(currentId)) {
      return {
        id: currentId,
        name: folder.name,
        files: [],
        children: [],
        folderCount: 1,
        bookCount: 0,
        isShortcut: Boolean(folder.isShortcut),
        cycle: true,
      };
    }

    const nextAncestorIds =
      new Set(ancestorIds);

    nextAncestorIds.add(currentId);

    const [files, childFolders] =
      await Promise.all([
        this.listBooks(currentId),
        this.listFolders(currentId),
      ]);

    const children = [];

    for (const childFolder of childFolders) {
      children.push(
        await this.scanTree(
          childFolder,
          nextAncestorIds
        )
      );
    }

    const folderCount =
      1 +
      children.reduce(
        (total, child) =>
          total + child.folderCount,
        0
      );

    const bookCount =
      files.length +
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
