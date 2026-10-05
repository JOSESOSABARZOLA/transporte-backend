/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: formulario-rol.guard.ts
 * Responsabilidad: Verificar que el formulario de la petición pertenece al rol.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * PER-01. Un departamento no puede escribir en formularios en los que no participa,
 * **ni siquiera manipulando la petición**.
 *
 * De ahí la regla dura de esta guarda: la petición solo indica QUÉ formulario se
 * pretende usar; quién participa en él lo dice la tabla `t_formulario_rol`. Si la guarda
 * confiara en un campo del cuerpo para decidir la participación, bastaría con alterar ese
 * campo para escribir en un formulario ajeno.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DE «UN DUEÑO Y UN INVITADO» A N ROLES. 2026-08-25.
 *
 * Hasta hoy la participación cabía en dos columnas —`form_rol_dueno` y
 * `form_rol_compartido`— y esta guarda las leía. El negocio pidió que la patrulla ECU la
 * registren **dos** departamentos, y eso con dos columnas no cabe.
 *
 * Ahora son filas, y esta guarda comprueba pertenencia a un conjunto. Lo que **no**
 * cambió es dónde se decide: sigue siendo la base, y sigue sin confiarse en la pantalla.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { CODIGOS_ERROR } from '../../errors/codigos-error';
import { AutorizacionError } from '../../errors/errores-dominio';
import {
  FORMULARIO_DESDE_KEY,
  type UbicacionFormulario,
} from '../decorators/formulario-desde.decorator';
import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado.interface';
import { FormularioAutorizacionRepository } from '../infrastructure/formulario-autorizacion.repository';

@Injectable()
export class FormularioRolGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly repositorio: FormularioAutorizacionRepository,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const ubicacion = this.reflector.getAllAndOverride<UbicacionFormulario>(
      FORMULARIO_DESDE_KEY,
      [contexto.getHandler(), contexto.getClass()],
    );

    // Sin decorador, el endpoint no trabaja sobre un formulario concreto.
    if (!ubicacion) return true;

    const peticion = contexto
      .switchToHttp()
      .getRequest<Request & { user?: UsuarioAutenticado }>();

    const usuario = peticion.user;
    if (!usuario) {
      throw new ForbiddenException('La identidad no está resuelta.');
    }

    const codigo = extraerCodigo(peticion, ubicacion);
    if (!codigo) {
      throw new AutorizacionError(
        CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
        'Debe indicar el formulario sobre el que desea trabajar.',
      );
    }

    const formulario = await this.repositorio.buscarPorCodigo(codigo);

    if (!formulario || !formulario.activo) {
      // Un formulario inexistente o dado de baja se responde como no autorizado y no
      // como no encontrado: así la respuesta no revela qué códigos existen.
      throw new AutorizacionError(
        CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
        'El formulario seleccionado no corresponde a su departamento.',
        { formularioCodigo: codigo },
      );
    }

    /*
      Se comprueba contra TODOS sus roles, no contra el efectivo: la persona participa en
      este formulario si CUALQUIERA de los que tiene tiene una fila en él.

      Desde el 2026-08-25 la participación son filas de `t_formulario_rol` y no dos
      columnas. Un formulario puede tener varios departamentos que registran —la patrulla
      ECU tiene dos— y varios que aportan personal.
    */
    const participaciones = formulario.roles.filter((fila) =>
      usuario.roles.includes(fila.rol),
    );

    if (participaciones.length === 0) {
      throw new AutorizacionError(
        CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
        `El formulario ${formulario.nombre} no corresponde a su departamento.`,
        { formularioCodigo: codigo, roles: usuario.roles },
      );
    }

    /*
      ES EL ESTRECHAMIENTO MÁS IMPORTANTE DE LA CADENA. El rol con el que se escribe en un
      formulario es **el que participa en él**, no uno cualquiera de los que la persona
      tenga. De ahí salen `oper_creado_por_rol` y la ventana de carga que se aplica: quien
      tenga DAF y DMIP Operativos y registre en un formulario de DMIP lo hace como DMIP y
      se le aplica la ventana de DMIP, no la de la DAF.

      ESCRITURA GANA A APORTA cuando la persona tiene los dos papeles. Si se tomara el
      primero de la lista, el orden en que Auth devolvió sus roles decidiría lo que puede
      hacer, y el mismo usuario perdería la capacidad de registrar de una sesión a otra
      sin que nada hubiera cambiado.
    */
    const escribe = participaciones.find((fila) => fila.acceso === 'ESCRITURA');
    usuario.rol = (escribe ?? participaciones[0]).rol;

    return true;
  }
}

/** Lee el código del formulario del lugar que indica el decorador. */
function extraerCodigo(
  peticion: Request,
  ubicacion: UbicacionFormulario,
): string | undefined {
  const contenedor = peticion[ubicacion.origen] as
    | Record<string, unknown>
    | undefined;
  const valor = contenedor?.[ubicacion.propiedad];
  return typeof valor === 'string' && valor.length > 0 ? valor : undefined;
}
