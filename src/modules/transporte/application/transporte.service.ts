/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: transporte.service.ts
 * Responsabilidad: Asignar conductor y vehículo, o declarar propios medios.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES EL SUBMÓDULO MÁS ACOTADO DEL SISTEMA, Y ESA ES SU FUNCIÓN.
 *
 * La DAF escribe **dos campos** de los nueve formularios. La restricción se sostiene en
 * cuatro niveles independientes, para que ninguno sea el único punto de defensa:
 *
 *   1. **Ruta.** Endpoints propios bajo `/transporte`, con `@Roles(DAF)`.
 *   2. **Contrato.** `ActualizarTransporteDto` tiene exactamente dos propiedades.
 *   3. **Validación.** `forbidNonWhitelisted` rechaza cualquier campo adicional.
 *   4. **Servicio.** La escritura pasa por `OperativosService.asignarTransporte()`, cuya
 *      firma **no puede expresar** otra columna.
 *
 * El cuarto nivel es el que sobrevive a un descuido en los tres anteriores: aunque
 * alguien añadiera un campo al DTO y relajara la validación, no habría por dónde
 * escribirlo.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NO CONTIENE REGLAS DE DESCANSO. Las del conductor son POL-02 y viven en
 * `talento-operativo`, igual que las del personal: aquí se pregunta y se traslada el
 * veredicto (regla 1 de CLAUDE.md). Lo que sí decide este submódulo es la política de
 * vehículo del formulario, que es suya.
 */

import { Injectable } from '@nestjs/common';
import {
  PoliticaVehiculo,
  type Conductor,
  type Vehiculo,
} from '@prisma/client';

import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
} from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import {
  OperativosService,
  type Autor,
} from '../../operativos/application/operativos.service';
import { RangoHorario } from '../../operativos/domain/rango-horario';
import type { OperativoCompleto } from '../../operativos/infrastructure/operativos.repository';
import { ElegibilidadService } from '../../talento-operativo/application/elegibilidad.service';
import type { NivelFatiga } from '../../talento-operativo/application/politicas/indice-fatiga.policy';
import {
  FlotaRepository,
  type ConductorConVehiculo,
} from '../infrastructure/flota.repository';
import { verificarOcupacionVehiculo } from './politicas/ocupacion-vehiculo';

/**
 * Resultado de una asignación, con lo que la respuesta necesita nombrar.
 *
 * El conductor y el vehículo se devuelven **ya cargados** en lugar de incorporarlos a la
 * carga anticipada de `OperativoCompleto`: esa carga la comparten todas las consultas de
 * operativos, y añadirle dos relaciones más costaría dos `JOIN` en cada listado de la
 * jornada para un dato que solo esta pantalla usa.
 */
export interface ResultadoTransporte {
  operativo: OperativoCompleto;
  conductor: Conductor | null;
  vehiculo: Vehiculo | null;
}

/**
 * Vehículo de la flota tal como lo ve la DAF ese día. PV-33.
 *
 * `utilizable` en falso NO significa «no mostrar»: significa mostrarlo inhabilitado, con
 * `motivo` escrito en palabras junto a la placa.
 */
export interface VehiculoDeLaFlota {
  id: number;
  placa: string;
  descripcion: string | null;
  utilizable: boolean;
  motivo: string | null;
}

/** Conductor ofrecido a la DAF, con la placa que se propone. Caso 9 del plan. */
export interface ConductorDisponible {
  id: number;
  nombreCompleto: string;
  licenciaTipo: string | null;
  /** RN-45 y caso 9: la placa se propone desde el vehículo habitual. */
  vehiculoHabitual: { id: number; placa: string } | null;
  /**
   * Semáforo de carga del conductor (FRMS / ISO 39001+45001, 2026-09-24). ADVISORY: da
   * visibilidad de cuánto lleva ese día/período para repartir de forma pareja; NO bloquea (la
   * fatiga que impide conducir la comprueba `verificarConductor` al asignar). Lo calcula
   * `talento-operativo` y aquí solo se adjunta. Ausente si no se pudo calcular.
   */
  nivelCarga?: NivelFatiga;
}

