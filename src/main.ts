import { createOutageTracker, withOutageTracking } from './alerts.js';
import { createGraphClient } from './clients/graph.js';
import { createLinearClient } from './clients/linear.js';
import { createLlmClient, sdkParse } from './clients/llm.js';
import { createTwentyClient } from './clients/twenty.js';
import { loadConfig, loadEnv, managedLabels } from './config.js';
import { ConfigError } from './errors.js';
import { createLogger } from './log.js';
import { runTick } from './poller.js';
import { openStore } from './store/store.js';

function stopped(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
}

async function main(): Promise<void> {
  let env;
  let config;
  try {
    env = loadEnv(process.env);
    config = loadConfig(env.CONFIG_PATH);
  } catch (error) {
    if (error instanceof ConfigError) process.stderr.write(`${error.message}\n`);
    else process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const clock = () => new Date();
  const log = createLogger(clock);
  const store = openStore(env.DB_PATH);
  try {
    const outages = createOutageTracker({ outages: store.outages, webhookUrl: env.ALERT_WEBHOOK_URL, log, clock });
    const linear = withOutageTracking(createLinearClient({ clientId: env.LINEAR_CLIENT_ID, clientSecret: env.LINEAR_CLIENT_SECRET, clock }), 'linear', outages);
    const twenty = withOutageTracking(createTwentyClient({ baseUrl: env.TWENTY_BASE_URL, apiKey: env.TWENTY_API_KEY }), 'twenty', outages);
    const schedulerMailbox = config.pool.find(({ active }) => active)?.email;
    if (schedulerMailbox === undefined) throw new Error('No active pool member');
    const graph = withOutageTracking(createGraphClient({ tenantId: env.GRAPH_TENANT_ID, clientId: env.GRAPH_CLIENT_ID, clientSecret: env.GRAPH_CLIENT_SECRET, schedulerMailbox, clock }), 'graph', outages);
    const llm = withOutageTracking(createLlmClient({ parse: sdkParse(env.ANTHROPIC_API_KEY), model: config.llmModel, effort: config.llmEffort }), 'llm', outages);
    const botUserId = await linear.getViewerId();
    const workspace = await linear.resolveWorkspace(config.teamKey, [...managedLabels(config), config.overrideLabel], config.triageOwnerEmail);
    log('info', 'started', { mode: config.enforce ? 'enforce' : 'shadow' });
    const stop = stopped();
    let running = true;
    void stop.then(() => { running = false; });
    while (running) {
      await runTick({ config, linear, twenty, graph, llm, store, workspace, botUserId, clock, random: Math.random, log });
      if (running) await Promise.race([stop, new Promise((resolve) => setTimeout(resolve, config.pollSeconds * 1000))]);
    }
  } catch (error) {
    log('error', 'startup failed', { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

void main();
