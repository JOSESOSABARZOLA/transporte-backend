/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Flota y garajes
 * Archivo: flota.service.spec.ts
 * Responsabilidad: Verificar la baja con asignación vigente, la baja del vehículo que deja sin
 *   vehículo a sus conductores, la reactivación, el formato de placa y los indicadores. Desde el
 *   2026-10-20: la baja guarda fecha y autor sin pasar por la edición, el mantenimiento abierto la
 *   impide y el aviso previo da el mismo motivo que el 409.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-14
 */

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { FlotaRepository } from '../infrastructure/flota.repository';
import { FlotaService } from './flota.service';
import type { ParametrosTransporteService } from './parametros-transporte.service';

const dia = (texto: string) => new Date(`${texto}T00:00:00.000Z`);

const VEHICULO = {
  id: 7,
  placa: 'PBA-1235',
  descripcion: 'Camioneta blanca',
  activo: true,
  tipo: 'Camioneta',
  asientos: 4,
  kilometraje: 85000,
  matriculaVencimiento: null,
  soatVencimiento: null,
};

const CONDUCTOR = {
  id: 3,
  cedula: '1720476900',
  nombreCompleto: 'ESCALERAS KEVIN ANDRES',
  telefono: null,
  licenciaTipo: 'C',
  vehiculoHabitualId: 7,
  vehiculoHabitual: VEHICULO,
  activo: true,
};

const armar = (
  opciones: {
    tramos?: {
      fecha: string;
      horaInicio: string;
      horaFin: string;
      cruzaMedianoche: boolean;
      identificador: string;
      esTarea: boolean;
    }[];
    paradas?: {
      desde: string;
      hasta: string;
      motivo: string | null;
      estado: string | null;
    }[];
    vehiculo?: Partial<typeof VEHICULO>;
    conductor?: Partial<typeof CONDUCTOR>;
    habituales?: { id: number; nombreCompleto: string; activo: boolean }[];
  } = {},
) => {
  const vehiculo = { ...VEHICULO, ...opciones.vehiculo };
  const conductor = { ...CONDUCTOR, ...opciones.conductor };
  const repositorio = {
    buscarVehiculo: jest.fn().mockResolvedValue(vehiculo),
    buscarConductor: jest.fn().mockResolvedValue(conductor),
    buscarVehiculoPorPlaca: jest.fn().mockResolvedValue(null),
    tramosParaBaja: jest.fn().mockResolvedValue(opciones.tramos ?? []),
    paradasParaBaja: jest.fn().mockResolvedValue(opciones.paradas ?? []),
    nombresDeUsuarios: jest.fn().mockResolvedValue({ 1: 'Ana Pérez' }),
    listarVehiculos: jest.fn().mockResolvedValue([vehiculo]),
    mantenimientosEnRango: jest.fn().mockResolvedValue([]),
    conductoresConVehiculoHabitual: jest
      .fn()
      .mockResolvedValue(opciones.habituales ?? []),
    contarOperativosDeVehiculo: jest.fn().mockResolvedValue(4),
    contarOperativosDeConductor: jest.fn().mockResolvedValue(2),
    actualizarVehiculo: jest
      .fn()
      .mockImplementation((id: number, cambios: object) =>
        Promise.resolve({ ...vehiculo, ...cambios }),
      ),
    actualizarConductor: jest
      .fn()
      .mockImplementation((id: number, cambios: object) =>
        Promise.resolve({ ...conductor, ...cambios }),
      ),
    crearVehiculo: jest
      .fn()
      .mockImplementation((datos: object) =>
        Promise.resolve({ ...vehiculo, ...datos }),
      ),
    quitarVehiculoHabitual: jest.fn().mockResolvedValue(undefined),
    datosDelResumen: jest.fn(),
    ejecutarEnTransaccion: jest
      .fn()
      .mockImplementation((op: (c: unknown) => Promise<unknown>) => op({})),
  };
  const auditoria = {
    registrar: jest.fn().mockResolvedValue(undefined),
    registrarVarios: jest.fn().mockResolvedValue(undefined),
    compararCambios: jest
      .fn()
      .mockImplementation(
        (antes: Record<string, unknown>, despues: Record<string, unknown>) =>
          Object.keys(despues)
            .filter((k) => String(antes[k]) !== String(despues[k]))
            .map((campo) => ({ campo })),
      ),
  };
  const parametros = {
    leerKmMaximo: jest.fn().mockResolvedValue(999_999),
  };
  const servicio = new FlotaService(
    repositorio as unknown as FlotaRepository,
    auditoria as unknown as AuditoriaService,
    parametros as unknown as ParametrosTransporteService,
  );
  return { servicio, repositorio, auditoria, parametros };
};

