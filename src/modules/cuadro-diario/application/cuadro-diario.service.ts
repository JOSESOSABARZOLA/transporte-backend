/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Cuadro diario
 * Archivo: cuadro-diario.service.ts
 * Responsabilidad: Gobernar el ciclo de vida de la jornada.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ES EL RELOJ DEL SISTEMA. Todo lo demás pregunta aquí si todavía se puede escribir.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * CÓMO AVANZA EL ESTADO, QUE ES LA DECISIÓN DE DISEÑO DEL MÓDULO.
 *
 * INV-03 exige pasar por los cuatro estados en orden, y CU-10 dice que el Director
 * cierra cuando **«las ventanas de carga y de transporte han vencido»**. Esas dos
 * frases juntas describen un estado que no lo mueve nadie a mano: lo mueve el reloj.
 *
 * Por eso `sincronizarConVentanas()` lleva el estado guardado hasta donde dicen las
 * ventanas de M-08, **un escalón a la vez**, y el cierre exige llegar a `APROBADO`.
 * Así el sistema no necesita un planificador —que sería una dependencia nueva— ni un
 * endpoint de «avanzar» que el plan no contempla, y el Director no puede cerrar un
 * cuadro que la DAF todavía está completando.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * LOS EVENTOS SE EMITEN DESPUÉS DE CONFIRMAR LA TRANSACCIÓN, nunca dentro (regla 6 de
 * CLAUDE.md). Mientras no haya bus —incorporarlo sería una dependencia nueva—, el
 * único consumidor es la proyección de M-11, que se invoca directamente al terminar.
 * Si el cierre se confirmó y la consolidación falla, el cuadro queda cerrado y el
 * historial se puede rehacer: `consolidarJornada` es idempotente. Al revés no: meter
 * la consolidación dentro de la transacción del cierre haría que un fallo en una
 * proyección derivada impidiera cerrar la jornada.
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  EstadoCuadro,
  RolDepartamental,
  type CuadroDiario,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import { LoggerService } from '../../../common/logger/logger.service';
import { marcaDeTiempo } from '../../../common/utilidades/marca-tiempo';
import { VentanaCargaService } from '../../configuracion/application/ventana-carga.service';
import { HistorialJornadaService } from '../../talento-operativo/application/historial-jornada.service';
import {
  admiteEscritura,
  DESCRIPCION_ESTADO,
  ESTADO_TRAS_REAPERTURA,
  puedeAvanzarA,
  puedeReabrirse,
  siguienteEstado,
} from '../domain/estado-cuadro';
import { semanaIso } from '../domain/semana-iso';
import { CuadroDiarioRepository } from '../infrastructure/cuadro-diario.repository';

/** Roles cuya ventana marca el fin de la carga departamental. */
const ROLES_DEPARTAMENTALES: RolDepartamental[] = [
  RolDepartamental.DMIP_OPERATIVOS,
  RolDepartamental.DMIP_INSPECCIONES,
  RolDepartamental.DMIT_INSTRUCTOR,
];

@Injectable()
export class CuadroDiarioService {
  constructor(
    private readonly repositorio: CuadroDiarioRepository,
    private readonly ventanas: VentanaCargaService,
    private readonly historial: HistorialJornadaService,
    private readonly auditoria: AuditoriaService,
    private readonly logger: LoggerService,
  ) {}

  // ─────────────────────────── Consulta ───────────────────────────

  async obtenerPorFecha(fecha: Date): Promise<CuadroDiario> {
    const cuadro = await this.repositorio.buscarPorFecha(fecha);

    if (!cuadro) {
      throw new RecursoNoEncontradoError(
        `No hay un cuadro abierto para el ${comoFecha(fecha)}.`,
        { fecha: comoFecha(fecha) },
      );
    }
    return cuadro;
  }

  /**
   * RN-58. Si la jornada admite modificaciones.
   *
   * Lo consultará `operativos` (M-14) antes de cada escritura. Un cuadro inexistente
   * **no admite escritura**: no se puede registrar en una jornada que nadie abrió.
   */
  async puedeEscribir(fecha: Date): Promise<boolean> {
    const cuadro = await this.repositorio.buscarPorFecha(fecha);
    return cuadro ? admiteEscritura(cuadro.estado) : false;
  }

  /**
   * Igual que el anterior, pero lanza con el motivo. Es lo que M-14 usará para que el
   * funcionario lea por qué no puede guardar.
   */
  async exigirEscritura(fecha: Date): Promise<CuadroDiario> {
    return this.exigirQueAdmitaEscritura(await this.obtenerPorFecha(fecha));
  }

