/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: orden-servicio.service.ts
 * Responsabilidad: Emitir las órdenes de un operativo y servir las propias.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * CU-09. **Una orden por funcionario, y ninguna menciona a los demás** (RN-49).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL CONTENIDO SE CONGELA EN LA EMISIÓN.
 *
 * `oser_dato_aislado` guarda los cuatro campos tal como estaban al imprimir. Si la DAF
 * cambia el conductor media hora después, la orden ya entregada **sigue diciendo lo que
 * decía**: es evidencia de lo comunicado, no una vista en vivo. Un documento que se
 * modifica solo no sirve para responder «¿qué le dijeron a esta persona?».
 *
 * La corrección no reescribe: **anula y reemite** (INV-25). La anterior queda en la tabla
 * marcada como no vigente, que es la diferencia entre corregir y hacer desaparecer.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * LA CONSULTA PROPIA FILTRA POR LA IDENTIDAD DEL SERVIDOR. `/ordenes-servicio/mias` no
 * acepta ningún parámetro que diga de quién son las órdenes: el funcionario sale del
 * usuario autenticado. Es el caso 6 del plan, y la única forma de que manipular la
 * petición no sirva de nada.
 */

import { Injectable } from '@nestjs/common';
import { AccionAuditoria, RolDepartamental, type Prisma } from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  AutorizacionError,
  RecursoNoEncontradoError,
  ReglaNegocioError,
} from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import { ParametroPoliticaService } from '../../configuracion/application/parametro-politica.service';
import { construirDatoAislado } from '../domain/dato-aislado';
import { FirmaDigitalClient } from '../infrastructure/firma-digital.client';
import {
  OrdenServicioRepository,
  type BorradorDeCuadro,
  type ConfigCuadroFila,
  type OperativoParaOrden,
  type OrdenConOperativo,
  type PlantillaFila,
} from '../infrastructure/orden-servicio.repository';
import {
  faltantesDeOrden,
  firmanteDeOrden,
  formatearNumeroOrden,
  type Faltante,
  type FirmanteOrden,
} from './estado-orden';
import {
  APARTADOS_POR_DEFECTO,
  exportarOrdenMemorando,
  type Apartado,
  type DatosOrdenMemorando,
  type OperativoDeOrden,
} from './exportador-orden-memorando';
import {
  ETIQUETA_TOKEN,
  resolverTokens as resolverDatosTokens,
  type FuenteTokens,
} from './resolver-tokens';
import {
  comoHoraInstitucional,
  enLenguajeNatural,
  nombreDeDireccion,
} from './reglas-matriz';

/** Claves de parámetro del cuadro/config (D13). Vacíos = dato faltante si la plantilla los usa. */
const PARAM_CIUDAD = 'ORDEN_CIUDAD';
const PARAM_SIGLAS_UNIDAD = 'ORDEN_SIGLAS_UNIDAD';

/** La ciudad del encabezado es fija: el documento SIEMPRE dice «Quito, D.M.» (nunca es faltante). */
const CIUDAD_POR_DEFECTO = 'Quito, D.M.';

/**
 * Meses en español para la fecha del memorando («17 de junio de 2026»). Sin `Intl`, igual que
 * `reglas-matriz`: su salida depende de los datos de localización del proceso y esto va impreso.
 */
const MESES_MEMORANDO = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** «AAAA-MM-DD» → «17 de junio de 2026». Vacío o con formato inválido → '' (no bloquea). */
function fechaMemorandoNatural(texto: string): string {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limpio);
  if (!partes) return '';
  const [, anio, mes, dia] = partes.map(Number);
  const nombreMes = MESES_MEMORANDO[mes - 1];
  if (!nombreMes || dia < 1 || dia > 31) return '';
  return `${dia} de ${nombreMes} de ${anio}`;
}

/** Config del documento que sale de los parámetros administrables (no del editor por-orden). */
interface ConfigOrden {
  ciudad: string;
  siglasUnidad: string;
}

/**
 * Datos GENERALES del Director (2026-10-02): viven en la plantilla, los fija una vez el Director y
 * valen para TODAS las órdenes. Alimentan los tokens del cuerpo con origen «plantilla». Vacío = sin
 * completar (faltante si la plantilla usa ese token). La fecha se guarda como texto «AAAA-MM-DD».
 */
export interface DatosGenerales {
  direccionResponsable: string;
  numeroMemorando: string;
  fechaMemorando: string;
  designado: string;
  /** El FIRMANTE del documento (2026-10-02): nombre con título, su cargo y su dependencia. */
  firmante: string;
  firmanteCargo: string;
  firmanteDependencia: string;
  /**
   * TABLA DE CONTROL del final del documento (2026-10-08): «<accion>: <elaboradoPor>», las siglas de
   * la unidad y la fecha de emisión (esta se calcula). Antes «elaborado por» era de la config del
   * DÍA y las siglas un parámetro global; ahora cada Director las fija en su plantilla.
   */
  accion: string;
  elaboradoPor: string;
  /** En mayúsculas, máx. 20 (lo normaliza `aDatosGenerales`). */
  siglasUnidad: string;
}

/** La acción de la tabla de control cuando la plantilla no dice otra. */
const ACCION_POR_DEFECTO = 'Elaborado por';

/** Las siglas de la unidad se imprimen en mayúsculas y no pasan de 20 caracteres. */
const MAX_SIGLAS_UNIDAD = 20;

function aSiglas(valor: string): string {
  return valor.trim().toUpperCase().slice(0, MAX_SIGLAS_UNIDAD);
}

/**
 * Datos generales VACÍOS (2026-10-05): lo ausente queda vacío y se resalta como faltante. Ya NO hay
 * valores de respaldo en el render (punto 7): un dato que no está en la plantilla del Director NO se
 * inventa en el PDF.
 */
const DATOS_GENERALES_VACIOS: DatosGenerales = {
  direccionResponsable: '',
  numeroMemorando: '',
  fechaMemorando: '',
  designado: '',
  firmante: '',
  firmanteCargo: '',
  firmanteDependencia: '',
  accion: ACCION_POR_DEFECTO,
  elaboradoPor: '',
  siglasUnidad: '',
};

/**
 * La dirección responsable con la que NACE la plantilla de un Director nuevo (punto 5). Es solo el
 * valor inicial de su plantilla —editable—, nunca un respaldo del documento.
 */
const DIRECCION_RESPONSABLE_INICIAL = 'Dirección Metropolitana de Inspección';

/** Normaliza el JSON guardado a `DatosGenerales`: lo ausente queda vacío (faltante). */
function aDatosGenerales(valor: unknown): DatosGenerales {
  if (valor === null || typeof valor !== 'object') {
    return { ...DATOS_GENERALES_VACIOS };
  }
  const dato = valor as Record<string, unknown>;
  const texto = (clave: keyof DatosGenerales): string =>
    typeof dato[clave] === 'string' ? dato[clave] : '';
  return {
    direccionResponsable: texto('direccionResponsable'),
    numeroMemorando: texto('numeroMemorando'),
    fechaMemorando: texto('fechaMemorando'),
    designado: texto('designado'),
    firmante: texto('firmante'),
    firmanteCargo: texto('firmanteCargo'),
    firmanteDependencia: texto('firmanteDependencia'),
    accion: texto('accion').trim() || ACCION_POR_DEFECTO,
    elaboradoPor: texto('elaboradoPor'),
    siglasUnidad: aSiglas(texto('siglasUnidad')),
  };
}

/**
 * ¿Los datos generales guardados son ANTERIORES a la tabla de control (2026-10-08)? Se reconoce por
 * la ausencia de la clave `accion`: la migración 20261008120000 la puso en todas las plantillas, así
 * que solo una versión vieja —con la que se emitió una orden antes del cambio— no la tiene.
 */
