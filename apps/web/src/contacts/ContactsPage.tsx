import { Add } from '@mui/icons-material';
import { Alert, Box, Button, Chip, CircularProgress, Divider, Paper, Snackbar, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { getContactDirectoryCompany, listContactDirectoryCompanies, type CompanyType, type DirectoryCompany, type DirectoryCompanyDetail, type DirectoryContact, type DirectoryContactMethod } from '../services/contactDirectory';
import { deactivateContact, reactivateContact, type UpdatedContact } from '../services/contacts';
import { deactivateContactMethod, reactivateContactMethod, type AddedContactMethod, type EditedContactMethod } from '../services/contactMethods';
import { AddContactMethodForm } from './AddContactMethodForm';
import { ContactActionsMenu } from './ContactActionsMenu';
import { ContactDrawer } from './ContactDrawer';
import { ContactEditDrawer } from './ContactEditDrawer';
import { ContactMethodRow } from './ContactMethodRow';
import { DeactivateContactDialog } from './DeactivateContactDialog';
import { InactiveContactsSection } from './InactiveContactsSection';
import { InactiveMethodsSection } from './InactiveMethodsSection';
import { contactTitle } from './contactDisplay';

const companyLabels: Record<CompanyType, string> = { PROVEEDOR: 'Proveedor', SERVICIO: 'Proveedor de servicios', FLETE: 'Flete', CLIENTE: 'Cliente', OTRO: 'Otro' };
type MethodFormState = { mode: 'add'; contactId: string; formId: number } | { mode: 'edit'; contactId: string; methodId: string; formId: number };
function positive(value: string | null, fallback: number) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback; }

