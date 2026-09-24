import { createPluginRuntime } from "@smart-tools/plugin-sdk/locale";

import { pluginLocale } from "../localization.ts";
import type { WebCtx } from "@smart-tools/plugin-sdk/host";
import { create } from "zustand";

import type {
  AutoCoderOutputFrame,
  AutoCoderProjectSettings,
  AutoCoderProjectView,
  AutoCoderRunStatus,
  AutoCoderSettings,
  AutoCoderSettingsView,
} from "../contracts.ts";
import type { AutoCoderFailure } from "../failures.ts";
import {
  EMPTY_OUTPUT_VIEW,
  applyFrame,
  applyProjectField,
  clearOutputView,
  frameChangesNothing,
  type OutputView,
  type ProjectField,
} from "./formLogic.ts";

const runtime = createPluginRuntime<WebCtx>("auto-coder", pluginLocale);

export const rememberCtx = runtime.remember;
export const autoCoderCtx = runtime.ctx;
export const resetAutoCoderCtx = runtime.reset;

export type AutoCoderTab = "project" | "run";

export type AutoCoderStoreState = {
  readonly chosenProjectId: string | null;
  readonly tab: AutoCoderTab;
  readonly gearOpen: boolean;

  readonly settings: AutoCoderSettings | null;
  readonly platform: string;
  readonly gigacodePathDefault: string;
  readonly settingsFailure: AutoCoderFailure | null;

  readonly loadedProjectId: string | null;
  readonly project: AutoCoderProjectView | null;
  readonly projectDraft: AutoCoderProjectSettings | null;
  readonly projectFailure: AutoCoderFailure | null;

  readonly run: AutoCoderRunStatus | null;
  readonly output: OutputView;
  readonly runFailure: AutoCoderFailure | null;
  readonly runBusy: boolean;

  chooseProject: (projectId: string) => void;
  setTab: (tab: AutoCoderTab) => void;
  setGearOpen: (open: boolean) => void;

  settingsLoaded: (view: AutoCoderSettingsView) => void;
  settingsSaved: (view: AutoCoderSettingsView) => void;
  settingsFailed: (failure: AutoCoderFailure) => void;
  settingsDraftChanged: (field: keyof AutoCoderSettings, value: string) => void;

  projectLoaded: (view: AutoCoderProjectView) => void;
  projectSaved: (view: AutoCoderProjectView) => void;
  projectFailed: (failure: AutoCoderFailure) => void;
  projectDraftChanged: (field: ProjectField, value: string) => void;

  frameLoaded: (frame: AutoCoderOutputFrame) => void;
  runFailed: (failure: AutoCoderFailure) => void;
  setRunBusy: (busy: boolean) => void;
  clearView: () => void;
};

const EMPTY = {
  chosenProjectId: null,
  tab: "project" as AutoCoderTab,
  gearOpen: false,
  settings: null,
  platform: "",
  gigacodePathDefault: "",
  settingsFailure: null,
  loadedProjectId: null,
  project: null,
  projectDraft: null,
  projectFailure: null,
  run: null,
  output: EMPTY_OUTPUT_VIEW,
  runFailure: null,
  runBusy: false,
};

export const useAutoCoderStore = create<AutoCoderStoreState>((set) => ({
  ...EMPTY,

  chooseProject: (projectId) =>
    set((state) =>
      state.chosenProjectId === projectId
        ? state
        : {
            chosenProjectId: projectId,
            loadedProjectId: null,
            project: null,
            projectDraft: null,
            projectFailure: null,
            run: null,
            output: EMPTY_OUTPUT_VIEW,
            runFailure: null,
          },
    ),
  setTab: (tab) => set({ tab }),
  setGearOpen: (gearOpen) => set({ gearOpen }),

  settingsLoaded: (view) =>
    set({
      settings: view.settings,
      platform: view.platform,
      gigacodePathDefault: view.gigacodePathDefault,
      settingsFailure: null,
    }),
  settingsSaved: (view) =>
    set({
      platform: view.platform,
      gigacodePathDefault: view.gigacodePathDefault,
      settingsFailure: null,
    }),
  settingsFailed: (settingsFailure) => set({ settingsFailure }),
  settingsDraftChanged: (field, value) =>
    set((state) =>
      state.settings === null ? state : { settings: { ...state.settings, [field]: value } },
    ),

  projectLoaded: (view) =>
    set({
      loadedProjectId: view.projectId,
      project: view,
      projectDraft: view.settings,
      projectFailure: null,
      platform: view.platform,
      gigacodePathDefault: view.gigacodePathDefault,
    }),
  projectSaved: (view) =>
    set((state) =>
      state.loadedProjectId === view.projectId
        ? {
            project: view,
            platform: view.platform,
            gigacodePathDefault: view.gigacodePathDefault,
            projectFailure: null,
          }
        : state,
    ),
  projectFailed: (projectFailure) => set({ projectFailure }),
  projectDraftChanged: (field, value) =>
    set((state) =>
      state.projectDraft === null
        ? state
        : { projectDraft: applyProjectField(state.projectDraft, field, value) },
    ),

  frameLoaded: (frame) =>
    set((state) =>
      state.runFailure === null && frameChangesNothing(state, frame)
        ? state
        : {
            run: frame.status,
            output: applyFrame(state.output, frame),
            runFailure: null,
          },
    ),
  runFailed: (runFailure) => set({ runFailure }),
  setRunBusy: (runBusy) => set({ runBusy }),
  clearView: () => set((state) => ({ output: clearOutputView(state.output) })),
}));

export const resetAutoCoderStore = (): void => {
  useAutoCoderStore.setState(EMPTY);
};
