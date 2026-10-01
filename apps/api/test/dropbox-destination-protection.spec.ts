import { describe, expect, it, vi } from 'vitest';
import {
  buildPaymentDestinationPath,
  DEFAULT_PAYMENT_DESTINATION_PATH,
  DropboxPathError,
  resolveDestinationAfterDropboxChange
} from '../src/payment-notification-settings/dropbox-path';
import { syncPaymentNotificationDestination } from '../src/payment-notification-settings/payment-notification-settings.repository';
import { ProvidersRepository } from '../src/providers/providers.repository';

// P1 (audit): historical companies store their own ruta_destino template. Changing ruta_dropbox must move
// ONLY the prefix and keep the stored sub-path byte for byte; the standard pattern is regenerated only when
// the stored value IS the standard pattern. Synthetic paths only: no real company appears here.

const identity = { userId: null, userEmail: null };
const PREVIOUS = 'PROVEEDORES/SYNTH ALFA';
const NEXT = 'PROVEEDORES/SYNTH BETA';
const PREVIOUS_BS = 'PROVEEDORES\\SYNTH ALFA';
const NEXT_BS = 'PROVEEDORES\\SYNTH BETA';
const standard = (path: string | null) => buildPaymentDestinationPath(path);

// Representative sub-paths of the historical shapes found in the audit (company-independent).
const HISTORICAL_SUBPATHS = [
  'PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NOMBRE_TITULO}',
  'PAGOS\\NOTIFICACIONES DE PAGO\\{MES_NOMBRE_TITULO}',
  'PAGOS\\{ANIO}\\NOTIFICACIONES DE PAGO\\{MES_NOMBRE_TITULO}',
  'PAGOS\\NOTIFICACION DE PAGOS\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}',
  'PAGOS\\Notificación de pagos\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}',
  '{ANIO}\\PAGOS\\NOTIFICACIONES DE PAGO\\{MES_NUM}.- {MES_NOMBRE_TITULO}',
  '{ANIO}\\PAGOS\\NOTIFICACIONES DE PAGO\\{MES_NOMBRE_TITULO}',
  'PAGOS\\NOTIFICACIO DE PAGO\\{ANIO}\\{MES_NOMBRE_TITULO}',
  'Notificacion\\{ANIO}\\{MES_NOMBRE_TITULO}',
  'PAGOS\\PAGO PROVEEDOR\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}',
  '{ANIO}\\PAGOS\\Notificación de pagos\\{MES_NUM}.- {MES_NOMBRE_TITULO}',
  'PAGOS\\NOTIFICACION DE PROVEEDOR\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}',
  'PAGOS\\{ANIO}\\COMPLEMENTOS DE PAGO\\{MES_NOMBRE_TITULO}',
  'PAGOS\\Notificación de pagos\\{ANIO}\\{MES_NOMBRE_TITULO}',
  'PAGOS\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}',
  '{ANIO}\\PAGOS\\{MES_NUM}.- {MES_NOMBRE_TITULO}',
  '{ANIO}\\Importaciones\\{MES_NUM}.- {MES_NOMBRE_TITULO}\\Cotización y pago'
];

function decide(previous: string | null, next: string | null, current: string | null) {
  return resolveDestinationAfterDropboxChange({ previousDropboxPath: previous, nextDropboxPath: next, currentDestination: current });
}

