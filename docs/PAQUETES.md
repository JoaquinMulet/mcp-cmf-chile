# Paquetes de alto nivel

Cuatro herramientas que permiten descargar y organizar información de la CMF con pocas llamadas y un directorio lógico con nombres de archivo normalizados.

## `cmf_empresa_paquete`

Plan de descarga completo de una empresa en **una llamada**: árbol de directorio + manifest de documentos (EEFF, hechos, sanciones, resoluciones, memoria, ASG) con nombres normalizados. No incluye los bytes.

- **Entrada**: `rut`, `anio_inicio?`, `anio_fin?` (máx 2 años por llamada), `tipo?` (C/I), `norma?` (IFRS/NCH), `secciones?`, `incluir_tablas?`
- **Salida**: `empresa`, `arbol`, `manifest` (ruta, tipo, periodo, estado), `resumen` (requests, tiempo estimado, fallidos)
- **Siguiente paso**: usar el manifest con `cmf_empresa_paquete_documentos`.

## `cmf_empresa_paquete_documentos`

Descarga los documentos en **ZIP ordenado en base64** con directorio lógico y `manifiesto.json`. Máx 3 períodos EEFF por llamada (los primeros con datos del rango, o la lista `periodos` AAAAMM) y 2 años para las demás secciones.

- **Entrada**: `rut`, `anio_inicio?`, `anio_fin?`, `periodos?` (máx 3), `secciones?`, `tipo?`, `norma?`, `max_documentos?` (1-24), `max_mb?` (1-50, agregado), `incluir_zip?`
- **Salida**: `descargados` (ruta, nombre, base64, tamano), `resumen` (ok, fallidos, omitidos), `zip`
- Los tokens firmados se gestionan en el servidor: nunca se exponen al cliente.

## `cmf_fondos_paquete_mensual`

Boletines del sistema de fondos mutuos de un mes en una llamada: BPR (patrimonio/rentabilidad/partícipes), costos TAC, comisiones e inversiones. Resumen por sección; use las tools individuales para el detalle completo.

- **Entrada**: `anio`, `mes`, `secciones?` (bpr, costos, comisiones, inversiones_nacio, inversiones_inter), `max_filas?`

## `cmf_catalogo_entidades`

Catálogo completo de entidades supervisadas (11.401 registros) con filtros por nombre, tipo de entidad y estado. Cacheado 24h en KV; paginado (nunca devuelve el dump crudo).

- **Entrada**: `nombre?`, `tipo_entidad?`, `estado?`, `offset?`, `limit?`

## Árbol de directorio (contrato de nombres)

```
copec_90690000/
├── eeff/202512/{eeff_xbrl_202512.zip, eeff_202512.pdf, analisis_razonado_202512.pdf, declaracion_responsabilidad_202512.pdf}
├── hechos/2026/hechos_relevantes_20260315_12345.pdf
├── sanciones/2026/sancion_20260701_007.pdf
├── resoluciones/2026/resolucion_20260402_112.pdf
├── memorias/memoria_anual_2025.pdf
├── asg/asg_memoria_integrada_2025.pdf
└── manifiesto.json
```

Carpeta = `<nemo|razón social>_<RUT>`; nombres `<tipo>_<periodo>.<ext>` con sufijo único cuando hay repetición; `manifiesto.json` es la fuente de verdad de la descarga.

## Límites y fair use

- Máx 2 años por llamada en `cmf_empresa_paquete` (límite de duración del worker); máx 3 períodos EEFF en `cmf_empresa_paquete_documentos` (≈15 requests ≈ 17s).
- Un job pesado a la vez por instancia (semáforo) + rate limit de 1 req/s hacia la CMF.
- Los documentos se cachean 15 min; los catálogos 24h en KV.
- Los fallos parciales se reportan (`fallidos`) sin detener el resto de la descarga.
