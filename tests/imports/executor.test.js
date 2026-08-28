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
