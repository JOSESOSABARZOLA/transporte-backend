# Microservicio: transporte · Modulo: Cuadro de Colores
# Construccion multietapa: separa compilacion de ejecucion para reducir la imagen.

# Etapa 1: construccion
FROM node:20 AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

RUN npm ci

COPY src ./src

# El cliente de Prisma se genera DENTRO de la imagen y nunca se copia desde la maquina
# de desarrollo: incluye binarios especificos de la plataforma y es la causa mas
# frecuente de fallo al contenerizar con Prisma.
COPY prisma ./prisma
RUN npx prisma generate

RUN npm run build

# Etapa 2: ejecucion
FROM node:20-slim

WORKDIR /app

# dumb-init para el manejo correcto de señales.
# openssl es OBLIGATORIO para Prisma: node:20-slim no lo incluye, y sin el la deteccion
# del motor de consultas cae a "debian-openssl-1.1.x" mientras la etapa de construccion
# genero el motor para "debian-openssl-3.0.x". El contenedor arranca y entra en bucle de
# reinicio al primer acceso a datos. Es la variante mas comun del riesgo RT-04.
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Cliente de Prisma generado en la etapa de construccion, y el esquema con sus
# migraciones, que el despliegue necesita para `prisma migrate deploy`.
# Se copian las DOS carpetas: .prisma trae el motor de consultas y @prisma/client el
# cliente generado. `npm ci --omit=dev` reinstala @prisma/client sin generar, y sin esta
# copia el cliente queda vacio.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/prisma ./prisma

# Membrete institucional para la matriz consolidada y las ordenes de servicio.
#
# LAS FUENTES ROBOTO VUELVEN A LA IMAGEN (2026-09-15). El comentario anterior decia que
# /app/fonts no lo leia nadie: era cierto mientras solo existian los exportadores pdfkit
# (matriz y orden de servicio corta), que traen sus fuentes incrustadas. La nueva Orden de
# Servicio en formato memorando usa **pdfmake**, que exige registrar los .ttf desde disco
# (ver reports/motor-documento.ts). Sin este COPY, ese documento falla en produccion por
# fuente ausente. La matriz y la orden corta siguen en pdfkit y no dependen de esto.
COPY fonts ./fonts
#
# EL LOGOTIPO INSTITUCIONAL VIVE AQUI, Y ESTA LINEA ES LA UNICA QUE LO METE EN LA IMAGEN.
# Desde el 2026-08-25 `src/assets/logo-amc.png` es el bloque real entregado por la
# institucion —1200x268, 101 kB— y `identidad-institucional.ts` lo busca en
# `<cwd>/src/assets`. `nest-cli.json` NO copia activos a dist, asi que sin este COPY los
# dos documentos salen con el membrete de texto de respaldo. PV-30 cerrado.
#
# Hasta esa fecha aqui habia un marcador de 70 bytes —un PNG transparente de 1x1 con
# extension .jpeg— con el nombre y la ruta correctos. Se retiro.
COPY src/assets ./src/assets

# Usuario no privilegiado.
RUN groupadd -g 1001 nodejs
RUN useradd -m -u 1001 -g nodejs nestjs

# uploads se monta como volumen; Docker lo inicializa con el dueño de esta carpeta en la
# imagen. Debe ser nestjs para que el usuario no-root pueda escribir los documentos.
RUN mkdir -p /app/uploads && chown -R nestjs:nodejs /app/uploads

USER nestjs

EXPOSE 3003

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/main"]
