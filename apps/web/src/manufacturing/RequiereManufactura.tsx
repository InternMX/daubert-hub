import { useEffect, useState, type ReactNode } from 'react';
import { Box, CircularProgress, Link, Typography } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/authContext.core';
import { revalidarManufactura, useManufacturaVisible } from './manufacturaDisponible';

function ComprobarManufactura({ usuarioId, children }: { usuarioId: string; children: ReactNode }) {
  const { estado, visible } = useManufacturaVisible();
  const [comprobado, setComprobado] = useState(false);

  useEffect(() => {
    let activo = true;
    const pendiente = revalidarManufactura(usuarioId);
    if (pendiente) {
      void pendiente.then(() => { if (activo) setComprobado(true); });
    } else {
      setComprobado(true);
    }
    return () => { activo = false; };
  }, [usuarioId]);

  if (!comprobado || estado === 'desconocido') return <CircularProgress aria-label="Cargando" />;
  if (visible) return <>{children}</>;
  return (
    <Box>
      <Typography>Hojas de manufactura no está disponible en este momento.</Typography>
      <Link component={RouterLink} to="/">Inicio</Link>
    </Box>
  );
}

export function RequiereManufactura({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return null;
  return <ComprobarManufactura key={JSON.stringify([user.id, pathname])} usuarioId={user.id}>{children}</ComprobarManufactura>;
}
