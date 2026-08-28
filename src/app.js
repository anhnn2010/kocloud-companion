import { googleAuth } from "./google-drive/auth.js";
import { googleDriveApi } from "./google-drive/api.js";
import { googleDrivePicker } from "./google-drive/picker.js";
import { LibraryService } from "./services/library.js";
import {
  GoogleDriveImportSource,
} from "./imports/sources/google-drive.js";
import { ImportPlanner } from "./imports/planner.js";
import { ImportExecutor } from "./imports/executor.js";
import {
  createAvailableBookName,
  normalizeBookName,
} from "./core/book-names.js";
import { KOCloudProtocol } from "./core/protocol.js";
import {
  BrowserUploadTask,
  UploadCancelledError,
} from "./google-drive/upload.js";
import {
  getBookFormatLabel,
  SUPPORTED_BOOK_ACCEPT,
} from "./book-formats.js";

const libraryService = new LibraryService({
  driveApi: googleDriveApi,
  getAccessToken: () => googleAuth.getAccessToken(),
});

const driveImportSource = new GoogleDriveImportSource({
  driveApi: googleDriveApi,
  getAccessToken: () => googleAuth.getAccessToken(),
  isSupportedBook: (file) =>
    libraryService.isSupportedBook(file),
});

const importPlanner = new ImportPlanner({
  libraryService,
});

const importExecutor = new ImportExecutor({
  source: driveImportSource,
  libraryService,
});

const elements = {
  clientId: document.getElementById("google-client-id"),
  pickerApiKey: document.getElementById("google-picker-api-key"),
  pickerAppId: document.getElementById("google-picker-app-id"),
  saveClientId: document.getElementById("save-client-id"),
  connectGoogle: document.getElementById("connect-google"),
  connectionStatus: document.getElementById("connection-status"),
  authMessage: document.getElementById("auth-message"),

  chooseDriveSourceFolder:
    document.getElementById("choose-drive-source-folder"),
  driveSourceFolder:
    document.getElementById("drive-source-folder"),
  driveSourceBrowser:
    document.getElementById("drive-source-browser"),
  driveSourceBack:
    document.getElementById("drive-source-back"),
  driveSourcePath:
    document.getElementById("drive-source-path"),
  driveSourceEmpty:
    document.getElementById("drive-source-empty"),
  driveSourceList:
    document.getElementById("drive-source-list"),
  cancelDriveSourceFolder:
    document.getElementById("cancel-drive-source-folder"),
  useDriveSourceFolder:
    document.getElementById("use-drive-source-folder"),
  openDrivePicker: document.getElementById("open-drive-picker"),
  previewWholeFolder:
    document.getElementById("preview-whole-folder"),
  wholeFolderPreview:
    document.getElementById("whole-folder-preview"),
  wholeFolderSummary:
    document.getElementById("whole-folder-summary"),
  wholeFolderTarget:
    document.getElementById("whole-folder-target"),
  wholeFolderDuplicatePolicy:
    document.getElementById("whole-folder-duplicate-policy"),
  importWholeFolder:
    document.getElementById("import-whole-folder"),
  clearWholeFolderPreview:
    document.getElementById("clear-whole-folder-preview"),
  driveSelectionEmpty: document.getElementById("drive-selection-empty"),
  driveSelection: document.getElementById("drive-selection"),
  driveSelectionSummary:
    document.getElementById("drive-selection-summary"),
  driveSelectionList:
    document.getElementById("drive-selection-list"),
  clearDriveSelection:
    document.getElementById("clear-drive-selection"),
  driveImportDestination:
    document.getElementById("drive-import-destination"),
  newBookFolderName:
    document.getElementById("new-book-folder-name"),
  createBookFolder:
    document.getElementById("create-book-folder"),
  destinationMessage:
    document.getElementById("destination-message"),
  importDriveBooks:
    document.getElementById("import-drive-books"),
  driveImportMessage:
    document.getElementById("drive-import-message"),

  uploadDestination:
    document.getElementById("upload-destination"),
  newUploadFolderName:
    document.getElementById("new-upload-folder-name"),
  createUploadFolder:
    document.getElementById("create-upload-folder"),
  uploadDestinationMessage:
    document.getElementById("upload-destination-message"),
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
  registerFolderBooks:
    document.getElementById("register-folder-books"),
  registerAllFolderBooks:
    document.getElementById("register-all-folder-books"),
  libraryNavigation:
    document.getElementById("library-navigation"),
  libraryBack: document.getElementById("library-back"),
  libraryPath: document.getElementById("library-path"),
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
  libraryFolders: [],
  libraryPath: [],
  libraryLoading: false,
  registeringFolderBooks: false,
  registeringAllFolderBooks: false,
  driveSourceFolder: null,
  driveSourceFolderPicking: false,
  driveSourceBrowserFolders: [],
  driveSourceBrowserPath: [],
  driveSourceBrowserLoading: false,
  wholeFolderScanning: false,
  wholeFolderImporting: false,
  wholeFolderPlan: null,
  wholeFolderDuplicatePolicy: "skip",
  driveSelection: [],
  driveImporting: false,
  driveFolders: [],
  driveFoldersLoading: false,
  uploadDestinationId: "",
  uploadDestinationName: "Books",
  driveDestinationId: "",
  driveDestinationName: "Books",
};

/**
 * Initialize KOCloud Companion.
 */
function init() {
  elements.clientId.value = googleAuth.getClientId();
  elements.bookFiles.accept = SUPPORTED_BOOK_ACCEPT;

  const pickerConfig = googleDrivePicker.getConfig();
  elements.pickerApiKey.value = pickerConfig.apiKey;
  elements.pickerAppId.value = pickerConfig.appId;

  setDisconnectedState();
  renderQueue();
  renderDriveSourceFolder();
  renderDriveSourceBrowser();
  renderWholeFolderPreview();
  renderDriveSelection();

  elements.saveClientId.addEventListener(
    "click",
    handleSaveClientId
  );

  elements.connectGoogle.addEventListener(
    "click",
    handleConnectGoogle
  );

  elements.uploadDestination.addEventListener(
    "change",
    handleUploadDestinationChange
  );

  elements.createUploadFolder.addEventListener(
    "click",
    handleCreateUploadFolder
  );

  elements.newUploadFolderName.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleCreateUploadFolder();
      }
    }
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

  elements.libraryBack.addEventListener(
    "click",
    handleLibraryBack
  );

  elements.registerFolderBooks.addEventListener(
    "click",
    handleRegisterFolderBooks
  );

  elements.registerAllFolderBooks.addEventListener(
    "click",
    handleRegisterAllFolderBooks
  );

  elements.chooseDriveSourceFolder.addEventListener(
    "click",
    handleChooseDriveSourceFolder
  );

  elements.driveSourceBack.addEventListener(
    "click",
    handleDriveSourceBack
  );

  elements.cancelDriveSourceFolder.addEventListener(
    "click",
    handleCancelDriveSourceFolder
  );

  elements.useDriveSourceFolder.addEventListener(
    "click",
    handleUseDriveSourceFolder
  );

  elements.openDrivePicker.addEventListener(
    "click",
    handleOpenDrivePicker
  );

  elements.previewWholeFolder.addEventListener(
    "click",
    handlePreviewWholeFolder
  );

  elements.importWholeFolder.addEventListener(
    "click",
    handleImportWholeFolder
  );

  elements.clearWholeFolderPreview.addEventListener(
    "click",
    clearWholeFolderPlan
  );

  elements.wholeFolderDuplicatePolicy.addEventListener(
    "change",
    handleWholeFolderDuplicatePolicyChange
  );

  elements.clearDriveSelection.addEventListener(
    "click",
    handleClearDriveSelection
  );

  elements.importDriveBooks.addEventListener(
    "click",
    handleImportDriveBooks
  );

  elements.driveImportDestination.addEventListener(
    "change",
    handleDriveDestinationChange
  );

  elements.createBookFolder.addEventListener(
    "click",
    handleCreateBookFolder
  );

  elements.newBookFolderName.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleCreateBookFolder();
      }
    }
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
      await libraryService.resolveStorage(
        accessToken
      );

    state.storage = storage;

    setMessage(
      elements.authMessage,
      `Ready. Using ${storage.root.name}/${storage.books.name}.`,
      "success"
    );

    enableBookSelection();

    await loadDriveImportFolders();

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
 * Load direct child folders under KOCloud/Books for Drive import.
 */
