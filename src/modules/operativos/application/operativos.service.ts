/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: operativos.service.ts
 * Responsabilidad: Registrar, editar, retirar y consultar operativos del cuadro.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ES EL NÚCLEO DEL SISTEMA. Todo lo anterior existe para que esta operación sea posible
 * y todo lo posterior parte de lo que aquí se guarda.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL ORDEN DE LAS COMPROBACIONES NO ES ARBITRARIO. Sigue §11.1 de la guía:
 *
 *   Identidad → Rol → Formulario → Ventana → DTO → Coherencia → Persistencia
 *      401       403     403        423      400      400/409      409
 *
 * Las cuatro primeras las resuelven las guardas antes de llegar aquí. Este servicio
 * empieza por la jornada —¿existe el cuadro y admite escritura?— porque es lo que
 * invalida todo lo demás: validar catálogos de un cuadro cerrado es trabajo perdido y,
 * peor, un mensaje que habla del punto de encuentro cuando el problema es otro.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * EL SECUENCIAL SE OBTIENE DENTRO DE LA TRANSACCIÓN Y SE REINTENTA (RN-12, VAL-32).
 * Contar y crear ocurren con el mismo cliente; si aun así dos peticiones coinciden, la
 * restricción única rechaza a una y **se reintenta hasta tres veces**. El funcionario no
 * ve nada: es el caso 5 del plan.
 *
 * NO CONTIENE REGLAS DE DESCANSO. Desde M-15 este servicio asigna personal, y para ello
 * **pregunta** a `ElegibilidadService`: recibe un veredicto —elegible o no, y por qué— y
 * lo traslada. Los antecedentes con los que se decidió no cruzan la frontera. Si alguna
 * de esas reglas apareciera escrita aquí, es un defecto (regla 1 de CLAUDE.md).
 */

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  TipoTransporte,
  AreaPersonal,
  EstadoCuadro,
  EstadoTransporte,
  Prisma,
  RolDepartamental,
} from '@prisma/client';

