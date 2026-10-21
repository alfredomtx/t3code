import { ChevronRightIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";

import { Button } from "../ui/button";

export function JiraResultDisclosure({
  rowId,
  resourceUri,
  defaultCollapsed,
  overrides,
  onToggle,
  onFullscreenChange,
  children,
}: {
  readonly rowId: string;
  readonly resourceUri: string;
  readonly defaultCollapsed: boolean;
  readonly overrides: Map<string, boolean>;
  readonly onToggle: (rowId: string, collapsed: boolean) => void;
  readonly onFullscreenChange: (fullscreen: boolean) => void;
  readonly children: (state: {
    visible: boolean;
    onFullscreenChange: (fullscreen: boolean) => void;
  }) => ReactNode;
}) {
  const contentId = useId();
  const [override, setOverride] = useState(() => overrides.get(rowId));
  const [fullscreen, setFullscreen] = useState(false);
  const expanded = fullscreen || (override ?? !defaultCollapsed);
  const handleFullscreenChange = useStableCallback((active: boolean) => {
    setFullscreen(active);
    onFullscreenChange(active);
  });

  if (resourceUri !== "ui://widget/jira-widget.html")
    return children({ visible: true, onFullscreenChange });

  return (
    <div>
      <Button
        variant="ghost-muted"
        size="sm"
        className="max-w-full justify-start"
        aria-expanded={expanded}
        aria-controls={contentId}
        disabled={fullscreen}
        onClick={() => {
          onToggle(rowId, expanded);
          overrides.set(rowId, !expanded);
          setOverride(!expanded);
        }}
      >
        <ChevronRightIcon className={expanded ? "size-3.5 rotate-90" : "size-3.5"} />
        <span className="truncate">Jira result</span>
      </Button>
      <div
        id={contentId}
        inert={!expanded}
        aria-hidden={!expanded}
        style={expanded ? undefined : { height: 0, overflow: "hidden", visibility: "hidden" }}
      >
        {children({ visible: expanded, onFullscreenChange: handleFullscreenChange })}
      </div>
    </div>
  );
}
