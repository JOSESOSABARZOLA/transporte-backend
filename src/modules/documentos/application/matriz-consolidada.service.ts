/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Matriz consolidada
 * Archivo: matriz-consolidada.service.ts
 * Responsabilidad: Componer la matriz del día y entregarla exportada.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES EL ENTREGABLE QUE ORIGINÓ EL ENCARGO, Y TAMBIÉN EL QUE MÁS SE RESTRINGE.
 *
 * El cuadro completo circulaba por WhatsApp y los intervenidos se anticipaban al
 * operativo. PER-02 y RN-48: **la matriz no se sirve a perfiles departamentales**. Cada
 * uno ve lo suyo en P-02; la vista consolidada es de la Dirección.
 *
 * Por eso el control de rol está en la ruta —`@Roles(DIRECTOR)`— y no hay ningún filtro
 * «por si acaso» dentro del servicio: quien llega aquí ya pasó por la guarda, y duplicar
 * la comprobación con otro criterio sería crear una segunda verdad sobre quién puede ver
 * el cuadro entero.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * TRES CONSULTAS PARA TODA LA MATRIZ (caso 7 del plan): el cuadro, los formularios y los
 * operativos con sus relaciones. El resto —agrupar, contar alertas, decidir la fila de
 * evidencia— ocurre en memoria sobre lo ya traído.
 *
 * Las ventanas se consultan aparte, desde la caché de M-08, y solo para los formularios
 * que resultaron vacíos.
 */

import { Injectable } from '@nestjs/common';
import { EstadoCuadro, type CuadroDiario } from '@prisma/client';

