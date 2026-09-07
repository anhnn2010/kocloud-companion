import test from "node:test";
import assert from "node:assert/strict";
import {
  UploadDestinationResolver,
} from "../../src/uploads/destination-resolver.js";

test("resolver reuses existing nested folders", async () => {
  const listed = [];
  const resolver = new UploadDestinationResolver({
    async listFolders(parentId) {
      listed.push(parentId);
      if (parentId === "root") {
        return [{ id: "a", name: "SciFi" }];
      }
      if (parentId === "a") {
        return [{ id: "b", name: "Herbert" }];
      }
      return [];
    },
    async createFolder() {
      throw new Error("should not create");
    },
  });

  const folder = await resolver.resolve(
    "root",
    ["scifi", "HERBERT"],
    { createMissing: true }
  );

  assert.equal(folder.id, "b");
  assert.deepEqual(listed, ["root", "a"]);
});

test("resolver can detect a missing path without mutation", async () => {
  let creates = 0;
  const resolver = new UploadDestinationResolver({
    async listFolders() {
      return [];
    },
    async createFolder() {
      creates += 1;
      return { id: "new", name: "New" };
    },
  });

  const folder = await resolver.resolve(
    "root",
    ["New"],
    { createMissing: false }
  );

  assert.equal(folder, null);
  assert.equal(creates, 0);
});

test("resolver creates missing folders once and caches them", async () => {
  let nextId = 0;
  const created = [];
  const resolver = new UploadDestinationResolver({
    async listFolders() {
      return [];
    },
    async createFolder(parentId, name) {
      const folder = {
        id: `new-${++nextId}`,
        name,
      };
      created.push({ parentId, name });
      return folder;
    },
  });

  const first = await resolver.resolve(
    "root",
    ["SciFi", "Herbert"],
    { createMissing: true }
  );
  const second = await resolver.resolve(
    "root",
    ["SciFi", "Herbert"],
    { createMissing: true }
  );

  assert.equal(first.id, second.id);
  assert.deepEqual(created, [
    { parentId: "root", name: "SciFi" },
    { parentId: "new-1", name: "Herbert" },
  ]);
});
