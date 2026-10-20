/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: token-sesion.ts
 * Responsabilidad: Firmar y verificar el token de sesión propio, y verificar el de Auth central.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-17
 *
 * FUNCIONES SUELTAS Y NO UN SERVICIO INYECTABLE, a propósito. Las consume el
 * `IdentidadGuard` —que vive en `common/auth`— y el servicio de sesión —que vive en
 * `modules/identidad`—. Un proveedor de Nest obligaría a que `common/auth` dependiera
 * del submódulo o al revés, y las dos direcciones son peores que ninguna. Aquí no hay
 * estado ni dependencias: solo dos claves leídas de la configuración.
 *
 * DOS CLAVES DISTINTAS, y la distinción es el fondo del patrón de cookie:
 *
 *   - `secretoAuth`   verifica lo que FIRMÓ Auth central. Se usa UNA sola vez, en el
 *                     canje del código, y nunca más.
 *   - `secretoPropio` firma y verifica lo que emite ESTE módulo. Es lo que viaja en la
 *                     cookie y lo que se comprueba en cada petición.
 *
 * El token de Auth no se guarda en ninguna parte: se verifica, se traduce a identidad
 * local y se descarta. Ver docs/PLAN_INTEGRACION_AUTH.md §6.1.
 */

import { Logger } from '@nestjs/common';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { RolDepartamental } from '@prisma/client';

import { appConfig } from '../../config/app.config';

/** Algoritmo de firma. Auth central firma en HS256; comprobado contra el servidor real. */
const ALGORITMO = 'HS256';

/**
 * Cuántos segundos debe durar la sesión, sin pasarse del token de Auth.
 *
 * DEVUELVE AL MENOS UN SEGUNDO. Si el token de Auth ya venció o vence ahora mismo, un
 * `expiresIn` de cero o negativo produciría una cookie inválida desde el instante en que
 * se emite, y esa persona vería un 401 sin entender por qué acaba de entrar. Un segundo
 * la deja pasar y la obliga a renovar, que es lo que debe ocurrir.
 */
function vigenciaEfectiva(vencimientoAuth: number | null): number {
  const propia = appConfig.sesion.vigenciaSegundos;
  if (vencimientoAuth === null) return propia;

  const restanteEnAuth = vencimientoAuth - Math.floor(Date.now() / 1000);
  return Math.max(1, Math.min(propia, restanteEnAuth));
}

/** Registro propio: estas funciones no son un proveedor y no reciben el del módulo. */
const registro = new Logger('TokenSesion');

/** Contenido del token que emite este módulo y viaja en la cookie de sesión. */
export interface ContenidoSesion {
  usuarioId: number;
  /**
   * Roles del Cuadro de Colores que tiene esta persona.
   *
   * ERA UNO SOLO -`rol`- hasta el 2026-08-19. Auth admite asignar varios roles de
   * Transporte a la misma persona, y el negocio decidio que valen TODOS a la vez: se ve
   * la union de los formularios de cada uno.
   *
   * CONSECUENCIA AL DESPLEGAR: las cookies emitidas antes de este cambio no traen
   * `roles` y se rechazan al verificarse. Es correcto -esa sesion no puede saber que
   * roles tiene- y se traduce en que quien la tuviera abierta vuelve al portal una vez.
   */
  roles: RolDepartamental[];
  nombre: string;
  /** Enlace con la ficha de personal. Nulo en los perfiles que no salen a operativos. */
  funcionarioId: number | null;
  /** Usuario de Auth central que originó la sesión. Solo para la traza. */
  usuarioAuth: string;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * EL TOKEN DE AUTH, GUARDADO. Cambio del 2026-08-21, y es un cambio de POSTURA.
   *
   * Hasta hoy este token se descartaba en el propio canje, deliberadamente: la sesión de
   * este módulo no necesitaba a Auth para nada más. Ahora sí — P-07 consulta
   * `GET /users` de Auth para pintar el directorio de personal, y **Auth no tiene token
   * de servicio ni API key**: la única credencial que existe es la sesión de una persona.
   *
   * QUÉ SIGNIFICA ESTO, SIN ADORNARLO. Quien obtenga esta cookie obtiene también una
   * credencial de Auth central, no solo de este módulo. Se acepta porque:
   *
   *   · la cookie es `HttpOnly`: el JavaScript de la aplicación no la lee;
   *   · la CSP declara `connect-src 'self'`, así que aunque alguien lograra ejecutar
   *     código, no podría enviarla a otro origen;
   *   · la sesión **ya estaba acotada al vencimiento de Auth** (`vigenciaEfectiva`), de
   *     modo que este token nunca sobrevive a la sesión que lo originó.
   *
   * NO ESTÁ CIFRADO, SOLO FIRMADO. Un JWT es legible por quien lo tenga en la mano. Si
   * algún día hace falta más que esto, la respuesta no es cifrar la cookie: es pedirle a
   * Auth central una credencial de servicio, que es lo que corresponde a una consulta
   * máquina a máquina.
   *
   * Nulo en las sesiones emitidas antes de este cambio, y en cualquiera donde el canje no
   * lo entregue. Quien lo consuma debe tratarlo como ausente, no como error.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  tokenAuth: string | null;
}

