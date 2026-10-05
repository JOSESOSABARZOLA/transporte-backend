/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: auth-usuarios.client.ts
 * Responsabilidad: Preguntarle a Auth central quién trabaja en la institución.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-21
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES LA SEGUNDA LLAMADA SALIENTE DE TODO EL MÓDULO. La primera es el canje.
 *
 * Existe porque el maestro de personal estaba vacío —PV-02, uno de los cinco bloqueantes
 * del negocio— y cargarlo a mano significa teclear a la institución entera. Auth ya sabe
 * quién es quién: nombre, cédula, correo, dependencia, roles y si es inspector.
 *
 * LO QUE AUTH **NO** SABE, y por eso este cliente no lo promete: el tipo de contrato.
 * Ni nombramiento, ni ocasional, ni modalidad de vinculación. Comprobado en su código
 * fuente el 2026-08-21. Y es justo el dato que gobierna RN-26 y RN-33, así que sigue
 * capturándose en P-07.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SIN AXIOS, con el `fetch` global de Node, igual que `sesion.service.ts`. Una dependencia
 * menos en la imagen.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * TRES COSAS DE `GET /users` QUE HAY QUE SABER ANTES DE CONSUMIRLO.
 *
 * 1. **No pagina ni filtra.** Devuelve la institución completa, activos e inactivos, en
 *    una sola respuesta. Filtrar es responsabilidad de quien llama.
 * 2. **No exige rol.** Cualquier sesión válida de cualquier subsistema puede listar al
 *    personal entero. No es nuestro para arreglarlo —está reportado— y por eso **nuestro**
 *    endpoint sí exige `ADMINISTRADOR_DMIP`.
 * 3. **El Auth desplegado va por detrás de su repositorio.** Ya ocurrió dos veces con el
 *    token de sesión. Por eso aquí no se declara la respuesta como un contrato cerrado:
 *    cada campo se lee con tolerancia y se normaliza. Un campo que falte deja su hueco
 *    vacío, no tumba la pantalla.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable, Logger } from '@nestjs/common';

import { ApplicationError } from '../../../common/errors/application.error';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import { appConfig } from '../../../config/app.config';

/** Cinco segundos, el mismo tope que el canje. Auth responde en milisegundos o no responde. */
const ESPERA_MAXIMA_MS = 5000;

/**
 * `Bearer <token>`. **EL PREFIJO NO ES OPCIONAL Y SU AUSENCIA NO SE PARECE A UN ERROR.**
 *
 * Comprobado contra el Auth desplegado el 2026-08-21:
 *
 * ```
 * sin cabecera      → 500 {"message":"Token no encontrado"}
 * Authorization: X  → 500 {"message":"Token no encontrado"}      ← indistinguible
 * Bearer X          → 500 {"message":"Token incorrecto o expirado"}
 * ```
 *
 * Es decir: un token **pelado se descarta como si no existiera**, y Auth contesta lo mismo
 * que a una petición anónima. La primera versión de este cliente lo enviaba así, copiando
 * al otro módulo del ecosistema que consume `/users` —que reenvía la cabecera entera del
 * navegador, y por eso ya trae el prefijo—, y el directorio salía vacío con un mensaje que
 * culpaba a la sesión del administrador.
 *
 * Se tolera que el token llegue ya prefijado para que reenviar una cabecera tal cual no
 * produzca `Bearer Bearer …`.
 */
const conBearer = (token: string): string =>
  /^Bearer\s/i.test(token) ? token : `Bearer ${token}`;

/**
 * Un usuario de Auth, ya normalizado.
 *
 * NO ES EL JSON DE AUTH TAL CUAL: es lo que este módulo necesita de él, con los tipos
 * asegurados. Auth entrega además la firma electrónica y el color del inspector, que aquí
 * sobran.
 */
export interface UsuarioDeAuth {
  id: number;
  /** Nombre completo, en un solo campo: Auth no separa apellidos de nombres. */
  nombre: string;
  usuario: string;
  cedula: string;
  correo: string;
  dependencia: string | null;
  /** Ya vienen formateados por Auth como `(Subsistema) Rol`. */
  roles: string[];
  activo: boolean;
  /** Nulo si esa persona no está registrada como inspector. */
  inspector: {
    /** `IG` General · `IT` Técnico · `IS` Sustanciador · `IC` CCF/ITCC. */
    tipo: string;
    zonal: string | null;
    codigo: string;
  } | null;
}

/**
 * 503 · El servicio de Auth no respondió, o respondió algo que no se puede usar.
 *
 * ES UN `ApplicationError` Y NO UN `Error` PELADO, y la diferencia se vio en producción el
 * 2026-08-21: mientras extendió `Error`, el filtro global lo trataba como «Error no
 * controlado», respondía 500 con el texto genérico —«No se pudo completar la operación…»— y
 * el motivo redactado, que dice **qué hacer**, se quedaba en la bitácora. La regla 7 del
 * proyecto —los mensajes del servidor se muestran tal cual— no se cumple sola: exige que el
 * error pertenezca a la jerarquía que el filtro sabe leer.
 *
 * **503 y no 500**: lo que falla es una dependencia externa, no este módulo, y la pantalla
 * puede decir con verdad que el maestro se sigue administrando igual.
 */
export class AuthNoDisponibleError extends ApplicationError {
  constructor(motivo: string, detalles?: unknown) {
    super(motivo, 503, CODIGOS_ERROR.AUTH_NO_DISPONIBLE, detalles);
    this.name = 'AuthNoDisponibleError';
  }
}

