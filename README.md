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

| Key | Meaning | Default |
| --- | --- | --- |
| `teamKey` | String. Key of the Linear team to triage. The team must have a triage state and a canceled state. | `PRE` |
| `triageOwnerEmail` | String. Email of the Linear user who gets an accepted ticket when the company has no previous ticket owner. The user must exist in Linear. | `ela@evertrust.fr` |
| `pool` | Array of `{ "email": string, "active": boolean }`. The bot reads the calendars of active members for a demo or technical discovery slot. The first active member's mailbox sends the Graph `getSchedule` call, so at least one member must be active. A previous owner who is not active shows as away. | sbo, vdo, mob inactive, ela |
| `approvers` | Array of names. A PoC exception passes `poc-paid` only when one name appears as a whole word, in any case, in the extracted approver and in the quoted note text. | Etienne, Mohamed, Soufiane, Vincent |
| `minDealVolume`, `minPocVolume` | Positive integers. `volume-floor` and `poc-volume` deny a new-business deal or PoC when the maximum stated volume is below the value. | 200, 500 |
| `maxUnknownItems` | Integer, 0 or more. `qualification` denies when more items than this are missing or declared unobtainable. Volume and decision maker must always be known and do not count toward this limit. | 2 |
| `waitDays` | Positive integer. In enforce mode, after the bot asks a question and the ticket gets no new input, the bot cancels the ticket when the wait expires. The wait expires at the earliest of now plus this number of days, the slot start and the end of the deadline day. | 7 |
| `handoffHours` | Positive integer. When the evaluation of a ticket fails for this number of hours, the bot posts a hand-off comment. | 2 |
| `shortNoticeWorkingDays` | Positive integer. `slot` adds a short-notice note when fewer full working days than this are between today and the slot day. Working days are Monday to Friday in `defaultTimezone`, without today and the slot day. | 2 |
| `noteMaxAgeMonths` | Positive integer. The bot reads company notes from this number of past months and all opportunity notes. | 12 |
| `discoveryMaxAgeMonths` | Positive integer. `discovery-first` passes when a technical discovery ticket for the company was completed, or a CRM note shows a discovery, in this number of past months. | 12 |
| `pollSeconds` | Positive integer. Seconds between two polls of Linear. | 120 |
| `defaultTimezone` | IANA time zone name. The bot uses it for a slot without a time zone, for working days and for the end of the deadline day. | `Europe/Paris` |
| `enforce` | Boolean. `false` runs shadow mode: the bot only sets the request type label and posts a shadow comment. `true` also changes the ticket state and assignee. | `false` |
| `overrideLabel` | String. The bot skips a ticket with this label, in any case. The label must exist in Linear. | `triage-override` |
| `requestTypes` | Array of `{ "formValue", "kind", "label" }`. The bot maps the form request type, in any case, to a `kind` (one of `demo`, `technical_discovery`, `poc`, `rfx`) and sets `label` on the ticket. Each label must exist in Linear, and an unmapped form value gives the `manual` verdict. | demo, technical discovery, poc, rfi rfp mappings |
| `pocProducts` | Array of Twenty product ids. A quote line with one of these products is a PoC line. | `[]` |
| `pocQuoteLinePattern` | Regular expression, case-insensitive. A quote line whose name or description matches it is a PoC line. | `\bpoc\b\|proof of concept` |
| `pocQuoteExcludedStatuses` | Array of quote statuses, each one of `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`. A quote with one of these statuses is not a PoC quote. | `EXPIRED`, `REJECTED` |
| `placeholderValues` | Array of strings. A form field or opportunity text field equal to one of these values is empty. The comparison trims spaces and ignores case. | TBD, ?, -, n/a, xxx, à définir, unknown, empty |
| `llmModel` | String. Claude model id for the LLM calls. | `claude-sonnet-5-5` |
| `llmEffort` | Effort for the LLM calls. One of `low`, `medium`, `high`, `xhigh`, `max`. | `medium` |
| `rules` | Array of rule ids to run. See the list below. | all rule ids |

If the file at `CONFIG_PATH` does not exist, the bot uses all defaults. An unknown key makes the config invalid.

Rule ids:

- `single-request`: the ticket has only one request.
- `crm-link`: the CRM link is valid and the record exists.
- `notes-exist`: the deal has at least one CRM note.
- `qualification`: the new-business deal has enough known qualification items.
- `volume-floor`: the new-business deal volume is at least `minDealVolume`.
- `discovery-first`: a new-business demo or PoC has a recent technical discovery.
- `slot`: a demo or technical discovery has a complete future slot and a free active pool member.
- `poc-volume`: the new-business PoC volume is at least `minPocVolume`.
- `poc-paid`: a PoC has a PoC quote, a note that expects one, or an approver exception.

## Running

For local use, run `npm ci && npm run build && npm start`. In production, see `docs/deployment.md`. View container logs with `docker compose logs -f presales-triage`.

## Replay

Run `npm run build && npm run replay -- fixtures/replay/PRE-304.json`. To replay another ticket, write a fixture with its ticket, CRM, calendar, history and LLM outputs. Replay calls no network service because the LLM outputs are part of the fixture.

## Dry run

Run `npm run build && npm run dry-run`, or `npm run dry-run -- PRE-304 PRE-301`. It reads live data and prints each verdict and comment without writing to Linear or a state file.
It evaluates each ticket as a first evaluation: it does not know the questions the bot asked earlier.

## Enforce mode

Review shadow comments, set `"enforce": true`, then restart. Triage tickets evaluated in shadow mode are evaluated once more in enforce mode. A ticket canceled before the bot had a record is never rechecked. Add `triage-override` to a ticket to override triage.