/**
 * Reclamaciones del token que emite Auth central.
 *
 * Copiadas del código, no supuestas: `auth.service.ts:65` firma
 * `{ userId, cedula, tokenType, sessionId, subsystemId, roleIds }`.
 * **`username` no está aquí**: llega en el cuerpo de la respuesta del canje.
 */
export interface ContenidoAuth {
  userId: number;
  /**
   * Vencimiento del token de Auth, en segundos desde la época.
   *
   * SE EXPONE PARA PODER ACOTAR NUESTRA SESIÓN A ÉL. Es la única reclamación de este
   * token que el Auth desplegado SÍ envía siempre —junto a `userId` e `iat`—, a
   * diferencia de `tokenType`, `subsystemId` y `roleIds`, que el repositorio declara y
   * el despliegue no manda. Comprobado contra el servidor el 2026-08-20.
   */
  exp: number | null;
  tokenType: string;
  sessionId: string;
  subsystemId: number;
  roleIds: number[];
}

/** El token no es utilizable: firma inválida, vencido o con forma inesperada. */
export class TokenInvalidoError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'TokenInvalidoError';
  }
}

/**
 * Exige que la clave esté configurada.
 *
 * Se comprueba al usarla y no al arrancar porque la configuración se evalúa al importar
 * el módulo, y un `throw` ahí dejaría sin ejecutar hasta las pruebas que no tocan la
 * sesión. Aquí el fallo aparece donde se puede entender.
 */
function exigirClave(clave: string, nombreVariable: string): string {
  if (clave.trim() === '') {
    throw new Error(
      `${nombreVariable} no está configurada: la sesión con Auth central no puede operar sin ella.`,
    );
  }
  return clave;
}

/** Firma el token de sesión de este módulo. */
/**
 * Firma la sesión de este módulo.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA SESIÓN NO DURA MÁS QUE EL TOKEN DE AUTH, y eso es lo que hace `vencimientoAuth`.
 *
 * Sin ese tope, nuestra cookie duraba sus ocho horas pasara lo que pasara: si Auth
 * emitía un token de diez minutos —porque así lo decidiera esa política, o porque la
 * sesión del portal estuviera a punto de caducar—, este módulo seguía admitiendo a esa
 * persona durante casi ocho horas más. **La sesión sobrevivía a la credencial que la
 * originó.**
 *
 * Idea tomada del módulo de Instrucción, que integró Auth central con el mismo patrón y
 * ya lo acotaba. Ver instruccion-backend/src/modules/auth-central/application.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * @param vencimientoAuth Vencimiento del token de Auth, en segundos desde la época.
 *                        Nulo cuando Auth no lo declara: entonces rige solo el nuestro.
 */
export function firmarSesion(
  contenido: ContenidoSesion,
  vencimientoAuth: number | null = null,
): string {
  const clave = exigirClave(
    appConfig.sesion.secretoPropio,
    'SESSION_JWT_SECRET',
  );

  return jwt.sign({ ...contenido }, clave, {
    algorithm: ALGORITMO,
    expiresIn: vigenciaEfectiva(vencimientoAuth),
    issuer: appConfig.sesion.emisor,
    audience: appConfig.sesion.destinatario,
  });
}

/**
 * Verifica el token de sesión de este módulo.
 *
 * `algorithms` se fija explícitamente. Sin esa lista, un token con la cabecera
 * `alg: none` o firmado con otro algoritmo podría aceptarse: es el fallo clásico de las
 * bibliotecas de JWT, y cerrarlo cuesta una línea.
 */
export function verificarSesion(token: string): ContenidoSesion {
  const clave = exigirClave(
    appConfig.sesion.secretoPropio,
    'SESSION_JWT_SECRET',
  );

  // Emisor y destinatario se exigen SOLO en el token propio. El de Auth central no los
  // declara, y pedírselos rechazaría todas sus sesiones.
  const contenido = verificar(token, clave, {
    issuer: appConfig.sesion.emisor,
    audience: appConfig.sesion.destinatario,
  });

  const usuarioId = numero(contenido.usuarioId);
  const nombre = texto(contenido.nombre);
  const usuarioAuth = texto(contenido.usuarioAuth);

  // Se exige que sea un arreglo NO VACIO. Una sesion sin ningun rol no podria hacer nada,
  // y admitirla dejaria a esa persona dentro de la aplicacion sin entender por que todo
  // le responde 403. Se rechaza en el ingreso, que es donde el mensaje sirve.
  const roles = Array.isArray(contenido.roles)
    ? contenido.roles.filter(
        (r): r is string => typeof r === 'string' && r !== '',
      )
    : [];

  if (usuarioId === undefined || nombre === undefined || roles.length === 0) {
    throw new TokenInvalidoError('El token de sesión no trae la identidad.');
  }

  return {
    usuarioId,
    roles: roles as RolDepartamental[],
    nombre,
    funcionarioId: numero(contenido.funcionarioId) ?? null,
    usuarioAuth: usuarioAuth ?? '',
    // NO se exige: las cookies emitidas antes del 2026-08-21 no lo traen, y rechazarlas
    // devolvería al portal a todo el mundo por una funcionalidad que casi nadie usa. Su
    // ausencia la resuelve quien lo consume, con un mensaje que se entiende.
    tokenAuth: texto(contenido.tokenAuth) ?? null,
  };
}

