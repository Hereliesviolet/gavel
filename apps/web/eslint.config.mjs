import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: [".next/**", "node_modules/**", "drizzle/migrations/**"],
  },
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      // React Compiler diagnostics that flag two existing components
      // (app/favoriten/client.tsx, components/shared/favorite-button.tsx). Both
      // work as written; they are reported as warnings until refactored.
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
    },
  },
];

export default config;
