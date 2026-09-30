import { describe, expect, it, vi } from "vitest";

import { assertSafeOutboundUrl, isPrivateAddress, postSignedJson, signPayload, ToolRequestError } from "./http-tool";

const publicResolver = async () => ["93.184.216.34"];

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])(
    "blocks %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("allows %s", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("assertSafeOutboundUrl", () => {
  it("accepts public https hosts", async () => {
    await expect(assertSafeOutboundUrl("https://api.example.com/book", publicResolver)).resolves.toBeInstanceOf(URL);
  });

  it.each([
    "http://api.example.com/book",
    "https://user:pass@api.example.com",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "not a url",
  ])("rejects %s", async (url) => {
    await expect(assertSafeOutboundUrl(url, publicResolver)).rejects.toBeInstanceOf(ToolRequestError);
  });

  it("rejects hostnames that resolve to private addresses (DNS-based SSRF)", async () => {
    await expect(
      assertSafeOutboundUrl("https://evil.example.com", async () => ["93.184.216.34", "10.0.0.5"]),
    ).rejects.toThrow(/private address/);
  });
});

describe("postSignedJson", () => {
  it("signs the exact body and sends the idempotency key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const result = await postSignedJson(
      "https://api.example.com/book",
      { a: 1 },
      { secret: "s3cret", idempotencyKey: "key-1", fetchImpl: fetchImpl as unknown as typeof fetch, resolve: publicResolver },
    );
    expect(result).toEqual({ ok: 1 });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    const [, t, v1] = headers["x-forgechat-signature"].match(/^t=(\d+),v1=([a-f0-9]+)$/)!;
    expect(v1).toBe(signPayload("s3cret", t, init.body as string));
    expect(headers["idempotency-key"]).toBe("key-1");
    expect(init.redirect).toBe("manual");
  });

  it("refuses redirects and marks 5xx as retryable", async () => {
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://10.0.0.1" } }));
    await expect(
      postSignedJson("https://api.example.com", {}, { secret: "", idempotencyKey: "k", fetchImpl: redirect as unknown as typeof fetch, resolve: publicResolver }),
    ).rejects.toThrow(/redirects/);

    const failing = vi.fn(async () => new Response("down", { status: 503 }));
    const err = await postSignedJson("https://api.example.com", {}, {
      secret: "",
      idempotencyKey: "k",
      fetchImpl: failing as unknown as typeof fetch,
      resolve: publicResolver,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ToolRequestError);
    expect((err as ToolRequestError).retryable).toBe(true);
  });
});
