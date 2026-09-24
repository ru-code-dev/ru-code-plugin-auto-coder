import { useEffect, useRef } from "react";
import { BotIcon, EraserIcon, SettingsIcon, XIcon } from "lucide-react";
import { useSignal } from "@smart-tools/plugin-sdk/react";

import { L } from "../localization.ts";
import { followProject, followSettings } from "./actions.ts";
import { Empty, EmptyDescription, EmptyTitle } from "./components/empty.tsx";
import { DiffPanelShell } from "./components/panel-shell.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./components/select.tsx";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "./components/tabs.tsx";
import { Toggle } from "./components/toggle.tsx";
import { resolveSelectedProject } from "./formLogic.ts";
import { ProjectTab } from "./ProjectTab.tsx";
import { RunTab } from "./RunTab.tsx";
import { SettingsView } from "./SettingsView.tsx";
import { autoCoderCtx, useAutoCoderStore, type AutoCoderTab } from "./store.ts";

export const AUTO_CODER_PANEL_ID = "auto-coder";

export function AutoCoderPanel() {
  const ctx = autoCoderCtx();
  const projects = useSignal(ctx.projects);
  const activeProject = useSignal(ctx.activeProject);

  const chosen = useAutoCoderStore((state) => state.chosenProjectId);
  const tab = useAutoCoderStore((state) => state.tab);
  const gearOpen = useAutoCoderStore((state) => state.gearOpen);
  const chooseProject = useAutoCoderStore((state) => state.chooseProject);
  const setTab = useAutoCoderStore((state) => state.setTab);
  const setGearOpen = useAutoCoderStore((state) => state.setGearOpen);

  const selected = resolveSelectedProject(chosen, activeProject, projects);

  const portalTarget = useRef<HTMLDivElement>(null);

  useEffect(() => followSettings(), []);
  useEffect(() => (selected === null ? undefined : followProject(selected)), [selected]);

  const header = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <BotIcon className="size-4 text-muted-foreground" />
        <h2 className="truncate font-semibold text-sm">{L("Auto Coder", "Авто Кодер")}</h2>
      </div>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <Toggle
          aria-label={L("Clear view", "Очистить вид")}
          onPressedChange={() => {
            useAutoCoderStore.getState().clearView();
          }}
          pressed={false}
          size="xs"
          variant="outline"
        >
          <EraserIcon className="size-3" />
        </Toggle>
        <Toggle
          aria-label={L("Settings", "Настройки")}
          onPressedChange={setGearOpen}
          pressed={gearOpen}
          size="xs"
          variant="outline"
        >
          <SettingsIcon className="size-3" />
        </Toggle>
        <Toggle
          aria-label={L("Close Auto Coder", "Закрыть Авто Кодер")}
          onPressedChange={() => {
            ctx.closePanel(AUTO_CODER_PANEL_ID);
          }}
          pressed={false}
          size="xs"
          variant="outline"
        >
          <XIcon className="size-3" />
        </Toggle>
      </div>
    </>
  );

  const selectedName = projects.find((project) => project.id === selected)?.name ?? "";

  return (
    <DiffPanelShell className="bg-card" header={header} mode="sidebar">
      <div className="contents" ref={portalTarget} />
      {gearOpen ? (
        <SettingsView
          onBack={() => {
            setGearOpen(false);
          }}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {}
          <div className="flex items-center gap-2 border-border border-b px-3 py-2.5">
            <span className="shrink-0 font-medium text-foreground text-xs">
              {L("Project", "Проект")}
            </span>
            <Select
              onValueChange={(value) => {
                chooseProject(String(value));
              }}
              value={selected ?? ""}
            >
              <SelectTrigger
                aria-label={L("Project", "Проект")}
                className="min-w-0 max-w-[13rem] shrink-0 justify-between px-1.5 font-medium"
                data-testid="ac-project-select"
                disabled={projects.length === 0}
                size="xs"
                variant="ghost"
              >
                <SelectValue>{() => selectedName}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false} container={portalTarget}>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <Tabs
            className="min-h-0 flex-1"
            onValueChange={(value) => {
              setTab(value as AutoCoderTab);
            }}
            value={tab}
          >
            <TabsList className="shrink-0 border-border border-b px-2">
              <TabsTab disabled={selected === null} value="project">
                {L("Project", "Проект")}
              </TabsTab>
              <TabsTab disabled={selected === null} value="run">
                {L("Run", "Запуск")}
              </TabsTab>
              <TabsIndicator />
            </TabsList>

            {selected === null ? (
              <Empty className="py-10" data-testid="ac-no-projects">
                <EmptyTitle>{L("No projects", "Нет проектов")}</EmptyTitle>
                <EmptyDescription>
                  {L(
                    "Add a project to the app first — this plugin runs one process per project.",
                    "Сначала добавьте проект в приложение — плагин запускает по одному процессу на проект.",
                  )}
                </EmptyDescription>
              </Empty>
            ) : (
              <>
                <TabsPanel value="project">
                  <ProjectTab />
                </TabsPanel>
                <TabsPanel value="run">
                  <RunTab projectId={selected} />
                </TabsPanel>
              </>
            )}
          </Tabs>
        </div>
      )}
    </DiffPanelShell>
  );
}
