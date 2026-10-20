import { z } from 'zod';
import type { LinearClient, LinearComment, LinearIssue } from './types.js';
import type { FetchLike } from './http.js';
import { requestJson } from './http.js';
import { ConfigError, DependencyError } from '../errors.js';
import type { Clock } from '../domain/types.js';
import * as query from './linear-queries.js';

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number() });
const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const issueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  number: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  state: z.object({ id: z.string(), type: z.string() }),
  assignee: z.object({ id: z.string(), email: z.string(), name: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string() })) }),
  attachments: z.object({ nodes: z.array(z.object({ title: z.string() })) }),
});
const commentSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  parent: z.object({ id: z.string() }).nullable(),
  user: z.object({ id: z.string(), name: z.string() }).nullable(),
  externalUser: z.object({ name: z.string() }).nullable(),
  botActor: z.object({ name: z.string().nullable() }).nullable(),
  issue: z.object({ id: z.string() }),
});
const issueWithCommentsSchema = issueSchema.extend({ comments: z.object({ nodes: z.array(commentSchema) }) });
const issuesPageSchema = z.object({ nodes: z.array(issueSchema), pageInfo: pageInfoSchema });
const issuesWithCommentsPageSchema = z.object({ nodes: z.array(issueWithCommentsSchema), pageInfo: pageInfoSchema });
const commentsPageSchema = z.object({ nodes: z.array(commentSchema), pageInfo: pageInfoSchema });
const successSchema = z.object({ success: z.literal(true) });
const workspaceSchema = z.object({
  teams: z.object({ nodes: z.array(z.object({ id: z.string(), states: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })) }) })) }),
  issueLabels: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string(), team: z.object({ id: z.string() }).nullable() })) }),
  owner: z.object({ nodes: z.array(z.object({ id: z.string() })) }),
  users: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string(), displayName: z.string(), email: z.string() })) }),
});

function invalid(message: string): DependencyError {
  return new DependencyError('linear', message);
}

function mapIssue(value: z.infer<typeof issueSchema>): LinearIssue {
  return {
    id: value.id,
    identifier: value.identifier,
    number: value.number,
    title: value.title,
    description: value.description ?? '',
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt,
    stateId: value.state.id,
    stateType: value.state.type,
    assignee: value.assignee,
    labels: value.labels.nodes,
    attachmentTitles: value.attachments.nodes.map((attachment) => attachment.title),
  };
}

function mapComment(value: z.infer<typeof commentSchema>): LinearComment {
  return {
    id: value.id,
    issueId: value.issue.id,
    body: value.body,
    createdAt: value.createdAt,
    parentId: value.parent?.id ?? null,
    authorId: value.user?.id ?? null,
    authorName: value.user?.name ?? value.externalUser?.name ?? value.botActor?.name ?? 'Unknown',
  };
}

function isEntityNotFound(errors: unknown): boolean {
  return Array.isArray(errors) && errors.some((error) => {
    return typeof error === 'object'
      && error !== null
      && 'message' in error
      && String(error.message).startsWith('Entity not found');
  });
}

