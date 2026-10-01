import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { readPluginBundle } from "@smart-tools/plugin-sdk/testing/node";

import { SCRIPT_FILE } from "../src/constants.ts";

const dist = readPluginBundle(NodePath.resolve(import.meta.dirname, ".."));

describe.skipIf(!dist.hasDist)("the built folder", () => {
  it("keeps the shared packages external in the web half and bundles the rest", () => {
    expect(dist.webImports).toEqual(["@base-ui/react", "react", "react/jsx-runtime", "zustand"]);
  });

  it("carries the two class libraries the copied controls are written against", () => {
    const imports = dist.webImports;
    expect(imports).not.toContain("class-variance-authority");
    expect(imports).not.toContain("tailwind-merge");
  });

  it("compiles the app's utilities into its OWN sheet, scoped, with the ported app utility", () => {
    const sheet = NodeFs.readFileSync(NodePath.join(dist.root, "dist/web/styles.css"), "utf8");
    expect(sheet).toContain('[data-plugin-root="auto-coder"]');
    expect(sheet).toContain("backdrop-filter");
    expect(sheet.length).toBeGreaterThan(10_000);
  });

  it("imports nothing but `node:*` in the server half", () => {
    for (const specifier of dist.serverImports) {
      expect(specifier.startsWith("node:")).toBe(true);
    }
  });

  it("ships the script, unchanged, where the server half looks for it", () => {
    const shipped = NodePath.join(dist.root, "dist/assets/script", SCRIPT_FILE);
    expect(NodeFs.existsSync(shipped)).toBe(true);
    expect(NodeFs.readFileSync(shipped, "utf8")).toBe(
      NodeFs.readFileSync(NodePath.join(dist.root, "src/assets/script", SCRIPT_FILE), "utf8"),
    );
  });

  it("declares in its manifest exactly the files it emitted", () => {
    const manifest = JSON.parse(
      NodeFs.readFileSync(NodePath.join(dist.root, "dist/plugin.json"), "utf8"),
    ) as Record<string, string>;
    for (const field of ["server", "web", "styles"] as const) {
      expect(NodeFs.existsSync(NodePath.join(dist.root, "dist", manifest[field] ?? ""))).toBe(true);
    }
  });
});

// S105: the playground compiles every plugin on its own, so a build line that lost the compiler would
// leave the page an author measures compiled and the page the app loads not. The bundle cannot tell
// (the compiled ui-kit and catalog-core it bundles carry memo caches too), so the build config is
// what is asserted: its web half has the compiler pass from `@smart-tools/plugin-dev/build`.
describe("the React Compiler", () => {
  it("is on the web half of the build config (`@smart-tools/plugin-dev/build`)", async () => {
    type BuildConfig = { readonly platform?: string; readonly plugins?: ReadonlyArray<unknown> };
    const configs = [
      (await import("../tsdown.config.ts")).default,
    ].flat() as ReadonlyArray<BuildConfig>;
    const web = configs.find((config) => config.platform === "browser");
    const plugins = await Promise.all(web?.plugins ?? []);
    const names = plugins.map((plugin) => String((plugin as { readonly name?: unknown }).name));
    expect(names).toContain("plugin-dev:react-compiler-summary");
  });
});
