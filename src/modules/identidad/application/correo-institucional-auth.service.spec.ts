/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: correo-institucional-auth.service.spec.ts
 * Responsabilidad: Que el correo institucional de un alta desde Auth salga de Auth, o se diga por qué no.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 */

import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  AuthNoDisponibleError,
  type AuthUsuariosClient,
  type UsuarioDeAuth,
} from '../infrastructure/auth-usuarios.client';
import { CorreoInstitucionalAuthService } from './correo-institucional-auth.service';

const persona = (parcial: Partial<UsuarioDeAuth> = {}): UsuarioDeAuth => ({
  id: 1,
  nombre: 'ABAD MOLINA VERONICA GABRIELA',
  usuario: 'veronica.abad',
  cedula: '0301654414',
  correo: 'Veronica.Abad@quito.gob.ec',
  dependencia: 'Dirección Metropolitana de Ejecución',
  roles: [],
  activo: true,
  inspector: null,
  ...parcial,
});

const armar = (usuarios: UsuarioDeAuth[]) => {
  const listar = jest.fn().mockResolvedValue(usuarios);
  const servicio = new CorreoInstitucionalAuthService({
    listar,
  } as unknown as AuthUsuariosClient);
  return { servicio, listar };
};

describe('CorreoInstitucionalAuthService · alta desde Auth', () => {
  it('devuelve el correo de la persona ACTIVA con esa cédula, en minúsculas', async () => {
    const { servicio, listar } = armar([persona()]);

    await expect(servicio.correoPorCedula('0301654414', 'tk')).resolves.toBe(
      'veronica.abad@quito.gob.ec',
    );
    expect(listar).toHaveBeenCalledWith('tk');
  });

  it('una cuenta inactiva de Auth no cuenta: 422 PERSONA_NO_ENCONTRADA_EN_AUTH', async () => {
    const { servicio } = armar([persona({ activo: false })]);

    await expect(
      servicio.correoPorCedula('0301654414', 'tk'),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: CODIGOS_ERROR.PERSONA_NO_ENCONTRADA_EN_AUTH,
    });
  });

  it('la cédula que Auth no tiene: 422 con un mensaje que ofrece el registro manual', async () => {
    const { servicio } = armar([persona()]);

    await expect(
      servicio.correoPorCedula('1712345678', 'tk'),
    ).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('registre la ficha a mano') as string,
    });
  });

  it('sin correo en Auth: 422, no se inventa uno', async () => {
    const { servicio } = armar([persona({ correo: '  ' })]);

    await expect(
      servicio.correoPorCedula('0301654414', 'tk'),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('sin token de Auth en la sesión: 503 y no pregunta a nadie', async () => {
    const { servicio, listar } = armar([persona()]);

    await expect(
      servicio.correoPorCedula('0301654414', null),
    ).rejects.toBeInstanceOf(AuthNoDisponibleError);
    expect(listar).not.toHaveBeenCalled();
  });
});
