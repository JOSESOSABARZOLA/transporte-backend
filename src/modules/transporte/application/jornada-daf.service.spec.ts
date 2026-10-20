/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (flujo guiado en 4 pasos)
 * Archivo: jornada-daf.service.spec.ts
 * Responsabilidad: Verificar el resumen, los candidatos, la confirmación de vehículos y la emisión de hojas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 */

import {
  RolDepartamental,
  TipoTramo,
  TipoTransporte,
  TurnoConductor,
} from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { VentanaCargaService } from '../../configuracion/application/ventana-carga.service';
import type { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import type { JornadaDafRepository } from '../infrastructure/jornada-daf.repository';
import type {
  PlanificacionTransporteRepository,
  TramoCompleto,
} from '../infrastructure/planificacion-transporte.repository';
import type { CapacidadFlotaService } from './capacidad-flota.service';
import { JornadaDafService } from './jornada-daf.service';
import type { OptimizacionTransporteService } from './optimizacion-transporte.service';
import type {
  DatosDelDia,
  EvaluacionConductor,
  PlanificacionTransporteService,
} from './planificacion-transporte.service';
import type { PreparacionTransporteService } from './preparacion-transporte.service';
import { huellaDeTramos } from './politicas/hoja-ruta-emision';
import { franjaDe } from './politicas/linea-de-tiempo';

const INICIO = '05:00';
const FECHA = new Date(Date.UTC(2026, 9, 9));
const AUTOR = { usuarioId: 7, rol: RolDepartamental.DAF };
const CALDERON = { id: 3, nombre: 'Calderón', sector: 'NORTE' };

const tramo = (
  id: number,
  cambios: Partial<Record<string, unknown>> = {},
): TramoCompleto =>
  ({
    id,
    operativoId: id,
    tipo: TipoTramo.COMPLETO,
    horaInicio: '08:00',
    horaFin: '16:30',
    conductorId: null,
    vehiculoId: null,
    compartidoConTramoId: null,
    zonalOrigen: CALDERON,
    zonalDestino: CALDERON,
    descripcion: null,
    operativo: { identificador: `OCPMO-00${id}` },
    conductor: null,
    vehiculo: null,
    ...cambios,
  }) as unknown as TramoCompleto;

const VEHICULOS = [
  { id: 11, placa: 'PMA0011', asientos: 4, tipo: 'CAMIONETA' },
  { id: 12, placa: 'PMA0012', asientos: 4, tipo: 'CAMIONETA' },
  { id: 13, placa: 'PMA7058', asientos: 4, tipo: 'CAMIONETA' },
];

const dia = (cambios: Partial<DatosDelDia> = {}): DatosDelDia =>
  ({
    parametros: {
      inicioJornada: INICIO,
      ventanasTurno: {
        DIA: franjaDe('06:00', '18:00', INICIO),
        NOCHE: franjaDe('18:00', '07:00', INICIO),
        ECU_NOCHE: franjaDe('20:00', '04:00', INICIO),
      },
    },
    conductores: [
      { id: 1, nombreCompleto: 'Kevin Escaleras', vehiculoHabitualId: 11 },
      { id: 2, nombreCompleto: 'Marco Toapanta', vehiculoHabitualId: 12 },
    ],
    vehiculos: VEHICULOS,
    tramosHoy: [],
    turnos: new Map([
      [1, TurnoConductor.DIA],
      [2, TurnoConductor.NOCHE],
    ]),
    activados: new Set(),
    ausentes: new Set(),
    enTaller: new Set([13]),
    ...cambios,
  }) as unknown as DatosDelDia;

const armar = (
  datos: DatosDelDia,
  opciones: {
    evaluaciones?: EvaluacionConductor[];
    evaluarConductor?: jest.Mock;
    filasJornada?: unknown[];
    emisiones?: unknown[];
    finDelDia?: unknown[];
    tramosDeFecha?: TramoCompleto[];
  } = {},
) => {
  const registrar = jest.fn().mockResolvedValue(undefined);
  const guardarVehiculoJornada = jest.fn().mockResolvedValue(undefined);
  const registrarEmision = jest
    .fn()
    .mockImplementation((_f: Date, conductorId: number) =>
      Promise.resolve({
        id: 100 + conductorId,
        emitidaEn: new Date('2026-10-09T20:00:00Z'),
      }),
    );
  const declarar = jest.fn().mockResolvedValue({
    vehiculosRequeridos: 3,
    veredicto: { hayAdvertencia: false },
  });
  const obtenerPorFecha = jest.fn().mockResolvedValue({ id: 1 });
  const operativos = [
    {
      id: 1,
      identificador: 'OCPMO-001',
      horaInicio: '08:00',
      horaFin: '16:30',
      tipoTransporte: TipoTransporte.COMPLETO,
      estadoTransporte: 'PENDIENTE',
      esMacrooperativo: false,
      transporteLiberadoEn: null,
      formulario: { numero: 2, nombre: 'PMO' },
      zonales: [{ zonal: CALDERON }],
      personal: [{ funcionarioId: 50 }],
    },
    {
      id: 2,
      identificador: 'OCPMO-002',
      horaInicio: '09:00',
      horaFin: '12:00',
      tipoTransporte: TipoTransporte.PROPIOS_MEDIOS,
      estadoTransporte: 'PENDIENTE',
      esMacrooperativo: false,
      transporteLiberadoEn: null,
      formulario: { numero: 2, nombre: 'PMO' },
      zonales: [{ zonal: CALDERON }],
      personal: [{ funcionarioId: 51 }],
    },
  ];

  const planificacion = {
    datosDelDia: jest.fn().mockResolvedValue(datos),
    evaluarConductor:
      opciones.evaluarConductor ??
      jest.fn().mockReturnValue({ estado: 'OK', motivos: [] }),
    conduccionDe: (ops: { id: number }[]) => ({
      esPatrulla: false,
      esNocturno: false,
      operativoIds: ops.map((o) => o.id),
    }),
    tramoEvaluado: (t: TramoCompleto, inicio: string) => ({
      franja: franjaDe(t.horaInicio, t.horaFin, inicio),
      origen: null,
      destino: null,
      etiqueta: String(t.id),
    }),
    evaluarConContexto: jest.fn().mockResolvedValue({
      evaluaciones: opciones.evaluaciones ?? [],
      dia: datos,
      operativos,
      existentes: datos.tramosHoy.filter((t) => t.operativoId === 1),
      bloque: {
        tramos: [
          {
            franja: franjaDe('08:00', '16:30', INICIO),
            origen: null,
            destino: null,
            etiqueta: 'OCPMO-001',
          },
        ],
        idsTramos: datos.tramosHoy
          .filter((t) => t.operativoId === 1)
          .map((t) => t.id),
      },
    }),
  };
  const repositorio = {
    operativosDeFecha: jest.fn().mockResolvedValue(operativos),
    vehiculosActivos: jest.fn().mockResolvedValue(VEHICULOS),
    vehiculosEnTaller: jest.fn().mockResolvedValue(new Set([13])),
    tramosDeFecha: jest
      .fn()
      .mockResolvedValue(opciones.tramosDeFecha ?? datos.tramosHoy),
    conductoresActivos: jest.fn().mockResolvedValue(datos.conductores),
    zonalesActivas: jest
      .fn()
      .mockResolvedValue([{ ...CALDERON, esDmq: false }]),
    garajesAutorizados: jest.fn().mockResolvedValue([
      {
        id: 3,
        nombre: 'Garaje Norte (Carcelén)',
        zonal: { id: 3, sector: 'NORTE' },
      },
      {
        id: 4,
        nombre: 'Garaje Sur (Quitumbe)',
        zonal: { id: 5, sector: 'SUR' },
      },
    ]),
  };
  const jornada = {
    vehiculosDeJornada: jest
      .fn()
      .mockResolvedValue(opciones.filasJornada ?? []),
    emisionesDe: jest.fn().mockResolvedValue(opciones.emisiones ?? []),
    guardarVehiculoJornada,
    registrarEmision,
    ejecutarEnTransaccion: jest
      .fn()
      .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
        operacion({}),
      ),
  };
  const preparacion = {
    preparar: jest.fn().mockResolvedValue({
      cuadro: { existe: true, estado: 'APROBADO', operativos: 2, listo: true },
      turnos: { cargados: true, publicados: true },
      conductoresIncompletos: [],
    }),
  };

  const servicio = new JornadaDafService(
    planificacion as unknown as PlanificacionTransporteService,
    {
      finDelDia: jest.fn().mockResolvedValue(opciones.finDelDia ?? []),
    } as unknown as OptimizacionTransporteService,
    preparacion as unknown as PreparacionTransporteService,
    {
      calcular: jest.fn().mockResolvedValue({
        calculada: { conductoresHabiles: 2, vehiculosHabiles: 2 },
      }),
      declarar,
    } as unknown as CapacidadFlotaService,
    { obtenerPorFecha } as unknown as CuadroDiarioService,
    {
      obtenerEstado: jest.fn().mockResolvedValue({
        abierta: true,
        horaApertura: '15:55',
        horaCierre: '16:50',
        mensaje: 'Abierta',
        zonaHoraria: 'America/Guayaquil',
      }),
    } as unknown as VentanaCargaService,
    repositorio as unknown as PlanificacionTransporteRepository,
    jornada as unknown as JornadaDafRepository,
    { registrar } as unknown as AuditoriaService,
  );
  return {
    servicio,
    registrar,
    guardarVehiculoJornada,
    registrarEmision,
    declarar,
    obtenerPorFecha,
  };
};

