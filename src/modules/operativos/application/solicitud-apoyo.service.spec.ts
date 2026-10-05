/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Solicitud de apoyo interdirección
 * Archivo: solicitud-apoyo.service.spec.ts
 * Responsabilidad: Verificar el registro y la bandeja de CU-13.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import {
  AccionAuditoria,
  AreaPersonal,
  EstadoSolicitud,
  RolDepartamental,
} from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import type {
  DatosSolicitud,
  SolicitudApoyoRepository,
  SolicitudConOperativo,
} from '../infrastructure/solicitud-apoyo.repository';
import type { OperativosService } from './operativos.service';
import { SolicitudApoyoService } from './solicitud-apoyo.service';

const CLIENTE = { marca: 'transaccion' };
const JORNADA = new Date(Date.UTC(2026, 9, 14));

const INSPECCIONES = {
  usuarioId: 2,
  rol: RolDepartamental.DMIP_INSPECCIONES,
};

const OPERATIVO = {
  id: 500,
  identificador: 'INSP-001-14-OCT-2026',
  cuadro: { fecha: JORNADA },
};

const SOLICITUD = {
  id: 900,
  operativoId: 500,
  rolSolicitante: RolDepartamental.DMIP_INSPECCIONES,
  rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
  areaRequerida: AreaPersonal.INSTRUCCION,
  cantidad: 2,
  estado: EstadoSolicitud.SOLICITADA,
  observacion: null,
  creadoEn: new Date(),
} as unknown as SolicitudConOperativo;

const armar = (
  opciones: {
    equivalenteAbierta?: SolicitudConOperativo | null;
    escrituraBloqueada?: Error;
    operativoAjeno?: Error;
  } = {},
) => {
  const {
    equivalenteAbierta = null,
    escrituraBloqueada,
    operativoAjeno,
  } = opciones;

  /** Lo que el servicio pidió guardar, con tipo, para poder afirmar sobre ello. */
  const enviados: DatosSolicitud[] = [];

  const crear = jest.fn().mockImplementation((datos: DatosSolicitud) => {
    enviados.push(datos);
    return Promise.resolve(SOLICITUD);
  });
  const listar = jest.fn().mockResolvedValue([SOLICITUD]);
  const listarDeOperativo = jest.fn().mockResolvedValue([SOLICITUD]);
  const registrar = jest.fn().mockResolvedValue(undefined);
  const log = jest.fn();

  const exigirOperativoPropio = jest
    .fn()
    .mockImplementation(() =>
      operativoAjeno
        ? Promise.reject(operativoAjeno)
        : Promise.resolve(OPERATIVO),
    );
  const obtener = jest.fn().mockResolvedValue(OPERATIVO);
  const exigirEscritura = jest
    .fn()
    .mockImplementation(() =>
      escrituraBloqueada
        ? Promise.reject(escrituraBloqueada)
        : Promise.resolve({ id: 9, fecha: JORNADA }),
    );

  const servicio = new SolicitudApoyoService(
    {
      crear,
      listar,
      listarDeOperativo,
      buscarEquivalenteAbierta: jest.fn().mockResolvedValue(equivalenteAbierta),
      ejecutarEnTransaccion: jest
        .fn()
        .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
          operacion(CLIENTE),
        ),
    } as unknown as SolicitudApoyoRepository,
    { exigirOperativoPropio, obtener } as unknown as OperativosService,
    { exigirEscritura } as unknown as CuadroDiarioService,
    { registrar } as unknown as AuditoriaService,
    { log } as unknown as LoggerService,
  );

  return {
    servicio,
    crear,
    enviados,
    listar,
    listarDeOperativo,
    registrar,
    exigirOperativoPropio,
    obtener,
    log,
  };
};

const capturar = async (promesa: Promise<unknown>): Promise<unknown> =>
  promesa.catch((error: unknown) => error);

