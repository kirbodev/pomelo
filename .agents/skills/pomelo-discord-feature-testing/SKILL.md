---
name: pomelo-discord-feature-testing
description: Test newly implemented Pomelo features through the real Discord UI with Computer Use, strictly inside the Bot Testing server. Use after changing commands, interactions, permissions, moderation, settings, persistence, or other user-visible Discord behavior that needs end-to-end verification with the Discord desktop admin account and, when required, the dummy non-admin account in Microsoft Edge.
---

# Pomelo Discord Feature Testing

Test the feature in Discord after the relevant automated checks pass. Use the Discord desktop app for the admin account and Microsoft Edge for the dummy non-admin account.

## Hard boundary

- Perform every test strictly inside the server named exactly `Bot Testing`.
- Treat the server's position as a hint only. It should be the first server from the top, below Discord Home and any non-server controls, but verify the exact server name before opening or interacting with it.
- Hover over or inspect the first server icon and confirm its displayed name is exactly `Bot Testing`.
- Do not send a message, run a command, click a feature component, change settings, or moderate a user in any other server, DM, or group DM.
- If the exact server name cannot be verified before interaction, stop and ask the user to confirm the setup.
- If another server is opened accidentally, do not interact with it. Return to a neutral view and report what happened.

## Prepare the test

1. Read the feature requirements, changed files, and relevant Pomelo conventions.
2. Run the appropriate automated checks before GUI testing.
3. Confirm the local Pomelo bot instance being tested is running and available in `Bot Testing`.
4. Write a small test matrix covering the relevant cases:
   - expected success;
   - invalid input or error handling;
   - permission enforcement;
   - ephemeral or public response behavior;
   - buttons, menus, modals, autocomplete, or persistence when applicable;
   - both slash and legacy message-command entry points when the feature supports both.
5. Use only test data that can be safely removed or restored.

## Open the admin session

1. Use the `$computer-use` skill and its required safety guidance for all Windows UI actions.
2. Open the Discord desktop app.
3. Verify that Discord is already logged into the admin account. If it is logged out or the account is ambiguous, stop. Do not enter credentials or change accounts.
4. Locate the first server from the top and verify its displayed name is exactly `Bot Testing`.
5. Open `Bot Testing` only after that verification.
6. Confirm the bot and intended test channel belong to `Bot Testing` before running any command.

## Open the dummy session when needed

Use the second account only when the feature needs another person, a moderation target, or a non-admin permission check.

1. Open Microsoft Edge through Computer Use.
2. Navigate directly to `https://discord.com/app`.
3. Verify Discord is already logged into the dummy account and that it is not the admin account from the desktop app. If login or identity is ambiguous, stop. Do not enter credentials or switch accounts.
4. Open only the server named exactly `Bot Testing`, verifying the name before interaction.
5. Confirm the dummy account does not have admin permissions. Use non-mutating UI evidence when available and verify that admin-only behavior is denied during the relevant permission test.
6. If the dummy account can perform an admin-only action, stop the affected tests and report the permission mismatch.

## Run the tests

- Follow the prepared matrix and compare every result with the feature requirements.
- Use the admin account for setup and authorized admin behavior.
- Use only the dummy account as the target or second participant. Never target another server member for moderation testing.
- Verify that non-admin actions are rejected with the intended localized, human-readable response.
- Check whether responses are ephemeral or public as designed.
- Exercise interactive components from the account that is supposed to use them, including unauthorized-user checks when relevant.
- For moderation features, verify the audit reason, case record, notification, scheduled reversal, and persistence when those behaviors are part of the feature.
- Follow Computer Use confirmation rules before disruptive actions such as bans, kicks, timeouts, purges, role changes, or destructive settings changes.
- Do not broaden the test into unrelated Discord settings or server administration.

## Clean up

- Remove test messages and restore test settings when the feature permits safe cleanup.
- Reverse temporary moderation state, such as timeouts or bans, when reversal is part of the approved test and can be completed safely.
- Do not alter roles or permissions merely to make a test pass.
- Keep cleanup strictly inside `Bot Testing`.

## Report results

Report:

- the exact cases tested;
- which account performed each case;
- expected and actual results;
- pass, fail, or skipped status;
- any cleanup completed or remaining;
- blockers such as an unverified server, missing login, wrong permissions, unavailable bot, or declined confirmation.

Never claim a case passed if it was not completed in the Discord UI.
