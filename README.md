# KOCloud Companion

KOCloud Companion is the browser-based companion for KOCloud on KOReader.

The initial V0.1 scope is intentionally small:

- connect to Google Drive with a user-owned Web OAuth client;
- locate the existing KOCloud storage initialized by the KOReader plugin;
- choose one EPUB or PDF;
- upload it directly from the browser to `KOCloud/Books`;
- show real upload progress.

## Architecture

KOCloud is self-managed by design.

```text
Phone / PC browser
        |
        |  drive.file
        v
Google Drive
KOCloud/Books
        |
        v
KOReader + kocloud.koplugin
```

The browser sends ebook bytes directly to Google Drive. A static host such as
GitHub Pages only serves the HTML, CSS, and JavaScript.

## Requirements

Before using Companion:

1. Install and configure `kocloud.koplugin` on KOReader.
2. Initialize KOCloud storage in Google Drive from KOReader.
3. In the same Google Cloud project, create a **Web application** OAuth client.
4. Add the HTTPS origin where Companion is hosted to **Authorized JavaScript origins**.
5. Use the `https://www.googleapis.com/auth/drive.file` scope.

See [`docs/google-cloud-setup.md`](docs/google-cloud-setup.md).

## Run locally

Because the app uses JavaScript modules, serve the repository through a local
HTTP server instead of opening `index.html` with `file://`.

For example:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

For Google OAuth, add the exact local origin you use (for example
`http://localhost:8000`) to the Web OAuth client's Authorized JavaScript origins
if you want to test OAuth locally.

## Deploy to GitHub Pages

The repository is a static site. Configure GitHub Pages to publish from the
repository root on the `master` branch.

The `.nojekyll` file prevents unnecessary Jekyll processing.

## Security model

- The Web OAuth Client ID is not a secret and is stored in browser
  `localStorage` for convenience.
- Google access tokens are kept in page memory only.
- No Google OAuth client secret belongs in this repository or in browser code.
- Ebook data is uploaded directly from the browser to Google Drive.

## Current limitation

V0.1 uploads one EPUB/PDF at a time. Multi-file queueing, retry, duplicate
handling, and library management are planned after this checkpoint is verified
end-to-end.
