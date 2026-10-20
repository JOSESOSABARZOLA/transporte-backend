/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: flota.service.ts
 * Responsabilidad: Administrar el catálogo de conductores y vehículos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * RF-056. Es la administración que hoy no existe: PV-03 dice que el catálogo de
 * conductores y vehículos **no ha sido entregado por la DAF**, y sin una pantalla para
 * cargarlo el día que llegue habría que insertarlo a mano en la base.
 *
 * LA BAJA ES LÓGICA, como en el maestro de personal (M-10) y por el mismo motivo: un
 * conductor dado de baja sigue figurando en los operativos que condujo, y borrarlo
 * dejaría sin nombre a una orden de servicio ya emitida. `onDelete: Restrict` en
 * `fk_operativo_conductor` lo impide en la base; aquí se responde con una frase.
 *
 * LA CÉDULA SE VALIDA CON EL MISMO ALGORITMO que el personal (`reglas-personal.ts`).
 * Reimplementarlo aquí daría dos versiones del dígito verificador ecuatoriano, y la que
 * se corrigiera primero dejaría a la otra aceptando cédulas inválidas.
 *
 * FLOTA Y GARAJES (2026-10-14):
 *   · La baja de un vehículo o un conductor con transporte asignado desde HOY (Quito) se rechaza
 *     con 409 `RECURSO_CON_ASIGNACION`: dejaría un operativo sin conductor o sin vehículo.
 *   · Dar de baja un vehículo deja «sin vehículo» a sus conductores habituales, en la misma
 *     transacción y con su traza (D3): antes quedaban apuntando a una placa que nadie ofrece.
 *   · Lo dado de baja se REACTIVA; la baja ya no es un callejón sin salida.
 *   · Garaje: «dar de baja» apaga a la vez `activo` y `garajeAutorizado`, y reactivar los
 *     enciende (D2). Vigente = activo y autorizado (`esGarajeVigente`).
 *   · La placa nueva o cambiada tiene que ser AAA-999 / AAA-9999 (D4) y siempre se guarda con
 *     `normalizarPlaca` (A1): la unicidad compara la placa normalizada.
 *   · El kilometraje no supera DAF_KM_MAXIMO (A2, 2026-10-15).
 *   · El nombre del garaje se guarda tal cual se escribió, sin espacios sobrantes (A3); la
 *     unicidad sigue sin distinguir mayúsculas ni tildes.
 *
 * BAJA CON FECHA Y MOTIVOS REALES (2026-10-20, plan «flota-mantenimiento-baja»):
 *   · La baja y la reactivación escriben SOLO `activo` + `bajaEn`/`bajaPor` (D1), con su traza;
 *     ya no pasan por la edición completa (un conductor con un acta incoherente heredada no podía
 *     darse de baja: `exigirActaCoherente` le respondía 400).
 *   · Lo que impide la baja lo decide `politicas/baja-flota.ts` (D2): traslados que aún no
 *     terminan, un mantenimiento abierto (vehículo) o vehículos que duermen en el garaje desde hoy.
 *     El aviso previo (`impacto-baja`) usa la misma regla y devuelve el mismo `motivo`.
 *   · `disponibilidad(fecha)` (D3): cada vehículo DISPONIBLE / EN_TALLER / DE_BAJA en la fecha y
 *     sus paradas de la semana, en dos consultas.
 */

import { Injectable } from '@nestjs/common';
import { AccionAuditoria, type Conductor, type Vehiculo } from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import {
  fechaIsoEnZona,
  horaEnZona,
} from '../../../common/utilidades/marca-tiempo';
import { normalizarParaComparar } from '../../../common/utilidades/texto';
import {
  tieneFormatoCedula,
  esTelefonoValido,
} from '../../talento-operativo/application/reglas-personal';
import {
  FlotaRepository,
  type CambiosConductor,
  type CambiosVehiculo,
  type ConductorConVehiculo,
  type DatosConductor,
  type DatosVehiculo,
  type UbicacionConZonal,
} from '../infrastructure/flota.repository';
import { ParametrosTransporteService } from './parametros-transporte.service';
import {
  bloqueoDeBaja,
  tramosPendientes,
  type BloqueoBaja,
  type TramoParaBaja,
} from './politicas/baja-flota';
import {
  esPlacaValida,
  kilometrajeExcedeTope,
  normalizarPlaca as normalizarFormaPlaca,
  resumenDeFlota,
  type ResumenFlota,
} from './politicas/datos-flota';
import {
  disponibilidadDeFlota,
  diasDeSemana,
  type DisponibilidadDeVehiculo,
} from './politicas/semana-mantenimiento';

/** Resultado de una baja, con lo que el administrador necesita saber. */
export interface ResultadoBajaFlota<T> {
  registro: T;
  operativosHistoricos: number;
  mensaje: string;
  /** Conductores que quedaron sin vehículo habitual (solo en la baja de un vehículo). */
  conductoresSinVehiculo: { id: number; nombreCompleto: string }[];
}

