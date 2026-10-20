/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Flota y garajes
 * Archivo: datos-flota.spec.ts
 * Responsabilidad: Verificar el formato de placa, los faltantes del conductor y los indicadores.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-14
 */

import {
  esGarajeVigente,
  esMismaPlaca,
  esPlacaValida,
  faltantesDeConductor,
  kilometrajeExcedeTope,
  normalizarPlaca,
  resumenDeFlota,
} from './datos-flota';

const dia = (texto: string) => new Date(`${texto}T00:00:00.000Z`);
const HOY = '2026-10-14';

describe('esPlacaValida / normalizarPlaca', () => {
  it.each(['PBA-1235', 'GYE-233'])('acepta %s', (placa) => {
    expect(esPlacaValida(placa)).toBe(true);
  });

  it.each(['PBA1235', 'PB-1235', 'PBA-12', 'PBA-12345', 'pba-1235', '123-ABC'])(
    'rechaza %s',
    (placa) => {
      expect(esPlacaValida(placa)).toBe(false);
    },
  );

  it.each([
    ['PMA3370', 'PMA-3370'],
    ['pma-3370', 'PMA-3370'],
    ['PMA 3370', 'PMA-3370'],
    [' pma - 3370 ', 'PMA-3370'],
    ['gye233', 'GYE-233'],
    ['GYE-233', 'GYE-233'],
  ])('normaliza %s como %s', (entrada, esperada) => {
    expect(normalizarPlaca(entrada)).toBe(esperada);
  });

  it('lo que no tiene forma de placa queda en mayúsculas, sin espacios ni guiones', () => {
    expect(normalizarPlaca('x-1')).toBe('X1');
    expect(normalizarPlaca(' ab 12345 ')).toBe('AB12345');
    expect(esPlacaValida(normalizarPlaca('x-1'))).toBe(false);
  });

  it('es idempotente', () => {
    expect(normalizarPlaca(normalizarPlaca('pma 3370'))).toBe('PMA-3370');
  });

  it('con y sin guion, en minúsculas o con espacios, es la misma placa (duplicado)', () => {
    expect(esMismaPlaca('PMA3370', 'PMA-3370')).toBe(true);
    expect(esMismaPlaca('pma 3370', 'PMA-3370')).toBe(true);
    expect(esMismaPlaca('PMA-3370', 'PMA-3371')).toBe(false);
  });
});

describe('kilometrajeExcedeTope', () => {
  it('solo excede por encima del tope; el tope mismo y vacío son válidos', () => {
    expect(kilometrajeExcedeTope(1_000_000, 999_999)).toBe(true);
    expect(kilometrajeExcedeTope(999_999, 999_999)).toBe(false);
    expect(kilometrajeExcedeTope(0, 999_999)).toBe(false);
    expect(kilometrajeExcedeTope(null, 999_999)).toBe(false);
    expect(kilometrajeExcedeTope(undefined, 999_999)).toBe(false);
  });
});

describe('faltantesDeConductor', () => {
  const completo = {
    vehiculoHabitual: { activo: true },
    tipoContrato: 'OCASIONAL',
    patronRotacion: 'DDDDDLL',
  };

  it('un conductor completo no tiene faltantes', () => {
    expect(faltantesDeConductor(completo)).toEqual([]);
  });

  it('sin vehículo, o con uno dado de baja, falta el vehículo habitual', () => {
    expect(
      faltantesDeConductor({ ...completo, vehiculoHabitual: null }),
    ).toEqual(['VEHICULO_HABITUAL']);
    expect(
      faltantesDeConductor({
        ...completo,
        vehiculoHabitual: { activo: false },
      }),
    ).toEqual(['VEHICULO_HABITUAL']);
  });

  it('lista contrato y patrón que faltan, en orden', () => {
    expect(
      faltantesDeConductor({
        vehiculoHabitual: null,
        tipoContrato: null,
        patronRotacion: null,
      }),
    ).toEqual(['VEHICULO_HABITUAL', 'TIPO_CONTRATO', 'PATRON_ROTACION']);
  });
});