async function loadDriveImportFolders() {
  const accessToken = googleAuth.getAccessToken();
  const booksFolderId = state.storage?.books?.id;

  if (!accessToken || !booksFolderId) {
    state.driveFolders = [];
    state.uploadDestinationId = "";
    state.uploadDestinationName = "Books";
    state.driveDestinationId = "";
    state.driveDestinationName = "Books";
    renderUploadDestinations();
    renderDriveImportDestinations();
    return;
  }

  state.driveFoldersLoading = true;
  clearMessage(elements.uploadDestinationMessage);
  clearMessage(elements.destinationMessage);
  updateControls();
  updateDriveImportControls();

  try {
    state.driveFolders =
      await libraryService.listFolders(
        booksFolderId
      );

    const uploadSelectedStillExists =
      state.uploadDestinationId &&
      state.driveFolders.some(
        (folder) =>
          folder.id === state.uploadDestinationId
      );

    if (!uploadSelectedStillExists) {
      state.uploadDestinationId = "";
      state.uploadDestinationName = "Books";
    }

    const importSelectedStillExists =
      state.driveDestinationId &&
      state.driveFolders.some(
        (folder) =>
          folder.id === state.driveDestinationId
      );

    if (!importSelectedStillExists) {
      state.driveDestinationId = "";
      state.driveDestinationName = "Books";
    }

    renderUploadDestinations();
    renderDriveImportDestinations();
  } catch (error) {
    state.driveFolders = [];
    state.uploadDestinationId = "";
    state.uploadDestinationName = "Books";
    state.driveDestinationId = "";
    state.driveDestinationName = "Books";
    renderUploadDestinations();
    renderDriveImportDestinations();

    const message =
      `Could not load book folders: ${getErrorMessage(error)}`;

    setMessage(
      elements.uploadDestinationMessage,
      message,
      "error"
    );
    setMessage(
      elements.destinationMessage,
      message,
      "error"
    );
  } finally {
    state.driveFoldersLoading = false;
    updateControls();
    updateDriveImportControls();
  }
}

/**
 * Return the display path stored for a destination folder.
 *
 * Direct children use their name. Folders created below another
 * destination keep the relative path from KOCloud/Books.
 *
 * @param {object} folder
 * @returns {string}
 */
function getDestinationFolderPath(folder) {
  return folder.destinationPath || folder.name || "";
}

/**
 * Join one child name onto a KOCloud/Books-relative path.
 *
 * @param {string} parentPath
 * @param {string} childName
 * @returns {string}
 */
function joinDestinationPath(parentPath, childName) {
  return parentPath
    ? `${parentPath}/${childName}`
    : childName;
}

/**
 * Remember one destination folder and its KOCloud/Books-relative path.
 *
 * @param {object} folder
 * @param {string} destinationPath
 * @returns {object}
 */
function rememberDriveDestinationFolder(
  folder,
  destinationPath
) {
  const rememberedFolder = {
    ...folder,
    destinationPath,
  };

  const existingIndex =
    state.driveFolders.findIndex(
      (candidate) => candidate.id === folder.id
    );

  if (existingIndex >= 0) {
    state.driveFolders[existingIndex] =
      rememberedFolder;
  } else {
    state.driveFolders.push(rememberedFolder);
  }

  state.driveFolders.sort(
    (left, right) =>
      getDestinationFolderPath(left).localeCompare(
        getDestinationFolderPath(right),
        undefined,
        {
          sensitivity: "base",
          numeric: true,
        }
      )
  );

  return rememberedFolder;
}

/**
 * Render the direct KOCloud/Books destination list for local uploads.
 */
function renderUploadDestinations() {
  const select = elements.uploadDestination;
  const previousValue =
    state.uploadDestinationId || "";

  select.replaceChildren();

  const rootOption =
    document.createElement("option");
  rootOption.value = "";
  rootOption.textContent =
    "KOCloud / Books";
  select.append(rootOption);

  for (const folder of state.driveFolders) {
    const option =
      document.createElement("option");

    option.value = folder.id;
    option.textContent =
      `KOCloud / Books / ${getDestinationFolderPath(folder)}`;
    select.append(option);
  }

  select.value = previousValue;
}

/**
 * Render the direct KOCloud/Books destination list.
 */
function renderDriveImportDestinations() {
  const select = elements.driveImportDestination;
  const previousValue =
    state.driveDestinationId || "";

  select.replaceChildren();

  const rootOption =
    document.createElement("option");
  rootOption.value = "";
  rootOption.textContent =
    "KOCloud / Books";
  select.append(rootOption);

  for (const folder of state.driveFolders) {
    const option =
      document.createElement("option");

    option.value = folder.id;
    option.textContent =
      `KOCloud / Books / ${getDestinationFolderPath(folder)}`;
    select.append(option);
  }

  select.value = previousValue;
}

/**
 * Return the currently selected local-upload destination folder ID.
 *
 * @returns {string}
 */
function getUploadDestinationFolderId() {
  return (
    state.uploadDestinationId ||
    state.storage?.books?.id ||
    ""
  );
}

/**
 * Return the local-upload destination path for UI messages.
 *
 * @returns {string}
 */
function getUploadDestinationPath() {
  if (!state.uploadDestinationId) {
    return "KOCloud/Books";
  }

  return (
    "KOCloud/Books/" +
    state.uploadDestinationName
  );
}

/**
 * Change the destination used by Add books.
 */
async function handleUploadDestinationChange() {
  if (state.busy || state.driveFoldersLoading) {
    return;
  }

  const folderId =
    elements.uploadDestination.value;

  const folder =
    state.driveFolders.find(
      (candidate) =>
        candidate.id === folderId
    ) || null;

  state.uploadDestinationId =
    folder?.id || "";
  state.uploadDestinationName =
    folder
      ? getDestinationFolderPath(folder)
      : "Books";

  clearMessage(elements.uploadDestinationMessage);

  if (state.queue.length > 0) {
    try {
      await refreshDuplicateStates();
    } catch (error) {
      setMessage(
        elements.uploadDestinationMessage,
        `Could not check destination duplicates: ${getErrorMessage(error)}`,
        "error"
      );
    }
  }

  updateControls();
}

/**
 * Create one direct subfolder under the current Add books destination.
 */
async function handleCreateUploadFolder() {
  if (state.busy || state.driveFoldersLoading) {
    return;
  }

  const accessToken = googleAuth.getAccessToken();
  const parentFolderId =
    getUploadDestinationFolderId();
  const parentDestinationPath =
    state.uploadDestinationId
      ? state.uploadDestinationName
      : "";
  const folderName =
    elements.newUploadFolderName.value.trim();

  if (!accessToken || !parentFolderId) {
    setMessage(
      elements.uploadDestinationMessage,
      "Connect Google Drive first.",
      "error"
    );
    return;
  }

  if (!folderName) {
    setMessage(
      elements.uploadDestinationMessage,
      "Enter a folder name first.",
      "error"
    );
    elements.newUploadFolderName.focus();
    return;
  }

  const normalizedFolderName =
    normalizeBookName(folderName);

  let existingFolder = null;

  try {
    const childFolders =
      await libraryService.listFolders(
        parentFolderId
      );

    existingFolder =
      childFolders.find(
        (folder) =>
          normalizeBookName(folder.name) ===
          normalizedFolderName
      ) || null;
  } catch (error) {
    setMessage(
      elements.uploadDestinationMessage,
      getErrorMessage(error),
      "error"
    );
    return;
  }

  if (existingFolder) {
    const destinationPath =
      joinDestinationPath(
        parentDestinationPath,
        existingFolder.name
      );

    const rememberedFolder =
      rememberDriveDestinationFolder(
        existingFolder,
        destinationPath
      );

    state.uploadDestinationId =
      rememberedFolder.id;
    state.uploadDestinationName =
      destinationPath;
    renderUploadDestinations();

    setMessage(
      elements.uploadDestinationMessage,
      `Folder already exists. Selected ${getUploadDestinationPath()}.`,
      "success"
    );

    if (state.queue.length > 0) {
      await refreshDuplicateStates();
    }
    return;
  }

  state.driveFoldersLoading = true;
  clearMessage(elements.uploadDestinationMessage);
  updateControls();
  updateDriveImportControls();

  try {
    const createdFolder =
      await libraryService.createFolder(
        parentFolderId,
        folderName
      );

    const destinationPath =
      joinDestinationPath(
        parentDestinationPath,
        createdFolder.name
      );

    const rememberedFolder =
      rememberDriveDestinationFolder(
        createdFolder,
        destinationPath
      );

    state.uploadDestinationId =
      rememberedFolder.id;
    state.uploadDestinationName =
      destinationPath;

    elements.newUploadFolderName.value = "";
    renderUploadDestinations();
    renderDriveImportDestinations();

    setMessage(
      elements.uploadDestinationMessage,
      `Created and selected ${getUploadDestinationPath()}.`,
      "success"
    );

    if (
      getCurrentLibraryFolderId() ===
      parentFolderId
    ) {
      await loadLibrary();
    }

    if (state.queue.length > 0) {
      await refreshDuplicateStates();
    }
  } catch (error) {
    setMessage(
      elements.uploadDestinationMessage,
      getErrorMessage(error),
      "error"
    );
  } finally {
    state.driveFoldersLoading = false;
    updateControls();
    updateDriveImportControls();
  }
}

