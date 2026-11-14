import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";

const rawDesignValue = String.raw`#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(|(?:linear|radial|conic)-gradient\(`;
const spacingStyleProperty =
  "^(padding|paddingTop|paddingRight|paddingBottom|paddingLeft|paddingInline|paddingBlock|margin|marginTop|marginRight|marginBottom|marginLeft|marginInline|marginBlock|gap|rowGap|columnGap|fontSize|borderRadius)$";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: {
      "no-debugger": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=/${rawDesignValue}/]`,
          message:
            "Use a semantic design token instead of a raw color or gradient.",
        },
        {
          selector: `TemplateElement[value.raw=/${rawDesignValue}/]`,
          message:
            "Use a semantic design token instead of a raw color or gradient.",
        },
        {
          selector: `JSXAttribute[name.name="style"] ObjectExpression > Property[key.name=/${spacingStyleProperty}/] > Literal[value=/\\d/]`,
          message:
            "Inline spacing, type, and radius values must come from a design token.",
        },
      ],
    },
  },
  {
    files: ["src/design-system/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["src/test/**/*", "e2e/**/*"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];
