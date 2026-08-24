import { googleAuth } from "./google-drive/auth.js";
import { googleDriveApi } from "./google-drive/api.js";
import { googleDrivePicker } from "./google-drive/picker.js";
import {
  BrowserUploadTask,
  UploadCancelledError,
} from "./google-drive/upload.js";

const elements = {
  clientId: document.getElementById("google-client-id"),
  pickerApiKey: document.getElementById("google-picker-api-key"),
  pickerAppId: document.getElementById("google-picker-app-id"),
  saveClientId: document.getElementById("save-client-id"),
  connectGoogle: document.getElementById("connect-google"),
  connectionStatus: document.getElementById("connection-status"),
  authMessage: document.getElementById("auth-message"),

  openDrivePicker: document.getElementById("open-drive-picker"),
  driveSelectionEmpty: document.getElementById("drive-selection-empty"),
  driveSelection: document.getElementById("drive-selection"),
  driveSelectionSummary:
    document.getElementById("drive-selection-summary"),
  driveSelectionList:
    document.getElementById("drive-selection-list"),
  clearDriveSelection:
    document.getElementById("clear-drive-selection"),
  importDriveBooks:
    document.getElementById("import-drive-books"),
  driveImportMessage:
    document.getElementById("drive-import-message"),

  bookFiles: document.getElementById("book-files"),
  queueEmpty: document.getElementById("queue-empty"),
  uploadQueue: document.getElementById("upload-queue"),
  queueSummary: document.getElementById("queue-summary"),
  queueList: document.getElementById("queue-list"),
  clearQueue: document.getElementById("clear-queue"),

  uploadAll: document.getElementById("upload-all"),
  uploadMessage: document.getElementById("upload-message"),

  batchProgress: document.getElementById("batch-progress"),
  batchProgressBar: document.getElementById("batch-progress-bar"),
  batchProgressText: document.getElementById("batch-progress-text"),

  refreshLibrary: document.getElementById("refresh-library"),
  libraryEmpty: document.getElementById("library-empty"),
  libraryContent: document.getElementById("library-content"),
  librarySummary: document.getElementById("library-summary"),
  libraryList: document.getElementById("library-list"),
  libraryMessage: document.getElementById("library-message"),
};

const state = {
  storage: null,
  queue: [],
  uploadTask: null,
  busy: false,
  libraryBooks: [],
  libraryLoading: false,
  driveSelection: [],
  driveImporting: false,
};

/**
 * Initialize KOCloud Companion.
 */
function init() {
  elements.clientId.value = googleAuth.getClientId();

  const pickerConfig = googleDrivePicker.getConfig();
  elements.pickerApiKey.value = pickerConfig.apiKey;
  elements.pickerAppId.value = pickerConfig.appId;

  setDisconnectedState();
  renderQueue();
  renderDriveSelection();

  elements.saveClientId.addEventListener(
    "click",
    handleSaveClientId
  );

  elements.connectGoogle.addEventListener(
    "click",
    handleConnectGoogle
  );

  elements.bookFiles.addEventListener(
    "change",
    handleBookSelection
  );

  elements.clearQueue.addEventListener(
    "click",
    handleClearQueue
  );

  elements.uploadAll.addEventListener(
    "click",
    handleUploadAll
  );

  elements.refreshLibrary.addEventListener(
    "click",
    handleRefreshLibrary
  );

  elements.openDrivePicker.addEventListener(
    "click",
    handleOpenDrivePicker
  );

  elements.clearDriveSelection.addEventListener(
    "click",
    handleClearDriveSelection
  );

  elements.importDriveBooks.addEventListener(
    "click",
    handleImportDriveBooks
  );

  googleAuth.subscribe(handleAuthEvent);
}

/**
 * Save the Web OAuth Client ID in this browser.
 */
function handleSaveClientId() {
  clearMessage(elements.authMessage);

  try {
    googleAuth.saveClientId(elements.clientId.value);

    googleDrivePicker.saveConfig({
      apiKey: elements.pickerApiKey.value,
      appId: elements.pickerAppId.value,
    });

    setMessage(
      elements.authMessage,
      "Google configuration saved in this browser.",
      "success"
    );

    setDisconnectedState();
    updateDriveImportControls();
  } catch (error) {
    setMessage(
      elements.authMessage,
      getErrorMessage(error),
      "error"
    );
  }
}

/**
 * Connect to Google Drive and resolve existing KOCloud storage.
 */
