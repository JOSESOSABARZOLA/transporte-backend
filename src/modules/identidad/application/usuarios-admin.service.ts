/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: usuarios-admin.service.ts
 * Responsabilidad: Gobernar el alta y el mantenimiento de las cuentas del módulo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-19
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE. Hasta el 2026-08-19 las cuentas se sembraban desde
 * `prisma/insumos/usuarios-cuadro.json`. Al retirar la semilla, dar de alta a alguien se
 * volvió una sentencia SQL escrita a mano, y eso no es aceptable para una operación que
 * decide QUIÉN entra y CON QUÉ ROL: equivocarse hacia DIRECTOR da acceso a la matriz
 * consolidada entera.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * TRES COMPROBACIONES QUE SE HACEN AQUÍ Y NO EN LA BASE, porque el mensaje importa:
 *
 *   · Correo repetido, identificador de Auth repetido y ficha ya ocupada tienen índice
 *     único en la base, así que están garantizados igualmente. Pero una violación de
 *     restricción llega al administrador como un error del motor; comprobarlo antes
 *     permite decir qué cuenta lo ocupa y qué hacer.
 *
 * LA CÉDULA SE RESUELVE CONTRA `t_funcionario`, y si no existe se rechaza el alta en
 * lugar de guardar la cuenta sin ficha. Es la diferencia entre enterarse ahora o cuando
 * esa persona no pueda ver sus órdenes de servicio.
 */

import { Injectable } from '@nestjs/common';
import { RolDepartamental } from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import {
  UsuariosAdminRepository,
  type CambiosCuenta,
  type CuentaAdministrada,
} from '../infrastructure/usuarios-admin.repository';

/** Lo que la pantalla envía al dar de alta. */
export interface AltaCuenta {
  correo: string;
  nombre: string;
  /** Uno o varios. El negocio decidió el 2026-08-19 que valen todos a la vez. */
  roles: RolDepartamental[];
  identificadorAd: string | null;
  /** Cédula de la ficha de personal. Se resuelve aquí; `null` si la persona no sale a operativos. */
  funcionarioCedula: string | null;
}

/** Lo que la pantalla envía al editar. El correo no se cambia: es la llave natural. */
export interface EdicionCuenta {
  nombre?: string;
  /** Si viene, REEMPLAZA el conjunto entero. No se añade ni se quita de uno en uno. */
  roles?: RolDepartamental[];
  identificadorAd?: string | null;
  funcionarioCedula?: string | null;
  activo?: boolean;
}

