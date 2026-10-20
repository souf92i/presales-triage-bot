# Context: Linear Presales Triage

Glossary for this repo. Use these terms in code, tests and docs.

- **Ask**: a presales request created in Linear team PRE from Slack through Linear Asks.
- **Request kind**: `demo`, `technical_discovery`, `poc`, `rfx`. Derived from the form's Type of Request.
- **Triage owner**: the person who receives accepted tickets (config `triageOwnerEmail`, today Etienne, `ela@`).
- **SE / owner**: the presales engineer who followed a customer before. Found from the most recent worked ticket of the same company.
- **Worked ticket**: a ticket that left Triage and is not canceled or duplicate.
- **Pool**: the presales engineers whose calendars are checked for a slot.
- **Facts**: the typed record extracted from the ticket and the CRM. The LLM produces facts, never verdicts.
- **Rule**: a module that reads facts and returns pass, deny, ask or skip.
- **Annotation**: information added to the comment without changing the verdict (owner, partner caution, short notice, on site).
- **Verdict**: denied, waiting or accepted.
- **Shadow mode**: the bot labels and writes an unsynced comment, nothing else. **Enforce mode**: the bot acts.
- **Partner-only ask**: an ask whose Target is only Partner.
- **Qualification items**: volume, hosting, solution, decision maker, budget, timeline, current PKI, use cases, CLM driver.