async function handleConnectGoogle() {
  if (state.busy) {
    return;
  }

  clearMessage(elements.authMessage);
  clearMessage(elements.uploadMessage);

  const typedClientId = elements.clientId.value.trim();

  if (!typedClientId) {
    setMessage(
      elements.authMessage,
      "Enter your Google Web OAuth Client ID first.",
      "error"
    );
    return;
  }

  if (typedClientId !== googleAuth.getClientId()) {
    try {
      googleAuth.saveClientId(typedClientId);
    } catch (error) {
      setMessage(
        elements.authMessage,
        getErrorMessage(error),
        "error"
      );
      return;
    }
  }

  setBusy(true);
  setConnectionStatus(
    "Google Drive: Connecting…",
    "disconnected"
  );

  elements.connectGoogle.textContent = "Connecting…";

  try {
    const accessToken = await googleAuth.connect();

    setConnectionStatus(
      "Google Drive: Connected",
      "connected"
    );

    setMessage(
      elements.authMessage,
      "Connected. Checking KOCloud storage…"
    );

    const storage =
      await googleDriveApi.resolveBooksStorage(
        accessToken
      );

    state.storage = storage;

    setMessage(
      elements.authMessage,
      `Ready. Using ${storage.root.name}/${storage.books.name}.`,
      "success"
    );

    enableBookSelection();
    updateDriveImportControls();

    if (state.queue.length > 0) {
      await refreshDuplicateStates();
    }

    await loadLibrary();
  } catch (error) {
    state.storage = null;
    disableBookSelection();

    setConnectionStatus(
      "Google Drive: Connection failed",
      "error"
    );

    setMessage(
      elements.authMessage,
      formatConnectError(error),
      "error"
    );
  } finally {
    elements.connectGoogle.textContent =
      "Connect Google Drive";

    setBusy(false);
  }
}

/**
 * Open Google Picker and preview selected Drive books.
 */
async function handleOpenDrivePicker() {
  if (state.busy) {
    return;
  }

  clearMessage(elements.driveImportMessage);

  const accessToken = googleAuth.getAccessToken();

  if (!accessToken) {
    setMessage(
      elements.driveImportMessage,
      "Connect Google Drive before selecting books.",
      "error"
    );
    return;
  }

  if (!googleDrivePicker.isConfigured()) {
    setMessage(
      elements.driveImportMessage,
      "Save Google Picker API key and project number first.",
      "error"
    );
    return;
  }

  elements.openDrivePicker.disabled = true;
  elements.openDrivePicker.textContent =
    "Opening Google Drive…";

  try {
    const selectedBooks =
      await googleDrivePicker.pickBooks(
        accessToken
      );

    if (selectedBooks.length === 0) {
      return;
    }

    state.driveSelection = selectedBooks.map(
      (book) => ({
        ...book,
        importStatus: "selected",
        importMessage: "",
      })
    );

    renderDriveSelection();

    setMessage(
      elements.driveImportMessage,
      `${selectedBooks.length} Drive book` +
        `${selectedBooks.length === 1 ? "" : "s"} selected. ` +
        "Ready to import into KOCloud/Books.",
      "success"
    );
  } catch (error) {
    setMessage(
      elements.driveImportMessage,
      getErrorMessage(error),
      "error"
    );
  } finally {
    elements.openDrivePicker.textContent =
      "Select books from Google Drive";

    updateDriveImportControls();
  }
}

/**
 * Clear the current Google Drive import preview.
 */
function handleClearDriveSelection() {
  if (state.busy || state.driveImporting) {
    return;
  }

  state.driveSelection = [];
  clearMessage(elements.driveImportMessage);
  renderDriveSelection();
}

/**
 * Render Google Picker selections for Checkpoint 1 preview.
 */
function renderDriveSelection() {
  const books = state.driveSelection;

  elements.driveSelectionEmpty.hidden =
    books.length > 0;

  elements.driveSelection.hidden =
    books.length === 0;

  elements.driveSelectionSummary.textContent =
    `${books.length} book` +
    `${books.length === 1 ? "" : "s"} selected`;

  elements.driveSelectionList.replaceChildren();

  for (const book of books) {
    const item = document.createElement("li");
    item.className = "queue-item";

    const main = document.createElement("div");
    main.className = "queue-item-main";

    const name = document.createElement("div");
    name.className = "queue-item-name";
    name.textContent = book.name;

    const type = document.createElement("div");
    type.className = "queue-item-size";
    type.textContent =
      formatDriveBookType(book.mimeType);

    main.append(name, type);

    const status = document.createElement("div");
    status.className = "queue-item-status";
    status.textContent =
      getDriveImportStatusText(book);

    if (book.importStatus === "done") {
      status.classList.add("status-success");
    } else if (
      book.importStatus === "error" ||
      book.importStatus === "blocked"
    ) {
      status.classList.add("status-error");
    }

    item.append(main, status);
    elements.driveSelectionList.append(item);
  }

  updateDriveImportControls();
}

/**
 * Enable/disable Google Drive import controls.
 */
function updateDriveImportControls() {
  const ready =
    !state.busy &&
    !state.driveImporting &&
    googleAuth.isConnected();

  const canOpen =
    ready &&
    googleDrivePicker.isConfigured();

  const canImport =
    ready &&
    Boolean(state.storage?.books?.id) &&
    state.driveSelection.some(
      (book) =>
        book.importStatus !== "done" &&
        book.importStatus !== "blocked"
    );

  elements.openDrivePicker.disabled = !canOpen;

  elements.clearDriveSelection.disabled =
    !ready ||
    state.driveSelection.length === 0;

  elements.importDriveBooks.disabled =
    !canImport;

  elements.importDriveBooks.textContent =
    state.driveImporting
      ? "Importing…"
      : "Import selected books";
}

