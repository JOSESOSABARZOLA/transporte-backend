/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · línea de tiempo por conductor
 * Archivo: planificacion-transporte.service.spec.ts
 * Responsabilidad: Verificar la generación de tramos, la asignación y la sincronización con el operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * LO QUE ESTAS PRUEBAS PROTEGEN: que los tramos nazcan del tipo de transporte pedido, que un ✕ de
 * la política RECHACE la asignación sin escribir nada, y que `operativo.conductorId/vehiculoId` siga
 * al PRIMER tramo asignado (regla 10: la orden de servicio y la matriz leen de ahí).
 */

import { EstadoTransporte } from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { OperativosService } from '../../operativos/application/operativos.service';
import type {
  ElegibilidadService,
  EvaluadorConduccion,
} from '../../talento-operativo/application/elegibilidad.service';
import type { PlanificacionTransporteRepository } from '../infrastructure/planificacion-transporte.repository';
import type {
  ParametrosPlanificacion,
  ParametrosTransporteService,
} from './parametros-transporte.service';
import { PlanificacionTransporteService } from './planificacion-transporte.service';
import { franjaDe } from './politicas/linea-de-tiempo';

/** Miércoles: sin reglas de fin de semana. */
const FECHA = new Date(Date.UTC(2026, 9, 7));
const AUTOR = { usuarioId: 4, rol: 'DAF' as const };
const ZONAL = { id: 1, nombre: 'ELOY ALFARO', sector: 'SUR' };

const PARAMETROS: ParametrosPlanificacion = {
  inicioJornada: '05:00',
  duracionTramo: { dejar: 30, retirar: 30 },
  huecoMinimoMin: 60,
  ventanaNombramiento: franjaDe('08:00', '16:30', '05:00'),
  ventanasTurno: {
    DIA: franjaDe('06:00', '18:00', '05:00'),
    NOCHE: franjaDe('18:00', '06:00', '05:00'),
    ECU_NOCHE: franjaDe('20:00', '05:00', '05:00'),
  },
  asignacion: {
    maxJornadaHoras: 14,
    jornadaAvisoHoras: 12,
    descansoMinHoras: 9,
    traslado: { mismaZona: 15, mismoSector: 30, otroSector: 60 },
    costoAviso: 30,
    costoActivarLibre: 120,
    costoArranqueLejos: 20,
  },
};

interface TramoFalso {
  id: number;
  operativoId: number | null;
  fecha: Date;
  tipo: string;
  horaInicio: string;
  horaFin: string;
  cruzaMedianoche: boolean;
  conductorId: number | null;
  vehiculoId: number | null;
  zonalOrigenId: number | null;
  zonalDestinoId: number | null;
  compartidoConTramoId: number | null;
  descripcion: string | null;
  operativo: { id: number; identificador: string; formularioId: number } | null;
  conductor: { id: number; nombreCompleto: string } | null;
  vehiculo: { id: number; placa: string } | null;
  zonalOrigen: typeof ZONAL | null;
  zonalDestino: typeof ZONAL | null;
}

const operativo = (
  id: number,
  horaInicio: string,
  horaFin: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  identificador: `OPE-00${id}`,
  horaInicio,
  horaFin,
  cruzaMedianoche: false,
  tipoTransporte: 'COMPLETO',
  esMacrooperativo: false,
  estadoTransporte: EstadoTransporte.PENDIENTE,
  conductorId: null as number | null,
  vehiculoId: null as number | null,
  creadoPorRol: 'DMIP_OPERATIVOS',
  formulario: { numero: 1, nombre: 'Operativos' },
  zonales: [{ orden: 1, zonal: ZONAL }],
  personal: [
    { funcionarioId: 100 + id, funcionario: { apellidos: 'A', nombres: 'B' } },
  ],
  cuadro: { fecha: FECHA },
  ...extra,
});

const tramo = (
  id: number,
  operativoId: number,
  horaInicio: string,
  horaFin: string,
  extra: Partial<TramoFalso> = {},
): TramoFalso => ({
  id,
  operativoId,
  fecha: FECHA,
  tipo: 'COMPLETO',
  horaInicio,
  horaFin,
  cruzaMedianoche: false,
  conductorId: null,
  vehiculoId: null,
  zonalOrigenId: ZONAL.id,
  zonalDestinoId: ZONAL.id,
  compartidoConTramoId: null,
  descripcion: null,
  operativo: {
    id: operativoId,
    identificador: `OPE-00${operativoId}`,
    formularioId: 1,
  },
  conductor: null,
  vehiculo: null,
  zonalOrigen: ZONAL,
  zonalDestino: ZONAL,
  ...extra,
});

const CONDUCTOR = {
  id: 7,
  nombreCompleto: 'PÉREZ JUAN',
  sector: 'SUR',
  tipoContrato: null,
  parqueaderoAutorizado: false,
  actaParqueaderoNumero: null,
  actaParqueaderoDesde: null,
  actaParqueaderoHasta: null,
  vehiculoHabitualId: 80,
};

const armar = (
  opciones: {
    operativos?: ReturnType<typeof operativo>[];
    tramos?: TramoFalso[];
    turnos?: { conductorId: number; fecha: Date; turno: string }[];
    activaciones?: { conductorId: number }[];
    asignadosDelConductor?: number;
    /** RN-44/RN-25 (2026-10-14): lo que decide talento-operativo por conductor y bloque. */
    restriccion?: EvaluadorConduccion;
  } = {},
) => {
  const operativos = opciones.operativos ?? [operativo(1, '08:00', '12:00')];
  const tramos = [...(opciones.tramos ?? [])];
  let siguiente = 500;

  const repositorio = {
    operativosDeFecha: jest.fn().mockResolvedValue(operativos),
    operativosPorId: jest
      .fn()
      .mockImplementation((ids: number[]) =>
        Promise.resolve(operativos.filter((o) => ids.includes(o.id))),
      ),
    tramosDeOperativos: jest
      .fn()
      .mockImplementation((ids: number[]) =>
        Promise.resolve(
          tramos.filter(
            (t) => t.operativoId !== null && ids.includes(t.operativoId),
          ),
        ),
      ),
    tramosDeFecha: jest
      .fn()
      .mockImplementation(() => Promise.resolve([...tramos])),
    tramosAsignadosEnFechas: jest.fn().mockResolvedValue([]),
    buscarTramo: jest
      .fn()
      .mockImplementation((id: number) =>
        Promise.resolve(tramos.find((t) => t.id === id) ?? null),
      ),
    crearTramos: jest
      .fn()
      .mockImplementation((nuevos: Omit<TramoFalso, 'id'>[]) => {
        for (const n of nuevos) {
          tramos.push(
            tramo(
              siguiente++,
              n.operativoId as number,
              n.horaInicio,
              n.horaFin,
              { tipo: n.tipo },
            ),
          );
        }
        return Promise.resolve();
      }),
    crearTramosDevolviendo: jest
      .fn()
      .mockImplementation((nuevos: Partial<TramoFalso>[]) =>
        Promise.resolve(
          nuevos.map((n) => {
            const creado = tramo(
              siguiente++,
              n.operativoId as number,
              n.horaInicio as string,
              n.horaFin as string,
              {
                tipo: n.tipo,
                conductorId: n.conductorId ?? null,
                vehiculoId: n.vehiculoId ?? null,
              },
            );
            tramos.push(creado);
            return {
              id: creado.id,
              tipo: creado.tipo,
              conductorId: creado.conductorId,
              vehiculoId: creado.vehiculoId,
            };
          }),
        ),
      ),
    asignarTramos: jest
      .fn()
      .mockImplementation(
        (
          ids: number[],
          conductorId: number | null,
          vehiculoId: number | null,
        ) => {
          for (const t of tramos) {
            if (ids.includes(t.id))
              Object.assign(t, {
                conductorId,
                vehiculoId,
                compartidoConTramoId: null,
              });
          }
          return Promise.resolve();
        },
      ),
    // Compartir unidad (2026-10-19): suelta a los invitados de unos anfitriones.
    liberarInvitados: jest
      .fn()
      .mockImplementation((anfitriones: number[], excluir: number[]) => {
        const sueltos = tramos
          .filter(
            (t) =>
              t.compartidoConTramoId !== null &&
              anfitriones.includes(t.compartidoConTramoId) &&
              !excluir.includes(t.id),
          )
          .map((t) => ({
            id: t.id,
            operativoId: t.operativoId,
            conductorId: t.conductorId,
            vehiculoId: t.vehiculoId,
            compartidoConTramoId: t.compartidoConTramoId,
          }));
        for (const s of sueltos)
          Object.assign(tramos.find((t) => t.id === s.id) as TramoFalso, {
            conductorId: null,
            vehiculoId: null,
            compartidoConTramoId: null,
          });
        return Promise.resolve(sueltos);
      }),
    compartirTramo: jest.fn().mockImplementation(
      (
        tramoId: number,
        anfitrion: {
          id: number;
          conductorId: number;
          vehiculoId: number | null;
        },
      ) => {
        Object.assign(tramos.find((t) => t.id === tramoId) as TramoFalso, {
          compartidoConTramoId: anfitrion.id,
          conductorId: anfitrion.conductorId,
          vehiculoId: anfitrion.vehiculoId,
        });
        return Promise.resolve();
      },
    ),
    traslados: jest.fn().mockResolvedValue([]),
    conductoresActivos: jest.fn().mockResolvedValue([
      CONDUCTOR,
      {
        ...CONDUCTOR,
        id: 8,
        nombreCompleto: 'ZAMORA ANA',
        vehiculoHabitualId: 81,
      },
    ]),
    vehiculosActivos: jest.fn().mockResolvedValue([
      { id: 80, placa: 'PMA7056', asientos: 10 },
      { id: 81, placa: 'PMA7057', asientos: 10 },
    ]),
    turnosPublicadosEnRango: jest.fn().mockResolvedValue(opciones.turnos ?? []),
    activacionesDe: jest.fn().mockResolvedValue(opciones.activaciones ?? []),
    conductoresAusentes: jest.fn().mockResolvedValue(new Set<number>()),
    vehiculosEnTaller: jest.fn().mockResolvedValue(new Set<number>()),
    destinosDe: jest.fn().mockResolvedValue([]),
    activar: jest.fn().mockResolvedValue({ id: 9 }),
    desactivar: jest.fn().mockResolvedValue(1),
    tramosAsignadosDelConductor: jest
      .fn()
      .mockResolvedValue(opciones.asignadosDelConductor ?? 0),
    ejecutarEnTransaccion: jest
      .fn()
      .mockImplementation((operacion: (cliente: unknown) => Promise<unknown>) =>
        operacion({}),
      ),
  };

  const operativosServicio = {
    asignarTransporte: jest.fn().mockResolvedValue(undefined),
    desasignarTransporte: jest.fn().mockResolvedValue(undefined),
  };
  const registrar = jest.fn().mockResolvedValue(undefined);
  const registrarVarios = jest.fn().mockResolvedValue(undefined);

  const servicio = new PlanificacionTransporteService(
    repositorio as unknown as PlanificacionTransporteRepository,
    {
      leer: jest.fn().mockResolvedValue(PARAMETROS),
      leerOptimizacion: jest.fn().mockResolvedValue({
        compartirVentanaMin: 30,
        guardaHoraTarde: '20:00',
        duracionTareaTallerMin: 60,
      }),
    } as unknown as ParametrosTransporteService,
    operativosServicio as unknown as OperativosService,
    { registrar, registrarVarios } as unknown as AuditoriaService,
    {
      evaluadorDeConduccion: jest
        .fn()
        .mockResolvedValue(opciones.restriccion ?? (() => [])),
    } as unknown as ElegibilidadService,
  );

  return {
    servicio,
    repositorio,
    operativosServicio,
    registrar,
    registrarVarios,
    tramos,
  };
};

