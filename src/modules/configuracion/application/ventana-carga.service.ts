/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: ventana-carga.service.ts
 * Responsabilidad: Publicar el estado de la ventana de cada rol y gobernar su cambio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * RN-56 y RN-59. Reutiliza `VentanaCargaEvaluador` —la política POL-05 de M-05— en
 * lugar de reimplementar la aritmética horaria. Esa clase se expuso como inyectable
 * precisamente para esto: el cruce de medianoche y la evaluación en zona horaria son
 * demasiado delicados para tener dos versiones.
 *
 * LA GUARDA NO USA ESTE SERVICIO, Y ES DELIBERADO. `VentanaCargaGuard` sigue leyendo
 * la base en cada escritura, por dos motivos:
 *
 *   · `common/auth` no puede depender de un submódulo de negocio. Invertir esa flecha
 *     haría que la cadena de autorización dependiera de `configuracion`.
 *   · Para la guarda, la frescura vale más que la velocidad. Una caché desfasada
 *     mantendría abierta una ventana que el administrador acaba de cerrar, que es
 *     exactamente lo contrario de lo que la guarda existe para impedir.
 *
 * La caché de este servicio sirve a la CONSULTA del estado —la pantalla la pide cada
 * vez que se dibuja la cabecera— y se invalida en cuanto se modifica una ventana.
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  TipoVentana,
  type RolDepartamental,
  type VentanaCarga,
} from '@prisma/client';

import {
  horarioDeVentana,
  mensajeParaFuncionario,
  minutosDelDia,
} from '../../../common/auth/application/horario-ventana';
import { resolverMensajeVentana } from '../../../common/auth/application/mensaje-ventana';
import { VentanaCargaEvaluador } from '../../../common/auth/application/ventana-carga.evaluador';
import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { comoHoraInstitucional } from '../../../common/utilidades/hora';
import { horaEnZona } from '../../../common/utilidades/marca-tiempo';
import {
  VentanasRepository,
  type CambiosVentana,
} from '../infrastructure/ventanas.repository';
import { motivoDeRechazo, type VentanaPropuesta } from './reglas-ventana';

/** Lo que la interfaz necesita saber para decidir si deja escribir y qué mostrar. */
export interface EstadoVentana {
  rol: RolDepartamental;
  abierta: boolean;
  activo: boolean;
  zonaHoraria: string;
  horaApertura: string | null;
  horaCierre: string | null;
  diaApertura: number | null;
  diaCierre: number | null;
  /** Redactado para el funcionario: por qué está cerrada o hasta cuándo abierta. */
  mensaje: string;
  /**
   * El horario en UNA frase, calculado de las horas reales (2026-10-06): lo que la pantalla muestra
   * como horario. Nunca el texto libre del administrador.
   */
  horarioTexto: string;
  /** Solo la DAF: «cuando cierra el registro de operativos» si abre justo entonces (RN-56). */
  motivoApertura: string | null;
  /** El texto libre de «Ventanas y parámetros», como nota secundaria (no es el horario). */
  notaAdministrador: string | null;
  evaluadoEn: Date;
}

/** Resultado de administrar una ventana: la ventana tal como quedó guardada. */
export interface VentanaActualizada {
  ventana: VentanaCarga;
}

@Injectable()
export class VentanaCargaService {
  /** Caché de rol a ventana. Se descarta entera ante cualquier modificación. */
  private cache: Map<RolDepartamental, VentanaCarga> | null = null;

