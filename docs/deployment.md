# Deployment guide

## 1. What you deploy and what you need

You deploy one Docker container. It polls the Linear Presales team (PRE), checks each new ticket against the triage policy, then labels the ticket and posts a comment.

Before you start, make sure you have each item:

- [ ] A Linux host or container service owned by Evertrust, with Docker, Docker Compose and outbound HTTPS. The bot has no inbound port.
- [ ] A Linear OAuth app with the `client_credentials` grant (section 2).
- [ ] A Microsoft Entra app with Exchange Online RBAC access to the pool mailboxes only (section 3).
- [ ] A Twenty API key (section 4).
- [ ] An Anthropic API key (section 4).
- [ ] In the Linear Asks form, the option `Technical discovery` in "Type of Request".
- [ ] In Linear, these labels, spelled exactly like this: `demo`, `technical discovery`, `poc`, `rfi rfp`, `triage-override`.

## 2. Create the Linear app

A Linear workspace admin does this step.

1. In Linear, open Settings > API and create a new OAuth2 application named `Presales Triage`.
2. Turn on client credentials tokens for the app.
3. Copy the client ID and the client secret. You need them in section 5.

The bot asks for the `read,write` scopes itself and renews its token. There is no consent screen to approve.

The token can see public teams only. If the PRE team is private, give the app access to PRE on the app details page.

## 3. Create the Entra app

You need the Exchange Administrator role in Entra, or membership in the Organization Management role group in Exchange Online.

The bot reads free/busy data with Microsoft Graph `getSchedule`. Access must cover the pool mailboxes and nothing else. Exchange Online RBAC for Applications gives this scope.

Important: do not grant a tenant-wide calendar permission in Entra. Microsoft adds Entra grants and Exchange RBAC grants together. If the app has `Calendars.ReadBasic.All` (or any `Calendars.*` permission) with admin consent in Entra, it can read every mailbox and the scope has no effect.

### 3.1 Register the app

1. In the Entra admin center, create an app registration named `Presales Triage`.
2. Create a client secret. Copy its value.
3. Copy the Directory (tenant) ID and the Application (client) ID.
4. Under API permissions, make sure no `Calendars.*` application permission has admin consent. If one does, remove it.
5. Open Enterprise applications, then open `Presales Triage`. Copy the Application ID and the Object ID. Use these values for `<APP_ID>` and `<OBJECT_ID>` below. Do not use the Object ID from the App registrations page; it is a different value.

### 3.2 Create the pool group

1. Create a mail-enabled security group, for example `Presales Triage Pool`.
2. Add each pool mailbox from `config.json` directly to the group. Members of nested groups are out of scope.

### 3.3 Assign the scoped role

Connect to Exchange Online:

```powershell
Connect-ExchangeOnline
```

Get the distinguished name of the group:

```powershell
Get-Group "<POOL_GROUP>" | Select-Object DistinguishedName
```

Create the pointer to the service principal:

```powershell
New-ServicePrincipal -AppId <APP_ID> -ObjectId <OBJECT_ID> -DisplayName "Presales Triage"
```

Create a management scope over the group members:

```powershell
New-ManagementScope -Name "Presales Triage Pool" -RecipientRestrictionFilter "MemberOfGroup -eq '<POOL_GROUP_DN>'"
```

Assign the calendar role inside that scope:

```powershell
New-ManagementRoleAssignment -App <OBJECT_ID> -Role "Application Calendars.Read" -CustomResourceScope "Presales Triage Pool"
```

Exchange has no role for `Calendars.ReadBasic`. `Application Calendars.Read` is the smallest role that allows `getSchedule`.

### 3.4 Check the scope

Test a pool mailbox:

```powershell
Test-ServicePrincipalAuthorization -Identity <OBJECT_ID> -Resource <POOL_MAILBOX> | Format-Table
```

The `Application Calendars.Read` line must show `InScope` = `True`.

Test a mailbox outside the pool:

```powershell
Test-ServicePrincipalAuthorization -Identity <OBJECT_ID> -Resource <OTHER_MAILBOX> | Format-Table
```

