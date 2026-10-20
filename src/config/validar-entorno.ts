/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Configuración
 * Archivo: validar-entorno.ts
 * Responsabilidad: Detener el arranque cuando falta configuración crítica, en vez de
 *   arrancar con un secreto vacío que solo se nota cuando ya hay una sesión firmada mal.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-17
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DOS RASEROS DISTINTOS, Y LA DIFERENCIA IMPORTA.
 *
 * Hay variables que son NUESTRAS y siempre deben existir —la conexión a la base y la
 * clave con la que ESTE módulo firma su sesión—: si faltan o son débiles, arrancar es
 * peor que caerse, porque el módulo firmaría tokens con una clave vacía y nadie lo notaría
 * hasta que alguien los falsifique. Esas se comprueban con `errores`: detienen el arranque.
 *
 * Y hay variables de la INTEGRACIÓN con Auth central —su clave, el identificador del
 * subsistema— cuya etapa 1 sigue abierta: el propio `app.config.ts` explica que viven en
 * el entorno justamente porque todavía no están confirmadas. Detenerse por ellas rompería
 * el despliegue actual, así que se `advierten`, que es lo que `main.ts` ya hacía suelto por
 * `AUTH_SUBSYSTEM_ID`. Aquí se consolida.
 *
 * Los chequeos de producción (`CORS_ORIGINS`, cookie `Secure`) solo aplican cuando
 * `NODE_ENV=production` está declarado a propósito: en desarrollo sobre HTTP serían falsos
 * positivos. Ver docs/PLAN_INTEGRACION_AUTH.md §4.3.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { AppConfig } from './app.config';

export interface ResultadoValidacion {
  /** Impiden arrancar: configuración crítica ausente o insegura. */
  errores: string[];
  /** No impiden arrancar, pero conviene que consten en el registro. */
  advertencias: string[];
}

/**
 * Longitud mínima de la clave de sesión. Con 256 bits de entropía en base64 sobran; el
 * umbral descarta un `dev` o un `cambiar` olvidado, que es el fallo real que se busca.
 */
const MIN_SECRETO_SESION = 32;

export function validarEntorno(config: AppConfig): ResultadoValidacion {
  const errores: string[] = [];
  const advertencias: string[] = [];

  // ─── Siempre crítico, y bajo nuestro control ───
  if (!config.baseDatos.url) {
    errores.push(
      'DATABASE_URL: sin cadena de conexión; Prisma no puede abrir la base.',
    );
  }

  const secretoSesion = config.sesion.secretoPropio;
  if (!secretoSesion) {
    errores.push(
      'SESSION_JWT_SECRET: ausente; el módulo firmaría la sesión con una clave vacía y cualquiera podría falsificarla.',
    );
  } else if (secretoSesion.length < MIN_SECRETO_SESION) {
    errores.push(
      `SESSION_JWT_SECRET: demasiado corta (${secretoSesion.length} caracteres, mínimo ${MIN_SECRETO_SESION}).`,
    );
  }

  // TRUST_PROXY (2026-10-16): un valor que no es un entero de saltos detiene el arranque.
  // Adivinar uno sería peor: de más, el cliente elige su IP; de menos, todos comparten cupo.
  if (Number.isNaN(config.saltosProxy)) {
    errores.push(
      'TRUST_PROXY: debe ser un número entero de saltos (por ejemplo 2: Gateway y nginx del frontend), o quedar vacía.',
    );
  }

  // ─── Integración con Auth central: etapa 1 abierta, se avisa y no se detiene ───
  if (!config.sesion.secretoAuth) {
    advertencias.push(
      'AUTH_JWT_SECRET: sin clave de Auth central; el canje de sesión no podrá verificar sus tokens.',
    );
  }
  if (config.sesion.subsistemaIdAuth === 0) {
    advertencias.push(
      'AUTH_SUBSYSTEM_ID: sin configurar; no se comprueba a qué subsistema pertenece la sesión canjeada.',
    );
  }

  // ─── Producción, solo con NODE_ENV=production declarado ───
  if (config.produccion) {
    if (!(process.env.CORS_ORIGINS ?? '').trim()) {
      errores.push(
        'CORS_ORIGINS: obligatorio en producción; sin lista blanca el navegador descarta toda respuesta con credenciales.',
      );
    }
    if (!config.sesion.cookie.segura) {
      errores.push(
        'AUTH_COOKIE_SECURE: debe ser true en producción; sin la marca Secure la cookie de sesión viaja en claro.',
      );
    }
  }

  return { errores, advertencias };
}
