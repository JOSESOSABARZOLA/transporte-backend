/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: directorio-auth.service.ts
 * Responsabilidad: Cruzar el directorio de Auth con las fichas de personal y las cuentas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-21
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE. `t_funcionario` estaba prácticamente vacía —PV-02, bloqueante del
 * negocio— y llenarla a mano significa teclear a la institución entera. Auth ya sabe quién
 * es quién; lo que no sabe es lo que este módulo necesita para convocar a alguien.
 *
 * ESTE SERVICIO NO IMPORTA NADA. Solo pone las dos listas una al lado de la otra y dice
 * **quién tiene ficha y quién no**. Crear la ficha sigue siendo un acto explícito del
 * administrador en P-07, porque hay tres datos que Auth no puede darle —área, tipo de
 * contrato y teléfono— y dos de ellos deciden reglas.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SE CRUZA POR CÉDULA, Y NO ES UNA ELECCIÓN NUEVA. Es la misma llave con la que
 * `UsuariosAdminService` enlaza una cuenta con su ficha desde M-20. Cruzar por
 * identificador de Auth sería suponer que el usuario de directorio activo es la cédula
 * —la migración `20260806160000` descartó esa suposición por escrito— y cruzar por nombre
 * es impensable en un maestro donde hay homónimos.
 *
 * Quien en Auth no tenga cédula queda fuera del cruce y se marca **sin ficha**: es
 * exactamente lo que es, y decirlo es más útil que ocultarlo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import type { RolDepartamental } from '@prisma/client';

import { FuncionariosService } from '../../talento-operativo/application/funcionarios.service';
import { UsuariosAdminService } from './usuarios-admin.service';
import {
  AuthUsuariosClient,
  type UsuarioDeAuth,
} from '../infrastructure/auth-usuarios.client';

/** La ficha local de una persona, si la tiene. */
export interface FichaDelDirectorio {
  id: number;
  apellidos: string;
  nombres: string;
  area: string;
  tipoContrato: string;
  activo: boolean;
}

/**
 * La cuenta del cuadro de una persona, si la tiene. 2026-09-01.
 *
 * NO ES LO MISMO QUE LA FICHA, y confundirlas es fácil porque las dos son «lo que ya
 * tiene aquí». La ficha (`t_funcionario`) dice que se le puede **convocar a un
 * operativo**; la cuenta (`t_usuario`) dice que puede **entrar al sistema**. Hay gente
 * con una y no la otra en los dos sentidos: un inspector sale a operativos y nunca entra
 * al cuadro; quien administra entra y no sale a ninguno.
 */
export interface CuentaDelDirectorio {
  id: number;
  roles: RolDepartamental[];
  activo: boolean;
}

/** Una persona del directorio, con lo que Auth sabe y lo que sabemos aquí. */
export interface FilaDirectorio {
  authId: number;
  cedula: string;
  nombre: string;
  usuario: string;
  correo: string;
  dependencia: string | null;
  roles: string[];
  inspector: UsuarioDeAuth['inspector'];
  /** `null` significa que esa persona **todavía no puede ser convocada**. */
  ficha: FichaDelDirectorio | null;
  /**
   * `null` significa que esa persona **todavía no puede entrar**. 2026-09-01.
   *
   * Lo pide P-11: el alta de una cuenta empieza eligiendo del directorio, igual que el
   * alta de una ficha desde el 24-AGO, y ofrecer «crear cuenta» a quien ya la tiene
   * llevaría a un rechazo al enviar el formulario en lugar de a un aviso antes.
   */
  cuenta: CuentaDelDirectorio | null;
}

@Injectable()
export class DirectorioAuthService {
  constructor(
    private readonly auth: AuthUsuariosClient,
    private readonly funcionarios: FuncionariosService,
    private readonly cuentas: UsuariosAdminService,
  ) {}

