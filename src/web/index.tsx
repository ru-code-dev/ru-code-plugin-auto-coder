import { defineWebPlugin } from "@smart-tools/plugin-sdk/host";

import { L } from "../localization.ts";
import { AUTO_CODER_PANEL_ID, AutoCoderPanel } from "./AutoCoderPanel.tsx";
import { rememberCtx } from "./store.ts";

export { AUTO_CODER_PANEL_ID };

export const AUTO_CODER_PANEL_WIDTH = 720;

export default defineWebPlugin({
  panels: (ctx) => {
    rememberCtx(ctx);
    return [
      {
        id: AUTO_CODER_PANEL_ID,
        title: L("Auto Coder", "Авто Кодер"),
        description: L(
          "Configure and run the auto-coder for a project",
          "Настроить и запустить авто-кодер для проекта",
        ),
        icon: "Bot",
        mount: "panel",
        render: AutoCoderPanel,
        width: AUTO_CODER_PANEL_WIDTH,
        nav: { label: L("Auto Coder", "Авто Кодер"), icon: "Bot" },
      },
    ];
  },

  activate(ctx) {
    rememberCtx(ctx);
    ctx.log.info("auto-coder web half activated");
  },

  deactivate(ctx) {
    ctx.log.info("auto-coder web half deactivated");
  },
});
