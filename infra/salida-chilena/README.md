# Salida chilena

Proxy mínimo que consulta a `www.cmfchile.cl` desde una IP chilena. El Worker lo usa solo
cuando la CMF rechaza su consulta directa con 403 o 520. El porqué y la evidencia están en
la lección 36 del `CLAUDE.md` de la raíz.

## Piezas

- `proxy.mjs`. El servidor, sin dependencias. Escucha en `127.0.0.1:8791`.
- `cmf-salida-proxy.service`. Unidad de systemd de usuario que corre el proxy.
- `cmf-salida-tunel.service`. Unidad de systemd de usuario que corre un túnel de Cloudflare
  propio, llamado `cmf-salida`, hacia `cmf-salida.kumocloud.cl`.

En la máquina todo vive en `~/cmf-salida/`. Ahí están `proxy.mjs`, `tunel.yml` y `token`.
El archivo `token` es el secreto compartido con el Worker. Se generó en la máquina con
`openssl rand -hex 32` y nunca se copia a un chat ni al repositorio.

## Los 3 cerrojos

1. Secreto. Sin la cabecera `X-Cmf-Token` correcta responde 401.
2. Destino. Solo acepta `https://www.cmfchile.cl/...` en `X-Cmf-Destino`. Lo demás es 400.
3. Ritmo. Una consulta a la CMF cada 600 ms como máximo, y 12 en curso. Con la cola llena
   responde 429.

Los 3 están probados en `test/salida-proxy.test.ts`.

## Operación

Actualizar el proxy después de cambiar `proxy.mjs`.

```bash
scp infra/salida-chilena/proxy.mjs floki@100.110.136.31:cmf-salida/proxy.mjs
ssh floki@100.110.136.31 'systemctl --user restart cmf-salida-proxy'
```

Ver el estado y las últimas consultas. El registro lleva método, ruta y estado, sin
la query.

```bash
ssh floki@100.110.136.31 'systemctl --user is-active cmf-salida-proxy cmf-salida-tunel; journalctl --user -u cmf-salida-proxy -n 20 --no-pager -o cat'
```

Rotar el secreto. Primero la máquina, después el Worker, y la tubería evita que el valor
aparezca en pantalla.

```bash
ssh floki@100.110.136.31 'umask 077; openssl rand -hex 32 > ~/cmf-salida/token; systemctl --user restart cmf-salida-proxy'
ssh floki@100.110.136.31 'cat ~/cmf-salida/token' | npx wrangler secret put CMF_PROXY_TOKEN
```

Apagar la salida chilena. Se borra `CMF_PROXY_URL` de `wrangler.jsonc`, se despliega, y en la
máquina se detienen las 2 unidades.

```bash
ssh floki@100.110.136.31 'systemctl --user disable --now cmf-salida-proxy cmf-salida-tunel'
```