/** Un traslado de un día futuro: aún no termina, a cualquier hora en que corra la prueba. */
const TRAMO = {
  fecha: '2099-10-15',
  horaInicio: '07:30',
  horaFin: '08:00',
  cruzaMedianoche: false,
  identificador: 'F5-2099-10-15-003',
  esTarea: false,
};

describe('FlotaService · baja con asignación vigente (2026-10-14; D2 2026-10-20)', () => {
  it('rechaza con 409 la baja de un vehículo con traslados que no terminan y nombra el primero', async () => {
    const { servicio, repositorio } = armar({
      tramos: [
        { ...TRAMO, identificador: 'F5-2099-10-16-001', fecha: '2099-10-16' },
        TRAMO,
      ],
    });

    const intento = servicio.desactivarVehiculo(7, 1);

    await expect(intento).rejects.toBeInstanceOf(ReglaNegocioError);
    await expect(intento).rejects.toMatchObject({
      statusCode: 409,
      code: CODIGOS_ERROR.RECURSO_CON_ASIGNACION,
      message:
        'El vehículo de placa PBA-1235 tiene transporte asignado el 15/10/2099 a las 07H30 (el operativo F5-2099-10-15-003) y 1 traslado más. Libere esa asignación en «Planificar el día» antes de darlo de baja.',
    });
    expect(repositorio.actualizarVehiculo).not.toHaveBeenCalled();
    expect(repositorio.tramosParaBaja).toHaveBeenCalledWith(
      { vehiculoId: 7 },
      expect.any(Date),
    );
  });

  it('la TAREA de taller no impide la baja del vehículo (la cubre su parada)', async () => {
    const { servicio, repositorio } = armar({
      tramos: [
        { ...TRAMO, esTarea: true, identificador: 'Llevar a taller PBA-1235' },
      ],
    });

    await servicio.desactivarVehiculo(7, 1);

    expect(repositorio.actualizarVehiculo).toHaveBeenCalled();
  });

  it('un mantenimiento abierto impide la baja del vehículo; uno LISTO no', async () => {
    const abierta = armar({
      paradas: [
        {
          desde: '2099-10-20',
          hasta: '2099-10-23',
          motivo: 'Cambio de frenos',
          estado: 'PROGRAMADO',
        },
      ],
    });
    await expect(
      abierta.servicio.desactivarVehiculo(7, 1),
    ).rejects.toMatchObject({
      code: CODIGOS_ERROR.RECURSO_CON_ASIGNACION,
      message:
        'El vehículo de placa PBA-1235 tiene un mantenimiento abierto del 20/10/2099 al 23/10/2099 (Cambio de frenos). Retírelo o márquelo como listo en «Programar mantenimiento» antes de darlo de baja.',
    });

    const lista = armar({
      paradas: [
        {
          desde: '2099-10-20',
          hasta: '2099-10-23',
          motivo: null,
          estado: 'LISTO',
        },
      ],
    });
    await lista.servicio.desactivarVehiculo(7, 1);
    expect(lista.repositorio.actualizarVehiculo).toHaveBeenCalled();
  });

  it('rechaza con 409 la baja de un conductor con traslados o TAREAS que no terminan', async () => {
    const { servicio, repositorio } = armar({
      tramos: [
        { ...TRAMO, esTarea: true, identificador: 'Llevar a taller PBA-1235' },
      ],
    });

    await expect(servicio.desactivarConductor(3, 1)).rejects.toMatchObject({
      code: CODIGOS_ERROR.RECURSO_CON_ASIGNACION,
      message: expect.stringContaining(
        '(la tarea «Llevar a taller PBA-1235»)',
      ) as string,
    });
    expect(repositorio.actualizarConductor).not.toHaveBeenCalled();
  });

  it('«desde hoy» es el día de Quito a medianoche UTC (columna @db.Date)', async () => {
    const { servicio, repositorio } = armar();

    await servicio.impactoBajaConductor(3);

    const [[, desde]] = repositorio.tramosParaBaja.mock.calls as [
      [unknown, Date],
    ];
    expect(desde.toISOString().endsWith('T00:00:00.000Z')).toBe(true);
  });

  it('el aviso previo da el MISMO motivo que el 409', async () => {
    const { servicio } = armar({ tramos: [TRAMO] });

    const impacto = await servicio.impactoBajaConductor(3);
    const rechazo = await servicio
      .desactivarConductor(3, 1)
      .catch((e: Error) => e.message);

    expect(impacto.motivo).toBe(rechazo);
  });
});

