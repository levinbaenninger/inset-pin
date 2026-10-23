import { describe, expect, it } from "vitest";

import { insetUrl, originOf, parseInsetUrl } from "./inset-url";

const ID = "3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c";

describe(parseInsetUrl, () => {
  it("accepts a saved capture image by id", () => {
    expect(parseInsetUrl(`inset://capture/${ID}`)).toStrictEqual({
      id: ID,
      kind: "captureImage",
    });
  });

  it("accepts the draft preview by id", () => {
    expect(parseInsetUrl(`inset://draft/${ID}`)).toStrictEqual({
      id: ID,
      kind: "draftImage",
    });
  });

  it.each([
    ["dot segments", `inset://capture/../${ID}`],
    ["an upper-case id", `inset://capture/${ID.toUpperCase()}`],
    ["an extra segment", `inset://capture/${ID}/x`],
    ["a query string", `inset://capture/${ID}?a=1`],
    ["a fragment", `inset://capture/${ID}#x`],
    ["an encoded dot segment", "inset://app/%2e%2e/main.js"],
    ["an encoded slash", "inset://app/assets%2fa.js"],
    ["an unknown host", "inset://evil/x"],
    ["another scheme", `file://capture/${ID}`],
    ["an empty app path", "inset://app/"],
    ["a port", "inset://app:80/capture.html"],
  ])("rejects %s", (_label, url) => {
    expect(parseInsetUrl(url)).toBeNull();
  });

  it("accepts app bundle files", () => {
    expect(parseInsetUrl("inset://app/assets/a.js")).toStrictEqual({
      kind: "app",
      path: "assets/a.js",
    });
  });

  it("round-trips the builders", () => {
    expect(parseInsetUrl(insetUrl.page("library"))).toStrictEqual({
      kind: "app",
      path: "library.html",
    });
  });
});

describe(originOf, () => {
  it("derives an origin for the custom scheme and for the dev server", () => {
    expect(originOf("inset://app/capture.html")).toBe("inset://app");
    expect(originOf("http://localhost:5173/library.html#/captures/x")).toBe(
      "http://localhost:5173"
    );
    expect(originOf("not a url")).toBeNull();
  });
});
