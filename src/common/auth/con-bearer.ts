/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: con-bearer.ts
 * Responsabilidad: Componer la cabecera Authorization con el token de Auth central.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * Salió de `auth-usuarios.client.ts` el 2026-10-07: el cliente de Inspección reenvía el MISMO
 * token de Auth central, y los servicios del ecosistema lo rechazan igual si llega sin prefijo.
 */

/**
 * `Bearer <token>`. **EL PREFIJO NO ES OPCIONAL Y SU AUSENCIA NO SE PARECE A UN ERROR.**
 *
 * Comprobado contra el Auth desplegado el 2026-08-21:
 *
 * ```
 * sin cabecera      → 500 {"message":"Token no encontrado"}
 * Authorization: X  → 500 {"message":"Token no encontrado"}      ← indistinguible
 * Bearer X          → 500 {"message":"Token incorrecto o expirado"}
 * ```
 *
 * Es decir: un token **pelado se descarta como si no existiera**, y Auth contesta lo mismo
 * que a una petición anónima. La primera versión de este cliente lo enviaba así, copiando
 * al otro módulo del ecosistema que consume `/users` —que reenvía la cabecera entera del
 * navegador, y por eso ya trae el prefijo—, y el directorio salía vacío con un mensaje que
 * culpaba a la sesión del administrador.
 *
 * Se tolera que el token llegue ya prefijado para que reenviar una cabecera tal cual no
 * produzca `Bearer Bearer …`.
 */
export const conBearer = (token: string): string =>
  /^Bearer\s/i.test(token) ? token : `Bearer ${token}`;