/** Lo que pasaría al dar de baja: para avisar ANTES de confirmar. */
export interface ImpactoBaja {
  /** Traslados que aún no terminan (y TAREAS, para el conductor): si hay alguno, se rechaza. */
  asignacionesVigentes: number;
  primeraAsignacion: {
    fecha: string;
    horaInicio: string;
    identificador: string;
  } | null;
  /** Conductores activos que quedarían sin vehículo habitual (vacío para un conductor). */
  conductoresHabituales: { id: number; nombreCompleto: string }[];
  /** Lo que impide la baja, redactado igual que el 409; `null` si se puede dar de baja. */
  motivo: string | null;
}

/** Un registro de la flota con el NOMBRE de quien lo dio de baja (`null` si está activo). */
export type ConNombreDeBaja<T> = T & { bajaPorNombre: string | null };

const MENSAJE_PLACA_REPETIDA = 'Ya existe un vehículo con esa placa.';

/** `vehi_placa` admite diez caracteres. */
const LARGO_MAXIMO_PLACA = 10;

@Injectable()
export class FlotaService {
  constructor(
    private readonly repositorio: FlotaRepository,
    private readonly auditoria: AuditoriaService,
    private readonly parametros: ParametrosTransporteService,
  ) {}

  // ─────────────────────────── Conductores ───────────────────────────

  async listarConductores(
    incluirInactivos = false,
  ): Promise<ConNombreDeBaja<ConductorConVehiculo>[]> {
    return this.conNombresDeBaja(
      await this.repositorio.listarConductores(!incluirInactivos),
    );
  }

  async crearConductor(
    datos: DatosConductor,
    usuarioId: number,
  ): Promise<Conductor> {
    const cedula = datos.cedula.trim();

    if (!tieneFormatoCedula(cedula)) {
      throw new ValidacionError(
        `La cédula ${cedula} no es válida: debe tener diez dígitos.`,
        { cedula },
      );
    }

    if (datos.telefono && !esTelefonoValido(datos.telefono)) {
      throw new ValidacionError(
        'El teléfono del conductor no tiene un formato válido.',
        {},
      );
    }

    const repetida = await this.repositorio.buscarConductorPorCedula(cedula);
    if (repetida) {
      throw new ValidacionError(
        `Ya existe un conductor registrado con la cédula ${cedula}: ${repetida.nombreCompleto}.`,
        { cedula },
      );
    }

    await this.exigirVehiculoSiSeIndica(datos.vehiculoHabitualId);
    exigirActaCoherente(datos);

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const creado = await this.repositorio.crearConductor(
        { ...datos, cedula, nombreCompleto: datos.nombreCompleto.trim() },
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_conductor',
          entidadId: creado.id,
          accion: AccionAuditoria.CREAR,
          usuario: usuarioId,
        },
        cliente,
      );

