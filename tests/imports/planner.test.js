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

test("whole-folder planner reports duplicate-analysis progress", async () => {
  const planner = new ImportPlanner({
    libraryService: {
      async listFolders(parentId) {
        if (parentId === "destination") {
          return [{ id: "source-dest", name: "Source" }];
        }
        return [];
      },
      async listFiles() {
        return [];
      },
    },
  });
  const tree = {
    name: "Source",
    folderCount: 2,
    files: [],
    children: [
      {
        name: "Child",
        folderCount: 1,
        files: [],
        children: [],
      },
    ],
  };
  const updates = [];

  await planner.createWholeFolderPlan(
    tree,
    "source",
    "destination",
    "KOCloud/Books",
    {
      onProgress(progress) {
        updates.push(progress);
      },
    }
  );

  assert.equal(updates.at(-1).checkedFolders, 2);
  assert.equal(updates.at(-1).totalFolders, 2);
  assert.equal(
    updates.at(-1).currentPath,
    "Source / Child"
  );
});

test("whole-folder duplicate analysis bounds concurrent destination scans", async () => {
  const sourceChildren = [1, 2, 3, 4, 5, 6].map((number) => ({
    name: `Child ${number}`,
    files: [],
    children: [],
  }));
  const tree = {
    name: "Source",
    folderCount: 7,
    files: [],
    children: sourceChildren,
  };
  let active = 0;
  let maxActive = 0;

  const planner = new ImportPlanner({
    libraryService: {
      async listEntries(folderId) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;

        if (folderId === "destination") {
          return {
            folders: [{ id: "source-dest", name: "Source" }],
            files: [],
          };
        }

        if (folderId === "source-dest") {
          return {
            folders: sourceChildren.map((child, index) => ({
              id: `dest-child-${index + 1}`,
              name: child.name,
            })),
            files: [],
          };
        }

        return { folders: [], files: [] };
      },
    },
  });

  const plan = await planner.createWholeFolderPlan(
    tree,
    "source",
    "destination",
    "KOCloud/Books",
    { maxConcurrency: 4 }
  );

  assert.equal(plan.duplicateCount, 0);
  assert.equal(maxActive, 4);
});
