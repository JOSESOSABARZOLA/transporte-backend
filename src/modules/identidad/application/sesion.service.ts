/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: sesion.service.ts
 * Responsabilidad: Canjear el código de Auth central y construir la sesión del módulo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-17
 *
 * Implementa el patrón de cookie `HttpOnly` de `INTEGRACION_AUTH_CENTRALIZADO_BACKENDS.md`
 * sobre el `GET /auth/exchange` que Auth central sí tiene. Ver PLAN_INTEGRACION_AUTH.md §6.1.
 *
 * EL TOKEN DE AUTH SE CONSERVA DESDE EL 2026-08-21, y hasta esa fecha no. Se verifica, se
 * traduce a identidad local y **se guarda dentro del token propio**, en una cookie que el
 * navegador no puede leer.
 *
 * Cambió porque P-07 consulta el directorio de personal de Auth (`GET /users`) y **Auth no
 * tiene token de servicio ni API key**: la única credencial que existe es la sesión de una
 * persona. Es un cambio de postura de seguridad, no una comodidad, y lo que implica está
 * escrito donde se declara el campo, en `ContenidoSesion` de `token-sesion.ts`.
 *
 * SIN AXIOS. Node trae `fetch` global desde la versión 18 y el módulo corre sobre 20.
 * Una dependencia menos en la imagen, y era la tercera que este trabajo iba a pedir.
 */

import { Injectable, Logger } from '@nestjs/common';

import { appConfig } from '../../../config/app.config';
import { CODIGO_SESION_NO_VALIDA } from '../../../common/errors/codigos-error';
import { ApplicationError } from '../../../common/errors/application.error';
import {
  firmarSesion,
  verificarTokenDeAuth,
  TokenInvalidoError,
  type ContenidoSesion,
} from '../../../common/auth/token-sesion';
import {
  UsuarioSesionRepository,
  type CuentaConRoles,
} from '../infrastructure/usuario-sesion.repository';

/** Tiempo máximo de la llamada a Auth central, en milisegundos. */
const ESPERA_MAXIMA_MS = 5000;

/**
 * 401 de la sesión con Auth central.
 *
 * Lleva el código `APP-UNAUTHORIZED-001` que fija el contrato compartido, y el sobre
 * del módulo que compone `AllExceptionsFilter`. Ver codigos-error.ts.
 */
export class SesionNoValidaError extends ApplicationError {
  constructor(mensaje: string) {
    super(mensaje, 401, CODIGO_SESION_NO_VALIDA);
    this.name = 'SesionNoValidaError';
  }
}

/**
 * 403 · la sesión es válida pero la cuenta ya no puede entrar.
 *
 * DISTINTO DEL 401 A PROPÓSITO. «No hay sesión» y «su sesión vale pero le retiraron el
 * acceso» llevan al funcionario a gestiones distintas: la primera se resuelve volviendo
 * a entrar, la segunda hablando con el administrador. Volver a entrar ante la segunda
 * solo produce el mismo rechazo.
 */
export class AccesoRetiradoError extends ApplicationError {
  constructor(mensaje: string) {
    super(mensaje, 403, CODIGO_SESION_NO_VALIDA);
    this.name = 'AccesoRetiradoError';
  }
}

/** Respuesta del canje de Auth central. Ver PLAN_INTEGRACION_AUTH.md §1.1. */
interface RespuestaCanjeAuth {
  token: string;
  username: string;
}

@Injectable()
export class SesionService {
  private readonly logger = new Logger(SesionService.name);

  constructor(private readonly usuarios: UsuarioSesionRepository) {}