describe('FlotaService · la baja guarda fecha y autor sin pasar por la edición (D1, 2026-10-20)', () => {
  it('dar de baja a un conductor con un acta incoherente heredada funciona', async () => {
    const { servicio, repositorio, auditoria } = armar({
      conductor: {
        parqueaderoAutorizado: false,
        actaParqueaderoNumero: 'ACTA-1',
      } as Partial<typeof CONDUCTOR>,
    });

    await servicio.desactivarConductor(3, 5);

    expect(repositorio.actualizarConductor).toHaveBeenCalledWith(
      3,
      { activo: false, bajaEn: expect.any(Date) as Date, bajaPor: 5 },
      expect.anything(),
    );
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 't_conductor', entidadId: 3 }),
      expect.anything(),
    );
  });

  it('reactivar vacía la fecha y el autor', async () => {
    const { servicio, repositorio } = armar({
      vehiculo: { activo: false },
      conductor: { activo: false },
    });

    await servicio.reactivarVehiculo(7, 5);
    await servicio.reactivarConductor(3, 5);

    expect(repositorio.actualizarVehiculo).toHaveBeenCalledWith(
      7,
      { activo: true, bajaEn: null, bajaPor: null },
      expect.anything(),
    );
    expect(repositorio.actualizarConductor).toHaveBeenCalledWith(
      3,
      { activo: true, bajaEn: null, bajaPor: null },
      expect.anything(),
    );
  });

  it('la lista trae el nombre de quien dio de baja, en una consulta', async () => {
    const { servicio, repositorio } = armar();
    repositorio.listarVehiculos.mockResolvedValue([
      { ...VEHICULO, activo: false, bajaEn: dia('2026-10-14'), bajaPor: 1 },
      { ...VEHICULO, id: 8, bajaEn: null, bajaPor: null },
    ]);

    const filas = await servicio.listarVehiculos(true);

    expect(filas.map((f) => f.bajaPorNombre)).toEqual(['Ana Pérez', null]);
    expect(repositorio.nombresDeUsuarios).toHaveBeenCalledTimes(1);
  });
});

describe('FlotaService · disponibilidad por fecha (D3, 2026-10-20)', () => {
  it('pide los vehículos y las paradas de la semana una sola vez', async () => {
    const { servicio, repositorio } = armar();

    const respuesta = await servicio.disponibilidad('2026-10-20');

    expect(respuesta.hasta).toBe('2026-10-26');
    expect(repositorio.listarVehiculos).toHaveBeenCalledWith(false);
    expect(repositorio.mantenimientosEnRango).toHaveBeenCalledWith(
      dia('2026-10-20'),
      dia('2026-10-26'),
    );
    expect(respuesta.vehiculos[0].disponibilidad).toBe('DISPONIBLE');
  });
});

