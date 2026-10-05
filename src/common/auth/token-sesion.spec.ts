/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: token-sesion.spec.ts
 * Responsabilidad: Verificar la firma, el vencimiento y las comprobaciones del token.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-17
 *
 * SE PRUEBAN DECISIONES, NO MECANISMO. No se comprueba que `jsonwebtoken` sepa firmar:
 * se comprueba lo que este módulo DECIDE aceptar y rechazar, que es donde puede haber
 * un agujero. Los tres casos que importan son el algoritmo `none`, el token de tipo
 * `login` y el subsistema ajeno.
 */

import { Logger } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { RolDepartamental } from '@prisma/client';

import { appConfig } from '../../config/app.config';
import {
  firmarSesion,
  TokenInvalidoError,
  verificarSesion,
  verificarTokenDeAuth,
  type ContenidoSesion,
} from './token-sesion';

const CLAVE_PROPIA = 'clave-de-pruebas-del-modulo';
const CLAVE_AUTH = 'clave-de-pruebas-de-auth-central';

const PERFIL: ContenidoSesion = {
  usuarioId: 7,
  roles: [RolDepartamental.DAF],
  nombre: 'Analista de Transportes',
  funcionarioId: 150,
  usuarioAuth: 'daf.transportes',
  // El token de Auth viaja dentro de la sesión desde el 2026-08-21: el directorio de
  // personal lo necesita y Auth no tiene token de servicio. Aquí basta con que exista.
  tokenAuth: 'token-de-auth-de-pruebas',
};

/** Token de sesión tal como lo firma Auth central. Ver PLAN_INTEGRACION_AUTH.md §1.3. */
const tokenDeAuth = (
  cambios: Record<string, unknown> = {},
  clave = CLAVE_AUTH,
): string =>
  jwt.sign(
    {
      userId: 42,
      tokenType: 'session',
      sessionId: 'sesion-abc',
      subsystemId: 9,
      roleIds: [3, 5],
      ...cambios,
    },
    clave,
    { algorithm: 'HS256', expiresIn: 600 },
  );

