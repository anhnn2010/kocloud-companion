export function normalizeFileSize(value) {
  const size = Number(value);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

export function checksumFor(file) {
  if (file?.sha256Checksum) {
    return ["sha256", file.sha256Checksum];
  }
  if (file?.sha1Checksum) {
    return ["sha1", file.sha1Checksum];
  }
  if (file?.md5Checksum) {
    return ["md5", file.md5Checksum];
  }
  return null;
}

/**
 * Build a stable exact-content fingerprint from Google Drive metadata.
 * Returns null when Drive did not expose a content checksum.
 */
export function createExactFingerprint(file) {
  const checksum = checksumFor(file);
  const size = normalizeFileSize(file?.size);

  if (!checksum || size === null) {
    return null;
  }

  const [algorithm, value] = checksum;
  return `${algorithm}:${value}:${size}`;
}
