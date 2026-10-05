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
  type RolDepartamental,
  type VentanaCarga,
} from '@prisma/client';

import { VentanaCargaEvaluador } from '../../../common/auth/application/ventana-carga.evaluador';
import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { comoHoraInstitucional } from '../../../common/utilidades/hora';
import {
  VentanasRepository,
  type CambiosVentana,
} from '../infrastructure/ventanas.repository';
import { ParametroPoliticaService } from './parametro-politica.service';
import {
  advertenciasDe,
  motivoDeRechazo,
  type VentanaPropuesta,
} from './reglas-ventana';

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
  evaluadoEn: Date;
}

/** Resultado de administrar una ventana, con lo que conviene revisar. */
export interface VentanaActualizada {
  ventana: VentanaCarga;
  advertencias: string[];
}

@Injectable()
export class VentanaCargaService {
  /** Caché de rol a ventana. Se descarta entera ante cualquier modificación. */
  private cache: Map<RolDepartamental, VentanaCarga> | null = null;

  constructor(
    private readonly repositorio: VentanasRepository,
    private readonly evaluador: VentanaCargaEvaluador,
    private readonly parametros: ParametroPoliticaService,
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
    const ventana = (await this.cargarCache()).get(rol) ?? null;
    const veredicto = this.evaluador.evaluar(ventana, momento);

    return {
      rol,
      abierta: veredicto.puedeEscribir,
      activo: ventana?.activo ?? false,
      zonaHoraria: ventana?.zonaHoraria ?? 'America/Guayaquil',
      horaApertura: ventana?.horaApertura ?? null,
      horaCierre: ventana?.horaCierre ?? null,
      diaApertura: ventana?.diaApertura ?? null,
      diaCierre: ventana?.diaCierre ?? null,
      mensaje: this.mensajeDeEstado(ventana, veredicto.puedeEscribir),
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

    const advertencias = await this.advertencias(propuesta);

    if (traza.length === 0) {
      return { ventana: actual, advertencias };
    }

    const ventana = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const guardada = await this.repositorio.actualizar(
          rol,
          cambios,
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
    return { ventana, advertencias };
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
    return {
      rol: actual.rol,
      tipo: cambios.tipo ?? actual.tipo,
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
      activo: cambios.activo ?? actual.activo,
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

  /**
   * Reúne el contexto de las advertencias.
   *
   * Los parámetros se leen con `obtenerTexto`, que lanza si la clave no está
   * configurada. Aquí ESO NO DEBE IMPEDIR guardar la ventana: la advertencia es una
   * ayuda, no un requisito, así que su ausencia se traduce en una advertencia menos.
   */
  private async advertencias(propuesta: VentanaPropuesta): Promise<string[]> {
    const otras = (await this.repositorio.listar()).filter(
      (ventana) => ventana.rol !== propuesta.rol,
    );

    return advertenciasDe(propuesta, {
      otras,
      limiteCuadro: await this.parametroOpcional('HORA_LIMITE_CUADRO'),
    });
  }

  private async parametroOpcional(clave: string): Promise<string | undefined> {
    try {
      return await this.parametros.obtenerTexto(clave);
    } catch {
      return undefined;
    }
  }

  private mensajeDeEstado(
    ventana: VentanaCarga | null,
    abierta: boolean,
  ): string {
    if (!ventana || !ventana.activo) {
      return 'Su rol no tiene restricción horaria para escribir en el cuadro.';
    }

    if (!abierta) return ventana.mensajeCierre;

    if (ventana.horaCierre) {
      return `La ventana de carga está abierta hasta las ${comoHoraInstitucional(ventana.horaCierre)}.`;
    }
    return 'La ventana de carga está abierta.';
  }
}