/**
 * Import the current Google Picker selection into KOCloud/Books.
 *
 * Files are processed sequentially so one failed/shared-restricted file does
 * not stop the rest of the batch.
 */
async function handleImportDriveBooks() {
  if (state.busy || state.driveImporting) {
    return;
  }

  const accessToken = googleAuth.getAccessToken();
  const booksFolderId = state.storage?.books?.id;

  if (!accessToken || !booksFolderId) {
    setMessage(
      elements.driveImportMessage,
      "Connect Google Drive and resolve KOCloud/Books first.",
      "error"
    );
    return;
  }

  const pendingBooks =
    state.driveSelection.filter(
      (book) =>
        book.importStatus !== "done" &&
        book.importStatus !== "blocked"
    );

  if (pendingBooks.length === 0) {
    return;
  }

  state.driveImporting = true;
  clearMessage(elements.driveImportMessage);
  updateDriveImportControls();

  let importedCount = 0;
  let blockedCount = 0;
  let failedCount = 0;

  try {
    for (const book of pendingBooks) {
      book.importStatus = "checking";
      book.importMessage = "";
      renderDriveSelection();

      try {
        const source =
          await googleDriveApi.getImportSource(
            accessToken,
            book.id
          );

        book.name = source.name || book.name;
        book.mimeType =
          source.mimeType || book.mimeType;

        if (!source.capabilities?.canCopy) {
          book.importStatus = "blocked";
          book.importMessage =
            "Owner or administrator does not allow copying.";
          blockedCount += 1;
          renderDriveSelection();
          continue;
        }

        book.importStatus = "importing";
        book.importMessage =
          "Copying directly in Google Drive…";
        renderDriveSelection();

        await googleDriveApi.copyBookToFolder(
          accessToken,
          book.id,
          booksFolderId,
          book.name
        );

        book.importStatus = "done";
        book.importMessage =
          "Imported to KOCloud/Books";
        importedCount += 1;
      } catch (error) {
        book.importStatus = "error";
        book.importMessage =
          getErrorMessage(error);
        failedCount += 1;
      }

      renderDriveSelection();
    }

    if (importedCount > 0) {
      await loadLibrary();
    }

    const parts = [];

    if (importedCount > 0) {
      parts.push(
        `${importedCount} imported`
      );
    }

    if (blockedCount > 0) {
      parts.push(
        `${blockedCount} cannot be copied`
      );
    }

    if (failedCount > 0) {
      parts.push(
        `${failedCount} failed`
      );
    }

    const message =
      parts.length > 0
        ? `${parts.join(", ")}.`
        : "No books were imported.";

    setMessage(
      elements.driveImportMessage,
      message,
      failedCount > 0 ? "error" : "success"
    );
  } finally {
    state.driveImporting = false;
    updateDriveImportControls();
    renderDriveSelection();
  }
}

/**
 * Return user-facing status text for one Drive import item.
 *
 * @param {object} book
 * @returns {string}
 */
function getDriveImportStatusText(book) {
  if (book.importMessage) {
    return book.importMessage;
  }

  switch (book.importStatus) {
    case "checking":
      return "Checking copy permission…";
    case "importing":
      return "Importing…";
    case "done":
      return "Imported to KOCloud/Books";
    case "blocked":
      return "This file cannot be copied";
    case "error":
      return "Import failed";
    default:
      return "Selected from Google Drive";
  }
}

/**
 * Return a short file-type label for Drive Picker results.
 *
 * @param {string} mimeType
 * @returns {string}
 */
function formatDriveBookType(mimeType) {
  if (mimeType === "application/epub+zip") {
    return "EPUB";
  }

  if (mimeType === "application/pdf") {
    return "PDF";
  }

  return "Book";
}

/**
 * Refresh the read-only KOCloud library view.
 */
async function handleRefreshLibrary() {
  if (state.busy || state.libraryLoading) {
    return;
  }

  await loadLibrary();
}

/**
 * Load books currently visible in KOCloud/Books.
 */
async function loadLibrary() {
  const accessToken = googleAuth.getAccessToken();
  const booksFolderId = state.storage?.books?.id;

  if (!accessToken || !booksFolderId) {
    state.libraryBooks = [];
    renderLibrary();
    return;
  }

  state.libraryLoading = true;
  updateLibraryControls();
  clearMessage(elements.libraryMessage);

  try {
    const books =
      await googleDriveApi.listManagedBooks(
        accessToken,
        booksFolderId
      );

    books.sort(compareLibraryBooks);

    state.libraryBooks = books;
    renderLibrary();
  } catch (error) {
    setMessage(
      elements.libraryMessage,
      `Could not load library: ${getErrorMessage(error)}`,
      "error"
    );
  } finally {
    state.libraryLoading = false;
    updateLibraryControls();
  }
}

/**
 * Sort library books by most recently modified, then by name.
 *
 * @param {object} left
 * @param {object} right
 * @returns {number}
 */
