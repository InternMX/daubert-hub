import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { SafeExceptionFilter } from './common/http-exception.filter';
import type { EnvironmentConfig } from './config/environment';
import { createGlobalValidationPipe } from './config/validation-pipe';
import { detectContainer, ProductionDatabaseGuardError, verifyDatabaseBeforeListening } from './config/production-database-guard';
import { DatabaseService } from './database/database.service';

// Mandatory startup guard (independent of the npm launcher), awaited BEFORE app.listen(): a
// non-production process refuses daubert_global — both the configured DB_NAME/DB_USER and the
// database the connection really reached (read-only SELECT current_database()). In the real
// PRODUCTION container (NODE_ENV=production + container marker) nothing new happens. The opt-in
// EXPECTED_DATABASE_NAME from the safe dev launcher keeps applying in every runtime. Messages carry
// names only, never credentials. See config/production-database-guard.ts.
async function assertDatabaseSafeBeforeListening(app: Awaited<ReturnType<typeof NestFactory.create>>): Promise<void> {
  const logger = new Logger('Bootstrap');
  const configured = app.get(ConfigService<EnvironmentConfig, true>).get('database', { infer: true });
  const database = app.get(DatabaseService);
  let liveDatabaseName: string | undefined;
  try {
    ({ liveDatabaseName } = await verifyDatabaseBeforeListening(database, {
      configured: { name: configured.name, user: configured.user },
      runtime: { nodeEnv: process.env.NODE_ENV, inContainer: detectContainer() },
      expectedDatabaseName: process.env.EXPECTED_DATABASE_NAME
    }));
  } catch (error) {
    // Known guard errors are safe by construction; anything unexpected is not echoed.
    const known = error instanceof ProductionDatabaseGuardError || (error instanceof Error && error.message.startsWith('Refusing to start'));
    logger.error(known ? (error as Error).message : 'Refusing to start: could not verify the live database.');
    await app.close();
    process.exit(1);
  }
  logger.log(liveDatabaseName ? `Live database guard passed: connected to "${liveDatabaseName}".` : 'Database guard: production runtime, no additional check required.');
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // The API only ever returns JSON (no HTML views), so a locked-down,
  // no-inline-anything CSP is safe here — it's not fighting a real frontend
  // render path. HSTS stays off: current deployment is local HTTP TEST
  // behind a Cloudflare Quick Tunnel/Nginx, not HTTPS end-to-end at this
  // API; forcing HSTS here would be a lie about the transport and could
  // stick in browsers past the tunnel's lifetime. Revisit once the API is
  // deployed behind real, permanent TLS (see Phase 8B).
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: false
  }));
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new SafeExceptionFilter());

  await assertDatabaseSafeBeforeListening(app);

  const config = app.get(ConfigService<EnvironmentConfig, true>);
  const port = config.get('apiPort', { infer: true });
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on port ${port}`);
}

void bootstrap();
