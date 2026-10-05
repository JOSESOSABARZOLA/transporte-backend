/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Maestro de personal
 * Archivo: rol-direccion.repository.ts
 * Responsabilidad: Leer qué direcciones administra cada rol.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-01
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DE DÓNDE SALE EL ALCANCE DE UN ADMINISTRADOR DE ÁREA.
 *
 * `t_rol_direccion` dice que `ADMINISTRADOR_DMIT` administra `DMIT_INSTRUCTOR`. Los roles
 * departamentales no necesitan fila: ven lo suyo porque **son** esa dirección, y una fila
 * que lo repitiera haría creer que es ella la que concede el acceso. La base lo impide con
 * `ck_rol_direccion_distinta`.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SE CACHEA EN MEMORIA, y conviene decir por qué se puede. Son cuatro filas que describen
 * el organigrama: cambian cuando la institución se reorganiza, no durante una jornada.
 * Sin caché, cada listado del maestro y cada ausencia añadirían una consulta a una tabla
 * que casi nunca cambia.
 *
 * **El precio es explícito**: si alguien edita la tabla por SQL, las instancias que ya
 * arrancaron siguen con el reparto anterior hasta que se reinicien. Cuando exista la
 * pantalla que la administre, esa pantalla debe llamar a `olvidar()` al guardar, y por eso
 * el método es público desde hoy en lugar de dejarlo para entonces.
 */

import { Injectable } from '@nestjs/common';
import type { RolDepartamental } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class RolDireccionRepository {
  /** El reparto entero, resuelto una vez. `null` mientras no se haya leído. */
  private reparto: Map<RolDepartamental, RolDepartamental[]> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Las direcciones que administran **estos** roles, sin repetir.
   *
   * Se devuelve la unión y no una por rol: quien tiene varios administra lo de todos,
   * que es la misma semántica que el resto del módulo aplica a las personas con varios
   * roles desde el 2026-08-19.
   */
  async direccionesQueAdministran(
    roles: readonly RolDepartamental[],
  ): Promise<RolDepartamental[]> {
    const reparto = await this.cargar();
    const direcciones = new Set<RolDepartamental>();

    for (const rol of roles) {
      for (const direccion of reparto.get(rol) ?? []) {
        direcciones.add(direccion);
      }
    }

    return [...direcciones];
  }

  /** Descarta la caché. La usará la pantalla de administración al guardar. */
  olvidar(): void {
    this.reparto = null;
  }

  private async cargar(): Promise<Map<RolDepartamental, RolDepartamental[]>> {
    if (this.reparto) return this.reparto;

    const filas = await this.prisma.rolDireccion.findMany({
      where: { activo: true },
      select: { rol: true, direccion: true },
    });

    const reparto = new Map<RolDepartamental, RolDepartamental[]>();
    for (const fila of filas) {
      const suyas = reparto.get(fila.rol) ?? [];
      suyas.push(fila.direccion);
      reparto.set(fila.rol, suyas);
    }

    this.reparto = reparto;
    return reparto;
  }
}
