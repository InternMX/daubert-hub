import { Button } from '@mui/material';
import { Link } from 'react-router-dom';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { FirmasAdministrativas } from '../firmas/FirmasAdministrativas';

/** Usuarios → Firmas de personas sin cuenta: las que este ADMIN custodia (modelo de custodia administrativa existente). */
export function UserSignaturesPage() {
  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Usuarios', to: '/users' }, { label: 'Firmas de personas sin cuenta' }]} />
      <PageHeader title="Firmas de personas sin cuenta" description="Firmas que incorporaste como custodio. Tú gestionas quién puede usarlas; las de personas con cuenta las gobierna su propietaria.">
        <Button component={Link} to="/users">Volver a usuarios</Button>
      </PageHeader>
      <div style={{ marginTop: 32, maxWidth: 1100 }}>
        <FirmasAdministrativas consulta={{ sinCuenta: true }} propietarioNuevo={{ tipo: 'sinCuenta' }} titulo="Firmas bajo custodia" />
      </div>
    </>
  );
}