import {
  AuditoriaService,
  type CambioCampo,
} from '../../../common/auditoria/auditoria.service';
import { VentanaCargaEvaluador } from '../../../common/auth/application/ventana-carga.evaluador';
import { VentanaCargaRepository } from '../../../common/auth/infrastructure/ventana-carga.repository';
import type { ApplicationError } from '../../../common/errors/application.error';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  AutorizacionError,
  ConflictoConcurrenciaError,
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  CatalogosService,
  type CatalogosDeFormulario,
} from '../../configuracion/application/catalogos.service';
import { FormulariosService } from '../../configuracion/application/formularios.service';
import { ParametroPoliticaService } from '../../configuracion/application/parametro-politica.service';
import { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import { ElegibilidadService } from '../../talento-operativo/application/elegibilidad.service';
import { FuncionariosService } from '../../talento-operativo/application/funcionarios.service';
import { ClasificacionControl } from '../domain/clasificacion-control';
import { RangoHorario } from '../domain/rango-horario';
import { UbicacionOperativa } from '../domain/ubicacion-operativa';
import { AsignacionPersonalRepository } from '../infrastructure/asignacion-personal.repository';
import {
  OperativosRepository,
  type CambiosOperativo,
  type DatosOperativo,
  type FiltroOperativos,
  type OperativoCompleto,
  type OperativoParaCoincidencia,
} from '../infrastructure/operativos.repository';
import type { TramiteDeInspeccion } from '../infrastructure/inspeccion-tramites.client';
import { CalculadorAlertasService } from './calculador-alertas.service';
import { TramitesInspeccionService } from './tramites-inspeccion.service';
import { GeneradorIdentificadorService } from './generador-identificador.service';
import {
  RegistroCompatibilidadCompartir,
  type OperativoParaCompartir,
} from './compartir-transporte.puerto';
import { RegistroHerenciaTransporte } from './herencia-transporte.puerto';
import {
  verificarComposicion,
  type AsignacionExistente,
  type FormularioParaComposicion,
} from './politicas/composicion-personal';
import {
  admiteEdicion,
  CLAVE_RANGO_MAX_DIAS,
  fechaVigente,
  interpretarRangoMax,
} from './politicas/rango-consulta';

/** Quién realiza la operación. Lo resuelve `IdentidadGuard`, nunca el cuerpo. */
export interface Autor {
  usuarioId: number;
  rol: RolDepartamental;
}

/** Datos de registro, ya validados por el DTO. */
export interface DatosRegistro {
  cuadroFecha: Date;
  formularioCodigo: string;
  /**
   * Horario del operativo. **Opcional desde RN-66 (2026-09-08):** si no viaja, se TOMA de
   * las ventanas de las personas (`RangoHorario.envolvente`). Se conserva por compatibilidad
   * y para el modo clásico de las pruebas de integración.
   */
  horaInicio?: string;
  horaFin?: string;
  zonalesIds: number[];
  puntoEncuentroId?: number;
  puntoLibre?: string;
  /**
   * PUNTO NUEVO capturado al registrar (Unidad de Operativos, 2026-09-24). Excluyente con
   * `puntoEncuentroId`/`puntoLibre`. Se crea en el catálogo DENTRO de la transacción del registro,
   * ligado a este formulario: si el operativo no se crea, el punto tampoco. Solo en los formularios
   * con `puntoManual`. Ver `registrar`.
   */
  puntoNuevo?: { nombre: string; zonalId: number };
  tipoControlId?: number;
  /** Varios tipos, SOLO donde el formulario lo admite (form 8). */
  tipoControlIds?: number[];
  tipoLibre?: string;
  institucionesIds: number[];
  /** Personal que se asigna con el registro. Todo o nada: ver `CrearOperativoDto`. */
  personalIds?: number[];
  /** Personal con ventana horaria propia (2026-09-08). Prioritario sobre `personalIds`. */
  personal?: AsignacionSolicitada[];
  /** Notas del operativo (bitácora, 2026-09-09). Cada una entra como una fila propia. */
  observaciones?: string[];
  /**
   * Qué transporte pide el departamento (2026-10-06): COMPLETO, SOLO_INICIO, SOLO_FIN, INICIO_Y_FIN o
   * PROPIOS_MEDIOS. Lo dice QUIEN REGISTRA; no es conductor ni vehículo, así que no toca RN-40.
   * Si no viaja, COMPLETO (valor por defecto del esquema).
   */
  tipoTransporte?: TipoTransporte;
  /** Macrooperativo: la DAF lo prioriza al asignar. */
  esMacrooperativo?: boolean;
  /**
   * COMPARTIR UNIDAD (2026-10-19): con quién pide viajar en la misma unidad (intención que la DAF
   * ejecuta) y por qué pide vehículo exclusivo. Ver `validarCompartir`.
   */
  compartirConOperativoId?: number | null;
  justificacionExclusivo?: string | null;
}

/**
 * Datos de un adicional. Es un registro **sin jornada ni formulario**.
 *
 * Los dos se heredan del operativo del que nace y no se pueden enviar: un adicional en
 * otra fecha no es un adicional, y en otro formulario tendría un prefijo que no
 * corresponde al código de su padre.
 */
export type DatosAdicional = Omit<
  DatosRegistro,
  | 'cuadroFecha'
  | 'formularioCodigo'
  | 'compartirConOperativoId'
  | 'justificacionExclusivo'
>;

/** Datos de edición. Lo que no viene, no cambia. */
export interface DatosEdicion {
  version: number;
  horaInicio?: string;
  horaFin?: string;
  zonalesIds?: number[];
  puntoEncuentroId?: number;
  puntoLibre?: string;
  tipoControlId?: number;
  /** Varios tipos, SOLO donde el formulario lo admite (form 8). */
  tipoControlIds?: number[];
  tipoLibre?: string;
  institucionesIds?: number[];
  /** Notas NUEVAS a agregar (bitácora append-only, 2026-09-09). Las ya escritas no cambian. */
  observacionesNuevas?: string[];
  tipoTransporte?: TipoTransporte;
  esMacrooperativo?: boolean;
  /** Compartir unidad (2026-10-19). Lo que no viene, no cambia; `null` la retira. */
  compartirConOperativoId?: number | null;
  justificacionExclusivo?: string | null;
  /**
   * Transporte requerido (2026-10-07). Cambiar el tipo de un operativo que ya tiene transporte
   * asignado LIBERA la asignación: sin esta confirmación expresa se rechaza con 409
   * (`CAMBIO_TIPO_CON_TRANSPORTE`) para que la pantalla pregunte antes.
   */
  confirmarLiberacion?: boolean;
}

/**
 * Los campos GENERALES de la edición, sin la versión. Es lo que edita `editarPatrulla` para
 * toda la patrulla (2026-09-18): sin `version` porque el bloqueo optimista se resuelve por
 * miembro con la versión actual de cada uno; el horario tampoco viaja (es por persona/código).
 */
export type DatosEdicionGenerales = Omit<DatosEdicion, 'version'>;

/** Cambios generales ya calculados y validados, listos para escribir. */
interface CambiosGeneralesPreparados {
  cambios: CambiosOperativo;
  zonalIds: number[];
  institucionIds: number[];
  tipoIds: number[];
  observacionesNuevas: string[];
  traza: CambioCampo[];
  /** Transporte requerido (2026-10-07): el tipo de transporte cambia con esta edición. */
  cambiaTipo: boolean;
  /**
   * Ocupación por tramos (2026-10-14): cambia el horario o la zonal. Los tramos se cortaron con
   * los anteriores, así que dejan de corresponder (D4).
   */
  cambiaFranja: boolean;
}

export interface CriteriosConsulta {
  /** Rango de fechas del cuadro, inclusive (2026-10-13). Un día: desde = hasta. */
  desde?: Date;
  hasta?: Date;
  formularioCodigo?: string;
  pagina: number;
  tamanio: number;
}

/**
 * Resultado de la baja. `eliminado` distingue las dos que existen (PV-10).
 *
 * La pantalla necesita saber cuál ocurrió: «se eliminó» y «se retiró del cuadro, pero se
 * conserva porque ya tiene órdenes emitidas» no son la misma noticia para quien la lee.
 */
export interface ResultadoBaja {
  id: number;
  identificador: string;
  /** `true` si la fila se borró; `false` si quedó con baja lógica. */
  eliminado: boolean;
  /** Por qué no se pudo borrar, cuando `eliminado` es falso. */
  ordenesEmitidas: number;
}

/** Roles que ven la jornada completa. Los demás ven lo suyo (PER-02). */
const VEN_TODO: RolDepartamental[] = [
  RolDepartamental.DIRECTOR,
  RolDepartamental.DAF,
];

/**
 * Roles con ÁMBITO DEPARTAMENTAL propio en el listado: los que escriben o aportan en el
 * cuadro. Son los únicos que acotan la consulta. Un rol de LECTURA TOTAL (`VEN_TODO`) que el
 * usuario lleve ADEMÁS de uno de éstos NO amplía las pantallas departamentales (P-01/P-02):
 * entonces actúa como su departamento y ve lo suyo. Solo la Dirección o la DAF «puras» —sin
 * ningún rol departamental que acotar— ven todo (Camino B, 2026-09-10).
 */
const DEPARTAMENTALES: RolDepartamental[] = [
  RolDepartamental.DMIP_OPERATIVOS,
  RolDepartamental.DMIP_INSPECCIONES,
  RolDepartamental.DMIT_INSTRUCTOR,
];

/**
 * Bajo qué roles se ve el listado (PER-02). `null` = la jornada entera.
 *
 * Los roles con ámbito departamental propio (escriben o aportan) ACOTAN la consulta si el
 * usuario tiene ALGUNO: un rol de lectura total (Dirección/DAF) que lleve encima NO amplía las
 * pantallas departamentales (Camino B, 2026-09-10). Así, el listado sigue mostrando la UNIÓN
 * de lo departamental —DMIP Operativos + Inspecciones ve 1–4 y el 8—, pero tener DIRECTOR
 * entre los roles ya no revela lo de los demás departamentos.
 *
 * Ve todo SOLO quien es de lectura total y NO tiene ningún rol departamental que acotar: la
 * Dirección o la DAF «puras». Su visión completa vive en sus propias pantallas (matriz,
 * órdenes, transporte); aquí, sin departamento, ven la jornada entera.
 */
function visiblesPara(
  roles: readonly RolDepartamental[],
): RolDepartamental[] | null {
  const departamentales = roles.filter((rol) => DEPARTAMENTALES.includes(rol));

  const veTodo =
    departamentales.length === 0 && roles.some((rol) => VEN_TODO.includes(rol));

  return veTodo ? null : departamentales;
}

/** El operativo en captura, visto para buscar con quién compartir unidad (2026-10-19). */
export interface FiltroCoincidencias {
  fecha: Date;
  puntoEncuentroId: number;
  zonalId: number;
  horaInicio: string;
  horaFin: string;
  tipoTransporte: TipoTransporte;
  esMacrooperativo?: boolean;
  excluirOperativoId?: number;
}

/** Un operativo con el que se podría compartir unidad (2026-10-19). Solo nombra al personal. */
export interface CoincidenciaTransporte {
  operativoId: number;
  identificador: string;
  formularioNumero: number;
  personal: string[];
  horaInicio: string;
  horaFin: string;
  tipoTransporte: TipoTransporte;
  esMacrooperativo: boolean;
  compatible: boolean;
  motivo?: string;
  /** Traslados que harían juntos en la misma unidad («dejar»). Vacío si no es compatible. */
  comparte: string[];
  /** Traslados del invitado sin pareja («retirar»): la misma unidad o la DAF los hacen aparte. */
  propios: string[];
  /** Con qué operativo de la unidad viaja cada traslado compartido. */
  comparteCon: { tipo: string; con: string }[];
  /** «Completo» (2026-10-20): traslados de la unidad que el «completo» del invitado abarca. */
  contiene: string[];
  /** El «completo» de la unidad dentro del que viajan los traslados del invitado, o `null`. */
  contenidoEn: string | null;
}

/**
 * Aviso de una edición (2026-10-19): el operativo dejó de coincidir con el anfitrión con el que
 * pedía compartir unidad, y la intención se retiró. La pantalla lo dice con un aviso breve.
 */
export const AVISO_COMPARTIR_RETIRADO = 'COMPARTIR_RETIRADO';

/** Lo que devuelve `editar`: el operativo y, si los hay, los avisos de la edición. */
export type OperativoEditado = OperativoCompleto & { avisos?: string[] };

/** Cuántas coincidencias ofrece el registro: las de hora más cercana. */
const MAX_COINCIDENCIAS = 5;

/** El operativo en los términos del puerto de compartir unidad: lo que decide sus tramos. */
interface OperativoEnTerminosDeCompartir {
  horaInicio: string;
  horaFin: string;
  tipoTransporte: TipoTransporte;
  zonalIds: number[];
  esMacrooperativo: boolean;
}

function paraCompartir(op: OperativoEnTerminosDeCompartir) {
  return {
    horaInicio: op.horaInicio,
    horaFin: op.horaFin,
    tipoTransporte: op.tipoTransporte,
    zonalId: op.zonalIds[0] ?? null,
    esMacrooperativo: op.esMacrooperativo,
  };
}

function paraCompartirDe(
  op: OperativoParaCoincidencia,
  miembros: readonly OperativoParaCoincidencia[] = [],
): OperativoParaCompartir {
  return {
    ...paraCompartir({
      ...op,
      zonalIds: op.zonales.map((fila) => fila.zonalId),
    }),
    identificador: op.identificador,
    miembros: miembros.map((m) => paraCompartirDe(m)),
  };
}

/** «HH:MM» → minutos desde la medianoche. */
function minutosDe(hora: string): number {
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
}

const INTENTOS_SECUENCIAL = 3;

/** Clave del `Map` de conteo cuando se numera por FORMULARIO (una serie única), no por prefijo. */
const SERIE_FORMULARIO = '__serie-formulario__';

/** Una asignación de personal ya resuelta, lista para escribir junto a un operativo. */
interface AsignacionParaCrear {
  funcionarioId: number;
  asignadoPorRol: RolDepartamental;
  esResponsable: boolean;
  horaInicio: string | null;
  horaFin: string | null;
  /** Trámite de Inspección ya comprobado, a copiar en la asignación (2026-10-07). */
  tramite?: TramiteDeInspeccion | null;
}

@Injectable()
export class OperativosService {
  constructor(
    private readonly repositorio: OperativosRepository,
    private readonly personal: AsignacionPersonalRepository,
    private readonly cuadros: CuadroDiarioService,
    private readonly formularios: FormulariosService,
    private readonly catalogos: CatalogosService,
    private readonly parametros: ParametroPoliticaService,
    private readonly generador: GeneradorIdentificadorService,
    private readonly alertas: CalculadorAlertasService,
    private readonly funcionarios: FuncionariosService,
    private readonly elegibilidad: ElegibilidadService,
    private readonly auditoria: AuditoriaService,
    // Las dos siguientes NO sirven para bloquear: `AdicionalesController` no declara
    // `VentanaCargaGuard`, y la ventana se evalúa aquí solo para dejar constancia de si
    // estaba abierta cuando se creó el adicional. Ver `registrarAdicional`.
    private readonly ventanas: VentanaCargaRepository,
    private readonly evaluadorDeVentana: VentanaCargaEvaluador,
    private readonly logger: LoggerService,
    // Trámites de Inspección de los inspectores asignados (2026-10-07).
    private readonly tramites: TramitesInspeccionService,
    // El adicional hereda el transporte del original (2026-10-14): lo implementa `transporte`.
    private readonly herencia: RegistroHerenciaTransporte,
    // Compartir unidad (2026-10-19): la compatibilidad de tramos la responde `transporte`.
    private readonly compartir: RegistroCompatibilidadCompartir,
  ) {}

  // ─────────────────────────── Consulta ───────────────────────────

  async consultar(
    criterios: CriteriosConsulta,
    // TODOS los roles del usuario, no uno solo. 2026-09-09.
    //
    // Antes se filtraba por `autor.rol` —el rol bajo el que se hace la petición, que la guarda
    // estrecha AL PRIMERO que el endpoint admite—. Para una LECTURA eso escondía la mitad del
    // trabajo de quien tiene varios roles: un usuario con DMIP Operativos e Inspecciones veía
    // solo los formularios del primero (1–4) y nunca el 8. La escritura sí quiere un rol único
    // —para la auditoría—, pero el listado debe mostrar la UNIÓN, que es lo que el diseño
    // multi-rol promete: «ve la unión de los formularios de cada uno».
    roles: readonly RolDepartamental[],
  ): Promise<{ datos: OperativoCompleto[]; total: number }> {
    const filtro: FiltroOperativos = {
      desde: criterios.desde,
      hasta: criterios.hasta,
      formularioCodigo: criterios.formularioCodigo,
      visiblesPara: visiblesPara(roles),
      pagina: criterios.pagina,
      tamanio: criterios.tamanio,
    };

    return this.repositorio.listar(filtro);
  }

  /**
   * Cuántos operativos vigentes lleva cada formulario permitido en el cuadro de `fecha`
   * (2026-10-16): el «N hoy» del selector de formularios del registro.
   *
   * Cuenta con la MISMA visibilidad que `consultar` (PER-02, Camino B), así el número coincide
   * con lo que el usuario ve en la tabla. Devuelve TODOS los formularios de
   * `obtenerPermitidos`, con 0 los que no tienen operativos; una fecha sin cuadro da todo en 0.
   */
  async contarPorFormulario(
    fecha: Date,
    roles: readonly RolDepartamental[],
  ): Promise<{ formularioId: number; total: number }[]> {
    const [permitidos, conteo] = await Promise.all([
      this.formularios.obtenerPermitidos([...roles]),
      this.repositorio.contarPorFormulario({
        desde: fecha,
        hasta: fecha,
        visiblesPara: visiblesPara(roles),
      }),
    ]);

    return permitidos.map(({ formulario }) => ({
      formularioId: formulario.id,
      total: conteo.get(formulario.id) ?? 0,
    }));
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * COINCIDENCIAS PARA COMPARTIR UNIDAD · 2026-10-19 (plan «compartir unidad»).
   *
   * Mientras se registra un operativo con transporte de la DAF, la pantalla pregunta si ya hay otro
   * en el MISMO día, punto de encuentro, zonal y horario, para sugerir viajar en la misma unidad. Es
   * la causa del bloqueo por SOLAPAMIENTO que la DAF no puede resolver por su cuenta: varios
   * operativos de una persona en el mismo punto y hora.
   *
   * RN-48 (aislamiento): la misma visibilidad que el listado (`visiblesPara`). Nunca devuelve
   * operativos de formularios ajenos, y del personal solo el nombre. Si un candidato ya pide viajar
   * con otro, se ofrece ese ANFITRIÓN (no hay cadenas). Máximo `MAX_COINCIDENCIAS`, los de hora más
   * cercana primero. `compatible` lo decide `transporte` con la misma regla del optimizador, sin
   * asientos: todavía no hay vehículo.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async coincidenciasTransporte(
    filtro: FiltroCoincidencias,
    roles: readonly RolDepartamental[],
  ): Promise<CoincidenciaTransporte[]> {
    const visibles = visiblesPara(roles);
    const rango = RangoHorario.de(filtro.horaInicio, filtro.horaFin);
    const candidatos = await this.repositorio.buscarCoincidencias({
      fecha: filtro.fecha,
      puntoEncuentroId: filtro.puntoEncuentroId,
      zonalId: filtro.zonalId,
      excluirOperativoId: filtro.excluirOperativoId,
      visiblesPara: visibles,
    });
    const cruzan = candidatos.filter((candidato) =>
      RangoHorario.de(candidato.horaInicio, candidato.horaFin).seSolapaCon(
        rango,
      ),
    );

    // El anfitrión raíz: quien ya pide viajar con otro se ofrece como ese otro.
    const porId = new Map(cruzan.map((op) => [op.id, op]));
    const faltan = cruzan
      .map((op) => op.compartirConId)
      .filter((id): id is number => id !== null && !porId.has(id));
    const raices = new Map(
      (await this.repositorio.buscarParaCompartir(faltan, visibles)).map(
        (op) => [op.id, op],
      ),
    );
    const anfitriones = new Map<number, OperativoParaCoincidencia>();
    for (const op of cruzan) {
      const raiz =
        op.compartirConId === null
          ? undefined
          : (porId.get(op.compartirConId) ?? raices.get(op.compartirConId));
      const elegido = raiz && raiz.id !== filtro.excluirOperativoId ? raiz : op;
      anfitriones.set(elegido.id, elegido);
    }

    const inicio = minutosDe(filtro.horaInicio);
    const lista = [...anfitriones.values()]
      .sort(
        (a, b) =>
          Math.abs(minutosDe(a.horaInicio) - inicio) -
            Math.abs(minutosDe(b.horaInicio) - inicio) ||
          a.identificador.localeCompare(b.identificador),
      )
      .slice(0, MAX_COINCIDENCIAS);

    // La unidad es la del GRUPO (2026-10-19): con cada anfitrión van quienes ya piden viajar en ella.
    const miembros = await this.repositorio.miembrosDeUnidad(
      lista.map((op) => op.id),
      visibles,
      filtro.excluirOperativoId,
    );
    const veredictos = await this.compartir.evaluar(
      {
        horaInicio: filtro.horaInicio,
        horaFin: filtro.horaFin,
        tipoTransporte: filtro.tipoTransporte,
        zonalId: filtro.zonalId,
        esMacrooperativo: filtro.esMacrooperativo ?? false,
      },
      lista.map((op) =>
        paraCompartirDe(
          op,
          miembros.filter((m) => m.compartirConId === op.id),
        ),
      ),
    );

    return lista.map((op, i) => {
      const veredicto = veredictos[i] ?? {
        compatible: true,
        comparte: [],
        propios: [],
      };
      return {
        operativoId: op.id,
        identificador: op.identificador,
        formularioNumero: op.formulario.numero,
        personal: op.personal.map(
          (fila) => `${fila.funcionario.apellidos} ${fila.funcionario.nombres}`,
        ),
        horaInicio: op.horaInicio,
        horaFin: op.horaFin,
        tipoTransporte: op.tipoTransporte,
        esMacrooperativo: op.esMacrooperativo,
        compatible: veredicto.compatible,
        ...(veredicto.compatible
          ? {
              comparte: veredicto.comparte,
              propios: veredicto.propios,
              comparteCon: veredicto.comparteCon ?? [],
              contiene: veredicto.contiene ?? [],
              contenidoEn: veredicto.contenidoEn ?? null,
            }
          : {
              motivo: veredicto.motivo,
              comparte: [],
              propios: [],
              comparteCon: [],
              contiene: [],
              contenidoEn: null,
            }),
      };
    });
  }

  /**
   * Lo que la pantalla necesita ANTES de consultar un rango (2026-10-13): la fecha del cuadro
   * vigente y el rango máximo, para validar sin pedir. Si el parámetro aún no está sembrado,
   * rige el valor por defecto en vez de romper el listado.
   */
  async parametrosDeRango(
    ahora: Date = new Date(),
  ): Promise<{ fechaVigente: string; rangoMaxDias: number }> {
    return {
      fechaVigente: fechaVigente(ahora),
      rangoMaxDias: interpretarRangoMax(
        await this.parametros.obtenerTextoOpcional(CLAVE_RANGO_MAX_DIAS),
      ),
    };
  }

  /**
   * Conductor y placa de cada fila del listado (2026-10-13), en el mismo orden que `operativos`.
   * Solo lectura de lo que asignó la DAF; dos consultas para toda la página.
   */
  async transporteDelListado(
    operativos: readonly OperativoCompleto[],
  ): Promise<{ conductor: string; placa: string | null }[][]> {
    const porId = await this.repositorio.transporteDeOperativos(
      operativos.map((op) => op.id),
    );
    return operativos.map((op) => porId.get(op.id) ?? []);
  }

  /**
   * Si cada fila admite edición (2026-10-13): su cuadro no está cerrado, es el vigente y la
   * ventana está abierta. La ventana se evalúa UNA vez por rol en toda la petición, con el
   * mismo evaluador que `VentanaCargaGuard`. Para cada fila manda el rol que la creó si el
   * usuario lo tiene; si no —participa o aporta—, basta con que alguno de sus roles
   * departamentales tenga la ventana abierta. La propiedad sigue decidiéndola el cliente.
   */
  async admisionDeEdicion(
    operativos: readonly OperativoCompleto[],
    roles: readonly RolDepartamental[],
    ahora: Date = new Date(),
  ): Promise<boolean[]> {
    const vigente = fechaVigente(ahora);
    const propios = roles.filter((rol) => DEPARTAMENTALES.includes(rol));
    const abiertaPorRol = new Map<RolDepartamental, boolean>();

    // Solo hace falta evaluar la ventana si alguna fila es del cuadro vigente.
    if (
      operativos.some(
        (op) => op.cuadro.fecha.toISOString().slice(0, 10) === vigente,
      )
    ) {
      for (const rol of propios) {
        const veredicto = this.evaluadorDeVentana.evaluar(
          await this.ventanas.buscarPorRol(rol),
          ahora,
        );
        abiertaPorRol.set(rol, veredicto.puedeEscribir);
      }
    }

    const algunaAbierta = [...abiertaPorRol.values()].some(Boolean);

    return operativos.map((op) => {
      const abierta = abiertaPorRol.has(op.creadoPorRol)
        ? (abiertaPorRol.get(op.creadoPorRol) ?? false)
        : algunaAbierta;
      return admiteEdicion(
        {
          cuadroFecha: op.cuadro.fecha.toISOString().slice(0, 10),
          cuadroEstado: op.cuadro.estado,
        },
        vigente,
        abierta,
      );
    });
  }

  /**
   * Un operativo concreto, si el rol puede verlo.
   *
   * La propiedad se comprueba aquí y no en `FormularioRolGuard`: la ruta lleva el
   * identificador del operativo, no el código del formulario, y la guarda solo sabe leer
   * un código de la petición. Ver `exigirPropiedad`.
   */
  async obtener(
    id: number,
    autor: Autor,
    // TODOS los roles del usuario, no uno solo (2026-09-09). Puede VER el operativo si alguno
    // de sus roles lo ve. Por defecto, el único rol de la petición: comportamiento de siempre.
    roles: readonly RolDepartamental[] = [autor.rol],
  ): Promise<OperativoCompleto> {
    const operativo = await this.exigirOperativo(id);

    const veTodo = roles.some((rol) => VEN_TODO.includes(rol));
    const leCorrespondeAAlguno = roles.some((rol) =>
      leCorresponde(operativo, rol),
    );

    if (!veTodo && !leCorrespondeAAlguno) {
      throw new AutorizacionError(
        CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
        `El operativo ${operativo.identificador} pertenece al formulario ${operativo.formulario.nombre}, que no corresponde a su departamento.`,
        { operativoId: id, roles: [...roles] },
      );
    }

    return operativo;
  }

  /**
   * El operativo, exigiendo que el formulario sea del rol. Publicado en M-16.
   *
   * `SolicitudApoyoService` necesita exactamente la comprobación que `editar` y
   * `retirar` ya hacían en privado: solicitar apoyo es parte de construir el operativo,
   * y construirlo es del dueño. Publicarla evita que ese servicio repita la regla —y con
   * ella el riesgo de que las dos versiones se separen— o que lea el repositorio ajeno.
   */
  async exigirOperativoPropio(
    id: number,
    autor: Autor,
    roles: readonly RolDepartamental[] = [autor.rol],
  ): Promise<OperativoCompleto> {
    const operativo = await this.exigirOperativo(id);
    this.rolPropietarioEntre(operativo, roles);
    return operativo;
  }

  // ─────────────────────────── Registro ───────────────────────────

  /**
   * RN-09 a RN-20. Registra un operativo en la jornada.
   *
   * Escribe operativo, zonales, instituciones y auditoría **en una sola transacción**:
   * es el caso 13 del plan. Un fallo a mitad no deja un operativo sin zonales ni una
   * traza sin operativo.
   */
  async registrar(
    datos: DatosRegistro,
    autor: Autor,
    // Token de Auth central de la sesión: con él se vuelve a preguntar a Inspección por los
    // trámites elegidos (2026-10-07). Nunca se registra en la bitácora.
    tokenAuth: string | null = null,
  ): Promise<OperativoCompleto> {
    // Regla del 2026-08-11: registrar ABRE la jornada si todavía no existe, en lugar de
    // exigir que el administrador la haya abierto antes. El motivo y su alcance están en
    // `CuadroDiarioService.asegurarParaRegistro`. Las demás escrituras siguen usando
    // `exigirEscritura`: operan sobre un operativo que ya existe, así que su jornada
    // también.
    const cuadro = await this.cuadros.asegurarParaRegistro(
      datos.cuadroFecha,
      autor.usuarioId,
    );
    const formulario = await this.formularios.obtenerDefinicion(
      datos.formularioCodigo,
    );

    /*
      PER-01 y PER-06. `FormularioRolGuard` deja pasar a quien APORTA, porque para la
      guarda aportar es una forma de participación. Registrar, en cambio, exige
      `ESCRITURA`: quien tiene cupo pone personal en operativos que arma otro.

      SE COMPRUEBA CONTRA LAS FILAS, no contra el dueño: desde el 2026-08-25 un
      formulario puede tener **varios** departamentos que registran, y la patrulla ECU
      tiene dos.
    */
    if (!escribeEn(formulario, autor.rol)) {
      throw new AutorizacionError(
        CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
        `El formulario ${formulario.nombre} no es de su departamento: usted participa en él con cupo de personal, pero no registra sus operativos.`,
        { formularioCodigo: formulario.codigo, rol: autor.rol },
      );
    }

    // RN-66. El operativo TOMA su ventana de las personas si no trae horario propio; el
    // modo clásico (horario del operativo) se conserva. `es_nocturno` es «¿alguna persona?».
    const asignaciones = normalizarAsignaciones(datos);
    const { rango, esNocturno } = await this.ventanaDelOperativo(
      asignaciones,
      datos.horaInicio,
      datos.horaFin,
    );
    // Los catálogos se piden ANTES de componer la ubicación: desde el 2026-08-11 el
    // punto de encuentro también consulta si su catálogo admite ADICIONALES, igual que
    // el tipo de control. RN-20 es propiedad de cada catálogo.
    const catalogos = await this.catalogos.obtenerCatalogos(formulario.codigo);

    // PUNTO NUEVO (Unidad de Operativos, 2026-09-24): se teclea uno que no está en el catálogo y
    // se crea DENTRO de la transacción del registro, ligado a la zonal elegida. Excluyente con
    // elegir uno del catálogo o teclear un adicional suelto. Aquí se VALIDA —formulario que lo
    // permita, zonal, nombre libre— y se pospone su creación a la transacción: si el operativo se
    // rechaza, el punto tampoco queda (regla 5), que es lo que pidió Unidad de Operativos.
    let ubicacion: UbicacionOperativa;
    let puntoNuevo:
      | { nombre: string; zonalId: number; formularioId: number }
      | undefined;
    if (datos.puntoNuevo) {
      if (
        datos.puntoEncuentroId !== undefined ||
        datos.puntoLibre !== undefined
      ) {
        throw new ValidacionError(
          'Elija un punto del catálogo o cree uno nuevo, pero no las dos cosas.',
          { puntoNuevo: datos.puntoNuevo },
        );
      }
      // INV-07. El punto pertenece a UNA de las zonales del operativo: sin esto quedaría ligado a
      // una zonal que el operativo no cubre.
      if (!datos.zonalesIds.includes(datos.puntoNuevo.zonalId)) {
        throw new ValidacionError(
          'El punto nuevo debe pertenecer a una de las zonales seleccionadas para el operativo.',
          { zonalId: datos.puntoNuevo.zonalId },
        );
      }
      const nombre = await this.catalogos.validarPuntoDeRegistro(
        formulario.codigo,
        datos.puntoNuevo,
      );
      ubicacion = UbicacionOperativa.conPuntoPorCrear(datos.zonalesIds);
      puntoNuevo = {
        nombre,
        zonalId: datos.puntoNuevo.zonalId,
        formularioId: formulario.id,
      };
    } else {
      ubicacion = UbicacionOperativa.de({
        zonalIds: datos.zonalesIds,
        puntoId: datos.puntoEncuentroId,
        puntoLibre: datos.puntoLibre,
        capturaLibrePermitida: catalogos.capturaLibrePunto,
      });
    }

    const clasificacion = ClasificacionControl.de({
      tipoId: datos.tipoControlId,
      tipoIds: datos.tipoControlIds,
      tipoLibre: datos.tipoLibre,
      permiteCapturaLibre: catalogos.capturaLibreTipo,
      permiteMultiple: catalogos.tipoControlMultiple,
    });

    this.exigirCatalogosDelFormulario(
      catalogos,
      formulario.nombre,
      ubicacion,
      clasificacion,
      datos.institucionesIds,
    );

    const institucionIds = [...new Set(datos.institucionesIds)];

    // TODO O NADA. El personal se verifica ANTES de abrir la transacción: si alguien es
    // rechazado, esto lanza y no se ha escrito una sola fila. Ver `CrearOperativoDto`.
    const personal = await this.verificarPersonalDelRegistro(
      asignaciones,
      formulario,
      { fecha: cuadro.fecha, rango, esPatrulla: formulario.esPatrulla },
      autor,
    );
    // Trámites de Inspección (2026-10-07): se comprueban contra Inspección ANTES de la
    // transacción, igual que el personal. Con cantidad > 1 en el 8, las copias heredan el mismo.
    await this.adjuntarTramites(personal, cuadro.fecha, tokenAuth);

    // VARIOS OPERATIVOS POR PERSONA (2026-09-10). Solo en los formularios con `variosPorPersona`
    // (el 8 y, desde 2026-09-14, el 5): cada persona genera SUS propios operativos —uno por unidad
    // de su cantidad—, dividiendo su horario. En el resto, una cantidad > 1 se rechaza. Se comprueba también aquí
    // porque el navegador no es el control.
    this.exigirCantidadPorPersona(personal, catalogos.cantidadPorPersona);

    // La lista de operativos a crear, ya resuelta: uno por persona×tramo en el 5 y el 8; uno solo
    // con todo el personal en los demás. El descanso/cruce ya se verificó UNA vez sobre la ventana
    // completa de cada persona, así que sus tramos (disjuntos) no chocan entre sí (RN-28).
    const operativos = await this.componerOperativosDelRegistro(
      personal,
      rango,
      esNocturno,
      catalogos.variosPorPersona,
    );

    // Una PATRULLA (Form 5/6: split por persona SIN cantidad) numera POR PREFIJO —cada área desde
    // 001— y enlaza sus operativos con un mismo `grupoRegistro`. El DMIT lo adopta al APORTAR su
    // Instrucción (que crea su propio INECU en el mismo lote).
    const esPatrulla =
      catalogos.variosPorPersona && !catalogos.cantidadPorPersona;
    // EL LOTE ENLAZA TODO UN REGISTRO, no solo la patrulla (2026-09-21). Los formularios
    // `variosPorPersona` —la patrulla (5/6) Y el 8— reparten un mismo registro en varios operativos
    // de una persona; el lote los agrupa en pantalla como UN operativo. Que sea PATRULLA (aporte,
    // roster, numeración por prefijo) lo decide `esPatrulla`, NO el lote: el 8 lleva lote pero no es
    // patrulla —numera por formulario y sus códigos se editan/retiran uno por uno—.
    const grupoRegistro = catalogos.variosPorPersona ? randomUUID() : null;

    // COMPARTIR UNIDAD (2026-10-19): la intención se valida ANTES de abrir la transacción, como el
    // personal: si el destino no coincide, no se escribe nada. Propios medios la limpia, y sin
    // vehículo exclusivo la justificación sobra. Ver `evaluarDestinoCompartir`.
    const tipoTransporte =
      datos.tipoTransporte ?? formulario.tipoTransporteDefecto;
    const esMacrooperativo = macroSegunTipo(
      tipoTransporte,
      datos.esMacrooperativo,
    );
    let compartirConId: number | null = null;
    if (
      tipoTransporte !== TipoTransporte.PROPIOS_MEDIOS &&
      datos.compartirConOperativoId
    ) {
      const resultado = await this.evaluarDestinoCompartir(
        datos.compartirConOperativoId,
        {
          cuadroId: cuadro.id,
          puntoEncuentroId: ubicacion.puntoId,
          zonalIds: [...ubicacion.zonalIds],
          horaInicio: rango.horaInicio,
          horaFin: rango.horaFin,
          tipoTransporte,
          esMacrooperativo,
        },
        [autor.rol],
      );
      if ('error' in resultado) throw resultado.error;
      compartirConId = resultado.anfitrionId;
    }

    const operativo = await this.registrarConSecuencial(
      {
        cuadroId: cuadro.id,
        formulario,
        fechaJornada: cuadro.fecha,
        rango,
        esNocturno,
        ubicacion,
        puntoNuevo,
        clasificacion,
        institucionIds,
        observaciones: notasLimpias(datos.observaciones),
        personal,
        grupoRegistro,
        numeraPorPrefijo: esPatrulla,
        // Sin tipo indicado, el del formulario (2026-10-07).
        tipoTransporte,
        esMacrooperativo,
        compartirConId,
        justificacionExclusivo: esMacrooperativo
          ? (datos.justificacionExclusivo ?? null)
          : null,
      },
      autor,
      operativos,
    );

    // Evento `OperativoRegistrado`, después de confirmar (regla 6 de CLAUDE.md). Las
    // alertas NO se derivan de este evento: se calculan dentro de la misma transacción
    // del registro, porque un operativo sin alertas guardadas ya sería un dato falso.
    this.logger.log('Operativo registrado', {
      identificador: operativo.identificador,
      formulario: formulario.codigo,
      fecha: comoFecha(cuadro.fecha),
      horario: rango.toString(),
    });

    // Con el nombre de quien firmó sus notas (2026-10-19): la respuesta trae `notas` con autor.
    return (await this.repositorio.conAutores([operativo]))[0];
  }

  // ─────────────────────────── Adicional del día ───────────────────────────

  /**
   * Registra un operativo ADICIONAL sobre otro ya existente. 2026-08-20.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * QUÉ ES. Una salida extraordinaria que se dispone POR URGENCIA el mismo día en que se
   * ejecuta, colgando de un operativo que ya estaba planificado. No corrige al original
   * —para eso está `editar`— ni es una segunda salida programada: es una salida que no
   * existía cuando se armó el cuadro, y por eso llega tarde por definición.
   *
   * LO QUE HEREDA DEL PADRE, y no se puede enviar: la jornada y el formulario. Todo lo
   * demás —horario, zonales, punto, tipo, instituciones, personal— es suyo y puede
   * diferir: si coincidiera en todo con el padre no habría razón para crearlo.
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * SE SALTA LA VENTANA DE CARGA, Y ES LA ÚNICA ESCRITURA DEL SISTEMA QUE LO HACE.
   *
   * `AdicionalesController` no declara `VentanaCargaGuard`. Es deliberado que la excepción
   * viva en la firma de un controlador aparte y no en un decorador que la guarda lea: un
   * mecanismo general de exención acabaría puesto en otro endpoint «porque hace falta», y
   * la ventana dejaría de ser una garantía. Para eximir a un segundo endpoint hay que
   * crear otro controlador, que es exactamente la fricción que esto debe tener.
   *
   * LAS OTRAS TRES GUARDAS SE CONSERVAN: identidad, rol y —aquí, en el servicio, porque la
   * ruta lleva el identificador del padre y no un código de formulario— la propiedad del
   * formulario. Lo único que se salta es el horario.
   *
   * Y «AUDITADA» SIGNIFICA ALGO CONCRETO. La ventana se evalúa igual, no bloquea, y su
   * veredicto se escribe en la traza. Sin eso, un adicional creado a las diez de la mañana
   * —dentro de ventana, sin nada excepcional— sería indistinguible de uno creado a las
   * once de la noche, y la pregunta que justifica la excepción —«¿cuántos adicionales se
   * crearon fuera de ventana el mes pasado?»— no tendría respuesta.
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   * LO QUE NO SE SALTA ES EL CUADRO CERRADO. Ventana y estado del cuadro son cosas
   * distintas: la primera acota el horario de carga de cada departamento, el segundo dice
   * si la jornada admite cambios. `APROBADO` —el estado normal el día de la ejecución— sí
   * los admite. `CERRADO` no, y entonces esto se detiene: reabrir el cuadro es potestad de
   * la Dirección, deja su propia traza, y es quien debe enterarse de que algo se sale de
   * lo que ya aprobó.
   */
  async registrarAdicional(
    origenId: number,
    datos: DatosAdicional,
    autor: Autor,
    roles: readonly RolDepartamental[] = [autor.rol],
    tokenAuth: string | null = null,
  ): Promise<OperativoCompleto> {
    // ═══════════════════════════════════════════════════════════════════════════
    // LA DIRECCIÓN SE MIDE CON OTRA VARA, Y ES LO QUE HACE UTILIZABLE ESTO. 2026-08-20.
    //
    // Un rol departamental solo puede sobre SU formulario y con el cuadro abierto. La
    // Dirección puede sobre cualquiera y **también sobre un cuadro cerrado**, porque
    // RN-58 no exige que el cuadro sea inmutable: exige *autorización de la Dirección*, y
    // aquí ella es la autorización.
    //
    // No es una comodidad: la operación real es armar el cuadro, consolidar la matriz,
    // CERRARLO, y entonces recibir la urgencia. Exigir el cuadro abierto dejaba el
    // adicional inservible justo en el momento para el que se construyó.
    // ═══════════════════════════════════════════════════════════════════════════
    // Multi-rol (2026-09-09): la dispone la Dirección si el usuario TIENE ese rol, no si es el
    // que la guarda eligió primero. Y actúa bajo el sombrero correcto para la traza.
    const laDisponeLaDireccion = roles.includes(RolDepartamental.DIRECTOR);

    // Existe, está activo y —salvo la Dirección— el formulario es del rol.
    const padre = laDisponeLaDireccion
      ? await this.exigirOperativo(origenId)
      : await this.exigirOperativoPropio(origenId, autor, roles);

    const autorEfectivo: Autor = {
      usuarioId: autor.usuarioId,
      rol: laDisponeLaDireccion
        ? RolDepartamental.DIRECTOR
        : this.rolPropietarioEntre(padre, roles),
    };

    // UN ADICIONAL NO PUEDE TENER ADICIONALES. Decisión del negocio del 2026-08-20.
    // Encadenarlos convertiría una excepción acotada en una cadena sin fondo, y ningún
    // caso descrito lo necesita: lo que se dispone por urgencia se cuelga de lo
    // planificado, no de otra urgencia.
    if (padre.origenId !== null) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.ADICIONAL_NO_ENCADENABLE,
        `El operativo ${padre.identificador} ya es un adicional, y un adicional no admite adicionales. Cuélguelo del operativo original de la jornada.`,
        { operativoId: origenId, origenId: padre.origenId },
      );
    }

    // RN-58, para todos MENOS la Dirección. Un departamento no escribe en un cuadro que
    // la Dirección cerró; la Dirección sí, y por eso lo que queda escrito en la traza es
    // el estado del cuadro y quién lo dispuso.
    if (!laDisponeLaDireccion) {
      await this.cuadros.exigirEscritura(padre.cuadro.fecha);
    }

    const formulario = await this.formularios.obtenerDefinicion(
      padre.formulario.codigo,
    );

    // ANTES QUE NADA MÁS. Si el formulario no contempla adicionales, decirlo ahora y no
    // después de rechazarle un punto de encuentro o una persona: el motivo verdadero
    // llegaría al final y los anteriores habrían sido ruido. Ver §11.1 de la guía.
    await this.generador.exigirQueAdmitaAdicionales(formulario);

    // RN-66. El adicional también toma su ventana de las personas si no trae horario propio.
    const asignaciones = normalizarAsignaciones(datos);
    const { rango, esNocturno } = await this.ventanaDelOperativo(
      asignaciones,
      datos.horaInicio,
      datos.horaFin,
    );
    const catalogos = await this.catalogos.obtenerCatalogos(formulario.codigo);

    const ubicacion = UbicacionOperativa.de({
      zonalIds: datos.zonalesIds,
      puntoId: datos.puntoEncuentroId,
      puntoLibre: datos.puntoLibre,
      capturaLibrePermitida: catalogos.capturaLibrePunto,
    });

    const clasificacion = ClasificacionControl.de({
      tipoId: datos.tipoControlId,
      tipoIds: datos.tipoControlIds,
      tipoLibre: datos.tipoLibre,
      permiteCapturaLibre: catalogos.capturaLibreTipo,
      permiteMultiple: catalogos.tipoControlMultiple,
    });

    this.exigirCatalogosDelFormulario(
      catalogos,
      formulario.nombre,
      ubicacion,
      clasificacion,
      datos.institucionesIds,
    );

    // TODO O NADA, igual que en el registro ordinario.
    const personal = await this.verificarPersonalDelRegistro(
      asignaciones,
      formulario,
      { fecha: padre.cuadro.fecha, rango, esPatrulla: formulario.esPatrulla },
      autorEfectivo,
    );
    await this.adjuntarTramites(personal, padre.cuadro.fecha, tokenAuth);

    const ventana = await this.estadoDeLaVentana(autorEfectivo.rol);

    const adicional = await this.registrarConSecuencial(
      {
        cuadroId: padre.cuadroId,
        formulario,
        fechaJornada: padre.cuadro.fecha,
        rango,
        esNocturno,
        ubicacion,
        clasificacion,
        institucionIds: [...new Set(datos.institucionesIds)],
        observaciones: notasLimpias(datos.observaciones),
        personal,
        // El adicional pide el mismo tipo de transporte que su padre, salvo que diga otro.
        tipoTransporte: datos.tipoTransporte ?? padre.tipoTransporte,
        esMacrooperativo: macroSegunTipo(
          datos.tipoTransporte ?? padre.tipoTransporte,
          datos.esMacrooperativo ?? padre.esMacrooperativo,
        ),
        origen: {
          id: padre.id,
          identificador: padre.identificador,
          ventana,
          // El estado del cuadro **en el momento de crearlo**, no el de ahora: si la
          // Dirección lo reabriera después, la traza seguiría diciendo la verdad de lo
          // que ocurrió.
          estadoCuadro: padre.cuadro.estado,
          laDisponeLaDireccion,
        },
      },
      autorEfectivo,
    );

    // Se registra como AVISO y no como información: un adicional es, por definición, algo
    // que no estaba previsto, y quien lea el registro del día debe verlo sin buscarlo.
    this.logger.warn('Operativo adicional registrado', {
      identificador: adicional.identificador,
      origen: padre.identificador,
      formulario: formulario.codigo,
      fecha: comoFecha(padre.cuadro.fecha),
      horario: rango.toString(),
      ventanaDeCarga: ventana.abierta ? 'abierta' : 'cerrada',
      estadoCuadro: padre.cuadro.estado,
    });

    return this.heredarTransporte(padre, adicional, autorEfectivo);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * EL TRANSPORTE DEL OPERATIVO ORIGINAL, SI SIGUE SIENDO VIABLE. 2026-08-21; por tramos desde
   * el 2026-10-14.
   *
   * POR QUÉ SE HEREDA. Un adicional se dispone cuando la ventana de la DAF —15H00 a 16H30—
   * **también ha cerrado**. Sin heredar, nacería sin conductor y nadie podría asignárselo hasta
   * que la ventana vuelva a abrir: llegaría al operativo sin transporte.
   *
   * POR QUÉ NO CONTRADICE RN-40. Conductor y vehículo no llegan del cliente —`CrearAdicionalDto`
   * no los admite—: se copian del original, donde ya los puso la DAF. Se reutiliza una decisión
   * suya, no se toma una nueva en su nombre.
   *
   * POR TRAMOS (2026-10-14). La ocupación sale solo de `t_tramo_transporte`, así que heredar es
   * crear los tramos del adicional YA asignados, validados con las mismas reglas que la
   * asignación de la DAF (`asignarBloque`). Lo hace `transporte`, detrás del puerto
   * `RegistroHerenciaTransporte`. Se hereda a quien puede, y de quien no, la traza dice el motivo.
   *
   * DESPUÉS DE CONFIRMAR EL ALTA (regla 6). Si la herencia falla a mitad, el adicional ya existe
   * y queda PENDIENTE: la DAF lo asigna como cualquier otro. El fallo queda en la bitácora; el
   * operativo no se pierde.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  private async heredarTransporte(
    padre: OperativoCompleto,
    adicional: OperativoCompleto,
    autor: Autor,
  ): Promise<OperativoCompleto> {
    const implementacion = this.herencia.obtener();
    if (!implementacion) return adicional;
    try {
      const resultado = await implementacion.heredar(
        { padreId: padre.id, adicionalId: adicional.id },
        autor,
      );
      if (!resultado.heredado) return adicional;
    } catch (error) {
      this.logger.warn('El adicional no pudo heredar el transporte', {
        identificador: adicional.identificador,
        origen: padre.identificador,
        error: error instanceof Error ? error.message : String(error),
      });
      return adicional;
    }
    return (await this.repositorio.buscarPorId(adicional.id)) ?? adicional;
  }

  /**
   * Si la ventana del rol está abierta **ahora mismo**, sin impedir nada.
   *
   * Reutiliza el mismo evaluador que `VentanaCargaGuard`, y esto no es una comodidad:
   * una segunda forma de calcularlo haría que la traza afirmara «cerrada» sobre un
   * criterio distinto del que bloquea al resto del sistema, y la evidencia dejaría de
   * significar lo que dice.
   */
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * COMPARTIR UNIDAD · ¿puede este operativo pedir viajar en la unidad de `destinoId`? 2026-10-19.
   *
   * Es la INTENCIÓN de quien registra; la DAF la ejecuta con la flota a la vista (RN-40), así que
   * aquí no hay asientos. Se exige:
   *
   *   · que el destino exista y esté a su alcance (RN-48): si no, 404 SIN revelar si existe;
   *   · que ninguno pida vehículo exclusivo (409 COMPARTIR_CON_EXCLUSIVO; lo respalda
   *     ck_operativo_compartir_o_exclusivo);
   *   · mismo cuadro, mismo punto de encuentro del catálogo, alguna zonal en común, horarios que se
   *     cruzan y transporte de la DAF en los dos (409 COMPARTIR_NO_COMPATIBLE);
   *   · que los tramos puedan ir juntos con la MISMA regla del optimizador: la responde
   *     `transporte` por el puerto `RegistroCompatibilidadCompartir`.
   *
   * Si el destino ya pide viajar con otro, se resuelve a ESE anfitrión: no hay cadenas. Devuelve el
   * error en vez de lanzarlo para que la edición pueda retirar la intención en silencio cuando un
   * cambio de horario o punto deja de coincidir (aviso COMPARTIR_RETIRADO).
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  private async evaluarDestinoCompartir(
    destinoId: number,
    propio: {
      id?: number;
      cuadroId: number;
      puntoEncuentroId: number | null;
      zonalIds: number[];
      horaInicio: string;
      horaFin: string;
      tipoTransporte: TipoTransporte;
      esMacrooperativo: boolean;
    },
    roles: readonly RolDepartamental[],
  ): Promise<{ anfitrionId: number } | { error: ApplicationError }> {
    if (propio.id === destinoId) {
      return {
        error: new ValidacionError(
          'Un operativo no puede compartir unidad consigo mismo.',
          { operativoId: destinoId },
        ),
      };
    }
    if (propio.esMacrooperativo) {
      return {
        error: new ReglaNegocioError(
          CODIGOS_ERROR.COMPARTIR_CON_EXCLUSIVO,
          'Un operativo con vehículo exclusivo (macrooperativo) no comparte unidad. Elija una de las dos opciones.',
          { compartirConOperativoId: destinoId },
        ),
      };
    }

    const visibles = visiblesPara(roles);
    const [destino] = await this.repositorio.buscarParaCompartir(
      [destinoId],
      visibles,
    );
    if (!destino) {
      return {
        error: new RecursoNoEncontradoError(
          'El operativo con el que pide compartir unidad no existe o no está a su alcance.',
          { compartirConOperativoId: destinoId },
        ),
      };
    }
    let anfitrion = destino;
    if (
      destino.compartirConId !== null &&
      destino.compartirConId !== propio.id
    ) {
      const [raiz] = await this.repositorio.buscarParaCompartir(
        [destino.compartirConId],
        visibles,
      );
      if (raiz) anfitrion = raiz;
    }

    const coincide =
      anfitrion.cuadroId === propio.cuadroId &&
      propio.puntoEncuentroId !== null &&
      anfitrion.puntoEncuentroId === propio.puntoEncuentroId &&
      anfitrion.tipoTransporte !== TipoTransporte.PROPIOS_MEDIOS &&
      propio.tipoTransporte !== TipoTransporte.PROPIOS_MEDIOS &&
      anfitrion.zonales.some((fila) =>
        propio.zonalIds.includes(fila.zonalId),
      ) &&
      RangoHorario.de(anfitrion.horaInicio, anfitrion.horaFin).seSolapaCon(
        RangoHorario.de(propio.horaInicio, propio.horaFin),
      );
    const detalles = {
      anfitrionId: anfitrion.id,
      anfitrion: anfitrion.identificador,
    };
    if (!coincide) {
      return {
        error: new ReglaNegocioError(
          CODIGOS_ERROR.COMPARTIR_NO_COMPATIBLE,
          `${anfitrion.identificador} no está en el mismo día, punto de encuentro, zonal y horario: no se puede pedir compartir unidad con él.`,
          detalles,
        ),
      };
    }
    if (anfitrion.esMacrooperativo) {
      return {
        error: new ReglaNegocioError(
          CODIGOS_ERROR.COMPARTIR_CON_EXCLUSIVO,
          `${anfitrion.identificador} pide vehículo exclusivo (macrooperativo): no comparte unidad.`,
          detalles,
        ),
      };
    }

    const miembros = await this.repositorio.miembrosDeUnidad(
      [anfitrion.id],
      visibles,
      propio.id,
    );
    const [veredicto] = await this.compartir.evaluar(paraCompartir(propio), [
      paraCompartirDe(anfitrion, miembros),
    ]);
    if (veredicto && !veredicto.compatible) {
      return {
        error: new ReglaNegocioError(
          CODIGOS_ERROR.COMPARTIR_NO_COMPATIBLE,
          `No se puede compartir unidad con ${anfitrion.identificador}: ${veredicto.motivo}`,
          detalles,
        ),
      };
    }
    return { anfitrionId: anfitrion.id };
  }

  private async estadoDeLaVentana(
    rol: RolDepartamental,
  ): Promise<EstadoDeVentana> {
    const veredicto = this.evaluadorDeVentana.evaluar(
      await this.ventanas.buscarPorRol(rol),
    );

    return {
      abierta: veredicto.puedeEscribir,
      horaCierre: veredicto.horaCierre ?? null,
    };
  }

  // ─────────────────────────── Edición ───────────────────────────

  /**
   * RN-13. Reprogramar o corregir un operativo.
   *
   * El identificador **no cambia nunca**: ya está impreso en la matriz y puede estar en
   * una orden de servicio. Cambian el horario, la ubicación, el tipo, las instituciones
   * y las observaciones.
   */
  async editar(
    id: number,
    datos: DatosEdicion,
    autor: Autor,
    roles: readonly RolDepartamental[] = [autor.rol],
  ): Promise<OperativoEditado> {
    const actual = await this.exigirOperativo(id);
    // Multi-rol (2026-09-09): edita quien lo creó (alguno de sus roles), y la traza queda a
    // nombre de ESE rol, no del que la guarda eligió primero.
    const autorEfectivo: Autor = {
      usuarioId: autor.usuarioId,
      rol: this.rolPropietarioEntre(actual, roles),
    };
    await this.cuadros.exigirEscritura(actual.cuadro.fecha);

    const catalogos = await this.catalogos.obtenerCatalogos(
      actual.formulario.codigo,
    );
    const prep = await this.prepararCambiosGenerales(actual, datos, catalogos);
    const avisos = await this.revisarCompartirDeEdicion(
      actual,
      datos,
      prep,
      roles,
    );
    const liberacion = await this.exigirConfirmacionDeLiberacion(
      [actual],
      [prep],
      datos.confirmarLiberacion,
    );

    const editado = await this.repositorio.ejecutarEnTransaccion((cliente) =>
      this.escribirCambiosGenerales(
        cliente,
        actual,
        prep,
        datos.version,
        autorEfectivo,
        liberacion.get(actual.id),
      ),
    );

    // Evento `OperativoReprogramado`, después de confirmar.
    this.logger.log('Operativo modificado', {
      identificador: actual.identificador,
      campos: prep.traza.map((cambio) => cambio.campo),
    });

    const resultado = (await this.repositorio.buscarPorId(id)) ?? editado;
    // Los avisos viajan SOLO si hay alguno: la respuesta de siempre no cambia.
    return avisos.length > 0 ? { ...resultado, avisos } : resultado;
  }

  /**
   * COMPARTIR UNIDAD en la edición (2026-10-19). Con la intención final ya resuelta por
   * `prepararCambiosGenerales`, comprueba que el anfitrión siga coincidiendo:
   *
   *   · si quien edita la PIDIÓ ahora, un destino que no coincide es un error (404 / 409);
   *   · si solo la CONSERVA y el cambio —de horario, punto, zonal o traslado— la deja sin
   *     coincidencia, se RETIRA en silencio y se avisa con `COMPARTIR_RETIRADO`: el horario se
   *     re-deriva de las personas y no tiene sentido rechazar la edición por eso.
   *
   * Si la intención cambia, la traza se recalcula para que la auditoría la recoja.
   */
  private async revisarCompartirDeEdicion(
    actual: OperativoCompleto,
    datos: DatosEdicion,
    prep: CambiosGeneralesPreparados,
    roles: readonly RolDepartamental[],
  ): Promise<string[]> {
    const destino = prep.cambios.compartirConId ?? null;
    if (destino === null) return [];

    const resultado = await this.evaluarDestinoCompartir(
      destino,
      {
        id: actual.id,
        cuadroId: actual.cuadroId,
        puntoEncuentroId: prep.cambios.puntoEncuentroId ?? null,
        zonalIds: prep.zonalIds,
        horaInicio: prep.cambios.horaInicio ?? actual.horaInicio,
        horaFin: prep.cambios.horaFin ?? actual.horaFin,
        tipoTransporte: prep.cambios.tipoTransporte ?? actual.tipoTransporte,
        esMacrooperativo:
          prep.cambios.esMacrooperativo ?? actual.esMacrooperativo,
      },
      roles,
    );

    const avisos: string[] = [];
    if ('error' in resultado) {
      const pidioAhora =
        datos.compartirConOperativoId !== undefined &&
        datos.compartirConOperativoId !== null;
      if (pidioAhora) throw resultado.error;
      prep.cambios.compartirConId = null;
      avisos.push(AVISO_COMPARTIR_RETIRADO);
    } else {
      prep.cambios.compartirConId = resultado.anfitrionId;
    }

    prep.traza = this.auditoria.compararCambios(
      comoColumnas(actual),
      comoColumnas({ ...actual, ...prep.cambios }),
    );
    return avisos;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * EDITAR LOS CAMPOS GENERALES DE TODA LA PATRULLA. 2026-09-18.
   *
   * Una patrulla (Form 5/6) es N operativos con el mismo `grupoRegistro`, uno por persona y por
   * área (IGNECU/ITNECU/INECU), repartidos entre dos departamentos: el DMIP registra los
   * inspectores y el DMIT APORTA su Instrucción. Sus campos generales —zonal, punto, tipo,
   * instituciones, observaciones— son de la PATRULLA, no de cada código: el aporte los COPIA del
   * registro. Editarlos aquí los aplica a TODOS los miembros a la vez, para que no se separen.
   *
   * QUIÉN PUEDE: solo el **registrante** —el rol que creó el primer operativo del lote, es decir
   * los códigos de inspector—. Es una excepción ACOTADA a PER-08 («cada uno edita lo suyo»),
   * decidida por el negocio: como el INECU del DMIT solo HEREDA estos datos, el registrante es su
   * dueño y su edición se propaga. El PERSONAL sigue siendo de cada departamento (no se toca aquí).
   *
   * El horario NO se toca (es por persona/código); tampoco el personal. Todo en una transacción:
   * o cambian todos los códigos o ninguno.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async editarPatrulla(
    grupoRegistro: string,
    datos: DatosEdicionGenerales,
    autor: Autor,
    roles: readonly RolDepartamental[] = [autor.rol],
  ): Promise<OperativoCompleto[]> {
    const miembros =
      await this.repositorio.buscarPorGrupoRegistro(grupoRegistro);

    if (miembros.length === 0) {
      throw new RecursoNoEncontradoError(
        'La patrulla indicada no existe o fue retirada del cuadro.',
        { grupoRegistro },
      );
    }

    // El registrante es quien creó el primer operativo del lote (los inspectores). Solo él edita
    // los generales; el cambio se propaga a toda la patrulla, incluida la Instrucción del DMIT.
    const rolRegistrante = miembros[0].creadoPorRol;
    if (!roles.includes(rolRegistrante)) {
      throw new AutorizacionError(
        CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
        `Los datos generales de esta patrulla los edita ${rolRegistrante}, que la registró.`,
        { grupoRegistro, roles: [...roles] },
      );
    }
    const autorEfectivo: Autor = {
      usuarioId: autor.usuarioId,
      rol: rolRegistrante,
    };
    await this.cuadros.exigirEscritura(miembros[0].cuadro.fecha);

    // Todos los miembros comparten formulario: un solo catálogo para el lote.
    const catalogos = await this.catalogos.obtenerCatalogos(
      miembros[0].formulario.codigo,
    );

    // Se preparan TODOS antes de abrir la transacción: si alguno exige confirmar la liberación
    // del transporte (2026-10-07), se pregunta una sola vez por toda la patrulla.
    const preparados = await Promise.all(
      miembros.map((miembro) =>
        this.prepararCambiosGenerales(miembro, datos, catalogos),
      ),
    );
    const liberacion = await this.exigirConfirmacionDeLiberacion(
      miembros,
      preparados,
      datos.confirmarLiberacion,
    );

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      for (const [indice, miembro] of miembros.entries()) {
        await this.escribirCambiosGenerales(
          cliente,
          miembro,
          preparados[indice],
          miembro.version,
          autorEfectivo,
          liberacion.get(miembro.id),
        );
      }
    });

    this.logger.log('Patrulla modificada', {
      grupoRegistro,
      operativos: miembros.map((operativo) => operativo.identificador),
    });

    return this.repositorio.buscarPorGrupoRegistro(grupoRegistro);
  }

  /**
   * Calcula los cambios de los campos GENERALES de un operativo a partir de lo enviado y lo
   * actual, valida catálogos y prepara la traza. NO escribe: lo hace `escribirCambiosGenerales`.
   * Es la parte común de `editar` (un operativo) y `editarPatrulla` (todo el lote). Si `datos` no
   * trae horario, se conserva el del operativo (la patrulla no cambia horario aquí).
   */
  private async prepararCambiosGenerales(
    actual: OperativoCompleto,
    datos: DatosEdicionGenerales,
    catalogos: CatalogosDeFormulario,
  ): Promise<CambiosGeneralesPreparados> {
    const rango = RangoHorario.de(
      datos.horaInicio ?? actual.horaInicio,
      datos.horaFin ?? actual.horaFin,
    );

    const zonalIds = datos.zonalesIds ?? actual.zonales.map((f) => f.zonal.id);

    const ubicacion = UbicacionOperativa.de({
      ...componerPunto(actual, datos, zonalIds),
      capturaLibrePermitida: catalogos.capturaLibrePunto,
    });

    const clasificacion = ClasificacionControl.de(
      catalogos.tipoControlMultiple
        ? {
            // Form 8: lo no enviado se mantiene desde el actual (ids y libre conviven).
            tipoIds:
              datos.tipoControlIds ??
              actual.tiposControl.map((fila) => fila.tipo.id),
            tipoLibre:
              datos.tipoLibre !== undefined
                ? datos.tipoLibre
                : actual.tipoLibre,
            permiteCapturaLibre: catalogos.capturaLibreTipo,
            permiteMultiple: true,
          }
        : {
            ...componerTipo(actual, datos),
            permiteCapturaLibre: catalogos.capturaLibreTipo,
          },
    );

    const institucionIds = [
      ...new Set(
        datos.institucionesIds ??
          actual.instituciones.map((fila) => fila.institucion.id),
      ),
    ];

    this.exigirCatalogosDelFormulario(
      catalogos,
      actual.formulario.nombre,
      ubicacion,
      clasificacion,
      institucionIds,
    );

    const cambios: CambiosOperativo = {
      horaInicio: rango.horaInicio,
      horaFin: rango.horaFin,
      esNocturno: rango.esNocturno(await this.franjaNocturna()),
      cruzaMedianoche: rango.cruzaMedianoche,
      duracionHoras: rango.duracionHoras,
      puntoEncuentroId: ubicacion.puntoId,
      puntoLibre: ubicacion.puntoLibre,
      tipoControlId: clasificacion.tipoId,
      tipoLibre: clasificacion.tipoLibre,
      tipoTransporte: datos.tipoTransporte ?? actual.tipoTransporte,
      // Solo COMPLETO admite el macrooperativo (2026-10-19); en otro tipo se limpia.
      esMacrooperativo: macroSegunTipo(
        datos.tipoTransporte ?? actual.tipoTransporte,
        datos.esMacrooperativo ?? actual.esMacrooperativo,
      ),
    };

    // COMPARTIR UNIDAD (2026-10-19). Lo que no viene, se conserva. Propios medios limpia los dos;
    // sin vehículo exclusivo la justificación sobra; y compartir y exclusivo se excluyen
    // (ck_operativo_compartir_o_exclusivo): si se marca exclusivo, la intención de compartir se
    // retira, salvo que se pidan las dos a la vez, que es un error de quien registra. La
    // compatibilidad con el anfitrión la revisa `editar`, que conoce los roles.
    const pidioCompartir =
      datos.compartirConOperativoId !== undefined &&
      datos.compartirConOperativoId !== null;
    let compartirConId: number | null =
      datos.compartirConOperativoId !== undefined
        ? datos.compartirConOperativoId
        : (actual.compartirConId ?? null);
    let justificacionExclusivo: string | null =
      datos.justificacionExclusivo !== undefined
        ? datos.justificacionExclusivo
        : (actual.justificacionExclusivo ?? null);
    if (cambios.tipoTransporte === TipoTransporte.PROPIOS_MEDIOS) {
      compartirConId = null;
      justificacionExclusivo = null;
    }
    if (!cambios.esMacrooperativo) justificacionExclusivo = null;
    if (cambios.esMacrooperativo && compartirConId !== null) {
      if (pidioCompartir) {
        throw new ReglaNegocioError(
          CODIGOS_ERROR.COMPARTIR_CON_EXCLUSIVO,
          'Un operativo con vehículo exclusivo (macrooperativo) no comparte unidad. Elija una de las dos opciones.',
          { operativoId: actual.id },
        );
      }
      compartirConId = null;
    }
    cambios.compartirConId = compartirConId;
    cambios.justificacionExclusivo = justificacionExclusivo;

    // Las notas ya escritas no cambian (bitácora append-only); solo se AGREGAN las nuevas.
    const observacionesNuevas = notasLimpias(datos.observacionesNuevas);

    const traza = this.auditoria.compararCambios(
      comoColumnas(actual),
      comoColumnas({ ...actual, ...cambios }),
    );

    return {
      cambios,
      zonalIds,
      institucionIds,
      tipoIds: clasificacion.tipoIds,
      observacionesNuevas,
      traza,
      cambiaTipo: cambios.tipoTransporte !== actual.tipoTransporte,
      cambiaFranja:
        rango.horaInicio !== actual.horaInicio ||
        rango.horaFin !== actual.horaFin ||
        cambiaronNumeros(
          zonalIds,
          actual.zonales.map((f) => f.zonal.id),
        ),
    };
  }

  /**
   * Escribe los cambios generales ya preparados dentro de una transacción abierta: actualiza el
   * operativo (con bloqueo optimista), reemplaza zonales/instituciones/tipos si cambiaron,
   * recalcula alertas y audita. Parte común de `editar` y `editarPatrulla`.
   */
  private async escribirCambiosGenerales(
    cliente: Prisma.TransactionClient,
    actual: OperativoCompleto,
    prep: CambiosGeneralesPreparados,
    version: number,
    autorEfectivo: Autor,
    liberacion?: { conTransporte: boolean },
  ): Promise<OperativoCompleto> {
    // Quién pidió compartir unidad y cuándo (2026-10-19): se fija al pedirla o cambiarla y se
    // vacía al retirarla. Va a la traza con lo demás.
    const solicitud = solicitudDeCompartir(
      actual,
      prep.cambios.compartirConId,
      autorEfectivo.usuarioId,
      new Date(),
    );
    if (solicitud) {
      Object.assign(prep.cambios, solicitud);
      prep.traza = this.auditoria.compararCambios(
        comoColumnas(actual),
        comoColumnas({ ...actual, ...prep.cambios }),
      );
    }

    let guardado = await this.repositorio.actualizar(
      actual.id,
      version,
      prep.cambios,
      autorEfectivo,
      cliente,
      prep.observacionesNuevas,
    );

    if (!guardado) {
      throw new ConflictoConcurrenciaError(
        `El operativo ${actual.identificador} fue modificado por otra persona mientras usted lo editaba. Vuelva a abrirlo para ver los cambios antes de guardar.`,
        { operativoId: actual.id, versionEnviada: version },
      );
    }

    if (
      cambiaronNumeros(
        prep.zonalIds,
        actual.zonales.map((f) => f.zonal.id),
      )
    ) {
      await this.repositorio.reemplazarZonales(
        actual.id,
        prep.zonalIds,
        cliente,
      );
    }

    if (
      cambiaronNumeros(
        prep.institucionIds,
        actual.instituciones.map((fila) => fila.institucion.id),
      )
    ) {
      await this.repositorio.reemplazarInstituciones(
        actual.id,
        prep.institucionIds,
        cliente,
      );
    }

    // Form 8: los tipos viven en el join. En el resto `prep.tipoIds` es [] y `actual.tiposControl`
    // también, así que esto no se dispara.
    if (
      cambiaronNumeros(
        prep.tipoIds,
        actual.tiposControl.map((fila) => fila.tipo.id),
      )
    ) {
      await this.repositorio.reemplazarTiposControl(
        actual.id,
        prep.tipoIds,
        cliente,
      );
    }

    // Transporte requerido (2026-10-07). Cambió el tipo —o, desde el 2026-10-14, el horario o la
    // zonal—: los tramos ya no corresponden y se borran (transporte los regenera al planificar). Si
    // había transporte asignado (ya confirmado por quien edita), se libera y la DAF ve ALV-07.
    if (liberacion) {
      await this.liberarTransportePorCambio(
        cliente,
        guardado,
        liberacion.conTransporte,
        autorEfectivo,
      );
      guardado =
        (await this.repositorio.buscarPorIdEn(actual.id, cliente)) ?? guardado;
    }

    // Caso 8 del plan. POL-06 sobre el estado YA modificado: cambiar el horario de un operativo
    // con transporte puede volverlo nocturno, y con ello aparece ALV-04. Se recalcula el conjunto.
    await this.alertas.recalcular(guardado, cliente);

    await this.auditoria.registrar(
      {
        entidad: 't_operativo',
        entidadId: actual.id,
        operativoId: actual.id,
        accion: AccionAuditoria.ACTUALIZAR,
        cambios: prep.traza,
        usuario: autorEfectivo.usuarioId,
        rol: autorEfectivo.rol,
      },
      cliente,
    );

    return guardado;
  }

  /**
   * Transporte requerido (2026-10-07). De los operativos que cambian de tipo —o de horario o zonal,
   * desde el 2026-10-14 (D4)—, cuáles tienen ya transporte asignado. Si alguno lo tiene y no llegó
   * `confirmarLiberacion`, se rechaza con 409: la pantalla pregunta y reenvía. Devuelve, por
   * operativo que cambia, si hay que liberar.
   *
   * EL CÓDIGO: `CAMBIO_TIPO_CON_TRANSPORTE` si solo cambia el tipo (el de siempre, para no romper
   * la pantalla que ya lo conoce) y `CAMBIO_CON_TRANSPORTE` si cambia el horario o la zonal.
   */
  private async exigirConfirmacionDeLiberacion(
    operativos: readonly OperativoCompleto[],
    preparados: readonly CambiosGeneralesPreparados[],
    confirmado: boolean | undefined,
  ): Promise<Map<number, { conTransporte: boolean }>> {
    const liberacion = new Map<number, { conTransporte: boolean }>();
    const conTransporte: string[] = [];
    let porFranja = false;
    for (const [indice, operativo] of operativos.entries()) {
      const { cambiaTipo, cambiaFranja } = preparados[indice];
      if (!cambiaTipo && !cambiaFranja) continue;
      const asignado = await this.repositorio.tieneTransporteAsignado(
        operativo.id,
      );
      liberacion.set(operativo.id, { conTransporte: asignado });
      if (asignado) {
        conTransporte.push(operativo.identificador);
        porFranja ||= cambiaFranja;
      }
    }
    if (conTransporte.length > 0 && confirmado !== true) {
      throw porFranja
        ? errorCambioConTransporte(conTransporte)
        : new ReglaNegocioError(
            CODIGOS_ERROR.CAMBIO_TIPO_CON_TRANSPORTE,
            'Este operativo ya tiene transporte asignado. Si cambia el tipo de transporte, la asignación se libera y la DAF tendrá que volver a resolverlo. Confirme el cambio para continuar.',
            { operativos: conTransporte },
          );
    }
    return liberacion;
  }

  /**
   * Libera el transporte de un operativo cuyo tipo, horario o zonal cambió, y deja la traza. Sus
   * tramos se borran siempre (ya no corresponden); conductor y vehículo, solo si los tenía.
   */
  private async liberarTransportePorCambio(
    cliente: Prisma.TransactionClient,
    operativo: OperativoCompleto,
    conTransporte: boolean,
    autor: Autor,
  ): Promise<void> {
    await this.repositorio.liberarPorCambio(
      operativo.id,
      {
        conTransporte,
        marcarLiberado:
          operativo.tipoTransporte !== TipoTransporte.PROPIOS_MEDIOS,
      },
      cliente,
    );
    if (!conTransporte) return;

    await this.auditoria.registrar(
      {
        entidad: 't_operativo',
        entidadId: operativo.id,
        operativoId: operativo.id,
        accion: AccionAuditoria.ACTUALIZAR,
        cambios: this.auditoria.compararCambios(
          {
            cond_id: operativo.conductorId,
            vehi_id: operativo.vehiculoId,
            oper_estado_transporte: operativo.estadoTransporte,
          },
          {
            cond_id: null,
            vehi_id: null,
            oper_estado_transporte: EstadoTransporte.PENDIENTE,
          },
        ),
        usuario: autor.usuarioId,
        rol: autor.rol,
      },
      cliente,
    );

    this.logger.log('Transporte liberado por cambio del operativo', {
      identificador: operativo.identificador,
      tipoTransporte: operativo.tipoTransporte,
    });
  }

  // ─────────────────────────── Baja ───────────────────────────

  /**
   * PV-10. La baja BORRA la fila cuando todavía no hay nada emitido.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * DOS BAJAS DISTINTAS, Y LAS SEPARA UN SOLO HECHO: SI YA SE EMITIÓ UNA ORDEN.
   *
   *   · **Sin órdenes** → borrado FÍSICO. Es la corrección de un error de captura:
   *     nadie fuera del sistema supo nunca que ese operativo existió, así que no hay
   *     nada que preservar. El secuencial vuelve a quedar libre y se reutiliza.
   *   · **Con órdenes** → baja LÓGICA, y no es una preferencia: `fk_orden_operativo` es
   *     `RESTRICT` y la base rechazaría el borrado. Una orden ya se comunicó a un
   *     funcionario, y dejarla sin origen la volvería imposible de explicar.
   *
   * El cuadro cerrado no llega hasta aquí: `exigirEscritura` corta antes.
   *
   * **El asiento de auditoría se escribe siempre, y nombra el identificador**, porque en
   * el borrado físico `fk_auditoria_operativo` es `SET NULL`: la fila de auditoría
   * sobrevive sin enlace, y el identificador es lo único que la deja legible.
   *
   * Decidido por el Product Owner el 2026-08-07, sustituyendo la baja lógica única de
   * M-14. Ver PV-10.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async retirar(
    id: number,
    version: number,
    autor: Autor,
    roles: readonly RolDepartamental[] = [autor.rol],
  ): Promise<ResultadoBaja> {
    const actual = await this.exigirOperativo(id);
    // Multi-rol (2026-09-09): retira quien lo creó (alguno de sus roles); la baja queda a
    // nombre de ese rol.
    const autorEfectivo: Autor = {
      usuarioId: autor.usuarioId,
      rol: this.rolPropietarioEntre(actual, roles),
    };
    await this.cuadros.exigirEscritura(actual.cuadro.fecha);

    const [ordenes, adicionales] = await Promise.all([
      this.repositorio.contarOrdenesEmitidas(id),
      this.repositorio.contarAdicionales(id),
    ]);

    // 2026-08-20. Retirar el operativo del que nació un adicional VIGENTE lo dejaría
    // colgando de una salida que ya no está en el cuadro, y el adicional describe algo
    // que va a ocurrir hoy. Se rechaza con el orden correcto —primero el adicional,
    // después el original— en lugar de resolverlo por nuestra cuenta.
    if (adicionales.activos > 0) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.OPERATIVO_CON_ADICIONALES,
        adicionales.activos === 1
          ? `Del operativo ${actual.identificador} nació un operativo adicional que sigue vigente. Retire primero el adicional.`
          : `Del operativo ${actual.identificador} nacieron ${adicionales.activos} operativos adicionales que siguen vigentes. Retírelos primero.`,
        { operativoId: id, adicionalesVigentes: adicionales.activos },
      );
    }

    // `fk_operativo_origen` es RESTRICT: un adicional ya retirado sigue siendo una fila
    // y el `DELETE` fallaría. Se cae a la baja lógica, igual que con las órdenes.
    const sePuedeBorrar = ordenes === 0 && adicionales.total === 0;

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      // Antes de borrar: después de un `DELETE` la auditoría perdería el enlace y aquí
      // todavía puede escribirlo.
      await this.auditoria.registrar(
        {
          entidad: 't_operativo',
          entidadId: id,
          operativoId: id,
          accion: AccionAuditoria.ELIMINAR,
          cambios: [
            {
              campo: sePuedeBorrar ? 'oper_id' : 'oper_activo',
              valorAnterior: actual.identificador,
              // Sin valor nuevo en el borrado físico: no queda fila que describir.
              valorNuevo: sePuedeBorrar ? undefined : 'false',
            },
          ],
          usuario: autorEfectivo.usuarioId,
          rol: autorEfectivo.rol,
        },
        cliente,
      );

      const hecho = sePuedeBorrar
        ? await this.repositorio.eliminar(id, version, cliente)
        : (await this.repositorio.desactivar(
            id,
            version,
            autorEfectivo,
            cliente,
          )) !== null;

      if (!hecho) {
        throw new ConflictoConcurrenciaError(
          `El operativo ${actual.identificador} fue modificado por otra persona. Vuelva a abrirlo antes de retirarlo.`,
          { operativoId: id, versionEnviada: version },
        );
      }
    });

    // Evento `OperativoRetirado`, después de confirmar.
    this.logger.warn(
      sePuedeBorrar
        ? 'Operativo eliminado del cuadro'
        : 'Operativo retirado del cuadro, con órdenes emitidas',
      {
        identificador: actual.identificador,
        fecha: comoFecha(actual.cuadro.fecha),
        ordenesEmitidas: ordenes,
      },
    );

    return {
      id,
      identificador: actual.identificador,
      eliminado: sePuedeBorrar,
      ordenesEmitidas: ordenes,
    };
  }

  // ─────────────────────────── Personal ───────────────────────────

  /**
   * Asigna una persona al operativo. VAL-10, VAL-12 a VAL-18, INV-09, INV-10, PER-06.
   *
   * ORDEN DE LAS COMPROBACIONES, y cada una tiene su razón de ir donde va:
   *
   *   1. **Participación.** El dueño y el rol compartido pueden asignar; nadie más.
   *   2. **Jornada abierta.** RN-58: en un cuadro cerrado no se toca nada.
   *   3. **Composición** (`composicion-personal.ts`): baja, repetición, área y cupo. Es
   *      lo que decide este submódulo.
   *   4. **Descanso** (`ElegibilidadService`): lo decide `talento-operativo` y aquí solo
   *      se traslada el veredicto. Si esta lógica apareciera en este archivo, sería un
   *      defecto (regla 1 de CLAUDE.md).
   *
   * La composición va antes que el descanso a propósito: «ya figura en este operativo»
   * es más accionable que «superó su jornada máxima» cuando las dos son ciertas.
   */
  async asignarPersonal(
    operativoId: number,
    datos: {
      funcionarioId: number;
      esResponsable?: boolean;
      horaInicio?: string;
      horaFin?: string;
    },
    autor: Autor,
    roles: readonly RolDepartamental[] = [autor.rol],
  ): Promise<OperativoCompleto> {
    const operativo = await this.exigirOperativo(operativoId);
    // Multi-rol (2026-09-09): pone personal quien participa en el formulario con alguno de sus
    // roles, y actúa bajo el de más autoridad —el cupo y la traza son de ese rol—.
    const autorEfectivo: Autor = {
      usuarioId: autor.usuarioId,
      rol: this.rolParticipanteEntre(operativo, roles),
    };
    await this.cuadros.exigirEscritura(operativo.cuadro.fecha);

    // 2026-09-08. Ventana efectiva de la persona: su propia (⊆ la del operativo) o la del
    // operativo. Con ella se verifica el descanso y se persiste la asignación.
    const rangoPersona = this.rangoPropioDentroDe(
      {
        funcionarioId: datos.funcionarioId,
        horaInicio: datos.horaInicio,
        horaFin: datos.horaFin,
      },
      RangoHorario.de(operativo.horaInicio, operativo.horaFin),
    );

    const funcionario = await this.funcionarios.obtener(datos.funcionarioId);

    const veredictoComposicion = verificarComposicion(
      {
        funcionarioId: funcionario.id,
        nombre: `${funcionario.apellidos} ${funcionario.nombres}`,
        area: funcionario.area,
        activo: funcionario.activo,
      },
      comoFormularioParaComposicion(operativo),
      comoAsignacionesExistentes(operativo),
      autorEfectivo.rol,
    );

    if (!veredictoComposicion.admitida) {
      throw new ReglaNegocioError(
        veredictoComposicion.codigo ?? CODIGOS_ERROR.AREA_NO_ADMITIDA,
        veredictoComposicion.motivo ??
          'Esta persona no puede asignarse a este operativo.',
        { operativoId, funcionarioId: datos.funcionarioId },
      );
    }

    // VAL-12 a VAL-17. El veredicto llega hecho: ni los antecedentes ni los umbrales
    // pasan por aquí.
    const veredictoDescanso = await this.elegibilidad.verificar(
      funcionario.id,
      {
        fecha: operativo.cuadro.fecha,
        horaInicio: rangoPersona.horaInicio,
        horaFin: rangoPersona.horaFin,
        esPatrulla: operativo.formulario.esPatrulla,
        operativoId,
      },
    );

    if (!veredictoDescanso.elegible) {
      throw new ReglaNegocioError(
        veredictoDescanso.codigo ?? CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
        veredictoDescanso.motivo ??
          'Esta persona no puede recibir la asignación.',
        { operativoId, funcionarioId: datos.funcionarioId },
      );
    }

    // PATRULLAS (Form 5/6) · 2026-09-17. El aporte NO suma la persona a este operativo: CREA su
    // propio operativo de UNA persona, con el prefijo de su área (Instrucción → `INECU`), enlazado
    // a la MISMA patrulla (`grupoRegistro`). Así cada área lleva su código y el frontend los
    // reagrupa como una sola patrulla; el cupo no lo acota porque crea operativo, no suma (ver
    // `reglaCupoCompartido` y la migración 20260917130000). El resto de formularios conserva el
    // aporte clásico (la persona se suma al operativo). La condición es la de patrulla, no un número
    // de formulario: `variosPorPersona` SIN `cantidadPorPersona` (el 8 queda con el aporte clásico).
    if (
      operativo.formulario.variosPorPersona &&
      !operativo.formulario.cantidadPorPersona
    ) {
      const nuevo = await this.aportarComoOperativoPropio(
        operativo,
        funcionario,
        rangoPersona,
        autorEfectivo,
      );

      // Evento `PersonalAsignado` (como operativo propio), después de confirmar. Sin el nombre.
      this.logger.log('Operativo de instrucción aportado a la patrulla', {
        patrulla: operativo.identificador,
        identificador: nuevo.identificador,
        funcionarioId: funcionario.id,
      });

      return nuevo;
    }

    const esResponsable = datos.esResponsable ?? false;

    const actualizado = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const conVentana = datos.horaInicio != null && datos.horaFin != null;
        const asignacion = await this.personal.crear(
          {
            operativoId,
            funcionarioId: funcionario.id,
            asignadoPorRol: autorEfectivo.rol,
            esResponsable,
            horaInicio: conVentana ? datos.horaInicio : null,
            horaFin: conVentana ? datos.horaFin : null,
          },
          cliente,
        );

        if (esResponsable) {
          await this.personal.retirarResponsabilidad(
            operativoId,
            funcionario.id,
            cliente,
          );
        }

        await this.auditoria.registrar(
          {
            entidad: 't_asignacion_personal',
            entidadId: asignacion.id,
            operativoId,
            accion: AccionAuditoria.CREAR,
            usuario: autorEfectivo.usuarioId,
            rol: autorEfectivo.rol,
          },
          cliente,
        );

        return this.recalcularEn(operativoId, cliente);
      },
    );

    // Evento `PersonalAsignado`, después de confirmar. **Sin el nombre de la persona**:
    // el registro de actividad no es el sitio donde deba quedar quién sale a qué.
    this.logger.log('Personal asignado al operativo', {
      identificador: operativo.identificador,
      funcionarioId: funcionario.id,
      esResponsable,
    });

    return actualizado;
  }

  /**
   * El APORTE que CREA operativo, para las patrullas (Form 5/6). 2026-09-17.
   *
   * En una patrulla cada persona sale con SU propio código por área (el DMIT aporta Instrucción →
   * `INECU`), no sumada al operativo del inspector. Por eso, en lugar de escribir una asignación en
   * el operativo destino, se CREA un operativo de UNA persona con el prefijo de su área, enlazado a
   * la MISMA patrulla (`grupoRegistro`); el frontend los reagrupa como una sola patrulla. Hereda del
   * destino la ubicación, los tipos, las instituciones y las zonales —el endpoint solo trae la
   * persona y su horario— y toma la ventana PROPIA de la persona (RN-66). Nace sin transporte, sin
   * origen y sin notas (la bitácora es por operativo). Numera POR PREFIJO (su serie desde 001) con
   * reintento ante carreras, como el registro; el cupo no lo acota (crea operativo, no suma).
   */
  private async aportarComoOperativoPropio(
    patrulla: OperativoCompleto,
    funcionario: { id: number; area: AreaPersonal },
    rangoPersona: RangoHorario,
    autor: Autor,
  ): Promise<OperativoCompleto> {
    const esNocturno = rangoPersona.esNocturno(await this.franjaNocturna());
    const prefijo = await this.generador.resolverPrefijo(
      { id: patrulla.formularioId, nombre: patrulla.formulario.nombre },
      false,
      [funcionario.area],
    );

    let ultimoFallo: unknown;

    for (let intento = 1; intento <= INTENTOS_SECUENCIAL; intento += 1) {
      try {
        return await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
          const secuencial =
            (await this.repositorio.contarDelPrefijo(
              patrulla.cuadroId,
              patrulla.formularioId,
              prefijo,
              cliente,
            )) + 1;
          const identificador = this.generador.componer(
            prefijo,
            secuencial,
            patrulla.cuadro.fecha,
          );

          return this.crearUnOperativo(
            cliente,
            {
              cuadroId: patrulla.cuadroId,
              formularioId: patrulla.formularioId,
              identificador,
              secuencial,
              horaInicio: rangoPersona.horaInicio,
              horaFin: rangoPersona.horaFin,
              esNocturno,
              cruzaMedianoche: rangoPersona.cruzaMedianoche,
              duracionHoras: rangoPersona.duracionHoras,
              puntoEncuentroId: patrulla.puntoEncuentroId,
              puntoLibre: patrulla.puntoLibre,
              tipoControlId: patrulla.tipoControlId,
              tipoControlIds: patrulla.tiposControl.map((fila) => fila.tipo.id),
              tipoLibre: patrulla.tipoLibre,
              observaciones: [],
              zonalIds: patrulla.zonales.map((fila) => fila.zonal.id),
              institucionIds: patrulla.instituciones.map(
                (fila) => fila.institucion.id,
              ),
              origenId: null,
              grupoRegistro: patrulla.grupoRegistro,
              // El aporte viaja con la patrulla: mismo transporte pedido.
              tipoTransporte: patrulla.tipoTransporte,
              esMacrooperativo: patrulla.esMacrooperativo,
              rol: autor.rol,
              usuarioId: autor.usuarioId,
            },
            [
              {
                funcionarioId: funcionario.id,
                asignadoPorRol: autor.rol,
                esResponsable: false,
                horaInicio: rangoPersona.horaInicio,
                horaFin: rangoPersona.horaFin,
              },
            ],
            autor,
          );
        });
      } catch (error: unknown) {
        if (!esColisionDeUnicidad(error)) throw error;

        ultimoFallo = error;
        this.logger.warn(
          'Colisión de secuencial al aportar a la patrulla, reintentando',
          { patrulla: patrulla.identificador, prefijo, intento },
        );
      }
    }

    throw ultimoFallo;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * REEMPLAZAR A LA PERSONA DE UN OPERATIVO DE UNA SOLA PERSONA (PATRULLA). 2026-09-18.
   *
   * En una patrulla cada persona es su propio operativo con su código (IGNECU/ITNECU/INECU).
   * «Cambiar una persona» no crea un operativo nuevo (eso es el aporte) ni renumera: conserva el
   * MISMO código y solo sustituye al ocupante. Por eso la persona nueva debe ser de la MISMA área
   * que el código —el identificador la codifica (IGNECU = General…) y cambiarla lo volvería una
   * mentira—.
   *
   * QUIÉN PUEDE: por departamento, igual que retirar/turno —el dueño a cualquiera; el que aporta,
   * solo a quien él asignó (RF-063)—. Se revalida composición (sin el saliente) y descanso de la
   * persona nueva. Todo en una transacción: sale el ocupante, entra el nuevo, sobre el mismo id.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async reemplazarPersonal(
    operativoId: number,
    funcionarioIdNuevo: number,
    autor: Autor,
    roles: readonly RolDepartamental[] = [autor.rol],
  ): Promise<OperativoCompleto> {
    const operativo = await this.exigirOperativo(operativoId);
    const autorEfectivo: Autor = {
      usuarioId: autor.usuarioId,
      rol: this.rolParticipanteEntre(operativo, roles),
    };
    await this.cuadros.exigirEscritura(operativo.cuadro.fecha);

    // El reemplazo es para el operativo-persona de la patrulla: lleva exactamente uno.
    const ocupante = operativo.personal[0];
    if (!ocupante || operativo.personal.length !== 1) {
      throw new ValidacionError(
        `El operativo ${operativo.identificador} no es de una sola persona; no se puede reemplazar su ocupante.`,
        { operativoId },
      );
    }

    // El COMPARTIDO solo toca lo que él asignó; el dueño, a cualquiera (como retirar/turno).
    if (
      autorEfectivo.rol !== operativo.formulario.rolDueno &&
      ocupante.asignadoPorRol !== autorEfectivo.rol
    ) {
      throw new AutorizacionError(
        CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
        `Esa persona fue asignada por otro departamento: solicite el cambio a quien la asignó.`,
        { operativoId, rol: autorEfectivo.rol },
      );
    }

    if (funcionarioIdNuevo === ocupante.funcionarioId) {
      throw new ValidacionError(
        'La persona nueva es la misma que ya está asignada.',
        { operativoId, funcionarioId: funcionarioIdNuevo },
      );
    }

    const nuevo = await this.funcionarios.obtener(funcionarioIdNuevo);

    // MISMA ÁREA que el ocupante: el código conserva su significado.
    if (nuevo.area !== ocupante.funcionario.area) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.AREA_NO_ADMITIDA,
        `El código ${operativo.identificador} es del área ${ocupante.funcionario.area}; la persona nueva debe ser de esa misma área.`,
        {
          operativoId,
          areaEsperada: ocupante.funcionario.area,
          areaRecibida: nuevo.area,
        },
      );
    }

    // Composición SIN el saliente (baja, repetición, área admitida, cupo): así el cupo compartido
    // cuenta como si el puesto estuviera libre, que es lo que un reemplazo hace.
    const veredictoComposicion = verificarComposicion(
      {
        funcionarioId: nuevo.id,
        nombre: `${nuevo.apellidos} ${nuevo.nombres}`,
        area: nuevo.area,
        activo: nuevo.activo,
      },
      comoFormularioParaComposicion(operativo),
      comoAsignacionesExistentes({
        ...operativo,
        personal: operativo.personal.filter(
          (fila) => fila.funcionarioId !== ocupante.funcionarioId,
        ),
      }),
      autorEfectivo.rol,
    );

    if (!veredictoComposicion.admitida) {
      throw new ReglaNegocioError(
        veredictoComposicion.codigo ?? CODIGOS_ERROR.AREA_NO_ADMITIDA,
        veredictoComposicion.motivo ??
          'Esta persona no puede asignarse a este operativo.',
        { operativoId, funcionarioId: funcionarioIdNuevo },
      );
    }

    // La persona nueva ocupa el MISMO turno que el saliente (el código conserva su ventana).
    const ventana =
      ocupante.horaInicio != null && ocupante.horaFin != null
        ? RangoHorario.de(ocupante.horaInicio, ocupante.horaFin)
        : RangoHorario.de(operativo.horaInicio, operativo.horaFin);

    const veredictoDescanso = await this.elegibilidad.verificar(nuevo.id, {
      fecha: operativo.cuadro.fecha,
      horaInicio: ventana.horaInicio,
      horaFin: ventana.horaFin,
      esPatrulla: operativo.formulario.esPatrulla,
      operativoId,
    });

    if (!veredictoDescanso.elegible) {
      throw new ReglaNegocioError(
        veredictoDescanso.codigo ?? CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
        veredictoDescanso.motivo ??
          'Esta persona no puede recibir la asignación.',
        { operativoId, funcionarioId: funcionarioIdNuevo },
      );
    }

    const actualizado = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        await this.personal.eliminar(
          operativoId,
          ocupante.funcionarioId,
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_asignacion_personal',
            entidadId: ocupante.id,
            operativoId,
            accion: AccionAuditoria.ELIMINAR,
            usuario: autorEfectivo.usuarioId,
            rol: autorEfectivo.rol,
          },
          cliente,
        );

        // Entra sobre el MISMO operativo (mismo código), en el turno del saliente, conservando
        // la marca de responsable del puesto.
        const fila = await this.personal.crear(
          {
            operativoId,
            funcionarioId: nuevo.id,
            asignadoPorRol: autorEfectivo.rol,
            esResponsable: ocupante.esResponsable,
            horaInicio: ocupante.horaInicio,
            horaFin: ocupante.horaFin,
          },
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_asignacion_personal',
            entidadId: fila.id,
            operativoId,
            accion: AccionAuditoria.CREAR,
            usuario: autorEfectivo.usuarioId,
            rol: autorEfectivo.rol,
          },
          cliente,
        );

        return this.recalcularEn(operativoId, cliente);
      },
    );

    // Evento `PersonalReemplazado`, después de confirmar. Sin nombres.
    this.logger.log('Persona reemplazada en el operativo', {
      identificador: operativo.identificador,
      saliente: ocupante.funcionarioId,
      entrante: nuevo.id,
    });

    return actualizado;
  }

  /**
   * Retira una persona del operativo y vuelve a derivar las alertas.
   *
   * Es el caso 7 del plan: al retirar al último, **ALV-01 vuelve a activarse sola**.
   * No hay ningún código que la reactive; simplemente se recalcula todo y la condición
   * «no hay personal» vuelve a ser cierta.
   */
  async retirarPersonal(
    operativoId: number,
    funcionarioId: number,
    autor: Autor,
    roles: readonly RolDepartamental[] = [autor.rol],
  ): Promise<OperativoCompleto> {
    const operativo = await this.exigirOperativo(operativoId);
    // Multi-rol (2026-09-09): retira personal quien participa con alguno de sus roles, bajo el
    // de más autoridad (si es dueño, retira a cualquiera; si solo aporta, solo lo suyo).
    const autorEfectivo: Autor = {
      usuarioId: autor.usuarioId,
      rol: this.rolParticipanteEntre(operativo, roles),
    };
    await this.cuadros.exigirEscritura(operativo.cuadro.fecha);

    const asignacion = operativo.personal.find(
      (fila) => fila.funcionarioId === funcionarioId,
    );

    if (!asignacion) {
      throw new RecursoNoEncontradoError(
        `Esa persona no figura en el operativo ${operativo.identificador}.`,
        { operativoId, funcionarioId },
      );
    }

    // El rol COMPARTIDO solo retira lo que él mismo asignó. El plan reserva el retiro al
    // rol dueño; dejarlo así al pie de la letra ataría el cupo del DMIT a que otro
    // departamento lo liberase por él, y `aper_asignado_por_rol` existe justamente para
    // distinguirlo (RF-063). El dueño sigue pudiendo retirar a cualquiera.
    if (
      autorEfectivo.rol !== operativo.formulario.rolDueno &&
      asignacion.asignadoPorRol !== autorEfectivo.rol
    ) {
      throw new AutorizacionError(
        CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
        `Esa persona fue asignada por otro departamento: solicite el retiro a quien la asignó.`,
        { operativoId, funcionarioId, rol: autorEfectivo.rol },
      );
    }

    const actualizado = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        await this.personal.eliminar(operativoId, funcionarioId, cliente);

        await this.auditoria.registrar(
          {
            entidad: 't_asignacion_personal',
            entidadId: asignacion.id,
            operativoId,
            accion: AccionAuditoria.ELIMINAR,
            usuario: autorEfectivo.usuarioId,
            rol: autorEfectivo.rol,
          },
          cliente,
        );

        return this.recalcularEn(operativoId, cliente);
      },
    );

    // Evento `PersonalRetirado`, después de confirmar.
    this.logger.log('Personal retirado del operativo', {
      identificador: operativo.identificador,
      funcionarioId,
    });

    return actualizado;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * CAMBIAR EL TURNO DE UNA PERSONA YA ASIGNADA. 2026-09-09, RN-66.
   *
   * Al corregir un operativo se puede editar el horario de cada persona. Es un flujo
   * INMEDIATO, como asignar o retirar: no lleva `version` del cliente, escribe y devuelve el
   * operativo recalculado. Las dos horas son obligatorias —editar el horario es fijar una
   * ventana completa—.
   *
   * LA VENTANA DEL OPERATIVO SE RE-DERIVA de los turnos de TODA su gente (con el editado ya
   * sustituido): `RangoHorario.envolvente`, el arco corto que las cubre, y `es_nocturno` es
   * «¿alguna persona lo es?». Es la misma regla con la que nace en el registro; aquí solo se
   * vuelve a aplicar. Por eso NO se exige que el turno «quepa» en la ventana anterior: la
   * ventana sigue a las personas, no al revés.
   *
   * SE REVALIDA EL DESCANSO/CRUCE de esa persona con su nuevo turno, contra sus OTRAS
   * asignaciones del día (se excluye la de este operativo por `operativoId`). Es la misma
   * política de `asignarPersonal`, no una copia.
   *
   * Quién puede: el dueño a cualquiera; el rol COMPARTIDO solo a quien él mismo asignó, igual
   * que en el retiro (RF-063).
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async actualizarTurnoPersonal(
    operativoId: number,
    funcionarioId: number,
    datos: {
      horaInicio: string;
      horaFin: string;
      /** Ocupación por tramos (2026-10-14): confirma liberar el transporte si la ventana cambia. */
      confirmarLiberacion?: boolean;
    },
    autor: Autor,
    roles: readonly RolDepartamental[] = [autor.rol],
  ): Promise<OperativoCompleto> {
    const operativo = await this.exigirOperativo(operativoId);
    // Multi-rol (2026-09-09): como el resto del personal, bajo el rol de más autoridad.
    const autorEfectivo: Autor = {
      usuarioId: autor.usuarioId,
      rol: this.rolParticipanteEntre(operativo, roles),
    };
    await this.cuadros.exigirEscritura(operativo.cuadro.fecha);

    const asignacion = operativo.personal.find(
      (fila) => fila.funcionarioId === funcionarioId,
    );

    if (!asignacion) {
      throw new RecursoNoEncontradoError(
        `Esa persona no figura en el operativo ${operativo.identificador}, así que no tiene horario que editar.`,
        { operativoId, funcionarioId },
      );
    }

    // Mismo criterio que el retiro: el COMPARTIDO solo toca lo suyo; el dueño, a cualquiera.
    if (
      autorEfectivo.rol !== operativo.formulario.rolDueno &&
      asignacion.asignadoPorRol !== autorEfectivo.rol
    ) {
      throw new AutorizacionError(
        CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
        `Esa persona fue asignada por otro departamento: solicite el cambio de horario a quien la asignó.`,
        { operativoId, funcionarioId, rol: autorEfectivo.rol },
      );
    }

    // El nuevo turno, bien formado (RN-07 lo garantiza el patrón del DTO; `de` lo interpreta).
    const nuevoTurno = RangoHorario.de(datos.horaInicio, datos.horaFin);

    // La ventana del operativo re-derivada de los turnos de toda su gente, con el editado
    // sustituido. Quien no tenga turno propio (modo clásico) aporta la ventana actual.
    const ventanaActual = RangoHorario.de(
      operativo.horaInicio,
      operativo.horaFin,
    );
    const franja = await this.franjaNocturna();
    const rangos = operativo.personal.map((fila) => {
      if (fila.funcionarioId === funcionarioId) return nuevoTurno;
      if (fila.horaInicio != null && fila.horaFin != null) {
        return RangoHorario.de(fila.horaInicio, fila.horaFin);
      }
      return ventanaActual;
    });
    const envolvente = RangoHorario.envolvente(rangos);
    const esNocturno = rangos.some((rango) => rango.esNocturno(franja));

    // VAL-12 a VAL-17 para el nuevo turno de esta persona. El veredicto llega hecho; se
    // excluye su asignación en ESTE operativo por `operativoId`, para no chocar consigo misma.
    const veredicto = await this.elegibilidad.verificar(funcionarioId, {
      fecha: operativo.cuadro.fecha,
      horaInicio: nuevoTurno.horaInicio,
      horaFin: nuevoTurno.horaFin,
      esPatrulla: operativo.formulario.esPatrulla,
      operativoId,
    });

    if (!veredicto.elegible) {
      throw new ReglaNegocioError(
        veredicto.codigo ?? CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
        veredicto.motivo ??
          'La persona no puede cumplir ese horario en este operativo.',
        { operativoId, funcionarioId },
      );
    }

    // D4 (2026-10-14): si la ventana del operativo cambia, sus tramos de transporte ya no
    // corresponden. Con transporte asignado, se exige confirmar que se libera.
    const cambiaVentana =
      envolvente.horaInicio !== operativo.horaInicio ||
      envolvente.horaFin !== operativo.horaFin;
    const conTransporte =
      cambiaVentana &&
      (await this.repositorio.tieneTransporteAsignado(operativoId));
    if (conTransporte && datos.confirmarLiberacion !== true) {
      throw errorCambioConTransporte([operativo.identificador]);
    }

    const actualizado = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        await this.personal.actualizarTurno(
          operativoId,
          funcionarioId,
          datos.horaInicio,
          datos.horaFin,
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_asignacion_personal',
            entidadId: asignacion.id,
            operativoId,
            accion: AccionAuditoria.ACTUALIZAR,
            usuario: autorEfectivo.usuarioId,
            rol: autorEfectivo.rol,
          },
          cliente,
        );

        // La ventana re-derivada del operativo (RN-66). Escritura multitabla, auditada dentro.
        await this.repositorio.actualizarVentana(
          operativoId,
          {
            horaInicio: envolvente.horaInicio,
            horaFin: envolvente.horaFin,
            esNocturno,
            cruzaMedianoche: envolvente.cruzaMedianoche,
            duracionHoras: envolvente.duracionHoras,
          },
          { rol: autorEfectivo.rol, usuarioId: autorEfectivo.usuarioId },
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_operativo',
            entidadId: operativoId,
            operativoId,
            accion: AccionAuditoria.ACTUALIZAR,
            usuario: autorEfectivo.usuarioId,
            rol: autorEfectivo.rol,
          },
          cliente,
        );

        if (cambiaVentana) {
          await this.liberarTransportePorCambio(
            cliente,
            operativo,
            conTransporte,
            autorEfectivo,
          );
        }

        return this.recalcularEn(operativoId, cliente);
      },
    );

    this.logger.log('Turno de personal actualizado', {
      identificador: operativo.identificador,
      funcionarioId,
    });

    return actualizado;
  }

  /**
   * Fija o quita el trámite de Inspección de una persona ya asignada (2026-10-07).
   *
   * Es la edición del combo «Trámite de Inspección» en el cajón de corrección. Mismas guardas que
   * el cambio de turno: jornada escribible, la persona figura en el operativo, y el compartido solo
   * toca lo suyo. Con un código, el servidor vuelve a preguntar a Inspección antes de copiarlo;
   * con `null`, lo quita sin preguntar a nadie.
   *
   * POR LOTE (decisión del usuario, 2026-10-07): las N copias que el form 8 genera para una persona
   * comparten `grupoRegistro` y nacen con el MISMO trámite. Cambiarlo en una lo cambia en todas las
   * de esa persona en ese registro, en una sola transacción y con su auditoría por operativo. Sin
   * `grupoRegistro` (operativo suelto) solo se toca este operativo.
   */
  async fijarTramitePersonal(
    operativoId: number,
    funcionarioId: number,
    codigoTramite: string | null,
    autor: Autor,
    roles: readonly RolDepartamental[] = [autor.rol],
    tokenAuth: string | null = null,
  ): Promise<OperativoCompleto> {
    const operativo = await this.exigirOperativo(operativoId);
    const autorEfectivo: Autor = {
      usuarioId: autor.usuarioId,
      rol: this.rolParticipanteEntre(operativo, roles),
    };
    await this.cuadros.exigirEscritura(operativo.cuadro.fecha);

    const asignacion = operativo.personal.find(
      (fila) => fila.funcionarioId === funcionarioId,
    );

    if (!asignacion) {
      throw new RecursoNoEncontradoError(
        `Esa persona no figura en el operativo ${operativo.identificador}, así que no tiene trámite que editar.`,
        { operativoId, funcionarioId },
      );
    }

    if (
      autorEfectivo.rol !== operativo.formulario.rolDueno &&
      asignacion.asignadoPorRol !== autorEfectivo.rol
    ) {
      throw new AutorizacionError(
        CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
        `Esa persona fue asignada por otro departamento: solicite el cambio de trámite a quien la asignó.`,
        { operativoId, funcionarioId, rol: autorEfectivo.rol },
      );
    }

    const codigo = codigoTramite?.trim() || null;
    const copia = codigo
      ? (
          await this.tramites.copiasParaGuardar(
            comoFecha(operativo.cuadro.fecha),
            [
              {
                funcionarioId,
                cedula: asignacion.funcionario.cedula,
                area: asignacion.funcionario.area,
                nombre: `${asignacion.funcionario.apellidos} ${asignacion.funcionario.nombres}`,
                codigoTramite: codigo,
              },
            ],
            tokenAuth,
          )
        ).get(funcionarioId)
      : undefined;

    const lote = await this.loteDeTramite(operativo, funcionarioId);

    const actualizado = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        for (const copiaDelLote of lote) {
          if (copia) {
            await this.personal.guardarTramite(
              copiaDelLote.asignacion.id,
              copia,
              autorEfectivo.usuarioId,
              cliente,
            );
          } else {
            await this.personal.quitarTramite(
              copiaDelLote.asignacion.id,
              cliente,
            );
          }

          await this.auditoria.registrar(
            {
              entidad: 't_operativo_tramite_inspeccion',
              entidadId: copiaDelLote.asignacion.id,
              operativoId: copiaDelLote.operativoId,
              accion: AccionAuditoria.ACTUALIZAR,
              usuario: autorEfectivo.usuarioId,
              rol: autorEfectivo.rol,
              cambios: [
                {
                  campo: 'tramiteInspeccion',
                  valorAnterior:
                    copiaDelLote.asignacion.tramiteInspeccion?.codigoTramite,
                  valorNuevo: copia?.codigoTramite,
                },
              ],
            },
            cliente,
          );
        }

        return this.recalcularEn(operativoId, cliente);
      },
    );

    this.logger.log('Trámite de Inspección actualizado', {
      identificador: operativo.identificador,
      funcionarioId,
      tramite: copia?.codigoTramite ?? null,
      copias: lote.length,
    });

    return actualizado;
  }

  /**
   * Las asignaciones de la persona que comparten el trámite: este operativo y, si nació de un
   * registro por lote (`grupoRegistro`), las demás copias activas de esa misma persona.
   */
  private async loteDeTramite(
    operativo: OperativoCompleto,
    funcionarioId: number,
  ): Promise<
    {
      operativoId: number;
      asignacion: OperativoCompleto['personal'][number];
    }[]
  > {
    const propios = (op: OperativoCompleto) =>
      op.personal
        .filter((fila) => fila.funcionarioId === funcionarioId)
        .map((asignacion) => ({ operativoId: op.id, asignacion }));

    if (!operativo.grupoRegistro) return propios(operativo);

    const delGrupo = await this.repositorio.buscarPorGrupoRegistro(
      operativo.grupoRegistro,
    );
    const lote = delGrupo.flatMap(propios);
    // El operativo que se edita siempre entra, aunque la lectura del grupo no lo trajera.
    return lote.some((fila) => fila.operativoId === operativo.id)
      ? lote
      : [...propios(operativo), ...lote];
  }

  // ─────────────────────────── Transporte (M-17) ───────────────────────────

  /**
   * Operativos de la jornada que la DAF todavía no ha resuelto.
   *
   * Publicado para `transporte`, que es quien construye su pantalla. La consulta vive
   * aquí porque `t_operativo` es de este submódulo: la comunicación entre submódulos es
   * por servicio publicado y nunca por repositorio ajeno.
   */
  async consultarPendientesDeTransporte(
    fecha: Date,
    soloPendientes = true,
  ): Promise<OperativoCompleto[]> {
    return this.repositorio.listarPendientesDeTransporte(fecha, soloPendientes);
  }

  /**
   * RN-46. Cuántos operativos de la jornada necesitan vehículo. Publicado para M-18.
   *
   * `transporte` no lee `t_operativo` por su cuenta —es la misma frontera que sostiene el
   * cuarto nivel de la restricción de la DAF—, así que la cuenta la da su dueño.
   */
  async contarDemandaDeTransporte(fecha: Date): Promise<number> {
    return this.repositorio.contarQueRequierenTransporte(fecha);
  }

  /**
   * RN-40. Escribe la asignación logística. **Solo tres columnas y el momento.**
   *
   * Es el contrato que CLAUDE.md §4 declara entre `transporte` y `operativos`, y el
   * cuarto nivel de la restricción de la DAF: la firma **no puede expresar** otro campo,
   * así que no hay forma de que una escritura de transporte toque el horario, el punto o
   * el personal aunque el llamador se equivoque.
   *
   * Las reglas de descanso del conductor y la política de vehículo del formulario las
   * verifica `TransporteService` antes de llegar aquí. Este método hace lo que su nombre
   * dice y deja la traza y las alertas coherentes.
   *
   * @param conductorId `null` junto con `vehiculoId` para declarar propios medios
   */
  async asignarTransporte(
    operativoId: number,
    datos: { conductorId: number; vehiculoId: number } | null,
    autor: Autor,
  ): Promise<OperativoCompleto> {
    const actual = await this.exigirOperativo(operativoId);

    const estadoTransporte = datos
      ? EstadoTransporte.ASIGNADO
      : EstadoTransporte.PROPIOS_MEDIOS;

    const traza = this.auditoria.compararCambios(
      {
        cond_id: actual.conductorId,
        vehi_id: actual.vehiculoId,
        oper_estado_transporte: actual.estadoTransporte,
      },
      {
        cond_id: datos?.conductorId ?? null,
        vehi_id: datos?.vehiculoId ?? null,
        oper_estado_transporte: estadoTransporte,
      },
    );

    const actualizado = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        await this.repositorio.actualizarTransporte(
          operativoId,
          {
            conductorId: datos?.conductorId ?? null,
            vehiculoId: datos?.vehiculoId ?? null,
            estadoTransporte,
          },
          cliente,
        );

        // ALV-07 (2026-10-07): la DAF volvió a resolver el transporte liberado.
        if (actual.transporteLiberadoEn !== null) {
          await this.repositorio.limpiarTransporteLiberado(
            operativoId,
            cliente,
          );
        }

        await this.auditoria.registrar(
          {
            entidad: 't_operativo',
            entidadId: operativoId,
            operativoId,
            accion: AccionAuditoria.ACTUALIZAR,
            cambios: traza,
            usuario: autor.usuarioId,
            rol: autor.rol,
          },
          cliente,
        );

        // POL-06. Con el conductor asignado, ALV-02, ALV-03 y ALV-04 desaparecen solas:
        // es el caso 1 del plan de M-17 y la razón de que el cálculo sea completo.
        return this.recalcularEn(operativoId, cliente);
      },
    );

    return actualizado;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * Devuelve el operativo a `PENDIENTE`, sin conductor ni vehículo. 2026-08-31.
   *
   * ES UN MÉTODO APARTE Y NO UN PARÁMETRO MÁS DE `asignarTransporte`.
   *
   * Aquél ya admite `null` para declarar propios medios, y la tentación es reutilizarlo
   * pasando algo que distinga los dos destinos. Sería un error: `PROPIOS_MEDIOS` es una
   * DECISIÓN de la DAF —el operativo se cubre sin vehículo, y por eso retira las alertas—
   * mientras que `PENDIENTE` es su contrario exacto: queda por resolver, y las alertas
   * vuelven. Fundirlos en una firma con bandera haría que un booleano mal puesto
   * convirtiera un trabajo pendiente en un trabajo dado por resuelto.
   *
   * Mantenerlos separados conserva además el cuarto nivel de la restricción de la DAF:
   * las dos firmas siguen sin poder expresar ninguna columna que no sea conductor,
   * vehículo y estado.
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   * `ck_operativo_transporte` exige que `PENDIENTE` lleve las dos referencias nulas. Se
   * escriben en la misma sentencia que el estado, así que la fila nunca existe a medias.
   */
  async desasignarTransporte(
    operativoId: number,
    autor: Autor,
  ): Promise<OperativoCompleto> {
    const actual = await this.exigirOperativo(operativoId);

    const traza = this.auditoria.compararCambios(
      {
        cond_id: actual.conductorId,
        vehi_id: actual.vehiculoId,
        oper_estado_transporte: actual.estadoTransporte,
      },
      {
        cond_id: null,
        vehi_id: null,
        oper_estado_transporte: EstadoTransporte.PENDIENTE,
      },
    );

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      await this.repositorio.actualizarTransporte(
        operativoId,
        {
          conductorId: null,
          vehiculoId: null,
          estadoTransporte: EstadoTransporte.PENDIENTE,
        },
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_operativo',
          entidadId: operativoId,
          operativoId,
          accion: AccionAuditoria.ACTUALIZAR,
          cambios: traza,
          usuario: autor.usuarioId,
          rol: autor.rol,
        },
        cliente,
      );

      // POL-06. Al quedarse sin conductor, ALV-02, ALV-03 y ALV-04 vuelven a nacer si
      // corresponden. El recálculo completo es el que lo garantiza.
      return this.recalcularEn(operativoId, cliente);
    });
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  /**
   * Vuelve a leer el operativo dentro de la transacción y deriva sus alertas.
   *
   * La lectura tiene que ser con el cliente de la transacción: la asignación que se
   * acaba de escribir todavía no es visible desde fuera, y sin ella el recálculo
   * seguiría viendo el operativo sin personal.
   */
  private async recalcularEn(
    operativoId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<OperativoCompleto> {
    const operativo = await this.repositorio.buscarPorIdEn(
      operativoId,
      cliente,
    );

    if (!operativo) {
      throw new RecursoNoEncontradoError(
        'El operativo dejó de existir mientras se guardaba el cambio.',
        { operativoId },
      );
    }

    const alertas = await this.alertas.recalcular(operativo, cliente);

    // Se devuelve el operativo con las alertas ya puestas, en lugar de volver a leerlo:
    // acaban de escribirse en esta misma transacción y el valor es el mismo. El paso por
    // `unknown` es porque Prisma tipa la columna como `JsonValue` y TypeScript no
    // reconoce un arreglo de objetos declarados como tal.
    return {
      ...operativo,
      alertas: alertas as unknown as Prisma.JsonValue,
      alertaActiva: alertas.length > 0,
    };
  }

  /**
   * PER-06. Quién puede tocar el personal de un operativo.
   *
   * A diferencia de `exigirPropiedad` —que gobierna el operativo en sí—, aquí participa
   * **cualquiera con una fila** en el formulario, escriba o aporte: para eso está el
   * cupo. Cuánto puede asignar y de qué área lo decide después `composicion-personal.ts`,
   * que es donde esa cuenta tiene sentido.
   */
  /**
   * El rol bajo el que un usuario (con uno o VARIOS roles) TOCA EL PERSONAL de este operativo.
   *
   * Participa cualquiera con una fila en el formulario, escriba o aporte (para eso está el
   * cupo). Con varios roles se elige el de **más autoridad** que la persona tenga: primero el
   * dueño del formulario, luego el que lo creó, luego el primero que participe —para que un
   * multi-rol que además es dueño no quede atado al cupo compartido—. Devuelve ese rol (el
   * sombrero correcto para la auditoría y el cupo) o rechaza. Con un solo rol equivale a la
   * antigua `exigirParticipacion`.
   */
  private rolParticipanteEntre(
    operativo: OperativoCompleto,
    roles: readonly RolDepartamental[],
  ): RolDepartamental {
    const participantes = operativo.formulario.roles.map((fila) => fila.rol);
    const candidatos = roles.filter((rol) => participantes.includes(rol));

    const elegido =
      candidatos.find((rol) => rol === operativo.formulario.rolDueno) ??
      candidatos.find((rol) => rol === operativo.creadoPorRol) ??
      candidatos[0];

    if (elegido === undefined) {
      throw new AutorizacionError(
        CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
        `El operativo ${operativo.identificador} pertenece al formulario ${operativo.formulario.nombre}, que no corresponde a su departamento.`,
        { operativoId: operativo.id, roles: [...roles] },
      );
    }
    return elegido;
  }

  /**
   * RN-12 y VAL-32. Cuenta e inserta dentro de la misma transacción, y reintenta.
   *
   * El reintento cubre las dos restricciones que pueden colisionar entre peticiones
   * simultáneas: `uq_operativo_cuad_form_sec` y `uq_operativo_cuad_ident`. Agotados los
   * intentos, el error sale tal cual: tres colisiones seguidas ya no son concurrencia
   * normal y ocultarlas sería peor.
   */
  /**
   * Comprueba a todo el personal del registro **antes** de escribir nada.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * LAS MISMAS DOS POLÍTICAS QUE `asignarPersonal`, NO UNA COPIA. `verificarComposicion`
   * decide área, cupo y duplicados; `ElegibilidadService` decide las reglas de descanso.
   * Si estas comprobaciones se escribieran aparte, el día que una regla cambiara habría
   * dos sitios que actualizar y el segundo se olvidaría.
   *
   * SE ACUMULAN LAS YA ADMITIDAS. La composición depende de quién va dentro: sin
   * acumular, dos veces la misma persona pasarían las dos, y el cupo compartido del
   * formulario 6 se contaría siempre sobre cero.
   *
   * NO SE PASA `operativoId` A LA ELEGIBILIDAD porque todavía no existe. Ese parámetro
   * sirve para excluir al propio operativo del solapamiento al editarlo; aquí no hay
   * nada que excluir.
   *
   * EL PRIMER RECHAZO DETIENE TODO, con su código y su mensaje: es lo que la pantalla
   * muestra para que se corrija esa persona y se reintente.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  private async verificarPersonalDelRegistro(
    asignaciones: AsignacionSolicitada[],
    formulario: FormularioParaComposicion,
    jornada: { fecha: Date; rango: RangoHorario; esPatrulla: boolean },
    autor: Autor,
  ): Promise<PersonaVerificada[]> {
    const admitidas: PersonaVerificada[] = [];

    for (const asignacion of asignaciones) {
      const funcionarioId = asignacion.funcionarioId;
      const funcionario = await this.funcionarios.obtener(funcionarioId);

      const veredictoComposicion = verificarComposicion(
        {
          funcionarioId: funcionario.id,
          nombre: `${funcionario.apellidos} ${funcionario.nombres}`,
          area: funcionario.area,
          activo: funcionario.activo,
        },
        formulario,
        admitidas.map((persona) => ({
          funcionarioId: persona.id,
          area: persona.area,
          asignadoPorRol: persona.asignadoPorRol,
        })),
        autor.rol,
      );

      if (!veredictoComposicion.admitida) {
        throw new ReglaNegocioError(
          veredictoComposicion.codigo ?? CODIGOS_ERROR.AREA_NO_ADMITIDA,
          veredictoComposicion.motivo ??
            'Esta persona no puede asignarse a este operativo.',
          { funcionarioId },
        );
      }

      // 2026-09-08. La ventana horaria de la persona: la propia (si la trae, bien formada y
      // CONTENIDA en la del operativo) o la del operativo. El descanso se verifica con ESA
      // ventana efectiva, no con la del operativo para todos.
      const rangoPersona = this.rangoPropioDentroDe(asignacion, jornada.rango);

      const veredictoDescanso = await this.elegibilidad.verificar(
        funcionario.id,
        {
          fecha: jornada.fecha,
          horaInicio: rangoPersona.horaInicio,
          horaFin: rangoPersona.horaFin,
          esPatrulla: jornada.esPatrulla,
        },
      );

      if (!veredictoDescanso.elegible) {
        throw new ReglaNegocioError(
          veredictoDescanso.codigo ?? CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
          veredictoDescanso.motivo ??
            'Esta persona no puede recibir la asignación.',
          { funcionarioId },
        );
      }

      const tienePropio =
        asignacion.horaInicio != null && asignacion.horaFin != null;
      admitidas.push({
        id: funcionario.id,
        area: funcionario.area,
        asignadoPorRol: autor.rol,
        horaInicio: tienePropio ? asignacion.horaInicio! : null,
        horaFin: tienePropio ? asignacion.horaFin! : null,
        cantidad: asignacion.cantidad ?? 1,
        cedula: funcionario.cedula,
        nombre: `${funcionario.apellidos} ${funcionario.nombres}`,
        codigoTramite:
          asignacion.tramiteInspeccion?.codigoTramite?.trim() || null,
        tramite: null,
      });
    }

    return admitidas;
  }

  /**
   * Comprueba contra Inspección los trámites elegidos y los deja en cada persona (2026-10-07).
   *
   * UNA sola consulta para todo el registro. Si nadie eligió trámite, no se pregunta a Inspección:
   * el registro de siempre no depende de que otro sistema conteste.
   */
  private async adjuntarTramites(
    personal: PersonaVerificada[],
    fecha: Date,
    tokenAuth: string | null,
  ): Promise<void> {
    const solicitudes = personal.flatMap((persona) =>
      persona.codigoTramite === null
        ? []
        : [
            {
              funcionarioId: persona.id,
              cedula: persona.cedula,
              area: persona.area,
              nombre: persona.nombre,
              codigoTramite: persona.codigoTramite,
            },
          ],
    );
    if (solicitudes.length === 0) return;

    const copias = await this.tramites.copiasParaGuardar(
      comoFecha(fecha),
      solicitudes,
      tokenAuth,
    );
    for (const persona of personal) {
      persona.tramite = copias.get(persona.id) ?? null;
    }
  }

  /**
   * La ventana del operativo y si es nocturno, en el registro (RN-66, 2026-09-08).
   *
   * DOS MODOS, y el operativo ya no tiene horario propio en el que llega de la pantalla:
   *
   *   · **Por persona** (lo que envía P-01 hoy): no viaja `horaInicio/horaFin`. La ventana se
   *     TOMA de las personas —`RangoHorario.envolvente`, el arco corto que las cubre—, y cada
   *     una debe traer la suya completa. `es_nocturno` es «¿alguna persona lo es?» (D2), no la
   *     envolvente, que podría cubrir una madrugada en la que nadie trabaja.
   *
   *   · **Clásico** (compatibilidad y pruebas de integración): el operativo trae su horario y
   *     manda; las personas sin ventana propia lo heredan, como siempre.
   */
  private async ventanaDelOperativo(
    asignaciones: AsignacionSolicitada[],
    horaInicio: string | undefined,
    horaFin: string | undefined,
  ): Promise<{ rango: RangoHorario; esNocturno: boolean }> {
    const franja = await this.franjaNocturna();

    if (horaInicio != null && horaFin != null) {
      const rango = RangoHorario.de(horaInicio, horaFin);
      return { rango, esNocturno: rango.esNocturno(franja) };
    }

    if (asignaciones.length === 0) {
      throw new ValidacionError(
        'Asigne al menos una persona con su horario: de sus ventanas se toma la del operativo.',
        {},
      );
    }

    const rangos = asignaciones.map((asignacion) => {
      if (asignacion.horaInicio == null || asignacion.horaFin == null) {
        throw new ValidacionError(
          'Cada persona asignada debe indicar su horario de inicio y fin: el operativo ya no tiene un horario propio.',
          { funcionarioId: asignacion.funcionarioId },
        );
      }
      return RangoHorario.de(asignacion.horaInicio, asignacion.horaFin);
    });

    return {
      rango: RangoHorario.envolvente(rangos),
      esNocturno: rangos.some((rango) => rango.esNocturno(franja)),
    };
  }

  /**
   * La ventana horaria efectiva de una persona: su ventana propia —bien formada (RN-07) y
   * CONTENIDA en la del operativo— o la del operativo si no la trae. Rechaza una ventana que
   * se salga del operativo, que no significaría nada en el cuadro.
   */
  private rangoPropioDentroDe(
    asignacion: AsignacionSolicitada,
    rangoOperativo: RangoHorario,
  ): RangoHorario {
    if (asignacion.horaInicio == null || asignacion.horaFin == null) {
      return rangoOperativo;
    }

    const propio = RangoHorario.de(asignacion.horaInicio, asignacion.horaFin);
    if (!rangoOperativo.contiene(propio)) {
      throw new ValidacionError(
        `El horario ${propio.horaInicio} a ${propio.horaFin} de una persona no cabe en el del operativo (${rangoOperativo.horaInicio} a ${rangoOperativo.horaFin}). La ventana de cada persona debe estar dentro de la del operativo.`,
        { horaInicio: asignacion.horaInicio, horaFin: asignacion.horaFin },
      );
    }
    return propio;
  }

  /**
   * RN 2026-09-10, precisada 2026-09-14. Fijar la cantidad de operativos por persona (> 1) solo
   * lo OFRECEN los formularios con `cantidadPorPersona` (hoy el 8). En los demás —incluido el 5,
   * que divide por persona pero no ofrece la cantidad—, una persona con cantidad > 1 se rechaza.
   * Cantidad 1 no comprueba nada. El tope por persona (≤ 50) lo garantiza el DTO; sin tope total.
   */
  private exigirCantidadPorPersona(
    personal: readonly { cantidad: number }[],
    cantidadPorPersona: boolean,
  ): void {
    if (cantidadPorPersona) return;

    if (personal.some((persona) => persona.cantidad > 1)) {
      throw new ValidacionError(
        'Este formulario no permite indicar una cantidad de operativos por persona.',
      );
    }
  }

  /**
   * La lista de operativos a crear en un registro (2026-09-10; horario sin segmentar 2026-09-14).
   *
   *   · Formulario con `variosPorPersona` (el 8 y el 5): cada persona genera sus propios operativos
   *     de UNA sola persona —uno por unidad de su cantidad—, TODOS con SU misma ventana completa.
   *     Ya NO se segmenta el horario en tramos: el negocio pidió una sola hora general (ini/fin)
   *     para los N. Los identificadores salen consecutivos en el orden en que se listan.
   *   · Los demás: UN operativo con todo el personal, cada persona con su horario propio.
   *
   * El descanso/cruce de cada persona ya se verificó UNA vez sobre su ventana completa (RN-28);
   * los N operativos de una persona comparten esa misma ventana (antes eran tramos disjuntos).
   */
  private async componerOperativosDelRegistro(
    personal: PersonaVerificada[],
    rango: RangoHorario,
    esNocturno: boolean,
    variosPorPersona: boolean,
  ): Promise<OperativoACrear[]> {
    if (!variosPorPersona) {
      return [
        {
          rango,
          esNocturno,
          asignaciones: personal.map((persona) => ({
            persona,
            horaInicio: persona.horaInicio,
            horaFin: persona.horaFin,
          })),
        },
      ];
    }

    const franja = await this.franjaNocturna();
    return personal.flatMap((persona) => {
      // La ventana PROPIA de la persona (RN-66); si no la trajo, la del operativo.
      const ventana = RangoHorario.de(
        persona.horaInicio ?? rango.horaInicio,
        persona.horaFin ?? rango.horaFin,
      );
      // N operativos con la MISMA ventana completa (2026-09-14): el horario ya NO se reparte en
      // tramos; el negocio pidió una sola hora general (ini/fin) para todos.
      const nocturnoVentana = ventana.esNocturno(franja);
      return Array.from({ length: persona.cantidad }, () => ({
        rango: ventana,
        esNocturno: nocturnoVentana,
        asignaciones: [
          { persona, horaInicio: ventana.horaInicio, horaFin: ventana.horaFin },
        ],
      }));
    });
  }

  private async registrarConSecuencial(
    contexto: ContextoRegistro,
    autor: Autor,
    // Los operativos a crear, ya resueltos (2026-09-10). Si no llegan —el adicional—, se crea
    // UNO con la ventana del contexto y todo su personal (cada persona con su horario propio).
    operativos?: OperativoACrear[],
  ): Promise<OperativoCompleto> {
    let ultimoFallo: unknown;

    for (let intento = 1; intento <= INTENTOS_SECUENCIAL; intento += 1) {
      try {
        return await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
          // DOS SERIES INDEPENDIENTES desde el 2026-08-20: los adicionales se cuentan
          // entre ellos. El primero del día es el 001 aunque el formulario lleve seis
          // operativos ordinarios, y cada serie tiene su propio índice único parcial.
          const esAdicional = contexto.origen !== undefined;

          // PUNTO NUEVO (Unidad de Operativos, 2026-09-24): se crea AQUÍ, dentro de la transacción
          // del registro, antes de los operativos. Si algo más abajo falla, la transacción se
          // deshace y el punto tampoco queda. Su identificador se usa como punto de encuentro de
          // los operativos del registro (uno solo en los formularios 1-4). Ya se validó antes de
          // abrir la transacción (formulario, zonal, nombre libre): aquí solo se escribe.
          const puntoCreado = contexto.puntoNuevo
            ? await this.catalogos.crearPuntoEnTransaccion(
                cliente,
                contexto.puntoNuevo,
                autor.usuarioId,
              )
            : null;
          const puntoEncuentroId =
            puntoCreado?.id ?? contexto.ubicacion.puntoId;
          const puntoLibre = puntoCreado ? null : contexto.ubicacion.puntoLibre;

          // La lista de operativos a crear. Si no llegó (el adicional y el caso de siempre), UNO
          // con la ventana del contexto y todo el personal, cada persona con su horario propio.
          const ops: OperativoACrear[] = operativos ?? [
            {
              rango: contexto.rango,
              esNocturno: contexto.esNocturno,
              asignaciones: contexto.personal.map((persona) => ({
                persona,
                horaInicio: persona.horaInicio,
                horaFin: persona.horaFin,
              })),
            },
          ];

          // OPERATIVOS en la MISMA transacción: o entran todos o ninguno. El SECUENCIAL se cuenta
          // POR PREFIJO en las patrullas (5/6: cada área desde 001) y POR FORMULARIO en el resto
          // (una serie única; el 8 da IG-001, IT-002). El `Map` toma el conteo en base una vez por
          // clave y sigue en memoria para los consecutivos del mismo lote. Cada persona ya se
          // verificó sobre su ventana completa (RN-28).
          const conteo = new Map<string, number>();
          const creados: OperativoCompleto[] = [];

          for (const op of ops) {
            // El área decide el prefijo cuando el formulario lo delimita por área (5/6/8).
            const areas = op.asignaciones.map(
              (asignacion) => asignacion.persona.area,
            );
            const prefijo = await this.generador.resolverPrefijo(
              contexto.formulario,
              esAdicional,
              areas,
            );
            const clave = contexto.numeraPorPrefijo
              ? prefijo
              : SERIE_FORMULARIO;
            const base =
              conteo.get(clave) ??
              (contexto.numeraPorPrefijo
                ? await this.repositorio.contarDelPrefijo(
                    contexto.cuadroId,
                    contexto.formulario.id,
                    prefijo,
                    cliente,
                  )
                : await this.repositorio.contarDelFormulario(
                    contexto.cuadroId,
                    contexto.formulario.id,
                    esAdicional,
                    cliente,
                  ));
            const secuencial = base + 1;
            conteo.set(clave, secuencial);
            const identificador = this.generador.componer(
              prefijo,
              secuencial,
              contexto.fechaJornada,
            );

            const creado = await this.crearUnOperativo(
              cliente,
              {
                cuadroId: contexto.cuadroId,
                formularioId: contexto.formulario.id,
                identificador,
                secuencial,
                horaInicio: op.rango.horaInicio,
                horaFin: op.rango.horaFin,
                esNocturno: op.esNocturno,
                cruzaMedianoche: op.rango.cruzaMedianoche,
                duracionHoras: op.rango.duracionHoras,
                puntoEncuentroId,
                puntoLibre,
                tipoControlId: contexto.clasificacion.tipoId,
                tipoControlIds: contexto.clasificacion.tipoIds,
                tipoLibre: contexto.clasificacion.tipoLibre,
                observaciones: contexto.observaciones,
                zonalIds: [...contexto.ubicacion.zonalIds],
                institucionIds: contexto.institucionIds,
                origenId: contexto.origen?.id ?? null,
                grupoRegistro: contexto.grupoRegistro ?? null,
                tipoTransporte: contexto.tipoTransporte,
                esMacrooperativo: contexto.esMacrooperativo,
                compartirConId: contexto.compartirConId ?? null,
                justificacionExclusivo: contexto.justificacionExclusivo ?? null,
                rol: autor.rol,
                usuarioId: autor.usuarioId,
              },
              op.asignaciones.map(({ persona, horaInicio, horaFin }) => ({
                funcionarioId: persona.id,
                asignadoPorRol: persona.asignadoPorRol,
                esResponsable: false,
                horaInicio,
                horaFin,
                tramite: persona.tramite,
              })),
              autor,
              // El adicional lleva detalle en la traza (nace de una excepción); el ordinario no.
              contexto.origen ? trazaDelAdicional(contexto.origen) : undefined,
            );
            creados.push(creado);
          }

          // Se devuelve el PRIMERO: representa el registro y conserva el contrato de siempre
          // (un operativo). Con varios operativos el frontend recarga la lista para ver los demás.
          return creados[0];
        });
      } catch (error: unknown) {
        if (!esColisionDeUnicidad(error)) throw error;

        ultimoFallo = error;
        this.logger.warn('Colisión de secuencial al registrar, reintentando', {
          formulario: contexto.formulario.codigo,
          intento,
        });
      }
    }

    throw ultimoFallo;
  }

  /**
   * Crea UN operativo con su personal, dentro de una transacción ya abierta.
   *
   * Es la parte común del registro y del aporte que crea operativo (patrullas 5/6): inserta el
   * operativo y su asiento de creación, escribe cada asignación con su asiento, y devuelve el
   * operativo con las alertas ya derivadas (ALV-01 no queda activa si nació con gente). NO decide
   * el secuencial ni el identificador: los recibe hechos en `datos`.
   */
  private async crearUnOperativo(
    cliente: Prisma.TransactionClient,
    datos: DatosOperativo,
    asignaciones: AsignacionParaCrear[],
    autor: Autor,
    cambiosAuditoria?: CambioCampo[],
  ): Promise<OperativoCompleto> {
    const creado = await this.repositorio.crear(datos, cliente);

    await this.auditoria.registrar(
      {
        entidad: 't_operativo',
        entidadId: creado.id,
        operativoId: creado.id,
        accion: AccionAuditoria.CREAR,
        usuario: autor.usuarioId,
        rol: autor.rol,
        cambios: cambiosAuditoria,
      },
      cliente,
    );

    for (const asignacion of asignaciones) {
      const fila = await this.personal.crear(
        {
          operativoId: creado.id,
          funcionarioId: asignacion.funcionarioId,
          asignadoPorRol: asignacion.asignadoPorRol,
          esResponsable: asignacion.esResponsable,
          horaInicio: asignacion.horaInicio,
          horaFin: asignacion.horaFin,
        },
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_asignacion_personal',
          entidadId: fila.id,
          operativoId: creado.id,
          accion: AccionAuditoria.CREAR,
          usuario: autor.usuarioId,
          rol: autor.rol,
        },
        cliente,
      );

      // La COPIA del trámite de Inspección, en la misma transacción (2026-10-07).
      if (asignacion.tramite) {
        await this.personal.guardarTramite(
          fila.id,
          asignacion.tramite,
          autor.usuarioId,
          cliente,
        );
        await this.auditoria.registrar(
          {
            entidad: 't_operativo_tramite_inspeccion',
            entidadId: fila.id,
            operativoId: creado.id,
            accion: AccionAuditoria.CREAR,
            usuario: autor.usuarioId,
            rol: autor.rol,
            cambios: [
              {
                campo: 'tramiteInspeccion',
                valorAnterior: undefined,
                valorNuevo: asignacion.tramite.codigoTramite,
              },
            ],
          },
          cliente,
        );
      }
    }

    if (asignaciones.length === 0) {
      await this.alertas.recalcular(creado, cliente);
      return creado;
    }
    return this.recalcularEn(creado.id, cliente);
  }

  private async exigirOperativo(id: number): Promise<OperativoCompleto> {
    const operativo = await this.repositorio.buscarPorId(id);

    if (!operativo) {
      throw new RecursoNoEncontradoError(
        'El operativo indicado no existe o fue retirado del cuadro.',
        { operativoId: id },
      );
    }

    return operativo;
  }

  /**
   * PER-01 sobre un operativo ya registrado.
   *
   * `FormularioRolGuard` no puede resolverlo: la ruta lleva `:id`, no el código del
   * formulario, y la guarda solo sabe leer un código de la petición. Añadirle la lectura
   * del operativo pondría acceso a una tabla de negocio dentro de la cadena de
   * autorización —que `common/auth` evita a propósito— y consultaría el operativo dos
   * veces. La comprobación vive aquí y produce **el mismo 403** que la guarda.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * CADA DEPARTAMENTO EDITA Y RETIRA **LO QUE ÉL CREÓ**. 2026-08-25, por decisión del
   * negocio al abrir la patrulla ECU a dos departamentos.
   *
   * Hasta hoy bastaba con ser el dueño del formulario, y era equivalente: el dueño era
   * el único que podía haberlo creado. Con dos departamentos escribiendo en el mismo
   * formulario deja de serlo, y hay que elegir:
   *
   *   · «cualquiera con ESCRITURA edita cualquier fila» — se pisan el trabajo, y en un
   *     cuadro que se arma contra reloj eso se descubre tarde;
   *   · «cada uno lo suyo» — lo que pidió el negocio, y lo que hace esto.
   *
   * `oper_creado_por_rol` ya guardaba con qué sombrero se registró cada operativo: la
   * columna existía desde M-14 y aquí por fin decide algo.
   *
   * EL ROL COMPARTIDO SIGUE SIN ENTRAR, y por otra razón: tiene cupo de personal, no
   * propiedad del operativo (PER-06, M-15). Su vía es `exigirParticipacion`.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  /**
   * El rol bajo el que un usuario (con uno o VARIOS roles) EDITA/RETIRA/ADICIONAL este
   * operativo. «Cada departamento lo suyo»: hace falta tener el rol que lo CREÓ. Con varios
   * roles basta con que uno sea el creador, y entonces se actúa bajo ese —el sombrero correcto
   * para la auditoría—. Devuelve ese rol o rechaza. Con un solo rol equivale a la antigua
   * `exigirPropiedad`.
   */
  private rolPropietarioEntre(
    operativo: OperativoCompleto,
    roles: readonly RolDepartamental[],
  ): RolDepartamental {
    if (roles.includes(operativo.creadoPorRol)) return operativo.creadoPorRol;

    throw new AutorizacionError(
      CODIGOS_ERROR.FORMULARIO_NO_AUTORIZADO,
      `El operativo ${operativo.identificador} lo registró ${operativo.creadoPorRol}. Cada departamento edita y retira los suyos.`,
      { operativoId: operativo.id, roles: [...roles] },
    );
  }

  /**
   * INV-07, INV-08 y VAL-05 a VAL-09. Lo elegido pertenece al formulario.
   *
   * Se comprueba contra los catálogos **delimitados**, que es el mismo conjunto que la
   * pantalla ofrece: si la interfaz solo muestra lo permitido, un valor fuera de lista
   * llegó por otro camino.
   */
  private exigirCatalogosDelFormulario(
    catalogos: CatalogosDeFormulario,
    nombreFormulario: string,
    ubicacion: UbicacionOperativa,
    clasificacion: ClasificacionControl,
    institucionIds: number[],
  ): void {
    const zonalesValidas = new Set(catalogos.zonales.map((zonal) => zonal.id));
    const zonalAjena = ubicacion.zonalIds.find(
      (zonalId) => !zonalesValidas.has(zonalId),
    );

    if (zonalAjena !== undefined) {
      throw new ValidacionError(
        'Alguna de las zonales seleccionadas no está vigente. Vuelva a elegirla en la lista.',
        { zonalId: zonalAjena },
      );
    }

    if (ubicacion.puntoId !== null) {
      const punto = catalogos.puntos.find(
        (candidato) => candidato.id === ubicacion.puntoId,
      );

      if (!punto) {
        throw new ValidacionError(
          `El punto de encuentro seleccionado no pertenece al formulario ${nombreFormulario}.`,
          { puntoId: ubicacion.puntoId },
        );
      }

      // INV-07. El punto pertenece a alguna de las zonales del operativo.
      if (!ubicacion.incluyeZonal(punto.zonalId)) {
        throw new ValidacionError(
          `El punto ${punto.nombre} pertenece a la zonal ${punto.zonalFormulario.nombre}, que no está entre las seleccionadas.`,
          { puntoId: punto.id, zonalId: punto.zonalId },
        );
      }
    }

    // INV-08. El tipo pertenece al catálogo del formulario, salvo captura libre.
    const tiposValidos = new Set(
      catalogos.tiposControl.map((candidato) => candidato.id),
    );

    if (
      clasificacion.tipoId !== null &&
      !tiposValidos.has(clasificacion.tipoId)
    ) {
      throw new ValidacionError(
        `El tipo de control seleccionado no pertenece al formulario ${nombreFormulario}.`,
        { tipoControlId: clasificacion.tipoId },
      );
    }

    // INV-08, forma múltiple (form 8): cada tipo de la lista pertenece al formulario.
    const tipoMultipleAjeno = clasificacion.tipoIds.find(
      (id) => !tiposValidos.has(id),
    );

    if (tipoMultipleAjeno !== undefined) {
      throw new ValidacionError(
        `El tipo de control seleccionado no pertenece al formulario ${nombreFormulario}.`,
        { tipoControlId: tipoMultipleAjeno },
      );
    }

    const institucionesValidas = new Set(
      catalogos.instituciones.map((institucion) => institucion.id),
    );
    const institucionAjena = institucionIds.find(
      (institucionId) => !institucionesValidas.has(institucionId),
    );

    if (institucionAjena !== undefined) {
      throw new ValidacionError(
        `Alguna de las instituciones seleccionadas no participa en el formulario ${nombreFormulario}.`,
        { institucionId: institucionAjena },
      );
    }
  }

  /**
   * RN-43. La franja que define qué es nocturno.
   *
   * Se lee de los parámetros, nunca de una constante: es el mismo criterio que usa
   * `talento-operativo` para las reglas de descanso, y una segunda definición haría que
   * un operativo fuera nocturno para una regla y diurno para otra.
   */
  private async franjaNocturna(): Promise<{ inicio: string; fin: string }> {
    const [inicio, fin] = await Promise.all([
      this.parametros.obtenerTexto('FRANJA_NOCTURNA_INICIO'),
      this.parametros.obtenerTexto('FRANJA_NOCTURNA_FIN'),
    ]);

    return { inicio, fin };
  }
}