const capturar = async (promesa: Promise<unknown>): Promise<unknown> =>
  promesa.catch((error: unknown) => error);

describe('JornadaDafService · resumen', () => {
  it('cuenta solo los operativos que piden transporte y deriva el paso', async () => {
    const { servicio } = armar(dia({ tramosHoy: [tramo(1)] }), {
      filasJornada: [
        { vehiculoId: 11, sale: true, registradoEn: new Date() },
        { vehiculoId: 12, sale: true, registradoEn: new Date() },
        { vehiculoId: 13, sale: false, registradoEn: new Date() },
      ],
    });

    const r = await servicio.resumen(FECHA);

    expect(r.totales).toEqual(
      expect.objectContaining({
        operativos: 1,
        cubiertos: 0,
        sinConductor: 1,
        propiosMedios: 1,
        vehiculosDisponibles: 2,
        enTaller: 1,
      }),
    );
    expect(r.preparacion.listos).toBe(true);
    expect(r.pasos.pasoInicial).toBe(2);
    expect(r.operativos[0]).toEqual(
      expect.objectContaining({
        identificador: 'OCPMO-001',
        formulario: '2. PMO',
        zonal: 'Calderón',
        cubierto: false,
      }),
    );
  });

  it('«Se guarda en» ofrece solo los garajes autorizados del catálogo, por su nombre', async () => {
    const { servicio } = armar(dia({ tramosHoy: [tramo(1)] }));

    const r = await servicio.resumen(FECHA);

    expect(r.garajes).toEqual([
      { id: 3, nombre: 'Garaje Norte (Carcelén)' },
      { id: 4, nombre: 'Garaje Sur (Quitumbe)' },
    ]);
  });

  it('los avisos van en el carril del conductor, sin repetir el mismo código', async () => {
    const evaluarConductor = jest.fn().mockReturnValue({
      estado: 'AVISO',
      motivos: [
        {
          codigo: 'FUERA_DE_TURNO',
          mensaje: 'Fuera de su turno.',
          tipo: 'AVISO',
        },
      ],
    });
    const asignado = (id: number) =>
      tramo(id, {
        conductorId: 2,
        vehiculoId: 12,
        conductor: { id: 2, nombreCompleto: 'Marco Toapanta' },
        vehiculo: { id: 12, placa: 'PMA0012' },
      });
    const { servicio } = armar(dia({ tramosHoy: [asignado(1), asignado(3)] }), {
      evaluarConductor,
    });

    const r = await servicio.resumen(FECHA);
    const marco = r.conductores.find((c) => c.id === 2);

    expect(marco?.avisos).toEqual([
      {
        codigo: 'FUERA_DE_TURNO',
        mensaje: 'Fuera de su turno.',
        tipo: 'AVISO',
      },
    ]);
    expect(marco?.placa).toBe('PMA0012');
    expect(marco?.hojaRuta).toEqual({ estado: 'PENDIENTE', emitidaEn: null });
    expect(r.totales.cubiertos).toBe(1);
    expect(r.totales.avisos).toBe(1);
  });

  it('un tramo sin vehículo se evalúa sin vehículo, no con la placa habitual (2026-10-15)', async () => {
    const evaluarConductor = jest
      .fn()
      .mockReturnValue({ estado: 'OK', motivos: [] });
    const sinPlaca = tramo(1, {
      conductorId: 2,
      vehiculoId: null,
      conductor: { id: 2, nombreCompleto: 'Marco Toapanta' },
      vehiculo: null,
    });
    const { servicio } = armar(dia({ tramosHoy: [sinPlaca] }), {
      evaluarConductor,
    });

    await servicio.resumen(FECHA);

    expect(evaluarConductor).toHaveBeenCalled();
    for (const llamada of evaluarConductor.mock.calls as unknown[][]) {
      expect(llamada[1]).toBeNull();
    }
  });

  it('una hoja emitida vuelve a PENDIENTE_CAMBIO si sus tramos cambian', async () => {
    const t1 = tramo(1, { conductorId: 1, vehiculoId: 11 });
    const { servicio } = armar(dia({ tramosHoy: [t1] }), {
      emisiones: [
        {
          conductorId: 1,
          huella: huellaDeTramos([{ ...t1, horaFin: '15:00' }]),
          emitidaEn: new Date('2026-10-09T20:00:00Z'),
        },
      ],
    });

    const r = await servicio.resumen(FECHA);

    expect(r.conductores.find((c) => c.id === 1)?.hojaRuta?.estado).toBe(
      'PENDIENTE_CAMBIO',
    );
  });
});

