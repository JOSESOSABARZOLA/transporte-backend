/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: operativos.module.ts
 * Responsabilidad: Componer el núcleo del cuadro y publicar su servicio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * CTX-01 · Planificación Operativa, segunda mitad. El cuadro gobierna el ciclo de vida
 * de la jornada (M-13) y aquí viven los operativos, que **no cuelgan de ese agregado**
 * (HAL-02): tres departamentos escriben en paralelo y competirían por la misma fila.
 *
 * IMPORTA DOS SUBMÓDULOS, ambos por servicio publicado:
 *
 * | Módulo | Para qué |
 * |---|---|
 * | `configuracion` | `FormulariosService`, `CatalogosService` y `ParametroPoliticaService` |
 * | `cuadro-diario` | `CuadroDiarioService.exigirEscritura()`, que dice si la jornada admite cambios |
 * | `talento-operativo` | `FuncionariosService` y `ElegibilidadService`, desde M-15 |
 *
 * DE `talento-operativo` LLEGA UN VEREDICTO, NO UNA REGLA. `ElegibilidadService` dice si
 * la persona puede salir y por qué; los antecedentes con los que lo decidió no cruzan la
 * frontera. Sin acceso a ellos, este submódulo no puede reimplementar el descanso aunque
 * quisiera, que es justamente el propósito de la regla 1 de CLAUDE.md.
 */

import { Module } from '@nestjs/common';

import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { CuadroDiarioModule } from '../cuadro-diario/cuadro-diario.module';
import { TalentoOperativoModule } from '../talento-operativo/talento-operativo.module';
import { CalculadorAlertasService } from './application/calculador-alertas.service';
import { RegistroCompatibilidadCompartir } from './application/compartir-transporte.puerto';
import { GeneradorIdentificadorService } from './application/generador-identificador.service';
import { RegistroHerenciaTransporte } from './application/herencia-transporte.puerto';
import { OperativosService } from './application/operativos.service';
import { SolicitudApoyoService } from './application/solicitud-apoyo.service';
import { TramitesInspeccionService } from './application/tramites-inspeccion.service';
import { AsignacionPersonalRepository } from './infrastructure/asignacion-personal.repository';
import { InspeccionTramitesClient } from './infrastructure/inspeccion-tramites.client';
import { OperativosRepository } from './infrastructure/operativos.repository';
import { SolicitudApoyoRepository } from './infrastructure/solicitud-apoyo.repository';
import { AdicionalesController } from './presentation/adicionales.controller';
import { OperativosController } from './presentation/operativos.controller';
import { SolicitudesApoyoController } from './presentation/solicitudes-apoyo.controller';
import { TramitesInspeccionController } from './presentation/tramites-inspeccion.controller';

@Module({
  imports: [ConfiguracionModule, CuadroDiarioModule, TalentoOperativoModule],
  /**
   * `AdicionalesController` comparte la ruta `operativos` con el primero y está aparte a
   * propósito: es el único que **no declara `VentanaCargaGuard`**, y esa excepción debe
   * verse en la firma de una clase y no esconderse en un decorador. Ver su cabecera.
   */
  controllers: [
    OperativosController,
    AdicionalesController,
    SolicitudesApoyoController,
    TramitesInspeccionController,
  ],
  providers: [
    OperativosService,
    GeneradorIdentificadorService,
    CalculadorAlertasService,
    SolicitudApoyoService,
    TramitesInspeccionService,
    RegistroHerenciaTransporte,
    RegistroCompatibilidadCompartir,
    InspeccionTramitesClient,
    OperativosRepository,
    AsignacionPersonalRepository,
    SolicitudApoyoRepository,
  ],
  /**
   * Lo consumirán M-15, M-17 y M-19 para asignar personal, transporte y apoyo.
   * `RegistroHerenciaTransporte`: `transporte` inscribe ahí la herencia del adicional (2026-10-14).
   * `RegistroCompatibilidadCompartir`: y ahí la regla de compartir unidad (2026-10-19).
   */
  exports: [
    OperativosService,
    SolicitudApoyoService,
    RegistroHerenciaTransporte,
    RegistroCompatibilidadCompartir,
  ],
})
export class OperativosModule {}
