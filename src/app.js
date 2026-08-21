import { googleAuth } from "./google-drive/auth.js";
import { googleDriveApi } from "./google-drive/api.js";
import {
  BrowserUploadTask,
  UploadCancelledError,
} from "./google-drive/upload.js";

const elements = {
  clientId: document.getElementById("google-client-id"),
  saveClientId: document.getElementById("save-client-id"),
  connectGoogle: document.getElementById("connect-google"),
  connectionStatus: document.getElementById("connection-status"),
  authMessage: document.getElementById("auth-message"),

  bookFile: document.getElementById("book-file"),
  selectedBook: document.getElementById("selected-book"),
  uploadBook: document.getElementById("upload-book"),
  uploadMessage: document.getElementById("upload-message"),

  progressRegion: document.getElementById("upload-progress"),
  progressBar: document.getElementById("upload-progress-bar"),
  progressText: document.getElementById("upload-progress-text"),
};

const state = {
  storage: null,
  selectedFile: null,
  uploadTask: null,
  busy: false,
};

/**
 * Initialize KOCloud Companion V0.1.
 */
function init() {
  elements.clientId.value = googleAuth.getClientId();

  setDisconnectedState();

  elements.saveClientId.addEventListener(
    "click",
    handleSaveClientId
  );

  elements.connectGoogle.addEventListener(
    "click",
    handleConnectGoogle
  );

  elements.bookFile.addEventListener(
    "change",
    handleBookSelection
  );

  elements.uploadBook.addEventListener(
    "click",
    handleUploadBook
  );

  googleAuth.subscribe(handleAuthEvent);
}

/**
 * Save the user's Web OAuth Client ID locally in this browser.
 */
function handleSaveClientId() {
  clearMessage(elements.authMessage);

  try {
    googleAuth.saveClientId(elements.clientId.value);

    setMessage(
      elements.authMessage,
      "Web OAuth Client ID saved in this browser.",
      "success"
    );

    setDisconnectedState();
  } catch (error) {
    setMessage(
      elements.authMessage,
      getErrorMessage(error),
      "error"
    );
  }
}

/**
 * Connect to Google and resolve the existing KOCloud Books storage.
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

  elements.connectGoogle.textContent =
    "Connecting…";

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
 * Handle an ebook selected by the user.
 */
function handleBookSelection() {
  clearMessage(elements.uploadMessage);
  resetProgress();

  const file =
    elements.bookFile.files?.[0] || null;

  if (!file) {
    clearSelectedBook();
    return;
  }

  if (!googleDriveApi.isSupportedBook(file)) {
    elements.bookFile.value = "";
    clearSelectedBook();

    setMessage(
      elements.uploadMessage,
      "Only EPUB and PDF files are supported.",
      "error"
    );
    return;
  }

  state.selectedFile = file;

  elements.selectedBook.dataset.state = "ready";
  elements.selectedBook.textContent =
    `${file.name} · ${formatBytes(file.size)}`;

  updateUploadButton();
}

/**
 * Upload the selected ebook directly from this browser to Google Drive.
 */
async function handleUploadBook() {
  if (state.busy) {
    return;
  }

  const file = state.selectedFile;
  const storage = state.storage;
  const accessToken = googleAuth.getAccessToken();

  if (!accessToken) {
    setMessage(
      elements.uploadMessage,
      "Google authorization is no longer available. Connect Google Drive again.",
      "error"
    );
    return;
  }

  if (!storage?.books?.id) {
    setMessage(
      elements.uploadMessage,
      "KOCloud Books storage is not ready. Connect Google Drive again.",
      "error"
    );
    return;
  }

  if (!file) {
    setMessage(
      elements.uploadMessage,
      "Choose an EPUB or PDF first.",
      "error"
    );
    return;
  }

  setBusy(true);
  clearMessage(elements.uploadMessage);
  showProgress(0);

  elements.uploadBook.textContent =
    "Preparing upload…";

  try {
    const sessionUrl =
      await googleDriveApi.createBookUploadSession(
        accessToken,
        file,
        storage.books.id
      );

    const mimeType =
      googleDriveApi.getBookMimeType(file);

    const task = new BrowserUploadTask(
      sessionUrl,
      file,
      mimeType
    );

    state.uploadTask = task;
    elements.uploadBook.textContent =
      "Uploading…";

    const uploadedFile = await task.start(
      ({ loaded, total, percent }) => {
        showProgress(percent, loaded, total);
      }
    );

    state.uploadTask = null;

    showProgress(100, file.size, file.size);

    setMessage(
      elements.uploadMessage,
      `${uploadedFile.name || file.name} uploaded to KOCloud.`,
      "success"
    );

    // Clear the picker after a successful upload so an accidental second tap
    // cannot upload the same file again.
    elements.bookFile.value = "";
    state.selectedFile = null;

    elements.selectedBook.dataset.state = "";
    elements.selectedBook.textContent =
      "No book selected.";
  } catch (error) {
    state.uploadTask = null;

    if (error instanceof UploadCancelledError) {
      setMessage(
        elements.uploadMessage,
        "Upload cancelled."
      );
    } else {
      setMessage(
        elements.uploadMessage,
        formatUploadError(error),
        "error"
      );
    }
  } finally {
    elements.uploadBook.textContent =
      "Upload book";

    setBusy(false);
    updateUploadButton();
  }
}

