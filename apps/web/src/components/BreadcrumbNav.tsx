import { Breadcrumbs, Link as MuiLink, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  to?: string;
  state?: unknown;
}

interface BreadcrumbNavProps {
  items: BreadcrumbItem[];
}

export function BreadcrumbNav({ items }: BreadcrumbNavProps) {
  return (
    <Breadcrumbs component="nav" aria-label="Migas de pan" separator="/" sx={{ mb: 1, '& .MuiBreadcrumbs-separator': { color: 'text.disabled', mx: 0.75 } }}>
      {items.map((item, index) => item.to && index < items.length - 1
        ? <MuiLink key={item.label} component={RouterLink} to={item.to} state={item.state} underline="hover" color="text.secondary" variant="body2">{item.label}</MuiLink>
        : <Typography key={item.label} color="text.secondary" variant="body2" aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</Typography>)}
    </Breadcrumbs>
  );
}
