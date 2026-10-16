import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { connectDebugger, freePort } from "./rdp.mjs";

// A disposable Zotero profile/data directory; the everyday library is never opened.
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, ".scaffold"), { recursive: true });
const temp = await mkdtemp(path.join(root, ".scaffold/integration-"));
const profile = path.join(temp, "profile");
const data = path.join(temp, "data");
const helper = path.join(temp, "helper");
await mkdir(helper, { recursive: true });
await mkdir(data, { recursive: true });
await mkdir(profile, { recursive: true });
const fixturePath = path.join(temp, "fixture.pdf");
const resultPath = path.join(temp, "result.json");
const buildDir = path.join(root, ".scaffold/build");
const xpi = (await readdir(buildDir)).find((name) => name.endsWith(".xpi"));
if (!xpi) throw new Error("Run npm run build first.");

// Minimal two-page, text-bearing PDF fixture with a correct cross-reference table.
const stream = (text) => {
  const content = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET\n`;
  return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`;
};
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  stream("First page. Paper to speech test."),
  stream("Second page. Test complete."),
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
objects.forEach((object, index) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
pdf += offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
  .join("");
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(fixturePath, pdf);
const prefs = {
  "browser.dom.window.dump.enabled": true,
  "devtools.debugger.remote-enabled": true,
  "devtools.debugger.remote-websocket": false,
  "devtools.debugger.prompt-connection": false,
  "devtools.debugger.force-local": true,
  "extensions.autoDisableScopes": 0,
  "xpinstall.signatures.required": false,
  "extensions.logging.enabled": true,
  "extensions.enabledScopes": 15,
  "extensions.zotero.firstRun2": false,
  "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
  "extensions.zoteroMacWordIntegration.skipInstallation": true,
  "extensions.zoteroOpenOfficeIntegration.skipInstallation": true,
  "extensions.zotero.dataDir": data,
  "extensions.zotero.useDataDir": true,
  "extensions.zotero.sync.autoSync": false,
  "extensions.zotero.reportTranslationFailure": false,
  "toolkit.telemetry.enabled": false,
  "app.update.enabled": false,
};
await writeFile(
  path.join(profile, "prefs.js"),
  Object.entries(prefs)
    .map(
      ([key, value]) =>
        `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
    )
    .join("\n"),
);
await writeFile(
  path.join(helper, "manifest.json"),
  JSON.stringify({
    manifest_version: 2,
    name: "Paper2Speech Integration Test",
    version: "1.0",
    applications: {
      zotero: {
        id: "paper2speech-test@zotero.local",
        update_url: "https://example.invalid/paper2speech-test-update.json",
        strict_min_version: "7.0",
        strict_max_version: "10.*",
      },
    },
  }),
);
await writeFile(
  path.join(helper, "bootstrap.js"),
  `
function install() {}
function uninstall() {}
function shutdown() {}
function onMainWindowLoad() {}
function onMainWindowUnload() {}
function startup({ rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "test.js", {
    Zotero, Services, ChromeUtils, Cc, Ci, IOUtils,
    fixturePath: ${JSON.stringify(fixturePath)}, resultPath: ${JSON.stringify(resultPath)}
  });
}
`,
);
await build({
  entryPoints: [path.join(root, "test/integration.ts")],
  outfile: path.join(helper, "test.js"),
  bundle: true,
  target: "firefox115",
});
const binary =
  process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH ||
  "/Applications/Zotero.app/Contents/MacOS/zotero";
console.log(`Testing in disposable profile: ${temp}`);
console.log(
  "The test will briefly speak a two-page fixture using macOS speech.",
);
const port = await freePort();
const child = spawn(
  binary,
  [
    "-no-remote",
    "-profile",
    profile,
    "-ZoteroDebugText",
    "-start-debugger-server",
    String(port),
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
const logFile = createWriteStream(path.join(temp, "zotero.log"));
child.stdout.on("data", (data) => {
  log += data;
  logFile.write(data);
});
child.stderr.on("data", (data) => {
  log += data;
  logFile.write(data);
});
const timeout = setTimeout(() => child.kill("SIGTERM"), 90_000);
const exited = new Promise((resolve, reject) => {
  child.once("exit", resolve);
  child.once("error", reject);
});
let client;
try {
  client = await connectDebugger(port);
  const rootActor = await client.request("root", "getRoot");
  for (const addonPath of [path.join(buildDir, xpi), helper]) {
    const response = await client.request(
      rootActor.addonsActor,
      "installTemporaryAddon",
      { addonPath },
    );
    console.log(`Loaded test extension: ${JSON.stringify(response)}`);
  }
} catch (error) {
  console.error(error);
  child.kill("SIGTERM");
} finally {
  client?.close();
}
await exited;
clearTimeout(timeout);
await new Promise((resolve) => logFile.end(resolve));
try {
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch {
  console.error(`No test result. Inspect ${path.join(temp, "zotero.log")}`);
  console.error(log.slice(-8000));
  process.exitCode = 1;
}
