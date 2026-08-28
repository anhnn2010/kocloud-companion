import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProtocolManifest,
  getManagedPath,
  getManifestPath,
  isProtocolManifestV1,
  KOCloudProtocol,
} from "../../src/core/protocol.js";

test("protocol exposes stable v1 paths", () => {
  assert.equal(
    KOCloudProtocol.format,
    "kocloud-storage"
  );
  assert.equal(KOCloudProtocol.version, 1);
  assert.equal(
    getManagedPath("books"),
    "KOCloud/Books"
  );
  assert.equal(
    getManifestPath(),
    "KOCloud/.kocloud/manifest.json"
  );
});

test("protocol builds and validates manifest v1", () => {
  const manifest = buildProtocolManifest();

  assert.equal(
    isProtocolManifestV1(manifest),
    true
  );
  assert.equal(manifest.layout.root, "KOCloud");
  assert.equal(
    manifest.layout.reading_data,
    "ReadingData"
  );

  assert.equal(
    isProtocolManifestV1({
      ...manifest,
      schema_version: 2,
    }),
    false
  );
});
