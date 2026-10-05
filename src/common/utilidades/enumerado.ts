/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Utilidades transversales
 * Archivo: enumerado.ts
 * Responsabilidad: Interpretar valores de enumerado que llegan por la ruta o la consulta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * POR QUÉ EXISTE. Los parámetros de ruta y de consulta llegan como texto y no pasan por
 * el `ValidationPipe`, que solo mira el cuerpo. Sin comprobarlos, un valor cualquiera
 * viaja hasta Prisma y sale como error no controlado.
 *
 * Había dos versiones de esto —una para el rol de las ventanas y otra para los filtros
 * del maestro de personal— con mensajes distintos para el mismo problema. Ahora el
 * funcionario lee siempre la misma frase, y esa frase ENUMERA LOS VALORES VÁLIDOS:
 * quien filtra necesita saber qué puede pedir, no solo que se equivocó.
 */

import { ValidacionError } from '../errors/errores-dominio';

/**
 * Comprueba que el texto sea uno de los valores del enumerado.
 * @param nombre cómo se llama el dato en la interfaz, para el mensaje de error
 * @throws ValidacionError enumerando los valores admitidos
 */
export function exigirEnumerado<T extends Record<string, string>>(
  valor: string,
  enumerado: T,
  nombre: string,
): T[keyof T] {
  const valores = Object.values(enumerado);

  if (!valores.includes(valor)) {
    throw new ValidacionError(
      `«${valor}» no es un valor admitido para ${nombre}. Los valores son: ${valores.join(', ')}.`,
      { valorRecibido: valor, nombre },
    );
  }

  return valor as T[keyof T];
}

/** Igual que el anterior, pero admite la ausencia del dato. Para filtros opcionales. */
export function interpretarEnumerado<T extends Record<string, string>>(
  valor: string | undefined,
  enumerado: T,
  nombre: string,
): T[keyof T] | undefined {
  if (valor === undefined || valor === '') return undefined;
  return exigirEnumerado(valor, enumerado, nombre);
}
