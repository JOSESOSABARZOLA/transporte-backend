/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: usuario-sesion.repository.ts
 * Responsabilidad: Resolver la cuenta del módulo a partir del usuario de Auth central.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-17
 *
 * AQUÍ SE APOYA TODO EL REPARTO DE RESPONSABILIDADES DE LA INTEGRACIÓN:
 * **Auth central dice QUIÉN es; el Cuadro de Colores decide QUÉ ROL tiene.**
 *
 * El rol NO se toma de los `roles` ni de los `permissions` que devuelve Auth. Aquel
 * sistema modela permisos como la tupla `(roleId, moduleId)` con `write` y `scope`;
 * éste decide con `RolDepartamental` y con `FormularioRolGuard` consultando
 * `t_formulario`. Traducir uno al otro exigiría inventar correspondencias que nadie ha
 * acordado, y este proyecto tiene prohibido inventar. Ver PLAN_INTEGRACION_AUTH.md §3.
 *
 * Es el mismo principio que ya rige el modo provisional, escrito en `usuarios-prueba.ts`:
 * el cliente indica quién dice ser, y el rol que le corresponde lo decide el servidor
 * con una tabla propia.
 *
 * SIN MIGRACIÓN. `usua_identificador_ad` existe desde la línea base precisamente para
 * esto, y `func_id` desde M-20 para las órdenes propias.
 */

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** La cuenta con sus roles. Desde el 2026-08-19 una persona puede tener varios. */
export type CuentaConRoles = Prisma.UsuarioGetPayload<{
  include: { roles: { select: { rol: true } } };
}>;

@Injectable()
export class UsuarioSesionRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /**
   * Cuenta del módulo que corresponde al usuario de Auth central.
   *
   * SE COMPARA SIN DISTINGUIR MAYÚSCULAS. Active Directory no las distingue y el
   * `username` puede llegar escrito de cualquier forma según por dónde entre el
   * usuario; una cuenta que existe y no se encuentra por la caja de una letra sería
   * indistinguible de una cuenta sin dar de alta, y el funcionario recibiría el
   * mensaje equivocado.
   *
   * Devuelve también las cuentas inactivas: quién decide qué hacer con ellas es el
   * servicio, que es el que puede explicar el motivo. Un repositorio no decide nada
   * de negocio.
   */
  async buscarPorIdentificadorAd(
    identificador: string,
  ): Promise<CuentaConRoles | null> {
    return this.prisma.usuario.findFirst({
      where: {
        identificadorAd: { equals: identificador, mode: 'insensitive' },
      },
      // Los roles vienen CON la cuenta y no en una segunda consulta: esto está en el
      // camino crítico del ingreso, y una ida más a la base por cada canje no aporta nada.
      include: { roles: { select: { rol: true } } },
    });
  }
}
