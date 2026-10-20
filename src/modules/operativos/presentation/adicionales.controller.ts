/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: adicionales.controller.ts
 * Responsabilidad: Exponer el registro del operativo adicional del día.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-20
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ESTE ARCHIVO EXISTE POR UNA SOLA LÍNEA: LA DE `@UseGuards`.
 *
 * `OperativosController` declara la cadena completa —Identidad, Roles, FormularioRol y
 * **VentanaCarga**— a nivel de clase. Un adicional se dispone por urgencia el mismo día
 * en que se ejecuta, cuando la ventana de carga del departamento ya cerró: dentro de ese
 * controlador sería imposible de crear justo cuando hace falta.
 *
 * SE PODÍA HABER RESUELTO CON UN DECORADOR `@SinVentanaDeCarga()` que la guarda leyera, y
 * se descartó. Eso crea un mecanismo GENERAL de exención, y un mecanismo general acaba
 * puesto en un segundo endpoint «porque hace falta», y en un tercero: la ventana dejaría
 * de ser una garantía para pasar a ser una opción. Con un controlador aparte, la excepción
 * está en la firma, se lee de un vistazo, y eximir otro endpoint obliga a crear otro
 * controlador —que es exactamente la fricción que esto debe tener—.
 *
 * LO QUE **NO** SE SALTA, y conviene enumerarlo para que nadie lo dé por supuesto:
 *
 *   · `IdentidadGuard` y `RolesGuard` siguen aquí.
 *   · La PROPIEDAD del formulario la comprueba el servicio, con el mismo 403. No puede ir
 *     en `FormularioRolGuard` porque la ruta lleva el identificador del operativo padre y
 *     no un código de formulario, exactamente igual que en `PATCH` y `DELETE`.
 *     **La Dirección está exenta**: responde por el cuadro entero, no por un formulario.
 *   · El ESTADO DEL CUADRO, **para los roles departamentales**. Sobre un cuadro cerrado
 *     ellos se detienen; la Dirección no, porque RN-58 exige su autorización y ella es la
 *     autorización. Ver `OperativosService.registrarAdicional`.
 *   · La AUDITORÍA. La ventana se evalúa igual, no bloquea, y su veredicto queda escrito,
 *     junto con el estado del cuadro y quién lo dispuso.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { OperativosService } from '../application/operativos.service';
import {
  aOperativoResponse,
  CrearAdicionalDto,
  type OperativoResponseDto,
} from './dto/operativo.dto';

/**
 * Los tres que cargan operativos, **y la Dirección**.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA DIRECCIÓN SE SUMÓ EL 2026-08-20, y no por comodidad: es lo que hace utilizable la
 * funcionalidad. La operación real es que el cuadro se arma, se consolida la matriz, **se
 * cierra**, y ENTONCES aparece la urgencia. Con el cuadro abierto el adicional casi no
 * hace falta.
 *
 * RN-58 no dice que un cuadro cerrado sea inmutable: dice que no admite modificaciones
 * **sin autorización de la Dirección**. Si la Dirección es quien lo crea, la autorización
 * es intrínseca. No hay que reabrir el cuadro —que abriría la escritura a todos los
 * departamentos a la vez— ni inventar un mecanismo de permiso.
 *
 * El departamento conserva la facultad **mientras el cuadro siga abierto**. Quién puede
 * qué se decide en `OperativosService.registrarAdicional`, no aquí: depende del estado
 * del cuadro, que esta guarda no conoce.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * `DIRECTOR` VA PRIMERO EN LA LISTA, Y EL ORDEN NO ES DECORATIVO.
 *
 * `RolesGuard` estrecha el rol efectivo **al primero de esta lista que la persona tenga**.
 * Quien acumule Dirección y un rol departamental —hoy solo las cuentas de prueba— actuará
 * como Dirección al crear un adicional, y eso es lo correcto por dos motivos: es la
 * autoridad mayor de las dos, y la traza de auditoría dirá `DIRECTOR`, que es de dónde
 * viene realmente la autorización. Ponerlo al final haría que la excepción de RN-58
 * dependiera de qué otros roles tenga esa persona, que es tanto como no tener regla.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
@Controller('operativos')
@UseGuards(IdentidadGuard, PermisosGuard)
export class AdicionalesController {
  constructor(private readonly operativos: OperativosService) {}

  /**
   * Registra un adicional sobre el operativo `:id`.
   *
   * La ruta cuelga del padre y no de una colección propia —no es `POST /adicionales`—
   * porque un adicional no existe sin él: su jornada, su formulario y su prefijo salen
   * de ahí. Ninguno de los tres viaja en el cuerpo, y enviarlos produce `400`.
   */
  @Post(':id/adicional')
  @RequierePermiso('operativos:adicional:crear')
  async registrar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CrearAdicionalDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OperativoResponseDto> {
    return aOperativoResponse(
      await this.operativos.registrarAdicional(
        id,
        dto,
        { usuarioId: usuario.usuarioId, rol: usuario.rol },
        usuario.roles,
        // Para volver a preguntar a Inspección por los trámites elegidos (2026-10-07).
        usuario.tokenAuth,
      ),
    );
  }
}
