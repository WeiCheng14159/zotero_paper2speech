import net from "node:net";

// Minimal sequential client for Gecko's local, length-prefixed debug protocol.
export async function connectDebugger(port, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let socket;
  while (Date.now() < deadline) {
    try {
      socket = await new Promise((resolve, reject) => {
        const candidate = net.connect({ host: "127.0.0.1", port });
        candidate.once("connect", () => resolve(candidate));
        candidate.once("error", reject);
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!socket)
    throw new Error("Timed out connecting to the disposable Zotero debugger.");
  let buffer = Buffer.alloc(0);
  let pending;
  socket.on("error", (error) => pending?.reject(error));
  socket.on("close", () =>
    pending?.reject(new Error("Zotero debugger disconnected")),
  );
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const colon = buffer.indexOf(58);
      if (colon < 0) return;
      const size = Number(buffer.subarray(0, colon).toString());
      if (!Number.isInteger(size) || size < 0)
        throw new Error("Invalid debugger frame");
      if (buffer.length < colon + 1 + size) return;
      const message = JSON.parse(
        buffer.subarray(colon + 1, colon + 1 + size).toString(),
      );
      buffer = buffer.subarray(colon + 1 + size);
      if (
        pending &&
        message.from === pending.actor &&
        !message.applicationType
      ) {
        const request = pending;
        pending = undefined;
        if (message.error) request.reject(new Error(JSON.stringify(message)));
        else request.resolve(message);
      }
    }
  });
  return {
    request(actor, type, data = {}) {
      if (pending) throw new Error("Debugger requests must be sequential");
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending = undefined;
          reject(new Error(`Debugger request timed out: ${type}`));
          socket.destroy();
        }, 45_000);
        pending = {
          actor,
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        };
        const message = JSON.stringify({ to: actor, type, ...data });
        socket.write(`${Buffer.byteLength(message)}:${message}`);
      });
    },
    close() {
      socket.destroy();
    },
  };
}

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
