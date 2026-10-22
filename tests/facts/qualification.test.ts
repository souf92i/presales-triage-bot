import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config.js';
import { blankPlaceholders, mergeQualification, opportunitySources } from '../../src/facts/qualification.js';
import type { Opportunity, QualificationExtraction } from '../../src/domain/types.js';

const opportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({ id: 'opp', companyId: null, dealtype: null, typeOfNegotiation: null, hosting: [], decisionnaires: '', besoin: '', technicalInformation: '', blocker: '', description: '', salesChannel: null, hasActualPartner: false, dataQualityMissing: '', ...overrides });
const missing = { status: 'missing', value: null, evidence: null } as const;
const extraction = (): QualificationExtraction => ({ items: { volume: missing, hosting: missing, solution: missing, decisionMaker: { status: 'known', value: 'LLM', evidence: { sourceId: 'ticket', quote: 'LLM' } }, budget: missing, timeline: missing, currentPki: missing, useCases: missing, clmDriver: missing }, volume: null, solutionIncludesClm: null, discoveryEvidence: null, pocQuoteExpectedEvidence: null, approverException: null, partnerNamed: null });

describe('qualification merge', () => {
  it('blanks placeholder text fields', () => expect(blankPlaceholders(opportunity({ decisionnaires: 'TBD', besoin: 'xxx' }), defaultConfig().placeholderValues)).toMatchObject({ decisionnaires: '', besoin: '' }));
  it('fields win for hosting and decisionMaker', () => {
    const result = mergeQualification(opportunity({ hosting: ['SaaS', 'EU'], decisionnaires: ' Jane ' }), extraction()).qualification.items;
    expect(result.hosting).toMatchObject({ status: 'known', value: 'SaaS, EU' });
    expect(result.decisionMaker).toMatchObject({ status: 'known', value: 'Jane' });
  });
  it('blank decisionnaires falls back to the LLM item', () => expect(mergeQualification(opportunity(), extraction()).qualification.items.decisionMaker.value).toBe('LLM'));
  it('volume item follows the volume fact', () => {
    const input = { ...extraction(), volume: { min: 10, max: 20, unitIsClmManagedCerts: false, unclear: false, evidence: { sourceId: 'ticket', quote: '10-20' } } };
    expect(mergeQualification(opportunity(), input).qualification.items.volume).toMatchObject({ status: 'known', value: '10-20' });
  });
  it('uses the CLM extraction only when the solution is known', () => {
    const missingSolution = mergeQualification(opportunity(), { ...extraction(), solutionIncludesClm: false }).qualification;
    const knownSolution = mergeQualification(opportunity(), { ...extraction(), items: { ...extraction().items, solution: { status: 'known', value: 'PKI', evidence: { sourceId: 'ticket', quote: 'PKI' } } }, solutionIncludesClm: false }).qualification;
    expect(missingSolution.solutionIncludesClm).toBeNull();
    expect(knownSolution.solutionIncludesClm).toBe(false);
  });
  it('marks a non-CLM certificate unit as unclear', () => {
    const input = { ...extraction(), volume: { min: 150, max: 150, unitIsClmManagedCerts: false, unclear: false, evidence: { sourceId: 'ticket', quote: '150 holders' } } };
    expect(mergeQualification(opportunity(), input).qualification.volume).toMatchObject({ unclear: true });
  });
  it('opportunitySources skips empty fields', () => expect(opportunitySources(opportunity({ besoin: 'Need', decisionnaires: 'Jane' })).map(({ id }) => id)).toEqual(['besoin', 'decisionnaires']));
});
