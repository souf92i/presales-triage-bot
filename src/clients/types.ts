import type {
  AsksForm,
  Company,
  CrmNote,
  Opportunity,
  QualificationExtraction,
  Quote,
  RequestKind,
  TicketFacts,
} from '../domain/types.js';

export interface LinearIssue {
  readonly id: string; readonly identifier: string; readonly number: number; readonly title: string; readonly description: string;
  readonly createdAt: string; readonly updatedAt: string; readonly completedAt: string | null;
  readonly stateId: string; readonly stateType: string;
  readonly assignee: { readonly id: string; readonly email: string; readonly name: string } | null;
  readonly labels: readonly { readonly id: string; readonly name: string }[];
  readonly attachmentTitles: readonly string[];
}
export interface LinearComment {
  readonly id: string; readonly issueId: string; readonly body: string; readonly createdAt: string;
  readonly parentId: string | null; readonly authorId: string | null; readonly authorName: string;
}
export interface IssueWithComments { readonly issue: LinearIssue; readonly comments: readonly LinearComment[] }
export interface LinearUser { readonly id: string; readonly name: string; readonly displayName: string; readonly email: string }
export interface LinearWorkspace {
  readonly teamId: string; readonly triageStateId: string; readonly canceledStateId: string;
  readonly labelIds: Readonly<Record<string, string>>;   // lowercase label name -> id
  readonly triageOwnerId: string;
  readonly users: readonly LinearUser[];
}
export interface LinearClient {
  getViewerId(): Promise<string>;
  resolveWorkspace(teamKey: string, labelNames: readonly string[], triageOwnerEmail: string): Promise<LinearWorkspace>;
  listTriageIssues(teamKey: string): Promise<readonly IssueWithComments[]>;
  listIssuesUpdatedSince(teamKey: string, sinceIso: string | null): Promise<readonly LinearIssue[]>;
  getIssue(issueId: string): Promise<LinearIssue | null>;
  getIssueWithComments(issueId: string): Promise<IssueWithComments | null>;
  listCommentsCreatedSince(teamKey: string, sinceIso: string): Promise<readonly LinearComment[]>;
  createComment(input: { issueId: string; body: string; parentId: string | null }): Promise<string>;
  updateIssue(issueId: string, input: { stateId?: string; assigneeId?: string }): Promise<void>;
  addLabel(issueId: string, labelId: string): Promise<void>;
  removeLabel(issueId: string, labelId: string): Promise<void>;
}
export interface TwentyClient {
  getOpportunity(id: string): Promise<Opportunity | null>;   // null = 404 or deletedAt set
  getCompany(id: string): Promise<Company | null>;           // null = 404 or deletedAt set
  listNotes(target: { kind: 'opportunity' | 'company'; id: string }): Promise<readonly Omit<CrmNote, 'target'>[]>;
  listQuotes(opportunityId: string): Promise<readonly Quote[]>;
}
export interface GraphClient {
  getAvailability(emails: readonly string[], startUtc: Date, endUtc: Date): Promise<ReadonlyMap<string, boolean>>; // lowercase email -> free
}
export interface SourceText { readonly id: string; readonly label: string; readonly createdAt: string | null; readonly text: string }
export interface TicketFactsInput { readonly formKind: RequestKind; readonly form: AsksForm; readonly sources: readonly SourceText[] } // 'ticket' first, then requester comments
export interface QualificationInput { readonly hosting: readonly string[]; readonly sources: readonly SourceText[] } // fields, notes, 'ticket', requester comments
export interface LlmResult<T> { readonly value: T; readonly raw: unknown; readonly model: string }
export interface LlmClient {
  extractTicketFacts(input: TicketFactsInput): Promise<LlmResult<TicketFacts>>;
  extractQualification(input: QualificationInput): Promise<LlmResult<QualificationExtraction>>;
}
