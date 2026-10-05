/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: sesion.dto.ts
 * Responsabilidad: Declarar el contrato de los tres endpoints de sesión con Auth central.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-17
 *
 * ESTE CONTRATO NO ES DEL MÓDULO: lo fija `INTEGRACION_AUTH_CENTRAL_FRONTEND.md`, que
 * es compartido por todos los módulos del ecosistema SIGOC. Por eso `code`, `success`,
 * `data`, `user`, `username` y `displayName` están en inglés, contra la regla de
 * nombres en español del proyecto. Cambiarlos rompería a los demás.
 *
 * La regla se aplica donde sigue siendo nuestra: los comentarios, los nombres internos
 * y **los mensajes que lee el funcionario**.
 */

import { IsNotEmpty, IsString } from 'class-validator';
import type { RolDepartamental } from '@prisma/client';

/**
 * Cuerpo del canje. **Un solo campo, y es deliberado.**
 *
 * Con `forbidNonWhitelisted` activo en el `ValidationPipe`, cualquier otra propiedad
 * hace fallar la petición. Es la misma garantía que sostiene la restricción de dos
 * campos de la DAF, aplicada aquí: nadie puede colar un identificador de usuario, un
 * rol ni un subsistema en el ingreso.
 */
export class CanjearCodigoDto {
  @IsString({ message: 'El código de ingreso no tiene el formato esperado.' })
  @IsNotEmpty({
    message:
      'El ingreso llegó sin código. Vuelva a iniciar sesión desde el portal institucional.',
  })
  code!: string;
}

/**
 * Perfil mínimo que se devuelve al navegador.
 *
 * **Nunca incluye el token**, que es el fondo del patrón de cookie `HttpOnly`.
 *
 * `rolCode` es una AMPLIACIÓN del contrato compartido, que solo pide `username` y
 * `displayName`. Hace falta porque este frontend **monta las pantallas según el rol**
 * —regla de interfaz nº 4: un perfil no autorizado no tiene el componente en memoria—,
 * y sin el rol no puede decidir qué construir. Pendiente de acordar con Auth central;
 * ver PLAN_INTEGRACION_AUTH.md §4.3.
 *
 * **No se envía la etiqueta legible del rol.** El texto de interfaz lo pone el
 * frontend, que ya tiene sus nombres; duplicar aquí ese mapa crearía dos sitios donde
 * cambiar una palabra.
 */
export interface PerfilSesionDto {
  username: string;
  displayName: string;
  rolCodes: RolDepartamental[];
  /** RBAC: permisos atómicos efectivos del perfil. El frontend gatea la UI con ellos. */
  permisos: string[];
}

/** Sobre de respuesta que fija el contrato compartido. */
export interface RespuestaSesionDto {
  success: true;
  data: { user: PerfilSesionDto };
  correlationId: string;
  requestId: string;
}

/** Sobre del cierre de sesión: sin datos, porque no hay nada que devolver. */
export interface RespuestaLogoutDto {
  success: true;
  data: Record<string, never>;
  correlationId: string;
  requestId: string;
}
