import next from 'eslint-config-next';

// A plain date glued to a UTC midnight or end of day (`${day}T00:00:00.000Z`)
// is the site's day boundary only when the site is in UTC, which no Nordic site
// is. That is how classes, errors and seed cut-offs landed on the wrong day
// (BCPLA-18, BCPLA-20). A midday UTC time falls on the same Nordic day, so seed
// timestamps such as T10:00 are left alone, and so are site-local times with an
// offset (`T00:00:00+02:00`) or bare wall-clock times (`T23:14:07`): only a `Z`
// marks UTC.
const UTC_DAY = {
  selector: 'TemplateElement[value.raw=/^T(?:00|23):[0-9:.]*Z/]',
  message:
    'A plain date with a UTC time is not the site-local day. Use startOfDay(day, timezone) or localDay(at, timezone) from src/domain/dates.ts.',
};

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'data/**',
      'src/db/migrations/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...next,
  {
    // Merged into the design-token block below for .tsx files under src/app:
    // a later block's no-restricted-syntax replaces this one, never adds to it.
    files: ['src/**/*.ts', 'src/**/*.tsx', 'scripts/**/*.ts'],
    ignores: ['src/domain/dates.ts'],
    rules: { 'no-restricted-syntax': ['error', UTC_DAY] },
  },
  {
    // Design tokens are the only source of colour, type, spacing and radius.
    // An arbitrary value or a raw hex here is drift: it renders correctly and is
    // invisible to the Figma library, so the two diverge silently. Add a token
    // in src/app/globals.css instead, then use its class.
    // Structural arbitraries (grid-cols-[auto_1fr] and friends) are not tokens
    // and are deliberately not matched.
    files: ['src/components/**/*.tsx', 'src/app/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Literal[value=/(?:^|\\s)(?:text|bg|border|fill|stroke|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|w|h|min-w|min-h|max-w|max-h|rounded|leading|tracking)-\\[/]",
          message:
            'Arbitrary Tailwind value. Add a token in src/app/globals.css and use its class.',
        },
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'Raw hex colour. Use a colour token from src/app/globals.css.',
        },
        {
          selector:
            "Literal[value=/(?:^|\\s)(?:bg|text|border|fill|stroke|ring|divide|outline|shadow)-(?:ink|ink-muted|line|surface|surface-raised|accent|accent-soft|good|warn|bad)(?:-[a-z-]+)?\\/[0-9]+/]",
          message:
            'Alpha modifier on a colour token. Figma variables cannot alias a colour with a new alpha. Add an explicit tint token instead.',
        },
        UTC_DAY,
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'off',
      'import/no-anonymous-default-export': 'off',
    },
  },
  {
    // Playwright best practice: an un-awaited action or assertion passes silently.
    files: ['tests/e2e/**/*.ts'],
    languageOptions: { parserOptions: { project: './tests/e2e/tsconfig.json', tsconfigRootDir: import.meta.dirname } },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
];

export default config;
