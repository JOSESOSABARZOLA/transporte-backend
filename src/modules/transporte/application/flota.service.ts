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
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  type Conductor,
  type UbicacionFlota,
  type Vehiculo,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
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
} from '../infrastructure/flota.repository';

/** Resultado de una baja, con lo que el administrador necesita saber. */
export interface ResultadoBajaFlota<T> {
  registro: T;
  operativosHistoricos: number;
  mensaje: string;
}

/** `vehi_placa` admite diez caracteres. Formato libre: ninguna fuente lo define. */
const LARGO_MAXIMO_PLACA = 10;

@Injectable()
export class FlotaService {
  constructor(
    private readonly repositorio: FlotaRepository,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─────────────────────────── Conductores ───────────────────────────

  async listarConductores(
    incluirInactivos = false,
  ): Promise<ConductorConVehiculo[]> {
    return this.repositorio.listarConductores(!incluirInactivos);
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

  /** Baja lógica. El conductor sale del desplegable y conserva su historial. */
  async desactivarConductor(
    id: number,
    usuarioId: number,
  ): Promise<ResultadoBajaFlota<Conductor>> {
    const actual = await this.exigirConductor(id);
    const historicos = await this.repositorio.contarOperativosDeConductor(id);

    const registro = actual.activo
      ? await this.actualizarConductor(id, { activo: false }, usuarioId)
      : actual;

    return {
      registro,
      operativosHistoricos: historicos,
      mensaje:
        historicos > 0
          ? `${actual.nombreCompleto} deja de ofrecerse en el desplegable. Sigue figurando en ${historicos} operativo${historicos === 1 ? '' : 's'} ya registrado${historicos === 1 ? '' : 's'}.`
          : `${actual.nombreCompleto} deja de ofrecerse en el desplegable.`,
    };
  }

  // ─────────────────────────── Vehículos ───────────────────────────

  async listarVehiculos(incluirInactivos = false): Promise<Vehiculo[]> {
    return this.repositorio.listarVehiculos(!incluirInactivos);
  }

  async crearVehiculo(
    datos: DatosVehiculo,
    usuarioId: number,
  ): Promise<Vehiculo> {
    const placa = normalizarPlaca(datos.placa);

    const repetida = await this.repositorio.buscarVehiculoPorPlaca(placa);
    if (repetida) {
      throw new ValidacionError(
        `Ya existe un vehículo registrado con la placa ${placa}.`,
        { placa },
      );
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
    const placa = cambios.placa ? normalizarPlaca(cambios.placa) : undefined;

    if (placa && placa !== actual.placa) {
      const repetida = await this.repositorio.buscarVehiculoPorPlaca(placa);
      if (repetida) {
        throw new ValidacionError(
          `Ya existe un vehículo registrado con la placa ${placa}.`,
          { placa },
        );
      }
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

  async desactivarVehiculo(
    id: number,
    usuarioId: number,
  ): Promise<ResultadoBajaFlota<Vehiculo>> {
    const actual = await this.exigirVehiculo(id);
    const historicos = await this.repositorio.contarOperativosDeVehiculo(id);

    const registro = actual.activo
      ? await this.actualizarVehiculo(id, { activo: false }, usuarioId)
      : actual;

    return {
      registro,
      operativosHistoricos: historicos,
      mensaje:
        historicos > 0
          ? `El vehículo de placa ${actual.placa} deja de ofrecerse. Sigue figurando en ${historicos} operativo${historicos === 1 ? '' : 's'} ya registrado${historicos === 1 ? '' : 's'}.`
          : `El vehículo de placa ${actual.placa} deja de ofrecerse.`,
    };
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

  // ─────────── Ubicaciones de reposo de la flota · RN-DAF-03 ───────────

  /**
   * El catálogo de zonales donde puede quedar un vehículo.
   *
   * NACE VACÍO Y SE CARGA A MANO. La evidencia se contradice —cinco zonales en la hoja de
   * agosto, cuatro en la reunión— y es la pregunta Q-01, sin responder. Sembrar cinco
   * filas «porque están en el Excel» convertiría una suposición en un dato maestro y nadie
   * volvería a preguntarse de dónde salió.
   */
  async listarUbicaciones(incluirInactivas = false): Promise<UbicacionFlota[]> {
    return this.repositorio.listarUbicaciones(!incluirInactivas);
  }

  async crearUbicacion(
    nombre: string,
    usuarioId: number,
  ): Promise<UbicacionFlota> {
    const limpio = nombre.trim().toUpperCase();

    // Mayúsculas y sin espacios sobrantes, igual que la placa. El Excel escribe la misma
    // zonal como CALDERON, «LA CALDERON» y con tilde; el catálogo existe para acabar con
    // eso, y admitir dos grafías del mismo sitio lo reintroduciría por la puerta de atrás.
    const repetida = await this.repositorio.buscarUbicacionPorNombre(limpio);

    if (repetida) {
      throw new ValidacionError(
        `Ya existe una zonal registrada con el nombre ${limpio}.`,
        { nombre: limpio },
      );
    }

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const creada = await this.repositorio.crearUbicacion(limpio, cliente);

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

  async actualizarUbicacion(
    id: number,
    cambios: { nombre?: string; activo?: boolean },
    usuarioId: number,
  ): Promise<UbicacionFlota> {
    const actual = await this.repositorio.buscarUbicacion(id);

    if (!actual) {
      throw new RecursoNoEncontradoError(
        `No existe una zonal con identificador ${id}.`,
        { id },
      );
    }

    const nombre =
      cambios.nombre === undefined
        ? undefined
        : cambios.nombre.trim().toUpperCase();

    const traza = this.auditoria.compararCambios(
      { ubic_nombre: actual.nombre, ubic_activo: actual.activo },
      {
        ubic_nombre: nombre ?? actual.nombre,
        ubic_activo: cambios.activo ?? actual.activo,
      },
    );

    if (traza.length === 0) return actual;

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const guardada = await this.repositorio.actualizarUbicacion(
        id,
        { nombre, activo: cambios.activo },
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
}

/**
 * La placa se guarda en mayúsculas y sin espacios.
 *
 * Ninguna fuente define su formato —`PBA-1234`, `PBA1234`, con guion o sin él—, así que
 * no se impone uno: solo se normaliza lo que no cambia el dato, para que `uq_vehiculo_placa`
 * no admita la misma placa escrita de dos maneras.
 */
function normalizarPlaca(placa: string): string {
  const normalizada = placa.trim().toUpperCase().replace(/\s+/g, '');

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

/** La traza nombra columnas, no propiedades del modelo. */
function columnasDeConductor(conductor: {
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
  };
}

function columnasDeVehiculo(vehiculo: {
  placa: string;
  descripcion: string | null;
  activo: boolean;
}): Record<string, unknown> {
  return {
    vehi_placa: vehiculo.placa,
    vehi_descripcion: vehiculo.descripcion,
    vehi_activo: vehiculo.activo,
  };
}
