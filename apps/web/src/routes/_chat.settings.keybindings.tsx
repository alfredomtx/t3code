import { KeybindingCommand, EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { createFileRoute } from "@tanstack/react-router";

import { KeybindingsSettingsPanel } from "../components/settings/KeybindingsSettings";

const isCommand = Schema.is(KeybindingCommand);
const isEnvironmentId = Schema.is(EnvironmentId);

export const Route = createFileRoute("/_chat/settings/keybindings")({
  validateSearch: (raw: Record<string, unknown>) => ({
    coachCommand: isCommand(raw.coachCommand) ? raw.coachCommand : undefined,
    coachSource: isEnvironmentId(raw.coachSource) ? raw.coachSource : undefined,
  }),
  component: () => {
    const search = Route.useSearch();
    return (
      <KeybindingsSettingsPanel {...search} key={`${search.coachSource}:${search.coachCommand}`} />
    );
  },
});
