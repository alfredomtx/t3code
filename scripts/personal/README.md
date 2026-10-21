# Personal release runner

The twice-daily T3 automations use this runner. [Automation instructions](https://github.com/alfredomtx/configs/blob/main/agents/automations/t3-personal-nightly.md) own scheduling and repair chats.

Run with the Node executable from `~/.local/share/t3-personal/config.json`: `nightly.mjs --check` for a read-only check, `--build-only` for a verified local package, or `--publish` for publication. The runner does not install updates or restart the user's apps.
