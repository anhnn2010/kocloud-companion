import test from "node:test";
import assert from "node:assert/strict";
import {
  ImportPlanner,
} from "../../src/imports/planner.js";

test("selection planner marks destination and batch duplicates", async () => {
  const planner = new ImportPlanner({
    libraryService: {
      async listFiles() {
        return [{ id: "old", name: "Dune.epub" }];
      },
    },
  });

  const selection = planner.createSelection([
    { id: "1", name: "Dune.epub" },
    { id: "2", name: "Foundation.epub" },
    { id: "3", name: "foundation.epub" },
  ]);

  const duplicateCount =
    await planner.refreshSelectionDuplicates(
      selection,
      "destination"
    );

  assert.equal(duplicateCount, 2);
  assert.equal(selection[0].importStatus, "duplicate");
  assert.equal(selection[0].existingFile.id, "old");
  assert.equal(selection[1].importStatus, "selected");
  assert.equal(selection[2].importStatus, "duplicate");
});

test("whole-folder planner preserves destination context", async () => {
  const planner = new ImportPlanner({
    libraryService: {
      async listFolders() {
        return [];
      },
      async listFiles() {
        return [];
      },
    },
  });
  const tree = {
    name: "Source",
    files: [
      { id: "1", name: "One.epub" },
      { id: "2", name: "one.epub" },
    ],
    children: [],
  };

  const plan = await planner.createWholeFolderPlan(
    tree,
    "source",
    "destination",
    "KOCloud/Books"
  );

  assert.equal(plan.sourceFolderId, "source");
  assert.equal(plan.destinationFolderId, "destination");
  assert.equal(plan.duplicateCount, 1);
});