/**
 * Keep UI state synchronized with auth events.
 *
 * @param {object} event
 */
function handleAuthEvent(event) {
  if (event.type === "disconnected") {
    state.storage = null;
    disableBookSelection();
    setDisconnectedState();
  }

  if (event.type === "error") {
    state.storage = null;
    disableBookSelection();

    setConnectionStatus(
      "Google Drive: Connection failed",
      "error"
    );
  }
}

/**
 * Enable the upload area after KOCloud storage is resolved.
 */
function enableBookSelection() {
  elements.bookFile.disabled = false;

  const pickerLabel =
    document.querySelector(
      'label[for="book-file"]'
    );

  if (pickerLabel) {
    pickerLabel.setAttribute(
      "aria-disabled",
      "false"
    );
  }

  updateUploadButton();
}

/**
 * Disable upload controls until Google Drive + KOCloud storage are ready.
 */
function disableBookSelection() {
  elements.bookFile.disabled = true;
  elements.uploadBook.disabled = true;

  const pickerLabel =
    document.querySelector(
      'label[for="book-file"]'
    );

  if (pickerLabel) {
    pickerLabel.setAttribute(
      "aria-disabled",
      "true"
    );
  }
}

/**
 * Reset UI to disconnected state.
 */
function setDisconnectedState() {
  setConnectionStatus(
    "Google Drive: Not connected",
    "disconnected"
  );

  state.storage = null;

  disableBookSelection();
  updateUploadButton();
}

/**
 * Clear the selected ebook from state and UI.
 */
function clearSelectedBook() {
  state.selectedFile = null;

  elements.selectedBook.dataset.state = "";
  elements.selectedBook.textContent =
    "No book selected.";

  updateUploadButton();
}

/**
 * Update whether the Upload button is currently usable.
 */
function updateUploadButton() {
  elements.uploadBook.disabled =
    state.busy ||
    !googleAuth.isConnected() ||
    !state.storage?.books?.id ||
    !state.selectedFile;
}

/**
 * Mark the UI busy while OAuth/storage resolution/upload is running.
 *
 * @param {boolean} busy
 */
function setBusy(busy) {
  state.busy = busy;

  elements.saveClientId.disabled = busy;
  elements.connectGoogle.disabled = busy;

  if (busy) {
    elements.bookFile.disabled = true;
  } else if (
    googleAuth.isConnected() &&
    state.storage?.books?.id
  ) {
    elements.bookFile.disabled = false;
  }

  updateUploadButton();
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
 * Show a progress value.
 *
 * @param {number} percent
 * @param {number|null} loaded
 * @param {number|null} total
 */
function showProgress(
  percent,
  loaded = null,
  total = null
) {
  const safePercent =
    Math.max(0, Math.min(100, percent));

  elements.progressRegion.hidden = false;
  elements.progressBar.value = safePercent;

  if (
    Number.isFinite(loaded) &&
    Number.isFinite(total) &&
    total > 0
  ) {
    elements.progressText.textContent =
      `${safePercent}% · ` +
      `${formatBytes(loaded)} / ` +
      `${formatBytes(total)}`;
  } else {
    elements.progressText.textContent =
      `${safePercent}%`;
  }
}

/**
 * Hide and reset progress UI.
 */
function resetProgress() {
  elements.progressRegion.hidden = true;
  elements.progressBar.value = 0;
  elements.progressText.textContent = "0%";
}

/**
 * Set user-visible helper/error/success text.
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
 * Format a byte count for UI.
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
 * Return a concise error message from unknown thrown values.
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
 * Add reconnect guidance for expired/invalid Google access tokens.
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
      `${message} Connect Google Drive again and retry the upload.`
    );
  }

  return message;
}

init();
