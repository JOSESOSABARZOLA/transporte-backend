/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: sesion.service.spec.ts
 * Responsabilidad: Verificar el canje del código y la resolución de la cuenta local.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-17
 *
 * SE SIMULA `fetch`, NO AXIOS: el servicio usa el `fetch` global de Node a propósito,
 * para no sumar una dependencia. Simularlo es sustituir `globalThis.fetch`.
 *
 * EL CASO MÁS IMPORTANTE DE ESTE ARCHIVO es el último: que el rol NO salga de lo que
 * diga Auth central. Es el reparto sobre el que se apoya toda la integración, y una
 * prueba que lo fije evita que alguien «mejore» el servicio leyendo `roles` de la
 * respuesta.
 */

import jwt from 'jsonwebtoken';
import { RolDepartamental } from '@prisma/client';

import { appConfig } from '../../../config/app.config';
import { verificarSesion } from '../../../common/auth/token-sesion';
import { SesionNoValidaError, SesionService } from './sesion.service';
import type {
  CuentaConRoles,
  UsuarioSesionRepository,
} from '../infrastructure/usuario-sesion.repository';

const CLAVE_PROPIA = 'clave-de-pruebas-del-modulo';
const CLAVE_AUTH = 'clave-de-pruebas-de-auth-central';
const URL_CANJE = 'http://auth-api.pruebas/auth/exchange';

const CUENTA: CuentaConRoles = {
  id: 4,
  correo: 'daf.transportes@amc.gob.ec',
  nombre: 'Analista de Transportes',
  roles: [{ rol: RolDepartamental.DAF }],
  identificadorAd: 'daf.transportes',
  funcionarioId: 150,
  activo: true,
  creadoEn: new Date('2026-08-01T00:00:00.000Z'),
};

const tokenDeAuth = (cambios: Record<string, unknown> = {}): string =>
  jwt.sign(
    {
      userId: 42,
      tokenType: 'session',
      sessionId: 'sesion-abc',
      subsystemId: 9,
      roleIds: [3],
      ...cambios,
    },
    CLAVE_AUTH,
    { algorithm: 'HS256', expiresIn: 600 },
  );

/** Respuesta de `GET /auth/exchange`, con la forma real del contrato. */
const respuestaDeAuth = (cuerpo: unknown, ok = true): Response =>
  ({
    ok,
    status: ok ? 200 : 401,
    json: () => Promise.resolve(cuerpo),
  }) as Response;