  constructor(
    private readonly repositorio: VentanasRepository,
    private readonly evaluador: VentanaCargaEvaluador,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─────────────────────────── Consulta ───────────────────────────

  /**
   * Estado de la ventana de un rol en un momento dado.
   *
   * `momento` es un parámetro y no `new Date()` fijo para que las pruebas puedan
   * situarse a las 14H00 o a las 15H30 sin manipular el reloj del sistema, que es la
   * clase de prueba que falla sola dos veces al año.
   */
  async obtenerEstado(
    rol: RolDepartamental,
    momento: Date = new Date(),
  ): Promise<EstadoVentana> {
    const cache = await this.cargarCache();
    const ventana = cache.get(rol) ?? null;
    const veredicto = this.evaluador.evaluar(ventana, momento);
    const todas = [...cache.values()];
    const horario = horarioDeVentana(ventana, todas);

    return {
      rol,
      abierta: veredicto.puedeEscribir,
      activo: ventana?.activo ?? false,
      zonaHoraria: ventana?.zonaHoraria ?? 'America/Guayaquil',
      horaApertura: ventana?.horaApertura ?? null,
      horaCierre: ventana?.horaCierre ?? null,
      diaApertura: ventana?.diaApertura ?? null,
      diaCierre: ventana?.diaCierre ?? null,
      mensaje: this.mensajeDeEstado(
        ventana,
        veredicto.puedeEscribir,
        todas,
        momento,
        veredicto.finDeSemana ?? false,
      ),
      horarioTexto: horario.texto,
      motivoApertura: horario.motivoApertura,
      notaAdministrador:
        ventana && ventana.activo
          ? resolverMensajeVentana(
              ventana.mensajeCierre,
              ventana.horaApertura,
              ventana.horaCierre,
            )
          : null,
      evaluadoEn: momento,
    };
  }

  /**
   * Si el rol puede escribir ahora. Lo consumirá `cuadro-diario` (M-13) para decidir
   * si el cuadro admite cambios, sin repetir la evaluación.
   */
  async puedeEscribir(
    rol: RolDepartamental,
    momento: Date = new Date(),
  ): Promise<boolean> {
    const ventana = (await this.cargarCache()).get(rol) ?? null;
    return this.evaluador.evaluar(ventana, momento).puedeEscribir;
  }

  /** Las seis ventanas, para la pantalla de administración. */
  async listar(): Promise<VentanaCarga[]> {
    return this.repositorio.listar();
  }

  async obtener(rol: RolDepartamental): Promise<VentanaCarga> {
    const ventana = await this.repositorio.buscarPorRol(rol);
    if (!ventana) {
      throw new RecursoNoEncontradoError(
        `No hay una ventana de carga configurada para el rol ${rol}.`,
        { rol },
      );
    }
    return ventana;
  }

  // ─────────────────────────── Modificación ───────────────────────────

  /**
   * Cambia la ventana de un rol.
   *
   * Es el caso 5 del plan: cambiar la hora de cierre modifica el comportamiento del
   * sistema **sin desplegar código**. Por eso la escritura va acompañada de auditoría
   * dentro de la misma transacción (DA-09): un cambio que altera quién puede escribir
   * y hasta cuándo tiene que dejar rastro de quién lo hizo.
   *
   * SOLO SE VALIDA LA PROPIA VENTANA (2026-10-08): forma de horas y días, cierre posterior a la
   * apertura y mensaje (`motivoDeRechazo`). La pantalla solo parametriza; la coherencia entre
   * ventanas la aplica el sistema en ejecución (`VentanaCargaGuard` y el flujo del cuadro), no al
   * guardar. Por eso aquí no se lee ninguna otra ventana ni `HORA_LIMITE_CUADRO`: el rechazo RN-56
   * del 2026-10-06 y las advertencias RN-56/RN-57 se retiraron de este flujo.
   */
  async actualizar(
    rol: RolDepartamental,
    cambios: CambiosVentana,
    usuarioId: number,
  ): Promise<VentanaActualizada> {
    const actual = await this.obtener(rol);
    const propuesta = this.componer(actual, cambios);

    const motivo = motivoDeRechazo(propuesta);
    if (motivo) {
      throw new ValidacionError(motivo, { rol, cambios });
    }

    const traza = this.auditoria.compararCambios(
      this.comoColumnas(actual),
      this.comoColumnas(propuesta),
    );

    if (traza.length === 0) {
      return { ventana: actual };
    }

    const ventana = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        // El tipo y `activo` viajan SIEMPRE ya derivados (2026-10-07): `activo` es
        // `tipo <> SIN_RESTRICCION`, y nunca se escribe uno sin el otro.
        const guardada = await this.repositorio.actualizar(
          rol,
          { ...cambios, tipo: propuesta.tipo, activo: propuesta.activo },
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_ventana_carga',
            entidadId: actual.id,
            accion: AccionAuditoria.ACTUALIZAR,
            cambios: traza,
            usuario: usuarioId,
          },
          cliente,
        );

        return guardada;
      },
    );

    this.invalidarCache();
    return { ventana };
  }

  /** Descarta la caché. La siguiente consulta vuelve a la base. */
  invalidarCache(): void {
    this.cache = null;
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  private async cargarCache(): Promise<Map<RolDepartamental, VentanaCarga>> {
    if (this.cache) return this.cache;

    const ventanas = await this.repositorio.listar();
    this.cache = new Map(ventanas.map((ventana) => [ventana.rol, ventana]));
    return this.cache;
  }

  /** Combina lo guardado con lo que llega, para validar el resultado y no el fragmento. */
  private componer(
    actual: VentanaCarga,
    cambios: CambiosVentana,
  ): VentanaPropuesta {
    const tipo = tipoResultante(actual, cambios);
    return {
      rol: actual.rol,
      tipo,
      diaApertura:
        cambios.diaApertura === undefined
          ? actual.diaApertura
          : cambios.diaApertura,
      horaApertura:
        cambios.horaApertura === undefined
          ? actual.horaApertura
          : cambios.horaApertura,
      diaCierre:
        cambios.diaCierre === undefined ? actual.diaCierre : cambios.diaCierre,
      horaCierre:
        cambios.horaCierre === undefined
          ? actual.horaCierre
          : cambios.horaCierre,
      mensajeCierre: cambios.mensajeCierre ?? actual.mensajeCierre,
      activo: tipo !== TipoVentana.SIN_RESTRICCION,
    };
  }

  /** La traza nombra columnas, no propiedades del modelo. */
  private comoColumnas(
    ventana: VentanaPropuesta | VentanaCarga,
  ): Record<string, unknown> {
    return {
      vcar_tipo: ventana.tipo,
      vcar_dia_apertura: ventana.diaApertura,
      vcar_hora_apertura: ventana.horaApertura,
      vcar_dia_cierre: ventana.diaCierre,
      vcar_hora_cierre: ventana.horaCierre,
      vcar_mensaje_cierre: ventana.mensajeCierre,
      vcar_activo: ventana.activo,
    };
  }

  private mensajeDeEstado(
    ventana: VentanaCarga | null,
    abierta: boolean,
    todas: VentanaCarga[],
    momento: Date,
    finDeSemana: boolean,
  ): string {
    if (!ventana || !ventana.activo) {
      return 'Su rol no tiene restricción horaria para escribir en el cuadro.';
    }

    // Cerrada: el mensaje del administrador con sus marcadores resueltos, o el calculado de las
    // horas reales si no hay mensaje o el mensaje dice una hora que no es (2026-10-07). Es la
    // misma función que usa el 423 de la guarda.
    if (!abierta) {
      return mensajeParaFuncionario(
        ventana,
        todas,
        minutosDelDia(horaEnZona(momento, ventana.zonaHoraria)),
        finDeSemana,
      );
    }

    if (ventana.horaCierre) {
      return `La ventana de carga está abierta hasta las ${comoHoraInstitucional(ventana.horaCierre)}.`;
    }
    return 'La ventana de carga está abierta.';
  }
}

/**
 * El tipo que queda tras el cambio (2026-10-07). Lo normal es que llegue `tipo`. Por compatibilidad
 * con clientes anteriores se admite aún `activo`: `false` equivale a SIN_RESTRICCION, y `true`
 * sobre una ventana sin restricción la vuelve DIARIA.
 */
function tipoResultante(
  actual: VentanaCarga,
  cambios: CambiosVentana,
): TipoVentana {
  if (cambios.tipo !== undefined) return cambios.tipo;
  if (cambios.activo === false) return TipoVentana.SIN_RESTRICCION;
  if (cambios.activo === true && actual.tipo === TipoVentana.SIN_RESTRICCION) {
    return TipoVentana.DIARIO;
  }
  // Una ventana DESACTIVADA de antes de esta fecha (tipo DIARIO, activo = false) es, en el modelo
  // nuevo, «sin restricción»: tocar otro campo no debe volverla a activar.
  if (cambios.activo === undefined && !actual.activo) {
    return TipoVentana.SIN_RESTRICCION;
  }
  return actual.tipo;
}
