import { buildMemoryKeyDescriptors, deterministicMap, matchField, type AIField } from '@contextfill/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_FACTS } from './helpers';

const keys = buildMemoryKeyDescriptors(DEMO_FACTS);
const f = (label: string, type: AIField['type'] = 'text', hint = ''): AIField => ({ id: 'f_matcher01', label, type, hint, options: [], section: '', required: false });

describe('semantic field matching (deterministic engine)', () => {
  it.each([
    ['Full Name', 'full_name'],
    ['Your name', 'full_name'],
    ['Applicant Name', 'full_name'],
    ['Email Address', 'email'],
    ['Contact E-mail', 'email'],
    ['College Name', 'college'],
    ['Educational Institution', 'college'],
    ['University', 'college'],
    ['Developer Repository', 'github_url'],
    ['GitHub Profile', 'github_url'],
    ['Portfolio / Personal Website', 'portfolio_url'],
    ['Highest Qualification', 'degree'],
    ['Technologies you know', 'skills'],
    ['Expected Graduation Year', 'graduation_year'],
    ['Year of Passing', 'graduation_year'],
  ])('"%s" -> %s', (label, key) => {
    const m = matchField(f(label), keys);
    expect(m.action).toBe('use_memory');
    expect(m.memoryKey).toBe(key);
  });

  it('splits names with transforms', () => {
    expect(matchField(f('First name'), keys)).toMatchObject({ memoryKey: 'full_name', transform: 'first_name' });
    expect(matchField(f('Surname'), keys)).toMatchObject({ memoryKey: 'full_name', transform: 'last_name' });
  });

  it('does not treat "Team Name" or "Company name" as the person', () => {
    expect(matchField(f('Team Name'), keys).action).toBe('ask_user');
    expect(matchField(f('Company name'), keys).memoryKey).not.toBe('full_name');
  });

  it('uses the name hint when the label is vague', () => {
    expect(matchField(f('Link', 'url', 'applicant github'), keys).memoryKey).toBe('github_url');
  });

  it('open-ended questions become drafts', () => {
    expect(matchField(f('Why do you want to join HackFest?', 'textarea'), keys).action).toBe('draft');
  });

  it('unknown fields ask the user', () => {
    expect(matchField(f('T-shirt size'), keys)).toMatchObject({ action: 'ask_user', memoryKey: null });
  });

  it('produces one mapping per field in schema shape', () => {
    const res = deterministicMap({ fields: [f('Full Name'), { ...f('Email'), id: 'f_matcher02' }], availableMemoryKeys: keys });
    expect(res.mappings.map((m) => m.fieldId)).toEqual(['f_matcher01', 'f_matcher02']);
  });
});