describe('SesionService', () => {
  const original = { ...appConfig.sesion };
  const buscarPorIdentificadorAd = jest.fn<
    Promise<CuentaConRoles | null>,
    [string]
  >();
  const repositorio = {
    buscarPorIdentificadorAd,
  } as unknown as UsuarioSesionRepository;

  let servicio: SesionService;
  // Se tipa el doble en lugar de dejarlo genérico: `jest.Mock` sin parámetros devuelve
  // `any`, y leer `mock.calls[0][0]` propagaría ese `any`, que el proyecto prohíbe.
  let peticionesAAuth: jest.Mock<Promise<Response>, [string]>;

  beforeEach(() => {
    appConfig.sesion.secretoPropio = CLAVE_PROPIA;
    appConfig.sesion.secretoAuth = CLAVE_AUTH;
    appConfig.sesion.subsistemaIdAuth = 9;
    appConfig.sesion.vigenciaSegundos = 600;
    appConfig.sesion.urlCanjeAuth = URL_CANJE;

    buscarPorIdentificadorAd.mockReset();
    buscarPorIdentificadorAd.mockResolvedValue(CUENTA);

    peticionesAAuth = jest
      .fn<Promise<Response>, [string]>()
      .mockResolvedValue(
        respuestaDeAuth({ token: tokenDeAuth(), username: 'daf.transportes' }),
      );
    globalThis.fetch = peticionesAAuth as unknown as typeof fetch;

    servicio = new SesionService(repositorio);
  });

  afterEach(() => {
    Object.assign(appConfig.sesion, original);
    jest.restoreAllMocks();
  });

  it('canjea el código y devuelve un token con la identidad local', async () => {
    const { token, perfil } = await servicio.canjear('codigo-de-un-solo-uso');

    expect(perfil).toEqual({
      usuarioId: 4,
      // El perfil trae los roles YA APLANADOS: la forma con { rol } es la del repositorio.
      roles: [RolDepartamental.DAF],
      nombre: 'Analista de Transportes',
      funcionarioId: 150,
      usuarioAuth: 'daf.transportes',
      // El token de Auth se conserva desde el 2026-08-21. Ver la prueba siguiente.
      tokenAuth: expect.any(String) as string,
    });
    expect(verificarSesion(token).usuarioId).toBe(4);
  });

  /**
   * EL TOKEN DE AUTH SE CONSERVA, Y ES UN CAMBIO DE POSTURA DE SEGURIDAD. 2026-08-21.
   *
   * Antes se descartaba en cuanto se validaba. Ahora viaja dentro de nuestro token de
   * sesión porque **Auth central no tiene token de servicio ni clave de API**: la
   * credencial de quien pregunta es la única con la que se puede consultar `/users`, y
   * sin ella el directorio de personal de P-07 no existe.
   *
   * Que sea EL MISMO que devolvió Auth no es un detalle de implementación: si se guardara
   * otro, la consulta al directorio fallaría con un 401 que nadie sabría a qué atribuir.
   */
  it('conserva el token de Auth en el perfil, tal como Auth lo devolvió', async () => {
    const devueltoPorAuth = tokenDeAuth();

    peticionesAAuth.mockResolvedValue(
      respuestaDeAuth({ token: devueltoPorAuth, username: 'daf.transportes' }),
    );

    const { perfil } = await servicio.canjear('codigo-de-un-solo-uso');

    expect(perfil.tokenAuth).toBe(devueltoPorAuth);
  });

  it('envía el código a Auth central por la URL configurada', async () => {
    await servicio.canjear('abc 123');

    expect(peticionesAAuth.mock.calls[0][0]).toBe(
      `${URL_CANJE}?code=abc%20123`,
    );
  });

  it('resuelve la cuenta por el usuario de Auth, no por el userId de Auth', async () => {
    // `t_usuario.usua_id` y el `userId` de Auth son numeraciones distintas y no tienen
    // por qué coincidir. La llave es `usua_identificador_ad`.
    await servicio.canjear('codigo');
    expect(buscarPorIdentificadorAd).toHaveBeenCalledWith('daf.transportes');
  });

  describe('rechaza el ingreso', () => {
    it('cuando Auth central no reconoce el código', async () => {
      peticionesAAuth.mockResolvedValue(respuestaDeAuth({}, false));
      await expect(servicio.canjear('gastado')).rejects.toThrow(
        SesionNoValidaError,
      );
    });

    it('cuando no se puede contactar con Auth central', async () => {
      peticionesAAuth.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1:443'));
      // El mensaje NO debe filtrar el host interno de Auth al navegador.
      await expect(servicio.canjear('codigo')).rejects.toThrow(
        /Intente nuevamente en unos minutos/,
      );
    });

    it('cuando el token de Auth es de otro subsistema', async () => {
      peticionesAAuth.mockResolvedValue(
        respuestaDeAuth({
          token: tokenDeAuth({ subsystemId: 2 }),
          username: 'daf.transportes',
        }),
      );
      await expect(servicio.canjear('codigo')).rejects.toThrow(
        SesionNoValidaError,
      );
    });

    it('cuando la respuesta no trae el usuario, que es la llave de la cuenta', async () => {
      peticionesAAuth.mockResolvedValue(
        respuestaDeAuth({ token: tokenDeAuth() }),
      );
      await expect(servicio.canjear('codigo')).rejects.toThrow(
        /no indicó de qué usuario/,
      );
    });

    /**
     * El caso de F-02: `t_usuario` está vacía. Es el que más veces se va a ver el día
     * que se encienda la identidad real, así que su mensaje debe decirle al funcionario
     * qué hacer, no solo que no puede pasar.
     */
    it('cuando el usuario no tiene cuenta en el Cuadro de Colores', async () => {
      buscarPorIdentificadorAd.mockResolvedValue(null);
      await expect(servicio.canjear('codigo')).rejects.toThrow(
        /Solicite el alta al administrador del módulo/,
      );
    });

    it('cuando la cuenta está desactivada, y lo distingue de no tenerla', async () => {
      buscarPorIdentificadorAd.mockResolvedValue({ ...CUENTA, activo: false });
      await expect(servicio.canjear('codigo')).rejects.toThrow(
        /está desactivado/,
      );
    });
  });

  /**
   * EL REPARTO QUE SOSTIENE LA INTEGRACIÓN: Auth central dice QUIÉN es; el Cuadro de
   * Colores decide QUÉ ROL tiene. Ver PLAN_INTEGRACION_AUTH.md §3.
   */
  it('el rol sale de t_usuario y NO de lo que declare Auth central', async () => {
    peticionesAAuth.mockResolvedValue(
      respuestaDeAuth({
        token: tokenDeAuth({ roleIds: [999] }),
        username: 'daf.transportes',
        roles: ['Director', 'Administrador'],
        permissions: [{ path: '/todo', write: true, scope: 'all' }],
      }),
    );

    const { perfil } = await servicio.canjear('codigo');

    expect(perfil.roles).toEqual([RolDepartamental.DAF]);
  });

  it('no reintenta el canje: el código es de un solo uso', async () => {
    peticionesAAuth.mockResolvedValue(respuestaDeAuth({}, false));
    await expect(servicio.canjear('codigo')).rejects.toThrow();
    expect(peticionesAAuth).toHaveBeenCalledTimes(1);
  });
  /**
   * LA MEJORA QUE TRAJO EL MÓDULO DE INSTRUCCIÓN, que integró Auth antes que éste.
   *
   * La cookie dura ocho horas. Sin releer la cuenta, retirar un rol o dar de baja a
   * alguien no surtiría efecto hasta que caducara: quien perdiera el perfil de Dirección
   * seguiría viendo la matriz consolidada el resto de la jornada.
   */
  describe('el perfil vigente se relee de la base', () => {
    it('devuelve el rol ACTUAL, no el que se firmó al entrar', async () => {
      buscarPorIdentificadorAd.mockResolvedValue({
        ...CUENTA,
        roles: [{ rol: RolDepartamental.DIRECTOR }],
      });

      const perfil = await servicio.perfilVigente('daf.transportes');

      expect(perfil.roles).toEqual([RolDepartamental.DIRECTOR]);
      expect(buscarPorIdentificadorAd).toHaveBeenCalledWith('daf.transportes');
    });

    it('responde 403 si la cuenta fue desactivada, no 401', async () => {
      buscarPorIdentificadorAd.mockResolvedValue({ ...CUENTA, activo: false });

      // 403 y no 401 a propósito: volver a entrar no arregla que le hayan retirado el
      // acceso, y mandar al portal solo produciría el mismo rechazo.
      await expect(
        servicio.perfilVigente('daf.transportes'),
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('responde 403 si la cuenta ya no existe', async () => {
      buscarPorIdentificadorAd.mockResolvedValue(null);

      await expect(
        servicio.perfilVigente('daf.transportes'),
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('relee por el usuario de Auth, que es la llave estable', async () => {
      // No por `usuarioId`: si la cuenta se recreó, el identificador cambia y el usuario
      // de Auth no.
      buscarPorIdentificadorAd.mockResolvedValue({ ...CUENTA, id: 999 });

      const perfil = await servicio.perfilVigente('daf.transportes');

      expect(perfil.usuarioId).toBe(999);
    });
  });
});