export function ContactsPage() {
  const [params, setParams] = useSearchParams();
  const searchQuery = params.get('search')?.trim() || ''; const page = positive(params.get('page'), 1); const pageSize = positive(params.get('pageSize'), 25); const selectedId = params.get('company');
  const [search, setSearch] = useState(searchQuery); const [companies, setCompanies] = useState<DirectoryCompany[]>([]); const [total, setTotal] = useState(0); const [listLoading, setListLoading] = useState(true); const [listError, setListError] = useState(false); const [listRetry, setListRetry] = useState(0);
  const [detail, setDetail] = useState<DirectoryCompanyDetail | null>(null); const [detailLoading, setDetailLoading] = useState(false); const [detailError, setDetailError] = useState(false); const [detailRetry, setDetailRetry] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(() => params.get('action') === 'new-contact'); const [drawerCompany, setDrawerCompany] = useState<{ id: string; commercialName: string } | null>(null); const [editContact, setEditContact] = useState<DirectoryContact | null>(null); const [methodForm, setMethodForm] = useState<MethodFormState | null>(null); const [feedback, setFeedback] = useState<string | null>(null); const [pendingIds, setPendingIds] = useState<Set<string>>(new Set()); const pendingIdsRef = useRef(new Set<string>()); const detailRefreshRef = useRef(0); const methodFormIdRef = useRef(0);
  const [contactPendingIds, setContactPendingIds] = useState<Set<string>>(new Set()); const contactPendingIdsRef = useRef(new Set<string>()); const [deactivating, setDeactivating] = useState<{ id: string; label: string } | null>(null); const [contactActionPending, setContactActionPending] = useState(false);
  useEffect(() => setSearch(searchQuery), [searchQuery]);
  useEffect(() => { if (params.get('action') === 'new-contact') { setDrawerCompany(null); setDrawerOpen(true); } }, [params]);
  useEffect(() => { const timer = window.setTimeout(() => { if (search === searchQuery) return; setParams((current) => { const next = new URLSearchParams(current); if (search.trim()) next.set('search', search.trim()); else next.delete('search'); next.set('page', '1'); return next; }); }, 300); return () => window.clearTimeout(timer); }, [search, searchQuery, setParams]);
  useEffect(() => { let active = true; setListLoading(true); setListError(false); listContactDirectoryCompanies({ search: searchQuery, page, pageSize }).then((result) => { if (!active) return; setCompanies(result.data); setTotal(result.meta.total); if (result.data.length && !result.data.some((company) => company.id === selectedId)) setParams((current) => { const next = new URLSearchParams(current); next.set('company', result.data[0]!.id); return next; }); }).catch(() => active && setListError(true)).finally(() => active && setListLoading(false)); return () => { active = false; }; }, [searchQuery, page, pageSize, selectedId, listRetry, setParams]);
  useEffect(() => { if (!selectedId) { setDetail(null); return; } let active = true; setDetailLoading(true); setDetailError(false); getContactDirectoryCompany(selectedId).then((result) => active && setDetail(result)).catch(() => active && setDetailError(true)).finally(() => active && setDetailLoading(false)); return () => { active = false; }; }, [selectedId, detailRetry]);
  useEffect(() => { detailRefreshRef.current += 1; setMethodForm(null); }, [selectedId]);
  function select(company: DirectoryCompany) { setParams((current) => { const next = new URLSearchParams(current); next.set('company', company.id); return next; }); }
  function created(companyId: string) { if (companyId === selectedId) setDetailRetry((value) => value + 1); setListRetry((value) => value + 1); setFeedback('Contacto registrado correctamente.'); }
  function openGlobalDrawer() { setDrawerCompany(null); setDrawerOpen(true); }
  function openContextualDrawer() { if (!detail) return; setDrawerCompany(detail.company); setDrawerOpen(true); }
  function closeDrawer() { setDrawerOpen(false); if (params.get('action') === 'new-contact') setParams((current) => { const next = new URLSearchParams(current); next.delete('action'); return next; }, { replace: true }); }
  function openAddMethod(contactId: string) { setMethodForm({ mode: 'add', contactId, formId: ++methodFormIdRef.current }); }
  function openEditMethod(contactId: string, methodId: string) { setMethodForm({ mode: 'edit', contactId, methodId, formId: ++methodFormIdRef.current }); }
  async function refreshDetail(companyId: string): Promise<void> { const refreshId = ++detailRefreshRef.current; const refreshed = await getContactDirectoryCompany(companyId); setDetail((current) => current?.company.id === companyId && detailRefreshRef.current === refreshId ? refreshed : current); }
  function updated(contact: UpdatedContact) { const companyId = detail?.company.id; setDetail((current) => current ? { ...current, contacts: current.contacts.map((item) => item.id === contact.id ? { ...item, name: contact.name, area: contact.area, position: contact.position, notes: contact.notes } : item) } : current); setEditContact(null); setFeedback('Contacto actualizado correctamente.'); if (companyId) void refreshDetail(companyId).catch(() => undefined); }
  function methodAdded(contactId: string, method: AddedContactMethod) { const companyId = detail?.company.id; setDetail((current) => current ? { ...current, contacts: current.contacts.map((contact) => contact.id === contactId ? { ...contact, methods: [...contact.methods, { id: method.id, type: method.type, value: method.value, isPrimary: false }] } : contact) } : current); setFeedback('Medio de contacto agregado.'); if (companyId) void refreshDetail(companyId).catch(() => undefined); }
  function methodEdited(contactId: string, edited: EditedContactMethod) { const companyId = detail?.company.id; setDetail((current) => current ? { ...current, contacts: current.contacts.map((contact) => { if (contact.id !== contactId) return contact; const existing = [...contact.methods, ...contact.inactiveMethods].find((method) => method.id === edited.id); if (!existing) return contact; const updatedMethod = { ...existing, type: edited.type, value: edited.value }; const place = (methods: DirectoryContactMethod[], target: boolean) => target ? (methods.some((method) => method.id === edited.id) ? methods.map((method) => method.id === edited.id ? updatedMethod : method) : [...methods, updatedMethod]) : methods.filter((method) => method.id !== edited.id); return { ...contact, methods: place(contact.methods, edited.status === 'ACTIVO'), inactiveMethods: place(contact.inactiveMethods, edited.status === 'INACTIVO') }; }) } : current); setFeedback('Medio de contacto actualizado.'); if (companyId) void refreshDetail(companyId).catch(() => undefined); }
  async function changeMethod(id: string, action: 'deactivate' | 'reactivate'): Promise<boolean> { if (pendingIdsRef.current.has(id) || !selectedId) return false; const companyId = selectedId; pendingIdsRef.current.add(id); setPendingIds(new Set(pendingIdsRef.current)); try { if (action === 'deactivate') await deactivateContactMethod(id); else await reactivateContactMethod(id); await refreshDetail(companyId); setFeedback(action === 'deactivate' ? 'Medio de contacto desactivado.' : 'Medio de contacto reactivado.'); return true; } catch { setFeedback(action === 'deactivate' ? 'No fue posible desactivar el medio de contacto.' : 'No fue posible reactivar el medio de contacto.'); return false; } finally { pendingIdsRef.current.delete(id); setPendingIds(new Set(pendingIdsRef.current)); } }
  async function changeContactLifecycle(contactId: string, action: 'deactivate' | 'reactivate'): Promise<boolean> {
    if (contactPendingIdsRef.current.has(contactId)) return false;
    const companyId = selectedId;
    contactPendingIdsRef.current.add(contactId); setContactPendingIds(new Set(contactPendingIdsRef.current));
    try {
      if (action === 'deactivate') await deactivateContact(contactId); else await reactivateContact(contactId);
      if (companyId) await refreshDetail(companyId).catch(() => undefined);
      setListRetry((value) => value + 1);
      setEditContact((current) => current?.id === contactId ? null : current);
      setMethodForm((current) => current && current.contactId === contactId ? null : current);
      setFeedback(action === 'deactivate' ? 'Contacto desactivado.' : 'Contacto reactivado.');
      return true;
    } catch {
      if (companyId) void refreshDetail(companyId).catch(() => undefined);
      setFeedback(action === 'deactivate' ? 'No fue posible desactivar el contacto.' : 'No fue posible reactivar el contacto.');
      return false;
    } finally {
      contactPendingIdsRef.current.delete(contactId); setContactPendingIds(new Set(contactPendingIdsRef.current));
    }
  }
  async function confirmDeactivate() {
    const target = deactivating;
    if (!target || contactActionPending) return;
    setContactActionPending(true);
    try { if (await changeContactLifecycle(target.id, 'deactivate')) setDeactivating(null); }
    finally { setContactActionPending(false); }
  }
  async function reactivateContactById(contactId: string): Promise<void> { await changeContactLifecycle(contactId, 'reactivate'); }
  return <>
    <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Contactos' }]} />
    <PageHeader title="Directorio de contactos" description="Consulta rápidamente las empresas y sus contactos."><Button variant="contained" onClick={openGlobalDrawer}>Agregar contacto</Button></PageHeader>
    <TextField label="Empresa, contacto, correo, teléfono o área" placeholder="Empresa, contacto, correo, teléfono o área" value={search} onChange={(event) => setSearch(event.target.value)} fullWidth sx={{ mt: 4, maxWidth: 800 }} />
    <Box sx={{ mt: 3, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 34%) minmax(0, 1fr)' }, gap: 2 }}>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}><Typography variant="h2" sx={{ fontSize: '1rem' }}>Empresas</Typography><Typography variant="body2" color="text.secondary">{total} en el directorio</Typography></Box>
        {listLoading && <Box role="status" sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} aria-label="Cargando empresas" /></Box>}
        {listError && <Alert severity="error" action={<button onClick={() => setListRetry((value) => value + 1)}>Reintentar</button>} sx={{ m: 2 }}>No fue posible cargar el directorio de contactos.</Alert>}
        {!listLoading && !listError && <Stack divider={<Divider flexItem />}>{companies.map((company) => <Box key={company.id} component="button" type="button" onClick={() => select(company)} aria-pressed={company.id === selectedId} sx={{ border: 0, bgcolor: company.id === selectedId ? 'action.selected' : 'transparent', textAlign: 'left', p: 2, cursor: 'pointer', font: 'inherit' }}><Stack direction="row" justifyContent="space-between" spacing={1}><Typography fontWeight={700}>{company.commercialName}</Typography><Chip label={company.contactCount} size="small" /></Stack><Typography variant="body2" color="text.secondary">{companyLabels[company.companyType]}</Typography>{company.matchedAlias && <Typography variant="body2" color="text.secondary" title={company.matchedAlias} sx={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>Coincidencia por alias: {company.matchedAlias}</Typography>}</Box>)}</Stack>}
      </Paper>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3.5 }, minHeight: 360 }}>
        {detailLoading && <Box role="status" sx={{ textAlign: 'center', py: 8 }}><CircularProgress size={28} aria-label="Cargando contactos" /></Box>}
        {detailError && <Alert severity="error" action={<button onClick={() => setDetailRetry((value) => value + 1)}>Reintentar</button>}>No fue posible cargar los contactos de esta empresa.</Alert>}
        {!detailLoading && !detailError && !detail && <Typography color="text.secondary" sx={{ py: 8, textAlign: 'center' }}>Selecciona una empresa.</Typography>}
        {!detailLoading && !detailError && detail && <>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={2}>
            <Box><Typography variant="h2" sx={{ fontSize: '1.5rem' }}>{detail.company.commercialName}</Typography><Typography color="text.secondary">{companyLabels[detail.company.companyType]}</Typography></Box>
            <Button variant="contained" onClick={openContextualDrawer}>Agregar contacto</Button>
          </Stack>
          <Typography sx={{ mt: 2, fontWeight: 700 }}>{detail.contacts.length} {detail.contacts.length === 1 ? 'contacto' : 'contactos'}</Typography>
          {detail.contacts.length === 0 ? <Typography color="text.secondary" sx={{ mt: 4 }}>{detail.inactiveContacts.length > 0 ? 'No hay contactos activos.' : 'No hay contactos registrados para esta empresa.'}</Typography> : <Stack spacing={2} sx={{ mt: 3 }}>
            {detail.contacts.map((contact) => {
              const editingMethodId = methodForm?.mode === 'edit' && methodForm.contactId === contact.id ? methodForm.methodId : null;
              const editingFormId = methodForm?.mode === 'edit' && methodForm.contactId === contact.id ? methodForm.formId : null;
              return <Box key={contact.id} sx={{ borderLeft: 3, borderColor: 'primary.main', pl: 2 }}>
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}><Typography fontWeight={700}>{contactTitle(contact)}</Typography><ContactActionsMenu label={contactTitle(contact)} onEdit={() => setEditContact(contact)} onDeactivate={() => setDeactivating({ id: contact.id, label: contactTitle(contact) })} /></Stack>
                {contact.name && contact.area && <Typography color="text.secondary">{contact.area}</Typography>}
                {!contact.name && contact.contactType === 'BUZON_GENERICO' && <Typography color="text.secondary">Buzón general</Typography>}
                {contact.position && <Typography color="text.secondary">{contact.position}</Typography>}
                <Stack spacing={0.5} sx={{ mt: 1.25 }}>
                  {contact.methods.length === 0 && <Typography variant="body2" color="text.secondary">Sin medios activos</Typography>}
                  {contact.methods.map((method) => <ContactMethodRow key={method.id} method={method} pending={pendingIds.has(method.id)} editing={editingMethodId === method.id} onEdit={(selected) => openEditMethod(contact.id, selected.id)} onEditClose={() => setMethodForm((current) => current?.mode === 'edit' && current.formId === editingFormId ? null : current)} onEdited={(edited) => methodEdited(contact.id, edited)} onDeactivate={(id) => changeMethod(id, 'deactivate')} />)}
                </Stack>
                {methodForm?.mode === 'add' && methodForm.contactId === contact.id ? <AddContactMethodForm key={`add-${methodForm.formId}`} contact={{ id: contact.id, label: contactTitle(contact) }} onClose={() => { const formId = methodForm.formId; setMethodForm((current) => current?.mode === 'add' && current.formId === formId ? null : current); }} onAdded={methodAdded} /> : <Button size="small" variant="text" startIcon={<Add />} aria-label={`Agregar medio para ${contactTitle(contact)}`} onClick={() => openAddMethod(contact.id)} sx={{ mt: 0.5, px: 0.5 }}>Agregar medio</Button>}
                <InactiveMethodsSection methods={contact.inactiveMethods} pendingIds={pendingIds} editingMethodId={editingMethodId} editingFormId={editingFormId} onEdit={(selected) => openEditMethod(contact.id, selected.id)} onEditClose={(_methodId, formId) => setMethodForm((current) => current?.mode === 'edit' && current.formId === formId ? null : current)} onEdited={(edited) => methodEdited(contact.id, edited)} onReactivate={(id) => changeMethod(id, 'reactivate')} />
              </Box>;
            })}
          </Stack>}
          <InactiveContactsSection contacts={detail.inactiveContacts} pendingIds={contactPendingIds} onReactivate={reactivateContactById} />
        </>}
      </Paper>
    </Box>
    <ContactDrawer company={drawerCompany} open={drawerOpen} onClose={closeDrawer} onCreated={created} />
    <ContactEditDrawer company={detail?.company ?? null} contact={editContact} onClose={() => setEditContact(null)} onUpdated={updated} />
    <DeactivateContactDialog open={Boolean(deactivating)} label={deactivating?.label ?? ''} companyName={detail?.company.commercialName ?? ''} submitting={contactActionPending} onCancel={() => setDeactivating(null)} onConfirm={() => void confirmDeactivate()} />
    <Snackbar open={Boolean(feedback)} autoHideDuration={4000} onClose={() => setFeedback(null)} message={feedback} />
  </>;
}
