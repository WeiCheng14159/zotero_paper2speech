import { SpeechController, type SpeechStatus } from "./speech.ts";
import { startNativeSpeech } from "./native.ts";
import { extractPaper } from "./paper.ts";
import { config } from "../package.json";
import { getSettings, Preferences } from "./preferences.ts";
import { readerControls } from "./controls.ts";

type MainWindow = _ZoteroTypes.MainWindow;

class Paper2Speech {
  initialized = false;
  readonly preferences = new Preferences();
  private preferencePane?: string;
  private readerGroups = new Set<HTMLElement>();
  private renderReaderToolbar: _ZoteroTypes.Reader.EventHandler<"renderToolbar"> =
    ({ reader, doc, append }) => {
      for (const old of this.readerGroups) {
        if (!old.isConnected || old.ownerDocument === doc) {
          old.remove();
          this.readerGroups.delete(old);
        }
      }
      const group = readerControls(
        doc,
        () => {
          if (!reader.itemID) return;
          const item = Zotero.Items.get(reader.itemID);
          if (item) void this.readItem(item);
        },
        () => this.stop(),
      );
      this.readerGroups.add(group);
      append(group);
      this.updateControls(group);
    };
  private windows = new Map<
    MainWindow,
    { nodes: Element[]; cleanups: (() => void)[] }
  >();
  private detail = "";
  readonly speech = new SpeechController(
    startNativeSpeech,
    (_status, detail) => {
      this.detail = detail || "";
      this.refresh();
    },
    (error) => this.showError(error),
  );

