import test from "node:test";
import assert from "node:assert/strict";
import {
  getBookFormatLabel,
  getBookMimeType,
  isSupportedBookName,
  SUPPORTED_BOOK_EXTENSIONS,
} from "../../src/book-formats.js";

test("book formats expose the shared 23-format set", () => {
  assert.equal(SUPPORTED_BOOK_EXTENSIONS.length, 23);

  for (const extension of SUPPORTED_BOOK_EXTENSIONS) {
    assert.equal(
      isSupportedBookName(`Book.${extension}`),
      true,
      extension
    );
  }
});

test("book formats reject unsupported Kindle formats", () => {
  assert.equal(isSupportedBookName("Book.azw3"), false);
  assert.equal(isSupportedBookName("Book.kfx"), false);
});

test("book formats return stable MIME and labels", () => {
  assert.equal(
    getBookMimeType("Book.epub"),
    "application/epub+zip"
  );
  assert.equal(getBookFormatLabel("Book.djv"), "DJVU");
});
