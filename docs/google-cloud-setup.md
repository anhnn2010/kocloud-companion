# Google Cloud setup

KOCloud Companion uses a Google **Web application** OAuth client.

The KOReader plugin and Companion should use OAuth clients from the same Google
Cloud project:

```text
Google Cloud project
├── TVs and Limited Input devices client
│   └── kocloud.koplugin
└── Web application client
    └── kocloud-companion
```

Both use:

```text
https://www.googleapis.com/auth/drive.file
```

## 1. Enable Google Drive API

In the user's Google Cloud project, enable **Google Drive API**.

## 2. Create the Web OAuth client

Create an OAuth client with application type:

```text
Web application
```

No client secret is used by KOCloud Companion.

## 3. Add Authorized JavaScript origins

Add the exact origin hosting Companion.

For a GitHub Pages site such as:

```text
https://USERNAME.github.io/kocloud-companion/
```

the origin is:

```text
https://USERNAME.github.io
```

Do not include the repository path in the origin.

For local testing, an origin can look like:

```text
http://localhost:8000
```

Use only origins that the user actually controls.

## 4. Open Companion

Open the deployed Companion page and enter the Web OAuth Client ID.

The Client ID is stored in that browser's `localStorage`, so a different browser
or device will need it once as well.

## 5. Connect Google Drive

Press **Connect Google Drive** and authorize access.

The browser access token is kept only in page memory. Refreshing or closing the
page clears it, so the user may need to connect again.

## 6. Existing KOCloud storage is required

Companion V0.1 deliberately does not initialize the KOCloud storage structure.

The KOReader plugin should already have created:

```text
KOCloud/
├── Books/
├── Backups/
├── ReadingData/
└── .kocloud/
```

Companion locates the root and Books folder through KOCloud `appProperties`
rather than relying only on their display names.
