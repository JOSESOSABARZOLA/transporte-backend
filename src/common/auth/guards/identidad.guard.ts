/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: identidad.guard.ts
 * Responsabilidad: Resolver quién realiza la petición y dejarlo en `request.user`.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05 · sesión real el 2026-08-17 · retirado el modo provisional el 2026-08-18
 *
 * SIGUE SIENDO EL ÚNICO PUNTO DONDE SE RESUELVE LA IDENTIDAD. La cadena que viene
 * después —Roles, FormularioRol y VentanaCarga— no cambió al llegar Auth central ni al
 * retirarse el modo provisional. Ver docs/FASE4-arquitectura-tecnica.md §9.
 *
 * YA NO HAY MÁS DE UNA FORMA DE AUTENTICARSE, y ése es todo el objeto de la etapa 5 de
 * `docs/PLAN_INTEGRACION_AUTH.md`. Hasta el 2026-08-18 convivían dos:
 *
 *   · la cookie de sesión que emite el canje con Auth central, y
 *   · una cabecera `x-usuario-prueba` con el identificador de un perfil simulado.
 *
 * La segunda existía porque no había identidad real. Mientras existió, **cualquiera que
 * conociera el nombre de la cabecera podía declararse DIRECTOR y ver la matriz
 * consolidada entera** con solo enviar un número, siempre que la variable de entorno
 * estuviera encendida. Era el riesgo B-01 de `17_KNOWN_ISSUES.md`, y se cierra aquí:
 * `usuarios-prueba.ts` y `MODO_IDENTIDAD_PROVISIONAL` desaparecieron del proyecto.
 *
 * ES SÍNCRONO. Verificar el token propio es aritmética sobre una firma: no toca la red,
 * ni la base, ni Redis. Cada petición del sistema pasa por aquí.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { appConfig } from '../../../config/app.config';
import { registrarIdentidad } from '../../contexto/contexto-peticion';
import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado.interface';
import { TokenInvalidoError, verificarSesion } from '../token-sesion';

/**
 * Lee una cookie ya interpretada por `cookie-parser`.
 *
 * NO SE LEE `peticion.cookies` DIRECTAMENTE. `@types/express` la declara como `any`, y
 * ese `any` se propaga por todo lo que toque: el proyecto lo tiene prohibido. Aquí se
 * acota en un solo sitio y sale tipado.
 */
function leerCookie(peticion: Request, nombre: string): string | undefined {
  const contenedor: unknown = (peticion as { cookies?: unknown }).cookies;
  if (typeof contenedor !== 'object' || contenedor === null) return undefined;

  const valor = (contenedor as Record<string, unknown>)[nombre];
  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

@Injectable()
export class IdentidadGuard implements CanActivate {
  private readonly logger = new Logger(IdentidadGuard.name);

  canActivate(contexto: ExecutionContext): boolean {
    const peticion = contexto
      .switchToHttp()
      .getRequest<Request & { user?: UsuarioAutenticado }>();

    const usuario = this.desdeCookie(peticion);

    if (!usuario) {
      throw new UnauthorizedException(
        'No se pudo identificar al usuario de la petición. Vuelva a iniciar sesión.',
      );
    }

    peticion.user = usuario;
    // Deja la identidad disponible para el registro y la auditoría sin que cada
    // servicio tenga que arrastrarla. Ver common/contexto/contexto-peticion.ts.
    // Se registra el rol de partida. Si una guarda posterior lo estrecha, la traza de
    // esta petición ya salió: es aceptable porque el contexto sirve para correlacionar,
    // y lo que se AUDITA se toma de `request.user`, que sí queda estrechado.
    registrarIdentidad(usuario.usuarioId, usuario.rol);

    return true;
  }

  /**
   * La identidad viene del token de sesión de este módulo.
   *
   * El token lo firmó `SesionService` al canjear el código de Auth central, y contiene la
   * identidad ya traducida: `usuarioId`, `rol` y `nombre` salen de `t_usuario`, **no de
   * Auth**. Auth dice quién es; el rol lo decide este sistema.
   */
  private desdeCookie(peticion: Request): UsuarioAutenticado | undefined {
    const token = leerCookie(peticion, appConfig.sesion.cookie.nombre);
    if (!token) return undefined;

    // Sin clave no hay nada que verificar, y el token NO se acepta a ciegas. Es una
    // situación ordinaria —un navegador con la cookie de una configuración anterior—, así
    // que se ignora en lugar de reventar con un 500 en cada petición.
    if (appConfig.sesion.secretoPropio.trim() === '') {
      this.logger.warn(
        'Llegó una cookie de sesión y SESSION_JWT_SECRET no está configurada: no se puede verificar y se ignora.',
      );
      return undefined;
    }

    try {
      const sesion = verificarSesion(token);

      return {
        id: String(sesion.usuarioId),
        usuarioId: sesion.usuarioId,
        // Rol de PARTIDA. Las guardas siguientes lo estrechan al que autoriza esta
        // peticion concreta. Ver la interfaz UsuarioAutenticado.
        rol: sesion.roles[0],
        nombre: sesion.nombre,
        roles: sesion.roles,
        funcionarioId: sesion.funcionarioId,
        usuarioAuth: sesion.usuarioAuth,
        // Viaja hasta aquí para que P-07 pueda consultarle el directorio a Auth. No lo
        // mira ninguna guarda: ver `UsuarioAutenticado`.
        tokenAuth: sesion.tokenAuth,
      };
    } catch (error) {
      if (error instanceof TokenInvalidoError) {
        // Nivel de depuración: una cookie vencida es lo más normal del mundo y no debe
        // llenar el registro de operación.
        this.logger.debug(`Cookie de sesión descartada: ${error.message}`);
        return undefined;
      }
      throw error;
    }
  }
}
