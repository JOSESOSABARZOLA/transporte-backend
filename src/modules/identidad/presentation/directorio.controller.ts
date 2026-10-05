/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: directorio.controller.ts
 * Responsabilidad: Exponer el directorio de Auth cruzado con las fichas de personal.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-21
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * RUTA PROPIA, Y NO `administracion/personal/directorio` COMO DECÍA EL PLAN.
 *
 * `AdministracionPersonalController` ya declara `@Get(':id')` con `ParseIntPipe`. Colgar
 * el directorio de esa misma ruta lo dejaría compitiendo con ese comodín: según el orden
 * en que Nest registre los controladores, `directorio` acabaría interpretado como un
 * identificador y respondiendo `400`. Es el tipo de fallo que no aparece en desarrollo y
 * sí el día que alguien reordena un array de `controllers`.
 *
 * Una ruta que no puede colisionar cuesta lo mismo y no depende de un orden.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SOLO LOS ADMINISTRADORES QUE DAN DE ALTA PERSONAL O CUENTAS, y conviene decir por qué se
 * declara aquí aunque Auth no lo exija: `GET /users` de Auth **no comprueba rol**,
 * cualquier sesión de cualquier subsistema puede listar al personal de la institución. Eso
 * está reportado a ese equipo; mientras tanto, **este** módulo no amplía el agujero. El
 * directorio trae correo y cédula de toda la institución, y es la misma clase de dato que
 * P-07 ya restringe.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ENTRA `ADMINISTRADOR_DMIT` EL 2026-09-02, Y ES UNA CORRECCIÓN, NO UNA AMPLIACIÓN.
 *
 * El día anterior el maestro de personal se repartió: el de Instrucción da de alta a su
 * gente. Pero **el alta empieza aquí** —«Nuevo funcionario» abre el directorio de Auth— y
 * este `@Roles` se quedó sin actualizar, así que su primer clic recibía un 403 con el
 * mensaje genérico «su rol no tiene permiso», sin decir qué le faltaba. La pantalla que se
 * le abrió el día anterior era, en la práctica, de solo lectura.
 *
 * QUÉ VE DE MÁS, DICHO SIN ADORNARLO. El directorio es la AMC entera —nombre, cédula y
 * correo de toda persona activa en Auth— y, para quien ya tiene ficha en este módulo,
 * también su área, su tipo de contrato y si está activa. Eso último **incluye fichas de
 * otros departamentos**, y no se recorta por alcance a propósito: sin ese cruce el alta no
 * podría avisar de que la persona ya está registrada, y se intentarían duplicados que el
 * índice único de cédula rechazaría con un error mucho peor de entender.
 *
 * Es exactamente lo que el `ADMINISTRADOR_DMIP` ya veía. Si el negocio decide que el de
 * Instrucción no deba ver el área ni el contrato de una ficha ajena, es otro recorte y
 * otra decisión — el `ficha` del cruce es lo único que habría que acotar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Controller, Get, UseGuards } from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { DirectorioAuthService } from '../application/directorio-auth.service';
import { AuthNoDisponibleError } from '../infrastructure/auth-usuarios.client';
import {
  aDirectorioResponse,
  directorioNoDisponible,
  type RespuestaDirectorioDto,
} from './dto/directorio.dto';

@Controller('administracion/directorio')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('personal:directorio:ver')
export class DirectorioController {
  constructor(private readonly directorio: DirectorioAuthService) {}

  /**
   * El personal de la institución, según Auth, cruzado con nuestras fichas.
   *
   * SE CONSULTA CON EL TOKEN DE QUIEN PREGUNTA, porque Auth no tiene otra credencial: no
   * existe token de servicio ni API key. Si la sesión es anterior al 2026-08-21 no lo
   * lleva, y entonces se pide volver a entrar en lugar de fallar con un 500 que nadie
   * sabría interpretar.
   */
  @Get()
  async consultar(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<RespuestaDirectorioDto> {
    if (!usuario.tokenAuth) {
      return directorioNoDisponible(
        'Su sesión se abrió antes de que el módulo pudiera consultar el directorio de Auth central. Vuelva a entrar desde el portal institucional.',
      );
    }

    try {
      const filas = await this.directorio.consultar(usuario.tokenAuth);

      return {
        disponible: true,
        motivo: null,
        personas: filas.map(aDirectorioResponse),
      };
    } catch (error: unknown) {
      /*
        SOLO SE ATRAPA LA INDISPONIBILIDAD DE AUTH. Un fallo de nuestra base o un defecto
        de programación tiene que seguir subiendo al filtro global: convertirlo en
        `disponible: false` diría que el problema es de Auth cuando es nuestro, y quien
        lea la pantalla iría a reclamar al equipo equivocado.
      */
      if (error instanceof AuthNoDisponibleError) {
        return directorioNoDisponible(error.message);
      }

      throw error;
    }
  }
}
