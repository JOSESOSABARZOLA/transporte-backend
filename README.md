# transporte-backend

Repositorio automatizacion de Cuadro de Colores Operativos.

Backend del **Módulo Transportes / Cuadro de Colores Operativo** de la Agencia Metropolitana de
Control. NestJS 11 · Prisma · PostgreSQL 18 · Docker.

## Ejecutar

```bash
npm install
npm run start:dev      # http://localhost:3003/api/v1
npm run build          # debe salir con código 0
npm run lint           # debe salir con código 0
```

## Prisma

**Fijado en 6.x** deliberadamente. El motivo está en `prisma/README.md`.

```bash
npm run prisma:generate    # genera el cliente
npm run prisma:migrate     # desarrollo: genera y aplica la migración
npm run prisma:deploy      # producción: aplica lo pendiente
npm run prisma:status      # migraciones pendientes
```

Las migraciones **no** se aplican al arrancar el contenedor: son un paso explícito del
despliegue. Un arranque que modifica el esquema puede dejar la base a medias.

Solo la capa `infrastructure` de cada submódulo toca `PrismaService`. Los controladores y los
servicios de aplicación nunca lo inyectan.

## Variables de entorno

| Variable | Ejemplo | Nota |
|---|---|---|
| `PORT` | `3003` | |
| `DATABASE_URL` | `postgresql://…/transportedb?schema=public&connection_limit=10&pool_timeout=20` | **`connection_limit` es obligatorio**: sin él Prisma abre 57 conexiones por instancia contra un tope de 100 |
| `CORS_ORIGINS` | `http://localhost:5180` | Lista blanca |
| `TZ` | `America/Guayaquil` | **Crítico**: las ventanas de carga dependen de ella |
| `AUTH_EXCHANGE_URL` | `http://<IP_SERVIDOR_AUTH>:10004/auth/exchange` | Canje con Auth central |
| `AUTH_JWT_SECRET` | — | **Secreto.** Verifica lo que Auth firmó |
| `AUTH_SUBSYSTEM_ID` | `11` | SIGOC |
| `SESSION_JWT_SECRET` | — | **Secreto, y distinto del anterior.** Firma la cookie de este módulo |
| `JWT_AUDIENCE` | `TRANSPORTE` | Destinatario del token propio |
| `AUTH_COOKIE_SECURE` | `false` | **`true` en producción con HTTPS** |

> `MODO_IDENTIDAD_PROVISIONAL` **ya no existe**: se retiró el 2026-08-18 con la etapa 5. Si aparece
> en un `.env` heredado, sobra. Ver `DESPLIEGUE.md` §0.

## Documentación

La fuente de verdad está en `docs/`:

| Necesito | Archivo |
|---|---|
| Guía de implementación, orden y listas de verificación | `docs/IMPLEMENTATION_GUIDE.md` |
| Reglas de negocio y validaciones | `docs/FASE2-documentacion-funcional.md` |
| Agregados, objetos de valor y eventos | `docs/FASE3-analisis-dominio.md` |
| Arquitectura y contratos de API | `docs/FASE4-arquitectura-tecnica.md` |
| Diccionario de datos, restricciones e índices | `docs/FASE4-diseno-base-datos.md` |
| Pendientes de validación con el Product Owner | `docs/PENDIENTES-VALIDACION.md` |

## Estado

Línea base: arquitectura, convenciones y componentes transversales. Los seis submódulos del
Cuadro de Colores se construyen en las etapas E1 a E8 de la guía de implementación.