/**
 * Verifica el token que devolvió Auth central en el canje.
 *
 * Comprueba, además de la firma y el vencimiento que hace `jwt.verify`:
 *
 *   1. `userId` presente y numérico. **Es lo único obligatorio.**
 *   2. `tokenType === 'session'`, SI el token lo declara. Auth emite también tokens de
 *      tipo `login`, que solo sirven para elegir subsistema y no acreditan una sesión.
 *   3. `subsystemId` coincide con el de este módulo, SI el token lo declara y el
 *      identificador está configurado. Sin esta comprobación, un `redirectCode` emitido
 *      para Timbre o IVs se canjearía contra el Cuadro de Colores.
 *
 * POR QUÉ LOS DOS ÚLTIMOS SON CONDICIONALES, Y NO ES UNA CONCESIÓN GRATUITA.
 *
 * El Auth desplegado en desarrollo —su API en el 10004, comprobado el 2026-08-17—
 * firma tokens de sesión con **solo tres reclamaciones**: `{userId, iat, exp}`. No trae
 * `tokenType`, ni `subsystemId`, ni `sessionId`, ni `roleIds`. El código de
 * `project_auth/auth` 1.6.5 sí las firma, así que **lo desplegado va por detrás del
 * repositorio**.
 *
 * Exigirlas dejaría la integración inservible contra el único Auth que hay hoy. Se
 * aceptan ausentes y **se advierte en el registro cada vez**, para que la carencia sea
 * visible y no se convierta en el estado normal:
 *
 *   - Sin `tokenType`, un token de login es indistinguible de uno de sesión. El riesgo
 *     es acotado, porque para obtener cualquiera de los dos hay que autenticarse antes.
 *   - Sin `subsystemId`, **la comprobación de §4.3 del plan no se puede hacer**: no hay
 *     forma de saber si el código se emitió para este módulo. Eso sí es una carencia
 *     real, y se cierra actualizando el Auth desplegado.
 */
export function verificarTokenDeAuth(token: string): ContenidoAuth {
  const clave = exigirClave(appConfig.sesion.secretoAuth, 'AUTH_JWT_SECRET');
  const contenido = verificar(token, clave);

  const userId = numero(contenido.userId);
  if (userId === undefined) {
    throw new TokenInvalidoError(
      'El token de Auth central no identifica al usuario.',
    );
  }

  const tipo = texto(contenido.tokenType);
  if (tipo === undefined) {
    registro.warn(
      'El token de Auth central no declara `tokenType`: no se puede distinguir una sesión de un token de login.',
    );
  } else if (tipo !== 'session') {
    throw new TokenInvalidoError(
      `Auth central devolvió un token de tipo «${tipo}», no una sesión.`,
    );
  }

  const subsystemId = numero(contenido.subsystemId);
  const esperado = appConfig.sesion.subsistemaIdAuth;
  if (subsystemId === undefined) {
    if (esperado !== 0) {
      registro.warn(
        `El token de Auth central no declara \`subsystemId\`: no se puede comprobar que la sesión sea del subsistema ${esperado}.`,
      );
    }
  } else if (esperado !== 0 && subsystemId !== esperado) {
    throw new TokenInvalidoError(
      `La sesión pertenece al subsistema ${subsystemId} y no al Cuadro de Colores.`,
    );
  }

  return {
    userId,
    exp: numero(contenido.exp) ?? null,
    tokenType: tipo ?? '',
    sessionId: texto(contenido.sessionId) ?? '',
    subsystemId: subsystemId ?? 0,
    roleIds: enteros(contenido.roleIds),
  };
}

/** Verifica firma y vencimiento, y devuelve el cuerpo siempre como objeto. */
function verificar(
  token: string,
  clave: string,
  opciones: jwt.VerifyOptions = {},
): JwtPayload {
  let contenido: string | JwtPayload;

  try {
    contenido = jwt.verify(token, clave, {
      algorithms: [ALGORITMO],
      ...opciones,
    });
  } catch (error) {
    throw new TokenInvalidoError(
      error instanceof Error ? error.message : 'Token ilegible.',
    );
  }

  if (typeof contenido === 'string') {
    throw new TokenInvalidoError('El token no contiene un cuerpo con datos.');
  }

  return contenido;
}

function numero(valor: unknown): number | undefined {
  return typeof valor === 'number' && Number.isFinite(valor)
    ? valor
    : undefined;
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

function enteros(valor: unknown): number[] {
  return Array.isArray(valor)
    ? valor.filter((item): item is number => typeof item === 'number')
    : [];
}
