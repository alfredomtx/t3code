# Personal release command

The [T3 automation instructions](https://github.com/alfredomtx/configs/blob/main/agents/automations/t3-personal-nightly.md) own upstream integration and repair chats. GitHub Releases and T3 history record progress.

Set the build environment from those instructions. Run `node scripts/personal/nightly.mjs --check` for a read-only prerequisite check. After committing an upstream merge, run `node scripts/personal/nightly.mjs --upstream-tag <official-tag> --revision <1..999>` to build and verify. Add `--publish` to push source and publish through a GitHub draft.

The command prints its artifact and log directory. It does not install updates or restart user apps.
