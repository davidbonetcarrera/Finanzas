# Finanzas personales · Guía

Mini app personal (PWA) para controlar ingresos, gastos fijos, gastos del bebé y gastos generales mes a mes, con presupuestos, estados de pago, resumen anual y exportación a PDF y Excel. Funciona en el móvil como una app instalada, también sin conexión.

## 1. Cómo funciona por dentro (y dónde están tus datos)

- **No hay servidor ni cuentas.** Toda la app se ejecuta en tu teléfono y los datos se guardan **sólo en ese dispositivo**, en el almacenamiento del navegador (IndexedDB).
- Los datos se guardan **cifrados** con AES‑256‑GCM. La clave se obtiene de tu contraseña con PBKDF2‑SHA‑256 (600.000 iteraciones). La contraseña no se guarda en ningún sitio.
- Aunque alguien conozca la dirección web, sólo verá una pantalla de contraseña vacía: tus datos no están en la web, están en tu teléfono.
- La app se bloquea sola tras unos minutos sin uso (configurable: 1 a 30 min) o al volver de segundo plano tras ese tiempo.
- La app no carga nada de Internet (ni fuentes, ni analíticas, ni librerías externas). Una política de seguridad (CSP) lo impide.

### Riesgos que debes conocer

| Situación | Qué pasa | Qué hacer |
|---|---|---|
| Pierdes o cambias el teléfono | Los datos se quedan en ese teléfono (cifrados) | Restaurar tu última **copia cifrada** en el nuevo |
| Olvidas la contraseña | Nadie puede descifrar los datos, ni tú | Borrar y restaurar una copia (con la contraseña de esa copia) |
| Borras los datos del navegador o desinstalas la app | Se borran los datos | Restaurar una copia |
| Alguien coge tu teléfono desbloqueado con la app abierta | Puede verla hasta el bloqueo automático | Bloqueo automático corto y botón del candado |
| Exportas PDF/Excel | Esos archivos **no** están cifrados | Guárdalos en un lugar seguro |

> **Haz una copia de seguridad al menos una vez al mes** (Ajustes → Descargar copia cifrada). La app te avisa si llevas más de 30 días sin hacerla.

## 2. Publicarla (necesita HTTPS)

Para instalarla en el móvil debe abrirse desde una dirección **HTTPS** (el cifrado del navegador y el modo sin conexión sólo funcionan así). Es una web estática: basta subir la carpeta `app-finanzas` tal cual. Opciones gratuitas:

1. **Netlify Drop** (la más fácil): entra en https://app.netlify.com/drop, crea una cuenta y arrastra la carpeta `app-finanzas`. Te da una dirección `https://algo.netlify.app`. El archivo `_headers` añade automáticamente las cabeceras de seguridad.
2. **Cloudflare Pages**: Workers & Pages → Create → Pages → Upload assets → sube la carpeta. También usa `_headers`.
3. **GitHub Pages**: sube la carpeta a un repositorio y activa Pages (las cabeceras de `_headers` no se aplican, pero la CSP de `index.html` sí).

Consejos:
- Usa un nombre de sitio poco obvio y no compartas el enlace (no es la protección principal, pero no hace daño). El sitio está marcado como `noindex` para que los buscadores no lo muestren.
- Protege la cuenta del hosting con contraseña fuerte y verificación en dos pasos: quien controle el hosting podría cambiar el código de la app.
- Para actualizar la app, vuelve a subir la carpeta. La app mostrará «Hay una versión nueva → Actualizar». Si cambias archivos, sube también el número de `VERSION` en `sw.js`.

**Probarla en un ordenador** (sin publicar): desde la carpeta, `npx serve .` o `python3 -m http.server 8080` y abre `http://localhost:8080` (localhost cuenta como seguro).

## 3. Añadirla a la pantalla de inicio

**iPhone (Safari)**
1. Abre la dirección HTTPS de la app en **Safari** (no en Chrome de iPhone).
2. Toca el botón **Compartir** (cuadrado con flecha hacia arriba).
3. Elige **«Añadir a pantalla de inicio»** → **Añadir**.
4. Abre la app **desde el icono** y crea ahí tu contraseña. En iPhone, los datos de la app instalada y los de Safari son independientes.

**Android (Chrome)**
1. Abre la dirección en **Chrome**.
2. Menú **⋮** → **«Instalar aplicación»** (o «Añadir a pantalla de inicio») → **Instalar**.
3. Abre la app desde el icono.

## 4. Uso diario

**Primera vez:** crea una contraseña (mínimo 8 caracteres; mejor una frase de 4 o más palabras).

**Arriba:** selector de mes (‹ › o toca el nombre para elegir mes y año), candado para bloquear y ⚙ Ajustes. Debajo, la franja con Ingresos, Gasto real, Pendiente y Saldo del mes.