describe('JornadaDafService · candidatos', () => {
  it('clasifica, marca al asignado actual y lo deja al final; el ocupado dice con qué', async () => {
    const ocupando = tramo(9, {
      operativoId: 9,
      conductorId: 2,
      horaInicio: '07:00',
      horaFin: '10:00',
      operativo: { identificador: 'OCFIJ-001' },
    });
    const actual = tramo(1, { conductorId: 1, vehiculoId: 11 });
    const { servicio } = armar(dia({ tramosHoy: [actual, ocupando] }), {
      evaluaciones: [
        {
          conductorId: 1,
          nombre: 'Kevin Escaleras',
          estado: 'OK',
          motivos: [],
          costo: 0,
          vehiculoId: 11,
        },
        {
          conductorId: 2,
          nombre: 'Marco Toapanta',
          estado: 'DURO',
          motivos: [
            { codigo: 'SOLAPAMIENTO', mensaje: 'Se pisa.', tipo: 'DURO' },
          ],
          costo: 0,
          vehiculoId: 12,
        },
      ],
    });

    const r = await servicio.candidatos(FECHA, 1);

    expect(r.actual).toEqual({ conductorId: 1, nombre: 'Kevin Escaleras' });
    expect(r.candidatos.map((c) => [c.conductorId, c.categoria])).toEqual([
      [2, 'OCUPADO'],
      [1, 'DISPONIBLE'],
    ]);
    expect(r.candidatos[0].motivo).toBe('Ocupado 07H00–10H00 con OCFIJ-001');
    expect(r.candidatos[1]).toEqual(
      expect.objectContaining({ actual: true, placa: 'PMA0011' }),
    );
  });
});

