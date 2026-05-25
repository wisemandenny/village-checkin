#!/usr/bin/env node
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const outPath = resolve(dirname(new URL(import.meta.url).pathname), "../src/generated/changelog.json");
mkdirSync(dirname(outPath), { recursive: true });

const SEP = "---COMMIT---";
const FORMAT = `${SEP}%n%H%n%h%n%an%n%aI%n%s`;

const raw = execSync(`git log --format="${FORMAT}" --no-merges -100`, {
  encoding: "utf-8",
  cwd: resolve(dirname(new URL(import.meta.url).pathname), "../.."),
});

const commits = raw
  .split(SEP)
  .filter((block) => block.trim())
  .map((block) => {
    const [, hash, shortHash, author, date, ...subjectParts] = block.split("\n");
    return {
      hash,
      shortHash,
      author,
      date,
      message: subjectParts.join("\n").trim(),
    };
  })
  .filter((c) => c.hash);

writeFileSync(outPath, JSON.stringify(commits, null, 2));
console.log(`Changelog: wrote ${commits.length} commits to ${outPath}`);
