/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad · directorio de Auth central
 * Archivo: auth-usuarios.client.spec.ts
 * Responsabilidad: Fijar cómo se le habla a Auth y cómo se traduce lo que responde.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-21
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ESTE ARCHIVO NACE DE UN DEFECTO QUE SOLO APARECIÓ CONTRA EL AUTH REAL.
 *
 * La primera versión enviaba el token **sin el prefijo `Bearer`**, copiando al otro módulo
 * del ecosistema que consume `/users` —que reenvía la cabecera entera del navegador y por
 * eso ya lo trae—. Comprobado contra el Auth desplegado:
 *
 *     sin cabecera        → 500 «Token no encontrado»
 *     Authorization: xxx  → 500 «Token no encontrado»    ← INDISTINGUIBLE
 *     Bearer xxx          → 500 «Token incorrecto o expirado»
 *
 * Un token pelado no da un error de autenticación: **da el mismo error que no enviar nada**.
 * Por eso la prueba mira la cabecera que se envía, y no solo el resultado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { ApplicationError } from '../../../common/errors/application.error';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import { appConfig } from '../../../config/app.config';
import {
  AuthNoDisponibleError,
  AuthUsuariosClient,
} from './auth-usuarios.client';

const URL_AUTH = 'http://auth.interno:10004';

const respuesta = (cuerpo: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    json: () => Promise.resolve(cuerpo),
  }) as Response;

/** Un usuario con la forma que Auth devuelve de verdad. */
const usuarioDeAuth = (cambios: Record<string, unknown> = {}) => ({
  id: 42,
  name: 'PEREZ LOPEZ JUAN CARLOS',
  username: 'jcperez',
  cedula: '1712345678',
  email: 'jcperez@amc.gob.ec',
  dependencia: 'DMIP',
  roles: ['(Cuadro de Colores) Administrador'],
  active: true,
  inspector: null,
  ...cambios,
});

describe('AuthUsuariosClient', () => {
  const original = { ...appConfig.sesion };
  let peticiones: jest.Mock<Promise<Response>, [string, RequestInit]>;
  let cliente: AuthUsuariosClient;

  /** La cabecera `Authorization` de la última petición. */
  const autorizacionEnviada = (): string => {
    const [, opciones] = peticiones.mock.calls[0];
    const cabeceras = opciones.headers as Record<string, string>;
    return cabeceras.Authorization;
  };

  beforeEach(() => {
    appConfig.sesion.urlApiAuth = URL_AUTH;

    peticiones = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValue(respuesta([usuarioDeAuth()]));
    globalThis.fetch = peticiones as unknown as typeof fetch;

    cliente = new AuthUsuariosClient();
  });

  afterEach(() => {
    Object.assign(appConfig.sesion, original);
    jest.restoreAllMocks();
  });

  it('envía el token con el prefijo `Bearer`, que Auth exige', async () => {
    await cliente.listar('eyJhbGciOiJIUzI1NiJ9.abc');

    expect(autorizacionEnviada()).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.abc');
  });

  it('no duplica el prefijo si el token ya lo trae', async () => {
    // Reenviar una cabecera tal cual es un uso legítimo, y `Bearer Bearer …` no lo es.
    await cliente.listar('Bearer eyJhbGciOiJIUzI1NiJ9.abc');

    expect(autorizacionEnviada()).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.abc');
  });

  it('pregunta por `/users` sobre la base configurada', async () => {
    await cliente.listar('token');

    expect(peticiones.mock.calls[0][0]).toBe(`${URL_AUTH}/users`);
  });

  it('devuelve a todos, activos e inactivos: filtrar no es de esta capa', async () => {
    peticiones.mockResolvedValue(
      respuesta([
        usuarioDeAuth({ id: 1, active: true }),
        usuarioDeAuth({ id: 2, active: false }),
      ]),
    );

    const usuarios = await cliente.listar('token');

    expect(usuarios).toHaveLength(2);
    expect(usuarios.map((usuario) => usuario.activo)).toEqual([true, false]);
  });

  describe('cuando Auth no sirve la consulta', () => {
    /**
     * LA PRUEBA QUE HACE QUE EL MENSAJE LLEGUE A LA PANTALLA.
     *
     * Mientras `AuthNoDisponibleError` extendió `Error` a secas, el filtro global lo
     * trataba como fallo no controlado: respondía 500 con el texto genérico y el motivo
     * redactado se quedaba en la bitácora. Pertenecer a `ApplicationError` es lo que
     * cumple la regla 7 del proyecto, y por eso se afirma el tipo y no solo el texto.
     */
    it('el error es un ApplicationError 503, no un Error pelado', async () => {
      peticiones.mockResolvedValue(
        respuesta(
          { statusCode: 500, message: 'Token no encontrado' },
          false,
          500,
        ),
      );

      const fallo = await cliente
        .listar('token')
        .catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(AuthNoDisponibleError);
      expect(fallo).toBeInstanceOf(ApplicationError);
      expect((fallo as ApplicationError).statusCode).toBe(503);
      expect((fallo as ApplicationError).code).toBe(
        CODIGOS_ERROR.AUTH_NO_DISPONIBLE,
      );
    });

    it('arrastra el motivo que da Auth: es lo que distingue un caso del otro', async () => {
      peticiones.mockResolvedValue(
        respuesta(
          { statusCode: 500, message: 'Token incorrecto o expirado' },
          false,
          500,
        ),
      );

      const fallo = await cliente
        .listar('token')
        .catch((error: unknown) => error);

      expect((fallo as Error).message).toContain('Token incorrecto o expirado');
    });

    it('sin cuerpo legible el mensaje sigue siendo accionable', async () => {
      peticiones.mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('no es JSON')),
      } as unknown as Response);

      const fallo = await cliente
        .listar('token')
        .catch((error: unknown) => error);

      expect((fallo as Error).message).toContain('portal institucional');
    });

    it('si Auth no responde, se dice que el maestro se sigue administrando', async () => {
      peticiones.mockRejectedValue(new Error('ECONNREFUSED'));

      const fallo = await cliente
        .listar('token')
        .catch((error: unknown) => error);

      expect((fallo as Error).message).toContain('maestro de personal');
    });

    it('sin `AUTH_API_URL` no se inventa a dónde preguntar', async () => {
      appConfig.sesion.urlApiAuth = '';

      const fallo = await new AuthUsuariosClient()
        .listar('token')
        .catch((error: unknown) => error);

      expect(fallo).toBeInstanceOf(AuthNoDisponibleError);
      expect((fallo as Error).message).toContain('no está configurado');
      expect(peticiones).not.toHaveBeenCalled();
    });

    it('un cuerpo que no es una lista no se da por bueno', async () => {
      peticiones.mockResolvedValue(respuesta({ usuarios: [] }));

      const fallo = await cliente
        .listar('token')
        .catch((error: unknown) => error);

      expect((fallo as Error).message).toContain('formato inesperado');
    });
  });
});
