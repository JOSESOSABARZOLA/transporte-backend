/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: directorio.controller.spec.ts
 * Responsabilidad: Fijar que el fallo de Auth viaja como dato y no como excepción.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-24
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LO QUE SE PRUEBA ES QUÉ **NO** LANZA, Y QUÉ SÍ.
 *
 * Desde el 2026-08-24 el directorio deja de ser una pestaña de consulta y pasa a ser el
 * primer paso del alta de personal. Un 503 en mitad de ese camino dejaba a la pantalla
 * distinguiendo por el `catch` entre «no se pudo preguntar» y «no hay nadie», que son
 * cosas distintas y se ven igual.
 *
 * Pero atrapar de más es peor que no atrapar: si un fallo de **nuestra** base saliera como
 * `disponible: false`, la pantalla acusaría a Auth de algo que no hizo y el administrador
 * iría a reclamar al equipo equivocado. Por eso la última prueba de este archivo es la que
 * más importa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import type { FilaDirectorio } from '../application/directorio-auth.service';
import type { DirectorioAuthService } from '../application/directorio-auth.service';
import { AuthNoDisponibleError } from '../infrastructure/auth-usuarios.client';
import { DirectorioController } from './directorio.controller';

const PERSONA: FilaDirectorio = {
  authId: 42,
  cedula: '0924402068',
  nombre: 'SOSA BARZOLA JOSE LUIS',
  usuario: 'jlsosa',
  correo: 'jose.sosa@quito.gob.ec',
  dependencia: 'DMIP',
  roles: ['(Cuadro de Colores) Administrador'],
  inspector: null,
  ficha: null,
  cuenta: null,
};

const conSesion = (tokenAuth: string | undefined): UsuarioAutenticado =>
  ({ usuarioId: 1, tokenAuth }) as unknown as UsuarioAutenticado;

const controlador = (consultar: jest.Mock): DirectorioController =>
  new DirectorioController({
    consultar,
  } as unknown as DirectorioAuthService);

describe('el directorio responde, no revienta', () => {
  it('cuando Auth contesta, entrega las personas y se declara disponible', async () => {
    const respuesta = await controlador(
      jest.fn().mockResolvedValue([PERSONA]),
    ).consultar(conSesion('token-de-auth'));

    expect(respuesta.disponible).toBe(true);
    expect(respuesta.motivo).toBeNull();
    expect(respuesta.personas).toHaveLength(1);
    expect(respuesta.personas[0].cedula).toBe('0924402068');
  });

  it('cuando Auth no responde, lo dice y devuelve la lista vacía', async () => {
    const consultar = jest
      .fn()
      .mockRejectedValue(
        new AuthNoDisponibleError(
          'Auth central no respondió. Vuelva a intentarlo.',
        ),
      );

    const respuesta = await controlador(consultar).consultar(
      conSesion('token-de-auth'),
    );

    expect(respuesta.disponible).toBe(false);
    // El texto del servidor se arrastra tal cual: regla 7. Sin él, la pantalla no puede
    // distinguir una caída de Auth de una sesión caducada.
    expect(respuesta.motivo).toContain('Auth central no respondió');
    expect(respuesta.personas).toEqual([]);
  });

  /**
   * La sesión anterior al 21-AGO no lleva el token de Auth. Antes esto era un 403, que en
   * el camino del alta se leía como «no tiene permiso» cuando lo que hay que hacer es
   * volver a entrar.
   */
  it('sin token de Auth en la sesión, tampoco lanza: explica que hay que volver a entrar', async () => {
    const consultar = jest.fn();

    const respuesta = await controlador(consultar).consultar(
      conSesion(undefined),
    );

    expect(respuesta.disponible).toBe(false);
    expect(respuesta.motivo).toContain('Vuelva a entrar');
    // Y no se molesta a Auth: no hay con qué preguntar.
    expect(consultar).not.toHaveBeenCalled();
  });

  it('un fallo QUE NO ES DE AUTH sigue subiendo, y no se disfraza de indisponibilidad', async () => {
    const consultar = jest
      .fn()
      .mockRejectedValue(new Error('la base de datos no respondió'));

    await expect(
      controlador(consultar).consultar(conSesion('token-de-auth')),
    ).rejects.toThrow('la base de datos no respondió');
  });
});
