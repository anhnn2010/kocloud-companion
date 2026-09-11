import test from "node:test";
import assert from "node:assert/strict";
import {
  GoogleAuth,
} from "../../src/google-drive/auth.js";

function installBrowserMocks() {
  const values = new Map();
  const prompts = [];
  let callback = null;
  let tokenNumber = 0;

  globalThis.localStorage = {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };

  const google = {
    accounts: {
      oauth2: {
        initTokenClient(options) {
          callback = options.callback;
          return {
            requestAccessToken({ prompt }) {
              prompts.push(prompt);
              tokenNumber += 1;
              const currentNumber = tokenNumber;
              queueMicrotask(() => {
                callback({
                  access_token: `token-${currentNumber}`,
                  expires_in:
                    currentNumber === 1 ? 1 : 3600,
                });
              });
            },
          };
        },
      },
    },
  };

  globalThis.google = google;
  globalThis.window = {
    google,
    setTimeout,
  };

  return { prompts };
}

test("GoogleAuth silently renews a nearly expired token", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const originalGoogle = globalThis.google;
  const { prompts } = installBrowserMocks();

  try {
    const auth = new GoogleAuth();
    auth.saveClientId("client-id.apps.googleusercontent.com");

    const initial = await auth.connect();
    assert.equal(initial, "token-1");

    const refreshed = await auth.getValidAccessToken();
    assert.equal(refreshed, "token-2");
    assert.deepEqual(prompts, ["consent", ""]);
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.window = originalWindow;
    globalThis.google = originalGoogle;
  }
});

test("GoogleAuth coalesces concurrent silent refresh requests", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const originalGoogle = globalThis.google;
  const { prompts } = installBrowserMocks();

  try {
    const auth = new GoogleAuth();
    auth.saveClientId("client-id.apps.googleusercontent.com");
    await auth.connect();

    const [one, two, three, four] = await Promise.all([
      auth.getValidAccessToken(),
      auth.getValidAccessToken(),
      auth.getValidAccessToken(),
      auth.getValidAccessToken(),
    ]);

    assert.deepEqual(
      [one, two, three, four],
      ["token-2", "token-2", "token-2", "token-2"]
    );
    assert.deepEqual(prompts, ["consent", ""]);
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.window = originalWindow;
    globalThis.google = originalGoogle;
  }
});
