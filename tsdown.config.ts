import * as Fs from "node:fs";
import * as Path from "node:path";

import { pluginBuildConfig } from "@smart-tools/plugin-sdk/build";

const root = import.meta.dirname;
const assetsSource = Path.join(root, "src", "assets");
const assetsOut = Path.join(root, "dist", "assets");

const copyAssets = (): void => {
  if (!Fs.existsSync(assetsSource)) {
    throw new Error(`[plugin-auto-coder] the shipped assets folder is missing: ${assetsSource}`);
  }
  Fs.cpSync(assetsSource, assetsOut, { recursive: true });
};

export default pluginBuildConfig({
  root,
  styles: {
    tailwind: {
      sources: ["dist/web", "src/web"],
      input: "src/web/styles.css",
    },
  },
}).map((config) => ({
  ...config,
  hooks: {
    ...config.hooks,
    "build:done": async (): Promise<void> => {
      await config.hooks["build:done"]();
      copyAssets();
    },
  },
}));
