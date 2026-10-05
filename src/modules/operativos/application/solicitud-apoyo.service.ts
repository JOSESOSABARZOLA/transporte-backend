/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Solicitud de apoyo interdirección
 * Archivo: solicitud-apoyo.service.ts
 * Responsabilidad: Registrar y consultar las solicitudes de apoyo entre direcciones.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * CU-13. Un operativo conjunto necesita personal de otra dirección. Hoy eso se pide por
 * teléfono y no queda constancia de quién lo pidió, a quién ni para qué.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SE REGISTRA Y SE NOTIFICA. NO SE ACEPTA NI SE RECHAZA (PV-12).
 *
 * `e_estado_solicitud` declara cuatro estados —SOLICITADA, ATENDIDA, RECHAZADA,
 * VENCIDA— y **ninguna fuente define quién los mueve, cuándo ni con qué consecuencia**.
 * FASE2 §CU-13 lo marca como pendiente de validación con el usuario.
 *
 * Por eso aquí solo se crea en `SOLICITADA`. Implementar las transiciones exigiría
 * inventar el flujo, y un flujo inventado en una herramienta de coordinación entre
 * direcciones es peor que no tenerlo: la gente seguiría llamando por teléfono, pero
 * ahora con un sistema que además dice otra cosa.
 *
 * La dirección requerida ve la solicitud en su bandeja y responde asignando personal al
 * operativo con los endpoints de M-15, que es el paso 4 del flujo principal de CU-13.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  EstadoSolicitud,
  RolDepartamental,
  type AreaPersonal,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import {
  SolicitudApoyoRepository,
  type SolicitudConOperativo,
} from '../infrastructure/solicitud-apoyo.repository';
import { OperativosService, type Autor } from './operativos.service';

/** Lo que llega del DTO, ya validado en forma. */
export interface DatosSolicitudApoyo {
  rolRequerido: RolDepartamental;
  areaRequerida?: AreaPersonal;
  cantidad: number;
  observacion?: string;
}

export interface CriteriosBandeja {
  fecha?: Date;
  estado?: EstadoSolicitud;
}

/**
 * Direcciones a las que se puede pedir personal.
 *
 * Son las tres que cargan operativos, y es lo que dice la matriz de permisos de FASE2
 * §14: la solicitud de apoyo es suya. Las otras tres no tienen personal operativo que
 * prestar —la DAF asigna transporte, la Dirección supervisa y la administración
 * configura—, así que una solicitud dirigida a ellas no tendría destinatario capaz de
 * atenderla.
 */
const DIRECCIONES_CON_PERSONAL: RolDepartamental[] = [
  RolDepartamental.DMIP_OPERATIVOS,
  RolDepartamental.DMIP_INSPECCIONES,
  RolDepartamental.DMIT_INSTRUCTOR,
];

/** Roles que ven todas las solicitudes, no solo las suyas. */
const VEN_TODAS: RolDepartamental[] = [
  RolDepartamental.DIRECTOR,
  RolDepartamental.ADMINISTRADOR_DMIP,
];

@Injectable()
export class SolicitudApoyoService {
  constructor(
    private readonly repositorio: SolicitudApoyoRepository,
    private readonly operativos: OperativosService,
    private readonly cuadros: CuadroDiarioService,
    private readonly auditoria: AuditoriaService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * RF-019. Registra la solicitud y notifica a la dirección requerida.
   *
   * El operativo tiene que ser **del rol que solicita**: pedir apoyo forma parte de
   * construir el operativo, y construirlo es del dueño del formulario. El rol compartido
   * participa con cupo de personal, no decide qué apoyo hace falta.
   */
  async solicitar(
    operativoId: number,
    datos: DatosSolicitudApoyo,
    autor: Autor,
  ): Promise<SolicitudConOperativo> {
    const operativo = await this.operativos.exigirOperativoPropio(
      operativoId,
      autor,
    );
    await this.cuadros.exigirEscritura(operativo.cuadro.fecha);

    this.exigirDireccionValida(datos.rolRequerido, autor.rol);

    const porGuardar = {
      operativoId,
      rolSolicitante: autor.rol,
      rolRequerido: datos.rolRequerido,
      areaRequerida: datos.areaRequerida ?? null,
      cantidad: datos.cantidad,
      observacion: datos.observacion?.trim() || null,
    };

    const repetida =
      await this.repositorio.buscarEquivalenteAbierta(porGuardar);
    if (repetida) {
      throw new ValidacionError(
        `Ya hay una solicitud de apoyo abierta a ${enPalabras(datos.rolRequerido)} para el operativo ${operativo.identificador}.`,
        { solicitudId: repetida.id },
      );
    }

    const solicitud = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const creada = await this.repositorio.crear(porGuardar, cliente);

        await this.auditoria.registrar(
          {
            entidad: 't_solicitud_apoyo',
            entidadId: creada.id,
            operativoId,
            accion: AccionAuditoria.CREAR,
            usuario: autor.usuarioId,
            rol: autor.rol,
          },
          cliente,
        );

        return creada;
      },
    );

    // NOT-01 · evento `ApoyoInterdireccionSolicitado`, después de confirmar. El CANAL de
    // la notificación sigue sin definirse —FASE2 §18 lo marca como pendiente—, así que
    // por ahora queda en el registro de actividad y en la bandeja de la dirección
    // requerida, que es lo que sí se puede consultar sin inventar un canal.
    this.logger.log('Apoyo interdirección solicitado', {
      identificador: operativo.identificador,
      rolSolicitante: autor.rol,
      rolRequerido: datos.rolRequerido,
      cantidad: datos.cantidad,
    });