**Ingresos:** «+ Añadir ingreso» con descripción, importe, fecha y observaciones opcionales. Marca «Repetir en los próximos meses» para tu salario. Toca un ingreso para editarlo o eliminarlo.

**Gastos** (tres bloques plegables con su subtotal):
- **Gastos fijos.** Los 15 conceptos aparecen solos cada mes.
  - *Importe directo* (Renta, Inversion, Internet, letras, IFARU, Deuda muebles, seguros, Limpieza casa): escribe el importe en la casilla de la derecha y marca el cuadro de la izquierda al pagar (aparece **✓ OK pagado**).
  - *Presupuesto + transacciones* (Super, Luz, Gasolina, Panapass, Ginecologo): toca la partida para desplegarla, pon el **presupuesto mensual** y añade cada compra, factura o recarga con **+ Transacción** (fecha, descripción, importe, pagado). El gasto real empieza en $0 y suma las transacciones. Verás «Quedan $X» o «Excedido por $X». Cuando todas están pagadas aparece **✓ OK**.
- **Gastos del bebé.** «+ Añadir partida del bebé»: elige *Importe directo* para compras puntuales o *Presupuesto + transacciones* para partidas como Pañales o Supermercado bebé. Puedes hacer que se repita cada mes.
- **Gastos generales.** «+ Añadir gasto»: nombre, importe real, fecha y si está pagado. Si alguna vez necesitas desglose, elige el otro tipo.
- **Ahorros.** Cuarta sección, aparte de los gastos: «+ Añadir ahorro» (p. ej. Fondo de emergencia) con el importe del mes y la casilla «apartado» cuando lo transfieras. También puede tener una meta y aportaciones. El ahorro **no cuenta como gasto**, pero se resta aparte: **Saldo libre = ingresos − gastos reales − ahorro**. Por defecto se repite cada mes.
- **Reembolsos.** Quinta sección, para lo que os tienen que devolver (empresa, seguro, familia…) de un pago que **ya registraste en tus gastos** (por ejemplo, dentro del pago de la tarjeta en gastos generales). Con «+ Añadir reembolso» indicas el concepto, quién lo devuelve, el importe y la fecha. Mientras está «por cobrar» no cambia nada. Cuando marcas la casilla («✓ OK reembolsado»), **el importe se suma al saldo libre** (y al «Disponible tras pagos») del mes en que se registró el reembolso. Los pendientes de meses anteriores aparecen al final de la sección para marcarlos cuando lleguen. Si al final no os lo devuelven, simplemente elimínalo.
- **Opciones** de cada partida: renombrar, cambiar de tipo (activar o desactivar el desglose), observaciones, eliminar.

Los importes aceptan `475.50`, `475,50`, `1,075.50` o `$600`.

**Meses nuevos:** al abrir un mes sin datos se crea a partir de tu plantilla, copiando los importes y presupuestos habituales del mes anterior (nunca los pagos ni las transacciones). No se guarda nada hasta que cambies algo, y puedes pulsar «Empezar con importes en blanco». Cada mes es una copia independiente: cambiar un mes, o la plantilla, **no altera los meses anteriores**. La plantilla se gestiona en Ajustes → «Partidas que se repiten cada mes».

**Totales**
- **Mes:** ingresos, gastos reales, ahorro, saldo libre (ingresos − gastos reales − ahorro), ingresos − gastos (antes de ahorrar), disponible tras pagos (ingresos − lo ya pagado − lo ya apartado), pagado y pendiente, desglose por categoría y presupuestos con lo restante o el exceso. La «estimación si gastas todo el presupuesto» se muestra aparte y nunca se resta del saldo.
- **Año / Varios meses:** acumulados, gráfico de gasto por mes y categoría con la marca de ingresos, evolución del saldo, tabla comparativa, promedios por categoría (sólo con meses que tienen datos), presupuesto frente a gasto real por partida (más o menos de lo previsto) y las partidas donde más gastas.

### Presupuestos que se restan desde el inicio (v1.2)
- En las partidas con presupuesto (p. ej. Super $600), el **presupuesto completo se resta del saldo libre desde el primer día**. Cada compra va consumiendo ese presupuesto («Quedan $X»). Si te pasas, se resta el gasto real.
- La franja superior muestra **Gastos** = gastos reales + presupuesto aún por gastar, y **Saldo** = lo que de verdad te queda libre.
- **Fin de mes:** en Totales → Presupuestos, toca **«Pasar sobrante a Ahorros»**. Lo no gastado se añade a Ahorros como «Sobrante de presupuestos», el saldo no cambia y el presupuesto deja de reservarse. Se puede deshacer con «Reabrir presupuestos».

