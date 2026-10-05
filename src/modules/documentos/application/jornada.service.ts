/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Jornada del día (P-13)
 * Archivo: jornada.service.ts
 * Responsabilidad: Componer la jornada y decir qué secciones puede tocar quien consulta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-26
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ESTO NO ES LA MATRIZ CONSOLIDADA, Y LA DIFERENCIA IMPORTA.
 *
 * P-04 es de la Dirección: los nueve formularios, exportable a PDF y con el cierre de la
 * jornada. Esto es la rejilla del día de los departamentos: los nueve formularios en
 * pantalla, y **ni exportación ni cierre**.
 *
 * CADA ROL VE SOLO SUS FORMULARIOS (2026-09-15). La jornada muestra a quien la consulta
 * únicamente los formularios que **escribe o aporta** (por `t_formulario_rol`); el resto no
 * aparece. `componer` descarta las secciones `LECTURA`, y los totales cuentan solo lo visible.
 *
 * ES UN GIRO RESPECTO DE 2026-08-26/09-01. Entonces se abrió la jornada a los tres roles
 * departamentales mostrando los NUEVE formularios «solo en lectura y sin el personal ajeno»,
 * para darles visibilidad del día. El 2026-09-15 el negocio revirtió esa apertura: pesa más el
 * aislamiento (RN-48 —el cuadro circulaba por WhatsApp y los intervenidos se anticipaban—) que
 * ver el volumen ajeno. Ya no hay «personal ajeno» que recortar porque la sección ajena no viaja.
 * `puedeEditarPersonal` sigue diciendo si P-13 es donde el rol asigna, o si usa P-01/P-02.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * `acceso` DECIDE QUÉ SE PINTA. NO AUTORIZA NADA.
 *
 * La pantalla necesita saber en qué secciones ofrecer el botón de personal, y eso es lo
 * que este campo responde. **La autorización de verdad sigue estando en la escritura**:
 * `exigirParticipacion` de `operativos.service.ts`, contra la base y no contra lo que la
 * pantalla creyera. Si alguien falseara la respuesta de este servicio, lo único que
 * conseguiría es un botón que devuelve 403 al pulsarlo.
 *
 * Es la misma división que ya declara `accesoOperativo.util.ts` en el frontend: «esto no
 * autoriza nada».
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import type {
  AreaPersonal,
  CuadroDiario,
  RolDepartamental,
} from '@prisma/client';

