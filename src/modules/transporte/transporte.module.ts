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
 * | `talento-operativo` | `ElegibilidadService.evaluadorDeConduccion()` (POL-02: RN-44, RN-25) |
 * | `cuadro-diario` | `exigirEscritura()`, para no tocar una jornada cerrada |
 *
 * NO ESCRIBE `t_operativo` POR SU CUENTA. `FlotaRepository` toca `t_conductor`,
 * `t_vehiculo` y `t_disponibilidad`; la columna del operativo la escribe su dueño. Es lo
 * que hace verdadero el cuarto nivel de la restricción.
 */

import { Module } from '@nestjs/common';

import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { CuadroDiarioModule } from '../cuadro-diario/cuadro-diario.module';
import { OperativosModule } from '../operativos/operativos.module';
import { TalentoOperativoModule } from '../talento-operativo/talento-operativo.module';
import { CapacidadFlotaService } from './application/capacidad-flota.service';
import { FlotaService } from './application/flota.service';
import { DestinoVehiculoService } from './application/destino-vehiculo.service';
import { JornadaConductoresService } from './application/jornada-conductores.service';
import { MantenimientoVehiculoService } from './application/mantenimiento-vehiculo.service';
import { OperacionFlotaService } from './application/operacion-flota.service';
import { OptimizacionTransporteService } from './application/optimizacion-transporte.service';
import { ParametrosTransporteService } from './application/parametros-transporte.service';
import { PlanificacionTransporteService } from './application/planificacion-transporte.service';
import { TransporteService } from './application/transporte.service';
import { CargaInicialService } from './application/carga-inicial.service';
import { CargaInicialController } from './presentation/carga-inicial.controller';
import { TrasladosService } from './application/traslados.service';
import { TurnosConductoresService } from './application/turnos-conductores.service';
import { CapacidadFlotaRepository } from './infrastructure/capacidad-flota.repository';
import { FlotaRepository } from './infrastructure/flota.repository';
import { OperacionFlotaRepository } from './infrastructure/operacion-flota.repository';
import { PlanificacionTransporteRepository } from './infrastructure/planificacion-transporte.repository';
import { PreparacionTransporteService } from './application/preparacion-transporte.service';
import { HerenciaTransporteService } from './application/herencia-transporte.service';
import { CompatibilidadCompartirService } from './application/compatibilidad-compartir.service';
import { JornadaDafService } from './application/jornada-daf.service';
import { JornadaDafRepository } from './infrastructure/jornada-daf.repository';
import { JornadaDafController } from './presentation/jornada-daf.controller';
import { PreparacionTransporteController } from './presentation/preparacion-transporte.controller';
import { MantenimientoSemanaController } from './presentation/mantenimiento-semana.controller';
import { AdministracionFlotaController } from './presentation/administracion-flota.controller';
import { AusenciasConductorController } from './presentation/ausencias-conductor.controller';
import { AusenciasConductorService } from './application/ausencias-conductor.service';
import { AusenciasConductorRepository } from './infrastructure/ausencias-conductor.repository';
import { MantenimientoVehiculoController } from './presentation/mantenimiento-vehiculo.controller';
import { CapacidadFlotaController } from './presentation/capacidad-flota.controller';
import { OperacionFlotaController } from './presentation/operacion-flota.controller';
import { OptimizacionTransporteController } from './presentation/optimizacion-transporte.controller';
import { PlanificacionTransporteController } from './presentation/planificacion-transporte.controller';
import { TransporteController } from './presentation/transporte.controller';
import { TurnosConductoresController } from './presentation/turnos-conductores.controller';

@Module({
  imports: [
    OperativosModule,
    TalentoOperativoModule,
    CuadroDiarioModule,
    ConfiguracionModule,
  ],
  controllers: [
    TransporteController,
    CapacidadFlotaController,
    // Antes que AdministracionFlotaController: `conductores/ausencias` (2026-10-16).
    AusenciasConductorController,
    AdministracionFlotaController,
    MantenimientoVehiculoController,
    PlanificacionTransporteController,
    TurnosConductoresController,
    OptimizacionTransporteController,
    OperacionFlotaController,
    PreparacionTransporteController,
    MantenimientoSemanaController,
    JornadaDafController,
    CargaInicialController,
  ],
  providers: [
    TransporteService,
    FlotaService,
    CapacidadFlotaService,
    MantenimientoVehiculoService,
    AusenciasConductorService,
    AusenciasConductorRepository,
    DestinoVehiculoService,
    JornadaConductoresService,
    FlotaRepository,
    CapacidadFlotaRepository,
    PlanificacionTransporteRepository,
    ParametrosTransporteService,
    PlanificacionTransporteService,
    TrasladosService,
    TurnosConductoresService,
    OptimizacionTransporteService,
    OperacionFlotaService,
    OperacionFlotaRepository,
    PreparacionTransporteService,
    CargaInicialService,
    JornadaDafService,
    JornadaDafRepository,
    // Inscribe en `operativos` la herencia del transporte del adicional (2026-10-14).
    HerenciaTransporteService,
    // Y la regla de compartir unidad que pregunta el registro (2026-10-19).
    CompatibilidadCompartirService,
  ],
  /** Lo consumirá M-24 (matriz consolidada) para la cabecera de P-04. */
  exports: [TransporteService, FlotaService, CapacidadFlotaService],
})
export class TransporteModule {}
