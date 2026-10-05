/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Configuración institucional
 * Archivo: configuracion.module.ts
 * Responsabilidad: Componer el submódulo de configuración y publicar sus servicios.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * CTX-05 · Configuración Institucional. Define el marco normativo del cuadro para
 * que se modifique sin intervención técnica.
 *
 * Los servicios se EXPORTAN porque otros submódulos los consumen por servicio
 * publicado, nunca por su repositorio:
 *
 * | Servicio | Quién lo consume |
 * |---|---|
 * | `ParametroPoliticaService` | `talento-operativo` (M-12) y las ventanas (M-08) |
 * | `FormulariosService` | `operativos` (M-14) para la definición del formulario |
 * | `CatalogosService` | `operativos` (M-14) para validar punto, tipo e institución |
 * | `VentanaCargaService` | `cuadro-diario` (M-13) para saber si el cuadro admite cambios |
 */

import { Module } from '@nestjs/common';

import { CatalogosService } from './application/catalogos.service';
import { RolesAuthService } from './application/roles-auth.service';
import { AreasFormularioService } from './application/areas-formulario.service';
import { FormulariosAdminService } from './application/formularios-admin.service';
import { FormulariosService } from './application/formularios.service';
import { ParametroPoliticaService } from './application/parametro-politica.service';
import { PermisosAdminService } from './application/permisos-admin.service';
import { VentanaCargaService } from './application/ventana-carga.service';
import { CatalogosRepository } from './infrastructure/catalogos.repository';
import { RolesAuthRepository } from './infrastructure/roles-auth.repository';
import { FormulariosRepository } from './infrastructure/formularios.repository';
import { ParametroPoliticaRepository } from './infrastructure/parametro-politica.repository';
import { VentanasRepository } from './infrastructure/ventanas.repository';
import { AdministracionAreasController } from './presentation/administracion-areas.controller';
import { AdministracionCatalogosController } from './presentation/administracion-catalogos.controller';
import { AdministracionFormulariosController } from './presentation/administracion-formularios.controller';
import { AdministracionRolesAuthController } from './presentation/administracion-roles-auth.controller';
import { AdministracionVentanasController } from './presentation/administracion-ventanas.controller';
import { FormulariosController } from './presentation/formularios.controller';
import { ParametrosController } from './presentation/parametros.controller';
import { PermisosController } from './presentation/permisos.controller';
import { RolesController } from './presentation/roles.controller';
import { VentanasController } from './presentation/ventanas.controller';
import { ZonalesController } from './presentation/zonales.controller';

@Module({
  controllers: [
    ParametrosController,
    PermisosController,
    RolesController,
    FormulariosController,
    ZonalesController,
    VentanasController,
    AdministracionAreasController,
    AdministracionCatalogosController,
    AdministracionFormulariosController,
    AdministracionVentanasController,
    AdministracionRolesAuthController,
  ],
  providers: [
    ParametroPoliticaService,
    ParametroPoliticaRepository,
    PermisosAdminService,
    FormulariosService,
    FormulariosAdminService,
    FormulariosRepository,
    /**
     * `AreasFormularioService` NO se exporta: solo lo usa su controlador. Publicarlo
     * invitaria a cambiar las areas admitidas desde otro submodulo saltandose el
     * `@Roles(ADMINISTRADOR_DMIP)` de la ruta, que es donde vive el control de acceso.
     */
    AreasFormularioService,
    CatalogosService,
    CatalogosRepository,
    VentanaCargaService,
    VentanasRepository,
    RolesAuthService,
    RolesAuthRepository,
  ],
  exports: [
    ParametroPoliticaService,
    FormulariosService,
    CatalogosService,
    VentanaCargaService,
  ],
})
export class ConfiguracionModule {}
