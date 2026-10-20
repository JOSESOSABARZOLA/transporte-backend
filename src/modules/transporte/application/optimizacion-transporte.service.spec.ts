/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · optimizador, fin del día e insumo de movilización
 * Archivo: optimizacion-transporte.service.spec.ts
 * Responsabilidad: Verificar que confirmar re-evalúa, que el día siguiente repite el vehículo y el fin del día.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import { RolDepartamental, TipoTramo, TurnoConductor } from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import type { SolicitudApoyoService } from '../../operativos/application/solicitud-apoyo.service';
import type {
  PlanificacionTransporteRepository,
  TramoCompleto,
} from '../infrastructure/planificacion-transporte.repository';
import type { DestinoVehiculoService } from './destino-vehiculo.service';
import { OptimizacionTransporteService } from './optimizacion-transporte.service';
import type { ParametrosTransporteService } from './parametros-transporte.service';
import type {
  DatosDelDia,
  EvaluacionConductor,
  PlanificacionTransporteService,
} from './planificacion-transporte.service';
import { obtenerContexto } from '../../../common/contexto/contexto-peticion';
import { franjaDe } from './politicas/linea-de-tiempo';

const INICIO = '05:00';
const FECHA = new Date(Date.UTC(2026, 9, 14));
const AUTOR = { usuarioId: 7, rol: RolDepartamental.DAF };
const NORTE = { id: 1, nombre: 'Norte', sector: 'NORTE' };

const tramo = (
  id: number,
  cambios: Partial<Record<string, unknown>> = {},
): TramoCompleto =>
  ({
    id,
    operativoId: id,
    tipo: TipoTramo.COMPLETO,
    horaInicio: '09:00',
    horaFin: '11:00',
    conductorId: null,
    vehiculoId: null,
    zonalOrigen: NORTE,
    zonalDestino: NORTE,
    descripcion: null,
    ...cambios,
  }) as unknown as TramoCompleto;

const conductorFila = (
  id: number,
  cambios: Partial<Record<string, unknown>> = {},
) => ({
  id,
  nombreCompleto: `CONDUCTOR ${id}`,
  tipoContrato: 'OCASIONAL',
  vehiculoHabitualId: null,
  sector: 'NORTE',
  parqueaderoAutorizado: false,
  actaParqueaderoNumero: null,
  actaParqueaderoDesde: null,
  actaParqueaderoHasta: null,
  ...cambios,
});

const dia = (cambios: Partial<DatosDelDia> = {}): DatosDelDia =>
  ({
    parametros: {
      inicioJornada: INICIO,
      duracionTramo: { dejar: 60, retirar: 60 },
      huecoMinimoMin: 60,
      ventanaNombramiento: franjaDe('08:00', '16:30', INICIO),
      ventanasTurno: {
        DIA: franjaDe('06:00', '18:00', INICIO),
        NOCHE: franjaDe('18:00', '06:00', INICIO),
        ECU_NOCHE: franjaDe('20:00', '04:00', INICIO),
      },
    },
    asignacion: {
      maxJornadaHoras: 14,
      jornadaAvisoHoras: 12,
      descansoMinHoras: 9,
      traslado: { mismaZona: 15, mismoSector: 30, otroSector: 60 },
      tablaTraslados: new Map(),
      costoAviso: 30,
      costoActivarLibre: 120,
      costoArranqueLejos: 20,
    },
    conductores: [conductorFila(1)],
    vehiculos: [
      { id: 11, placa: 'PMA0011', asientos: 4, tipo: 'CAMIONETA' },
      { id: 12, placa: 'PMA0012', asientos: 4, tipo: 'CAMIONETA' },
    ],
    tramosHoy: [],
    tramosAyer: [],
    turnos: new Map(),
    activados: new Set(),
    ausentes: new Set(),
    enTaller: new Set(),
    amaneceEn: new Map(),
    llevadoPor: new Map(),
    ...cambios,
  }) as unknown as DatosDelDia;

const evaluacion = (
  estado: 'OK' | 'AVISO' | 'DURO',
  mensaje = '',
): EvaluacionConductor =>
  ({
    conductorId: 1,
    estado,
    motivos:
      estado === 'DURO'
        ? [{ tipo: 'DURO', codigo: 'SOLAPAMIENTO', mensaje }]
        : [],
    costo: 0,
  }) as unknown as EvaluacionConductor;

