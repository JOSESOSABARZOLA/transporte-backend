/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Estado del servicio
 * Archivo: salud.repository.ts
 * Responsabilidad: Comprobar que la base responde, para el punto de salud.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-17
 *
 * ES UN REPOSITORIO Y NO UNA LLAMADA DESDE `AppService`, aunque solo haga una consulta.
 * La regla dice que **únicamente la capa de infraestructura toca `PrismaService`**, y
 * saltársela «porque es una línea» es como se erosionan las reglas. Ver
 * docs/IMPLEMENTATION_GUIDE.md §13.3.
 *
 * `$queryRaw` con plantilla etiquetada es parametrizado y está permitido; lo prohibido
 * es `$queryRawUnsafe`. La consulta no lee ninguna tabla a propósito: comprobar la
 * salud no debe depender de que exista un dato concreto.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Espera máxima de la comprobación, en milisegundos.
 *
 * Sin este límite, una base que acepta la conexión pero no responde deja la petición
 * colgada: el contenedor acabaría marcándose enfermo por tiempo agotado, pero quien
 * consulte el punto de salud a mano se queda esperando sin explicación. Con él la
 * respuesta llega siempre, y dice qué pasa.
 */
const ESPERA_MAXIMA_MS = 2000;

@Injectable()
export class SaludRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `true` si la base acepta y responde una consulta trivial dentro del plazo. */
  async baseResponde(): Promise<boolean> {
    let temporizador: NodeJS.Timeout | undefined;

    const plazo = new Promise<false>((resolver) => {
      temporizador = setTimeout(() => resolver(false), ESPERA_MAXIMA_MS);
    });

    try {
      const consulta = this.prisma.$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false);

      return await Promise.race([consulta, plazo]);
    } finally {
      // El temporizador se cancela SIEMPRE: si la consulta gana la carrera y queda
      // pendiente, mantiene vivo el bucle de eventos y el proceso no termina al apagar.
      if (temporizador) clearTimeout(temporizador);
    }
  }
}
