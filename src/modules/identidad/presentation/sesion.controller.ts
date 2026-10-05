/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: sesion.controller.ts
 * Responsabilidad: Exponer el canje, la consulta y el cierre de la sesión del módulo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-17
 *
 * Los tres endpoints de `INTEGRACION_AUTH_CENTRALIZADO_BACKENDS.md`, montados bajo el
 * prefijo `/api/v1` del módulo:
 *
 *   POST /api/v1/auth/session/exchange   público    canjea el código y crea la cookie
 *   GET  /api/v1/auth/session            protegido  confirma que hay sesión viva
 *   POST /api/v1/auth/session/logout     público    borra la cookie, idempotente
 *
 * EL PREFIJO ES UNA DESVIACIÓN CONSCIENTE. La guía escribe las rutas sin él; aquí todo
 * cuelga de `/api/v1` desde M-01 y `httpClient` del frontend ya compone su `baseURL`
 * con ese prefijo. Se eligió la coherencia interna. Pendiente de avisar a quien fijó el
 * contrato. Ver PLAN_INTEGRACION_AUTH.md §4.1.
 *
 * NO HAY GUARDA GLOBAL, y por eso «público» aquí significa simplemente no declarar
 * `@UseGuards`. En este módulo cada endpoint declara su cadena —ver `auth.module.ts`—,
 * de modo que no hace falta una lista de exclusiones, que es donde se esconden los
 * agujeros.
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { CookieOptions, Response } from 'express';

import { appConfig } from '../../../config/app.config';
import { obtenerContexto } from '../../../common/contexto/contexto-peticion';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { PermisosService } from '../../../common/auth/application/permisos.service';
import { SesionService } from '../application/sesion.service';
import {
  CanjearCodigoDto,
  type PerfilSesionDto,
  type RespuestaLogoutDto,
  type RespuestaSesionDto,
} from './dto/sesion.dto';

/** Cabecera de trazabilidad por petición que pide el contrato compartido. */
const CABECERA_PETICION = 'x-request-id';

@Controller('auth')
export class SesionController {
  constructor(
    private readonly sesion: SesionService,
    private readonly permisos: PermisosService,
  ) {}

  /**
   * Canjea el código de un solo uso que entregó Auth central.
   *
   * `passthrough: true` deja que Nest siga serializando el valor devuelto: sin él,
   * pedir `@Res()` obliga a escribir la respuesta a mano y se pierde el filtro de
   * excepciones, que es quien compone el sobre de error del módulo.
   *
   * **La respuesta no lleva el token.** Va en la cookie, que el navegador no puede leer.
   *
   * LÍMITE MÁS ESTRECHO QUE EL GENERAL. Es la única ruta pública que provoca una
   * llamada a Auth central por cada petición: sin acotarla, este backend serviría para
   * sondear códigos contra un sistema que no es nuestro. Un ingreso legítimo la usa
   * **una vez** por sesión, así que diez por minuto sobran incluso reintentando.
   */
  @Post('session/exchange')
  @Throttle({
    default: {
      ttl: appConfig.limitePeticiones.ventanaMs,
      limit: appConfig.limitePeticiones.maximoIngreso,
    },
  })
  @HttpCode(HttpStatus.OK)
  async canjear(
    @Body() datos: CanjearCodigoDto,
    @Res({ passthrough: true }) respuesta: Response,
    @Headers(CABECERA_PETICION) peticionId?: string,
  ): Promise<RespuestaSesionDto> {
    const { token, perfil } = await this.sesion.canjear(datos.code);

    respuesta.cookie(
      appConfig.sesion.cookie.nombre,
      token,
      opcionesDeCookie(appConfig.sesion.vigenciaSegundos),
    );

    return envolver(
      {
        username: perfil.usuarioAuth,
        displayName: perfil.nombre,
        // PLURAL DESDE EL 2026-08-19. El frontend monta las pantallas según el rol, y
        // ahora puede haber varios: se le entregan todos y él calcula la unión.
        rolCodes: perfil.roles,
        // RBAC: los permisos efectivos (unión de los de sus roles). El frontend gatea la
        // UI con ellos; NO viajan en el JWT, se derivan de la base en cada respuesta.
        permisos: [...(await this.permisos.permisosDeRoles(perfil.roles))],
      },
      peticionId,
    );
  }