/**
 * Un operativo a crear, ya resuelto (2026-09-10): su ventana, si es nocturno, y sus
 * asignaciones con el horario que le toca a cada persona en ESTE operativo. `componer`
 * arma la lista; `registrarConSecuencial` la escribe con secuenciales consecutivos.
 */
interface OperativoACrear {
  rango: RangoHorario;
  esNocturno: boolean;
  asignaciones: {
    persona: PersonaVerificada;
    horaInicio: string | null;
    horaFin: string | null;
  }[];
}

/** Lo que `registrarConSecuencial` necesita, ya resuelto y validado. */
interface ContextoRegistro {
  cuadroId: number;
  formulario: { id: number; codigo: string; nombre: string };
  fechaJornada: Date;
  rango: RangoHorario;
  esNocturno: boolean;
  ubicacion: UbicacionOperativa;
  /**
   * PUNTO NUEVO a crear DENTRO de la transacción del registro (Unidad de Operativos, 2026-09-24).
   * Cuando está presente, `ubicacion` viaja SIN punto (`conPuntoPorCrear`) y el identificador del
   * punto se rellena al crearlo, en la misma transacción. Solo en el registro ordinario; el
   * adicional y la edición no lo usan. Ver `registrarConSecuencial`.
   */
  puntoNuevo?: { nombre: string; zonalId: number; formularioId: number };
  clasificacion: ClasificacionControl;
  institucionIds: number[];
  observaciones: string[];
  /**
   * Personal ya verificado, en el orden en que se capturó. Vacío si no se envió ninguno.
   *
   * Llega **verificado**: la comprobación ocurre antes de abrir la transacción, para que
   * un rechazo no deje nada escrito. Ver `verificarPersonalDelRegistro`.
   */
  personal: PersonaVerificada[];
  /**
   * Enlaza los operativos de un mismo registro-patrulla (Form 5/6) para agruparlos en las listas.
   * Nulo en el adicional y en las copias del 8; presente aunque la patrulla tenga un solo operativo.
   */
  grupoRegistro?: string | null;
  /**
   * Numeración POR PREFIJO (cada área desde 001) en las patrullas 5/6. En el resto —incluido el 8—
   * es por formulario (serie única). Ver `registrarConSecuencial`.
   */
  numeraPorPrefijo?: boolean;
  /** Tipo de transporte pedido y macrooperativo (2026-10-06). Sin ellos, los del esquema. */
  tipoTransporte?: TipoTransporte;
  esMacrooperativo?: boolean;
  /** Compartir unidad (2026-10-19), ya validado. Nulos en el adicional. */
  compartirConId?: number | null;
  justificacionExclusivo?: string | null;
  /**
   * Presente **solo si el operativo nace como adicional**. Su ausencia es lo que
   * distingue un registro ordinario, y de ella dependen las tres cosas que cambian:
   * la serie del secuencial, el prefijo del identificador y lo que se escribe en la traza.
   */
  origen?: {
    id: number;
    /** Del padre. Se guarda en la traza: un número de fila no dice de qué nació. */
    identificador: string;
    ventana: EstadoDeVentana;
    /** Estado del cuadro **al crearlo**. Ver `trazaDelAdicional`. */
    estadoCuadro: EstadoCuadro;
    /** Si lo dispuso la Dirección, que es lo que autoriza escribir sobre lo cerrado. */
    laDisponeLaDireccion: boolean;
  };
}

