/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Documentos
 * Archivo: documentos.module.ts
 * Responsabilidad: Componer el submódulo de entregables y publicar su servicio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * CTX-04 · Documentación Operativa. Produce lo que sale del sistema: la matriz para la
 * Dirección (M-19) y las órdenes de servicio individuales (M-20).
 *
 * IMPORTA TRES SUBMÓDULOS, todos por servicio publicado:
 *
 * | Módulo | Para qué |
 * |---|---|
 * | `cuadro-diario` | `obtenerPorFecha()`, para la cabecera y para exigir que la jornada exista |
 * | `configuracion` | `VentanaCargaService`, que dice si la ventana de un formulario vacío ya venció (RN-53) |
 * | `transporte` | `CapacidadFlotaService`, para el indicador de flota de la cabecera |
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DESDE EL 2026-08-26 PUBLICA DOS VISTAS DE LA JORNADA, Y NO COMPARTEN NADA.
 *
 * `MatrizConsolidadaService` es la del Director: los nueve formularios, exportable y con
 * el cierre. `JornadaService` es la de DMIT Instrucción: los mismos nueve en pantalla, el
 * personal editable solo donde su rol participa, **sin exportación y sin cierre**.
 *
 * Tienen repositorio y DTO propios a propósito. Son dos pantallas con modelos de permiso
 * distintos, y compartir sus piezas significaría que un cambio pedido por un perfil llega
 * al otro sin que nadie lo decida. Lo único que comparten es `reglas-matriz.ts`, que son
 * reglas de dominio: duplicarlas daría dos versiones de la misma norma.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Y TIENE REPOSITORIO PROPIO, de solo lectura. Es lo que el plan pide para M-19 y lo que
 * el caso 7 exige: la matriz se compone en tres consultas, y pedir los datos pieza por
 * pieza a otros submódulos produciría los cientos de consultas que se quieren evitar.
 */

import { Module } from '@nestjs/common';

import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { CuadroDiarioModule } from '../cuadro-diario/cuadro-diario.module';
import { TransporteModule } from '../transporte/transporte.module';
import { JornadaService } from './application/jornada.service';
import { MatrizConsolidadaService } from './application/matriz-consolidada.service';
import { OrdenServicioService } from './application/orden-servicio.service';
import { FirmaDigitalClient } from './infrastructure/firma-digital.client';
import { JornadaRepository } from './infrastructure/jornada.repository';
import { MatrizRepository } from './infrastructure/matriz.repository';
import { JornadaController } from './presentation/jornada.controller';
import { MatrizController } from './presentation/matriz.controller';
import { DirectorGuard } from './presentation/director.guard';
import { OrdenesServicioController } from './presentation/ordenes-servicio.controller';
import { OrdenServicioRepository } from './infrastructure/orden-servicio.repository';

@Module({
  imports: [CuadroDiarioModule, ConfiguracionModule, TransporteModule],
  controllers: [MatrizController, JornadaController, OrdenesServicioController],
  providers: [
    MatrizConsolidadaService,
    JornadaService,
    OrdenServicioService,
    // Rol DIRECTOR además del permiso en los endpoints de la Dirección (2026-10-05).
    DirectorGuard,
    MatrizRepository,
    JornadaRepository,
    OrdenServicioRepository,
    FirmaDigitalClient,
  ],
  /**
   * Lo consumirán las pantallas de M-25 y M-26.
   *
   * `JornadaService` NO se exporta: solo lo usa su controlador, y publicarlo invitaría a
   * componer la jornada desde otro submódulo saltándose el `@Roles` de la ruta, que es
   * donde vive el control de acceso de esta vista.
   */
  exports: [MatrizConsolidadaService, OrdenServicioService],
})
export class DocumentosModule {}
