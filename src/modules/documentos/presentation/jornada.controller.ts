/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Jornada del día (P-13)
 * Archivo: jornada.controller.ts
 * Responsabilidad: Exponer la jornada del día al rol que la consulta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-26
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * UNA SOLA RUTA, Y LO QUE NO TIENE ES TAN DELIBERADO COMO LO QUE TIENE.
 *
 * **No hay `:fecha/exportar`.** El PDF de la jornada es RN-47 y es de la Dirección: es el
 * artefacto que circulaba por WhatsApp y el que RN-44 retiró de los canales informales.
 * Que el DMIT vea la jornada en pantalla fue una decisión de negocio del 2026-08-26; que
 * pueda llevársela en un archivo firmable no se pidió y no se concede.
 *
 * **No hay cierre de cuadro.** Vive en `POST /cuadros/:fecha/cerrar` y sigue siendo del
 * Director.
 *
 * Si algún día se añade cualquiera de las dos, que sea porque alguien lo decidió, no
 * porque copiar `matriz.controller.ts` las arrastró.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LOS TRES ROLES DEPARTAMENTALES DESDE EL 2026-09-01. FUE LA DECISIÓN QUE ESTO PEDÍA.
 *
 * Aquí decía: «SOLO `DMIT_INSTRUCTOR`… los otros dos no lo pidieron: **abrirles esta ruta
 * es un cambio de una línea, y conviene que sea una decisión y no una inercia**». El
 * negocio la tomó: quien registra necesita una visión general del día para saber dónde
 * encaja lo suyo.
 *
 * Y DESDE EL 2026-09-15, CADA ROL VE SOLO SUS FORMULARIOS. Al principio (2026-08-26/09-01) la
 * jornada mostraba los nueve formularios «solo en lectura y sin el personal ajeno». El negocio
 * revirtió esa apertura: `componer` descarta las secciones que el rol solo lee (contra
 * `t_formulario_rol`), así que el resto no aparece. Pesa más el aislamiento que ver el volumen
 * ajeno.
 *
 * PER-02 vuelve a ser casi la de siempre: cada departamento ve la rejilla del día **de lo
 * suyo**, no la ajena. El aislamiento de la información es el requisito que originó este
 * encargo —el cuadro circulaba por WhatsApp y los intervenidos se anticipaban—, no una cautela
 * genérica.
 *
 * El Director sigue teniendo la suya en `/matriz`, con el documento completo.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SIN `VentanaCargaGuard`. Es una consulta, y `VentanaCargaGuard` solo actúa sobre
 * métodos de escritura. La ventana sí gobierna la asignación de personal, pero esa ocurre
 * en `POST /operativos/:id/personal`, que la lleva.
 */

import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { JornadaService } from '../application/jornada.service';
import { aJornadaResponse, type JornadaResponseDto } from './dto/jornada.dto';

@Controller('jornada')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('jornada:ver')
export class JornadaController {
  constructor(private readonly jornada: JornadaService) {}

  /**
   * La jornada del día, con sus secciones marcadas como editables o de solo lectura.
   *
   * LOS ROLES SALEN DEL USUARIO, NUNCA DE LA PETICIÓN. Aceptarlos por parámetro dejaría que
   * cualquiera pidiera la jornada «como Director».
   *
   * SE USA LA UNIÓN `usuario.roles`, no `usuario.rol` (2026-09-14). El acceso de cada sección
   * —y por tanto si se publica su personal— es el MÁS FUERTE entre todos los roles del usuario,
   * igual que P-01 y P-02. Con un solo rol (`usuario.rol`, el primero que estrecha `RolesGuard`),
   * quien tenía varios roles veía «No se publica» en los formularios que escriben sus OTROS roles.
   */
  @Get(':fecha')
  async consultar(
    @Param('fecha') fecha: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<JornadaResponseDto> {
    return aJornadaResponse(
      await this.jornada.componer(exigirFecha(fecha), usuario.roles),
    );
  }
}

/** Mismo criterio que en M-13, M-14, M-16, M-17, M-18 y M-19: `@db.Date` se lee en UTC. */
function exigirFecha(texto: string): Date {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);

  if (!partes) {
    throw new ValidacionError(
      `«${texto}» no es una fecha válida. Se escribe como AAAA-MM-DD.`,
      { fecha: texto },
    );
  }

  const [, anio, mes, dia] = partes.map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    throw new ValidacionError(`La fecha ${texto} no existe.`, { fecha: texto });
  }

  return fecha;
}