  async startup() {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);
    this.preferencePane = await Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      id: `${config.addonRef}-preferences`,
      src: "content/preferences.xhtml",
      label: "Paper2Speech",
      image: "content/icons/icon.svg",
    });
    Zotero.Reader.registerEventListener(
      "renderToolbar",
      this.renderReaderToolbar,
      config.addonID,
    );
    for (const win of Zotero.getMainWindows()) this.loadWindow(win);
    this.initialized = true;
  }

  loadWindow(win: MainWindow) {
    if (this.windows.has(win)) return;
    const nodes: Element[] = [];
    const cleanups: (() => void)[] = [];
    this.windows.set(win, { nodes, cleanups });
    const doc = win.document;
    const toolbar = doc.getElementById("zotero-items-toolbar");
    if (toolbar) {
      const group = doc.createXULElement("hbox");
      group.id = `${config.addonRef}-controls`;
      group.setAttribute("align", "center");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", "Paper2Speech");
      group.setAttribute("style", "margin-inline:4px;");
      for (const [action, label] of [
        ["read", "Read Selected Paper Aloud"],
        ["stop", "Stop Reading"],
      ] as const) {
        const button = doc.createXULElement("toolbarbutton");
        button.id = `${config.addonRef}-${action}`;
        button.className = "zotero-tb-button";
        button.setAttribute("data-p2s-action", action);
        button.setAttribute("tooltiptext", `Paper2Speech: ${label}`);
        button.setAttribute("aria-label", label);
        button.setAttribute(
          "image",
          `chrome://${config.addonRef}/content/icons/${action === "read" ? "play" : "stop"}.svg`,
        );
        button.setAttribute(
          "style",
          "-moz-context-properties:fill;fill:currentColor;min-width:28px;padding:4px;",
        );
        button.addEventListener("command", () =>
          action === "read" ? void this.read(win, true) : this.stop(),
        );
        group.append(button);
      }
      toolbar.insertBefore(
        group,
        doc.getElementById("zotero-tb-search") || null,
      );
      nodes.push(group);
    }
    for (const [parentID, context] of [
      ["zotero-itemmenu", true],
      ["menu_ToolsPopup", false],
    ] as const) {
      const parent = doc.getElementById(parentID);
      if (!parent) continue;
      const menu = doc.createXULElement("menu");
      menu.id = `${config.addonRef}-${context ? "item" : "tools"}`;
      menu.setAttribute("label", "Paper2Speech");
      const popup = doc.createXULElement("menupopup");
      menu.append(popup);
      const add = (action: string, label: string, callback?: () => void) => {
        const node = doc.createXULElement("menuitem");
        node.setAttribute("label", label);
        node.setAttribute("data-p2s-action", action);
        if (action === "read" || action === "stop") {
          node.className = "menuitem-iconic";
          node.setAttribute(
            "image",
            `chrome://${config.addonRef}/content/icons/${action === "read" ? "play" : "stop"}.svg`,
          );
        }
        if (callback) node.addEventListener("command", callback);
        popup.append(node);
      };
      add(
        "read",
        context ? "Read Selected Paper Aloud" : "Read Current Paper Aloud",
        () => void this.read(win, context),
      );
      add("stop", "Stop Reading", () => this.stop());
      popup.append(doc.createXULElement("menuseparator"));
      add("settings", "Settings…", () => this.openPreferences());
      add("status", "Ready");
      parent.append(menu);
      nodes.push(menu);
      const refresh = () => this.refresh();
      parent.addEventListener("popupshowing", refresh);
      cleanups.push(() => parent.removeEventListener("popupshowing", refresh));
    }
    this.refresh();
  }

  unloadWindow(win: MainWindow) {
    const entry = this.windows.get(win);
    entry?.cleanups.forEach((cleanup) => cleanup());
    entry?.nodes.forEach((node) => node.remove());
    this.windows.delete(win);
    if (!this.windows.size)
      void this.speech.stop().catch((error) => Zotero.logError(error));
  }

  private selectedItem(win: MainWindow, context: boolean): Zotero.Item {
    if (!context && win.Zotero_Tabs.selectedID !== "zotero-pane") {
      const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
      if (reader?.itemID) {
        const item = Zotero.Items.get(reader.itemID);
        if (item) return item;
      }
    }
    const selected = win.ZoteroPane.getSelectedItems();
    if (selected.length !== 1)
      throw new Error(
        "Select exactly one paper or PDF attachment to read aloud.",
      );
    return selected[0];
  }

  initPreferences(win: Window) {
    return this.preferences.load(win);
  }

  openPreferences() {
    return Zotero.Utilities.Internal.openPreferences(
      this.preferencePane || `${config.addonRef}-preferences`,
    );
  }

  private stop() {
    void this.speech.stop().catch((error) => this.showError(error));
  }

  async read(win: MainWindow, context = false) {
    try {
      const item = this.selectedItem(win, context);
      await this.readItem(item);
    } catch (error) {
      this.showError(error);
    }
  }

  private async readItem(item: Zotero.Item) {
    try {
      if (!Zotero.isMac)
        throw new Error(
          "Paper2Speech requires macOS and its built-in speech engine.",
        );
      await this.speech.read(
        () => extractPaper(item),
        getSettings(),
        String(item.getField("title")),
      );
    } catch (error) {
      this.showError(error);
    }
  }

  private refresh() {
    for (const { nodes } of this.windows.values()) {
      for (const node of nodes) this.updateControls(node);
    }
    for (const group of this.readerGroups) {
      if (!group.isConnected) this.readerGroups.delete(group);
      else this.updateControls(group);
    }
  }

  private updateControls(root: Element) {
    const labels: Record<SpeechStatus, string> = {
      idle: "Ready",
      loading: "Extracting PDF text…",
      speaking: "Reading",
      error: "Reading failed",
    };
    for (const node of root.querySelectorAll("[data-p2s-action]")) {
      const action = node.getAttribute("data-p2s-action");
      const disabled =
        action === "status" ||
        !Zotero.isMac ||
        (action === "stop" &&
          !["loading", "speaking"].includes(this.speech.status));
      if (disabled) node.setAttribute("disabled", "true");
      else node.removeAttribute("disabled");
      if (action === "status") {
        node.setAttribute(
          "label",
          labels[this.speech.status] +
            (this.detail ? `: ${this.detail.slice(0, 70)}` : ""),
        );
      }
    }
  }

  private showError(error: unknown) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    Services.prompt.alert(
      Zotero.getMainWindow() as unknown as mozIDOMWindowProxy,
      "Paper2Speech",
      error instanceof Error ? error.message : String(error),
    );
  }

  async shutdown() {
    this.initialized = false;
    await this.speech.shutdown();
    Zotero.Reader.unregisterEventListener(
      "renderToolbar",
      this.renderReaderToolbar,
    );
    for (const group of this.readerGroups) group.remove();
    this.readerGroups.clear();
    this.preferences.shutdown();
    if (this.preferencePane)
      Zotero.PreferencePanes.unregister(this.preferencePane);
    for (const win of [...this.windows.keys()]) this.unloadWindow(win);
  }
}

// bootstrap.js supplies the Zotero/Gecko globals to this script's sandbox.
(Zotero as typeof Zotero & { Paper2Speech: Paper2Speech }).Paper2Speech =
  new Paper2Speech();
