/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: zonales.controller.ts
 * Responsabilidad: Exponer el catálogo de zonales administrativas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * NACIÓ COMO LAS ONCE FILAS FIJAS: las diez del Distrito más el ámbito DMQ. DEJÓ DE SER UN
 * CATÁLOGO CERRADO EL 2026-09-04: el administrador puede sumar zonales (crear, renombrar y
 * desactivar), en `administracion-catalogos.controller.ts`. La creación de zonales no
 * estaba prevista y es una decisión de negocio tomada esa fecha; el ámbito distrital (DMQ)
 * no se administra —es único y ya existe—.
 *
 * Desde el 2026-09-02 esta lista ya no es lo que se ofrece al registrar. RN-18 decía que la
 * lista no se filtraba nunca, con fuente en entrevista: el matrizador fue explícito en que
 * no cambia de una pantalla a otra. La revocó el insumo de catálogos de esa fecha, en el
 * que cuatro formularios son distritales: ofrecerles las diez administraciones zonales era
 * ofrecerles diez caminos sin salida, porque el punto de encuentro es obligatorio y ninguno
 * admite captura libre. Para registrar se usa `CatalogosRepository.zonalesDeFormulario`.
 *
 * ESTA SIGUE ENTERA PORQUE P-08 LA NECESITA ENTERA: administrar es, sobre todo, sembrar
 * la zonal que todavía no tiene ningún punto, y esa es justo la que la otra omite. Con
 * `incluirInactivas` trae también las desactivadas, para poder reactivarlas.
 *
 * Endpoint propio y no anidado bajo formularios porque el catálogo no depende de
 * ninguno: la pantalla lo consulta una vez y lo reutiliza.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import { CatalogosService } from '../application/catalogos.service';
import {
  aZonalResponse,
  type ZonalResponseDto,
} from './dto/catalogos-response.dto';

@Controller('zonales')
@UseGuards(IdentidadGuard, PermisosGuard)
export class ZonalesController {
  constructor(private readonly catalogos: CatalogosService) {}

  /**
   * `incluirInactivas=true` solo lo pide la pantalla de catálogos, que necesita ver las
   * desactivadas para poder reactivarlas. Por omisión salen solo las vigentes, que es lo
   * que espera cualquier otro consumidor.
   */
  @Get()
  async listar(
    @Query('incluirInactivas') incluirInactivas?: string,
  ): Promise<ZonalResponseDto[]> {
    const zonales = await this.catalogos.listarZonales(
      incluirInactivas === 'true',
    );
    return zonales.map(aZonalResponse);
  }
}
