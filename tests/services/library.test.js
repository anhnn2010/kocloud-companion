import test from "node:test";
import assert from "node:assert/strict";
import {
  LibraryService,
} from "../../src/services/library.js";

function createService() {
  const calls = [];
  const driveApi = {
    async resolveBooksStorage(token) {
      calls.push(["resolve", token]);
      return { root: { id: "root" }, books: { id: "books" } };
    },
    async listChildFolders(token, folderId) {
      calls.push(["folders", token, folderId]);
      return [{ id: "child", name: "Child" }];
    },
    async listBooksInFolder(token, folderId) {
      calls.push(["files", token, folderId]);
      return [{ id: "book", name: "Book.epub" }];
    },
    async listManagedBooks(token, folderId) {
      calls.push(["managed", token, folderId]);
      return [{ id: "managed", name: "Managed.epub" }];
    },
    async createBookFolder(token, parentId, name) {
      calls.push(["create", token, parentId, name]);
      return { id: "new", name };
    },
    isSupportedBook(file) {
      return file.name.endsWith(".epub");
    },
    getBookMimeType() {
      return "application/epub+zip";
    },
    async createBookUploadSession(
      token,
      file,
      folderId,
      driveName
    ) {
      calls.push([
        "upload",
        token,
        file.name,
        folderId,
        driveName,
      ]);
      return "upload-session";
    },
    async createBookReplaceSession(token, file, fileId) {
      calls.push([
        "replace",
        token,
        file.name,
        fileId,
      ]);
      return "replace-session";
    },
  };

  const service = new LibraryService({
    driveApi,
    getAccessToken: () => "token",
  });

  return { service, calls };
}

test("library service owns destination operations", async () => {
  const { service, calls } = createService();

  const folder = await service.listFolder("books");
  assert.equal(folder.folders.length, 1);
  assert.equal(folder.books.length, 1);

  const created = await service.createFolder(
    "books",
    "Programming"
  );
  assert.equal(created.name, "Programming");

  const session = await service.createUploadSession(
    { name: "Book.epub" },
    "books"
  );
  assert.equal(session, "upload-session");
  assert.equal(calls.some(([name]) => name === "upload"), true);
});

test("library service fails consistently without auth", async () => {
  const service = new LibraryService({
    driveApi: {},
    getAccessToken: () => null,
  });

  await assert.rejects(
    () => service.listFolders("books"),
    /Connect Google Drive again/
  );
});
