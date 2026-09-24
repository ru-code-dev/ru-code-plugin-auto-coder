import { useState } from "react";
import { FolderOpenIcon } from "lucide-react";

import { L } from "../localization.ts";
import { saveProject } from "./actions.ts";
import { Button } from "./components/button.tsx";
import { Input } from "./components/input.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./components/input-group.tsx";
import { ScrollArea } from "./components/scroll-area.tsx";
import { Textarea } from "./components/textarea.tsx";
import { describeFailure } from "./failureText.ts";
import { PanelField, PanelFieldError } from "./PanelField.tsx";
import { autoCoderCtx, useAutoCoderStore } from "./store.ts";

export function ProjectTab() {
  const draft = useAutoCoderStore((state) => state.projectDraft);
  const failure = useAutoCoderStore((state) => state.projectFailure);
  const change = useAutoCoderStore((state) => state.projectDraftChanged);
  const [picking, setPicking] = useState(false);

  const commit = (): void => {
    void saveProject();
  };

  const labels = {
    projectKey: L("Bitbucket project key", "Ключ проекта Bitbucket"),
    repoSlug: L("Repository", "Репозиторий"),
    baseBranch: L("Base branch", "Базовая ветка"),
    workspace: L("Workspace folder", "Рабочая папка"),
    namespace: L("Jira namespace", "Пространство Jira"),
    jql: L("JQL", "JQL"),
  };

  if (draft === null) {
    return (
      <div className="space-y-4 p-4">
        <p className="text-muted-foreground text-xs" data-testid="ac-project-loading">
          {failure === null ? L("Loading…", "Загрузка…") : describeFailure(failure)}
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-4 p-4" data-testid="ac-project-form">
        <PanelField label={labels.projectKey}>
          <Input
            aria-label={labels.projectKey}
            onBlur={commit}
            onChange={(event) => {
              change("bitbucketProjectKey", event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
            value={draft.bitbucketProjectKey}
          />
        </PanelField>

        <PanelField
          hint={L("Defaults to the project's folder name.", "По умолчанию — имя папки проекта.")}
          label={labels.repoSlug}
        >
          <Input
            aria-label={labels.repoSlug}
            onBlur={commit}
            onChange={(event) => {
              change("repoSlug", event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
            value={draft.repoSlug}
          />
        </PanelField>

        <PanelField label={labels.baseBranch}>
          <Input
            aria-label={labels.baseBranch}
            onBlur={commit}
            onChange={(event) => {
              change("baseBranch", event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
            value={draft.baseBranch}
          />
        </PanelField>

        {}
        <PanelField label={labels.workspace}>
          <InputGroup>
            <InputGroupInput
              aria-label={labels.workspace}
              onBlur={commit}
              onChange={(event) => {
                change("workspacePath", event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit();
              }}
              value={draft.workspacePath}
            />
            <InputGroupAddon align="inline-end">
              <Button
                aria-label={L("Choose a folder", "Выбрать папку")}
                disabled={picking}
                onClick={() => {
                  setPicking(true);
                  void autoCoderCtx()
                    .pickFolder(draft.workspacePath === "" ? {} : { start: draft.workspacePath })
                    .then((picked) => {
                      if (picked === null) return;
                      change("workspacePath", picked);
                      commit();
                    })
                    .finally(() => {
                      setPicking(false);
                    });
                }}
                size="icon-xs"
                variant="ghost"
              >
                <FolderOpenIcon />
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </PanelField>

        <PanelField label={labels.namespace}>
          <Input
            aria-label={labels.namespace}
            onBlur={commit}
            onChange={(event) => {
              change("jiraNamespace", event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
            value={draft.jiraNamespace}
          />
        </PanelField>

        <PanelField
          hint={L(
            "Follows the namespace and the repository until you edit it yourself.",
            "Следует за пространством и репозиторием, пока вы не измените его сами.",
          )}
          label={labels.jql}
        >
          <Textarea
            aria-label={labels.jql}
            onBlur={commit}
            onChange={(event) => {
              change("jql", event.target.value);
            }}
            size="sm"
            value={draft.jql}
          />
        </PanelField>

        {failure === null ? null : (
          <div role="status">
            <PanelFieldError>{describeFailure(failure)}</PanelFieldError>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