/** Cómo estaba la ventana de carga cuando se creó el adicional. Se audita, no bloquea. */
interface EstadoDeVentana {
  abierta: boolean;
  horaCierre: string | null;
}

/** Persona que ya pasó composición y descanso, lista para asignarse al registrar. */
interface PersonaVerificada {
  id: number;
  area: AreaPersonal;
  asignadoPorRol: RolDepartamental;
  /** Ventana horaria PROPIA (2026-09-08). NULL: cumple el horario del operativo. */
  horaInicio: string | null;
  horaFin: string | null;
  /** Cuántos operativos genera esta persona (2026-09-10). Por defecto 1; solo aplica en el 8. */
  cantidad: number;
  /** De la ficha: con la cédula se cruza contra Inspección; el nombre va en los mensajes. */
  cedula: string;
  nombre: string;
  /** Código del trámite de Inspección que se pidió (2026-10-07). Nulo si no se eligió. */
  codigoTramite: string | null;
  /** El trámite ya comprobado contra Inspección. Lo llena `adjuntarTramites`. */
  tramite: TramiteDeInspeccion | null;
}

/** Una persona a asignar, con su ventana horaria opcional (override del operativo). */
interface AsignacionSolicitada {
  funcionarioId: number;
  horaInicio?: string;
  horaFin?: string;
  /**
   * Cuántos operativos genera ESTA persona (2026-09-10). Por defecto 1. Solo surte efecto en
   * los formularios con `variosPorPersona` (el 8 y el 5). Ver `componerOperativosDelRegistro`.
   */
  cantidad?: number;
  /** Trámite de Inspección elegido para esta persona (2026-10-07). */
  tramiteInspeccion?: { codigoTramite: string };
}

