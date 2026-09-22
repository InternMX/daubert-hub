// Phase 12A.3 §B: a small, explicit presentation mapping from the EXACT known
// ops.automatizacion_series_proceso.llave_proceso values (confirmed via live schema/data
// introspection, Phase 12A.1/12A.2 — never inferred from operacion.series_documentales.codigo
// parsing) to a Spanish label. This is presentation only, never routing logic — the actual
// route/series relationship always comes from the database join (caterpillar-routing.repository.ts),
// never from this map.
const KNOWN_PROCESS_LABELS: Readonly<Record<string, string>> = {
  'CATERPILLAR_P2|P2|': 'P2',
  'CAT_P3_P4_P5_P6|P3|': 'P3',
  'CAT_P3_P4_P5_P6|P4|': 'P4',
  'CAT_P3_P4_P5_P6|P5|': 'P5',
  'CAT_P3_P4_P5_P6|P6|': 'P6',
  'CAT_NUEVO_LAREDO|NUEVO_LAREDO|FINSA_1': 'Nuevo Laredo FINSA 1',
  'CAT_NUEVO_LAREDO|NUEVO_LAREDO|FINSA_3': 'Nuevo Laredo FINSA 3',
  'CAT_TORREON|TORREON|': 'Torreón',
  'CAT_TORREON|TORREON|PLANTA_2': 'Torreón Planta 2'
};

// Never drops or crashes on an unrecognized key (e.g. a future route added directly in
// PostgreSQL before this map is updated) — falls back to the raw llave_proceso, which the API
// response always includes verbatim alongside this label (see CaterpillarProcessRoute.processKey).
export function caterpillarProcessLabel(llaveProceso: string): string {
  return KNOWN_PROCESS_LABELS[llaveProceso] ?? llaveProceso;
}