The `Application Calendars.Read` line must show `InScope` = `False`.

This test checks the Exchange side only. It ignores Entra grants, so step 3.1.4 is still required. Exchange can take 30 minutes to 2 hours to apply a change to live calls.

The bot calls `getSchedule` on the first active mailbox in `pool`. Keep that mailbox in the group.

## 4. Get the Twenty and Anthropic keys

1. In Twenty, create an API key with read access to opportunities, companies, notes, note targets, quotes and quote lines.
2. Copy the key and the base URL of the Twenty workspace, for example `https://crm.example.com`. Do not add `/rest`; the bot adds it.
3. In the Anthropic Console, create an API key for the bot. Copy it.

## 5. Prepare the host

1. Clone the repository and go to its folder:

   ```bash
   git clone <REPO_URL> linear-presales-triage
   cd linear-presales-triage
   ```

2. Create the configuration file. Do this before the first Docker command. If the file is missing, Docker creates a folder with that name and the bot cannot start.

   ```bash
   cp config.example.json config.json
   ```

3. Check `config.json`. Keep `"enforce": false`. Make sure `pool` lists the pool mailboxes and `triageOwnerEmail` is a Linear user.
4. Create `.env` with these 9 variables:

   ```bash
   LINEAR_CLIENT_ID=
   LINEAR_CLIENT_SECRET=
   TWENTY_BASE_URL=
   TWENTY_API_KEY=
   GRAPH_TENANT_ID=
   GRAPH_CLIENT_ID=
   GRAPH_CLIENT_SECRET=
   ANTHROPIC_API_KEY=
   ALERT_WEBHOOK_URL=
   ```

   | Variable | Value |
   | --- | --- |
   | `LINEAR_CLIENT_ID` | Linear app client ID (section 2) |
   | `LINEAR_CLIENT_SECRET` | Linear app client secret (section 2) |
   | `TWENTY_BASE_URL` | Twenty base URL, without `/rest` (section 4) |
   | `TWENTY_API_KEY` | Twenty API key (section 4) |
   | `GRAPH_TENANT_ID` | Entra Directory (tenant) ID (section 3.1) |
   | `GRAPH_CLIENT_ID` | Entra Application (client) ID (section 3.1) |
   | `GRAPH_CLIENT_SECRET` | Entra client secret value (section 3.1) |
   | `ANTHROPIC_API_KEY` | Anthropic API key (section 4) |
   | `ALERT_WEBHOOK_URL` | Optional. A Slack incoming webhook URL for outage alerts. Leave empty to turn alerts off. |

   Do not add `CONFIG_PATH` or `DB_PATH` to `.env`. The image sets them to the correct paths inside the container.

5. Restrict access to the file:

   ```bash
   chmod 600 .env
   ```

## 6. Dry run first

The dry run uses live data and writes nothing to Linear.

1. Build the image:

   ```bash
   docker compose build
   ```

2. Run the dry run on every PRE ticket now in Triage:

   ```bash
   docker compose run --rm presales-triage node dist/dry-run.js
   ```

   To check specific tickets, add their identifiers:

   ```bash
   docker compose run --rm presales-triage node dist/dry-run.js PRE-304 PRE-301
   ```

Good output:

- The command prints one result per ticket identifier, with the verdict the bot would give: `accepted`, `waiting`, `denied` or `manual`.
- An unknown identifier prints `not found`. A ticket outside Triage, or with `triage-override`, prints `skipped`.
- The command ends with exit code 0.

A `pending_retry` verdict means the bot could not read a service. Fix that service before you continue. If the command stops at once with an error, see section 10.

## 7. Start in shadow mode

In shadow mode the bot only adds the request type label and posts one comment that starts with "Shadow mode, no action taken:". It does not move, assign or cancel tickets.

1. In Linear, turn off PRE comment notifications to Slack for the trial. Otherwise each shadow comment reaches Slack.
2. Start the bot:

   ```bash
   docker compose up -d
   ```

3. Check the logs:

   ```bash
   docker compose logs -f presales-triage
   ```

Each log line is JSON. Look for:

