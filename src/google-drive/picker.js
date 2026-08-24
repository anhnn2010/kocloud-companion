const PICKER_API_KEY_STORAGE_KEY =
  "kocloud_google_picker_api_key";

const PICKER_APP_ID_STORAGE_KEY =
  "kocloud_google_picker_app_id";

const PICKER_SCRIPT_URL =
  "https://apis.google.com/js/api.js";

const BOOK_MIME_TYPES = [
  "application/epub+zip",
  "application/pdf",
];

let pickerLibraryPromise = null;

/**
 * Google Picker helper for importing books already stored in Google Drive.
 */
export class GoogleDrivePicker {
  /**
   * @returns {{apiKey: string, appId: string}}
   */
  getConfig() {
    return {
      apiKey:
        localStorage.getItem(
          PICKER_API_KEY_STORAGE_KEY
        ) || "",
      appId:
        localStorage.getItem(
          PICKER_APP_ID_STORAGE_KEY
        ) || "",
    };
  }

  /**
   * @param {{apiKey: string, appId: string}} config
   */
  saveConfig({ apiKey, appId }) {
    const normalizedApiKey = apiKey.trim();
    const normalizedAppId = appId.trim();

    if (!normalizedApiKey) {
      throw new Error(
        "Google Picker API key is required."
      );
    }

    if (!normalizedAppId) {
      throw new Error(
        "Google Cloud project number is required."
      );
    }

    if (!/^\d+$/.test(normalizedAppId)) {
      throw new Error(
        "Google Cloud project number must contain digits only."
      );
    }

    localStorage.setItem(
      PICKER_API_KEY_STORAGE_KEY,
      normalizedApiKey
    );

    localStorage.setItem(
      PICKER_APP_ID_STORAGE_KEY,
      normalizedAppId
    );
  }

  /**
   * @returns {boolean}
   */
  isConfigured() {
    const { apiKey, appId } = this.getConfig();
    return Boolean(apiKey && appId);
  }

  /**
   * Open Google Picker for EPUB/PDF selection.
   *
   * The view intentionally does not set ownedByMe, so both user-owned and
   * shared-with-user files can be shown.
   *
   * @param {string} accessToken
   * @returns {Promise<Array<{
   *   id: string,
   *   name: string,
   *   mimeType: string,
   *   url: string
   * }>>}
   */
  async pickBooks(accessToken) {
    if (!accessToken) {
      throw new Error(
        "Connect Google Drive before opening the Picker."
      );
    }

    const { apiKey, appId } = this.getConfig();

    if (!apiKey || !appId) {
      throw new Error(
        "Save Google Picker API key and project number first."
      );
    }

    await loadPickerLibrary();

    return new Promise((resolve, reject) => {
      try {
        const view =
          new google.picker.DocsView(
            google.picker.ViewId.DOCS
          );

        view.setMimeTypes(
          BOOK_MIME_TYPES.join(",")
        );

        view.setIncludeFolders(true);
        view.setSelectFolderEnabled(false);

        const picker =
          new google.picker.PickerBuilder()
            .setDeveloperKey(apiKey)
            .setAppId(appId)
            .setOAuthToken(accessToken)
            .setOrigin(window.location.origin)
            .enableFeature(
              google.picker.Feature
                .MULTISELECT_ENABLED
            )
            .addView(view)
            .setTitle(
              "Select EPUB / PDF books"
            )
            .setCallback((data) => {
              handlePickerCallback(
                data,
                resolve,
                reject
              );
            })
            .build();

        picker.setVisible(true);
      } catch (error) {
        reject(error);
      }
    });
  }
}

/**
 * @returns {Promise<void>}
 */
function loadPickerLibrary() {
  if (
    globalThis.google?.picker?.PickerBuilder
  ) {
    return Promise.resolve();
  }

  if (pickerLibraryPromise) {
    return pickerLibraryPromise;
  }

  pickerLibraryPromise = new Promise(
    (resolve, reject) => {
      loadGoogleApiScript()
        .then(() => {
          globalThis.gapi.load(
            "picker",
            {
              callback: resolve,
              onerror: () => {
                reject(
                  new Error(
                    "Google Picker library failed to load."
                  )
                );
              },
              timeout: 10000,
              ontimeout: () => {
                reject(
                  new Error(
                    "Google Picker library loading timed out."
                  )
                );
              },
            }
          );
        })
        .catch(reject);
    }
  );

  return pickerLibraryPromise;
}

/**
 * @returns {Promise<void>}
 */
function loadGoogleApiScript() {
  if (globalThis.gapi?.load) {
    return Promise.resolve();
  }

  const existing =
    document.querySelector(
      `script[src="${PICKER_SCRIPT_URL}"]`
    );

  if (existing) {
    return waitForGapi();
  }

  return new Promise((resolve, reject) => {
    const script =
      document.createElement("script");

    script.src = PICKER_SCRIPT_URL;
    script.async = true;
    script.defer = true;

    script.addEventListener(
      "load",
      () => {
        waitForGapi()
          .then(resolve)
          .catch(reject);
      }
    );

    script.addEventListener(
      "error",
      () => {
        reject(
          new Error(
            "Google API loader failed to load."
          )
        );
      }
    );

    document.head.append(script);
  });
}

/**
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
async function waitForGapi(
  timeoutMs = 10000
) {
  const startedAt = Date.now();

  while (
    Date.now() - startedAt < timeoutMs
  ) {
    if (globalThis.gapi?.load) {
      return;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 50);
    });
  }

  throw new Error(
    "Google API loader did not initialize."
  );
}

/**
 * @param {object} data
 * @param {(books: Array<object>) => void} resolve
 * @param {(error: Error) => void} reject
 */
function handlePickerCallback(
  data,
  resolve,
  reject
) {
  console.debug(
    "KOCloud Google Picker callback:",
    data
  );

  const rawAction = data?.action ?? "";
  const action =
    String(rawAction).toLowerCase();

  const pickedAction =
    String(
      google.picker.Action.PICKED
    ).toLowerCase();

  const cancelAction =
    String(
      google.picker.Action.CANCEL
    ).toLowerCase();

  const errorAction =
    String(
      google.picker.Action.ERROR
    ).toLowerCase();

  if (action === cancelAction) {
    resolve([]);
    return;
  }

  if (action === errorAction) {
    reject(
      new Error(
        "Google Picker reported a selection error."
      )
    );
    return;
  }

  if (action !== pickedAction) {
    return;
  }

  try {
    const documents =
      Array.isArray(data?.docs)
        ? data.docs
        : [];

    resolve(
      documents.map(normalizePickerDocument)
    );
  } catch (error) {
    reject(error);
  }
}

/**
 * @param {object} documentData
 * @returns {{
 *   id: string,
 *   name: string,
 *   mimeType: string,
 *   url: string
 * }}
 */
function normalizePickerDocument(
  documentData
) {
  return {
    id: documentData?.id ?? "",
    name:
      documentData?.name ??
      "Untitled",
    mimeType:
      documentData?.mimeType ??
      "",
    url: documentData?.url ?? "",
  };
}

export const googleDrivePicker =
  new GoogleDrivePicker();
