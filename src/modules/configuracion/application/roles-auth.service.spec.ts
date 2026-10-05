/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Homologación de roles
 * Archivo: roles-auth.service.spec.ts
 * Responsabilidad: Verificar las decisiones de la correspondencia con Auth central.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-19
 *
 * SE PRUEBAN DECISIONES, NO MAQUETADO. Las cuatro que importan, y que de romperse no
 * darían un error visible sino un comportamiento silencioso y grave:
 *
 *   1. Un identificador repetido se rechaza. Sin esto, dos filas apuntarían al mismo rol
 *      de Auth con destinos distintos y el ingreso resolvería a una cualquiera.
 *   2. Los huecos se informan. Hoy `FUNCIONARIO` no tiene rol en Auth, y quien administra
 *      debe verlo en la pantalla, no descubrirlo cuando alguien no puede entrar.
 *   3. La baja AVISA si era la última de su rol. Desactivarla deja a ese perfil sin forma
 *      de entrar, y eso debe verse antes.
 *   4. Toda escritura queda auditada. Quien cambia quién es Director tiene que dejar rastro.
 */

import { RolDepartamental } from '@prisma/client';

import {
  ValidacionError,
  RecursoNoEncontradoError,
} from '../../../common/errors/errores-dominio';
import { RolesAuthService } from './roles-auth.service';

type Fila = {
  idAuth: number;
  nombreAuth: string;
  rol: RolDepartamental;
  subsistema: number;
  activo: boolean;
};

const fila = (cambios: Partial<Fila> = {}): Fila => ({
  idAuth: 53,
  nombreAuth: 'Transporte - Operativos',
  rol: RolDepartamental.DMIP_OPERATIVOS,
  subsistema: 11,
  activo: true,
  ...cambios,
});

describe('RolesAuthService', () => {
  const repositorio = {
    listar: jest.fn(),
    buscarPorIdAuth: jest.fn(),
    crear: jest.fn(),
    actualizar: jest.fn(),
    desactivar: jest.fn(),
    rolesSinCorrespondencia: jest.fn(),
    ejecutarEnTransaccion: jest.fn(),
  };
  const auditoria = { registrar: jest.fn() };

  const servicio = new RolesAuthService(
    repositorio as never,
    auditoria as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    // La transacción se ejecuta de verdad, con un cliente simulado: así la prueba
    // recorre el mismo camino que producción en lugar de uno paralelo.
    repositorio.ejecutarEnTransaccion.mockImplementation(
      (operacion: (cliente: unknown) => Promise<unknown>) => operacion({}),
    );
  });

  it('informa qué roles del módulo no tienen rol en Auth', async () => {
    repositorio.listar.mockResolvedValue([fila()]);
    repositorio.rolesSinCorrespondencia.mockResolvedValue([
      RolDepartamental.FUNCIONARIO,
    ]);

    const panorama = await servicio.consultar();

    expect(panorama.sinCorrespondencia).toEqual([RolDepartamental.FUNCIONARIO]);
  });

  it('rechaza un identificador de Auth que ya está registrado', async () => {
    repositorio.buscarPorIdAuth.mockResolvedValue(fila());

    await expect(
      servicio.crear(1, RolDepartamental.ADMINISTRADOR_DMIP, {
        idAuth: 53,
        nombreAuth: 'Otro nombre',
        rol: RolDepartamental.DIRECTOR,
        subsistema: 11,
      }),
    ).rejects.toBeInstanceOf(ValidacionError);

    expect(repositorio.crear).not.toHaveBeenCalled();
  });

  it('audita el alta dentro de la transacción', async () => {
    repositorio.buscarPorIdAuth.mockResolvedValue(null);
    repositorio.crear.mockResolvedValue(fila({ idAuth: 59 }));

    await servicio.crear(7, RolDepartamental.ADMINISTRADOR_DMIP, {
      idAuth: 59,
      nombreAuth: 'Transporte - Auditor',
      rol: RolDepartamental.DIRECTOR,
      subsistema: 11,
    });

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_rol_auth',
        entidadId: 59,
        accion: 'CREAR',
        usuario: 7,
      }),
      expect.anything(),
    );
  });

  it('avisa cuando la baja deja a un rol sin ninguna vía de acceso', async () => {
    repositorio.buscarPorIdAuth.mockResolvedValue(
      fila({ idAuth: 57, rol: RolDepartamental.DIRECTOR }),
    );
    repositorio.listar.mockResolvedValue([
      fila({ idAuth: 57, rol: RolDepartamental.DIRECTOR }),
    ]);
    repositorio.desactivar.mockResolvedValue(
      fila({ idAuth: 57, rol: RolDepartamental.DIRECTOR, activo: false }),
    );

    const { eraLaUnica } = await servicio.desactivar(
      1,
      RolDepartamental.ADMINISTRADOR_DMIP,
      57,
    );

    expect(eraLaUnica).toBe(true);
  });

  it('no avisa si el rol conserva otra correspondencia activa', async () => {
    repositorio.buscarPorIdAuth.mockResolvedValue(
      fila({ idAuth: 56, rol: RolDepartamental.DAF }),
    );
    repositorio.listar.mockResolvedValue([
      fila({ idAuth: 56, rol: RolDepartamental.DAF }),
      fila({ idAuth: 60, rol: RolDepartamental.DAF }),
    ]);
    repositorio.desactivar.mockResolvedValue(
      fila({ idAuth: 56, rol: RolDepartamental.DAF, activo: false }),
    );

    const { eraLaUnica } = await servicio.desactivar(
      1,
      RolDepartamental.ADMINISTRADOR_DMIP,
      56,
    );

    expect(eraLaUnica).toBe(false);
  });

  it('responde 404 al editar una correspondencia que no existe', async () => {
    repositorio.buscarPorIdAuth.mockResolvedValue(null);

    await expect(
      servicio.actualizar(1, RolDepartamental.ADMINISTRADOR_DMIP, 99, {
        activo: false,
      }),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });
});
