import { describe, expect, it } from 'vitest';

import { resolveCrmLink } from '../src/crm-link.js';

describe('CRM link resolution', () => {
  it('resolves an opportunity link for an end customer', () => {
    expect(resolveCrmLink(
      'https://crm.evertrust.internal/object/opportunity/2341bae4-2621-4cf5-b5f3-ffe7ae25362d',
      ['End customer'],
    )).toEqual({ kind: 'opportunity', id: '2341bae4-2621-4cf5-b5f3-ffe7ae25362d' });
  });

  it('resolves an opportunity link with a fragment', () => {
    expect(resolveCrmLink(
      'https://crm.evertrust.internal/object/opportunity/2341bae4-2621-4cf5-b5f3-ffe7ae25362d#notes',
      ['End customer'],
    )).toEqual({ kind: 'opportunity', id: '2341bae4-2621-4cf5-b5f3-ffe7ae25362d' });
  });

  it('lowercases an opportunity id', () => {
    expect(resolveCrmLink(
      'https://crm.evertrust.internal/object/opportunity/797DB51C-36BD-5669-9966-AE08D78F1E77',
      ['End customer'],
    )).toEqual({ kind: 'opportunity', id: '797db51c-36bd-5669-9966-ae08d78f1e77' });
  });

  it('resolves a company link for a partner-only target', () => {
    expect(resolveCrmLink(
      'https://crm.evertrust.internal/object/company/aa561e6f-d166-5576-93ef-a4cada04a352',
      ['Partner'],
    )).toEqual({ kind: 'company', id: 'aa561e6f-d166-5576-93ef-a4cada04a352' });
  });

  it('rejects a company link for mixed targets', () => {
    const raw = 'https://crm.evertrust.internal/object/company/aa561e6f-d166-5576-93ef-a4cada04a352';
    expect(resolveCrmLink(raw, ['End customer', 'Partner'])).toEqual({ kind: 'invalid', raw });
  });

  it('rejects a company link for an empty target', () => {
    const raw = 'https://crm.evertrust.internal/object/company/aa561e6f-d166-5576-93ef-a4cada04a352';
    expect(resolveCrmLink(raw, [])).toEqual({ kind: 'invalid', raw });
  });

  it('rejects a collection opportunities URL', () => {
    const raw = 'https://crm.evertrust.internal/objects/opportunities?viewId=47dd53b2-27a6-45d1-a0aa-5e1b1fc05259';
    expect(resolveCrmLink(raw, ['End customer'])).toEqual({ kind: 'invalid', raw });
  });

  it('rejects a HubSpot URL', () => {
    const raw = 'https://app.hubspot.com/contacts/123/deal/456';
    expect(resolveCrmLink(raw, ['End customer'])).toEqual({ kind: 'invalid', raw });
  });

  it('rejects a SharePoint URL', () => {
    const raw = 'https://evertrustfr.sharepoint.com/:f:/s/Intranet/abc';
    expect(resolveCrmLink(raw, ['End customer'])).toEqual({ kind: 'invalid', raw });
  });

  it('preserves an empty raw value when invalid', () => {
    expect(resolveCrmLink('', ['Partner'])).toEqual({ kind: 'invalid', raw: '' });
  });

  it('rejects an HTTP CRM link', () => {
    const raw = 'http://crm.evertrust.internal/object/opportunity/2341bae4-2621-4cf5-b5f3-ffe7ae25362d';
    expect(resolveCrmLink(raw, ['End customer'])).toEqual({ kind: 'invalid', raw });
  });
});