  /**
   * Canjea el código de un solo uso y devuelve el token de sesión de este módulo.
   *
   * Los siete pasos del §6.1 del plan, en orden. Cualquiera de ellos que falle produce
   * el mismo `401`, con un mensaje distinto según de quién sea el problema.
   */
  async canjear(
    code: string,
  ): Promise<{ token: string; perfil: ContenidoSesion }> {
    const respuesta = await this.pedirCanjeAAuth(code);
    const contenidoAuth = this.verificarToken(respuesta.token);
    const cuenta = await this.resolverCuenta(respuesta.username);

    const perfil: ContenidoSesion = {
      usuarioId: cuenta.id,
      roles: cuenta.roles.map((fila) => fila.rol),
      nombre: cuenta.nombre,
      funcionarioId: cuenta.funcionarioId,
      usuarioAuth: respuesta.username,
      // SE CONSERVA desde el 2026-08-21, y hasta hoy se descartaba a propósito. P-07
      // consulta el directorio de personal de Auth, y **Auth no tiene token de servicio**:
      // la única credencial que existe es la sesión de una persona. Lo que esto implica
      // está escrito donde se declara el campo, en `ContenidoSesion`.
      tokenAuth: respuesta.token,
    };

    this.logger.log(
      `Sesión abierta para ${respuesta.username} · usuario ${cuenta.id} · roles ${cuenta.roles.map((f) => f.rol).join(', ')} · Auth userId ${contenidoAuth.userId}`,
    );

    // LA SESIÓN NO DURA MÁS QUE EL TOKEN DE AUTH. Sin este tope, nuestra cookie duraba
    // sus ocho horas aunque el token que la originó venciera en diez minutos: la sesión
    // sobrevivía a la credencial. Idea tomada del módulo de Instrucción.
    return { token: firmarSesion(perfil, contenidoAuth.exp), perfil };
  }

  /**
   * Perfil de la sesión vigente, **releído de la base**.
   *
   * NO DEVUELVE LO QUE SE FIRMÓ AL ENTRAR, y ésa es toda la razón de que exista este
   * método. La cookie dura ocho horas: si en ese tiempo se retira un rol o se desactiva
   * una cuenta, confiar en lo firmado mantendría el acceso anterior el resto de la
   * jornada. En un sistema donde `DIRECTOR` es el único que ve la matriz consolidada
   * entera, esa ventana no es aceptable.
   *
   * Se relee por `usuarioAuth`, que es la llave estable, y no por `usuarioId`: si la
   * cuenta se recreó, el identificador cambia y el usuario de Auth no.
   *
   * EL COSTE ESTÁ ACOTADO. Es una consulta en `GET /auth/session`, que el frontend hace
   * al arrancar, no en cada petición: `IdentidadGuard` sigue sin tocar la base.
   *
   * Lo mismo hace el módulo de Instrucción, que integró Auth antes que éste.
   */
  async perfilVigente(usuarioAuth: string): Promise<ContenidoSesion> {
    const cuenta = await this.usuarios.buscarPorIdentificadorAd(usuarioAuth);

    // SIN NINGÚN ROL NO SE ENTRA, y se dice aquí y no cuando todo responda 403. Puede
    // pasar: la pantalla de cuentas permite retirar el último rol de alguien.
    if (cuenta && cuenta.activo && cuenta.roles.length === 0) {
      this.logger.warn(
        `${usuarioAuth} tiene cuenta activa pero ningún rol asignado.`,
      );
      throw new AccesoRetiradoError(
        'Su usuario no tiene ningún rol asignado en el Cuadro de Colores, así que no puede trabajar en él. Solicíteselo al administrador del módulo.',
      );
    }

    if (!cuenta || !cuenta.activo) {
      this.logger.warn(
        `La sesión de «${usuarioAuth}» sigue vigente pero su cuenta ${cuenta ? 'está desactivada' : 'ya no existe'}.`,
      );
      throw new AccesoRetiradoError(
        cuenta
          ? 'Su usuario del Cuadro de Colores fue desactivado. Comuníquese con el administrador del módulo.'
          : 'Su usuario ya no está dado de alta en el Cuadro de Colores. Solicite el alta al administrador del módulo.',
      );
    }

    return {
      usuarioId: cuenta.id,
      roles: cuenta.roles.map((fila) => fila.rol),
      nombre: cuenta.nombre,
      funcionarioId: cuenta.funcionarioId,
      usuarioAuth,
      // NULO, y no es un descuido: este método relee la identidad **de la base**, y el
      // token de Auth no está en la base ni debe estarlo. Vive solo en la cookie, y quien
      // lo necesita lo toma de `UsuarioAutenticado`. Nadie consume este campo aquí: la
      // respuesta de `GET /auth/session` son tres datos y ninguno es el token.
      tokenAuth: null,
    };
  }