function esTablaControlLegada(valor: unknown): boolean {
  return (
    valor === null ||
    typeof valor !== 'object' ||
    !Object.prototype.hasOwnProperty.call(valor, 'accion')
  );
}

/**
 * Config del memorando POR CUADRO (D13, 2026-10-02). SOLO RESPALDO desde el 2026-10-08: el NUT ya no
 * se imprime y «elaborado por» pasó a la plantilla del Director. Se sigue leyendo para las órdenes
 * resueltas con una versión de plantilla ANTERIOR (`tablaControlLegada`), que lo tomaban de aquí.
 * Ya no se edita: el endpoint de la config del día se retiró.
 */
interface ConfigCuadro {
  elaboradoPor: string;
}

/** La config del cuadro vacía: una jornada sin configurar. */
const CONFIG_CUADRO_VACIA: ConfigCuadro = {
  elaboradoPor: '',
};

/** Normaliza la fila almacenada a `ConfigCuadro`: NULL o espacios en blanco pasan a cadena vacía. */
function aConfigCuadro(fila: ConfigCuadroFila | null): ConfigCuadro {
  return {
    elaboradoPor: fila?.elaboradoPor?.trim() ?? '',
  };
}

/**
 * Un token vacío se muestra como `[Etiqueta]` —nunca «XXXX» (D14)—; `numeroOrden` sin asignar, en
 * su propio texto gris. El exportador resalta en amarillo los `[…]` de los campos estructurados.
 */
function marcador(token: string, valor: string | null): string {
  if (valor !== null && valor.trim() !== '') return valor;
  if (token === 'numeroOrden') return '[N.º se asigna al quedar vigente]';
  // El cargo sin dato en la ficha se imprime EN BLANCO (2026-10-08): no es faltante ni se marca.
  if (token === 'cargo') return '';
  return `[${ETIQUETA_TOKEN[token] ?? token}]`;
}

/**
 * Los tokens del trámite de Inspección a partir de las asignaciones del día (2026-10-07). Con varios
 * operativos —p. ej. las copias del 8— se listan los DISTINTOS, unidos por «; ».
 */
export function tokensDeTramites(
  asignaciones: readonly {
    tramiteInspeccion?: {
      codigoTramite: string;
      nroSitra: string | null;
      predio: string | null;
      zonal: string | null;
      materia: string | null;
    } | null;
  }[],
): Pick<
  FuenteTokens,
  | 'tramiteCodigo'
  | 'tramiteSitra'
  | 'tramitePredio'
  | 'tramiteZonal'
  | 'tramiteMateria'
> {
  const vistos = new Set<string>();
  const tramites = asignaciones.flatMap((asignacion) => {
    const tramite = asignacion.tramiteInspeccion;
    if (!tramite || vistos.has(tramite.codigoTramite)) return [];
    vistos.add(tramite.codigoTramite);
    return [tramite];
  });
  const unir = (valores: (string | null)[]): string =>
    valores.filter((valor): valor is string => !!valor?.trim()).join('; ');
  return {
    tramiteCodigo: unir(tramites.map((tramite) => tramite.codigoTramite)),
    tramiteSitra: unir(tramites.map((tramite) => tramite.nroSitra)),
    tramitePredio: unir(tramites.map((tramite) => tramite.predio)),
    tramiteZonal: unir(tramites.map((tramite) => tramite.zonal)),
    tramiteMateria: unir(tramites.map((tramite) => tramite.materia)),
  };
}

/** La copia del firmante (Director) que se congela en la orden al emitir. */
interface FirmanteCopia {
  nombre: string;
  cargo: string;
  dependencia: string;
  usuarioId: number;
  fecha: string;
}

/**
 * Los datos que el editor por-orden completa. Todos opcionales: lo que no venga queda VACÍO y el
 * documento lo resalta como `[Etiqueta]` (nunca «XXXX», D14). Los TEXTOS LEGALES ya no están aquí:
 * viven en la PLANTILLA (compartida), que se edita aparte. Los operativos y el nombre se re-derivan
 * del servidor (RN-51).
 */
export interface EditablesMemorando {
  numeroMemorando?: string;
  numeroOrden?: string;
  paraDependencia?: string;
  direccionResponsable?: string;
  firmanteNombre?: string;
  firmanteCargo?: string;
  firmanteDependencia?: string;
  /**
   * SOLO LECTURA desde el 2026-10-08: el editor ya no la envía (las siglas viven en la plantilla).
   * Se conserva para el respaldo de las órdenes guardadas antes del cambio.
   */
  siglasUnidad?: string;
}

/** Sustituye los tokens `{{clave}}` de un texto por sus valores. Lo desconocido queda igual. */
function sustituirTokens(
  texto: string,
  tokens: Record<string, string>,
): string {
  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (coincidencia, clave: string) =>
    clave in tokens ? tokens[clave] : coincidencia,
  );
}

/** Los apartados guardados deben ser una lista con la forma esperada; si no, se usa la de omisión. */
function apartadosValidos(valor: unknown): valor is Apartado[] {
  return (
    Array.isArray(valor) &&
    valor.every(
      (a) =>
        a !== null &&
        typeof a === 'object' &&
        typeof (a as Apartado).titulo === 'string' &&
        typeof (a as Apartado).tipo === 'string' &&
        typeof (a as Apartado).contenido === 'string',
    )
  );
}

/** Una plantilla ya normalizada: lo que necesita la resolución de tokens y el render. */
export interface PlantillaResuelta {
  apartados: Apartado[];
  datosGenerales: DatosGenerales;
  /** Versión anterior a la tabla de control (2026-10-08): usa el respaldo. Ver `esTablaControlLegada`. */
  tablaControlLegada: boolean;
}

/** La plantilla de un Director en su versión vigente (2026-10-05). */
export interface PlantillaDeDirector extends PlantillaResuelta {
  id: number;
  directorId: number;
  version: number;
}

/** Lo mínimo de una orden para saber con qué plantilla y versión se resuelve. */
interface OrdenConPlantilla {
  plantillaId: number | null;
  plantillaVersion: number | null;
}

/** Clave del mapa de plantillas para las órdenes sin plantilla (caen en la base institucional). */
const CLAVE_BASE = 'base';

function clavePlantilla(orden: OrdenConPlantilla): string {
  return orden.plantillaId !== null && orden.plantillaVersion !== null
    ? `${orden.plantillaId}:${orden.plantillaVersion}`
    : CLAVE_BASE;
}

/** Normaliza apartados + datos generales guardados (JSON) a una plantilla utilizable. */
function aPlantillaResuelta(
  apartados: unknown,
  datosGenerales: unknown,
): PlantillaResuelta {
  return {
    apartados: apartadosValidos(apartados) ? apartados : APARTADOS_POR_DEFECTO,
    datosGenerales: aDatosGenerales(datosGenerales),
    tablaControlLegada: esTablaControlLegada(datosGenerales),
  };
}

/** La plantilla de una orden dentro del mapa resuelto; si faltara su versión, la base. */
function plantillaDe(
  mapa: Map<string, PlantillaResuelta>,
  orden: OrdenConPlantilla,
): PlantillaResuelta {
  return (
    mapa.get(clavePlantilla(orden)) ??
    mapa.get(CLAVE_BASE) ??
    aPlantillaResuelta(null, null)
  );
}

function aPlantillaDeDirector(
  fila: PlantillaFila,
  directorId: number,
): PlantillaDeDirector {
  return {
    id: fila.id,
    directorId,
    version: fila.version,
    ...aPlantillaResuelta(fila.apartados, fila.datosGenerales),
  };
}

/** El firmante que el editor propone a partir del Director en sesión (solo sugerencia). */
export interface SugerenciaFirmante {
  nombre: string;
  cargo: string;
  dependencia: string;
}