  /**
   * Confirma que la cookie corresponde a una sesión viva y devuelve el perfil.
   *
   * Lo consulta el frontend al arrancar para decidir si entra o va al portal.
   *
   * **RELEE LA CUENTA DE LA BASE, no devuelve lo que se firmó.** La cookie dura ocho
   * horas: sin esta relectura, retirar un rol o desactivar a alguien no surtiría efecto
   * hasta que caducara, y quien perdiera el perfil de Dirección seguiría viendo la matriz
   * consolidada el resto de la jornada. Responde **403** en ese caso, distinto del 401
   * de «no hay sesión»: son dos gestiones distintas para el funcionario.
   *
   * `RolesGuard` NO se declara a propósito: este endpoint no restringe por rol —lo usan
   * los siete—, y esa guarda deja pasar cuando no hay roles exigidos.
   */
  @Get('session')
  @UseGuards(IdentidadGuard)
  async obtener(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Headers(CABECERA_PETICION) peticionId?: string,
  ): Promise<RespuestaSesionDto> {
    const perfil = await this.sesion.perfilVigente(usuario.usuarioAuth);

    return envolver(
      {
        username: perfil.usuarioAuth,
        displayName: perfil.nombre,
        // PLURAL DESDE EL 2026-08-19. El frontend monta las pantallas según el rol, y
        // ahora puede haber varios: se le entregan todos y él calcula la unión.
        rolCodes: perfil.roles,
        // RBAC: permisos efectivos, re-derivados de la base (reflejan cambios de la matriz).
        permisos: [...(await this.permisos.permisosDeRoles(perfil.roles))],
      },
      peticionId,
    );
  }

  /**
   * Borra la cookie de sesión de este módulo.
   *
   * PÚBLICO E IDEMPOTENTE, como pide la guía: cerrar sesión con la cookie ya vencida
   * debe funcionar igual. Exigir sesión para poder cerrarla dejaría al usuario
   * atrapado justo cuando algo ha ido mal.
   *
   * BORRA SOLO LA SESIÓN DE ESTE MÓDULO. La de Auth central sigue viva en su Redis, y
   * desde el portal se puede volver a entrar sin credenciales. Auth no publica hoy
   * endpoint de revocación y la guía prohíbe improvisarlo. Queda abierto en
   * PLAN_INTEGRACION_AUTH.md §10.
   */
  @Post('session/logout')
  @HttpCode(HttpStatus.OK)
  cerrar(
    @Res({ passthrough: true }) respuesta: Response,
    @Headers(CABECERA_PETICION) peticionId?: string,
  ): RespuestaLogoutDto {
    // `clearCookie` solo surte efecto si los atributos coinciden con los del alta:
    // el navegador identifica la cookie por nombre, dominio, ruta y SameSite.
    respuesta.clearCookie(
      appConfig.sesion.cookie.nombre,
      opcionesDeCookie(undefined),
    );

    return {
      success: true,
      data: {},
      correlationId: obtenerContexto()?.correlacionId ?? '',
      requestId: peticionId ?? randomUUID(),
    };
  }
}

/**
 * Atributos de la cookie de sesión.
 *
 * `httpOnly` es el patrón entero: sin él, el token queda al alcance de cualquier script
 * de la página y el trabajo no habría servido de nada.
 *
 * `secure` y `sameSite` salen de la configuración porque dependen del ambiente. En
 * desarrollo sobre HTTP, `secure: true` haría que el navegador descartara la cookie en
 * silencio y la sesión no se abriría nunca sin ningún error visible.
 */
function opcionesDeCookie(vigenciaSegundos: number | undefined): CookieOptions {
  const opciones: CookieOptions = {
    httpOnly: true,
    secure: appConfig.sesion.cookie.segura,
    sameSite: appConfig.sesion.cookie.sameSite,
    path: '/',
  };

  return vigenciaSegundos === undefined
    ? opciones
    : { ...opciones, maxAge: vigenciaSegundos * 1000 };
}

/** Compone el sobre del contrato compartido con la trazabilidad de la petición. */
function envolver(
  perfil: PerfilSesionDto,
  peticionId: string | undefined,
): RespuestaSesionDto {
  return {
    success: true,
    data: { user: perfil },
    correlationId: obtenerContexto()?.correlacionId ?? '',
    requestId: peticionId ?? randomUUID(),
  };
}
