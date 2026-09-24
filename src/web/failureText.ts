import { L, LT } from "../localization.ts";
import type { AutoCoderFailure } from "../failures.ts";

export const describeFailure = (failure: AutoCoderFailure): string => {
  switch (failure.kind) {
    case "unknown-project":
      return L("That project is no longer in the app.", "Этого проекта больше нет в приложении.");
    case "script-missing":
      return LT(
        "The plugin's script is missing at {0} — reinstall the plugin.",
        "Скрипт плагина не найден: {0} — переустановите плагин.",
        [failure.path],
      );
    case "already-running":
      return L("It is already running.", "Уже запущено.");
    case "not-running":
      return L("Nothing is running.", "Ничего не запущено.");
    case "write-failed":
      return LT("Could not write {0}: {1}", "Не удалось записать {0}: {1}", [
        failure.file,
        failure.detail,
      ]);
    case "transport":
      return L("No connection to the server.", "Нет соединения с сервером.");
    default:
      return LT("The plugin is unavailable: {0}", "Плагин недоступен: {0}", [failure.detail]);
  }
};
