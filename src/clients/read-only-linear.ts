import type { LinearClient } from './types.js';

export function readOnlyLinear(inner: LinearClient): LinearClient {
  async function blocked(method: string): Promise<never> {
    throw new Error(`dry run: ${method} blocked`);
  }

  return {
    getViewerId: () => inner.getViewerId(),
    resolveWorkspace: (teamKey, labelNames, triageOwnerEmail) => inner.resolveWorkspace(teamKey, labelNames, triageOwnerEmail),
    listTriageIssues: (teamKey) => inner.listTriageIssues(teamKey),
    listIssuesUpdatedSince: (teamKey, sinceIso) => inner.listIssuesUpdatedSince(teamKey, sinceIso),
    getIssue: (issueId) => inner.getIssue(issueId),
    getIssueWithComments: (issueId) => inner.getIssueWithComments(issueId),
    listCommentsCreatedSince: (teamKey, sinceIso) => inner.listCommentsCreatedSince(teamKey, sinceIso),
    createComment: () => blocked('createComment'),
    updateIssue: () => blocked('updateIssue'),
    addLabel: () => blocked('addLabel'),
    removeLabel: () => blocked('removeLabel'),
  };
}
