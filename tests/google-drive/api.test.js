import test from "node:test";
import assert from "node:assert/strict";
import {
  GoogleDriveApi,
} from "../../src/google-drive/api.js";

test("Drive folder entries use one large-page child listing", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = null;

  globalThis.fetch = async (url) => {
    requestUrl = new URL(url);
    return {
      ok: true,
      async json() {
        return {
          files: [
            {
              id: "folder",
              name: "Folder",
              mimeType: "application/vnd.google-apps.folder",
            },
            {
              id: "shortcut",
              name: "Shortcut Folder",
              mimeType: "application/vnd.google-apps.shortcut",
              shortcutDetails: {
                targetId: "target-folder",
                targetMimeType:
                  "application/vnd.google-apps.folder",
              },
            },
            {
              id: "book",
              name: "Book.epub",
              mimeType: "application/epub+zip",
            },
          ],
        };
      },
    };
  };

  try {
    const api = new GoogleDriveApi();
    const entries = await api.listFolderEntries(
      "token",
      "parent"
    );

    assert.equal(requestUrl.searchParams.get("pageSize"), "1000");
    assert.match(
      requestUrl.searchParams.get("fields"),
      /capabilities\(canCopy\)/
    );
    assert.match(
      requestUrl.searchParams.get("fields"),
      /sha256Checksum/
    );
    assert.match(
      requestUrl.searchParams.get("fields"),
      /md5Checksum/
    );
    assert.match(
      requestUrl.searchParams.get("q"),
      /'parent' in parents/
    );
    assert.equal(entries.files.length, 1);
    assert.equal(entries.files[0].id, "book");
    assert.equal(entries.folders.length, 2);
    assert.equal(entries.folders[0].id, "folder");
    assert.equal(entries.folders[1].id, "target-folder");
    assert.equal(entries.folders[1].isShortcut, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Drive copy omits book role for preserved non-book files", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;

  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { id: "copied", name: requestBody.name };
      },
    };
  };

  try {
    const api = new GoogleDriveApi();
    await api.copyBookToFolder(
      "token",
      "source",
      "destination",
      "cover.jpg",
      { isBook: false }
    );

    assert.equal(requestBody.name, "cover.jpg");
    assert.equal(requestBody.appProperties.kocloud_role, undefined);
    assert.equal(requestBody.appProperties.kocloud_schema, "1");
    assert.equal(requestBody.appProperties.kocloud_source, "drive_import");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Drive listings retry transient rate limits", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        async json() {
          return { error: { message: "rate limited" } };
        },
        async text() {
          return "rate limited";
        },
      };
    }

    return {
      ok: true,
      status: 200,
      async json() {
        return { files: [] };
      },
    };
  };

  try {
    const api = new GoogleDriveApi();
    const entries = await api.listFolderEntries(
      "token",
      "parent"
    );
    assert.equal(calls, 2);
    assert.deepEqual(entries, { folders: [], files: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
