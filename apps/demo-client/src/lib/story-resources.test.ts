import { describe, expect, it } from "vitest";
import {
  findManifestResources,
  parseManifest,
  resourceText,
  sanitizeSvg,
  storyIdFromManifestUri,
} from "./story-resources";

describe("storyIdFromManifestUri", () => {
  it("matches exactly story://{id}/manifest", () => {
    expect(storyIdFromManifestUri("story://odyssey/manifest")).toBe("odyssey");
    expect(storyIdFromManifestUri("story://odyssey/scenes/boat")).toBeUndefined();
    expect(storyIdFromManifestUri("story://odyssey/manifest/extra")).toBeUndefined();
    expect(storyIdFromManifestUri("file:///manifest")).toBeUndefined();
  });
});

describe("findManifestResources", () => {
  it("picks every manifest, deduped and sorted by story id", () => {
    const found = findManifestResources([
      { uri: "story://odyssey/scenes/boat", serverId: "s" },
      { uri: "story://odyssey/manifest", serverId: "s" },
      { uri: "story://datacenter/manifest", serverId: "s" },
      { uri: "story://odyssey/manifest", serverId: "s" },
      { uri: "notes://readme", serverId: "s" },
    ]);
    expect(found).toEqual([
      { serverId: "s", uri: "story://datacenter/manifest", storyId: "datacenter" },
      { serverId: "s", uri: "story://odyssey/manifest", storyId: "odyssey" },
    ]);
  });
});

describe("parseManifest", () => {
  const body = {
    id: "datacenter",
    title: "The Datacenter",
    blurb: "Break ground. Keep the lights on.",
    phases: [
      { id: "site", label: "Site" },
      { id: "permits", label: "Permits" },
    ],
    defaultScene: "story://datacenter/scenes/empty-site",
    accent: "#f6821f",
  };

  it("parses JSON text or an object", () => {
    expect(parseManifest(JSON.stringify(body))).toEqual(body);
    expect(parseManifest(body)).toEqual(body);
  });

  it("degrades missing optional fields and drops unsafe accents", () => {
    const minimal = parseManifest({ id: "x", title: "X" });
    expect(minimal).toEqual({ id: "x", title: "X", blurb: "", phases: [], defaultScene: "" });
    const unsafe = parseManifest({ ...body, accent: "red; background: url(http://evil)" });
    expect(unsafe?.accent).toBeUndefined();
    const named = parseManifest({ ...body, accent: " teal " });
    expect(named?.accent).toBe("teal");
    const oklch = parseManifest({ ...body, accent: "oklch(70% 0.15 200)" });
    expect(oklch?.accent).toBe("oklch(70% 0.15 200)");
  });

  it("rejects non-manifests and broken JSON", () => {
    expect(parseManifest("{not json")).toBeUndefined();
    expect(parseManifest({ title: "no id" })).toBeUndefined();
    expect(parseManifest(null)).toBeUndefined();
  });
});

describe("resourceText", () => {
  it("reads text contents and decodes UTF-8 blob contents", () => {
    expect(resourceText({ contents: [{ uri: "u", text: "<svg/>" }] })).toBe("<svg/>");
    const utf8 = new TextEncoder().encode("<svg>ü→</svg>");
    const blob = btoa(String.fromCharCode(...utf8));
    expect(resourceText({ contents: [{ uri: "u", blob }] })).toBe("<svg>ü→</svg>");
  });

  it("yields undefined for empty or malformed results", () => {
    expect(resourceText({ contents: [] })).toBeUndefined();
    expect(resourceText({ nope: true })).toBeUndefined();
    expect(resourceText(undefined)).toBeUndefined();
  });
});

describe("sanitizeSvg", () => {
  it("keeps a plain animated scene intact", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><style>.sea{fill:teal}</style><rect class="sea" width="100" height="50"><animate attributeName="x" values="0;5;0" dur="3s" repeatCount="indefinite"/></rect></svg>';
    expect(sanitizeSvg(svg)).toBe(svg);
  });

  it("strips scripts, handlers, external refs, and embedded documents", () => {
    const dirty =
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onclick="alert(1)" width="1"/><image href="https://evil.example/x.png"/><a xlink:href="javascript:alert(1)">x</a><foreignObject><iframe src="https://evil"></iframe></foreignObject><style>.a{background:url(https://evil/x)}@import "x.css";</style><use href="#local"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).toBeDefined();
    expect(clean?.startsWith("<svg")).toBe(true);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("https://evil");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("foreignObject");
    expect(clean).not.toContain("iframe");
    expect(clean).not.toContain("@import");
    expect(clean).toContain('href="#local"');
  });

  it("strips javascript: values on any attribute and SMIL retargeting of links or handlers", () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="#x"><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="onload" values="alert(1)" dur="1s"/><rect width="1"/></a><animate attributeName="x" values="0;5" dur="1s" repeatCount="indefinite"/><rect data-to=\'javascript:alert(2)\'/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).toBeDefined();
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain('attributeName="href"');
    expect(clean).not.toContain('attributeName="onload"');
    expect(clean).toContain('attributeName="x"');
    expect(clean).toContain('<rect width="1"/>');
  });

  it("refuses bodies with no svg root", () => {
    expect(sanitizeSvg("<div>not svg</div>")).toBeUndefined();
    expect(sanitizeSvg("")).toBeUndefined();
  });
});