const armar = (
  datos: DatosDelDia,
  opciones: { evaluar?: EvaluacionConductor; operativos?: unknown[] } = {},
) => {
  const asignarTramos = jest.fn().mockResolvedValue(undefined);
  const activar = jest.fn().mockResolvedValue({ id: 77 });
  const compartirTramo = jest.fn().mockResolvedValue(undefined);
  const registrar = jest.fn().mockResolvedValue(undefined);
  // La correlación con la que se escribió cada lote de trazas (la del contexto en ese momento).
  const correlaciones: (string | undefined)[] = [];
  const registrarVarios = jest.fn().mockImplementation(() => {
    correlaciones.push(obtenerContexto()?.correlacionId);
    return Promise.resolve();
  });
  const sincronizarOperativos = jest.fn().mockResolvedValue(undefined);
  const evaluarConductor = jest
    .fn()
    .mockReturnValue(opciones.evaluar ?? evaluacion('OK'));
  const declarar = jest.fn().mockResolvedValue(undefined);

  const planificacion = {
    datosDelDia: jest.fn().mockResolvedValue(datos),
    generarTramosDelDia: jest.fn().mockResolvedValue({ generados: 0 }),
    evaluarConductor,
    sincronizarOperativos,
    tramoEvaluado: (t: TramoCompleto, inicio: string) => ({
      franja: franjaDe(t.horaInicio, t.horaFin, inicio),
      origen: { zonalId: 1, sector: 'NORTE' },
      destino: { zonalId: 1, sector: 'NORTE' },
      etiqueta: String(t.id),
    }),
    bloquesDe: (operativos: { id: number }[]) =>
      operativos.map((o) => ({ operativoIds: [o.id] })),
    ultimoFinAyer: () => null,
    conduccionDe: (ops: { id: number }[]) => ({
      esPatrulla: false,
      esNocturno: false,
      operativoIds: ops.map((o) => o.id),
    }),
    restriccionesDe: () => [],
  };
  const repositorio = {
    operativosDeFecha: jest.fn().mockResolvedValue(
      opciones.operativos ?? [
        {
          id: 1,
          identificador: 'IG-001',
          personal: [{ funcionarioId: 50 }],
          esMacrooperativo: false,
        },
      ],
    ),
    asignarTramos,
    activar,
    compartirTramo,
    garajesAutorizados: jest
      .fn()
      .mockResolvedValue([
        { id: 1, nombre: 'Garaje Norte', zonal: { id: 1, sector: 'NORTE' } },
      ]),
    turnosPublicadosEnRango: jest.fn().mockResolvedValue([]),
    tramosDeFecha: jest.fn().mockResolvedValue([]),
    destinosDe: jest.fn().mockResolvedValue([]),
    ejecutarEnTransaccion: jest
      .fn()
      .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
        operacion({}),
      ),
  };
  const parametros = {
    leer: jest.fn().mockResolvedValue(datos.parametros),
    leerOptimizacion: jest.fn().mockResolvedValue({
      compartirVentanaMin: 30,
      guardaHoraTarde: '20:00',
      duracionTareaTallerMin: 60,
    }),
  };

  const servicio = new OptimizacionTransporteService(
    planificacion as unknown as PlanificacionTransporteService,
    repositorio as unknown as PlanificacionTransporteRepository,
    parametros as unknown as ParametrosTransporteService,
    { declarar } as unknown as DestinoVehiculoService,
    {} as unknown as SolicitudApoyoService,
    { registrar, registrarVarios } as unknown as AuditoriaService,
  );
  return {
    servicio,
    generarTramosDelDia: planificacion.generarTramosDelDia,
    asignarTramos,
    activar,
    compartirTramo,
    registrar,
    registrarVarios,
    correlaciones,
    sincronizarOperativos,
    evaluarConductor,
    declarar,
  };
};