/**
 * Return the currently selected destination folder ID.
 *
 * @returns {string}
 */
function getDriveDestinationFolderId() {
  return (
    state.driveDestinationId ||
    state.storage?.books?.id ||
    ""
  );
}

/**
 * Return the current destination path for UI messages.
 *
 * @returns {string}
 */
function getDriveDestinationPath() {
  if (!state.driveDestinationId) {
    return "KOCloud/Books";
  }

  return (
    "KOCloud/Books/" +
    state.driveDestinationName
  );
}

/**
 * Switch Drive-import destination and recompute duplicate state there.
 */
async function handleDriveDestinationChange() {
  if (
    state.busy ||
    state.driveImporting ||
    state.wholeFolderScanning ||
    state.wholeFolderImporting ||
    state.driveFoldersLoading
  ) {
    return;
  }

  const folderId =
    elements.driveImportDestination.value;

  const folder =
    state.driveFolders.find(
      (candidate) =>
        candidate.id === folderId
    ) || null;

  state.driveDestinationId =
    folder?.id || "";

  state.driveDestinationName =
    folder
      ? getDestinationFolderPath(folder)
      : "Books";

  clearMessage(elements.destinationMessage);

  if (state.wholeFolderPlan) {
    await refreshWholeFolderPlanForDestination();
  }

  if (state.driveSelection.length > 0) {
    try {
      await refreshDriveImportDuplicateStates();
    } catch (error) {
      setMessage(
        elements.destinationMessage,
        `Could not check destination duplicates: ${getErrorMessage(error)}`,
        "error"
      );
    }
  }

  updateDriveImportControls();
}

/**
 * Create one direct subfolder under the current Drive-import destination.
 */
async function handleCreateBookFolder() {
  if (
    state.busy ||
    state.driveImporting ||
    state.wholeFolderScanning ||
    state.wholeFolderImporting ||
    state.driveFoldersLoading
  ) {
    return;
  }

  const accessToken = googleAuth.getAccessToken();
  const parentFolderId =
    getDriveDestinationFolderId();
  const parentDestinationPath =
    state.driveDestinationId
      ? state.driveDestinationName
      : "";
  const folderName =
    elements.newBookFolderName.value.trim();

  if (!accessToken || !parentFolderId) {
    setMessage(
      elements.destinationMessage,
      "Connect Google Drive first.",
      "error"
    );
    return;
  }

  if (!folderName) {
    setMessage(
      elements.destinationMessage,
      "Enter a folder name first.",
      "error"
    );
    elements.newBookFolderName.focus();
    return;
  }

  const normalizedFolderName =
    normalizeBookName(folderName);

  let existingFolder = null;

  try {
    const childFolders =
      await libraryService.listFolders(
        parentFolderId
      );

    existingFolder =
      childFolders.find(
        (folder) =>
          normalizeBookName(folder.name) ===
          normalizedFolderName
      ) || null;
  } catch (error) {
    setMessage(
      elements.destinationMessage,
      getErrorMessage(error),
      "error"
    );
    return;
  }

  if (existingFolder) {
    const destinationPath =
      joinDestinationPath(
        parentDestinationPath,
        existingFolder.name
      );

    const rememberedFolder =
      rememberDriveDestinationFolder(
        existingFolder,
        destinationPath
      );

    state.driveDestinationId =
      rememberedFolder.id;
    state.driveDestinationName =
      destinationPath;

    renderUploadDestinations();
    renderDriveImportDestinations();

    if (state.wholeFolderPlan) {
      await refreshWholeFolderPlanForDestination();
    }

    setMessage(
      elements.destinationMessage,
      `Folder already exists. Selected ${getDriveDestinationPath()}.`,
      "success"
    );

    if (state.driveSelection.length > 0) {
      await refreshDriveImportDuplicateStates();
    }

    return;
  }

  state.driveFoldersLoading = true;
  clearMessage(elements.destinationMessage);
  updateDriveImportControls();

  try {
    const createdFolder =
      await libraryService.createFolder(
        parentFolderId,
        folderName
      );

    const destinationPath =
      joinDestinationPath(
        parentDestinationPath,
        createdFolder.name
      );

    const rememberedFolder =
      rememberDriveDestinationFolder(
        createdFolder,
        destinationPath
      );

    state.driveDestinationId =
      rememberedFolder.id;
    state.driveDestinationName =
      destinationPath;

    if (state.wholeFolderPlan) {
      await refreshWholeFolderPlanForDestination();
    }

    elements.newBookFolderName.value = "";
    renderUploadDestinations();
    renderDriveImportDestinations();

    setMessage(
      elements.destinationMessage,
      `Created and selected ${getDriveDestinationPath()}.`,
      "success"
    );

    if (
      getCurrentLibraryFolderId() ===
      parentFolderId
    ) {
      await loadLibrary();
    }

    if (state.driveSelection.length > 0) {
      await refreshDriveImportDuplicateStates();
    }
  } catch (error) {
    setMessage(
      elements.destinationMessage,
      getErrorMessage(error),
      "error"
    );
  } finally {
    state.driveFoldersLoading = false;
    updateDriveImportControls();
  }
}

/**
 * Open the hierarchical Google Drive source-folder browser.
 *
 * The browser starts at My Drive unless the current source was selected by
 * this browser, in which case it reopens at the same path.
 */
async function handleChooseDriveSourceFolder() {
  if (
    state.busy ||
    state.driveImporting ||
    state.driveSourceFolderPicking ||
    state.wholeFolderScanning ||
    state.wholeFolderImporting
  ) {
    return;
  }

  clearMessage(elements.driveImportMessage);

  const accessToken =
    googleAuth.getAccessToken();

  if (!accessToken) {
    setMessage(
      elements.driveImportMessage,
      "Connect Google Drive before choosing a source folder.",
      "error"
    );
    return;
  }

  const savedPath =
    state.driveSourceFolder?.pathEntries;

  state.driveSourceBrowserPath =
    Array.isArray(savedPath) && savedPath.length > 0
      ? savedPath.map((entry) => ({ ...entry }))
      : [{ id: "root", name: "My Drive" }];

  state.driveSourceFolderPicking = true;
  state.driveSourceBrowserFolders = [];
  renderDriveSourceBrowser();
  updateDriveImportControls();

  const loaded = await loadDriveSourceBrowserFolder();

  if (!loaded) {
    closeDriveSourceBrowser();
  }
}

/**
 * Return the folder currently displayed by the source-folder browser.
 *
 * @returns {object|null}
 */
function getCurrentDriveSourceBrowserFolder() {
  return (
    state.driveSourceBrowserPath[
      state.driveSourceBrowserPath.length - 1
    ] || null
  );
}

/**
 * Load only direct child folders for the current browser location.
 *
 * @returns {Promise<boolean>} whether loading succeeded
 */
async function loadDriveSourceBrowserFolder() {
  const accessToken = googleAuth.getAccessToken();
  const currentFolder =
    getCurrentDriveSourceBrowserFolder();

  if (!accessToken || !currentFolder?.id) {
    return false;
  }

  state.driveSourceBrowserLoading = true;
  renderDriveSourceBrowser();

  try {
    state.driveSourceBrowserFolders =
      await driveImportSource.listFolders(
        currentFolder.id
      );

    renderDriveSourceBrowser();
    return true;
  } catch (error) {
    state.driveSourceBrowserFolders = [];
    renderDriveSourceBrowser();

    setMessage(
      elements.driveImportMessage,
      `Could not load Drive folders: ${getErrorMessage(error)}`,
      "error"
    );

    return false;
  } finally {
    state.driveSourceBrowserLoading = false;
    renderDriveSourceBrowser();
  }
}

