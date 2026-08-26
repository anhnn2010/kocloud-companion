/**
 * KOReader document formats supported by KOCloud Companion.
 *
 * Keep this list aligned with KOReader's current document registry / Calibre
 * integration rather than maintaining separate format checks per feature.
 */
const BOOK_FORMATS = [
  ["epub", "EPUB", "application/epub+zip"],
  ["pdf", "PDF", "application/pdf"],
  ["djvu", "DJVU", "image/vnd.djvu"],
  ["djv", "DJVU", "image/vnd.djvu"],
  ["fb2", "FB2", "application/fb2"],
  ["mobi", "MOBI", "application/x-mobipocket-ebook"],
  ["azw", "AZW", "application/vnd.amazon.ebook"],
  ["doc", "DOC", "application/msword"],
  [
    "docx",
    "DOCX",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ["rtf", "RTF", "application/rtf"],
  ["html", "HTML", "text/html"],
  ["htm", "HTML", "text/html"],
  ["xhtml", "XHTML", "application/xhtml+xml"],
  ["chm", "CHM", "application/vnd.ms-htmlhelp"],
  ["txt", "TXT", "text/plain"],
  ["md", "MD", "text/markdown"],
  ["cbz", "CBZ", "application/vnd.comicbook+zip"],
  ["cbr", "CBR", "application/vnd.comicbook-rar"],
  ["cbt", "CBT", "application/vnd.comicbook+tar"],
  ["pdb", "PDB", "application/vnd.palm"],
  ["prc", "PRC", "application/x-mobipocket-ebook"],
  ["xps", "XPS", "application/oxps"],
  ["zip", "ZIP", "application/zip"],
];

const FORMAT_BY_EXTENSION = new Map(
  BOOK_FORMATS.map(([extension, label, mimeType]) => [
    extension,
    { extension, label, mimeType },
  ])
);

export const SUPPORTED_BOOK_EXTENSIONS =
  BOOK_FORMATS.map(([extension]) => extension);

export const SUPPORTED_BOOK_ACCEPT =
  SUPPORTED_BOOK_EXTENSIONS.map(
    (extension) => `.${extension}`
  ).join(",");

/**
 * Return the lowercase extension without a leading dot.
 *
 * @param {string} name
 * @returns {string}
 */
export function getBookExtension(name) {
  const value = String(name || "");
  const dotIndex = value.lastIndexOf(".");

  if (
    dotIndex < 0 ||
    dotIndex === value.length - 1
  ) {
    return "";
  }

  return value.slice(dotIndex + 1).toLowerCase();
}

/**
 * Return whether a file name uses a KOCloud-supported KOReader format.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isSupportedBookName(name) {
  return FORMAT_BY_EXTENSION.has(
    getBookExtension(name)
  );
}

/**
 * Return the MIME type to use when uploading a supported book.
 *
 * @param {string} name
 * @param {string} [fallbackMimeType=""]
 * @returns {string}
 */
export function getBookMimeType(
  name,
  fallbackMimeType = ""
) {
  const format = FORMAT_BY_EXTENSION.get(
    getBookExtension(name)
  );

  return (
    format?.mimeType ||
    fallbackMimeType ||
    "application/octet-stream"
  );
}

/**
 * Return a short display label such as EPUB, DJVU, or MOBI.
 *
 * @param {string} name
 * @returns {string}
 */
export function getBookFormatLabel(name) {
  const format = FORMAT_BY_EXTENSION.get(
    getBookExtension(name)
  );

  return format?.label || "Book";
}
