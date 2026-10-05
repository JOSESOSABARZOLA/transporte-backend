/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: identidad.guard.spec.ts
 * Responsabilidad: Verificar que la identidad solo se resuelve desde la cookie de sesión.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05 · reescrita el 2026-08-18 con la etapa 5
 *
 * ANTES ESTE ARCHIVO TENÍA DOS MITADES: una para la cabecera `x-usuario-prueba` y otra
 * para la cookie. La primera desapareció con el modo provisional, y con ella ocho
 * pruebas que ya no comprueban nada existente.
 *
 * SE CONSERVAN DOS DE ELLAS, TRADUCIDAS, porque lo que afirmaban sigue importando:
 *
 *   · que **el rol lo decide el servidor**, no la petición;
 *   · que **una identidad que no se puede verificar no entra**.
 *
 * Y se añade la que sustituye a la garantía RT-05. Aquélla comprobaba que la cabecera de
 * pruebas se ignoraba con el modo apagado; ahora el enunciado es más fuerte y más simple:
 * **esa cabecera ya no significa nada, esté como esté la configuración.**
 */

import { UnauthorizedException } from '@nestjs/common';
import { RolDepartamental } from '@prisma/client';

import { appConfig } from '../../../config/app.config';
import {
  ejecutarConContexto,
  obtenerContexto,
} from '../../contexto/contexto-peticion';
import { IdentidadGuard } from './identidad.guard';
import { firmarSesion } from '../token-sesion';
import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado.interface';

interface PeticionSimulada {
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  user?: UsuarioAutenticado;
}

const contextoCon = (peticion: PeticionSimulada) =>
  ({
    switchToHttp: () => ({ getRequest: () => peticion }),
  }) as never;

const CLAVE = 'clave-de-pruebas-del-modulo';
const NOMBRE_COOKIE = 'cuadro_colores_sesion';

describe('IdentidadGuard', () => {
  const guarda = new IdentidadGuard();
  const sesionOriginal = { ...appConfig.sesion };

  /** Cookie con una sesión firmada, como la que emite el canje. */
  const cookieCon = (
    cambios: Partial<Parameters<typeof firmarSesion>[0]> = {},
  ) => ({
    [NOMBRE_COOKIE]: firmarSesion({
      usuarioId: 4,
      roles: [RolDepartamental.DAF],
      nombre: 'Analista de Transportes',
      funcionarioId: 150,
      usuarioAuth: 'daf.transportes',
      // Presente desde el 2026-08-21. La guarda lo traslada a `request.user` sin mirarlo:
      // quien decide si sirve es el endpoint del directorio, no ella.
      tokenAuth: 'token-de-auth-de-pruebas',
      ...cambios,
    }),
  });

  beforeEach(() => {
    appConfig.sesion.secretoPropio = CLAVE;
    appConfig.sesion.vigenciaSegundos = 600;
    appConfig.sesion.cookie.nombre = NOMBRE_COOKIE;
  });

  afterEach(() => {
    Object.assign(appConfig.sesion, sesionOriginal);
  });

  describe('con la sesión en la cookie', () => {
    it('resuelve la identidad', () => {
      const peticion: PeticionSimulada = { headers: {}, cookies: cookieCon() };

      expect(guarda.canActivate(contextoCon(peticion))).toBe(true);
      expect(peticion.user?.usuarioId).toBe(4);
      expect(peticion.user?.rol).toBe(RolDepartamental.DAF);
      expect(peticion.user?.usuarioAuth).toBe('daf.transportes');
    });

    it('rellena `roles` para que el RolesGuard heredado funcione sin tocarlo', () => {
      const peticion: PeticionSimulada = { headers: {}, cookies: cookieCon() };
      guarda.canActivate(contextoCon(peticion));
      expect(peticion.user?.roles).toEqual([RolDepartamental.DAF]);
    });

    it('deja la identidad en el contexto, para el registro y la auditoría', () => {
      const peticion: PeticionSimulada = { headers: {}, cookies: cookieCon() };

      ejecutarConContexto(
        { correlacionId: 'c-1', metodo: 'GET', ruta: '/x' },
        () => {
          guarda.canActivate(contextoCon(peticion));
          expect(obtenerContexto()?.usuarioId).toBe(4);
          expect(obtenerContexto()?.rol).toBe(RolDepartamental.DAF);
        },
      );
    });

    /**
     * Traducida del modo provisional, donde el enunciado era el mismo: el cliente dice
     * quién es, y **el rol lo pone el servidor**. Aquí el rol viene dentro de un token que
     * solo este backend puede firmar, así que declarar otro por cabecera no cambia nada.
     */
    it('el rol lo decide el token firmado, no la petición', () => {
      const peticion: PeticionSimulada = {
        headers: { 'x-rol': 'DIRECTOR', 'x-usuario-prueba': '5' },
        cookies: cookieCon(),
      };

      guarda.canActivate(contextoCon(peticion));
      expect(peticion.user?.rol).toBe(RolDepartamental.DAF);
    });
  });

  describe('rechaza y responde 401', () => {
    it('sin cookie', () => {
      expect(() => guarda.canActivate(contextoCon({ headers: {} }))).toThrow(
        UnauthorizedException,
      );
    });

    it('con una cookie firmada con otra clave', () => {
      const peticion: PeticionSimulada = { headers: {}, cookies: cookieCon() };
      appConfig.sesion.secretoPropio = 'otra-clave-distinta';

      expect(() => guarda.canActivate(contextoCon(peticion))).toThrow(
        UnauthorizedException,
      );
    });

    it('con una cookie ilegible', () => {
      expect(() =>
        guarda.canActivate(
          contextoCon({
            headers: {},
            cookies: { [NOMBRE_COOKIE]: 'esto-no-es-un-token' },
          }),
        ),
      ).toThrow(UnauthorizedException);
    });

    it('con una cookie de otro nombre', () => {
      expect(() =>
        guarda.canActivate(
          contextoCon({ headers: {}, cookies: { otra_cosa: 'lo-que-sea' } }),
        ),
      ).toThrow(UnauthorizedException);
    });

    /**
     * El caso que aparece al desplegar: la aplicación arranca sin la clave de sesión y
     * algún navegador conserva la cookie de una configuración anterior. Antes producía un
     * 500 en CADA petición de ese usuario, con el mensaje genérico y sin pista del motivo.
     */
    it('sin clave configurada ignora la cookie en lugar de reventar', () => {
      const peticion: PeticionSimulada = { headers: {}, cookies: cookieCon() };
      appConfig.sesion.secretoPropio = '';

      expect(() => guarda.canActivate(contextoCon(peticion))).toThrow(
        UnauthorizedException,
      );
    });
  });

  /**
   * SUSTITUYE A LA GARANTÍA RT-05, y dice algo más fuerte que ella.
   *
   * Aquélla comprobaba que `x-usuario-prueba` se ignoraba **cuando el modo provisional
   * estaba apagado** —es decir, que la variable de entorno se respetaba—. Con el modo
   * retirado ya no hay variable que respetar: la cabecera no la lee nadie, y no hay
   * configuración alguna que pueda devolverle significado.
   */
  it('la cabecera de identidad de pruebas ya no significa nada', () => {
    expect(() =>
      guarda.canActivate(contextoCon({ headers: { 'x-usuario-prueba': '5' } })),
    ).toThrow(UnauthorizedException);
  });
});
