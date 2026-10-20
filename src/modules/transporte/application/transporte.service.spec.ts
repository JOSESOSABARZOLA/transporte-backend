/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: transporte.service.spec.ts
 * Responsabilidad: Verificar la asignación, los propios medios y el desplegable.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import {
  EstadoDisponibilidad,
  EstadoTransporte,
  PoliticaVehiculo,
  RolDepartamental,
} from '@prisma/client';

import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
} from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import type { OperativosService } from '../../operativos/application/operativos.service';
import type { OperativoCompleto } from '../../operativos/infrastructure/operativos.repository';
import type { ElegibilidadService } from '../../talento-operativo/application/elegibilidad.service';
import type { FlotaRepository } from '../infrastructure/flota.repository';
import type { PlanificacionTransporteService } from './planificacion-transporte.service';
import { TransporteService } from './transporte.service';

const JORNADA = new Date(Date.UTC(2026, 11, 2));
const DAF = { usuarioId: 4, rol: RolDepartamental.DAF };

const CONDUCTOR = {
  id: 70,
  cedula: '1700000001',
  nombreCompleto: 'VIVANCO JORGE',
  telefono: null,
  licenciaTipo: 'E',
  vehiculoHabitualId: 80,
  activo: true,
  vehiculoHabitual: {
    id: 80,
    placa: 'PBA1234',
    descripcion: null,
    activo: true,
  },
};

const VEHICULO = {
  id: 80,
  placa: 'PBA1234',
  descripcion: null,
  activo: true,
};

const operativo = (parcial: Record<string, unknown> = {}): OperativoCompleto =>
  ({
    id: 500,
    identificador: 'PMO-001-02-DIC-2026',
    horaInicio: '08:00',
    horaFin: '12:00',
    esNocturno: false,
    estadoTransporte: EstadoTransporte.PENDIENTE,
    conductorId: null,
    vehiculoId: null,
    alertaActiva: true,
    cuadro: { id: 9, fecha: JORNADA },
    formulario: {
      id: 2,
      nombre: 'PMO',
      esPatrulla: false,
      condicionanteNoct: false,
      politicaVehiculo: PoliticaVehiculo.REQUERIDO,
    },
    personal: [],
    ...parcial,
  }) as unknown as OperativoCompleto;

const armar = (
  opciones: {
    operativoActual?: OperativoCompleto;
    conductor?: Record<string, unknown> | null;
    vehiculo?: Record<string, unknown> | null;
    ausenciaVehiculo?: { estado: EstadoDisponibilidad; hasta: Date } | null;
    /** Lo que responde la asignación por tramos (2026-10-14): un rechazo, si lo hay. */
    rechazoBloque?: Error;
    ausentes?: number[];
    /** PV-33. Toda la flota activa, no solo la de los conductores libres. */
    flotaCompleta?: Record<string, unknown>[];
    /** PV-33. Ausencias de la flota en la fecha, por identificador de vehículo. */
    ausenciasFlota?: Map<number, { estado: EstadoDisponibilidad; hasta: Date }>;
    escrituraBloqueada?: Error;
    /** Semáforo de carga por conductor (advisory), para el desplegable de la DAF. */
    cargasConductor?: Map<number, { nivelFatiga: string }>;
  } = {},
) => {
  const {
    operativoActual = operativo(),
    conductor = CONDUCTOR,
    vehiculo = VEHICULO,
    ausenciaVehiculo = null,
    rechazoBloque,
    ausentes = [],
    flotaCompleta = [VEHICULO],
    ausenciasFlota = new Map(),
    escrituraBloqueada,
    cargasConductor = new Map(),
  } = opciones;

  // Lo usa solo «propios medios»: la asignación va por tramos.
  const asignarTransporte = jest.fn().mockResolvedValue(
    operativo({
      estadoTransporte: EstadoTransporte.PROPIOS_MEDIOS,
      alertaActiva: false,
    }),
  );
  // La primera lectura es el operativo tal cual; las siguientes, como queda tras asignar.
  const obtener = jest
    .fn()
    .mockResolvedValueOnce(operativoActual)
    .mockResolvedValue(
      operativo({
        estadoTransporte: EstadoTransporte.ASIGNADO,
        conductorId: 70,
        vehiculoId: 80,
        alertaActiva: false,
      }),
    );
  const asignarBloque = jest
    .fn()
    .mockImplementation(() =>
      rechazoBloque
        ? Promise.reject(rechazoBloque)
        : Promise.resolve({ tramosAsignados: 1 }),
    );
  const liberarOperativo = jest.fn().mockResolvedValue(1);
  const consultarPendientesDeTransporte = jest.fn().mockResolvedValue([]);
  const desasignarTransporte = jest.fn().mockResolvedValue(
    operativo({
      estadoTransporte: EstadoTransporte.PENDIENTE,
      conductorId: null,
      vehiculoId: null,
      alertaActiva: true,
    }),
  );
  const calcularCargasConductores = jest
    .fn()
    .mockResolvedValue(cargasConductor);
  const exigirEscritura = jest
    .fn()
    .mockImplementation(() =>
      escrituraBloqueada
        ? Promise.reject(escrituraBloqueada)
        : Promise.resolve({ id: 9, fecha: JORNADA }),
    );
  const log = jest.fn();

  const flota = {
    buscarConductor: jest.fn().mockResolvedValue(conductor),
    buscarVehiculo: jest.fn().mockResolvedValue(vehiculo),
    ausenciaDeVehiculo: jest.fn().mockResolvedValue(ausenciaVehiculo),
    listarConductores: jest.fn().mockResolvedValue([CONDUCTOR]),
    conductoresAusentes: jest.fn().mockResolvedValue(new Set(ausentes)),
    listarVehiculos: jest.fn().mockResolvedValue(flotaCompleta),
    ausenciasDeVehiculos: jest.fn().mockResolvedValue(ausenciasFlota),
  };

  const servicio = new TransporteService(
    flota as unknown as FlotaRepository,
    {
      obtener,
      asignarTransporte,
      desasignarTransporte,
      consultarPendientesDeTransporte,
    } as unknown as OperativosService,
    { calcularCargasConductores } as unknown as ElegibilidadService,
    { exigirEscritura } as unknown as CuadroDiarioService,
    { log } as unknown as LoggerService,
    {
      asignarBloque,
      liberarOperativo,
    } as unknown as PlanificacionTransporteService,
  );

  return {
    servicio,
    flota,
    asignarTransporte,
    desasignarTransporte,
    asignarBloque,
    liberarOperativo,
    obtener,
    exigirEscritura,
    consultarPendientesDeTransporte,
    log,
  };
};