      return creado;
    });
  }

  async actualizarConductor(
    id: number,
    cambios: CambiosConductor,
    usuarioId: number,
  ): Promise<Conductor> {
    const actual = await this.exigirConductor(id);

    if (cambios.telefono && !esTelefonoValido(cambios.telefono)) {
      throw new ValidacionError(
        'El teléfono del conductor no tiene un formato válido.',
        {},
      );
    }

    await this.exigirVehiculoSiSeIndica(cambios.vehiculoHabitualId);
    exigirActaCoherente({ ...actual, ...definidos(cambios) });

    const traza = this.auditoria.compararCambios(
      columnasDeConductor(actual),
      columnasDeConductor({ ...actual, ...cambios }),
    );

    if (traza.length === 0) return actual;

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const guardado = await this.repositorio.actualizarConductor(
        id,
        cambios,
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_conductor',
          entidadId: id,
          accion: AccionAuditoria.ACTUALIZAR,
          cambios: traza,
          usuario: usuarioId,
        },
        cliente,
      );

      return guardado;
    });
  }

  /**
   * Baja lógica. El conductor deja de ofrecerse a la DAF y conserva su historial. Con traslados o
   * TAREAS que aún no terminan se rechaza (409 `RECURSO_CON_ASIGNACION`, D2). Escribe solo
   * `activo` y la fecha y el autor de la baja (D1).
   */
  async desactivarConductor(
    id: number,
    usuarioId: number,
  ): Promise<ResultadoBajaFlota<Conductor>> {
    const actual = await this.exigirConductor(id);

    if (actual.activo) {
      exigirSinBloqueo(await this.bloqueoConductor(id, actual.nombreCompleto));
    }

    const historicos = await this.repositorio.contarOperativosDeConductor(id);
    const registro = actual.activo
      ? await this.cambiarActivoConductor(id, false, usuarioId)
      : actual;

    return {
      registro,
      operativosHistoricos: historicos,
      mensaje: `${actual.nombreCompleto} dejó de ofrecerse a la DAF. No se borró nada; puede reactivarlo después.`,
      conductoresSinVehiculo: [],
    };
  }

  /** Vuelve a ofrecer a un conductor dado de baja y le borra la fecha de baja. Idempotente. */
  async reactivarConductor(id: number, usuarioId: number): Promise<Conductor> {
    const actual = await this.exigirConductor(id);
    if (actual.activo) return actual;
    return this.cambiarActivoConductor(id, true, usuarioId);
  }

  /** Qué pasaría al dar de baja al conductor: la misma regla que la baja (D2). */
  async impactoBajaConductor(id: number): Promise<ImpactoBaja> {
    const actual = await this.exigirConductor(id);
    const tramos = await this.repositorio.tramosParaBaja(
      { conductorId: id },
      this.hoy(),
    );
    return impactoDe(
      tramos,
      bloqueoDeBaja(actual.nombreCompleto, { tramos }, hoyIso(), horaEnZona()),
      [],
    );
  }

  /** Solo `cond_activo` y la fecha y el autor de la baja, con su traza (D1). */
  private async cambiarActivoConductor(
    id: number,
    activo: boolean,
    usuarioId: number,
  ): Promise<Conductor> {
    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const guardado = await this.repositorio.actualizarConductor(
        id,
        {
          activo,
          bajaEn: activo ? null : new Date(),
          bajaPor: activo ? null : usuarioId,
        },
        cliente,
      );
      await this.auditoria.registrar(
        {
          entidad: 't_conductor',
          entidadId: id,
          accion: AccionAuditoria.ACTUALIZAR,
          cambios: this.auditoria.compararCambios(
            { cond_activo: !activo },
            { cond_activo: activo },
          ),
          usuario: usuarioId,
        },
        cliente,
      );
      return guardado;
    });
  }

  /** Lo que impide dar de baja al conductor: sus traslados y TAREAS que aún no terminan. */
  private async bloqueoConductor(
    id: number,
    nombre: string,
  ): Promise<BloqueoBaja | null> {
    const tramos = await this.repositorio.tramosParaBaja(
      { conductorId: id },
      this.hoy(),
    );
    return bloqueoDeBaja(nombre, { tramos }, hoyIso(), horaEnZona());
  }

  // ─────────────────────────── Vehículos ───────────────────────────

  async listarVehiculos(
    incluirInactivos = false,
  ): Promise<ConNombreDeBaja<Vehiculo>[]> {
    return this.conNombresDeBaja(
      await this.repositorio.listarVehiculos(!incluirInactivos),
    );
  }

  async crearVehiculo(
    datos: DatosVehiculo,
    usuarioId: number,
  ): Promise<Vehiculo> {
    const placa = normalizarPlaca(datos.placa);
    exigirFormatoPlaca(placa);
    await this.exigirKilometraje(datos.kilometraje);

    const repetida = await this.buscarVehiculoPorPlaca(placa);
    if (repetida) {
      throw new ValidacionError(MENSAJE_PLACA_REPETIDA, { placa });
    }

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const creado = await this.repositorio.crearVehiculo(
        { ...datos, placa },
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_vehiculo',
          entidadId: creado.id,
          accion: AccionAuditoria.CREAR,
          usuario: usuarioId,
        },
        cliente,
      );

      return creado;
    });
  }

  async actualizarVehiculo(
    id: number,
    cambios: CambiosVehiculo,
    usuarioId: number,
  ): Promise<Vehiculo> {
    const actual = await this.exigirVehiculo(id);
    // La misma placa que ya tiene, escrita de otra forma, no es un cambio.
    const placa =
      cambios.placa && normalizarPlaca(cambios.placa) !== actual.placa
        ? normalizarPlaca(cambios.placa)
        : undefined;

    if (placa) {
      // D4: solo una placa que CAMBIA tiene que cumplir el formato; las registradas no se rompen.
      exigirFormatoPlaca(placa);
      const repetida = await this.buscarVehiculoPorPlaca(placa);
      // Ponerle el guion a la propia placa (PMA7056 → PMA-7056) no choca consigo misma.
      if (repetida && repetida.id !== id) {
        throw new ValidacionError(MENSAJE_PLACA_REPETIDA, { placa });
      }
    }
    // A2: solo un kilometraje que cambia se valida; el registrado sobre el tope no bloquea la
    // edición de otros campos (se reporta, no se corrige).
    if (
      cambios.kilometraje !== undefined &&
      cambios.kilometraje !== actual.kilometraje
    ) {
      await this.exigirKilometraje(cambios.kilometraje);
    }

    const propuesta = { ...cambios, placa: placa ?? actual.placa };
    const traza = this.auditoria.compararCambios(
      columnasDeVehiculo(actual),
      columnasDeVehiculo({ ...actual, ...propuesta }),
    );

    if (traza.length === 0) return actual;

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const guardado = await this.repositorio.actualizarVehiculo(
        id,
        propuesta,
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_vehiculo',
          entidadId: id,
          accion: AccionAuditoria.ACTUALIZAR,
          cambios: traza,
          usuario: usuarioId,
        },
        cliente,
      );

      return guardado;
    });
  }

  /**
   * Baja lógica del vehículo. Con traslados que aún no terminan o un mantenimiento abierto se
   * rechaza (409, D2 del 2026-10-20). Sus conductores habituales quedan sin vehículo en la MISMA
   * transacción, cada uno con su traza (D3). Guarda la fecha y el autor de la baja.
   */
  async desactivarVehiculo(
    id: number,
    usuarioId: number,
  ): Promise<ResultadoBajaFlota<Vehiculo>> {
    const actual = await this.exigirVehiculo(id);
    const historicos = await this.repositorio.contarOperativosDeVehiculo(id);

    if (!actual.activo) {
      return {
        registro: actual,
        operativosHistoricos: historicos,
        mensaje: `El vehículo de placa ${actual.placa} ya estaba dado de baja.`,
        conductoresSinVehiculo: [],
      };
    }

    exigirSinBloqueo(await this.bloqueoVehiculo(id, actual.placa));

    const habituales =
      await this.repositorio.conductoresConVehiculoHabitual(id);

    const registro = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const guardado = await this.repositorio.actualizarVehiculo(
          id,
          { activo: false, bajaEn: new Date(), bajaPor: usuarioId },
          cliente,
        );
        await this.repositorio.quitarVehiculoHabitual(
          habituales.map((c) => c.id),
          cliente,
        );

        await this.auditoria.registrarVarios(
          [
            {
              entidad: 't_vehiculo',
              entidadId: id,
              accion: AccionAuditoria.ACTUALIZAR,
              cambios: this.auditoria.compararCambios(
                { vehi_activo: true },
                { vehi_activo: false },
              ),
              usuario: usuarioId,
            },
            ...habituales.map((c) => ({
              entidad: 't_conductor',
              entidadId: c.id,
              accion: AccionAuditoria.ACTUALIZAR,
              cambios: this.auditoria.compararCambios(
                { vehi_id: id },
                { vehi_id: null },
              ),
              usuario: usuarioId,
            })),
          ],
          cliente,
        );

        return guardado;
      },
    );

    // Se limpian todos (también los dados de baja), pero solo se nombra a los activos.
    const sinVehiculo = habituales
      .filter((c) => c.activo)
      .map((c) => ({ id: c.id, nombreCompleto: c.nombreCompleto }));
    const aviso =
      sinVehiculo.length > 0
        ? ` Quedaron sin vehículo habitual: ${sinVehiculo.map((c) => c.nombreCompleto).join(', ')}.`
        : '';

    return {
      registro,
      operativosHistoricos: historicos,
      mensaje: `El vehículo de placa ${actual.placa} dejó de ofrecerse en la asignación de transporte. Su historial se conserva.${aviso}`,
      conductoresSinVehiculo: sinVehiculo,
    };
  }

  /**
   * Vuelve a ofrecer un vehículo dado de baja y le borra la fecha de baja. No le devuelve sus
   * conductores habituales. Solo escribe `activo` (D1), con su traza.
   */
  async reactivarVehiculo(id: number, usuarioId: number): Promise<Vehiculo> {
    const actual = await this.exigirVehiculo(id);
    if (actual.activo) return actual;
    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const guardado = await this.repositorio.actualizarVehiculo(
        id,
        { activo: true, bajaEn: null, bajaPor: null },
        cliente,
      );
      await this.auditoria.registrar(
        {
          entidad: 't_vehiculo',
          entidadId: id,
          accion: AccionAuditoria.ACTUALIZAR,
          cambios: this.auditoria.compararCambios(
            { vehi_activo: false },
            { vehi_activo: true },
          ),
          usuario: usuarioId,
        },
        cliente,
      );
      return guardado;
    });
  }

  /** Qué pasaría al dar de baja el vehículo: la misma regla que la baja y quién queda sin él. */
  async impactoBajaVehiculo(id: number): Promise<ImpactoBaja> {
    const actual = await this.exigirVehiculo(id);
    const [habituales, tramos, paradas] = await Promise.all([
      this.repositorio.conductoresConVehiculoHabitual(id),
      this.tramosDeVehiculo(id),
      this.repositorio.paradasParaBaja(id, this.hoy()),
    ]);
    return impactoDe(
      tramos,
      bloqueoDeBaja(
        `El vehículo de placa ${actual.placa}`,
        { tramos, paradas },
        hoyIso(),
        horaEnZona(),
      ),
      habituales
        .filter((c) => c.activo)
        .map((c) => ({ id: c.id, nombreCompleto: c.nombreCompleto })),
    );
  }

  /** Lo que impide dar de baja el vehículo: traslados que no terminan y paradas abiertas. */
  private async bloqueoVehiculo(
    id: number,
    placa: string,
  ): Promise<BloqueoBaja | null> {
    const [tramos, paradas] = await Promise.all([
      this.tramosDeVehiculo(id),
      this.repositorio.paradasParaBaja(id, this.hoy()),
    ]);
    return bloqueoDeBaja(
      `El vehículo de placa ${placa}`,
      { tramos, paradas },
      hoyIso(),
      horaEnZona(),
    );
  }

  /** Los traslados del vehículo SIN sus TAREAS de taller: esas las cubre la parada abierta. */
  private async tramosDeVehiculo(id: number): Promise<TramoParaBaja[]> {
    return (
      await this.repositorio.tramosParaBaja({ vehiculoId: id }, this.hoy())
    ).filter((t) => !t.esTarea);
  }

  /**
   * D3 (2026-10-20): cada vehículo (activo o de baja) con su disponibilidad en `fecha` y sus
   * paradas de los siete días desde `fecha`. Dos consultas, sin importar el tamaño de la flota.
   */
  async disponibilidad(fecha: string): Promise<{
    fecha: string;
    hasta: string;
    vehiculos: DisponibilidadDeVehiculo[];
  }> {
    const dia = new Date(`${fecha}T00:00:00.000Z`);
    const hasta = diasDeSemana(dia)[6];
    const [vehiculos, citas] = await Promise.all([
      this.repositorio.listarVehiculos(false),
      this.repositorio.mantenimientosEnRango(
        dia,
        new Date(`${hasta}T00:00:00.000Z`),
      ),
    ]);
    return {
      fecha,
      hasta,
      vehiculos: disponibilidadDeFlota(dia, vehiculos, citas),
    };
  }

  // ─────────────────────────── Indicadores ───────────────────────────

  /** Los indicadores de la pantalla Flota y garajes (sin N+1: tres consultas). */
  async resumen(
    diasAviso: number,
    hoy = fechaIsoEnZona(),
  ): Promise<ResumenFlota> {
    const [vehiculos, conductores, garajes, enTaller] =
      await this.repositorio.datosDelResumen(new Date(`${hoy}T00:00:00.000Z`));
    return resumenDeFlota(
      vehiculos,
      conductores,
      garajes,
      hoy,
      diasAviso,
      enTaller.map((c) => c.vehiculoId),
    );
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  private async exigirConductor(id: number): Promise<ConductorConVehiculo> {
    const conductor = await this.repositorio.buscarConductor(id);

    if (!conductor) {
      throw new RecursoNoEncontradoError(
        `No existe un conductor con identificador ${id}.`,
        { id },
      );
    }
    return conductor;
  }

  private async exigirVehiculo(id: number): Promise<Vehiculo> {
    const vehiculo = await this.repositorio.buscarVehiculo(id);

    if (!vehiculo) {
      throw new RecursoNoEncontradoError(
        `No existe un vehículo con identificador ${id}.`,
        { id },
      );
    }
    return vehiculo;
  }

  private async exigirVehiculoSiSeIndica(id?: number | null): Promise<void> {
    if (id === undefined || id === null) return;
    await this.exigirVehiculo(id);
  }

  /**
   * La placa repetida se busca con guion y SIN él: hay placas registradas antes del formato D4
   * como `PMA7056`, y `PMA-7056` es el mismo vehículo.
   */
  /**
   * El vehículo con esa placa, comparando normalizada. Busca también la forma sin guion por si
   * una placa no pudo migrarse (colisión): así nunca se cuelan dos grafías de la misma.
   */
  async buscarVehiculoPorPlaca(texto: string): Promise<Vehiculo | null> {
    const placa = normalizarFormaPlaca(texto);
    const sinGuion = placa.replace('-', '');
    return (
      (await this.repositorio.buscarVehiculoPorPlaca(placa)) ??
      (sinGuion === placa
        ? null
        : await this.repositorio.buscarVehiculoPorPlaca(sinGuion))
    );
  }

  /** A2: entero de 0 a DAF_KM_MAXIMO (el mínimo y el entero los exige el DTO). */
  private async exigirKilometraje(
    kilometraje: number | null | undefined,
  ): Promise<void> {
    if (kilometraje === null || kilometraje === undefined) return;
    const kmMaximo = await this.parametros.leerKmMaximo();
    if (kilometrajeExcedeTope(kilometraje, kmMaximo)) {
      throw new ValidacionError(
        'Revise el kilometraje: parece demasiado alto.',
        { kilometraje, kmMaximo },
      );
    }
  }

  /** «Desde hoy» es el día de calendario de Quito, como columna @db.Date. */
  private hoy(): Date {
    return new Date(`${fechaIsoEnZona()}T00:00:00.000Z`);
  }

  /** El nombre de quien dio de baja cada registro, en UNA consulta. */
  private async conNombresDeBaja<T extends { bajaPor: number | null }>(
    filas: T[],
  ): Promise<ConNombreDeBaja<T>[]> {
    const nombres = await this.repositorio.nombresDeUsuarios(
      filas.map((f) => f.bajaPor),
    );
    return filas.map((f) => ({
      ...f,
      bajaPorNombre: f.bajaPor === null ? null : (nombres[f.bajaPor] ?? null),
    }));
  }

  // ─────────── Ubicaciones de reposo de la flota · RN-DAF-03 ───────────

  /**
   * El catálogo de zonales donde puede quedar un vehículo.
   *
   * NACE VACÍO Y SE CARGA A MANO. La evidencia se contradice —cinco zonales en la hoja de
   * agosto, cuatro en la reunión— y es la pregunta Q-01, sin responder. Sembrar cinco
   * filas «porque están en el Excel» convertiría una suposición en un dato maestro y nadie
   * volvería a preguntarse de dónde salió.
   */
  async listarUbicaciones(
    incluirInactivas = false,
  ): Promise<ConNombreDeBaja<UbicacionConZonal>[]> {
    return this.conNombresDeBaja(
      await this.repositorio.listarUbicaciones(!incluirInactivas),
    );
  }

  async crearUbicacion(
    nombre: string,
    usuarioId: number,
    extra: { zonalId?: number | null } = {},
  ): Promise<UbicacionConZonal> {
    const limpio = nombre.trim();

    // Tal cual se escribió, sin espacios sobrantes (A3, 2026-10-15): «Eloy Alfaro», no
    // «ELOY ALFARO». Dos grafías del mismo sitio (CALDERON, «Calderón») las sigue frenando
    // `exigirNombreLibre`, que compara sin tildes ni mayúsculas.
    await this.exigirNombreLibre(limpio);
    await this.exigirZonalSiSeIndica(extra.zonalId);

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      // Un garaje dado de alta ES un garaje autorizado, siempre (D2, 2026-10-14): ya no hay
      // garajes «vigentes sin autorizar». Sin zonal es válido (la Matriz).
      const creada = await this.repositorio.crearUbicacion(limpio, cliente, {
        zonalId: extra.zonalId,
        garajeAutorizado: true,
      });

      await this.auditoria.registrar(
        {
          entidad: 't_ubicacion_flota',
          entidadId: creada.id,
          accion: AccionAuditoria.CREAR,
          usuario: usuarioId,
        },
        cliente,
      );

      return creada;
    });
  }

  /**
   * Nombre de ubicación ÚNICO (2026-10-06), comparando sin tildes, sin mayúsculas y sin espacios
   * sobrantes: «Calderón» y «CALDERON» son el mismo garaje. Cuenta también las inactivas, porque
   * reactivarlas chocaría con la nueva. 409 `NOMBRE_DUPLICADO`.
   */
  private async exigirNombreLibre(nombre: string, excluirId?: number) {
    const buscado = normalizarParaComparar(nombre);
    const existentes = await this.repositorio.nombresDeUbicaciones();
    const repetida = existentes.find(
      (u) => u.id !== excluirId && normalizarParaComparar(u.nombre) === buscado,
    );
    if (repetida) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.NOMBRE_DUPLICADO,
        'Ya existe una ubicación con ese nombre.',
        { nombre, existente: repetida.nombre },
      );
    }
  }

  async actualizarUbicacion(
    id: number,
    cambios: {
      nombre?: string;
      activo?: boolean;
      garajeAutorizado?: boolean;
      zonalId?: number | null;
    },
    usuarioId: number,
  ): Promise<UbicacionConZonal> {
    const actual = await this.exigirUbicacion(id);

    const nombre =
      cambios.nombre === undefined ? undefined : cambios.nombre.trim();

    if (nombre !== undefined) await this.exigirNombreLibre(nombre, id);
    await this.exigirZonalSiSeIndica(cambios.zonalId);

    // D2: la vigencia se mueve con las dos marcas juntas. Un `activo` sin `garajeAutorizado`
    // explícito arrastra la autorización; quien manda las dos (compatibilidad) decide él.
    if (
      cambios.activo !== undefined &&
      cambios.garajeAutorizado === undefined
    ) {
      cambios = { ...cambios, garajeAutorizado: cambios.activo };
    }

    const traza = this.auditoria.compararCambios(
      {
        ubic_nombre: actual.nombre,
        ubic_activo: actual.activo,
        ubic_garaje_autorizado: actual.garajeAutorizado,
        zona_id: actual.zonalId,
      },
      {
        ubic_nombre: nombre ?? actual.nombre,
        ubic_activo: cambios.activo ?? actual.activo,
        ubic_garaje_autorizado:
          cambios.garajeAutorizado ?? actual.garajeAutorizado,
        zona_id:
          cambios.zonalId === undefined ? actual.zonalId : cambios.zonalId,
      },
    );

    if (traza.length === 0) return actual;

    // D1 y D2 (2026-10-20): la baja exige que ningún vehículo duerma ahí desde hoy, y la fecha y
    // el autor viajan con `activo`, se cambie por la baja o por la edición.
    const cambiaActivo =
      cambios.activo !== undefined && cambios.activo !== actual.activo;
    if (cambiaActivo && cambios.activo === false) {
      exigirSinBloqueo(
        bloqueoDeBaja(
          `El garaje ${actual.nombre}`,
          {
            destinos: await this.repositorio.destinosParaBaja(id, this.hoy()),
          },
          hoyIso(),
          horaEnZona(),
        ),
      );
    }

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const guardada = await this.repositorio.actualizarUbicacion(
        id,
        {
          nombre,
          activo: cambios.activo,
          garajeAutorizado: cambios.garajeAutorizado,
          zonalId: cambios.zonalId,
          ...(cambiaActivo
            ? {
                bajaEn: cambios.activo ? null : new Date(),
                bajaPor: cambios.activo ? null : usuarioId,
              }
            : {}),
        },
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_ubicacion_flota',
          entidadId: id,
          accion: AccionAuditoria.ACTUALIZAR,
          cambios: traza,
          usuario: usuarioId,
        },
        cliente,
      );

      return guardada;
    });
  }

  /**
   * Baja del garaje (D2): deja de ser vigente — ni activo ni autorizado —. Con vehículos activos que
   * duermen ahí desde hoy se rechaza (409, 2026-10-20).
   */
  async darDeBajaUbicacion(
    id: number,
    usuarioId: number,
  ): Promise<UbicacionConZonal> {
    return this.actualizarUbicacion(
      id,
      { activo: false, garajeAutorizado: false },
      usuarioId,
    );
  }

  /** Reactivar el garaje (D2): vuelve a ser vigente — activo y autorizado —. */
  async reactivarUbicacion(
    id: number,
    usuarioId: number,
  ): Promise<UbicacionConZonal> {
    return this.actualizarUbicacion(
      id,
      { activo: true, garajeAutorizado: true },
      usuarioId,
    );
  }

  private async exigirUbicacion(id: number): Promise<UbicacionConZonal> {
    const ubicacion = await this.repositorio.buscarUbicacion(id);
    if (!ubicacion) {
      throw new RecursoNoEncontradoError(
        `No existe una zonal con identificador ${id}.`,
        { id },
      );
    }
    return ubicacion;
  }

  /** «Vehículos que lo usan»: la última fecha de cada vehículo en cada garaje. */
  async usosDeUbicaciones(ubicacionIds?: readonly number[]) {
    return this.repositorio.usosDeUbicaciones(ubicacionIds);
  }

  /** La zonal del garaje tiene que existir (404); hoy solo la protegía la FK, con un 500. */
  private async exigirZonalSiSeIndica(zonalId?: number | null): Promise<void> {
    if (zonalId === undefined || zonalId === null) return;
    if (!(await this.repositorio.existeZonal(zonalId))) {
      throw new RecursoNoEncontradoError(
        `No existe una zonal con identificador ${zonalId}.`,
        { zonalId },
      );
    }
  }
}