  /**
   * Paso 1 · pide el canje a Auth central.
   *
   * EL CÓDIGO ES DE UN SOLO USO: `consumeRedirectCode` lo borra de Redis al leerlo. Un
   * reintento automático ante un fallo de red devolvería «código inválido» y taparía la
   * causa real, así que **no se reintenta** y el fallo se distingue del rechazo.
   */
  private async pedirCanjeAAuth(code: string): Promise<RespuestaCanjeAuth> {
    const base = appConfig.sesion.urlCanjeAuth;
    if (base.trim() === '') {
      throw new Error(
        'AUTH_EXCHANGE_URL no está configurada: no hay a dónde canjear el código de ingreso.',
      );
    }

    const destino = `${base}${base.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}`;

    let respuesta: Response;
    try {
      respuesta = await fetch(destino, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
      });
    } catch (error) {
      // La causa se registra y NO se devuelve: puede traer el host interno de Auth.
      this.logger.error(
        `No se pudo contactar con Auth central: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new SesionNoValidaError(
        'No se pudo contactar con el servicio de autenticación. Intente nuevamente en unos minutos.',
      );
    }

    if (!respuesta.ok) {
      this.logger.warn(
        `Auth central rechazó el canje con estado ${respuesta.status}.`,
      );
      throw new SesionNoValidaError(
        'El ingreso caducó o ya fue utilizado. Vuelva a iniciar sesión desde el portal institucional.',
      );
    }

    const cuerpo: unknown = await respuesta.json();
    return this.interpretarCanje(cuerpo);
  }

  /**
   * Comprueba que la respuesta del canje trae lo que hace falta.
   *
   * `username` viene en el CUERPO y `userId` dentro del TOKEN: son dos sitios distintos,
   * y hacen falta los dos. Es el desajuste D-5 del plan, y aquí se ve por qué importa —
   * decodificar solo el token dejaría sin la llave con la que se resuelve la cuenta.
   */
  private interpretarCanje(cuerpo: unknown): RespuestaCanjeAuth {
    if (typeof cuerpo !== 'object' || cuerpo === null) {
      throw new SesionNoValidaError(
        'El servicio de autenticación respondió de una forma que no se pudo interpretar.',
      );
    }

    const { token, username } = cuerpo as {
      token?: unknown;
      username?: unknown;
    };

    if (typeof token !== 'string' || token === '') {
      throw new SesionNoValidaError(
        'El servicio de autenticación no entregó una sesión válida.',
      );
    }

    if (typeof username !== 'string' || username === '') {
      throw new SesionNoValidaError(
        'El servicio de autenticación no indicó de qué usuario se trata.',
      );
    }

    return { token, username };
  }

  /** Pasos 2 y 3 · firma, vencimiento, tipo de token y subsistema. */
  private verificarToken(token: string) {
    try {
      return verificarTokenDeAuth(token);
    } catch (error) {
      if (error instanceof TokenInvalidoError) {
        this.logger.warn(`Token de Auth central rechazado: ${error.message}`);
        throw new SesionNoValidaError(
          'La sesión entregada por el portal institucional no es válida para el Cuadro de Colores.',
        );
      }
      throw error;
    }
  }

  /**
   * Paso 4 · el usuario de Auth se convierte en una cuenta de este módulo.
   *
   * LOS DOS MENSAJES SON DISTINTOS A PROPÓSITO. «No está dada de alta» y «está
   * desactivada» llevan al funcionario a gestiones distintas, y confundirlas le hace
   * perder una llamada. Ninguno de los dos revela si el usuario existe en Auth: eso ya
   * lo sabe quien acaba de autenticarse.
   */
  private async resolverCuenta(usuarioAuth: string): Promise<CuentaConRoles> {
    const cuenta = await this.usuarios.buscarPorIdentificadorAd(usuarioAuth);

    if (!cuenta) {
      this.logger.warn(
        `«${usuarioAuth}» se autenticó en Auth central pero no tiene cuenta en el Cuadro de Colores.`,
      );
      throw new SesionNoValidaError(
        'Su usuario no está dado de alta en el Cuadro de Colores. Solicite el alta al administrador del módulo.',
      );
    }

    if (!cuenta.activo) {
      throw new SesionNoValidaError(
        'Su usuario del Cuadro de Colores está desactivado. Comuníquese con el administrador del módulo.',
      );
    }

    return cuenta;
  }
}
