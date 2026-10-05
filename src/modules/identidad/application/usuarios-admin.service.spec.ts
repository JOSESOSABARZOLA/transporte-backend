/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: usuarios-admin.service.spec.ts
 * Responsabilidad: Verificar las decisiones del alta y mantenimiento de cuentas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-19
 *
 * SE PRUEBAN DECISIONES. Éste es el servicio que decide QUIÉN entra y CON QUÉ ROL, así
 * que las cinco que se protegen son las que, de romperse, darían acceso indebido o
 * dejarían a alguien sin poder trabajar:
 *
 *   1. Un usuario de Auth repetido se rechaza. Con dos cuentas iguales, el canje
 *      resolvería a una cualquiera y esa persona entraría con el rol de otra.
 *   2. Una cédula que no existe rechaza el alta, en vez de guardar la cuenta sin ficha.
 *      Es la diferencia entre enterarse ahora o cuando esa persona no vea sus órdenes.
 *   3. Una ficha ya enlazada a otra cuenta se rechaza: una ficha, una cuenta.
 *   4. Sin cédula la cuenta se crea igual, con la ficha nula. Dirección y administración
 *      no salen a operativos, y exigirles ficha sería inventar un dato.
 *   5. El alta queda auditada. Quien crea un DIRECTOR tiene que dejar rastro.
 */

import { RolDepartamental } from '@prisma/client';

import { ValidacionError } from '../../../common/errors/errores-dominio';
import { UsuariosAdminService } from './usuarios-admin.service';

const cuenta = (cambios: Record<string, unknown> = {}) => ({
  id: 1,
  correo: 'nombre.apellido@quito.gob.ec',
  nombre: 'Apellidos Nombres',
  roles: [RolDepartamental.DMIP_OPERATIVOS],
  identificadorAd: 'napellido',
  funcionarioId: null,
  activo: true,
  funcionario: null,
  ...cambios,
});

describe('UsuariosAdminService', () => {
  const repositorio = {
    listar: jest.fn(),
    buscarPorId: jest.fn(),
    buscarPorCorreo: jest.fn(),
    buscarPorIdentificadorAd: jest.fn(),
    fichaPorCedula: jest.fn(),
    cuentaConFicha: jest.fn(),
    crear: jest.fn(),
    actualizar: jest.fn(),
    desactivar: jest.fn(),
    ejecutarEnTransaccion: jest.fn(),
  };
  const auditoria = { registrar: jest.fn() };

  const servicio = new UsuariosAdminService(
    repositorio as never,
    auditoria as never,
  );

  const alta = {
    correo: 'nueva@quito.gob.ec',
    nombre: 'Persona Nueva',
    roles: [RolDepartamental.DMIP_OPERATIVOS],
    identificadorAd: 'pnueva',
    funcionarioCedula: null as string | null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repositorio.ejecutarEnTransaccion.mockImplementation(
      (operacion: (cliente: unknown) => Promise<unknown>) => operacion({}),
    );
    repositorio.buscarPorCorreo.mockResolvedValue(null);
    repositorio.buscarPorIdentificadorAd.mockResolvedValue(null);
    repositorio.crear.mockResolvedValue(cuenta());
  });

  it('rechaza un usuario de Auth que ya pertenece a otra cuenta', async () => {
    repositorio.buscarPorIdentificadorAd.mockResolvedValue(
      cuenta({ id: 9, nombre: 'Otra Persona' }),
    );

    await expect(
      servicio.crear(1, RolDepartamental.ADMINISTRADOR_DMIP, alta),
    ).rejects.toBeInstanceOf(ValidacionError);

    expect(repositorio.crear).not.toHaveBeenCalled();
  });

  it('rechaza un correo que ya pertenece a otra cuenta', async () => {
    repositorio.buscarPorCorreo.mockResolvedValue(cuenta({ id: 4 }));

    await expect(
      servicio.crear(1, RolDepartamental.ADMINISTRADOR_DMIP, alta),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('rechaza una cédula que no está en el maestro de personal', async () => {
    repositorio.fichaPorCedula.mockResolvedValue(null);

    await expect(
      servicio.crear(1, RolDepartamental.ADMINISTRADOR_DMIP, {
        ...alta,
        funcionarioCedula: '0000000000',
      }),
    ).rejects.toBeInstanceOf(ValidacionError);

    expect(repositorio.crear).not.toHaveBeenCalled();
  });

  it('rechaza una ficha que ya está enlazada a otra cuenta', async () => {
    repositorio.fichaPorCedula.mockResolvedValue({
      id: 151,
      apellidos: 'SALAZAR',
      nombres: 'DANIELA',
    });
    repositorio.cuentaConFicha.mockResolvedValue({
      id: 8,
      nombre: 'Otra Cuenta',
    });

    await expect(
      servicio.crear(1, RolDepartamental.ADMINISTRADOR_DMIP, {
        ...alta,
        funcionarioCedula: '1719446302',
      }),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  /** Dirección y administración no salen a operativos: la ficha nula es correcta. */
  it('crea la cuenta sin ficha cuando no se indica cédula', async () => {
    await servicio.crear(1, RolDepartamental.ADMINISTRADOR_DMIP, {
      ...alta,
      roles: [RolDepartamental.DIRECTOR],
      funcionarioCedula: null,
    });

    expect(repositorio.crear).toHaveBeenCalledWith(
      expect.objectContaining({ funcionarioId: null }),
      expect.anything(),
    );
  });

  it('resuelve la ficha por cédula y la enlaza', async () => {
    repositorio.fichaPorCedula.mockResolvedValue({
      id: 151,
      apellidos: 'SALAZAR',
      nombres: 'DANIELA',
    });
    repositorio.cuentaConFicha.mockResolvedValue(null);

    await servicio.crear(1, RolDepartamental.ADMINISTRADOR_DMIP, {
      ...alta,
      funcionarioCedula: '1719446302',
    });

    expect(repositorio.crear).toHaveBeenCalledWith(
      expect.objectContaining({ funcionarioId: 151 }),
      expect.anything(),
    );
  });

  it('audita el alta dentro de la transacción', async () => {
    await servicio.crear(7, RolDepartamental.ADMINISTRADOR_DMIP, alta);

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_usuario',
        accion: 'CREAR',
        usuario: 7,
      }),
      expect.anything(),
    );
  });

  /** Al editarse a sí misma, su propio identificador no debe considerarse ocupado. */
  it('permite guardar una cuenta conservando su propio usuario de Auth', async () => {
    repositorio.buscarPorId.mockResolvedValue(cuenta({ id: 3 }));
    repositorio.buscarPorIdentificadorAd.mockResolvedValue(cuenta({ id: 3 }));
    repositorio.actualizar.mockResolvedValue(cuenta({ id: 3 }));

    await expect(
      servicio.actualizar(1, RolDepartamental.ADMINISTRADOR_DMIP, 3, {
        identificadorAd: 'napellido',
      }),
    ).resolves.toBeDefined();
  });
});
