/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: ventanas.controller.ts
 * Responsabilidad: Exponer el estado de la ventana del rol bajo el que se trabaja.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * DEVUELVE UNA VENTANA PROPIA, NUNCA LA DE OTRO. El rol puede indicarse, pero **se
 * comprueba contra los de la sesión**: pedir uno ajeno responde `403`. La regla original
 * —que el horario de otro departamento no se consulta— sigue intacta; lo único que se
 * admite es elegir entre los roles que la persona ya tiene.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ HIZO FALTA ADMITIR EL ROL · defecto reportado el 2026-08-20.
 *
 * La DAF entraba a P-03 y leía «La ventana de asignación ya cerró», con el mensaje de
 * cierre del DMIP pegado detrás. La bandeja quedaba en solo lectura **justo durante la
 * hora y media en que la DAF debe trabajar**: a las 15H00 su ventana abre y la del DMIP
 * cierra.
 *
 * LA CAUSA NO ESTABA AQUÍ, SINO EN LA CADENA. `IdentidadGuard` fija `usuario.rol` al
 * PRIMERO de la lista —rol de partida— y `RolesGuard` lo estrecha al que el endpoint
 * admite… **solo si el endpoint declara `@Roles`**. Éste no lo declara, y no puede: lo
 * consultan los seis roles, así que la lista tendría que incluirlos todos y la guarda
 * volvería a estrechar al primero de esa lista, no al de la pantalla. Sería el mismo
 * defecto con otra cara.
 *
 * Sin estrechar, una cuenta con seis roles preguntaba siempre por el primero, y la
 * pantalla de la DAF recibía la ventana del DMIP.
 *
 * NO ERA UN PROBLEMA DE PERMISOS: `PATCH /transporte/operativos/:id` sí declara
 * `@Roles(DAF)`, así que la escritura se evaluaba contra la ventana correcta y **habría
 * funcionado**. Era la pantalla bloqueándose contra sí misma con un dato equivocado.
 *
 * LA CORRECCIÓN ES DE SIMETRÍA: cada pantalla pregunta por la ventana del rol bajo el que
 * opera, que es exactamente lo que `RolesGuard` elegirá cuando esa pantalla escriba. Vista
 * y guarda miran lo mismo, y por eso no pueden volver a discrepar.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Lo consume el hook `useVentanaCarga` para que la interfaz avise ANTES de capturar un
 * operativo, en lugar de dejar que el funcionario descubra la ventana cerrada al guardar.
 * La guarda sigue siendo la que decide; esto solo se anticipa.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import { AutorizacionError } from '../../../common/errors/errores-dominio';
import { VentanaCargaService } from '../application/ventana-carga.service';
import {
  aVentanaEstadoResponse,
  ConsultarVentanaDto,
  type VentanaEstadoResponseDto,
} from './dto/ventana.dto';

@Controller('ventanas')
@UseGuards(IdentidadGuard, PermisosGuard)
export class VentanasController {
  constructor(private readonly ventanas: VentanaCargaService) {}

  @Get('estado')
  async estado(
    @Query() filtro: ConsultarVentanaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<VentanaEstadoResponseDto> {
    return aVentanaEstadoResponse(
      await this.ventanas.obtenerEstado(this.rolConsultado(filtro, usuario)),
    );
  }

  /**
   * El rol por el que se pregunta, comprobado contra los de la sesión.
   *
   * FALLA CERRADA. Un rol ajeno no se ignora en silencio para responder con el propio:
   * eso devolvería un horario que no es el que se pidió, y la pantalla lo pintaría como
   * si lo fuera. Se rechaza, con el mismo código con el que se rechaza cualquier acceso
   * que no corresponde al perfil.
   */
  private rolConsultado(
    filtro: ConsultarVentanaDto,
    usuario: UsuarioAutenticado,
  ): UsuarioAutenticado['rol'] {
    // Sin parámetro, el comportamiento de siempre: el rol efectivo de la sesión.
    if (filtro.rol === undefined) return usuario.rol;

    if (!usuario.roles.includes(filtro.rol)) {
      throw new AutorizacionError(
        CODIGOS_ERROR.ROL_NO_AUTORIZADO,
        'No puede consultar la ventana de carga de un departamento que no es el suyo.',
        { rolConsultado: filtro.rol },
      );
    }

    return filtro.rol;
  }
}