/**
 * Open one child folder in the source-folder browser.
 *
 * @param {object} folder
 */
async function handleOpenDriveSourceFolder(folder) {
  if (
    state.driveSourceBrowserLoading ||
    !folder?.id
  ) {
    return;
  }

  state.driveSourceBrowserPath.push({
    id: folder.id,
    name: folder.name || "Folder",
  });

  const loaded = await loadDriveSourceBrowserFolder();

  if (!loaded) {
    state.driveSourceBrowserPath.pop();
    renderDriveSourceBrowser();
  }
}

/**
 * Navigate to the parent folder in the source-folder browser.
 */
async function handleDriveSourceBack() {
  if (
    state.driveSourceBrowserLoading ||
    state.driveSourceBrowserPath.length <= 1
  ) {
    return;
  }

  const removedFolder =
    state.driveSourceBrowserPath.pop();

  const loaded = await loadDriveSourceBrowserFolder();

  if (!loaded && removedFolder) {
    state.driveSourceBrowserPath.push(removedFolder);
    renderDriveSourceBrowser();
  }
}

/**
 * Cancel source-folder browsing without changing the selected source.
 */
function handleCancelDriveSourceFolder() {
  if (state.driveSourceBrowserLoading) {
    return;
  }

  closeDriveSourceBrowser();
}

/**
 * Use the browser's current folder as the Drive import source.
 */
function handleUseDriveSourceFolder() {
  if (state.driveSourceBrowserLoading) {
    return;
  }

  const currentFolder =
    getCurrentDriveSourceBrowserFolder();

  if (!currentFolder?.id) {
    return;
  }

  const sourceChanged =
    state.driveSourceFolder?.id !== currentFolder.id;

  state.driveSourceFolder = {
    id: currentFolder.id,
    name: currentFolder.name || "Folder",
    pathEntries:
      state.driveSourceBrowserPath.map(
        (entry) => ({ ...entry })
      ),
  };

  if (sourceChanged) {
    state.driveSelection = [];
    clearWholeFolderPlan();
    renderDriveSelection();
  }

  renderDriveSourceFolder();
  closeDriveSourceBrowser();

  setMessage(
    elements.driveImportMessage,
    `Source folder selected: ${getDriveSourceFolderPath()}.`,
    "success"
  );
}

/**
 * Close and reset the source-folder browser.
 */
function closeDriveSourceBrowser() {
  state.driveSourceFolderPicking = false;
  state.driveSourceBrowserLoading = false;
  state.driveSourceBrowserFolders = [];
  state.driveSourceBrowserPath = [];
  renderDriveSourceBrowser();
  updateDriveImportControls();
}

/**
 * Return the selected Drive source path for display.
 *
 * @returns {string}
 */
function getDriveSourceFolderPath() {
  const folder = state.driveSourceFolder;

  if (!folder) {
    return "";
  }

  if (
    Array.isArray(folder.pathEntries) &&
    folder.pathEntries.length > 0
  ) {
    return folder.pathEntries
      .map((entry) => entry.name || "Folder")
      .join(" / ");
  }

  return folder.name || "Folder";
}

/**
 * Render the currently selected Drive source folder.
 */
function renderDriveSourceFolder() {
  const path = getDriveSourceFolderPath();

  elements.driveSourceFolder.textContent =
    path
      ? `Selected: ${path}`
      : "No source folder selected.";
}

/**
 * Render the hierarchical source-folder browser.
 */
function renderDriveSourceBrowser() {
  const open = state.driveSourceFolderPicking;

  elements.driveSourceBrowser.hidden = !open;

  if (!open) {
    elements.driveSourceList.replaceChildren();
    elements.driveSourceEmpty.hidden = true;
    return;
  }

  const pathNames =
    state.driveSourceBrowserPath.map(
      (entry) => entry.name || "Folder"
    );

  elements.driveSourcePath.textContent =
    pathNames.join(" / ") || "My Drive";

  elements.driveSourceBack.disabled =
    state.driveSourceBrowserLoading ||
    state.driveSourceBrowserPath.length <= 1;

  elements.cancelDriveSourceFolder.disabled =
    state.driveSourceBrowserLoading;

  elements.useDriveSourceFolder.disabled =
    state.driveSourceBrowserLoading ||
    !getCurrentDriveSourceBrowserFolder()?.id;

  elements.driveSourceList.replaceChildren();

  if (state.driveSourceBrowserLoading) {
    elements.driveSourceEmpty.hidden = false;
    elements.driveSourceEmpty.textContent =
      "Loading folders…";
    return;
  }

  const folders = state.driveSourceBrowserFolders;

  elements.driveSourceEmpty.hidden =
    folders.length > 0;

  elements.driveSourceEmpty.textContent =
    "This folder has no subfolders.";

  for (const folder of folders) {
    const item = document.createElement("li");
    item.className = "library-folder-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "library-folder-button";
    button.disabled = state.driveSourceBrowserLoading;

    const main = document.createElement("span");
    main.className = "library-folder-main";

    const icon = document.createElement("span");
    icon.className = "library-folder-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "📁";

    const name = document.createElement("span");
    name.className = "library-item-name";
    name.textContent = folder.name || "Folder";

    const arrow = document.createElement("span");
    arrow.className = "library-folder-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";

    main.append(icon, name);
    button.append(main, arrow);

    button.addEventListener(
      "click",
      () => handleOpenDriveSourceFolder(folder)
    );

    item.append(button);
    elements.driveSourceList.append(item);
  }
}

/**
 * Open Google Picker and preview selected Drive books.
 */
