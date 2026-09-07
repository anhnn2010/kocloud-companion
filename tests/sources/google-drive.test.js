import test from "node:test";
import assert from "node:assert/strict";
import {
  GoogleDriveImportSource,
} from "../../src/imports/sources/google-drive.js";

test("Drive source recursively preserves all files and counts recognized books", async () => {
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
  assert.equal(tree.fileCount, 3);
  assert.equal(tree.bookCount, 2);
  assert.equal(tree.files.length, 2);
  assert.equal(tree.files[1].name, "bad.exe");
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
  assert.equal(tree.fileCount, 0);
  assert.equal(tree.bookCount, 0);
});

test("Drive source reports recursive scan progress", async () => {
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
  const source = new GoogleDriveImportSource({
    driveApi: {
      async listChildFolders(_token, folderId) {
        return foldersByParent.get(folderId) || [];
      },
      async listBooksInFolder(_token, folderId) {
        return filesByParent.get(folderId) || [];
      },
    },
    getAccessToken: () => "token",
    isSupportedBook: (file) =>
      /\.(?:epub|pdf)$/i.test(file.name),
  });
  const updates = [];

  await source.scanTree(
    { id: "root", name: "Root" },
    new Set(),
    {
      onProgress(progress) {
        updates.push(progress);
      },
    }
  );

  assert.equal(updates.length, 2);
  assert.deepEqual(updates.at(-1), {
    foldersScanned: 2,
    filesScanned: 3,
    booksFound: 2,
    currentPath: "Root / Child",
  });
});

test("Drive source scan can be cancelled", async () => {
  const controller = new AbortController();
  const source = new GoogleDriveImportSource({
    driveApi: {
      async listChildFolders() {
        return [{ id: "child", name: "Child" }];
      },
      async listBooksInFolder() {
        return [];
      },
    },
    getAccessToken: () => "token",
    isSupportedBook: () => true,
  });

  await assert.rejects(
    source.scanTree(
      { id: "root", name: "Root" },
      new Set(),
      {
        signal: controller.signal,
        onProgress() {
          controller.abort();
        },
      }
    ),
    (error) => error.name === "AbortError"
  );
});

test("Drive source bounds concurrent recursive folder scans", async () => {
  const entriesByParent = new Map([
    [
      "root",
      {
        folders: [1, 2, 3, 4, 5, 6].map((number) => ({
          id: `child-${number}`,
          name: `Child ${number}`,
        })),
        files: [],
      },
    ],
  ]);
  let active = 0;
  let maxActive = 0;

  const source = new GoogleDriveImportSource({
    driveApi: {
      async listFolderEntries(_token, folderId) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return entriesByParent.get(folderId) || {
          folders: [],
          files: [],
        };
      },
    },
    getAccessToken: () => "token",
    isSupportedBook: () => true,
  });

  const tree = await source.scanTree(
    { id: "root", name: "Root" },
    new Set(),
    { maxConcurrency: 4 }
  );

  assert.equal(tree.folderCount, 7);
  assert.equal(maxActive, 4);
});


test("Drive source copies recognized and other files with correct role intent", async () => {
  const calls = [];
  const source = new GoogleDriveImportSource({
    driveApi: {
      async copyBookToFolder(...args) {
        calls.push(args);
        return { id: `copy-${calls.length}` };
      },
    },
    getAccessToken: () => "token",
    isSupportedBook: (file) => /\.epub$/i.test(file.name),
  });

  await source.copyFile("book", "dest", "Book.epub");
  await source.copyFile("cover", "dest", "cover.jpg");

  assert.equal(calls[0][4].isBook, true);
  assert.equal(calls[1][4].isBook, false);
});