const capturar = async (promesa: Promise<unknown>): Promise<unknown> =>
  promesa.catch((error: unknown) => error);

describe('TransporteService · asignación', () => {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * 2026-10-14 · UNA SOLA FUENTE DE OCUPACIÓN. El endpoint clásico ya no escribe conductor y
   * vehículo en el operativo por su cuenta: delega en la asignación POR TRAMOS, que aplica
   * las mismas reglas que «Planificar el día» (solapamiento y traslado por tramo, la placa
   * ocupada RN-DAF-01, RN-44 y RN-25). Aquí se prueba el cableado; las reglas, en
   * `planificacion-transporte.service.spec.ts` y en las políticas.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('caso 1 del plan · asigna por tramos y devuelve el operativo ya asignado', async () => {
    const { servicio, asignarBloque } = armar();

    const resultado = await servicio.asignar(
      500,
      { conductorId: 70, vehiculoId: 80 },
      DAF,
    );

    expect(asignarBloque).toHaveBeenCalledWith(
      {
        fecha: JORNADA,
        operativoIds: [500],
        conductorId: 70,
        vehiculoId: 80,
      },
      DAF,
    );
    expect(resultado.operativo.estadoTransporte).toBe(
      EstadoTransporte.ASIGNADO,
    );
    expect(resultado.operativo.alertaActiva).toBe(false);
    expect(resultado.conductor?.nombreCompleto).toBe('VIVANCO JORGE');
    expect(resultado.vehiculo?.placa).toBe('PBA1234');
  });

  it('caso 11 del plan · solo viajan conductor y vehículo del operativo (regla 3)', async () => {
    const { servicio, asignarBloque, asignarTransporte } = armar();

    await servicio.asignar(500, { conductorId: 70, vehiculoId: 80 }, DAF);

    const [datos] = asignarBloque.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(datos).sort()).toEqual([
      'conductorId',
      'fecha',
      'operativoIds',
      'vehiculoId',
    ]);
    // El servicio ya no escribe el operativo directamente: lo sincroniza la asignación.
    expect(asignarTransporte).not.toHaveBeenCalled();
  });

  it('el rechazo de la asignación por tramos (descanso, solapamiento, placa) se traslada tal cual', async () => {
    const rechazo = new ReglaNegocioError(
      'VEHICULO_OCUPADO',
      'La placa PBA1234 ya está con OTRO CONDUCTOR de 10:00 a 14:00.',
      {},
    );
    const { servicio, obtener } = armar({ rechazoBloque: rechazo });

    await expect(
      servicio.asignar(500, { conductorId: 70, vehiculoId: 80 }, DAF),
    ).rejects.toBe(rechazo);
    // No se relee el operativo: no cambió.
    expect(obtener).toHaveBeenCalledTimes(1);
  });

  it('INV-13 · un formulario que opera por propios medios no admite conductor', async () => {
    const { servicio, asignarBloque } = armar({
      operativoActual: operativo({
        formulario: {
          id: 1,
          nombre: 'REACCION',
          esPatrulla: false,
          condicionanteNoct: false,
          politicaVehiculo: PoliticaVehiculo.NO_APLICA,
        },
      }),
    });

    const fallo = await capturar(
      servicio.asignar(500, { conductorId: 70, vehiculoId: 80 }, DAF),
    );

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).message).toContain('propios medios');
    expect(asignarBloque).not.toHaveBeenCalled();
  });

  it('un conductor inexistente produce 404', async () => {
    const { servicio } = armar({ conductor: null });

    await expect(
      servicio.asignar(500, { conductorId: 70, vehiculoId: 80 }, DAF),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('un conductor dado de baja se rechaza nombrándolo', async () => {
    const { servicio } = armar({
      conductor: { ...CONDUCTOR, activo: false },
    });

    const fallo = await capturar(
      servicio.asignar(500, { conductorId: 70, vehiculoId: 80 }, DAF),
    );

    expect((fallo as ReglaNegocioError).message).toContain('VIVANCO JORGE');
  });

  it('un vehículo inexistente produce 404 y uno de baja, 409', async () => {
    const sinVehiculo = armar({ vehiculo: null });
    await expect(
      sinVehiculo.servicio.asignar(
        500,
        { conductorId: 70, vehiculoId: 80 },
        DAF,
      ),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);

    const deBaja = armar({ vehiculo: { ...VEHICULO, activo: false } });
    const fallo = await capturar(
      deBaja.servicio.asignar(500, { conductorId: 70, vehiculoId: 80 }, DAF),
    );
    expect((fallo as ReglaNegocioError).message).toContain('PBA1234');
  });

  it('un vehículo en mantenimiento no se asigna', async () => {
    const { servicio } = armar({
      ausenciaVehiculo: {
        estado: EstadoDisponibilidad.MANTENIMIENTO,
        hasta: new Date(Date.UTC(2026, 11, 10)),
      },
    });

    const fallo = await capturar(
      servicio.asignar(500, { conductorId: 70, vehiculoId: 80 }, DAF),
    );

    expect((fallo as ReglaNegocioError).message).toContain('mantenimiento');
    expect((fallo as ReglaNegocioError).message).toContain('2026-12-10');
  });

  it('un cuadro cerrado no admite asignación', async () => {
    const cerrado = new Error('cuadro cerrado');
    const { servicio, asignarBloque } = armar({
      escrituraBloqueada: cerrado,
    });

    await expect(
      servicio.asignar(500, { conductorId: 70, vehiculoId: 80 }, DAF),
    ).rejects.toBe(cerrado);
    expect(asignarBloque).not.toHaveBeenCalled();
  });
});

describe('TransporteService · propios medios', () => {
  it('caso 8 del plan · queda en PROPIOS_MEDIOS, sin conductor ni vehículo', async () => {
    const { servicio, asignarTransporte } = armar();

    const resultado = await servicio.declararPropiosMedios(500, DAF);

    expect(asignarTransporte).toHaveBeenCalledWith(500, null, DAF);
    expect(resultado.operativo.estadoTransporte).toBe(
      EstadoTransporte.PROPIOS_MEDIOS,
    );
    expect(resultado.conductor).toBeNull();
    expect(resultado.vehiculo).toBeNull();
    expect(resultado.operativo.alertaActiva).toBe(false);
  });

  it('RN-43 · el nocturno con condicionante NO puede declararse por propios medios', async () => {
    const { servicio, asignarTransporte } = armar({
      operativoActual: operativo({
        esNocturno: true,
        formulario: {
          id: 6,
          nombre: 'PATRULLA NOCTURNA',
          esPatrulla: true,
          condicionanteNoct: true,
          politicaVehiculo: PoliticaVehiculo.REQUERIDO,
        },
      }),
    });

    const fallo = await capturar(servicio.declararPropiosMedios(500, DAF));

    expect((fallo as ReglaNegocioError).code).toBe('CONDICIONANTE_NOCTURNO');
    expect(asignarTransporte).not.toHaveBeenCalled();
  });

  it('el mismo formulario en horario diurno sí puede', async () => {
    const { servicio, asignarTransporte } = armar({
      operativoActual: operativo({
        esNocturno: false,
        formulario: {
          id: 6,
          nombre: 'PATRULLA',
          esPatrulla: true,
          condicionanteNoct: true,
          politicaVehiculo: PoliticaVehiculo.REQUERIDO,
        },
      }),
    });

    await servicio.declararPropiosMedios(500, DAF);

    expect(asignarTransporte).toHaveBeenCalled();
  });

  it('declararlo dos veces no es un error', async () => {
    const { servicio, asignarTransporte } = armar({
      operativoActual: operativo({
        estadoTransporte: EstadoTransporte.PROPIOS_MEDIOS,
      }),
    });

    await servicio.declararPropiosMedios(500, DAF);

    expect(asignarTransporte).toHaveBeenCalled();
  });
});

describe('TransporteService · el desplegable (RN-45)', () => {
  it('caso 9 del plan · cada conductor viaja con su vehículo habitual', async () => {
    const { servicio } = armar();

    const conductores = await servicio.conductoresDisponibles(JORNADA);

    expect(conductores).toHaveLength(1);
    expect(conductores[0].vehiculoHabitual).toEqual({
      id: 80,
      placa: 'PBA1234',
    });
  });

  it('excluye a los ausentes, y la exclusión ocurre en el servidor', async () => {
    const { servicio } = armar({ ausentes: [70] });

    expect(await servicio.conductoresDisponibles(JORNADA)).toHaveLength(0);
  });

  it('adjunta el semáforo de carga del conductor (advisory), sin excluirlo', async () => {
    // La carga alta NO saca al conductor del desplegable: solo lo señala. La DAF decide.
    const { servicio } = armar({
      cargasConductor: new Map([[70, { nivelFatiga: 'ROJO' }]]),
    });

    const [conductor] = await servicio.conductoresDisponibles(JORNADA);

    expect(conductor.nivelCarga).toBe('ROJO');
  });

  it('el conductor sin vehículo habitual se ofrece igual, sin placa propuesta', async () => {
    const { servicio } = armar();
    const sinVehiculo = new TransporteService(
      {
        listarConductores: jest
          .fn()
          .mockResolvedValue([{ ...CONDUCTOR, vehiculoHabitual: null }]),
        conductoresAusentes: jest.fn().mockResolvedValue(new Set()),
      } as unknown as FlotaRepository,
      {} as unknown as OperativosService,
      {
        calcularCargasConductores: jest.fn().mockResolvedValue(new Map()),
      } as unknown as ElegibilidadService,
      {} as unknown as CuadroDiarioService,
      {} as unknown as LoggerService,
    );

    expect(await servicio.conductoresDisponibles(JORNADA)).toHaveLength(1);
    const conductores = await sinVehiculo.conductoresDisponibles(JORNADA);
    expect(conductores[0].vehiculoHabitual).toBeNull();
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PV-33 · 2026-08-31. LA FLOTA COMPLETA.
 *
 * Hasta esta fecha las placas salían del vehículo habitual de cada conductor libre, así
 * que un vehículo sin conductor habitual era inasignable y además invisible. Estas
 * pruebas fijan las dos mitades del arreglo: que llega entera, y que la que no se puede
 * usar llega igualmente, marcada y con su motivo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('TransporteService · flota completa del día', () => {
  const OTRO_VEHICULO = {
    id: 81,
    placa: 'PMA7056',
    descripcion: 'Camioneta doble cabina',
    activo: true,
  };

  it('devuelve todas las placas activas, tengan o no conductor habitual', async () => {
    // La 81 no es el vehículo habitual de nadie: antes de PV-33 no se podía elegir.
    const { servicio } = armar({ flotaCompleta: [VEHICULO, OTRO_VEHICULO] });

    const flota = await servicio.vehiculosDeLaFlota(JORNADA);

    expect(flota.map((vehiculo) => vehiculo.placa)).toEqual([
      'PBA1234',
      'PMA7056',
    ]);
  });

  it('sin ausencias, todas son utilizables y ninguna lleva motivo', async () => {
    const { servicio } = armar({ flotaCompleta: [VEHICULO, OTRO_VEHICULO] });

    const flota = await servicio.vehiculosDeLaFlota(JORNADA);

    expect(flota.every((vehiculo) => vehiculo.utilizable)).toBe(true);
    expect(flota.every((vehiculo) => vehiculo.motivo === null)).toBe(true);
  });

  /**
   * LA QUE DE VERDAD IMPORTA. La placa en taller **no desaparece**: llega marcada, con el
   * motivo en palabras. Es el criterio de la regla 14 del frontend, y lo contrario de lo
   * que se hace con los conductores ausentes.
   */
  it('la placa en mantenimiento sigue viniendo, marcada y con su motivo', async () => {
    const { servicio } = armar({
      flotaCompleta: [VEHICULO, OTRO_VEHICULO],
      ausenciasFlota: new Map([
        [
          81,
          {
            estado: EstadoDisponibilidad.MANTENIMIENTO,
            hasta: new Date(Date.UTC(2026, 11, 4)),
          },
        ],
      ]),
    });

    const flota = await servicio.vehiculosDeLaFlota(JORNADA);

    expect(flota).toHaveLength(2);

    const enTaller = flota.find((vehiculo) => vehiculo.id === 81);
    expect(enTaller?.utilizable).toBe(false);
    expect(enTaller?.motivo).toBe('En mantenimiento hasta el 2026-12-04.');

    // Y la otra no se contagia.
    expect(flota.find((vehiculo) => vehiculo.id === 80)?.utilizable).toBe(true);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * P-07 · 2026-08-31. DESHACER LA DECISIÓN.
 *
 * La bandeja solo listaba pendientes y no existía transición de salida: un error de
 * asignación solo se corregía con una sentencia en la base.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('TransporteService · desasignación', () => {
  it('un ASIGNADO vacía sus TRAMOS (2026-10-14), que es lo que libera al conductor', async () => {
    const { servicio, liberarOperativo, desasignarTransporte } = armar({
      operativoActual: operativo({
        estadoTransporte: EstadoTransporte.ASIGNADO,
        conductorId: 70,
        vehiculoId: 80,
        alertaActiva: false,
      }),
    });

    const resultado = await servicio.desasignar(500, DAF);

    expect(liberarOperativo).toHaveBeenCalledWith(500, DAF);
    expect(desasignarTransporte).not.toHaveBeenCalled();
    expect(resultado.conductor).toBeNull();
    expect(resultado.vehiculo).toBeNull();
  });

  /**
   * Revierte las DOS decisiones, no solo la asignación: propios medios también se puede
   * declarar por error, y era igual de irreversible.
   */
  it('también deshace un operativo declarado por propios medios', async () => {
    const { servicio, desasignarTransporte } = armar({
      operativoActual: operativo({
        estadoTransporte: EstadoTransporte.PROPIOS_MEDIOS,
      }),
    });

    await servicio.desasignar(500, DAF);

    expect(desasignarTransporte).toHaveBeenCalledWith(500, DAF);
  });

  /**
   * NO SE BLOQUEA POR EL CONDICIONANTE NOCTURNO, y es lo contrario de lo que hace
   * `declararPropiosMedios`. Volver a PENDIENTE no deja al operativo sin transporte: lo
   * deja pendiente de resolver. Bloquearlo aquí dejaría un nocturno mal asignado sin
   * ninguna salida por la aplicación, que es justo el defecto que esto corrige.
   */
  it('un nocturno con condicionante se puede desasignar', async () => {
    const { servicio, liberarOperativo } = armar({
      operativoActual: operativo({
        estadoTransporte: EstadoTransporte.ASIGNADO,
        conductorId: 70,
        vehiculoId: 80,
        esNocturno: true,
        formulario: {
          id: 4,
          nombre: 'ECU',
          esPatrulla: true,
          condicionanteNoct: true,
          politicaVehiculo: PoliticaVehiculo.REQUERIDO,
        },
      }),
    });

    await servicio.desasignar(500, DAF);

    expect(liberarOperativo).toHaveBeenCalled();
  });

  it('respeta la jornada cerrada: si no admite escritura, no escribe', async () => {
    const { servicio, desasignarTransporte, liberarOperativo } = armar({
      escrituraBloqueada: new Error('El cuadro está cerrado.'),
    });

    await capturar(servicio.desasignar(500, DAF));

    expect(desasignarTransporte).not.toHaveBeenCalled();
    expect(liberarOperativo).not.toHaveBeenCalled();
  });
});

describe('TransporteService · bandeja de corrección', () => {
  it('por omisión pide solo los pendientes', async () => {
    const { servicio, consultarPendientesDeTransporte } = armar();

    await servicio.consultarPendientes(JORNADA);

    expect(consultarPendientesDeTransporte).toHaveBeenCalledWith(JORNADA, true);
  });

  it('con `incluirResueltos` pide también los ya resueltos', async () => {
    const { servicio, consultarPendientesDeTransporte } = armar();

    await servicio.consultarPendientes(JORNADA, true);

    expect(consultarPendientesDeTransporte).toHaveBeenCalledWith(
      JORNADA,
      false,
    );
  });
});
