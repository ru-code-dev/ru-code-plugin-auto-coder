import { RUN_OUTPUT_STATE } from "../constants.ts";
import type { QueryResult, QuerySignal } from "@smart-tools/plugin-sdk/host";

import type { AutoCoderRunsSummary, AutoCoderSettingsView } from "../contracts.ts";
import { decodeAutoCoderFailure } from "../failures.ts";
import { autoCoderClient } from "./client.ts";
import { followLog } from "./follow.ts";
import { behind } from "./formLogic.ts";
import { autoCoderCtx, useAutoCoderStore } from "./store.ts";

let showing: string | null = null;

export const resetAutoCoderActions = (): void => {
  showing = null;
};

let settingsRead: QuerySignal<AutoCoderSettingsView> | null = null;

const showSettings = (result: QueryResult<AutoCoderSettingsView>): void => {
  const store = useAutoCoderStore.getState();
  if (result.phase === "ready") {
    if (store.settings === null) store.settingsLoaded(result.value);
    else store.settingsSaved(result.value);
  } else if (result.phase === "failed") {
    store.settingsFailed(decodeAutoCoderFailure(result.error));
  }
};

export const followSettings = (): (() => void) => {
  const read = autoCoderClient.settingsQuery();
  settingsRead = read;
  const stop = read.subscribe(() => {
    showSettings(read.get());
  });
  return () => {
    stop();
    if (settingsRead === read) settingsRead = null;
  };
};

export const retrySettings = (): void => {
  void settingsRead?.refresh().then(showSettings);
};

export const followProject = (projectId: string): (() => void) => {
  showing = projectId;
  const read = autoCoderClient.projectQuery(projectId);
  return read.subscribe(() => {
    const result = read.get();
    const store = useAutoCoderStore.getState();
    if (result.phase === "ready") {
      if (store.loadedProjectId === result.value.projectId) store.projectSaved(result.value);
      else store.projectLoaded(result.value);
    } else if (result.phase === "failed") {
      store.projectFailed(decodeAutoCoderFailure(result.error));
    }
  });
};

export const saveSettings = async (): Promise<void> => {
  const store = useAutoCoderStore.getState();
  const settings = store.settings;
  if (settings === null) return;
  try {
    store.settingsSaved(await autoCoderClient.setSettings(settings));
  } catch (error) {
    store.settingsFailed(decodeAutoCoderFailure(error));
  }
};

export const saveProject = async (): Promise<void> => {
  const store = useAutoCoderStore.getState();
  const { loadedProjectId, projectDraft } = store;
  if (loadedProjectId === null || projectDraft === null) return;
  try {
    const view = await autoCoderClient.setProject(loadedProjectId, projectDraft);
    if (showing !== loadedProjectId) return;
    store.projectSaved(view);
  } catch (error) {
    if (showing !== loadedProjectId) return;
    store.projectFailed(decodeAutoCoderFailure(error));
  }
};

const runsSummary = (): AutoCoderRunsSummary | undefined =>
  autoCoderCtx().state(RUN_OUTPUT_STATE).get() as AutoCoderRunsSummary | undefined;

export const followRun = (projectId: string): (() => void) => {
  const store = useAutoCoderStore.getState;
  return followLog({
    lines: autoCoderClient.outputQuery(projectId, () => store().output.since),
    summary: autoCoderCtx().state(RUN_OUTPUT_STATE),
    behind: () => behind(runsSummary()?.[projectId], store().output),
    show: (result) => {
      if (result.phase === "ready") store().frameLoaded(result.value);
      else if (result.phase === "failed") store().runFailed(decodeAutoCoderFailure(result.error));
    },
  });
};

export const startRun = async (projectId: string): Promise<void> => {
  const store = useAutoCoderStore.getState();
  store.setRunBusy(true);
  try {
    await autoCoderClient.start(projectId);
  } catch (error) {
    store.runFailed(decodeAutoCoderFailure(error));
  } finally {
    store.setRunBusy(false);
  }
};

export const stopRun = async (projectId: string): Promise<void> => {
  const store = useAutoCoderStore.getState();
  store.setRunBusy(true);
  try {
    await autoCoderClient.stop(projectId);
  } catch (error) {
    store.runFailed(decodeAutoCoderFailure(error));
  } finally {
    store.setRunBusy(false);
  }
};