/** Quién emite. Lo resuelve `IdentidadGuard`, nunca el cuerpo. */
export interface Emisor {
  usuarioId: number;
  /** Nombre del usuario en sesión: es el del FIRMANTE (Director) que se congela en la orden. */
  nombre: string;
  /** Todos los roles de la persona: la emisión exige que incluya DIRECTOR (F21). */
  roles: RolDepartamental[];
}

@Injectable()
export class OrdenServicioService {
  constructor(
    private readonly repositorio: OrdenServicioRepository,
    private readonly auditoria: AuditoriaService,
    private readonly logger: LoggerService,
    private readonly firma: FirmaDigitalClient,
    private readonly parametros: ParametroPoliticaService,
  ) {}

  /**
   * El FIRMANTE de esta emisión sale de los DATOS GENERALES de la plantilla (F19, 2026-10-02):
   * nombre, cargo y dependencia que el Director fijó allí. Si están vacíos, la orden queda en
   * BORRADOR hasta completarlos en la plantilla. Se congela una COPIA en la orden (F20): no se
   * recalcula después, aunque luego se edite la plantilla. El `usuarioId` deja constancia de quién
   * emitió.
   */
  private firmanteActual(
    emisor: Emisor,
    datosGenerales: DatosGenerales,
  ): FirmanteCopia {
    return {
      nombre: datosGenerales.firmante.trim(),
      cargo: datosGenerales.firmanteCargo.trim(),
      dependencia: datosGenerales.firmanteDependencia.trim(),
      usuarioId: emisor.usuarioId,
      fecha: new Date().toISOString(),
    };
  }

  /** Config administrable del documento (D13). Vacíos = faltante si la plantilla usa ese token. */
  private async configOrden(): Promise<ConfigOrden> {
    const [ciudad, siglasUnidad] = await Promise.all([
      this.parametros.obtenerTextoOpcional(PARAM_CIUDAD),
      this.parametros.obtenerTextoOpcional(PARAM_SIGLAS_UNIDAD),
    ]);
    return {
      ciudad: ciudad.trim(),
      siglasUnidad: siglasUnidad.trim(),
    };
  }

  /**
   * La FUENTE de tokens de una orden: reúne de dónde sale cada dato (D13) —persona, editables,
   * firmante persistido, config y número AMC-OS— en la forma que `resolverTokens` entiende.
   */
  private fuenteDeOrden(entrada: {
    nombre: string;
    cargoFicha: string | null;
    /** La dirección (RolDepartamental) de la ficha: de ella SALE la dependencia del destinatario. */
    direccionFicha: RolDepartamental;
    editables: EditablesMemorando;
    firmante: FirmanteOrden | null;
    config: ConfigOrden;
    /** Config del DÍA: solo el respaldo de «elaborado por» para versiones anteriores (2026-10-08). */
    configCuadro: ConfigCuadro;
    /** La plantilla (y versión) de la orden: sus datos generales alimentan los tokens «plantilla». */
    plantilla: PlantillaResuelta;
    fecha: Date;
    numeroAnio: number | null;
    numeroSecuencial: number | null;
  }): FuenteTokens {
    const { editables, firmante, config, configCuadro, plantilla, fecha } =
      entrada;
    const { datosGenerales, tablaControlLegada } = plantilla;
    const [anio, mes, dia] = fecha.toISOString().slice(0, 10).split('-');
    const texto = (valor?: string): string =>
      valor !== undefined && valor.trim() !== '' ? valor.trim() : '';
    return {
      nombre: entrada.nombre,
      // El cargo sale SOLO de la ficha de Personal (`func_cargo`), tal como se registró allí
      // (2026-10-08). Si la ficha no lo tiene, va EN BLANCO: no es faltante ni se teclea por orden.
      // Un `paraCargo` guardado en órdenes anteriores se conserva en su JSON pero ya no se lee.
      cargo: entrada.cargoFicha?.trim() ?? '',
      // La dependencia del destinatario SE DERIVA de su dirección (organigrama): no se teclea
      // ni es un editable. La columna `func_direccion` siempre tiene valor, así que nunca falta.
      dependencia: nombreDeDireccion(entrada.direccionFicha),
      fechaEmision: `${dia}/${mes}/${anio}`,
      // La ciudad y la fecha SE CALCULAN y NUNCA faltan: la ciudad es fija «Quito, D.M.» (salvo que
      // un parámetro la cambie) y la fecha es la de la jornada en lenguaje natural.
      ciudadFecha: `${config.ciudad || CIUDAD_POR_DEFECTO}, ${enLenguajeNatural(
        fecha,
      )}`,
      // Dirección responsable, número y fecha del memorando de designación y funcionario designado
      // salen de los DATOS GENERALES de la plantilla (2026-10-02), no de la persona ni de la config.
      direccionResponsable: datosGenerales.direccionResponsable.trim(),
      // TABLA DE CONTROL (2026-10-08): de la plantilla. Una versión ANTERIOR no la tiene y usa el
      // respaldo de entonces —siglas del parámetro o de la orden, «elaborado por» del día—, para que
      // la orden ya emitida siga diciendo lo mismo.
      siglasUnidad: tablaControlLegada
        ? aSiglas(config.siglasUnidad || texto(editables.siglasUnidad))
        : datosGenerales.siglasUnidad,
      numeroMemorando: datosGenerales.numeroMemorando.trim(),
      fechaMemorando: fechaMemorandoNatural(datosGenerales.fechaMemorando),
      designado: datosGenerales.designado.trim(),
      elaboradoPor: tablaControlLegada
        ? configCuadro.elaboradoPor
        : datosGenerales.elaboradoPor.trim(),
      tablaControlLegada,
      // El firmante sale de la COPIA CONGELADA de la orden si la tiene (campo a campo), y si no de
      // los datos generales de la plantilla (2026-10-02). Así una orden ya emitida conserva su
      // firma aunque luego se edite la plantilla, y un borrador toma lo que la plantilla tenga.
      firmante: texto(firmante?.nombre) || datosGenerales.firmante.trim(),
      firmanteCargo:
        texto(firmante?.cargo) || datosGenerales.firmanteCargo.trim(),
      firmanteDependencia:
        texto(firmante?.dependencia) ||
        datosGenerales.firmanteDependencia.trim(),
      numeroOrden: formatearNumeroOrden(
        entrada.numeroAnio,
        entrada.numeroSecuencial,
      ),
    };
  }

  /**
   * El memorando de una orden: sus operativos en la jornada, en el formato oficial.
   *
   * A DIFERENCIA DE LA TARJETA CORTA, aquí sí se enumeran los operativos de la persona
   * (sigue siendo solo de ESA persona, RN-51). Lo que el sistema no conoce —número de
   * memorando, firmante, quién elabora…— sale resaltado como `[Etiqueta]` para completarse después (D14).
   * MEMORANDO U OFICIO y MOTIVO quedan en blanco (decisión del negocio, 2026-09-15).
   */
  async componerMemorando(
    codigo: string,
    editables?: EditablesMemorando,
  ): Promise<{ pdf: Buffer; esBorrador: boolean }> {
    const datos = await this.datosDeMemorando(codigo, editables);
    const pdf = await exportarOrdenMemorando(datos);

    // FIRMA DIGITAL (2026-09-22). Si está configurada (variables FIRMA_*), devuelve el memorando
    // firmado; si no, lo devuelve tal cual. Ver `firma-digital.client.ts`. Se informa si es Borrador
    // (E22) para que el controlador nombre el archivo «…-BORRADOR.pdf».
    return {
      pdf: await this.firma.firmar(pdf),
      esBorrador: datos.esBorrador === true,
    };
  }

