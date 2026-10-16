import test from "node:test";
import assert from "node:assert/strict";
import {
  LibraryIndex,
  createLibraryIndexEntry,
} from "../../src/library/library-index.js";
import {
  MemoryLibraryIndexStore,
} from "../../src/library/index-store.js";

test("library index persists a complete snapshot and loads it again", async () => {
  const store = new MemoryLibraryIndexStore();
  const index = new LibraryIndex({ store });

  const entries = [
    createLibraryIndexEntry(
      {
        id: "a",
        name: "A.epub",
        size: "100",
        md5Checksum: "same",
      },
      { parentId: "p1", parentPath: "Books/A", isBook: true }
    ),
    createLibraryIndexEntry(
      {
        id: "b",
        name: "B.epub",
        size: "100",
        md5Checksum: "same",
      },
      { parentId: "p2", parentPath: "Books/B", isBook: true }
    ),
  ];

  await index.replaceAll("books-root", entries);
  assert.equal(index.getReport().groups.length, 1);

  const reloaded = new LibraryIndex({ store });
  assert.equal(await reloaded.load("books-root"), true);
  assert.equal(reloaded.getReport().duplicateCopies, 1);
  assert.equal(reloaded.getReport().filesScanned, 2);
});

test("library index write-through updates and removals change duplicate report", async () => {
  const store = new MemoryLibraryIndexStore();
  const index = new LibraryIndex({ store });

  await index.replaceAll("books-root", [
    createLibraryIndexEntry(
      { id: "a", name: "A.epub", size: 100, md5Checksum: "same" },
      { parentPath: "Books/A", isBook: true }
    ),
  ]);

  await index.upsert(
    createLibraryIndexEntry(
      { id: "b", name: "B.epub", size: 100, md5Checksum: "same" },
      { parentPath: "Books/B", isBook: true }
    )
  );
  assert.equal(index.getReport().groups.length, 1);

  await index.remove("b");
  assert.equal(index.getReport().groups.length, 0);
});

test("library index rejects a snapshot from another Books root", async () => {
  const store = new MemoryLibraryIndexStore();
  const index = new LibraryIndex({ store });
  await index.replaceAll("books-root-a", []);

  const other = new LibraryIndex({ store });
  assert.equal(await other.load("books-root-b"), false);
  assert.equal(other.isReady("books-root-b"), false);
});