describe('resolveDestinationAfterDropboxChange', () => {
  it('NEW company (no stored destination): standard destination for the new path', () => {
    expect(decide(null, NEXT, null)).toEqual({ kind: 'NEW', destination: standard(NEXT) });
    expect(decide(null, NEXT, undefined as never).kind).toBe('NEW');
    expect(decide(null, NEXT, '   ').kind).toBe('NEW');
    expect(decide(null, null, null)).toEqual({ kind: 'NEW', destination: DEFAULT_PAYMENT_DESTINATION_PATH });
  });

  it('STANDARD destination: regenerated with the new prefix and the same standard pattern', () => {
    const result = decide(PREVIOUS, NEXT, standard(PREVIOUS));
    expect(result).toEqual({ kind: 'STANDARD', destination: `${NEXT_BS}\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}` });
    expect(result.destination).toBe(standard(NEXT));
  });

  it('STANDARD destination is also recognised when the stored previous path used backslashes or a trailing separator', () => {
    expect(decide('PROVEEDORES\\SYNTH ALFA\\', NEXT, standard(PREVIOUS)).kind).toBe('STANDARD');
  });

  it('STANDARD with no previous path (schema default) and a new path: standard for the new path', () => {
    expect(decide(null, NEXT, DEFAULT_PAYMENT_DESTINATION_PATH)).toEqual({ kind: 'STANDARD', destination: standard(NEXT) });
  });

  it('clearing the path on a STANDARD destination resets it to the schema default (as before)', () => {
    expect(decide(PREVIOUS, null, standard(PREVIOUS))).toEqual({ kind: 'STANDARD', destination: DEFAULT_PAYMENT_DESTINATION_PATH });
  });

  it.each(HISTORICAL_SUBPATHS.map((subpath) => [subpath]))('HISTORICAL destination keeps the sub-path verbatim and only swaps the prefix: %s', (subpath) => {
    const result = decide(PREVIOUS, NEXT, `${PREVIOUS_BS}\\${subpath}`);
    expect(result.kind).toBe('HISTORICAL');
    expect(result.destination).toBe(`${NEXT_BS}\\${subpath}`);
    expect(result.destination).not.toBe(standard(NEXT));
  });

  it('HISTORICAL sub-path is preserved exactly: inner spaces, casing, accents and trailing whitespace', () => {
    const subpath = 'pAgOs  Mixtos \\ {ANIO} \\Notificación DE pagos {MES_NOMBRE_TITULO} ';
    const result = decide(PREVIOUS, NEXT, `${PREVIOUS_BS}\\${subpath}`);
    expect(result.destination).toBe(`${NEXT_BS}\\${subpath}`);
    expect(result.destination!.endsWith(subpath)).toBe(true);
  });

  it('a destination that only differs from the standard in the spacing of the pattern is HISTORICAL (kept), not rewritten', () => {
    const withSpaces = `${PREVIOUS_BS}\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}. - {MES_NOMBRE_TITULO}`;
    const result = decide(PREVIOUS, NEXT, withSpaces);
    expect(result).toEqual({ kind: 'HISTORICAL', destination: `${NEXT_BS}\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}. - {MES_NOMBRE_TITULO}` });
  });

  it('the previous prefix is matched case-insensitively (Windows paths) but the sub-path keeps its own casing', () => {
    const result = decide('FLETES/ABC', 'FLETES/NUEVO', 'Fletes\\abc\\PAGO PROVEEDOR\\{ANIO}\\{MES_NOMBRE_TITULO}');
    expect(result).toEqual({ kind: 'HISTORICAL', destination: 'FLETES\\NUEVO\\PAGO PROVEEDOR\\{ANIO}\\{MES_NOMBRE_TITULO}' });
  });

  it('the new path is canonicalised like any other (either separator accepted)', () => {
    expect(decide(PREVIOUS, 'PROVEEDORES\\SYNTH BETA', `${PREVIOUS_BS}\\PAGO PROVEEDOR\\{ANIO}`).destination).toBe(`${NEXT_BS}\\PAGO PROVEEDOR\\{ANIO}`);
  });

  it('clearing the path on a HISTORICAL destination leaves it untouched (nothing is guessed)', () => {
    expect(decide(PREVIOUS, null, `${PREVIOUS_BS}\\PAGO PROVEEDOR\\{ANIO}`)).toEqual({ kind: 'HISTORICAL', destination: null });
  });

  it('UNRELATED destination (does not start with the previous path) is never overwritten', () => {
    expect(decide(PREVIOUS, NEXT, 'OTRA CARPETA\\PAGOS\\{ANIO}\\{MES_NOMBRE_TITULO}')).toEqual({ kind: 'UNRELATED', destination: null });
    expect(decide(PREVIOUS, null, 'OTRA CARPETA\\PAGOS\\{ANIO}')).toEqual({ kind: 'UNRELATED', destination: null });
  });

  it('the prefix must end on a whole folder: "A\\B" does not own "A\\BC\\x"', () => {
    expect(decide('FLETES/ABC', 'FLETES/NUEVO', 'FLETES\\ABCD\\PAGOS\\{ANIO}')).toEqual({ kind: 'UNRELATED', destination: null });
  });

  it('a stored destination equal to the previous path with nothing after it is not a sub-path: untouched', () => {
    expect(decide(PREVIOUS, NEXT, PREVIOUS_BS).kind).toBe('UNRELATED');
    expect(decide(PREVIOUS, NEXT, `${PREVIOUS_BS}\\`).kind).toBe('UNRELATED');
  });

  it('with no previous path, a custom stored destination cannot be attributed to any prefix: untouched', () => {
    expect(decide(null, NEXT, 'PAGO PROVEEDOR\\{ANIO}\\{MES_NOMBRE_TITULO}')).toEqual({ kind: 'UNRELATED', destination: null });
  });

  it('UNCHANGED path: the stored destination is left alone, whatever it is', () => {
    expect(decide(PREVIOUS, PREVIOUS, standard(PREVIOUS))).toEqual({ kind: 'UNCHANGED', destination: null });
    expect(decide(PREVIOUS, PREVIOUS, `${PREVIOUS_BS}\\PAGO PROVEEDOR\\{ANIO}`)).toEqual({ kind: 'UNCHANGED', destination: null });
    expect(decide(PREVIOUS, 'PROVEEDORES\\SYNTH ALFA', `${PREVIOUS_BS}\\X`).kind).toBe('UNCHANGED');
  });

  it('a legacy stored previous path is never validated, so it cannot make the decision throw', () => {
    expect(() => decide('  C:\\legado con {llaves}/ ', NEXT, 'lo que sea')).not.toThrow();
  });

  it('an invalid NEW path still fails exactly as before (DropboxPathError)', () => {
    expect(() => decide(PREVIOUS, 'C:\\FLETES', standard(PREVIOUS))).toThrow(DropboxPathError);
    expect(() => decide(PREVIOUS, '../x', standard(PREVIOUS))).toThrow(DropboxPathError);
  });
});

