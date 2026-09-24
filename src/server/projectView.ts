import type { PluginProject, ServerCtx } from "@smart-tools/plugin-sdk/host";

import type { AutoCoderProjectView } from "../contracts.ts";
import { defaultGigacodePath, mergeProjectSettings, projectDefaults } from "../defaults.ts";
import { readProjectSettings } from "./store.ts";

export const resolveProjectView = async (
  ctx: ServerCtx,
  project: PluginProject,
  platform: string,
): Promise<AutoCoderProjectView> => {
  const defaults = projectDefaults(project.cwd);
  const saved = await readProjectSettings(ctx, project.id);
  return {
    projectId: project.id,
    settings: mergeProjectSettings(saved, defaults),
    defaults,
    platform,
    gigacodePathDefault: defaultGigacodePath(platform),
  };
};

export const findProject = async (
  ctx: ServerCtx,
  projectId: string,
): Promise<PluginProject | null> => {
  const projects = await ctx.projects.list();
  return projects.find((project) => project.id === projectId) ?? null;
};
