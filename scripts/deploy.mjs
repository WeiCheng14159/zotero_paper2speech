import {
  readFile,
  readdir,
  mkdir,
  mkdtemp,
  copyFile,
  stat,
  writeFile,
  unlink,
} from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectDebugger, freePort } from "./rdp.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const profile = process.argv[2];
if (
  process.platform !== "darwin" ||
  !profile ||
  !path.isAbsolute(profile) ||
  !process.argv.includes("--restart")
) {
  throw new Error(
    "On macOS: npm run deploy -- '/absolute/path/to/Zotero/profile' --restart",
  );
}
const prefsPath = path.join(profile, "prefs.js");
if (!(await stat(prefsPath)).isFile()) throw new Error("Not a Zotero profile.");
const build = path.join(root, ".scaffold/build");
const xpis = (await readdir(build)).filter((name) => name.endsWith(".xpi"));
if (xpis.length !== 1) throw new Error("Run npm run build first.");
const xpi = path.join(build, xpis[0]);
const manifest = JSON.parse(
  execFileSync("/usr/bin/unzip", ["-p", xpi, "manifest.json"], {
    encoding: "utf8",
  }),
);
if (
  manifest.applications.zotero.id !== pkg.config.addonID ||
  manifest.version !== pkg.version
)
  throw new Error("Rebuild the XPI: ID/version mismatch.");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function running() {
  try {
    return !!execFileSync("/usr/bin/pgrep", ["-x", "zotero"], {
      encoding: "utf8",
    }).trim();
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}
async function quit() {
  if (!running()) return;
  execFileSync("/usr/bin/osascript", [
    "-e",
    'tell application "Zotero" to quit',
  ]);
  const deadline = Date.now() + 30_000;
  while (running() && Date.now() < deadline) await delay(250);
  if (running())
    throw new Error("Zotero did not quit. Close modal dialogs and retry.");
}
async function optionalRead(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

console.log("Installing through Zotero's add-on manager…");
await quit();
const work = await mkdtemp(path.join(root, ".scaffold/deploy-"));
const helper = path.join(work, "installer");
await mkdir(helper);
try {
  await copyFile(
    path.join(profile, "extensions", `${pkg.config.addonID}.xpi`),
    path.join(work, "previous.xpi"),
  );
  console.log(`Previous XPI backed up in ${work}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
// Enable a localhost-only debugger for installation, then restore prior prefs.
const overrides = {
  "devtools.debugger.remote-enabled": true,
  "devtools.debugger.remote-websocket": false,
  "devtools.debugger.prompt-connection": false,
  "devtools.debugger.force-local": true,
};
const originalPrefs = await readFile(prefsPath, "utf8");
const userPath = path.join(profile, "user.js");
const originalUser = await optionalRead(userPath);
await writeFile(path.join(work, "prefs-before.js"), originalPrefs, {
  mode: 0o600,
});
if (originalUser !== null)
  await writeFile(path.join(work, "user-before.js"), originalUser, {
    mode: 0o600,
  });
const overriddenLine = (line) =>
  Object.keys(overrides).some((key) =>
    line.startsWith(`user_pref(${JSON.stringify(key)},`),
  );
const savedLines = originalPrefs.split("\n").filter(overriddenLine);
const resultPath = path.join(work, "result.json");
await writeFile(
  path.join(helper, "manifest.json"),
  JSON.stringify({
    manifest_version: 2,
    name: "Paper2Speech Temporary Installer",
    version: "1.0",
    applications: {
      zotero: {
        id: "paper2speech-installer@zotero.local",
        update_url: "https://example.invalid/installer.json",
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
function startup() { void runInstall(); }
async function runInstall() {
  try {
    await Promise.all([Zotero.initializationPromise, Zotero.uiReadyPromise]);
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(${JSON.stringify(xpi)});
    const installer = await AddonManager.getInstallForFile(file);
    await installer.install();
    for (let n = 0; n < 200 && !Zotero.Paper2Speech?.initialized; n++) await Zotero.Promise.delay(100);
    const addon = await AddonManager.getAddonByID(${JSON.stringify(pkg.config.addonID)});
    const menu = Zotero.getMainWindow().document.getElementById("zotero-paper2speech-tools");
    const controls = Zotero.getMainWindow().document.getElementById("zotero-paper2speech-controls");
    const prefs = Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === "zotero-paper2speech-preferences");
    if (!addon?.isActive || !Zotero.Paper2Speech?.initialized || !menu || !controls || !prefs) throw new Error("Plugin did not initialize after installation");
    await Zotero.File.putContentsAsync(${JSON.stringify(resultPath)}, JSON.stringify({ ok: true, id: addon.id, version: addon.version, active: addon.isActive, initialized: true, menu: true, controls: true, preferences: true }));
  } catch (error) {
    await Zotero.File.putContentsAsync(${JSON.stringify(resultPath)}, JSON.stringify({ ok: false, error: String(error) }));
  }
}
`,
);
let client;
try {
  await writeFile(
    userPath,
    (originalUser || "") +
      "\n" +
      Object.entries(overrides)
        .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${value});`)
        .join("\n") +
      "\n",
    { mode: 0o600 },
  );
  const port = await freePort();
  const binary =
    process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH ||
    "/Applications/Zotero.app/Contents/MacOS/zotero";
  const child = spawn(
    binary,
    ["-profile", profile, "-start-debugger-server", String(port)],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  client = await connectDebugger(port);
  const rootActor = await client.request("root", "getRoot");
  await client.request(rootActor.addonsActor, "installTemporaryAddon", {
    addonPath: helper,
  });
  const deadline = Date.now() + 45_000;
  let result;
  while (Date.now() < deadline) {
    const text = await optionalRead(resultPath);
    if (text) {
      result = JSON.parse(text);
      break;
    }
    await delay(250);
  }
  if (!result?.ok)
    throw new Error(result?.error || `Installation timed out. See ${work}`);
  console.log(`Verified live plugin: ${JSON.stringify(result)}`);
} finally {
  client?.close();
  await quit();
  const currentPrefs = await readFile(prefsPath, "utf8");
  await writeFile(
    prefsPath,
    currentPrefs
      .split("\n")
      .filter((line) => !overriddenLine(line))
      .join("\n") +
      savedLines.join("\n") +
      "\n",
  );
  if (originalUser === null) await unlink(userPath);
  else await writeFile(userPath, originalUser);
  execFileSync("/usr/bin/open", ["-a", "Zotero"]);
}
const data = JSON.parse(
  await readFile(path.join(profile, "extensions.json"), "utf8"),
);
const addon = data.addons.find((addon) => addon.id === pkg.config.addonID);
if (
  !addon?.active ||
  addon.userDisabled ||
  addon.appDisabled ||
  addon.version !== pkg.version
)
  throw new Error("Persistent active status not confirmed.");
console.log(
  `Installed and active: ${pkg.config.addonName} ${pkg.version}. Normal Zotero session restored.`,
);
