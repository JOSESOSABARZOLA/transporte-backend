/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Manejo de errores
 * Archivo: codigos-error.ts
 * Responsabilidad: Declarar los códigos de error del módulo y su estado HTTP.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * El código va dirigido al desarrollador y permite al frontend reaccionar de forma
 * diferenciada sin interpretar cadenas de texto. El mensaje va dirigido al
 * funcionario. Ver docs/IMPLEMENTATION_GUIDE.md §11.3.
 */

/** Los códigos de error del módulo, con la regla que los origina. */
export const CODIGOS_ERROR = {
  /** RN-56 · El rol intenta escribir fuera de su ventana de carga. */
  VENTANA_CARGA_CERRADA: 'VENTANA_CARGA_CERRADA',
  /** PER-01 · El formulario no pertenece al rol que escribe. */
  FORMULARIO_NO_AUTORIZADO: 'FORMULARIO_NO_AUTORIZADO',
  /** PER-05 · El rol no figura entre los autorizados para el endpoint. */
  ROL_NO_AUTORIZADO: 'ROL_NO_AUTORIZADO',
  /** RBAC · El perfil no tiene el permiso atómico que el endpoint exige. */
  PERMISO_INSUFICIENTE: 'PERMISO_INSUFICIENTE',
  /** RN-38 · La DAF envió campos distintos de conductor y vehículo. */
  CAMPOS_NO_PERMITIDOS: 'CAMPOS_NO_PERMITIDOS',
  /** RN-30 · La persona registra una ausencia vigente. */
  PERSONA_NO_DISPONIBLE: 'PERSONA_NO_DISPONIBLE',
  /** La persona tiene turno DESCANSO ese día en la cobertura de Instrucción. */
  PERSONA_EN_DESCANSO: 'PERSONA_EN_DESCANSO',
  /** El horario del operativo no cae dentro de la ventana del turno (diurno/nocturno). */
  TURNO_FUERA_DE_RANGO: 'TURNO_FUERA_DE_RANGO',
  /** RN-26 y RN-33 · Personal de nombramiento en turno nocturno o de fin de semana. */
  CONTRATO_NO_ADMITE_TURNO: 'CONTRATO_NO_ADMITE_TURNO',
  /** RN-24 · Salió en patrulla el día anterior. */
  PATRULLA_CONSECUTIVA: 'PATRULLA_CONSECUTIVA',
  /** RN-25 · Alcanzó el tope de salidas nocturnas o de fin de semana. */
  TOPE_SALIDAS_PESADAS: 'TOPE_SALIDAS_PESADAS',
  /** RN-28 · La persona ya figura en otro operativo con horario cruzado. */
  SOLAPAMIENTO_HORARIO: 'SOLAPAMIENTO_HORARIO',
  /** RN-36 · La suma de asignaciones supera la jornada máxima del día. */
  JORNADA_MAXIMA_SUPERADA: 'JORNADA_MAXIMA_SUPERADA',
  /** PER-06 · El rol compartido excede su cupo en el formulario. */
  CUPO_COMPARTIDO_SUPERADO: 'CUPO_COMPARTIDO_SUPERADO',
  /**
   * RN-15 y VAL-10 · La persona pertenece a un área que el formulario no admite.
   *
   * Decimosexto código, agregado en M-15. El plan exige responder `409` con la lista de
   * áreas admitidas, y ninguno de los quince anteriores describe ese rechazo:
   * `CUPO_COMPARTIDO_SUPERADO` habla del cupo del rol compartido, que es otra cosa, y
   * reutilizarlo obligaría al frontend a distinguir dos situaciones por el texto.
   */
  AREA_NO_ADMITIDA: 'AREA_NO_ADMITIDA',
  /** RN-44 · El conductor condujo en patrulla el día anterior. */
  CONDUCTOR_PATRULLA_CONSECUTIVA: 'CONDUCTOR_PATRULLA_CONSECUTIVA',
  /** RN-43 · Horario en franja nocturna sin conductor asignado. */
  CONDICIONANTE_NOCTURNO: 'CONDICIONANTE_NOCTURNO',
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * 2026-08-25 · UNA PATRULLA COMPARTIDA SE CIERRA SIN EL APORTE DEL DEPARTAMENTO QUE
   * DEBÍA PONERLO.
   *
   * Va SEPARADO de `CUPO_COMPARTIDO_SUPERADO`, que es su espejo y su contrario: aquél
   * dice «ya puso demasiados» y se corrige quitando a alguien; éste dice «no puso
   * ninguno» y se corrige añadiéndolo. Fundirlos obligaría a la pantalla a distinguir
   * dos situaciones opuestas leyendo el texto, que es justo lo que los códigos evitan.
   *
   * Y va separado de `CONDICIONANTE_NOCTURNO` aunque los dos frenen el mismo cierre:
   * aquél lo resuelve la DAF asignando un conductor; éste, el departamento que aporta
   * personal. Son dos personas distintas a las que avisar.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  APORTE_COMPARTIDO_PENDIENTE: 'APORTE_COMPARTIDO_PENDIENTE',
  /** RN-58 · El cuadro fue cerrado por la Dirección. */
  CUADRO_CERRADO: 'CUADRO_CERRADO',
  /**
   * 2026-08-20 · Se intenta colgar un adicional de otro adicional.
   *
   * Códigos DIECIOCHO y DIECINUEVE, y van separados aunque los dos nazcan del mismo
   * vínculo. La pantalla reacciona distinto a cada uno: éste se corrige eligiendo el
   * operativo original de la jornada, y el siguiente, retirando antes el adicional.
   * Fundirlos obligaría al frontend a distinguirlos por el texto, que es justo lo que
   * los códigos existen para evitar.
   */
  ADICIONAL_NO_ENCADENABLE: 'ADICIONAL_NO_ENCADENABLE',
  /** 2026-08-20 · Se intenta retirar un operativo del que cuelgan adicionales vigentes. */
  OPERATIVO_CON_ADICIONALES: 'OPERATIVO_CON_ADICIONALES',
  /**
   * 2026-08-21 · Auth central no respondió, o respondió algo que no se puede usar.
   *
   * Código VEINTE, y el primero que **no habla del negocio sino de una dependencia**. Va
   * con 503: lo que falló no es este módulo. La pantalla lo necesita separado para decir
   * que el maestro de personal se sigue administrando igual, que es verdad y que no lo
   * sería con cualquier otro rechazo.
   */
  AUTH_NO_DISPONIBLE: 'AUTH_NO_DISPONIBLE',
  /** Bloqueo optimista · la versión del operativo está desactualizada. */
  CONFLICTO_CONCURRENCIA: 'CONFLICTO_CONCURRENCIA',
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * 2026-08-28 · LA MISMA PLACA EN DOS OPERATIVOS QUE SE CRUZAN.
   *
   * Código VEINTIUNO. Va SEPARADO de `SOLAPAMIENTO_HORARIO`, que es su gemelo y no su
   * igual: aquél dice que una PERSONA no puede estar en dos sitios, y se corrige
   * cambiando de conductor; éste dice que un ACTIVO no puede, y se corrige cambiando de
   * placa. Son dos desplegables distintos de la misma pantalla, y fundirlos obligaría a
   * la DAF a leer el texto para saber cuál de los dos tiene que tocar.
   *
   * RN-DAF-01, del levantamiento con Planificación de Transporte del 2026-08-28.
   * Pendiente de numeración definitiva en FASE2 §8: se cita con el identificador del
   * análisis para que el origen no se pierda mientras tanto.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  VEHICULO_OCUPADO: 'VEHICULO_OCUPADO',
  /**
   * 502 · El servicio externo de firma digital (.p12) no respondió o falló al firmar el
   * memorando. Solo se emite cuando la firma está CONFIGURADA (variables FIRMA_*): sin
   * configurar, el memorando se entrega sin firmar y no hay error. Ver `firma-digital.client.ts`.
   */
  SERVICIO_FIRMA_NO_DISPONIBLE: 'SERVICIO_FIRMA_NO_DISPONIBLE',

  /**
   * 409 · Se intentó ELIMINAR (baja física) un valor de catálogo que ya se usó en operativos
   * anteriores, o una zonal que aún tiene puntos. No se borra para conservar el historial
   * (INV-22); en su lugar se desactiva. Ver `catalogos.service.ts`.
   */
  CATALOGO_EN_USO: 'CATALOGO_EN_USO',
  /**
   * 409 · Ya existe ese valor de catálogo —zonal, punto en su zonal, tipo, sigla o denominación—
   * (2026-10-12; antes era un 400). La comparación ignora tildes, mayúsculas y espacios.
   */
  CATALOGO_DUPLICADO: 'CATALOGO_DUPLICADO',
  /**
   * 409 · Ya existe un formulario con ese número o código, o su prefijo ya lo usa otro
   * formulario (2026-10-13; antes número y código eran un 400). Ver `politicas/formulario-admin.ts`.
   */
  FORMULARIO_DUPLICADO: 'FORMULARIO_DUPLICADO',
  /**
   * Transporte por tramos (2026-10-06): el conductor no puede tomar el bloque —se pisa, no llega
   * por el traslado, nombramiento fuera de horario, jornada máxima, libre sin activar, asientos o
   * vehículo en taller—. Ver `asignacion-conductor.policy.ts`.
   */
  ASIGNACION_NO_VIABLE: 'ASIGNACION_NO_VIABLE',
  /**
   * 409 · Ya existe un registro con ese nombre (2026-10-06): garajes/ubicaciones de flota. La
   * comparación ignora tildes, mayúsculas y espacios sobrantes.
   */
  NOMBRE_DUPLICADO: 'NOMBRE_DUPLICADO',
  /** Turnos de conductores · el reporte solo se emite de un mes publicado (2026-10-07). */
  MES_NO_PUBLICADO: 'MES_NO_PUBLICADO',
  /**
   * Trámites de Inspección (2026-10-07) · el sistema de Inspección no respondió, rechazó el token
   * de la sesión o no está configurado. En la CONSULTA no se lanza (es un estado de la respuesta);
   * al GUARDAR un trámite sí, porque sin Inspección no se puede comprobar que sea de esa persona.
   */
  INSPECCION_NO_DISPONIBLE: 'INSPECCION_NO_DISPONIBLE',
  /**
   * Trámites de Inspección (2026-10-07) · el trámite elegido no figura entre los asignados a esa
   * persona en la fecha de la jornada, o la persona no es inspector.
   */
  TRAMITE_INSPECCION_NO_VALIDO: 'TRAMITE_INSPECCION_NO_VALIDO',
  /**
   * Transporte requerido (2026-10-07) · se cambió el tipo de transporte de un operativo que ya
   * tiene conductor o tramos asignados. El registro debe CONFIRMAR que se libera la asignación
   * (`confirmarLiberacion`); la DAF lo ve después como «Transporte liberado».
   */
  CAMBIO_TIPO_CON_TRANSPORTE: 'CAMBIO_TIPO_CON_TRANSPORTE',
  /**
   * Ocupación por tramos (2026-10-14) · se cambió el HORARIO o la ZONAL de un operativo que ya
   * tiene tramos asignados: los tramos ya no corresponden y la asignación se libera. Mismo flujo
   * que el anterior (`confirmarLiberacion`). `CAMBIO_TIPO_CON_TRANSPORTE` se conserva cuando
   * solo cambia el tipo, para que la pantalla que ya lo conoce no se rompa.
   */
  CAMBIO_CON_TRANSPORTE: 'CAMBIO_CON_TRANSPORTE',
  /**
   * Macrooperativo (2026-10-07) · se intentó compartir el vehículo con un operativo que pide
   * vehículo exclusivo. Motivo: «Operativo con vehículo exclusivo».
   */
  COMPARTIR_CON_EXCLUSIVO: 'COMPARTIR_CON_EXCLUSIVO',
  /**
   * Compartir unidad (2026-10-19) · el operativo con el que se pide viajar no coincide en día,
   * punto, horario o traslado. El mensaje dice qué falla («No piden el mismo traslado…»).
   */
  COMPARTIR_NO_COMPATIBLE: 'COMPARTIR_NO_COMPATIBLE',
  /**
   * Rediseño de P-07 (2026-10-08) · La cédula ya tiene ficha en el maestro. 409: la petición
   * es correcta, lo que choca es el estado (la ficha existe, quizá dada de baja y reactivable).
   * Antes era un 400 de validación y el frontend no podía llevar el error al campo cédula.
   */
  CEDULA_CON_FICHA: 'CEDULA_CON_FICHA',
  /** INV-14 · La ausencia se cruza con otra ya registrada de la misma persona. */
  AUSENCIA_SOLAPADA: 'AUSENCIA_SOLAPADA',
  /** Una ausencia que ya terminó es historia: no se quita (rediseño de P-07, B7). */
  AUSENCIA_PASADA: 'AUSENCIA_PASADA',
  /**
   * Alta desde Auth central cuya cédula Auth no devuelve (o sin correo): el correo
   * institucional lo pone Auth y no el navegador, así que sin ella no se puede completar.
   */
  PERSONA_NO_ENCONTRADA_EN_AUTH: 'PERSONA_NO_ENCONTRADA_EN_AUTH',
  /**
   * 409 · Flota y garajes (2026-10-14) · se intentó dar de baja un vehículo o un conductor que
   * tiene transporte asignado desde hoy en adelante (tramos de operativos vigentes). Primero hay
   * que liberar esa asignación en «Planificar el día».
   */
  RECURSO_CON_ASIGNACION: 'RECURSO_CON_ASIGNACION',
} as const;

