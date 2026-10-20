/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: correo-institucional-auth.service.ts
 * Responsabilidad: Tomar de Auth central el correo institucional de una persona, por su cédula.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL CORREO INSTITUCIONAL LO PONE AUTH, NO EL NAVEGADOR. Rediseño de P-07 (2026-10-08).
 *
 * Hasta hoy el alta desde el directorio mandaba el correo que el navegador había leído de
 * Auth, y el servidor lo guardaba tal cual: quien manipulara la petición podía dejar en la
 * ficha un correo que no es el de la cuenta institucional de esa persona. Ahora, en un alta
 * de origen AUTH, el servidor vuelve a preguntar a Auth —con el token de la sesión, que es la
 * única credencial que Auth acepta— y usa lo que Auth dice. Lo que mande el cliente se ignora.
 *
 * VIVE EN SU PROPIO MÓDULO (`AuthDirectorioModule`) para que `talento-operativo` lo use sin
 * importar `IdentidadModule`, que ya importa a `talento-operativo`: así no hay ciclo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../common/errors/application.error';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  AuthNoDisponibleError,
  AuthUsuariosClient,
} from '../infrastructure/auth-usuarios.client';

@Injectable()
export class CorreoInstitucionalAuthService {
  constructor(private readonly auth: AuthUsuariosClient) {}

  /**
   * El correo institucional de la persona ACTIVA de Auth con esa cédula, en minúsculas.
   *
   * - Sin token (sesión anterior al 2026-08-21) o Auth caído → 503 (`AUTH_NO_DISPONIBLE`):
   *   el alta manual sigue disponible y la pantalla lo puede decir.
   * - Auth responde pero no tiene a esa persona activa, o la tiene sin correo → 422
   *   (`PERSONA_NO_ENCONTRADA_EN_AUTH`): la petición no es procesable tal como viene.
   *
   * El token NO se registra en la bitácora ni sale de aquí hacia otro destino que Auth.
   */
  async correoPorCedula(
    cedula: string,
    tokenAuth: string | null | undefined,
  ): Promise<string> {
    if (!tokenAuth) {
      throw new AuthNoDisponibleError(
        'Su sesión se abrió antes de que el módulo pudiera consultar Auth central. Vuelva a entrar desde el portal institucional, o registre la ficha a mano.',
      );
    }

    const usuarios = await this.auth.listar(tokenAuth);
    const persona = usuarios.find(
      (usuario) => usuario.activo && usuario.cedula === cedula,
    );
    const correo = persona?.correo.trim().toLowerCase() ?? '';

    if (!persona || correo === '') {
      throw new ApplicationError(
        persona
          ? `La cuenta de Auth central con cédula ${cedula} no tiene correo institucional. Corríjalo en Auth central o registre la ficha a mano.`
          : `Auth central no tiene una cuenta activa con la cédula ${cedula}. Vuelva a buscar a la persona o registre la ficha a mano.`,
        422,
        CODIGOS_ERROR.PERSONA_NO_ENCONTRADA_EN_AUTH,
        { cedula },
      );
    }

    return correo;
  }
}