/**
 * Notas del operativo, limpias: recorta cada una y descarta las vacías (2026-09-09). Una
 * nota en blanco no es una nota, y guardarla ensuciaría la bitácora.
 */
/**
 * Transporte requerido (2026-10-07). El macrooperativo pide vehículo EXCLUSIVO.
 *
 * SOLO EN COMPLETO DESDE EL 2026-10-19, a pedido del negocio: el vehículo exclusivo tiene sentido
 * cuando la unidad acompaña TODO el operativo. En «solo dejar», «solo retirar» o «dejar y
 * retirar» la unidad queda libre entre traslados y se puede compartir; con PROPIOS_MEDIOS no hay
 * vehículo. En cualquier tipo distinto de COMPLETO la marca se limpia en silencio —alta, edición y
 * herencia del adicional—, igual que ya se hacía con PROPIOS_MEDIOS, para no romper a un cliente
 * que la envíe. No se migran datos: la regla rige al crear y al editar.
 */
function macroSegunTipo(
  tipo: TipoTransporte | undefined,
  macro: boolean | undefined,
): boolean {
  return tipo === TipoTransporte.COMPLETO ? macro === true : false;
}

function notasLimpias(notas?: string[]): string[] {
  return (notas ?? []).map((texto) => texto.trim()).filter(Boolean);
}

