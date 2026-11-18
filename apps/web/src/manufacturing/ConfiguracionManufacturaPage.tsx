import { Box, Typography } from '@mui/material';
import { MANUFACTURING_SHEETS_ROUTE } from '../automations/automationRoutes';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { AdministracionAbreviaturas } from './AbreviaturasClientesPage';

/** Configuración de Hojas de manufactura (solo ADMIN, protegida por AdminRoute y por la API). Hoy: identificación de clientes por abreviatura. */
export function ConfiguracionManufacturaPage() {
  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones', to: '/automations' }, { label: 'Hojas de manufactura', to: MANUFACTURING_SHEETS_ROUTE }, { label: 'Configuración' }]} />
      <PageHeader title="Configuración de hojas de manufactura" description="Ajustes que sirven a la elaboración de las hojas. Los cambios no afectan a las hojas ya finalizadas." />
      <Box component="section" aria-labelledby="identificacion-clientes" sx={{ mt: 4 }}>
        <Typography id="identificacion-clientes" variant="h2" sx={{ fontSize: '1.25rem' }}>Identificación de clientes</Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 3, maxWidth: 760 }}>Las abreviaturas asocian la parte inicial de un código DCMX con un cliente para SUGERIRLO en la hoja. Nunca asignan el cliente solas; una abreviatura puede pertenecer a varios clientes y se revisan las propuestas de los usuarios.</Typography>
        <AdministracionAbreviaturas />
      </Box>
    </>
  );
}
