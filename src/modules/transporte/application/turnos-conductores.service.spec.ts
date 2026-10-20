/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: turnos-conductores.service.spec.ts
 * Responsabilidad: Verificar la matriz mensual de turnos de conductores (limpiar, lote, publicar, mínimos, reporte, propuesta).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import { EstadoCoberturaMes, TurnoConductor } from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { PlanificacionTransporteRepository } from '../infrastructure/planificacion-transporte.repository';
import type { ParametrosTransporteService } from './parametros-transporte.service';
import type { ReglasRotacion } from './politicas/propuesta-turnos.policy';
import { TurnosConductoresService } from './turnos-conductores.service';

const AUTOR = { usuarioId: 4, rol: 'DAF' as const };
const dia = (d: number) => new Date(Date.UTC(2026, 9, d));

const armar = (
  opciones: {
    turnos?: { conductorId: number; fecha: Date; turno: TurnoConductor }[];
    ausencias?: {
      conductorId: number;
      estado: string;
      desde: Date;
      hasta: Date;
    }[];
    estadoMes?: EstadoCoberturaMes;
    reglas?: Partial<ReglasRotacion>;
    patron?: string | null;
  } = {},
) => {
  let estado = opciones.estadoMes ?? EstadoCoberturaMes.BORRADOR;
  const repositorio = {
    conductoresActivos: jest.fn().mockResolvedValue([
      {
        id: 7,
        nombreCompleto: 'PÉREZ JUAN',
        sector: 'SUR',
        tipoContrato: 'OCASIONAL',
        patronRotacion: opciones.patron ?? null,
      },
      {
        id: 8,
        nombreCompleto: 'ZAMORA ANA',
        sector: 'NORTE',
        tipoContrato: 'NOMBRAMIENTO',
        patronRotacion: null,
      },
    ]),
    turnosEnRango: jest.fn().mockResolvedValue(opciones.turnos ?? []),
    ausenciasConductoresEnRango: jest
      .fn()
      .mockResolvedValue(opciones.ausencias ?? []),
    estadoMes: jest.fn().mockImplementation(() => Promise.resolve(estado)),
    guardarTurno: jest.fn().mockResolvedValue(undefined),
    marcarMesConCambios: jest.fn().mockResolvedValue(undefined),
    publicarMes: jest.fn().mockImplementation(() => {
      estado = EstadoCoberturaMes.PUBLICADO;
      return Promise.resolve();
    }),
    ejecutarEnTransaccion: jest
      .fn()
      .mockImplementation((operacion: (cliente: unknown) => Promise<unknown>) =>
        operacion({}),
      ),
  };
  const servicio = new TurnosConductoresService(
    repositorio as unknown as PlanificacionTransporteRepository,
    {
      registrar: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditoriaService,
    {
      leerRotacion: jest.fn().mockResolvedValue({
        minimosDia: null,
        minimosNoche: null,
        maxDiasSinLibre: null,
        permiteNocheADia: null,
        ...opciones.reglas,
      }),
    } as unknown as ParametrosTransporteService,
  );
  return { servicio, repositorio };
};

describe('Turnos de conductores · matriz', () => {
  it('pinta turnos, ausencias y totales del mes', async () => {
    const { servicio } = armar({
      turnos: [{ conductorId: 7, fecha: dia(1), turno: TurnoConductor.DIA }],
      ausencias: [
        { conductorId: 8, estado: 'VACACIONES', desde: dia(1), hasta: dia(2) },
      ],
    });

    const matriz = await servicio.matriz('2026-10');

    expect(matriz.dias).toHaveLength(31);
    expect(matriz.conductores[0].celdas[0]).toEqual({
      fecha: '2026-10-01',
      estado: 'DIA',
      esAusencia: false,
    });
    expect(matriz.conductores[1].celdas[0]).toEqual({
      fecha: '2026-10-01',
      estado: 'VACACIONES',
      esAusencia: true,
    });
    expect(matriz.totales[0]).toMatchObject({
      dia: 1,
      ausencias: 1,
      sinTurno: 0,
    });
    expect(matriz.totales[2]).toMatchObject({ sinTurno: 2 });
  });
});

describe('Turnos de conductores · edición', () => {
  it('`null` limpia la celda', async () => {
    const { servicio, repositorio } = armar();

    await servicio.editarCelda(7, '2026-10-05', null, AUTOR);

    expect(repositorio.guardarTurno).toHaveBeenCalledWith(
      7,
      dia(5),
      null,
      4,
      expect.anything(),
    );
    expect(repositorio.marcarMesConCambios).toHaveBeenCalledWith(
      '2026-10',
      expect.anything(),
    );
  });

  it('no se edita un día de ausencia', async () => {
    const { servicio, repositorio } = armar({
      ausencias: [
        {
          conductorId: 7,
          estado: 'REPOSO_MEDICO',
          desde: dia(5),
          hasta: dia(6),
        },
      ],
    });

    await expect(
      servicio.editarCelda(7, '2026-10-05', TurnoConductor.NOCHE, AUTOR),
    ).rejects.toBeInstanceOf(ValidacionError);
    expect(repositorio.guardarTurno).not.toHaveBeenCalled();
  });

  it('el lote aplica las válidas y devuelve las omitidas con su motivo', async () => {
    const { servicio, repositorio } = armar({
      ausencias: [
        { conductorId: 7, estado: 'VACACIONES', desde: dia(6), hasta: dia(6) },
      ],
    });

    const resultado = await servicio.editarLote(
      [
        { conductorId: 7, fecha: '2026-10-05', turno: TurnoConductor.DIA },
        { conductorId: 7, fecha: '2026-10-06', turno: TurnoConductor.DIA },
        { conductorId: 99, fecha: '2026-10-05', turno: TurnoConductor.DIA },
      ],
      AUTOR,
    );

    expect(resultado.aplicadas).toBe(1);
    expect(resultado.omitidas.map((o) => [o.conductorId, o.fecha])).toEqual([
      [7, '2026-10-06'],
      [99, '2026-10-05'],
    ]);
    expect(repositorio.guardarTurno).toHaveBeenCalledTimes(1);
  });

  it('una fecha imposible se rechaza', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editarLote(
        [{ conductorId: 7, fecha: '2026-02-30', turno: null }],
        AUTOR,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
  });
});

describe('Turnos de conductores · publicar y rotación', () => {
  it('publicar deja el mes PUBLICADO y cuenta las celdas vacías', async () => {
    const { servicio } = armar();

    const resultado = await servicio.publicarMes('2026-10', AUTOR);

    expect(resultado.estadoMes).toBe(EstadoCoberturaMes.PUBLICADO);
    expect(resultado.celdasVacias).toBe(62);
  });

  it('continúa el ciclo DIA-DIA-LIBRE sobre las celdas vacías', async () => {
    const ciclo = [
      TurnoConductor.DIA,
      TurnoConductor.DIA,
      TurnoConductor.LIBRE,
    ];
    const turnos = Array.from({ length: 12 }, (_, i) => ({
      conductorId: 7,
      fecha: new Date(Date.UTC(2026, 8, 19 + i)),
      turno: ciclo[i % 3],
    }));
    const { servicio } = armar({ turnos });

    const { propuestas, conductores } = await servicio.proponerRotacion(
      '2026-10',
      [7],
    );

    expect(conductores).toBe(1);
    expect(propuestas.slice(0, 3).map((p) => [p.fecha, p.turno])).toEqual([
      ['2026-10-01', 'DIA'],
      ['2026-10-02', 'DIA'],
      ['2026-10-03', 'LIBRE'],
    ]);
  });
});

describe('Turnos de conductores · mínimos en la matriz (2026-10-07)', () => {
  it('sin configurar: minimos null y ningún día bajo mínimo', async () => {
    const { servicio } = armar();
    const matriz = await servicio.matriz('2026-10');
    expect(matriz.minimos).toEqual({ dia: null, noche: null });
    expect(
      matriz.totales.every((t) => !t.bajoMinimo.dia && !t.bajoMinimo.noche),
    ).toBe(true);
  });

  it('marca bajoMinimo por día de la semana; la noche cuenta NOCHE + ECU NOCHE', async () => {
    // 2026-10-01 es jueves (índice 3).
    const { servicio } = armar({
      turnos: [
        { conductorId: 7, fecha: dia(1), turno: TurnoConductor.DIA },
        { conductorId: 8, fecha: dia(1), turno: TurnoConductor.ECU_NOCHE },
      ],
      reglas: {
        minimosDia: [2, 2, 2, 2, 2, 0, 0],
        minimosNoche: [1, 1, 1, 1, 1, 1, 1],
      },
    });
    const matriz = await servicio.matriz('2026-10');
    expect(matriz.minimos).toEqual({
      dia: [2, 2, 2, 2, 2, 0, 0],
      noche: [1, 1, 1, 1, 1, 1, 1],
    });
    expect(matriz.totales[0].bajoMinimo).toEqual({ dia: true, noche: false });
    // 2026-10-03 es sábado: mínimo de día 0 → no está bajo; de noche 1 y hay 0 → sí.
    expect(matriz.totales[2].bajoMinimo).toEqual({ dia: false, noche: true });
  });
});

describe('Turnos de conductores · reporte solo publicado (2026-10-07)', () => {
  it('en BORRADOR responde 409 «Publique el mes antes de exportar el reporte»', async () => {
    const { servicio } = armar();
    const error: unknown = await servicio
      .exportar('2026-10', 'xlsx')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReglaNegocioError);
    expect(error).toMatchObject({
      statusCode: 409,
      code: 'MES_NO_PUBLICADO',
      message: 'Publique el mes antes de exportar el reporte',
    });
  });

  it('publicado: entrega el Excel y el PDF', async () => {
    const { servicio } = armar({
      estadoMes: EstadoCoberturaMes.PUBLICADO_CON_CAMBIOS,
    });
    const xlsx = await servicio.exportar('2026-10', 'xlsx');
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
    const pdf = await servicio.exportar('2026-10', 'pdf');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('Turnos de conductores · proponer el mes (2026-10-07)', () => {
  it('usa el patrón del conductor y no escribe nada', async () => {
    const { servicio, repositorio } = armar({ patron: 'DNL' });
    const r = await servicio.proponerMes('2026-10');
    const suyas = r.propuestas.filter((p) => p.conductorId === 7);
    expect(suyas.slice(0, 3).map((p) => p.turno)).toEqual([
      'DIA',
      'NOCHE',
      'LIBRE',
    ]);
    expect(r.propuestas.some((p) => p.conductorId === 8)).toBe(false);
    expect(r.resumen.celdasALlenar).toBe(62);
    expect(r.resumen.parametrosSinConfigurar).toHaveLength(4);
    expect(repositorio.guardarTurno).not.toHaveBeenCalled();
  });
});