const capturar = async (promesa: Promise<unknown>): Promise<unknown> =>
  promesa.catch((error: unknown) => error);

describe('Generar los tramos del día', () => {
  it('un PMO de inicio y fin pide dejar y retirar, no el operativo entero', async () => {
    const { servicio, tramos } = armar({
      operativos: [
        operativo(1, '08:00', '16:00', { tipoTransporte: 'INICIO_Y_FIN' }),
      ],
    });

    const { generados } = await servicio.generarTramosDelDia(FECHA, AUTOR);

    expect(generados).toBe(2);
    expect(tramos.map((t) => [t.tipo, t.horaInicio, t.horaFin])).toEqual([
      ['DEJAR', '08:00', '08:30'],
      ['RETIRAR', '15:30', '16:00'],
    ]);
  });

  it('es idempotente: un operativo con tramos no se vuelve a generar', async () => {
    const { servicio, repositorio } = armar({
      tramos: [tramo(1, 1, '08:00', '12:00')],
    });

    const { generados } = await servicio.generarTramosDelDia(FECHA, AUTOR);

    expect(generados).toBe(0);
    expect(repositorio.crearTramos).not.toHaveBeenCalled();
  });

  it('propios medios no pide transporte', async () => {
    const { servicio } = armar({
      operativos: [
        operativo(1, '08:00', '12:00', { tipoTransporte: 'PROPIOS_MEDIOS' }),
      ],
    });

    expect((await servicio.generarTramosDelDia(FECHA, AUTOR)).generados).toBe(
      0,
    );
  });
});

describe('Asignar un bloque y sincronizar el operativo (regla 10)', () => {
  it('asigna los tramos y el operativo toma el conductor y vehículo del primero', async () => {
    const { servicio, repositorio, operativosServicio } = armar({
      tramos: [tramo(10, 1, '08:00', '12:00')],
    });

    const { evaluacion, tramosAsignados } = await servicio.asignarBloque(
      { fecha: FECHA, operativoIds: [1], conductorId: 7, vehiculoId: 80 },
      AUTOR,
    );

    expect(evaluacion.estado).toBe('OK');
    expect(tramosAsignados).toBe(1);
    expect(repositorio.asignarTramos).toHaveBeenCalledWith(
      [10],
      7,
      80,
      expect.anything(),
    );
    expect(operativosServicio.asignarTransporte).toHaveBeenCalledWith(
      1,
      { conductorId: 7, vehiculoId: 80 },
      AUTOR,
    );
  });

  it('genera los tramos que falten antes de asignar', async () => {
    const { servicio, repositorio } = armar();

    await servicio.asignarBloque(
      { fecha: FECHA, operativoIds: [1], conductorId: 7, vehiculoId: 80 },
      AUTOR,
    );

    expect(repositorio.crearTramos).toHaveBeenCalled();
    expect(repositorio.asignarTramos).toHaveBeenCalledWith(
      [500],
      7,
      80,
      expect.anything(),
    );
  });

  it('un ✕ de la política (se pisa) rechaza con ASIGNACION_NO_VIABLE y no escribe', async () => {
    const { servicio, repositorio, operativosServicio } = armar({
      operativos: [
        operativo(1, '08:00', '12:00'),
        operativo(2, '10:00', '14:00'),
      ],
      tramos: [
        tramo(10, 1, '08:00', '12:00', { conductorId: 7, vehiculoId: 80 }),
        tramo(11, 2, '10:00', '14:00'),
      ],
    });

    const fallo = await capturar(
      servicio.asignarBloque(
        { fecha: FECHA, operativoIds: [2], conductorId: 7, vehiculoId: 80 },
        AUTOR,
      ),
    );

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).code).toBe('ASIGNACION_NO_VIABLE');
    expect(repositorio.asignarTramos).not.toHaveBeenCalled();
    expect(operativosServicio.asignarTransporte).not.toHaveBeenCalled();
  });

  it('la misma placa con otro conductor en horario cruzado es VEHICULO_OCUPADO', async () => {
    const { servicio, repositorio } = armar({
      operativos: [
        operativo(1, '08:00', '12:00'),
        operativo(2, '10:00', '14:00'),
      ],
      tramos: [
        tramo(10, 1, '08:00', '12:00', { conductorId: 8, vehiculoId: 80 }),
        tramo(11, 2, '10:00', '14:00'),
      ],
    });

    const fallo = await capturar(
      servicio.asignarBloque(
        { fecha: FECHA, operativoIds: [2], conductorId: 7, vehiculoId: 80 },
        AUTOR,
      ),
    );

    expect((fallo as ReglaNegocioError).code).toBe('VEHICULO_OCUPADO');
    expect(repositorio.asignarTramos).not.toHaveBeenCalled();
  });

  it('un conductor LIBRE sin activar no se asigna; activado sí', async () => {
    const turnos = [{ conductorId: 7, fecha: FECHA, turno: 'LIBRE' }];
    const sinActivar = armar({
      tramos: [tramo(10, 1, '08:00', '12:00')],
      turnos,
    });
    const fallo = await capturar(
      sinActivar.servicio.asignarBloque(
        { fecha: FECHA, operativoIds: [1], conductorId: 7, vehiculoId: 80 },
        AUTOR,
      ),
    );
    expect((fallo as ReglaNegocioError).code).toBe('ASIGNACION_NO_VIABLE');

    const activado = armar({
      tramos: [tramo(10, 1, '08:00', '12:00')],
      turnos,
      activaciones: [{ conductorId: 7 }],
    });
    const { evaluacion } = await activado.servicio.asignarBloque(
      { fecha: FECHA, operativoIds: [1], conductorId: 7, vehiculoId: 80 },
      AUTOR,
    );
    expect(evaluacion.estado).toBe('AVISO');
  });

  it('quitar el único tramo asignado devuelve el operativo a PENDIENTE', async () => {
    const { servicio, repositorio, operativosServicio } = armar({
      operativos: [
        operativo(1, '08:00', '12:00', {
          estadoTransporte: EstadoTransporte.ASIGNADO,
          conductorId: 7,
          vehiculoId: 80,
        }),
      ],
      tramos: [
        tramo(10, 1, '08:00', '12:00', { conductorId: 7, vehiculoId: 80 }),
      ],
    });

    await servicio.quitarTramo(10, AUTOR);

    expect(repositorio.asignarTramos).toHaveBeenCalledWith(
      [10],
      null,
      null,
      expect.anything(),
    );
    expect(operativosServicio.desasignarTransporte).toHaveBeenCalledWith(
      1,
      AUTOR,
    );
  });

  it('un operativo de propios medios no se toca al sincronizar', async () => {
    const { servicio, operativosServicio } = armar({
      operativos: [
        operativo(1, '08:00', '12:00', {
          estadoTransporte: EstadoTransporte.PROPIOS_MEDIOS,
        }),
      ],
      tramos: [
        tramo(10, 1, '08:00', '12:00', { conductorId: 7, vehiculoId: 80 }),
      ],
    });

    await servicio.sincronizarOperativos([1], AUTOR);

    expect(operativosServicio.asignarTransporte).not.toHaveBeenCalled();
    expect(operativosServicio.desasignarTransporte).not.toHaveBeenCalled();
  });
});

