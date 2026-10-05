/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: usuario-autenticado.interface.ts
 * Responsabilidad: Declarar la identidad resuelta que viaja en la petición.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Extiende `AuthUser`, el contrato que ya consume el `RolesGuard` existente. Por eso
 * incluye `roles` como arreglo: permite reutilizar esa guarda **sin modificarla**,
 * conforme a docs/IMPLEMENTATION_GUIDE.md §0.2.
 */

import type { RolDepartamental } from '@prisma/client';

import type { AuthUser } from './auth-user.interface';

export interface UsuarioAutenticado extends AuthUser {
  /** Identificador numérico del usuario, que es el que audita la traza. */
  usuarioId: number;
  /**
   * EL ROL BAJO EL QUE SE HACE **ESTA** PETICIÓN, no «el rol del usuario».
   *
   * Cambió de significado el 2026-08-19, cuando una persona pasó a poder tener varios.
   * Lo calcula la cadena de guardas y se estrecha a medida que avanza:
   *
   *   · `IdentidadGuard` lo deja en el primero de `roles`, como valor de partida.
   *   · `RolesGuard` lo reduce a uno que el endpoint admita.
   *   · `FormularioRolGuard` lo fija en el dueño del formulario que se escribe.
   *
   * Es lo que se graba en `oper_creado_por_rol`, `audi_rol` y demás: **con qué sombrero
   * se hizo esto**, que es la pregunta que esas columnas responden. Si se grabara «todos
   * sus roles», la traza dejaría de decir quién actuó.
   */
  rol: RolDepartamental;
  nombre: string;
  /**
   * TODOS los roles de la persona. Es la fuente de la autorización.
   *
   * `RolesGuard` ya leía un arreglo antes de este cambio —se rellenaba con un solo
   * elemento— así que la cadena no necesitó tocarse para admitir varios.
   */
  roles: RolDepartamental[];
  /**
   * Usuario con el que Auth central acreditó la sesión.
   *
   * OBLIGATORIO desde la etapa 5. Era opcional mientras existía el modo provisional, que
   * fijaba la identidad con una cabecera y no tenía ninguno; retirado aquél, toda
   * identidad viene de un canje y siempre trae su usuario de Auth.
   *
   * Se usa para devolver el perfil en `GET /auth/session` y para la traza; **ninguna
   * decisión de autorización depende de este campo**, que sigue siendo `rol`.
   */
  usuarioAuth: string;
  /**
   * Enlace con la ficha de personal (2026-10-02). Nulo en los perfiles que no salen a operativos
   * —Dirección y administración—. Viene del token de sesión (`ContenidoSesion.funcionarioId`). Lo usa
   * la emisión de órdenes para resolver datos del firmante/ejecutor; ninguna decisión de
   * autorización depende de él (esa sigue siendo `rol`/`roles`).
   */
  funcionarioId: number | null;
  /**
   * Token con el que Auth central acreditó esta sesión, para poder consultarle a él.
   *
   * NINGUNA DECISIÓN DE AUTORIZACIÓN DE ESTE MÓDULO LO MIRA. Sirve para una sola cosa:
   * `GET /users` de Auth, que alimenta el directorio de personal de P-07. Auth no tiene
   * token de servicio, así que la credencial de una persona es la única que existe.
   *
   * **Puede ser nulo** —sesiones anteriores al 2026-08-21, o un canje que no lo entregue—
   * y quien lo consuma debe decirlo con un mensaje que se entienda, no reventar.
   */
  tokenAuth: string | null;
}
