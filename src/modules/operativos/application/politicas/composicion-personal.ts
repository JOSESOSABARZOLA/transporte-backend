/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de personal y alertas
 * Archivo: composicion-personal.ts
 * Responsabilidad: Decidir si un rol puede asignar a una persona a un operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * VAL-10, VAL-18, INV-09, INV-10 y PER-06. Es la parte de la asignación que **no**
 * depende del descanso: quién compone el operativo, no si la persona puede salir.
 *
 * ESA SEPARACIÓN ES DELIBERADA. Las reglas de descanso viven en `talento-operativo` y
 * llegan como veredicto (regla 1 de CLAUDE.md). Aquí se decide lo que sí es de este
 * submódulo: si el área está admitida por el formulario, si la persona ya figura y si el
 * rol compartido cabe en su cupo.
 *
 * ES UNA FUNCIÓN PURA. Recibe la definición del formulario, la persona y las
 * asignaciones que ya existen. No consulta la base ni conoce NestJS.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PER-06 · EL CUPO NO PUEDE VERIFICARSE EN UNA GUARDA, y el plan lo dice.
 *
 * Depende del área de la persona y de cuántas lleva asignadas el rol en ESE operativo:
 * son dos datos que la petición no trae y que una guarda tendría que ir a buscar. Va en
 * la capa de aplicación.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { AreaPersonal, RolDepartamental } from '@prisma/client';

import {
  CODIGOS_ERROR,
  type CodigoError,
} from '../../../../common/errors/codigos-error';

/** Área admitida por el formulario, con su marca de compartida. */
export interface AreaAdmitida {
  area: AreaPersonal;
  /** `farea_es_compartida`: el rol compartido solo puede asignar estas. PER-06. */
  esCompartida: boolean;
}

/** Participación de un departamento en el formulario. `t_formulario_rol`. */
export interface RolParticipante {
  rol: RolDepartamental;
  acceso: 'ESCRITURA' | 'APORTA';
  /** Máximo de personas que puede asignar. Solo en `APORTA`. */
  cupo: number | null;
}

/** Definición del formulario, en lo que toca a la composición. */
export interface FormularioParaComposicion {
  nombre: string;
  rolDueno: RolDepartamental;
  /**
   * ERA `rolCompartido` Y `cupoCompartido` hasta el 2026-08-25, dos campos que solo
   * daban para un invitado. Ahora son las filas de `t_formulario_rol`: un formulario
   * puede tener varios departamentos que registran y varios que aportan.
   */
  roles: RolParticipante[];
  esPatrulla: boolean;
  areas: AreaAdmitida[];
}

/** La persona que se pretende asignar. */
export interface PersonaParaAsignar {
  funcionarioId: number;
  /** `APELLIDOS NOMBRES`, para redactar el mensaje. */
  nombre: string;
  area: AreaPersonal;
  activo: boolean;
}

/** Una asignación que el operativo ya tiene. */
export interface AsignacionExistente {
  funcionarioId: number;
  area: AreaPersonal;
  asignadoPorRol: RolDepartamental;
}

/** Igual que el veredicto de elegibilidad: sin datos estructurados de la persona. */
export interface VeredictoComposicion {
  admitida: boolean;
  codigo?: CodigoError;
  motivo?: string;
}

const ADMITIDA: VeredictoComposicion = { admitida: true };

/**
 * Aplica las cuatro reglas, en orden, y devuelve el primer motivo que impide asignar.
 *
 * El orden importa: la persona dada de baja y la repetida se responden antes que el
 * área, porque un mensaje sobre áreas admitidas cuando el problema es que la persona ya
 * figura desorienta a quien lo lee.
 */
export function verificarComposicion(
  persona: PersonaParaAsignar,
  formulario: FormularioParaComposicion,
  asignadas: AsignacionExistente[],
  rolQueAsigna: RolDepartamental,
): VeredictoComposicion {
  return (
    reglaPersonaActiva(persona) ??
    reglaSinRepetir(persona, asignadas) ??
    reglaAreaAdmitida(persona, formulario) ??
    reglaCupoCompartido(persona, formulario, asignadas, rolQueAsigna) ??
    ADMITIDA
  );
}

// ───────────────────── 1 · La persona sigue en el maestro ─────────────────────

function reglaPersonaActiva(
  persona: PersonaParaAsignar,
): VeredictoComposicion | undefined {
  if (persona.activo) return undefined;

  return {
    admitida: false,
    codigo: CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
    motivo: `${persona.nombre} está dada de baja en el maestro de personal y no puede recibir asignaciones.`,
  };
}

// ───────────────────── 2 · INV-10 · nadie figura dos veces ─────────────────────

/**
 * `uq_asignacion_oper_func` ya lo impide en la base. Comprobarlo aquí no lo duplica:
 * lo anticipa, para que el funcionario lea una frase con el nombre de la persona en
 * lugar del error del motor.
 *
 * El código es `SOLAPAMIENTO_HORARIO` y no uno nuevo: figurar dos veces en el mismo
 * operativo es el caso límite de RN-28 —la persona estaría en dos sitios a la vez, que
 * resultan ser el mismo—. `ElegibilidadService` no lo detecta porque excluye a propósito
 * el operativo que se está editando.
 */
function reglaSinRepetir(
  persona: PersonaParaAsignar,
  asignadas: AsignacionExistente[],
): VeredictoComposicion | undefined {
  const repetida = asignadas.some(
    (asignada) => asignada.funcionarioId === persona.funcionarioId,
  );

  if (!repetida) return undefined;

  return {
    admitida: false,
    codigo: CODIGOS_ERROR.SOLAPAMIENTO_HORARIO,
    motivo: `${persona.nombre} ya figura en este operativo.`,
  };
}

