import test from "node:test";
import assert from "node:assert/strict";
import {
  getLocalDirectoryKey,
  getLocalUploadPath,
} from "../../src/uploads/local-path.js";

test("ordinary file selection stays in chosen destination", () => {
  const result = getLocalUploadPath({
    name: "Dune.epub",
    webkitRelativePath: "",
  });

  assert.equal(result.relativePath, "Dune.epub");
  assert.deepEqual(result.directoryParts, []);
});

test("folder selection preserves its root and nested folders", () => {
  const result = getLocalUploadPath({
    name: "Dune.epub",
    webkitRelativePath: "SciFi/Herbert/Dune.epub",
  });

  assert.equal(
    result.relativePath,
    "SciFi/Herbert/Dune.epub"
  );
  assert.deepEqual(result.directoryParts, [
    "SciFi",
    "Herbert",
  ]);
});

test("directory keys compare case-insensitively", () => {
  assert.equal(
    getLocalDirectoryKey(["SciFi", "Herbert"]),
    getLocalDirectoryKey(["scifi", "HERBERT"])
  );
});