  /**
   * Persiste los datos editables del memorando de una orden (D13, 2026-10-01). Lo llama el editor
   * por-orden al guardar: desde aquí «Ver documento» y la reemisión usan estos datos, y la orden
   * deja de estar en BORRADOR cuando se completan los requeridos.
   *
   * PROPIEDAD (2026-10-05): solo el Director que GENERÓ la orden la edita; para los demás es de solo
   * lectura (403). Los faltantes se miden con la plantilla y versión DE ESA ORDEN.
   */
  async guardarEditables(
    codigo: string,
    editables: EditablesMemorando,
    usuarioId: number,
  ): Promise<void> {
    // La config global (ciudad/siglas) se lee FUERA de la transacción: es de todas las órdenes.
    const config = await this.configOrden();

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const orden = await this.repositorio.paraCompletar(codigo, cliente);

      if (!orden) {
        throw new RecursoNoEncontradoError(
          `No existe una orden de servicio con el código ${codigo}.`,
          { codigo },
        );
      }

      await this.exigirDuenoDeOrden(orden.directorId, usuarioId, codigo);

      await this.repositorio.actualizarEditables(
        codigo,
        editables as unknown as Prisma.InputJsonValue,
        cliente,
      );

      // G14. Al completar los requeridos, el borrador pasa a VIGENTE y RECIÉN AHÍ consume número.
      // No se renumera si ya lo tiene (una reemisión conserva el suyo reservado), y una orden
      // reemplazada (no vigente) nunca lo recibe por editar.
      if (orden.vigente && orden.numeroSecuencial === null) {
        const [plantillas, configCuadroFila] = await Promise.all([
          this.plantillasDeOrdenes([orden], cliente),
          this.repositorio.obtenerConfigCuadro(
            orden.operativo.cuadro.fecha,
            cliente,
          ),
        ]);
        const plantilla = plantillaDe(plantillas, orden);
        const fuente = this.fuenteDeOrden({
          nombre: `${orden.funcionario.apellidos} ${orden.funcionario.nombres}`,
          cargoFicha: orden.funcionario.cargo,
          direccionFicha: orden.funcionario.direccion,
          editables,
          firmante: firmanteDeOrden(orden.firmante),
          config,
          configCuadro: aConfigCuadro(configCuadroFila),
          plantilla,
          fecha: orden.operativo.cuadro.fecha,
          numeroAnio: orden.numeroAnio,
          numeroSecuencial: orden.numeroSecuencial,
        });
        if (faltantesDeOrden(plantilla.apartados, fuente).length === 0) {
          await this.numerar(orden.id, orden.emitidaEn, cliente);
        }
      }
    });
  }

  /**
   * El PDF de la plantilla que se está editando (2026-09-22; genérica desde 2026-10-05).
   *
   * Es la vista previa REAL del editor de plantilla: renderiza el memorando con los apartados y los
   * DATOS GENERALES que la Dirección tiene en pantalla —aún sin guardar— para que vea cómo saldrá.
   * Es siempre GENÉRICA (D17): los datos DE LA ORDEN (destinatario, número, fechas, operativos) van
   * vacíos y se pintan como MARCADOR GRIS de ejemplo (`modoVistaPrevia`). La tabla de control
   * (acción, elaborado por, siglas) es de la plantilla y sale con lo que el editor tiene en pantalla
   * (2026-10-08). Si el editor no envía datos generales, se usan los de la plantilla del Director en
   * sesión. NO se firma.
   */
  async previsualizarPlantilla(
    apartados: Apartado[],
    datosGeneralesOverride: Partial<DatosGenerales> | undefined,
    usuarioId: number,
  ): Promise<Buffer> {
    // El bloque del Director que llega del editor puede venir parcial: se normaliza a la forma plena.
    const datosGenerales = datosGeneralesOverride
      ? aDatosGenerales(datosGeneralesOverride)
      : (await this.plantillaDelDirector(usuarioId)).datosGenerales;
    const fuente: FuenteTokens = {
      // Datos de la orden: vacíos → marcador gris de ejemplo.
      nombre: '',
      cargo: '',
      dependencia: '',
      numeroOrden: null,
      // La fecha de emisión y «Ciudad, fecha» son DE LA ORDEN (la jornada de cada una): en la vista
      // previa van vacías y salen como marcador gris, nunca con la fecha de hoy (2026-10-05).
      fechaEmision: '',
      ciudadFecha: '',
      // Datos generales EN EDICIÓN: su valor real.
      direccionResponsable: datosGenerales.direccionResponsable.trim(),
      numeroMemorando: datosGenerales.numeroMemorando.trim(),
      fechaMemorando: fechaMemorandoNatural(datosGenerales.fechaMemorando),
      designado: datosGenerales.designado.trim(),
      firmante: datosGenerales.firmante.trim(),
      firmanteCargo: datosGenerales.firmanteCargo.trim(),
      firmanteDependencia: datosGenerales.firmanteDependencia.trim(),
      elaboradoPor: datosGenerales.elaboradoPor.trim(),
      siglasUnidad: datosGenerales.siglasUnidad,
    };
    return exportarOrdenMemorando({
      ...this.componerDatos(apartados, fuente, datosGenerales.accion, []),
      modoVistaPrevia: true,
    });
  }

  /**
   * Los datos del memorando de una orden: lo que el sistema conoce + lo que la Dirección completó.
   *
   * Se resuelve con la plantilla y versión CON LAS QUE SE GENERÓ LA ORDEN (punto 20, 2026-10-05), no
   * con la del usuario que la abre: un Director que mira la orden de otro ve los datos y la firma de
   * quien la generó. Los operativos y el nombre salen del servidor y no se aceptan del cliente.
   */
  async datosDeMemorando(
    codigo: string,
    editables?: EditablesMemorando,
  ): Promise<DatosOrdenMemorando> {
    const orden = await this.repositorio.buscarPorCodigo(codigo);

    if (!orden) {
      throw new RecursoNoEncontradoError(
        `No existe una orden de servicio con el código ${codigo}.`,
        { codigo },
      );
    }

    // Si no llegan editables (p. ej. al VER el documento ya emitido), se usan los PERSISTIDOS en la
    // orden (D13). Así «Ver documento» y la reemisión reproducen lo que la Dirección ya completó.
    const efectivos: EditablesMemorando =
      editables ?? (orden.editables as EditablesMemorando | null) ?? {};

    const fecha = orden.operativo.cuadro.fecha;
    const [plantillas, asignaciones, config, configCuadroFila] =
      await Promise.all([
        this.plantillasDeOrdenes([orden]),
        this.repositorio.operativosDeFuncionarioEnFecha(
          orden.funcionarioId,
          fecha,
        ),
        this.configOrden(),
        this.repositorio.obtenerConfigCuadro(fecha),
      ]);
    const plantilla = plantillaDe(plantillas, orden);

    const fuente: FuenteTokens = {
      ...this.fuenteDeOrden({
        nombre: `${orden.funcionario.apellidos} ${orden.funcionario.nombres}`,
        cargoFicha: orden.funcionario.cargo,
        direccionFicha: orden.funcionario.direccion,
        editables: efectivos,
        firmante: firmanteDeOrden(orden.firmante),
        config,
        configCuadro: aConfigCuadro(configCuadroFila),
        plantilla,
        fecha,
        numeroAnio: orden.numeroAnio,
        numeroSecuencial: orden.numeroSecuencial,
      }),
      // Trámite(s) de Inspección de la persona ese día (2026-10-07), de la copia guardada.
      ...tokensDeTramites(asignaciones),
    };

    const operativos: OperativoDeOrden[] = asignaciones.map((asignacion) => ({
      identificador: asignacion.operativo.identificador,
      horario: `${comoHoraInstitucional(
        asignacion.horaInicio ?? asignacion.operativo.horaInicio,
      )} A ${comoHoraInstitucional(
        asignacion.horaFin ?? asignacion.operativo.horaFin,
      )}`,
      zonal:
        asignacion.operativo.zonales
          .map((fila) => fila.zonal.nombre)
          .join(', ') || '—',
      // Institución(es) del operativo: vacío si no tiene ninguna (celda en blanco, nunca «XXXX»).
      institucion: asignacion.operativo.instituciones
        .map((fila) => fila.institucion.nombre)
        .join(', '),
    }));

    // RN-34: el teléfono del destinatario sale SOLO de su ficha (nunca se digita en el operativo).
    return this.componerDatos(
      plantilla.apartados,
      fuente,
      plantilla.datosGenerales.accion,
      operativos,
      orden.funcionario.telefono ?? '',
    );
  }

  /**
   * Arma el `DatosOrdenMemorando` a partir de UNA resolución de tokens (D12): los campos
   * estructurados van con su valor crudo (vacío = el exportador los resalta en amarillo) y el cuerpo
   * libre de los apartados con cada token sustituido —vacío como `[Etiqueta]`, número de orden en
   * gris—, nunca «XXXX» (D14). Lo comparten el documento real y la vista previa.
   */
  private componerDatos(
    apartados: Apartado[],
    fuente: FuenteTokens,
    /** Primera columna de la tabla de control: «<accion>: <elaborado por>» (2026-10-08). */
    accion: string,
    operativos: OperativoDeOrden[],
    telefonoFuncionario = '',
  ): DatosOrdenMemorando {
    // E22: si quedan datos obligatorios sin completar, el documento es un BORRADOR y sale con la
    // marca de agua «NO VÁLIDO». Se miden sobre los MISMOS apartados y fuente que se renderizan
    // (D12), de modo que la marca aparece exactamente cuando la tarjeta/visor dicen «Borrador».
    const { valores, faltantes } = resolverDatosTokens(apartados, fuente);
    const esBorrador = faltantes.length > 0;

    // Un BORRADOR nunca muestra número (punto 13): si una reemisión incompleta conserva su número
    // RESERVADO, el documento lleva el marcador gris «[N.º se asigna al quedar vigente]» igual.
    if (esBorrador) valores.numeroOrden = null;

    const tokensTexto: Record<string, string> = {};
    for (const token of Object.keys(ETIQUETA_TOKEN)) {
      tokensTexto[token] = marcador(token, valores[token] ?? null);
    }
    const apartadosResueltos = apartados.map((apartado) => ({
      ...apartado,
      titulo: sustituirTokens(apartado.titulo, tokensTexto),
      etiqueta:
        apartado.etiqueta !== undefined
          ? sustituirTokens(apartado.etiqueta, tokensTexto)
          : apartado.etiqueta,
      contenido: sustituirTokens(apartado.contenido, tokensTexto),
    }));

    return {
      numeroMemorando: valores.numeroMemorando ?? '',
      ciudadFecha: valores.ciudadFecha ?? '',
      numeroOrden: valores.numeroOrden ?? '',
      fechaEmision: valores.fechaEmision ?? '',
      direccionResponsable: valores.direccionResponsable ?? '',
      // RN-34: el teléfono del DESTINATARIO (su propio dato en su orden). Vacío si la ficha no lo tiene.
      telefonoFuncionario,
      accion: accion.trim() || ACCION_POR_DEFECTO,
      elaboradoPor: valores.elaboradoPor ?? '',
      siglasUnidad: valores.siglasUnidad ?? '',
      para: {
        // El nombre NO se toma del cliente: se re-deriva del servidor (RN-51).
        nombre: valores.nombre ?? '',
        cargo: valores.cargo ?? '',
        dependencia: valores.dependencia ?? '',
      },
      firmante: {
        nombre: valores.firmante ?? '',
        cargo: fuente.firmanteCargo,
        dependencia: fuente.firmanteDependencia,
      },
      operativos,
      apartados: apartadosResueltos,
      esBorrador,
    };
  }

  /**
   * Los faltantes de una LISTA de órdenes, sin N+1: UNA lectura de la config global, una de la config
   * del cuadro por fecha distinta y UNA de las versiones de plantilla que usan las órdenes. Cada orden
   * se resuelve con SU plantilla y versión (2026-10-05), y su cuadro con el suyo.
   */
  async faltantesPorCodigo(
    ordenes: OrdenConOperativo[],
  ): Promise<Map<string, Faltante[]>> {
    const [config, plantillas] = await Promise.all([
      this.configOrden(),
      this.plantillasDeOrdenes(ordenes),
    ]);

    const fechas = new Map<string, Date>();
    for (const orden of ordenes) {
      const fecha = orden.operativo.cuadro.fecha;
      fechas.set(fecha.toISOString(), fecha);
    }
    const configsCuadro = new Map<string, ConfigCuadro>();
    await Promise.all(
      [...fechas.entries()].map(async ([clave, fecha]) => {
        configsCuadro.set(
          clave,
          aConfigCuadro(await this.repositorio.obtenerConfigCuadro(fecha)),
        );
      }),
    );

    const mapa = new Map<string, Faltante[]>();
    for (const orden of ordenes) {
      const plantilla = plantillaDe(plantillas, orden);
      const fuente = this.fuenteDeOrden({
        nombre: `${orden.funcionario.apellidos} ${orden.funcionario.nombres}`,
        cargoFicha: orden.funcionario.cargo,
        direccionFicha: orden.funcionario.direccion,
        editables: (orden.editables as EditablesMemorando | null) ?? {},
        firmante: firmanteDeOrden(orden.firmante),
        config,
        configCuadro:
          configsCuadro.get(orden.operativo.cuadro.fecha.toISOString()) ??
          CONFIG_CUADRO_VACIA,
        plantilla,
        fecha: orden.operativo.cuadro.fecha,
        numeroAnio: orden.numeroAnio,
        numeroSecuencial: orden.numeroSecuencial,
      });
      mapa.set(orden.codigo, faltantesDeOrden(plantilla.apartados, fuente));
    }
    return mapa;
  }

  /**
   * PASO AUTOMÁTICO A VIGENTE (punto 14, 2026-10-05). Una orden vigente SIN número cuyos faltantes ya
   * están en cero —p. ej. porque se completó el cargo en la ficha de Personal— se numera aquí, en una
   * transacción atómica, antes de responder: así la pantalla nunca muestra un «Borrador» al que no le
   * falta nada. Muta en memoria el número de las órdenes promovidas para que la respuesta lo refleje.
   */
  async asegurarVigencia(
    ordenes: OrdenConOperativo[],
    faltantes: Map<string, Faltante[]>,
  ): Promise<void> {
    const completas = ordenes.filter(
      (orden) =>
        orden.vigente &&
        orden.numeroSecuencial === null &&
        (faltantes.get(orden.codigo) ?? []).length === 0,
    );
    if (completas.length === 0) return;

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      for (const orden of completas) {
        const numero = await this.numerar(orden.id, orden.emitidaEn, cliente);
        orden.numeroAnio = numero.anio;
        orden.numeroSecuencial = numero.secuencial;
      }
    });
  }

  /**
   * Si al borrador ya no le falta ningún dato obligatorio, lo numera (lo deja VIGENTE) y lo audita.
   * Mismos faltantes que el resto (D12), con SU plantilla (y el respaldo del día si es anterior).
   */
  private async promoverSiCompleto(
    borrador: BorradorDeCuadro,
    fechaCuadro: Date,
    plantilla: PlantillaResuelta,
    config: ConfigOrden,
    configCuadro: ConfigCuadro,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    const fuente = this.fuenteDeOrden({
      nombre: `${borrador.funcionario.apellidos} ${borrador.funcionario.nombres}`,
      cargoFicha: borrador.funcionario.cargo,
      direccionFicha: borrador.funcionario.direccion,
      editables: (borrador.editables as EditablesMemorando | null) ?? {},
      firmante: firmanteDeOrden(borrador.firmante),
      config,
      configCuadro,
      plantilla,
      fecha: fechaCuadro,
      numeroAnio: borrador.numeroAnio,
      numeroSecuencial: borrador.numeroSecuencial,
    });

    if (faltantesDeOrden(plantilla.apartados, fuente).length > 0) return;

    await this.numerar(borrador.id, borrador.emitidaEn, cliente);
  }

  /**
   * Asigna el número AMC-OS a una orden (secuencial institucional del año, atómico) y lo audita. Es el
   * ÚNICO sitio que numera: el contador es compartido por todos los Directores y se reinicia por año.
   */
  private async numerar(
    ordenId: number,
    emitidaEn: Date,
    cliente: Prisma.TransactionClient,
  ): Promise<{ anio: number; secuencial: number }> {
    const anio = emitidaEn.getFullYear();
    const secuencial = await this.repositorio.siguienteSecuencial(
      anio,
      cliente,
    );
    await this.repositorio.asignarNumero(ordenId, anio, secuencial, cliente);

    await this.auditoria.registrar(
      {
        entidad: 't_orden_servicio',
        entidadId: ordenId,
        accion: AccionAuditoria.EMITIR,
        cambios: [
          { campo: 'oser_numero_secuencial', valorNuevo: String(secuencial) },
        ],
      },
      cliente,
    );
    return { anio, secuencial };
  }

  // ─────────────────── Plantilla por Director (2026-10-05) ───────────────────

  /**
   * La plantilla del Director en sesión (su versión vigente). Si aún no tiene, SE CREA copiando los
   * apartados de la plantilla BASE institucional y prellenando sus datos generales desde su usuario
   * (punto 5). Un Director nunca obtiene la plantilla de otro: se busca por SU id.
   */
  async plantillaDelDirector(usuarioId: number): Promise<PlantillaDeDirector> {
    const existente = await this.repositorio.plantillaDeDirector(usuarioId);
    if (existente) return aPlantillaDeDirector(existente, usuarioId);

    const [base, iniciales] = await Promise.all([
      this.repositorio.plantillaBase(),
      this.datosGeneralesIniciales(usuarioId),
    ]);
    const apartados =
      base && apartadosValidos(base.apartados)
        ? base.apartados
        : APARTADOS_POR_DEFECTO;

    try {
      const creada = await this.repositorio.ejecutarEnTransaccion(
        async (cliente) => {
          const fila = await this.repositorio.crearPlantillaDirector(
            {
              directorId: usuarioId,
              apartados: apartados as unknown as Prisma.InputJsonValue,
              datosGenerales: iniciales as unknown as Prisma.InputJsonValue,
              usuarioId,
            },
            cliente,
          );
          await this.auditoria.registrar(
            {
              entidad: 't_plantilla_orden',
              entidadId: fila.id,
              accion: AccionAuditoria.CREAR,
              usuario: usuarioId,
            },
            cliente,
          );
          return fila;
        },
      );
      return aPlantillaDeDirector(creada, usuarioId);
    } catch (fallo) {
      // Dos pestañas del mismo Director pudieron crearla a la vez: `uq_plantilla_director` rechaza la
      // segunda. Si ya existe, se usa; si no, el fallo era otro y se propaga.
      const recien = await this.repositorio.plantillaDeDirector(usuarioId);
      if (recien) return aPlantillaDeDirector(recien, usuarioId);
      throw fallo;
    }
  }

  /**
   * Los datos generales con los que nace la plantilla de un Director (punto 5): el firmante es él
   * —su nombre, y cargo/dependencia de su ficha si su cuenta está enlazada—; la dirección responsable
   * es la institucional; el designado se propone como «firmante (cargo)»; memorando y fecha, vacíos.
   * Todo editable después en el editor.
   */
  private async datosGeneralesIniciales(
    usuarioId: number,
  ): Promise<DatosGenerales> {
    const usuario = await this.repositorio.usuarioParaPlantilla(usuarioId);
    const firmante = usuario?.nombre.trim() ?? '';
    const cargo = usuario?.funcionario?.cargo?.trim() ?? '';
    const dependencia = usuario?.funcionario
      ? nombreDeDireccion(usuario.funcionario.direccion)
      : '';
    // Tabla de control (2026-10-08): las siglas nacen del parámetro institucional; quién elabora,
    // vacío (lo fija el Director en su plantilla).
    const { siglasUnidad } = await this.configOrden();
    return {
      ...DATOS_GENERALES_VACIOS,
      direccionResponsable: DIRECCION_RESPONSABLE_INICIAL,
      firmante,
      firmanteCargo: cargo,
      firmanteDependencia: dependencia,
      designado: firmante && cargo ? `${firmante} (${cargo})` : firmante,
      siglasUnidad: aSiglas(siglasUnidad),
    };
  }

  /**
   * Las plantillas (apartados + datos generales) con las que se resuelve una lista de órdenes: la
   * versión EXACTA de cada una (`plantillaId` + `plantillaVersion`), leídas en UNA consulta. Una orden
   * sin plantilla (no debería quedar ninguna tras la migración) cae en la base institucional.
   */
  private async plantillasDeOrdenes(
    ordenes: OrdenConPlantilla[],
    cliente?: Prisma.TransactionClient,
  ): Promise<Map<string, PlantillaResuelta>> {
    const pares = new Map<string, { plantillaId: number; version: number }>();
    let hayHuerfanas = false;
    for (const orden of ordenes) {
      if (orden.plantillaId !== null && orden.plantillaVersion !== null) {
        pares.set(clavePlantilla(orden), {
          plantillaId: orden.plantillaId,
          version: orden.plantillaVersion,
        });
      } else {
        hayHuerfanas = true;
      }
    }

    const mapa = new Map<string, PlantillaResuelta>();
    const versiones = await this.repositorio.versionesDePlantilla(
      [...pares.values()],
      cliente,
    );
    for (const fila of versiones) {
      mapa.set(
        `${fila.plantillaId}:${fila.version}`,
        aPlantillaResuelta(fila.apartados, fila.datosGenerales),
      );
    }

    // La base cubre las huérfanas y cualquier versión que no apareciera en el historial.
    const faltaAlguna = [...pares.keys()].some((clave) => !mapa.has(clave));
    if (hayHuerfanas || faltaAlguna) {
      const base = await this.repositorio.plantillaBase(cliente);
      mapa.set(
        CLAVE_BASE,
        aPlantillaResuelta(
          base?.apartados ?? null,
          base?.datosGenerales ?? null,
        ),
      );
    }
    return mapa;
  }

  /**
   * SUGERENCIA DEL FIRMANTE para el editor (2026-10-05): el Director EN SESIÓN, leído de su ficha de
   * personal —nombre, cargo y la dependencia que se deriva de su dirección (organigrama)—. El editor la
   * usa SOLO para prellenar los campos del firmante que vengan vacíos; no se guarda por sí sola. Sin
   * ficha asociada a la sesión, no hay sugerencia (`null`). No expone nada más de la sesión.
   */
  async sugerenciaFirmante(usuario: {
    funcionarioId: number | null;
    nombre: string;
  }): Promise<SugerenciaFirmante | null> {
    if (usuario.funcionarioId === null) return null;
    const ficha = await this.repositorio.fichaFirmante(usuario.funcionarioId);
    if (!ficha) return null;
    const nombre =
      `${ficha.nombres} ${ficha.apellidos}`.trim() || usuario.nombre;
    return {
      nombre,
      cargo: ficha.cargo?.trim() ?? '',
      dependencia: nombreDeDireccion(ficha.direccion),
    };
  }

  /**
   * Guarda la plantilla DEL DIRECTOR EN SESIÓN —apartados y datos generales— como una NUEVA versión
   * (punto 27). En la misma transacción:
   *  · deja la versión en el historial y la audita (regla 5);
   *  · regenera SOLO los borradores de ESE Director: pasan a la nueva versión, se re-sella su firmante
   *    si estaba incompleto (una firma ya válida no se reescribe, F20) y, si ya no les falta nada, se
   *    numeran. Las órdenes Vigentes y Reemplazadas NO cambian: siguen con su versión.
   */
  async guardarPlantilla(
    apartados: Apartado[],
    datosGenerales: Partial<DatosGenerales> | undefined,
    usuarioId: number,
  ): Promise<PlantillaDeDirector> {
    const limpios = aDatosGenerales(datosGenerales);
    const actual = await this.plantillaDelDirector(usuarioId);
    const config = await this.configOrden();

    const version = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const nueva = await this.repositorio.guardarNuevaVersion(
          actual.id,
          apartados as unknown as Prisma.InputJsonValue,
          limpios as unknown as Prisma.InputJsonValue,
          usuarioId,
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_plantilla_orden',
            entidadId: actual.id,
            accion: AccionAuditoria.ACTUALIZAR,
            usuario: usuarioId,
            cambios: [
              {
                campo: 'plor_version',
                valorAnterior: String(actual.version),
                valorNuevo: String(nueva),
              },
            ],
          },
          cliente,
        );

        const borradores = await this.repositorio.borradoresDeDirector(
          usuarioId,
          cliente,
        );

        // Config del cuadro por fecha (respaldo de «elaborado por»): una lectura por jornada distinta.
        const configsCuadro = new Map<string, ConfigCuadro>();
        for (const borrador of borradores) {
          const clave = borrador.operativo.cuadro.fecha.toISOString();
          if (!configsCuadro.has(clave)) {
            configsCuadro.set(
              clave,
              aConfigCuadro(
                await this.repositorio.obtenerConfigCuadro(
                  borrador.operativo.cuadro.fecha,
                  cliente,
                ),
              ),
            );
          }
        }

        const plantillaNueva: PlantillaResuelta = {
          apartados,
          datosGenerales: limpios,
          tablaControlLegada: false,
        };
        for (const borrador of borradores) {
          await this.repositorio.actualizarVersionPlantilla(
            borrador.id,
            actual.id,
            nueva,
            cliente,
          );

          const copia = firmanteDeOrden(borrador.firmante);
          const incompleto =
            copia === null ||
            copia.nombre.trim() === '' ||
            copia.cargo.trim() === '' ||
            copia.dependencia.trim() === '';
          if (incompleto) {
            const sellado = {
              nombre: copia?.nombre?.trim()
                ? copia.nombre
                : limpios.firmante.trim(),
              cargo: copia?.cargo?.trim()
                ? copia.cargo
                : limpios.firmanteCargo.trim(),
              dependencia: copia?.dependencia?.trim()
                ? copia.dependencia
                : limpios.firmanteDependencia.trim(),
              usuarioId,
              fecha: new Date().toISOString(),
            };
            await this.repositorio.actualizarFirmante(
              borrador.id,
              sellado as unknown as Prisma.InputJsonValue,
              cliente,
            );
          }

          await this.promoverSiCompleto(
            borrador,
            borrador.operativo.cuadro.fecha,
            plantillaNueva,
            config,
            configsCuadro.get(borrador.operativo.cuadro.fecha.toISOString()) ??
              CONFIG_CUADRO_VACIA,
            cliente,
          );
        }

        return nueva;
      },
    );

    return {
      id: actual.id,
      directorId: usuarioId,
      version,
      apartados,
      datosGenerales: limpios,
      tablaControlLegada: false,
    };
  }

  /**
   * RF-045. Emite una orden por cada funcionario asignado.
   *
   * VAL-30: sin personal no hay destinatario, y un documento sin destinatario no es una
   * orden de servicio. Se responde con el identificador del operativo para que el
   * Director sepa cuál revisar.
   *
   * PLANTILLA POR DIRECTOR (2026-10-05): se genera con la plantilla (última versión) del Director en
   * sesión, y la orden guarda director, plantilla y versión. Si el operativo ya tiene órdenes VIGENTES
   * de OTRO Director, solo él puede reemitirlas (403).
   */
  async emitir(
    operativoId: number,
    emisor: Emisor,
  ): Promise<OrdenConOperativo[]> {
    // F21. Solo la Dirección emite/reemite. Es regla de negocio (el firmante debe ser el Director)
    // SOBRE el permiso `ordenes:gestionar`: el permiso abre la pantalla, pero firmar es del Director.
    if (!emisor.roles.includes(RolDepartamental.DIRECTOR)) {
      throw new AutorizacionError(
        CODIGOS_ERROR.ROL_NO_AUTORIZADO,
        'Solo la Dirección puede emitir órdenes de servicio: el documento lo firma el Director.',
        { operativoId },
      );
    }

    const operativo = await this.exigirOperativo(operativoId);

    if (operativo.personal.length === 0) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.CUADRO_CERRADO,
        `El operativo ${operativo.identificador} no tiene personal asignado: no hay a quién entregar la orden.`,
        { operativoId },
      );
    }

    // PROPIEDAD: las órdenes vigentes de otro Director solo las reemite él.
    const vigentes = await this.repositorio.listarDeOperativo(operativoId);
    const ajena = vigentes.find(
      (orden) =>
        orden.directorId !== null && orden.directorId !== emisor.usuarioId,
    );
    if (ajena?.directorId != null) {
      const nombres = await this.repositorio.nombresDeUsuarios([
        ajena.directorId,
      ]);
      const quien = nombres.get(ajena.directorId) ?? 'otro Director';
      throw new AutorizacionError(
        CODIGOS_ERROR.ROL_NO_AUTORIZADO,
        `Estas órdenes las generó ${quien}; solo él puede reemitirlas.`,
        { operativoId },
      );
    }

    // La plantilla del Director, la config global y la del cuadro (por la fecha de la jornada) se leen
    // UNA vez, fuera de la transacción: con ellas cada orden decide si nace Vigente (numera) o
    // Borrador, con los mismos faltantes que el resto (D12).
    const [config, plantilla, configCuadroFila] = await Promise.all([
      this.configOrden(),
      this.plantillaDelDirector(emisor.usuarioId),
      this.repositorio.obtenerConfigCuadro(operativo.cuadro.fecha),
    ]);
    const configCuadro = aConfigCuadro(configCuadroFila);

    // La COPIA CONGELADA del firmante sale de los datos generales de SU plantilla (F19/F20).
    const firmante = this.firmanteActual(emisor, plantilla.datosGenerales);

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      for (const asignacion of operativo.personal) {
        await this.emitirPara(
          operativo,
          asignacion.funcionarioId,
          emisor,
          firmante,
          plantilla,
          config,
          configCuadro,
          cliente,
        );
      }
    });

    // Evento `OrdenServicioEmitida`, después de confirmar. **Sin los nombres**: el
    // registro de actividad no es el sitio donde deba quedar quién sale a qué.
    this.logger.log('Órdenes de servicio emitidas', {
      identificador: operativo.identificador,
      ordenes: operativo.personal.length,
      emitidaPor: emisor.usuarioId,
    });

    return this.repositorio.listarDeOperativo(operativoId);
  }

  /** Lo ya emitido para un operativo. Lo consulta la pantalla P-05. */
  async consultarDeOperativo(
    operativoId: number,
  ): Promise<OrdenConOperativo[]> {
    await this.exigirOperativo(operativoId);
    return this.repositorio.listarDeOperativo(operativoId);
  }

  /** El nombre de los Directores que generaron una lista de órdenes, en UNA consulta. */
  async nombresDeDirectores(
    ordenes: OrdenConOperativo[],
  ): Promise<Map<number, string>> {
    const ids = new Set<number>();
    for (const orden of ordenes) {
      if (orden.directorId !== null) ids.add(orden.directorId);
    }
    return this.repositorio.nombresDeUsuarios([...ids]);
  }

  /**
   * RN-49. Las órdenes del funcionario que consulta. **Nunca las de otro.**
   *
   * El identificador de la persona sale del usuario autenticado y de ningún otro sitio:
   * no hay parámetro que lo altere. Si la cuenta no tiene ficha de personal asociada, se
   * dice con claridad en lugar de devolver una lista vacía que parecería «no tiene
   * órdenes».
   */
  async consultarPropias(
    usuarioId: number,
    desde?: Date,
  ): Promise<OrdenConOperativo[]> {
    const funcionarioId =
      await this.repositorio.funcionarioDeUsuario(usuarioId);

    if (funcionarioId === null) {
      throw new RecursoNoEncontradoError(
        'Su usuario no tiene una ficha de personal asociada, así que no puede recibir órdenes de servicio. Comuníquelo al administrador del sistema.',
        { usuarioId },
      );
    }

    return this.repositorio.listarDeFuncionario(funcionarioId, desde);
  }

  /** Una orden concreta, por su código. Para descargar el documento. */
  async obtenerPorCodigo(codigo: string): Promise<OrdenConOperativo> {
    const orden = await this.repositorio.buscarPorCodigo(codigo);

    if (!orden) {
      throw new RecursoNoEncontradoError(
        `No existe una orden de servicio con el código ${codigo}.`,
        { codigo },
      );
    }

    return orden;
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  /**
   * PROPIEDAD DE LA ORDEN (punto 8, 2026-10-05): cada Director ve todas las órdenes del cuadro, pero
   * solo edita las SUYAS. Una orden sin director (anterior a la migración) no se bloquea.
   */
  private async exigirDuenoDeOrden(
    directorId: number | null,
    usuarioId: number,
    codigo: string,
  ): Promise<void> {
    if (directorId === null || directorId === usuarioId) return;
    const nombres = await this.repositorio.nombresDeUsuarios([directorId]);
    const quien = nombres.get(directorId) ?? 'otro Director';
    throw new AutorizacionError(
      CODIGOS_ERROR.ROL_NO_AUTORIZADO,
      `Esta orden la generó ${quien}: es de solo lectura para usted.`,
      { codigo },
    );
  }

  /**
   * Emite la orden de una persona: anula la anterior y escribe la nueva.
   *
   * Las dos operaciones van con el MISMO cliente de transacción. `uq_orden_vigente` es un
   * índice único parcial: si entre una y otra se colara otra emisión, la base rechazaría
   * la segunda, y con razón.
   */
  private async emitirPara(
    operativo: OperativoParaOrden,
    funcionarioId: number,
    emisor: Emisor,
    firmante: FirmanteCopia,
    plantilla: PlantillaDeDirector,
    config: ConfigOrden,
    configCuadro: ConfigCuadro,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    const asignacion = operativo.personal.find(
      (fila) => fila.funcionarioId === funcionarioId,
    );

    if (!asignacion) return;

    // Se lee la vigente ANTES de anularla: la reemisión conserva lo que la Dirección ya completó
    // (editables) y el número que ya tenía (G27), de modo que corregir no reinicia ni renumera.
    const anterior = await this.repositorio.vigenteAnterior(
      operativo.id,
      funcionarioId,
      cliente,
    );

    const anuladas = await this.repositorio.anularVigentes(
      operativo.id,
      funcionarioId,
      cliente,
    );

    const emisiones = await this.repositorio.contarEmisiones(
      operativo.id,
      funcionarioId,
      cliente,
    );

    // POL-09. Cuatro valores sueltos: el constructor no recibe el operativo.
    const datoAislado = construirDatoAislado({
      // 2026-09-08. El horario de la orden es el de ESTA persona: su ventana propia si la
      // tiene, o la del operativo. La orden ya es por funcionario (RN-50), así que su hoja
      // dice el turno que le toca a ella, no el del operativo entero.
      horaInicio: asignacion.horaInicio ?? operativo.horaInicio,
      horaFin: asignacion.horaFin ?? operativo.horaFin,
      nombreFuncionario: `${asignacion.funcionario.apellidos} ${asignacion.funcionario.nombres}`,
      nombreConductor: operativo.conductor?.nombreCompleto ?? null,
      telefonoConductor: operativo.conductor?.telefono ?? null,
      placa: operativo.vehiculo?.placa ?? null,
    });

    // Los editables heredados de la vigente anterior (si los hubo); un `null` guardado no se copia.
    const editablesHeredados: Prisma.InputJsonValue | undefined =
      anterior && anterior.editables !== null
        ? (anterior.editables as Prisma.InputJsonValue)
        : undefined;

    const creada = await this.repositorio.crear(
      {
        operativoId: operativo.id,
        funcionarioId,
        codigo: componerCodigo(
          operativo.identificador,
          funcionarioId,
          emisiones + 1,
        ),
        datoAislado: datoAislado as unknown as Prisma.InputJsonValue,
        emitidaPor: emisor.usuarioId,
        // F20. Copia CONGELADA del firmante (de la plantilla del Director): no se recalcula después.
        firmante: firmante as unknown as Prisma.InputJsonValue,
        editables: editablesHeredados,
        // G27 / decisión 2026-10-05: la reemisión hereda el número; si la nueva versión queda
        // incompleta, ese número queda RESERVADO (la orden se expone como Borrador, sin número).
        numeroSecuencial: anterior?.numeroSecuencial ?? null,
        numeroAnio: anterior?.numeroAnio ?? null,
        directorId: emisor.usuarioId,
        plantillaId: plantilla.id,
        plantillaVersion: plantilla.version,
      },
      cliente,
    );

    // G14. El número se consume SOLO cuando la orden nace VIGENTE —sin faltantes— y aún no tiene uno:
    // el borrador no numera, y la reemisión conserva (reservado) el que heredó.
    const yaNumerada =
      anterior?.numeroSecuencial != null && anterior?.numeroAnio != null;
    if (!yaNumerada) {
      const fuente = this.fuenteDeOrden({
        nombre: `${asignacion.funcionario.apellidos} ${asignacion.funcionario.nombres}`,
        cargoFicha: asignacion.funcionario.cargo,
        direccionFicha: asignacion.funcionario.direccion,
        editables: (anterior?.editables as EditablesMemorando | null) ?? {},
        firmante: firmanteDeOrden(firmante),
        config,
        configCuadro,
        plantilla,
        fecha: operativo.cuadro.fecha,
        numeroAnio: null,
        numeroSecuencial: null,
      });
      if (faltantesDeOrden(plantilla.apartados, fuente).length === 0) {
        await this.numerar(creada.id, creada.emitidaEn, cliente);
      }
    }

    await this.auditoria.registrar(
      {
        entidad: 't_orden_servicio',
        entidadId: creada.id,
        operativoId: operativo.id,
        accion: AccionAuditoria.EMITIR,
        cambios:
          anuladas > 0
            ? [
                {
                  campo: 'oser_vigente',
                  valorAnterior: 'true',
                  valorNuevo: 'false',
                },
              ]
            : undefined,
        usuario: emisor.usuarioId,
      },
      cliente,
    );
  }

  private async exigirOperativo(id: number): Promise<OperativoParaOrden> {
    const operativo = await this.repositorio.buscarOperativo(id);

    if (!operativo) {
      throw new RecursoNoEncontradoError(
        'El operativo indicado no existe o fue retirado del cuadro.',
        { operativoId: id },
      );
    }

    return operativo;
  }
}

/**
 * RF-049. El código único de la emisión.
 *
 * Se compone de datos que ya existen —el identificador del operativo, la persona y el
 * número de emisión— en lugar de un consecutivo suelto: así el código **dice de qué
 * orden habla** cuando alguien lo cita en un oficio, y la reemisión se distingue de la
 * primera entrega sin consultar la base.
 *
 * A diferencia de `cuad_orden_trabajo` (PV-28), aquí generarlo es lo correcto: FASE2
 * §CU-09 dice que **el sistema** registra la emisión con código único. Lo que ninguna
 * fuente fija es su forma, y esta se eligió por ser trazable, no por ser bonita.
 */
function componerCodigo(
  identificador: string,
  funcionarioId: number,
  numeroDeEmision: number,
): string {
  return `OS-${identificador}-${funcionarioId}-${numeroDeEmision}`;
}
