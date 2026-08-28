import test from "node:test";
import assert from "node:assert/strict";
import {
  createAvailableBookName,
  normalizeBookName,
} from "../../src/core/book-names.js";

test("book names normalize case whitespace and Unicode", () => {
  const decomposed = "Cafe\u0301.epub";

  assert.equal(
    normalizeBookName(`  ${decomposed}  `),
    "café.epub"
  );
});

test("keep-both naming finds the next free suffix", () => {
  const existing = new Map([
    ["dune.epub", {}],
    ["dune (1).epub", {}],
    ["dune (2).epub", {}],
  ]);

  assert.equal(
    createAvailableBookName("Dune.epub", existing),
    "Dune (3).epub"
  );
});
