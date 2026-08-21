/**
 * Upload one file to a Google Drive resumable upload session.
 *
 * XMLHttpRequest is used instead of fetch() because browser upload progress
 * events are widely available through xhr.upload.
 *
 * @param {string} sessionUrl
 * @param {File} file
 * @param {string} mimeType
 * @param {(progress: {
 *   loaded: number,
 *   total: number,
 *   percent: number
 * }) => void} [onProgress]
 * @returns {Promise<object>} uploaded Google Drive file metadata
 */
export function uploadFileToSession(
  sessionUrl,
  file,
  mimeType,
  onProgress = null
) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("PUT", sessionUrl, true);
    xhr.setRequestHeader(
      "Content-Type",
      mimeType || "application/octet-stream"
    );

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        return;
      }

      const total = event.total || file.size || 0;
      const loaded = event.loaded || 0;

      const percent =
        total > 0
          ? Math.min(
              100,
              Math.round((loaded / total) * 100)
            )
          : 0;

      if (onProgress) {
        onProgress({
          loaded,
          total,
          percent,
        });
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let result = {};

        if (xhr.responseText) {
          try {
            result = JSON.parse(xhr.responseText);
          } catch {
            result = {
              rawResponse: xhr.responseText,
            };
          }
        }

        if (onProgress) {
          onProgress({
            loaded: file.size,
            total: file.size,
            percent: 100,
          });
        }

        resolve(result);
        return;
      }

      reject(
        new Error(
          buildUploadErrorMessage(
            xhr.status,
            xhr.responseText
          )
        )
      );
    });

    xhr.addEventListener("error", () => {
      reject(
        new Error(
          "Upload failed because of a network or browser error."
        )
      );
    });

    xhr.addEventListener("abort", () => {
      reject(
        new UploadCancelledError(
          "Upload was cancelled."
        )
      );
    });

    xhr.addEventListener("timeout", () => {
      reject(
        new Error(
          "Upload timed out before Google Drive finished receiving the file."
        )
      );
    });

    // Do not use a short timeout for ebook uploads. Mobile networks can be
    // slow, and Google resumable sessions are already designed for longer
    // transfers.
    xhr.timeout = 0;

    xhr.send(file);
  });
}

/**
 * Upload cancellation marker.
 */
export class UploadCancelledError extends Error {
  constructor(message) {
    super(message);
    this.name = "UploadCancelledError";
  }
}

/**
 * Create an upload task that can be cancelled by the caller.
 *
 * Companion V0.1 does not expose a Cancel button yet, but using a task object
 * here means the UI can add cancellation later without changing the Drive API
 * layer.
 */
export class BrowserUploadTask {
  /**
   * @param {string} sessionUrl
   * @param {File} file
   * @param {string} mimeType
   */
  constructor(sessionUrl, file, mimeType) {
    this.sessionUrl = sessionUrl;
    this.file = file;
    this.mimeType =
      mimeType || "application/octet-stream";

    this.xhr = null;
    this.running = false;
  }

  /**
   * Start the upload.
   *
   * @param {(progress: {
   *   loaded: number,
   *   total: number,
   *   percent: number
   * }) => void} [onProgress]
   * @returns {Promise<object>}
   */
  start(onProgress = null) {
    if (this.running) {
      return Promise.reject(
        new Error("This upload task is already running.")
      );
    }

    this.running = true;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      this.xhr = xhr;

      xhr.open("PUT", this.sessionUrl, true);
      xhr.setRequestHeader(
        "Content-Type",
        this.mimeType
      );

      xhr.upload.addEventListener(
        "progress",
        (event) => {
          if (!event.lengthComputable) {
            return;
          }

          const total =
            event.total || this.file.size || 0;

          const loaded = event.loaded || 0;

          const percent =
            total > 0
              ? Math.min(
                  100,
                  Math.round((loaded / total) * 100)
                )
              : 0;

          if (onProgress) {
            onProgress({
              loaded,
              total,
              percent,
            });
          }
        }
      );

      xhr.addEventListener("load", () => {
        this.running = false;
        this.xhr = null;

        if (
          xhr.status >= 200 &&
          xhr.status < 300
        ) {
          let result = {};

          if (xhr.responseText) {
            try {
              result = JSON.parse(
                xhr.responseText
              );
            } catch {
              result = {
                rawResponse:
                  xhr.responseText,
              };
            }
          }

          if (onProgress) {
            onProgress({
              loaded: this.file.size,
              total: this.file.size,
              percent: 100,
            });
          }

          resolve(result);
          return;
        }

        reject(
          new Error(
            buildUploadErrorMessage(
              xhr.status,
              xhr.responseText
            )
          )
        );
      });

      xhr.addEventListener("error", () => {
        this.running = false;
        this.xhr = null;

        reject(
          new Error(
            "Upload failed because of a network or browser error."
          )
        );
      });

      xhr.addEventListener("abort", () => {
        this.running = false;
        this.xhr = null;

        reject(
          new UploadCancelledError(
            "Upload was cancelled."
          )
        );
      });

      xhr.addEventListener("timeout", () => {
        this.running = false;
        this.xhr = null;

        reject(
          new Error(
            "Upload timed out before Google Drive finished receiving the file."
          )
        );
      });

      xhr.timeout = 0;
      xhr.send(this.file);
    });
  }

  /**
   * Cancel an in-progress upload.
   */
  cancel() {
    if (this.xhr && this.running) {
      this.xhr.abort();
    }
  }
}

/**
 * Build a concise Google Drive upload error.
 *
 * @param {number} status
 * @param {string} responseText
 * @returns {string}
 */
function buildUploadErrorMessage(
  status,
  responseText
) {
  let detail = "";

  if (responseText) {
    try {
      const payload = JSON.parse(responseText);

      detail =
        payload?.error?.message ||
        responseText;
    } catch {
      detail = responseText;
    }
  }

  const prefix =
    status > 0
      ? `Google Drive upload failed (${status})`
      : "Google Drive upload failed";

  return (
    prefix +
    (detail ? `: ${detail}` : "")
  );
}
