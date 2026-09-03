import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { QueryResultRow } from 'pg';
import { AppModule } from './app.module';
import { SafeExceptionFilter } from './common/http-exception.filter';
import type { EnvironmentConfig } from './config/environment';
import { assertLiveDatabaseMatches } from './config/live-database-guard';
import { DatabaseService } from './database/database.service';

interface CurrentDatabaseRow extends QueryResultRow {
  database_name: string;
}

// Opt-in, dev-only live guard: the safe local-development launcher (scripts/dev-test-only.cjs
// at the repo root) is the only thing that sets EXPECTED_DATABASE_NAME. It is absent in Docker
// TEST/PROD and in the integration runners, so this is a no-op there — parsing the connection
// URL is not enough on its own, this confirms the live connection actually landed on the
// intended database before the API starts serving traffic.
async function assertExpectedDatabaseIfConfigured(app: Awaited<ReturnType<typeof NestFactory.create>>): Promise<void> {
  const expected = process.env.EXPECTED_DATABASE_NAME?.trim();
  if (!expected) return;

  const logger = new Logger('Bootstrap');
  const database = app.get(DatabaseService);
  let actual: string | undefined;
  try {
    const [row] = await database.query<CurrentDatabaseRow>('SELECT current_database() AS database_name');
    actual = row?.database_name;
    assertLiveDatabaseMatches(actual, expected);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : 'Refusing to start: could not verify the live database.');
    await app.close();
    process.exit(1);
  }
  logger.log(`Live database guard passed: connected to "${actual}".`);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new SafeExceptionFilter());

  await assertExpectedDatabaseIfConfigured(app);

  const config = app.get(ConfigService<EnvironmentConfig, true>);
  const port = config.get('apiPort', { infer: true });
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on port ${port}`);
}

void bootstrap();
