/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: ventana-carga.guard.ts
 * Responsabilidad: Impedir la escritura fuera de la ventana horaria del rol.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * VAL-26 y RN-56. Responde con 423 y NO con 403 a propósito: el rol sí tiene
 * permiso, lo que no tiene es el momento. El mensaje indica cuándo vuelve a abrirse,
 * conforme al criterio de redacción de FASE2 §19.5.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { VentanaCerradaError } from '../../errors/errores-dominio';
import { horaEnZona } from '../../utilidades/marca-tiempo';
import {
  horarioDeVentana,
  mensajeParaFuncionario,
  minutosDelDia,
} from '../application/horario-ventana';
import { resolverMensajeVentana } from '../application/mensaje-ventana';
import { VentanaCargaEvaluador } from '../application/ventana-carga.evaluador';
import { VentanaCargaRepository } from '../infrastructure/ventana-carga.repository';
import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado.interface';

/** Métodos que modifican estado y por tanto quedan sujetos a la ventana. */
const METODOS_ESCRITURA = ['POST', 'PATCH', 'PUT', 'DELETE'];

@Injectable()
export class VentanaCargaGuard implements CanActivate {
  constructor(
    private readonly repositorio: VentanaCargaRepository,
    private readonly evaluador: VentanaCargaEvaluador,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const peticion = contexto
      .switchToHttp()
      .getRequest<Request & { user?: UsuarioAutenticado }>();

    // La ventana restringe la escritura. La consulta no se limita nunca: la
    // Dirección debe poder revisar el cuadro a cualquier hora.
    if (!METODOS_ESCRITURA.includes(peticion.method)) {
      return true;
    }

    const usuario = peticion.user;
    if (!usuario) {
      // Falla CERRADA. Antes devolvía `true`, dando por hecho que `IdentidadGuard` se
      // había ejecutado antes; un endpoint que declarara esta guarda sin aquella, o en
      // otro orden, habría admitido escrituras sin ventana y sin identidad. Es el
      // mismo criterio que ya aplicaba `FormularioRolGuard`.
      throw new ForbiddenException('La identidad no está resuelta.');
    }

    const ventana = await this.repositorio.buscarPorRol(usuario.rol);
    const veredicto = this.evaluador.evaluar(ventana);

    if (!veredicto.puedeEscribir && ventana) {
      /*
        EL MENSAJE SE COMPONE DE LAS HORAS REALES (2026-10-06). Antes era `vcar_mensaje_cierre`, un
        texto libre que no se movía al mover las horas y contradecía a la pantalla («15H00 a 16H30»
        con la ventana en 18H25). El texto del administrador viaja aparte, como nota (RN-56).
      */
      const todas = await this.repositorio.listar();
      // Desde el 2026-10-07 manda el mensaje del administrador con sus marcadores resueltos
      // ({cierre}/{apertura}), salvo que diga una hora que no es: ahí, el calculado.
      const mensaje = mensajeParaFuncionario(
        ventana,
        todas,
        minutosDelDia(horaEnZona(new Date(), ventana.zonaHoraria)),
        veredicto.finDeSemana,
      );
      throw new VentanaCerradaError(mensaje, {
        rol: usuario.rol,
        horaCierre: veredicto.horaCierre,
        horaApertura: veredicto.horaApertura,
        horarioTexto: horarioDeVentana(ventana, todas).texto,
        notaAdministrador: resolverMensajeVentana(
          ventana.mensajeCierre,
          ventana.horaApertura,
          ventana.horaCierre,
        ),
      });
    }

    if (!veredicto.puedeEscribir) {
      throw new VentanaCerradaError(
        veredicto.motivo ??
          'La ventana de carga de su departamento está cerrada.',
        {
          rol: usuario.rol,
          horaCierre: veredicto.horaCierre,
          horaApertura: veredicto.horaApertura,
        },
      );
    }

    return true;
  }
}
