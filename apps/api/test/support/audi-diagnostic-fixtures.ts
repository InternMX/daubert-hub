// Synthetic inputs only, shared by the unit, service and HTTP disclosure regressions.
export const untrustedAudiDiagnostics = [
  { label: 'business-looking message without an approved catalog', message: 'No fue posible generar el documento.', fragments: ['No fue posible generar el documento'] },
  { label: 'unknown message', message: 'Fallo ZetaDiagnostico desconocido', fragments: ['ZetaDiagnostico'] },
  { label: 'password-shaped value from the review reproduction', message: 'pwd : ValorSinteticoSoloPrueba123', fragments: ['pwd', 'ValorSinteticoSoloPrueba123'] },
  { label: 'access key from the review reproduction', message: 'clave de acceso ValorSinteticoSoloPrueba123', fragments: ['clave de acceso', 'ValorSinteticoSoloPrueba123'] },
  { label: 'internal path', message: 'C:\\private\\SoloPrueba\\origenPrivadoSoloPrueba.pdf', fragments: ['private', 'SoloPrueba', 'origenPrivadoSoloPrueba.pdf'] },
  { label: 'arbitrary technical information', message: 'Error al conectar con servidor interno 10.12.0.9', fragments: ['servidor interno', '10.12.0.9'] },
  { label: 'spaces and uppercase variations', message: '  PWD  :   ValorSinteticoMayusculas987  ', fragments: ['PWD', 'ValorSinteticoMayusculas987'] },
  { label: 'special characters and line breaks', message: '\tClAvE\n: <ValorSintetico>&%="987" 🔒', fragments: ['ClAvE', 'ValorSintetico', '987'] },
  { label: 'raw payload', message: '{"payload":"ValorSinteticoPayload987"}', fragments: ['payload', 'ValorSinteticoPayload987'] },
  { label: 'long arbitrary message', message: 'ValorSinteticoLargo987 '.repeat(30), fragments: ['ValorSinteticoLargo987'] }
] as const;
