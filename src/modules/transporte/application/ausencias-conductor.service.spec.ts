/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ausencias de conductores
 * Archivo: ausencias-conductor.service.spec.ts
 * Responsabilidad: Verificar las reglas del registro y el retiro de ausencias de conductor.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-16
 *
 * LO QUE ESTAS PRUEBAS PROTEGEN es que la ausencia de un conductor se mida con la misma vara
 * que la del personal: rango, INV-14 (409 AUSENCIA_SOLAPADA), una pasada no se quita (409
 * AUSENCIA_PASADA), el motivo nunca entra en la traza, y los tramos ya asignados se AVISAN sin
 * retirarlos (A5).
 */

import { AccionAuditoria, EstadoDisponibilidad } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { AusenciasConductorRepository } from '../infrastructure/ausencias-conductor.repository';
import { CrearAusenciaConductorDto } from '../presentation/dto/ausencias-conductor.dto';
import { AusenciasConductorService } from './ausencias-conductor.service';

const dia = (numero: number) => new Date(Date.UTC(2026, 9, numero));

const ausencia = (desde: number, hasta: number, id = 7, conductorId = 3) => ({
  id,
  funcionarioId: null,
  conductorId,
  vehiculoId: null,
  estado: EstadoDisponibilidad.VACACIONES,
  desde: dia(desde),
  hasta: dia(hasta),
  motivo: 'Cirugía programada',
  registradoPor: 14,
  creadoEn: new Date(),
});

const armar = (
  opciones: {
    conductor?: { nombreCompleto: string } | null;
    solapadas?: ReturnType<typeof ausencia>[];
    existente?: ReturnType<typeof ausencia> | null;
    tramos?: unknown[];
  } = {},
) => {
  const {
    conductor = { nombreCompleto: 'PEREZ JUAN' },
    solapadas = [],
    existente = ausencia(20, 22),
    tramos = [],
  } = opciones;

  const crear = jest
    .fn()
    .mockImplementation((datos: Record<string, unknown>) =>
      Promise.resolve({ id: 99, ...datos }),
    );
  const eliminar = jest.fn().mockResolvedValue(undefined);
  const registrar = jest.fn().mockResolvedValue(undefined);

  const repositorio = {
    existeConductor: jest.fn().mockResolvedValue(conductor),
    listarDe: jest.fn().mockResolvedValue([ausencia(20, 22)]),
    vigentesYProximas: jest.fn().mockResolvedValue([]),
    solapadas: jest.fn().mockResolvedValue(solapadas),
    buscar: jest.fn().mockResolvedValue(existente),
    tramosEnRango: jest.fn().mockResolvedValue(tramos),
    crear,
    eliminar,
    ejecutarEnTransaccion: jest.fn(
      (operacion: (cliente: unknown) => Promise<unknown>) => operacion({}),
    ),
  };

  const servicio = new AusenciasConductorService(
    repositorio as unknown as AusenciasConductorRepository,
    { registrar } as unknown as AuditoriaService,
  );

  return { servicio, repositorio, crear, eliminar, registrar };
};

const datos = (desde: number, hasta: number, motivo?: string) => ({
  estado: EstadoDisponibilidad.VACACIONES,
  desde: dia(desde),
  hasta: dia(hasta),
  motivo,
});

