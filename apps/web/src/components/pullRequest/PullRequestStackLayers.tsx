import type { PullRequestRef, PullRequestStack } from "@t3tools/contracts";
import { CheckIcon, GitBranchIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { MenuItem, MenuGroupLabel } from "../ui/menu";
import { PullRequestStackLayerContent } from "./PullRequestStackLayerContent";

const CONNECTOR_CLASS =
  "relative before:absolute before:inset-y-0 before:-start-2 before:border-s-2 before:border-border after:absolute after:end-full after:top-1/2 after:w-2 after:border-t-2 after:border-border";

export function PullRequestStackLayers({
  stack,
  reference,
  onSelect,
  pending = false,
}: {
  stack: PullRequestStack;
  reference: PullRequestRef;
  onSelect?: ((reference: PullRequestRef) => void) | undefined;
  pending?: boolean;
}) {
  return (
    <div className="max-h-80 overflow-y-auto ps-4">
      {stack.layers.toReversed().map((layer) => {
        const current = layer.number === reference.number;
        return (
          <div
            key={layer.number}
            className={cn(
              CONNECTOR_CLASS,
              "first:before:top-1/2",
              current && "rounded-sm bg-accent/60 font-semibold",
            )}
          >
            <MenuItem
              onClick={() => {
                onSelect?.({ ...reference, number: layer.number });
              }}
              disabled={!onSelect || pending}
              aria-current={current ? "true" : undefined}
            >
              <PullRequestStackLayerContent layer={layer} />
              {current ? <CheckIcon aria-hidden className="size-3.5 text-primary" /> : null}
            </MenuItem>
          </div>
        );
      })}
      <div
        className={cn(
          CONNECTOR_CLASS,
          "before:bottom-[calc(50%-2px)] only:before:hidden only:after:hidden",
        )}
      >
        <MenuGroupLabel>
          <span className="flex items-center gap-2">
            <GitBranchIcon aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{stack.base}</span>
          </span>
        </MenuGroupLabel>
      </div>
    </div>
  );
}
