import next from 'eslint-config-next';

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
];

export default config;