/** «Hoy» de Quito como AAAA-MM-DD, para la política de baja. */
function hoyIso(): string {
  return fechaIsoEnZona();
}

/** 409 `RECURSO_CON_ASIGNACION` con el motivo redactado por `politicas/baja-flota.ts` (D2). */
function exigirSinBloqueo(bloqueo: BloqueoBaja | null): void {
  if (!bloqueo) return;
  throw new ReglaNegocioError(
    CODIGOS_ERROR.RECURSO_CON_ASIGNACION,
    bloqueo.mensaje,
    { motivo: bloqueo.tipo, cantidad: bloqueo.cantidad },
  );
}

/** El aviso previo a la baja, con el MISMO motivo que daría el 409. */
function impactoDe(
  tramos: readonly TramoParaBaja[],
  bloqueo: BloqueoBaja | null,
  conductoresHabituales: { id: number; nombreCompleto: string }[],
): ImpactoBaja {
  const pendientes = tramosPendientes(tramos, hoyIso(), horaEnZona());
  const primera = pendientes[0];
  return {
    asignacionesVigentes: pendientes.length,
    primeraAsignacion: primera
      ? {
          fecha: primera.fecha,
          horaInicio: primera.horaInicio,
          identificador: primera.identificador,
        }
      : null,
    conductoresHabituales,
    motivo: bloqueo?.mensaje ?? null,
  };
}

