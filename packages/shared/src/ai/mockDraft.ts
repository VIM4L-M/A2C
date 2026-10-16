import type { DraftRequest, DraftResponse } from '../schemas';

/**
 * Deterministic MOCK draft. Not AI: it stitches approved facts into neutral
 * sentences and never adds information that is not in the facts.
 */
export function mockDraft(request: DraftRequest): DraftResponse {
  const facts = new Map(request.facts.map((f) => [f.key, f.value.trim()]));
  const used: string[] = [];
  const take = (key: string) => {
    const v = facts.get(key);
    if (v) used.push(key);
    return v;
  };

  const sentences: string[] = [];
  const degree = take('degree');
  const major = take('major');
  const college = take('college');
  const year = take('graduation_year');
  if (degree || college) {
    const study = [degree, major ? `in ${major}` : ''].filter(Boolean).join(' ');
    sentences.push(
      `I am ${study ? `pursuing ${study}` : 'a student'}${college ? ` at ${college}` : ''}${year ? `, graduating in ${year}` : ''}.`,
    );
  }
  const role = take('current_role');
  if (role) sentences.push(`I currently work as ${role}.`);
  const skills = take('skills');
  if (skills) sentences.push(`My main skills include ${skills}.`);
  const bio = take('bio');
  if (bio) sentences.push(bio);
  const github = take('github_url');
  if (github) sentences.push(`You can see my work at ${github}.`);

  const missingFacts: string[] = [];
  if (sentences.length === 0) missingFacts.push('No approved facts were provided');
  missingFacts.push('Your personal motivation for this specific question');

  const max = request.maxLength ?? 800;
  let draft = sentences.join(' ');
  if (draft.length > max) draft = `${draft.slice(0, max - 3)}...`;
  return { draft, usedKeys: used, missingFacts };
}
