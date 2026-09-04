import { Button, Paper, Typography } from '@mui/material';
import { Link } from 'react-router-dom';

export function CompanyContactsSection({ companyId }: { companyId: string }) {
  return (
    <Paper component="section" aria-labelledby="company-contacts-heading" variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
      <Typography id="company-contacts-heading" variant="h2" sx={{ fontSize: '1.125rem' }}>Contactos relacionados</Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>Consulta y administra los contactos de esta empresa desde el directorio de contactos.</Typography>
      <Button component={Link} to={`/contacts?company=${encodeURIComponent(companyId)}`} variant="outlined" sx={{ mt: 2 }}>Ver contactos</Button>
    </Paper>
  );
}
