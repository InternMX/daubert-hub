import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getContactDirectoryCompany, listContactDirectoryCompanies } from '../services/contactDirectory';
import { ContactsPage } from './ContactsPage';

vi.mock('../services/contactDirectory', () => ({ listContactDirectoryCompanies: vi.fn(), getContactDirectoryCompany: vi.fn() }));
const listMock = vi.mocked(listContactDirectoryCompanies); const detailMock = vi.mocked(getContactDirectoryCompany);
function renderPage(path = '/contacts') { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/contacts" element={<ContactsPage />} /></Routes></MemoryRouter>); }
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe('ContactsPage', () => {
  it('renders companies and selected detail with multiple method types without payment routing fields', async () => {
    listMock.mockResolvedValue({ data: [{ id: '1', commercialName: 'ALMEX', companyType: 'FLETE', contactCount: 2 }, { id: '2', commercialName: 'NOVAPAK', companyType: 'PROVEEDOR', contactCount: 0 }], meta: { page: 1, pageSize: 25, total: 2, totalPages: 1 } });
    detailMock.mockResolvedValue({ company: { id: '1', commercialName: 'ALMEX', companyType: 'FLETE' }, contacts: [{ id: '3', name: null, contactType: 'BUZON_GENERICO', area: 'Facturación', position: null, isPrimary: false, methods: [{ id: '4', type: 'CORREO', value: 'billing@example.test', isPrimary: true }, { id: '5', type: 'TELEFONO', value: '5550000000', isPrimary: false }, { id: '6', type: 'WHATSAPP', value: '5550000001', isPrimary: false }] }] });
    renderPage();
    expect(await screen.findByText('ALMEX')).toBeInTheDocument();
    expect(screen.getByText('NOVAPAK')).toBeInTheDocument();
    expect(await screen.findByText('Buzón general')).toBeInTheDocument();
    expect(screen.getByText('Correo:')).toBeInTheDocument(); expect(screen.getByText('Teléfono:')).toBeInTheDocument(); expect(screen.getByText('WhatsApp:')).toBeInTheDocument();
    expect(screen.queryByText(/PARA|CCO|receives payment/i)).not.toBeInTheDocument();
  });
  it('debounces search and keeps it in the directory request', async () => {
    vi.useFakeTimers(); listMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }); renderPage(); await act(async () => {}); listMock.mockClear(); fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'Facturación' } }); await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(listMock).toHaveBeenCalledWith({ search: 'Facturación', page: 1, pageSize: 25 });
  });
  it('shows an empty contact state for a selected company', async () => {
    listMock.mockResolvedValue({ data: [{ id: '2', commercialName: 'NOVAPAK', companyType: 'PROVEEDOR', contactCount: 0 }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }); detailMock.mockResolvedValue({ company: { id: '2', commercialName: 'NOVAPAK', companyType: 'PROVEEDOR' }, contacts: [] }); renderPage('/contacts?company=2'); expect(await screen.findByText('No hay contactos registrados para esta empresa.')).toBeInTheDocument();
  });
});
