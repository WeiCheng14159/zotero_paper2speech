import { config } from "../package.json";
import { listVoices } from "./native.ts";
import { speechArguments, type SpeechSettings } from "./speech.ts";

export function getSettings(): SpeechSettings {
  return {
    rate: Number(Zotero.Prefs.get(`${config.prefsPrefix}.rate`, true) ?? 180),
    voice: String(Zotero.Prefs.get(`${config.prefsPrefix}.voice`, true) ?? ""),
  };
}

export class Preferences {
  private panes = new Map<Element, () => void>();

  async load(win: Window) {
    const doc = win.document;
    const root = doc.getElementById("paper2speech-preferences");
    if (!root || this.panes.has(root)) return;
    const voice = doc.getElementById("paper2speech-voice") as HTMLSelectElement;
    const rate = doc.getElementById("paper2speech-rate") as HTMLInputElement;
    const slider = doc.getElementById(
      "paper2speech-rate-slider",
    ) as HTMLInputElement;
    const status = doc.getElementById("paper2speech-preferences-status")!;
    const current = getSettings();
    rate.value = slider.value = String(current.rate);
    const saveRate = (event: Event) => {
      const input = event.target as HTMLInputElement;
      const next = Number(input.value);
      try {
        speechArguments({ rate: next, voice: "" });
        Zotero.Prefs.set(`${config.prefsPrefix}.rate`, next, true);
        rate.value = slider.value = String(next);
        status.textContent = "";
        rate.removeAttribute("aria-invalid");
      } catch {
        status.textContent = "Enter a whole number from 80 to 450.";
        rate.setAttribute("aria-invalid", "true");
      }
    };
    const saveVoice = () =>
      Zotero.Prefs.set(`${config.prefsPrefix}.voice`, voice.value, true);
    rate.addEventListener("change", saveRate);
    slider.addEventListener("input", saveRate);
    voice.addEventListener("change", saveVoice);
    const cleanup = () => {
      rate.removeEventListener("change", saveRate);
      slider.removeEventListener("input", saveRate);
      voice.removeEventListener("change", saveVoice);
      win.removeEventListener("unload", cleanup);
      this.panes.delete(root);
    };
    win.addEventListener("unload", cleanup, { once: true });
    this.panes.set(root, cleanup);
    if (!Zotero.isMac) {
      rate.disabled = slider.disabled = true;
      status.textContent = "Paper2Speech requires macOS.";
      return;
    }
    try {
      const voices = await listVoices();
      if (!root.isConnected || !this.panes.has(root)) return;
      voice.replaceChildren();
      const option = (value: string, label: string) => {
        const node = doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "option",
        ) as HTMLOptionElement;
        node.value = value;
        node.textContent = label;
        voice.append(node);
      };
      option("", "System default");
      for (const name of voices.sort((a, b) => a.localeCompare(b)))
        option(name, name);
      if (current.voice && !voices.includes(current.voice))
        option(current.voice, `${current.voice} (not currently installed)`);
      voice.value = current.voice;
      voice.disabled = false;
    } catch (error) {
      status.textContent = `Could not load macOS voices: ${String(error)}`;
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  shutdown() {
    for (const cleanup of [...this.panes.values()]) cleanup();
  }
}
