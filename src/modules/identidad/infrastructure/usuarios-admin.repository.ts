/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: usuarios-admin.repository.ts
 * Responsabilidad: Administrar las cuentas del Cuadro de Colores.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-19
 *
 * SEPARADO DE `usuario-sesion.repository.ts` A PROPÓSITO, aunque toquen la misma tabla.
 * Aquél resuelve UNA pregunta en el camino crítico del ingreso —¿qué cuenta corresponde a
 * este usuario de Auth?— y conviene que siga siendo pequeño y rápido de leer. Éste
 * administra, y sus consultas traen la ficha de personal enlazada, que al canje le sobra.
 *
 * EL ENLACE CON LA FICHA SE RESUELVE POR CÉDULA, no pidiendo el identificador interno.
 * Es lo que hacía la semilla retirada, y es mejor por un motivo comprobado: quien da de
 * alta a una persona conoce su cédula, no el `func_id`. Cuando se pedía el número, se
 * olvidaba —`ffnavarrete` quedó sin ficha y por eso P-06 no le funcionaba— y el fallo no
 * aparecía al dar de alta sino después, al intentar consultar una orden.
 */

import { Injectable } from '@nestjs/common';
import type { Prisma, RolDepartamental } from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Una cuenta con lo que la pantalla necesita mostrar. */
export type CuentaAdministrada = Prisma.UsuarioGetPayload<{
  include: {
    funcionario: {
      select: { id: true; cedula: true; apellidos: true; nombres: true };
    };
    roles: { select: { rol: true } };
  };
}>;

/** Lo que se puede fijar al dar de alta. */
export interface DatosCuenta {
  correo: string;
  nombre: string;
  /** Uno o varios. La tabla de unión los guarda; el par (usuario, rol) es único. */
  roles: RolDepartamental[];
  identificadorAd: string | null;
  funcionarioId: number | null;
}

/** Lo que se puede cambiar después. El correo no: es la llave natural de la cuenta. */
export interface CambiosCuenta {
  nombre?: string;
  identificadorAd?: string | null;
  funcionarioId?: number | null;
  activo?: boolean;
}

const CON_FICHA = {
  funcionario: {
    select: { id: true, cedula: true, apellidos: true, nombres: true },
  },
  roles: { select: { rol: true }, orderBy: { rol: 'asc' } },
} satisfies Prisma.UsuarioInclude;

@Injectable()
export class UsuariosAdminRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Todas, incluidas las inactivas: la pantalla las distingue y permite reactivarlas. */
  async listar(): Promise<CuentaAdministrada[]> {
    return this.prisma.usuario.findMany({
      include: CON_FICHA,
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    });
  }

  async buscarPorId(
    id: number,
    cliente: Prisma.TransactionClient = this.prisma,
  ): Promise<CuentaAdministrada | null> {
    return cliente.usuario.findUnique({ where: { id }, include: CON_FICHA });
  }

  async buscarPorCorreo(correo: string): Promise<CuentaAdministrada | null> {
    return this.prisma.usuario.findUnique({
      where: { correo },
      include: CON_FICHA,
    });
  }

  /**
   * Busca por el usuario de Auth.
   *
   * `identificadorAd` es único desde la etapa 3 de la integración: dos cuentas con el
   * mismo harían que el ingreso resolviera a una cualquiera. Se comprueba antes de
   * escribir para dar un mensaje que el administrador entienda, en lugar de una
   * violación de restricción.
   */
  async buscarPorIdentificadorAd(
    identificadorAd: string,
  ): Promise<CuentaAdministrada | null> {
    return this.prisma.usuario.findUnique({
      where: { identificadorAd },
      include: CON_FICHA,
    });
  }

  /** Ficha de personal por cédula. Devuelve `null` si esa cédula no está registrada. */
  async fichaPorCedula(
    cedula: string,
  ): Promise<{ id: number; apellidos: string; nombres: string } | null> {
    return this.prisma.funcionario.findUnique({
      where: { cedula },
      select: { id: true, apellidos: true, nombres: true },
    });
  }

  /** La cuenta que ya ocupa esa ficha, si la hay. `func_id` es único. */
  async cuentaConFicha(
    funcionarioId: number,
  ): Promise<{ id: number; nombre: string } | null> {
    return this.prisma.usuario.findUnique({
      where: { funcionarioId },
      select: { id: true, nombre: true },
    });
  }

  async crear(
    datos: DatosCuenta,
    cliente: Prisma.TransactionClient = this.prisma,
  ): Promise<CuentaAdministrada> {
    const { roles, ...cuenta } = datos;
    return cliente.usuario.create({
      data: { ...cuenta, roles: { create: roles.map((rol) => ({ rol })) } },
      include: CON_FICHA,
    });
  }

  /**
   * Reemplaza el conjunto de roles de una cuenta.
   *
   * SE BORRA Y SE VUELVE A CREAR, en lugar de calcular altas y bajas. Es una tabla de dos
   * columnas con clave primaria compuesta y a lo sumo siete filas por persona: la
   * diferencia de coste es nula y el borrado deja el conjunto exactamente en lo pedido,
   * sin depender de que el cálculo de diferencias esté bien.
   *
   * VA DENTRO DE LA TRANSACCIÓN de quien llama: entre el borrado y el alta, esa cuenta
   * no tiene ningún rol, y una sesión que se resolviera en ese instante la vería sin
   * poder hacer nada.
   */
  async reemplazarRoles(
    id: number,
    roles: RolDepartamental[],
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.usuarioRol.deleteMany({ where: { usuarioId: id } });
    await cliente.usuarioRol.createMany({
      data: roles.map((rol) => ({ usuarioId: id, rol })),
    });
  }

  async actualizar(
    id: number,
    cambios: CambiosCuenta,
    cliente: Prisma.TransactionClient = this.prisma,
  ): Promise<CuentaAdministrada> {
    return cliente.usuario.update({
      where: { id },
      data: cambios,
      include: CON_FICHA,
    });
  }

  /**
   * Baja LÓGICA, nunca borrado.
   *
   * Las 1 172 filas de auditoría guardan el identificador de quien hizo cada cambio.
   * Borrar la cuenta dejaría esas trazas apuntando a nadie, y la auditoría es evidencia.
   */
  async desactivar(
    id: number,
    cliente: Prisma.TransactionClient = this.prisma,
  ): Promise<CuentaAdministrada> {
    return cliente.usuario.update({
      where: { id },
      data: { activo: false },
      include: CON_FICHA,
    });
  }
}