describe('Una sola fuente de ocupación: los tramos (2026-10-14)', () => {
  it('el conductor de un «dejar y retirar» queda libre en el intervalo medio', async () => {
    const { servicio, repositorio } = armar({
      operativos: [
        operativo(1, '08:00', '16:00', { tipoTransporte: 'INICIO_Y_FIN' }),
        operativo(2, '10:00', '12:00'),
      ],
      tramos: [
        tramo(10, 1, '08:00', '08:30', {
          tipo: 'DEJAR',
          conductorId: 7,
          vehiculoId: 80,
        }),
        tramo(11, 1, '15:30', '16:00', {
          tipo: 'RETIRAR',
          conductorId: 7,
          vehiculoId: 80,
        }),
        tramo(12, 2, '10:00', '12:00'),
      ],
    });

    const { evaluacion } = await servicio.asignarBloque(
      { fecha: FECHA, operativoIds: [2], conductorId: 7, vehiculoId: 80 },
      AUTOR,
    );

    // Entre el «dejar» (08H30) y el «retirar» (15H30) el conductor y su placa están libres.
    expect(evaluacion.estado).not.toBe('DURO');
    expect(repositorio.asignarTramos).toHaveBeenCalledWith(
      [12],
      7,
      80,
      expect.anything(),
    );
  });

  it('RN-44 · la patrulla consecutiva que decide talento-operativo es un ✕ y no escribe', async () => {
    const restriccion = jest.fn().mockReturnValue([
      {
        elegible: false,
        codigo: 'CONDUCTOR_PATRULLA_CONSECUTIVA',
        motivo:
          'PÉREZ JUAN condujo en patrulla el día anterior y no puede repetir.',
      },
    ]);
    const { servicio, repositorio } = armar({
      operativos: [
        operativo(1, '08:00', '12:00', {
          formulario: { numero: 5, nombre: 'Patrulla', esPatrulla: true },
        }),
      ],
      tramos: [tramo(10, 1, '08:00', '12:00')],
      restriccion,
    });

    const fallo = (await capturar(
      servicio.asignarBloque(
        { fecha: FECHA, operativoIds: [1], conductorId: 7, vehiculoId: 80 },
        AUTOR,
      ),
    )) as ReglaNegocioError;

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect(fallo.message).toContain('condujo en patrulla');
    expect(restriccion).toHaveBeenCalledWith(7, {
      esPatrulla: true,
      esNocturno: false,
      operativoIds: [1],
    });
    expect(repositorio.asignarTramos).not.toHaveBeenCalled();
  });

  it('RN-25 · el tope de salidas pesadas aparece como ✕ en la evaluación', async () => {
    const { servicio } = armar({
      tramos: [tramo(10, 1, '08:00', '12:00')],
      restriccion: (conductorId) =>
        conductorId === 7
          ? [
              {
                elegible: false,
                codigo: 'TOPE_SALIDAS_PESADAS',
                motivo: 'PÉREZ JUAN alcanzó el tope de 3 salidas nocturnas.',
              },
            ]
          : [],
    });

    const evaluaciones = await servicio.evaluarBloque(FECHA, [1]);
    const perez = evaluaciones.find((e) => e.conductorId === 7);

    expect(perez?.estado).toBe('DURO');
    expect(perez?.motivos.map((m) => m.codigo)).toContain(
      'TOPE_SALIDAS_PESADAS',
    );
    expect(evaluaciones.find((e) => e.conductorId === 8)?.estado).toBe('OK');
  });

  it('liberar un operativo vacía TODOS sus tramos, con traza por tramo, y lo devuelve a PENDIENTE', async () => {
    const { servicio, repositorio, operativosServicio, registrar } = armar({
      operativos: [
        operativo(1, '08:00', '16:00', {
          tipoTransporte: 'INICIO_Y_FIN',
          estadoTransporte: EstadoTransporte.ASIGNADO,
          conductorId: 7,
          vehiculoId: 80,
        }),
      ],
      tramos: [
        tramo(10, 1, '08:00', '08:30', { conductorId: 7, vehiculoId: 80 }),
        tramo(11, 1, '15:30', '16:00', { conductorId: 7, vehiculoId: 80 }),
      ],
    });

    expect(await servicio.liberarOperativo(1, AUTOR)).toBe(2);
    expect(repositorio.asignarTramos).toHaveBeenCalledWith(
      [10, 11],
      null,
      null,
      expect.anything(),
    );
    expect(registrar).toHaveBeenCalledTimes(2);
    expect(operativosServicio.desasignarTransporte).toHaveBeenCalledWith(
      1,
      AUTOR,
    );
  });
});

describe('Evaluar un bloque', () => {
  it('ordena ✓ antes que ✕', async () => {
    const { servicio } = armar({
      operativos: [
        operativo(1, '08:00', '12:00'),
        operativo(2, '10:00', '14:00'),
      ],
      tramos: [
        tramo(10, 1, '08:00', '12:00', { conductorId: 7, vehiculoId: 80 }),
        tramo(11, 2, '10:00', '14:00'),
      ],
    });

    const resultado = await servicio.evaluarBloque(FECHA, [2]);

    expect(resultado.map((r) => [r.conductorId, r.estado])).toEqual([
      [8, 'OK'],
      [7, 'DURO'],
    ]);
  });
});

describe('Activación de libres', () => {
  it('exige un motivo', async () => {
    const { servicio, repositorio } = armar();

    const fallo = await capturar(servicio.activarLibre(7, FECHA, '  ', AUTOR));

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect(repositorio.activar).not.toHaveBeenCalled();
  });

  it('activa y deja traza', async () => {
    const { servicio, repositorio, registrar } = armar();

    await servicio.activarLibre(7, FECHA, 'Macrooperativo del sábado', AUTOR);

    expect(repositorio.activar).toHaveBeenCalledWith(
      7,
      FECHA,
      'Macrooperativo del sábado',
      4,
      expect.anything(),
    );
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 't_activacion_conductor' }),
      expect.anything(),
    );
  });

  it('no se retira la activación de quien ya tiene tramos ese día', async () => {
    const { servicio, repositorio } = armar({ asignadosDelConductor: 2 });

    const fallo = await capturar(servicio.desactivarLibre(7, FECHA, AUTOR));

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect(repositorio.desactivar).not.toHaveBeenCalled();
  });
});

describe('Plan del día · escala de la línea y nombres de unidad (2026-10-07)', () => {
  it('las ventanas viajan en minutos DESDE el inicio de la jornada, no desde las 00H00', async () => {
    const { servicio } = armar();
    const plan = await servicio.planDelDia(FECHA);
    // DIA 06:00–18:00 con inicio 05:00 → {60, 780}; nombramiento 08:00–16:30 → {180, 690}.
    expect(plan.ventanasTurno.DIA).toEqual({ inicio: 60, fin: 780 });
    expect(plan.ventanasTurno.NOCHE).toEqual({ inicio: 780, fin: 1500 });
    expect(plan.ventanaNombramiento).toEqual({ inicio: 180, fin: 690 });
  });

  it('el departamento se nombra en palabras y conserva su código', async () => {
    const { servicio } = armar();
    const plan = await servicio.planDelDia(FECHA);
    expect(plan.operativos[0]).toMatchObject({
      departamento: 'DMIP · Unidad de Operativos',
      departamentoCodigo: 'DMIP_OPERATIVOS',
    });
  });
});