async function handleOpenDrivePicker() {
  if (
    state.busy ||
    state.driveImporting ||
    state.driveSourceFolderPicking
  ) {
    return;
  }

  clearMessage(elements.driveImportMessage);

  const accessToken = googleAuth.getAccessToken();
  const sourceFolder =
    state.driveSourceFolder;

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

  if (!sourceFolder?.id) {
    setMessage(
      elements.driveImportMessage,
      "Choose a source folder before selecting books.",
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
        accessToken,
        {
          parentId: sourceFolder.id,
          title:
            `Select books from ${sourceFolder.name}`,
        }
      );

    if (selectedBooks.length === 0) {
      return;
    }

    const supportedBooks =
      selectedBooks.filter((book) =>
        libraryService.isSupportedBook(book)
      );

    const unsupportedCount =
      selectedBooks.length -
      supportedBooks.length;

    if (supportedBooks.length === 0) {
      setMessage(
        elements.driveImportMessage,
        "No supported KOReader book formats were selected.",
        "error"
      );
      return;
    }

    clearWholeFolderPlan();

    state.driveSelection =
      importPlanner.createSelection(
        supportedBooks
      );

    const duplicateCount =
      await refreshDriveImportDuplicateStates();

    const duplicateText =
      duplicateCount > 0
        ? ` ${duplicateCount} duplicate` +
          `${duplicateCount === 1 ? "" : "s"} found; ` +
          "choose Skip, Replace, or Keep both."
        : ` Ready to import into ${getDriveDestinationPath()}.`;

    setMessage(
      elements.driveImportMessage,
      `${supportedBooks.length} Drive book` +
        `${supportedBooks.length === 1 ? "" : "s"} selected.` +
        (unsupportedCount > 0
          ? ` ${unsupportedCount} unsupported file` +
            `${unsupportedCount === 1 ? " was" : "s were"} skipped.`
          : "") +
        duplicateText,
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
      "Select books";

    updateDriveImportControls();
  }
}

/**
 * Build a read-only recursive import preview.
 */
async function handlePreviewWholeFolder() {
  if (
    state.busy ||
    state.driveImporting ||
    state.driveSourceFolderPicking ||
    state.wholeFolderScanning ||
    state.wholeFolderImporting
  ) {
    return;
  }

  const sourceFolder =
    state.driveSourceFolder;

  const destinationFolderId =
    getDriveDestinationFolderId();

  if (
    !googleAuth.getAccessToken() ||
    !sourceFolder?.id ||
    !destinationFolderId
  ) {
    setMessage(
      elements.driveImportMessage,
      "Choose a source folder and destination first.",
      "error"
    );
    return;
  }

  clearMessage(elements.driveImportMessage);

  state.driveSelection = [];
  renderDriveSelection();

  state.wholeFolderScanning = true;
  state.wholeFolderPlan = null;
  renderWholeFolderPreview();
  updateDriveImportControls();

  try {
    const tree =
      await driveImportSource.scanTree(
        sourceFolder
      );

    if (tree.bookCount === 0) {
      setMessage(
        elements.driveImportMessage,
        `No supported books were found in ${sourceFolder.name} or its subfolders.`,
        "success"
      );
      return;
    }

    state.wholeFolderPlan =
      await importPlanner.createWholeFolderPlan(
        tree,
        sourceFolder.id,
        destinationFolderId,
        getDriveDestinationPath()
      );

    const duplicateCount =
      state.wholeFolderPlan.duplicateCount;

    renderWholeFolderPreview();

    setMessage(
      elements.driveImportMessage,
      `Whole-folder preview ready: ${tree.bookCount} book` +
        `${tree.bookCount === 1 ? "" : "s"}, ` +
        `${tree.folderCount} folder` +
        `${tree.folderCount === 1 ? "" : "s"}, ` +
        `${duplicateCount} duplicate` +
        `${duplicateCount === 1 ? "" : "s"}.`,
      "success"
    );
  } catch (error) {
    state.wholeFolderPlan = null;
    renderWholeFolderPreview();

    setMessage(
      elements.driveImportMessage,
      `Could not scan whole source folder: ${getErrorMessage(error)}`,
      "error"
    );
  } finally {
    state.wholeFolderScanning = false;
    renderWholeFolderPreview();
    updateDriveImportControls();
  }
}

/**
 * Refresh the recursive preview after the destination changes.
 *
 * The source tree is reused; only destination duplicate analysis is repeated.
 * This avoids forcing the user to scan the source folder again.
 */
async function refreshWholeFolderPlanForDestination() {
  const plan = state.wholeFolderPlan;

  if (
    !plan ||
    state.wholeFolderScanning ||
    state.wholeFolderImporting
  ) {
    return;
  }

  const destinationFolderId =
    getDriveDestinationFolderId();

  if (
    !googleAuth.getAccessToken() ||
    !destinationFolderId
  ) {
    return;
  }

  state.wholeFolderScanning = true;
  updateDriveImportControls();
  renderWholeFolderPreview();

  try {
    state.wholeFolderPlan =
      await importPlanner.refreshWholeFolderPlan(
        plan,
        destinationFolderId,
        getDriveDestinationPath()
      );

    const duplicateCount =
      state.wholeFolderPlan.duplicateCount;

    renderWholeFolderPreview();

    setMessage(
      elements.driveImportMessage,
      `Destination updated: ${plan.tree.bookCount} book` +
        `${plan.tree.bookCount === 1 ? "" : "s"}, ` +
        `${plan.tree.folderCount} folder` +
        `${plan.tree.folderCount === 1 ? "" : "s"}, ` +
        `${duplicateCount} duplicate` +
        `${duplicateCount === 1 ? "" : "s"}.`,
      "success"
    );
  } catch (error) {
    setMessage(
      elements.driveImportMessage,
      `Could not refresh destination preview: ${getErrorMessage(error)}`,
      "error"
    );
  } finally {
    state.wholeFolderScanning = false;
    renderWholeFolderPreview();
    updateDriveImportControls();
  }
}

/**
 * Clear the recursive import preview.
 */
function clearWholeFolderPlan() {
  if (state.wholeFolderImporting) {
    return;
  }

  state.wholeFolderPlan = null;
  renderWholeFolderPreview();
  updateDriveImportControls();
}

/**
 * Store the global duplicate policy for recursive import.
 */
function handleWholeFolderDuplicatePolicyChange() {
  const policy =
    elements.wholeFolderDuplicatePolicy.value;

  if (
    policy !== "skip" &&
    policy !== "replace" &&
    policy !== "keep-both"
  ) {
    return;
  }

  state.wholeFolderDuplicatePolicy =
    policy;
}

/**
 * Render recursive whole-folder preview state.
 */
function renderWholeFolderPreview() {
  const plan =
    state.wholeFolderPlan;

  elements.wholeFolderPreview.hidden =
    !plan &&
    !state.wholeFolderScanning;

  if (state.wholeFolderScanning) {
    elements.wholeFolderSummary.textContent =
      "Scanning whole folder…";

    elements.wholeFolderTarget.textContent =
      "Reading source folders and checking destination duplicates.";

    return;
  }

  if (!plan) {
    elements.wholeFolderSummary.textContent =
      "Folder + subfolders";
    elements.wholeFolderTarget.textContent = "";
    return;
  }

  const tree = plan.tree;

  elements.wholeFolderSummary.textContent =
    `${tree.bookCount} book` +
    `${tree.bookCount === 1 ? "" : "s"} · ` +
    `${tree.folderCount} folder` +
    `${tree.folderCount === 1 ? "" : "s"} · ` +
    `${plan.duplicateCount} duplicate` +
    `${plan.duplicateCount === 1 ? "" : "s"}`;

  elements.wholeFolderTarget.textContent =
    `Destination: ${plan.destinationPath}/${tree.name}`;

  elements.wholeFolderDuplicatePolicy.value =
    state.wholeFolderDuplicatePolicy;
}

/**
 * Apply the current recursive whole-folder import preview.
 */
async function handleImportWholeFolder() {
  if (
    state.busy ||
    state.driveImporting ||
    state.wholeFolderScanning ||
    state.wholeFolderImporting
  ) {
    return;
  }

  const plan = state.wholeFolderPlan;

  if (!plan || !googleAuth.getAccessToken()) {
    setMessage(
      elements.driveImportMessage,
      "Preview the whole folder before importing.",
      "error"
    );
    return;
  }

  if (
    state.driveSourceFolder?.id !==
      plan.sourceFolderId
  ) {
    clearWholeFolderPlan();

    setMessage(
      elements.driveImportMessage,
      "Source folder changed. Select the folder + subfolders mode again.",
      "error"
    );
    return;
  }

  state.wholeFolderImporting = true;
  updateDriveImportControls();

  try {
    const counts =
      await importExecutor.importWholeFolder(
        plan,
        state.wholeFolderDuplicatePolicy
      );

    const resultParts = [];

    if (counts.imported > 0) {
      resultParts.push(
        `${counts.imported} imported`
      );
    }

    if (counts.replaced > 0) {
      resultParts.push(
        `${counts.replaced} replaced`
      );
    }

    if (counts.skipped > 0) {
      resultParts.push(
        `${counts.skipped} skipped`
      );
    }

    if (counts.blocked > 0) {
      resultParts.push(
        `${counts.blocked} blocked`
      );
    }

    if (counts.failed > 0) {
      resultParts.push(
        `${counts.failed} failed`
      );
    }

    setMessage(
      elements.driveImportMessage,
      resultParts.length > 0
        ? `Whole folder import complete: ${resultParts.join(", ")}.`
        : "Whole folder import completed with no file changes.",
      counts.blocked > 0 ||
        counts.failed > 0
        ? "error"
        : "success"
    );

    await loadDriveImportFolders();
    await loadLibrary();

    state.wholeFolderPlan = null;
    renderWholeFolderPreview();
  } catch (error) {
    setMessage(
      elements.driveImportMessage,
      `Whole folder import failed: ${getErrorMessage(error)}`,
      "error"
    );
  } finally {
    state.wholeFolderImporting = false;
    renderWholeFolderPreview();
    updateDriveImportControls();
  }
}

/**
 * Compare Drive-import selections with KOCloud/Books and with each other.
 *
 * @returns {Promise<number>} duplicate item count
 */
async function refreshDriveImportDuplicateStates() {
  const destinationFolderId =
    getDriveDestinationFolderId();

  if (
    !googleAuth.getAccessToken() ||
    !destinationFolderId
  ) {
    renderDriveSelection();
    return 0;
  }

  const duplicateCount =
    await importPlanner.refreshSelectionDuplicates(
      state.driveSelection,
      destinationFolderId
    );

  renderDriveSelection();
  return duplicateCount;
}

/**
 * Change the selected action for one Drive-import duplicate.
 *
 * @param {string} fileId
 * @param {"skip"|"replace"|"keep-both"} action
 */
function setDriveImportDuplicateAction(
  fileId,
  action
) {
  if (state.busy || state.driveImporting) {
    return;
  }

  const book = state.driveSelection.find(
    (candidate) => candidate.id === fileId
  );

  if (
    !book ||
    book.importStatus !== "duplicate"
  ) {
    return;
  }

  book.duplicateAction = action;
  renderDriveSelection();
}

/**
 * Clear the current Google Drive import preview.
 */
function handleClearDriveSelection() {
  if (
    state.busy ||
    state.driveImporting
  ) {
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
    item.dataset.state = book.importStatus;
    item.dataset.duplicateAction =
      book.duplicateAction || "skip";

    const main = document.createElement("div");
    main.className = "queue-item-main";

    const name = document.createElement("div");
    name.className = "queue-item-name";
    name.textContent = book.name;

    const type = document.createElement("div");
    type.className = "queue-item-size";
    type.textContent =
      getBookFormatLabel(book.name);

    main.append(name, type);

    const status = document.createElement("div");
    status.className = "queue-item-status";
    status.textContent =
      getDriveImportStatusText(book);

    if (
      book.importStatus === "done" ||
      book.importStatus === "replaced"
    ) {
      status.classList.add("status-success");
    } else if (
      book.importStatus === "error" ||
      book.importStatus === "blocked"
    ) {
      status.classList.add("status-error");
    }

    const actions =
      document.createElement("div");
    actions.className = "queue-item-actions";
    actions.hidden =
      book.importStatus !== "duplicate";

    if (book.importStatus === "duplicate") {
      for (const action of [
        {
          id: "skip",
          label: "Skip",
        },
        {
          id: "replace",
          label: "Replace",
        },
        {
          id: "keep-both",
          label: "Keep both",
        },
      ]) {
        const button =
          document.createElement("button");

        button.type = "button";
        button.className =
          "queue-action-button";
        button.dataset.action = action.id;
        button.textContent = action.label;
        button.disabled =
          state.busy ||
          state.driveImporting ||
          book.duplicateAction === action.id;

        button.addEventListener(
          "click",
          () => {
            setDriveImportDuplicateAction(
              book.id,
              action.id
            );
          }
        );

        actions.append(button);
      }
    }

    item.append(main, status, actions);
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
    !state.driveSourceFolderPicking &&
    !state.wholeFolderScanning &&
    !state.wholeFolderImporting &&
    googleAuth.isConnected();

  const pickerReady =
    ready &&
    googleDrivePicker.isConfigured();

  const hasSourceFolder =
    Boolean(state.driveSourceFolder?.id);

  const canOpenPicker =
    pickerReady &&
    hasSourceFolder;

  const canScanSource =
    ready &&
    hasSourceFolder;

  const canImport =
    ready &&
    Boolean(state.storage?.books?.id) &&
    state.driveSelection.some(
      (book) =>
        book.importStatus !== "done" &&
        book.importStatus !== "replaced" &&
        book.importStatus !== "skipped" &&
        book.importStatus !== "blocked"
    );

  elements.chooseDriveSourceFolder.disabled =
    !ready;

  elements.chooseDriveSourceFolder.textContent =
    state.driveSourceFolderPicking
      ? "Choosing source folder…"
      : state.driveSourceFolder
        ? "Change source folder"
        : "Choose source folder";

  elements.openDrivePicker.disabled =
    !canOpenPicker;

  elements.previewWholeFolder.disabled =
    !canScanSource;

  elements.previewWholeFolder.textContent =
    state.wholeFolderScanning
      ? "Scanning whole folder…"
      : state.wholeFolderPlan
        ? "Refresh folder + subfolders"
        : "This folder + subfolders";

  elements.importWholeFolder.disabled =
    !ready ||
    !state.wholeFolderPlan;

  elements.importWholeFolder.textContent =
    state.wholeFolderImporting
      ? "Importing whole folder…"
      : "Confirm import";

  elements.wholeFolderDuplicatePolicy.disabled =
    state.wholeFolderImporting;

  elements.clearWholeFolderPreview.disabled =
    state.wholeFolderImporting ||
    !state.wholeFolderPlan;

  elements.clearDriveSelection.disabled =
    !ready ||
    state.driveSelection.length === 0;

  elements.importDriveBooks.disabled =
    !canImport;

  elements.importDriveBooks.textContent =
    state.driveImporting
      ? "Importing…"
      : "Import selected books";

  const destinationReady =
    !state.busy &&
    !state.driveImporting &&
    !state.wholeFolderScanning &&
    !state.wholeFolderImporting &&
    !state.driveFoldersLoading &&
    googleAuth.isConnected() &&
    Boolean(state.storage?.books?.id);

  elements.driveImportDestination.disabled =
    !destinationReady;

  elements.newBookFolderName.disabled =
    !destinationReady;

  elements.createBookFolder.disabled =
    !destinationReady;
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

  const destinationFolderId =
    getDriveDestinationFolderId();

  if (
    !googleAuth.getAccessToken() ||
    !destinationFolderId
  ) {
    setMessage(
      elements.driveImportMessage,
      "Connect Google Drive and choose a destination first.",
      "error"
    );
    return;
  }

  const hasPendingBooks =
    state.driveSelection.some(
      (book) =>
        book.importStatus !== "done" &&
        book.importStatus !== "replaced" &&
        book.importStatus !== "skipped" &&
        book.importStatus !== "blocked"
    );

  if (!hasPendingBooks) {
    return;
  }

  state.driveImporting = true;
  clearMessage(elements.driveImportMessage);
  updateDriveImportControls();

  try {
    const counts =
      await importExecutor.importSelection(
        state.driveSelection,
        destinationFolderId,
        getDriveDestinationPath(),
        () => renderDriveSelection()
      );

    if (
      (counts.imported > 0 ||
        counts.replaced > 0) &&
      getCurrentLibraryFolderId() ===
        destinationFolderId
    ) {
      await loadLibrary();
    }

    const parts = [];

    if (counts.imported > 0) {
      parts.push(`${counts.imported} imported`);
    }

    if (counts.replaced > 0) {
      parts.push(`${counts.replaced} replaced`);
    }

    if (counts.skipped > 0) {
      parts.push(`${counts.skipped} skipped`);
    }

    if (counts.blocked > 0) {
      parts.push(
        `${counts.blocked} cannot be copied`
      );
    }

    if (counts.failed > 0) {
      parts.push(`${counts.failed} failed`);
    }

    const message = parts.length > 0
      ? `${parts.join(", ")}.`
      : "No books were imported.";

    setMessage(
      elements.driveImportMessage,
      message,
      counts.failed > 0 ? "error" : "success"
    );
  } catch (error) {
    setMessage(
      elements.driveImportMessage,
      `Could not prepare Drive import: ${getErrorMessage(error)}`,
      "error"
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
    case "duplicate":
      if (book.duplicateAction === "replace") {
        return "Already exists · Replace selected";
      }

      if (book.duplicateAction === "keep-both") {
        return "Already exists · Keep both selected";
      }

      return "Already exists · Skip selected";
    case "checking":
      return "Checking copy permission…";
    case "importing":
      return "Importing…";
    case "done":
      return "Imported to KOCloud/Books";
    case "replaced":
      return "Replaced";
    case "skipped":
      return "Skipped · already exists";
    case "blocked":
      return "This file cannot be copied";
    case "error":
      return "Import failed";
    default:
      return "Selected from Google Drive";
  }
}

/**
 * Register supported book files that already exist in the current My Books folder.
 *
 * The Picker is deliberately scoped to the current folder. Registration only
 * adds KOCloud appProperties; it does not copy, move, rename, or replace the
 * selected Drive file.
 */
async function handleRegisterFolderBooks() {
  if (
    state.busy ||
    state.libraryLoading ||
    state.registeringFolderBooks ||
    state.registeringAllFolderBooks
  ) {
    return;
  }

  const accessToken = googleAuth.getAccessToken();
  const currentFolderId =
    getCurrentLibraryFolderId();

  if (!accessToken || !currentFolderId) {
    setMessage(
      elements.libraryMessage,
      "Connect Google Drive and open a library folder first.",
      "error"
    );
    return;
  }

  clearMessage(elements.libraryMessage);
  state.registeringFolderBooks = true;
  updateLibraryControls();

  try {
    const selectedBooks =
      await googleDrivePicker.pickBooks(
        accessToken,
        {
          parentId: currentFolderId,
          title: "Register selected books",
        }
      );

    if (selectedBooks.length === 0) {
      return;
    }

    let registered = 0;
    let alreadyRegistered = 0;
    let readOnly = 0;
    let outsideFolder = 0;
    let unsupported = 0;
    let failed = 0;

    for (const selected of selectedBooks) {
      if (!libraryService.isSupportedBook(selected)) {
        unsupported += 1;
        continue;
      }

      try {
        // Picker normally returns parentId for a scoped DocsView. If it does,
        // use that direct selection context instead of trying to infer folder
        // membership through Drive listing under drive.file.
        if (
          selected.parentId &&
          selected.parentId !== currentFolderId
        ) {
          outsideFolder += 1;
          continue;
        }

        const source =
          await libraryService.getRegistrationSource(
            selected.id
          );

        const appProperties =
          source.appProperties || {};

        if (
          appProperties[KOCloudProtocol.metadataKeys.role] ===
            KOCloudProtocol.roles.book
        ) {
          alreadyRegistered += 1;
          continue;
        }

        if (
          source.capabilities &&
          source.capabilities.canEdit === false
        ) {
          readOnly += 1;
          continue;
        }

        await libraryService.registerExistingBook(
          source.id,
          appProperties
        );

        registered += 1;
      } catch (error) {
        console.error(
          "KOCloud register book failed:",
          selected,
          error
        );
        failed += 1;
      }
    }

    if (registered > 0) {
      await loadLibrary();
    }

    const parts = [];

    if (registered > 0) {
      parts.push(
        `${registered} registered`
      );
    }

    if (alreadyRegistered > 0) {
      parts.push(
        `${alreadyRegistered} already registered`
      );
    }

    if (readOnly > 0) {
      parts.push(
        `${readOnly} read-only`
      );
    }

    if (outsideFolder > 0) {
      parts.push(
        `${outsideFolder} outside this folder`
      );
    }

    if (unsupported > 0) {
      parts.push(
        `${unsupported} unsupported`
      );
    }

    if (failed > 0) {
      parts.push(
        `${failed} failed`
      );
    }

    setMessage(
      elements.libraryMessage,
      parts.length > 0
        ? `${parts.join(", ")}.`
        : "No books were registered.",
      failed > 0 || readOnly > 0
        ? "error"
        : "success"
    );
  } catch (error) {
    setMessage(
      elements.libraryMessage,
      getErrorMessage(error),
      "error"
    );
  } finally {
    state.registeringFolderBooks = false;
    updateLibraryControls();
  }
}

/**
 * Register all supported book files directly inside the current My Books folder.
 *
 * This operation is non-recursive and only adds KOCloud appProperties in
 * place. It never copies, moves, renames, replaces, or deletes files.
 */
async function handleRegisterAllFolderBooks() {
  if (
    state.busy ||
    state.libraryLoading ||
    state.registeringFolderBooks ||
    state.registeringAllFolderBooks
  ) {
    return;
  }

  const accessToken = googleAuth.getAccessToken();
  const currentFolderId =
    getCurrentLibraryFolderId();

  if (!accessToken || !currentFolderId) {
    setMessage(
      elements.libraryMessage,
      "Connect Google Drive and open a library folder first.",
      "error"
    );
    return;
  }

  clearMessage(elements.libraryMessage);
  state.registeringAllFolderBooks = true;
  updateLibraryControls();

  try {
    const directFiles =
      await libraryService.listFiles(
        currentFolderId
      );

    const books =
      directFiles.filter((file) =>
        libraryService.isSupportedBook(file)
      );

    if (books.length === 0) {
      setMessage(
        elements.libraryMessage,
        "No supported book files were found directly in this folder.",
        "success"
      );
      return;
    }

    let registered = 0;
    let alreadyRegistered = 0;
    let readOnly = 0;
    let failed = 0;

    for (const book of books) {
      try {
        const source =
          await libraryService.getRegistrationSource(
            book.id
          );

        const appProperties =
          source.appProperties || {};

        if (
          appProperties[KOCloudProtocol.metadataKeys.role] ===
            KOCloudProtocol.roles.book
        ) {
          alreadyRegistered += 1;
          continue;
        }

        if (
          source.capabilities &&
          source.capabilities.canEdit === false
        ) {
          readOnly += 1;
          continue;
        }

        await libraryService.registerExistingBook(
          source.id,
          appProperties
        );

        registered += 1;
      } catch (error) {
        console.error(
          "KOCloud bulk register failed:",
          book,
          error
        );
        failed += 1;
      }
    }

    if (registered > 0) {
      await loadLibrary();
    }

    const parts = [];

    if (registered > 0) {
      parts.push(`${registered} registered`);
    }

    if (alreadyRegistered > 0) {
      parts.push(
        `${alreadyRegistered} already registered`
      );
    }

    if (readOnly > 0) {
      parts.push(`${readOnly} read-only`);
    }

    if (failed > 0) {
      parts.push(`${failed} failed`);
    }

    setMessage(
      elements.libraryMessage,
      parts.length > 0
        ? `${parts.join(", ")}.`
        : "No books needed registration.",
      readOnly > 0 || failed > 0
        ? "error"
        : "success"
    );
  } catch (error) {
    setMessage(
      elements.libraryMessage,
      `Could not scan this folder: ${getErrorMessage(error)}`,
      "error"
    );
  } finally {
    state.registeringAllFolderBooks = false;
    updateLibraryControls();
  }
}

/**
 * Refresh the current KOCloud library folder.
 */
async function handleRefreshLibrary() {
  if (state.busy || state.libraryLoading) {
    return;
  }

  await loadLibrary();
}

/**
 * Return the current library folder ID.
 *
 * @returns {string}
 */
function getCurrentLibraryFolderId() {
  const current =
    state.libraryPath[
      state.libraryPath.length - 1
    ];

  return (
    current?.id ||
    state.storage?.books?.id ||
    ""
  );
}

/**
 * Ensure My Books starts at the managed Books root.
 */
function ensureLibraryRootPath() {
  const books = state.storage?.books;

  if (!books?.id) {
    state.libraryPath = [];
    return;
  }

  const currentRoot = state.libraryPath[0];

  if (
    !currentRoot ||
    currentRoot.id !== books.id
  ) {
    state.libraryPath = [
      {
        id: books.id,
        name: books.name || "Books",
      },
    ];
  }
}

/**
 * Load direct folders and books in the current My Books location.
 *
 * @returns {Promise<boolean>} whether the folder loaded successfully
 */
async function loadLibrary() {
  const accessToken = googleAuth.getAccessToken();
  const booksFolderId = state.storage?.books?.id;

  if (!accessToken || !booksFolderId) {
    state.libraryBooks = [];
    state.libraryFolders = [];
    state.libraryPath = [];
    renderLibrary();
    return false;
  }

  ensureLibraryRootPath();

  const currentFolderId =
    getCurrentLibraryFolderId();

  state.libraryLoading = true;
  updateLibraryControls();
  clearMessage(elements.libraryMessage);

  try {
    const { folders, books } =
      await libraryService.listFolder(
        currentFolderId
      );

    folders.sort(compareLibraryFolders);
    books.sort(compareLibraryBooks);

    state.libraryFolders = folders;
    state.libraryBooks = books;
    renderLibrary();

    return true;
  } catch (error) {
    setMessage(
      elements.libraryMessage,
      `Could not load library: ${getErrorMessage(error)}`,
      "error"
    );

    return false;
  } finally {
    state.libraryLoading = false;
    updateLibraryControls();
  }
}

/**
 * Open one child folder in My Books.
 *
 * @param {object} folder
 */
async function handleOpenLibraryFolder(folder) {
  if (
    state.busy ||
    state.libraryLoading ||
    !folder?.id
  ) {
    return;
  }

  state.libraryPath.push({
    id: folder.id,
    name: folder.name || "Folder",
  });

  const loaded = await loadLibrary();

  if (!loaded) {
    state.libraryPath.pop();
    renderLibraryNavigation();
  }
}

/**
 * Navigate to the parent My Books folder.
 */
async function handleLibraryBack() {
  if (
    state.busy ||
    state.libraryLoading ||
    state.libraryPath.length <= 1
  ) {
    return;
  }

  const removedFolder =
    state.libraryPath.pop();

  const loaded = await loadLibrary();

  if (!loaded && removedFolder) {
    state.libraryPath.push(removedFolder);
    renderLibraryNavigation();
  }
}

/**
 * Sort library folders by name.
 *
 * @param {object} left
 * @param {object} right
 * @returns {number}
 */
function compareLibraryFolders(left, right) {
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
 * Render the current KOCloud folder.
 */
function renderLibrary() {
  const connected =
    googleAuth.isConnected() &&
    Boolean(state.storage?.books?.id);

  renderLibraryNavigation();

  if (!connected) {
    elements.libraryEmpty.hidden = false;
    elements.libraryEmpty.textContent =
      "Connect Google Drive to load your library.";
    elements.libraryContent.hidden = true;
    elements.libraryList.replaceChildren();
    elements.librarySummary.textContent =
      "0 folders · 0 books";
    updateLibraryControls();
    return;
  }

  const folders = state.libraryFolders;
  const books = state.libraryBooks;
  const totalItems =
    folders.length + books.length;

  elements.librarySummary.textContent =
    formatLibrarySummary(
      folders.length,
      books.length
    );

  elements.libraryList.replaceChildren();

  if (totalItems === 0) {
    elements.libraryEmpty.hidden = false;
    elements.libraryEmpty.textContent =
      "This folder is empty.";
    elements.libraryContent.hidden = true;
    updateLibraryControls();
    return;
  }

  elements.libraryEmpty.hidden = true;
  elements.libraryContent.hidden = false;

  for (const folder of folders) {
    elements.libraryList.append(
      createLibraryFolderElement(folder)
    );
  }

  for (const book of books) {
    elements.libraryList.append(
      createLibraryItemElement(book)
    );
  }

  updateLibraryControls();
}

/**
 * Render My Books path and Back control.
 */
function renderLibraryNavigation() {
  const connected =
    googleAuth.isConnected() &&
    Boolean(state.storage?.books?.id);

  elements.libraryNavigation.hidden =
    !connected;

  if (!connected) {
    elements.libraryPath.textContent =
      "KOCloud / Books";
    elements.libraryBack.disabled = true;
    return;
  }

  ensureLibraryRootPath();

  const pathNames =
    state.libraryPath.map(
      (entry) => entry.name || "Folder"
    );

  elements.libraryPath.textContent =
    ["KOCloud", ...pathNames].join(" / ");

  elements.libraryBack.disabled =
    state.busy ||
    state.libraryLoading ||
    state.libraryPath.length <= 1;
}

/**
 * Format folder/book counts for the current location.
 *
 * @param {number} folderCount
 * @param {number} bookCount
 * @returns {string}
 */
function formatLibrarySummary(
  folderCount,
  bookCount
) {
  return (
    `${folderCount} folder` +
    `${folderCount === 1 ? "" : "s"} · ` +
    `${bookCount} book` +
    `${bookCount === 1 ? "" : "s"}`
  );
}

/**
 * Create one clickable folder row.
 *
 * @param {object} folder
 * @returns {HTMLLIElement}
 */
function createLibraryFolderElement(folder) {
  const li = document.createElement("li");
  li.className =
    "library-item library-folder-item";

  const button =
    document.createElement("button");
  button.type = "button";
  button.className =
    "library-folder-button";
  button.setAttribute(
    "aria-label",
    `Open folder ${folder.name || "Folder"}`
  );

  const main =
    document.createElement("span");
  main.className =
    "library-folder-main";

  const icon =
    document.createElement("span");
  icon.className =
    "library-folder-icon";
  icon.setAttribute(
    "aria-hidden",
    "true"
  );
  icon.textContent = "📁";

  const name =
    document.createElement("span");
  name.className =
    "library-item-name";
  name.textContent =
    folder.name || "Untitled folder";

  main.append(icon, name);

  const arrow =
    document.createElement("span");
  arrow.className =
    "library-folder-arrow";
  arrow.setAttribute(
    "aria-hidden",
    "true"
  );
  arrow.textContent = "›";

  button.append(main, arrow);

  button.addEventListener(
    "click",
    () => {
      handleOpenLibraryFolder(folder);
    }
  );

  li.append(button);
  return li;
}

/**
 * Create one read-only book row.
 *
 * @param {object} book
 * @returns {HTMLLIElement}
 */
function createLibraryItemElement(book) {
  const li = document.createElement("li");
  li.className =
    "library-item library-book-item";

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
 * Enable/disable My Books navigation controls.
 */
function updateLibraryControls() {
  const ready =
    !state.busy &&
    !state.libraryLoading &&
    googleAuth.isConnected() &&
    Boolean(state.storage?.books?.id);

  elements.refreshLibrary.disabled =
    !ready;

  elements.refreshLibrary.textContent =
    state.libraryLoading
      ? "Refreshing…"
      : "Refresh";

  elements.libraryBack.disabled =
    !ready ||
    state.libraryPath.length <= 1;

  elements.registerFolderBooks.disabled =
    !ready ||
    state.registeringFolderBooks ||
    state.registeringAllFolderBooks ||
    !googleDrivePicker.isConfigured();

  elements.registerFolderBooks.textContent =
    state.registeringFolderBooks
      ? "Registering selected…"
      : "Register selected books";

  elements.registerAllFolderBooks.disabled =
    !ready ||
    state.registeringFolderBooks ||
    state.registeringAllFolderBooks;

  elements.registerAllFolderBooks.textContent =
    state.registeringAllFolderBooks
      ? "Registering all…"
      : "Register all books in this folder";
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
    if (libraryService.isSupportedBook(file)) {
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
        "Only KOReader-supported book formats are accepted.",
      "error"
    );
  }
}

/**
 * Compare queued files with files in the selected upload destination.
 */
async function refreshDuplicateStates() {
  const accessToken = googleAuth.getAccessToken();
  const destinationFolderId =
    getUploadDestinationFolderId();

  if (!accessToken || !destinationFolderId) {
    return;
  }

  const existingBooks =
    await libraryService.listFiles(
      destinationFolderId
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
  const destinationFolderId =
    getUploadDestinationFolderId();

  if (!accessToken) {
    setMessage(
      elements.uploadMessage,
      "Google authorization is no longer available. Connect Google Drive again.",
      "error"
    );
    return;
  }

  if (!destinationFolderId) {
    setMessage(
      elements.uploadMessage,
      "Choose a destination before uploading books.",
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
      await libraryService.listFiles(
        destinationFolderId
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
            await libraryService.createReplaceSession(
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
            await libraryService.createUploadSession(
              item.file,
              destinationFolderId,
              driveName
            );
        }

        const task = new BrowserUploadTask(
          sessionUrl,
          item.file,
          libraryService.getBookMimeType(item.file)
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
      `${parts.join(", ")}. Destination: ${getUploadDestinationPath()}.`,
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
    state.libraryFolders = [];
    state.libraryPath = [];
    state.driveFolders = [];
    state.driveDestinationId = "";
    state.driveDestinationName = "Books";
    renderDriveImportDestinations();
    disableBookSelection();
    setDisconnectedState();
    renderLibrary();
    updateDriveImportControls();
  }

  if (event.type === "error") {
    state.storage = null;
    state.libraryBooks = [];
    state.libraryFolders = [];
    state.libraryPath = [];
    state.driveFolders = [];
    state.driveDestinationId = "";
    state.driveDestinationName = "Books";
    renderDriveImportDestinations();
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
  state.driveSourceFolder = null;
  state.driveSourceFolderPicking = false;
  state.driveSourceBrowserFolders = [];
  state.driveSourceBrowserPath = [];
  state.driveSourceBrowserLoading = false;
  state.wholeFolderPlan = null;
  state.driveSelection = [];
  renderDriveSourceFolder();
  renderDriveSourceBrowser();
  renderWholeFolderPreview();
  renderDriveSelection();
  setConnectionStatus(
    "Google Drive: Not connected",
    "disconnected"
  );

  state.storage = null;
  state.libraryBooks = [];
  state.libraryFolders = [];
  state.libraryPath = [];
  state.driveFolders = [];
  state.uploadDestinationId = "";
  state.uploadDestinationName = "Books";
  state.driveDestinationId = "";
  state.driveDestinationName = "Books";
  renderUploadDestinations();
  renderDriveImportDestinations();

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
  const destinationReady =
    !state.busy &&
    googleAuth.isConnected() &&
    Boolean(state.storage?.books?.id) &&
    !state.driveFoldersLoading;

  const canUpload =
    destinationReady &&
    Boolean(getUploadDestinationFolderId()) &&
    state.queue.some(
      (item) =>
        item.status === "waiting" ||
        item.status === "error" ||
        item.status === "duplicate"
    );

  elements.uploadDestination.disabled =
    !destinationReady;
  elements.newUploadFolderName.disabled =
    !destinationReady;
  elements.createUploadFolder.disabled =
    !destinationReady;

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
