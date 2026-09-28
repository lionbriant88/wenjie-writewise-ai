import { describe, expect, it, vi } from "vitest";
import { createPrivateStorage, readBoundedBody } from "./storage.js";
const config = {
  url: "https://wudbhdyqgnbnuorebhnu.supabase.co",
  bucket: "pilot-originals",
  serviceKey: "test-only-storage-secret",
};
describe("storage transport", () => {
  it("stopsOversizedStreamWithoutReadingTheRest", async () => {
    let pulls = 0,
      cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        c.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readBoundedBody(new Response(stream), 5),
    ).rejects.toMatchObject({ code: "invalid_image" });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(3);
  });
  it("signsOnlyFixedPrivatePathsAndDoesNotForwardSecretToSignedReads", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        if (String(url).includes("/upload/sign/"))
          return new Response(
            JSON.stringify({
              url:
                new URL(String(url)).pathname.replace("/storage/v1", "") +
                "?token=test",
            }),
            { headers: { "content-type": "application/json" } },
          );
        if (init?.method === "POST")
          return new Response(
            JSON.stringify({
              signedURL:
                new URL(String(url)).pathname.replace("/storage/v1", "") +
                "?token=test",
            }),
            { headers: { "content-type": "application/json" } },
          );
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        });
      },
    );
    const storage = createPrivateStorage(config, fetchImpl);
    const path =
      "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
    const ticket = await storage.signUpload(path);
    expect(new URL(ticket.url).origin).toBe(config.url);
    expect(ticket.url).not.toContain(config.serviceKey);
    expect(new Headers(requests[0].init?.headers).get("x-upsert")).not.toBe(
      "true",
    );
    expect(
      Array.from(
        (await storage.read(path, new AbortController().signal)).bytes,
      ),
    ).toEqual([1, 2, 3]);
    expect(
      new Headers(requests.at(-1)?.init?.headers).has("authorization"),
    ).toBe(false);
    const before = requests.length;
    await expect(storage.signUpload("../other")).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(requests).toHaveLength(before);
  });
  it("rejectsOffProjectSignedUrlsAndRedirects", async () => {
    const remote = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ signedURL: "https://attacker.test/private" }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const storage = createPrivateStorage(config, remote);
    await expect(
      storage.signRead(
        "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222",
        60,
      ),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(remote).toHaveBeenCalledTimes(1);
    expect(() =>
      createPrivateStorage({ ...config, url: "https://attacker.test" }, remote),
    ).toThrow();
  });
});
