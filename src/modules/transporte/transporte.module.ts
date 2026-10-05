/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: transporte.module.ts
 * Responsabilidad: Componer el submódulo logístico y publicar su servicio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * CTX-02 · Logística de Transporte. **Su responsabilidad son dos campos** de los nueve
 * formularios, y esa estrechez es deliberada: el análisis la señaló como la garantía de
 * que la DAF no vuelva a tocar el resto del operativo.
 *
 * IMPORTA TRES SUBMÓDULOS, todos por servicio publicado:
 *
 * | Módulo | Para qué |
 * |---|---|
 * | `operativos` | `consultarPendientesDeTransporte()` y `asignarTransporte()`, que es el contrato declarado en CLAUDE.md §4 |
 * | `talento-operativo` | `ElegibilidadService.verificarConductor()` (POL-02) |
 * | `cuadro-diario` | `exigirEscritura()`, para no tocar una jornada cerrada |
 *
 * NO ESCRIBE `t_operativo` POR SU CUENTA. `FlotaRepository` toca `t_conductor`,
 * `t_vehiculo` y `t_disponibilidad`; la columna del operativo la escribe su dueño. Es lo
 * que hace verdadero el cuarto nivel de la restricción.
 */

import { Module } from '@nestjs/common';

import { CuadroDiarioModule } from '../cuadro-diario/cuadro-diario.module';
import { OperativosModule } from '../operativos/operativos.module';
import { TalentoOperativoModule } from '../talento-operativo/talento-operativo.module';
import { CapacidadFlotaService } from './application/capacidad-flota.service';
import { FlotaService } from './application/flota.service';
import { DestinoVehiculoService } from './application/destino-vehiculo.service';
import { JornadaConductoresService } from './application/jornada-conductores.service';
import { MantenimientoVehiculoService } from './application/mantenimiento-vehiculo.service';
import { TransporteService } from './application/transporte.service';
import { CapacidadFlotaRepository } from './infrastructure/capacidad-flota.repository';
import { FlotaRepository } from './infrastructure/flota.repository';
import { AdministracionFlotaController } from './presentation/administracion-flota.controller';
import { MantenimientoVehiculoController } from './presentation/mantenimiento-vehiculo.controller';
import { CapacidadFlotaController } from './presentation/capacidad-flota.controller';
import { TransporteController } from './presentation/transporte.controller';

@Module({
  imports: [OperativosModule, TalentoOperativoModule, CuadroDiarioModule],
  controllers: [
    TransporteController,
    CapacidadFlotaController,
    AdministracionFlotaController,
    MantenimientoVehiculoController,
  ],
  providers: [
    TransporteService,
    FlotaService,
    CapacidadFlotaService,
    MantenimientoVehiculoService,
    DestinoVehiculoService,
    JornadaConductoresService,
    FlotaRepository,
    CapacidadFlotaRepository,
  ],
  /** Lo consumirá M-24 (matriz consolidada) para la cabecera de P-04. */
  exports: [TransporteService, FlotaService, CapacidadFlotaService],
})
export class TransporteModule {}