describe('El adicional hereda el transporte de su original, por tramos (2026-10-14)', () => {
  /** Los asientos que dejó la herencia: el de cada tramo y el `transporte` del adicional. */
  const asientos = (registrarVarios: jest.Mock) =>
    (
      registrarVarios.mock.calls[0] as [
        {
          entidad: string;
          entidadId: number;
          cambios: { campo: string; valorNuevo: string }[];
        }[],
      ]
    )[0];
  const textoTransporte = (registrarVarios: jest.Mock) =>
    asientos(registrarVarios)
      .find((a) => a.entidad === 't_operativo')
      ?.cambios.find((c) => c.campo === 'transporte')?.valorNuevo;

  it('crea los tramos del adicional ya asignados al conductor y vehículo del original', async () => {
    const { servicio, repositorio, registrarVarios, operativosServicio } =
      armar({
        operativos: [
          operativo(1, '08:00', '12:00', { conductorId: 7, vehiculoId: 80 }),
          operativo(2, '13:00', '15:00', { origenId: 1 }),
        ],
        tramos: [
          tramo(10, 1, '08:00', '12:00', { conductorId: 7, vehiculoId: 80 }),
        ],
      });

    const resultado = await servicio.heredarDeOriginal(
      { padreId: 1, adicionalId: 2 },
      AUTOR,
    );

    expect(resultado).toEqual({ heredado: true, motivo: null });
    expect(repositorio.crearTramosDevolviendo).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          operativoId: 2,
          tipo: 'COMPLETO',
          conductorId: 7,
          vehiculoId: 80,
        }),
      ],
      expect.anything(),
    );
    // Una traza por tramo heredado, que dice de dónde salió, y el asiento del adicional.
    const tramoHeredado = asientos(registrarVarios).find(
      (a) => a.entidad === 't_tramo_transporte',
    );
    expect(tramoHeredado?.cambios).toEqual(
      expect.arrayContaining([
        { campo: 'cond_id', valorNuevo: '7' },
        {
          campo: 'herencia',
          valorNuevo: 'heredado de OPE-001, donde lo asignó la DAF',
        },
      ]),
    );
    expect(textoTransporte(registrarVarios)).toBe(
      'heredado de OPE-001, donde lo asignó la DAF',
    );
    // El reflejo del operativo se sincroniza con el primer tramo (regla 10).
    expect(operativosServicio.asignarTransporte).toHaveBeenCalledWith(
      2,
      { conductorId: 7, vehiculoId: 80 },
      AUTOR,
    );
  });

  it('si el conductor no puede, el adicional nace PENDIENTE y la traza dice por qué', async () => {
    const { servicio, repositorio, registrarVarios, operativosServicio } =
      armar({
        operativos: [
          operativo(1, '08:00', '12:00', { conductorId: 7, vehiculoId: 80 }),
          // Se cruza con el original: el mismo conductor no puede estar en los dos (RN-28).
          operativo(2, '11:00', '13:00', { origenId: 1 }),
        ],
        tramos: [
          tramo(10, 1, '08:00', '12:00', { conductorId: 7, vehiculoId: 80 }),
        ],
      });

    const resultado = await servicio.heredarDeOriginal(
      { padreId: 1, adicionalId: 2 },
      AUTOR,
    );

    expect(resultado.heredado).toBe(false);
    expect(resultado.motivo).toContain('Se pisa con OPE-001');
    // Los tramos nacen igual, LIBRES: la DAF los asigna como cualquier otro.
    expect(repositorio.crearTramosDevolviendo).toHaveBeenCalledWith(
      [expect.objectContaining({ conductorId: null, vehiculoId: null })],
      expect.anything(),
    );
    expect(textoTransporte(registrarVarios)).toContain(
      'sin heredar · No se puede asignar a PÉREZ JUAN',
    );
    expect(operativosServicio.asignarTransporte).not.toHaveBeenCalled();
  });

  it('si el original no tenía transporte, no hereda y lo deja asentado', async () => {
    const { servicio, repositorio, registrar } = armar({
      operativos: [
        operativo(1, '08:00', '12:00'),
        operativo(2, '13:00', '15:00', { origenId: 1 }),
      ],
    });

    const resultado = await servicio.heredarDeOriginal(
      { padreId: 1, adicionalId: 2 },
      AUTOR,
    );

    expect(resultado).toEqual({ heredado: false, motivo: null });
    expect(repositorio.crearTramosDevolviendo).not.toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_operativo',
        entidadId: 2,
        cambios: [
          {
            campo: 'transporte',
            valorNuevo:
              'sin heredar · el operativo original no tenía transporte asignado',
          },
        ],
      }),
    );
  });

  it('«dejar y retirar» con dos conductores: cada tramo recibe el del tramo del mismo tipo', async () => {
    const { servicio, repositorio } = armar({
      operativos: [
        operativo(1, '08:00', '16:00', {
          tipoTransporte: 'INICIO_Y_FIN',
          conductorId: 7,
          vehiculoId: 80,
        }),
        operativo(2, '17:00', '21:00', {
          tipoTransporte: 'INICIO_Y_FIN',
          origenId: 1,
        }),
      ],
      tramos: [
        tramo(10, 1, '08:00', '08:30', {
          tipo: 'DEJAR',
          conductorId: 7,
          vehiculoId: 80,
        }),
        tramo(11, 1, '15:30', '16:00', {
          tipo: 'RETIRAR',
          conductorId: 8,
          vehiculoId: 81,
        }),
      ],
    });

    const resultado = await servicio.heredarDeOriginal(
      { padreId: 1, adicionalId: 2 },
      AUTOR,
    );

    expect(resultado).toEqual({ heredado: true, motivo: null });
    expect(repositorio.crearTramosDevolviendo).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          tipo: 'DEJAR',
          horaInicio: '17:00',
          conductorId: 7,
          vehiculoId: 80,
        }),
        expect.objectContaining({
          tipo: 'RETIRAR',
          horaFin: '21:00',
          conductorId: 8,
          vehiculoId: 81,
        }),
      ],
      expect.anything(),
    );
  });

  it('sin tramo del mismo tipo en el original, usa su reflejo (conductor y vehículo del operativo)', async () => {
    const { servicio, repositorio } = armar({
      operativos: [
        // Asignado por la ruta clásica antes de los tramos: solo tiene el reflejo.
        operativo(1, '08:00', '12:00', { conductorId: 8, vehiculoId: 81 }),
        operativo(2, '13:00', '15:00', { origenId: 1 }),
      ],
    });

    await servicio.heredarDeOriginal({ padreId: 1, adicionalId: 2 }, AUTOR);

    expect(repositorio.crearTramosDevolviendo).toHaveBeenCalledWith(
      [expect.objectContaining({ conductorId: 8, vehiculoId: 81 })],
      expect.anything(),
    );
  });

  it('si el adicional ya tiene tramos, no los toca (idempotente)', async () => {
    const { servicio, repositorio, registrar } = armar({
      operativos: [
        operativo(1, '08:00', '12:00', { conductorId: 7, vehiculoId: 80 }),
        operativo(2, '13:00', '15:00', { origenId: 1 }),
      ],
      tramos: [tramo(20, 2, '13:00', '15:00')],
    });

    const resultado = await servicio.heredarDeOriginal(
      { padreId: 1, adicionalId: 2 },
      AUTOR,
    );

    expect(resultado).toEqual({ heredado: false, motivo: null });
    expect(repositorio.crearTramosDevolviendo).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe('Tramos sin vehículo: se evalúa con lo que se guarda (2026-10-15)', () => {
  it('asignar sin vehículo no choca con el taller de la placa habitual', async () => {
    const { servicio, repositorio } = armar({
      tramos: [tramo(10, 1, '08:00', '12:00')],
    });
    repositorio.vehiculosEnTaller.mockResolvedValue(new Set([80]));

    const { evaluacion } = await servicio.asignarBloque(
      { fecha: FECHA, operativoIds: [1], conductorId: 7, vehiculoId: null },
      AUTOR,
    );

    // Solo el aviso de que falta la placa (G2): ni taller ni nada de la habitual.
    expect(evaluacion.estado).toBe('AVISO');
    expect(evaluacion.vehiculoId).toBeNull();
    expect(evaluacion.motivos).toEqual([
      {
        codigo: 'SIN_VEHICULO',
        mensaje: 'Asignado sin vehículo: falta la placa.',
        tipo: 'AVISO',
      },
    ]);
    expect(repositorio.asignarTramos).toHaveBeenCalledWith(
      [10],
      7,
      null,
      expect.anything(),
    );
  });

  it('asignar sin vehículo no aplica los asientos de la placa habitual', async () => {
    const personal = [1, 2, 3].map((n) => ({
      funcionarioId: 200 + n,
      funcionario: { apellidos: 'A', nombres: 'B' },
    }));
    const { servicio, repositorio } = armar({
      operativos: [operativo(1, '08:00', '12:00', { personal })],
      tramos: [tramo(10, 1, '08:00', '12:00')],
    });
    repositorio.vehiculosActivos.mockResolvedValue([
      { id: 80, placa: 'PMA-7056', asientos: 1 },
      { id: 81, placa: 'PMA-7057', asientos: 10 },
    ]);

    const { evaluacion } = await servicio.asignarBloque(
      { fecha: FECHA, operativoIds: [1], conductorId: 7, vehiculoId: null },
      AUTOR,
    );

    expect(evaluacion.motivos.map((m) => m.codigo)).not.toContain('ASIENTOS');
  });

  it('la lista de candidatos sigue proponiendo la placa habitual, con su taller', async () => {
    const { servicio, repositorio } = armar({
      tramos: [tramo(10, 1, '08:00', '12:00')],
    });
    repositorio.vehiculosEnTaller.mockResolvedValue(new Set([80]));

    const resultado = await servicio.evaluarBloque(FECHA, [1]);
    const juan = resultado.find((r) => r.conductorId === 7);

    expect(juan?.vehiculoId).toBe(80);
    expect(juan?.motivos.map((m) => m.codigo)).toContain('VEHICULO_EN_TALLER');
  });

  it('el adicional hereda sin vehículo si la placa del original ya no está activa', async () => {
    const { servicio, repositorio } = armar({
      operativos: [
        operativo(1, '08:00', '12:00', { conductorId: 7, vehiculoId: 99 }),
        operativo(2, '13:00', '15:00', { origenId: 1 }),
      ],
      tramos: [
        tramo(10, 1, '08:00', '12:00', { conductorId: 7, vehiculoId: 99 }),
      ],
    });
    repositorio.vehiculosEnTaller.mockResolvedValue(new Set([80]));

    const resultado = await servicio.heredarDeOriginal(
      { padreId: 1, adicionalId: 2 },
      AUTOR,
    );

    expect(resultado.heredado).toBe(true);
    const creados = (
      repositorio.crearTramosDevolviendo.mock.calls[0] as [
        { conductorId: number | null; vehiculoId: number | null }[],
      ]
    )[0];
    expect(creados.every((t) => t.conductorId === 7)).toBe(true);
    expect(creados.every((t) => t.vehiculoId === null)).toBe(true);
  });
});

describe('vehiculoPropuesto', () => {
  const diaDe = async (
    opciones: Parameters<typeof armar>[0],
    vehiculos?: { id: number; placa: string; asientos: number }[],
  ) => {
    const { servicio, repositorio } = armar(opciones);
    if (vehiculos) repositorio.vehiculosActivos.mockResolvedValue(vehiculos);
    const dia = await servicio.datosDelDia(FECHA);
    return { servicio, dia };
  };

  it('la que ya usa hoy gana a la habitual', async () => {
    const { servicio, dia } = await diaDe({
      tramos: [
        tramo(10, 1, '08:00', '09:00', { conductorId: 7, vehiculoId: 81 }),
      ],
    });
    expect(servicio.vehiculoPropuesto(dia.conductores[0], new Set(), dia)).toBe(
      81,
    );
  });

  it('sin tramos hoy propone la habitual; excluir el tramo de hoy también', async () => {
    const { servicio, dia } = await diaDe({
      tramos: [
        tramo(10, 1, '08:00', '09:00', { conductorId: 7, vehiculoId: 81 }),
      ],
    });
    expect(
      servicio.vehiculoPropuesto(dia.conductores[0], new Set([10]), dia),
    ).toBe(80);
  });

  it('una habitual dada de baja no se propone: null', async () => {
    const { servicio, dia } = await diaDe({}, [
      { id: 81, placa: 'PMA-7057', asientos: 10 },
    ]);
    expect(
      servicio.vehiculoPropuesto(dia.conductores[0], new Set(), dia),
    ).toBeNull();
  });
});

describe('Sustitución de flota: evaluarVehiculos (2026-10-15)', () => {
  const escenario = () => {
    const armado = armar({
      tramos: [
        tramo(10, 1, '08:00', '12:00'),
        // La 81 ya está con ZAMORA ANA en la misma franja.
        tramo(11, 2, '09:00', '11:00', {
          conductorId: 8,
          vehiculoId: 81,
          conductor: { id: 8, nombreCompleto: 'ZAMORA ANA' },
          vehiculo: { id: 81, placa: 'PMA-7057' },
        }),
      ],
    });
    armado.repositorio.vehiculosActivos.mockResolvedValue([
      {
        id: 80,
        placa: 'PMA-7056',
        asientos: 10,
        tipo: null,
        descripcion: null,
      },
      {
        id: 81,
        placa: 'PMA-7057',
        asientos: 10,
        tipo: null,
        descripcion: null,
      },
      {
        id: 82,
        placa: 'PMA-7058',
        asientos: 10,
        tipo: null,
        descripcion: 'Blanca',
      },
    ]);
    armado.repositorio.vehiculosEnTaller.mockResolvedValue(new Set([82]));
    return armado;
  };

  it('cada placa con su veredicto: la propuesta primero, ocupada y en taller como DURO', async () => {
    const { servicio } = escenario();

    const r = await servicio.evaluarVehiculos(FECHA, [1], undefined, 7);

    expect(r.propuestoId).toBe(80);
    expect(r.vehiculos.map((v) => v.vehiculoId)).toEqual([80, 81, 82]);
    const [propia, ocupada, taller] = r.vehiculos;
    expect(propia).toMatchObject({
      propuesto: true,
      estado: 'OK',
      ocupadaPor: null,
    });
    expect(ocupada.estado).toBe('DURO');
    expect(ocupada.ocupadaPor).toEqual({
      conductorId: 8,
      nombre: 'ZAMORA ANA',
      horaInicio: '09:00',
      horaFin: '11:00',
    });
    expect(ocupada.motivos[0]).toMatchObject({
      codigo: 'PLACA_OCUPADA',
      tipo: 'DURO',
    });
    expect(taller).toMatchObject({ estado: 'DURO', descripcion: 'Blanca' });
    expect(taller.motivos.map((m) => m.codigo)).toContain('VEHICULO_EN_TALLER');
  });

  it('no escribe nada', async () => {
    const { servicio, repositorio, registrar } = escenario();

    await servicio.evaluarVehiculos(FECHA, [1], undefined, 7);

    expect(repositorio.asignarTramos).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('conductor inexistente → 404', async () => {
    const { servicio } = escenario();
    await expect(
      servicio.evaluarVehiculos(FECHA, [1], undefined, 999),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('asignar con otra placa libre que la propuesta funciona y no avisa SIN_VEHICULO', async () => {
    const { servicio, repositorio } = escenario();
    repositorio.vehiculosEnTaller.mockResolvedValue(new Set());

    const { evaluacion } = await servicio.asignarBloque(
      { fecha: FECHA, operativoIds: [1], conductorId: 7, vehiculoId: 82 },
      AUTOR,
    );

    expect(evaluacion.vehiculoId).toBe(82);
    expect(evaluacion.motivos.map((m) => m.codigo)).not.toContain(
      'SIN_VEHICULO',
    );
    expect(repositorio.asignarTramos).toHaveBeenCalledWith(
      [10],
      7,
      82,
      expect.anything(),
    );
  });
});

describe('Compartir unidad a mano (2026-10-19)', () => {
  /**
   * El caso de la DAF: OPE-001 y OPE-002 en el mismo punto y a la misma hora, los dos «solo dejar».
   * OPE-001 ya tiene conductor (7) y placa (80, 10 asientos); OPE-002 está pendiente.
   */
  const escenario = (
    cambios: {
      tipoInvitado?: string;
      asientos?: number | null;
      anfitrionSinConductor?: boolean;
      invitado?: Record<string, unknown>;
      extraOperativos?: ReturnType<typeof operativo>[];
      extraTramos?: TramoFalso[];
    } = {},
  ) => {
    const armado = armar({
      operativos: [
        operativo(1, '08:00', '16:00', { tipoTransporte: 'SOLO_INICIO' }),
        operativo(2, '08:00', '16:00', {
          tipoTransporte: cambios.tipoInvitado ?? 'SOLO_INICIO',
          ...(cambios.invitado ?? {}),
        }),
        ...(cambios.extraOperativos ?? []),
      ],
      tramos: [
        tramo(10, 1, '08:00', '08:30', {
          tipo: 'DEJAR',
          ...(cambios.anfitrionSinConductor
            ? {}
            : { conductorId: 7, vehiculoId: 80 }),
        }),
        tramo(20, 2, '08:00', cambios.tipoInvitado ? '16:00' : '08:30', {
          tipo: cambios.tipoInvitado ? 'COMPLETO' : 'DEJAR',
        }),
        ...(cambios.extraTramos ?? []),
      ],
    });
    if (cambios.asientos !== undefined)
      armado.repositorio.vehiculosActivos.mockResolvedValue([
        { id: 80, placa: 'PMA7056', asientos: cambios.asientos },
        { id: 81, placa: 'PMA7057', asientos: 10 },
      ]);
    return armado;
  };
  const compartir = (servicio: PlanificacionTransporteService) =>
    servicio.compartirUnidad(
      { operativoId: 2, anfitrionOperativoId: 1 },
      AUTOR,
    );

  it('el invitado viaja con el conductor y la placa del anfitrión, con su traza', async () => {
    const { servicio, tramos, registrarVarios, operativosServicio } =
      escenario();

    const r = await compartir(servicio);

    expect(r.tramosAsignados).toBe(1);
    expect(r.compartidoCon).toEqual({
      operativoId: 1,
      identificador: 'OPE-001',
    });
    expect(tramos.find((t) => t.id === 20)).toMatchObject({
      conductorId: 7,
      vehiculoId: 80,
      compartidoConTramoId: 10,
    });
    const llamadas = registrarVarios.mock.calls as unknown as [
      { cambios: { campo: string; valorNuevo: string }[] }[],
    ][];
    const trazas = llamadas[0][0];
    expect(trazas[0].cambios).toEqual(
      expect.arrayContaining([
        { campo: 'trtr_compartido_con_id', valorNuevo: '10' },
        { campo: 'compartir_unidad', valorNuevo: 'con OPE-001' },
      ]),
    );
    expect(operativosServicio.asignarTransporte).toHaveBeenCalledWith(
      2,
      { conductorId: 7, vehiculoId: 80 },
      AUTOR,
    );
  });

  /*
    CAMBIO DE REGLA (2026-10-20, «completo comparte unidad»). Antes, un «completo» frente a un «dejar»
    era un 409. Ahora, en el mismo punto y zonal, el «completo» ABARCA el dejar de la unidad: va en ella.
    El 409 sigue cuando el «completo» está en otro punto de encuentro. Desde el 2026-10-21 el «completo»
    es la RAÍZ de la unidad: el dejar que abarca pasa a su grupo.
  */
  it('un «completo» en el mismo sitio abarca el dejar de la unidad y pasa a ser su raíz (2026-10-21)', async () => {
    const { servicio, tramos } = escenario({ tipoInvitado: 'COMPLETO' });

    await compartir(servicio);

    expect(tramos.find((t) => t.id === 20)).toMatchObject({
      conductorId: 7,
      vehiculoId: 80,
      compartidoConTramoId: null,
    });
    expect(tramos.find((t) => t.id === 10)).toMatchObject({
      conductorId: 7,
      compartidoConTramoId: 20,
    });
  });

  it('un «completo» en otro punto de encuentro → 409 COMPARTIR_NO_COMPATIBLE sin escribir', async () => {
    const { servicio, repositorio } = escenario({
      tipoInvitado: 'COMPLETO',
      invitado: { puntoEncuentroId: 328 },
    });
    repositorio.operativosDeFecha.mockResolvedValue([
      operativo(1, '08:00', '16:00', {
        tipoTransporte: 'SOLO_INICIO',
        puntoEncuentroId: 327,
      }),
      operativo(2, '08:00', '16:00', {
        tipoTransporte: 'COMPLETO',
        puntoEncuentroId: 328,
      }),
    ]);

    const error = await capturar(compartir(servicio));

    expect(error).toBeInstanceOf(ReglaNegocioError);
    expect((error as ReglaNegocioError).code).toBe('COMPARTIR_NO_COMPATIBLE');
    expect((error as Error).message).toContain('otro punto de encuentro');
    expect(repositorio.compartirTramo).not.toHaveBeenCalled();
  });

  it('si no caben → 409 con el motivo de los asientos', async () => {
    const { servicio } = escenario({ asientos: 1 });

    const error = await capturar(compartir(servicio));

    expect((error as ReglaNegocioError).code).toBe('COMPARTIR_NO_COMPATIBLE');
    expect((error as Error).message).toContain('No caben');
  });

  it('placa sin asientos registrados → 409: no se comparte a ciegas', async () => {
    const { servicio } = escenario({ asientos: null });

    const error = await capturar(compartir(servicio));

    expect((error as Error).message).toContain('no tiene asientos registrados');
  });

  it('el anfitrión todavía sin conductor → 409', async () => {
    const { servicio } = escenario({ anfitrionSinConductor: true });

    const error = await capturar(compartir(servicio));

    expect((error as ReglaNegocioError).code).toBe('COMPARTIR_NO_COMPATIBLE');
    expect((error as Error).message).toContain('todavía no tiene conductor');
  });

  it('consigo mismo → 400', async () => {
    const { servicio } = escenario();
    await expect(
      servicio.compartirUnidad(
        { operativoId: 1, anfitrionOperativoId: 1 },
        AUTOR,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('la unidad compartida es UN viaje: un tercer bloque a otra hora no da SOLAPAMIENTO', async () => {
    const { servicio } = escenario({
      extraOperativos: [operativo(3, '10:00', '12:00')],
      extraTramos: [tramo(30, 3, '10:00', '12:00')],
    });
    await compartir(servicio);

    const evaluaciones = await servicio.evaluarBloque(FECHA, [3]);
    const juan = evaluaciones.find((e) => e.conductorId === 7);
    expect(juan?.motivos.map((m) => m.codigo)).not.toContain('SOLAPAMIENTO');
  });

  it('y SÍ da SOLAPAMIENTO (una vez, no por duplicado) si el tercero se cruza de verdad', async () => {
    const { servicio } = escenario({
      extraOperativos: [operativo(3, '08:15', '09:00')],
      extraTramos: [tramo(30, 3, '08:15', '09:00')],
    });
    await compartir(servicio);

    const evaluaciones = await servicio.evaluarBloque(FECHA, [3]);
    const juan = evaluaciones.find((e) => e.conductorId === 7);
    expect(
      juan?.motivos.filter((m) => m.codigo === 'SOLAPAMIENTO'),
    ).toHaveLength(1);
  });

  it('asignar un tercero al mismo conductor con la misma placa no es VEHICULO_OCUPADO: la placa es suya', async () => {
    const { servicio } = escenario({
      extraOperativos: [operativo(3, '10:00', '12:00')],
      extraTramos: [tramo(30, 3, '10:00', '12:00')],
    });
    await compartir(servicio);

    const r = await servicio.asignarBloque(
      { fecha: FECHA, operativoIds: [3], conductorId: 7, vehiculoId: 80 },
      AUTOR,
    );
    expect(r.evaluacion.estado).not.toBe('DURO');
  });

  it('el anfitrión y su invitado no se ven entre sí como un choque (carril de avisos)', async () => {
    const { servicio } = escenario();
    await compartir(servicio);

    const dia = await servicio.datosDelDia(FECHA);
    const conductor = dia.conductores.find((c) => c.id === 7);
    const invitado = dia.tramosHoy.find((t) => t.id === 20);
    const evaluacion = servicio.evaluarConductor(
      conductor as (typeof dia.conductores)[number],
      80,
      {
        tramos: [
          servicio.tramoEvaluado(
            invitado as (typeof dia.tramosHoy)[number],
            '05:00',
          ),
        ],
        personas: 1,
      },
      new Set([20]),
      FECHA,
      dia,
    );
    expect(evaluacion.motivos.map((m) => m.codigo)).not.toContain(
      'SOLAPAMIENTO',
    );
  });

  it('quitar al ANFITRIÓN deja sin conductor a su invitado y lo avisa', async () => {
    const { servicio, tramos } = escenario();
    await compartir(servicio);
    expect(tramos.find((t) => t.id === 20)?.conductorId).toBe(7);

    const r = await servicio.quitarTramo(10, AUTOR);

    expect(r.liberados).toEqual([{ operativoId: 2, identificador: 'OPE-002' }]);
    expect(r.aviso).toContain('quedó sin conductor: OPE-002');
    expect(tramos.find((t) => t.id === 20)).toMatchObject({
      conductorId: null,
      vehiculoId: null,
      compartidoConTramoId: null,
    });
  });

  it('reasignar el anfitrión a otro conductor también suelta al invitado', async () => {
    const { servicio, tramos } = escenario();
    await compartir(servicio);

    const r = await servicio.asignarBloque(
      { fecha: FECHA, operativoIds: [1], conductorId: 8, vehiculoId: 81 },
      AUTOR,
    );

    expect(r.liberados.map((l) => l.identificador)).toEqual(['OPE-002']);
    expect(r.aviso).toContain('OPE-002');
    expect(tramos.find((t) => t.id === 20)?.conductorId).toBeNull();
    expect(tramos.find((t) => t.id === 10)?.conductorId).toBe(8);
  });

  it('quitar al INVITADO solo lo saca a él', async () => {
    const { servicio, tramos } = escenario();
    await compartir(servicio);

    const r = await servicio.quitarTramo(20, AUTOR);

    expect(r.liberados).toEqual([]);
    expect(tramos.find((t) => t.id === 10)?.conductorId).toBe(7);
    expect(tramos.find((t) => t.id === 20)).toMatchObject({
      conductorId: null,
      compartidoConTramoId: null,
    });
  });

  it('compartibles: el anfitrión compatible con conductor, placa y asientos libres', async () => {
    const { servicio } = escenario();

    const r = await servicio.compartibles(2);

    expect(r.anfitriones).toHaveLength(1);
    expect(r.anfitriones[0]).toMatchObject({
      operativoId: 1,
      identificador: 'OPE-001',
      conductor: { id: 7, nombre: 'PÉREZ JUAN' },
      vehiculo: { id: 80, placa: 'PMA7056', asientos: 10 },
      asientosLibres: 9,
      compatible: true,
      motivo: null,
      solicitado: false,
    });
  });

  it('compartibles: el pedido de quien registró va primero, aunque no sea compatible, con su motivo', async () => {
    const { servicio } = escenario({
      invitado: {
        compartirConId: 3,
        compartirCon: { id: 3, identificador: 'OPE-003' },
      },
      extraOperativos: [
        operativo(3, '08:00', '16:00', { tipoTransporte: 'COMPLETO' }),
      ],
      extraTramos: [
        tramo(30, 3, '08:00', '16:00', { conductorId: 8, vehiculoId: 81 }),
      ],
    });

    const r = await servicio.compartibles(2);

    expect(r.solicitado).toEqual({ operativoId: 3, identificador: 'OPE-003' });
    /*
      CAMBIO DE REGLA (2026-10-20): OPE-003 es un «completo» 08:00–16:00 en el mismo sitio: el «solo
      dejar» invitado cae DENTRO de él, así que el pedido ahora sí es compatible.
    */
    expect(
      r.anfitriones.map((a) => [a.identificador, a.solicitado, a.compatible]),
    ).toEqual([
      ['OPE-003', true, true],
      ['OPE-001', false, true],
    ]);
    expect(r.anfitriones[0]).toMatchObject({
      completo: 'DENTRO',
      asientosLibres: 9,
      personasConInvitado: 2,
    });
  });
});

describe('«La misma unidad»: compartir el dejar y hacer el retiro (2026-10-19)', () => {
  /**
   * El caso del negocio: A (OPE-001, «solo dejar») ya tiene conductor 7 y placa 80; B (OPE-002,
   * «dejar y retirar») está pendiente, mismo punto y hora. La unidad deja a los dos juntos y
   * después queda libre para retirar a B.
   */
  const escenario = (extra: { otroTramo?: TramoFalso } = {}) =>
    armar({
      operativos: [
        operativo(1, '08:00', '16:00', { tipoTransporte: 'SOLO_INICIO' }),
        operativo(2, '08:00', '16:00', { tipoTransporte: 'INICIO_Y_FIN' }),
        ...(extra.otroTramo
          ? [operativo(3, '15:00', '16:30', { tipoTransporte: 'COMPLETO' })]
          : []),
      ],
      tramos: [
        tramo(10, 1, '08:00', '08:30', {
          tipo: 'DEJAR',
          conductorId: 7,
          vehiculoId: 80,
        }),
        tramo(20, 2, '08:00', '08:30', { tipo: 'DEJAR' }),
        tramo(21, 2, '15:30', '16:00', { tipo: 'RETIRAR' }),
        ...(extra.otroTramo ? [extra.otroTramo] : []),
      ],
    });
  const compartir = (servicio: PlanificacionTransporteService) =>
    servicio.compartirUnidad(
      { operativoId: 2, anfitrionOperativoId: 1 },
      AUTOR,
    );

  it('el dejar viaja compartido y el retiro lo hace la MISMA unidad (sin marca)', async () => {
    const { servicio, tramos } = escenario();

    const r = await compartir(servicio);

    expect(r.tramosAsignados).toBe(2);
    expect(r.tramosPropios).toEqual([
      { tramoId: 21, tipo: 'RETIRAR', asignado: true },
    ]);
    expect(r.aviso).toBeNull();
    expect(tramos.find((t) => t.id === 20)).toMatchObject({
      conductorId: 7,
      vehiculoId: 80,
      compartidoConTramoId: 10,
    });
    expect(tramos.find((t) => t.id === 21)).toMatchObject({
      conductorId: 7,
      vehiculoId: 80,
      compartidoConTramoId: null,
    });
  });

  it('si la unidad no puede hacer el retiro, se comparte el dejar y el retiro queda PENDIENTE con su motivo', async () => {
    const { servicio, tramos } = escenario({
      otroTramo: tramo(30, 3, '15:00', '16:30', {
        conductorId: 7,
        vehiculoId: 80,
      }),
    });

    const r = await compartir(servicio);

    expect(r.tramosAsignados).toBe(1);
    expect(r.tramosPropios).toEqual([
      expect.objectContaining({
        tramoId: 21,
        tipo: 'RETIRAR',
        asignado: false,
      }),
    ]);
    expect(r.tramosPropios[0].motivo).toBeTruthy();
    expect(r.aviso).toContain('El retiro quedó pendiente');
    expect(r.aviso).toContain('Asignar conductor');
    expect(tramos.find((t) => t.id === 20)?.compartidoConTramoId).toBe(10);
    expect(tramos.find((t) => t.id === 21)?.conductorId).toBeNull();
  });

  it('«Asignar conductor» después completa SOLO el retiro: el dejar compartido no se toca', async () => {
    const { servicio, tramos } = escenario({
      otroTramo: tramo(30, 3, '15:00', '16:30', {
        conductorId: 7,
        vehiculoId: 80,
      }),
    });
    await compartir(servicio);

    const r = await servicio.asignarBloque(
      { fecha: FECHA, operativoIds: [2], conductorId: 8, vehiculoId: 81 },
      AUTOR,
    );

    expect(r.tramosAsignados).toBe(1);
    expect(tramos.find((t) => t.id === 21)).toMatchObject({
      conductorId: 8,
      vehiculoId: 81,
    });
    expect(tramos.find((t) => t.id === 20)).toMatchObject({
      conductorId: 7,
      compartidoConTramoId: 10,
    });
  });

  it('quitar al anfitrión suelta el dejar compartido; el retiro de la misma unidad sigue siendo suyo', async () => {
    const { servicio, tramos } = escenario();
    await compartir(servicio);

    const r = await servicio.quitarTramo(10, AUTOR);

    expect(r.liberados.map((l) => l.identificador)).toEqual(['OPE-002']);
    expect(tramos.find((t) => t.id === 20)?.conductorId).toBeNull();
    expect(tramos.find((t) => t.id === 21)).toMatchObject({
      conductorId: 7,
      vehiculoId: 80,
    });
  });

  it('compartibles dice qué comparten, qué queda propio y si la misma unidad puede hacerlo', async () => {
    const { servicio } = escenario();

    const r = await servicio.compartibles(2);

    expect(r.anfitriones[0]).toMatchObject({
      identificador: 'OPE-001',
      compatible: true,
      comparte: ['dejar'],
      propios: ['retirar'],
      propiosViables: true,
      motivoPropios: null,
    });
  });

  /**
   * «Retirar es otro estado» (2026-10-19): B pide SOLO el retiro. No viaja con A, pero no se cruza
   * con su dejar de las 08:00: la misma unidad lo retira después.
   */
  const soloRetiro = (extra: { otroTramo?: TramoFalso } = {}) =>
    armar({
      operativos: [
        operativo(1, '08:00', '16:00', { tipoTransporte: 'SOLO_INICIO' }),
        operativo(2, '08:00', '16:00', { tipoTransporte: 'SOLO_FIN' }),
        ...(extra.otroTramo
          ? [operativo(3, '15:00', '16:30', { tipoTransporte: 'COMPLETO' })]
          : []),
      ],
      tramos: [
        tramo(10, 1, '08:00', '08:30', {
          tipo: 'DEJAR',
          conductorId: 7,
          vehiculoId: 80,
        }),
        tramo(21, 2, '15:30', '16:00', { tipo: 'RETIRAR' }),
        ...(extra.otroTramo ? [extra.otroTramo] : []),
      ],
    });

  it('un «solo retirar» que no se cruza: la misma unidad lo hace después, sin marca de compartido', async () => {
    const { servicio, tramos } = soloRetiro();

    const r = await compartir(servicio);

    expect(r.tramosAsignados).toBe(1);
    expect(r.tramosPropios).toEqual([
      { tramoId: 21, tipo: 'RETIRAR', asignado: true },
    ]);
    expect(tramos.find((t) => t.id === 21)).toMatchObject({
      conductorId: 7,
      vehiculoId: 80,
      compartidoConTramoId: null,
    });
  });

  it('si la misma unidad no puede hacer ese retiro, no es un éxito vacío: 409 con el motivo', async () => {
    const { servicio, tramos } = soloRetiro({
      otroTramo: tramo(30, 3, '15:00', '16:30', {
        conductorId: 7,
        vehiculoId: 80,
      }),
    });

    await expect(compartir(servicio)).rejects.toMatchObject({
      code: CODIGOS_ERROR.COMPARTIR_NO_COMPATIBLE,
    });
    expect(tramos.find((t) => t.id === 21)?.conductorId).toBeNull();
  });

  /*
    CAMBIO DE REGLA (2026-10-20): en el MISMO sitio, un «completo» abarca el dejar de la unidad (ver
    «completo comparte unidad», abajo). En OTRA zonal la unidad no puede estar en los dos: sigue el 409.
  */
  it('un «completo» en otra zonal que se cruza con el dejar de la unidad es un conflicto: 409', async () => {
    const OTRA = { id: 9, nombre: 'QUITUMBE', sector: 'SUR' };
    const { servicio } = armar({
      operativos: [
        operativo(1, '08:00', '16:00', { tipoTransporte: 'SOLO_INICIO' }),
        operativo(2, '08:00', '16:00', {
          tipoTransporte: 'COMPLETO',
          zonales: [{ orden: 1, zonal: OTRA }],
        }),
      ],
      tramos: [
        tramo(10, 1, '08:00', '08:30', {
          tipo: 'DEJAR',
          conductorId: 7,
          vehiculoId: 80,
        }),
        tramo(22, 2, '08:00', '16:00', {
          tipo: 'COMPLETO',
          zonalOrigenId: OTRA.id,
          zonalDestinoId: OTRA.id,
          zonalOrigen: OTRA,
          zonalDestino: OTRA,
        }),
      ],
    });

    await expect(compartir(servicio)).rejects.toMatchObject({
      code: CODIGOS_ERROR.COMPARTIR_NO_COMPATIBLE,
    });
  });

  /**
   * El grupo A/B/C (2026-10-19): A «solo dejar» (asignado), B «dejar y retirar» y C «solo retirar»,
   * mismo punto y hora. La MISMA unidad deja a A+B juntos y retira a B+C juntos.
   */
  const grupoABC = (personasC = 1) =>
    armar({
      operativos: [
        operativo(1, '08:00', '16:00', { tipoTransporte: 'SOLO_INICIO' }),
        operativo(2, '08:00', '16:00', {
          tipoTransporte: 'INICIO_Y_FIN',
          compartirConId: 1,
        }),
        operativo(4, '08:00', '16:00', {
          tipoTransporte: 'SOLO_FIN',
          compartirConId: 1,
          personal: Array.from({ length: personasC }, (_, i) => ({
            funcionarioId: 400 + i,
            funcionario: { apellidos: 'C', nombres: String(i) },
          })),
        }),
      ],
      tramos: [
        tramo(10, 1, '08:00', '08:30', {
          tipo: 'DEJAR',
          conductorId: 7,
          vehiculoId: 80,
        }),
        tramo(20, 2, '08:00', '08:30', { tipo: 'DEJAR' }),
        tramo(21, 2, '15:30', '16:00', { tipo: 'RETIRAR' }),
        tramo(40, 4, '15:30', '16:00', { tipo: 'RETIRAR' }),
      ],
    });

  it('A/B/C: B comparte el dejar con A y hace su retiro; C viaja con el retiro de B (compartido con ese tramo)', async () => {
    const { servicio, tramos } = grupoABC();

    await servicio.compartirUnidad(
      { operativoId: 2, anfitrionOperativoId: 1 },
      AUTOR,
    );
    const r = await servicio.compartirUnidad(
      { operativoId: 4, anfitrionOperativoId: 1 },
      AUTOR,
    );

    expect(r.tramosAsignados).toBe(1);
    expect(r.tramosPropios).toEqual([]);
    expect(tramos.find((t) => t.id === 20)).toMatchObject({
      conductorId: 7,
      compartidoConTramoId: 10,
    });
    expect(tramos.find((t) => t.id === 21)).toMatchObject({
      conductorId: 7,
      vehiculoId: 80,
      compartidoConTramoId: null,
    });
    expect(tramos.find((t) => t.id === 40)).toMatchObject({
      conductorId: 7,
      vehiculoId: 80,
      compartidoConTramoId: 21,
    });
  });

  it('A/B/C: los asientos se cuentan POR TRAMO; si en el retiro B+C no caben, C no puede ir (409)', async () => {
    const { servicio, tramos } = grupoABC(10);
    await servicio.compartirUnidad(
      { operativoId: 2, anfitrionOperativoId: 1 },
      AUTOR,
    );

    await expect(
      servicio.compartirUnidad(
        { operativoId: 4, anfitrionOperativoId: 1 },
        AUTOR,
      ),
    ).rejects.toMatchObject({ code: CODIGOS_ERROR.COMPARTIR_NO_COMPATIBLE });
    expect(tramos.find((t) => t.id === 40)?.conductorId).toBeNull();
  });

  it('A/B/C: quitar el retiro de B libera a C; quitar el dejar de A suelta el dejar de B y deja a C con la unidad', async () => {
    const { servicio, tramos } = grupoABC();
    await servicio.compartirUnidad(
      { operativoId: 2, anfitrionOperativoId: 1 },
      AUTOR,
    );
    await servicio.compartirUnidad(
      { operativoId: 4, anfitrionOperativoId: 1 },
      AUTOR,
    );

    const deA = await servicio.quitarTramo(10, AUTOR);
    expect(deA.liberados.map((l) => l.identificador)).toEqual(['OPE-002']);
    expect(tramos.find((t) => t.id === 40)?.conductorId).toBe(7);

    const deB = await servicio.quitarTramo(21, AUTOR);
    expect(deB.liberados.map((l) => l.identificador)).toEqual(['OPE-004']);
    expect(tramos.find((t) => t.id === 40)).toMatchObject({
      conductorId: null,
      compartidoConTramoId: null,
    });
  });

  it('compartibles avisa cuando la misma unidad NO puede hacer el retiro', async () => {
    const { servicio } = escenario({
      otroTramo: tramo(30, 3, '15:00', '16:30', {
        conductorId: 7,
        vehiculoId: 80,
      }),
    });

    const r = await servicio.compartibles(2);

    expect(r.anfitriones[0]).toMatchObject({
      compatible: true,
      propiosViables: false,
    });
    expect(r.anfitriones[0].motivoPropios).toBeTruthy();
  });
});

describe('«Completo» comparte unidad (2026-10-20)', () => {
  /**
   * El caso real del 20-oct: A (OPE-001, «solo dejar» 08:00) y su grupo (OPE-002, «solo retirar» 16:00,
   * pide ir con A) en la unidad del conductor 7 con la placa 80. E (OPE-005, «completo» 08:00–16:30)
   * está pendiente: la unidad que lo acompaña todo el día deja a A y retira a B sin moverse.
   */
  const escenario = (
    cambios: {
      asientos?: number;
      ajeno?: boolean;
      ajenoDelConductor?: boolean;
    } = {},
  ) => {
    const armado = armar({
      operativos: [
        operativo(1, '08:00', '16:30', { tipoTransporte: 'SOLO_INICIO' }),
        operativo(2, '08:00', '16:30', {
          tipoTransporte: 'SOLO_FIN',
          compartirConId: 1,
        }),
        operativo(5, '08:00', '16:30', { tipoTransporte: 'COMPLETO' }),
        ...(cambios.ajeno ? [operativo(6, '10:00', '12:00')] : []),
        ...(cambios.ajenoDelConductor
          ? [operativo(6, '09:30', '14:30', { tipoTransporte: 'COMPLETO' })]
          : []),
      ],
      tramos: [
        tramo(10, 1, '08:00', '08:30', {
          tipo: 'DEJAR',
          conductorId: 7,
          vehiculoId: 80,
        }),
        tramo(20, 2, '16:00', '16:30', {
          tipo: 'RETIRAR',
          conductorId: 7,
          vehiculoId: 80,
        }),
        tramo(50, 5, '08:00', '16:30', { tipo: 'COMPLETO' }),
        ...(cambios.ajeno ? [tramo(60, 6, '10:00', '12:00')] : []),
        // El conductor 7 tiene ADEMÁS otro operativo a media mañana, fuera del grupo.
        ...(cambios.ajenoDelConductor
          ? [
              tramo(60, 6, '09:30', '14:30', {
                tipo: 'COMPLETO',
                conductorId: 7,
                vehiculoId: 80,
              }),
            ]
          : []),
      ],
    });
    if (cambios.asientos !== undefined)
      armado.repositorio.vehiculosActivos.mockResolvedValue([
        { id: 80, placa: 'PMA7056', asientos: cambios.asientos },
        { id: 81, placa: 'PMA7057', asientos: 10 },
      ]);
    return armado;
  };
  const compartir = (servicio: PlanificacionTransporteService) =>
    servicio.compartirUnidad(
      { operativoId: 5, anfitrionOperativoId: 1 },
      AUTOR,
    );

  it('el «completo» va en la unidad de A: un conductor y una placa para todo, con el «completo» como raíz', async () => {
    const { servicio, tramos } = escenario();

    const r = await compartir(servicio);

    expect(r.tramosAsignados).toBe(1);
    expect(tramos.find((t) => t.id === 50)).toMatchObject({
      conductorId: 7,
      vehiculoId: 80,
      compartidoConTramoId: null,
    });
    // El dejar de A y el retiro de B pasan a su grupo: no quedan dos intervalos.
    for (const id of [10, 20])
      expect(tramos.find((t) => t.id === id)).toMatchObject({
        conductorId: 7,
        vehiculoId: 80,
        compartidoConTramoId: 50,
      });
  });

  it('compartibles del «completo»: la unidad de A, compatible, con los asientos de cada momento', async () => {
    const { servicio } = escenario();

    const r = await servicio.compartibles(5);

    expect(r.anfitriones[0]).toMatchObject({
      identificador: 'OPE-001',
      compatible: true,
      completo: 'ABARCA',
      // A (dejar) y B (retirar) ya van en la unidad; con el «completo», 2 a bordo en cada momento.
      asientosLibres: 9,
      personasConInvitado: 2,
      asientosPorMomento: [
        { tipo: 'DEJAR', hora: '08:00', ocupados: 2 },
        { tipo: 'RETIRAR', hora: '16:00', ocupados: 2 },
      ],
    });
  });

  it('con ABARCA, «comparte» no lista el dejar: va en «contiene» con el retiro', async () => {
    const { servicio } = escenario();

    const r = await servicio.compartibles(5);

    expect(r.anfitriones[0]).toMatchObject({
      completo: 'ABARCA',
      comparte: [],
      contiene: ['dejar', 'retirar'],
    });
  });

  /*
    HUECO CORREGIDO (2026-10-20): la regla de la unidad no mira lo que el conductor hace FUERA del
    grupo. Si el conductor 7 tiene además un «completo» de 09:30 a 14:30 (OPE-006, otro operativo),
    el «completo» de OPE-005 no puede ir en su unidad: no puede estar en los dos sitios.
  */
  it('el conductor de la unidad tiene otro operativo a media mañana: compartibles lo da NO compatible con el motivo', async () => {
    const { servicio } = escenario({ ajenoDelConductor: true });

    const r = await servicio.compartibles(5);
    const deA = r.anfitriones.find((a) => a.identificador === 'OPE-001');

    expect(deA?.compatible).toBe(false);
    expect(deA?.motivo).toContain('El conductor de esa unidad no puede');
    expect(deA?.motivo).toContain('OPE-006');
    expect(deA?.personasConInvitado).toBeNull();
  });

  it('y compartir con esa unidad da 409 COMPARTIR_NO_COMPATIBLE sin escribir nada', async () => {
    const { servicio, repositorio } = escenario({ ajenoDelConductor: true });

    const error = await capturar(compartir(servicio));

    expect((error as ReglaNegocioError).code).toBe('COMPARTIR_NO_COMPATIBLE');
    expect((error as Error).message).toContain('OPE-006');
    expect(repositorio.compartirTramo).not.toHaveBeenCalled();
    expect(repositorio.asignarTramos).not.toHaveBeenCalled();
  });

  it('un bloque ajeno a las 10:00 para el conductor 7 da SOLAPAMIENTO: la unidad está ocupada todo el día', async () => {
    const { servicio } = escenario({ ajeno: true });
    await compartir(servicio);

    const evaluaciones = await servicio.evaluarBloque(FECHA, [6]);
    const juan = evaluaciones.find((e) => e.conductorId === 7);
    expect(juan?.motivos.map((m) => m.codigo)).toContain('SOLAPAMIENTO');
  });

  it('quitar el dejar de A solo lo libera a él; quitar el «completo» (la raíz) libera a todo el grupo', async () => {
    const { servicio, tramos } = escenario();
    await compartir(servicio);

    const delDejar = await servicio.quitarTramo(10, AUTOR);
    expect(delDejar.liberados).toEqual([]);
    expect(tramos.find((t) => t.id === 50)?.conductorId).toBe(7);
    expect(tramos.find((t) => t.id === 20)?.conductorId).toBe(7);

    const delCompleto = await servicio.quitarTramo(50, AUTOR);
    expect(delCompleto.liberados.map((l) => l.identificador)).toEqual([
      'OPE-002',
    ]);
    expect(tramos.find((t) => t.id === 20)?.conductorId).toBeNull();
  });

  it('un «solo dejar» que cae DENTRO de un «completo» asignado va con él; quitar el «completo» lo deja PENDIENTE', async () => {
    const { servicio, tramos } = armar({
      operativos: [
        operativo(5, '08:00', '16:30', { tipoTransporte: 'COMPLETO' }),
        operativo(1, '08:00', '16:30', { tipoTransporte: 'SOLO_INICIO' }),
      ],
      tramos: [
        tramo(50, 5, '08:00', '16:30', {
          tipo: 'COMPLETO',
          conductorId: 7,
          vehiculoId: 80,
        }),
        tramo(10, 1, '08:00', '08:30', { tipo: 'DEJAR' }),
      ],
    });

    await servicio.compartirUnidad(
      { operativoId: 1, anfitrionOperativoId: 5 },
      AUTOR,
    );
    expect(tramos.find((t) => t.id === 10)).toMatchObject({
      conductorId: 7,
      compartidoConTramoId: 50,
    });

    const r = await servicio.quitarTramo(50, AUTOR);
    expect(r.liberados.map((l) => l.identificador)).toEqual(['OPE-001']);
    expect(r.aviso).toContain('OPE-001');
    expect(tramos.find((t) => t.id === 10)?.conductorId).toBeNull();
  });

  it('asientos del grupo: si no caben, 409 con el motivo de los asientos', async () => {
    const { servicio, repositorio } = escenario({ asientos: 1 });

    const error = await capturar(compartir(servicio));

    expect((error as ReglaNegocioError).code).toBe('COMPARTIR_NO_COMPATIBLE');
    expect((error as Error).message).toContain('No caben');
    expect(repositorio.compartirTramo).not.toHaveBeenCalled();
  });
});

describe('El «completo» deja y retira en su punto, en cualquier orden (caso 21-OCT, 2026-10-21)', () => {
  /**
   * El caso real del 21-OCT, punto 327: 66 «completo» 08:00–16:30, 67 «solo dejar», 68 «solo retirar»
   * (pide ir con 66) y 69 «dejar y retirar» (pide ir con 66), una persona cada uno. La unidad del
   * conductor 7 con la placa 80 (4 asientos) hace los cinco traslados: a las 08:00 lleva 3 y a las 16:00
   * otros 3.
   */
  const caso = (asientos = 4, ajeno = false) => {
    const punto = { puntoEncuentroId: 327 };
    const armado = armar({
      operativos: [
        operativo(66, '08:00', '16:30', {
          ...punto,
          tipoTransporte: 'COMPLETO',
        }),
        operativo(67, '08:00', '16:30', {
          ...punto,
          tipoTransporte: 'SOLO_INICIO',
        }),
        operativo(68, '08:00', '16:30', {
          ...punto,
          tipoTransporte: 'SOLO_FIN',
          compartirConId: 66,
        }),
        operativo(69, '08:00', '16:30', {
          ...punto,
          tipoTransporte: 'INICIO_Y_FIN',
          compartirConId: 66,
        }),
        ...(ajeno
          ? [operativo(70, '10:00', '12:00', { puntoEncuentroId: 328 })]
          : []),
      ],
      tramos: [
        ...(ajeno ? [tramo(60, 70, '10:00', '12:00')] : []),
        tramo(46, 66, '08:00', '16:30', { tipo: 'COMPLETO' }),
        tramo(47, 67, '08:00', '08:30', { tipo: 'DEJAR' }),
        tramo(48, 68, '16:00', '16:30', { tipo: 'RETIRAR' }),
        tramo(49, 69, '08:00', '08:30', { tipo: 'DEJAR' }),
        tramo(50, 69, '16:00', '16:30', { tipo: 'RETIRAR' }),
      ],
    });
    armado.repositorio.vehiculosActivos.mockResolvedValue([
      { id: 80, placa: 'PMA3370', asientos },
      { id: 81, placa: 'PMA7057', asientos: 10 },
    ]);
    return armado;
  };
  const asignar = (servicio: PlanificacionTransporteService, ids: number[]) =>
    servicio.asignarBloque(
      { fecha: FECHA, operativoIds: ids, conductorId: 7, vehiculoId: 80 },
      AUTOR,
    );
  /** compartibles y el POST dicen lo mismo: el anfitrión sale compatible y el POST lo hace. */
  const compartir = async (
    servicio: PlanificacionTransporteService,
    operativoId: number,
    anfitrionOperativoId: number,
  ) => {
    const lista = await servicio.compartibles(operativoId);
    expect(
      lista.anfitriones.find((a) => a.operativoId === anfitrionOperativoId)
        ?.compatible,
    ).toBe(true);
    await servicio.compartirUnidad(
      { operativoId, anfitrionOperativoId },
      AUTOR,
    );
  };
  const final = (tramos: TramoFalso[]) =>
    Object.fromEntries(
      tramos.map((t) => [
        t.id,
        [t.conductorId, t.vehiculoId, t.compartidoConTramoId],
      ]),
    );
  const ESPERADO = {
    46: [7, 80, null],
    47: [7, 80, 46],
    48: [7, 80, 46],
    49: [7, 80, 46],
    50: [7, 80, 46],
  };

  it('el completo primero: los demás comparten su unidad', async () => {
    const { servicio, tramos } = caso();
    await asignar(servicio, [66]);
    await compartir(servicio, 67, 66);
    await compartir(servicio, 68, 66);
    await compartir(servicio, 69, 66);
    expect(final(tramos)).toEqual(ESPERADO);
  });

  it('dejar, retirar con la misma unidad y DESPUÉS el completo: el completo pasa a ser la raíz', async () => {
    const { servicio, tramos } = caso();
    await asignar(servicio, [67]);
    await compartir(servicio, 68, 67);
    await compartir(servicio, 66, 67);
    await compartir(servicio, 69, 66);
    expect(final(tramos)).toEqual(ESPERADO);
  });

  it('dejar, el completo y después el retirar: el retirar ya ve el completo de la unidad', async () => {
    const { servicio, tramos } = caso();
    await asignar(servicio, [67]);
    await compartir(servicio, 66, 67);
    await compartir(servicio, 68, 66);
    await compartir(servicio, 69, 66);
    expect(final(tramos)).toEqual(ESPERADO);
  });

  it('los cuatro de una vez con «Asignar»: un grupo con el completo como raíz', async () => {
    const { servicio, tramos } = caso();
    const r = await asignar(servicio, [66, 67, 68, 69]);
    expect(r.tramosAsignados).toBe(5);
    expect(final(tramos)).toEqual(ESPERADO);
  });

  it('los cuatro de una vez con 3 asientos: caben, porque a cada hora viajan 3', async () => {
    const { servicio, tramos } = caso(3);
    const r = await asignar(servicio, [66, 67, 68, 69]);
    expect(r.tramosAsignados).toBe(5);
    expect(final(tramos)).toEqual(ESPERADO);
  });

  it('los cuatro de una vez con 2 asientos: 409 sin escribir, con la hora que no cabe', async () => {
    const { servicio, repositorio } = caso(2);
    const error = await capturar(asignar(servicio, [66, 67, 68, 69]));
    expect((error as ReglaNegocioError).code).toBe('ASIGNACION_NO_VIABLE');
    expect((error as Error).message).toContain(
      'No caben a las 08:00: la unidad llevaría 3 personas y el vehículo tiene 2 asientos',
    );
    expect(repositorio.asignarTramos).not.toHaveBeenCalled();
  });

  it('con 3 asientos (PMA-3370 del 21-OCT) entra el cuarto: compartibles dice 3 de 3 en cada momento', async () => {
    const { servicio } = caso(3);
    await asignar(servicio, [66]);
    await compartir(servicio, 67, 66);
    await compartir(servicio, 68, 66);

    const lista = await servicio.compartibles(69);
    expect(lista.anfitriones.find((a) => a.operativoId === 66)).toMatchObject({
      compatible: true,
      asientosLibres: 1,
      personasConInvitado: 3,
      asientosPorMomento: [
        { tipo: 'DEJAR', hora: '08:00', ocupados: 3 },
        { tipo: 'RETIRAR', hora: '16:00', ocupados: 3 },
      ],
    });
  });

  it('con 2 asientos el cuarto no cabe: compartibles lo dice y el POST da 409', async () => {
    const { servicio, repositorio } = caso(2);
    await asignar(servicio, [66]);
    await compartir(servicio, 67, 66);
    await compartir(servicio, 68, 66);

    const lista = await servicio.compartibles(69);
    expect(lista.anfitriones.find((a) => a.operativoId === 66)).toMatchObject({
      compatible: false,
      asientosLibres: 0,
      personasConInvitado: null,
      asientosPorMomento: [],
      motivo:
        'No caben a las 08:00: la unidad llevaría 3 personas y el vehículo tiene 2 asientos.',
    });
    repositorio.compartirTramo.mockClear();
    const error = await capturar(
      servicio.compartirUnidad(
        { operativoId: 69, anfitrionOperativoId: 66 },
        AUTOR,
      ),
    );
    expect((error as ReglaNegocioError).code).toBe('COMPARTIR_NO_COMPATIBLE');
    expect(repositorio.compartirTramo).not.toHaveBeenCalled();
  });

  it('con la unidad completa, un bloque ajeno a las 10:00 en otro punto da SOLAPAMIENTO al conductor 7', async () => {
    const { servicio } = caso(4, true);
    await asignar(servicio, [66, 67, 68, 69]);
    const evaluaciones = await servicio.evaluarBloque(FECHA, [70]);
    expect(
      evaluaciones
        .find((e) => e.conductorId === 7)
        ?.motivos.map((m) => m.codigo),
    ).toContain('SOLAPAMIENTO');
  });
});