  /**
   * El directorio cruzado, **solo con los activos de Auth**.
   *
   * EL FILTRO DE ACTIVOS SE HACE AQUÍ Y NO EN EL CLIENTE. `GET /users` devuelve la
   * institución completa, bajas incluidas, y quien se dio de baja no debe aparecer en una
   * pantalla cuyo propósito es dar de alta personal. El cliente traduce lo que Auth dice;
   * decidir qué es relevante es de este servicio.
   *
   * Las fichas locales se traen **todas, incluidas las inactivas**: una persona que
   * reingresa tiene su ficha desactivada, y mostrarla como «sin ficha» llevaría a crear
   * una segunda que chocaría contra el índice único de cédula.
   */
  async consultar(tokenAuth: string): Promise<FilaDirectorio[]> {
    const [usuarios, fichas, cuentas] = await Promise.all([
      this.auth.listar(tokenAuth),
      this.funcionarios.listar({ incluirInactivos: true }),
      this.cuentas.listar(),
    ]);

    const porCedula = new Map(fichas.map((ficha) => [ficha.cedula, ficha]));

    /**
     * ═══════════════════════════════════════════════════════════════════════════════
     * LAS CUENTAS SE CRUZAN POR EL USUARIO DE AUTH, NO POR LA CÉDULA.
     *
     * `usua_identificador_ad` **es** el `username` de Auth: es la llave del canje y lo
     * único que garantiza que hablamos de la misma persona. La cédula no sirve aquí: una
     * cuenta puede no tener ficha —quien administra no sale a operativos— y entonces no
     * hay cédula por la que cruzar.
     *
     * SE INCLUYEN LAS CUENTAS DESACTIVADAS, por el mismo motivo que las fichas inactivas:
     * quien reingresa conserva su cuenta desactivada, y presentarlo como «sin cuenta»
     * llevaría a crear una segunda que chocaría contra el índice único del correo. El
     * campo `activo` deja que la pantalla lo diga con palabras.
     * ═══════════════════════════════════════════════════════════════════════════════
     */
    const porUsuarioAuth = new Map(
      cuentas
        .filter((cuenta) => cuenta.identificadorAd)
        .map((cuenta) => [cuenta.identificadorAd as string, cuenta]),
    );

    return (
      usuarios
        .filter((usuario) => usuario.activo)
        .map((usuario) => {
          const ficha = usuario.cedula
            ? porCedula.get(usuario.cedula)
            : undefined;
          const cuenta = porUsuarioAuth.get(usuario.usuario);

          return {
            authId: usuario.id,
            cedula: usuario.cedula,
            nombre: usuario.nombre,
            usuario: usuario.usuario,
            correo: usuario.correo,
            dependencia: usuario.dependencia,
            roles: usuario.roles,
            inspector: usuario.inspector,
            ficha: ficha
              ? {
                  id: ficha.id,
                  apellidos: ficha.apellidos,
                  nombres: ficha.nombres,
                  area: ficha.area,
                  tipoContrato: ficha.tipoContrato,
                  activo: ficha.activo,
                }
              : null,
            cuenta: cuenta
              ? {
                  id: cuenta.id,
                  roles: cuenta.roles.map((fila) => fila.rol),
                  activo: cuenta.activo,
                }
              : null,
          };
        })
        // Los que faltan por fichar, primero: son el trabajo pendiente de la pantalla.
        .sort((uno, otro) => {
          if (!uno.ficha && otro.ficha) return -1;
          if (uno.ficha && !otro.ficha) return 1;
          return uno.nombre.localeCompare(otro.nombre);
        })
    );
  }
}

/**
 * Parte el nombre completo de Auth en apellidos y nombres.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES UNA HEURÍSTICA, Y SE DICE. Auth guarda el nombre en **un solo campo** —`name`,
 * `VarChar(255)`— con el formato `APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2`. No hay forma de
 * separarlo con certeza: «DE LA TORRE PEREZ JUAN» rompe cualquier regla de posición.
 *
 * Se toman las dos primeras palabras como apellidos, que es **lo mismo que hace Auth** en
 * su propio módulo de inspectores. Y por eso el resultado llega al formulario como valor
 * editable, nunca como dato fijo: quien da de alta a la persona lo confirma mirándolo.
 *
 * Vive aquí, exportada, para que la use la pantalla y la prueba, y no dos veces con
 * criterios que empiecen a separarse.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function partirNombre(nombreCompleto: string): {
  apellidos: string;
  nombres: string;
} {
  const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean);

  // Con dos palabras o menos no hay nada que partir: se deja todo como apellidos y que el
  // administrador reparta. Inventar un nombre a partir de una sola palabra sería peor.
  if (partes.length <= 2) {
    return { apellidos: partes.join(' '), nombres: '' };
  }

  return {
    apellidos: partes.slice(0, 2).join(' '),
    nombres: partes.slice(2).join(' '),
  };
}
