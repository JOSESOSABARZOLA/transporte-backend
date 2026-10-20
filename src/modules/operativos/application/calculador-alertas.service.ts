/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de personal y alertas
 * Archivo: calculador-alertas.service.ts
 * Responsabilidad: Recalcular y persistir las alertas del operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * POL-06. El reparto es el mismo de M-12: este servicio **reúne y guarda**, y
 * `alertas-operativo.ts` **decide**, sin tocar nada externo.
 *
 * SE RECALCULAN COMPLETAS ANTE CUALQUIER CAMBIO. Se invoca al registrar, al editar, al
 * asignar personal, al retirarlo y —desde M-17— al asignar transporte. Nunca se
 * actualiza una alerta suelta: se sustituye el conjunto entero.
 *
 * Mantenerlas de forma incremental es lo que produce estados residuales, que es el
 * defecto que hoy tiene el cuadro en Excel: la celda sigue amarilla después de que el
 * dato se completó. RN-55 exige que la alerta desaparezca sola, y la única forma de
 * garantizarlo es no llevar estado.
 *
 * SE ESCRIBE DENTRO DE LA TRANSACCIÓN de la operación que lo provoca. Si el registro se
 * deshace, sus alertas también: un operativo que no existe no puede tener alertas, y una
 * proyección que sobrevive a su origen es peor que ninguna.
 */

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  OperativosRepository,
  type OperativoCompleto,
} from '../infrastructure/operativos.repository';
import { calcularAlertas, type Alerta } from './politicas/alertas-operativo';

@Injectable()
export class CalculadorAlertasService {
  constructor(private readonly repositorio: OperativosRepository) {}

  /**
   * Deriva las alertas del operativo y las guarda.
   *
   * @param operativo estado ya cargado, **posterior** al cambio que motiva el recálculo
   * @param cliente cliente de la transacción en curso
   * @returns las alertas resultantes, para poder afirmarlas y registrarlas
   */
  async recalcular(
    operativo: OperativoCompleto,
    cliente: Prisma.TransactionClient,
  ): Promise<Alerta[]> {
    const alertas = this.derivar(operativo);

    await this.repositorio.guardarAlertas(
      operativo.id,
      alertas as unknown as Prisma.InputJsonValue,
      alertas.length > 0,
      cliente,
    );

    return alertas;
  }

  /**
   * El cálculo, sin escribir. Publicado para que M-22 pueda previsualizar y para que la
   * prueba compruebe la derivación sin base de datos.
   */
  derivar(operativo: OperativoCompleto): Alerta[] {
    return calcularAlertas({
      personasAsignadas: operativo.personal.length,
      politicaVehiculo: operativo.formulario.politicaVehiculo,
      estadoTransporte: operativo.estadoTransporte,
      condicionanteNocturno: operativo.formulario.condicionanteNoct,
      esNocturno: operativo.esNocturno,
      puntoLibre: operativo.puntoLibre,
      tipoLibre: operativo.tipoLibre,
      tipoTransporte: operativo.tipoTransporte,
      transporteLiberado: Boolean(operativo.transporteLiberadoEn),
    });
  }
}
