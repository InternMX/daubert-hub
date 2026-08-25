import { ChevronRight, ExpandMore } from '@mui/icons-material';
import { Box, Collapse, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import type { DirectoryContact } from '../services/contactDirectory';
import { contactTitle } from './contactDisplay';
import { ContactActionsMenu } from './ContactActionsMenu';
import { ContactMethodRow } from './ContactMethodRow';
import { InactiveMethodsSection } from './InactiveMethodsSection';

export function InactiveContactsSection({ contacts, pendingIds, onReactivate }: { contacts: DirectoryContact[]; pendingIds: Set<string>; onReactivate: (contactId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (contacts.length === 0) return null;
  return <Box sx={{ mt: 4 }}>
    <Box component="button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} sx={{ display: 'flex', alignItems: 'center', border: 0, bgcolor: 'transparent', color: 'text.secondary', p: 0, cursor: 'pointer', font: 'inherit' }}>
      <Box component="span" sx={{ display: 'flex', p: 0.625 }}>{open ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}</Box><Typography variant="body2" fontWeight={600}>Contactos inactivos ({contacts.length})</Typography>
    </Box>
    <Collapse in={open}><Stack spacing={3} sx={{ mt: 2 }}>{contacts.map((contact) => {
      const title = contactTitle(contact);
      return <Box key={contact.id} sx={{ borderLeft: 3, borderColor: 'divider', pl: 2 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}><Typography fontWeight={700} color="text.secondary">{title}</Typography><ContactActionsMenu label={title} inactive onReactivate={() => onReactivate(contact.id)} /></Stack>
        {contact.name && contact.area && <Typography color="text.secondary">{contact.area}</Typography>}
        {!contact.name && contact.contactType === 'BUZON_GENERICO' && <Typography color="text.secondary">Buzón general</Typography>}
        {contact.position && <Typography color="text.secondary">{contact.position}</Typography>}
        <Stack spacing={0.5} sx={{ mt: 1.25 }}>
          {contact.methods.length === 0 && <Typography variant="body2" color="text.secondary">Sin medios activos</Typography>}
          {contact.methods.map((method) => <ContactMethodRow key={method.id} method={method} readOnly pending={false} />)}
        </Stack>
        <InactiveMethodsSection methods={contact.inactiveMethods} pendingIds={pendingIds} editingMethodId={null} editingFormId={null} readOnly />
      </Box>;
    })}</Stack></Collapse>
  </Box>;
}
