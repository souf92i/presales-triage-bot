import type { SourceText } from '../clients/types.js';
import type { Opportunity, QualificationExtraction, QualificationFacts, NoteFacts } from '../domain/types.js';
import { isPlaceholder } from '../text.js';

export const TEXT_FIELDS = ['besoin', 'technicalInformation', 'blocker', 'description'] as const;

export function blankPlaceholders(opportunity: Opportunity, placeholders: readonly string[]): Opportunity {
  const fields = ['decisionnaires', ...TEXT_FIELDS] as const;
  return fields.reduce<Opportunity>((result, field) => isPlaceholder(result[field], placeholders) ? { ...result, [field]: '' } : result, opportunity);
}

export function opportunitySources(opportunity: Opportunity): readonly SourceText[] {
  const fields = [...TEXT_FIELDS, 'decisionnaires'] as const;
  return fields.filter((field) => opportunity[field].trim() !== '').map((field) => ({ id: field, label: field, createdAt: null, text: opportunity[field] }));
}

export const missingItem = { status: 'missing', value: null, evidence: null } as const;

function volumeValue(min: number, max: number): string {
  return min === max ? String(min) : `${min}-${max}`;
}

export function mergeQualification(opportunity: Opportunity, extraction: QualificationExtraction): { qualification: QualificationFacts; noteFacts: NoteFacts } {
  const hostingValue = opportunity.hosting.join(', ');
  const decisionMakerValue = opportunity.decisionnaires.trim();
  const volume = extraction.volume === null || extraction.volume.unitIsClmManagedCerts
    ? extraction.volume
    : { ...extraction.volume, unclear: true };
  const volumeItem = volume !== null
    ? { status: 'known' as const, value: volumeValue(volume.min, volume.max), evidence: volume.evidence }
    : extraction.items.volume.status === 'declared_unobtainable' ? extraction.items.volume : missingItem;
  return {
    qualification: {
      items: {
        ...extraction.items,
        volume: volumeItem,
        hosting: hostingValue === '' ? extraction.items.hosting : { status: 'known', value: hostingValue, evidence: { sourceId: 'hosting', quote: hostingValue } },
        decisionMaker: decisionMakerValue === '' ? extraction.items.decisionMaker : { status: 'known', value: decisionMakerValue, evidence: { sourceId: 'decisionnaires', quote: decisionMakerValue } },
      },
      volume,
      solutionIncludesClm: extraction.items.solution.status === 'known' ? extraction.solutionIncludesClm : null,
    },
    noteFacts: {
      discoveryEvidence: extraction.discoveryEvidence,
      pocQuoteExpectedEvidence: extraction.pocQuoteExpectedEvidence,
      approverException: extraction.approverException,
      partnerNamed: extraction.partnerNamed,
    },
  };
}
