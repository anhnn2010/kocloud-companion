import test from "node:test";
import assert from "node:assert/strict";
import {
  DuplicateScanner,
  createExactFingerprint,
} from "../../src/library/duplicate-scanner.js";

test("exact fingerprint prefers strongest available checksum", () => {
  assert.equal(
    createExactFingerprint({
      size: "12",
      md5Checksum: "m",
      sha1Checksum: "s1",
      sha256Checksum: "s256",
    }),
    "sha256:s256:12"
  );

  assert.equal(
    createExactFingerprint({ size: "12" }),
    null
  );
});

test("duplicate scanner groups exact books across folders", async () => {
  const tree = {
    root: {
      folders: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      files: [],
    },
    a: {
      folders: [],
      files: [
        {
          id: "a1",
          name: "Book.epub",
          size: "100",
          md5Checksum: "same",
        },
        {
          id: "note",
          name: "note.jpg",
          size: "100",
          md5Checksum: "same",
        },
      ],
    },
    b: {
      folders: [],
      files: [
        {
          id: "b1",
          name: "Renamed.epub",
          size: "100",
          md5Checksum: "same",
        },
        {
          id: "unique",
          name: "Unique.pdf",
          size: "50",
          md5Checksum: "unique",
        },
      ],
    },
  };

  const scanner = new DuplicateScanner({
    libraryService: {
      async listEntries(folderId) {
        return tree[folderId];
      },
      isSupportedBook(file) {
        return /\.(epub|pdf)$/i.test(file.name);
      },
    },
    folderConcurrency: 2,
  });

  const result = await scanner.scan({
    rootFolderId: "root",
    rootPath: "Books",
  });

  assert.equal(result.foldersScanned, 3);
  assert.equal(result.filesScanned, 4);
  assert.equal(result.booksScanned, 3);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].files.length, 2);
  assert.equal(result.groups[0].reclaimableBytes, 100);
  assert.deepEqual(
    result.groups[0].files.map((file) => file.path).sort(),
    ["Books/A/Book.epub", "Books/B/Renamed.epub"]
  );
});

test("duplicate scanner continues past a broken child folder", async () => {
  const scanner = new DuplicateScanner({
    libraryService: {
      async listEntries(folderId) {
        if (folderId === "root") {
          return {
            folders: [
              { id: "bad", name: "Bad" },
              { id: "good", name: "Good" },
            ],
            files: [],
          };
        }
        if (folderId === "bad") {
          throw new Error("broken");
        }
        return {
          folders: [],
          files: [
            {
              id: "good-file",
              name: "Good.epub",
              size: "10",
              md5Checksum: "x",
            },
          ],
        };
      },
      isSupportedBook() {
        return true;
      },
    },
  });

  const result = await scanner.scan({
    rootFolderId: "root",
  });

  assert.equal(result.folderErrors, 1);
  assert.equal(result.booksScanned, 1);
});

test("duplicate scanner honors cancellation", async () => {
  const controller = new AbortController();
  const scanner = new DuplicateScanner({
    libraryService: {
      async listEntries() {
        controller.abort();
        return { folders: [], files: [] };
      },
      isSupportedBook() {
        return true;
      },
    },
  });

  await assert.rejects(
    () => scanner.scan({
      rootFolderId: "root",
      signal: controller.signal,
    }),
    { name: "AbortError" }
  );
});

test("duplicate scanner breaks folder shortcut cycles by target id", async () => {
  let rootCalls = 0;
  const scanner = new DuplicateScanner({
    libraryService: {
      async listEntries(folderId) {
        if (folderId === "root") {
          rootCalls += 1;
          return {
            folders: [{ id: "child", name: "Child" }],
            files: [],
          };
        }
        return {
          folders: [{ id: "root", name: "Back to root" }],
          files: [],
        };
      },
      isSupportedBook() {
        return true;
      },
    },
  });

  const result = await scanner.scan({ rootFolderId: "root" });
  assert.equal(rootCalls, 1);
  assert.equal(result.foldersScanned, 2);
});
