Run these commands from the stable personal source checkout after integration and native update verification.

1. Run `node scripts/personal/install-launch-agent.mjs --write` to prepare the local configuration and inactive LaunchAgent.
2. Run `node scripts/personal/nightly.mjs --check` for read-only scheduler validation.
3. Run `node scripts/personal/nightly.mjs --build-only --revision 1` for a verified build without publication. Use revision 2 for another build of the same official nightly.
4. Run `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.alfredomtx.t3code.personal.nightly.plist` to activate the 15-minute schedule.

The Mac must remain awake and logged in. The sidebar controls update installation. The runner does not replace the running application.

The runner uses a dedicated builder clone under `~/.local/share/t3-personal`. It uses the public cloud identifiers from `.env.example`. Local signing does not provide Apple notarization or Apple passkey entitlements. Verify cloud login on the personal protocol before daily use.

Logs, pending work, artifacts, and accepted release status remain under `~/.local/share/t3-personal`. A failed merge stays in the builder for inspection. Resolve protected conflicts manually. After repair, verify the result and publish it to the source fork personal branch before retrying. Never discard a failed builder until its diagnostics are saved.

Only the production runner requires `alfredomtx/t3code-personal-releases`. Direct desktop packaging retains `T3CODE_DESKTOP_UPDATE_REPOSITORY` for explicit test builds. Set it before the full web build. Use `--build-version`, and do not use `--skip-build` for release artifacts.