function compareLibraryBooks(left, right) {
  const leftTime =
    Date.parse(left.modifiedTime || "") || 0;

  const rightTime =
    Date.parse(right.modifiedTime || "") || 0;

  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return String(left.name || "").localeCompare(
    String(right.name || ""),
    undefined,
    {
      sensitivity: "base",
      numeric: true,
    }
  );
}

/**
 * Render the read-only My Books list.
 */
function renderLibrary() {
  const connected =
    googleAuth.isConnected() &&
    Boolean(state.storage?.books?.id);

  if (!connected) {
    elements.libraryEmpty.hidden = false;
    elements.libraryEmpty.textContent =
      "Connect Google Drive to load your library.";
    elements.libraryContent.hidden = true;
    elements.libraryList.replaceChildren();
    elements.librarySummary.textContent = "0 books";
    updateLibraryControls();
    return;
  }

  const books = state.libraryBooks;

  if (books.length === 0) {
    elements.libraryEmpty.hidden = false;
    elements.libraryEmpty.textContent =
      "No books found in KOCloud/Books.";
    elements.libraryContent.hidden = true;
    elements.libraryList.replaceChildren();
    elements.librarySummary.textContent = "0 books";
    updateLibraryControls();
    return;
  }

  elements.libraryEmpty.hidden = true;
  elements.libraryContent.hidden = false;
  elements.librarySummary.textContent =
    `${books.length} book${books.length === 1 ? "" : "s"}`;

  elements.libraryList.replaceChildren();

  for (const book of books) {
    elements.libraryList.append(
      createLibraryItemElement(book)
    );
  }

  updateLibraryControls();
}

/**
 * Create one read-only library row.
 *
 * @param {object} book
 * @returns {HTMLLIElement}
 */
function createLibraryItemElement(book) {
  const li = document.createElement("li");
  li.className = "library-item";

  const name = document.createElement("div");
  name.className = "library-item-name";
  name.textContent = book.name || "Untitled";

  const size = document.createElement("div");
  size.className = "library-item-size";
  size.textContent = formatBytes(
    Number(book.size || 0)
  );

  const meta = document.createElement("div");
  meta.className = "library-item-meta";

  if (book.modifiedTime) {
    meta.textContent =
      `Updated ${formatDateTime(book.modifiedTime)}`;
  } else {
    meta.textContent = "Updated time unavailable";
  }

  li.append(name, size, meta);
  return li;
}

/**
 * Enable/disable the Library Refresh button.
 */
function updateLibraryControls() {
  elements.refreshLibrary.disabled =
    state.busy ||
    state.libraryLoading ||
    !googleAuth.isConnected() ||
    !state.storage?.books?.id;

  elements.refreshLibrary.textContent =
    state.libraryLoading
      ? "Refreshing…"
      : "Refresh";
}

/**
 * Add supported selected files to the upload queue and preflight duplicates.
 */
async function handleBookSelection() {
  clearMessage(elements.uploadMessage);

  const files = Array.from(
    elements.bookFiles.files || []
  );

  if (files.length === 0) {
    return;
  }

  const supported = [];
  const rejected = [];

  for (const file of files) {
    if (googleDriveApi.isSupportedBook(file)) {
      supported.push(file);
    } else {
      rejected.push(file.name);
    }
  }

  for (const file of supported) {
    state.queue.push(createQueueItem(file));
  }

  // Reset so the same local file can be selected again intentionally.
  elements.bookFiles.value = "";

  renderQueue();

  if (supported.length > 0) {
    try {
      await refreshDuplicateStates();
    } catch (error) {
      setMessage(
        elements.uploadMessage,
        `Could not check duplicates: ${getErrorMessage(error)}`,
        "error"
      );
    }
  }

  if (rejected.length > 0) {
    setMessage(
      elements.uploadMessage,
      `${rejected.length} unsupported file` +
        `${rejected.length === 1 ? " was" : "s were"} skipped. ` +
        "Only EPUB and PDF files are supported.",
      "error"
    );
  }
}

/**
 * Compare queued files with files currently in KOCloud/Books.
 */
async function refreshDuplicateStates() {
  const accessToken = googleAuth.getAccessToken();
  const booksFolderId = state.storage?.books?.id;

  if (!accessToken || !booksFolderId) {
    return;
  }

  const existingBooks =
    await googleDriveApi.listManagedBooks(
      accessToken,
      booksFolderId
    );

  const existingByName = new Map();

  for (const book of existingBooks) {
    const key = normalizeBookName(book.name);

    if (!existingByName.has(key)) {
      existingByName.set(key, book);
    }
  }

  for (const item of state.queue) {
    if (
      item.status === "uploading" ||
      item.status === "done" ||
      item.status === "replaced"
    ) {
      continue;
    }

    const existing = existingByName.get(
      normalizeBookName(item.file.name)
    );

    if (existing) {
      item.existingFile = existing;
      item.status = "duplicate";
      item.progress = 0;
      item.error = "";

      if (
        item.duplicateAction !== "replace" &&
        item.duplicateAction !== "keep-both"
      ) {
        item.duplicateAction = "skip";
      }
    } else {
      item.existingFile = null;

      if (
        item.status === "duplicate" ||
        item.status === "skipped"
      ) {
        item.status = "waiting";
      }

      item.duplicateAction = "skip";
      item.progress = 0;
      item.error = "";
    }
  }

  renderQueue();
}

