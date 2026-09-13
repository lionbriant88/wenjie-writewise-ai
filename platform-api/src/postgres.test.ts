import { createServer } from "node:net";
import { expect, it } from "vitest";
import { createPostgresDatabase } from "./database.js";
it("cannot disable encrypted PostgreSQL negotiation via connection URL query options", async () => {
  let firstPacket: Buffer | undefined;
  const server = createServer((socket) =>
    socket.once("data", (data) => {
      firstPacket = data;
      socket.end("N");
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("missing_listener");
  const db = createPostgresDatabase(
    `postgres://synthetic:synthetic@127.0.0.1:${address.port}/postgres?ssl=0`,
  );
  try {
    await expect(db.query("SELECT 1")).rejects.toThrow();
    expect(firstPacket?.length).toBe(8);
    // PostgreSQL's literal SSLRequest protocol code, checked before credentials may be sent.
    expect(firstPacket?.readUInt32BE(4)).toBe(80877103);
  } finally {
    await db.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
