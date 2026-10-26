// Pure transport invariant, not deduplication or permission to reserve.
function readCaterpillarOperationalContent(items) {
  const fail = () => { throw new Error('CAT_TEST_MANIFEST_TRANSPORT_INVALID'); };
  if (!Array.isArray(items) || !items.length) return fail();
  const content = items[0]?.json?.cat_operational_content;
  const manifest = content?.manifest;
  if (content?.deliveryIdentity !== 'UNCONFIRMED' || manifest?.version !== 'CAT_OPERATIONAL_CONTENT_V1' ||
    !Array.isArray(manifest.scope) || manifest.scope.length !== 5 || manifest.scope.some(v => typeof v !== 'string') ||
    !/^\d{4}-\d{2}-\d{2}$/.test(manifest.deliveryDate) ||
    manifest.grouping !== (manifest.scope[0] === 'CAT_TORREON' ? 'POR_OC' : 'POR_ARTICULO') ||
    !Array.isArray(manifest.documents) || manifest.documents.length !== items.length) return fail();
  for (const document of manifest.documents) {
    if (typeof document.purchaseOrder !== 'string' || !document.purchaseOrder.trim() || !Array.isArray(document.lines) || !document.lines.length) return fail();
    for (const line of document.lines) {
      if (!Array.isArray(line) || line.length !== 5 || !line.slice(0, 3).every(v => typeof v === 'string') ||
        !line[0].trim() || line[2] !== document.purchaseOrder || typeof line[3] !== 'number' || !Number.isFinite(line[3]) || line[3] <= 0 ||
        !['BOLSAS', 'HOJAS', 'ROLLOS', 'PAQUETES', 'PIEZAS'].includes(line[4])) return fail();
    }
    if (manifest.grouping === 'POR_ARTICULO' && document.lines.length !== 1) return fail();
  }
  const canonical = JSON.stringify(content);
  if (items.some(item => JSON.stringify(item?.json?.cat_operational_content) !== canonical)) return fail();
  return content;
}
module.exports = { readCaterpillarOperationalContent };