/**
 * Change the action for one duplicate item.
 *
 * @param {string} queueId
 * @param {"skip"|"replace"|"keep-both"} action
 */
function setDuplicateAction(queueId, action) {
  if (state.busy) {
    return;
  }

  const item = state.queue.find(
    (candidate) => candidate.id === queueId
  );

  if (!item || item.status !== "duplicate") {
    return;
  }

  item.duplicateAction = action;
  renderQueue();
}

/**
 * Remove every queued item when no upload is running.
 */
function handleClearQueue() {
  if (state.busy) {
    return;
  }

  state.queue = [];
  resetBatchProgress();
  clearMessage(elements.uploadMessage);
  renderQueue();
}

/**
 * Upload/replace waiting items sequentially.
 */
async function handleUploadAll() {
  if (state.busy) {
    return;
  }

  const accessToken = googleAuth.getAccessToken();
  const booksFolderId = state.storage?.books?.id;

  if (!accessToken) {
    setMessage(
      elements.uploadMessage,
      "Google authorization is no longer available. Connect Google Drive again.",
      "error"
    );
    return;
  }

  if (!booksFolderId) {
    setMessage(
      elements.uploadMessage,
      "KOCloud Books storage is not ready. Connect Google Drive again.",
      "error"
    );
    return;
  }

  const pendingItems = state.queue.filter(
    (item) =>
      item.status === "waiting" ||
      item.status === "error" ||
      item.status === "duplicate"
  );

  if (pendingItems.length === 0) {
    setMessage(
      elements.uploadMessage,
      "There are no books waiting to upload."
    );
    return;
  }

  setBusy(true);
  clearMessage(elements.uploadMessage);

  for (const item of pendingItems) {
    item.progress = 0;
    item.error = "";
    item.uploadedFile = null;
  }

  renderQueue();
  updateBatchProgress();

  let succeeded = 0;
  let replaced = 0;
  let skipped = 0;
  let failed = 0;

  try {
    // Re-read Drive immediately before the batch to avoid stale duplicate
    // decisions if the cloud changed after file selection.
    const existingBooks =
      await googleDriveApi.listManagedBooks(
        accessToken,
        booksFolderId
      );

    const existingByName = new Map();

    for (const book of existingBooks) {
      const key = normalizeBookName(book.name);

      if (!existingByName.has(key)) {
        existingByName.set(key, book);
      }
    }

    for (const item of pendingItems) {
      const normalizedName =
        normalizeBookName(item.file.name);

      const cloudExisting =
        existingByName.get(normalizedName) || null;

      if (cloudExisting) {
        item.existingFile = cloudExisting;

        if (item.duplicateAction === "skip") {
          item.status = "skipped";
          item.progress = 100;
          item.error = "";
          skipped += 1;

          renderQueue();
          updateBatchProgress();
          continue;
        }
      } else if (item.status === "duplicate") {
        // The previously detected duplicate disappeared before upload.
        item.existingFile = null;
        item.duplicateAction = "skip";
        item.status = "waiting";
      }

      const currentToken = googleAuth.getAccessToken();

      if (!currentToken) {
        item.status = "error";
        item.error =
          "Google authorization is no longer available.";
        failed += 1;
        renderQueue();
        updateBatchProgress();
        continue;
      }

      item.status = "uploading";
      item.progress = 0;
      item.error = "";

      renderQueue();
      updateBatchProgress();

      try {
        let sessionUrl;
        let driveName = item.file.name;

        const isReplace =
          Boolean(cloudExisting) &&
          item.duplicateAction === "replace";

        const isKeepBoth =
          Boolean(cloudExisting) &&
          item.duplicateAction === "keep-both";

        if (isReplace) {
          sessionUrl =
            await googleDriveApi.createBookReplaceSession(
              currentToken,
              item.file,
              cloudExisting.id
            );
        } else {
          if (isKeepBoth) {
            driveName = createAvailableBookName(
              item.file.name,
              existingByName
            );
          }

          sessionUrl =
            await googleDriveApi.createBookUploadSession(
              currentToken,
              item.file,
              booksFolderId,
              driveName
            );
        }

        const task = new BrowserUploadTask(
          sessionUrl,
          item.file,
          googleDriveApi.getBookMimeType(item.file)
        );

        state.uploadTask = task;

        const uploadedFile = await task.start(
          ({ percent }) => {
            item.progress = percent;
            updateQueueItemElement(item);
            updateBatchProgress();
          }
        );

        state.uploadTask = null;

        item.progress = 100;
        item.uploadedFile = uploadedFile;

        if (isReplace) {
          item.status = "replaced";
          replaced += 1;

          existingByName.set(
            normalizedName,
            uploadedFile.id
              ? uploadedFile
              : cloudExisting
          );
        } else {
          item.status = "done";
          item.driveName =
            uploadedFile.name || driveName;
          succeeded += 1;

          existingByName.set(
            normalizeBookName(item.driveName),
            uploadedFile.id
              ? uploadedFile
              : {
                  id: uploadedFile.id,
                  name: item.driveName,
                }
          );
        }
      } catch (error) {
        state.uploadTask = null;

        item.status = "error";
        item.error =
          error instanceof UploadCancelledError
            ? "Upload cancelled."
            : formatUploadError(error);

        failed += 1;
      }

      renderQueue();
      updateBatchProgress();
    }
  } catch (error) {
    setMessage(
      elements.uploadMessage,
      `Could not prepare upload queue: ${getErrorMessage(error)}`,
      "error"
    );
    return;
  } finally {
    state.uploadTask = null;
    setBusy(false);
    renderQueue();
    updateBatchProgress();
  }

  const parts = [];

  if (succeeded > 0) {
    parts.push(`${succeeded} uploaded`);
  }

  if (replaced > 0) {
    parts.push(`${replaced} replaced`);
  }

  if (skipped > 0) {
    parts.push(`${skipped} skipped`);
  }

  if (failed > 0) {
    parts.push(`${failed} failed`);
  }

  if (failed > 0) {
    setMessage(
      elements.uploadMessage,
      `${parts.join(", ")}. ` +
        "Press Upload books again to retry failed items.",
      "error"
    );
  } else {
    setMessage(
      elements.uploadMessage,
      `${parts.join(", ")}.`,
      "success"
    );
  }

  await loadLibrary();
}

