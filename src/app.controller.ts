/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Estado del servicio
 * Archivo: app.controller.ts
 * Responsabilidad: Exponer el punto de comprobación de salud del servicio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-04 · estado degradado agregado el 2026-08-17
 */

import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { AppService, type EstadoDelServicio } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Punto de comprobación de salud. **Público y sin guardas**, a propósito: lo consulta
   * Docker desde dentro del contenedor, antes de que exista ninguna sesión.
   *
   * DEVUELVE 503 CUANDO LA BASE NO RESPONDE, y ahí está el cambio: es lo que convierte
   * esto en una comprobación de verdad. Un punto de salud que siempre responde 200 no
   * informa de nada, y el `healthcheck` del compose solo mira el código de estado.
   *
   * SE FIJA EL ESTADO CON `@Res({ passthrough: true })` EN LUGAR DE LANZAR. Una
   * excepción pasaría por `AllExceptionsFilter`, que para los códigos 5xx sustituye el
   * detalle por el mensaje genérico —correcto para no filtrar interioridades al
   * funcionario, inútil para quien diagnostica—. Así el cuerpo conserva qué falla.
   *
   * `@SkipThrottle` porque Docker lo consulta cada pocos segundos desde la misma
   * dirección: con el límite general aplicado, la comprobación acabaría estrangulándose
   * a sí misma y el contenedor se declararía enfermo estando sano.
   */
  @Get('estado')
  @SkipThrottle()
  async obtenerEstado(
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<EstadoDelServicio> {
    const estado = await this.appService.obtenerEstado();

    respuesta.status(
      estado.estado === 'operativo'
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE,
    );

    return estado;
  }
}