### Reglas de cálculo
- **Presupuesto** = dinero reservado. No es gasto real, pero sí se resta del saldo libre mientras no se pase a Ahorros.
- **Gasto real** = importe directo, o suma de transacciones en partidas con desglose (el importe nunca se cuenta dos veces).
- **Pagado** = importes directos marcados más transacciones marcadas. **Pendiente** = gasto real − pagado.
- **Presupuesto restante** = presupuesto − gasto real (negativo = exceso).
- Ejemplo: presupuesto $600 y compras por $475.50 dan un gasto real de **$475.50** y quedan $124.50.

## 5. Exportar informes

Totales → «Exportar informe» → **Descargar PDF** o **Descargar Excel**. Se exporta el período que estás viendo (mes, año o meses seleccionados). En iPhone se abre el menú Compartir para guardarlo en Archivos, enviarlo, etc.

- **PDF:** resumen, ingresos, cada categoría con presupuesto, gasto real, pagado, pendiente y restante, y las transacciones. Los informes de varios meses incluyen gráfico, comparación mensual, presupuesto frente a real y gasto por partida.
- **Excel:** hojas *Resumen* (por mes, con totales y promedios), *Ingresos*, *Gastos* (una fila por partida), *Ahorros*, *Reembolsos*, *Transacciones*, *Presupuesto vs real* y *Por partida*. Las hojas de registros tienen filtros y los importes son números, para hacer tus propios cálculos. No sumes *Gastos* y *Transacciones* juntas: el gasto real de *Gastos* ya incluye sus transacciones.

## 6. Copias de seguridad y cambio de teléfono

- **Crear copia:** Ajustes → «Descargar copia cifrada». Se genera un archivo `finanzas-copia-cifrada-AAAA-MM-DD.json`, cifrado con tu contraseña actual. Guárdalo fuera del teléfono (correo, iCloud o Google Drive, ordenador).
- **Pasar a otro teléfono:** instala la app en el nuevo → en la pantalla inicial toca «Tengo una copia de seguridad» → elige el archivo → escribe la contraseña de esa copia. Esa pasa a ser la contraseña de la app.
- **Restaurar en el mismo teléfono:** Ajustes → «Restaurar copia» (reemplaza los datos actuales y conserva tu contraseña actual).
- Si cambias la contraseña, las copias antiguas siguen abriéndose con la contraseña antigua. Haz una copia nueva.

## 7. Seguridad aplicada

- Cifrado AES‑256‑GCM con autenticación (detecta archivos manipulados) y clave PBKDF2 de 600.000 iteraciones con sal aleatoria. La clave no es exportable y sólo vive en memoria mientras la app está desbloqueada.
- Bloqueo automático, botón de bloqueo y espera creciente tras 5 contraseñas incorrectas.
- Sin servidor, sin secretos ni credenciales de configuración que proteger, y sin peticiones a terceros.
- Content‑Security‑Policy estricta (sólo código propio, sin `eval`, sin scripts en línea). Todo el texto se inserta como texto (nunca HTML), lo que evita inyecciones.
- Las copias importadas se validan y se reconstruyen campo a campo antes de usarlas.
- Cabeceras HTTPS recomendadas en `_headers` (HSTS, no incrustar en otras webs, nosniff, no‑referrer).
- Librería de PDF incluida localmente: jsPDF 4.2.1 y jsPDF‑AutoTable 5.0.8 (licencia MIT, en `vendor/`). El Excel se genera con código propio.

**¿Y si quiero sincronizar varios dispositivos?** Requeriría un servidor con inicio de sesión (por ejemplo, Supabase o Firebase con autenticación, reglas de acceso por usuario y, de preferencia, los datos cifrados en el propio móvil antes de enviarlos). Es más cómodo pero añade cuentas, coste y superficie de ataque. Para uso personal en un solo teléfono, la opción local cifrada con copias es la más segura y sencilla.

## 8. Pruebas

- `node --test tests/` ejecuta 15 pruebas: cálculos (incluido el ejemplo de $600 y $475.50, y el de $3,000, $2,000 y $1,200), 2.000 transacciones, independencia de meses, plantillas, resumen anual, cifrado (contraseña errónea y manipulación), validación de copias y Excel.
- `node tests/e2e.mjs` (requiere Playwright) prueba la app completa en un iPhone simulado: contraseña, ingresos, gastos fijos, Super con 4 compras, bebé con exceso, generales, totales, mes siguiente independiente, resumen anual, PDF y Excel, recarga, bloqueo, datos cifrados en disco, copia restaurada en un Android simulado, tema claro y apertura sin conexión.

## Estructura

```
index.html, manifest.webmanifest, sw.js, _headers, robots.txt
css/app.css         estilos (paleta tierra, tema oscuro y claro)
js/app.js           interfaz
js/model.js         datos, plantillas y meses
js/calc.js          cálculos
js/crypto.js        cifrado
js/store.js         almacenamiento local
js/reports.js       datos de informes y Excel
js/xlsx.js          generador de .xlsx
js/pdf.js           informe PDF
js/charts.js        gráficos
icons/, vendor/, tests/
```
