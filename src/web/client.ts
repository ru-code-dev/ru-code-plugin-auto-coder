import type {
  AutoCoderOutputFrame,
  AutoCoderProjectSettings,
  AutoCoderProjectView,
  AutoCoderRunStatus,
  AutoCoderSettings,
  AutoCoderSettingsView,
} from "../contracts.ts";
import type { QuerySignal } from "@smart-tools/plugin-sdk/host";

import { autoCoderCtx } from "./store.ts";

export const autoCoderClient = {
  settingsQuery: (): QuerySignal<AutoCoderSettingsView> =>
    autoCoderCtx().query<AutoCoderSettingsView>("settings.get"),
  setSettings: (settings: AutoCoderSettings): Promise<AutoCoderSettingsView> =>
    autoCoderCtx().invoke<AutoCoderSettingsView>("settings.set", { settings }),

  projectQuery: (projectId: string): QuerySignal<AutoCoderProjectView> =>
    autoCoderCtx().query<AutoCoderProjectView>("project.get", { projectId }),
  setProject: (
    projectId: string,
    settings: AutoCoderProjectSettings,
  ): Promise<AutoCoderProjectView> =>
    autoCoderCtx().invoke<AutoCoderProjectView>("project.set", { projectId, settings }),

  start: (projectId: string): Promise<AutoCoderRunStatus> =>
    autoCoderCtx().invoke<AutoCoderRunStatus>("run.start", { projectId }),
  stop: (projectId: string): Promise<AutoCoderRunStatus> =>
    autoCoderCtx().invoke<AutoCoderRunStatus>("run.stop", { projectId }),
  outputQuery: (projectId: string, since: () => number): QuerySignal<AutoCoderOutputFrame> =>
    autoCoderCtx().query<AutoCoderOutputFrame>("run.output", () => ({
      projectId,
      since: since(),
    })),
} as const;