@Injectable()
export class TransporteService {
  constructor(
    private readonly flota: FlotaRepository,
    private readonly operativos: OperativosService,
    private readonly elegibilidad: ElegibilidadService,
    private readonly cuadros: CuadroDiarioService,
    private readonly logger: LoggerService,
  ) {}

  // ─────────────────────────── Consulta ───────────────────────────

  /**
   * Los operativos de la jornada que esperan asignación logística.
   *
   * Con `incluirResueltos` llegan también los ya asignados y los de propios medios: es la
   * bandeja de CORRECCIÓN, y sin ella la DAF no tenía forma de deshacer un error desde la
   * aplicación.
   */
  async consultarPendientes(
    fecha: Date,
    incluirResueltos = false,
  ): Promise<OperativoCompleto[]> {
    return this.operativos.consultarPendientesDeTransporte(
      fecha,
      !incluirResueltos,
    );
  }

  /**
   * RN-45. Conductores que se pueden ofrecer ese día.
   *
   * El desplegable **excluye a quienes están ausentes**, y esa exclusión se hace aquí y
   * no en el navegador: si la lista llegara completa, bastaría con no filtrarla para
   * asignar a alguien de vacaciones. El servidor no ofrece lo que después rechazaría.
   *
   * La comprobación completa —patrulla consecutiva, solapamiento, jornada— sigue estando
   * al asignar: depende del operativo concreto y no de la fecha.
   */
  async conductoresDisponibles(fecha: Date): Promise<ConductorDisponible[]> {
    const [conductores, ausentes] = await Promise.all([
      this.flota.listarConductores(),
      this.flota.conductoresAusentes(fecha),
    ]);

    const disponibles = conductores.filter(
      (conductor) => !ausentes.has(conductor.id),
    );

    // Semáforo de carga (advisory) por lote. La fatiga la calcula `talento-operativo` (regla 1);
    // aquí solo se adjunta el nivel. No filtra ni ordena: un conductor con carga alta sigue
    // ofreciéndose, y la DAF decide.
    const cargas = await this.elegibilidad.calcularCargasConductores(
      disponibles.map((conductor) => conductor.id),
      fecha,
    );

    return disponibles.map((conductor) => ({
      ...comoConductorDisponible(conductor),
      nivelCarga: cargas.get(conductor.id)?.nivelFatiga,
    }));
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * PV-33 · 2026-08-31. LA DAF PASA A VER LA FLOTA ENTERA.
   *
   * Hasta hoy las placas que podía elegir salían de `conductoresDisponibles`: cada
   * conductor viajaba con su **vehículo habitual** y la pantalla componía el desplegable
   * a partir de ahí. La consecuencia era que **un vehículo sin conductor habitual era
   * inasignable**, aunque estuviera libre y en perfecto estado, y nadie lo veía: la placa
   * sencillamente no existía en la pantalla.
   *
   * SE DEVUELVEN TAMBIÉN LAS NO UTILIZABLES, y es lo contrario de lo que hace
   * `conductoresDisponibles`. La asimetría es deliberada:
   *
   *   · Un conductor ausente se excluye porque el desplegable de conductores es largo y
   *     la ausencia es del todo ajena a la decisión de la DAF.
   *   · Una placa en taller **sí le interesa**: es la que esperaba usar, y saber que está
   *     en el taller hasta el jueves es justamente lo que le permite planificar.
   *
   * Es el criterio que el proyecto ya aplica al personal: «quien no puede ser convocado se
   * muestra, no se oculta, deshabilitado y con su motivo en palabras» (regla 14 del
   * frontend). Ocultarlo produce la misma sorpresa que produjo `ficha: null` en P-07.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async vehiculosDeLaFlota(fecha: Date): Promise<VehiculoDeLaFlota[]> {
    const [vehiculos, ausencias] = await Promise.all([
      this.flota.listarVehiculos(),
      this.flota.ausenciasDeVehiculos(fecha),
    ]);

    return vehiculos.map((vehiculo) => {
      const ausencia = ausencias.get(vehiculo.id);

      return {
        id: vehiculo.id,
        placa: vehiculo.placa,
        descripcion: vehiculo.descripcion,
        utilizable: !ausencia,
        // Se redacta aquí y no en la pantalla: es el mismo texto que devolvería el
        // rechazo al asignar, y dos redacciones del mismo hecho acaban divergiendo.
        // El taller se nombra cuando consta: «en mantenimiento» dice que no está, y
        // «en AMBACAR» dice además dónde preguntar cuándo vuelve.
        motivo: ausencia
          ? `En ${ausencia.estado.toLowerCase().replace('_', ' ')}${
              ausencia.taller ? ` (${ausencia.taller})` : ''
            } hasta el ${ausencia.hasta.toISOString().slice(0, 10)}.`
          : null,
      };
    });
  }

  // ─────────────────────────── Asignación ───────────────────────────

  /**
   * RN-40. La DAF completa conductor y vehículo.
   *
   * Orden de las comprobaciones, cada una en su sitio:
   *
   *   1. El operativo existe y la jornada admite escritura (RN-58).
   *   2. **INV-13**: el formulario habilita vehículo. Es de este submódulo.
   *   3. Conductor y vehículo existen, están activos y el vehículo no está en taller.
   *   4. **POL-02**: el descanso del conductor, que decide `talento-operativo`.
   */
  async asignar(
    operativoId: number,
    datos: { conductorId: number; vehiculoId: number },
    autor: Autor,
  ): Promise<ResultadoTransporte> {
    const operativo = await this.exigirOperativo(operativoId, autor);
    await this.cuadros.exigirEscritura(operativo.cuadro.fecha);

    this.exigirVehiculoHabilitado(operativo);

    const conductor = await this.exigirConductor(datos.conductorId);
    const vehiculo = await this.exigirVehiculoUtilizable(
      datos.vehiculoId,
      operativo,
    );

    // VAL-19 a VAL-22. El veredicto llega hecho: los antecedentes del conductor no
    // cruzan la frontera de `talento-operativo`.
    const veredicto = await this.elegibilidad.verificarConductor(conductor.id, {
      fecha: operativo.cuadro.fecha,
      horaInicio: operativo.horaInicio,
      horaFin: operativo.horaFin,
      esPatrulla: operativo.formulario.esPatrulla,
      operativoId,
    });

    if (!veredicto.elegible) {
      throw new ReglaNegocioError(
        veredicto.codigo ?? CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
        veredicto.motivo ?? 'El conductor no puede recibir esta asignación.',
        { operativoId, conductorId: conductor.id },
      );
    }

    const actualizado = await this.operativos.asignarTransporte(
      operativoId,
      datos,
      autor,
    );

    // Evento `TransporteAsignado`, después de confirmar.
    this.logger.log('Transporte asignado', {
      identificador: operativo.identificador,
      conductorId: conductor.id,
      vehiculoId: datos.vehiculoId,
    });

    return { operativo: actualizado, conductor, vehiculo };
  }

  /**
   * RN-41. El operativo se cubre por propios medios.
   *
   * **No es lo mismo que dejarlo pendiente**: es una decisión de la DAF, y por eso
   * retira las alertas de conductor y placa. `ck_operativo_transporte` garantiza en la
   * base que este estado no conserve conductor ni vehículo.
   */
  async declararPropiosMedios(
    operativoId: number,
    autor: Autor,
  ): Promise<ResultadoTransporte> {
    const operativo = await this.exigirOperativo(operativoId, autor);
    await this.cuadros.exigirEscritura(operativo.cuadro.fecha);

    // Declararlo dos veces no es un error: el resultado es el mismo y rechazarlo
    // obligaría a la pantalla a comprobar el estado antes de cada clic.

    // RN-43. Un operativo con condicionante nocturno y horario en la franja EXIGE
    // conductor: declararlo por propios medios lo dejaría sin transporte la noche en que
    // más falta hace, y además impediría cerrar la jornada (INV-11).
    if (operativo.formulario.condicionanteNoct && operativo.esNocturno) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.CONDICIONANTE_NOCTURNO,
        `El operativo ${operativo.identificador} tiene horario nocturno y requiere conductor asignado obligatoriamente. No se puede declarar por propios medios.`,
        { operativoId },
      );
    }