export function createLinearClient(opts: { clientId: string; clientSecret: string; fetch?: FetchLike; clock: Clock }): LinearClient {
  const fetchFn = opts.fetch ?? fetch;
  const { clock } = opts;
  let cached: { token: string; expiresAt: Date } | null = null;

  async function renewToken(): Promise<string> {
    const body = 'grant_type=client_credentials&scope=read,write';
    const authorization = `Basic ${Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64')}`;
    try {
      const response = await fetchFn('https://api.linear.app/oauth/token', {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!response.ok) throw invalid(`Linear token request returned ${response.status}`);
      const parsed = tokenSchema.safeParse(await response.json());
      if (!parsed.success) throw invalid('Invalid Linear token response');
      cached = {
        token: parsed.data.access_token,
        expiresAt: new Date(clock().getTime() + parsed.data.expires_in * 1000),
      };
      return cached.token;
    } catch (cause) {
      throw new DependencyError('linear', 'Linear token request failed', { cause });
    }
  }

  async function token(force = false): Promise<string> {
    if (force || cached === null || cached.expiresAt.getTime() - clock().getTime() < 86_400_000) {
      return renewToken();
    }
    return cached.token;
  }

  async function raw(document: string, variables: Record<string, unknown>, missingEntityIsNull = false): Promise<unknown | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await requestJson('linear', fetchFn, 'https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await token(attempt === 1)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: document, variables }),
      });
      const errors = result.body !== null && typeof result.body === 'object' && 'errors' in result.body
        ? (result.body as { errors?: unknown }).errors
        : undefined;
      const auth = result.status === 401 || (Array.isArray(errors) && errors.some((error) => {
        return typeof error === 'object'
          && error !== null
          && 'extensions' in error
          && typeof error.extensions === 'object'
          && error.extensions !== null
          && 'type' in error.extensions
          && String(error.extensions.type).toLowerCase().includes('authentication');
      }));
      if (auth && attempt === 0) {
        cached = null;
        continue;
      }
      if (missingEntityIsNull && isEntityNotFound(errors)) return null;
      if (auth || result.status < 200 || result.status >= 300 || errors !== undefined) {
        throw invalid('Linear GraphQL request failed');
      }
      if (result.body === null || typeof result.body !== 'object' || !('data' in result.body)) {
        throw invalid('Invalid Linear GraphQL response');
      }
      return result.body.data;
    }
    throw invalid('Linear GraphQL authentication failed');
  }

  async function request<T>(document: string, variables: Record<string, unknown>, schema: z.ZodType<T>): Promise<T>;
  async function request<T>(document: string, variables: Record<string, unknown>, schema: z.ZodType<T>, missingEntityIsNull: true): Promise<T | null>;
  async function request<T>(document: string, variables: Record<string, unknown>, schema: z.ZodType<T>, missingEntityIsNull = false): Promise<T | null> {
    const value = await raw(document, variables, missingEntityIsNull);
    if (value === null && missingEntityIsNull) return null;
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw invalid('Invalid Linear GraphQL response');
    return parsed.data;
  }

  async function pages<T>(document: string, variables: Record<string, unknown>, schema: z.ZodType<{ pageInfo: z.infer<typeof pageInfoSchema>; nodes: T[] }>, key: 'issues' | 'comments'): Promise<T[]> {
    const all: T[] = [];
    let after: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const value = await raw(document, { ...variables, after }) as Record<string, unknown>;
      const parsed = schema.safeParse(value[key]);
      if (!parsed.success) throw invalid('Invalid Linear GraphQL response');
      all.push(...parsed.data.nodes);
      if (!parsed.data.pageInfo.hasNextPage) return all;
      if (parsed.data.pageInfo.endCursor === null) throw invalid('Linear pagination cursor missing');
      after = parsed.data.pageInfo.endCursor;
    }
    throw invalid('Linear pagination exceeded 100 pages');
  }

  return {
    async getViewerId() {
      return (await request(query.VIEWER, {}, z.object({ viewer: z.object({ id: z.string() }) }))).viewer.id;
    },
    async resolveWorkspace(teamKey, labelNames, triageOwnerEmail) {
      const value = await request(query.WORKSPACE, { teamKey, labelNames: [...labelNames], email: triageOwnerEmail }, workspaceSchema);
      const team = value.teams.nodes[0];
      if (team === undefined) throw new ConfigError(`Linear team ${teamKey} not found`);
      const triage = team.states.nodes.find((state) => state.type === 'triage');
      const canceled = team.states.nodes.find((state) => state.type === 'canceled' && state.name.toLowerCase() === 'canceled')
        ?? team.states.nodes.find((state) => state.type === 'canceled');
      if (triage === undefined || canceled === undefined) throw new ConfigError(`Linear team ${teamKey} is missing triage or canceled state`);
      const missing: string[] = [];
      const labelIds: Record<string, string> = {};
      for (const name of labelNames) {
        const label = value.issueLabels.nodes.find((entry) => entry.name === name && entry.team?.id === team.id)
          ?? value.issueLabels.nodes.find((entry) => entry.name === name && entry.team === null);
        if (label === undefined) missing.push(name);
        else labelIds[name.toLowerCase()] = label.id;
      }
      if (missing.length > 0) throw new ConfigError(`Missing Linear labels: ${missing.join(', ')}`);
      const owner = value.owner.nodes[0];
      if (owner === undefined) throw new ConfigError(`Linear owner ${triageOwnerEmail} not found`);
      return {
        teamId: team.id,
        triageStateId: triage.id,
        canceledStateId: canceled.id,
        labelIds,
        triageOwnerId: owner.id,
        users: value.users.nodes,
      };
    },
    async listTriageIssues(teamKey) {
      const nodes = await pages(query.TRIAGE_ISSUES, { teamKey }, issuesWithCommentsPageSchema, 'issues');
      return nodes.map((entry) => ({ issue: mapIssue(entry), comments: entry.comments.nodes.map(mapComment) }));
    },
    async listIssuesUpdatedSince(teamKey, sinceIso) {
      const nodes = await pages(query.ISSUES_UPDATED_SINCE, { teamKey, since: sinceIso ?? '1970-01-01T00:00:00.000Z' }, issuesPageSchema, 'issues');
      return nodes.map(mapIssue);
    },
    async getIssue(issueId) {
      const value = await request(query.ISSUE, { id: issueId }, z.object({ issue: issueSchema.nullable() }), true);
      return value === null || value.issue === null ? null : mapIssue(value.issue);
    },
    async getIssueWithComments(issueId) {
      const value = await request(query.ISSUE_WITH_COMMENTS, { id: issueId }, z.object({ issue: issueWithCommentsSchema.nullable() }), true);
      return value === null || value.issue === null
        ? null
        : { issue: mapIssue(value.issue), comments: value.issue.comments.nodes.map(mapComment) };
    },
    async listCommentsCreatedSince(teamKey, sinceIso) {
      const nodes = await pages(query.COMMENTS_SINCE, { teamKey, since: sinceIso }, commentsPageSchema, 'comments');
      return nodes.map(mapComment);
    },
    async createComment(input) {
      const value = await request(query.COMMENT_CREATE, {
        input: input.parentId === null ? { issueId: input.issueId, body: input.body } : input,
      }, z.object({ commentCreate: successSchema.extend({ comment: z.object({ id: z.string() }) }) }));
      return value.commentCreate.comment.id;
    },
    async updateIssue(issueId, input) {
      await request(query.ISSUE_UPDATE, { id: issueId, input }, z.object({ issueUpdate: successSchema }));
    },
    async addLabel(issueId, labelId) {
      await request(query.ISSUE_ADD_LABEL, { id: issueId, labelId }, z.object({ issueAddLabel: successSchema }));
    },
    async removeLabel(issueId, labelId) {
      await request(query.ISSUE_REMOVE_LABEL, { id: issueId, labelId }, z.object({ issueRemoveLabel: successSchema }));
    },
  };
}
