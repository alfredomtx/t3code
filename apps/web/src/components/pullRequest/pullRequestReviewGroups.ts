import { classifyChangedFile, isTestChangedFile } from "@t3tools/shared/changedFileKind";
import * as Schema from "effect/Schema";

export const ReviewFileGroup = Schema.Literals(["markdown", "tests", "source"]);
export type ReviewFileGroup = typeof ReviewFileGroup.Type;
export const REVIEW_FILE_GROUPS = [
  { id: "markdown", label: "Markdown" },
  { id: "tests", label: "Tests" },
  { id: "source", label: "Source" },
] as const;

const SOURCE_EXTENSION =
  /\.(php|[cm]?[jt]sx?|[cm]ts|py|rb|go|rs|java|kt|kts|cs|c|cc|cpp|cxx|h|hh|hpp|swift|m|mm|scala|groovy|vue|svelte|html|css|scss|sass|less|sql|graphql|gql|sh|bash|zsh|ex|exs|erl|hrl|clj|cljs|dart|lua|r)$/i;
const CONFIG_PATH =
  /(^|\/)(\.[^/]+|config|configs|configuration)(\/|\.|$)|(^|\/)[^/]*[.-]config\.[^/]+$/i;

export function reviewFileGroup(path: string): ReviewFileGroup | null {
  const normalized = path.replaceAll("\\", "/");
  if (/\.(md|mdx|markdown)$/i.test(normalized)) return "markdown";
  if (isTestChangedFile(normalized)) return "tests";
  if (
    classifyChangedFile(normalized) === "code" &&
    SOURCE_EXTENSION.test(normalized) &&
    !CONFIG_PATH.test(normalized)
  )
    return "source";
  return null;
}