describe('esGarajeVigente', () => {
  it('solo activo y autorizado', () => {
    expect(esGarajeVigente({ activo: true, garajeAutorizado: true })).toBe(
      true,
    );
    expect(esGarajeVigente({ activo: true, garajeAutorizado: false })).toBe(
      false,
    );
    expect(esGarajeVigente({ activo: false, garajeAutorizado: true })).toBe(
      false,
    );
  });
});

describe('resumenDeFlota', () => {
  const vehiculos = [
    // Al día, con conductor activo.
    {
      id: 1,
      activo: true,
      matriculaVencimiento: dia('2027-06-01'),
      soatVencimiento: dia('2027-06-01'),
    },
    // SOAT por vencer, sin conductor.
    {
      id: 2,
      activo: true,
      matriculaVencimiento: null,
      soatVencimiento: dia('2026-11-02'),
    },
    // Matrícula vencida; su único conductor está dado de baja.
    {
      id: 3,
      activo: true,
      matriculaVencimiento: dia('2026-09-30'),
      soatVencimiento: null,
    },
    // Sin ninguna fecha: un dato faltante, cuenta aparte (A5).
    {
      id: 5,
      activo: true,
      matriculaVencimiento: null,
      soatVencimiento: null,
    },
    // Dado de baja con todo vencido: no cuenta en los avisos.
    {
      id: 4,
      activo: false,
      matriculaVencimiento: dia('2020-01-01'),
      soatVencimiento: null,
    },
  ];
  const conductores = [
    {
      activo: true,
      vehiculoHabitualId: 1,
      vehiculoHabitual: { activo: true },
      tipoContrato: 'OCASIONAL',
      patronRotacion: 'DDDDDLL',
    },
    {
      activo: true,
      vehiculoHabitualId: 4,
      vehiculoHabitual: { activo: false },
      tipoContrato: null,
      patronRotacion: 'NNLL',
    },
    {
      activo: false,
      vehiculoHabitualId: 3,
      vehiculoHabitual: { activo: true },
      tipoContrato: null,
      patronRotacion: null,
    },
  ];
  const garajes = [
    { activo: true, garajeAutorizado: true },
    { activo: true, garajeAutorizado: false },
    { activo: false, garajeAutorizado: false },
  ];

  it('cuenta solo lo activo y un garaje no autorizado como de baja', () => {
    expect(resumenDeFlota(vehiculos, conductores, garajes, HOY, 30)).toEqual({
      vehiculos: {
        activos: 4,
        deBaja: 1,
        documentosPorVencer: 2,
        sinFechas: 1,
        sinConductorHabitual: 3,
        enTallerHoy: 0,
      },
      conductores: { activos: 2, deBaja: 1, incompletos: 1 },
      garajes: { vigentes: 1, deBaja: 2 },
    });
  });

  it('«en taller hoy» cuenta solo los activos que vienen en el taller (2026-10-20)', () => {
    // El 4 está de baja: aunque tenga la cita, no se ofrece y no cuenta.
    expect(
      resumenDeFlota(vehiculos, conductores, garajes, HOY, 30, [1, 3, 4, null])
        .vehiculos.enTallerHoy,
    ).toBe(2);
  });

  it('«por vencer» cuenta vencidos y por vencer; «sin fechas» no entra ahí', () => {
    const { vehiculos: v } = resumenDeFlota(
      vehiculos,
      conductores,
      garajes,
      HOY,
      30,
    );
    expect(v.documentosPorVencer + v.sinFechas).toBe(3);
  });

  it('el aviso cambia el conteo de documentos', () => {
    expect(
      resumenDeFlota(vehiculos, conductores, garajes, HOY, 10).vehiculos
        .documentosPorVencer,
    ).toBe(1);
  });

  it('«sin fechas» suma a los que les falta una de las dos (INCOMPLETO)', () => {
    // Con 10 días, el SOAT del vehículo 2 (a 19 días) ya no avisa y le falta la matrícula.
    expect(
      resumenDeFlota(vehiculos, conductores, garajes, HOY, 10).vehiculos
        .sinFechas,
    ).toBe(2);
  });
});
