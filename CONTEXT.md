# Context: Linear Presales Triage

Glossary for this repo. Use these terms in code, tests and docs.

- **Ask**: a presales request created in Linear team PRE from Slack through Linear Asks.
- **Request kind**: `demo`, `technical_discovery`, `poc`, `rfx`. Derived from the form's Type of Request.
- **Triage owner**: the person who receives accepted tickets (config `triageOwnerEmail`, today Etienne, `ela@`).
- **SE / owner**: the presales engineer who followed a customer before. Found from the most recent worked ticket of the same company.
- **Requester**: the person named in the ask's `Ask from <Name>` attachment, resolved to a Linear user or a Slack display name. Only the requester's comments count as answers, triggers and LLM input.
- **Worked ticket**: a ticket whose state type is `unstarted`, `started` or `completed`. Backlog (Parked), triage and canceled (duplicate included) do not count.
- **Pool**: the presales engineers whose calendars are checked for a slot.
- **Facts**: the typed record extracted from the ticket and the CRM. The LLM produces facts, never verdicts.
- **Rule**: a module that reads facts and returns pass, deny, ask, skip (does not apply) or error (cannot be evaluated).
- **Annotation**: information added to the comment without changing the verdict (owner, partner caution, short notice, on site).
- **Verdict**: accepted, waiting, denied, manual (unsupported form or unknown request type; a person triages) or pending_retry (a mandatory input could not be read).
- **Shadow mode**: the bot labels and writes a comment outside the synced thread, nothing else. **Enforce mode**: the bot acts.
- **Partner-only ask**: an ask whose Target is only Partner.
- **Qualification items**: volume, hosting, solution, decision maker, budget, timeline, current PKI, use cases, CLM driver.
