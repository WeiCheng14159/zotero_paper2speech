import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeText,
  speechArguments,
  SpeechController,
  type Playback,
} from "../src/speech.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const settings = { rate: 180, voice: "" };

test("PDF cleanup preserves Unicode and joins line-wrapped words", () => {
  assert.equal(
    normalizeText("A multi-\nmodal\u00ad paper.\n\nRésumé 中文\fNext page."),
    "A multimodal paper. Résumé 中文 Next page.",
  );
  assert.equal(normalizeText("[[slnc 99999]] hello"), "(slnc 99999) hello");
});

test("speech arguments validate rates and keep voice names as one argument", () => {
  assert.deepEqual(
    speechArguments({ rate: 200, voice: "Eddy (English (US))" }),
    ["-r", "200", "-v", "Eddy (English (US))"],
  );
  for (const rate of [0, 79, 451, 1.5, NaN, Infinity]) {
    assert.throws(() => speechArguments({ rate, voice: "" }));
  }
});

test("Stop during extraction prevents later playback", async () => {
  const load = deferred<string>();
  let starts = 0;
  const controller = new SpeechController(
    async () => {
      starts++;
      throw new Error("must not start");
    },
    () => {},
    assert.fail,
  );
  const reading = controller.read(() => load.promise, settings, "Paper");
  assert.equal(controller.status, "loading");
  await controller.stop();
  load.resolve("Late extraction result");
  await reading;
  assert.equal(starts, 0);
  assert.equal(controller.status, "idle");
});

test("replacing a pending extraction reads only the latest paper", async () => {
  const load = deferred<string>();
  const spoken: string[] = [];
  const controller = new SpeechController(
    async (text) => {
      spoken.push(text);
      return { finished: Promise.resolve(), stop: async () => {} };
    },
    () => {},
    assert.fail,
  );
  const first = controller.read(() => load.promise, settings, "First");
  await controller.read(async () => "Second", settings, "Second");
  load.resolve("First");
  await first;
  await tick();
  assert.deepEqual(spoken, ["Second"]);
  assert.equal(controller.status, "idle");
});

test("Stop kills a process whose startup completes after cancellation", async () => {
  const start = deferred<Playback>();
  const done = deferred<void>();
  let stopped = false;
  const controller = new SpeechController(
    () => start.promise,
    () => {},
    assert.fail,
  );
  await controller.read(async () => "Paper", settings, "Paper");
  await controller.stop();
  start.resolve({
    finished: done.promise,
    stop: async () => {
      stopped = true;
      done.resolve();
    },
  });
  await controller.shutdown();
  assert.ok(stopped);
  assert.equal(controller.status, "idle");
});

test("native errors and empty/scanned PDFs produce actionable failures", async () => {
  const errors: unknown[] = [];
  const controller = new SpeechController(
    async () => ({
      finished: Promise.reject(new Error("voice unavailable")),
      stop: async () => {},
    }),
    () => {},
    (error) => errors.push(error),
  );
  await controller.read(async () => " \n ", settings, "Scan");
  assert.match(String(errors[0]), /OCR/);
  await controller.read(async () => "Paper", settings, "Paper");
  await tick();
  assert.match(String(errors[1]), /voice unavailable/);
  assert.equal(controller.status, "error");
});

test("replacing active playback stops the old process and completes the new one", async () => {
  const firstDone = deferred<void>();
  let starts = 0;
  let stops = 0;
  const controller = new SpeechController(
    async () => {
      if (++starts === 1)
        return {
          finished: firstDone.promise,
          stop: async () => {
            stops++;
            firstDone.resolve();
          },
        };
      return { finished: Promise.resolve(), stop: async () => {} };
    },
    () => {},
    assert.fail,
  );
  await controller.read(async () => "One", settings, "One");
  await tick();
  assert.equal(controller.status, "speaking");
  await controller.read(async () => "Two", settings, "Two");
  await tick();
  assert.equal(stops, 1);
  assert.equal(starts, 2);
  assert.equal(controller.status, "idle");
});
