import {
  access,
  readdir,
  readFile,
} from "node:fs/promises";
import path from "node:path";

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(
      directory,
      entry.name
    );

    if (entry.isDirectory()) {
      files.push(
        ...(await listJavaScriptFiles(entryPath))
      );
      continue;
    }

    if (/\.(?:js|mjs)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

const files = await listJavaScriptFiles("src");
const importPattern = /\bfrom\s+["'](\.[^"']+)["']/g;

for (const file of files) {
  const source = await readFile(file, "utf8");
  let match;

  while ((match = importPattern.exec(source))) {
    const target = path.resolve(
      path.dirname(file),
      match[1]
    );

    try {
      await access(target);
    } catch {
      throw new Error(
        `Missing import target: ${file} -> ${match[1]}`
      );
    }
  }
}

console.log(
  `Imports OK: ${files.length} source files checked`
);
