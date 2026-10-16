export interface SpeechSettings {
  rate: number;
  voice: string;
}

export interface Playback {
  finished: Promise<void>;
  stop(): Promise<void>;
}

export type SpeechStatus = "idle" | "loading" | "speaking" | "error";

export function normalizeText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      .replace(/\u00ad/g, "")
      .replace(/([\p{L}])-[ \t]*\n[ \t]*([\p{Ll}])/gu, "$1$2")
      .replace(/[\u0000-\u0008\u000b\u000e-\u001f]/g, "")
      // macOS speech interprets [[...]] as commands; treat PDF content as text.
      .replace(/\[\[/g, "(")
      .replace(/\]\]/g, ")")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function speechArguments(settings: SpeechSettings): string[] {
  if (
    !Number.isInteger(settings.rate) ||
    settings.rate < 80 ||
    settings.rate > 450
  ) {
    throw new Error(
      "Speech rate must be an integer from 80 to 450 words per minute.",
    );
  }
  const args = ["-r", String(settings.rate)];
  if (settings.voice.trim()) args.push("-v", settings.voice.trim());
  return args;
}

/** A generation counter prevents cancelled extraction from starting speech. */
export class SpeechController {
  status: SpeechStatus = "idle";
  private generation = 0;
  private playback?: Playback;
  private pending = new Set<Promise<void>>();
  private start: (text: string, settings: SpeechSettings) => Promise<Playback>;
  private changed: (status: SpeechStatus, detail?: string) => void;
  private failed: (error: unknown) => void;

  constructor(
    start: (text: string, settings: SpeechSettings) => Promise<Playback>,
    changed: (status: SpeechStatus, detail?: string) => void,
    failed: (error: unknown) => void,
  ) {
    this.start = start;
    this.changed = changed;
    this.failed = failed;
  }

  private update(status: SpeechStatus, detail?: string) {
    this.status = status;
    this.changed(status, detail);
  }

  async stop(): Promise<void> {
    ++this.generation;
    const playback = this.playback;
    this.playback = undefined;
    this.update("idle");
    if (playback) await playback.stop();
  }

  async read(
    load: () => Promise<string>,
    settings: SpeechSettings,
    title: string,
  ) {
    const previous = this.playback;
    this.playback = undefined;
    const generation = ++this.generation;
    this.update("loading", title);
    try {
      if (previous) await previous.stop();
      if (generation !== this.generation) return;
      speechArguments(settings);
      const text = normalizeText(await load());
      if (generation !== this.generation) return;
      if (!text) {
        throw new Error(
          "This PDF has no extractable text. Scanned papers need OCR before they can be read aloud.",
        );
      }
      // Track native startup so shutdown waits until any late process is killed.
      const task = this.startAndMonitor(text, settings, title, generation);
      this.pending.add(task);
      void task.finally(() => this.pending.delete(task));
    } catch (error) {
      this.report(error, generation);
    }
  }

  private async startAndMonitor(
    text: string,
    settings: SpeechSettings,
    title: string,
    generation: number,
  ) {
    try {
      const playback = await this.start(text, settings);
      // Attach a rejection handler before stopping a superseded native process.
      const finished = playback.finished.catch((error) => {
        this.report(error, generation);
      });
      if (generation !== this.generation) {
        await playback.stop();
        await finished;
        return;
      }
      this.playback = playback;
      this.update("speaking", title);
      await finished;
      if (generation === this.generation) {
        this.playback = undefined;
        if (this.status !== "error") this.update("idle");
      }
    } catch (error) {
      this.report(error, generation);
    }
  }

  private report(error: unknown, generation: number) {
    if (generation !== this.generation) return;
    this.playback = undefined;
    this.update("error");
    this.failed(error);
  }

  async shutdown() {
    await this.stop();
    await Promise.allSettled([...this.pending]);
  }
}