/**
 * Create a queue model item for one File.
 *
 * @param {File} file
 * @returns {object}
 */
function createQueueItem(file) {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random()}`,
    file,
    status: "waiting",
    progress: 0,
    error: "",
    uploadedFile: null,
    existingFile: null,
    duplicateAction: "skip",
    driveName: file.name,
  };
}

/**
 * Render the whole upload queue.
 */
function renderQueue() {
  const count = state.queue.length;

  elements.queueEmpty.hidden = count > 0;
  elements.uploadQueue.hidden = count === 0;

  elements.queueSummary.textContent =
    `${count} book${count === 1 ? "" : "s"} selected`;

  elements.queueList.replaceChildren();

  for (const item of state.queue) {
    elements.queueList.append(
      createQueueItemElement(item)
    );
  }

  updateControls();
}

/**
 * Create the DOM element for one queue item.
 *
 * @param {object} item
 * @returns {HTMLLIElement}
 */
function createQueueItemElement(item) {
  const li = document.createElement("li");
  li.className = "queue-item";
  li.dataset.queueId = item.id;
  li.dataset.state = item.status;
  li.dataset.duplicateAction =
    item.duplicateAction;

  const main = document.createElement("div");
  main.className = "queue-item-main";

  const name = document.createElement("div");
  name.className = "queue-item-name";
  name.textContent = item.file.name;

  const size = document.createElement("div");
  size.className = "queue-item-size";
  size.textContent = formatBytes(item.file.size);

  main.append(name, size);

  const status = document.createElement("div");
  status.className = "queue-item-status";
  status.textContent = getQueueStatusText(item);

  const actions = document.createElement("div");
  actions.className = "queue-item-actions";
  actions.hidden = item.status !== "duplicate";

  if (item.status === "duplicate") {
    const skipButton =
      document.createElement("button");

    skipButton.type = "button";
    skipButton.className = "queue-action-button";
    skipButton.dataset.action = "skip";
    skipButton.textContent = "Skip";
    skipButton.disabled =
      state.busy ||
      item.duplicateAction === "skip";

    skipButton.addEventListener(
      "click",
      () => {
        setDuplicateAction(item.id, "skip");
      }
    );

    const replaceButton =
      document.createElement("button");

    replaceButton.type = "button";
    replaceButton.className =
      "queue-action-button";
    replaceButton.dataset.action = "replace";
    replaceButton.textContent = "Replace";
    replaceButton.disabled =
      state.busy ||
      item.duplicateAction === "replace";

    replaceButton.addEventListener(
      "click",
      () => {
        setDuplicateAction(item.id, "replace");
      }
    );

    const keepBothButton =
      document.createElement("button");

    keepBothButton.type = "button";
    keepBothButton.className =
      "queue-action-button";
    keepBothButton.dataset.action =
      "keep-both";
    keepBothButton.textContent = "Keep both";
    keepBothButton.disabled =
      state.busy ||
      item.duplicateAction === "keep-both";

    keepBothButton.addEventListener(
      "click",
      () => {
        setDuplicateAction(
          item.id,
          "keep-both"
        );
      }
    );

    actions.append(
      skipButton,
      replaceButton,
      keepBothButton
    );
  }

  const progress = document.createElement("div");
  progress.className = "queue-item-progress";
  progress.hidden =
    item.status !== "uploading" &&
    item.status !== "done" &&
    item.status !== "replaced";

  const progressBar =
    document.createElement("progress");
  progressBar.max = 100;
  progressBar.value = item.progress;

  const percent = document.createElement("span");
  percent.className = "queue-item-percent";
  percent.textContent = `${item.progress}%`;

  progress.append(progressBar, percent);

  const error = document.createElement("div");
  error.className = "queue-item-error";
  error.textContent = item.error;

  li.append(
    main,
    status,
    actions,
    progress,
    error
  );

  return li;
}

/**
 * Update only the DOM for one queue item during progress events.
 *
 * @param {object} item
 */
function updateQueueItemElement(item) {
  const row = elements.queueList.querySelector(
    `[data-queue-id="${CSS.escape(item.id)}"]`
  );

  if (!row) {
    return;
  }

  row.dataset.state = item.status;
  row.dataset.duplicateAction =
    item.duplicateAction;

  const status = row.querySelector(
    ".queue-item-status"
  );

  const progressRegion = row.querySelector(
    ".queue-item-progress"
  );

  const progressBar = row.querySelector(
    "progress"
  );

  const percent = row.querySelector(
    ".queue-item-percent"
  );

  const error = row.querySelector(
    ".queue-item-error"
  );

  if (status) {
    status.textContent = getQueueStatusText(item);
  }

  if (progressRegion) {
    progressRegion.hidden =
      item.status !== "uploading" &&
      item.status !== "done" &&
      item.status !== "replaced";
  }

  if (progressBar) {
    progressBar.value = item.progress;
  }

  if (percent) {
    percent.textContent = `${item.progress}%`;
  }

  if (error) {
    error.textContent = item.error;
  }
}

/**
 * Return user-visible text for a queue state.
 *
 * @param {object} item
 * @returns {string}
 */
function getQueueStatusText(item) {
  switch (item.status) {
    case "uploading":
      return item.duplicateAction === "replace"
        ? "Replacing…"
        : "Uploading…";
    case "done":
      return "Uploaded";
    case "replaced":
      return "Replaced";
    case "error":
      return "Failed";
    case "skipped":
      return "Skipped · already exists";
    case "duplicate":
      if (item.duplicateAction === "replace") {
        return "Already exists · Replace selected";
      }

      if (item.duplicateAction === "keep-both") {
        return "Already exists · Keep both selected";
      }

      return "Already exists · Skip selected";
    default:
      return "Waiting";
  }
}

/**
 * Update total batch progress using byte-weighted progress.
 */
function updateBatchProgress() {
  if (state.queue.length === 0) {
    resetBatchProgress();
    return;
  }

  const totalBytes = state.queue.reduce(
    (sum, item) => sum + item.file.size,
    0
  );

  const loadedBytes = state.queue.reduce(
    (sum, item) => {
      if (
        item.status === "done" ||
        item.status === "replaced" ||
        item.status === "skipped"
      ) {
        return sum + item.file.size;
      }

      return (
        sum +
        item.file.size * (item.progress / 100)
      );
    },
    0
  );

  const percent =
    totalBytes > 0
      ? Math.min(
          100,
          Math.round(
            (loadedBytes / totalBytes) * 100
          )
        )
      : 0;

  const completedCount = state.queue.filter(
    (item) =>
      item.status === "done" ||
      item.status === "replaced" ||
      item.status === "skipped"
  ).length;

  elements.batchProgress.hidden = false;
  elements.batchProgressBar.value = percent;
  elements.batchProgressText.textContent =
    `${percent}% · ${completedCount}/${state.queue.length}`;
}

/**
 * Hide and reset total batch progress.
 */
function resetBatchProgress() {
  elements.batchProgress.hidden = true;
  elements.batchProgressBar.value = 0;
  elements.batchProgressText.textContent = "0%";
}

/**
 * Keep UI synchronized with auth events.
 *
 * @param {object} event
 */
function handleAuthEvent(event) {
  if (event.type === "disconnected") {
    state.storage = null;
    state.libraryBooks = [];
    disableBookSelection();
    setDisconnectedState();
    renderLibrary();
    updateDriveImportControls();
  }

  if (event.type === "error") {
    state.storage = null;
    state.libraryBooks = [];
    disableBookSelection();

    setConnectionStatus(
      "Google Drive: Connection failed",
      "error"
    );

    renderLibrary();
    updateDriveImportControls();
  }
}

/**
 * Enable the file picker when Google Drive storage is ready.
 */
function enableBookSelection() {
  elements.bookFiles.disabled = false;

  const pickerLabel =
    document.querySelector(
      'label[for="book-files"]'
    );

  if (pickerLabel) {
    pickerLabel.setAttribute(
      "aria-disabled",
      "false"
    );
  }

  updateControls();
}

/**
 * Disable upload controls until Google Drive is ready.
 */
function disableBookSelection() {
  elements.bookFiles.disabled = true;
  elements.uploadAll.disabled = true;

  const pickerLabel =
    document.querySelector(
      'label[for="book-files"]'
    );

  if (pickerLabel) {
    pickerLabel.setAttribute(
      "aria-disabled",
      "true"
    );
  }
}

/**
 * Reset auth-related UI to disconnected state.
 */
function setDisconnectedState() {
  setConnectionStatus(
    "Google Drive: Not connected",
    "disconnected"
  );

  state.storage = null;
  state.libraryBooks = [];

  disableBookSelection();
  updateControls();
  renderLibrary();
  updateDriveImportControls();
}

/**
 * Mark UI busy while OAuth or upload work is running.
 *
 * @param {boolean} busy
 */
function setBusy(busy) {
  state.busy = busy;

  elements.saveClientId.disabled = busy;
  elements.connectGoogle.disabled = busy;
  elements.clearQueue.disabled = busy;

  if (busy) {
    elements.bookFiles.disabled = true;
  } else if (
    googleAuth.isConnected() &&
    state.storage?.books?.id
  ) {
    elements.bookFiles.disabled = false;
  }

  updateControls();
  updateLibraryControls();
  updateDriveImportControls();
}

/**
 * Update queue-related controls.
 */
function updateControls() {
  const canUpload =
    !state.busy &&
    googleAuth.isConnected() &&
    Boolean(state.storage?.books?.id) &&
    state.queue.some(
      (item) =>
        item.status === "waiting" ||
        item.status === "error" ||
        item.status === "duplicate"
    );

  elements.uploadAll.disabled = !canUpload;
  elements.clearQueue.disabled =
    state.busy || state.queue.length === 0;

  if (state.busy) {
    elements.uploadAll.textContent = "Uploading…";
    return;
  }

  const actionableCount = state.queue.filter(
    (item) =>
      item.status === "waiting" ||
      item.status === "error" ||
      item.status === "duplicate"
  ).length;

  elements.uploadAll.textContent =
    actionableCount > 0
      ? `Upload ${actionableCount} book` +
        `${actionableCount === 1 ? "" : "s"}`
      : "Upload books";
}

/**
 * Update the Google Drive connection badge.
 *
 * @param {string} text
 * @param {"connected"|"disconnected"|"error"} stateName
 */
function setConnectionStatus(
  text,
  stateName
) {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.dataset.state =
    stateName;
}

/**
 * Set a user-visible message.
 *
 * @param {HTMLElement} element
 * @param {string} text
 * @param {"success"|"error"|""} stateName
 */
function setMessage(
  element,
  text,
  stateName = ""
) {
  element.textContent = text;

  if (stateName) {
    element.dataset.state = stateName;
  } else {
    delete element.dataset.state;
  }
}

/**
 * Clear a message region.
 *
 * @param {HTMLElement} element
 */
function clearMessage(element) {
  setMessage(element, "");
}

/**
 * Create a Drive filename that does not collide with existing books.
 *
 * Examples:
 * Dune.epub -> Dune (1).epub -> Dune (2).epub
 *
 * @param {string} originalName
 * @param {Map<string, object>} existingByName
 * @returns {string}
 */
function createAvailableBookName(
  originalName,
  existingByName
) {
  const lastDot = originalName.lastIndexOf(".");

  const hasExtension =
    lastDot > 0 &&
    lastDot < originalName.length - 1;

  const stem = hasExtension
    ? originalName.slice(0, lastDot)
    : originalName;

  const extension = hasExtension
    ? originalName.slice(lastDot)
    : "";

  let index = 1;

  while (true) {
    const candidate =
      `${stem} (${index})${extension}`;

    if (
      !existingByName.has(
        normalizeBookName(candidate)
      )
    ) {
      return candidate;
    }

    index += 1;
  }
}

/**
 * Normalize a filename for duplicate comparison.
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeBookName(name) {
  return name
    .normalize("NFC")
    .trim()
    .toLowerCase();
}

/**
 * Format byte count for UI.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "Unknown size";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = [
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  let value = bytes / 1024;
  let unitIndex = 0;

  while (
    value >= 1024 &&
    unitIndex < units.length - 1
  ) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits =
    value >= 100 ? 0 :
    value >= 10 ? 1 : 2;

  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

/**
 * Format an ISO date/time for the user's browser locale.
 *
 * @param {string} value
 * @returns {string}
 */
function formatDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  ).format(date);
}

/**
 * Return a concise message from an unknown thrown value.
 *
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Add user guidance for common OAuth/storage problems.
 *
 * @param {unknown} error
 * @returns {string}
 */
function formatConnectError(error) {
  const message = getErrorMessage(error);

  if (
    message.includes("origin") ||
    message.includes("redirect_uri") ||
    message.includes("Not a valid origin")
  ) {
    return (
      `${message} Check that this site's HTTPS origin is listed in ` +
      "Authorized JavaScript origins for your Google Web OAuth client."
    );
  }

  if (
    message.includes("managed folder") ||
    message.includes("KOCloud")
  ) {
    return (
      `${message} Open KOCloud on KOReader and initialize Google Drive ` +
      "storage first."
    );
  }

  return message;
}

/**
 * Add reconnect guidance for expired/invalid tokens.
 *
 * @param {unknown} error
 * @returns {string}
 */
function formatUploadError(error) {
  const message = getErrorMessage(error);

  if (
    message.includes("(401)") ||
    message.includes("Invalid Credentials") ||
    message.includes("invalid_token")
  ) {
    return (
      `${message} Connect Google Drive again and retry the failed upload.`
    );
  }

  return message;
}

init();