    const actualizado = await this.operativos.asignarTransporte(
      operativoId,
      null,
      autor,
    );

    // Evento `OperativoDeclaradoPropiosMedios`, después de confirmar.
    this.logger.log('Operativo declarado por propios medios', {
      identificador: operativo.identificador,
    });

    return { operativo: actualizado, conductor: null, vehiculo: null };
  }

  /**
   * Deshace la decisión y devuelve el operativo a `PENDIENTE`. 2026-08-31.
   *
   * CIERRA UN HUECO QUE OBLIGABA A ENTRAR EN LA BASE. La bandeja solo listaba operativos
   * pendientes y no existía ninguna transición de salida: una vez asignado o declarado
   * por propios medios, corregirse exigía un `UPDATE` a mano. Es el problema P-07 del
   * análisis funcional del 2026-08-28.
   *
   * SIRVE A LOS DOS ESTADOS, y por eso no se llama «desasignar conductor»: revierte tanto
   * `ASIGNADO` como `PROPIOS_MEDIOS`, que son las dos decisiones que la DAF puede tomar y
   * por tanto las dos que puede equivocar.
   *
   * NO COMPRUEBA EL CONDICIONANTE NOCTURNO, al revés que `declararPropiosMedios`. Volver
   * a `PENDIENTE` no deja al operativo sin transporte: lo deja **pendiente de resolver**,
   * que es exactamente el estado en el que nació y en el que las alertas vuelven a
   * exigir que alguien lo atienda. Bloquearlo aquí dejaría un operativo nocturno mal
   * asignado sin ninguna salida por la aplicación, que es el defecto que esto corrige.
   */
  async desasignar(
    operativoId: number,
    autor: Autor,
  ): Promise<ResultadoTransporte> {
    const operativo = await this.exigirOperativo(operativoId, autor);
    await this.cuadros.exigirEscritura(operativo.cuadro.fecha);

    // Deshacer lo que ya está pendiente no es un error: el resultado es el mismo, y
    // rechazarlo obligaría a la pantalla a comprobar el estado antes de cada clic. Mismo
    // criterio que `declararPropiosMedios`.

    const actualizado = await this.operativos.desasignarTransporte(
      operativoId,
      autor,
    );

    // Evento `TransporteDesasignado`, después de confirmar.
    this.logger.log('Transporte desasignado', {
      identificador: operativo.identificador,
      estadoAnterior: operativo.estadoTransporte,
    });

    return { operativo: actualizado, conductor: null, vehiculo: null };
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  /**
   * El operativo, visto por quien pregunta.
   *
   * `OperativosService.obtener` ya resuelve la visibilidad y por eso se reutiliza: la DAF
   * ve la jornada completa —asigna transporte en los nueve formularios (PER-02, M-14)—,
   * y si algún día otro rol llegara aquí, la misma comprobación lo detendría.
   */
  private async exigirOperativo(
    id: number,
    autor: Autor,
  ): Promise<OperativoCompleto> {
    return this.operativos.obtener(id, autor);
  }

  /**
   * INV-13, RN-41 y RN-42. El formulario tiene que habilitar vehículo.
   *
   * Los formularios 1 y 3 operan por propios medios y el 9 no habilita conductor ni
   * placa. Asignarles transporte contradiría el instrumento aprobado, y el operativo
   * quedaría con un conductor que su propio formulario dice que no existe.
   */
  private exigirVehiculoHabilitado(operativo: OperativoCompleto): void {
    if (operativo.formulario.politicaVehiculo !== PoliticaVehiculo.NO_APLICA) {
      return;
    }

    throw new ReglaNegocioError(
      CODIGOS_ERROR.CAMPOS_NO_PERMITIDOS,
      `El formulario ${operativo.formulario.nombre} opera por propios medios y no habilita conductor ni vehículo.`,
      { operativoId: operativo.id },
    );
  }

  private async exigirConductor(id: number): Promise<ConductorConVehiculo> {
    const conductor = await this.flota.buscarConductor(id);

    if (!conductor) {
      throw new RecursoNoEncontradoError(
        'El conductor seleccionado no existe.',
        { conductorId: id },
      );
    }

    if (!conductor.activo) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
        `${conductor.nombreCompleto} está dado de baja en el catálogo de conductores.`,
        { conductorId: id },
      );
    }

    return conductor;
  }

  /**
   * El vehículo existe, está activo, no está en taller y no está ya ocupado.
   *
   * RECIBE EL OPERATIVO ENTERO Y NO SOLO LA FECHA desde el 2026-08-28: la última
   * comprobación necesita el horario que se pretende ocupar y el identificador que hay
   * que excluir al reasignar, y los dos viven en el operativo.
   */
  private async exigirVehiculoUtilizable(
    id: number,
    operativo: OperativoCompleto,
  ): Promise<Vehiculo> {
    const fecha = operativo.cuadro.fecha;
    const vehiculo = await this.flota.buscarVehiculo(id);

    if (!vehiculo) {
      throw new RecursoNoEncontradoError(
        'El vehículo seleccionado no existe.',
        {
          vehiculoId: id,
        },
      );
    }

    if (!vehiculo.activo) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
        `El vehículo de placa ${vehiculo.placa} está dado de baja.`,
        { vehiculoId: id },
      );
    }

    const ausencia = await this.flota.ausenciaDeVehiculo(id, fecha);

    if (ausencia) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
        `El vehículo de placa ${vehiculo.placa} registra ${ausencia.estado.toLowerCase().replace('_', ' ')} hasta el ${ausencia.hasta.toISOString().slice(0, 10)}.`,
        { vehiculoId: id },
      );
    }

    // RN-DAF-01. Y por último, que no esté ya sirviendo a otro operativo que se cruce.
    // Va al final a propósito: es la única comprobación que consulta los operativos del
    // día, y no tiene sentido pagarla si el vehículo ya estaba descartado por baja o por
    // taller.
    const ocupaciones = await this.flota.asignacionesDelVehiculoEn(
      id,
      fecha,
      operativo.id,
    );

    const veredicto = verificarOcupacionVehiculo(
      vehiculo.placa,
      ocupaciones.map((ocupacion) => ({
        identificador: ocupacion.identificador,
        rango: RangoHorario.de(ocupacion.horaInicio, ocupacion.horaFin),
      })),
      RangoHorario.de(operativo.horaInicio, operativo.horaFin),
    );

    if (!veredicto.libre) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.VEHICULO_OCUPADO,
        veredicto.motivo ??
          `El vehículo de placa ${vehiculo.placa} ya está asignado a otro operativo con este horario.`,
        { operativoId: operativo.id, vehiculoId: id },
      );
    }

    return vehiculo;
  }
}

function comoConductorDisponible(
  conductor: ConductorConVehiculo,
): ConductorDisponible {
  return {
    id: conductor.id,
    nombreCompleto: conductor.nombreCompleto,
    licenciaTipo: conductor.licenciaTipo,
    vehiculoHabitual: conductor.vehiculoHabitual
      ? {
          id: conductor.vehiculoHabitual.id,
          placa: conductor.vehiculoHabitual.placa,
        }
      : null,
  };
}
