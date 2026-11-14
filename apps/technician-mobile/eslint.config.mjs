import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

const rawDesignValue = String.raw`#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(|(?:linear|radial|conic)-gradient\(`;
const spacingStyleProperty =
  '^(padding|paddingTop|paddingRight|paddingBottom|paddingLeft|paddingHorizontal|paddingVertical|margin|marginTop|marginRight|marginBottom|marginLeft|marginHorizontal|marginVertical|gap|rowGap|columnGap|fontSize|borderRadius)$';

export default [
  { ignores: ['node_modules/**', 'dist/**', '.expo/**', 'android/**', 'ios/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      'no-debugger': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${rawDesignValue}/]`,
          message: 'Use a semantic mobile token instead of a raw color or gradient.',
        },
        {
          selector: `TemplateElement[value.raw=/${rawDesignValue}/]`,
          message: 'Use a semantic mobile token instead of a raw color or gradient.',
        },
        {
          selector: `JSXAttribute[name.name='style'] ObjectExpression > Property[key.name=/${spacingStyleProperty}/] > Literal[value=/\\d/]`,
          message: 'Inline spacing, type, and radius values must come from a mobile token.',
        },
      ],
    },
  },
  {
    files: ['src/ui/palette.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
