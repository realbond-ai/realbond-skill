import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function writeJsonFile(value: unknown, name = "binding.json"): string {
  const file = join(mkdtempSync(join(tmpdir(), "skill-")), name);
  writeFileSync(file, JSON.stringify(value));
  return file;
}
