import type { DirectoryContact } from '../services/contactDirectory';

export function contactTitle(contact: DirectoryContact) { return contact.name?.trim() || contact.area?.trim() || (contact.contactType === 'BUZON_GENERICO' ? 'Buzón general' : 'Contacto sin nombre'); }
