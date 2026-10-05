/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Módulo raíz
 * Archivo: app.module.ts
 * Responsabilidad: Componer los módulos del Cuadro de Colores Operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-04
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { appConfig } from './config/app.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SaludRepository } from './common/salud/salud.repository';
import { AuthModule } from './common/auth/auth.module';
import { CommonModule } from './common/common.module';
import { ConfiguracionModule } from './modules/configuracion/configuracion.module';
import { CuadroDiarioModule } from './modules/cuadro-diario/cuadro-diario.module';
import { DocumentosModule } from './modules/documentos/documentos.module';
import { IdentidadModule } from './modules/identidad/identidad.module';
import { OperativosModule } from './modules/operativos/operativos.module';
import { TalentoOperativoModule } from './modules/talento-operativo/talento-operativo.module';
import { TransporteModule } from './modules/transporte/transporte.module';
import { PrismaModule } from './prisma/prisma.module';

// Los seis submódulos de docs/IMPLEMENTATION_GUIDE.md §6 están registrados. Las órdenes
// de servicio (M-20) se incorporan dentro de `DocumentosModule`.
//
// `IdentidadModule` es el séptimo y no es de negocio: sostiene el ingreso al sistema con
// Auth central. Va antes que los seis porque los precede a todos.
// Ver docs/PLAN_INTEGRACION_AUTH.md.
@Module({
  imports: [
    /**
     * Límite de peticiones por origen.
     *
     * **ES LA ÚNICA GUARDA GLOBAL DEL SISTEMA, y no contradice a `auth.module.ts`.**
     * Allí se explica por qué las cuatro guardas de autorización NO son globales: la
     * cadena no es la misma en todos los endpoints, y registrarlas globalmente
     * obligaría a excluir uno por uno, donde una exclusión olvidada es un agujero
     * silencioso.
     *
     * Con el límite el razonamiento se invierte. Se aplica igual a todo, así que no hay
     * cadena que componer; y lo que se olvida no es una exclusión sino una inclusión:
     * un endpoint sin límite queda desprotegido sin que nada avise. Global por omisión
     * y `@SkipThrottle` donde estorbe —hoy solo el punto de salud— es lo seguro.
     *
     * EL CUPO ES POR ENDPOINT Y POR ORIGEN, no uno solo por origen. Comprobado contra el
     * servicio en marcha: agotar `/zonales` no impide llamar a `/formularios/permitidos`,
     * que tiene el suyo. La consecuencia hay que tenerla presente —el techo real de un
     * origen es el máximo multiplicado por el número de endpoints— y es deliberada:
     * protege a cada endpoint de que lo martilleen sin que una ráfaga en uno deje al
     * funcionario sin poder usar el resto de la aplicación.
     *
     * AVISO PARA EL DESPLIEGUE. El origen se toma de la dirección de red. Si algún día
     * el backend queda detrás de un proxy inverso, TODAS las peticiones llegarán con la
     * dirección del proxy y compartirán cupo: el primer usuario activo dejaría fuera a
     * los demás. Entonces hay que habilitar la confianza en el proxy.
     */
    ThrottlerModule.forRoot([
      {
        ttl: appConfig.limitePeticiones.ventanaMs,
        limit: appConfig.limitePeticiones.maximo,
      },
    ]),
    PrismaModule,
    CommonModule,
    AuthModule,
    IdentidadModule,
    ConfiguracionModule,
    TalentoOperativoModule,
    CuadroDiarioModule,
    OperativosModule,
    TransporteModule,
    DocumentosModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SaludRepository,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
