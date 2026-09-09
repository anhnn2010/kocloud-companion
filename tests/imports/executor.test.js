import test from "node:test";
import assert from "node:assert/strict";
import {
  ImportExecutor,
} from "../../src/imports/executor.js";

function createExecutor(existingFiles = []) {
  const copies = [];
  const trashed = [];
  const source = {
    async getFile(id) {
      return {
        id,
        name: id === "source-2" ? "Dune.epub" : "New.epub",
        capabilities: { canCopy: true },
      };
    },
    async copyFile(id, folderId, name) {
      const copy = {
        id: `copy-${copies.length + 1}`,
        name,
        folderId,
        sourceId: id,
      };
      copies.push(copy);
      return copy;
    },
    async trashFile(id) {
      trashed.push(id);
      return { id };
    },
  };
  const library = {
    async listFiles() {
      return existingFiles;
    },
    async listFolders() {
      return [];
    },
    async createFolder(parentId, name) {
      return { id: `${parentId}/${name}`, name };
    },
  };

  return {
    executor: new ImportExecutor({
      source,
      libraryService: library,
    }),
    copies,
    trashed,
  };
}

test("selection executor supports keep-both", async () => {
  const { executor, copies } = createExecutor([
    { id: "old", name: "Dune.epub" },
  ]);
  const selection = [
    {
      id: "source-2",
      name: "Dune.epub",
      importStatus: "duplicate",
      duplicateAction: "keep-both",
    },
  ];

  const counts = await executor.importSelection(
    selection,
    "destination",
    "KOCloud/Books"
  );

  assert.equal(counts.imported, 1);
  assert.equal(copies[0].name, "Dune (1).epub");
  assert.equal(selection[0].importStatus, "done");
});

test("selection executor replaces by trashing old copy", async () => {
  const { executor, trashed } = createExecutor([
    { id: "old", name: "Dune.epub" },
  ]);
  const selection = [
    {
      id: "source-2",
      name: "Dune.epub",
      importStatus: "duplicate",
      duplicateAction: "replace",
    },
  ];

  const counts = await executor.importSelection(
    selection,
    "destination",
    "KOCloud/Books"
  );

  assert.equal(counts.replaced, 1);
  assert.deepEqual(trashed, ["old"]);
  assert.equal(selection[0].importStatus, "replaced");
});


test("whole-folder executor imports non-book files preserved by the scan", async () => {
  const copies = [];
  const executor = new ImportExecutor({
    source: {
      async getFile(id) {
        return {
          id,
          name: "cover.jpg",
          capabilities: { canCopy: true },
        };
      },
      async copyFile(id, folderId, name) {
        copies.push({ id, folderId, name });
        return { id: "copy-cover", name };
      },
      async trashFile() {},
    },
    libraryService: {
      async listFiles() { return []; },
      async listFolders() { return []; },
      async createFolder(parentId, name) {
        return { id: `${parentId}/${name}`, name };
      },
    },
  });

  const counts = await executor.importWholeFolder(
    {
      tree: {
        name: "Book Folder",
        fileCount: 1,
        bookCount: 0,
        files: [{ id: "cover", name: "cover.jpg" }],
        children: [],
        cycle: false,
      },
      destinationFolderId: "destination",
    },
    "skip"
  );

  assert.equal(counts.imported, 1);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].name, "cover.jpg");
});

test("direct whole-folder import streams discovery and skips duplicates without pre-scan", async () => {
  const copies = [];
  const sourceListings = [];
  const destinationListings = [];

  const source = {
    isBook(file) {
      return /\.epub$/i.test(file.name);
    },
    async listEntries(folderId) {
      sourceListings.push(folderId);
      if (folderId === "source-root") {
        return {
          files: [
            {
              id: "new-book",
              name: "New.epub",
              capabilities: { canCopy: true },
            },
            {
              id: "old-book",
              name: "Old.epub",
              capabilities: { canCopy: true },
            },
          ],
          folders: [{ id: "child", name: "Child" }],
        };
      }

      return {
        files: [
          {
            id: "cover",
            name: "cover.jpg",
            capabilities: { canCopy: true },
          },
        ],
        folders: [],
      };
    },
    async copyFile(id, folderId, name) {
      const copy = {
        id: `copy-${id}`,
        name,
        folderId,
      };
      copies.push(copy);
      return copy;
    },
    async trashFile() {},
  };

  const library = {
    async listEntries(folderId) {
      destinationListings.push(folderId);

      if (folderId === "destination") {
        return {
          files: [],
          folders: [{ id: "destination/Source", name: "Source" }],
        };
      }

      if (folderId === "destination/Source") {
        return {
          files: [{ id: "existing", name: "Old.epub" }],
          folders: [],
        };
      }

      return { files: [], folders: [] };
    },
    async createFolder(parentId, name) {
      return { id: `${parentId}/${name}`, name };
    },
  };

  const executor = new ImportExecutor({
    source,
    libraryService: library,
  });
  const updates = [];

  const counts = await executor.importWholeFolderDirect(
    {
      sourceFolder: { id: "source-root", name: "Source" },
      destinationFolderId: "destination",
      destinationPath: "KOCloud/Books",
    },
    "skip",
    {
      maxConcurrency: 2,
      onProgress(progress) {
        updates.push(progress);
      },
    }
  );

  assert.equal(counts.imported, 2);
  assert.equal(counts.skipped, 1);
  assert.deepEqual(sourceListings.sort(), ["child", "source-root"]);
  assert.equal(destinationListings.filter((id) => id === "destination").length, 1);
  assert.equal(
    destinationListings.filter((id) => id === "destination/Source").length,
    1
  );
  assert.equal(copies.some((copy) => copy.name === "New.epub"), true);
  assert.equal(copies.some((copy) => copy.name === "cover.jpg"), true);
  assert.equal(copies.some((copy) => copy.name === "Old.epub"), false);
  assert.equal(updates.at(-1).filesProcessed, 3);
  assert.equal(updates.at(-1).filesFound, 3);
  assert.equal(updates.at(-1).booksFound, 2);
});

test("direct whole-folder import reports partial counts when cancelled", async () => {
  const controller = new AbortController();
  const source = {
    isBook() {
      return true;
    },
    async listEntries() {
      return {
        folders: [],
        files: [
          {
            id: "one",
            name: "One.epub",
            capabilities: { canCopy: true },
          },
          {
            id: "two",
            name: "Two.epub",
            capabilities: { canCopy: true },
          },
        ],
      };
    },
    async copyFile(id, _folderId, name) {
      if (id === "one") {
        controller.abort();
      }
      return { id: `copy-${id}`, name };
    },
    async trashFile() {},
  };
  const library = {
    async listEntries() {
      return { files: [], folders: [] };
    },
    async createFolder(parentId, name) {
      return { id: `${parentId}/${name}`, name };
    },
  };
  const executor = new ImportExecutor({
    source,
    libraryService: library,
  });

  await assert.rejects(
    executor.importWholeFolderDirect(
      {
        sourceFolder: { id: "source", name: "Source" },
        destinationFolderId: "destination",
        destinationPath: "KOCloud/Books",
      },
      "skip",
      { signal: controller.signal }
    ),
    (error) => {
      assert.equal(error.name, "AbortError");
      assert.equal(error.counts.imported, 1);
      return true;
    }
  );
});