/**
 * La placa se guarda en mayúsculas, sin espacios y con guion (`PBA1234` → `PBA-1234`), para que
 * `uq_vehiculo_placa` no admita la misma placa escrita de dos maneras.
 */
function normalizarPlaca(placa: string): string {
  const normalizada = normalizarFormaPlaca(placa);

  if (normalizada.length === 0) {
    throw new ValidacionError('Indique la placa del vehículo.', {});
  }

  if (normalizada.length > LARGO_MAXIMO_PLACA) {
    throw new ValidacionError(
      `La placa no puede superar los ${LARGO_MAXIMO_PLACA} caracteres.`,
      { placa },
    );
  }

  return normalizada;
}

/** D4 (2026-10-14): AAA-999 o AAA-9999. */
function exigirFormatoPlaca(placa: string): void {
  if (!esPlacaValida(placa)) {
    throw new ValidacionError(
      `La placa ${placa} no tiene un formato válido: se escribe AAA-999 o AAA-9999.`,
      { placa },
    );
  }
}

/** La traza nombra columnas, no propiedades del modelo. */
function columnasDeConductor(conductor: {
  patronRotacion?: string | null;
  actaParqueaderoNumero?: string | null;
  actaParqueaderoDesde?: Date | null;
  actaParqueaderoHasta?: Date | null;
  nombreCompleto: string;
  telefono: string | null;
  licenciaTipo: string | null;
  sector?: string | null;
  parqueaderoAutorizado?: boolean;
  tipoContrato?: string | null;
  vehiculoHabitualId: number | null;
  activo: boolean;
}): Record<string, unknown> {
  return {
    cond_nombre_completo: conductor.nombreCompleto,
    // El número no se copia a la traza: es un dato personal, y para pedir cuentas basta
    // con saber que cambió. Mismo criterio que el maestro de personal (M-10).
    cond_telefono: conductor.telefono ? '[dato personal]' : null,
    cond_licencia_tipo: conductor.licenciaTipo,
    vehi_id: conductor.vehiculoHabitualId,
    cond_activo: conductor.activo,
    // Los tres del 2026-08-31. NO son datos personales en el sentido de la cédula o el
    // teléfono: describen la relación laboral y la logística, no a la persona fuera del
    // trabajo, y sin su valor en la traza no se podría auditar quién habilitó a quién a
    // llevarse un vehículo a casa —que es justamente lo que hay que poder auditar—.
    cond_sector: conductor.sector ?? null,
    cond_parqueadero_autorizado: conductor.parqueaderoAutorizado ?? false,
    cond_tipo_contrato: conductor.tipoContrato ?? null,
    // El acta de parqueadero (2026-10-06): es lo que habilita llevarse el vehículo a casa.
    cond_acta_parqueadero_numero: conductor.actaParqueaderoNumero ?? null,
    cond_acta_parqueadero_desde: diaONulo(conductor.actaParqueaderoDesde),
    cond_acta_parqueadero_hasta: diaONulo(conductor.actaParqueaderoHasta),
    cond_patron_rotacion: conductor.patronRotacion ?? null,
  };
}