describe('FlotaService · baja del vehículo deja sin vehículo a sus conductores (D3)', () => {
  it('quita el vehículo habitual en la misma transacción, con una traza por conductor', async () => {
    const { servicio, repositorio, auditoria } = armar({
      habituales: [
        { id: 3, nombreCompleto: 'ESCALERAS KEVIN ANDRES', activo: true },
        { id: 9, nombreCompleto: 'DADO DE BAJA', activo: false },
      ],
    });

    const baja = await servicio.desactivarVehiculo(7, 1);

    expect(repositorio.actualizarVehiculo).toHaveBeenCalledWith(
      7,
      { activo: false, bajaEn: expect.any(Date) as Date, bajaPor: 1 },
      expect.anything(),
    );
    expect(repositorio.quitarVehiculoHabitual).toHaveBeenCalledWith(
      [3, 9],
      expect.anything(),
    );
    const [[filas]] = auditoria.registrarVarios.mock.calls as [
      [{ entidad: string; entidadId: number }[]],
    ];
    expect(filas.map((f) => `${f.entidad}:${f.entidadId}`)).toEqual([
      't_vehiculo:7',
      't_conductor:3',
      't_conductor:9',
    ]);
    // Solo se nombra a los activos.
    expect(baja.conductoresSinVehiculo).toEqual([
      { id: 3, nombreCompleto: 'ESCALERAS KEVIN ANDRES' },
    ]);
    expect(baja.mensaje).toBe(
      'El vehículo de placa PBA-1235 dejó de ofrecerse en la asignación de transporte. Su historial se conserva. Quedaron sin vehículo habitual: ESCALERAS KEVIN ANDRES.',
    );
  });

  it('un vehículo ya dado de baja no se toca', async () => {
    const { servicio, repositorio } = armar({ vehiculo: { activo: false } });

    const baja = await servicio.desactivarVehiculo(7, 1);

    expect(baja.mensaje).toContain('ya estaba dado de baja');
    expect(repositorio.ejecutarEnTransaccion).not.toHaveBeenCalled();
  });

  it('el impacto avisa de los conductores activos y de las asignaciones', async () => {
    const { servicio } = armar({
      tramos: [TRAMO],
      habituales: [
        { id: 3, nombreCompleto: 'ESCALERAS KEVIN ANDRES', activo: true },
        { id: 9, nombreCompleto: 'DADO DE BAJA', activo: false },
      ],
    });

    expect(await servicio.impactoBajaVehiculo(7)).toEqual({
      asignacionesVigentes: 1,
      primeraAsignacion: {
        fecha: '2099-10-15',
        horaInicio: '07:30',
        identificador: 'F5-2099-10-15-003',
      },
      conductoresHabituales: [
        { id: 3, nombreCompleto: 'ESCALERAS KEVIN ANDRES' },
      ],
      motivo:
        'El vehículo de placa PBA-1235 tiene transporte asignado el 15/10/2099 a las 07H30 (el operativo F5-2099-10-15-003). Libere esa asignación en «Planificar el día» antes de darlo de baja.',
    });
  });
});

describe('FlotaService · reactivar (2026-10-14)', () => {
  it('reactiva un vehículo y un conductor dados de baja', async () => {
    const { servicio, repositorio } = armar({
      vehiculo: { activo: false },
      conductor: { activo: false },
    });

    expect((await servicio.reactivarVehiculo(7, 1)).activo).toBe(true);
    expect((await servicio.reactivarConductor(3, 1)).activo).toBe(true);
    expect(repositorio.actualizarVehiculo).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ activo: true }),
      expect.anything(),
    );
  });

  it('reactivar lo que ya está activo no escribe nada', async () => {
    const { servicio, repositorio } = armar();

    await servicio.reactivarVehiculo(7, 1);
    await servicio.reactivarConductor(3, 1);

    expect(repositorio.ejecutarEnTransaccion).not.toHaveBeenCalled();
  });
});

describe('FlotaService · formato de placa (D4)', () => {
  it('una placa nueva sin formato se rechaza; sin guion se le pone', async () => {
    const { servicio, repositorio } = armar();

    await expect(
      servicio.crearVehiculo({ placa: 'PB-12' }, 1),
    ).rejects.toBeInstanceOf(ValidacionError);

    await servicio.crearVehiculo({ placa: 'gye 233' }, 1);
    expect(repositorio.crearVehiculo).toHaveBeenCalledWith(
      expect.objectContaining({ placa: 'GYE-233' }),
      expect.anything(),
    );
  });

  it('una placa ya registrada fuera de formato no se rompe al editar otra cosa', async () => {
    const { servicio, repositorio } = armar({ vehiculo: { placa: 'X1' } });

    await servicio.actualizarVehiculo(
      7,
      { placa: 'x1', descripcion: 'Otra' },
      1,
    );

    expect(repositorio.actualizarVehiculo).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ placa: 'X1', descripcion: 'Otra' }),
      expect.anything(),
    );
  });

  it('PMA-7056 es duplicado de una PMA7056 registrada sin guion', async () => {
    const { servicio, repositorio } = armar();
    repositorio.buscarVehiculoPorPlaca.mockImplementation((p: string) =>
      Promise.resolve(p === 'PMA7056' ? { ...VEHICULO, id: 40 } : null),
    );

    await expect(
      servicio.crearVehiculo({ placa: 'PMA-7056' }, 1),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('ponerle el guion a la propia placa no choca consigo misma', async () => {
    const { servicio, repositorio } = armar({ vehiculo: { placa: 'PMA7056' } });
    repositorio.buscarVehiculoPorPlaca.mockImplementation((p: string) =>
      Promise.resolve(p === 'PMA7056' ? { ...VEHICULO, id: 7 } : null),
    );

    await servicio.actualizarVehiculo(7, { placa: 'PMA-7056' }, 1);

    expect(repositorio.actualizarVehiculo).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ placa: 'PMA-7056' }),
      expect.anything(),
    );
  });

  it.each(['PMA3370', 'pma-3370', 'PMA 3370'])(
    '%s es duplicado de la PMA-3370 registrada, con el mensaje de siempre',
    async (escrita) => {
      const { servicio, repositorio } = armar();
      repositorio.buscarVehiculoPorPlaca.mockImplementation((p: string) =>
        Promise.resolve(p === 'PMA-3370' ? { ...VEHICULO, id: 60 } : null),
      );

      await expect(
        servicio.crearVehiculo({ placa: escrita }, 1),
      ).rejects.toMatchObject({
        message: 'Ya existe un vehículo con esa placa.',
      });
      expect(repositorio.crearVehiculo).not.toHaveBeenCalled();
    },
  );

  it('la misma placa escrita en minúsculas o sin guion no es un cambio', async () => {
    const { servicio, repositorio } = armar({
      vehiculo: { placa: 'PMA-3370' },
    });

    await servicio.actualizarVehiculo(
      7,
      { placa: 'pma 3370', descripcion: 'Otra' },
      1,
    );

    expect(repositorio.buscarVehiculoPorPlaca).not.toHaveBeenCalled();
    expect(repositorio.actualizarVehiculo).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ placa: 'PMA-3370' }),
      expect.anything(),
    );
  });

  it('cambiar la placa a una sin formato se rechaza', async () => {
    const { servicio } = armar();

    await expect(
      servicio.actualizarVehiculo(7, { placa: 'ABC-12' }, 1),
    ).rejects.toBeInstanceOf(ValidacionError);
  });
});