// ---- syncPaymentNotificationDestination against a recording client ---------------------------------
const BIG_ID = '9007199254740993123';
function recordingClient(storedDestination: string | null) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT ruta_destino')) return { rows: storedDestination === null ? [] : [{ ruta_destino: storedDestination }] };
    return { rows: [] };
  });
  return { calls, client: { query } as never };
}
const writes = <T extends { sql: string }>(calls: T[]): T[] => calls.filter((call) => /^\s*(INSERT|UPDATE)/i.test(call.sql));

describe('syncPaymentNotificationDestination — P1 protection', () => {
  it('STANDARD stored destination: UPDATE only ruta_destino/updated_at with the regenerated standard, BIGINT id as string', async () => {
    const { calls, client } = recordingClient(standard(PREVIOUS));
    expect(await syncPaymentNotificationDestination(client, BIG_ID, PREVIOUS, NEXT)).toBe('STANDARD');
    const [write] = writes(calls);
    expect(writes(calls)).toHaveLength(1);
    expect(write!.sql).toBe('UPDATE core.empresas_notificacion_pago SET ruta_destino = $2, updated_at = now() WHERE empresa_id = $1');
    expect(write!.params).toEqual([BIG_ID, standard(NEXT)]);
    expect(typeof write!.params![0]).toBe('string');
  });

  it.each(HISTORICAL_SUBPATHS.slice(0, 6).map((subpath) => [subpath]))('HISTORICAL stored destination: prefix swapped, sub-path kept (%s)', async (subpath) => {
    const { calls, client } = recordingClient(`${PREVIOUS_BS}\\${subpath}`);
    expect(await syncPaymentNotificationDestination(client, BIG_ID, PREVIOUS, NEXT)).toBe('HISTORICAL');
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]!.params).toEqual([BIG_ID, `${NEXT_BS}\\${subpath}`]);
  });

  it('UNRELATED stored destination: no write at all', async () => {
    const { calls, client } = recordingClient('OTRA CARPETA\\PAGOS\\{ANIO}');
    expect(await syncPaymentNotificationDestination(client, BIG_ID, PREVIOUS, NEXT)).toBe('UNRELATED');
    expect(writes(calls)).toHaveLength(0);
  });

  it('UNCHANGED path: no write, even with a historical destination', async () => {
    const { calls, client } = recordingClient(`${PREVIOUS_BS}\\PAGO PROVEEDOR\\{ANIO}`);
    expect(await syncPaymentNotificationDestination(client, BIG_ID, PREVIOUS, PREVIOUS)).toBe('UNCHANGED');
    expect(writes(calls)).toHaveLength(0);
  });

  it('clearing the path on a HISTORICAL destination: no write', async () => {
    const { calls, client } = recordingClient(`${PREVIOUS_BS}\\PAGO PROVEEDOR\\{ANIO}`);
    expect(await syncPaymentNotificationDestination(client, BIG_ID, PREVIOUS, null)).toBe('HISTORICAL');
    expect(writes(calls)).toHaveLength(0);
  });

  it('NEW (no settings row): INSERT false/false with the standard destination, never active/processing', async () => {
    const { calls, client } = recordingClient(null);
    expect(await syncPaymentNotificationDestination(client, BIG_ID, null, NEXT)).toBe('NEW');
    const [write] = writes(calls);
    expect(write!.sql).toContain('VALUES ($1, FALSE, FALSE, $2)');
    expect(write!.sql).toContain('ON CONFLICT (empresa_id) DO NOTHING');
    expect(write!.params).toEqual([BIG_ID, standard(NEXT)]);
  });

  it('never touches the flags, recipients or contacts: only core.empresas_notificacion_pago is queried', async () => {
    for (const stored of [standard(PREVIOUS), `${PREVIOUS_BS}\\PAGO PROVEEDOR\\{ANIO}`, 'OTRA\\X', null]) {
      const { calls, client } = recordingClient(stored);
      await syncPaymentNotificationDestination(client, BIG_ID, PREVIOUS, NEXT);
      for (const call of calls) {
        expect(call.sql).toContain('core.empresas_notificacion_pago');
        expect(call.sql).not.toMatch(/core\.(contactos|medios_contacto|alias_empresa|empresas\b)/);
        if (/^\s*UPDATE/i.test(call.sql)) expect(call.sql).not.toMatch(/procesa_comprobantes_pago|notificaciones_activas|observaciones/);
      }
    }
  });
});

