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

async function withBrowserMocks(callback) {
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const originalGoogle = globalThis.google;
  const mocks = installBrowserMocks();

  try {
    await callback(mocks);
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.window = originalWindow;
    globalThis.google = originalGoogle;
  }
}

test("GoogleAuth pauses near expiry until a user gesture renews access", async () => {
  await withBrowserMocks(async ({ prompts }) => {
    const auth = new GoogleAuth();
    const events = [];
    auth.subscribe((event) => events.push(event));
    auth.saveClientId("client-id.apps.googleusercontent.com");

    const initial = await auth.connect();
    assert.equal(initial, "token-1");

    const waiting = auth.getValidAccessToken();
    await Promise.resolve();

    assert.equal(auth.isRenewalRequired(), true);
    assert.deepEqual(prompts, ["consent"]);
    assert.equal(
      events.some((event) => event.type === "renewal-required"),
      true
    );

    const renewed = await auth.renewAccessTokenFromUserGesture();
    assert.equal(renewed, "token-2");
    assert.equal(await waiting, "token-2");
    assert.equal(auth.isRenewalRequired(), false);
    assert.deepEqual(prompts, ["consent", ""]);
  });
});

test("GoogleAuth coalesces concurrent workers behind one renewal gate", async () => {
  await withBrowserMocks(async ({ prompts }) => {
    const auth = new GoogleAuth();
    auth.saveClientId("client-id.apps.googleusercontent.com");
    await auth.connect();

    const waiting = [
      auth.getValidAccessToken(),
      auth.getValidAccessToken(),
      auth.getValidAccessToken(),
      auth.getValidAccessToken(),
    ];

    await Promise.resolve();
    assert.equal(auth.isRenewalRequired(), true);
    assert.deepEqual(prompts, ["consent"]);

    await auth.renewAccessTokenFromUserGesture();

    assert.deepEqual(
      await Promise.all(waiting),
      ["token-2", "token-2", "token-2", "token-2"]
    );
    assert.deepEqual(prompts, ["consent", ""]);
  });
});