describe('JornadaDafService · vehículos que salen', () => {
  it('guarda la lista, audita y declara el conteo con las placas que no salen', async () => {
    const { servicio, guardarVehiculoJornada, registrar, declarar } =
      armar(dia());

    await servicio.confirmarVehiculos(
      FECHA,
      { saleIds: [11], observacion: 'Sin chofer.' },
      AUTOR,
    );

    expect(guardarVehiculoJornada).toHaveBeenCalledTimes(3);
    expect(guardarVehiculoJornada).toHaveBeenCalledWith(
      FECHA,
      12,
      false,
      7,
      expect.anything(),
    );
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_vehiculo_jornada',
        cambios: [
          expect.objectContaining({
            campo: 'vehiculos_salen',
            valorNuevo: '11',
          }),
        ],
      }),
      expect.anything(),
    );
    expect(declarar).toHaveBeenCalledWith(
      FECHA,
      {
        vehiculosHabiles: 1,
        conductoresHabiles: 2,
        observacion: 'Vehículos que no salen: PMA0012. Sin chofer.',
      },
      AUTOR,
    );
  });

  it('si salen todos los disponibles, confirma sin observación', async () => {
    const { servicio, declarar } = armar(dia());

    await servicio.confirmarVehiculos(FECHA, { saleIds: [11, 12] }, AUTOR);

    expect(declarar).toHaveBeenCalledWith(
      FECHA,
      { vehiculosHabiles: 2, conductoresHabiles: 2, observacion: undefined },
      AUTOR,
    );
  });

  it('un vehículo en taller no puede salir', async () => {
    const { servicio, guardarVehiculoJornada } = armar(dia());

    const error = await capturar(
      servicio.confirmarVehiculos(FECHA, { saleIds: [11, 13] }, AUTOR),
    );

    expect(error).toBeInstanceOf(ValidacionError);
    expect((error as Error).message).toBe(
      'PMA7058 está en el taller ese día: no puede salir.',
    );
    expect(guardarVehiculoJornada).not.toHaveBeenCalled();
  });

  it('un vehículo que no existe se rechaza', async () => {
    const { servicio } = armar(dia());

    expect(
      await capturar(
        servicio.confirmarVehiculos(FECHA, { saleIds: [99] }, AUTOR),
      ),
    ).toBeInstanceOf(RecursoNoEncontradoError);
  });
});

