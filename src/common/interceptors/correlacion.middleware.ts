/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Trazabilidad
 * Archivo: correlacion.middleware.ts
 * Responsabilidad: Establecer el identificador de correlación de la petición y
 *                  devolverlo en la respuesta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * El identificador se genera en el frontend y viaja en la cabecera x-correlation-id.
 * Si no llega, se genera aquí. Se propaga por todos los registros del backend y se
 * devuelve en las respuestas, incluidas las de error, de modo que una petición se
 * puede reconstruir desde el clic del usuario hasta la consulta a la base.
 * Ver docs/FASE4-arquitectura-tecnica.md §12.3.
 *
 * POR QUÉ MIDDLEWARE Y NO INTERCEPTOR. Se implementó primero como interceptor, como
 * nombra el plan, y las pruebas de ejecución mostraron dos fallos:
 *
 *   1. AsyncLocalStorage NO sobrevive al límite de RxJS. Un interceptor devuelve el
 *      Observable, y Nest se suscribe a él FUERA del `run()`, de modo que el contexto
 *      se pierde antes de que el controlador se ejecute. El registro salía sin
 *      correlación.
 *   2. Los interceptores solo corren en rutas emparejadas. Un 404 de ruta inexistente
 *      no pasaba por él, y su respuesta de error salía sin correlación, que es
 *      justamente cuando más falta hace para dar soporte.
 *
 * Un middleware de Express se ejecuta antes del enrutador y para TODA petición, y
 * `next()` invocado dentro del `run()` propaga el contexto a la cadena completa.
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { ejecutarConContexto } from '../contexto/contexto-peticion';

export const CABECERA_CORRELACION = 'x-correlation-id';

/**
 * Forma admisible del identificador que llega del cliente.
 *
 * SE VALIDA, no se acepta tal cual, por tres motivos concretos:
 *
 *   1. `audi_correlacion` es `VARCHAR(60)`. Un identificador más largo hace fallar la
 *      inserción de la auditoría, y con ella la transacción completa: una cabecera mal
 *      formada del cliente rompería toda escritura auditada.
 *   2. El valor se devuelve como cabecera de respuesta. Con caracteres de control,
 *      `setHeader` lanza y la petición muere con un 500 sin explicación útil.
 *   3. Aparece en cada línea del registro. Restringir el alfabeto evita que un valor
 *      arbitrario ensucie la traza que sirve para dar soporte.
 *
 * Un identificador que no cumple no se rechaza: se sustituye por uno generado aquí.
 * La petición es legítima; lo dudoso es la cabecera, y perder la correlación es peor
 * que perder el valor que propuso el cliente.
 */
const FORMATO_CORRELACION = /^[A-Za-z0-9._:-]{8,60}$/;

/** Middleware de correlación. Se registra con `app.use()` antes de todo lo demás. */
export function correlacionMiddleware(
  peticion: Request,
  respuesta: Response,
  siguiente: NextFunction,
): void {
  const recibido = peticion.headers[CABECERA_CORRELACION];
  const propuesto = Array.isArray(recibido) ? recibido[0] : recibido;
  const correlacionId =
    propuesto && FORMATO_CORRELACION.test(propuesto) ? propuesto : randomUUID();

  respuesta.setHeader(CABECERA_CORRELACION, correlacionId);

  ejecutarConContexto(
    {
      correlacionId,
      metodo: peticion.method,
      ruta: peticion.originalUrl,
    },
    () => {
      siguiente();
    },
  );
}
