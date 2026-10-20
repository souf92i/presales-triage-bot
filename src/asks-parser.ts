import type { RequestTypeMapping } from './config.js';
import type { AsksForm, RequestKind, Target } from './domain/types.js';
import { isPlaceholder } from './text.js';

const headingToField = {
  Target: 'target',
  'Prospect / Customer / Partner name': 'customerName',
  'Qualification HubSpot Link': 'crmLinkRaw',
  'Type of Request': 'requestType',
  Deadline: 'deadline',
  'Target meeting date(s)': 'meetingText',
  Priority: 'priority',
  'Sharepoint link': 'sharepointLink',
} as const;

type FormField = (typeof headingToField)[keyof typeof headingToField];
type FormSections = Record<FormField, string>;

function parseSections(description: string, placeholders: readonly string[]): FormSections | null {
  const sections: Partial<FormSections> = {};
  const lines = description.split('\n');
  let heading: string | null = null;
  let content: string[] = [];

  const saveSection = () => {
    if (heading === null) return;
    const field = headingToField[heading as keyof typeof headingToField];
    const value = content.join('\n').trim();
    if (field) sections[field] = isPlaceholder(value, placeholders) ? '' : value;
  };

  for (const line of lines) {
    const match = line.match(/^####\s+(.+?)\s*$/);
    if (match) {
      saveSection();
      heading = (match[1] ?? '').trim();
      content = [];
    } else if (heading !== null) {
      content.push(line);
    }
  }
  saveSection();

  if (!Object.hasOwn(sections, 'requestType')) return null;
  return {
    target: sections.target ?? '',
    customerName: sections.customerName ?? '',
    crmLinkRaw: sections.crmLinkRaw ?? '',
    requestType: sections.requestType ?? '',
    deadline: sections.deadline ?? '',
    meetingText: sections.meetingText ?? '',
    priority: sections.priority ?? '',
    sharepointLink: sections.sharepointLink ?? '',
  };
}

function firstUrlOrValue(value: string): string {
  return value.match(/https?:\/\/[^\s<>()\[\]]+/)?.[0] ?? value;
}

function parseTargets(value: string): readonly Target[] {
  return value.split(',').reduce<Target[]>((targets, item) => {
    const normalized = item.trim().toLowerCase();
    const target = normalized === 'end customer'
      ? 'End customer'
      : normalized === 'partner'
        ? 'Partner'
        : null;
    if (target && !targets.includes(target)) targets.push(target);
    return targets;
  }, []);
}

export function parseRequesterName(attachmentTitles: readonly string[]): string | null {
  for (const title of attachmentTitles) {
    const match = title.match(/^Ask from (.+)$/);
    if (match) return (match[1] ?? '').trim();
  }
  return null;
}

export function parseAsksForm(
  description: string,
  attachmentTitles: readonly string[],
  placeholders: readonly string[],
): AsksForm | null {
  const sections = parseSections(description, placeholders);
  if (sections === null) return null;

  return {
    target: parseTargets(sections.target),
    customerName: sections.customerName,
    crmLinkRaw: firstUrlOrValue(sections.crmLinkRaw),
    requestType: sections.requestType,
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(sections.deadline) ? sections.deadline : null,
    meetingText: sections.meetingText,
    priority: sections.priority,
    sharepointLink: firstUrlOrValue(sections.sharepointLink),
    requesterName: parseRequesterName(attachmentTitles),
  };
}

export function mapRequestType(
  requestType: string,
  mapping: readonly RequestTypeMapping[],
): { kind: RequestKind; label: string } | null {
  const normalized = requestType.trim().toLowerCase();
  const match = mapping.find((item) => item.formValue.toLowerCase() === normalized);
  return match ? { kind: match.kind, label: match.label } : null;
}

export function kindFromLabels(
  labelNames: readonly string[],
  mapping: readonly RequestTypeMapping[],
): RequestKind | null {
  for (const labelName of labelNames) {
    const match = mapping.find((item) => item.label.toLowerCase() === labelName.toLowerCase());
    if (match) return match.kind;
  }
  return null;
}
