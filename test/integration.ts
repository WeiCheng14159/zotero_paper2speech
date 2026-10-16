import { extractPaper, resolvePDF } from "../src/paper.ts";
import { listVoices, startNativeSpeech } from "../src/native.ts";

declare const fixturePath: string;
declare const resultPath: string;

async function run() {
  const checks: string[] = [];
  const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const waitFor = async (condition: () => unknown) => {
    for (let n = 0; n < 200 && !condition(); n++)
      await Zotero.Promise.delay(100);
    if (!condition()) throw new Error("Timed out waiting for UI");
  };
  const capture = async (window: any, name: string) => {
    const canvas = window.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas
      .getContext("2d")
      .drawWindow(window, 0, 0, canvas.width, canvas.height, "white");
    const bytes = Uint8Array.from(
      window.atob(canvas.toDataURL("image/png").split(",")[1]),
      (c: string) => c.charCodeAt(0),
    );
    await IOUtils.write(
      resultPath.replace("result.json", name + ".png"),
      bytes,
    );
  };
  try {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);
    const api = () => (Zotero as any).Paper2Speech;
    for (let n = 0; n < 100 && !api()?.initialized; n++)
      await Zotero.Promise.delay(100);
    assert(api()?.initialized, "Plugin initializes in Zotero");
    const win = Zotero.getMainWindow();
    const { AddonManager } = ChromeUtils.importESModule(
      "resource://gre/modules/AddonManager.sys.mjs",
    );
    const addon = await AddonManager.getAddonByID(
      "zotero-paper2speech@zotero.local",
    );
    assert(
      addon.iconURL?.endsWith("content/icons/icon.svg"),
      "Plugin manager uses the bundled monochrome icon",
    );
    const icon = new win.Image();
    icon.src = addon.iconURL;
    await icon.decode();
    assert(
      icon.naturalWidth === 48 && icon.naturalHeight === 48,
      "Zotero decodes the SVG plugin icon",
    );
    assert(
      win.document.getElementById("zotero-paper2speech-item"),
      "Library context menu is registered",
    );
    assert(
      win.document.getElementById("zotero-paper2speech-tools"),
      "Tools menu is registered",
    );
    api().loadWindow(win);
    assert(
      win.document.querySelectorAll("#zotero-paper2speech-tools").length === 1,
      "Window registration is idempotent",
    );
    const voices = await listVoices();
    assert(
      voices.length > 0,
      `Installed macOS voices are available (${voices.length})`,
    );
    const playButton = win.document.getElementById("zotero-paper2speech-read")!;
    const stopButton = win.document.getElementById("zotero-paper2speech-stop")!;
    assert(
      playButton?.getAttribute("image")?.endsWith("play.svg") &&
        stopButton?.getAttribute("image")?.endsWith("stop.svg"),
      "Library toolbar has Play and Stop icons",
    );
    assert(
      stopButton.hasAttribute("disabled"),
      "Stop icon is disabled while idle",
    );
    const prefsWin = api().openPreferences();
    await waitFor(
      () =>
        prefsWin?.document.getElementById("paper2speech-voice")?.disabled ===
        false,
    );
    const voice = prefsWin.document.getElementById("paper2speech-voice");
    const rate = prefsWin.document.getElementById("paper2speech-rate");
    const slider = prefsWin.document.getElementById("paper2speech-rate-slider");
    assert(
      voice.options.length === voices.length + 1,
      "Preferences lists installed voices and system default",
    );
    const selectedVoice = voices.includes("Samantha") ? "Samantha" : voices[0];
    voice.value = selectedVoice;
    voice.dispatchEvent(new prefsWin.Event("change"));
    rate.value = "300";
    rate.dispatchEvent(new prefsWin.Event("change"));
    assert(
      Zotero.Prefs.get("extensions.zotero.zotero-paper2speech.rate", true) ===
        300 &&
        Zotero.Prefs.get(
          "extensions.zotero.zotero-paper2speech.voice",
          true,
        ) === selectedVoice &&
        slider.value === "300",
      "Voice and speed selections persist and slider stays in sync",
    );
    rate.value = "999";
    rate.dispatchEvent(new prefsWin.Event("change"));
    assert(
      Zotero.Prefs.get("extensions.zotero.zotero-paper2speech.rate", true) ===
        300 && rate.getAttribute("aria-invalid") === "true",
      "Invalid speed does not overwrite saved speed",
    );
    slider.value = "280";
    slider.dispatchEvent(new prefsWin.Event("input"));
    assert(
      rate.value === "280" &&
        Zotero.Prefs.get("extensions.zotero.zotero-paper2speech.rate", true) ===
          280,
      "Speed slider saves a valid value",
    );
    await capture(prefsWin, "preferences");
    prefsWin.close();
    const parent = new Zotero.Item("journalArticle");
    parent.setField("title", "Paper2Speech integration fixture");
    await parent.saveTx();
    const attachment = await Zotero.Attachments.importFromFile({
      file: fixturePath,
      parentItemID: parent.id,
    });
    assert(
      (await resolvePDF(parent)).id === attachment.id,
      "Parent paper resolves to its PDF attachment",
    );
    assert(
      (await resolvePDF(attachment)).id === attachment.id,
      "Selected PDF resolves directly",
    );
    const text = await extractPaper(parent);
    assert(
      text.includes("First page") && text.includes("Second page"),
      "Zotero extracts both PDF pages",
    );
    Zotero.Prefs.set("extensions.zotero.zotero-paper2speech.rate", 300, true);
    await win.ZoteroPane.selectItem(parent.id);
    // Exercise the actual UI command callback, not only the extraction helper.
    await capture(win, "library");
    const read = playButton;
    read!.dispatchEvent(new win.Event("command"));
    let speaking = false;
    for (let n = 0; n < 200; n++) {
      speaking ||= api().speech.status === "speaking";
      if (speaking && api().speech.status === "idle") break;
      if (api().speech.status === "error")
        throw new Error("UI playback failed");
      await Zotero.Promise.delay(100);
    }
    assert(
      speaking && api().speech.status === "idle",
      "Library Play icon speaks the selected paper and completes",
    );
    const reader = await Zotero.Reader.open(attachment.id);
    await waitFor(() =>
      (reader as any)?._iframeWindow?.document.querySelector(
        ".paper2speech-reader-controls",
      ),
    );
    const readerWin = (reader as any)._iframeWindow;
    const readerGroup = readerWin.document.querySelector(
      ".paper2speech-reader-controls",
    );
    const readerPlay = readerGroup.querySelector('[data-p2s-action="read"]');
    const readerStop = readerGroup.querySelector('[data-p2s-action="stop"]');
    assert(
      readerPlay.querySelector("svg") && readerStop.querySelector("svg"),
      "PDF reader toolbar has Play and Stop icons",
    );
    readerPlay.click();
    await waitFor(() => api().speech.status === "speaking");
    assert(
      !readerStop.disabled && !stopButton.hasAttribute("disabled"),
      "Stop state stays in sync between reader and library",
    );
    readerStop.click();
    await waitFor(() => api().speech.status === "idle");
    assert(
      readerStop.disabled,
      "Reader Stop icon stops playback and returns to idle",
    );
    await capture(readerWin, "reader");
    const playback = await startNativeSpeech(
      "This reading will be stopped. ".repeat(100),
      {
        rate: 180,
        voice: voices.includes("Samantha") ? "Samantha" : voices[0],
      },
    );
    await Zotero.Promise.delay(200);
    await playback.stop();
    await playback.finished;
    assert(true, "Native Stop terminates owned speech and settles playback");
    await api().shutdown();
    assert(
      !win.document.getElementById("zotero-paper2speech-tools"),
      "Shutdown removes menus",
    );
    assert(
      !win.document.getElementById("zotero-paper2speech-controls") &&
        !readerWin.document.querySelector(".paper2speech-reader-controls"),
      "Shutdown removes toolbar icons",
    );
    assert(
      !Zotero.PreferencePanes.pluginPanes.some(
        (pane) => pane.id === "zotero-paper2speech-preferences",
      ),
      "Shutdown unregisters preferences",
    );
    await Zotero.File.putContentsAsync(
      resultPath,
      JSON.stringify({ ok: true, zotero: Zotero.version, checks }, null, 2),
    );
  } catch (error) {
    Zotero.logError(error);
    await Zotero.File.putContentsAsync(
      resultPath,
      JSON.stringify(
        {
          ok: false,
          checks,
          error: String(error),
          stack: (error as Error).stack,
        },
        null,
        2,
      ),
    );
  } finally {
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  }
}
void run();
