/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Flota y garajes
 * Archivo: baja-flota.spec.ts
 * Responsabilidad: Verificar qué impide la baja de un vehículo, un conductor o un garaje (D2).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-20
 */

import {
  bloqueoDeBaja,
  tramosPendientes,
  type TramoParaBaja,
} from './baja-flota';

const HOY = '2026-10-20';
const AHORA = '14:00';

const tramo = (cambios: Partial<TramoParaBaja> = {}): TramoParaBaja => ({
  fecha: HOY,
  horaInicio: '08:00',
  horaFin: '08:30',
  cruzaMedianoche: false,
  identificador: 'OCPMO-001-20-OCT-2026',
  esTarea: false,
  ...cambios,
});

describe('baja-flota · tramosPendientes', () => {
  it('un traslado de hoy que ya terminó no bloquea; uno que termina más tarde sí', () => {
    const pendientes = tramosPendientes(
      [
        tramo(),
        tramo({ horaInicio: '16:00', horaFin: '16:30', identificador: 'B' }),
      ],
      HOY,
      AHORA,
    );
    expect(pendientes.map((t) => t.identificador)).toEqual(['B']);
  });

  it('uno de hoy que cruza la medianoche y uno de un día futuro bloquean', () => {
    const pendientes = tramosPendientes(
      [
        tramo({ fecha: '2026-10-21', identificador: 'MANANA' }),
        tramo({
          horaInicio: '22:00',
          horaFin: '02:00',
          cruzaMedianoche: true,
          identificador: 'NOCHE',
        }),
      ],
      HOY,
      '23:30',
    );
    expect(pendientes.map((t) => t.identificador)).toEqual(['NOCHE', 'MANANA']);
  });
});

describe('baja-flota · bloqueoDeBaja', () => {
  it('sin nada pendiente se puede dar de baja', () => {
    expect(
      bloqueoDeBaja('PMA-7056', { tramos: [tramo()] }, HOY, AHORA),
    ).toBeNull();
  });

  it('el traslado pendiente gana sobre la parada abierta y cuenta los demás', () => {
    const bloqueo = bloqueoDeBaja(
      'El vehículo de placa PMA-7056',
      {
        tramos: [
          tramo({ fecha: '2026-10-22', identificador: 'X' }),
          tramo({ fecha: '2026-10-21', identificador: 'Y' }),
        ],
        paradas: [
          { desde: HOY, hasta: HOY, motivo: null, estado: 'EN_TALLER' },
        ],
      },
      HOY,
      AHORA,
    );
    expect(bloqueo).toEqual({
      tipo: 'ASIGNACION',
      cantidad: 2,
      mensaje:
        'El vehículo de placa PMA-7056 tiene transporte asignado el 21/10/2026 a las 08H00 (el operativo Y) y 1 traslado más. Libere esa asignación en «Planificar el día» antes de darlo de baja.',
    });
  });

  it('una parada LISTO o que ya terminó no bloquea', () => {
    expect(
      bloqueoDeBaja(
        'PMA-7056',
        {
          paradas: [
            { desde: HOY, hasta: '2026-10-25', motivo: null, estado: 'LISTO' },
            {
              desde: '2026-10-01',
              hasta: '2026-10-19',
              motivo: null,
              estado: null,
            },
          ],
        },
        HOY,
        AHORA,
      ),
    ).toBeNull();
  });

  it('una parada abierta (sin estado, de antes de la Fase 5) bloquea con su motivo', () => {
    expect(
      bloqueoDeBaja(
        'El vehículo de placa PMA-7056',
        {
          paradas: [
            {
              desde: HOY,
              hasta: '2026-10-23',
              motivo: 'Revisión técnica',
              estado: null,
            },
          ],
        },
        HOY,
        AHORA,
      )?.mensaje,
    ).toBe(
      'El vehículo de placa PMA-7056 tiene un mantenimiento abierto del 20/10/2026 al 23/10/2026 (Revisión técnica). Retírelo o márquelo como listo en «Programar mantenimiento» antes de darlo de baja.',
    );
  });

  it('el garaje con vehículos que duermen ahí desde hoy; los de ayer no cuentan', () => {
    const bloqueo = bloqueoDeBaja(
      'El garaje Calderón',
      {
        destinos: [
          { fecha: '2026-10-19', placa: 'PMA-1111' },
          { fecha: '2026-10-21', placa: 'PMA-7056' },
          { fecha: HOY, placa: 'PMA-7057' },
        ],
      },
      HOY,
      AHORA,
    );
    expect(bloqueo).toEqual({
      tipo: 'GARAJE_EN_USO',
      cantidad: 2,
      mensaje:
        'El garaje Calderón tiene vehículos que duermen ahí desde el 20/10/2026: PMA-7057, PMA-7056. Cambie su destino en «Planificar el día» antes de darlo de baja.',
    });
  });
});
