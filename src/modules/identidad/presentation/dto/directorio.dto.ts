/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: directorio.dto.ts
 * Responsabilidad: Declarar lo que la pantalla recibe del directorio de Auth.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-21
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NO SE DEVUELVE LA FILA DE AUTH TAL CUAL, y no es ceremonia.
 *
 * `GET /users` de Auth entrega además el bloque de firma electrónica —si la tiene, con qué
 * archivo— y el color con el que se pinta a ese inspector en sus pantallas. Nada de eso
 * significa nada aquí, y arrastrarlo tendría dos costes: la pantalla acabaría mostrando
 * datos de otro sistema que nadie sabría interpretar, y este módulo quedaría atado a un
 * contrato ajeno más ancho de lo que necesita.
 *
 * Se entrega lo que las pantallas pintan, ni un campo más.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DECÍA «lo que P-07 pinta», Y DESDE EL 2026-09-01 SON DOS PANTALLAS.
 *
 * P-11 «Cuentas del cuadro» empieza el alta eligiendo del directorio, igual que P-07 hace
 * con las fichas desde el 24-AGO, así que la fila lleva ahora `cuenta` además de `ficha`.
 *
 * **La regla no se ha relajado, se ha releído.** Lo que prohíbe es arrastrar el contrato
 * de Auth entero —la firma electrónica, el color del inspector— porque eso ata este módulo
 * a un sistema ajeno. `cuenta` no viene de Auth: es **nuestro**, sale de `t_usuario`, y lo
 * pinta una pantalla concreta. Sigue sin haber ni un campo que nadie muestre.
 *
 * Y `ficha` y `cuenta` no son lo mismo, aunque las dos suenen a «lo que ya tiene aquí»:
 * la primera dice que se le puede **convocar a un operativo**, la segunda que puede
 * **entrar al sistema**. Hay gente con una y no la otra en los dos sentidos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { RolDepartamental } from '@prisma/client';

import type { FilaDirectorio } from '../../application/directorio-auth.service';

/** Lo que Auth sabe del inspector. Nulo si esa persona no lo es. */
export interface InspectorDto {
  /** `IG` General · `IT` Técnico · `IS` Sustanciador · `IC` CCF/ITCC. */
  tipo: string;
  zonal: string | null;
  codigo: string;
}

/** La ficha local, si existe. Su ausencia es el dato importante de esta pantalla. */
export interface FichaDto {
  id: number;
  apellidos: string;
  nombres: string;
  area: string;
  tipoContrato: string;
  activo: boolean;
}

/** La cuenta del cuadro de esa persona. **No es la ficha**: una deja entrar, la otra convocar. */
export interface CuentaDto {
  id: number;
  roles: RolDepartamental[];
  activo: boolean;
}

export interface FilaDirectorioDto {
  authId: number;
  cedula: string;
  /** Nombre completo en un solo campo: Auth no separa apellidos de nombres. */
  nombre: string;
  usuario: string;
  correo: string;
  dependencia: string | null;
  /** Formateados por Auth como `(Subsistema) Rol`. Se muestran tal cual. */
  roles: string[];
  inspector: InspectorDto | null;
  /**
   * `null` ⇒ esa persona **no puede ser convocada a un operativo** todavía.
   *
   * Es la razón de ser de la pantalla, no un adorno: sin ficha no hay a quién asignar, ni
   * reglas de descanso que aplicar, ni orden de servicio que emitir.
   */
  ficha: FichaDto | null;
  /**
   * Nulo ⇒ esa persona **todavía no puede entrar al sistema**. 2026-09-01.
   *
   * Lo pinta P-11: sin esto, la pantalla ofrecería «crear cuenta» a quien ya la tiene y
   * el choque aparecería al enviar el formulario, con el rechazo del correo repetido.
   * Un aviso antes vale más que un error después.
   */
  cuenta: CuentaDto | null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL FALLO DE AUTH VIAJA COMO DATO, NO COMO EXCEPCIÓN. 2026-08-24.
 *
 * Hasta hoy este endpoint respondía **503** cuando Auth no contestaba, y la pantalla lo
 * atrapaba. Servía mientras el directorio era una pestaña de consulta: fallaba una vista
 * y el resto seguía.
 *
 * Deja de servir cuando el directorio pasa a ser **el primer paso del alta**: un error
 * en mitad de ese camino obliga a la pantalla a distinguir «no se pudo preguntar» de
 * «preguntamos y no hay nadie», y con una excepción eso se hace por el `catch`, que es
 * donde se pierden los matices.
 *
 * Con `disponible: false` y su `motivo`, la ventana se abre igual, dice qué pasó y ofrece
 * la salida manual —que no toca Auth por ningún lado—. Es el contrato que ya usa el
 * módulo de Instrucción para lo mismo, con los mismos tres campos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface RespuestaDirectorioDto {
  /** `false` si no se pudo consultar a Auth. **No es un error**: es el estado. */
  disponible: boolean;
  /** Redactado para el funcionario, se muestra tal cual. `null` si todo fue bien. */
  motivo: string | null;
  personas: FilaDirectorioDto[];
}

/** Lo que se responde cuando Auth no se pudo consultar. Nunca lanza. */
export function directorioNoDisponible(motivo: string): RespuestaDirectorioDto {
  return { disponible: false, motivo, personas: [] };
}

export function aDirectorioResponse(fila: FilaDirectorio): FilaDirectorioDto {
  return {
    authId: fila.authId,
    cedula: fila.cedula,
    nombre: fila.nombre,
    usuario: fila.usuario,
    correo: fila.correo,
    dependencia: fila.dependencia,
    roles: fila.roles,
    inspector: fila.inspector,
    ficha: fila.ficha,
    cuenta: fila.cuenta,
  };
}
