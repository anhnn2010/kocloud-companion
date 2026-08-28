# Testing

KOCloud Companion uses the Node.js built-in test runner. No test framework or
runtime dependency is required.

## Run all checks

From the repository root:

```sh
npm run check
```

This command performs three layers of validation:

1. syntax-check every JavaScript file under `src/`, `tests/`, and `scripts/`;
2. verify every relative source import points to an existing file;
3. run unit tests for Protocol v1, book formats/naming, LibraryService, Drive
   import-source traversal, duplicate planning, and import execution.

The syntax check is intentionally repository-wide. It protects the application
bootstrap from failures where one malformed module prevents OAuth controls and
all other event handlers from initializing.

## Browser testing

DOM rendering, Google OAuth/Picker behavior, and real Drive operations are still
validated manually in the deployed Companion. Pure planning/domain logic should
prefer unit tests so it can run without Google credentials.

## CI

`.github/workflows/test.yml` runs `npm run check` on every push and pull request
using Node.js 22.
