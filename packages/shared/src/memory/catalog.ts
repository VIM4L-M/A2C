import type { FieldKind, MemoryCategory, MemoryPermission, MemorySensitivity } from '../types';

/**
 * Known memory attributes. The model only ever sees `key` + `description`;
 * values are resolved locally. Synonyms drive the deterministic matcher.
 */
export interface CatalogEntry {
  key: string;
  label: string;
  description: string;
  category: MemoryCategory;
  sensitivity: MemorySensitivity;
  defaultPermission: MemoryPermission;
  /** Normalized phrases (see normalizeText) that strongly indicate this key. */
  synonyms: string[];
  autocomplete?: string[];
  preferredKinds?: FieldKind[];
  /** Values are lists (e.g. skills) that can match checkbox groups. */
  list?: boolean;
}

export const MEMORY_CATALOG: CatalogEntry[] = [
  {
    key: 'full_name',
    label: 'Full name',
    description: 'Person full name',
    category: 'identity',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: ['full name', 'your name', 'applicant name', 'candidate name', 'participant name', 'student name', 'legal name', 'name'],
    autocomplete: ['name'],
  },
  {
    key: 'preferred_name',
    label: 'Preferred name',
    description: 'Name the person prefers to be called',
    category: 'identity',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: ['preferred name', 'nickname', 'display name', 'what should we call you'],
    autocomplete: ['nickname'],
  },
  {
    key: 'email',
    label: 'Email',
    description: 'Primary contact email address',
    category: 'contact',
    sensitivity: 'standard',
    defaultPermission: 'ask',
    synonyms: ['email', 'e mail', 'email address', 'mail id', 'contact email', 'work email'],
    autocomplete: ['email'],
    preferredKinds: ['email'],
  },
  {
    key: 'phone',
    label: 'Phone',
    description: 'Contact phone number',
    category: 'contact',
    sensitivity: 'private',
    defaultPermission: 'ask',
    synonyms: ['phone', 'phone number', 'mobile', 'mobile number', 'cell', 'telephone', 'contact number', 'whatsapp'],
    autocomplete: ['tel', 'tel-national'],
    preferredKinds: ['tel'],
  },
  {
    key: 'city',
    label: 'City',
    description: 'City of residence',
    category: 'contact',
    sensitivity: 'private',
    defaultPermission: 'ask',
    synonyms: ['city', 'town', 'current city', 'city of residence', 'location'],
    autocomplete: ['address-level2'],
  },
  {
    key: 'country',
    label: 'Country',
    description: 'Country of residence',
    category: 'contact',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: ['country', 'country of residence', 'nation'],
    autocomplete: ['country', 'country-name'],
  },
  {
    key: 'college',
    label: 'College / University',
    description: 'Current or most recent educational institution',
    category: 'education',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: [
      'college',
      'college name',
      'university',
      'university name',
      'institution',
      'educational institution',
      'institute',
      'school',
      'school name',
      'alma mater',
      'academic institution',
      'where do you study',
    ],
  },
  {
    key: 'degree',
    label: 'Degree',
    description: 'Degree being pursued or completed',
    category: 'education',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: ['degree', 'qualification', 'highest qualification', 'degree program', 'degree programme', 'level of study'],
  },
  {
    key: 'major',
    label: 'Major / Field of study',
    description: 'Field of study or specialization',
    category: 'education',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: ['major', 'field of study', 'specialization', 'specialisation', 'branch', 'discipline', 'stream'],
  },
  {
    key: 'graduation_year',
    label: 'Graduation year',
    description: 'Year of graduation (expected or completed)',
    category: 'education',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: [
      'graduation year',
      'year of graduation',
      'grad year',
      'expected graduation',
      'expected graduation year',
      'passing year',
      'year of passing',
      'batch',
      'class of',
      'when do you graduate',
    ],
  },
  {
    key: 'gpa',
    label: 'GPA / CGPA',
    description: 'Grade point average',
    category: 'education',
    sensitivity: 'private',
    defaultPermission: 'ask',
    synonyms: ['gpa', 'cgpa', 'grade point average', 'grades'],
  },
  {
    key: 'skills',
    label: 'Skills',
    description: 'Technical skills, comma separated',
    category: 'skills',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: [
      'skills',
      'technical skills',
      'technologies',
      'tech stack',
      'programming languages',
      'languages known',
      'expertise',
      'competencies',
      'tools',
      'frameworks',
      'technologies you know',
      'primary skills',
    ],
    list: true,
  },
  {
    key: 'github_url',
    label: 'GitHub URL',
    description: 'Public developer profile / code repository URL',
    category: 'links',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: ['github', 'git hub', 'github url', 'github profile', 'developer repository', 'code repository', 'repository', 'source code profile', 'repo'],
    preferredKinds: ['url', 'text'],
  },
  {
    key: 'linkedin_url',
    label: 'LinkedIn URL',
    description: 'Public LinkedIn profile URL',
    category: 'links',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: ['linkedin', 'linked in', 'linkedin profile', 'professional network profile'],
    preferredKinds: ['url', 'text'],
  },
  {
    key: 'portfolio_url',
    label: 'Portfolio URL',
    description: 'Personal website or portfolio URL',
    category: 'links',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: ['portfolio', 'personal website', 'website', 'homepage', 'personal site', 'blog', 'portfolio url', 'personal url'],
    autocomplete: ['url'],
    preferredKinds: ['url', 'text'],
  },
  {
    key: 'current_role',
    label: 'Current role',
    description: 'Current job title or role',
    category: 'work',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: ['current role', 'job title', 'current job title', 'designation', 'current position', 'occupation'],
    autocomplete: ['organization-title'],
  },
  {
    key: 'years_experience',
    label: 'Years of experience',
    description: 'Total years of professional experience',
    category: 'work',
    sensitivity: 'standard',
    defaultPermission: 'auto',
    synonyms: ['years of experience', 'experience years', 'total experience', 'work experience years', 'experience'],
  },
  {
    key: 'bio',
    label: 'Short bio',
    description: 'Short professional summary written by the person (used only for drafts)',
    category: 'other',
    sensitivity: 'standard',
    defaultPermission: 'ask',
    synonyms: ['bio', 'short bio', 'about me', 'summary', 'professional summary'],
    preferredKinds: ['textarea'],
  },
  {
    key: 'date_of_birth',
    label: 'Date of birth',
    description: 'Date of birth (YYYY-MM-DD)',
    category: 'identity',
    sensitivity: 'private',
    defaultPermission: 'ask',
    synonyms: ['date of birth', 'dob', 'birth date', 'birthday'],
    autocomplete: ['bday'],
    preferredKinds: ['date'],
  },
];

const BY_KEY = new Map(MEMORY_CATALOG.map((e) => [e.key, e]));

export function catalogEntry(key: string): CatalogEntry | undefined {
  return BY_KEY.get(key);
}
