import { MoreVert } from '@mui/icons-material';
import { IconButton, Menu, MenuItem } from '@mui/material';
import { useState } from 'react';
import type { MouseEvent } from 'react';

export function ContactActionsMenu({ label, inactive = false, onEdit, onDeactivate, onReactivate }: { label: string; inactive?: boolean; onEdit?: () => void; onDeactivate?: () => void; onReactivate?: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  function open(event: MouseEvent<HTMLElement>) { setAnchor(event.currentTarget); }
  function edit() { setAnchor(null); onEdit?.(); }
  function deactivate() { setAnchor(null); onDeactivate?.(); }
  function reactivate() { setAnchor(null); onReactivate?.(); }
  return <><IconButton size="small" aria-label={`Acciones del contacto ${label}`} onClick={open} sx={{ mt: -0.5, border: 1, borderColor: 'divider' }}><MoreVert fontSize="small" /></IconButton><Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>{inactive ? [<MenuItem key="reactivate" onClick={reactivate}>Reactivar contacto</MenuItem>] : [<MenuItem key="edit" onClick={edit}>Editar contacto</MenuItem>, <MenuItem key="deactivate" onClick={deactivate}>Desactivar contacto</MenuItem>]}</Menu></>;
}
