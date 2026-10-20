export const VIEWER = `query Viewer { viewer { id } }`;
export const ISSUE_FIELDS = `fragment IssueFields on Issue {
  id identifier number title description createdAt updatedAt completedAt
  state { id type } assignee { id email name }
  labels(first: 20) { nodes { id name } } attachments(first: 10) { nodes { title } }
}`;
export const COMMENT_FIELDS = `fragment CommentFields on Comment {
  id body createdAt parent { id } user { id name } externalUser { name } botActor { name } issue { id }
}`;
export const TRIAGE_ISSUES = `${ISSUE_FIELDS}\n${COMMENT_FIELDS}\nquery TriageIssues($teamKey: String!, $after: String) {
  issues(first: 10, after: $after, filter: { team: { key: { eq: $teamKey } }, state: { type: { eq: "triage" } } }) {
    nodes { ...IssueFields comments(first: 100) { nodes { ...CommentFields } } } pageInfo { hasNextPage endCursor } } }`;
export const ISSUES_UPDATED_SINCE = `${ISSUE_FIELDS}\nquery IssuesUpdatedSince($teamKey: String!, $since: DateTimeOrDuration!, $after: String) {
  issues(first: 50, after: $after, includeArchived: true, orderBy: updatedAt,
         filter: { team: { key: { eq: $teamKey } }, updatedAt: { gt: $since } }) {
    nodes { ...IssueFields } pageInfo { hasNextPage endCursor } } }`;
export const ISSUE = `${ISSUE_FIELDS}\nquery Issue($id: String!) { issue(id: $id) { ...IssueFields } }`;
export const ISSUE_WITH_COMMENTS = `${ISSUE_FIELDS}\n${COMMENT_FIELDS}\nquery IssueWithComments($id: String!) { issue(id: $id) { ...IssueFields comments(first: 100) { nodes { ...CommentFields } } } }`;
export const COMMENTS_SINCE = `${COMMENT_FIELDS}\nquery CommentsSince($teamKey: String!, $since: DateTimeOrDuration!, $after: String) {
  comments(first: 100, after: $after, orderBy: createdAt, filter: { createdAt: { gt: $since }, issue: { team: { key: { eq: $teamKey } } } }) {
    nodes { ...CommentFields } pageInfo { hasNextPage endCursor } } }`;
export const COMMENT_CREATE = `mutation CommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }`;
export const ISSUE_UPDATE = `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`;
export const ISSUE_ADD_LABEL = `mutation IssueAddLabel($id: String!, $labelId: String!) { issueAddLabel(id: $id, labelId: $labelId) { success } }`;
export const ISSUE_REMOVE_LABEL = `mutation IssueRemoveLabel($id: String!, $labelId: String!) { issueRemoveLabel(id: $id, labelId: $labelId) { success } }`;
export const WORKSPACE = `query Workspace($teamKey: String!, $labelNames: [String!]!, $email: String!) {
  teams(filter: { key: { eq: $teamKey } }) { nodes { id states { nodes { id name type } } } }
  issueLabels(first: 250, filter: { name: { in: $labelNames } }) { nodes { id name team { id } } }
  owner: users(filter: { email: { eq: $email } }) { nodes { id } }
  users(first: 250) { nodes { id name displayName email } } }`;
