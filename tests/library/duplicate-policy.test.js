import test from "node:test";
import assert from "node:assert/strict";
import {
  DUPLICATE_KEEP_POLICIES,
  chooseDuplicateKeep,
  paginateDuplicateGroups,
} from "../../src/library/duplicate-policy.js";

const group = {
  files: [
    {
      id: "deep",
      path: "Books/Imported/Old/Book.epub",
      modifiedTime: "2026-01-01T00:00:00Z",
    },
    {
      id: "shallow-new",
      path: "Books/Book.epub",
      modifiedTime: "2026-03-01T00:00:00Z",
    },
    {
      id: "shallow-old",
      path: "Books/A.epub",
      modifiedTime: "2025-12-01T00:00:00Z",
    },
  ],
};

test("shortest-path policy prefers the shallowest placement", () => {
  assert.equal(
    chooseDuplicateKeep(group, DUPLICATE_KEEP_POLICIES.SHORTEST_PATH),
    "shallow-old"
  );
});

test("oldest and newest policies use modified time", () => {
  assert.equal(
    chooseDuplicateKeep(group, DUPLICATE_KEEP_POLICIES.OLDEST),
    "shallow-old"
  );
  assert.equal(
    chooseDuplicateKeep(group, DUPLICATE_KEEP_POLICIES.NEWEST),
    "shallow-new"
  );
});

test("duplicate pagination clamps pages and returns only one page", () => {
  const groups = Array.from({ length: 45 }, (_, index) => ({ id: index }));
  const page = paginateDuplicateGroups(groups, 1, 20);
  assert.equal(page.pageIndex, 1);
  assert.equal(page.totalPages, 3);
  assert.equal(page.items.length, 20);
  assert.equal(page.items[0].id, 20);

  const last = paginateDuplicateGroups(groups, 99, 20);
  assert.equal(last.pageIndex, 2);
  assert.equal(last.items.length, 5);
});
