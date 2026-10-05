/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Catálogo de roles
 * Archivo: roles.controller.ts
 * Responsabilidad: Publicar qué roles existen y cuáles se pueden asignar.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-01
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NINGÚN ROL DEBE ESTAR ESCRITO EN EL FRONTEND. Decisión del negocio, 2026-09-01.
 *
 * Hasta hoy el navegador tenía su propio mapa de nombres y de él salía la lista del
 * desplegable de P-11 y de «Roles de Auth central». Eso significaba que **añadir un rol
 * exigía tocar el frontend**, y que las dos listas —la del servidor y la del navegador—
 * podían decir cosas distintas sin que nada fallara.
 *
 * ES UN CATÁLOGO, NO UNA MATRIZ DE PERMISOS. Dice qué roles hay y cómo se llaman; **no**
 * dice qué abre cada uno. Eso sigue en los `@Roles` de cada endpoint, y parametrizarlo es
 * otro trabajo, ya planificado y aparte.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SIN `VentanaCargaGuard`: es una consulta, y además de administración. La ventana
 * gobierna la jornada del cuadro. Mismo criterio que M-06, M-07 y M-08.
 */

import { Controller, Get, UseGuards } from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import {
  catalogoDeRoles,
  type RolDelCatalogo,
} from '../../../common/roles/catalogo-roles';

@Controller('administracion/roles')
@UseGuards(IdentidadGuard, PermisosGuard)
/**
 * SOLO EL ADMINISTRADOR, y no por cautela genérica: las pantallas que lo consumen —P-11
 * «Cuentas del cuadro» y «Roles de Auth central»— son suyas. Abrirlo a más roles sería
 * ensanchar el contrato antes de que nadie lo necesite.
 */
@RequierePermiso('roles:ver')
export class RolesController {
  /**
   * El catálogo de roles del módulo.
   *
   * NO CONSULTA LA BASE. El enumerado es un tipo de PostgreSQL y los nombres son del
   * organigrama: los dos viven en el código y cambiarlos exige desplegar de todos modos.
   * Lo que este endpoint resuelve no es la persistencia, es **la duplicación**: que el
   * navegador deje de tener su propia copia.
   */
  @Get()
  consultar(): RolDelCatalogo[] {
    return catalogoDeRoles();
  }
}
