const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const CLIENT_ID_STORAGE_KEY = "kocloud_google_web_client_id";
const DEFAULT_TOKEN_LIFETIME_MS = 55 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;

/**
 * Google OAuth helper for KOCloud Companion.
 *
 * Companion intentionally requests full Google Drive access because it is the
 * KOCloud library-management plane. The KOReader plugin continues to use the
 * narrower drive.file scope with its limited-input OAuth client.
 *
 * The Web OAuth Client ID is persisted in localStorage because it is not a
 * secret. Access tokens are deliberately kept only in page memory.
 *
 * GIS' browser token model does not issue refresh tokens. Google requires a
 * user gesture to request a replacement access token after expiry, so long
 * jobs pause at an auth gate and resume after the user clicks Continue.
 */
export class GoogleAuth {
  constructor() {
    this.tokenClient = null;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.pendingTokenRequest = null;
    this.pendingRenewal = null;
    this.listeners = new Set();
  }

  /** Return the Web OAuth Client ID saved in this browser. */
  getClientId() {
    return localStorage.getItem(CLIENT_ID_STORAGE_KEY) || "";
  }

  /** Save the Web OAuth Client ID in this browser. */
  saveClientId(clientId) {
    const normalized = clientId.trim();

    if (!normalized) {
      throw new Error("Web OAuth Client ID is required.");
    }

    localStorage.setItem(CLIENT_ID_STORAGE_KEY, normalized);
    this.tokenClient = null;
    this.clearAccessToken();

    this.#emit({
      type: "client-id-saved",
      clientId: normalized,
    });
  }

  /** Return whether this page currently has Google authorization state. */
  isConnected() {
    return Boolean(this.accessToken);
  }

  /** Return the current in-memory access token without refreshing it. */
  getAccessToken() {
    return this.accessToken;
  }

  /** Return the known expiry time for the current token. */
  getAccessTokenExpiresAt() {
    return this.accessTokenExpiresAt;
  }

  /** Return whether a long-running job is waiting for user authorization. */
  isRenewalRequired() {
    return Boolean(this.pendingRenewal);
  }

  /**
   * Return a token that is expected to remain valid for the next operation.
   *
   * GIS' token model requires user interaction to obtain a replacement token.
   * When the current token approaches expiry, callers wait on a shared renewal
   * gate instead of trying to open a popup from a background async callback.
   */
  async getValidAccessToken({
    minValidityMs = TOKEN_REFRESH_SKEW_MS,
  } = {}) {
    if (!this.accessToken) {
      return null;
    }

    if (
      this.accessTokenExpiresAt >
      Date.now() + Math.max(0, minValidityMs)
    ) {
      return this.accessToken;
    }

    return this.#waitForUserRenewal();
  }

  /**
   * Pause callers until the user explicitly renews Google authorization.
   *
   * This method intentionally does not call requestAccessToken() itself. It is
   * used by service-layer 401 recovery and by proactive expiry checks, both of
   * which run outside a user gesture and would otherwise be popup-blocked.
   */
  async refreshAccessToken() {
    if (!this.accessToken) {
      throw new Error(
        "Google authorization is no longer available. Connect Google Drive again."
      );
    }

    return this.#waitForUserRenewal();
  }

  /**
   * Renew the access token from an explicit user gesture, then release every
   * long-running worker that is waiting at the auth gate.
   */
  renewAccessTokenFromUserGesture() {
    if (!this.accessToken || !this.tokenClient) {
      throw new Error(
        "Google authorization is no longer available. Connect Google Drive again."
      );
    }

    // Do not await anything before requestAccessToken(). Browsers may only
    // allow the OAuth popup while the original button-click activation is
    // still live on this synchronous call stack.
    return this.#requestAccessToken("", "renew");
  }

  /** Remove the access token from memory. */
  clearAccessToken() {
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;

    if (this.pendingRenewal) {
      const pending = this.pendingRenewal;
      this.pendingRenewal = null;
      pending.reject(
        new Error(
          "Google authorization was disconnected while a job was waiting to resume."
        )
      );
    }

    this.#emit({
      type: "disconnected",
    });
  }

  /** Subscribe to auth state events. */
  subscribe(listener) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Connect to Google Drive using Google Identity Services. */
  async connect() {
    const clientId = this.getClientId();

    if (!clientId) {
      throw new Error(
        "Save your Google Web OAuth Client ID before connecting."
      );
    }

    await this.#ensureTokenClient();
    return this.#requestAccessToken("consent", "connect");
  }

  /** Build the GIS token client once for the current Web OAuth Client ID. */
  async #ensureTokenClient() {
    const clientId = this.getClientId();

    if (!clientId) {
      throw new Error(
        "Save your Google Web OAuth Client ID before connecting."
      );
    }

    await this.#waitForGoogleIdentityServices();

    if (this.tokenClient) {
      return;
    }

    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      include_granted_scopes: false,
      callback: (response) => {
        this.#handleTokenResponse(response);
      },
      error_callback: (error) => {
        this.#handleTokenPopupError(error);
      },
    });
  }

  /** Create or reuse the shared promise that pauses long-running jobs. */
  #waitForUserRenewal() {
    if (this.pendingRenewal) {
      return this.pendingRenewal.promise;
    }

    let resolveRenewal;
    let rejectRenewal;

    const promise = new Promise((resolve, reject) => {
      resolveRenewal = resolve;
      rejectRenewal = reject;
    });

    this.pendingRenewal = {
      promise,
      resolve: resolveRenewal,
      reject: rejectRenewal,
    };

    this.#emit({
      type: "renewal-required",
      expiresAt: this.accessTokenExpiresAt,
    });

    return promise;
  }

  /** Request one access token and coalesce concurrent interactive attempts. */
  #requestAccessToken(prompt, purpose) {
    if (this.pendingTokenRequest) {
      return this.pendingTokenRequest.promise;
    }

    let resolveRequest;
    let rejectRequest;

    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });

    this.pendingTokenRequest = {
      promise,
      resolve: resolveRequest,
      reject: rejectRequest,
      purpose,
    };

    try {
      this.tokenClient.requestAccessToken({ prompt });
    } catch (error) {
      const pending = this.pendingTokenRequest;
      this.pendingTokenRequest = null;
      pending?.reject(error);
    }

    return promise;
  }

  /** Handle a successful or OAuth-error GIS token callback. */
  #handleTokenResponse(response) {
    const pending = this.pendingTokenRequest;
    this.pendingTokenRequest = null;

    if (response?.error) {
      const error = new Error(
        response.error_description ||
          response.error ||
          "Google authorization failed."
      );

      if (pending?.purpose === "renew" && this.pendingRenewal) {
        this.#emit({
          type: "renewal-required",
          error: error.message,
          expiresAt: this.accessTokenExpiresAt,
        });
        pending.reject(error);
        return;
      }

      this.accessToken = null;
      this.accessTokenExpiresAt = 0;

      this.#emit({
        type: "error",
        error: response.error,
      });

      pending?.reject(error);
      return;
    }

    if (!response?.access_token) {
      const error = new Error("Google did not return an access token.");

      if (pending?.purpose === "renew" && this.pendingRenewal) {
        this.#emit({
          type: "renewal-required",
          error: error.message,
          expiresAt: this.accessTokenExpiresAt,
        });
        pending.reject(error);
        return;
      }

      this.accessToken = null;
      this.accessTokenExpiresAt = 0;
      pending?.reject(error);
      return;
    }

    const expiresInSeconds = Number(response.expires_in);
    const lifetimeMs =
      Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? expiresInSeconds * 1000
        : DEFAULT_TOKEN_LIFETIME_MS;

    this.accessToken = response.access_token;
    this.accessTokenExpiresAt = Date.now() + lifetimeMs;

    const renewal = this.pendingRenewal;
    this.pendingRenewal = null;

    this.#emit({
      type: "connected",
      accessToken: this.accessToken,
      expiresAt: this.accessTokenExpiresAt,
      renewed: pending?.purpose === "renew",
    });

    renewal?.resolve(this.accessToken);
    pending?.resolve(this.accessToken);
  }

  /** Handle GIS popup/window failures. */
  #handleTokenPopupError(error) {
    const pending = this.pendingTokenRequest;
    this.pendingTokenRequest = null;

    const message =
      error?.message ||
      error?.type ||
      "Google authorization popup failed.";

    if (pending?.purpose === "renew" && this.pendingRenewal) {
      this.#emit({
        type: "renewal-required",
        error: message,
        expiresAt: this.accessTokenExpiresAt,
      });
      pending.reject(new Error(message));
      return;
    }

    this.accessToken = null;
    this.accessTokenExpiresAt = 0;

    this.#emit({
      type: "error",
      error: message,
    });

    pending?.reject(new Error(message));
  }

  /** Wait until Google Identity Services is available. */
  async #waitForGoogleIdentityServices(timeoutMs = 10000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (window.google?.accounts?.oauth2?.initTokenClient) {
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

  /** Emit an auth event to all listeners. */
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
