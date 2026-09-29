import { describe, expect, it } from "vitest";
import { createFileTickets } from "./fileTickets.js";

const path =
  "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
const other =
  "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333";

describe("private file tickets", () => {
  it("binds the exact path, method, and expiry to an opaque signature", () => {
    const tickets = createFileTickets({
      origin: "https://example.test",
      signingKey: "x".repeat(32),
      now: () => 1_700_000_000_000,
    });
    const { url, expiresAt } = tickets.sign("PUT", path, 7200);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(`/api/pilot/files/${path}`);
    expect(parsed.searchParams.get("expires")).toBe("1700007200");
    expect(expiresAt).toBe("2023-11-15T00:13:20.000Z");
    const signature = parsed.searchParams.get("signature")!;
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      tickets.verify("PUT", path, "1700007200", signature),
    ).not.toThrow();
    for (const [method, changedPath, expiry] of [
      ["GET", path, "1700007200"],
      ["PUT", other, "1700007200"],
      ["PUT", path, "1700007201"],
    ] as const) {
      expect(() =>
        tickets.verify(method, changedPath, expiry, signature),
      ).toThrow();
    }
  });

  it("expires exactly at the deadline and rejects malformed inputs", () => {
    let now = 1_700_000_000_000;
    const tickets = createFileTickets({
      origin: "https://example.test",
      signingKey: "x".repeat(32),
      now: () => now,
    });
    const signed = new URL(tickets.sign("GET", path, 60).url);
    const expiry = signed.searchParams.get("expires")!;
    const signature = signed.searchParams.get("signature")!;
    now = Number(expiry) * 1000 - 1;
    expect(() => tickets.verify("GET", path, expiry, signature)).not.toThrow();
    now += 1;
    expect(() => tickets.verify("GET", path, expiry, signature)).toThrow();
    for (const bad of [
      "../outside",
      `${path}/extra`,
      path.replace("22222222", "aaaaaaaa").toUpperCase(),
      "a/b",
    ]) {
      expect(() => tickets.sign("GET", bad, 60)).toThrow();
    }
    for (const ttl of [0, 61, 1.5, Number.NaN]) {
      expect(() => tickets.sign("GET", path, ttl)).toThrow();
    }
    expect(() => tickets.sign("PUT", path, 7201)).toThrow();
    expect(() =>
      tickets.verify("GET", path, "0170000060", signature),
    ).toThrow();
    expect(() => tickets.verify("GET", path, expiry, "0".repeat(64))).toThrow();
  });
});
