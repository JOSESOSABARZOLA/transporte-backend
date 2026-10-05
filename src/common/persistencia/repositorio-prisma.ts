/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Acceso a datos
 * Archivo: repositorio-prisma.ts
 * Responsabilidad: Dar a los repositorios el cliente y la apertura de transacciones.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * POR QUÉ EXISTE. `ejecutarEnTransaccion` estaba escrito CINCO veces, palabra por
 * palabra, en los repositorios de parámetros, catálogos, ventanas, funcionarios y
 * disponibilidad. Cada copia era idéntica y cada una podía divergir: bastaba con que
 * alguien añadiera un nivel de aislamiento o un tiempo máximo en una sola de ellas
 * para que dos escrituras del sistema se comportaran distinto sin motivo.
 *
 * POR QUÉ HERENCIA Y NO UNA UNIDAD DE TRABAJO INYECTADA. Una unidad de trabajo
 * inyectada en los SERVICIOS sería la forma canónica, pero obligaría a cambiar el
 * constructor de nueve servicios y de todos sus dobles de prueba, sin ganar nada: la
 * transacción se abre igual y donde mismo. Esta clase conserva el contrato que los
 * servicios ya usan —`repositorio.ejecutarEnTransaccion(...)`— y borra la
 * duplicación. Si algún día un servicio necesita abarcar VARIOS repositorios en una
 * transacción, esa sí es la señal para extraer la unidad de trabajo.
 *
 * REGLA QUE NO CAMBIA: solo la capa `infrastructure` hereda de aquí. Un servicio de
 * aplicación que extendiera esta clase estaría tocando PrismaService, que es
 * exactamente lo que la arquitectura prohíbe. Ver docs/IMPLEMENTATION_GUIDE.md §13.3.
 */

import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/** Espera máxima por una conexión libre del pool, en milisegundos. */
const ESPERA_MAXIMA_MS = 5_000;

/** Duración máxima de una transacción antes de que Prisma la aborte, en milisegundos. */
const DURACION_MAXIMA_MS = 20_000;

export abstract class RepositorioPrisma {
  protected constructor(protected readonly prisma: PrismaService) {}

  /**
   * Ejecuta la operación dentro de una transacción.
   *
   * La auditoría se escribe DENTRO, con el cliente que recibe la operación: una
   * evidencia que puede perderse ante un fallo parcial no sirve como evidencia (DA-09).
   *
   * LOS DOS TIEMPOS SE FIJAN AQUÍ, Y NO SE DEJAN POR DEFECTO. Prisma aplica `maxWait`
   * de 2 s y `timeout` de 5 s si no se dicen, y cinco segundos se quedan cortos para
   * este sistema: **toda escritura multitabla lleva la auditoría dentro**, así que las
   * transacciones son más largas que la media. Con datos reales, un `P2028` abortaría
   * una escritura válida y el funcionario vería un error que no sabría reproducir.
   *
   * Veinte segundos son holgados sin ser indefinidos: el tope existe para que una
   * transacción atascada no retenga sus bloqueos, no para acotar el trabajo normal. El
   * seguro del lado del servidor —`idle_in_transaction_session_timeout`— está en
   * `docker-compose.yml` y cubre el caso en que la aplicación muera sin cerrar.
   */
  async ejecutarEnTransaccion<T>(
    operacion: (cliente: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(operacion, {
      maxWait: ESPERA_MAXIMA_MS,
      timeout: DURACION_MAXIMA_MS,
    });
  }
}
