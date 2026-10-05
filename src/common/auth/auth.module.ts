/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: auth.module.ts
 * Responsabilidad: Publicar la cadena de autorización a los submódulos de negocio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Las guardas NO se registran de forma global a propósito. Cada endpoint declara las
 * que le corresponden con `@UseGuards()`, porque la cadena no es la misma en todos:
 * una consulta lleva Identidad y Roles, y una escritura lleva además FormularioRol y
 * VentanaCarga. Registrarlas globalmente obligaría a excluir endpoints uno por uno,
 * y una exclusión olvidada es un agujero silencioso.
 *
 * Orden obligatorio, de docs/IMPLEMENTATION_GUIDE.md §16.1:
 *   IdentidadGuard → RolesGuard → FormularioRolGuard → VentanaCargaGuard
 *        401             403             403                423
 */

import { Global, Module } from '@nestjs/common';

import { RolesGuard } from './guards/roles.guard';
import { IdentidadGuard } from './guards/identidad.guard';
import { FormularioRolGuard } from './guards/formulario-rol.guard';
import { VentanaCargaGuard } from './guards/ventana-carga.guard';
import { PermisosGuard } from './guards/permisos.guard';
import { VentanaCargaEvaluador } from './application/ventana-carga.evaluador';
import { PermisosService } from './application/permisos.service';
import { FormularioAutorizacionRepository } from './infrastructure/formulario-autorizacion.repository';
import { VentanaCargaRepository } from './infrastructure/ventana-carga.repository';
import { PermisosRepository } from './infrastructure/permisos.repository';

@Global()
@Module({
  providers: [
    IdentidadGuard,
    RolesGuard,
    FormularioRolGuard,
    VentanaCargaGuard,
    PermisosGuard,
    VentanaCargaEvaluador,
    PermisosService,
    FormularioAutorizacionRepository,
    VentanaCargaRepository,
    PermisosRepository,
  ],
  /**
   * Los DOS REPOSITORIOS se exportan además de las guardas, y hace falta.
   *
   * `@UseGuards(Clase)` construye la guarda en el inyector del módulo que declara el
   * controlador, no en este: sin exportar sus dependencias, `FormularioRolGuard` y
   * `VentanaCargaGuard` no se pueden instanciar fuera de `common/auth`. Se descubrió en
   * M-14, que es el primer submódulo que declara la cadena completa.
   *
   * Exportarlos no abre acceso a la base a nadie: son de solo lectura, leen las cinco
   * columnas que deciden la propiedad departamental y la ventana del rol, y ningún
   * servicio de negocio los inyecta.
   */
  exports: [
    IdentidadGuard,
    RolesGuard,
    FormularioRolGuard,
    VentanaCargaGuard,
    PermisosGuard,
    VentanaCargaEvaluador,
    PermisosService,
    FormularioAutorizacionRepository,
    VentanaCargaRepository,
    PermisosRepository,
  ],
})
export class AuthModule {}