@Injectable()
export class UsuariosAdminService {
  constructor(
    private readonly repositorio: UsuariosAdminRepository,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(): Promise<CuentaAdministrada[]> {
    return this.repositorio.listar();
  }

  async crear(
    usuarioId: number,
    rolUsuario: RolDepartamental,
    datos: AltaCuenta,
  ): Promise<CuentaAdministrada> {
    await this.exigirCorreoLibre(datos.correo);
    await this.exigirIdentificadorLibre(datos.identificadorAd, null);
    const funcionarioId = await this.resolverFicha(
      datos.funcionarioCedula,
      null,
    );

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const creada = await this.repositorio.crear(
        {
          correo: datos.correo,
          nombre: datos.nombre,
          roles: datos.roles,
          identificadorAd: datos.identificadorAd,
          funcionarioId,
        },
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_usuario',
          entidadId: creada.id,
          accion: 'CREAR',
          usuario: usuarioId,
          rol: rolUsuario,
          cambios: [
            { campo: 'correo', valorNuevo: creada.correo },
            {
              campo: 'roles',
              valorNuevo: creada.roles.map((r) => r.rol).join(', '),
            },
            {
              campo: 'identificadorAd',
              valorNuevo: creada.identificadorAd ?? '',
            },
          ],
        },
        cliente,
      );

      return creada;
    });
  }

  async actualizar(
    usuarioId: number,
    rolUsuario: RolDepartamental,
    id: number,
    cambios: EdicionCuenta,
  ): Promise<CuentaAdministrada> {
    const previa = await this.exigir(id);

    if (cambios.identificadorAd !== undefined) {
      await this.exigirIdentificadorLibre(cambios.identificadorAd, id);
    }

    const aEscribir: CambiosCuenta = {
      nombre: cambios.nombre,
      identificadorAd: cambios.identificadorAd,
      activo: cambios.activo,
    };

    // `undefined` significa «no lo toques»; `null` significa «déjalo sin ficha».
    if (cambios.funcionarioCedula !== undefined) {
      aEscribir.funcionarioId = await this.resolverFicha(
        cambios.funcionarioCedula,
        id,
      );
    }

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      await this.repositorio.actualizar(id, aEscribir, cliente);

      // Los roles se reemplazan dentro de la MISMA transacción: entre el borrado y el
      // alta esa cuenta no tiene ninguno, y una sesión que se resolviera en ese instante
      // la vería sin poder hacer nada.
      if (cambios.roles !== undefined) {
        await this.repositorio.reemplazarRoles(id, cambios.roles, cliente);
      }

      // Se relee para devolver los roles ya reemplazados: el `update` anterior trae los
      // de antes, porque se ejecutó antes del reemplazo.
      const actualizada = (await this.repositorio.buscarPorId(id, cliente))!;

      await this.auditoria.registrar(
        {
          entidad: 't_usuario',
          entidadId: id,
          accion: 'ACTUALIZAR',
          usuario: usuarioId,
          rol: rolUsuario,
          cambios: [
            {
              campo: 'nombre',
              valorAnterior: previa.nombre,
              valorNuevo: actualizada.nombre,
            },
            {
              campo: 'roles',
              valorAnterior: previa.roles.map((r) => r.rol).join(', '),
              valorNuevo: actualizada.roles.map((r) => r.rol).join(', '),
            },
            {
              campo: 'identificadorAd',
              valorAnterior: previa.identificadorAd ?? '',
              valorNuevo: actualizada.identificadorAd ?? '',
            },
            {
              campo: 'activo',
              valorAnterior: String(previa.activo),
              valorNuevo: String(actualizada.activo),
            },
          ],
        },
        cliente,
      );

      return actualizada;
    });
  }

  async desactivar(
    usuarioId: number,
    rolUsuario: RolDepartamental,
    id: number,
  ): Promise<CuentaAdministrada> {
    await this.exigir(id);

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const desactivada = await this.repositorio.desactivar(id, cliente);

      await this.auditoria.registrar(
        {
          entidad: 't_usuario',
          entidadId: id,
          accion: 'ELIMINAR',
          usuario: usuarioId,
          rol: rolUsuario,
          cambios: [
            { campo: 'activo', valorAnterior: 'true', valorNuevo: 'false' },
          ],
        },
        cliente,
      );

      return desactivada;
    });
  }

  private async exigir(id: number): Promise<CuentaAdministrada> {
    const cuenta = await this.repositorio.buscarPorId(id);
    if (!cuenta) {
      throw new RecursoNoEncontradoError(
        'Esa cuenta no existe. Quizá la eliminó otra persona mientras usted la editaba.',
        { id },
      );
    }
    return cuenta;
  }

  private async exigirCorreoLibre(correo: string): Promise<void> {
    const ocupado = await this.repositorio.buscarPorCorreo(correo);
    if (ocupado) {
      throw new ValidacionError(
        `El correo ${correo} ya pertenece a la cuenta de ${ocupado.nombre}. ` +
          'Si esa persona cambió de área, edite su cuenta en lugar de crear otra.',
        { correo },
      );
    }
  }

  /**
   * El usuario de Auth no puede repetirse.
   *
   * Si dos cuentas lo tuvieran, el canje resolvería a una cualquiera y esa persona
   * entraría con el rol de otra. La base lo impide con un índice único desde la etapa 3;
   * aquí se comprueba para poder decir CUÁL lo ocupa.
   */
  private async exigirIdentificadorLibre(
    identificadorAd: string | null | undefined,
    idPropio: number | null,
  ): Promise<void> {
    if (!identificadorAd) return;

    const ocupado =
      await this.repositorio.buscarPorIdentificadorAd(identificadorAd);
    if (ocupado && ocupado.id !== idPropio) {
      throw new ValidacionError(
        `El usuario de Auth «${identificadorAd}» ya está asignado a la cuenta de ${ocupado.nombre}. ` +
          'Dos cuentas con el mismo usuario harían que el ingreso resolviera a una cualquiera.',
        { identificadorAd },
      );
    }
  }

  /**
   * Cédula → identificador de la ficha.
   *
   * Devuelve `null` cuando no se indica cédula, que es lo correcto para quien no sale a
   * operativos: Dirección y administración no reciben órdenes de servicio.
   */
  private async resolverFicha(
    cedula: string | null | undefined,
    idPropio: number | null,
  ): Promise<number | null> {
    if (!cedula) return null;

    const ficha = await this.repositorio.fichaPorCedula(cedula);
    if (!ficha) {
      throw new ValidacionError(
        `No hay ninguna ficha de personal con la cédula ${cedula}. ` +
          'Regístrela primero en Personal y disponibilidad, o deje el campo vacío si esa persona no sale a operativos.',
        { cedula },
      );
    }

    const ocupada = await this.repositorio.cuentaConFicha(ficha.id);
    if (ocupada && ocupada.id !== idPropio) {
      throw new ValidacionError(
        `La ficha de ${ficha.apellidos} ${ficha.nombres} ya está enlazada a la cuenta de ${ocupada.nombre}. ` +
          'Una ficha corresponde a una sola cuenta.',
        { cedula },
      );
    }

    return ficha.id;
  }
}
