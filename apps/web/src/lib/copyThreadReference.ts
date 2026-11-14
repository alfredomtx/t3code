import type { ThreadReferenceCopyTarget } from "@t3tools/client-runtime/thread-reference";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextFragment,
} from "@t3tools/shared/composerContextClipboard";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";

export async function copyThreadReference(target: ThreadReferenceCopyTarget): Promise<boolean> {
  const fragment = target.fragment ? encodeComposerContextFragment(target.fragment) : null;
  try {
    await writeTextToClipboard(
      target.value,
      target.clipboardTarget,
      fragment ? { [COMPOSER_CONTEXT_CLIPBOARD_MIME]: fragment } : undefined,
    );
    return true;
  } catch (error) {
    console.error(error);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: target.failureTitle,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
    return false;
  }
}
