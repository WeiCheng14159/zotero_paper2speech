// Lifecycle layout adapted from windingwind/zotero-plugin-template (AGPL-3.0).
var chromeHandle;

function install() {}
function uninstall() {}

async function startup({ rootURI }) {
  chromeHandle = Cc["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Ci.amIAddonManagerStartup)
    .registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
      ["content", "__addonRef__", rootURI + "content/"],
    ]);
  const context = { Zotero, Services, ChromeUtils, Cc, Ci };
  Services.scriptloader.loadSubScript(
    rootURI + "content/scripts/__addonRef__.js",
    context,
  );
  await Zotero.__addonInstance__.startup();
}

async function onMainWindowLoad({ window }) {
  Zotero.__addonInstance__?.loadWindow(window);
}

async function onMainWindowUnload({ window }) {
  Zotero.__addonInstance__?.unloadWindow(window);
}

async function shutdown() {
  // Stop native speech on application exit as well as disable/uninstall.
  await Zotero.__addonInstance__?.shutdown();
  delete Zotero.__addonInstance__;
  chromeHandle?.destruct();
  chromeHandle = null;
}
