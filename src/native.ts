import {
  speechArguments,
  type Playback,
  type SpeechSettings,
} from "./speech.ts";

function subprocess() {
  return ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs")
    .Subprocess;
}

export async function startNativeSpeech(
  text: string,
  settings: SpeechSettings,
): Promise<Playback> {
  if (!Zotero.isMac)
    throw new Error(
      "Paper2Speech requires macOS and its built-in speech engine.",
    );
  const process = await subprocess().call({
    command: "/usr/bin/say",
    arguments: speechArguments(settings),
    stderr: "pipe",
  });
  let stopped = false;
  // Use stdin, not shell commands or command-line text; long papers stay local.
  const feed = (async () => {
    await process.stdin.write(text);
    await process.stdin.close();
  })();
  const finished = (async () => {
    const results = await Promise.allSettled([
      feed,
      process.stderr.readString(),
      process.stdout.readString(),
      process.wait(),
    ]);
    if (stopped) return;
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
    const exit = results[3];
    const stderr = results[1];
    if (exit.status === "fulfilled" && exit.value.exitCode !== 0) {
      throw new Error(
        `macOS speech failed: ${stderr.status === "fulfilled" ? stderr.value : "unknown error"}`,
      );
    }
  })();
  return {
    finished,
    async stop() {
      stopped = true;
      await process.kill();
      await finished;
    },
  };
}

export async function listVoices(): Promise<string[]> {
  const process = await subprocess().call({
    command: "/usr/bin/say",
    arguments: ["-v", "?"],
    stderr: "pipe",
  });
  await process.stdin.close();
  const [output, error, result] = await Promise.all([
    process.stdout.readString(),
    process.stderr.readString(),
    process.wait(),
  ]);
  if (result.exitCode !== 0)
    throw new Error(error || "Cannot list macOS voices.");
  return output
    .split("\n")
    .map((line: string) =>
      line.match(/^(.*?)\s+[a-z]{2,3}_[A-Z]{2}\s+#/)?.[1]?.trim(),
    )
    .filter(Boolean) as string[];
}
