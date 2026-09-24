import { ChevronLeftIcon } from "lucide-react";

import { JIRA_HOST } from "../constants.ts";
import { L } from "../localization.ts";
import { retrySettings, saveSettings } from "./actions.ts";
import { Button } from "./components/button.tsx";
import { Input } from "./components/input.tsx";
import { ScrollArea } from "./components/scroll-area.tsx";
import { describeFailure } from "./failureText.ts";
import { PanelField, PanelFieldError } from "./PanelField.tsx";
import { useAutoCoderStore } from "./store.ts";

export function SettingsView(props: { readonly onBack: () => void }) {
  const settings = useAutoCoderStore((state) => state.settings);
  const placeholder = useAutoCoderStore((state) => state.gigacodePathDefault);
  const failure = useAutoCoderStore((state) => state.settingsFailure);
  const change = useAutoCoderStore((state) => state.settingsDraftChanged);
  const commit = (): void => {
    void saveSettings();
  };

  const labels = {
    host: L("Jira host", "Хост Jira"),
    jiraToken: L("Jira token", "Токен Jira"),
    bitbucketToken: L("Bitbucket token", "Токен Bitbucket"),
    login: L("Login", "Логин"),
    gigacode: L("GigaCode path", "Путь к GigaCode"),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="ac-settings-view">
      {}
      <div className="border-border border-b px-2 py-2">
        <Button onClick={props.onBack} size="sm" variant="ghost">
          <ChevronLeftIcon className="size-4" />
          {L("Back", "Назад")}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {settings === null ? (
            <p className="text-muted-foreground text-xs" data-testid="ac-settings-loading">
              {failure === null ? L("Loading…", "Загрузка…") : describeFailure(failure)}
            </p>
          ) : (
            <>
              <PanelField
                hint={L("Fixed for this build of the plugin.", "Задан в этой сборке плагина.")}
                label={labels.host}
              >
                {}
                <div aria-disabled className="opacity-50 select-none" inert>
                  <Input aria-label={labels.host} readOnly value={JIRA_HOST} />
                </div>
              </PanelField>
              <PanelField label={labels.jiraToken}>
                <Input
                  aria-label={labels.jiraToken}
                  onBlur={commit}
                  onChange={(event) => {
                    change("jiraToken", event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                  }}
                  type="password"
                  value={settings.jiraToken}
                />
              </PanelField>
              <PanelField label={labels.bitbucketToken}>
                <Input
                  aria-label={labels.bitbucketToken}
                  onBlur={commit}
                  onChange={(event) => {
                    change("bitbucketToken", event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                  }}
                  type="password"
                  value={settings.bitbucketToken}
                />
              </PanelField>
              <PanelField label={labels.login}>
                <Input
                  aria-label={labels.login}
                  onBlur={commit}
                  onChange={(event) => {
                    change("login", event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                  }}
                  value={settings.login}
                />
              </PanelField>
              <PanelField
                hint={L(
                  "Leave it empty to use this platform's default.",
                  "Оставьте пустым, чтобы использовать путь по умолчанию для этой ОС.",
                )}
                label={labels.gigacode}
              >
                {}
                <Input
                  aria-label={labels.gigacode}
                  onBlur={commit}
                  onChange={(event) => {
                    change("gigacodePath", event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                  }}
                  placeholder={placeholder}
                  value={settings.gigacodePath}
                />
              </PanelField>
              {failure === null ? null : (
                <div className="flex items-center gap-2" role="status">
                  <PanelFieldError>{describeFailure(failure)}</PanelFieldError>
                  <Button
                    onClick={() => {
                      retrySettings();
                    }}
                    size="xs"
                    variant="outline"
                  >
                    {L("Retry", "Повторить")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
