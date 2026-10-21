import { renderOutcomeBody } from './actions.js';
import { readOnlyLinear } from './clients/read-only-linear.js';
import { createGraphClient } from './clients/graph.js';
import { createLinearClient } from './clients/linear.js';
import { createLlmClient, sdkParse } from './clients/llm.js';
import { createTwentyClient } from './clients/twenty.js';
import type { IssueWithComments } from './clients/types.js';
import { loadConfig, loadEnv, managedLabels } from './config.js';
import { ConfigError, DependencyError } from './errors.js';
import { evaluateTicket } from './evaluate.js';
import { createLogger } from './log.js';
import { refreshIndex, type PollerDeps } from './poller.js';
import { openStore } from './store/store.js';
import { ticketInput } from './triggers.js';

function print(value: string): void {
  process.stdout.write(`${value}\n`);
}

function printTicket(ticket: IssueWithComments, outcome: Awaited<ReturnType<typeof evaluateTicket>>): void {
  print(ticket.issue.identifier);
  print(`title: ${ticket.issue.title}`);
  if (outcome.kind === 'manual') {
    print('verdict: manual');
    print(`comment: ${renderOutcomeBody(outcome)}`);
    return;
  }
  print(`verdict: ${outcome.result.verdict}`);
  for (const result of outcome.result.results) print(`${result.ruleId}: ${result.outcome.kind}`);
  for (const annotation of outcome.result.annotations) print(`annotation: ${JSON.stringify(annotation)}`);
  const comment = outcome.result.verdict === 'pending_retry'
    ? `pending_retry: ${outcome.result.errors.join('; ')}`
    : renderOutcomeBody(outcome);
  print(`comment: ${comment}`);
}

function printDependency(identifier: string, error: DependencyError, title?: string): void {
  print(identifier);
  if (title !== undefined) print(`title: ${title}`);
  print('verdict: pending_retry');
  print(`comment: pending_retry: ${error.dependency}: ${error.message}`);
}

async function evaluateTickets(tickets: readonly (IssueWithComments | string)[], deps: PollerDeps): Promise<void> {
  for (const ticket of tickets) {
    if (typeof ticket === 'string') { print(`${ticket}\nnot found`); continue; }
    if (ticket.issue.stateType !== 'triage') { print(`${ticket.issue.identifier}\nskipped: not in Triage`); continue; }
    if (ticket.issue.labels.some(({ name }) => name.toLowerCase() === deps.config.overrideLabel.toLowerCase())) {
      print(`${ticket.issue.identifier}\nskipped: override label`); continue;
    }
    try {
      const input = ticketInput(ticket, deps.workspace.users, deps.botUserId);
      printTicket(ticket, await evaluateTicket({ issue: ticket.issue, ...input, lastAskKeys: [] }, { ...deps, history: deps.store.index, users: deps.workspace.users }));
    } catch (error) {
      if (error instanceof DependencyError) printDependency(ticket.issue.identifier, error, ticket.issue.title);
      else throw error;
    }
  }
}

async function run(): Promise<void> {
  const env = loadEnv(process.env);
  const config = loadConfig(env.CONFIG_PATH);
  const clock = () => new Date();
  const log = createLogger(clock);
  const store = openStore(':memory:');
  try {
    const linear = readOnlyLinear(createLinearClient({ clientId: env.LINEAR_CLIENT_ID, clientSecret: env.LINEAR_CLIENT_SECRET, clock }));
    const twenty = createTwentyClient({ baseUrl: env.TWENTY_BASE_URL, apiKey: env.TWENTY_API_KEY });
    const schedulerMailbox = config.pool.find(({ active }) => active)?.email;
    if (schedulerMailbox === undefined) throw new Error('No active pool member');
    const graph = createGraphClient({ tenantId: env.GRAPH_TENANT_ID, clientId: env.GRAPH_CLIENT_ID, clientSecret: env.GRAPH_CLIENT_SECRET, schedulerMailbox, clock });
    const llm = createLlmClient({ parse: sdkParse(env.ANTHROPIC_API_KEY), model: config.llmModel, effort: config.llmEffort });
    const botUserId = await linear.getViewerId();
    const workspace = await linear.resolveWorkspace(config.teamKey, [...managedLabels(config), config.overrideLabel], config.triageOwnerEmail);
    const deps: PollerDeps = { config, linear, twenty, graph, llm, store, workspace, botUserId, clock, random: Math.random, log };
    await refreshIndex(deps);
    const requested = process.argv.slice(2);
    const tickets: (IssueWithComments | string)[] = requested.length === 0 ? [...await linear.listTriageIssues(config.teamKey)] : [];
    for (const identifier of requested) {
      try {
        tickets.push((await linear.getIssueWithComments(identifier)) ?? identifier);
      } catch (error) {
        if (error instanceof DependencyError) printDependency(identifier, error);
        else throw error;
      }
    }
    await evaluateTickets(tickets, deps);
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  try {
    await run();
  } catch (error) {
    process.stderr.write(`${error instanceof ConfigError ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
