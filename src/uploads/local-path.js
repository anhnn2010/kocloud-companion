/**
 * Normalize the browser-provided relative path for one local upload file.
 *
 * Folder selections expose File.webkitRelativePath, while ordinary file
 * selections only expose File.name. Keeping both flows in one normalized
 * representation lets the upload engine preserve folders without creating a
 * second upload implementation.
 *
 * @param {{name: string, webkitRelativePath?: string}} file
 * @returns {{relativePath: string, directoryParts: Array<string>}}
 */
export function getLocalUploadPath(file) {
  const rawPath =
    String(file?.webkitRelativePath || file?.name || "")
      .replaceAll("\\", "/");

  const parts = rawPath
    .split("/")
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length > 0 &&
        part !== "." &&
        part !== ".."
    );

  if (parts.length === 0) {
    throw new Error("The selected file has no usable name.");
  }

  const fileName = String(file?.name || "").trim();

  if (fileName && parts.at(-1) !== fileName) {
    parts.push(fileName);
  }

  return {
    relativePath: parts.join("/"),
    directoryParts: parts.slice(0, -1),
  };
}

/**
 * Stable logical key for one relative directory path.
 *
 * @param {Array<string>} parts
 * @returns {string}
 */
export function getLocalDirectoryKey(parts) {
  return parts
    .map((part) => String(part).trim().toLocaleLowerCase())
    .join("/");
}
