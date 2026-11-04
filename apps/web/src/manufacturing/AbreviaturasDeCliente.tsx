import { Paper, Typography } from '@mui/material';
import { AdministracionAbreviaturas } from './AbreviaturasClientesPage';

/**
 * Sección «Abreviaturas de código DCMX» en la ficha de un cliente. Es el MISMO catálogo, endpoints y reglas que la Configuración de Hojas de manufactura, filtrado por empresa:
 * un ADMIN registra, confirma, rechaza e inactiva; una cuenta GENERAL consulta lo confirmado y puede PROPONER (un ADMIN la confirma). No son los alias de pago de la empresa.
 */
export function AbreviaturasDeCliente({ cliente }: { cliente: { id: string; nombre: string } }) {
  return (
    <Paper variant="outlined" component="section" aria-labelledby="abreviaturas-cliente" sx={{ p: { xs: 3, sm: 4 } }}>
      <Typography id="abreviaturas-cliente" variant="h2" sx={{ fontSize: '1.125rem' }}>Abreviaturas de código DCMX</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2, fontSize: '0.875rem' }}>Ayudan a SUGERIR este cliente en las hojas de manufactura según el inicio del código; nunca lo asignan solas. Son distintas de los alias de pago.</Typography>
      <AdministracionAbreviaturas cliente={cliente} />
    </Paper>
  );
}
