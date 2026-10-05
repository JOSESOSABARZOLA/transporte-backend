/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Homologación de roles
 * Archivo: roles-auth.service.ts
 * Responsabilidad: Gobernar la correspondencia entre los roles de Auth central y los del módulo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-19
 *
 * QUÉ SE PUEDE HACER AQUÍ Y QUÉ NO, porque la distinción es el fondo de esta pieza:
 *
 *   · Registrar un rol de Auth que corresponda a un rol que YA existe en el módulo es un
 *     alta. Si mañana Auth separa la DAF en dos zonas, son dos filas apuntando a `DAF`.
 *     No hace falta migración ni desplegar.
 *
 *   · Un actor genuinamente NUEVO —un «Auditor» que solo lee— NO se crea desde aquí, y
 *     no es una limitación que haya que sortear: un rol del módulo necesita que alguien
 *     defina qué formularios posee, si tiene ventana de carga y qué le permiten las
 *     cuatro guardas. Si bastara una fila, existirían roles cuyo comportamiento no está
 *     escrito en ninguna parte y las guardas los tratarían como desconocidos.
 *
 * LA AUDITORÍA SE ESCRIBE DENTRO DE LA TRANSACCIÓN, como toda escritura del módulo: una
 * evidencia que puede perderse ante un fallo parcial no sirve como evidencia (DA-09).
 */

import { Injectable } from '@nestjs/common';
import { RolDepartamental, type RolAuth } from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import {
  RolesAuthRepository,
  type CambiosRolAuth,
} from '../infrastructure/roles-auth.repository';

/** Lo que ve la pantalla de administración: la correspondencia y sus huecos. */
export interface PanoramaRolesAuth {
  correspondencias: RolAuth[];
  /** Roles del módulo sin rol de Auth activo. Hoy: `FUNCIONARIO`. */
  sinCorrespondencia: RolDepartamental[];
}

@Injectable()
export class RolesAuthService {
  constructor(
    private readonly repositorio: RolesAuthRepository,
    private readonly auditoria: AuditoriaService,
  ) {}

  async consultar(): Promise<PanoramaRolesAuth> {
    const [correspondencias, sinCorrespondencia] = await Promise.all([
      this.repositorio.listar(),
      this.repositorio.rolesSinCorrespondencia(),
    ]);
    return { correspondencias, sinCorrespondencia };
  }

  async crear(
    usuarioId: number,
    rolUsuario: RolDepartamental,
    datos: {
      idAuth: number;
      nombreAuth: string;
      rol: RolDepartamental;
      subsistema: number;
    },
  ): Promise<RolAuth> {
    const existente = await this.repositorio.buscarPorIdAuth(datos.idAuth);
    if (existente) {
      // El inventario de códigos de negocio es CERRADO —quince— y ninguno describe esto.
      // Ampliarlo es una decisión que no corresponde a esta pieza: un identificador que
      // ya existe es un dato de entrada inválido, y `ValidacionError` es exactamente eso.
      throw new ValidacionError(
        `El identificador ${datos.idAuth} ya está registrado y corresponde a ${existente.rol}. ` +
          'Si el rol cambió de significado en Auth, edite la correspondencia en lugar de crear otra.',
        { idAuth: datos.idAuth },
      );
    }

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const creado = await this.repositorio.crear(datos, cliente);
      await this.auditoria.registrar(
        {
          entidad: 't_rol_auth',
          entidadId: creado.idAuth,
          accion: 'CREAR',
          usuario: usuarioId,
          rol: rolUsuario,
          cambios: [
            { campo: 'nombreAuth', valorNuevo: creado.nombreAuth },
            { campo: 'rol', valorNuevo: creado.rol },
          ],
        },
        cliente,
      );
      return creado;
    });
  }

  async actualizar(
    usuarioId: number,
    rolUsuario: RolDepartamental,
    idAuth: number,
    cambios: CambiosRolAuth,
  ): Promise<RolAuth> {
    const previo = await this.exigir(idAuth);

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const actualizado = await this.repositorio.actualizar(
        idAuth,
        cambios,
        cliente,
      );
      await this.auditoria.registrar(
        {
          entidad: 't_rol_auth',
          entidadId: idAuth,
          accion: 'ACTUALIZAR',
          usuario: usuarioId,
          rol: rolUsuario,
          cambios: [
            {
              campo: 'nombreAuth',
              valorAnterior: previo.nombreAuth,
              valorNuevo: actualizado.nombreAuth,
            },
            {
              campo: 'rol',
              valorAnterior: previo.rol,
              valorNuevo: actualizado.rol,
            },
            {
              campo: 'activo',
              valorAnterior: String(previo.activo),
              valorNuevo: String(actualizado.activo),
            },
          ],
        },
        cliente,
      );
      return actualizado;
    });
  }

  /**
   * Baja lógica.
   *
   * SE AVISA SI ES LA ÚLTIMA de su rol, y no se impide: puede ser precisamente lo que el
   * administrador quiere al retirar un rol de Auth. Pero desactivar la única
   * correspondencia de, por ejemplo, `DIRECTOR` deja a ese perfil sin forma de entrar, y
   * eso debe verse antes y no descubrirse cuando alguien no puede trabajar.
   */
  async desactivar(
    usuarioId: number,
    rolUsuario: RolDepartamental,
    idAuth: number,
  ): Promise<{ rolAuth: RolAuth; eraLaUnica: boolean }> {
    const previo = await this.exigir(idAuth);

    const correspondencias = await this.repositorio.listar();
    const eraLaUnica =
      correspondencias.filter((c) => c.rol === previo.rol && c.activo)
        .length === 1;

    const rolAuth = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const desactivado = await this.repositorio.desactivar(idAuth, cliente);
        await this.auditoria.registrar(
          {
            entidad: 't_rol_auth',
            entidadId: idAuth,
            accion: 'ELIMINAR',
            usuario: usuarioId,
            rol: rolUsuario,
            cambios: [
              { campo: 'activo', valorAnterior: 'true', valorNuevo: 'false' },
            ],
          },
          cliente,
        );
        return desactivado;
      },
    );

    return { rolAuth, eraLaUnica };
  }

  private async exigir(idAuth: number): Promise<RolAuth> {
    const fila = await this.repositorio.buscarPorIdAuth(idAuth);
    if (!fila) {
      throw new RecursoNoEncontradoError(
        `No existe una correspondencia registrada para el rol ${idAuth} de Auth central.`,
        { idAuth },
      );
    }
    return fila;
  }
}
