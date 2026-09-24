import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_BASE_BRANCH,
  DEFAULT_JQL,
  PLATFORM_DEFAULT_GIGACODE_PATH,
} from "../src/constants.ts";
import {
  baseNameOf,
  defaultGigacodePath,
  deriveJql,
  effectiveGigacodePath,
  isDerivedJql,
  mergeProjectSettings,
  projectDefaults,
  substituteJql,
} from "../src/defaults.ts";

describe("baseNameOf", () => {
  it("reads the last segment for both separators, and survives a trailing one", () => {
    expect(baseNameOf("/Users/me/projects/ru-code")).toBe("ru-code");
    expect(baseNameOf("/Users/me/projects/ru-code/")).toBe("ru-code");
    expect(baseNameOf("C:\\repos\\billing-api")).toBe("billing-api");
    expect(baseNameOf("C:\\repos\\billing-api\\")).toBe("billing-api");
    expect(baseNameOf("relative-folder")).toBe("relative-folder");
  });

  it("answers empty for a root and for nothing — never throws at the caller", () => {
    expect(baseNameOf("/")).toBe("");
    expect(baseNameOf("")).toBe("");
  });
});

describe("the JQL pattern", () => {
  it("substitutes both placeholders, every occurrence", () => {
    expect(substituteJql(DEFAULT_JQL, { jiraNamespace: "OPS", repoSlug: "billing" })).toBe(
      'project = OPS AND component = billing AND status = "To Do"',
    );
    expect(
      substituteJql("%REPO_SLUG% %REPO_SLUG% %JIRA_NAMESPACE%", {
        jiraNamespace: "N",
        repoSlug: "R",
      }),
    ).toBe("R R N");
  });

  it("recognises its own output and nothing else", () => {
    const values = { jiraNamespace: "OPS", repoSlug: "billing" };
    expect(isDerivedJql(deriveJql(values), values)).toBe(true);
    expect(isDerivedJql(deriveJql(values), { jiraNamespace: "OPS", repoSlug: "other" })).toBe(
      false,
    );
    expect(isDerivedJql("assignee = currentUser()", values)).toBe(false);
  });
});

describe("projectDefaults", () => {
  it("is the project's own folder, the house branch and the filled-in pattern", () => {
    expect(projectDefaults("/Users/me/projects/billing-api")).toEqual({
      bitbucketProjectKey: "",
      repoSlug: "billing-api",
      baseBranch: DEFAULT_BASE_BRANCH,
      workspacePath: "/Users/me/projects/billing-api",
      jiraNamespace: "",
      jql: 'project =  AND component = billing-api AND status = "To Do"',
    });
  });
});

describe("mergeProjectSettings", () => {
  const defaults = projectDefaults("/w/billing-api");

  it("is the defaults when nothing was ever saved", () => {
    expect(mergeProjectSettings(null, defaults)).toEqual(defaults);
  });

  it("keeps every saved value, including a HAND-EDITED jql", () => {
    const saved = {
      bitbucketProjectKey: "OPS",
      repoSlug: "billing",
      baseBranch: "main",
      workspacePath: "/elsewhere",
      jiraNamespace: "PAY",
      jql: "assignee = currentUser()",
    };
    expect(mergeProjectSettings(saved, defaults)).toEqual(saved);
  });

  it("reads an EMPTY column as 'not set' and falls back to the default", () => {
    const merged = mergeProjectSettings(
      {
        bitbucketProjectKey: "",
        repoSlug: "   ",
        baseBranch: "",
        workspacePath: "",
        jiraNamespace: "PAY",
        jql: "",
      },
      defaults,
    );
    expect(merged.repoSlug).toBe("billing-api");
    expect(merged.baseBranch).toBe(DEFAULT_BASE_BRANCH);
    expect(merged.workspacePath).toBe("/w/billing-api");
    expect(merged.jql).toBe('project = PAY AND component = billing-api AND status = "To Do"');
  });
});

describe("the GigaCode path", () => {
  it("has one default per shipped platform, and reads an unknown one as Linux", () => {
    expect(defaultGigacodePath("darwin")).toBe(PLATFORM_DEFAULT_GIGACODE_PATH.darwin);
    expect(defaultGigacodePath("win32")).toBe(PLATFORM_DEFAULT_GIGACODE_PATH.win32);
    expect(defaultGigacodePath("linux")).toBe(PLATFORM_DEFAULT_GIGACODE_PATH.linux);
    expect(defaultGigacodePath("freebsd")).toBe(PLATFORM_DEFAULT_GIGACODE_PATH.linux);
  });

  it("writes the platform default only while the user's field is blank", () => {
    const blank = { jiraToken: "", bitbucketToken: "", login: "", gigacodePath: "  " };
    expect(effectiveGigacodePath(blank, "darwin")).toBe(PLATFORM_DEFAULT_GIGACODE_PATH.darwin);
    expect(effectiveGigacodePath({ ...blank, gigacodePath: " /opt/gc " }, "darwin")).toBe(
      "/opt/gc",
    );
  });
});
