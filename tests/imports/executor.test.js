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

test("direct whole-folder import skips a failed child branch and continues siblings", async () => {
  const copies = [];
  const source = {
    isBook() {
      return true;
    },
    async listEntries(folderId) {
      if (folderId === "source") {
        return {
          files: [],
          folders: [
            { id: "bad", name: "Bad" },
            { id: "good", name: "Good" },
          ],
        };
      }
      if (folderId === "bad") {
        throw new Error("simulated timeout");
      }
      return {
        files: [
          {
            id: "good-book",
            name: "Good.epub",
            capabilities: { canCopy: true },
          },
        ],
        folders: [],
      };
    },
    async copyFile(id, folderId, name) {
      copies.push({ id, folderId, name });
      return { id: `copy-${id}`, name };
    },
    async trashFile() {},
  };
  const library = {
    async listEntries(folderId) {
      if (folderId === "destination") {
        return { files: [], folders: [] };
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

  const counts = await executor.importWholeFolderDirect(
    {
      sourceFolder: { id: "source", name: "Source" },
      destinationFolderId: "destination",
      destinationPath: "KOCloud/Books",
    },
    "skip",
    { maxConcurrency: 2 }
  );

  assert.equal(counts.imported, 1);
  assert.equal(counts.folderFailed, 1);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].name, "Good.epub");
});

test("direct replace keeps cleanup adjacent and bounds folder work", async () => {
  const operationLog = [];
  let activeFolderLists = 0;
  let maxActiveFolderLists = 0;
  const childCount = 12;
  const childFolders = Array.from({ length: childCount }, (_, index) => ({
    id: `source-child-${index}`,
    name: `Child ${index}`,
  }));

  const source = {
    isBook() {
      return true;
    },
    async listEntries(folderId) {
      activeFolderLists += 1;
      maxActiveFolderLists = Math.max(
        maxActiveFolderLists,
        activeFolderLists
      );
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeFolderLists -= 1;

      if (folderId === "source") {
        return { files: [], folders: childFolders };
      }

      const index = folderId.replace("source-child-", "");
      return {
        files: [
          {
            id: `source-file-${index}`,
            name: `Book ${index}.epub`,
            capabilities: { canCopy: true },
          },
        ],
        folders: [],
      };
    },
    async copyFile(id, folderId, name) {
      operationLog.push(`copy:${id}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
      return { id: `copy-${id}`, folderId, name };
    },
    async trashFile(id) {
      operationLog.push(`trash:${id}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { id };
    },
  };

  const library = {
    async listEntries(folderId) {
      if (folderId === "destination") {
        return {
          files: [],
          folders: [{ id: "destination/Source", name: "Source" }],
        };
      }
      if (folderId === "destination/Source") {
        return {
          files: [],
          folders: childFolders.map((_folder, index) => ({
            id: `destination/Source/Child ${index}`,
            name: `Child ${index}`,
          })),
        };
      }
      const match = folderId.match(/Child (\d+)$/);
      if (match) {
        const index = match[1];
        return {
          files: [
            {
              id: `existing-${index}`,
              name: `Book ${index}.epub`,
            },
          ],
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

  const counts = await executor.importWholeFolderDirect(
    {
      sourceFolder: { id: "source", name: "Source" },
      destinationFolderId: "destination",
      destinationPath: "KOCloud/Books",
    },
    "replace",
    { maxConcurrency: 2 }
  );

  assert.equal(counts.replaced, childCount);
  assert.equal(counts.failed, 0);
  assert.ok(maxActiveFolderLists <= 2);

  const firstTrashIndex = operationLog.findIndex((entry) =>
    entry.startsWith("trash:")
  );
  const copiesBeforeFirstTrash = operationLog
    .slice(0, firstTrashIndex)
    .filter((entry) => entry.startsWith("copy:")).length;

  assert.ok(firstTrashIndex >= 0);
  assert.ok(copiesBeforeFirstTrash <= 2);
});

test("direct whole-folder import stops on authentication failure", async () => {
  const authError = new Error("Google authorization expired");
  authError.code = "GOOGLE_AUTH_REQUIRED";

  const executor = new ImportExecutor({
    source: {
      async listEntries() {
        throw authError;
      },
      isBook() {
        return true;
      },
    },
    libraryService: {
      async listEntries() {
        return { folders: [], files: [] };
      },
      async createFolder(_parentId, name) {
        return { id: `dest-${name}`, name };
      },
    },
  });

  await assert.rejects(
    () =>
      executor.importWholeFolderDirect(
        {
          sourceFolder: { id: "source", name: "Source" },
          destinationFolderId: "books",
          destinationPath: "KOCloud/Books",
        },
        "skip",
        { maxConcurrency: 2 }
      ),
    (error) => error.code === "GOOGLE_AUTH_REQUIRED"
  );
});