export type CodigoError = (typeof CODIGOS_ERROR)[keyof typeof CODIGOS_ERROR];

/** Código genérico de los fallos no controlados. */
export const CODIGO_ERROR_INTERNO = 'ERROR_INTERNO';

/** Código de la petición sin identidad resuelta. Es el 401 de la cadena. */
export const CODIGO_NO_AUTENTICADO = 'NO_AUTENTICADO';

/**
 * Código del 401 de la sesión con Auth central.
 *
 * NO SIGUE LA NOMENCLATURA DEL MÓDULO, y es deliberado: lo fija
 * `INTEGRACION_AUTH_CENTRALIZADO_BACKENDS.md`, que es contrato compartido entre todos
 * los módulos del ecosistema. Un código propio obligaría a cada frontend a distinguir
 * un caso que en todos los demás módulos se llama igual.
 *
 * El sobre que lo envuelve SÍ es el del módulo —`statusCode`, `codigo`, `mensaje`,
 * `correlacionId`—, no el `{success, error}` de la guía. Ver PLAN_INTEGRACION_AUTH.md
 * §4.2: es una desviación consciente, pendiente de confirmar en la etapa 1.
 */
export const CODIGO_SESION_NO_VALIDA = 'APP-UNAUTHORIZED-001';

/** Código de los datos con forma incorrecta que no encajan en ningún otro. */
export const CODIGO_VALIDACION = 'VALIDACION';

/** Código del recurso inexistente. */
export const CODIGO_NO_ENCONTRADO = 'RECURSO_NO_ENCONTRADO';
