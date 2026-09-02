import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AddressType, CreateAddressDto } from '../src/addresses/dto/create-address.dto';
import { UpdateAddressDto } from '../src/addresses/dto/update-address.dto';

describe('address DTOs', () => {
  it('accepts and normalizes the exact address contract', async () => {
    const input = plainToInstance(CreateAddressDto, { tipoDireccion: AddressType.Delivery, calle: ' Reforma ', numeroInterior: ' ', pais: null, esPrincipal: true, fechaInicio: '2026-09-02', fechaFin: '2026-09-03' });
    expect(await validate(input)).toHaveLength(0);
    expect(input).toMatchObject({ tipoDireccion: 'ENTREGA', calle: 'Reforma', numeroInterior: null, pais: null, esPrincipal: true, fechaInicio: '2026-09-02' });
  });

  it.each(Object.values(AddressType))('accepts supported type %s', async (tipoDireccion) => {
    expect(await validate(plainToInstance(CreateAddressDto, { tipoDireccion, direccionCompleta: 'Aguascalientes' }))).toHaveLength(0);
  });

  it.each(['RECOLECCION', 'ENVIO', 'OFICINA', ''])('rejects unsupported type %s', async (tipoDireccion) => {
    expect(await validate(plainToInstance(CreateAddressDto, { tipoDireccion, calle: 'Reforma' }))).not.toHaveLength(0);
  });

  it.each(['2026-9-02', '02/09/2026', '2026-09-02T00:00:00Z', '2026-02-30', '2026-13-01'])('rejects invalid date %s', async (fechaInicio) => {
    expect(await validate(plainToInstance(UpdateAddressDto, { fechaInicio }))).not.toHaveLength(0);
  });
});
