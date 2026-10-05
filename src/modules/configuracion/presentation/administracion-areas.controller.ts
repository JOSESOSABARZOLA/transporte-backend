/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: administracion-areas.controller.ts
 * Responsabilidad: Exponer el cambio de áreas admitidas de un formulario.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-27
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * UNA SOLA RUTA, Y ES UN `PUT`.
 *
 * No hay `POST` de un área ni `DELETE` de otra, y es deliberado: con altas y bajas
 * sueltas existe el momento en que el formulario se queda sin ninguna, y ese estado deja
 * el selector de personal vacío sin explicarlo. Se manda el conjunto entero y el servidor
 * lo iguala en una transacción.
 *
 * SOLO EL `ADMINISTRADOR_DMIP`, igual que el resto de P-08. Quien registra operativos no
 * decide de qué áreas puede sacar gente: eso es configuración del cuadro.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SIN `FormularioRolGuard`. Esa guarda comprueba que el rol **participe** en el
 * formulario, y el administrador no participa en ninguno: administra los nueve. Ponerla
 * aquí lo dejaría fuera de todos.
 */

import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { AreasFormularioService } from '../application/areas-formulario.service';
import { ReemplazarAreasDto } from './dto/administrar-areas.dto';

/** Lo que el formulario admite después del cambio. */
interface AreasResponseDto {
  codigo: string;
  nombre: string;
  areas: { area: string; esCompartida: boolean }[];
}

@Controller('administracion/formularios')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('catalogos:administrar')
export class AdministracionAreasController {
  constructor(private readonly areas: AreasFormularioService) {}

  /**
   * Deja el formulario con exactamente las áreas que se envían.
   *
   * Devuelve el estado resultante y no un `204`: la pantalla necesita repintar el panel
   * con lo que quedó, incluida la marca de compartida, que este endpoint **conserva** y
   * no recibe.
   */
  @Put(':codigo/areas')
  async reemplazar(
    @Param('codigo') codigo: string,
    @Body() dto: ReemplazarAreasDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<AreasResponseDto> {
    const formulario = await this.areas.reemplazar(
      codigo,
      dto.areas,
      usuario.usuarioId,
    );

    return {
      codigo: formulario.codigo,
      nombre: formulario.nombre,
      areas: formulario.areas.map((fila) => ({
        area: fila.area,
        esCompartida: fila.esCompartida,
      })),
    };
  }
}