@Injectable()
export class AuthUsuariosClient {
  private readonly logger = new Logger(AuthUsuariosClient.name);

  /** `true` si hay a dónde preguntar. La pantalla lo usa para explicarse. */
  get configurado(): boolean {
    return appConfig.sesion.urlApiAuth !== '';
  }

  /**
   * Todos los usuarios que Auth conoce, **incluidos los inactivos**.
   *
   * El filtro de activos NO se hace aquí sino en el servicio, y a propósito: este cliente
   * traduce lo que Auth dice, no decide qué es relevante. Mezclar las dos cosas haría que
   * un cambio de criterio de negocio obligara a tocar el que habla con la red.
   */
  async listar(tokenAuth: string): Promise<UsuarioDeAuth[]> {
    if (!this.configurado) {
      throw new AuthNoDisponibleError(
        'El directorio de Auth central no está configurado en este ambiente. Comuníquelo al administrador del sistema.',
      );
    }

    const destino = `${appConfig.sesion.urlApiAuth}/users`;
    let respuesta: Response;

    try {
      respuesta = await fetch(destino, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: conBearer(tokenAuth),
        },
        signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
      });
    } catch (error: unknown) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Auth central no respondió al listar usuarios: ${motivo}`,
      );
      throw new AuthNoDisponibleError(
        'Auth central no respondió. Vuelva a intentarlo en unos minutos; mientras tanto puede administrar el maestro de personal como siempre.',
      );
    }

    if (!respuesta.ok) {
      // AUTH NO USA 401: rechaza con 500 y el motivo en el cuerpo —«Token no encontrado»,
      // «Token incorrecto o expirado»—. Se traduce a algo accionable, y **se arrastra su
      // texto**: es lo que distingue una sesión caducada de un token que no llegó, y sin
      // él el administrador solo ve un 500 que no puede interpretar.
      const suyo = await this.motivoDeAuth(respuesta);

      this.logger.warn(
        `Auth central rechazó la consulta de usuarios con ${respuesta.status}${
          suyo ? `: ${suyo}` : '.'
        }`,
      );
      throw new AuthNoDisponibleError(
        `Auth central rechazó la consulta${suyo ? ` («${suyo}»)` : ''}. Vuelva a entrar desde el portal institucional para renovar su sesión.`,
      );
    }

    const cuerpo: unknown = await respuesta.json();

    if (!Array.isArray(cuerpo)) {
      throw new AuthNoDisponibleError(
        'Auth central devolvió el directorio en un formato inesperado. Comuníquelo al administrador del sistema.',
      );
    }

    return cuerpo.map((fila) => this.normalizar(fila));
  }

  /**
   * Traduce una fila de Auth a lo que este módulo entiende.
   *
   * TOLERANTE A PROPÓSITO. El Auth desplegado va por detrás de su repositorio, y ya nos
   * costó dos correcciones con el token de sesión. Un campo ausente deja su hueco vacío;
   * lo único que se exige es la **cédula**, porque es la llave con la que se cruza contra
   * la ficha de personal y sin ella la fila no sirve para nada.
   */
  /**
   * El `message` que Auth pone en el cuerpo del rechazo, si lo hay.
   *
   * Devuelve cadena vacía ante cualquier tropiezo —cuerpo que no es JSON, sin `message`,
   * ya consumido—: **estamos construyendo el mensaje de un error, y fallar aquí lo
   * sustituiría por otro que no dice nada de lo que pasó de verdad.**
   */
  private async motivoDeAuth(respuesta: Response): Promise<string> {
    try {
      const cuerpo: unknown = await respuesta.json();

      if (
        typeof cuerpo === 'object' &&
        cuerpo !== null &&
        'message' in cuerpo &&
        typeof (cuerpo as { message: unknown }).message === 'string'
      ) {
        return (cuerpo as { message: string }).message.trim();
      }
    } catch {
      // Sin cuerpo legible. El estado ya quedó en la bitácora.
    }

    return '';
  }

  private normalizar(fila: unknown): UsuarioDeAuth {
    const dato = (fila ?? {}) as Record<string, unknown>;
    const inspector = (dato.inspector ?? {}) as Record<string, unknown>;

    return {
      id: numero(dato.id) ?? 0,
      nombre: texto(dato.name) ?? '',
      usuario: texto(dato.username) ?? '',
      cedula: texto(dato.cedula) ?? '',
      correo: texto(dato.email) ?? '',
      dependencia: texto(dato.dependencia) ?? null,
      roles: Array.isArray(dato.roles)
        ? dato.roles.filter((rol): rol is string => typeof rol === 'string')
        : [],
      // Auth expresa la baja con `deleted_at` y la traduce a este booleano. Si faltara, se
      // asume ACTIVO: esconder a alguien del directorio por un campo ausente sería peor
      // que mostrarlo de más, porque el administrador puede ver que no le corresponde.
      activo: dato.active !== false,
      inspector:
        inspector.enabled === true
          ? {
              tipo: texto(inspector.tipoInspector) ?? '',
              zonal: texto(inspector.zonal) ?? null,
              codigo: texto(inspector.codigoInspector) ?? '',
            }
          : null,
    };
  }
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== ''
    ? valor.trim()
    : undefined;
}

function numero(valor: unknown): number | undefined {
  return typeof valor === 'number' && Number.isFinite(valor)
    ? valor
    : undefined;
}