describe('token-sesion', () => {
  const original = { ...appConfig.sesion };

  beforeEach(() => {
    appConfig.sesion.secretoPropio = CLAVE_PROPIA;
    appConfig.sesion.secretoAuth = CLAVE_AUTH;
    appConfig.sesion.subsistemaIdAuth = 9;
    appConfig.sesion.vigenciaSegundos = 600;
  });

  afterEach(() => {
    Object.assign(appConfig.sesion, original);
    jest.restoreAllMocks();
  });

  describe('el token propio', () => {
    it('conserva la identidad de ida y vuelta', () => {
      expect(verificarSesion(firmarSesion(PERFIL))).toMatchObject(PERFIL);
    });

    it('conserva el enlace con la ficha de personal, que es lo que sostiene P-06', () => {
      expect(verificarSesion(firmarSesion(PERFIL)).funcionarioId).toBe(150);
    });

    it('admite que no haya ficha de personal: Dirección y administración no salen a operativos', () => {
      const sinFicha = { ...PERFIL, funcionarioId: null };
      expect(verificarSesion(firmarSesion(sinFicha)).funcionarioId).toBeNull();
    });

    it('rechaza un token firmado con otra clave', () => {
      const ajeno = jwt.sign({ ...PERFIL }, 'otra-clave-cualquiera', {
        algorithm: 'HS256',
      });
      expect(() => verificarSesion(ajeno)).toThrow(TokenInvalidoError);
    });

    it('rechaza un token vencido', () => {
      const vencido = jwt.sign({ ...PERFIL }, CLAVE_PROPIA, {
        algorithm: 'HS256',
        expiresIn: -60,
      });
      expect(() => verificarSesion(vencido)).toThrow(TokenInvalidoError);
    });

    /**
     * El fallo clásico de las bibliotecas de JWT: sin declarar los algoritmos
     * admitidos, un token con la cabecera `alg: none` y sin firma se acepta como
     * válido. Cualquiera podría entonces declararse DIRECTOR.
     */
    it('rechaza un token sin firma que dice usar el algoritmo «none»', () => {
      const enBase64 = (valor: object) =>
        Buffer.from(JSON.stringify(valor)).toString('base64url');
      const sinFirma = `${enBase64({ alg: 'none', typ: 'JWT' })}.${enBase64({
        ...PERFIL,
        roles: [RolDepartamental.DIRECTOR],
      })}.`;

      expect(() => verificarSesion(sinFirma)).toThrow(TokenInvalidoError);
    });

    /**
     * `aud` y `iss` los exige el contrato compartido, y cierran un paso real: varios
     * modulos de la AMC pueden compartir dominio, y una cookie de dominio viaja a todos.
     * Sin `aud`, el token de otro modulo firmado con la misma clave seria aceptado aqui.
     */
    it('rechaza un token propio emitido para otro modulo', () => {
      const ajeno = jwt.sign({ ...PERFIL }, CLAVE_PROPIA, {
        algorithm: 'HS256',
        expiresIn: 600,
        issuer: 'otro-backend',
        audience: 'OTRO_MODULO',
      });

      expect(() => verificarSesion(ajeno)).toThrow(TokenInvalidoError);
    });

    it('rechaza un token propio sin emisor ni destinatario', () => {
      const sinSello = jwt.sign({ ...PERFIL }, CLAVE_PROPIA, {
        algorithm: 'HS256',
        expiresIn: 600,
      });

      expect(() => verificarSesion(sinSello)).toThrow(TokenInvalidoError);
    });

    it('exige que la clave esté configurada, y lo dice nombrando la variable', () => {
      appConfig.sesion.secretoPropio = '';
      expect(() => firmarSesion(PERFIL)).toThrow(/SESSION_JWT_SECRET/);
    });
  });

  describe('el token de Auth central', () => {
    it('acepta una sesión del subsistema propio', () => {
      const contenido = verificarTokenDeAuth(tokenDeAuth());
      expect(contenido.userId).toBe(42);
      expect(contenido.sessionId).toBe('sesion-abc');
      expect(contenido.roleIds).toEqual([3, 5]);
    });

    /**
     * Auth emite también tokens de tipo `login`, que solo sirven para elegir subsistema
     * en `POST /auth/role`. No acreditan una sesión y no deben abrir el módulo.
     */
    it('rechaza un token de tipo «login»', () => {
      expect(() =>
        verificarTokenDeAuth(tokenDeAuth({ tokenType: 'login' })),
      ).toThrow(TokenInvalidoError);
    });

    /**
     * La comprobación que la guía de integración no pide y que cierra un agujero real:
     * sin ella, un `redirectCode` emitido para Timbre —subsistema 2— se canjearía
     * contra el Cuadro de Colores.
     */
    it('rechaza una sesión emitida para otro subsistema', () => {
      expect(() =>
        verificarTokenDeAuth(tokenDeAuth({ subsystemId: 2 })),
      ).toThrow(/no al Cuadro de Colores/);
    });

    it('sin subsistema configurado no comprueba el origen, y el arranque ya lo advirtió', () => {
      appConfig.sesion.subsistemaIdAuth = 0;
      expect(verificarTokenDeAuth(tokenDeAuth({ subsystemId: 2 })).userId).toBe(
        42,
      );
    });

    it('rechaza un token firmado con una clave que no es la de Auth', () => {
      expect(() => verificarTokenDeAuth(tokenDeAuth({}, 'impostora'))).toThrow(
        TokenInvalidoError,
      );
    });

    it('rechaza un token sin usuario', () => {
      expect(() =>
        verificarTokenDeAuth(tokenDeAuth({ userId: undefined })),
      ).toThrow(/no identifica al usuario/);
    });

    /**
     * EL AUTH DESPLEGADO VA POR DETRÁS DEL REPOSITORIO. Comprobado el 2026-08-17 contra
     * 172.20.136.127:10004: sus tokens de sesión traen solo `{userId, iat, exp}`.
     * Exigir `tokenType` y `subsystemId` dejaría la integración inservible contra el
     * único Auth que hay hoy, así que se aceptan ausentes y se advierte.
     */
    describe('contra la versión desplegada, que firma menos reclamaciones', () => {
      const comoElDesplegado = (): string =>
        jwt.sign({ userId: 3 }, CLAVE_AUTH, {
          algorithm: 'HS256',
          expiresIn: 600,
        });

      it('acepta un token con solo `userId`', () => {
        expect(verificarTokenDeAuth(comoElDesplegado()).userId).toBe(3);
      });

      it('avisa de que no puede distinguir una sesión de un token de login', () => {
        const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        verificarTokenDeAuth(comoElDesplegado());
        expect(aviso).toHaveBeenCalledWith(
          expect.stringContaining('tokenType'),
        );
      });

      it('avisa de que no puede comprobar el subsistema', () => {
        const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        verificarTokenDeAuth(comoElDesplegado());
        expect(aviso).toHaveBeenCalledWith(
          expect.stringContaining('subsystemId'),
        );
      });

      it('no avisa del subsistema si tampoco se configuró cuál esperar', () => {
        appConfig.sesion.subsistemaIdAuth = 0;
        const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        verificarTokenDeAuth(comoElDesplegado());
        expect(aviso).not.toHaveBeenCalledWith(
          expect.stringContaining('subsystemId'),
        );
      });

      /** Lo que NO se relaja: si el token declara el tipo, tiene que ser una sesión. */
      it('sigue rechazando un `tokenType` declarado que no sea «session»', () => {
        expect(() =>
          verificarTokenDeAuth(tokenDeAuth({ tokenType: 'login' })),
        ).toThrow(TokenInvalidoError);
      });
    });

    /**
     * Las dos claves son distintas a propósito. Si el módulo verificara los tokens de
     * Auth con su propia clave, aceptaría como sesión de Auth cualquier token que él
     * mismo hubiera firmado.
     */
    it('no acepta con la clave de Auth un token firmado por este módulo', () => {
      expect(() => verificarTokenDeAuth(firmarSesion(PERFIL))).toThrow(
        TokenInvalidoError,
      );
    });
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * LA SESIÓN NO DURA MÁS QUE EL TOKEN DE AUTH.
   *
   * Sin este tope, la cookie duraba sus ocho horas pasara lo que pasara: si Auth emitía
   * un token de diez minutos, este módulo seguía admitiendo a esa persona casi ocho horas
   * más. **La sesión sobrevivía a la credencial que la originó.**
   *
   * Adoptado del módulo de Instrucción, que integró Auth con el mismo patrón y ya lo
   * acotaba. Ver instruccion-backend/src/modules/auth-central.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  describe('la vigencia no supera la del token de Auth', () => {
    const ahora = () => Math.floor(Date.now() / 1000);

    // OCHO HORAS, LAS DE PRODUCCIÓN, y no los 600 segundos que fija el `beforeEach` de
    // esta suite. Con 600 la prueba no distinguía nada: coincidía con el vencimiento de
    // Auth que se le pasaba, así que pasaba igual con tope y sin él. Lo descubrí al
    // degradar el código a propósito y ver que seguía en verde.
    const OCHO_HORAS = 28_800;
    beforeEach(() => {
      appConfig.sesion.vigenciaSegundos = OCHO_HORAS;
    });

    const vencimientoDe = (token: string): number => {
      const carga = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString(),
      ) as { exp: number };
      return carga.exp;
    };

    const PERFIL = {
      usuarioId: 4,
      roles: [RolDepartamental.DAF],
      nombre: 'Analista de Transportes',
      funcionarioId: null,
      usuarioAuth: 'daf.transportes',
      tokenAuth: 'token-de-auth-de-pruebas',
    };

    it('acorta la sesión cuando el token de Auth vence antes', () => {
      const enUnMinuto = ahora() + 60;

      const token = firmarSesion(PERFIL, enUnMinuto);

      // Tolerancia de un segundo: entre firmar y leer puede cruzarse el reloj.
      expect(vencimientoDe(token)).toBeLessThanOrEqual(enUnMinuto + 1);
      // Y MUY por debajo de las ocho horas propias: es lo que distingue el tope de su
      // ausencia, y lo que la versión anterior de esta prueba no comprobaba.
      expect(vencimientoDe(token)).toBeLessThan(ahora() + OCHO_HORAS - 60);
    });

    it('conserva la vigencia propia cuando el token de Auth dura más', () => {
      const dentroDeUnMes = ahora() + 60 * 60 * 24 * 30;

      const token = firmarSesion(PERFIL, dentroDeUnMes);

      expect(vencimientoDe(token)).toBeLessThan(dentroDeUnMes);
      // Rige el nuestro, entero.
      expect(vencimientoDe(token)).toBeGreaterThan(ahora() + OCHO_HORAS - 60);
    });

    it('sin vencimiento de Auth rige solo el propio', () => {
      const conAuth = vencimientoDe(firmarSesion(PERFIL, null));
      const sinArgumento = vencimientoDe(firmarSesion(PERFIL));

      expect(Math.abs(conAuth - sinArgumento)).toBeLessThanOrEqual(1);
    });

    /**
     * UN TOKEN DE AUTH YA VENCIDO NO PRODUCE UNA COOKIE INVÁLIDA. Con `expiresIn` cero o
     * negativo, la cookie nacería muerta y esa persona vería un 401 justo después de
     * entrar, sin entender por qué. Se le da un segundo: pasa, y se le obliga a renovar.
     */
    it('un token de Auth ya vencido no produce una cookie nacida inválida', () => {
      const haceUnaHora = ahora() - 3600;

      const token = firmarSesion(PERFIL, haceUnaHora);

      expect(vencimientoDe(token)).toBeGreaterThanOrEqual(ahora());
    });
  });
});
