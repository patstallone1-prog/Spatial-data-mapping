# Logging in

2026-11-15. Kerbside has a simple log-in: a username and a password. Logging in is optional.

## What a player sees

Click your name in the home screen's top-right corner. The panel that changes your name now has
a **Log in** section underneath it, with a username field, a password field, and two buttons:
**Log in** and **Create account**.

- **Logged in**, the corner reads "Logged in · *username*", and the panel shows **Log out**.
- **Not logged in**, the corner reads "Explorer · Log in", and the device keeps its own account as
  before.

Usernames are 3 to 24 letters, digits, dots, dashes or underscores. Upper and lower case count as
the same. Passwords are 8 to 128 characters.

## How it works

Nothing that was there before has changed. Each device still makes its own account secret
(`docs/kerbside-account.mjs`, `supabase/kerbside_device_accounts.sql`).

**Logging in** (`supabase/kerbside_login.sql`) links the device's row in `kerbside_editors` to an
account in `kerbside_accounts`. From then on:

- **One name.** The account's name is the device's name. A rename on any device changes it on
  every device logged in to the account.
- **Verification follows the player.** When the owner verifies the account, every device logged
  in to it is verified. Exterior edits and the other checks that read `kerbside_editors.verified`
  work unchanged.
- **Logging out unlinks this device only.** The device gets its own name back. It keeps
  verification only if the owner verified the device itself.
- **One id for the player.** `kerbside_account_of(key)` gives the account a device is logged in
  to. On the page, `account().accountId` gives the same. Server-side state can be keyed by it, so
  a player is one player on every device.

The page uses these functions:

| Function | Purpose |
|---|---|
| `kerbside_sign_up(key, username, password)` | Make an account and log this device in |
| `kerbside_sign_in(key, username, password)` | Log this device in |
| `kerbside_sign_out(key)` | Log this device out |
| `kerbside_login_whoami(key)` | Whether this device is logged in, and to which account |
| `kerbside_account_rename(key, name)` | Rename the account this device is logged in to |
| `kerbside_account_of(key)` | The account id this device is logged in to |

## Safety

- **Closed tables.** The public key cannot read the tables. It reaches them only through the
  functions above, each of which checks the device secret.
- **Hashed passwords.** A password goes to the store over HTTPS and is kept there only as a
  bcrypt hash (cost 10). Nothing of it is kept on the device.
- **No hints.** A wrong username and a wrong password get the same answer and take the same time.
- **Limited tries.** After 10 wrong passwords for one username, it waits 15 minutes.
- **Limited sign-ups.** New accounts are capped at 500 an hour.

## For the owner

To switch it on, paste `supabase/kerbside_login.sql` into the Supabase SQL editor, after the
device-account file. It is safe to run again. Until it is pasted, the panel says "logging in is
not set up on the server yet", and everything else works as before.

There is no email, so the owner verifies accounts and resets forgotten passwords:

```bash
python3 scripts/editor_accounts.py --verify-login coral.heron
```

```bash
python3 scripts/editor_accounts.py --reset-password coral.heron
```

Each prints a line of SQL to run. `--reset-password` also prints the new password to pass on.

Email, password-reset mail and sign-in with Google or Apple would need Supabase Auth and its email
settings. That is a later step. The account ids here can be carried over to it.

## Not covered

This adds identity, not saved play. A player's wallet, home and books are still kept in each
browser, so they don't move between devices. Moving them to the cloud is the separate cloud work
in progress. That work can key state by `kerbside_account_of`.

## Tests

`tests/test_kerbside_login.py` covers both sides:

- **The store.** The SQL runs against a throwaway PostgreSQL, as Supabase's `anon` role. This
  part is skipped where PostgreSQL is not installed.
- **The page module.** It runs against a stand-in store.