import { LoggerService } from '../../../common/logger/logger.service';
import { VentanaCargaService } from '../../configuracion/application/ventana-carga.service';
import { CapacidadFlotaService } from '../../transporte/application/capacidad-flota.service';
import { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import type { Alerta } from '../../operativos/application/politicas/alertas-operativo';
import {
  MatrizRepository,
  type FormularioDeMatriz,
  type OperativoDeMatriz,
} from '../infrastructure/matriz.repository';
import { exportarMatriz } from './exportador-matriz';
import {
  componerEvidencia,
  correspondeEvidencia,
  enLenguajeNatural,
  nombreDeDireccion,
  type FilaEvidencia,
} from './reglas-matriz';

/** Una sección de la matriz: un formulario con sus filas o su evidencia. */
export interface SeccionMatriz {
  formulario: FormularioDeMatriz;
  responsable: string;
  operativos: OperativoDeMatriz[];
  /** RN-53. Presente solo si el formulario quedó vacío y su ventana venció. */
  evidencia: FilaEvidencia | null;
}

/** La matriz completa, tal como la pinta P-04 y la imprime el PDF. */
export interface MatrizCompuesta {
  cuadro: CuadroDiario;
  fechaNatural: string;
  secciones: SeccionMatriz[];
  totales: {
    operativos: number;
    alertas: number;
    formulariosSinCarga: number;
  };
  /** Indicador de flota de M-18. Puede faltar si la DAF no declaró. */
  flota: {
    declarados: number;
    requeridos: number;
    hayAdvertencia: boolean;
  } | null;
}

@Injectable()
export class MatrizConsolidadaService {
  constructor(
    private readonly repositorio: MatrizRepository,
    private readonly cuadros: CuadroDiarioService,
    private readonly ventanas: VentanaCargaService,
    private readonly capacidad: CapacidadFlotaService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Compone la matriz de la jornada.
   *
   * Exige que el cuadro exista: la matriz **de un día que nadie abrió** no es una matriz
   * vacía, es una fecha equivocada, y confundirlas ocultaría el error.
   */
  async componer(fecha: Date): Promise<MatrizCompuesta> {
    const inicio = Date.now();
    const cuadro = await this.cuadros.obtenerPorFecha(fecha);

    const [formularios, operativos, flota] = await Promise.all([
      this.repositorio.listarFormularios(),
      this.repositorio.listarOperativos(fecha),
      this.capacidad.verificarDemanda(fecha),
    ]);

    const porFormulario = agruparPorFormulario(operativos);
    const secciones: SeccionMatriz[] = [];

    for (const formulario of formularios) {
      const suyos = porFormulario.get(formulario.id) ?? [];

      secciones.push({
        formulario,
        responsable: this.responsableDe(formulario),
        operativos: suyos,
        evidencia: await this.evidenciaDe(formulario, suyos.length > 0),
      });
    }

    const matriz: MatrizCompuesta = {
      cuadro,
      fechaNatural: enLenguajeNatural(cuadro.fecha),
      secciones,
      totales: {
        operativos: operativos.length,
        alertas: contarAlertas(operativos),
        formulariosSinCarga: secciones.filter(
          (seccion) => seccion.evidencia !== null,
        ).length,
      },
      flota: flota.veredicto
        ? {
            declarados: flota.veredicto.vehiculos.declarados,
            requeridos: flota.veredicto.vehiculos.requeridos,
            hayAdvertencia: flota.veredicto.hayAdvertencia,
          }
        : null,
    };

    // Caso 9 del plan: la matriz de un día completo se compone en menos de tres
    // segundos. Se registra el tiempo real para que la regresión se note en el registro
    // antes de que alguien la reporte.
    this.logger.log('Matriz consolidada compuesta', {
      fecha: comoFecha(fecha),
      operativos: matriz.totales.operativos,
      formulariosSinCarga: matriz.totales.formulariosSinCarga,
      duracionMs: Date.now() - inicio,
    });

    return matriz;
  }

  /**
   * RN-47. El documento formal de la jornada.
   *
   * Horizontal, con los banners de color de cada formulario y el bloque de firmas. **Sin
   * ningún control de interfaz**: no es una captura de la pantalla, es el documento que
   * se archiva y se firma.
   */
  async exportar(fecha: Date): Promise<{ contenido: Buffer; nombre: string }> {
    const matriz = await this.componer(fecha);
    const contenido = await exportarMatriz(matriz);

    this.logger.log('Matriz consolidada exportada', {
      fecha: comoFecha(fecha),
      ordenTrabajo: matriz.cuadro.ordenTrabajo,
      bytes: contenido.byteLength,
    });

    return {
      contenido,
      nombre: `matriz-${comoFecha(fecha)}.pdf`,
    };
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  /**
   * RN-53. Decide si al formulario vacío le corresponde fila de evidencia.
   *
   * Se pregunta a M-08 **solo por los formularios vacíos**: consultar la ventana de los
   * nueve cuando ocho tienen carga sería trabajo que nadie mira.
   */
  private async evidenciaDe(
    formulario: FormularioDeMatriz,
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

    return componerEvidencia(this.responsableDe(formulario), ventana);
  }

  /**
   * Quién responde por esta sección. La cabecera de FASE5 los nombra.
   *
   * DESDE EL 2026-08-25 PUEDEN SER VARIOS, y no solo «el dueño más el invitado»: la
   * patrulla ECU la registran dos departamentos. Se enumeran los que **escriben** y a
   * continuación los que **aportan personal**, que es el orden en que responden por lo
   * que hay en la sección.
   *
   * El responsable declarado va primero aunque el orden alfabético diga otra cosa: es el
   * departamento al que la Dirección le reclama la sección entera.
   */
  private responsableDe(formulario: FormularioDeMatriz): string {
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
}

/** Agrupa en memoria lo que ya se trajo: sin una consulta por formulario. */
function agruparPorFormulario(
  operativos: OperativoDeMatriz[],
): Map<number, OperativoDeMatriz[]> {
  const porFormulario = new Map<number, OperativoDeMatriz[]>();

  for (const operativo of operativos) {
    const suyos = porFormulario.get(operativo.formularioId) ?? [];
    suyos.push(operativo);
    porFormulario.set(operativo.formularioId, suyos);
  }

  return porFormulario;
}

/**
 * Cuántas alertas hay en la jornada. Es el segundo distintivo de la cabecera de P-04.
 *
 * Se cuentan las alertas guardadas, no se recalculan: `oper_alertas` es la proyección que
 * M-15 mantiene coherente ante cualquier cambio, y volver a derivarlas aquí daría un
 * segundo cálculo que podría discrepar del que muestra la pantalla de registro.
 */
function contarAlertas(operativos: OperativoDeMatriz[]): number {
  return operativos.reduce((suma, operativo) => {
    const alertas = (operativo.alertas as unknown as Alerta[] | null) ?? [];
    return suma + alertas.length;
  }, 0);
}

function comoFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Estados en los que el cuadro todavía admite cambios. Lo usa el pie del documento. */
export function admiteCambios(estado: EstadoCuadro): boolean {
  return estado !== EstadoCuadro.CERRADO;
}