describe('SolicitudApoyoService · registro', () => {
  it('caso 1 del plan · registra la solicitud en estado SOLICITADA', async () => {
    const { servicio, crear } = armar();

    const solicitud = await servicio.solicitar(
      500,
      {
        rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
        areaRequerida: AreaPersonal.INSTRUCCION,
        cantidad: 2,
      },
      INSPECCIONES,
    );

    expect(crear).toHaveBeenCalledWith(
      {
        operativoId: 500,
        rolSolicitante: RolDepartamental.DMIP_INSPECCIONES,
        rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
        areaRequerida: AreaPersonal.INSTRUCCION,
        cantidad: 2,
        observacion: null,
      },
      CLIENTE,
    );
    expect(solicitud.estado).toBe(EstadoSolicitud.SOLICITADA);
  });

  it('el estado NO se puede fijar desde fuera: siempre nace en SOLICITADA', async () => {
    const { servicio, enviados } = armar();

    await servicio.solicitar(
      500,
      { rolRequerido: RolDepartamental.DMIT_INSTRUCTOR, cantidad: 1 },
      INSPECCIONES,
    );

    // El servicio no envía `estado`: lo pone el valor por defecto de la columna, y
    // `DatosSolicitud` ni siquiera declara el campo. PV-12.
    expect(Object.keys(enviados[0])).not.toContain('estado');
  });

  it('el área es opcional: se guarda como nula', async () => {
    const { servicio, crear } = armar();

    await servicio.solicitar(
      500,
      { rolRequerido: RolDepartamental.DMIT_INSTRUCTOR, cantidad: 1 },
      INSPECCIONES,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ areaRequerida: null }),
      CLIENTE,
    );
  });

  it('recorta la observación y descarta la que queda vacía', async () => {
    const { servicio, crear } = armar();

    await servicio.solicitar(
      500,
      {
        rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
        cantidad: 1,
        observacion: '   ',
      },
      INSPECCIONES,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ observacion: null }),
      CLIENTE,
    );
  });

  it('el solicitante sale de la identidad, nunca del cuerpo', async () => {
    const { servicio, crear } = armar();

    await servicio.solicitar(
      500,
      { rolRequerido: RolDepartamental.DMIP_OPERATIVOS, cantidad: 1 },
      { usuarioId: 3, rol: RolDepartamental.DMIT_INSTRUCTOR },
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        rolSolicitante: RolDepartamental.DMIT_INSTRUCTOR,
      }),
      CLIENTE,
    );
  });

  it('audita la solicitud dentro de la transacción', async () => {
    const { servicio, registrar } = armar();

    await servicio.solicitar(
      500,
      { rolRequerido: RolDepartamental.DMIT_INSTRUCTOR, cantidad: 1 },
      INSPECCIONES,
    );

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_solicitud_apoyo',
        accion: AccionAuditoria.CREAR,
        operativoId: 500,
        rol: RolDepartamental.DMIP_INSPECCIONES,
      }),
      CLIENTE,
    );
  });

  it('NOT-01 · el evento se emite después de confirmar', async () => {
    const { servicio, log } = armar();

    await servicio.solicitar(
      500,
      { rolRequerido: RolDepartamental.DMIT_INSTRUCTOR, cantidad: 3 },
      INSPECCIONES,
    );

    expect(log).toHaveBeenCalledWith(
      'Apoyo interdirección solicitado',
      expect.objectContaining({
        rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
        cantidad: 3,
      }),
    );
  });
});

