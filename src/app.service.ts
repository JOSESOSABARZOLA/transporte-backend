/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Estado del servicio
 * Archivo: app.service.ts
 * Responsabilidad: Resolver la respuesta del punto de comprobación del servicio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-04 · comprobación de la base agregada el 2026-08-17
 *
 * ANTES DEVOLVÍA UN OBJETO FIJO, y esa era su falla: el `healthcheck` de
 * `docker-compose.yml` consulta este punto, de modo que `transporte-app` figuraba como
 * «healthy» **con PostgreSQL caído**, y el frontend —que espera a que esté sano— se
 * levantaba contra un backend incapaz de servir nada.
 *
 * Es la otra mitad del problema que M-30 ya había atacado: sin comprobación, el
 * contenedor figuraba «Up» desde el primer instante aunque Nest no hubiera arrancado.
 * Resolvía el arranque, no la dependencia.
 *
 * QUÉ SE COMPRUEBA Y QUÉ NO. Solo la base, porque es la única dependencia sin la cual
 * este servicio no puede responder nada útil. No se comprueba Auth central: el módulo
 * funciona con las sesiones ya emitidas aunque el portal esté caído, y marcarse enfermo
 * por una dependencia ajena provocaría reinicios en cascada.
 */

import { Injectable } from '@nestjs/common';

import { SaludRepository } from './common/salud/salud.repository';

export interface EstadoDelServicio {
  servicio: string;
  /** `operativo` si puede atender; `degradado` si la base no responde. */
  estado: 'operativo' | 'degradado';
  baseDatos: 'disponible' | 'no disponible';
}

@Injectable()
export class AppService {
  constructor(private readonly salud: SaludRepository) {}

  async obtenerEstado(): Promise<EstadoDelServicio> {
    const disponible = await this.salud.baseResponde();

    return {
      servicio: 'transporte-backend',
      estado: disponible ? 'operativo' : 'degradado',
      baseDatos: disponible ? 'disponible' : 'no disponible',
    };
  }
}
