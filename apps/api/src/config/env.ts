import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Look for .env in current working dir, repo root, or ../../.env
const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
];

for (const envPath of candidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive().max(65535))
    .default('4000'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_AUDIENCE: z.string().min(1),
  KEYCLOAK_JWKS_URI: z.string().url().optional(),
  HOST: z.string().min(1).default('0.0.0.0'),
  METRICS_TOKEN_FILE: z.string().min(1).default('./.secrets/paypilot_metrics_token'),
});

// __dirname is apps/api/src/config in development and apps/api/dist/config in
// production builds. Four levels up is the repository root in both cases.
export const REPO_ROOT = path.resolve(__dirname, '../../../..');

export function resolveRepoPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(REPO_ROOT, filePath);
}

export type Config = z.infer<typeof envSchema>;

let config: Config;

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  if (process.env.NODE_ENV === 'test') {
    config = {
      NODE_ENV: 'test',
      PORT: 4000,
      CORS_ORIGIN: 'http://localhost:5173',
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://paypilot_app:paypilot_app@localhost:5433/paypilot?schema=public',
      KEYCLOAK_ISSUER:
        process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8080/realms/paypilot',
      KEYCLOAK_AUDIENCE: process.env.KEYCLOAK_AUDIENCE ?? 'paypilot-api',
      KEYCLOAK_JWKS_URI: process.env.KEYCLOAK_JWKS_URI,
      HOST: process.env.HOST ?? '0.0.0.0',
      METRICS_TOKEN_FILE:
        process.env.METRICS_TOKEN_FILE ?? './.secrets/paypilot_metrics_token',
    };
  } else {
    console.error('❌ Invalid environment configuration:', parsedEnv.error.format());
    process.exit(1);
  }
} else {
  config = parsedEnv.data;
}

export { config };