function diaONulo(fecha: Date | null | undefined): string | null {
  return fecha ? fecha.toISOString().slice(0, 10) : null;
}

/** Quita las claves `undefined` para que no pisen el valor actual al combinar. */
function definidos<T extends object>(cambios: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(cambios).filter(([, valor]) => valor !== undefined),
  ) as Partial<T>;
}

/**
 * Art. 8 del Reglamento: el acta de parqueadero solo tiene sentido con el parqueadero autorizado,
 * y su vigencia es un rango (desde ≤ hasta) que viaja completo con su número.
 */
function exigirActaCoherente(conductor: {
  parqueaderoAutorizado?: boolean;
  actaParqueaderoNumero?: string | null;
  actaParqueaderoDesde?: Date | null;
  actaParqueaderoHasta?: Date | null;
}): void {
  const numero = conductor.actaParqueaderoNumero?.trim() || null;
  const desde = conductor.actaParqueaderoDesde ?? null;
  const hasta = conductor.actaParqueaderoHasta ?? null;
  if (numero === null && desde === null && hasta === null) return;
  if (!conductor.parqueaderoAutorizado) {
    throw new ValidacionError(
      'El acta de parqueadero solo se registra si el conductor tiene parqueadero autorizado.',
      {},
    );
  }
  if (numero === null || desde === null || hasta === null) {
    throw new ValidacionError(
      'El acta de parqueadero necesita su número y su vigencia (desde y hasta).',
      {},
    );
  }
  if (desde > hasta) {
    throw new ValidacionError(
      'La vigencia del acta de parqueadero termina antes de empezar.',
      {},
    );
  }
}

function columnasDeVehiculo(vehiculo: {
  placa: string;
  descripcion: string | null;
  activo: boolean;
  tipo?: string | null;
  asientos?: number | null;
  kilometraje?: number | null;
  matriculaVencimiento?: Date | null;
  soatVencimiento?: Date | null;
}): Record<string, unknown> {
  return {
    vehi_placa: vehiculo.placa,
    vehi_descripcion: vehiculo.descripcion,
    vehi_activo: vehiculo.activo,
    vehi_tipo: vehiculo.tipo ?? null,
    vehi_asientos: vehiculo.asientos ?? null,
    vehi_kilometraje: vehiculo.kilometraje ?? null,
    vehi_matricula_vencimiento: diaONulo(vehiculo.matriculaVencimiento),
    vehi_soat_vencimiento: diaONulo(vehiculo.soatVencimiento),
  };
}
