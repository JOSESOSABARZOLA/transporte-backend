/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos adicionales · herencia del transporte del original
 * Archivo: herencia-transporte.puerto.ts
 * Responsabilidad: Puerto por el que `operativos` pide a `transporte` que el adicional herede el
 *                  conductor y el vehículo de su operativo original, sin depender de ese submódulo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-14
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ UN PUERTO CON REGISTRO, Y NO UNA INYECCIÓN DIRECTA. `transporte` ya depende de
 * `operativos` (`OperativosService.asignarTransporte`, CLAUDE.md §4). Que `operativos` importara
 * `TransporteModule` cerraría el ciclo y obligaría a `forwardRef` en los dos lados. El adicional
 * hereda creando TRAMOS ya asignados, y los tramos son de `transporte`; así que la dependencia se
 * invierte:
 *
 *   · `operativos` define QUÉ necesita (`HerenciaTransporte`) y publica este registro;
 *   · `transporte` lo IMPLEMENTA y se inscribe al iniciar su módulo (`onModuleInit`).
 *
 * Sin nadie inscrito —una prueba que solo levanta `operativos`— el adicional nace PENDIENTE, como
 * si el original no tuviera transporte. No es un error: es la ausencia del submódulo que decide.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';

import type { Autor } from './operativos.service';

/** Qué pasó con el transporte del adicional. */
export interface ResultadoHerencia {
  /** Al menos un tramo del adicional quedó con el conductor del original. */
  heredado: boolean;
  /**
   * Por qué no se heredó todo, en palabras del funcionario. `null` si se heredó completo o si no
   * había nada que heredar (el original no tenía transporte).
   */
  motivo: string | null;
}

/** Lo que `operativos` necesita de `transporte` para que un adicional herede. */
export interface HerenciaTransporte {
  heredar(
    datos: { padreId: number; adicionalId: number },
    autor: Autor,
  ): Promise<ResultadoHerencia>;
}

/** Registro donde `transporte` inscribe su implementación. Uno por aplicación. */
@Injectable()
export class RegistroHerenciaTransporte {
  private implementacion: HerenciaTransporte | null = null;

  registrar(implementacion: HerenciaTransporte): void {
    this.implementacion = implementacion;
  }

  /** La implementación inscrita, o `null` si `transporte` no está cargado. */
  obtener(): HerenciaTransporte | null {
    return this.implementacion;
  }
}