describe('FlotaService · tope de kilometraje (A2, 2026-10-15)', () => {
  it('al crear, un kilometraje sobre DAF_KM_MAXIMO se rechaza', async () => {
    const { servicio, repositorio } = armar();

    await expect(
      servicio.crearVehiculo({ placa: 'ABC-123', kilometraje: 1_000_000 }, 1),
    ).rejects.toMatchObject({
      message: 'Revise el kilometraje: parece demasiado alto.',
    });
    expect(repositorio.crearVehiculo).not.toHaveBeenCalled();

    await servicio.crearVehiculo({ placa: 'ABC-123', kilometraje: 999_999 }, 1);
    expect(repositorio.crearVehiculo).toHaveBeenCalled();
  });

  it('al editar, solo se valida si el kilometraje cambia', async () => {
    const { servicio, repositorio, parametros } = armar({
      vehiculo: { kilometraje: 1_100_000 },
    });

    // El registrado sobre el tope no bloquea editar otra cosa (se reporta, no se corrige).
    await servicio.actualizarVehiculo(
      7,
      { kilometraje: 1_100_000, descripcion: 'Otra' },
      1,
    );
    expect(parametros.leerKmMaximo).not.toHaveBeenCalled();
    expect(repositorio.actualizarVehiculo).toHaveBeenCalled();

    await expect(
      servicio.actualizarVehiculo(7, { kilometraje: 1_200_000 }, 1),
    ).rejects.toBeInstanceOf(ValidacionError);
    await servicio.actualizarVehiculo(7, { kilometraje: 120_000 }, 1);
    expect(repositorio.actualizarVehiculo).toHaveBeenCalledTimes(2);
  });
});

describe('FlotaService · resumen', () => {
  it('cuenta con los datos del repositorio, el día y el aviso dados', async () => {
    const { servicio, repositorio } = armar();
    repositorio.datosDelResumen.mockResolvedValue([
      [
        {
          id: 7,
          activo: true,
          matriculaVencimiento: dia('2026-10-20'),
          soatVencimiento: null,
        },
        {
          id: 8,
          activo: false,
          matriculaVencimiento: null,
          soatVencimiento: null,
        },
      ],
      [
        {
          activo: true,
          vehiculoHabitualId: 7,
          vehiculoHabitual: { activo: true },
          tipoContrato: null,
          patronRotacion: 'DDLL',
        },
      ],
      [{ activo: true, garajeAutorizado: true }],
      [{ vehiculoId: 7 }, { vehiculoId: 8 }],
    ]);

    expect(await servicio.resumen(30, '2026-10-14')).toEqual({
      vehiculos: {
        activos: 1,
        deBaja: 1,
        documentosPorVencer: 1,
        sinFechas: 0,
        sinConductorHabitual: 0,
        // El 8 está en el taller pero de baja: no cuenta.
        enTallerHoy: 1,
      },
      conductores: { activos: 1, deBaja: 0, incompletos: 1 },
      garajes: { vigentes: 1, deBaja: 0 },
    });
  });
});
