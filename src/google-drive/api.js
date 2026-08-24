const DRIVE_FILES_URL =
  "https://www.googleapis.com/drive/v3/files";

const DRIVE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files";

const FOLDER_MIME_TYPE =
  "application/vnd.google-apps.folder";

const ROLE_KEY = "kocloud_role";
const SCHEMA_KEY = "kocloud_schema";
const SCHEMA_VERSION = "1";

/**
 * Escape a value before placing it inside a Google Drive `q` string literal.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeQueryValue(value) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
}

/**
 * Throw an Error containing useful details from a Drive API response.
 *
 * @param {Response} response
 * @param {string} action
 * @returns {Promise<never>}
 */
async function throwDriveError(response, action) {
  let detail = "";

  try {
    const payload = await response.json();
    detail =
      payload?.error?.message ||
      JSON.stringify(payload);
  } catch {
    detail = await response.text();
  }

  throw new Error(
    `${action} failed (${response.status})` +
      (detail ? `: ${detail}` : "")
  );
}

/**
 * Low-level Google Drive API helper used by KOCloud Companion.
 *
 * This class does not own OAuth state. Callers provide the current access
 * token for each operation.
 */
export class GoogleDriveApi {
  /**
   * List Drive files matching a query.
   *
   * @param {string} accessToken
   * @param {string} query
   * @returns {Promise<Array<object>>}
   */
  async listFiles(accessToken, query) {
    const files = [];
    let pageToken = null;

    do {
      const params = new URLSearchParams({
        q: query,
        spaces: "drive",
        pageSize: "100",
        fields:
          "nextPageToken," +
          "files(" +
          "id,name,mimeType,parents,appProperties,size,modifiedTime" +
          ")",
      });

      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const response = await fetch(
        `${DRIVE_FILES_URL}?${params}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        await throwDriveError(
          response,
          "Google Drive list"
        );
      }

      const payload = await response.json();

      files.push(...(payload.files || []));
      pageToken = payload.nextPageToken || null;
    } while (pageToken);

    return files;
  }

  /**
   * Find exactly one KOCloud-managed folder by role.
   *
   * @param {string} accessToken
   * @param {string} role
   * @param {string|null} parentId
   * @returns {Promise<object>}
   */
  async findManagedFolder(
    accessToken,
    role,
    parentId = null
  ) {
    const safeRole = escapeQueryValue(role);

    let query =
      `mimeType='${FOLDER_MIME_TYPE}' ` +
      "and trashed=false " +
      `and appProperties has { key='${ROLE_KEY}' ` +
      `and value='${safeRole}' }`;

    if (parentId) {
      query =
        `'${escapeQueryValue(parentId)}' in parents and ` +
        query;
    }

    const folders = await this.listFiles(
      accessToken,
      query
    );

    if (folders.length === 0) {
      throw new Error(
        `KOCloud managed folder "${role}" was not found. ` +
          "Initialize KOCloud storage from KOReader first."
      );
    }

    if (folders.length > 1) {
      throw new Error(
        `Found ${folders.length} KOCloud managed folders ` +
          `with role "${role}". Refusing to guess which one to use.`
      );
    }

    return folders[0];
  }

  /**
   * Resolve the existing KOCloud root and Books folder.
   *
   * Companion deliberately does not create these folders in V0.1. The
   * KOReader plugin remains the source of truth for storage initialization.
   *
   * @param {string} accessToken
   * @returns {Promise<{root: object, books: object}>}
   */
  async resolveBooksStorage(accessToken) {
    const root = await this.findManagedFolder(
      accessToken,
      "root"
    );

    const books = await this.findManagedFolder(
      accessToken,
      "books",
      root.id
    );

    return {
      root,
      books,
    };
  }

  /**
   * List KOCloud-managed book files in the Books folder.
   *
   * @param {string} accessToken
   * @param {string} booksFolderId
   * @returns {Promise<Array<object>>}
   */
  async listManagedBooks(
    accessToken,
    booksFolderId
  ) {
    const parentId =
      escapeQueryValue(booksFolderId);

    const query =
      `'${parentId}' in parents ` +
      "and trashed=false " +
      `and mimeType!='${FOLDER_MIME_TYPE}'`;

    return this.listFiles(
      accessToken,
      query
    );
  }

  /**
   * Create a resumable upload session for one KOCloud book.
   *
   * The browser will PUT ebook bytes directly to the returned session URL.
   *
   * @param {string} accessToken
   * @param {File} file
   * @param {string} booksFolderId
   * @returns {Promise<string>} resumable session URL
   */
  async createBookUploadSession(
    accessToken,
    file,
    booksFolderId
  ) {
    const metadata = {
      name: file.name,
      parents: [booksFolderId],
      appProperties: {
        [ROLE_KEY]: "book",
        [SCHEMA_KEY]: SCHEMA_VERSION,
        kocloud_source: "web_companion",
      },
    };

    const fields =
      "id,name,parents,appProperties,size,modifiedTime";

    const params = new URLSearchParams({
      uploadType: "resumable",
      fields,
    });

    const response = await fetch(
      `${DRIVE_UPLOAD_URL}?${params}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type":
            "application/json; charset=UTF-8",
          "X-Upload-Content-Type":
            this.getBookMimeType(file),
          "X-Upload-Content-Length":
            String(file.size),
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!response.ok) {
      await throwDriveError(
        response,
        "Create resumable upload session"
      );
    }

    const sessionUrl =
      response.headers.get("Location");

    if (!sessionUrl) {
      throw new Error(
        "Google Drive did not return a resumable upload URL."
      );
    }

    return sessionUrl;
  }

  /**
   * Create a resumable upload session that replaces the content of an
   * existing Google Drive file.
   *
   * The existing file keeps the same Drive file ID and parent folder.
   * Only its media content is replaced.
   *
   * @param {string} accessToken
   * @param {File} file
   * @param {string} existingFileId
   * @returns {Promise<string>} resumable session URL
   */
  async createBookReplaceSession(
    accessToken,
    file,
    existingFileId
  ) {
    const fields =
      "id,name,parents,appProperties,size,modifiedTime";

    const params = new URLSearchParams({
      uploadType: "resumable",
      fields,
    });

    const fileId =
      encodeURIComponent(existingFileId);

    const response = await fetch(
      `${DRIVE_UPLOAD_URL}/${fileId}?${params}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type":
            "application/json; charset=UTF-8",
          "X-Upload-Content-Type":
            this.getBookMimeType(file),
          "X-Upload-Content-Length":
            String(file.size),
        },
        // An empty partial metadata update preserves the existing file's
        // name, parents, and appProperties while replacing only its content.
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      await throwDriveError(
        response,
        "Create resumable replace session"
      );
    }

    const sessionUrl =
      response.headers.get("Location");

    if (!sessionUrl) {
      throw new Error(
        "Google Drive did not return a resumable replace URL."
      );
    }

    return sessionUrl;
  }

  /**
   * Return the MIME type KOCloud should use for an ebook.
   *
   * @param {File} file
   * @returns {string}
   */
  getBookMimeType(file) {
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith(".epub")) {
      return "application/epub+zip";
    }

    if (lowerName.endsWith(".pdf")) {
      return "application/pdf";
    }

    return file.type || "application/octet-stream";
  }

  /**
   * Return whether the file is supported by Companion.
   *
   * @param {File} file
   * @returns {boolean}
   */
  isSupportedBook(file) {
    const lowerName = file.name.toLowerCase();

    return (
      lowerName.endsWith(".epub") ||
      lowerName.endsWith(".pdf")
    );
  }
}

export const googleDriveApi = new GoogleDriveApi();
