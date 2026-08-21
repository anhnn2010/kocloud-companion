const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const CLIENT_ID_STORAGE_KEY = "kocloud_google_web_client_id";

/**
 * Google OAuth helper for KOCloud Companion.
 *
 * The Web OAuth Client ID is persisted in localStorage because it is not a
 * secret. Access tokens are deliberately kept only in page memory.
 */
export class GoogleAuth {
  constructor() {
    this.tokenClient = null;
    this.accessToken = null;
    this.listeners = new Set();
  }

  /**
   * Return the Web OAuth Client ID saved in this browser.
   *
   * @returns {string}
   */
  getClientId() {
    return localStorage.getItem(CLIENT_ID_STORAGE_KEY) || "";
  }

  /**
   * Save the Web OAuth Client ID in this browser.
   *
   * @param {string} clientId
   */
  saveClientId(clientId) {
    const normalized = clientId.trim();

    if (!normalized) {
      throw new Error("Web OAuth Client ID is required.");
    }

    localStorage.setItem(CLIENT_ID_STORAGE_KEY, normalized);

    // Rebuild the GIS token client next time Connect is pressed.
    this.tokenClient = null;
    this.clearAccessToken();

    this.#emit({
      type: "client-id-saved",
      clientId: normalized,
    });
  }

  /**
   * Return whether this page currently has a Google access token.
   *
   * @returns {boolean}
   */
  isConnected() {
    return Boolean(this.accessToken);
  }

  /**
   * Return the current in-memory access token.
   *
   * @returns {string|null}
   */
  getAccessToken() {
    return this.accessToken;
  }

  /**
   * Remove the access token from memory.
   */
  clearAccessToken() {
    this.accessToken = null;

    this.#emit({
      type: "disconnected",
    });
  }

  /**
   * Subscribe to auth state events.
   *
   * @param {(event: object) => void} listener
   * @returns {() => void} unsubscribe callback
   */
  subscribe(listener) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Connect to Google Drive using Google Identity Services.
   *
   * @returns {Promise<string>} access token
   */
  async connect() {
    const clientId = this.getClientId();

    if (!clientId) {
      throw new Error(
        "Save your Google Web OAuth Client ID before connecting."
      );
    }

    await this.#waitForGoogleIdentityServices();

    return new Promise((resolve, reject) => {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        include_granted_scopes: false,

        callback: (response) => {
          if (response.error) {
            this.accessToken = null;

            this.#emit({
              type: "error",
              error: response.error,
            });

            reject(
              new Error(
                response.error_description ||
                  response.error ||
                  "Google authorization failed."
              )
            );
            return;
          }

          if (!response.access_token) {
            this.accessToken = null;

            reject(
              new Error("Google did not return an access token.")
            );
            return;
          }

          this.accessToken = response.access_token;

          this.#emit({
            type: "connected",
            accessToken: this.accessToken,
          });

          resolve(this.accessToken);
        },

        error_callback: (error) => {
          this.accessToken = null;

          const message =
            error?.message ||
            error?.type ||
            "Google authorization popup failed.";

          this.#emit({
            type: "error",
            error: message,
          });

          reject(new Error(message));
        },
      });

      try {
        this.tokenClient.requestAccessToken({
          prompt: "consent",
        });
      } catch (error) {
        this.accessToken = null;
        reject(error);
      }
    });
  }

  /**
   * Wait until Google Identity Services is available.
   *
   * The GIS script is loaded asynchronously by index.html, so a user can
   * technically press Connect before the library has finished loading.
   *
   * @param {number} timeoutMs
   * @returns {Promise<void>}
   */
  async #waitForGoogleIdentityServices(timeoutMs = 10000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (
        window.google?.accounts?.oauth2?.initTokenClient
      ) {
        return;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 100);
      });
    }

    throw new Error(
      "Google Identity Services did not load. " +
        "Check your internet connection and reload the page."
    );
  }

  /**
   * Emit an auth event to all listeners.
   *
   * @param {object} event
   */
  #emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("KOCloud auth listener failed:", error);
      }
    }
  }
}

export const googleAuth = new GoogleAuth();