describe('SolicitudApoyoService · a quién se le puede pedir', () => {
  it('caso 3 del plan · pedirse apoyo a uno mismo se rechaza', async () => {
    const { servicio, crear } = armar();

    const fallo = await capturar(
      servicio.solicitar(
        500,
        { rolRequerido: RolDepartamental.DMIP_INSPECCIONES, cantidad: 1 },
        INSPECCIONES,
      ),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('otra dirección');
    expect(crear).not.toHaveBeenCalled();
  });

  it('las direcciones sin personal operativo no reciben solicitudes', async () => {
    for (const rol of [
      RolDepartamental.DAF,
      RolDepartamental.DIRECTOR,
      RolDepartamental.ADMINISTRADOR_DMIP,
    ]) {
      const { servicio, crear } = armar();

      const fallo = await capturar(
        servicio.solicitar(
          500,
          { rolRequerido: rol, cantidad: 1 },
          INSPECCIONES,
        ),
      );

      expect(fallo).toBeInstanceOf(ValidacionError);
      expect((fallo as ValidacionError).message).toContain(
        'no aporta personal',
      );
      expect(crear).not.toHaveBeenCalled();
    }
  });

  it('las otras dos direcciones de carga sí', async () => {
    for (const rol of [
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DMIT_INSTRUCTOR,
    ]) {
      const { servicio, crear } = armar();

      await servicio.solicitar(
        500,
        { rolRequerido: rol, cantidad: 1 },
        INSPECCIONES,
      );

      expect(crear).toHaveBeenCalled();
    }
  });
});

describe('SolicitudApoyoService · lo que impide registrar', () => {
  it('el operativo tiene que ser del rol que solicita', async () => {
    const ajeno = new Error('formulario ajeno');
    const { servicio, crear } = armar({ operativoAjeno: ajeno });

    await expect(
      servicio.solicitar(
        500,
        { rolRequerido: RolDepartamental.DMIT_INSTRUCTOR, cantidad: 1 },
        INSPECCIONES,
      ),
    ).rejects.toBe(ajeno);
    expect(crear).not.toHaveBeenCalled();
  });

  it('un cuadro cerrado no admite nuevas solicitudes', async () => {
    const cerrado = new Error('cuadro cerrado');
    const { servicio, crear } = armar({ escrituraBloqueada: cerrado });

    await expect(
      servicio.solicitar(
        500,
        { rolRequerido: RolDepartamental.DMIT_INSTRUCTOR, cantidad: 1 },
        INSPECCIONES,
      ),
    ).rejects.toBe(cerrado);
    expect(crear).not.toHaveBeenCalled();
  });

  it('una solicitud idéntica ya abierta se rechaza nombrando el operativo', async () => {
    const { servicio, crear } = armar({ equivalenteAbierta: SOLICITUD });

    const fallo = await capturar(
      servicio.solicitar(
        500,
        {
          rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
          areaRequerida: AreaPersonal.INSTRUCCION,
          cantidad: 2,
        },
        INSPECCIONES,
      ),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain(
      'INSP-001-14-OCT-2026',
    );
    expect(crear).not.toHaveBeenCalled();
  });
});

describe('SolicitudApoyoService · bandeja (caso 4 del plan)', () => {
  it('un rol departamental ve solo lo que le involucra', async () => {
    const { servicio, listar } = armar();

    await servicio.consultarBandeja({}, INSPECCIONES);

    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({ rol: RolDepartamental.DMIP_INSPECCIONES }),
    );
  });

  it('la Dirección y la administración las ven todas', async () => {
    for (const rol of [
      RolDepartamental.DIRECTOR,
      RolDepartamental.ADMINISTRADOR_DMIP,
    ]) {
      const { servicio, listar } = armar();

      await servicio.consultarBandeja({}, { usuarioId: 5, rol });

      expect(listar).toHaveBeenCalledWith(
        expect.objectContaining({ rol: null }),
      );
    }
  });

  it('acepta filtrar por fecha y por estado', async () => {
    const { servicio, listar } = armar();

    await servicio.consultarBandeja(
      { fecha: JORNADA, estado: EstadoSolicitud.SOLICITADA },
      INSPECCIONES,
    );

    expect(listar).toHaveBeenCalledWith({
      fecha: JORNADA,
      estado: EstadoSolicitud.SOLICITADA,
      rol: RolDepartamental.DMIP_INSPECCIONES,
    });
  });

  it('la consulta por operativo exige poder ver el operativo', async () => {
    const { servicio, obtener, listarDeOperativo } = armar();

    await servicio.listarDeOperativo(500, INSPECCIONES);

    expect(obtener).toHaveBeenCalledWith(500, INSPECCIONES);
    expect(listarDeOperativo).toHaveBeenCalledWith(500);
  });
});
