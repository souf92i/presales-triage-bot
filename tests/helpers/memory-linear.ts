import type { IssueWithComments, LinearClient, LinearComment, LinearIssue, LinearWorkspace } from '../../src/clients/types.js';
import type { Clock } from '../../src/domain/types.js';
import { DependencyError, type Dependency } from '../../src/errors.js';

export class MemoryLinear implements LinearClient {
  readonly calls: { method: string; args: unknown[] }[] = [];
  private readonly issues: Map<string, IssueWithComments>;
  private readonly failures = new Map<keyof LinearClient, Error>();
  private readonly workspace: LinearWorkspace;
  private commentSequence = 0;

  constructor(private readonly seed: { issues: IssueWithComments[]; viewerId: string; workspace: LinearWorkspace }, private readonly clock: Clock) {
    this.issues = new Map(structuredClone(seed.issues).map((ticket) => [ticket.issue.id, ticket]));
    this.workspace = structuredClone(seed.workspace);
  }

  failNext(method: keyof LinearClient, error: Error): void { this.failures.set(method, error); }

  private record(method: keyof LinearClient, ...args: unknown[]): void {
    this.calls.push({ method, args: structuredClone(args) });
    const error = this.failures.get(method);
    this.failures.delete(method);
    if (error) throw error;
  }

  private requireIssue(issueId: string): IssueWithComments {
    const ticket = this.issues.get(issueId);
    if (!ticket) throw new DependencyError('linear', `Issue not found: ${issueId}`);
    return ticket;
  }

  private saveIssue(issueId: string, patch: Partial<LinearIssue>): void {
    const ticket = this.requireIssue(issueId);
    this.issues.set(issueId, { ...ticket, issue: { ...ticket.issue, ...patch, updatedAt: this.clock().toISOString() } });
  }

  private teamIssues(teamKey: string): IssueWithComments[] {
    return [...this.issues.values()].filter(({ issue }) => issue.identifier.startsWith(`${teamKey}-`));
  }

  async getViewerId(): Promise<string> {
    this.record('getViewerId');
    return this.seed.viewerId;
  }

  async resolveWorkspace(teamKey: string, labelNames: readonly string[], triageOwnerEmail: string): Promise<LinearWorkspace> {
    this.record('resolveWorkspace', teamKey, labelNames, triageOwnerEmail);
    return structuredClone(this.workspace);
  }

  async listTriageIssues(teamKey: string): Promise<readonly IssueWithComments[]> {
    this.record('listTriageIssues', teamKey);
    return structuredClone(this.teamIssues(teamKey).filter(({ issue }) => issue.stateId === this.workspace.triageStateId));
  }

  async listIssuesUpdatedSince(teamKey: string, sinceIso: string | null): Promise<readonly LinearIssue[]> {
    this.record('listIssuesUpdatedSince', teamKey, sinceIso);
    return structuredClone(this.teamIssues(teamKey).map(({ issue }) => issue).filter((issue) => sinceIso === null || issue.updatedAt >= sinceIso));
  }

  async getIssue(issueId: string): Promise<LinearIssue | null> {
    this.record('getIssue', issueId);
    return structuredClone(this.issues.get(issueId)?.issue ?? null);
  }

  async getIssueWithComments(issueId: string): Promise<IssueWithComments | null> {
    this.record('getIssueWithComments', issueId);
    return structuredClone(this.issues.get(issueId) ?? null);
  }

  async listCommentsCreatedSince(teamKey: string, sinceIso: string): Promise<readonly LinearComment[]> {
    this.record('listCommentsCreatedSince', teamKey, sinceIso);
    return structuredClone(this.teamIssues(teamKey).flatMap(({ comments }) => comments).filter((comment) => comment.createdAt >= sinceIso));
  }

  async createComment(input: { issueId: string; body: string; parentId: string | null }): Promise<string> {
    this.record('createComment', input);
    const ticket = this.requireIssue(input.issueId);
    let id: string;
    do { id = `memory-comment-${++this.commentSequence}`; }
    while ([...this.issues.values()].some(({ comments }) => comments.some((comment) => comment.id === id)));
    const comment: LinearComment = { ...input, id, createdAt: this.clock().toISOString(), authorId: this.seed.viewerId, authorName: this.seed.viewerId };
    this.issues.set(input.issueId, { ...ticket, comments: [...ticket.comments, comment] });
    this.saveIssue(input.issueId, {});
    return id;
  }

  async updateIssue(issueId: string, input: { stateId?: string; assigneeId?: string }): Promise<void> {
    this.record('updateIssue', issueId, input);
    const assignee = input.assigneeId === undefined ? undefined : this.workspace.users.find((user) => user.id === input.assigneeId);
    if (input.assigneeId !== undefined && assignee === undefined) throw new DependencyError('linear', `User not found: ${input.assigneeId}`);
    const stateType = input.stateId === this.workspace.canceledStateId ? 'canceled' : 'triage';
    this.saveIssue(issueId, {
      ...(input.stateId === undefined ? {} : { stateId: input.stateId, stateType }),
      ...(assignee === undefined ? {} : { assignee: { id: assignee.id, name: assignee.name, email: assignee.email } }),
    });
  }

  async addLabel(issueId: string, labelId: string): Promise<void> {
    this.record('addLabel', issueId, labelId);
    const { issue } = this.requireIssue(issueId);
    const label = Object.entries(this.workspace.labelIds).find(([, id]) => id === labelId);
    if (!label) throw new DependencyError('linear', `Label not found: ${labelId}`);
    this.saveIssue(issueId, { labels: issue.labels.some(({ id }) => id === labelId) ? issue.labels : [...issue.labels, { id: labelId, name: label[0] }] });
  }

  async removeLabel(issueId: string, labelId: string): Promise<void> {
    this.record('removeLabel', issueId, labelId);
    const { issue } = this.requireIssue(issueId);
    this.saveIssue(issueId, { labels: issue.labels.filter(({ id }) => id !== labelId) });
  }
}

export function failing<T extends object>(client: T, dependency: Dependency): T {
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? async () => { throw new DependencyError(dependency, `Failed ${String(property)}`); } : value;
    },
  });
}
