/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte · planificar el día
 * Archivo: preparacion-dia.spec.ts
 * Responsabilidad: Verificar la lista «Antes de asignar» en cada estado.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import { prepararDia, type ConductorParaPreparar } from './preparacion-dia';

const FECHA = new Date(Date.UTC(2026, 9, 7));
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const conductor = (
  id: number,
  cambios: Partial<ConductorParaPreparar> = {},
): ConductorParaPreparar => ({
  id,
  nombreCompleto: `CONDUCTOR ${id}`,
  sector: 'NORTE',
  tipoContrato: 'OCASIONAL',
  parqueaderoAutorizado: false,
  actaParqueaderoNumero: null,
  actaParqueaderoDesde: null,
  actaParqueaderoHasta: null,
  ...cambios,
});

describe('prepararDia', () => {
  it('sin cuadro: no está listo', () => {
    const r = prepararDia({
      fecha: FECHA,
      cuadro: null,
      conductores: [conductor(1)],
      conductoresConTurno: new Set([1]),
    });
    expect(r.cuadro).toEqual({
      existe: false,
      estado: null,
      operativos: 0,
      listo: false,
    });
  });

  it('cuadro sin operativos activos: existe pero no está listo', () => {
    const r = prepararDia({
      fecha: FECHA,
      cuadro: { estado: 'CERRADO', operativos: 0 },
      conductores: [],
      conductoresConTurno: new Set(),
    });
    expect(r.cuadro.existe).toBe(true);
    expect(r.cuadro.listo).toBe(false);
  });

  it('cuadro con operativos (cualquier estado): listo', () => {
    const r = prepararDia({
      fecha: FECHA,
      cuadro: { estado: 'ABIERTO', operativos: 12 },
      conductores: [],
      conductoresConTurno: new Set(),
    });
    expect(r.cuadro.listo).toBe(true);
    expect(r.cuadro.operativos).toBe(12);
  });

  it('turnos no cargados para la fecha', () => {
    const r = prepararDia({
      fecha: FECHA,
      cuadro: null,
      conductores: [conductor(1), conductor(2)],
      conductoresConTurno: new Set(),
    });
    expect(r.turnos).toEqual({
      cargados: false,
      conductoresActivos: 2,
      conductoresConTurno: 0,
      estadoMes: 'BORRADOR',
      publicados: false,
    });
  });

  it('dice el estado del mes: en BORRADOR los turnos cargados aún no cuentan (2026-10-07)', () => {
    const base = {
      fecha: FECHA,
      cuadro: null,
      conductores: [conductor(1)],
      conductoresConTurno: new Set([1]),
    };
    expect(
      prepararDia({ ...base, estadoMes: 'BORRADOR' }).turnos,
    ).toMatchObject({
      cargados: true,
      estadoMes: 'BORRADOR',
      publicados: false,
    });
    expect(
      prepararDia({ ...base, estadoMes: 'PUBLICADO_CON_CAMBIOS' }).turnos,
    ).toMatchObject({ estadoMes: 'PUBLICADO_CON_CAMBIOS', publicados: true });
  });

  it('conductores incompletos: sector, contrato y parqueadero sin acta vigente', () => {
    const r = prepararDia({
      fecha: FECHA,
      cuadro: null,
      conductores: [
        conductor(1),
        conductor(2, { sector: null, tipoContrato: null }),
        conductor(3, { parqueaderoAutorizado: true }),
        conductor(4, {
          parqueaderoAutorizado: true,
          actaParqueaderoNumero: 'ACTA-1',
          actaParqueaderoDesde: dia('2026-01-01'),
          actaParqueaderoHasta: dia('2026-12-31'),
        }),
      ],
      conductoresConTurno: new Set([1, 2, 3, 4]),
    });
    expect(r.conductoresIncompletos).toEqual([
      { id: 2, nombre: 'CONDUCTOR 2', faltan: ['sector', 'contrato'] },
      { id: 3, nombre: 'CONDUCTOR 3', faltan: ['parqueadero'] },
    ]);
    expect(r.turnos.cargados).toBe(true);
  });
});
