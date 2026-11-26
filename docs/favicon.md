# Favicon de CUR

El icono representa un libro abierto con una página que se eleva. Usa el azul de CUR (`#0053d5`) y blanco. El SVG es el archivo maestro y conserva la nitidez a cualquier tamaño.

| Archivo | Uso |
| --- | --- |
| `public/favicon.svg` | Icono escalable en navegadores compatibles. |
| `public/favicon.ico` | Formato ICO con tamaños de 16, 32 y 48 px. |
| `public/favicon-32.png` | Icono PNG para pestañas y marcadores. |
| `public/apple-touch-icon.png` | Icono de 180 px para la pantalla de inicio de iOS. |
| `public/icons/cur-192.png` y `public/icons/cur-512.png` | Iconos para la pantalla de inicio y el manifiesto web. |

## Aplicación

El `<head>` de `public/index.html` ya declara los iconos y `public/site.webmanifest`. Cloudflare sirve todo el directorio `public` desde la raíz. Si reutilizas el favicon en otra web, conserva esas rutas o actualiza las referencias al copiar los archivos.

Para actualizar el diseño, modifica `favicon.svg` y vuelve a exportarlo en los tamaños de la tabla. Usa un fondo azul opaco en los PNG de pantalla de inicio. El manifiesto define el nombre y los iconos para sistemas compatibles. El uso sin conexión requeriría un servicio adicional.
