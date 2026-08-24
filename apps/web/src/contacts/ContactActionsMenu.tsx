import { MoreVert } from '@mui/icons-material';
import { IconButton, Menu, MenuItem } from '@mui/material';
import { useState } from 'react';
import type { MouseEvent } from 'react';

export function ContactActionsMenu({ label, onEdit }: { label: string; onEdit: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  function open(event: MouseEvent<HTMLElement>) { setAnchor(event.currentTarget); }
  function edit() { setAnchor(null); onEdit(); }
  return <><IconButton size="small" aria-label={`Acciones del contacto ${label}`} onClick={open} sx={{ mt: -0.5, border: 1, borderColor: 'divider' }}><MoreVert fontSize="small" /></IconButton><Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}><MenuItem onClick={edit}>Editar contacto</MenuItem></Menu></>;
}