  /**
   * La jornada de esa fecha, **abriéndola si todavía no existe**.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * REGLA DEL 2026-08-11 · LA JORNADA SE ABRE SOLA AL REGISTRAR EL PRIMER OPERATIVO.
   *
   * Hasta esta fecha la apertura era un acto explícito del `ADMINISTRADOR`, y sin ella
   * los tres departamentos no podían registrar nada. Esa precondición no venía del
   * negocio: `FASE2` §5.3 declara «Cuadro creado» como precondición de PROC-02 y
   * «Apertura del cuadro del día siguiente» como su disparador, pero **no define ningún
   * proceso ni actor que la ejecute**. Era un requisito sin dueño, y en la práctica
   * dejaba a la jornada entera esperando a que alguien se acordara.
   *
   * DECISIÓN DE DESARROLLO, PENDIENTE DE CONFIRMACIÓN DEL PRODUCT OWNER. Se anota como
   * tal a propósito: este proyecto distingue lo acordado de lo supuesto, y mientras
   * nadie del negocio la ratifique, esta regla es lo segundo.
   *
   * POR QUÉ AQUÍ Y NO EN LA PANTALLA. Este es el único punto por el que pasa todo
   * registro, venga de P-01 o de una petición directa. Hacerlo en el cliente obligaría
   * a abrir `POST /cuadros` a los tres roles departamentales, y la jornada nacería por
   * el mero hecho de abrir la pantalla.
   *
   * NO HACE FALTA ACOTAR LA HORA. `VentanaCargaGuard` corta antes de llegar hasta aquí,
   * así que una jornada solo puede nacer dentro de una ventana de carga abierta. El
   * estado inicial `BORRADOR` es por tanto el correcto por construcción.
   *
   * LO ÚNICO QUE SE PROHÍBE ES EL PASADO. Una jornada de ayer no se arma: los operativos
   * ya ocurrieron o no ocurrieron, y abrirla solo produciría una matriz que nadie pidió.
   * La apertura manual del administrador se conserva para todo lo demás.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async asegurarParaRegistro(
    fecha: Date,
    usuarioId: number,
  ): Promise<CuadroDiario> {
    const existente = await this.repositorio.buscarPorFecha(fecha);
    if (existente) return this.exigirQueAdmitaEscritura(existente);

    const dia = comoFecha(fecha);
    // La fecha de calendario de HOY en Quito, no en la zona del proceso. Se comparan
    // cadenas `AAAA-MM-DD`, donde el orden alfabético es el cronológico.
    const hoy = marcaDeTiempo().slice(0, 10);

    if (dia < hoy) {
      throw new ValidacionError(
        `La jornada del ${dia} ya pasó y no puede abrirse. El cuadro se arma para el día siguiente.`,
        { fecha: dia, hoy },
      );
    }

    return this.abrir(fecha, usuarioId);
  }

  /** RN-58, sobre un cuadro que ya se tiene: evita volver a consultarlo. */
  private exigirQueAdmitaEscritura(cuadro: CuadroDiario): CuadroDiario {
    if (!admiteEscritura(cuadro.estado)) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.CUADRO_CERRADO,
        `El cuadro del ${comoFecha(cuadro.fecha)} fue cerrado por la Dirección y no admite modificaciones.`,
        { fecha: comoFecha(cuadro.fecha), estado: cuadro.estado },
      );
    }

    return cuadro;
  }

  // ─────────────────────────── Apertura ───────────────────────────

  /**
   * RN-05. Un solo cuadro por fecha.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * PV-28 RESUELTO EL 2026-08-07 · LA ORDEN DE TRABAJO LA GENERA EL SISTEMA.
   *
   * Hasta esa fecha llegaba como dato de entrada, porque ninguna fuente definía su
   * formato y componerlo por nuestra cuenta habría puesto un código inventado en la
   * matriz. El Product Owner lo resolvió: **`AMC-AAAA-MM-DD`**, y su único uso es
   * exponer el día en la matriz consolidada.
   *
   * Al ser un dato de presentación derivado de la fecha, generarlo es lo correcto por el
   * mismo motivo que el identificador del operativo: **escribir a mano un código que ya
   * está determinado solo agrega la posibilidad de equivocarse**.
   *
   * Ya no se comprueba que la orden esté repetida, y no es un descuido: se deriva de la
   * fecha, y la fecha es única. Dos jornadas distintas no pueden producir el mismo
   * código, y la misma jornada la detiene la comprobación de arriba.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async abrir(fecha: Date, usuarioId: number): Promise<CuadroDiario> {
    const existente = await this.repositorio.buscarPorFecha(fecha);
    if (existente) {
      throw new ValidacionError(
        `Ya existe un cuadro para el ${comoFecha(fecha)}, con la orden de trabajo ${existente.ordenTrabajo}.`,
        { fecha: comoFecha(fecha), ordenTrabajo: existente.ordenTrabajo },
      );
    }

    const orden = componerOrdenTrabajo(fecha);

    // RN-06. La semana se deriva de la fecha; lo que venga del cliente se descarta
    // porque el contrato de entrada no lo contempla.
    const semana = semanaIso(fecha);

    const cuadro = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const creado = await this.repositorio.crear(
          {
            fecha,
            ordenTrabajo: orden,
            nroSemana: semana.numero,
            anioSemana: semana.anio,
          },
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_cuadro_diario',
            entidadId: creado.id,
            accion: AccionAuditoria.CREAR,
            usuario: usuarioId,
          },
          cliente,
        );

        return creado;
      },
    );

    // Evento `CuadroDiarioAbierto`, después de confirmar. Sin consumidores todavía.
    this.logger.log('Cuadro diario abierto', {
      fecha: comoFecha(fecha),
      ordenTrabajo: orden,
      semana: `${semana.numero}/${semana.anio}`,
    });

    return cuadro;
  }

  // ─────────────────────────── Avance ───────────────────────────

  /**
   * Lleva el estado guardado hasta donde dicen las ventanas de carga.
   *
   * Avanza de uno en uno, respetando INV-03, y **nunca retrocede**: si la ventana
   * departamental sigue abierta el cuadro se queda en borrador, y si ya cerró pasa a
   * transporte. Un cuadro cerrado no se toca.
   */
  async sincronizarConVentanas(
    fecha: Date,
    momento: Date = new Date(),
  ): Promise<CuadroDiario> {
    let cuadro = await this.obtenerPorFecha(fecha);
    if (cuadro.estado === EstadoCuadro.CERRADO) return cuadro;

    const departamentalRetiene = await this.algunaVentanaRetiene(
      ROLES_DEPARTAMENTALES,
      momento,
    );
    const transporteRetiene = await this.ventanaRetiene(
      RolDepartamental.DAF,
      momento,
    );

    const destino = departamentalRetiene
      ? EstadoCuadro.BORRADOR
      : transporteRetiene
        ? EstadoCuadro.EN_TRANSPORTE
        : EstadoCuadro.APROBADO;

    while (cuadro.estado !== destino && siguienteEstado(cuadro.estado)) {
      const siguiente = siguienteEstado(cuadro.estado) as EstadoCuadro;
      if (siguiente === EstadoCuadro.CERRADO) break;

      cuadro = await this.avanzar(fecha, siguiente);
    }

    return cuadro;
  }

  /**
   * Avanza un escalón. Publicado para que M-17 pueda adelantar el estado cuando la DAF
   * termina antes de que venza su ventana.
   */
  async avanzar(fecha: Date, destino: EstadoCuadro): Promise<CuadroDiario> {
    const cuadro = await this.obtenerPorFecha(fecha);

    if (!puedeAvanzarA(cuadro.estado, destino)) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.CUADRO_CERRADO,
        `El cuadro está ${DESCRIPCION_ESTADO[cuadro.estado]} y no puede pasar directamente a ${DESCRIPCION_ESTADO[destino]}.`,
        { desde: cuadro.estado, hacia: destino },
      );
    }

    return this.repositorio.ejecutarEnTransaccion((cliente) =>
      this.repositorio.actualizarEstado(fecha, { estado: destino }, cliente),
    );
  }

  // ─────────────────────────── Cierre ───────────────────────────

  /**
   * CU-10. La Dirección congela la jornada.
   *
   * Cuatro comprobaciones antes de escribir nada: que las ventanas hayan vencido, que el
   * cuadro no estuviera ya cerrado, que **ningún operativo con condicionante nocturno
   * siga sin conductor** (INV-11) y que **ninguna patrulla compartida se quede sin el
   * personal que aporta el otro departamento** (desde el 2026-08-25).
   *
   * Las dos últimas son de la misma clase y por eso van juntas: exigen al cerrar algo
   * que **llega después del registro** —el conductor lo pone la DAF, el aporte lo pone
   * el departamento compartido—, así que comprobarlas al escribir rechazaría lo normal.
   */
  async cerrar(fecha: Date, usuarioId: number): Promise<CuadroDiario> {
    const cuadro = await this.sincronizarConVentanas(fecha);

    if (cuadro.estado === EstadoCuadro.CERRADO) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.CUADRO_CERRADO,
        `El cuadro del ${comoFecha(fecha)} ya fue cerrado.`,
        { fecha: comoFecha(fecha) },
      );
    }

    if (cuadro.estado !== EstadoCuadro.APROBADO) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.CUADRO_CERRADO,
        `El cuadro todavía está ${DESCRIPCION_ESTADO[cuadro.estado]}. No se puede cerrar mientras la ventana correspondiente siga abierta.`,
        { estado: cuadro.estado },
      );
    }

    await this.exigirCondicionanteResuelto(fecha);
    await this.exigirAporteCompartido(fecha);

    const cerrado = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const actualizado = await this.repositorio.actualizarEstado(
          fecha,
          {
            estado: EstadoCuadro.CERRADO,
            cerradoPor: usuarioId,
            cerradoEn: new Date(),
          },
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_cuadro_diario',
            entidadId: cuadro.id,
            accion: AccionAuditoria.CERRAR,
            cambios: [
              {
                campo: 'cuad_estado',
                valorAnterior: cuadro.estado,
                valorNuevo: EstadoCuadro.CERRADO,
              },
            ],
            usuario: usuarioId,
          },
          cliente,
        );

        return actualizado;
      },
    );

    // Evento `CuadroCerrado`, DESPUÉS de confirmar. Su consumidor es la proyección de
    // historial, que alimenta las reglas de descanso del día siguiente.
    await this.historial.consolidarJornada(fecha);

    this.logger.log('Cuadro diario cerrado', {
      fecha: comoFecha(fecha),
      operativos: await this.repositorio.contarOperativos(fecha),
    });

    return cerrado;
  }

  /**
   * PV-11. La reapertura es un endpoint con verificación de rol, **sin flujo de
   * autorización adicional**: las fuentes no definen quién la autoriza más allá de la
   * Dirección. El contador de reaperturas queda como evidencia de cuántas veces se hizo.
   */
  async reabrir(fecha: Date, usuarioId: number): Promise<CuadroDiario> {
    const cuadro = await this.obtenerPorFecha(fecha);

    if (!puedeReabrirse(cuadro.estado)) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.CUADRO_CERRADO,
        `El cuadro del ${comoFecha(fecha)} no está cerrado: está ${DESCRIPCION_ESTADO[cuadro.estado]}.`,
        { estado: cuadro.estado },
      );
    }

    const reabierto = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const actualizado = await this.repositorio.actualizarEstado(
          fecha,
          {
            estado: ESTADO_TRAS_REAPERTURA,
            cerradoPor: null,
            cerradoEn: null,
            reaperturas: cuadro.reaperturas + 1,
          },
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_cuadro_diario',
            entidadId: cuadro.id,
            accion: AccionAuditoria.REABRIR,
            cambios: [
              {
                campo: 'cuad_estado',
                valorAnterior: EstadoCuadro.CERRADO,
                valorNuevo: ESTADO_TRAS_REAPERTURA,
              },
            ],
            usuario: usuarioId,
          },
          cliente,
        );

        return actualizado;
      },
    );

    this.logger.warn('Cuadro diario reabierto', {
      fecha: comoFecha(fecha),
      reaperturas: reabierto.reaperturas,
    });

    return reabierto;
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  /**
   * INV-11. Ningún operativo con condicionante nocturno puede seguir con transporte
   * pendiente al cerrar.
   *
   * PV-05: la verificación se hace **al cerrar y no al registrar**, porque el conductor
   * lo asigna la DAF después. Registrar el operativo nocturno sin conductor es normal;
   * cerrar la jornada dejándolo así, no.
   */
  private async exigirCondicionanteResuelto(fecha: Date): Promise<void> {
    const pendientes =
      await this.repositorio.operativosConCondicionantePendiente(fecha);

    if (pendientes.length === 0) return;

    const listado = pendientes
      .map(
        (operativo) =>
          `${operativo.identificador} (${operativo.horaInicio} a ${operativo.horaFin})`,
      )
      .join(', ');

    throw new ReglaNegocioError(
      CODIGOS_ERROR.CONDICIONANTE_NOCTURNO,
      `No se puede cerrar el cuadro: ${pendientes.length} operativo${pendientes.length === 1 ? '' : 's'} con horario nocturno sigue${pendientes.length === 1 ? '' : 'n'} sin conductor asignado. ${listado}.`,
      { operativos: pendientes.map((operativo) => operativo.identificador) },
    );
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * EL MÍNIMO DEL CUPO COMPARTIDO. 2026-08-25, por decisión del negocio.
   *
   * En la patrulla ECU el DMIT aporta **de una a dos** personas de Instrucción. El
   * máximo lo aplica `composicion-personal.ts` en cada asignación; el mínimo **no puede
   * aplicarse ahí**, y no es una comodidad: rechazaría siempre a la primera persona, que
   * por definición deja la composición incompleta. Es el mismo razonamiento que dejó
   * RN-31 y RN-32 sin bloquear, escrito en PV-29.
   *
   * ASÍ QUE SE COMPRUEBA AL CERRAR, junto a INV-11 y por el motivo que ya declaraba
   * PV-05: lo que llega después del registro se exige cuando la jornada se congela, no
   * cuando se escribe.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * ESTO PUEDE DEJAR UNA JORNADA SIN PODER CERRARSE, Y HAY QUE SABERLO.
   *
   * Si no queda nadie del área que aporta —de baja, ausente, o ya asignado a otro
   * operativo que se cruza—, el cierre se queda bloqueado y **no hay excepción**. Es la
   * consecuencia de convertir el mínimo en un bloqueo, que es lo que el negocio pidió.
   * Por eso el mensaje nombra el operativo, el formulario y el departamento: lo tiene
   * que resolver alguien, y la Dirección no puede hacerlo por su cuenta.
   *
   * La salida, si un día hiciera falta, es de datos y no de código: retirar el rol
   * compartido del formulario lo saca de esta comprobación.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  private async exigirAporteCompartido(fecha: Date): Promise<void> {
    const pendientes =
      await this.repositorio.operativosSinAporteCompartido(fecha);

    if (pendientes.length === 0) return;

    const listado = pendientes
      .map(
        (operativo) =>
          `${operativo.identificador} (${operativo.formularioNombre}, falta ${operativo.rolCompartido})`,
      )
      .join(', ');

    const uno = pendientes.length === 1;

    throw new ReglaNegocioError(
      CODIGOS_ERROR.APORTE_COMPARTIDO_PENDIENTE,
      `No se puede cerrar el cuadro: ${pendientes.length} operativo${uno ? '' : 's'} de formulario compartido sigue${uno ? '' : 'n'} sin el personal que aporta el otro departamento. ${listado}.`,
      { operativos: pendientes.map((operativo) => operativo.identificador) },
    );
  }

  /**
   * Si la ventana de un rol todavía retiene el cuadro en su estado actual.
   *
   * NO ES LO MISMO QUE «PUEDE ESCRIBIR». Una ventana desactivada deja escribir siempre
   * —así lo define M-08: sin restricción horaria—, pero no puede retener la jornada:
   * si lo hiciera, desactivar la ventana de la DAF dejaría el cuadro atrapado antes de
   * `APROBADO` y la Dirección no podría cerrarlo nunca. Solo una ventana **activa y
   * dentro de su horario** significa «todavía están cargando».
   */
  private async ventanaRetiene(
    rol: RolDepartamental,
    momento: Date,
  ): Promise<boolean> {
    const estado = await this.ventanas.obtenerEstado(rol, momento);
    return estado.activo && estado.abierta;
  }

  private async algunaVentanaRetiene(
    roles: RolDepartamental[],
    momento: Date,
  ): Promise<boolean> {
    const estados = await Promise.all(
      roles.map((rol) => this.ventanaRetiene(rol, momento)),
    );
    return estados.some(Boolean);
  }
}

function comoFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * PV-28. La orden de trabajo de la jornada: `AMC-AAAA-MM-DD`.
 *
 * Se compone sobre `comoFecha`, que lee la fecha **en UTC**, igual que el resto del
 * sistema. `cuad_fecha` es `@db.Date` —una fecha de calendario— y leerla con los
 * captadores locales imprimiría el día anterior en Quito, que está en UTC−5. El código
 * encabeza la matriz consolidada, así que un desfase de un día se vería en el documento
 * que firma la Dirección.
 */
function componerOrdenTrabajo(fecha: Date): string {
  return `AMC-${comoFecha(fecha)}`;
}
