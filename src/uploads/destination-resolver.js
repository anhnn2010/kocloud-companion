import {
  normalizeBookName,
} from "../core/book-names.js";

/**
 * Resolve/reuse/create KOCloud library folders for local folder uploads.
 *
 * One resolver instance caches folder listings only for the lifetime of a
 * single preflight or upload operation. Callers should create a fresh
 * resolver before an upload batch so cloud state is re-read.
 */
export class UploadDestinationResolver {
  /**
   * @param {{
   *   listFolders: (folderId: string) => Promise<Array<object>>,
   *   createFolder: (folderId: string, name: string) => Promise<object>
   * }} libraryService
   */
  constructor(libraryService) {
    this.library = libraryService;
    this.childrenByParent = new Map();
  }

  /**
   * Resolve a relative directory below a selected destination.
   *
   * @param {string} rootFolderId
   * @param {Array<string>} directoryParts
   * @param {{createMissing?: boolean}} options
   * @returns {Promise<object|null>}
   */
  async resolve(
    rootFolderId,
    directoryParts,
    { createMissing = false } = {}
  ) {
    let current = {
      id: rootFolderId,
      name: "",
    };

    for (const part of directoryParts) {
      const child = await this.#getChild(
        current.id,
        part,
        createMissing
      );

      if (!child) {
        return null;
      }

      current = child;
    }

    return current;
  }

  /**
   * @param {string} parentId
   * @param {string} name
   * @param {boolean} createMissing
   * @returns {Promise<object|null>}
   */
  async #getChild(parentId, name, createMissing) {
    const children = await this.#listChildren(parentId);
    const key = normalizeBookName(name);

    const existing =
      children.find(
        (folder) =>
          normalizeBookName(folder.name) === key
      ) || null;

    if (existing || !createMissing) {
      return existing;
    }

    const created = await this.library.createFolder(
      parentId,
      name
    );

    children.push(created);
    return created;
  }

  /**
   * @param {string} parentId
   * @returns {Promise<Array<object>>}
   */
  async #listChildren(parentId) {
    if (!this.childrenByParent.has(parentId)) {
      const children =
        await this.library.listFolders(parentId);

      this.childrenByParent.set(
        parentId,
        [...children]
      );
    }

    return this.childrenByParent.get(parentId);
  }
}