/**
 * Normaliza el personal del registro: `personal[]` (con ventanas por persona) tiene
 * prioridad; si no viaja, se usa `personalIds` (todos con el horario del operativo). En
 * ambos casos se deduplica por funcionario conservando el primero.
 */
function normalizarAsignaciones(datos: {
  personal?: AsignacionSolicitada[];
  personalIds?: number[];
}): AsignacionSolicitada[] {
  const fuente: AsignacionSolicitada[] =
    datos.personal && datos.personal.length > 0
      ? datos.personal
      : (datos.personalIds ?? []).map((funcionarioId) => ({ funcionarioId }));

  const vistos = new Set<number>();
  const unicas: AsignacionSolicitada[] = [];
  for (const asignacion of fuente) {
    if (vistos.has(asignacion.funcionarioId)) continue;
    vistos.add(asignacion.funcionarioId);
    unicas.push(asignacion);
  }
  return unicas;
}

/**
 * Traduce el formulario cargado a lo que la política pura necesita.
 *
 * La política no conoce Prisma: recibe la definición y decide. Este adaptador es el
 * único punto donde las dos formas se tocan.
 */
function comoFormularioParaComposicion(
  operativo: OperativoCompleto,
): FormularioParaComposicion {
  return {
    nombre: operativo.formulario.nombre,
    rolDueno: operativo.formulario.rolDueno,
    roles: operativo.formulario.roles.map((fila) => ({
      rol: fila.rol,
      acceso: fila.acceso,
      cupo: fila.cupo,
    })),
    esPatrulla: operativo.formulario.esPatrulla,
    areas: operativo.formulario.areas.map((fila) => ({
      area: fila.area,
      esCompartida: fila.esCompartida,
    })),
  };
}