- A line with `"msg":"started"` and `"mode":"shadow"`. Startup is good.
- One line with `"msg":"audit"` per ticket the bot evaluates.
- No line with `"level":"error"`.

Let the team review the shadow comments in Linear during the trial.

## 8. Switch to enforce mode

In enforce mode the bot comments in the Slack-synced thread, and it moves, assigns or cancels tickets.

1. Edit `config.json` and set:

   ```json
   "enforce": true
   ```

2. Restart the bot:

   ```bash
   docker compose restart
   ```

3. Check that the logs show `"msg":"started"` with `"mode":"enforce"`.

Tickets still in Triage get one more evaluation and one more comment in enforce mode.

You can turn PRE comment notifications to Slack back on.

## 9. Operate

### Update the bot

```bash
git pull && docker compose up -d --build
```

### Back up the state

The bot keeps its state in the `triage-data` volume. Docker adds the project name in front, so the default name is `linear-presales-triage_triage-data`. Check the name:

```bash
docker volume ls
```

Stop the bot, archive the volume, then start the bot again:

```bash
docker compose stop
docker run --rm -v linear-presales-triage_triage-data:/data:ro -v "$PWD":/backup alpine tar czf /backup/triage-data-$(date +%F).tar.gz -C /data .
docker compose start
```

### Rotate a secret

1. Create the new secret in Linear, Entra, Twenty or Anthropic.
2. Put the new value in `.env`.
3. Recreate the container. `docker compose restart` does not read `.env` again.

   ```bash
   docker compose up -d
   ```

4. Check the logs for `"msg":"started"`.
5. Revoke the old secret.

### Stop the bot

```bash
docker compose down
```

This keeps the state. Do not use `docker compose down -v`: it deletes the `triage-data` volume.

### Override a ticket

Add the label `triage-override` to the ticket in Linear. The bot never evaluates or changes a ticket with this label.

## 10. Troubleshooting

### The bot does not start

The container restarts in a loop (`docker compose ps` shows `restarting`). Read the first lines of the logs:

```bash
docker compose logs presales-triage
```

| Message | Meaning and fix |
| --- | --- |
| `Invalid environment variables: <names>` | These variables are missing or empty in `.env`. Add them, then run `docker compose up -d`. |
| `Cannot read config <path>: ...` | `config.json` is missing or is a folder. Delete the folder, run `cp config.example.json config.json`, then `docker compose up -d`. |
| `Invalid config: ...` | `config.json` has a JSON error or a wrong value. The message names the key. Fix it, then `docker compose restart`. |
| `Missing Linear labels: <names>` | Create these labels in Linear, spelled exactly like this. |
| `Linear team <key> not found` | `teamKey` in `config.json` is wrong, or the app cannot see the team (section 2). |
| `Linear team <key> is missing triage or canceled state` | Turn on Triage for the team, and make sure it has a Canceled state. |
| `Linear owner <email> not found` | `triageOwnerEmail` in `config.json` is not a Linear user. |

For the bot, the last four messages appear in a JSON line with `"msg":"startup failed"`, in the `error` field. The dry run prints all of them as plain text.

### "Manual triage needed" comments

- `Manual triage needed: the ticket description does not follow the Asks form ...` The ticket does not use the Asks form. A person triages it.
- `Manual triage needed: the request type "..." is not recognized.` The form has a "Type of Request" value that is not in `requestTypes` in `config.json`. Add the value, or triage the ticket by hand.
- `Automatic triage is unavailable, manual triage needed.` (in French, then English) A service failed for `handoffHours` hours on this ticket. The bot stops retrying it. A new requester comment or a change of the ticket body starts a new evaluation.

### Alert webhook

If `ALERT_WEBHOOK_URL` is set, the bot sends one message when a service (`linear`, `twenty`, `graph` or `llm`) becomes unavailable. The message reads "Presales Triage: `<service>` is unavailable since `<time>`. Error: `<error>`". The bot does not send one message per failed call.

The outage ends at the first successful call. The logs then show `"msg":"dependency outage ended"`. There is no Slack message for the end.

If the webhook call fails, the logs show `"msg":"dependency outage webhook failed"`. Check the webhook URL.