    return solicitud;
  }

  /** Las solicitudes de un operativo. Para la pantalla de registro (P-01, M-22). */
  async listarDeOperativo(
    operativoId: number,
    autor: Autor,
  ): Promise<SolicitudConOperativo[]> {
    // Reutiliza la visibilidad de M-14: quien no puede ver el operativo tampoco ve para
    // qué se pidió apoyo en él. La dirección requerida lo ve en su bandeja.
    await this.operativos.obtener(operativoId, autor);

    return this.repositorio.listarDeOperativo(operativoId);
  }

  /**
   * Caso 4 del plan. La bandeja del rol: lo que le piden y lo que pidió.
   *
   * La dirección requerida **no puede ver el operativo ajeno** —es de otro formulario, y
   * PER-02 lo impide—, así que la solicitud tiene que llegarle por aquí. La respuesta
   * incluye el identificador, el horario y el formulario, que es lo que necesita para
   * decidir a quién manda.
   */
  async consultarBandeja(
    criterios: CriteriosBandeja,
    autor: Autor,
  ): Promise<SolicitudConOperativo[]> {
    return this.repositorio.listar({
      fecha: criterios.fecha,
      estado: criterios.estado,
      rol: VEN_TODAS.includes(autor.rol) ? null : autor.rol,
    });
  }

  /**
   * El rol requerido tiene que ser otra dirección con personal operativo.
   *
   * Pedirse apoyo a uno mismo no describe nada: si el personal es propio, se asigna. Es
   * el caso 3 del plan.
   */
  private exigirDireccionValida(
    requerido: RolDepartamental,
    solicitante: RolDepartamental,
  ): void {
    if (requerido === solicitante) {
      throw new ValidacionError(
        'La solicitud de apoyo se dirige a otra dirección. Si el personal es de su propio departamento, asígnelo directamente al operativo.',
        { rolRequerido: requerido },
      );
    }

    if (!DIRECCIONES_CON_PERSONAL.includes(requerido)) {
      throw new ValidacionError(
        `${enPalabras(requerido)} no aporta personal a los operativos. El apoyo se solicita a ${DIRECCIONES_CON_PERSONAL.map(enPalabras).join(', ')}.`,
        { rolRequerido: requerido },
      );
    }
  }
}

/**
 * Nombre legible de la dirección, para los mensajes.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NO SE UNIFICÓ CON `common/roles/catalogo-roles`, Y NO ES UN OLVIDO. 2026-09-01.
 *
 * Ese día se retiró la copia que había en `reglas-matriz.ts` porque **era** una copia: los
 * dos mapas decían lo mismo con las mismas palabras. Éste no. Aquél da un **rótulo** —«DMIP
 * · Unidad de Operativos», para una celda—; éste da una **frase** que va dentro de otra:
 *
 *   «La DAF no aporta personal a los operativos. El apoyo se solicita a la Unidad de
 *    Operativos de la DMIP, la Unidad de Inspecciones…»
 *
 * Con los rótulos del catálogo esa frase quedaría «se solicita a DMIP · Unidad de
 * Operativos», que se lee como una etiqueta pegada en mitad de un mensaje. Unificar dos
 * cosas que **no son la misma** por parecerse es cómo se degradan los textos que este
 * proyecto escribe para el funcionario, no para el desarrollador.
 *
 * Está tipado `Record<RolDepartamental, string>`, así que el compilador lo protege de
 * quedarse atrás: fue lo que obligó a completarlo cuando el enumerado creció.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function enPalabras(rol: RolDepartamental): string {
  const nombres: Record<RolDepartamental, string> = {
    DMIP_OPERATIVOS: 'la Unidad de Operativos de la DMIP',
    DMIP_INSPECCIONES: 'la Unidad de Inspecciones de la DMIP',
    DMIT_INSTRUCTOR: 'la Unidad de Instrucción de la DMIT',
    DAF: 'la DAF',
    DIRECTOR: 'la Dirección',
    ADMINISTRADOR: 'la administración del sistema',
    // No es una dirección y NUNCA llega hasta aquí: una solicitud de apoyo se dirige a
    // una unidad que puede aportar personal, y `rolRequerido` solo admite las tres
    // departamentales. Está porque el tipo exige el mapa completo, y esa exigencia es
    // deseable: al agregar FUNCIONARIO al enumerado, el compilador señaló este sitio
    // en lugar de dejar que un `undefined` apareciera dentro de un mensaje.
    FUNCIONARIO: 'el funcionario',
    // Los tres del 2026-09-01. Tampoco llegan aquí, por lo mismo que `FUNCIONARIO`: una
    // solicitud de apoyo se dirige a quien aporta personal, y administrar no es aportar.
    // El compilador volvió a señalar este sitio al ampliar el enumerado, que es
    // exactamente para lo que sirve tener el mapa completo.
    ADMINISTRADOR_DMIP: 'la administración de la DMIP',
    ADMINISTRADOR_DMIT: 'la administración de la DMIT',
    ADMINISTRADOR_DAF: 'la administración de la DAF',
  };

  return nombres[rol];
}
