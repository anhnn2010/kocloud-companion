import {
  readdir,
} from "node:fs/promises";
import path from "node:path";
import {
  spawnSync,
} from "node:child_process";

const roots = ["src", "tests", "scripts"];

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

const files = [];

for (const root of roots) {
  files.push(...(await listJavaScriptFiles(root)));
}

for (const file of files.sort()) {
  const result = spawnSync(
    process.execPath,
    ["--check", file],
    {
      encoding: "utf8",
    }
  );

  if (result.status !== 0) {
    process.stderr.write(
      result.stderr || result.stdout
    );
    process.exit(result.status || 1);
  }
}

console.log(
  `Syntax OK: ${files.length} JavaScript files`
);
