import {
  defineWorkersProject,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers/config';
import path from 'node:path';

export default defineWorkersProject(async () => {
  // Read all migrations in the `migrations` directory
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: {configPath: './wrangler.jsonc'},
          miniflare: {
            // Add a test-only binding for migrations, so we can apply them in a setup file
            bindings: {
              TEST_MIGRATIONS: migrations,
              INGEST_TOKEN: 'test-token-12345',
            },
          },
        },
      },
    },
  };
});
