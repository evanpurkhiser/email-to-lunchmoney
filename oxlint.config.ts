import {common} from '@evanpurkhiser/oxc-config/oxlint';
import {defineConfig} from 'oxlint';

export default defineConfig({
  extends: [common],
  overrides: [
    {
      files: ['google-app-script/**/*.ts'],
      rules: {'no-unused-vars': 'off'},
    },
  ],
});
