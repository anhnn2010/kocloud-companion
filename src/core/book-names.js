/**
 * Normalize a book filename for duplicate comparison.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeBookName(name) {
  return name
    .normalize("NFC")
    .trim()
    .toLowerCase();
}

/**
 * Create a filename that does not collide with existing books.
 *
 * Examples:
 * Dune.epub -> Dune (1).epub -> Dune (2).epub
 *
 * @param {string} originalName
 * @param {Map<string, object>} existingByName
 * @returns {string}
 */
export function createAvailableBookName(
  originalName,
  existingByName
) {
  const lastDot = originalName.lastIndexOf(".");

  const hasExtension =
    lastDot > 0 &&
    lastDot < originalName.length - 1;

  const stem = hasExtension
    ? originalName.slice(0, lastDot)
    : originalName;

  const extension = hasExtension
    ? originalName.slice(lastDot)
    : "";

  let index = 1;

  while (true) {
    const candidate =
      `${stem} (${index})${extension}`;

    if (
      !existingByName.has(
        normalizeBookName(candidate)
      )
    ) {
      return candidate;
    }

    index += 1;
  }
}
