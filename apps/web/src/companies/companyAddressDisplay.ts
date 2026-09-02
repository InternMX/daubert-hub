import type { CompanyAddress, CompanyAddressType } from '../services/companyAddresses';

export const companyAddressTypeOptions: Array<{ value: CompanyAddressType; label: string }> = [
  { value: 'FISCAL', label: 'Fiscal' },
  { value: 'COMERCIAL', label: 'Comercial' },
  { value: 'OPERATIVA', label: 'Operativa' },
  { value: 'ENTREGA', label: 'Entrega' },
  { value: 'FACTURACION', label: 'Facturación' },
  { value: 'OTRA', label: 'Otra' }
];

export const companyAddressTypeLabels = Object.fromEntries(companyAddressTypeOptions.map(({ value, label }) => [value, label])) as Record<CompanyAddressType, string>;
export const presentAddressValue = (value: string | null | undefined): string | null => value?.trim() || null;

export function formatCompanyAddress(address: CompanyAddress): string {
  const complete = presentAddressValue(address.direccionCompleta);
  if (complete) return complete;
  const street = [presentAddressValue(address.calle), presentAddressValue(address.numeroExterior) && `No. ${presentAddressValue(address.numeroExterior)}`, presentAddressValue(address.numeroInterior) && `Int. ${presentAddressValue(address.numeroInterior)}`].filter(Boolean).join(' ');
  const locality = [presentAddressValue(address.colonia), presentAddressValue(address.municipio), presentAddressValue(address.estado), presentAddressValue(address.codigoPostal) && `C.P. ${presentAddressValue(address.codigoPostal)}`, presentAddressValue(address.pais)].filter(Boolean).join(', ');
  return [street, locality].filter(Boolean).join(', ') || 'Sin detalles de dirección.';
}
