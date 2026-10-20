/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Configuración
 * Archivo: app.config.ts
 * Responsabilidad: Exponer de forma tipada la configuración tomada del entorno.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-04
 */

export interface AppConfig {
  /**
   * `true` solo con `NODE_ENV=production` declarado a propósito. Endurece las
   * comprobaciones de arranque (CORS y cookie `Secure`) que en desarrollo sobre HTTP
   * serían falsos positivos. Ver `validar-entorno.ts`.
   */
  produccion: boolean;
  server: {
    port: number;
    prefijoApi: string;
  };
  baseDatos: {
    /** Cadena de conexión que consume Prisma. Ver docs/IMPLEMENTATION_GUIDE.md §15.3 */
    url: string;
    /**
     * Registro de consultas de Prisma: activo en desarrollo, inactivo en producción.
     * Se deriva de LOG_LEVEL. Ver docs/FASE4-arquitectura-tecnica.md §7.1.
     */
    registroConsultas: boolean;
  };
  /**
   * Zona horaria de evaluación de las ventanas de carga.
   * CRÍTICO: si queda mal configurada, los cierres ocurren a otra hora sin que nadie lo note.
   */
  zonaHoraria: string;
  /**
   * Integración con Auth central. Ver docs/PLAN_INTEGRACION_AUTH.md.
   *
   * NINGÚN VALOR ESTÁ CONFIRMADO TODAVÍA: la etapa 1 —coordinación con Auth central—
   * sigue abierta. Por eso viven aquí y no en el código: cuando la reunión fije la URL,
   * el puerto, la clave y el identificador del subsistema, cambia el `.env` y no se
   * recompila nada.
   */
  sesion: SesionConfig;
  /**
   * Límite de peticiones por dirección de origen.
   *
   * NO ES UN PARÁMETRO DE POLÍTICA. La regla 2 exige que los umbrales del negocio vivan
   * en `t_parametro_politica`; éste no es del negocio, es de infraestructura, y debe
   * poder cambiarse sin tocar la base ni reiniciar más que el proceso.
   */
  limitePeticiones: LimitePeticionesConfig;
  /** Sistema de Inspección (2026-10-07). `urlApi` vacía = sin integración. */
  inspeccion: { urlApi: string };
  /**
   * Proxies de confianza delante del backend (`TRUST_PROXY`, 2026-10-16), en SALTOS.
   *
   * Detrás del Gateway de `*.quito.gob.ec` y del nginx del frontend, toda petición llega con
   * la IP del último proxy: sin esto, el límite de peticiones contaría a todos los usuarios
   * como UNO y el ingreso daría 429 en hora pico. Con `n`, Express toma la IP real de
   * `X-Forwarded-For` descontando `n` saltos (`req.ip`, el que usa `ThrottlerGuard`).
   *
   * `null` = sin declarar: no se toca, como antes (el servidor sin Gateway). `NaN` = valor
   * inválido: `validarEntorno` detiene el arranque. Un valor mayor que los proxies reales
   * dejaría que el cliente eligiera su IP con `X-Forwarded-For`: se pone el número exacto.
   */
  saltosProxy: number | null;
}

export interface LimitePeticionesConfig {
  /** Ventana de conteo, en milisegundos. */
  ventanaMs: number;
  /** Peticiones admitidas por origen dentro de la ventana. */
  maximo: number;
  /**
   * Límite del canje de sesión, más estrecho que el general.
   *
   * Es la superficie de ingreso: la única ruta pública que consulta a Auth central por
   * cada llamada. Un límite generoso ahí permitiría usar este backend para sondear
   * códigos contra Auth, que no es nuestro.
   */
  maximoIngreso: number;
}

export interface SesionConfig {
  /** Endpoint de canje de Auth central: `GET …/auth/exchange?code=`. */
  urlCanjeAuth: string;
  /**
   * Base de la API de Auth central, de la que cuelga `/users`. 2026-08-21.
   *
   * Alimenta el directorio de personal de P-07. **Vacía significa sin directorio**, no
   * error: la pantalla lo dice y el maestro se sigue administrando como siempre.
   */
  urlApiAuth: string;
  /**
   * Clave con la que Auth central firma sus tokens, HS256.
   *
   * Es un SECRETO COMPARTIDO: quien la tiene puede firmar tokens válidos para todos
   * los módulos integrados. Está anotado en el plan como asunto a revisar con Auth
   * central —RS256 con clave pública sería preferible—, y no se versiona.
   */
  secretoAuth: string;
  /**
   * Identificador del subsistema de este módulo en Auth central.
   *
   * Se comprueba contra la reclamación `subsystemId` del token. Sin esa comprobación,
   * un código emitido para Timbre o para IVs se podría canjear contra el Cuadro de
   * Colores. Cero significa «sin confirmar»: la comprobación queda desactivada y el
   * arranque lo advierte.
   */
  subsistemaIdAuth: number;
  /** Clave con la que ESTE módulo firma su propio token de sesión. Distinta de la anterior. */
  secretoPropio: string;
  /** Vigencia del token propio, en segundos. Por omisión, ocho horas de jornada. */
  vigenciaSegundos: number;
  /**
   * Emisor y destinatario del token propio, del contrato compartido.
   *
   * NO SON ADORNO. Varios módulos de la AMC pueden compartir dominio, y una cookie de
   * dominio se envía a todos: sin `aud`, el token de sesión de otro módulo firmado con
   * la misma clave sería indistinguible del nuestro. Verificarlo cierra ese paso.
   *
   * EL DESTINATARIO ES EL CÓDIGO DEL MÓDULO EN AUTH CENTRAL, `TRANSPORTE`. El contrato
   * compartido lo dice dos veces con nombres distintos —`JWT_AUDIENCE` en la guía de
   * backends y `AUTH_MODULE_CODE` en la de frontends— y son el mismo valor.
   */
  emisor: string;
  destinatario: string;
  cookie: {
    nombre: string;
    /** `true` solo con HTTPS. En desarrollo sobre HTTP el navegador la descartaría. */
    segura: boolean;
    sameSite: 'lax' | 'strict' | 'none';
  };
}

