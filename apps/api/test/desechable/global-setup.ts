import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

// PRUEBAS DE INTEGRACIÓN DEL GESTOR DOCUMENTAL CONTRA UNA INSTANCIA POSTGRESQL DESECHABLE (nunca TEST ni PROD).
//
// Levanta un contenedor temporal postgres:18-alpine ligado SOLO a 127.0.0.1:55434 (sin volúmenes), crea la réplica mínima de los objetos de TEST y aplica el UP REAL de la migración
// `manufactura` (el mismo archivo que revisará el operador). Host, puerto, usuario y contraseña están FIJOS aquí y en `entorno.ts`: este arnés no lee `DATABASE_*` ni `TEST_DATABASE_URL`, así que
// no puede conectarse a `daubert_hub_test` ni a `daubert_global`. Al terminar elimina el contenedor.
export const CONTENEDOR = 'daubert-scratch-pg-documentos';
export const PUERTO = 55434;
const IMAGEN = 'postgres:18-alpine';
const RAIZ = resolve(__dirname, '..', '..', '..', '..');
const MIGRACIONES = join(RAIZ, 'database', 'migrations', 'daubert_hub_test');
const PREFIJO = '20261030_101_manufactura_gestor_documental_test';
const PREFIJO_102 = '20261103_102_manufactura_responsables_firmas_test';
const PREFIJO_103 = '20261105_103_manufactura_inventario_firmas_admin_test';
const PREFIJO_104 = '20261106_104_manufactura_cliente_abreviaturas_test';
const PREFIJO_105 = '20261107_105_manufactura_consulta_compartida_borradores_test';

const docker = (args: string[]) => spawnSync('docker', args, { encoding: 'utf8' });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function psql(archivo: string): void {
  const r = docker(['exec', '-e', 'PGPASSWORD=scratch', CONTENEDOR, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', archivo === 'init.sql' ? 'postgres' : 'daubert_hub_test', '-X', '-v', 'ON_ERROR_STOP=1', '-f', `/tmp/${archivo}`]);
  if (r.status !== 0) throw new Error(`psql ${archivo} falló: ${r.stderr}`);
}

export async function setup(): Promise<void> {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) throw new Error('Docker no está disponible: las pruebas con instancia desechable lo requieren.');
  docker(['rm', '-f', CONTENEDOR]);
  const run = docker(['run', '-d', '--rm', '--name', CONTENEDOR, '-e', 'POSTGRES_PASSWORD=scratch', '-p', `127.0.0.1:${PUERTO}:5432`, IMAGEN]);
  if (run.status !== 0) throw new Error(`No se pudo iniciar la instancia desechable: ${run.stderr}`);
  try {
    for (let i = 0; i < 80; i += 1) { if (docker(['exec', CONTENEDOR, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).status === 0) break; await esperar(500); }
    await esperar(1500);
    const { INIT } = createRequire(__filename)(join(MIGRACIONES, 'tools', 'instancia-desechable.cjs')) as { INIT: string };
    const tmp = mkdtempSync(join(tmpdir(), 'doc-desechable-'));
    try {
      writeFileSync(join(tmp, 'init.sql'), INIT);
      copyFileSync(join(MIGRACIONES, `${PREFIJO}.up.sql`), join(tmp, 'up.sql'));
      copyFileSync(join(MIGRACIONES, `${PREFIJO_102}.up.sql`), join(tmp, 'up102.sql'));
      copyFileSync(join(MIGRACIONES, `${PREFIJO_103}.up.sql`), join(tmp, 'up103.sql'));
      copyFileSync(join(MIGRACIONES, `${PREFIJO_104}.up.sql`), join(tmp, 'up104.sql'));
      copyFileSync(join(MIGRACIONES, `${PREFIJO_105}.up.sql`), join(tmp, 'up105.sql'));
      for (const f of ['init.sql', 'up.sql', 'up102.sql', 'up103.sql', 'up104.sql', 'up105.sql']) docker(['cp', join(tmp, f), `${CONTENEDOR}:/tmp/${f}`]);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
    psql('init.sql');
    psql('up.sql');
    psql('up102.sql');
    psql('up103.sql');
    psql('up104.sql');
    psql('up105.sql');
  } catch (error) {
    docker(['rm', '-f', CONTENEDOR]);
    throw error;
  }
}

export async function teardown(): Promise<void> {
  docker(['rm', '-f', CONTENEDOR]);
}
