/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Notas del operativo
 * Archivo: autores.ts
 * Responsabilidad: Resolver el nombre de quienes firman las notas de un listado, en UNA consulta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 *
 * SOLO LO LLAMAN REPOSITORIOS (`operativos`, `documentos/jornada`, `documentos/matriz`): toca
 * Prisma y la capa de aplicación no lo hace (CLAUDE.md §4). Vive aquí para que ningún submódulo
 * importe el repositorio de otro. Devuelve solo el nombre: nada más de la cuenta.
 */

import { Prisma, PrismaClient } from '@prisma/client';

import type { MapaDeAutores } from './notas-operativo';

/** Un cliente de Prisma o una transacción: los dos tienen `usuario.findMany`. */
type ClienteConUsuarios =
  | Pick<PrismaClient, 'usuario'>
  | Prisma.TransactionClient;

export async function autoresPorIds(
  cliente: ClienteConUsuarios,
  ids: number[],
): Promise<MapaDeAutores> {
  if (ids.length === 0) return {};
  const usuarios = await cliente.usuario.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true },
  });
  const autores: MapaDeAutores = {};
  for (const usuario of usuarios) autores[usuario.id] = usuario.nombre;
  return autores;
}
