import type { EnvironmentId, PullRequestActor, PullRequestRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { msg, useGT } from "gt-react";
import { ClockIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { m } from "~/i18n/messages";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";
import { toastManager } from "../ui/toast";
import { readableFailure } from "./pullRequestDetail.logic";

export function PullRequestRerequestReview({
  actor,
  environmentId,
  reference,
}: {
  actor: PullRequestActor;
  environmentId: EnvironmentId;
  reference: PullRequestRef;
}) {
  const gt = useGT();
  const [sending, setSending] = useState(false);
  const canRequest = useAtomValue(
    pullRequestEnvironment.requestReviewers.permissionAtom(environmentId),
  );
  const candidates = useEnvironmentQuery(
    canRequest
      ? pullRequestEnvironment.reviewerCandidates({ environmentId, input: reference })
      : null,
  );
  const requestReviewers = useAtomCommand(pullRequestEnvironment.requestReviewers, {
    reportFailure: false,
  });
  if (!canRequest || candidates.data === null || candidates.error !== null) return null;

  const requested = candidates.data.candidates.some(
    (candidate) =>
      candidate.kind === "user" &&
      candidate.isRequested &&
      candidate.login.toLowerCase() === actor.login.toLowerCase(),
  );
  if (requested) {
    const label = gt("Review requested from @{login}", { login: actor.login });
    return (
      <SharedTooltipTrigger
        label={label}
        render={<span className="inline-flex text-muted-foreground" />}
      >
        <ClockIcon className="size-3.5" role="img" aria-label={label} />
      </SharedTooltipTrigger>
    );
  }

  const label = gt("Re-request review from @{login}", { login: actor.login });
  return (
    <SharedTooltipTrigger
      label={label}
      render={
        <Button
          type="button"
          aria-label={label}
          aria-busy={sending || undefined}
          size="icon-xs"
          variant="ghost"
          disabled={sending || candidates.isPending}
          onClick={async () => {
            setSending(true);
            const result = await requestReviewers({
              environmentId,
              input: {
                ...reference,
                reviewers: [{ kind: "user", id: actor.login }],
                requested: true,
              },
            });
            setSending(false);
            if (result._tag !== "Success") {
              toastManager.add({
                type: "error",
                title: gt("Could not ask {logins} for a review", { logins: actor.login }),
                description: readableFailure(
                  squashAtomCommandFailure(result),
                  m(msg("The environment request failed.")),
                ),
              });
            }
          }}
        />
      }
    >
      <RotateCwIcon className="size-3.5" aria-hidden="true" />
    </SharedTooltipTrigger>
  );
}