/** Si ese rol registra en el formulario. `t_formulario_rol`, desde el 2026-08-25. */
function escribeEn(
  formulario: { roles: { rol: RolDepartamental; acceso: string }[] },
  rol: RolDepartamental,
): boolean {
  return formulario.roles.some(
    (fila) => fila.rol === rol && fila.acceso === 'ESCRITURA',
  );
}

function comoAsignacionesExistentes(
  operativo: OperativoCompleto,
): AsignacionExistente[] {
  return operativo.personal.map((fila) => ({
    funcionarioId: fila.funcionarioId,
    area: fila.funcionario.area,
    asignadoPorRol: fila.asignadoPorRol,
  }));
}

/**
 * PER-02 sobre una fila concreta: la registró, o participa en su formulario.
 *
 * VER NO ES EDITAR. Aquí basta con tener una fila en el formulario —escriba o aporte—,
 * porque para poner personal hay que ver primero el operativo. Quién puede **cambiarlo**
 * lo decide `exigirPropiedad`, y desde el 2026-08-25 es solo quien lo creó.
 */
function leCorresponde(
  operativo: OperativoCompleto,
  rol: RolDepartamental,
): boolean {
  return (
    operativo.creadoPorRol === rol ||
    operativo.formulario.roles.some((fila) => fila.rol === rol)
  );
}

