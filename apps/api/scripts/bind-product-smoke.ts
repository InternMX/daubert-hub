/**
 * Prueba REAL (opcional, manual) de la conexión con BIND ERP: busca un producto por código y muestra solo datos NO secretos.
 *
 *   npm run bind:smoke -- SCHFPMG001            (desde apps/api; el código es opcional, por defecto SCHFPMG001)
 *
 * Las credenciales se leen de las variables de entorno BIND_API_KEY / BIND_SUBSCRIPTION_KEY (o de apps/api/.env, que Git ignora). Este script nunca imprime
 * las claves, los encabezados ni la URL con credenciales. Si faltan las credenciales termina con «PENDIENTE» (no simula una conexión exitosa).
 */
import { BindErpClient } from '../src/manufacturing-sheets/bind/bind-erp.client';
import { interpretarProductoBind, sugerirDatosPlantilla } from '../src/manufacturing-sheets/bind-product-interpreter';

async function main(): Promise<number> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Sin .env: se usan solo las variables ya presentes en el entorno.
  }
  const apiKey = process.env.BIND_API_KEY?.trim() || null;
  const subscriptionKey = process.env.BIND_SUBSCRIPTION_KEY?.trim() || null;
  const baseUrl = process.env.BIND_API_BASE_URL?.trim() || 'https://api.bind.com.mx';
  const code = (process.argv[2] ?? 'SCHFPMG001').trim();

  if (!apiKey) {
    console.log('PENDIENTE: BIND_API_KEY no está configurada; no se realizó ninguna conexión con BIND.');
    return 2;
  }
  const client = new BindErpClient({ get: () => ({ baseUrl, apiKey, subscriptionKey }) } as never);
  console.log(`Consultando BIND por código «${code}» (credenciales configuradas: API key sí, clave de suscripción ${subscriptionKey ? 'sí' : 'no'}).`);
  const result = await client.findByCode(code);
  if (result.kind !== 'RESULTS') {
    console.log(`RESULTADO: ${result.kind}${result.kind === 'BAD_REQUEST' ? ' (BIND rechazó el filtro o el código; revisar la sintaxis de $filter para Code)' : ''}`);
    return 1;
  }
  if (result.products.length !== 1) {
    console.log(`RESULTADO: ${result.products.length === 0 ? 'producto no encontrado' : `${result.products.length} coincidencias (no se elige ninguna)`}`);
    return 1;
  }
  const producto = result.products[0]!;
  const interpretacion = interpretarProductoBind(producto);
  console.log('RESULTADO: producto encontrado');
  console.log(JSON.stringify({
    producto: { ID: producto.ID, Code: producto.Code, Title: producto.Title, Weight: producto.Weight, CreationDate: producto.CreationDate },
    pendientes: interpretacion.pendientes,
    advertencias: interpretacion.advertencias.map((a) => a.codigo),
    familia: interpretacion.familia,
    datosSugeridosPlantilla: sugerirDatosPlantilla(interpretacion)
  }, null, 2));
  return 0;
}

main().then((code) => process.exit(code), () => {
  console.log('ERROR inesperado en la prueba (sin detalles para no exponer credenciales).');
  process.exit(1);
});