describe('JornadaDafService · emitir hojas de ruta', () => {
  const asignados = [
    tramo(1, { conductorId: 1, vehiculoId: 11 }),
    tramo(2, { conductorId: 2, vehiculoId: 12 }),
  ];

  it('sin conductor, emite todas las que tienen tramos, con su huella y auditoría', async () => {
    const { servicio, registrarEmision, registrar } = armar(
      dia({ tramosHoy: asignados }),
    );

    const r = await servicio.emitirHojas(FECHA, undefined, AUTOR);

    expect(r.emitidas).toBe(2);
    expect(registrarEmision).toHaveBeenCalledWith(
      FECHA,
      1,
      huellaDeTramos([asignados[0]]),
      7,
      expect.anything(),
    );
    expect(registrar).toHaveBeenCalledTimes(2);
  });

  it('con conductor, solo la suya', async () => {
    const { servicio, registrarEmision } = armar(dia({ tramosHoy: asignados }));

    const r = await servicio.emitirHojas(FECHA, 2, AUTOR);

    expect(r.hojas).toEqual([
      expect.objectContaining({ conductorId: 2, estado: 'EMITIDA' }),
    ]);
    expect(registrarEmision).toHaveBeenCalledTimes(1);
  });

  it('un conductor sin tramos no tiene hoja que emitir', async () => {
    const { servicio } = armar(dia({ tramosHoy: asignados }));

    const error = await capturar(servicio.emitirHojas(FECHA, 5, AUTOR));

    expect(error).toBeInstanceOf(ValidacionError);
  });
});

