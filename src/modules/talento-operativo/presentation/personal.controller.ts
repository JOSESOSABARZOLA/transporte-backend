/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Personal elegible
 * Archivo: personal.controller.ts
 * Responsabilidad: Exponer el personal al que se le puede asignar un operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * LO CONSULTAN LOS DEPARTAMENTALES, y por eso la respuesta es pobre a propósito: id,
 * apellidos, nombres, área y cargo. Ni cédula ni teléfono. RN-34 los reserva al maestro
 * de personal, y quien arma el cuadro elige personas, no las contacta.
 *
 * TAMPOCO DICE POR QUÉ FALTA ALGUIEN. Si una persona está de reposo médico
 * simplemente no aparece; devolver «excluida por reposo médico» convertiría esta
 * consulta en un parte de salud de la institución.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { PersonalElegibleService } from '../application/personal-elegible.service';
import { aFechaUtc } from '../application/reglas-personal';
import {
  aPersonaElegibleResponse,
  type PersonaElegibleResponseDto,
} from './dto/personal.dto';

@Controller('personal')
@UseGuards(IdentidadGuard, PermisosGuard)
export class PersonalController {
  constructor(private readonly elegibles: PersonalElegibleService) {}

  /**
   * `GET /personal/elegible?formulario=INSP&inicio=2026-08-06&fin=2026-08-06`
   *
   * `fin` es opcional: la mayoría de los operativos ocurren en un solo día, y repetir
   * la fecha en cada consulta sería ruido.
   */
  @Get('elegible')
  async elegible(
    @Query('formulario') formulario: string,
    @Query('inicio') inicio: string,
    @Query('fin') fin?: string,
    @Query('horaInicio') horaInicio?: string,
    @Query('horaFin') horaFin?: string,
    /**
     * LOS ROLES SALEN DE LA SESIÓN, NUNCA DE LA PETICIÓN. Añadido el 2026-08-27.
     *
     * Acotan la lista al personal del que esos departamentos disponen. Aceptarlos por
     * parámetro dejaría que cualquiera pidiera «la lista como Inspecciones», que es
     * justo el tipo de cabecera que se retiró el 2026-08-18.
     *
     * SE PASAN TODOS Y NO `usuario.rol`: este endpoint no declara `@Roles`, así que ese
     * campo no lo estrecha nadie y se queda en el primero que devolvió Auth. Tomarlo
     * dejaba sin personal a quien tuviera además un rol sin área.
     */
    @UsuarioActual() usuario?: UsuarioAutenticado,
  ): Promise<PersonaElegibleResponseDto[]> {
    if (!formulario) {
      throw new ValidacionError(
        'Indique el formulario para el que consulta el personal.',
        {},
      );
    }

    const desde = exigirFecha(inicio, 'inicio');
    const hasta = fin ? exigirFecha(fin, 'fin') : desde;

    if (hasta < desde) {
      throw new ValidacionError(
        'La fecha de fin no puede ser anterior a la de inicio.',
        { inicio, fin },
      );
    }

    // Las dos horas van juntas o no van: con una sola no se puede formar el rango, y
    // aplicar media regla sería peor que no aplicarla.
    if (Boolean(horaInicio) !== Boolean(horaFin)) {
      throw new ValidacionError(
        'Indique la hora de inicio y la de fin, o ninguna de las dos.',
        { horaInicio: horaInicio ?? null, horaFin: horaFin ?? null },
      );
    }

    const personas = await this.elegibles.consultar({
      formularioCodigo: formulario,
      desde,
      hasta,
      roles: usuario?.roles,
      horaInicio,
      horaFin,
    });

    return personas.map(aPersonaElegibleResponse);
  }
}

function exigirFecha(texto: string | undefined, cual: string): Date {
  const fecha = texto ? aFechaUtc(texto) : undefined;

  if (!fecha) {
    throw new ValidacionError(
      `Indique la fecha «${cual}» del operativo, escrita como AAAA-MM-DD.`,
      { [cual]: texto ?? null },
    );
  }

  return fecha;
}