describe('OptimizacionTransporteService · proponer', () => {
  it('al día siguiente repite el vehículo a quien se lo llevó a su domicilio', async () => {
    const { servicio, asignarTramos } = armar(
      dia({
        conductores: [
          conductorFila(1, { vehiculoHabitualId: 11 }),
        ] as unknown as DatosDelDia['conductores'],
        tramosHoy: [tramo(1)],
        llevadoPor: new Map([[12, 1]]),
      }),
    );

    const propuesta = await servicio.proponer(
      FECHA,
      { activarLibres: false, compartirCarro: false },
      AUTOR,
    );

    expect(propuesta.cubiertos).toBe(1);
    expect(propuesta.asignaciones[0]).toEqual(
      expect.objectContaining({
        conductorId: 1,
        vehiculoId: 12,
        placa: 'PMA0012',
        identificadores: ['IG-001'],
      }),
    );
    // Proponer NO guarda asignaciones.
    expect(asignarTramos).not.toHaveBeenCalled();
  });

  it('lo que no se puede cubrir sale como «sin recurso» con su identificador', async () => {
    const { servicio } = armar(
      dia({
        conductores: [
          conductorFila(1),
        ] as unknown as DatosDelDia['conductores'],
        turnos: new Map([[1, TurnoConductor.LIBRE]]),
        tramosHoy: [tramo(1)],
      }),
    );

    const propuesta = await servicio.proponer(
      FECHA,
      { activarLibres: false, compartirCarro: false },
      AUTOR,
    );

    expect(propuesta.cubiertos).toBe(0);
    expect(propuesta.sinRecurso).toEqual([
      expect.objectContaining({
        operativoId: 1,
        identificador: 'IG-001',
        tramoIds: [1],
      }),
    ]);
  });
});

