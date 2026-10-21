# Linear Presales Triage

This bot reviews Presales tickets in Linear against the agreed triage policy. It gathers CRM, calendar and ticket facts, then labels the ticket and posts the result. In enforce mode it also moves, assigns or cancels the ticket. In shadow mode it only applies the label and posts a "Shadow mode" comment, so the team can check its decisions first.

## Setup

For a production deployment with Docker, follow the [deployment guide](docs/deployment.md).

- Create the Linear app `Presales Triage` as an OAuth2 app. Enable the `client_credentials` grant and `read,write` scopes. Its token acts as the app and is renewed by the bot.
- Create a Microsoft Entra app with the `Calendars.ReadBasic.All` application permission and admin consent. It covers every mailbox in the tenant (no event body). The first active pool mailbox runs `getSchedule`.
- Create a Twenty API key with read access to opportunities, companies, notes, note targets, quotes and quote lines.
- In the Linear Asks form, add `Technical discovery` as a Type of Request option.
- Create Linear labels: `demo`, `technical discovery`, `poc`, `rfi rfp`, `triage-override`. Startup lists missing labels and stops.
- For a shadow trial, turn off PRE comment notifications to Slack.

| Environment variable | Required | Default |
| --- | --- | --- |
| `LINEAR_CLIENT_ID` | Yes | None |
| `LINEAR_CLIENT_SECRET` | Yes | None |
| `TWENTY_BASE_URL` | Yes | None |
| `TWENTY_API_KEY` | Yes | None |
| `GRAPH_TENANT_ID` | Yes | None |
| `GRAPH_CLIENT_ID` | Yes | None |
| `GRAPH_CLIENT_SECRET` | Yes | None |
| `ANTHROPIC_API_KEY` | Yes | None |
| `ALERT_WEBHOOK_URL` | No | None |
| `CONFIG_PATH` | No | `./config.json` |
| `DB_PATH` | No | `./data/triage.sqlite` |

## Configuration

Copy `config.example.json` to `config.json`. Removing a rule id from `rules` disables that rule.

| Key | Default |
| --- | --- |
| `teamKey` | `PRE` |
| `triageOwnerEmail` | `ela@evertrust.fr` |
| `pool` | sbo, vdo, mob inactive, ela |
| `approvers` | Etienne, Mohamed, Soufiane, Vincent |
| `minDealVolume`, `minPocVolume` | 200, 500 |
| `maxUnknownItems` | 2 |
| `waitDays`, `handoffHours` | 7, 2 |
| `shortNoticeWorkingDays` | 2 |
| `noteMaxAgeMonths`, `discoveryMaxAgeMonths` | 12, 12 |
| `pollSeconds` | 120 |
| `defaultTimezone` | `Europe/Paris` |
| `enforce` | `false` |
| `overrideLabel` | `triage-override` |
| `requestTypes` | demo, technical discovery, poc, rfi rfp mappings |
| `pocProducts` | `[]` |
| `pocQuoteLinePattern` | `\bpoc\b\|proof of concept` |
| `pocQuoteExcludedStatuses` | `EXPIRED`, `REJECTED` |
| `placeholderValues` | TBD, ?, -, n/a, xxx, à définir, unknown, empty |
| `llmModel`, `llmEffort` | `claude-sonnet-5-5`, `medium` |
| `rules` | all rule ids |

## Running

For local use, run `npm ci && npm run build && npm start`. In production, see `docs/deployment.md`. View container logs with `docker compose logs -f presales-triage`.

## Replay

Run `npm run build && npm run replay -- fixtures/replay/PRE-304.json`. To replay another ticket, write a fixture with its ticket, CRM, calendar, history and LLM outputs. Replay calls no network service because the LLM outputs are part of the fixture.

## Dry run

Run `npm run build && npm run dry-run`, or `npm run dry-run -- PRE-304 PRE-301`. It reads live data and prints each verdict and comment without writing to Linear or a state file.
It evaluates each ticket as a first evaluation: it does not know the questions the bot asked earlier.

## Enforce mode

Review shadow comments, set `"enforce": true`, then restart. Triage tickets evaluated in shadow mode are evaluated once more in enforce mode. A ticket canceled before the bot had a record is never rechecked. Add `triage-override` to a ticket to override triage.
