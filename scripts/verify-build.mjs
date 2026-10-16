import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url)),
);
const build = new URL("../.scaffold/build/", import.meta.url);
const xpi = new URL("paper-2-speech.xpi", build);
const manifest = JSON.parse(
  execFileSync("unzip", ["-p", fileURLToPath(xpi), "manifest.json"], {
    encoding: "utf8",
  }),
);
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.applications.zotero.id, pkg.config.addonID);
assert.equal(
  manifest.applications.zotero.update_url,
  "https://github.com/WeiCheng14159/zotero_paper2speech/releases/download/release/update.json",
);
for (const size of [48, 96]) {
  assert.equal(manifest.icons[size], "content/icons/icon.svg");
  const icon = execFileSync(
    "unzip",
    ["-p", fileURLToPath(xpi), manifest.icons[size]],
    {
      encoding: "utf8",
    },
  );
  assert.match(icon, /viewBox="0 0 48 48"/);
  assert.match(icon, /context-fill #666/);
}
const script = execFileSync(
  "unzip",
  ["-p", fileURLToPath(xpi), `content/scripts/${pkg.config.addonRef}.js`],
  { encoding: "utf8" },
);
assert.ok(script.includes("content/icons/icon.svg"));
const feed = JSON.parse(await readFile(new URL("update.json", build)));
const update = feed.addons[pkg.config.addonID].updates[0];
assert.equal(update.version, pkg.version);
assert.equal(
  update.update_link,
  `https://github.com/WeiCheng14159/zotero_paper2speech/releases/download/v${pkg.version}/paper-2-speech.xpi`,
);
assert.equal(
  update.update_hash,
  `sha512:${createHash("sha512")
    .update(await readFile(xpi))
    .digest("hex")}`,
);
console.log(
  `Verified v${pkg.version}: packaged icon, preferences icon, XPI and update feed checksum.`,
);