const aNumero = (valor: string | undefined, porDefecto: number): number => {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : porDefecto;
};

/**
 * `TRUST_PROXY`: vacía o ausente → `null` (no se toca); un entero >= 0 → ese número de
 * saltos; cualquier otra cosa → `NaN`, que `validarEntorno` rechaza. No se admiten `true`
 * ni listas de IP: «confiar en todo» dejaría al cliente falsificar su dirección.
 */
export const aSaltosProxy = (valor: string | undefined): number | null => {
  const texto = (valor ?? '').trim();
  if (texto === '') {
    return null;
  }

  return /^\d+$/.test(texto) ? Number(texto) : Number.NaN;
};

const aBooleano = (valor: string | undefined, porDefecto: boolean): boolean => {
  if (valor === undefined) {
    return porDefecto;
  }

  return valor.toLowerCase() === 'true';
};

/**
 * Política `SameSite` de la cookie de sesión.
 *
 * Un valor desconocido cae en `lax` y no se rechaza: `strict` rompería el regreso desde
 * el portal de Auth —la navegación llega de otro sitio— y `none` sin HTTPS lo descarta
 * el navegador. `lax` es el único que funciona en los tres ambientes.
 */
const aSameSite = (valor: string | undefined): 'lax' | 'strict' | 'none' => {
  const normalizado = valor?.toLowerCase();
  return normalizado === 'strict' || normalizado === 'none'
    ? normalizado
    : 'lax';
};

export const appConfig: AppConfig = {
  produccion: process.env.NODE_ENV === 'production',
  server: {
    port: aNumero(process.env.PORT, 3003),
    prefijoApi: 'api/v1',
  },
  baseDatos: {
    url: process.env.DATABASE_URL ?? '',
    registroConsultas: (process.env.LOG_LEVEL ?? 'info') === 'debug',
  },
  zonaHoraria: process.env.TZ ?? 'America/Guayaquil',
  sesion: {
    urlCanjeAuth: process.env.AUTH_EXCHANGE_URL ?? '',
    /**
     * Base de la API de Auth central, de la que cuelga `/users`. 2026-08-21.
     *
     * VARIABLE APARTE Y NO DERIVADA DE `AUTH_EXCHANGE_URL`, aunque hoy sean el mismo
     * servidor: aquélla apunta a un endpoint concreto —`…/auth/exchange`— y recortarle el
     * camino para adivinar la base sería una suposición que se rompe el día que Auth
     * mueva una de las dos. Vacía significa **sin directorio**, y la pantalla lo dice.
     */
    urlApiAuth: (process.env.AUTH_API_URL ?? '').replace(/\/$/, ''),
    secretoAuth: process.env.AUTH_JWT_SECRET ?? '',
    subsistemaIdAuth: aNumero(process.env.AUTH_SUBSYSTEM_ID, 0),
    secretoPropio: process.env.SESSION_JWT_SECRET ?? '',
    vigenciaSegundos: aNumero(process.env.SESSION_EXPIRES_IN, 28800),
    emisor: process.env.JWT_ISSUER ?? 'transporte-backend',
    destinatario: process.env.JWT_AUDIENCE ?? 'TRANSPORTE',
    cookie: {
      nombre: process.env.AUTH_COOKIE_NAME ?? 'cuadro_colores_sesion',
      segura: aBooleano(process.env.AUTH_COOKIE_SECURE, false),
      sameSite: aSameSite(process.env.AUTH_COOKIE_SAME_SITE),
    },
  },
  /**
   * Sistema de Inspección (2026-10-07). Base de su API, de la que cuelga `/operativos?fecha=`: los
   * trámites que tiene asignados cada inspector en una fecha. Se llama DESDE EL SERVIDOR con el
   * token de Auth central del usuario conectado; el navegador nunca habla con Inspección. Vacía
   * significa **sin integración**: el registro funciona igual y el combo lo dice.
   */
  inspeccion: {
    urlApi: (process.env.INSPECCION_API_URL ?? '').replace(/\/$/, ''),
  },
  limitePeticiones: {
    ventanaMs: aNumero(process.env.LIMITE_VENTANA_MS, 60000),
    // 300 por minuto. Holgado para quien arma el cuadro —una pantalla de registro
    // encadena varias consultas de catálogo por operativo— y estrecho para un guion.
    maximo: aNumero(process.env.LIMITE_MAXIMO, 300),
    maximoIngreso: aNumero(process.env.LIMITE_MAXIMO_INGRESO, 10),
  },
  saltosProxy: aSaltosProxy(process.env.TRUST_PROXY),
};