// ───────────────────── 3 · VAL-10 e INV-09 · área admitida ─────────────────────

/**
 * RN-15. Cada formulario admite las áreas que le corresponden.
 *
 * El mensaje **enumera las que sí admite**: es el caso 3 del plan, y sin esa lista el
 * funcionario tiene que adivinar a quién puede poner.
 */
function reglaAreaAdmitida(
  persona: PersonaParaAsignar,
  formulario: FormularioParaComposicion,
): VeredictoComposicion | undefined {
  const admitida = formulario.areas.some((fila) => fila.area === persona.area);
  if (admitida) return undefined;

  const permitidas = formulario.areas.map((fila) => fila.area).join(', ');

  return {
    admitida: false,
    codigo: CODIGOS_ERROR.AREA_NO_ADMITIDA,
    motivo: `${persona.nombre} es del área ${persona.area}, y el formulario ${formulario.nombre} solo admite personal de: ${permitidas || 'ninguna área configurada'}.`,
  };
}

// ───────────────────── 4 · VAL-18 y PER-06 · cupo compartido ─────────────────────

/**
 * El rol COMPARTIDO tiene dos límites que el dueño no tiene.
 *
 *   · **Área.** Solo puede asignar las marcadas como compartidas. RN-32: la patrulla
 *     nocturna suma una persona del área de Instrucción, y esa es la que le corresponde
 *     al DMIT en el formulario 6.
 *   · **Cantidad.** `form_cupo_compartido` personas, contando **solo las que él mismo
 *     asignó** —de ahí que `aper_asignado_por_rol` exista (RF-063)—. Contar todas haría
 *     que el dueño consumiera el cupo ajeno con sus propias asignaciones.
 *
 * Sin cupo declarado, el rol compartido no asigna: un cupo indefinido no es «ilimitado».
 * Ver PV-09.
 */
function reglaCupoCompartido(
  persona: PersonaParaAsignar,
  formulario: FormularioParaComposicion,
  asignadas: AsignacionExistente[],
  rolQueAsigna: RolDepartamental,
): VeredictoComposicion | undefined {
  /*
    SOLO SE APLICA A QUIEN APORTA. Un departamento con `ESCRITURA` —desde el 2026-08-25
    pueden ser varios en el mismo formulario— arma el operativo entero y no tiene tope de
    personal: el cupo existe para acotar la participación de quien **no** lo arma.
  */
  const participacion = formulario.roles.find(
    (fila) => fila.rol === rolQueAsigna,
  );

  if (!participacion || participacion.acceso !== 'APORTA') return undefined;

  const areasCompartidas = formulario.areas
    .filter((fila) => fila.esCompartida)
    .map((fila) => fila.area);

  if (!areasCompartidas.includes(persona.area)) {
    return {
      admitida: false,
      codigo: CODIGOS_ERROR.CUPO_COMPARTIDO_SUPERADO,
      motivo: `Su departamento participa en el formulario ${formulario.nombre} con personal de: ${areasCompartidas.join(', ') || 'ninguna área'}. ${persona.nombre} es del área ${persona.area}.`,
    };
  }

  const cupo = participacion.cupo ?? 0;
  const yaAsignadas = asignadas.filter(
    (asignada) => asignada.asignadoPorRol === rolQueAsigna,
  ).length;

  if (yaAsignadas >= cupo) {
    return {
      admitida: false,
      codigo: CODIGOS_ERROR.CUPO_COMPARTIDO_SUPERADO,
      motivo:
        cupo === 0
          ? `El formulario ${formulario.nombre} no tiene cupo configurado para su departamento.`
          : `Su departamento ya asignó ${yaAsignadas} de ${cupo} ${cupo === 1 ? 'persona' : 'personas'} en este operativo.`,
    };
  }

  return undefined;
}

// ───────────────────── RN-31 y RN-32 · composición de la patrulla ─────────────────────

/** Estado de la composición esperada, para mostrarlo sin bloquear. */
export interface EstadoComposicion {
  esPatrulla: boolean;
  /** Áreas que el formulario admite y el operativo todavía no tiene. */
  areasPendientes: AreaPersonal[];
  completa: boolean;
}

/**
 * RN-31 y RN-32. Qué áreas le faltan al operativo.
 *
 * **NO BLOQUEA, Y ES UNA DECISIÓN.** Las dos reglas describen la composición que la
 * patrulla debe acabar teniendo —un inspector general, uno técnico, y en la nocturna una
 * persona de Instrucción—, no una condición de cada asignación: aplicarlas al asignar
 * rechazaría siempre a la primera persona, que por definición deja la composición
 * incompleta.
 *
 * Ninguna fuente dice **en qué momento** se verifica ni qué ocurre si no se cumple al
 * cerrar la jornada. Inventarlo aquí sería exactamente lo que el proyecto prohíbe, así
 * que se informa y se registra como PV-29.
 */
export function estadoDeComposicion(
  formulario: FormularioParaComposicion,
  asignadas: AsignacionExistente[],
): EstadoComposicion {
  const presentes = new Set(asignadas.map((asignada) => asignada.area));
  const areasPendientes = formulario.areas
    .map((fila) => fila.area)
    .filter((area) => !presentes.has(area));

  return {
    esPatrulla: formulario.esPatrulla,
    areasPendientes,
    completa: areasPendientes.length === 0,
  };
}