/**
 * Horas libres (2026-10-14). La resta de intervalos la prueba `huecos-libres.spec.ts`; aquí, que el
 * servicio arme bien la ventana de cada uno y respete los filtros.
 */
describe('JornadaDafService · horas libres', () => {
  const conHuecos = (cambios: Partial<DatosDelDia> = {}) =>
    dia({
      parametros: {
        inicioJornada: INICIO,
        huecoMinimoMin: 60,
        ventanaNombramiento: franjaDe('08:00', '16:30', INICIO),
        ventanasTurno: {
          DIA: franjaDe('06:00', '18:00', INICIO),
          NOCHE: franjaDe('18:00', '07:00', INICIO),
          ECU_NOCHE: franjaDe('20:00', '04:00', INICIO),
        },
      },
      asignacion: {
        maxJornadaHoras: 14,
        traslado: { mismaZona: 15, mismoSector: 30, otroSector: 60 },
        tablaTraslados: new Map(),
      },
      amaneceEn: new Map(),
      ...cambios,
    } as unknown as Partial<DatosDelDia>);

  it('el conductor de un «dejar y retirar» tiene libre el intervalo medio', async () => {
    const { servicio } = armar(
      conHuecos({
        tramosHoy: [
          tramo(1, { horaInicio: '08:00', horaFin: '08:30', conductorId: 1 }),
          tramo(2, { horaInicio: '15:30', horaFin: '16:00', conductorId: 1 }),
        ],
      }),
    );

    const r = await servicio.huecosDelDia(FECHA, { conductorId: 1 });

    expect(r.conductores).toHaveLength(1);
    expect(r.vehiculos).toHaveLength(0);
    const medio = r.conductores[0].huecos.find((h) => h.horaInicio === '08:30');
    expect(medio).toMatchObject({
      horaFin: '15:30',
      brutoMin: 420,
      horasExtra: false,
    });
  });

  it('sin filtros devuelve todos los conductores y vehículos; el vehículo en taller no tiene huecos', async () => {
    const { servicio } = armar(conHuecos());

    const r = await servicio.huecosDelDia(FECHA, {});

    expect(r.conductores.map((c) => c.conductorId)).toEqual([1, 2]);
    expect(r.vehiculos.find((v) => v.vehiculoId === 13)).toMatchObject({
      enTaller: true,
      huecos: [],
    });
    expect(
      r.vehiculos.find((v) => v.vehiculoId === 11)?.huecos.length,
    ).toBeGreaterThan(0);
  });

  it('un conductor de LIBRE sin activar no tiene ventana ni huecos', async () => {
    const { servicio } = armar(
      conHuecos({ turnos: new Map([[1, TurnoConductor.LIBRE]]) }),
    );

    const r = await servicio.huecosDelConductor(FECHA, 1);

    expect(r.ventana).toBeNull();
    expect(r.huecos).toEqual([]);
  });

  it('con zonal de destino, cada hueco trae el aprovechable', async () => {
    const { servicio } = armar(conHuecos());

    const r = await servicio.huecosDelDia(FECHA, {
      conductorId: 1,
      zonalId: CALDERON.id,
    });

    expect(r.zonalDestino).toMatchObject({ id: CALDERON.id });
    expect(r.conductores[0].huecos[0].aprovechableMin).not.toBeNull();
  });

  it('un conductor, vehículo o zonal que no existe es 404', async () => {
    const { servicio } = armar(conHuecos());

    await expect(
      servicio.huecosDelDia(FECHA, { conductorId: 99 }),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
    await expect(
      servicio.huecosDelDia(FECHA, { vehiculoId: 99 }),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
    await expect(
      servicio.huecosDelDia(FECHA, { zonalId: 99 }),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });
});