describe('OptimizacionTransporteService · confirmar re-evalúa', () => {
  it('aplica lo viable en una transacción, audita y sincroniza el operativo (regla 10)', async () => {
    const { servicio, asignarTramos, registrarVarios, sincronizarOperativos } =
      armar(dia({ tramosHoy: [tramo(1)] }));

    const r = await servicio.confirmar(
      FECHA,
      {
        asignaciones: [{ tramoIds: [1], conductorId: 1, vehiculoId: 11 }],
        activaciones: [],
        compartidos: [],
      },
      AUTOR,
    );

    expect(r.aplicadas).toBe(1);
    expect(asignarTramos).toHaveBeenCalledWith([1], 1, 11, expect.anything());
    expect(registrarVarios).toHaveBeenCalledTimes(1);
    expect(sincronizarOperativos).toHaveBeenCalledWith([1], AUTOR);
  });

  /**
   * Fase 2 del plan (2026-10-14): una fila por tramo asignado con su conductor y placa de antes y
   * de después, el resumen con la estrategia y las omitidas, todo con la correlación PROPIA de la
   * confirmación —que se devuelve— y en la misma transacción.
   */
  it('traza · una fila por tramo, el resumen con estrategia y omitidas, y una correlación propia', async () => {
    const { servicio, registrarVarios, correlaciones } = armar(
      dia({
        tramosHoy: [tramo(1), tramo(2, { conductorId: 9, vehiculoId: 12 })],
      }),
    );

    const r = await servicio.confirmar(
      FECHA,
      {
        asignaciones: [
          { tramoIds: [1], conductorId: 1, vehiculoId: 11 },
          // El 2 ya lo asignó alguien a mano: se omite y el motivo queda en el resumen.
          { tramoIds: [2], conductorId: 1, vehiculoId: 11 },
        ],
        activaciones: [],
        compartidos: [],
        estrategia: 'por dificultad, sin activar libres',
      },
      AUTOR,
    );

    const [trazas] = registrarVarios.mock.calls[0] as [
      {
        entidad: string;
        entidadId: number;
        cambios: {
          campo: string;
          valorAnterior?: string;
          valorNuevo?: string;
        }[];
      }[],
    ];
    const porTramo = trazas.find((t) => t.entidadId === 1);
    expect(porTramo?.cambios).toEqual([
      { campo: 'cond_id', valorAnterior: '', valorNuevo: '1' },
      { campo: 'vehi_id', valorAnterior: '', valorNuevo: '11' },
    ]);
    const resumen = trazas.find((t) => t.entidadId === 0);
    expect(resumen?.cambios).toEqual(
      expect.arrayContaining([
        {
          campo: 'optimizador_estrategia',
          valorNuevo: 'por dificultad, sin activar libres',
        },
        { campo: 'optimizador_asignaciones', valorNuevo: '1' },
        { campo: 'optimizador_omitidas', valorNuevo: '1' },
      ]),
    );
    expect(
      resumen?.cambios.find((c) => c.campo === 'optimizador_omitida')
        ?.valorNuevo,
    ).toContain('Tramos 2');
    expect(r.correlacionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(correlaciones).toEqual([r.correlacionId]);
  });

  it('traza · si TODO se omite, igual queda el resumen con los motivos', async () => {
    const { servicio, registrarVarios, asignarTramos } = armar(
      dia({ tramosHoy: [tramo(1, { conductorId: 9, vehiculoId: 12 })] }),
    );

    await servicio.confirmar(
      FECHA,
      {
        asignaciones: [{ tramoIds: [1], conductorId: 1, vehiculoId: 11 }],
        activaciones: [],
        compartidos: [],
      },
      AUTOR,
    );

    expect(asignarTramos).not.toHaveBeenCalled();
    expect(registrarVarios).toHaveBeenCalledTimes(1);
  });

  it('un tramo que alguien asignó entre medias se omite y se informa', async () => {
    const { servicio, asignarTramos } = armar(
      dia({ tramosHoy: [tramo(1, { conductorId: 9, vehiculoId: 12 })] }),
    );

    const r = await servicio.confirmar(
      FECHA,
      {
        asignaciones: [{ tramoIds: [1], conductorId: 1, vehiculoId: 11 }],
        activaciones: [],
        compartidos: [],
      },
      AUTOR,
    );

    expect(r.aplicadas).toBe(0);
    expect(r.omitidas[0].motivo).toContain('ya no está pendiente');
    expect(asignarTramos).not.toHaveBeenCalled();
  });

  it('si la re-evaluación da ✕, no se aplica y se devuelve el motivo', async () => {
    const { servicio, asignarTramos } = armar(dia({ tramosHoy: [tramo(1)] }), {
      evaluar: evaluacion('DURO', 'Se cruza con IG-009.'),
    });

    const r = await servicio.confirmar(
      FECHA,
      {
        asignaciones: [{ tramoIds: [1], conductorId: 1, vehiculoId: 11 }],
        activaciones: [],
        compartidos: [],
      },
      AUTOR,
    );

    expect(r.omitidas).toEqual([
      { tramoIds: [1], conductorId: 1, motivo: 'Se cruza con IG-009.' },
    ]);
    expect(asignarTramos).not.toHaveBeenCalled();
  });

  it('no pone una placa que otro conductor ya usa a esa hora', async () => {
    const { servicio, asignarTramos } = armar(
      dia({
        tramosHoy: [
          tramo(1),
          tramo(2, {
            conductorId: 9,
            vehiculoId: 11,
            horaInicio: '10:00',
            horaFin: '12:00',
          }),
        ],
      }),
    );

    const r = await servicio.confirmar(
      FECHA,
      {
        asignaciones: [{ tramoIds: [1], conductorId: 1, vehiculoId: 11 }],
        activaciones: [],
        compartidos: [],
      },
      AUTOR,
    );

    expect(r.omitidas[0].motivo).toContain(
      'La placa ya está con otro conductor',
    );
    expect(asignarTramos).not.toHaveBeenCalled();
  });

  it('activa el libre propuesto; un compartido sobre un tramo ya asignado en esta confirmación se omite', async () => {
    const { servicio, activar, compartirTramo } = armar(
      dia({
        conductores: [
          conductorFila(1),
        ] as unknown as DatosDelDia['conductores'],
        turnos: new Map([[1, TurnoConductor.LIBRE]]),
        tramosHoy: [tramo(1), tramo(2, { conductorId: 5, vehiculoId: 12 })],
      }),
    );

    const r = await servicio.confirmar(
      FECHA,
      {
        asignaciones: [{ tramoIds: [1], conductorId: 1, vehiculoId: 11 }],
        activaciones: [{ conductorId: 1, motivo: 'Cubrir IG-001' }],
        compartidos: [{ tramoId: 1, compartidoConTramoId: 2 }],
      },
      AUTOR,
    );

    expect(r.activados).toEqual([1]);
    expect(activar).toHaveBeenCalledWith(
      1,
      FECHA,
      'Cubrir IG-001',
      7,
      expect.anything(),
    );
    // El tramo 1 ya quedó asignado en esta misma confirmación: el compartido se omite.
    expect(r.compartidosOmitidos).toEqual([
      { tramoId: 1, motivo: 'El tramo ya no está pendiente.' },
    ]);
    expect(compartirTramo).not.toHaveBeenCalled();
  });
});

describe('OptimizacionTransporteService · compartir carro al confirmar', () => {
  it('el tramo pendiente toma conductor y placa de su anfitrión', async () => {
    const { servicio, compartirTramo, sincronizarOperativos } = armar(
      dia({
        tramosHoy: [tramo(1), tramo(2, { conductorId: 5, vehiculoId: 12 })],
      }),
    );

    const r = await servicio.confirmar(
      FECHA,
      {
        asignaciones: [],
        activaciones: [],
        compartidos: [{ tramoId: 1, compartidoConTramoId: 2 }],
      },
      AUTOR,
    );

    expect(r.compartidos).toBe(1);
    expect(compartirTramo).toHaveBeenCalledWith(
      1,
      { id: 2, conductorId: 5, vehiculoId: 12 },
      expect.anything(),
    );
    expect(sincronizarOperativos).toHaveBeenCalledWith([1], AUTOR);
  });

  it('un par incompatible que manda el cliente (un dejar que no cae en el «completo») se omite con su motivo', async () => {
    const { servicio, compartirTramo } = armar(
      dia({
        tramosHoy: [
          tramo(1, {
            tipo: TipoTramo.DEJAR,
            horaInicio: '08:00',
            horaFin: '09:30',
          }),
          tramo(2, { conductorId: 5, vehiculoId: 12 }),
        ],
      }),
    );

    const r = await servicio.confirmar(
      FECHA,
      {
        asignaciones: [],
        activaciones: [],
        compartidos: [{ tramoId: 1, compartidoConTramoId: 2 }],
      },
      AUTOR,
    );

    expect(r.compartidos).toBe(0);
    expect(compartirTramo).not.toHaveBeenCalled();
    expect(r.compartidosOmitidos[0].motivo).toContain(
      'no cae dentro del horario del operativo completo',
    );
  });

  it('un dejar DENTRO del «completo» de la unidad se confirma con el «completo» como raíz (2026-10-21)', async () => {
    const { servicio, compartirTramo } = armar(
      dia({
        tramosHoy: [
          tramo(1, { tipo: TipoTramo.DEJAR, horaFin: '09:30' }),
          tramo(2, { conductorId: 5, vehiculoId: 12 }),
        ],
      }),
    );

    const r = await servicio.confirmar(
      FECHA,
      {
        asignaciones: [],
        activaciones: [],
        compartidos: [{ tramoId: 1, compartidoConTramoId: 2 }],
      },
      AUTOR,
    );

    expect(r.compartidos).toBe(1);
    expect(compartirTramo).toHaveBeenCalledWith(
      1,
      { id: 2, conductorId: 5, vehiculoId: 12 },
      expect.anything(),
    );
  });
});

describe('OptimizacionTransporteService · fin del día', () => {
  it('termina tarde con acta vigente: sugiere el garaje más cercano: el domicilio es una excepción manual (2026-10-08)', async () => {
    const { servicio } = armar(
      dia({
        conductores: [
          conductorFila(1, {
            parqueaderoAutorizado: true,
            actaParqueaderoNumero: 'A-1',
            actaParqueaderoDesde: new Date(Date.UTC(2026, 0, 1)),
            actaParqueaderoHasta: new Date(Date.UTC(2026, 11, 31)),
          }),
        ] as unknown as DatosDelDia['conductores'],
        tramosHoy: [
          tramo(1, {
            conductorId: 1,
            vehiculoId: 11,
            horaInicio: '19:00',
            horaFin: '22:00',
          }),
        ],
      }),
    );

    const [sugerencia] = await servicio.finDelDia(FECHA);

    expect(sugerencia).toEqual(
      expect.objectContaining({
        vehiculoId: 11,
        tipo: 'GARAJE',
        ubicacionId: 1,
        conductorId: 1,
        conductor: 'CONDUCTOR 1',
        tarde: true,
        avisoCombustible: false,
        parqueadero: { autorizado: true, actaVigente: true },
        ultimoOperativo: {
          identificador: null,
          horaFin: '22:00',
          lugar: 'Norte',
        },
      }),
    );
  });

  it('guardar en lote: una guarda que falla no impide las demás', async () => {
    const { servicio, declarar } = armar(dia());
    declarar
      .mockRejectedValueOnce(
        new ValidacionError(
          'El conductor no tiene acta de parqueadero vigente.',
        ),
      )
      .mockResolvedValueOnce(undefined);

    const r = await servicio.guardarFinDelDia(
      FECHA,
      [
        {
          vehiculoId: 11,
          tipo: 'DOMICILIO',
          ubicacionId: null,
          conductorId: 1,
        },
        { vehiculoId: 12, tipo: 'GARAJE', ubicacionId: 1, conductorId: null },
      ],
      7,
    );

    expect(r).toEqual({
      guardadas: 1,
      errores: [
        {
          vehiculoId: 11,
          motivo: 'El conductor no tiene acta de parqueadero vigente.',
        },
      ],
    });
    expect(declarar).toHaveBeenLastCalledWith(
      12,
      FECHA,
      expect.objectContaining({
        tipo: 'GARAJE',
        domicilio: false,
        ubicacionId: 1,
      }),
      7,
    );
  });
});

describe('OptimizacionTransporteService · compartir con un macrooperativo (2026-10-07)', () => {
  it.each([
    ['el pendiente', { operativo: { esMacrooperativo: true } }, {}],
    ['el anfitrión', {}, { operativo: { esMacrooperativo: true } }],
  ])(
    'si %s pide vehículo exclusivo, no se comparte y se dice por qué',
    async (_caso, pendiente, anfitrion) => {
      const { servicio, compartirTramo } = armar(
        dia({
          tramosHoy: [
            tramo(1, pendiente),
            tramo(2, { conductorId: 5, vehiculoId: 12, ...anfitrion }),
          ],
        }),
      );

      const r = await servicio.confirmar(
        FECHA,
        {
          asignaciones: [],
          activaciones: [],
          compartidos: [{ tramoId: 1, compartidoConTramoId: 2 }],
        },
        AUTOR,
      );

      expect(r.compartidos).toBe(0);
      expect(r.compartidosOmitidos).toEqual([
        { tramoId: 1, motivo: 'Operativo con vehículo exclusivo' },
      ]);
      expect(compartirTramo).not.toHaveBeenCalled();
    },
  );
});

describe('OptimizacionTransporteService · simular (2026-10-08)', () => {
  it('compara sin y con libres en memoria y NO genera tramos ni escribe nada', async () => {
    const { servicio, generarTramosDelDia, asignarTramos, activar, registrar } =
      armar(
        dia({
          conductores: [
            conductorFila(1, { vehiculoHabitualId: 11 }),
            conductorFila(2, { vehiculoHabitualId: 12 }),
          ] as unknown as DatosDelDia['conductores'],
          turnos: new Map([
            [1, TurnoConductor.DIA],
            [2, TurnoConductor.LIBRE],
          ]),
          tramosHoy: [tramo(1), tramo(2)],
        }),
        {
          operativos: [
            {
              id: 1,
              identificador: 'IG-001',
              personal: [{ funcionarioId: 50 }],
              esMacrooperativo: false,
            },
            {
              id: 2,
              identificador: 'IG-002',
              personal: [{ funcionarioId: 51 }],
              esMacrooperativo: false,
            },
          ],
        },
      );

    const r = await servicio.simular(FECHA, { compartirCarro: false });

    expect(r.simulacion).toBe(true);
    expect(r.total).toBe(2);
    expect(r.cubiertosSinLibres).toBe(1);
    expect(r.cubiertosConLibres).toBe(2);
    expect(r.sugerencia).toEqual({
      aplica: true,
      pendientesSinLibres: 1,
      operativosExtra: 1,
      libres: [{ conductorId: 2, nombre: 'CONDUCTOR 2' }],
    });
    expect(generarTramosDelDia).not.toHaveBeenCalled();
    expect(asignarTramos).not.toHaveBeenCalled();
    expect(activar).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});
