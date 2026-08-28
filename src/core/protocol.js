/**
 * KOCloud Storage Protocol v1.
 *
 * Keep provider-neutral storage concepts here. Google Drive appProperties are
 * an optimization; the portable contract is the KOCloud directory layout plus
 * `KOCloud/.kocloud/manifest.json`.
 */
export const KOCloudProtocol = Object.freeze({
  format: "kocloud-storage",
  version: 1,
  schemaVersion: "1",

  manifest: Object.freeze({
    filename: "manifest.json",
    mimeType: "application/json",
  }),

  metadataKeys: Object.freeze({
    role: "kocloud_role",
    schema: "kocloud_schema",
    internal: "kocloud_internal",
    source: "kocloud_source",
  }),

  roles: Object.freeze({
    root: "root",
    books: "books",
    backups: "backups",
    readingData: "reading_data",
    metadata: "metadata",
    manifest: "manifest",
    book: "book",
    bookFolder: "book_folder",
  }),

  sources: Object.freeze({
    koreader: "koreader",
    webCompanion: "web_companion",
    driveImport: "drive_import",
    manualDrive: "manual_drive",
  }),

  rootFolder: Object.freeze({
    key: "root",
    name: "KOCloud",
    role: "root",
  }),

  managedFolders: Object.freeze([
    Object.freeze({
      key: "books",
      name: "Books",
      role: "books",
    }),
    Object.freeze({
      key: "backups",
      name: "Backups",
      role: "backups",
    }),
    Object.freeze({
      key: "reading_data",
      name: "ReadingData",
      role: "reading_data",
    }),
    Object.freeze({
      key: "metadata",
      name: ".kocloud",
      role: "metadata",
      internal: true,
    }),
  ]),
});

/**
 * Return one managed-folder definition by logical key.
 *
 * @param {string} key
 * @returns {object|null}
 */
export function getManagedFolder(key) {
  return (
    KOCloudProtocol.managedFolders.find(
      (definition) => definition.key === key
    ) || null
  );
}

/**
 * Return the portable path to one managed KOCloud folder.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function getManagedPath(key) {
  const definition = getManagedFolder(key);

  if (!definition) {
    return null;
  }

  return (
    `${KOCloudProtocol.rootFolder.name}/` +
    definition.name
  );
}

/**
 * Return the portable path to the protocol manifest.
 *
 * @returns {string}
 */
export function getManifestPath() {
  return (
    `${getManagedPath("metadata")}/` +
    KOCloudProtocol.manifest.filename
  );
}

/**
 * Build the portable KOCloud Storage Protocol v1 manifest.
 *
 * Provider IDs/refs never belong in this document.
 *
 * @returns {object}
 */
export function buildProtocolManifest() {
  const layout = {
    root: KOCloudProtocol.rootFolder.name,
  };

  for (const definition of KOCloudProtocol.managedFolders) {
    layout[definition.key] = definition.name;
  }

  return {
    format: KOCloudProtocol.format,
    schema_version: KOCloudProtocol.version,
    layout,
  };
}

/**
 * Return whether a parsed manifest matches Protocol v1.
 *
 * This is deliberately strict. A future schema upgrade should use an explicit
 * migration path instead of silently accepting an unknown layout contract.
 *
 * @param {object} manifest
 * @returns {boolean}
 */
export function isProtocolManifestV1(manifest) {
  if (
    !manifest ||
    manifest.format !== KOCloudProtocol.format ||
    manifest.schema_version !== KOCloudProtocol.version
  ) {
    return false;
  }

  const expected = buildProtocolManifest().layout;
  const actual = manifest.layout || {};

  return Object.entries(expected).every(
    ([key, value]) => actual[key] === value
  );
}