import { LoggerService } from '../../../common/logger/logger.service';
import { VentanaCargaService } from '../../configuracion/application/ventana-carga.service';
import { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import type { Alerta } from '../../operativos/application/politicas/alertas-operativo';
import {
  JornadaRepository,
  type FormularioDeJornada,
  type OperativoDeJornada,
} from '../infrastructure/jornada.repository';
import {
  componerEvidencia,
  correspondeEvidencia,
  enLenguajeNatural,
  nombreDeDireccion,
  type FilaEvidencia,
} from './reglas-matriz';

/**
 * Qué puede hacer en esta sección quien la consulta.
 *
 * `ESCRITURA` y `APORTA` se distinguen aunque la pantalla haga lo mismo con las dos —en
 * ambas ofrece el personal— porque **el cupo solo existe en `APORTA`** y el servidor lo
 * aplica al asignar. Fundirlas en un booleano perdería el motivo del rechazo.
 */
export type AccesoSeccion = 'ESCRITURA' | 'APORTA' | 'LECTURA';

/** Una sección de la jornada: un formulario con sus filas o su evidencia. */
export interface SeccionJornada {
  formulario: FormularioDeJornada;
  responsable: string;
  acceso: AccesoSeccion;
  /**
   * QUÉ PERSONAL SE ESPERA DE QUIEN CONSULTA, en esta sección. Vacío en `LECTURA`.
   *
   * No es lo mismo que las áreas del formulario. La 6 · Patrulla Reacción Nocturna admite
   * tres —General, Técnico e Instrucción— y el DMIT solo pone la tercera: las otras dos
   * las pone DMIP Inspecciones, y contarlas como pendientes suyas le pediría al DMIT
   * gente que no puede asignar y que el servidor le rechazaría.
   */
  areasDelRol: AreaPersonal[];
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * SI DESDE ESTA PANTALLA SE PUEDE ASIGNAR PERSONAL. 2026-09-01.
   *
   * ES OTRA PREGUNTA QUE `acceso`, y por eso es otro campo. `acceso` dice qué autoridad
   * tiene el rol sobre el formulario; esto dice si **P-13** es el sitio donde la ejerce.
   * Un departamento con ESCRITURA la ejerce en P-01 y P-02, que son sus pantallas, y aquí
   * solo mira: es lo que el negocio pidió al abrir esta rejilla a los tres —«solo en
   * lectura»— y lo que no se implementó entonces.
   *
   * SALE DE `t_formulario_rol`, COMO `acceso`. La pantalla no comprueba ningún rol, y el
   * día que el negocio conceda o retire este camino es un `UPDATE`, no un despliegue.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  puedeEditarPersonal: boolean;
  operativos: OperativoDeJornada[];
  /** RN-53. Presente solo si el formulario quedó vacío y su ventana venció. */
  evidencia: FilaEvidencia | null;
}

/** La jornada completa, tal como la pinta P-13. */
export interface JornadaCompuesta {
  cuadro: CuadroDiario;
  fechaNatural: string;
  secciones: SeccionJornada[];
  totales: {
    operativos: number;
    alertas: number;
    formulariosSinCarga: number;
  };
}

@Injectable()
export class JornadaService {
  constructor(
    private readonly repositorio: JornadaRepository,
    private readonly cuadros: CuadroDiarioService,
    private readonly ventanas: VentanaCargaService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Compone la jornada para un rol.
   *
   * Exige que el cuadro exista: la jornada **de un día que nadie abrió** no es una
   * jornada vacía, es una fecha equivocada, y confundirlas ocultaría el error. Mismo
   * criterio que M-19.
   */
  async componer(
    fecha: Date,
    roles: readonly RolDepartamental[],
  ): Promise<JornadaCompuesta> {
    const inicio = Date.now();
    const cuadro = await this.cuadros.obtenerPorFecha(fecha);

    const [formularios, operativos] = await Promise.all([
      this.repositorio.listarFormularios(),
      this.repositorio.listarOperativos(fecha),
    ]);

    const porFormulario = agruparPorFormulario(operativos);
    const secciones: SeccionJornada[] = [];

    for (const formulario of formularios) {
      const suyos = porFormulario.get(formulario.id) ?? [];

      const acceso = accesoDe(formulario, roles);

      // SOLO LOS FORMULARIOS A LOS QUE EL ROL TIENE ACCESO (2026-09-15). Hasta ahora la jornada
      // mostraba los NUEVE en solo lectura —para dar visibilidad del día completo—, y el personal
      // ajeno se recortaba. El negocio revirtió esa apertura: cada rol ve ÚNICAMENTE los
      // formularios que escribe o aporta (por `t_formulario_rol`); el resto ni siquiera aparece.
      // Es más aislamiento (RN-48), a costa de ver el volumen ajeno.
      if (acceso === 'LECTURA') continue;

      secciones.push({
        formulario,
        responsable: responsableDe(formulario),
        acceso,
        areasDelRol: areasQueLeTocanAlRol(formulario, acceso),
        puedeEditarPersonal: puedeEditarPersonalDesdeLaJornada(
          formulario,
          roles,
        ),
        operativos: suyos,
        evidencia: await this.evidenciaDe(formulario, suyos.length > 0),
      });
    }

    // Los totales cuentan SOLO lo visible (los formularios del rol), no el día entero: ver un
    // conteo que incluyera lo ajeno filtraría por la puerta de atrás lo que la sección oculta.
    const operativosVisibles = secciones.flatMap(
      (seccion) => seccion.operativos,
    );

    const jornada: JornadaCompuesta = {
      cuadro,
      fechaNatural: enLenguajeNatural(cuadro.fecha),
      secciones,
      totales: {
        operativos: operativosVisibles.length,
        alertas: contarAlertas(operativosVisibles),
        formulariosSinCarga: secciones.filter(
          (seccion) => seccion.evidencia !== null,
        ).length,
      },
    };

    this.logger.log('Jornada del día compuesta', {
      fecha: comoFecha(fecha),
      roles,
      operativos: jornada.totales.operativos,
      // CUENTA LO QUE LA PANTALLA OFRECE, no lo que el rol podría hacer en otro sitio.
      // Contaba `acceso !== 'LECTURA'`, que desde el 2026-09-01 es otra cosa: hay roles
      // con ESCRITURA que aquí solo miran, y la traza los daba por editables.
      seccionesEditables: secciones.filter(
        (seccion) => seccion.puedeEditarPersonal,
      ).length,
      duracionMs: Date.now() - inicio,
    });

    return jornada;
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  /**
   * RN-53. Decide si al formulario vacío le corresponde fila de evidencia.
   *
   * Se pregunta a M-08 **solo por los formularios vacíos**: consultar la ventana de los
   * nueve cuando ocho tienen carga sería trabajo que nadie mira.
   */
  private async evidenciaDe(
    formulario: FormularioDeJornada,
    tieneOperativos: boolean,
  ): Promise<FilaEvidencia | null> {
    if (tieneOperativos) return null;

    const estado = await this.ventanas.obtenerEstado(formulario.rolDueno);
    const ventana = {
      activo: estado.activo,
      abierta: estado.abierta,
      horaCierre: estado.horaCierre,
    };

    if (!correspondeEvidencia(false, ventana)) return null;

    return componerEvidencia(responsableDe(formulario), ventana);
  }
}

/**
 * Qué acceso tienen los roles del usuario sobre ese formulario, según `t_formulario_rol`.
 *
 * Se calcula sobre la UNIÓN de sus roles (2026-09-14), igual que P-01 y P-02 (que leen y
 * escriben con `usuario.roles`): un usuario con varios roles tiene, en cada formulario, el
 * acceso MÁS FUERTE de todos ellos —`ESCRITURA` gana a `APORTA`, y cualquiera a `LECTURA`—.
 * Antes se usaba un solo rol (`usuario.rol`, el primero que estrecha `RolesGuard`), y quien
 * tenía varios veía «No se publica» en los formularios que escriben sus OTROS roles.
 *
 * Sin ninguna fila para esos roles, `LECTURA`: es el caso de los formularios que el usuario no
 * toca, y de la Dirección/DAF «puras». La tabla es la única fuente; no se deduce del `rolDueno`.
 */
function accesoDe(
  formulario: FormularioDeJornada,
  roles: readonly RolDepartamental[],
): AccesoSeccion {
  const participaciones = formulario.roles.filter((fila) =>
    roles.includes(fila.rol),
  );

  if (participaciones.length === 0) return 'LECTURA';

  return participaciones.some((fila) => fila.acceso === 'ESCRITURA')
    ? 'ESCRITURA'
    : 'APORTA';
}

/**
 * Si ese rol asigna personal a ese formulario **desde esta pantalla**.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SIN FILA, NO. Es el mismo criterio que `accesoDe`, y por el mismo motivo: la tabla es
 * la única fuente. Quien no participa en el formulario no lo edita por ningún camino.
 *
 * Y CON FILA, LO QUE DIGA LA COLUMNA. No se deduce del acceso: un rol con ESCRITURA tiene
 * P-01 y P-02 para lo suyo, y que además pueda hacerlo aquí es una decisión del negocio
 * —la del DMIT, tomada al construir P-13— y no una consecuencia de tener autoridad.
 *
 * NO APARECE NINGÚN ROL EN ESTA FUNCIÓN, y es el punto. La instrucción que la originó
 * nombraba uno; escribirlo aquí habría creado la segunda fuente de verdad sobre permisos
 * que este módulo lleva evitando desde el 2026-08-25.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function puedeEditarPersonalDesdeLaJornada(
  formulario: FormularioDeJornada,
  roles: readonly RolDepartamental[],
): boolean {
  // Con varios roles, basta con que ALGUNO tenga el camino concedido (unión, 2026-09-14).
  return formulario.roles.some(
    (fila) => roles.includes(fila.rol) && fila.editaDesdeJornada,
  );
}

/**
 * De qué áreas se espera personal de quien consulta, en este formulario.
 *
 * Son las mismas que `reglaCupoCompartido` le admitiría al asignar, y por eso se derivan
 * del mismo dato —`t_formulario_area`— y no de una lista aparte:
 *
 * | Acceso | Áreas |
 * |---|---|
 * | `ESCRITURA` | todas las que el formulario admite: registra el operativo entero |
 * | `APORTA` | solo las marcadas `esCompartida`. Es literalmente lo que ese rol puede asignar |
 * | `LECTURA` | ninguna. No participa, y no se le pide nada |
 *
 * **Si un formulario de aporte no tiene ninguna área compartida, aquí sale vacío y es
 * correcto que salga vacío**: ese rol no podría asignar a nadie —el servidor rechazaría
 * cada intento con «participa con personal de: ninguna área»—, y anunciarle trabajo
 * pendiente sería mandarlo a una puerta cerrada.
 */
function areasQueLeTocanAlRol(
  formulario: FormularioDeJornada,
  acceso: AccesoSeccion,
): AreaPersonal[] {
  if (acceso === 'LECTURA') return [];

  return formulario.areas
    .filter((fila) => acceso === 'ESCRITURA' || fila.esCompartida)
    .map((fila) => fila.area);
}

/**
 * Quién responde por esta sección.
 *
 * Pueden ser varios desde el 2026-08-25: la patrulla ECU la registran dos departamentos.
 * Se enumeran los que **escriben** y detrás los que **aportan personal**; el responsable
 * declarado va primero aunque el orden alfabético diga otra cosa.
 */
function responsableDe(formulario: FormularioDeJornada): string {
  const escriben = formulario.roles
    .filter((fila) => fila.acceso === 'ESCRITURA')
    .map((fila) => fila.rol)
    .sort((uno, otro) =>
      uno === formulario.rolDueno ? -1 : otro === formulario.rolDueno ? 1 : 0,
    );

  const aportan = formulario.roles
    .filter((fila) => fila.acceso === 'APORTA')
    .map((fila) => fila.rol);

  return [...escriben, ...aportan].map(nombreDeDireccion).join(' + ');
}

/** Agrupa en memoria lo que ya se trajo: sin una consulta por formulario. */
function agruparPorFormulario(
  operativos: OperativoDeJornada[],
): Map<number, OperativoDeJornada[]> {
  const porFormulario = new Map<number, OperativoDeJornada[]>();

  for (const operativo of operativos) {
    const suyos = porFormulario.get(operativo.formularioId) ?? [];
    suyos.push(operativo);
    porFormulario.set(operativo.formularioId, suyos);
  }

  return porFormulario;
}

/**
 * Cuántas alertas hay en la jornada.
 *
 * Se cuentan las guardadas, no se recalculan: `oper_alertas` es la proyección que M-15
 * mantiene coherente, y volver a derivarlas aquí daría un segundo cálculo que podría
 * discrepar del que ve el departamento en su propia pantalla.
 */
function contarAlertas(operativos: OperativoDeJornada[]): number {
  return operativos.reduce((suma, operativo) => {
    const alertas = (operativo.alertas as unknown as Alerta[] | null) ?? [];
    return suma + alertas.length;
  }, 0);
}

function comoFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