describe('AusenciasConductorService · registrar', () => {
  it('registra la ausencia por cond_id y deja la traza SIN el motivo', async () => {
    const { servicio, crear, registrar } = armar();

    const { ausencia: creada } = await servicio.registrar(
      3,
      datos(20, 22, '  Cirugía programada  '),
      14,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        conductorId: 3,
        motivo: 'Cirugía programada',
        registradoPor: 14,
      }),
      expect.anything(),
    );
    expect(creada.id).toBe(99);

    const traza = (registrar.mock.calls as unknown[][])[0][0] as {
      accion: AccionAuditoria;
      cambios: { valorNuevo: string }[];
    };
    expect(traza.accion).toBe(AccionAuditoria.CREAR);
    expect(traza.cambios[0].valorNuevo).toBe(
      'VACACIONES · conductor 3 · 2026-10-20 a 2026-10-22',
    );
    expect(JSON.stringify(registrar.mock.calls)).not.toContain('Cirugía');
  });

  it('un motivo vacío se guarda como null', async () => {
    const { servicio, crear } = armar();
    await servicio.registrar(3, datos(20, 22, '   '), 14);
    expect((crear.mock.calls as unknown[][])[0][0]).toMatchObject({
      motivo: null,
    });
  });

  it('404 si el conductor no existe', async () => {
    const { servicio, crear } = armar({ conductor: null });
    await expect(servicio.registrar(9, datos(20, 22), 14)).rejects.toThrow(
      RecursoNoEncontradoError,
    );
    expect(crear).not.toHaveBeenCalled();
  });

  it('rechaza un rango invertido', async () => {
    const { servicio } = armar();
    await expect(servicio.registrar(3, datos(22, 20), 14)).rejects.toThrow(
      ValidacionError,
    );
  });

  it('rechaza DISPONIBLE y MANTENIMIENTO: no son ausencias de conductor', async () => {
    const { servicio } = armar();
    for (const estado of [
      EstadoDisponibilidad.DISPONIBLE,
      EstadoDisponibilidad.MANTENIMIENTO,
    ]) {
      await expect(
        servicio.registrar(3, { ...datos(20, 22), estado }, 14),
      ).rejects.toThrow(ValidacionError);
    }
  });

  it('INV-14: 409 AUSENCIA_SOLAPADA si se cruza con otra del mismo conductor', async () => {
    const { servicio, crear } = armar({ solapadas: [ausencia(21, 25, 5)] });

    const fallo = await servicio
      .registrar(3, datos(20, 22), 14)
      .catch((e: unknown) => e);

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).code).toBe(
      CODIGOS_ERROR.AUSENCIA_SOLAPADA,
    );
    expect(crear).not.toHaveBeenCalled();
  });

  it('A5: devuelve los tramos ya asignados en el rango, sin retirarlos', async () => {
    const tramo = {
      operativoId: 40,
      identificador: 'OCPMO-001-21-OCT-2026',
      fecha: dia(21),
      horaInicio: '08:00',
      horaFin: '16:30',
    };
    const { servicio, repositorio } = armar({ tramos: [tramo] });

    const { tramosAfectados } = await servicio.registrar(3, datos(20, 22), 14);

    expect(tramosAfectados).toEqual([tramo]);
    expect(repositorio.tramosEnRango).toHaveBeenCalledWith(3, dia(20), dia(22));
  });
});

describe('AusenciasConductorService · retirar', () => {
  it('retira una próxima y deja la traza sin el motivo', async () => {
    const { servicio, eliminar, registrar } = armar();

    await servicio.retirar(3, 7, 14, '2026-10-16');

    expect(eliminar).toHaveBeenCalledWith(7, expect.anything());
    const traza = (registrar.mock.calls as unknown[][])[0][0] as {
      accion: AccionAuditoria;
    };
    expect(traza.accion).toBe(AccionAuditoria.ELIMINAR);
    expect(JSON.stringify(registrar.mock.calls)).not.toContain('Cirugía');
  });

  it('una en curso también se retira', async () => {
    const { servicio, eliminar } = armar({ existente: ausencia(10, 20) });
    await servicio.retirar(3, 7, 14, '2026-10-16');
    expect(eliminar).toHaveBeenCalled();
  });

  it('409 AUSENCIA_PASADA: una que ya terminó es historia', async () => {
    const { servicio, eliminar } = armar({ existente: ausencia(1, 5) });

    const fallo = await servicio
      .retirar(3, 7, 14, '2026-10-16')
      .catch((e: unknown) => e);

    expect((fallo as ReglaNegocioError).code).toBe(
      CODIGOS_ERROR.AUSENCIA_PASADA,
    );
    expect(eliminar).not.toHaveBeenCalled();
  });

  it('404 si la ausencia es de OTRO conductor: no se borra la ajena', async () => {
    const { servicio, eliminar } = armar({
      existente: ausencia(20, 22, 7, 99),
    });
    await expect(servicio.retirar(3, 7, 14, '2026-10-16')).rejects.toThrow(
      RecursoNoEncontradoError,
    );
    expect(eliminar).not.toHaveBeenCalled();
  });
});

describe('CrearAusenciaConductorDto', () => {
  const validar = (cuerpo: Record<string, unknown>) =>
    validate(plainToInstance(CrearAusenciaConductorDto, cuerpo));

  it('acepta una ausencia válida', async () => {
    const errores = await validar({
      estado: 'VACACIONES',
      desde: '2026-10-20',
      hasta: '2026-10-22',
      motivo: 'Viaje',
    });
    expect(errores).toHaveLength(0);
  });

  it('rechaza DISPONIBLE, MANTENIMIENTO y fechas mal escritas', async () => {
    for (const estado of ['DISPONIBLE', 'MANTENIMIENTO']) {
      const errores = await validar({
        estado,
        desde: '2026-10-20',
        hasta: '2026-10-22',
      });
      expect(errores.map((e) => e.property)).toContain('estado');
    }
    const errores = await validar({
      estado: 'PERMISO',
      desde: '20-10-2026',
      hasta: '2026-10-22',
    });
    expect(errores.map((e) => e.property)).toContain('desde');
  });

  it('el motivo no supera los 220 caracteres', async () => {
    const errores = await validar({
      estado: 'PERMISO',
      desde: '2026-10-20',
      hasta: '2026-10-20',
      motivo: 'x'.repeat(221),
    });
    expect(errores.map((e) => e.property)).toContain('motivo');
  });
});
