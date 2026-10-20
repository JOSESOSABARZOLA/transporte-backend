/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · versión consolidada
 * Archivo: transporte.dto.spec.ts
 * Responsabilidad: Verificar el patrón de rotación del conductor y las alertas de vencimiento del vehículo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import type { Vehiculo } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  aVehiculoResponse,
  ActualizarConductorDto,
  CrearConductorDto,
} from './transporte.dto';

const errores = async (
  clase: typeof CrearConductorDto | typeof ActualizarConductorDto,
  cuerpo: object,
) =>
  (await validate(plainToInstance(clase, cuerpo)))
    .filter((e) => e.property === 'patronRotacion')
    .flatMap((e) => Object.values(e.constraints ?? {}));

describe('patronRotacion del conductor', () => {
  const base = { cedula: '1712345678', nombreCompleto: 'PÉREZ JUAN' };

  it('admite D/N/E/L/A de 2 a 14 letras, en el alta y en la edición', async () => {
    expect(
      await errores(CrearConductorDto, { ...base, patronRotacion: 'DDNNLL' }),
    ).toEqual([]);
    expect(
      await errores(ActualizarConductorDto, {
        patronRotacion: 'DNEALDNEALDNEA',
      }),
    ).toEqual([]);
    // null limpia el patrón; ausente no lo toca.
    expect(
      await errores(ActualizarConductorDto, { patronRotacion: null }),
    ).toEqual([]);
    expect(await errores(ActualizarConductorDto, {})).toEqual([]);
  });

  it('rechaza letras ajenas, minúsculas, una sola letra o más de 14', async () => {
    for (const patronRotacion of ['DX', 'dn', 'D', 'DDDDDDDDDDDDDDD']) {
      expect(
        await errores(CrearConductorDto, { ...base, patronRotacion }),
      ).toEqual([expect.stringMatching(/de 2 a 14 letras/)]);
    }
  });
});

describe('alertasVencimiento en la respuesta del vehículo', () => {
  const vehiculo = {
    id: 1,
    placa: 'PMA1234',
    descripcion: null,
    activo: true,
    tipo: null,
    asientos: 4,
    kilometraje: null,
    matriculaVencimiento: new Date('2026-10-20T00:00:00.000Z'),
    soatVencimiento: new Date('2026-09-30T00:00:00.000Z'),
  } as unknown as Vehiculo;

  it('usa la anticipación del parámetro y el día de Quito', () => {
    expect(
      aVehiculoResponse(vehiculo, 30, '2026-10-07').alertasVencimiento,
    ).toEqual([
      { documento: 'SOAT', vence: '2026-09-30', dias: -7, estado: 'VENCIDO' },
      {
        documento: 'MATRICULA',
        vence: '2026-10-20',
        dias: 13,
        estado: 'POR_VENCER',
      },
    ]);
    expect(
      aVehiculoResponse(vehiculo, 10, '2026-10-07').alertasVencimiento,
    ).toEqual([
      { documento: 'SOAT', vence: '2026-09-30', dias: -7, estado: 'VENCIDO' },
    ]);
  });
});
