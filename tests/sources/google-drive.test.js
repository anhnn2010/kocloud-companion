import test from "node:test";
import assert from "node:assert/strict";
import {
  GoogleDriveImportSource,
} from "../../src/imports/sources/google-drive.js";

test("Drive source recursively scans supported books", async () => {
  const foldersByParent = new Map([
    ["root", [{ id: "child", name: "Child" }]],
    ["child", []],
  ]);
  const filesByParent = new Map([
    [
      "root",
      [
        { id: "one", name: "One.epub" },
        { id: "bad", name: "bad.exe" },
      ],
    ],
    ["child", [{ id: "two", name: "Two.pdf" }]],
  ]);
  const driveApi = {
    async listChildFolders(_token, folderId) {
      return foldersByParent.get(folderId) || [];
    },
    async listBooksInFolder(_token, folderId) {
      return filesByParent.get(folderId) || [];
    },
  };
  const source = new GoogleDriveImportSource({
    driveApi,
    getAccessToken: () => "token",
    isSupportedBook: (file) =>
      /\.(?:epub|pdf)$/i.test(file.name),
  });

  const tree = await source.scanTree({
    id: "root",
    name: "Root",
  });

  assert.equal(tree.folderCount, 2);
  assert.equal(tree.bookCount, 2);
  assert.equal(tree.files.length, 1);
  assert.equal(tree.children[0].files[0].name, "Two.pdf");
});

test("Drive source breaks shortcut cycles", async () => {
  const source = new GoogleDriveImportSource({
    driveApi: {
      async listChildFolders() {
        return [];
      },
      async listBooksInFolder() {
        return [];
      },
    },
    getAccessToken: () => "token",
    isSupportedBook: () => true,
  });

  const tree = await source.scanTree(
    { id: "same", name: "Loop" },
    new Set(["same"])
  );

  assert.equal(tree.cycle, true);
  assert.equal(tree.bookCount, 0);
});
