import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { AddressesService } from '../src/addresses/addresses.service';
import { AddressType } from '../src/addresses/dto/create-address.dto';
import { UpdateAddressDto } from '../src/addresses/dto/update-address.dto';

const identity = { userId: null, userEmail: null };

describe('AddressesService', () => {
  it('rejects content-free creates and reversed create dates before SQL', async () => {
    const repository = { create: vi.fn() };
    const service = new AddressesService(repository as never);
    await expect(service.create('1', { tipoDireccion: AddressType.Operational }, 'r1', identity)).rejects.toMatchObject({ status: 400 });
    await expect(service.create('1', { tipoDireccion: AddressType.Operational, calle: 'Reforma', fechaInicio: '2026-09-03', fechaFin: '2026-09-02' }, 'r2', identity)).rejects.toMatchObject({ status: 400 });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects an empty PATCH', async () => {
    const repository = { update: vi.fn() };
    const service = new AddressesService(repository as never);
    await expect(service.update('1', plainToInstance(UpdateAddressDto, {}), 'r1', identity)).rejects.toMatchObject({ status: 400 });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('returns 404 when GET targets a missing company', async () => {
    const service = new AddressesService({ list: vi.fn().mockResolvedValue(null) } as never);
    await expect(service.list('999')).rejects.toMatchObject({ status: 404 });
  });

  it('maps exactly the supported output including dates and ACTIVA status', async () => {
    const row = { direccion_id: '9007199254740993', empresa_id: '2', tipo_direccion: 'COMERCIAL', calle: 'Reforma', numero_exterior: '1', numero_interior: null, colonia: 'Centro', codigo_postal: '20000', municipio: 'Aguascalientes', estado: 'Aguascalientes', pais: 'México', direccion_completa: null, referencias: null, es_principal: true, fecha_inicio: '2026-09-01', fecha_fin: null, estatus: 'ACTIVA' };
    const service = new AddressesService({ list: vi.fn().mockResolvedValue([row]) } as never);
    await expect(service.list('2')).resolves.toEqual({ data: [{ id: '9007199254740993', companyId: '2', tipoDireccion: 'COMERCIAL', calle: 'Reforma', numeroExterior: '1', numeroInterior: null, colonia: 'Centro', codigoPostal: '20000', municipio: 'Aguascalientes', estado: 'Aguascalientes', pais: 'México', direccionCompleta: null, referencias: null, esPrincipal: true, fechaInicio: '2026-09-01', fechaFin: null, estatus: 'ACTIVA' }] });
  });
});
