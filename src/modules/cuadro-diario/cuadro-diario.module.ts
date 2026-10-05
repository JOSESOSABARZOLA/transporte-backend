/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Cuadro diario
 * Archivo: cuadro-diario.module.ts
 * Responsabilidad: Componer el submódulo de la jornada y publicar su servicio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * CTX-01 · Planificación Operativa, primera mitad. Gobierna el ciclo de vida de la
 * jornada; los operativos llegan en M-14 y **no cuelgan de este agregado** (HAL-02).
 *
 * IMPORTA DOS SUBMÓDULOS, ambos por servicio publicado:
 *
 * | Módulo | Para qué |
 * |---|---|
 * | `configuracion` | `VentanaCargaService`, que dice si la carga o el transporte siguen abiertos |
 * | `talento-operativo` | `HistorialJornadaService`, que consolida la jornada al cerrarse |
 *
 * Ninguno de los dos sabe que este submódulo existe: la dependencia va en un solo
 * sentido y no hay ciclo.
 */

import { Module } from '@nestjs/common';

import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { TalentoOperativoModule } from '../talento-operativo/talento-operativo.module';
import { CuadroDiarioService } from './application/cuadro-diario.service';
import { CuadroDiarioRepository } from './infrastructure/cuadro-diario.repository';
import { CuadrosController } from './presentation/cuadros.controller';

@Module({
  imports: [ConfiguracionModule, TalentoOperativoModule],
  controllers: [CuadrosController],
  providers: [CuadroDiarioService, CuadroDiarioRepository],
  /** Lo consumirá `operativos` (M-14) para saber si la jornada admite escritura. */
  exports: [CuadroDiarioService],
})
export class CuadroDiarioModule {}
