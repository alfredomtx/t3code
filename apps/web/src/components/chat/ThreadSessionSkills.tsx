import { useId, useState } from "react";
import { T, useGT } from "gt-react";
import { BookOpenIcon, ChevronDownIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { RelativeTime } from "../RelativeTime";
import { useClientSettings } from "../../hooks/useSettings";
import { formatFullTimestamp } from "../../timestampFormat";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
} from "./threadDetailsPanelStyles";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { isCompleteTurnItemRow } from "@t3tools/client-runtime/state/threads";
import {
  useQuietThreadProjection,
  useQuietThreadVisibleTurnItems,
  useThreadHistory,
} from "../../state/entities";
import { collectSessionSkills } from "./sessionSkills";

export function ThreadSessionSkills({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useQuietThreadProjection(threadRef)?.projection;
  const items = useQuietThreadVisibleTurnItems(threadRef);
  const { hasMoreHistory } = useThreadHistory(threadRef);
  const session = thread?.providerThreads.find(
    (entry) => entry.id === thread.thread.activeProviderThreadId,
  );
  if (session?.driver !== "codex") return null;
  const skills = collectSessionSkills(items.filter(isCompleteTurnItemRow), session.id);
  return skills.length > 0 ? (
    <SessionSkillsList key={session.id} skills={skills} hasMoreHistory={hasMoreHistory} />
  ) : null;
}

export function SessionSkillsList({
  skills,
  hasMoreHistory,
}: {
  skills: ReturnType<typeof collectSessionSkills>;
  hasMoreHistory: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const gt = useGT();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  return (
    <ThreadDetailsSection headingId={id} title={gt("Session skills")} showHeading={false}>
      <div>
        <ThreadDetailsControl
          aria-expanded={expanded}
          aria-controls={`${id}-skills`}
          onClick={() => setExpanded(!expanded)}
        >
          <BookOpenIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
          <span className="min-w-0 flex-1 truncate">
            <T>Session skills</T>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {gt("{count, plural, one {# skill} other {# skills}}", { count: skills.length })}
          </span>
          <ChevronDownIcon
            aria-hidden
            className={`${THREAD_DETAILS_PANEL_CHEVRON_CLASS} ${expanded ? "" : "-rotate-90"}`}
          />
        </ThreadDetailsControl>
        <div id={`${id}-skills`} hidden={!expanded} className="px-2.5">
          {expanded ? (
            <>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 text-start font-normal">
                      <T>Skill</T>
                    </th>
                    <th scope="col" className="ps-2 text-end font-normal">
                      <T>Reads</T>
                    </th>
                    <th scope="col" className="whitespace-nowrap ps-2 text-end font-normal">
                      <T>Last read</T>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((skill) => (
                    <tr key={skill.path}>
                      <td className="break-all py-1">{skill.name}</td>
                      <td className="ps-2 text-end tabular-nums">{skill.count}</td>
                      <td className="whitespace-nowrap ps-2 text-end text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger render={<time dateTime={skill.lastRead} tabIndex={0} />}>
                            <RelativeTime timestamp={skill.lastRead} />
                          </TooltipTrigger>
                          <TooltipPopup>
                            {formatFullTimestamp(skill.lastRead, timestampFormat)}
                          </TooltipPopup>
                        </Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMoreHistory ? (
                <p className="pt-2 text-xs text-muted-foreground">
                  <T>Counts reflect loaded history. Load earlier messages to include more reads.</T>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </ThreadDetailsSection>
  );
}