/**
 * Combina el punto guardado con el que llega.
 *
 * Enviar uno de los dos **borra el otro**: son excluyentes por `ck_operativo_punto`, y
 * conservar el anterior dejaría los dos informados y el motor rechazaría la escritura
 * con un mensaje que el funcionario no puede interpretar.
 */
function componerPunto(
  actual: OperativoCompleto,
  datos: DatosEdicionGenerales,
  zonalIds: number[],
): { zonalIds: number[]; puntoId?: number | null; puntoLibre?: string | null } {
  if (datos.puntoEncuentroId !== undefined) {
    return { zonalIds, puntoId: datos.puntoEncuentroId, puntoLibre: null };
  }

  if (datos.puntoLibre !== undefined) {
    return { zonalIds, puntoId: null, puntoLibre: datos.puntoLibre };
  }

  return {
    zonalIds,
    puntoId: actual.puntoEncuentroId,
    puntoLibre: actual.puntoLibre,
  };
}

/** Mismo criterio que `componerPunto`, para `ck_operativo_tipo`. */
function componerTipo(
  actual: OperativoCompleto,
  datos: DatosEdicionGenerales,
): { tipoId?: number | null; tipoLibre?: string | null } {
  if (datos.tipoControlId !== undefined) {
    return { tipoId: datos.tipoControlId, tipoLibre: null };
  }

  if (datos.tipoLibre !== undefined) {
    return { tipoId: null, tipoLibre: datos.tipoLibre };
  }

  return { tipoId: actual.tipoControlId, tipoLibre: actual.tipoLibre };
}

/**
 * La traza nombra columnas, no propiedades del modelo.
 *
 * `oper_observaciones` salió de aquí el 2026-09-09: las observaciones pasaron a notas
 * independientes (`t_operativo_observacion`), append-only, cada una con su propio autor y
 * fecha, así que no forman parte del diff de la edición del operativo.
 */
function comoColumnas(operativo: {
  horaInicio: string;
  horaFin: string;
  esNocturno: boolean;
  cruzaMedianoche: boolean;
  duracionHoras: unknown;
  puntoEncuentroId: number | null;
  puntoLibre: string | null;
  tipoControlId: number | null;
  tipoLibre: string | null;
  tipoTransporte?: string;
  esMacrooperativo?: boolean;
  compartirConId?: number | null;
  justificacionExclusivo?: string | null;
  compartirSolicitadoPor?: number | null;
  compartirSolicitadoEn?: Date | null;
}): Record<string, unknown> {
  return {
    oper_tipo_transporte: operativo.tipoTransporte ?? null,
    oper_es_macrooperativo: operativo.esMacrooperativo ?? false,
    // Compartir unidad (2026-10-19): con quién pide viajar y por qué pide vehículo exclusivo.
    oper_compartir_con_id: operativo.compartirConId ?? null,
    oper_justificacion_exclusivo: operativo.justificacionExclusivo ?? null,
    // Y quién lo pidió y cuándo (2026-10-19, plan «acciones-icono-notas»).
    oper_compartir_solicitado_por: operativo.compartirSolicitadoPor ?? null,
    oper_compartir_solicitado_en:
      operativo.compartirSolicitadoEn?.toISOString() ?? null,
    oper_hora_inicio: operativo.horaInicio,
    oper_hora_fin: operativo.horaFin,
    oper_es_nocturno: operativo.esNocturno,
    oper_cruza_medianoche: operativo.cruzaMedianoche,
    oper_duracion_horas: Number(operativo.duracionHoras),
    pcto_id: operativo.puntoEncuentroId,
    oper_punto_libre: operativo.puntoLibre,
    tico_id: operativo.tipoControlId,
    oper_tipo_libre: operativo.tipoLibre,
  };
}

/**
 * Quién pidió compartir unidad y cuándo, tras una edición (2026-10-19, plan «acciones-icono-notas»).
 *
 *   · la intención no cambia (o no viaja)   → `null`: no se toca nada;
 *   · se retira (queda en `null`)           → se vacían los dos;
 *   · se pide o cambia de anfitrión          → quien edita, y ahora.
 *
 * Pura: el reloj y el usuario llegan de fuera.
 */
export function solicitudDeCompartir(
  actual: { compartirConId: number | null },
  nuevo: number | null | undefined,
  usuarioId: number,
  ahora: Date,
): {
  compartirSolicitadoPor: number | null;
  compartirSolicitadoEn: Date | null;
} | null {
  if (nuevo === undefined) return null;
  const anterior = actual.compartirConId ?? null;
  if (nuevo === anterior) return null;
  if (nuevo === null) {
    return { compartirSolicitadoPor: null, compartirSolicitadoEn: null };
  }
  return { compartirSolicitadoPor: usuarioId, compartirSolicitadoEn: ahora };
}

/** Compara dos conjuntos de identificadores sin importar el orden de llegada. */
function cambiaronNumeros(nuevos: number[], anteriores: number[]): boolean {
  if (nuevos.length !== anteriores.length) return true;

  const ordenados = [...nuevos].sort((uno, otro) => uno - otro);
  const previos = [...anteriores].sort((uno, otro) => uno - otro);

  return ordenados.some((valor, indice) => valor !== previos[indice]);
}

/**
 * La traza de un adicional. Es la evidencia de la excepción, no un adorno.
 *
 * DOS ASIENTOS Y NO UNO. `oper_origen_id` responde *de qué* nació; `ventana_carga`
 * responde *si hacía falta la excepción*. Sin el segundo, un adicional creado a las diez
 * de la mañana —dentro de ventana, sin nada excepcional— quedaría escrito igual que uno
 * creado a las once de la noche, y la pregunta que justifica todo esto —«¿cuántos
 * adicionales se crearon fuera de ventana?»— no se podría responder.
 *
 * EL TEXTO ES LEGIBLE A PROPÓSITO. Quien consulte la auditoría es un funcionario, no
 * quien escribió esto: un `false` no dice qué significaba estar cerrada.
 */
function trazaDelAdicional(origen: {
  identificador: string;
  ventana: EstadoDeVentana;
  estadoCuadro: EstadoCuadro;
  laDisponeLaDireccion: boolean;
}): CambioCampo[] {
  const cierre = origen.ventana.horaCierre
    ? ` (cerró a las ${origen.ventana.horaCierre.replace(':', 'H')})`
    : '';

  return [
    { campo: 'oper_origen_id', valorNuevo: origen.identificador },
    {
      campo: 'ventana_carga',
      valorNuevo: origen.ventana.abierta
        ? 'abierta al crear el adicional'
        : `cerrada${cierre} · adicional creado como excepción`,
    },
    {
      campo: 'estado_cuadro',
      valorNuevo:
        origen.estadoCuadro === EstadoCuadro.CERRADO
          ? 'CERRADO · dispuesto por la Dirección sobre un cuadro ya cerrado (RN-58)'
          : `${origen.estadoCuadro}${origen.laDisponeLaDireccion ? ' · dispuesto por la Dirección' : ''}`,
    },
    // DE DÓNDE SALE EL TRANSPORTE no va aquí desde el 2026-10-14: la herencia ocurre después de
    // confirmar el alta y deja su propio asiento `transporte` (ver `HerenciaTransporteService`).
  ];
}

/**
 * D4 (2026-10-14): el horario o la zonal de un operativo con transporte asignado cambió. Sus
 * tramos se cortaron con los anteriores; para seguir, quien edita confirma que se liberan.
 */
function errorCambioConTransporte(
  identificadores: string[],
): ReglaNegocioError {
  return new ReglaNegocioError(
    CODIGOS_ERROR.CAMBIO_CON_TRANSPORTE,
    'Este operativo ya tiene transporte asignado. Si cambia su horario o su zonal, los tramos de transporte dejan de corresponder: la asignación se libera y la DAF tendrá que volver a resolverlo. Confirme el cambio para continuar.',
    { operativos: identificadores },
  );
}

/** P2002 es la violación de restricción única de Prisma. */
function esColisionDeUnicidad(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function comoFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
