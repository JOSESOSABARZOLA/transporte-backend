/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Cuadro diario
 * Archivo: cuadro-diario.repository.ts
 * Responsabilidad: Leer y escribir la jornada, y comprobar lo que impide cerrarla.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EL CUADRO NO CONTIENE A LOS OPERATIVOS (hallazgo HAL-02). Si los contuviera, cada
 * registro competiría con los otros dos departamentos que escriben en paralelo: tres
 * asistentes cargando a la vez sobre el mismo agregado se bloquearían entre sí a las
 * 14H50, que es justo cuando más prisa tienen. El cuadro gobierna el ciclo de vida; los
 * operativos son suyos por referencia.
 *
 * LEE `t_operativo` PARA DOS PREGUNTAS, Y SOLO PARA ESAS DOS:
 *
 *   1. Si queda algún operativo con condicionante nocturno y transporte pendiente
 *      (INV-11).
 *   2. Si queda alguna patrulla de formulario compartido sin una sola persona puesta
 *      por el departamento que aporta (2026-08-25).
 *
 * Es la misma licencia declarada en M-11 y M-12 —una lectura de solo lectura, sin
 * importar repositorios ajenos— y sin ella el cierre no podría verificar lo que el
 * negocio exige verificar al cerrar.
 */

import { Injectable } from '@nestjs/common';
import {
  EstadoCuadro,
  EstadoTransporte,
  type CuadroDiario,
  type Prisma,
  type RolDepartamental,
} from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Operativo de formulario compartido sin una sola persona del departamento que aporta.
 *
 * Lleva el nombre del formulario y el rol porque el mensaje del cierre tiene que decir
 * **a quién hay que llamar**: la Dirección no puede resolverlo por su cuenta.
 */
export interface OperativoSinAporte {
  identificador: string;
  formularioNombre: string;
  rolCompartido: RolDepartamental;
}

/** Operativo que impide cerrar la jornada. INV-11. */
export interface OperativoSinTransporte {
  identificador: string;
  horaInicio: string;
  horaFin: string;
}

@Injectable()
export class CuadroDiarioRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async buscarPorFecha(fecha: Date): Promise<CuadroDiario | null> {
    return this.prisma.cuadroDiario.findUnique({ where: { fecha } });
  }

  // `buscarPorOrdenTrabajo` se retiró al resolverse PV-28 (2026-08-07): la orden de
  // trabajo pasó a derivarse de la fecha, que ya es única, así que la comprobación de
  // duplicados no podía ejecutarse nunca. El índice `uq_cuadro_orden` se conserva: sigue
  // siendo cierto que no puede haber dos, y ahora lo garantiza la base sin que nadie
  // tenga que acordarse.

  async crear(
    datos: {
      fecha: Date;
      ordenTrabajo: string;
      nroSemana: number;
      anioSemana: number;
    },
    cliente: Prisma.TransactionClient,
  ): Promise<CuadroDiario> {
    return cliente.cuadroDiario.create({ data: datos });
  }

  async actualizarEstado(
    fecha: Date,
    datos: {
      estado: EstadoCuadro;
      cerradoPor?: number | null;
      cerradoEn?: Date | null;
      reaperturas?: number;
    },
    cliente: Prisma.TransactionClient,
  ): Promise<CuadroDiario> {
    return cliente.cuadroDiario.update({ where: { fecha }, data: datos });
  }

  /**
   * INV-11. Operativos con condicionante nocturno que siguen sin transporte.
   *
   * Tres condiciones a la vez: el formulario tiene el condicionante, el horario
   * intersecta la franja —`oper_es_nocturno`, derivado al registrar— y la asignación
   * sigue pendiente. Los tres se consultan en la base y no en memoria: al cerrar puede
   * haber cincuenta operativos y solo interesan los que fallan.
   *
   * `activo: true` y era una omisión grave: un operativo nocturno **retirado** del cuadro
   * seguía impidiendo cerrar la jornada, y no había manera de resolverlo. La bandeja de
   * la DAF sí filtra los retirados, así que el operativo que bloqueaba el cierre no
   * aparecía en la única pantalla donde se le podía asignar transporte.
   */
  async operativosConCondicionantePendiente(
    fecha: Date,
  ): Promise<OperativoSinTransporte[]> {
    return this.prisma.operativo.findMany({
      where: {
        activo: true,
        cuadro: { fecha },
        esNocturno: true,
        estadoTransporte: EstadoTransporte.PENDIENTE,
        formulario: { condicionanteNoct: true },
      },
      select: { identificador: true, horaInicio: true, horaFin: true },
      orderBy: { identificador: 'asc' },
    });
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * OPERATIVOS DE FORMULARIO COMPARTIDO A LOS QUE LES FALTA EL APORTE. 2026-08-25.
   *
   * El negocio fijó que en la patrulla ECU el DMIT aporta **de una a dos** personas de
   * Instrucción. El máximo lo aplica `composicion-personal.ts` al asignar; el mínimo no
   * puede aplicarse ahí —rechazaría siempre a la primera persona, que por definición
   * deja la composición incompleta— y por eso se comprueba al cerrar, igual que INV-11
   * y por la misma razón que declara PV-05: el aporte llega después del registro.
   *
   * SE CUENTA A QUIEN APORTÓ EL ROL COMPARTIDO, no a quien sea del área. Que DMIP
   * Operativos ponga por su cuenta a alguien de Instrucción no es el aporte del DMIT:
   * `aper_asignado_por_rol` existe para distinguirlo, y el cupo del máximo cuenta con
   * ese mismo criterio. Medir el mínimo de otro modo haría que las dos mitades de la
   * misma regla contaran cosas distintas.
   *
   * Los formularios sin rol compartido —siete de los nueve— no entran en la consulta.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async operativosSinAporteCompartido(
    fecha: Date,
  ): Promise<OperativoSinAporte[]> {
    const candidatos = await this.prisma.operativo.findMany({
      where: {
        activo: true,
        cuadro: { fecha },
        formulario: { roles: { some: { acceso: 'APORTA' } } },
      },
      select: {
        identificador: true,
        formulario: {
          select: {
            nombre: true,
            roles: { where: { acceso: 'APORTA' }, select: { rol: true } },
          },
        },
        personal: { select: { asignadoPorRol: true } },
      },
      orderBy: { identificador: 'asc' },
    });

    /*
      UN FORMULARIO PUEDE TENER VARIOS QUE APORTEN. Hoy ninguno los tiene —solo el 6, con
      uno—, pero el modelo lo admite desde el 2026-08-25 y contar solo el primero dejaría
      pasar en silencio al segundo el día que lo haya.
    */
    return candidatos.flatMap((operativo) =>
      operativo.formulario.roles
        .filter(
          (participante) =>
            !operativo.personal.some(
              (fila) => fila.asignadoPorRol === participante.rol,
            ),
        )
        .map((participante) => ({
          identificador: operativo.identificador,
          formularioNombre: operativo.formulario.nombre,
          rolCompartido: participante.rol,
        })),
    );
  }

  /**
   * Cuántos operativos tiene la jornada. Para el registro del cierre.
   *
   * Los retirados no cuentan: el acta del cierre dice cuántos operativos **quedaron** en
   * el cuadro, y uno dado de baja no quedó.
   */
  async contarOperativos(fecha: Date): Promise<number> {
    return this.prisma.operativo.count({
      where: { activo: true, cuadro: { fecha } },
    });
  }
}