// ---- Provider update flow (ProvidersRepository.updateDropboxPath -> sync) --------------------------
function providerUpdateClient(currentPath: string | null, storedDestination: string | null) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('FROM core.empresas WHERE empresa_id = $1 FOR UPDATE')) return { rows: [{ empresa_id: BIG_ID, tipo_empresa: 'PROVEEDOR', nombre_comercial: 'SYNTH', observaciones: null, estatus: 'ACTIVO', ruta_dropbox: currentPath }] };
    if (sql.includes('FROM core.empresa_roles WHERE empresa_id = $1 AND estatus')) return { rows: [{ rol: 'PROVEEDOR' }] };
    if (sql.includes('notificaciones_activas = TRUE')) return { rows: [] };
    if (sql.startsWith('SELECT ruta_destino')) return { rows: storedDestination === null ? [] : [{ ruta_destino: storedDestination }] };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  const repository = new ProvidersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);
  vi.spyOn(repository, 'findById').mockResolvedValue(null);
  return { calls, repository };
}
const destinationWrites = (calls: Array<{ sql: string; params?: unknown[] }>) => calls.filter((call) => /^\s*UPDATE core\.empresas_notificacion_pago SET ruta_destino/i.test(call.sql));

describe('ProvidersRepository.update — rutaDropbox change keeps historical destinations', () => {
  it('historical destination: ruta_dropbox moves, ruta_destino keeps its sub-path', async () => {
    const historical = `${PREVIOUS_BS}\\PAGOS\\Notificación de pagos\\{ANIO}\\{MES_NOMBRE_TITULO}`;
    const { calls, repository } = providerUpdateClient(PREVIOUS, historical);
    await repository.update(BIG_ID, { rutaDropbox: NEXT }, 'req-1', identity);
    expect(calls.find((call) => call.sql.includes('UPDATE core.empresas SET ruta_dropbox'))!.params).toEqual([NEXT, BIG_ID]);
    expect(destinationWrites(calls)).toHaveLength(1);
    expect(destinationWrites(calls)[0]!.params).toEqual([BIG_ID, `${NEXT_BS}\\PAGOS\\Notificación de pagos\\{ANIO}\\{MES_NOMBRE_TITULO}`]);
    expect(calls.at(-1)!.sql).toBe('COMMIT');
  });

  it('standard destination: regenerated for the new path', async () => {
    const { calls, repository } = providerUpdateClient(PREVIOUS, standard(PREVIOUS));
    await repository.update(BIG_ID, { rutaDropbox: NEXT }, 'req-1', identity);
    expect(destinationWrites(calls)[0]!.params).toEqual([BIG_ID, standard(NEXT)]);
  });

  it('unrelated destination: ruta_dropbox moves but ruta_destino is not written', async () => {
    const { calls, repository } = providerUpdateClient(PREVIOUS, 'OTRA CARPETA\\PAGOS\\{ANIO}');
    await repository.update(BIG_ID, { rutaDropbox: NEXT }, 'req-1', identity);
    expect(calls.some((call) => call.sql.includes('UPDATE core.empresas SET ruta_dropbox'))).toBe(true);
    expect(destinationWrites(calls)).toHaveLength(0);
    expect(calls.some((call) => /^\s*INSERT INTO core\.empresas_notificacion_pago/i.test(call.sql))).toBe(false);
  });

  it('unchanged ruta_dropbox: the settings table is not even read', async () => {
    const { calls, repository } = providerUpdateClient(PREVIOUS, `${PREVIOUS_BS}\\PAGO PROVEEDOR\\{ANIO}`);
    await repository.update(BIG_ID, { rutaDropbox: PREVIOUS }, 'req-1', identity);
    expect(calls.some((call) => call.sql.includes('empresas_notificacion_pago'))).toBe(false);
  });

  it('the change touches neither the flags nor recipients/contacts/aliases', async () => {
    const { calls, repository } = providerUpdateClient(PREVIOUS, `${PREVIOUS_BS}\\PAGO PROVEEDOR\\{ANIO}`);
    await repository.update(BIG_ID, { rutaDropbox: NEXT }, 'req-1', identity);
    const sqlText = calls.map((call) => call.sql).join('\n');
    expect(sqlText).not.toMatch(/medios_contacto|core\.contactos|alias_empresa|procesa_comprobantes_pago =|notificaciones_activas =/);
  });
});
